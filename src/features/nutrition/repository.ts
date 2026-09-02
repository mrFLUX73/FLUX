import { fallbackProducts, productFromRow } from './catalog';
import type { MealEntry, MealKind, Product, ProductUnit } from './types';
import { getSupabaseClient, isAnonymousAuthEnabled, isSupabaseConfigured } from '../../lib/supabase';

const STORAGE_KEY = 'flux.nutrition-diary.v2';
const PENDING_DELETIONS_KEY = 'flux.nutrition-pending-deletions.v1';

export type NutritionMode = 'local' | 'supabase';

export type NutritionBootstrap = {
  mode: NutritionMode;
  products: Product[];
  entries: MealEntry[];
  message?: string;
};

let userPromise: Promise<string> | null = null;
let bootstrapPromise: Promise<NutritionBootstrap> | null = null;

type PendingDeletion = Pick<MealEntry, 'entryId' | 'mealId'>;

function isSameLocalDay(isoDate: string, date = new Date()) {
  const candidate = new Date(isoDate);
  return !Number.isNaN(candidate.getTime())
    && candidate.getFullYear() === date.getFullYear()
    && candidate.getMonth() === date.getMonth()
    && candidate.getDate() === date.getDate();
}

function readAllLocalEntries(): MealEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is MealEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const value = entry as Partial<MealEntry>;
      return typeof value.entryId === 'string'
        && typeof value.mealId === 'string'
        && typeof value.eatenAt === 'string'
        && typeof value.name === 'string';
    });
  } catch {
    return [];
  }
}

export function loadLocalEntriesForToday() {
  return readAllLocalEntries().filter((entry) => isSameLocalDay(entry.eatenAt));
}

export function persistLocalEntriesForToday(entries: MealEntry[]) {
  try {
    const olderEntries = readAllLocalEntries().filter((entry) => !isSameLocalDay(entry.eatenAt));
    const todayEntries = entries.filter((entry) => isSameLocalDay(entry.eatenAt));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...olderEntries, ...todayEntries]));
    return true;
  } catch {
    return false;
  }
}

export function removeLocalEntryFromStorage(entryId: string) {
  try {
    const remaining = readAllLocalEntries().filter((entry) => entry.entryId !== entryId);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
    return true;
  } catch {
    return false;
  }
}

function readPendingDeletions(): PendingDeletion[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_DELETIONS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PendingDeletion => {
      if (!entry || typeof entry !== 'object') return false;
      const value = entry as Partial<PendingDeletion>;
      return typeof value.entryId === 'string' && typeof value.mealId === 'string';
    });
  } catch {
    return [];
  }
}

function persistPendingDeletions(entries: PendingDeletion[]) {
  window.localStorage.setItem(PENDING_DELETIONS_KEY, JSON.stringify(entries));
}

export function queueRemoteMealDeletion(entry: MealEntry) {
  try {
    const pending = readPendingDeletions();
    if (!pending.some((candidate) => candidate.entryId === entry.entryId)) {
      persistPendingDeletions([...pending, { entryId: entry.entryId, mealId: entry.mealId }]);
    }
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

async function ensureUserId() {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase не настроен');
  if (!userPromise) {
    userPromise = (async () => {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (sessionData.session?.user.id) return sessionData.session.user.id;

      if (!isAnonymousAuthEnabled) {
        throw new Error('Анонимная синхронизация ещё не включена');
      }

      const { data, error } = await client.auth.signInAnonymously({
        options: { data: { display_name: 'Данил' } },
      });
      if (error) throw error;
      if (!data.user?.id) throw new Error('Supabase не вернул пользователя');
      return data.user.id;
    })().catch((error) => {
      userPromise = null;
      throw error;
    });
  }
  return userPromise;
}

async function loadRemoteProducts() {
  const client = await getSupabaseClient();
  if (!client) return fallbackProducts;
  const { data, error } = await client
    .from('products')
    .select('id,name,brand,category,serving_size_g,serving_unit,default_serving_quantity,energy_kcal_per_100g,protein_g_per_100g,carbohydrates_g_per_100g,fat_g_per_100g')
    .order('name');
  if (error) throw error;
  return data.map(productFromRow);
}

async function loadRemoteEntries(userId: string, products: Product[]) {
  const client = await getSupabaseClient();
  if (!client) return [];
  const start = new Date();
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
    .select('id,meal_id,product_id,product_name,portion_quantity,portion_unit,amount_g,energy_kcal,protein_g,carbohydrates_g,fat_g')
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
      brand: product?.brand ?? 'Без бренда',
      amount,
      unit,
      servingSizeG: Number(item.amount_g),
      kcal: Math.round(Number(item.energy_kcal)),
      protein: Math.round(Number(item.protein_g)),
      fat: Math.round(Number(item.fat_g)),
      carbs: Math.round(Number(item.carbohydrates_g)),
      icon: product?.icon ?? 'curd',
      meal: mealFromDatabase(meal.meal_type),
      time: formatTime(meal.eaten_at),
      eatenAt: meal.eaten_at,
    }];
  });
}

async function deleteRemoteEntryById(entryId: string) {
  await ensureUserId();
  const client = await getSupabaseClient();
  if (!client) return false;
  const { error } = await client.rpc('delete_meal_item', { p_item_id: entryId });
  if (error) throw error;
  return true;
}

async function flushPendingDeletions() {
  const pending = readPendingDeletions();
  for (const entry of pending) {
    await deleteRemoteEntryById(entry.entryId);
    persistPendingDeletions(readPendingDeletions().filter((candidate) => candidate.entryId !== entry.entryId));
  }
}

export function bootstrapNutrition(localEntries: MealEntry[], forceRefresh = false): Promise<NutritionBootstrap> {
  if (!isSupabaseConfigured) {
    return Promise.resolve({ mode: 'local', products: fallbackProducts, entries: localEntries });
  }

  if (forceRefresh) bootstrapPromise = null;

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const pendingEntryIds = new Set(readPendingDeletions().map((entry) => entry.entryId));
      const activeLocalEntries = localEntries.filter((entry) => !pendingEntryIds.has(entry.entryId));
      try {
        const userId = await ensureUserId();
        for (const entryId of pendingEntryIds) {
          if (!removeLocalEntryFromStorage(entryId)) {
            throw new Error('Не удалось обновить локальный дневник');
          }
        }
        await flushPendingDeletions();
        const products = await loadRemoteProducts();
        const remoteEntries = await loadRemoteEntries(userId, products);
        const merged = new Map(remoteEntries.map((entry) => [entry.entryId, entry]));

        for (const localEntry of activeLocalEntries) {
          if (merged.has(localEntry.entryId)) continue;
          await addRemoteMealEntry(localEntry);
          merged.set(localEntry.entryId, localEntry);
        }

        return {
          mode: 'supabase' as const,
          products,
          entries: [...merged.values()].sort((a, b) => a.eatenAt.localeCompare(b.eatenAt)),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось подключиться к Supabase';
        return { mode: 'local' as const, products: fallbackProducts, entries: activeLocalEntries, message };
      }
    })();
  }

  return bootstrapPromise;
}

export async function addRemoteMealEntry(entry: MealEntry) {
  if (!isSupabaseConfigured || !entry.productId) return false;
  await ensureUserId();
  const client = await getSupabaseClient();
  if (!client) return false;
  const { error } = await client.rpc('add_meal_item', {
    p_product_id: entry.productId,
    p_meal_type: mealToDatabase(entry.meal),
    p_quantity: entry.amount,
    p_eaten_at: entry.eatenAt,
    p_meal_id: entry.mealId,
    p_item_id: entry.entryId,
  });
  if (error) throw error;
  return true;
}

export async function deleteRemoteMealEntry(entry: MealEntry) {
  if (!isSupabaseConfigured) return false;
  const deleted = await deleteRemoteEntryById(entry.entryId);
  if (deleted && removeLocalEntryFromStorage(entry.entryId)) {
    persistPendingDeletions(readPendingDeletions().filter((candidate) => candidate.entryId !== entry.entryId));
  }
  return deleted;
}
