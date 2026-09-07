export const MEAL_KINDS = ['Завтрак', 'Обед', 'Перекус', 'Ужин'] as const;

export type MealKind = (typeof MEAL_KINDS)[number];
export type ProductUnit = 'г' | 'шт' | 'мл';
export type ProductIconName = 'wheat' | 'curd' | 'banana' | 'coffee';

export type Product = {
  id: string;
  barcode?: string;
  name: string;
  brand: string;
  amount: number;
  unit: ProductUnit;
  servingSizeG: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  icon: ProductIconName;
  // Personal products created through the manual form use a name/brand key
  // while their temporary local id is replaced by a database UUID.
  isManual?: boolean;
  // A Nutriapix card is ephemeral under the provider's terms. FLUX keeps only
  // the selected meal snapshot, never the card in the permanent catalogue.
  source?: 'nutriapix';
  externalFoodId?: string;
  externalBrandId?: string;
  externalServingId?: string;
};

export type MealEntry = Product & {
  entryId: string;
  mealId: string;
  productId: string | null;
  meal: MealKind;
  time: string;
  eatenAt: string;
};

export type NutritionTotals = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};
