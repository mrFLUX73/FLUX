-- User-entered cards are private by default. This queue is the only route
-- through which a card can be promoted to the shared FLUX catalogue.

create table if not exists public.product_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  barcode text check (barcode is null or char_length(trim(barcode)) between 4 and 64),
  name text not null check (char_length(trim(name)) between 1 and 160),
  brand text check (brand is null or char_length(trim(brand)) <= 120),
  serving_size_g numeric(8, 2) not null check (serving_size_g > 0),
  serving_unit text not null check (serving_unit in ('g', 'ml', 'piece')),
  default_serving_quantity numeric(8, 2) not null check (default_serving_quantity > 0),
  energy_kcal_per_100g numeric(8, 2) not null check (energy_kcal_per_100g >= 0),
  protein_g_per_100g numeric(7, 2) not null check (protein_g_per_100g >= 0),
  carbohydrates_g_per_100g numeric(7, 2) not null check (carbohydrates_g_per_100g >= 0),
  fat_g_per_100g numeric(7, 2) not null check (fat_g_per_100g >= 0),
  source text not null default 'manual' check (source in ('manual', 'open_food_facts', 'fatsecret')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  published_product_id uuid references public.products (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_suggestions_status_created_idx
  on public.product_suggestions (status, created_at desc);
create index if not exists product_suggestions_user_created_idx
  on public.product_suggestions (user_id, created_at desc);

create unique index if not exists product_suggestions_pending_barcode_user_key
  on public.product_suggestions (user_id, barcode)
  where status = 'pending' and barcode is not null;

create trigger product_suggestions_set_updated_at
before update on public.product_suggestions
for each row execute function public.set_updated_at();

alter table public.product_suggestions enable row level security;

create policy product_suggestions_select_own_or_admin
on public.product_suggestions for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));

create or replace function public.create_product_suggestion(
  p_barcode text,
  p_name text,
  p_brand text,
  p_serving_size_g numeric,
  p_serving_unit text,
  p_default_serving_quantity numeric,
  p_energy_kcal_per_100g numeric,
  p_protein_g_per_100g numeric,
  p_carbohydrates_g_per_100g numeric,
  p_fat_g_per_100g numeric,
  p_source text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  suggestion_id uuid;
  normalized_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_brand text := nullif(trim(coalesce(p_brand, '')), '');
begin
  if current_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if char_length(normalized_name) not between 1 and 160
    or p_serving_size_g is null or p_serving_size_g <= 0
    or p_default_serving_quantity is null or p_default_serving_quantity <= 0
    or p_energy_kcal_per_100g is null or p_energy_kcal_per_100g < 0
    or p_protein_g_per_100g is null or p_protein_g_per_100g < 0
    or p_carbohydrates_g_per_100g is null or p_carbohydrates_g_per_100g < 0
    or p_fat_g_per_100g is null or p_fat_g_per_100g < 0
    or p_serving_unit not in ('g', 'ml', 'piece')
    or p_source not in ('manual', 'open_food_facts', 'fatsecret') then
    raise exception 'Invalid product suggestion' using errcode = '23514';
  end if;

  -- Repeating the button must not create a second active review task.
  select id into suggestion_id
  from public.product_suggestions
  where user_id = current_user_id
    and status = 'pending'
    and (
      (normalized_barcode is not null and barcode = normalized_barcode)
      or (normalized_barcode is null and barcode is null and lower(name) = lower(normalized_name)
        and coalesce(lower(brand), '') = coalesce(lower(normalized_brand), ''))
    )
  limit 1;
  if suggestion_id is not null then return suggestion_id; end if;

  insert into public.product_suggestions (
    user_id, barcode, name, brand, serving_size_g, serving_unit, default_serving_quantity,
    energy_kcal_per_100g, protein_g_per_100g, carbohydrates_g_per_100g, fat_g_per_100g, source
  ) values (
    current_user_id, normalized_barcode, normalized_name, normalized_brand,
    p_serving_size_g, p_serving_unit, p_default_serving_quantity,
    p_energy_kcal_per_100g, p_protein_g_per_100g, p_carbohydrates_g_per_100g, p_fat_g_per_100g, p_source
  ) returning id into suggestion_id;
  return suggestion_id;
end;
$$;

create or replace function public.review_product_suggestion(
  p_suggestion_id uuid,
  p_decision text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  suggestion public.product_suggestions%rowtype;
  shared_product_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator role is required' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported review decision' using errcode = '23514';
  end if;

  select * into suggestion from public.product_suggestions where id = p_suggestion_id for update;
  if not found then return false; end if;
  if suggestion.status <> 'pending' then return true; end if;

  if p_decision = 'approved' then
    if suggestion.barcode is not null then
      select id into shared_product_id from public.products
      where owner_id is null and barcode = suggestion.barcode limit 1;
    end if;
    if shared_product_id is null then
      insert into public.products (
        owner_id, barcode, name, brand, category, serving_size_g, serving_unit,
        default_serving_quantity, energy_kcal_per_100g, protein_g_per_100g,
        carbohydrates_g_per_100g, fat_g_per_100g, is_verified
      ) values (
        null, suggestion.barcode, suggestion.name, suggestion.brand, 'Проверено сообществом',
        suggestion.serving_size_g, suggestion.serving_unit, suggestion.default_serving_quantity,
        suggestion.energy_kcal_per_100g, suggestion.protein_g_per_100g,
        suggestion.carbohydrates_g_per_100g, suggestion.fat_g_per_100g, true
      ) returning id into shared_product_id;
    end if;
  end if;

  update public.product_suggestions set
    status = p_decision,
    reviewed_by = current_user_id,
    reviewed_at = now(),
    published_product_id = case when p_decision = 'approved' then shared_product_id else null end
  where id = suggestion.id;
  return true;
end;
$$;

revoke all on function public.create_product_suggestion(text, text, text, numeric, text, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.create_product_suggestion(text, text, text, numeric, text, numeric, numeric, numeric, numeric, numeric, text) to authenticated;
revoke all on function public.review_product_suggestion(uuid, text) from public, anon;
grant execute on function public.review_product_suggestion(uuid, text) to authenticated;
