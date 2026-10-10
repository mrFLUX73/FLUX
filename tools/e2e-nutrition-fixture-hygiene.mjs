// Interrupted Nutrition fixtures are discoverable only through an owned
// product name carrying a UUID marker. Cleanup refuses mixed meals instead of
// guessing whether an unmarked row belongs to the test.
const markerPattern = /^\[FLUX E2E nutrition:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]$/i;

function fail(message) { throw new Error(`E2E nutrition fixture hygiene: ${message}`); }
export function isOwnedNutritionFixtureProduct(product) {
  if (!product?.id || !product?.owner_id || typeof product.name !== 'string') return false;
  const match = product.name.match(/(\[FLUX E2E nutrition:[0-9a-f-]{36}\])$/i);
  return Boolean(match && markerPattern.test(match[1]));
}

export async function cleanInterruptedNutritionFixtures(admin, syntheticUserIds) {
  const ids = [...new Set(syntheticUserIds)];
  if (!ids.length) return { products: 0, meals: 0, items: 0 };
  const { data: registry, error: registryError } = await admin.from('test_accounts').select('user_id').in('user_id', ids);
  if (registryError || registry.length !== ids.length) fail('synthetic registry changed before cleanup; no fixture data was touched');

  // Query broadly enough to find an orphan with no child rows; exact ownership
  // is proven below, before any delete can be attempted.
  const { data: products, error: productError } = await admin.from('products').select('id,owner_id,name').in('owner_id', ids).like('name', '%FLUX E2E nutrition:%');
  if (productError) fail(`could not inspect marked products: ${productError.message}`);
  const ownedProducts = (products ?? []).filter(isOwnedNutritionFixtureProduct);
  const productIds = ownedProducts.map((product) => product.id);
  const productById = new Map(ownedProducts.map((product) => [product.id, product]));

  const productItemsResult = productIds.length
    ? await admin.from('meal_items').select('id,user_id,meal_id,product_id,product_name').in('product_id', productIds).in('user_id', ids)
    : { data: [], error: null };
  const { data: productItems, error: itemError } = productItemsResult;
  if (itemError) fail(`could not inspect marked meal items: ${itemError.message}`);
  const { data: externalItems, error: externalItemError } = await admin.from('meal_items').select('id,user_id,meal_id,product_id,product_name,external_source').in('user_id', ids).is('product_id', null).like('product_name', '%[FLUX E2E nutrition:%');
  if (externalItemError) fail(`could not inspect marked external meal items: ${externalItemError.message}`);
  if (!productIds.length && !(externalItems ?? []).length) return { products: 0, meals: 0, items: 0 };
  if ((productItems ?? []).some((item) => {
    const product = productById.get(item.product_id);
    return !product || product.owner_id !== item.user_id || product.name !== item.product_name;
  }) || (externalItems ?? []).some((item) => {
    const match = item.product_name.match(/(\[FLUX E2E nutrition:[0-9a-f-]{36}\])$/i);
    return item.external_source !== 'nutriapix' || !match || !markerPattern.test(match[1]);
  })) fail('a candidate item did not prove test ownership; no fixture data was touched');

  const items = [...(productItems ?? []), ...(externalItems ?? [])];
  const itemIds = items.map((item) => item.id);
  const mealIds = [...new Set(items.map((item) => item.meal_id))];
  if (mealIds.length) {
    const { data: allMealItems, error } = await admin.from('meal_items').select('id,user_id,meal_id,product_id').in('meal_id', mealIds).in('user_id', ids);
    if (error) fail(`could not inspect fixture meals: ${error.message}`);
    if ((allMealItems ?? []).length !== itemIds.length || (allMealItems ?? []).some((item) => !itemIds.includes(item.id) || (item.product_id !== null && !productIds.includes(item.product_id)))) fail('a candidate meal contains a non-owned item; no fixture data was touched');
  }

  if (itemIds.length) {
    const { error } = await admin.from('meal_items').delete().in('id', itemIds).in('user_id', ids);
    if (error) fail(`could not delete exact test-owned meal items: ${error.message}`);
  }
  if (mealIds.length) {
    const { error } = await admin.from('meals').delete().in('id', mealIds).in('user_id', ids);
    if (error) fail(`could not delete exact test-owned meals: ${error.message}`);
  }
  const { data: remaining, error: remainingError } = await admin.from('meal_items').select('id').in('product_id', productIds).in('user_id', ids);
  if (remainingError || (remaining ?? []).length) fail('owned products still have meal items; no products were deleted');
  const { error: deleteProductsError } = await admin.from('products').delete().in('id', productIds).in('owner_id', ids);
  if (deleteProductsError) fail(`could not delete exact test-owned products: ${deleteProductsError.message}`);
  return { products: productIds.length, meals: mealIds.length, items: itemIds.length };
}
