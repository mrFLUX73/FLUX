-- Starter nutrition catalog and the first atomic diary write for FLUX.
-- Quantities stay friendly in the UI (g / ml / piece), while amount_g remains
-- the canonical value used for nutrition calculations.

alter table public.products
  add column if not exists serving_unit text not null default 'g'
    check (serving_unit in ('g', 'ml', 'piece')),
  add column if not exists default_serving_quantity numeric(8, 2)
    check (default_serving_quantity > 0);

-- Preserve the familiar amount of older catalog rows. A product whose serving
-- was 180 g should continue to appear as 180 g after this migration, not 100 g.
update public.products
set
  serving_size_g = coalesce(serving_size_g, 100),
  default_serving_quantity = coalesce(
    default_serving_quantity,
    case when serving_unit = 'piece' then 1 else coalesce(serving_size_g, 100) end
  );

alter table public.products
  alter column serving_size_g set not null,
  alter column default_serving_quantity set default 100,
  alter column default_serving_quantity set not null;

alter table public.meal_items
  add column if not exists portion_quantity numeric(9, 2)
    check (portion_quantity is null or portion_quantity > 0),
  add column if not exists portion_unit text
    check (portion_unit is null or portion_unit in ('g', 'ml', 'piece'));

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
values
  ('10000000-0000-4000-8000-000000000001', null, 'Овсянка на молоке', 'Домашнее блюдо', 'Каши и крупы', 180, 'g', 180, 105.56, 3.89, 16.11, 2.78, true),
  ('10000000-0000-4000-8000-000000000002', null, 'Творог 5%', 'Простоквашино', 'Молочные продукты', 180, 'g', 180, 121.11, 16.67, 2.78, 5.00, true),
  ('10000000-0000-4000-8000-000000000003', null, 'Банан', null, 'Фрукты', 120, 'piece', 1, 87.50, 1.08, 22.50, 0.33, true),
  ('10000000-0000-4000-8000-000000000004', null, 'Капучино', 'Без сахара', 'Напитки', 250, 'ml', 250, 48.00, 2.40, 4.00, 2.40, true),
  ('10000000-0000-4000-8000-000000000005', null, 'Куриная грудка', 'Запечённая', 'Мясо и птица', 150, 'g', 150, 165.00, 31.00, 0.00, 3.60, true),
  ('10000000-0000-4000-8000-000000000006', null, 'Рис', 'Варёный', 'Каши и крупы', 180, 'g', 180, 130.00, 2.70, 28.00, 0.30, true),
  ('10000000-0000-4000-8000-000000000007', null, 'Яйца', 'Варёные', 'Белковые продукты', 120, 'piece', 2, 155.00, 13.00, 1.10, 11.00, true),
  ('10000000-0000-4000-8000-000000000008', null, 'Йогурт греческий', 'Без сахара', 'Молочные продукты', 170, 'g', 170, 77.65, 10.00, 4.71, 2.00, true),
  ('10000000-0000-4000-8000-000000000009', null, 'Гречка', 'Варёная', 'Каши и крупы', 180, 'g', 180, 110.00, 3.60, 21.70, 1.10, true),
  ('10000000-0000-4000-8000-000000000010', null, 'Яблоко', null, 'Фрукты', 180, 'piece', 1, 52.00, 0.30, 14.00, 0.20, true),
  ('10000000-0000-4000-8000-000000000011', null, 'Лосось', 'Запечённый', 'Рыба', 150, 'g', 150, 208.00, 22.00, 0.00, 13.00, true),
  ('10000000-0000-4000-8000-000000000012', null, 'Овощной салат', 'С оливковым маслом', 'Овощи', 250, 'g', 250, 58.00, 1.60, 6.40, 3.60, true)
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

create or replace function public.add_meal_item(
  p_product_id uuid,
  p_meal_type text,
  p_quantity numeric,
  p_eaten_at timestamptz default now(),
  p_meal_id uuid default gen_random_uuid(),
  p_item_id uuid default gen_random_uuid()
)
returns table (
  meal_id uuid,
  meal_item_id uuid,
  product_id uuid,
  product_name text,
  meal_type text,
  eaten_at timestamptz,
  portion_quantity numeric,
  portion_unit text,
  amount_g numeric,
  energy_kcal numeric,
  protein_g numeric,
  carbohydrates_g numeric,
  fat_g numeric
)
language plpgsql
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_product public.products%rowtype;
  calculated_amount_g numeric;
  serving_scale numeric;
begin
  if current_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack', 'other') then
    raise exception 'Unsupported meal type' using errcode = '23514';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive' using errcode = '23514';
  end if;

  select product.*
    into source_product
  from public.products as product
  where product.id = p_product_id
    and (product.owner_id is null or product.owner_id = current_user_id);

  if not found then
    raise exception 'Product is unavailable' using errcode = '23503';
  end if;

  if source_product.serving_size_g <= 0 or source_product.default_serving_quantity <= 0 then
    raise exception 'Product serving is invalid' using errcode = '23514';
  end if;

  calculated_amount_g := (p_quantity / source_product.default_serving_quantity) * source_product.serving_size_g;
  serving_scale := calculated_amount_g / 100;

  insert into public.meals (id, user_id, meal_type, eaten_at)
  values (p_meal_id, current_user_id, p_meal_type, p_eaten_at);

  insert into public.meal_items (
    id,
    meal_id,
    user_id,
    product_id,
    product_name,
    portion_quantity,
    portion_unit,
    amount_g,
    energy_kcal,
    protein_g,
    carbohydrates_g,
    fat_g,
    fiber_g
  )
  values (
    p_item_id,
    p_meal_id,
    current_user_id,
    source_product.id,
    source_product.name,
    p_quantity,
    source_product.serving_unit,
    calculated_amount_g,
    source_product.energy_kcal_per_100g * serving_scale,
    source_product.protein_g_per_100g * serving_scale,
    source_product.carbohydrates_g_per_100g * serving_scale,
    source_product.fat_g_per_100g * serving_scale,
    source_product.fiber_g_per_100g * serving_scale
  );

  return query
  select
    p_meal_id,
    p_item_id,
    source_product.id,
    source_product.name,
    p_meal_type,
    p_eaten_at,
    p_quantity,
    source_product.serving_unit,
    calculated_amount_g,
    source_product.energy_kcal_per_100g * serving_scale,
    source_product.protein_g_per_100g * serving_scale,
    source_product.carbohydrates_g_per_100g * serving_scale,
    source_product.fat_g_per_100g * serving_scale;
end;
$$;

-- Delete one diary row, then remove its now-empty meal container. Keeping this
-- atomic avoids deleting sibling items if meals later contain full dishes.
create or replace function public.delete_meal_item(p_item_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  linked_meal_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  delete from public.meal_items
  where id = p_item_id
    and user_id = current_user_id
  returning meal_id into linked_meal_id;

  if linked_meal_id is null then
    return false;
  end if;

  delete from public.meals as meal
  where meal.id = linked_meal_id
    and meal.user_id = current_user_id
    and not exists (
      select 1
      from public.meal_items as item
      where item.meal_id = linked_meal_id
        and item.user_id = current_user_id
    );

  return true;
end;
$$;

revoke all on function public.add_meal_item(uuid, text, numeric, timestamptz, uuid, uuid)
from public, anon;
grant execute on function public.add_meal_item(uuid, text, numeric, timestamptz, uuid, uuid)
to authenticated;

revoke all on function public.delete_meal_item(uuid)
from public, anon;
grant execute on function public.delete_meal_item(uuid)
to authenticated;
