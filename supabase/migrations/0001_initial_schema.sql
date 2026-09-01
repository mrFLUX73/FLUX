-- FLUX MVP: initial Supabase schema.
-- All client-facing tables use RLS. Common products have owner_id = NULL.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(trim(display_name)) between 1 and 80),
  avatar_url text,
  birth_date date,
  biological_sex text check (biological_sex is null or biological_sex in ('female', 'male', 'other', 'prefer_not_to_say')),
  height_cm numeric(5, 2) check (height_cm is null or height_cm between 50 and 300),
  current_weight_kg numeric(6, 2) check (current_weight_kg is null or current_weight_kg between 20 and 500),
  unit_system text not null default 'metric' check (unit_system in ('metric', 'imperial')),
  timezone text not null default 'UTC',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.nutrition_goals (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  goal_type text not null default 'maintain' check (goal_type in ('lose', 'maintain', 'gain', 'recomposition', 'custom')),
  activity_level text check (activity_level is null or activity_level in ('sedentary', 'light', 'moderate', 'high', 'very_high')),
  daily_calories integer check (daily_calories is null or daily_calories between 500 and 10000),
  protein_g numeric(6, 1) check (protein_g is null or protein_g between 0 and 1000),
  carbohydrates_g numeric(6, 1) check (carbohydrates_g is null or carbohydrates_g between 0 and 1500),
  fat_g numeric(6, 1) check (fat_g is null or fat_g between 0 and 500),
  fiber_g numeric(5, 1) check (fiber_g is null or fiber_g between 0 and 200),
  water_ml integer check (water_ml is null or water_ml between 0 and 15000),
  target_weight_kg numeric(6, 2) check (target_weight_kg is null or target_weight_kg between 20 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.nutrition_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  meals_per_day smallint not null default 4 check (meals_per_day between 1 and 10),
  meal_reminders_enabled boolean not null default false,
  meal_reminder_times time[] not null default '{}'::time[],
  food_weight_unit text not null default 'g' check (food_weight_unit in ('g', 'oz')),
  show_macronutrients boolean not null default true,
  track_water boolean not null default true,
  dietary_preferences text[] not null default '{}'::text[],
  allergens text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  brand text check (brand is null or char_length(trim(brand)) between 1 and 120),
  barcode text check (barcode is null or char_length(trim(barcode)) between 4 and 64),
  category text,
  serving_size_g numeric(8, 2) check (serving_size_g is null or serving_size_g > 0),
  energy_kcal_per_100g numeric(8, 2) not null check (energy_kcal_per_100g >= 0),
  protein_g_per_100g numeric(7, 2) not null default 0 check (protein_g_per_100g >= 0),
  carbohydrates_g_per_100g numeric(7, 2) not null default 0 check (carbohydrates_g_per_100g >= 0),
  fat_g_per_100g numeric(7, 2) not null default 0 check (fat_g_per_100g >= 0),
  fiber_g_per_100g numeric(7, 2) not null default 0 check (fiber_g_per_100g >= 0),
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_id is null or not is_verified)
);

comment on column public.products.owner_id is 'NULL for a common catalog product; otherwise the owning user.';

create unique index products_common_barcode_key
  on public.products (barcode)
  where owner_id is null and barcode is not null;

create unique index products_owner_barcode_key
  on public.products (owner_id, barcode)
  where owner_id is not null and barcode is not null;

create index products_owner_name_idx on public.products (owner_id, name);
create index products_name_idx on public.products (name);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  eaten_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index meals_user_eaten_at_idx on public.meals (user_id, eaten_at desc);

create table public.meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null,
  user_id uuid not null,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null check (char_length(trim(product_name)) between 1 and 160),
  amount_g numeric(9, 2) not null check (amount_g > 0),
  energy_kcal numeric(9, 2) not null check (energy_kcal >= 0),
  protein_g numeric(8, 2) not null default 0 check (protein_g >= 0),
  carbohydrates_g numeric(8, 2) not null default 0 check (carbohydrates_g >= 0),
  fat_g numeric(8, 2) not null default 0 check (fat_g >= 0),
  fiber_g numeric(8, 2) not null default 0 check (fiber_g >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (meal_id, user_id)
    references public.meals (id, user_id)
    on delete cascade
);

create index meal_items_meal_idx on public.meal_items (meal_id);
create index meal_items_user_idx on public.meal_items (user_id);
create index meal_items_product_idx on public.meal_items (product_id) where product_id is not null;

create or replace function public.validate_meal_item_product_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.product_id is not null and not exists (
    select 1
    from public.products as product
    where product.id = new.product_id
      and (product.owner_id is null or product.owner_id = new.user_id)
  ) then
    raise exception 'Product must be common or owned by the meal owner'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger validate_meal_item_product_access_before_write
before insert or update of product_id, user_id on public.meal_items
for each row execute function public.validate_meal_item_product_access();

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  category text,
  equipment text[] not null default '{}'::text[],
  primary_muscles text[] not null default '{}'::text[],
  instructions text check (instructions is null or char_length(instructions) <= 5000),
  media_url text,
  measurement_type text not null default 'reps' check (measurement_type in ('reps', 'duration', 'distance')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index exercises_user_name_idx on public.exercises (user_id, name);

create table public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 3000),
  goal text,
  level text check (level is null or level in ('beginner', 'intermediate', 'advanced')),
  estimated_duration_minutes smallint check (estimated_duration_minutes is null or estimated_duration_minutes between 1 and 600),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index workout_plans_user_active_idx on public.workout_plans (user_id, is_active);

create table public.workout_plan_exercises (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  user_id uuid not null,
  exercise_id uuid not null,
  day_number smallint not null default 1 check (day_number between 1 and 7),
  sort_order smallint not null check (sort_order > 0),
  target_sets smallint not null default 1 check (target_sets between 1 and 100),
  target_reps_min smallint check (target_reps_min is null or target_reps_min between 1 and 1000),
  target_reps_max smallint check (target_reps_max is null or target_reps_max between 1 and 1000),
  target_duration_seconds integer check (target_duration_seconds is null or target_duration_seconds > 0),
  target_distance_m numeric(10, 2) check (target_distance_m is null or target_distance_m > 0),
  target_weight_kg numeric(8, 2) check (target_weight_kg is null or target_weight_kg >= 0),
  rest_seconds integer not null default 60 check (rest_seconds between 0 and 3600),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (plan_id, day_number, sort_order),
  check (target_reps_max is null or target_reps_min is null or target_reps_max >= target_reps_min),
  foreign key (plan_id, user_id)
    references public.workout_plans (id, user_id)
    on delete cascade,
  foreign key (exercise_id, user_id)
    references public.exercises (id, user_id)
    on delete cascade
);

create index workout_plan_exercises_user_idx on public.workout_plan_exercises (user_id);
create index workout_plan_exercises_exercise_idx on public.workout_plan_exercises (exercise_id);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 120),
  status text not null default 'in_progress' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  overall_rpe numeric(3, 1) check (overall_rpe is null or overall_rpe between 1 and 10),
  notes text check (notes is null or char_length(notes) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (completed_at is null or completed_at >= started_at),
  foreign key (plan_id, user_id)
    references public.workout_plans (id, user_id)
    on delete set null (plan_id)
);

create index workout_sessions_user_started_idx on public.workout_sessions (user_id, started_at desc);
create index workout_sessions_plan_idx on public.workout_sessions (plan_id) where plan_id is not null;

create table public.performed_sets (
  id uuid primary key default gen_random_uuid(),
  workout_session_id uuid not null,
  user_id uuid not null,
  exercise_id uuid,
  plan_exercise_id uuid,
  exercise_name text not null check (char_length(trim(exercise_name)) between 1 and 120),
  set_number smallint not null check (set_number between 1 and 1000),
  reps integer check (reps is null or reps >= 0),
  weight_kg numeric(8, 2) check (weight_kg is null or weight_kg >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  distance_m numeric(10, 2) check (distance_m is null or distance_m >= 0),
  rpe numeric(3, 1) check (rpe is null or rpe between 1 and 10),
  is_warmup boolean not null default false,
  is_completed boolean not null default true,
  completed_at timestamptz not null default now(),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workout_session_id, user_id)
    references public.workout_sessions (id, user_id)
    on delete cascade,
  foreign key (exercise_id, user_id)
    references public.exercises (id, user_id)
    on delete set null (exercise_id),
  foreign key (plan_exercise_id, user_id)
    references public.workout_plan_exercises (id, user_id)
    on delete set null (plan_exercise_id)
);

create index performed_sets_session_idx
  on public.performed_sets (workout_session_id, completed_at, set_number);
create index performed_sets_user_idx on public.performed_sets (user_id);
create index performed_sets_exercise_idx on public.performed_sets (exercise_id) where exercise_id is not null;
create index performed_sets_plan_exercise_idx on public.performed_sets (plan_exercise_id) where plan_exercise_id is not null;
-- A plan may intentionally contain the same exercise more than once. Keep set
-- numbers unique within that exact plan step, and distinguish warm-up sets.
create unique index performed_sets_session_plan_step_set_key
  on public.performed_sets (workout_session_id, plan_exercise_id, is_warmup, set_number)
  where plan_exercise_id is not null;

-- Ad-hoc sessions do not have a plan step, so the exercise itself is the scope.
create unique index performed_sets_session_ad_hoc_exercise_set_key
  on public.performed_sets (workout_session_id, exercise_id, is_warmup, set_number)
  where plan_exercise_id is null and exercise_id is not null;

create or replace function public.validate_performed_set_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_plan_id uuid;
  linked_exercise_id uuid;
  session_plan_id uuid;
begin
  if tg_op = 'INSERT' and new.exercise_id is null then
    raise exception 'A new performed set must reference an exercise'
      using errcode = '23514';
  end if;

  -- FK cascades may clear the source reference before the related plan step.
  -- Authenticated clients cannot update this relationship column directly.
  if tg_op = 'UPDATE' and new.exercise_id is null then
    return new;
  end if;

  if new.plan_exercise_id is null then
    return new;
  end if;

  select plan_exercise.plan_id, plan_exercise.exercise_id
    into linked_plan_id, linked_exercise_id
  from public.workout_plan_exercises as plan_exercise
  where plan_exercise.id = new.plan_exercise_id
    and plan_exercise.user_id = new.user_id;

  if not found then
    raise exception 'Plan exercise must be owned by the workout owner'
      using errcode = '23514';
  end if;

  if new.exercise_id is distinct from linked_exercise_id then
    raise exception 'Performed set exercise does not match its plan exercise'
      using errcode = '23514';
  end if;

  select workout_session.plan_id
    into session_plan_id
  from public.workout_sessions as workout_session
  where workout_session.id = new.workout_session_id
    and workout_session.user_id = new.user_id;

  if not found or session_plan_id is distinct from linked_plan_id then
    raise exception 'Plan exercise does not belong to the workout session plan'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger validate_performed_set_references_before_write
before insert or update of workout_session_id, user_id, exercise_id, plan_exercise_id
on public.performed_sets
for each row execute function public.validate_performed_set_references();

-- Keep updated_at trustworthy for direct API writes.
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger nutrition_goals_set_updated_at before update on public.nutrition_goals
for each row execute function public.set_updated_at();
create trigger nutrition_settings_set_updated_at before update on public.nutrition_settings
for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger meals_set_updated_at before update on public.meals
for each row execute function public.set_updated_at();
create trigger meal_items_set_updated_at before update on public.meal_items
for each row execute function public.set_updated_at();
create trigger exercises_set_updated_at before update on public.exercises
for each row execute function public.set_updated_at();
create trigger workout_plans_set_updated_at before update on public.workout_plans
for each row execute function public.set_updated_at();
create trigger workout_plan_exercises_set_updated_at before update on public.workout_plan_exercises
for each row execute function public.set_updated_at();
create trigger workout_sessions_set_updated_at before update on public.workout_sessions
for each row execute function public.set_updated_at();
create trigger performed_sets_set_updated_at before update on public.performed_sets
for each row execute function public.set_updated_at();

-- Create the minimal profile automatically when a Supabase Auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      nullif(
        trim(coalesce(
          new.raw_user_meta_data ->> 'display_name',
          new.raw_user_meta_data ->> 'full_name',
          ''
        )),
        ''
      ),
      80
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill profiles if the migration is applied to a project with existing users.
insert into public.profiles (id, display_name)
select
  auth_user.id,
  left(
    nullif(
      trim(coalesce(
        auth_user.raw_user_meta_data ->> 'display_name',
        auth_user.raw_user_meta_data ->> 'full_name',
        ''
      )),
      ''
    ),
    80
  )
from auth.users as auth_user
on conflict (id) do nothing;

-- Row-level security.
alter table public.profiles enable row level security;
alter table public.nutrition_goals enable row level security;
alter table public.nutrition_settings enable row level security;
alter table public.products enable row level security;
alter table public.meals enable row level security;
alter table public.meal_items enable row level security;
alter table public.exercises enable row level security;
alter table public.workout_plans enable row level security;
alter table public.workout_plan_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.performed_sets enable row level security;

create policy profiles_select_own
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy profiles_update_own
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy nutrition_goals_manage_own
on public.nutrition_goals for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy nutrition_settings_manage_own
on public.nutrition_settings for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy products_read_common_or_own
on public.products for select to authenticated
using (owner_id is null or owner_id = (select auth.uid()));

create policy products_insert_own
on public.products for insert to authenticated
with check (owner_id = (select auth.uid()));

create policy products_update_own
on public.products for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy products_delete_own
on public.products for delete to authenticated
using (owner_id = (select auth.uid()));

create policy meals_manage_own
on public.meals for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy meal_items_manage_own
on public.meal_items for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy exercises_manage_own
on public.exercises for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy workout_plans_manage_own
on public.workout_plans for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy workout_plan_exercises_manage_own
on public.workout_plan_exercises for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy workout_sessions_manage_own
on public.workout_sessions for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy performed_sets_manage_own
on public.performed_sets for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Reset inherited/default API privileges, then grant the minimum required below.
revoke all on table
  public.profiles,
  public.nutrition_goals,
  public.nutrition_settings,
  public.products,
  public.meals,
  public.meal_items,
  public.exercises,
  public.workout_plans,
  public.workout_plan_exercises,
  public.workout_sessions,
  public.performed_sets
from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, delete on table
  public.nutrition_goals,
  public.nutrition_settings,
  public.products,
  public.meals,
  public.meal_items,
  public.exercises,
  public.workout_plans,
  public.workout_plan_exercises,
  public.workout_sessions,
  public.performed_sets
to authenticated;

grant update on table
  public.nutrition_goals,
  public.nutrition_settings,
  public.products,
  public.meals,
  public.meal_items,
  public.exercises,
  public.workout_plans
to authenticated;

-- Relationship columns are immutable from the client after INSERT. This keeps
-- workout_session -> plan_exercise -> exercise consistent with performed sets.
grant update (
  day_number,
  sort_order,
  target_sets,
  target_reps_min,
  target_reps_max,
  target_duration_seconds,
  target_distance_m,
  target_weight_kg,
  rest_seconds,
  notes
) on public.workout_plan_exercises to authenticated;

grant update (
  title,
  status,
  started_at,
  completed_at,
  overall_rpe,
  notes
) on public.workout_sessions to authenticated;

grant update (
  exercise_name,
  set_number,
  reps,
  weight_kg,
  duration_seconds,
  distance_m,
  rpe,
  is_warmup,
  is_completed,
  completed_at,
  notes
) on public.performed_sets to authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.profiles,
  public.nutrition_goals,
  public.nutrition_settings,
  public.products,
  public.meals,
  public.meal_items,
  public.exercises,
  public.workout_plans,
  public.workout_plan_exercises,
  public.workout_sessions,
  public.performed_sets
to service_role;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.validate_meal_item_product_access() from public, anon, authenticated;
revoke all on function public.validate_performed_set_references() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
