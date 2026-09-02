export const MEAL_KINDS = ['Завтрак', 'Обед', 'Перекус', 'Ужин'] as const;

export type MealKind = (typeof MEAL_KINDS)[number];
export type ProductUnit = 'г' | 'шт' | 'мл';
export type ProductIconName = 'wheat' | 'curd' | 'banana' | 'coffee';

export type Product = {
  id: string;
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

