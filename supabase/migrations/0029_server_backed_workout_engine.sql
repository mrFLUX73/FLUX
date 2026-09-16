-- A real personal Workout Engine. Existing plans, sessions and sets remain
-- intact; new fields only make sessions self-contained and retry-safe.

alter table public.workout_sessions
  add column if not exists source_type text not null default 'personal_plan'
    check (source_type in ('personal_plan', 'trainer_assignment')),
  add column if not exists plan_snapshot jsonb not null default '[]'::jsonb;

alter table public.performed_sets
  add column if not exists session_step_id uuid,
  add column if not exists client_set_key uuid;

create unique index if not exists performed_sets_session_client_set_key
  on public.performed_sets (workout_session_id, client_set_key)
  where client_set_key is not null;

create unique index if not exists performed_sets_session_snapshot_step_set_key
  on public.performed_sets (workout_session_id, session_step_id, is_warmup, set_number)
  where session_step_id is not null;

-- One unfinished workout is enough for the calm, resume-first MVP. The unique
-- index is also a concurrency guard when a start request is repeated.
create unique index if not exists workout_sessions_one_in_progress_per_user
  on public.workout_sessions (user_id)
  where status = 'in_progress';

create or replace function public.prevent_completed_workout_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'completed' then
    raise exception 'Completed workout sessions are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists workout_sessions_prevent_completed_mutation on public.workout_sessions;
create trigger workout_sessions_prevent_completed_mutation
before update on public.workout_sessions
for each row execute function public.prevent_completed_workout_mutation();

create or replace function public.get_my_workout_plans()
returns table(
  id uuid,
  name text,
  description text,
  level text,
  estimated_duration_minutes smallint,
  exercise_count integer,
  is_active boolean,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    plan.id, plan.name, plan.description, plan.level, plan.estimated_duration_minutes,
    count(step.id)::integer, plan.is_active, plan.updated_at
  from public.workout_plans plan
  left join public.workout_plan_exercises step
    on step.plan_id = plan.id and step.user_id = plan.user_id
  where plan.user_id = (select auth.uid())
  group by plan.id
  order by plan.is_active desc, plan.updated_at desc;
$$;

create or replace function public.get_my_workout_plan(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'id', plan.id,
    'name', plan.name,
    'description', plan.description,
    'level', plan.level,
    'estimated_duration_minutes', plan.estimated_duration_minutes,
    'is_active', plan.is_active,
    'exercises', coalesce(steps.items, '[]'::jsonb)
  ) into v_result
  from public.workout_plans plan
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'step_id', step.id,
      'exercise_id', exercise.id,
      'name', exercise.name,
      'instructions', exercise.instructions,
      'measurement_type', exercise.measurement_type,
      'day_number', step.day_number,
      'sort_order', step.sort_order,
      'target_sets', step.target_sets,
      'target_reps_min', step.target_reps_min,
      'target_reps_max', step.target_reps_max,
      'target_duration_seconds', step.target_duration_seconds,
      'target_distance_m', step.target_distance_m,
      'target_weight_kg', step.target_weight_kg,
      'rest_seconds', step.rest_seconds,
      'notes', step.notes
    ) order by step.day_number, step.sort_order) as items
    from public.workout_plan_exercises step
    join public.exercises exercise on exercise.id = step.exercise_id and exercise.user_id = step.user_id
    where step.plan_id = plan.id and step.user_id = plan.user_id
  ) steps on true
  where plan.id = p_plan_id and plan.user_id = (select auth.uid());

  if v_result is null then
    raise exception 'Workout plan not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create or replace function public.start_personal_workout(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_snapshot jsonb;
  v_plan public.workout_plans%rowtype;
  v_session public.workout_sessions%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  select * into v_session
  from public.workout_sessions
  where user_id = v_user_id and status = 'in_progress'
  for update;
  if found then
    return public.get_my_workout_session(v_session.id);
  end if;

  select * into v_plan
  from public.workout_plans
  where id = p_plan_id and user_id = v_user_id and is_active;
  if not found then raise exception 'Active workout plan not found' using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'step_id', step.id,
    'exercise_id', exercise.id,
    'name', exercise.name,
    'instructions', exercise.instructions,
    'measurement_type', exercise.measurement_type,
    'day_number', step.day_number,
    'sort_order', step.sort_order,
    'target_sets', step.target_sets,
    'target_reps_min', step.target_reps_min,
    'target_reps_max', step.target_reps_max,
    'target_duration_seconds', step.target_duration_seconds,
    'target_distance_m', step.target_distance_m,
    'target_weight_kg', step.target_weight_kg,
    'rest_seconds', step.rest_seconds,
    'notes', step.notes
  ) order by step.day_number, step.sort_order), '[]'::jsonb)
  into v_snapshot
  from public.workout_plan_exercises step
  join public.exercises exercise on exercise.id = step.exercise_id and exercise.user_id = step.user_id
  where step.plan_id = v_plan.id and step.user_id = v_user_id;

  if jsonb_array_length(v_snapshot) = 0 then
    raise exception 'Workout plan has no exercises' using errcode = '23514';
  end if;

  insert into public.workout_sessions (user_id, plan_id, source_type, title, status, plan_snapshot)
  values (v_user_id, v_plan.id, 'personal_plan', v_plan.name, 'in_progress', v_snapshot)
  returning * into v_session;
  return public.get_my_workout_session(v_session.id);
end;
$$;

create or replace function public.get_my_workout_session(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'id', session.id,
    'plan_id', session.plan_id,
    'source_type', session.source_type,
    'title', session.title,
    'status', session.status,
    'started_at', session.started_at,
    'completed_at', session.completed_at,
    'overall_rpe', session.overall_rpe,
    'notes', session.notes,
    'plan_snapshot', session.plan_snapshot,
    'sets', coalesce(sets.items, '[]'::jsonb)
  ) into v_result
  from public.workout_sessions session
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', item.id,
      'client_set_key', item.client_set_key,
      'session_step_id', item.session_step_id,
      'exercise_name', item.exercise_name,
      'set_number', item.set_number,
      'reps', item.reps,
      'weight_kg', item.weight_kg,
      'duration_seconds', item.duration_seconds,
      'distance_m', item.distance_m,
      'rpe', item.rpe,
      'is_completed', item.is_completed,
      'completed_at', item.completed_at,
      'notes', item.notes
    ) order by item.completed_at, item.created_at) as items
    from public.performed_sets item
    where item.workout_session_id = session.id and item.user_id = session.user_id
  ) sets on true
  where session.id = p_session_id and session.user_id = (select auth.uid());
  if v_result is null then raise exception 'Workout session not found' using errcode = 'P0002'; end if;
  return v_result;
end;
$$;

create or replace function public.get_my_active_workout_session()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_session_id uuid;
begin
  select id into v_session_id from public.workout_sessions
  where user_id = (select auth.uid()) and status = 'in_progress'
  order by started_at desc limit 1;
  if v_session_id is null then return null; end if;
  return public.get_my_workout_session(v_session_id);
end;
$$;

create or replace function public.save_my_performed_set(
  p_session_id uuid,
  p_client_set_key uuid,
  p_session_step_id uuid,
  p_set_number smallint,
  p_reps integer default null,
  p_weight_kg numeric default null,
  p_duration_seconds integer default null,
  p_distance_m numeric default null,
  p_rpe numeric default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_step jsonb;
  v_exercise_id uuid;
  v_live_step_id uuid;
  v_result jsonb;
begin
  select * into v_session from public.workout_sessions
  where id = p_session_id and user_id = (select auth.uid()) and status = 'in_progress'
  for update;
  if not found then raise exception 'Active workout session not found' using errcode = 'P0002'; end if;
  if p_client_set_key is null then raise exception 'Client set key is required' using errcode = '22023'; end if;

  select step into v_step
  from jsonb_array_elements(v_session.plan_snapshot) step
  where step ->> 'step_id' = p_session_step_id::text;
  if v_step is null then raise exception 'Workout step does not belong to session' using errcode = '42501'; end if;
  if p_set_number < 1 or p_set_number > coalesce((v_step ->> 'target_sets')::smallint, 100) then
    raise exception 'Invalid set number' using errcode = '22023';
  end if;

  select id into v_exercise_id from public.exercises
  where id = (v_step ->> 'exercise_id')::uuid and user_id = v_session.user_id;
  select id into v_live_step_id from public.workout_plan_exercises
  where id = p_session_step_id and user_id = v_session.user_id;

  insert into public.performed_sets (
    workout_session_id, user_id, exercise_id, plan_exercise_id, session_step_id,
    client_set_key, exercise_name, set_number, reps, weight_kg, duration_seconds,
    distance_m, rpe, is_completed, completed_at, notes
  ) values (
    v_session.id, v_session.user_id, v_exercise_id, v_live_step_id, p_session_step_id,
    p_client_set_key, v_step ->> 'name', p_set_number, p_reps, p_weight_kg,
    p_duration_seconds, p_distance_m, p_rpe, true, now(), nullif(trim(coalesce(p_notes, '')), '')
  ) on conflict (workout_session_id, client_set_key) where client_set_key is not null
  do update set
    reps = excluded.reps, weight_kg = excluded.weight_kg,
    duration_seconds = excluded.duration_seconds, distance_m = excluded.distance_m,
    rpe = excluded.rpe, notes = excluded.notes, completed_at = excluded.completed_at
  returning jsonb_build_object(
    'id', id, 'client_set_key', client_set_key, 'session_step_id', session_step_id,
    'exercise_name', exercise_name, 'set_number', set_number, 'reps', reps,
    'weight_kg', weight_kg, 'duration_seconds', duration_seconds,
    'distance_m', distance_m, 'rpe', rpe, 'is_completed', is_completed,
    'completed_at', completed_at, 'notes', notes
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.complete_my_workout_session(
  p_session_id uuid,
  p_overall_rpe numeric default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_overall_rpe is not null and p_overall_rpe not between 1 and 10 then
    raise exception 'Overall RPE must be between 1 and 10' using errcode = '22023';
  end if;
  update public.workout_sessions
  set status = 'completed', completed_at = now(), overall_rpe = p_overall_rpe,
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_session_id and user_id = (select auth.uid()) and status = 'in_progress';
  if not found then raise exception 'Active workout session not found' using errcode = 'P0002'; end if;
  return public.get_my_workout_session(p_session_id);
end;
$$;

create or replace function public.get_my_workout_history(p_limit integer default 24)
returns table(
  id uuid, title text, source_type text, started_at timestamptz,
  completed_at timestamptz, overall_rpe numeric, completed_sets integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select session.id, session.title, session.source_type, session.started_at,
    session.completed_at, session.overall_rpe, count(item.id)::integer
  from public.workout_sessions session
  left join public.performed_sets item on item.workout_session_id = session.id and item.user_id = session.user_id
  where session.user_id = (select auth.uid()) and session.status = 'completed'
  group by session.id
  order by session.completed_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 100);
$$;

revoke all on function public.prevent_completed_workout_mutation() from public, anon, authenticated;
revoke all on function public.get_my_workout_plans(), public.get_my_workout_plan(uuid), public.start_personal_workout(uuid), public.get_my_workout_session(uuid), public.get_my_active_workout_session(), public.save_my_performed_set(uuid, uuid, uuid, smallint, integer, numeric, integer, numeric, numeric, text), public.complete_my_workout_session(uuid, numeric, text), public.get_my_workout_history(integer) from public, anon;
grant execute on function public.get_my_workout_plans(), public.get_my_workout_plan(uuid), public.start_personal_workout(uuid), public.get_my_workout_session(uuid), public.get_my_active_workout_session(), public.save_my_performed_set(uuid, uuid, uuid, smallint, integer, numeric, integer, numeric, numeric, text), public.complete_my_workout_session(uuid, numeric, text), public.get_my_workout_history(integer) to authenticated;
