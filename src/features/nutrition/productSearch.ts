import type { Product, ProductIconName, ProductUnit } from './types';
import { invokeSupabaseFunction } from '../../lib/supabase';

const OPEN_FOOD_FACTS_FIELDS = [
  'code',
  'product_name_ru',
  'product_name',
  'brands',
  'categories_tags',
  'product_quantity',
  'product_quantity_unit',
  'nutrition_data_per',
  'nutriments',
].join(',');

type OpenFoodFactsProduct = {
  code?: string;
  product_name_ru?: string;
  product_name?: string;
  brands?: string;
  categories_tags?: string[];
  product_quantity?: number | string;
  product_quantity_unit?: string;
  nutrition_data_per?: string;
  nutriments?: Record<string, number | string | undefined>;
};

type OpenFoodFactsResponse = {
  status?: number;
  product?: OpenFoodFactsProduct;
};

export type BarcodeLookupResult =
  | { status: 'found'; product: Product; source: 'Nutriapix' | 'Open Food Facts' | 'FatSecret' }
  | { status: 'not_found' }
  | { status: 'incomplete'; name: string }
  | { status: 'error'; message: string };

export type NutriapixSearchCandidate = {
  source: 'nutriapix';
  name: string;
  brand: string;
  slug: string;
};

export type OpenFoodFactsSearchCandidate = {
  source: 'open_food_facts';
  name: string;
  brand: string;
  product: Product;
};

export type ProductSearchCandidate = NutriapixSearchCandidate | OpenFoodFactsSearchCandidate;

type NutriapixSearchResponse =
  | { status: 'found'; candidates: ProductSearchCandidate[] }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

type NutriapixFoodResponse =
  | { status: 'found'; product: Product }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

function number(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function productIcon(product: OpenFoodFactsProduct): ProductIconName {
  const categories = product.categories_tags?.join(' ').toLocaleLowerCase('ru') ?? '';
  if (/beverage|drink|напит/.test(categories)) return 'coffee';
  if (/fruit|vegetable|фрукт|овощ/.test(categories)) return 'banana';
  if (/cereal|grain|круп|каша/.test(categories)) return 'wheat';
  return 'curd';
}

function serving(product: OpenFoodFactsProduct): { amount: number; unit: ProductUnit; servingSizeG: number } {
  const rawUnit = product.product_quantity_unit?.toLocaleLowerCase('ru') ?? '';
  const categories = product.categories_tags?.join(' ').toLocaleLowerCase('ru') ?? '';
  const isLiquid = /^(ml|мл|cl|л|l)$/.test(rawUnit)
    || product.nutrition_data_per === '100ml'
    || /beverage|drink|напит/.test(categories);
  const rawQuantity = number(product.product_quantity);
  let amount = rawQuantity && rawQuantity <= 5000 ? rawQuantity : 100;
  if (rawUnit === 'cl') amount *= 10;
  if (rawUnit === 'l' || rawUnit === 'л') amount *= 1000;
  return { amount: rounded(amount), unit: isLiquid ? 'мл' : 'г', servingSizeG: rounded(amount) };
}

async function lookupOpenFoodFactsByBarcode(barcode: string, signal?: AbortSignal): Promise<BarcodeLookupResult> {
  if (!/^\d{8,14}$/.test(barcode)) return { status: 'not_found' };

  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OPEN_FOOD_FACTS_FIELDS}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'error', message: `Источник временно недоступен (${response.status})` };

    const payload = await response.json() as OpenFoodFactsResponse;
    if (payload.status !== 1 || !payload.product) return { status: 'not_found' };

    const source = payload.product;
    const name = source.product_name_ru?.trim() || source.product_name?.trim() || '';
    const kcal = number(source.nutriments?.['energy-kcal_100g']);
    const protein = number(source.nutriments?.proteins_100g);
    const fat = number(source.nutriments?.fat_100g);
    const carbs = number(source.nutriments?.carbohydrates_100g);
    if (!name || kcal === null || protein === null || fat === null || carbs === null) {
      return { status: 'incomplete', name: name || `Товар ${barcode}` };
    }

    const portion = serving(source);
    const scale = portion.servingSizeG / 100;
    return {
      status: 'found',
      source: 'Open Food Facts',
      product: {
        id: `open-food-facts:${barcode}`,
        barcode,
        name,
        brand: source.brands?.trim() || 'Без бренда',
        amount: portion.amount,
        unit: portion.unit,
        servingSizeG: portion.servingSizeG,
        kcal: Math.round(kcal * scale),
        protein: rounded(protein * scale),
        fat: rounded(fat * scale),
        carbs: rounded(carbs * scale),
        icon: productIcon(source),
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { status: 'error', message: 'Не удалось связаться с базой продуктов' };
  }
}

function isBarcodeLookupResult(value: unknown): value is BarcodeLookupResult {
  if (!value || typeof value !== 'object' || !('status' in value)) return false;
  const status = (value as { status?: unknown }).status;
  return status === 'found' || status === 'not_found' || status === 'incomplete' || status === 'error';
}

export async function lookupProductByBarcode(barcode: string, signal?: AbortSignal): Promise<BarcodeLookupResult> {
  if (!/^\d{8,14}$/.test(barcode)) return { status: 'not_found' };

  try {
    const result = await invokeSupabaseFunction<unknown>('product-search', { barcode }, signal);
    if (isBarcodeLookupResult(result)) return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // Guest mode and a temporarily unavailable Edge Function still retain
    // the direct Open Food Facts lookup instead of turning barcode search off.
  }

  return lookupOpenFoodFactsByBarcode(barcode, signal);
}

export async function searchNutriapixProducts(query: string, signal?: AbortSignal): Promise<NutriapixSearchResponse> {
  const normalized = query.trim();
  if (normalized.length < 3 || normalized.length > 100) return { status: 'not_found' };
  try {
    return await invokeSupabaseFunction<NutriapixSearchResponse>('product-search', {
      mode: 'nutriapix-search', query: normalized,
    }, signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { status: 'error', message: 'Поиск Nutriapix временно недоступен.' };
  }
}

export async function getNutriapixProduct(slug: string, signal?: AbortSignal): Promise<NutriapixFoodResponse> {
  try {
    return await invokeSupabaseFunction<NutriapixFoodResponse>('product-search', {
      mode: 'nutriapix-food', slug,
    }, signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { status: 'error', message: 'Не удалось получить карточку продукта.' };
  }
}
