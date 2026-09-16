-- Personal Workout Plan Editor. Plans and their steps are saved as one
-- transaction; existing sessions remain governed by their #120 snapshot.

create or replace function public.get_my_exercises()
returns table(
  id uuid,
  name text,
  measurement_type text,
  instructions text,
  category text,
  equipment text[],
  primary_muscles text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select id, name, measurement_type, instructions, category, equipment, primary_muscles
  from public.exercises
  where user_id = (select auth.uid())
  order by lower(name), created_at;
$$;

create or replace function public.create_my_exercise(
  p_name text,
  p_measurement_type text,
  p_instructions text default null,
  p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_exercise public.exercises%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'Exercise name is required' using errcode = '22023'; end if;
  if p_measurement_type not in ('reps', 'duration', 'distance') then raise exception 'Invalid measurement type' using errcode = '22023'; end if;
  if p_instructions is not null and char_length(p_instructions) > 5000 then raise exception 'Exercise instructions are too long' using errcode = '22023'; end if;

  insert into public.exercises (user_id, name, measurement_type, instructions, category)
  values ((select auth.uid()), trim(p_name), p_measurement_type, nullif(trim(coalesce(p_instructions, '')), ''), nullif(trim(coalesce(p_category, '')), ''))
  returning * into v_exercise;
  return jsonb_build_object('id', v_exercise.id, 'name', v_exercise.name, 'measurement_type', v_exercise.measurement_type, 'instructions', v_exercise.instructions, 'category', v_exercise.category);
end;
$$;

create or replace function public.update_my_exercise(
  p_exercise_id uuid,
  p_name text,
  p_instructions text default null,
  p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_exercise public.exercises%rowtype;
begin
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'Exercise name is required' using errcode = '22023'; end if;
  update public.exercises
  set name = trim(p_name), instructions = nullif(trim(coalesce(p_instructions, '')), ''), category = nullif(trim(coalesce(p_category, '')), '')
  where id = p_exercise_id and user_id = (select auth.uid())
  returning * into v_exercise;
  if not found then raise exception 'Exercise not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', v_exercise.id, 'name', v_exercise.name, 'measurement_type', v_exercise.measurement_type, 'instructions', v_exercise.instructions, 'category', v_exercise.category);
end;
$$;

create or replace function public.delete_my_exercise(p_exercise_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.workout_plan_exercises where exercise_id = p_exercise_id and user_id = (select auth.uid())) then
    raise exception 'Remove this exercise from your plans before deleting it' using errcode = '23503';
  end if;
  delete from public.exercises where id = p_exercise_id and user_id = (select auth.uid());
  if not found then raise exception 'Exercise not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.save_my_workout_plan(
  p_plan_id uuid default null,
  p_name text default null,
  p_description text default null,
  p_level text default null,
  p_estimated_duration_minutes smallint default null,
  p_steps jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_plan public.workout_plans%rowtype;
  v_step jsonb;
  v_position integer := 0;
  v_exercise public.exercises%rowtype;
  v_sets smallint;
  v_rest integer;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'Plan name is required' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 3000 then raise exception 'Plan description is too long' using errcode = '22023'; end if;
  if p_level is not null and p_level not in ('beginner', 'intermediate', 'advanced') then raise exception 'Invalid plan level' using errcode = '22023'; end if;
  if p_estimated_duration_minutes is not null and p_estimated_duration_minutes not between 1 and 600 then raise exception 'Invalid plan duration' using errcode = '22023'; end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then raise exception 'A workout plan needs at least one exercise' using errcode = '22023'; end if;

  if p_plan_id is null then
    insert into public.workout_plans (user_id, name, description, level, estimated_duration_minutes, is_active)
    values (v_user_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_level, p_estimated_duration_minutes, true)
    returning * into v_plan;
  else
    update public.workout_plans
    set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''), level = p_level, estimated_duration_minutes = p_estimated_duration_minutes
    where id = p_plan_id and user_id = v_user_id
    returning * into v_plan;
    if not found then raise exception 'Workout plan not found' using errcode = 'P0002'; end if;
    delete from public.workout_plan_exercises where plan_id = v_plan.id and user_id = v_user_id;
  end if;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_position := v_position + 1;
    if (v_step ->> 'exercise_id') is null then raise exception 'Exercise is required' using errcode = '22023'; end if;
    select * into v_exercise from public.exercises where id = (v_step ->> 'exercise_id')::uuid and user_id = v_user_id;
    if not found then raise exception 'Exercise not found' using errcode = 'P0002'; end if;
    v_sets := coalesce((v_step ->> 'target_sets')::smallint, 1);
    v_rest := coalesce((v_step ->> 'rest_seconds')::integer, 60);
    if v_sets not between 1 and 100 or v_rest not between 0 and 3600 then raise exception 'Invalid exercise settings' using errcode = '22023'; end if;
    if v_exercise.measurement_type = 'reps' and coalesce((v_step ->> 'target_reps_min')::smallint, 0) < 1 then raise exception 'Repetitions are required' using errcode = '22023'; end if;
    if v_exercise.measurement_type = 'duration' and coalesce((v_step ->> 'target_duration_seconds')::integer, 0) < 1 then raise exception 'Duration is required' using errcode = '22023'; end if;
    if v_exercise.measurement_type = 'distance' and coalesce((v_step ->> 'target_distance_m')::numeric, 0) < 1 and coalesce((v_step ->> 'target_duration_seconds')::integer, 0) < 1 then raise exception 'Distance or duration is required' using errcode = '22023'; end if;

    insert into public.workout_plan_exercises (
      plan_id, user_id, exercise_id, day_number, sort_order, target_sets, target_reps_min, target_reps_max,
      target_duration_seconds, target_distance_m, target_weight_kg, rest_seconds, notes
    ) values (
      v_plan.id, v_user_id, v_exercise.id, 1, v_position, v_sets,
      case when v_exercise.measurement_type = 'reps' then (v_step ->> 'target_reps_min')::smallint else null end,
      case when v_exercise.measurement_type = 'reps' then nullif(v_step ->> 'target_reps_max', '')::smallint else null end,
      case when v_exercise.measurement_type in ('duration', 'distance') then nullif(v_step ->> 'target_duration_seconds', '')::integer else null end,
      case when v_exercise.measurement_type = 'distance' then nullif(v_step ->> 'target_distance_m', '')::numeric else null end,
      case when v_exercise.measurement_type = 'reps' then nullif(v_step ->> 'target_weight_kg', '')::numeric else null end,
      v_rest, nullif(trim(coalesce(v_step ->> 'notes', '')), '')
    );
  end loop;
  return public.get_my_workout_plan(v_plan.id);
end;
$$;

create or replace function public.duplicate_my_workout_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_source public.workout_plans%rowtype; v_copy public.workout_plans%rowtype;
begin
  select * into v_source from public.workout_plans where id = p_plan_id and user_id = (select auth.uid());
  if not found then raise exception 'Workout plan not found' using errcode = 'P0002'; end if;
  insert into public.workout_plans (user_id, name, description, goal, level, estimated_duration_minutes, is_active)
  values ((select auth.uid()), left('Копия · ' || v_source.name, 120), v_source.description, v_source.goal, v_source.level, v_source.estimated_duration_minutes, true)
  returning * into v_copy;
  insert into public.workout_plan_exercises (plan_id, user_id, exercise_id, day_number, sort_order, target_sets, target_reps_min, target_reps_max, target_duration_seconds, target_distance_m, target_weight_kg, rest_seconds, notes)
  select v_copy.id, user_id, exercise_id, day_number, sort_order, target_sets, target_reps_min, target_reps_max, target_duration_seconds, target_distance_m, target_weight_kg, rest_seconds, notes
  from public.workout_plan_exercises where plan_id = v_source.id and user_id = (select auth.uid());
  return public.get_my_workout_plan(v_copy.id);
end;
$$;

create or replace function public.archive_my_workout_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workout_plans set is_active = false where id = p_plan_id and user_id = (select auth.uid());
  if not found then raise exception 'Workout plan not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.delete_my_workout_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.workout_sessions where user_id = (select auth.uid()) and plan_id = p_plan_id and status = 'in_progress') then
    raise exception 'Finish the active workout before deleting this plan' using errcode = '55000';
  end if;
  delete from public.workout_plans where id = p_plan_id and user_id = (select auth.uid());
  if not found then raise exception 'Workout plan not found' using errcode = 'P0002'; end if;
end;
$$;

-- Existing direct DELETE permission could otherwise trigger the cascade from an
-- exercise into live plan steps. Deletion now goes through the guard above.
revoke delete on table public.exercises from authenticated;

revoke all on function public.get_my_exercises(), public.create_my_exercise(text, text, text, text), public.update_my_exercise(uuid, text, text, text), public.delete_my_exercise(uuid), public.save_my_workout_plan(uuid, text, text, text, smallint, jsonb), public.duplicate_my_workout_plan(uuid), public.archive_my_workout_plan(uuid), public.delete_my_workout_plan(uuid) from public, anon;
grant execute on function public.get_my_exercises(), public.create_my_exercise(text, text, text, text), public.update_my_exercise(uuid, text, text, text), public.delete_my_exercise(uuid), public.save_my_workout_plan(uuid, text, text, text, smallint, jsonb), public.duplicate_my_workout_plan(uuid), public.archive_my_workout_plan(uuid), public.delete_my_workout_plan(uuid) to authenticated;
