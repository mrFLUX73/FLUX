import type { SupabaseClient } from '@supabase/supabase-js';

import { fallbackProducts, productFromRow } from './catalog';
import type { MealEntry, MealKind, Product, ProductUnit } from './types';
import {
  getSupabaseClientForUser,
  isSupabaseConfigured,
  SupabaseAuthScopeError,
} from '../../lib/supabase';

const LEGACY_STORAGE_KEY = 'flux.nutrition-diary.v2';
const STORAGE_KEY_PREFIX = 'flux.nutrition-diary.v3';
const PRODUCT_CATALOG_KEY_PREFIX = 'flux.nutrition-products.v1';
const PENDING_DELETIONS_KEY_PREFIX = 'flux.nutrition-pending-deletions.v2';
const PENDING_UPDATES_KEY_PREFIX = 'flux.nutrition-pending-updates.v1';
const GUEST_CLAIM_KEY = 'flux.nutrition-guest-claim.v1';

export type NutritionStorageScope =
  | { kind: 'guest' }
  | { kind: 'user'; userId: string };

export const guestNutritionScope: NutritionStorageScope = { kind: 'guest' };

export function nutritionScopeForUser(userId: string): NutritionStorageScope {
  return { kind: 'user', userId };
}

export function isSameNutritionScope(left: NutritionStorageScope, right: NutritionStorageScope) {
  if (left.kind === 'guest' || right.kind === 'guest') return left.kind === right.kind;
  return left.userId === right.userId;
}

export type NutritionMode = 'local' | 'supabase';

export type NutritionBootstrap = {
  mode: NutritionMode;
  products: Product[];
  entries: MealEntry[];
  message?: string;
  requiresAuth?: boolean;
};

type PendingDeletion = Pick<MealEntry, 'entryId' | 'mealId'>;

type DiaryEnvelope = {
  version: 3;
  ownerUserId: string | null;
  entries: MealEntry[];
  pendingAddEntryIds: string[];
};

type ProductCatalogEnvelope = {
  version: 1;
  ownerUserId: string | null;
  products: Product[];
};

type PendingDeletionsEnvelope = {
  version: 2;
  ownerUserId: string;
  entries: PendingDeletion[];
};

type PendingUpdatesEnvelope = {
  version: 1;
  ownerUserId: string;
  entries: MealEntry[];
};

type GuestClaimMarker = {
  version: 1;
  status: 'copying' | 'done';
  ownerUserId: string;
  sourceEntryIds: string[];
};

function scopeToken(scope: NutritionStorageScope) {
  return scope.kind === 'user' ? `user:${scope.userId}` : 'guest';
}

function storageKey(scope: NutritionStorageScope) {
  return `${STORAGE_KEY_PREFIX}:${scopeToken(scope)}`;
}

function productCatalogKey(scope: NutritionStorageScope) {
  return `${PRODUCT_CATALOG_KEY_PREFIX}:${scopeToken(scope)}`;
}

function pendingDeletionsKey(scope: Extract<NutritionStorageScope, { kind: 'user' }>) {
  return `${PENDING_DELETIONS_KEY_PREFIX}:user:${scope.userId}`;
}

function pendingUpdatesKey(scope: Extract<NutritionStorageScope, { kind: 'user' }>) {
  return `${PENDING_UPDATES_KEY_PREFIX}:user:${scope.userId}`;
}

function ownerUserId(scope: NutritionStorageScope) {
  return scope.kind === 'user' ? scope.userId : null;
}

function isSameLocalDay(isoDate: string, date = new Date()) {
  const candidate = new Date(isoDate);
  return !Number.isNaN(candidate.getTime())
    && candidate.getFullYear() === date.getFullYear()
    && candidate.getMonth() === date.getMonth()
    && candidate.getDate() === date.getDate();
}

function dateFromLocalDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function validMealEntries(value: unknown): MealEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is MealEntry => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Partial<MealEntry>;
    return typeof candidate.entryId === 'string'
      && typeof candidate.mealId === 'string'
      && typeof candidate.eatenAt === 'string'
      && typeof candidate.name === 'string';
  });
}

function validProducts(value: unknown): Product[] {
  if (!Array.isArray(value)) return [];
  return value.filter((product): product is Product => {
    if (!product || typeof product !== 'object') return false;
    const candidate = product as Partial<Product>;
    return typeof candidate.id === 'string'
      && typeof candidate.name === 'string'
      && typeof candidate.brand === 'string'
      && typeof candidate.amount === 'number'
      && typeof candidate.servingSizeG === 'number'
      && typeof candidate.kcal === 'number'
      && typeof candidate.protein === 'number'
      && typeof candidate.fat === 'number'
      && typeof candidate.carbs === 'number'
      && (candidate.unit === 'г' || candidate.unit === 'мл' || candidate.unit === 'шт')
      && (candidate.icon === 'wheat' || candidate.icon === 'curd' || candidate.icon === 'banana' || candidate.icon === 'coffee');
  });
}

function emptyDiary(scope: NutritionStorageScope, entries: MealEntry[] = []): DiaryEnvelope {
  return {
    version: 3,
    ownerUserId: ownerUserId(scope),
    entries,
    pendingAddEntryIds: [],
  };
}

function readLocalDiary(scope: NutritionStorageScope): DiaryEnvelope {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DiaryEnvelope>;
      if (parsed.version !== 3 || parsed.ownerUserId !== ownerUserId(scope)) return emptyDiary(scope);
      const entries = validMealEntries(parsed.entries);
      const entryIds = new Set(entries.map((entry) => entry.entryId));
      const pendingAddEntryIds = Array.isArray(parsed.pendingAddEntryIds)
        ? parsed.pendingAddEntryIds.filter((entryId): entryId is string => typeof entryId === 'string' && entryIds.has(entryId))
        : [];
      return { ...emptyDiary(scope, entries), pendingAddEntryIds };
    }

    // Old entries had no owner. Keep them available only to the guest scope;
    // they must never be attached silently to whichever account signs in next.
    if (scope.kind === 'guest') {
      const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacyRaw) return emptyDiary(scope);
      const legacyEntries = validMealEntries(JSON.parse(legacyRaw) as unknown);
      const diary = emptyDiary(scope, legacyEntries);
      try {
        persistLocalDiary(diary);
      } catch {
        // The legacy value remains untouched and can be retried later.
      }
      return diary;
    }
    return emptyDiary(scope);
  } catch {
    return emptyDiary(scope);
  }
}

function readLocalProducts(scope: NutritionStorageScope): Product[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(productCatalogKey(scope)) ?? '{}') as Partial<ProductCatalogEnvelope>;
    if (parsed.version !== 1 || parsed.ownerUserId !== ownerUserId(scope)) return [];
    return validProducts(parsed.products);
  } catch {
    return [];
  }
}

function persistLocalProducts(scope: NutritionStorageScope, products: Product[]) {
  const deduplicated = new Map<string, Product>();
  for (const product of products) {
    deduplicated.set(productKey(product), product);
  }
  const envelope: ProductCatalogEnvelope = {
    version: 1,
    ownerUserId: ownerUserId(scope),
    products: [...deduplicated.values()],
  };
  window.localStorage.setItem(productCatalogKey(scope), JSON.stringify(envelope));
}

function productKey(product: Product) {
  if (product.isManual) {
    return `manual:${product.name.trim().toLocaleLowerCase('ru')}|${product.brand.trim().toLocaleLowerCase('ru')}`;
  }
  if (product.barcode) return `barcode:${product.barcode}`;
  return `id:${product.id}`;
}

function mergeProducts(...lists: Product[][]) {
  const merged = new Map<string, Product>();
  for (const products of lists) {
    for (const product of products) {
      merged.set(productKey(product), product);
    }
  }
  return [...merged.values()];
}

export function persistLocalProduct(scope: NutritionStorageScope, product: Product) {
  try {
    persistLocalProducts(scope, [...readLocalProducts(scope), product]);
    return true;
  } catch {
    return false;
  }
}

function persistLocalDiary(diary: DiaryEnvelope) {
  const scope = diary.ownerUserId ? nutritionScopeForUser(diary.ownerUserId) : guestNutritionScope;
  window.localStorage.setItem(storageKey(scope), JSON.stringify(diary));
}

function readAllLocalEntries(scope: NutritionStorageScope) {
  return readLocalDiary(scope).entries;
}

export function loadLocalEntriesForToday(scope: NutritionStorageScope) {
  return readAllLocalEntries(scope).filter((entry) => isSameLocalDay(entry.eatenAt));
}

export function loadLocalEntriesForDay(scope: NutritionStorageScope, dayKey: string) {
  return readAllLocalEntries(scope).filter((entry) => isSameLocalDay(entry.eatenAt, dateFromLocalDayKey(dayKey)));
}

function previousLocalMealEntries(scope: NutritionStorageScope, meal: MealKind) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidates = readAllLocalEntries(scope)
    .filter((entry) => entry.meal === meal && new Date(entry.eatenAt).getTime() < today.getTime())
    .sort((left, right) => right.eatenAt.localeCompare(left.eatenAt));
  if (!candidates.length) return [];
  const latestDay = new Date(candidates[0].eatenAt);
  return candidates
    .filter((entry) => isSameLocalDay(entry.eatenAt, latestDay))
    .sort((left, right) => left.eatenAt.localeCompare(right.eatenAt));
}

export function countGuestDiaryEntries() {
  return readLocalDiary(guestNutritionScope).entries.length;
}

export function persistLocalEntriesForToday(scope: NutritionStorageScope, entries: MealEntry[]) {
  try {
    const current = readLocalDiary(scope);
    const olderEntries = current.entries.filter((entry) => !isSameLocalDay(entry.eatenAt));
    const todayEntries = entries.filter((entry) => isSameLocalDay(entry.eatenAt));
    const nextEntries = [...olderEntries, ...todayEntries];
    const nextEntryIds = new Set(nextEntries.map((entry) => entry.entryId));
    persistLocalDiary({
      ...current,
      entries: nextEntries,
      pendingAddEntryIds: current.pendingAddEntryIds.filter((entryId) => nextEntryIds.has(entryId)),
    });
    return true;
  } catch {
    return false;
  }
}

function persistLocalEntriesForDay(scope: NutritionStorageScope, dayKey: string, entries: MealEntry[]) {
  const current = readLocalDiary(scope);
  const date = dateFromLocalDayKey(dayKey);
  const otherEntries = current.entries.filter((entry) => !isSameLocalDay(entry.eatenAt, date));
  const nextEntries = [...otherEntries, ...entries];
  const knownIds = new Set(nextEntries.map((entry) => entry.entryId));
  persistLocalDiary({
    ...current,
    entries: nextEntries,
    pendingAddEntryIds: current.pendingAddEntryIds.filter((entryId) => knownIds.has(entryId)),
  });
}

export function persistUpdatedLocalEntry(scope: NutritionStorageScope, entry: MealEntry) {
  try {
    const current = readLocalDiary(scope);
    if (!current.entries.some((candidate) => candidate.entryId === entry.entryId)) return false;
    persistLocalDiary({
      ...current,
      entries: current.entries.map((candidate) => candidate.entryId === entry.entryId ? entry : candidate),
    });
    return true;
  } catch {
    return false;
  }
}

export function removeLocalEntryFromStorage(scope: NutritionStorageScope, entryId: string) {
  try {
    const current = readLocalDiary(scope);
    persistLocalDiary({
      ...current,
      entries: current.entries.filter((entry) => entry.entryId !== entryId),
      pendingAddEntryIds: current.pendingAddEntryIds.filter((candidate) => candidate !== entryId),
    });
    return true;
  } catch {
    return false;
  }
}

export function persistNewLocalEntry(scope: NutritionStorageScope, entry: MealEntry) {
  try {
    const current = readLocalDiary(scope);
    const entries = current.entries.some((candidate) => candidate.entryId === entry.entryId)
      ? current.entries
      : [...current.entries, entry];
    const pendingAddEntryIds = scope.kind === 'user' && !current.pendingAddEntryIds.includes(entry.entryId)
      ? [...current.pendingAddEntryIds, entry.entryId]
      : current.pendingAddEntryIds;
    persistLocalDiary({ ...current, entries, pendingAddEntryIds });
    return true;
  } catch {
    return false;
  }
}

export function persistNewLocalEntries(scope: NutritionStorageScope, additions: MealEntry[]) {
  try {
    const current = readLocalDiary(scope);
    const knownIds = new Set(current.entries.map((entry) => entry.entryId));
    const uniqueAdditions = additions.filter((entry) => !knownIds.has(entry.entryId));
    const pendingAddEntryIds = scope.kind === 'user'
      ? [...new Set([...current.pendingAddEntryIds, ...uniqueAdditions.map((entry) => entry.entryId)])]
      : current.pendingAddEntryIds;
    persistLocalDiary({
      ...current,
      entries: [...current.entries, ...uniqueAdditions],
      pendingAddEntryIds,
    });
    return true;
  } catch {
    return false;
  }
}

export async function claimGuestDiaryForNewUser(userId: string) {
  await getSupabaseClientForUser(userId);

  const copy = () => {
    const guestDiary = readLocalDiary(guestNutritionScope);
    if (!guestDiary.entries.length) return 0;

    const sourceEntryIds = guestDiary.entries.map((entry) => entry.entryId).sort();
    let previousMarker: GuestClaimMarker | null = null;
    try {
      previousMarker = JSON.parse(window.localStorage.getItem(GUEST_CLAIM_KEY) ?? 'null') as GuestClaimMarker | null;
    } catch {
      previousMarker = null;
    }

    if (previousMarker?.version === 1
      && previousMarker.status === 'copying'
      && previousMarker.ownerUserId !== userId) {
      throw new Error('Этот гостевой дневник уже переносится в другой профиль');
    }

    const marker: GuestClaimMarker = {
      version: 1,
      status: 'copying',
      ownerUserId: userId,
      sourceEntryIds,
    };
    window.localStorage.setItem(GUEST_CLAIM_KEY, JSON.stringify(marker));

    const targetScope = nutritionScopeForUser(userId);
    const targetDiary = readLocalDiary(targetScope);
    const merged = new Map(targetDiary.entries.map((entry) => [entry.entryId, entry]));
    for (const entry of guestDiary.entries) {
      if (!merged.has(entry.entryId)) merged.set(entry.entryId, entry);
    }
    const pendingAddEntryIds = [...new Set([...targetDiary.pendingAddEntryIds, ...sourceEntryIds])];
    persistLocalDiary({ ...targetDiary, entries: [...merged.values()], pendingAddEntryIds });

    const verified = readLocalDiary(targetScope);
    const verifiedIds = new Set(verified.entries.map((entry) => entry.entryId));
    if (!sourceEntryIds.every((entryId) => verifiedIds.has(entryId))) {
      throw new Error('Не удалось проверить перенос гостевого дневника');
    }

    const guestProducts = readLocalProducts(guestNutritionScope);
    if (guestProducts.length) {
      persistLocalProducts(targetScope, mergeProducts(readLocalProducts(targetScope), guestProducts));
      window.localStorage.removeItem(productCatalogKey(guestNutritionScope));
    }

    window.localStorage.removeItem(storageKey(guestNutritionScope));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    window.localStorage.setItem(GUEST_CLAIM_KEY, JSON.stringify({ ...marker, status: 'done' }));
    return guestDiary.entries.length;
  };

  if (navigator.locks) return navigator.locks.request(GUEST_CLAIM_KEY, copy);
  return copy();
}

function markLocalAdditionSynced(scope: Extract<NutritionStorageScope, { kind: 'user' }>, entryId: string) {
  const current = readLocalDiary(scope);
  persistLocalDiary({
    ...current,
    pendingAddEntryIds: current.pendingAddEntryIds.filter((candidate) => candidate !== entryId),
  });
}

function readPendingDeletions(scope: Extract<NutritionStorageScope, { kind: 'user' }>): PendingDeletion[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(pendingDeletionsKey(scope)) ?? '{}') as Partial<PendingDeletionsEnvelope>;
    if (parsed.version !== 2 || parsed.ownerUserId !== scope.userId || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter((entry): entry is PendingDeletion => {
      if (!entry || typeof entry !== 'object') return false;
      const value = entry as Partial<PendingDeletion>;
      return typeof value.entryId === 'string' && typeof value.mealId === 'string';
    });
  } catch {
    return [];
  }
}

function persistPendingDeletions(scope: Extract<NutritionStorageScope, { kind: 'user' }>, entries: PendingDeletion[]) {
  const envelope: PendingDeletionsEnvelope = { version: 2, ownerUserId: scope.userId, entries };
  window.localStorage.setItem(pendingDeletionsKey(scope), JSON.stringify(envelope));
}

function readPendingUpdates(scope: Extract<NutritionStorageScope, { kind: 'user' }>): MealEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(pendingUpdatesKey(scope)) ?? '{}') as Partial<PendingUpdatesEnvelope>;
    if (parsed.version !== 1 || parsed.ownerUserId !== scope.userId) return [];
    return validMealEntries(parsed.entries);
  } catch {
    return [];
  }
}

function persistPendingUpdates(scope: Extract<NutritionStorageScope, { kind: 'user' }>, entries: MealEntry[]) {
  const deduplicated = new Map(entries.map((entry) => [entry.entryId, entry]));
  const envelope: PendingUpdatesEnvelope = { version: 1, ownerUserId: scope.userId, entries: [...deduplicated.values()] };
  window.localStorage.setItem(pendingUpdatesKey(scope), JSON.stringify(envelope));
}

function markLocalUpdateSynced(scope: Extract<NutritionStorageScope, { kind: 'user' }>, entryId: string) {
  persistPendingUpdates(scope, readPendingUpdates(scope).filter((candidate) => candidate.entryId !== entryId));
}

export function queueRemoteMealDeletion(scope: NutritionStorageScope, entry: MealEntry) {
  if (scope.kind !== 'user') return false;
  try {
    const pending = readPendingDeletions(scope);
    if (!pending.some((candidate) => candidate.entryId === entry.entryId)) {
      persistPendingDeletions(scope, [...pending, { entryId: entry.entryId, mealId: entry.mealId }]);
    }
    markLocalUpdateSynced(scope, entry.entryId);
    return true;
  } catch {
    return false;
  }
}

export function queueRemoteMealUpdate(scope: NutritionStorageScope, entry: MealEntry) {
  if (scope.kind !== 'user') return false;
  try {
    const pendingDeletions = readPendingDeletions(scope);
    if (pendingDeletions.some((candidate) => candidate.entryId === entry.entryId)) return true;
    persistPendingUpdates(scope, [...readPendingUpdates(scope), entry]);
    return true;
  } catch {
    return false;
  }
}

function mealToDatabase(meal: MealKind) {
  if (meal === 'Завтрак') return 'breakfast';
  if (meal === 'Обед') return 'lunch';
  if (meal === 'Ужин') return 'dinner';
  return 'snack';
}

function mealFromDatabase(meal: string): MealKind {
  if (meal === 'breakfast') return 'Завтрак';
  if (meal === 'lunch') return 'Обед';
  if (meal === 'dinner') return 'Ужин';
  return 'Перекус';
}

function unitFromDatabase(unit: string | null): ProductUnit {
  if (unit === 'piece') return 'шт';
  if (unit === 'ml') return 'мл';
  return 'г';
}

function formatTime(isoDate: string) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(isoDate));
}

async function loadRemoteProducts(client: SupabaseClient) {
  const { data, error } = await client
    .from('products')
    .select('id,barcode,name,brand,category,serving_size_g,serving_unit,default_serving_quantity,energy_kcal_per_100g,protein_g_per_100g,carbohydrates_g_per_100g,fat_g_per_100g')
    .order('name');
  if (error) throw error;
  return data.map(productFromRow);
}

function databaseUnit(unit: ProductUnit) {
  if (unit === 'шт') return 'piece';
  if (unit === 'мл') return 'ml';
  return 'g';
}

function isDatabaseProductId(value: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

async function ensureRemoteProduct(
  client: SupabaseClient,
  scope: Extract<NutritionStorageScope, { kind: 'user' }>,
  product: Product,
) {
  if (isDatabaseProductId(product.id)) return product.id;

  const selection = 'id,barcode,name,brand,category,serving_size_g,serving_unit,default_serving_quantity,energy_kcal_per_100g,protein_g_per_100g,carbohydrates_g_per_100g,fat_g_per_100g';
  let existingQuery = client.from('products').select(selection).limit(1);
  if (product.barcode) {
    existingQuery = existingQuery.eq('barcode', product.barcode);
  } else {
    existingQuery = existingQuery
      .eq('owner_id', scope.userId)
      .eq('name', product.name);
    existingQuery = product.brand === 'Без бренда'
      ? existingQuery.is('brand', null)
      : existingQuery.eq('brand', product.brand);
  }
  const { data: existing, error: existingError } = await existingQuery;
  if (existingError) throw existingError;
  if (existing?.[0]) return existing[0].id as string;

  const scale = 100 / product.servingSizeG;
  const values = {
    owner_id: scope.userId,
    barcode: product.barcode,
    name: product.name,
    brand: product.brand === 'Без бренда' ? null : product.brand,
    category: product.barcode ? 'Добавлено по штрихкоду' : 'Добавлено вручную',
    serving_size_g: product.servingSizeG,
    serving_unit: databaseUnit(product.unit),
    default_serving_quantity: product.amount,
    energy_kcal_per_100g: product.kcal * scale,
    protein_g_per_100g: product.protein * scale,
    carbohydrates_g_per_100g: product.carbs * scale,
    fat_g_per_100g: product.fat * scale,
    is_verified: false,
  };
  const { data: inserted, error: insertError } = await client
    .from('products')
    .insert(values)
    .select(selection)
    .single();
  if (!insertError) return inserted.id as string;

  // A second device can create the same barcode between the SELECT and INSERT.
  // In that case the unique index wins and we simply reuse the existing row.
  if (insertError.code === '23505') {
    const { data: concurrent, error: concurrentError } = await client
      .from('products')
      .select('id')
      .eq('barcode', product.barcode)
      .limit(1)
      .single();
    if (concurrentError) throw concurrentError;
    return concurrent.id as string;
  }
  throw insertError;
}

async function loadRemoteEntries(client: SupabaseClient, userId: string, products: Product[], date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const { data: meals, error: mealsError } = await client
    .from('meals')
    .select('id,meal_type,eaten_at')
    .eq('user_id', userId)
    .gte('eaten_at', start.toISOString())
    .lt('eaten_at', end.toISOString())
    .order('eaten_at');
  if (mealsError) throw mealsError;
  if (!meals.length) return [];

  const { data: items, error: itemsError } = await client
    .from('meal_items')
    .select('id,meal_id,product_id,product_name,portion_quantity,portion_unit,amount_g,energy_kcal,protein_g,carbohydrates_g,fat_g,external_source,external_food_id,external_brand_id,external_serving_id,external_brand_name')
    .in('meal_id', meals.map((meal) => meal.id));
  if (itemsError) throw itemsError;

  const productMap = new Map(products.map((product) => [product.id, product]));
  const mealMap = new Map(meals.map((meal) => [meal.id, meal]));

  return items.flatMap((item): MealEntry[] => {
    const meal = mealMap.get(item.meal_id);
    if (!meal) return [];
    const product = item.product_id ? productMap.get(item.product_id) : undefined;
    const amount = Number(item.portion_quantity) || Number(item.amount_g);
    const unit = unitFromDatabase(item.portion_unit);
    return [{
      id: product?.id ?? item.product_id ?? item.id,
      productId: item.product_id,
      entryId: item.id,
      mealId: item.meal_id,
      name: item.product_name,
      brand: product?.brand ?? item.external_brand_name ?? 'Без бренда',
      amount,
      unit,
      servingSizeG: Number(item.amount_g),
      kcal: Math.round(Number(item.energy_kcal)),
      protein: Math.round(Number(item.protein_g)),
      fat: Math.round(Number(item.fat_g)),
      carbs: Math.round(Number(item.carbohydrates_g)),
      icon: product?.icon ?? 'curd',
      source: item.external_source === 'nutriapix' ? 'nutriapix' : undefined,
      externalFoodId: item.external_food_id ?? undefined,
      externalBrandId: item.external_brand_id ?? undefined,
      externalServingId: item.external_serving_id ?? undefined,
      meal: mealFromDatabase(meal.meal_type),
      time: formatTime(meal.eaten_at),
      eatenAt: meal.eaten_at,
    }];
  });
}

export async function loadNutritionEntriesForDay(scope: NutritionStorageScope, dayKey: string, products: Product[]) {
  const localEntries = loadLocalEntriesForDay(scope, dayKey);
  if (!isSupabaseConfigured || scope.kind === 'guest') return { entries: localEntries, mode: 'local' as const };

  try {
    const client = await getSupabaseClientForUser(scope.userId);
    const remoteEntries = await loadRemoteEntries(client, scope.userId, products, dateFromLocalDayKey(dayKey));
    persistLocalEntriesForDay(scope, dayKey, remoteEntries);
    return { entries: remoteEntries, mode: 'supabase' as const };
  } catch {
    return { entries: localEntries, mode: 'local' as const };
  }
}

async function loadRemotePreviousMealEntries(client: SupabaseClient, userId: string, meal: MealKind) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: latestMeals, error: latestError } = await client
    .from('meals')
    .select('id,meal_type,eaten_at')
    .eq('user_id', userId)
    .eq('meal_type', mealToDatabase(meal))
    .lt('eaten_at', today.toISOString())
    .order('eaten_at', { ascending: false })
    .limit(1);
  if (latestError) throw latestError;
  const latestMeal = latestMeals?.[0];
  if (!latestMeal) return [];

  const latestDate = new Date(latestMeal.eaten_at);
  const dayStart = new Date(latestDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const { data: meals, error: mealsError } = await client
    .from('meals')
    .select('id,meal_type,eaten_at')
    .eq('user_id', userId)
    .eq('meal_type', mealToDatabase(meal))
    .gte('eaten_at', dayStart.toISOString())
    .lt('eaten_at', dayEnd.toISOString())
    .order('eaten_at');
  if (mealsError) throw mealsError;
  if (!meals?.length) return [];

  const { data: items, error: itemsError } = await client
    .from('meal_items')
    .select('id,meal_id,product_id,product_name,portion_quantity,portion_unit,amount_g,energy_kcal,protein_g,carbohydrates_g,fat_g,external_source,external_food_id,external_brand_id,external_serving_id,external_brand_name')
    .in('meal_id', meals.map((candidate) => candidate.id));
  if (itemsError) throw itemsError;
  if (!items?.length) return [];

  const productIds = [...new Set(items.map((item) => item.product_id).filter((id): id is string => Boolean(id)))];
  const selection = 'id,barcode,name,brand,category,serving_size_g,serving_unit,default_serving_quantity,energy_kcal_per_100g,protein_g_per_100g,carbohydrates_g_per_100g,fat_g_per_100g';
  const { data: productRows, error: productsError } = productIds.length
    ? await client.from('products').select(selection).in('id', productIds)
    : { data: [], error: null };
  if (productsError) throw productsError;
  const productMap = new Map((productRows ?? []).map((row) => {
    const product = productFromRow(row);
    return [product.id, product] as const;
  }));
  const mealMap = new Map(meals.map((candidate) => [candidate.id, candidate]));

  return items.flatMap((item): MealEntry[] => {
    const storedMeal = mealMap.get(item.meal_id);
    if (!storedMeal) return [];
    const product = item.product_id ? productMap.get(item.product_id) : undefined;
    return [{
      id: product?.id ?? item.product_id ?? item.id,
      productId: item.product_id,
      entryId: item.id,
      mealId: item.meal_id,
      name: item.product_name,
      brand: product?.brand ?? item.external_brand_name ?? 'Без бренда',
      amount: Number(item.portion_quantity) || Number(item.amount_g),
      unit: unitFromDatabase(item.portion_unit),
      servingSizeG: Number(item.amount_g),
      kcal: Math.round(Number(item.energy_kcal)),
      protein: Math.round(Number(item.protein_g) * 10) / 10,
      fat: Math.round(Number(item.fat_g) * 10) / 10,
      carbs: Math.round(Number(item.carbohydrates_g) * 10) / 10,
      icon: product?.icon ?? 'curd',
      source: item.external_source === 'nutriapix' ? 'nutriapix' : undefined,
      externalFoodId: item.external_food_id ?? undefined,
      externalBrandId: item.external_brand_id ?? undefined,
      externalServingId: item.external_serving_id ?? undefined,
      meal: mealFromDatabase(storedMeal.meal_type),
      time: formatTime(storedMeal.eaten_at),
      eatenAt: storedMeal.eaten_at,
    }];
  });
}

export async function loadPreviousMealEntries(scope: NutritionStorageScope, meal: MealKind) {
  const localEntries = previousLocalMealEntries(scope, meal);
  if (!isSupabaseConfigured || scope.kind === 'guest') return localEntries;

  try {
    const client = await getSupabaseClientForUser(scope.userId);
    const remoteEntries = await loadRemotePreviousMealEntries(client, scope.userId, meal);
    if (!remoteEntries.length) return localEntries;
    const current = readLocalDiary(scope);
    const merged = new Map(current.entries.map((entry) => [entry.entryId, entry]));
    for (const entry of remoteEntries) merged.set(entry.entryId, entry);
    persistLocalDiary({ ...current, entries: [...merged.values()] });
    return remoteEntries;
  } catch {
    return localEntries;
  }
}

async function deleteRemoteEntryById(client: SupabaseClient, entryId: string) {
  const { data, error } = await client.rpc('delete_meal_item', { p_item_id: entryId });
  if (error) throw error;
  return data === true;
}

async function flushPendingDeletions(client: SupabaseClient, scope: Extract<NutritionStorageScope, { kind: 'user' }>) {
  const pending = readPendingDeletions(scope);
  for (const entry of pending) {
    // false is an idempotent success: this user's row is already absent.
    await deleteRemoteEntryById(client, entry.entryId);
    persistPendingDeletions(scope, readPendingDeletions(scope).filter((candidate) => candidate.entryId !== entry.entryId));
  }
}

async function addRemoteMealEntryWithClient(
  client: SupabaseClient,
  scope: Extract<NutritionStorageScope, { kind: 'user' }>,
  entry: MealEntry,
) {
  if (entry.source === 'nutriapix') {
    if (!entry.externalFoodId) return false;
    const { error } = await client.rpc('add_external_meal_item', {
      p_source: 'nutriapix',
      p_source_food_id: entry.externalFoodId,
      p_source_brand_id: entry.externalBrandId ?? '',
      p_source_serving_id: entry.externalServingId ?? '',
      p_product_name: entry.name,
      p_brand_name: entry.brand,
      p_meal_type: mealToDatabase(entry.meal),
      p_portion_quantity: entry.amount,
      p_portion_unit: databaseUnit(entry.unit),
      p_amount_g: entry.unit === 'шт' ? entry.servingSizeG : entry.amount,
      p_energy_kcal: entry.kcal,
      p_protein_g: entry.protein,
      p_carbohydrates_g: entry.carbs,
      p_fat_g: entry.fat,
      p_eaten_at: entry.eatenAt,
      p_meal_id: entry.mealId,
      p_item_id: entry.entryId,
    });
    if (error) throw error;
    markLocalAdditionSynced(scope, entry.entryId);
    return true;
  }
  if (!entry.productId) return false;
  const productId = await ensureRemoteProduct(client, scope, entry);
  const { error } = await client.rpc('add_meal_item', {
    p_product_id: productId,
    p_meal_type: mealToDatabase(entry.meal),
    p_quantity: entry.amount,
    p_eaten_at: entry.eatenAt,
    p_meal_id: entry.mealId,
    p_item_id: entry.entryId,
  });
  if (error) throw error;
  markLocalAdditionSynced(scope, entry.entryId);
  return true;
}

async function updateRemoteMealEntryWithClient(
  client: SupabaseClient,
  scope: Extract<NutritionStorageScope, { kind: 'user' }>,
  entry: MealEntry,
) {
  if (entry.source === 'nutriapix') {
    const { error } = await client.rpc('update_external_meal_item', {
      p_item_id: entry.entryId,
      p_meal_type: mealToDatabase(entry.meal),
      p_portion_quantity: entry.amount,
      p_portion_unit: databaseUnit(entry.unit),
      p_amount_g: entry.unit === 'шт' ? entry.servingSizeG : entry.amount,
      p_energy_kcal: entry.kcal,
      p_protein_g: entry.protein,
      p_carbohydrates_g: entry.carbs,
      p_fat_g: entry.fat,
    });
    if (error) throw error;
    markLocalUpdateSynced(scope, entry.entryId);
    return true;
  }
  const { error } = await client.rpc('update_meal_item', {
    p_item_id: entry.entryId,
    p_meal_type: mealToDatabase(entry.meal),
    p_quantity: entry.amount,
  });
  if (error) throw error;
  markLocalUpdateSynced(scope, entry.entryId);
  return true;
}

async function flushPendingUpdates(client: SupabaseClient, scope: Extract<NutritionStorageScope, { kind: 'user' }>) {
  for (const entry of readPendingUpdates(scope)) {
    await updateRemoteMealEntryWithClient(client, scope, entry);
  }
}

export async function bootstrapNutrition(scope: NutritionStorageScope, localEntries: MealEntry[]): Promise<NutritionBootstrap> {
  const localProducts = readLocalProducts(scope);
  if (!isSupabaseConfigured || scope.kind === 'guest') {
    return { mode: 'local', products: mergeProducts(fallbackProducts, localProducts), entries: localEntries };
  }

  const pendingEntryIds = new Set(readPendingDeletions(scope).map((entry) => entry.entryId));
  const activeLocalEntries = localEntries.filter((entry) => !pendingEntryIds.has(entry.entryId));
  const pendingAddEntryIds = new Set(readLocalDiary(scope).pendingAddEntryIds);
  const pendingLocalEntries = activeLocalEntries.filter((entry) => pendingAddEntryIds.has(entry.entryId));
  try {
    const client = await getSupabaseClientForUser(scope.userId);
    for (const entryId of pendingEntryIds) {
      if (!removeLocalEntryFromStorage(scope, entryId)) {
        throw new Error('Не удалось обновить локальный дневник');
      }
    }
    await flushPendingDeletions(client, scope);
    const products = await loadRemoteProducts(client);
    const remoteEntries = await loadRemoteEntries(client, scope.userId, products);
    const merged = new Map(remoteEntries.map((entry) => [entry.entryId, entry]));

    for (const localEntry of pendingLocalEntries) {
      if (merged.has(localEntry.entryId)) {
        markLocalAdditionSynced(scope, localEntry.entryId);
        continue;
      }
      const synced = await addRemoteMealEntryWithClient(client, scope, localEntry);
      if (!synced) throw new Error('Не удалось синхронизировать локальную запись');
      merged.set(localEntry.entryId, localEntry);
    }
    const pendingUpdates = readPendingUpdates(scope);
    await flushPendingUpdates(client, scope);
    for (const entry of pendingUpdates) merged.set(entry.entryId, entry);

    return {
      mode: 'supabase' as const,
      // Keep the small verified starter catalogue available even before a
      // newly deployed catalogue migration has reached a device. Database rows
      // still win when their ids coincide.
      products: mergeProducts(fallbackProducts, localProducts, products),
      entries: [...merged.values()].sort((a, b) => a.eatenAt.localeCompare(b.eatenAt)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось подключиться к Supabase';
    return {
      mode: 'local' as const,
      products: mergeProducts(fallbackProducts, localProducts),
      entries: activeLocalEntries,
      message,
      requiresAuth: error instanceof SupabaseAuthScopeError,
    };
  }
}

export async function addRemoteMealEntry(scope: NutritionStorageScope, entry: MealEntry) {
  if (!isSupabaseConfigured || scope.kind !== 'user' || (!entry.productId && entry.source !== 'nutriapix')) return false;
  const client = await getSupabaseClientForUser(scope.userId);
  return addRemoteMealEntryWithClient(client, scope, entry);
}

export async function deleteRemoteMealEntry(scope: NutritionStorageScope, entry: MealEntry) {
  if (!isSupabaseConfigured || scope.kind !== 'user') return false;
  const client = await getSupabaseClientForUser(scope.userId);
  await deleteRemoteEntryById(client, entry.entryId);
  if (removeLocalEntryFromStorage(scope, entry.entryId)) {
    persistPendingDeletions(scope, readPendingDeletions(scope).filter((candidate) => candidate.entryId !== entry.entryId));
  }
  return true;
}

export async function updateRemoteMealEntry(scope: NutritionStorageScope, entry: MealEntry) {
  if (!isSupabaseConfigured || scope.kind !== 'user') return false;
  const client = await getSupabaseClientForUser(scope.userId);
  return updateRemoteMealEntryWithClient(client, scope, entry);
}
