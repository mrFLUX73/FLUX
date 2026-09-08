import { getSupabaseClientForUser } from '../../lib/supabase';
import type { Product } from './types';

export type ProductSuggestionStatus = 'pending' | 'approved' | 'rejected';

export type ProductSuggestion = {
  id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  servingSizeG: number;
  servingUnit: 'g' | 'ml' | 'piece';
  defaultServingQuantity: number;
  kcalPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  source: string;
  status: ProductSuggestionStatus;
  createdAt: string;
};

type StoredProductSuggestion = {
  id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  serving_size_g: number | string;
  serving_unit: 'g' | 'ml' | 'piece';
  default_serving_quantity: number | string;
  energy_kcal_per_100g: number | string;
  protein_g_per_100g: number | string;
  carbohydrates_g_per_100g: number | string;
  fat_g_per_100g: number | string;
  source: string;
  status: ProductSuggestionStatus;
  created_at: string;
};

const columns = 'id,barcode,name,brand,serving_size_g,serving_unit,default_serving_quantity,energy_kcal_per_100g,protein_g_per_100g,carbohydrates_g_per_100g,fat_g_per_100g,source,status,created_at';

function number(value: number | string) {
  return Number(value);
}

function toSuggestion(value: StoredProductSuggestion): ProductSuggestion {
  return {
    id: value.id, barcode: value.barcode, name: value.name, brand: value.brand,
    servingSizeG: number(value.serving_size_g), servingUnit: value.serving_unit,
    defaultServingQuantity: number(value.default_serving_quantity), kcalPer100: number(value.energy_kcal_per_100g),
    proteinPer100: number(value.protein_g_per_100g), carbsPer100: number(value.carbohydrates_g_per_100g),
    fatPer100: number(value.fat_g_per_100g), source: value.source, status: value.status, createdAt: value.created_at,
  };
}

function databaseUnit(product: Product): 'g' | 'ml' | 'piece' {
  return product.unit === 'г' ? 'g' : product.unit === 'мл' ? 'ml' : 'piece';
}

function sourceFor(product: Product) {
  if (product.id.startsWith('open-food-facts:')) return 'open_food_facts';
  if (product.id.startsWith('fatsecret:')) return 'fatsecret';
  return 'manual';
}

export async function submitProductSuggestion(userId: string, product: Product) {
  if (product.source === 'nutriapix') throw new Error('Карточки Nutriapix нельзя добавлять в общую базу');
  if (!product.servingSizeG || product.servingSizeG <= 0) throw new Error('У продукта нет корректной порции');
  const scale = 100 / product.servingSizeG;
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('create_product_suggestion', {
    p_barcode: product.barcode ?? null,
    p_name: product.name,
    p_brand: product.brand === 'Без бренда' ? null : product.brand,
    p_serving_size_g: product.servingSizeG,
    p_serving_unit: databaseUnit(product),
    p_default_serving_quantity: product.amount,
    p_energy_kcal_per_100g: product.kcal * scale,
    p_protein_g_per_100g: product.protein * scale,
    p_carbohydrates_g_per_100g: product.carbs * scale,
    p_fat_g_per_100g: product.fat * scale,
    p_source: sourceFor(product),
  });
  if (error || !data) throw error ?? new Error('Не удалось отправить предложение');
  return data as string;
}

export async function loadProductSuggestions(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.from('product_suggestions').select(columns).eq('status', 'pending').order('created_at', { ascending: false }).returns<StoredProductSuggestion[]>();
  if (error) throw error;
  return (data ?? []).map(toSuggestion);
}

export async function reviewProductSuggestion(userId: string, id: string, decision: Extract<ProductSuggestionStatus, 'approved' | 'rejected'>) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('review_product_suggestion', { p_suggestion_id: id, p_decision: decision });
  if (error || data !== true) throw error ?? new Error('Предложение не найдено');
}
