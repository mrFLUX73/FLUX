-- The trainer workspace reads client facts only through the RPCs below.
-- Direct table grants and existing user-owned RLS remain unchanged.

create table if not exists public.trainer_client_notes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trainer_client_notes_owner_client_idx
  on public.trainer_client_notes (trainer_id, client_id, updated_at desc);

alter table public.trainer_client_notes enable row level security;
revoke all on table public.trainer_client_notes from public, anon, authenticated;

drop trigger if exists trainer_client_notes_set_updated_at on public.trainer_client_notes;
create trigger trainer_client_notes_set_updated_at before update on public.trainer_client_notes
for each row execute function public.set_updated_at();

-- Central check used by all client-fact RPCs. The link id, rather than a
-- free client id, makes it impossible to substitute another client's UUID.
create or replace function public.trainer_workspace_client_id(p_link_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
begin
  select client_id into v_client_id
  from public.trainer_client_links
  where id = p_link_id
    and trainer_id = (select auth.uid())
    and status = 'active';

  if v_client_id is null then
    raise exception 'Active trainer connection required' using errcode = '42501';
  end if;
  return v_client_id;
end;
$$;

create or replace function public.get_trainer_client_nutrition(p_link_id uuid, p_day date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := public.trainer_workspace_client_id(p_link_id);
  v_result jsonb;
begin
  select jsonb_build_object(
    'day', p_day,
    'goal_kcal', goals.daily_calories,
    'kcal', coalesce(summary.kcal, 0),
    'protein', coalesce(summary.protein, 0),
    'fat', coalesce(summary.fat, 0),
    'carbs', coalesce(summary.carbs, 0),
    'meals', coalesce(meal_list.meals, '[]'::jsonb)
  ) into v_result
  from public.profiles profile
  left join public.nutrition_goals goals on goals.user_id = profile.id
  left join lateral (
    select sum(item.energy_kcal) kcal, sum(item.protein_g) protein, sum(item.fat_g) fat, sum(item.carbohydrates_g) carbs
    from public.meals meal join public.meal_items item on item.meal_id = meal.id
    where meal.user_id = v_client_id and meal.eaten_at::date = p_day
  ) summary on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', meal.id,
      'type', meal.meal_type,
      'eaten_at', meal.eaten_at,
      'items', coalesce(items.items, '[]'::jsonb)
    ) order by meal.eaten_at) meals
    from public.meals meal
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', item.id, 'name', item.product_name, 'amount_g', item.amount_g,
        'kcal', item.energy_kcal, 'protein', item.protein_g, 'fat', item.fat_g, 'carbs', item.carbohydrates_g
      ) order by item.created_at) items
      from public.meal_items item where item.meal_id = meal.id
    ) items on true
    where meal.user_id = v_client_id and meal.eaten_at::date = p_day
  ) meal_list on true
  where profile.id = v_client_id;
  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function public.get_trainer_client_workouts(p_link_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := public.trainer_workspace_client_id(p_link_id);
begin
  return jsonb_build_object(
    'plan', (
      select jsonb_build_object('name', plan.name, 'description', plan.description, 'duration_minutes', plan.estimated_duration_minutes)
      from public.workout_plans plan where plan.user_id = v_client_id and plan.is_active order by plan.updated_at desc limit 1
    ),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', session.id, 'title', session.title, 'status', session.status, 'started_at', session.started_at, 'completed_at', session.completed_at) order by session.started_at desc)
      from (select * from public.workout_sessions where user_id = v_client_id order by started_at desc limit 12) session
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_trainer_client_notes(p_link_id uuid)
returns table(id uuid, body text, created_at timestamptz, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := public.trainer_workspace_client_id(p_link_id);
begin
  return query select note.id, note.body, note.created_at, note.updated_at
  from public.trainer_client_notes note
  where note.trainer_id = (select auth.uid()) and note.client_id = v_client_id
  order by note.updated_at desc;
end;
$$;

create or replace function public.save_trainer_client_note(p_link_id uuid, p_note_id uuid default null, p_body text default '')
returns table(id uuid, body text, created_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := public.trainer_workspace_client_id(p_link_id);
begin
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Note must contain 1 to 2000 characters' using errcode = '22023';
  end if;
  if p_note_id is null then
    return query insert into public.trainer_client_notes (trainer_id, client_id, body)
      values ((select auth.uid()), v_client_id, trim(p_body))
      returning trainer_client_notes.id, trainer_client_notes.body, trainer_client_notes.created_at, trainer_client_notes.updated_at;
  end if;
  return query update public.trainer_client_notes note set body = trim(p_body)
    where note.id = p_note_id and note.trainer_id = (select auth.uid()) and note.client_id = v_client_id
    returning note.id, note.body, note.created_at, note.updated_at;
  if not found then raise exception 'Note not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.delete_trainer_client_note(p_link_id uuid, p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := public.trainer_workspace_client_id(p_link_id);
begin
  delete from public.trainer_client_notes
  where id = p_note_id and trainer_id = (select auth.uid()) and client_id = v_client_id;
  if not found then raise exception 'Note not found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.trainer_workspace_client_id(uuid), public.get_trainer_client_nutrition(uuid, date), public.get_trainer_client_workouts(uuid), public.get_trainer_client_notes(uuid), public.save_trainer_client_note(uuid, uuid, text), public.delete_trainer_client_note(uuid, uuid) from public, anon;
grant execute on function public.get_trainer_client_nutrition(uuid, date), public.get_trainer_client_workouts(uuid), public.get_trainer_client_notes(uuid), public.save_trainer_client_note(uuid, uuid, text), public.delete_trainer_client_note(uuid, uuid) to authenticated;
