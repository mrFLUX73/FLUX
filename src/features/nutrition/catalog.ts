import type { Product, ProductIconName, ProductUnit } from './types';

export const barcodeDemoProduct: Product = {
  id: 'barcode-demo-4601751007674',
  barcode: '4601751007674',
  name: 'Творог обезжиренный 0,3%',
  brand: 'Волжские Просторы',
  amount: 180,
  unit: 'г',
  servingSizeG: 180,
  kcal: 153,
  protein: 32.4,
  fat: 0,
  carbs: 5.9,
  icon: 'curd',
};

export const barcodeDemoAlternatives: Product[] = [
  { id: 'barcode-demo-curd-05', name: 'Творог 0,5%', brand: 'Волжские Просторы', amount: 180, unit: 'г', servingSizeG: 180, kcal: 153, protein: 32, fat: 0.9, carbs: 5.8, icon: 'curd' },
  { id: 'barcode-demo-curd-5', name: 'Творог 5%', brand: 'Волжские Просторы', amount: 180, unit: 'г', servingSizeG: 180, kcal: 218, protein: 30, fat: 9, carbs: 5, icon: 'curd' },
];

export const fallbackProducts: Product[] = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Овсянка на молоке', brand: 'Домашнее блюдо', amount: 180, unit: 'г', servingSizeG: 180, kcal: 190, protein: 7, fat: 5, carbs: 29, icon: 'wheat' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Творог 5%', brand: 'Простоквашино', amount: 180, unit: 'г', servingSizeG: 180, kcal: 218, protein: 30, fat: 9, carbs: 5, icon: 'curd' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Банан', brand: 'Обычный', amount: 1, unit: 'шт', servingSizeG: 120, kcal: 105, protein: 1, fat: 0, carbs: 27, icon: 'banana' },
  { id: '10000000-0000-4000-8000-000000000004', name: 'Капучино', brand: 'Без сахара', amount: 250, unit: 'мл', servingSizeG: 250, kcal: 120, protein: 6, fat: 6, carbs: 10, icon: 'coffee' },
  { id: '10000000-0000-4000-8000-000000000005', name: 'Куриная грудка', brand: 'Запечённая', amount: 150, unit: 'г', servingSizeG: 150, kcal: 248, protein: 47, fat: 5, carbs: 0, icon: 'curd' },
  { id: '10000000-0000-4000-8000-000000000006', name: 'Рис', brand: 'Варёный', amount: 180, unit: 'г', servingSizeG: 180, kcal: 234, protein: 5, fat: 1, carbs: 50, icon: 'wheat' },
  { id: '10000000-0000-4000-8000-000000000007', name: 'Яйца', brand: 'Варёные', amount: 2, unit: 'шт', servingSizeG: 120, kcal: 186, protein: 16, fat: 13, carbs: 1, icon: 'curd' },
  { id: '10000000-0000-4000-8000-000000000013', name: 'Яйцо', brand: 'Куриное, сырое', amount: 1, unit: 'шт', servingSizeG: 50, kcal: 72, protein: 6.3, fat: 4.8, carbs: 0.4, icon: 'curd' },
  { id: '10000000-0000-4000-8000-000000000008', name: 'Йогурт греческий', brand: 'Без сахара', amount: 170, unit: 'г', servingSizeG: 170, kcal: 132, protein: 17, fat: 3, carbs: 8, icon: 'curd' },
  { id: '10000000-0000-4000-8000-000000000009', name: 'Гречка', brand: 'Варёная', amount: 180, unit: 'г', servingSizeG: 180, kcal: 198, protein: 7, fat: 2, carbs: 39, icon: 'wheat' },
  { id: '10000000-0000-4000-8000-000000000010', name: 'Яблоко', brand: 'Свежее', amount: 1, unit: 'шт', servingSizeG: 180, kcal: 94, protein: 1, fat: 0, carbs: 25, icon: 'banana' },
  { id: '10000000-0000-4000-8000-000000000011', name: 'Лосось', brand: 'Запечённый', amount: 150, unit: 'г', servingSizeG: 150, kcal: 312, protein: 33, fat: 20, carbs: 0, icon: 'curd' },
  { id: '10000000-0000-4000-8000-000000000012', name: 'Овощной салат', brand: 'С оливковым маслом', amount: 250, unit: 'г', servingSizeG: 250, kcal: 145, protein: 4, fat: 9, carbs: 16, icon: 'banana' },
];

function searchTokens(value: string) {
  return value
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

// This is deliberately a small, predictable normaliser rather than a full
// morphology engine. It covers the common singular/plural forms that people
// naturally use in a food diary: "яйцо" ⇄ "яйца", "банан" ⇄ "бананы".
function searchStem(token: string) {
  if (token.length < 4 || !/^[а-я]+$/u.test(token)) return token;
  const ending = ['иями', 'ями', 'ами', 'ого', 'ему', 'иях', 'ов', 'ев', 'ах', 'ях', 'ый', 'ий', 'ая', 'ое', 'ые', 'ой', 'ей', 'ам', 'ям', 'ом', 'ем', 'у', 'ю', 'а', 'я', 'ы', 'и', 'о', 'е']
    .find((candidate) => token.endsWith(candidate) && token.length - candidate.length >= 3);
  return ending ? token.slice(0, -ending.length) : token;
}

const preparationWords = ['варен', 'жарен', 'запеч', 'тушен', 'копчен', 'солен', 'марин'];

export function matchesProductSearch(product: Product, query: string) {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length) return true;
  const productTokens = searchTokens(`${product.name} ${product.brand} ${product.barcode ?? ''}`);
  return queryTokens.every((queryToken) => productTokens.some((productToken) => (
    productToken.includes(queryToken)
    || searchStem(productToken).includes(searchStem(queryToken))
    || searchStem(queryToken).includes(searchStem(productToken))
  )));
}

export function productSearchRank(product: Product, query: string) {
  const queryTokens = searchTokens(query);
  const nameTokens = searchTokens(product.name);
  const productTokens = searchTokens(`${product.name} ${product.brand}`);
  const normalizedQuery = queryTokens.join(' ');
  const normalizedName = nameTokens.join(' ');
  const queryHasPreparation = queryTokens.some((token) => preparationWords.some((word) => token.startsWith(word)));
  const hasPreparation = productTokens.some((token) => preparationWords.some((word) => token.startsWith(word)));

  let rank = 0;
  if (normalizedName === normalizedQuery) rank += 100;
  if (normalizedName.startsWith(normalizedQuery)) rank += 45;
  rank += queryTokens.filter((queryToken) => nameTokens.some((nameToken) => searchStem(nameToken) === searchStem(queryToken))).length * 20;

  // When a preparation method was not requested, a neutral product is the
  // safer default than a cooked variation. "варёное яйцо" still ranks the
  // cooked result first because that word is explicitly present in the query.
  if (hasPreparation && !queryHasPreparation) rank -= 70;
  if (nameTokens.length === 1) rank += 8;
  return rank;
}

type ProductRow = {
  id: string;
  barcode?: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  serving_size_g: number | string | null;
  serving_unit: 'g' | 'piece' | 'ml' | null;
  default_serving_quantity: number | string | null;
  energy_kcal_per_100g: number | string;
  protein_g_per_100g: number | string;
  carbohydrates_g_per_100g: number | string;
  fat_g_per_100g: number | string;
};

function iconForCategory(category: string | null): ProductIconName {
  const value = category?.toLocaleLowerCase('ru') ?? '';
  if (value.includes('напит')) return 'coffee';
  if (value.includes('фрукт') || value.includes('овощ')) return 'banana';
  if (value.includes('круп') || value.includes('каша')) return 'wheat';
  return 'curd';
}

function unitFromDatabase(unit: ProductRow['serving_unit']): ProductUnit {
  if (unit === 'piece') return 'шт';
  if (unit === 'ml') return 'мл';
  return 'г';
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

export function productFromRow(row: ProductRow): Product {
  const servingSizeG = Number(row.serving_size_g) || 100;
  const amount = Number(row.default_serving_quantity) || servingSizeG;
  const scale = servingSizeG / 100;

  return {
    id: row.id,
    barcode: row.barcode || undefined,
    name: row.name,
    brand: row.brand || 'Без бренда',
    amount,
    unit: unitFromDatabase(row.serving_unit),
    servingSizeG,
    kcal: Math.round(Number(row.energy_kcal_per_100g) * scale),
    protein: rounded(Number(row.protein_g_per_100g) * scale),
    fat: rounded(Number(row.fat_g_per_100g) * scale),
    carbs: rounded(Number(row.carbohydrates_g_per_100g) * scale),
    icon: iconForCategory(row.category),
  };
}
