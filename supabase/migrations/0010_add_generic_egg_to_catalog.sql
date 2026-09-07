-- A neutral egg is the default search result. Cooked variants stay in the
-- catalogue but should only lead when the user explicitly asks for them.
insert into public.products (
  id,
  owner_id,
  name,
  brand,
  category,
  serving_size_g,
  serving_unit,
  default_serving_quantity,
  energy_kcal_per_100g,
  protein_g_per_100g,
  carbohydrates_g_per_100g,
  fat_g_per_100g,
  is_verified
)
values (
  '10000000-0000-4000-8000-000000000013',
  null,
  'Яйцо',
  'Куриное, сырое',
  'Белковые продукты',
  50,
  'piece',
  1,
  143.00,
  12.60,
  0.70,
  9.50,
  true
)
on conflict (id) do update
set
  name = excluded.name,
  brand = excluded.brand,
  category = excluded.category,
  serving_size_g = excluded.serving_size_g,
  serving_unit = excluded.serving_unit,
  default_serving_quantity = excluded.default_serving_quantity,
  energy_kcal_per_100g = excluded.energy_kcal_per_100g,
  protein_g_per_100g = excluded.protein_g_per_100g,
  carbohydrates_g_per_100g = excluded.carbohydrates_g_per_100g,
  fat_g_per_100g = excluded.fat_g_per_100g,
  is_verified = excluded.is_verified;
