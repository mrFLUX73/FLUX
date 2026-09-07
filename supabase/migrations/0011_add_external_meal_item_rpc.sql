-- Nutriapix product cards are not copied into public.products. Only a
-- person’s selected diary snapshot and storable provider identifiers live here.

alter table public.meal_items
  add column if not exists external_source text,
  add column if not exists external_food_id text,
  add column if not exists external_brand_id text,
  add column if not exists external_serving_id text,
  add column if not exists external_brand_name text;

create or replace function public.add_external_meal_item(
  p_source text,
  p_source_food_id text,
  p_source_brand_id text,
  p_source_serving_id text,
  p_product_name text,
  p_brand_name text,
  p_meal_type text,
  p_portion_quantity numeric,
  p_portion_unit text,
  p_amount_g numeric,
  p_energy_kcal numeric,
  p_protein_g numeric,
  p_carbohydrates_g numeric,
  p_fat_g numeric,
  p_eaten_at timestamptz default now(),
  p_meal_id uuid default gen_random_uuid(),
  p_item_id uuid default gen_random_uuid()
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_source <> 'nutriapix' or char_length(trim(p_source_food_id)) <> 25 then raise exception 'Unsupported external food' using errcode = '23514'; end if;
  if p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack', 'other') then raise exception 'Unsupported meal type' using errcode = '23514'; end if;
  if p_portion_quantity <= 0 or p_amount_g <= 0 or p_energy_kcal < 0 or p_protein_g < 0 or p_carbohydrates_g < 0 or p_fat_g < 0 then raise exception 'Invalid nutrition snapshot' using errcode = '23514'; end if;

  insert into public.meals (id, user_id, meal_type, eaten_at)
  values (p_meal_id, current_user_id, p_meal_type, p_eaten_at);
  insert into public.meal_items (
    id, meal_id, user_id, product_id, product_name, portion_quantity, portion_unit,
    amount_g, energy_kcal, protein_g, carbohydrates_g, fat_g, fiber_g,
    external_source, external_food_id, external_brand_id, external_serving_id, external_brand_name
  ) values (
    p_item_id, p_meal_id, current_user_id, null, left(trim(p_product_name), 160),
    p_portion_quantity, p_portion_unit, p_amount_g, p_energy_kcal, p_protein_g,
    p_carbohydrates_g, p_fat_g, 0, p_source, p_source_food_id,
    nullif(trim(p_source_brand_id), ''), nullif(trim(p_source_serving_id), ''), nullif(trim(p_brand_name), '')
  );
  return true;
end;
$$;

create or replace function public.update_external_meal_item(
  p_item_id uuid,
  p_meal_type text,
  p_portion_quantity numeric,
  p_portion_unit text,
  p_amount_g numeric,
  p_energy_kcal numeric,
  p_protein_g numeric,
  p_carbohydrates_g numeric,
  p_fat_g numeric
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare current_user_id uuid := (select auth.uid()); linked_meal_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack', 'other') then raise exception 'Unsupported meal type' using errcode = '23514'; end if;
  if p_portion_quantity <= 0 or p_amount_g <= 0 or p_energy_kcal < 0 or p_protein_g < 0 or p_carbohydrates_g < 0 or p_fat_g < 0 then raise exception 'Invalid nutrition snapshot' using errcode = '23514'; end if;
  select meal_id into linked_meal_id from public.meal_items where id = p_item_id and user_id = current_user_id and external_source = 'nutriapix';
  if linked_meal_id is null then return false; end if;
  update public.meals set meal_type = p_meal_type where id = linked_meal_id and user_id = current_user_id;
  update public.meal_items set portion_quantity = p_portion_quantity, portion_unit = p_portion_unit, amount_g = p_amount_g, energy_kcal = p_energy_kcal, protein_g = p_protein_g, carbohydrates_g = p_carbohydrates_g, fat_g = p_fat_g where id = p_item_id and user_id = current_user_id;
  return found;
end;
$$;

revoke all on function public.add_external_meal_item(text, text, text, text, text, text, text, numeric, text, numeric, numeric, numeric, numeric, numeric, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.add_external_meal_item(text, text, text, text, text, text, text, numeric, text, numeric, numeric, numeric, numeric, numeric, timestamptz, uuid, uuid) to authenticated;
revoke all on function public.update_external_meal_item(uuid, text, numeric, text, numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.update_external_meal_item(uuid, text, numeric, text, numeric, numeric, numeric, numeric, numeric) to authenticated;
