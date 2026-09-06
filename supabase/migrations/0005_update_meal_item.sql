-- Edit one diary item without replacing it, so offline changes can be replayed
-- safely when the connection returns. FLUX currently creates one meal container
-- per product, therefore changing the meal type moves only this diary row.

create or replace function public.update_meal_item(
  p_item_id uuid,
  p_meal_type text,
  p_quantity numeric
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_item public.meal_items%rowtype;
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

  select item.* into current_item
  from public.meal_items as item
  where item.id = p_item_id and item.user_id = current_user_id;

  if not found or current_item.product_id is null then
    return false;
  end if;

  select product.* into source_product
  from public.products as product
  where product.id = current_item.product_id
    and (product.owner_id is null or product.owner_id = current_user_id);

  if not found or source_product.serving_size_g <= 0 or source_product.default_serving_quantity <= 0 then
    return false;
  end if;

  calculated_amount_g := (p_quantity / source_product.default_serving_quantity) * source_product.serving_size_g;
  serving_scale := calculated_amount_g / 100;

  update public.meals as meal
  set meal_type = p_meal_type
  where meal.id = current_item.meal_id and meal.user_id = current_user_id;

  update public.meal_items as item
  set
    portion_quantity = p_quantity,
    portion_unit = source_product.serving_unit,
    amount_g = calculated_amount_g,
    energy_kcal = source_product.energy_kcal_per_100g * serving_scale,
    protein_g = source_product.protein_g_per_100g * serving_scale,
    carbohydrates_g = source_product.carbohydrates_g_per_100g * serving_scale,
    fat_g = source_product.fat_g_per_100g * serving_scale,
    fiber_g = source_product.fiber_g_per_100g * serving_scale
  where item.id = p_item_id and item.user_id = current_user_id;

  return found;
end;
$$;

revoke all on function public.update_meal_item(uuid, text, numeric)
from public, anon;
grant execute on function public.update_meal_item(uuid, text, numeric)
to authenticated;
