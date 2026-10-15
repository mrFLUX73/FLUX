-- FLUX Workout Editor V2, Slice 2C.
--
-- This migration is additive. Legacy plan rows keep their existing source
-- shape; V2 steps opt into an explicit immutable source contract. The V1
-- RPCs remain in place for the current UI until the editor switches over.

alter table public.workout_plan_exercises
  add column if not exists exercise_source_kind text,
  add column if not exists exercise_source_id uuid,
  add constraint workout_plan_exercises_source_shape check (
    (exercise_source_kind is null and exercise_source_id is null)
    or (
      exercise_source_kind in ('catalog', 'personal', 'trainer_private')
      and exercise_source_id is not null
    )
  );

alter table public.performed_sets
  add column if not exists exercise_source_kind text,
  add column if not exists exercise_source_id uuid,
  add constraint performed_sets_source_shape check (
    (exercise_source_kind is null and exercise_source_id is null)
    or (
      exercise_source_kind in ('catalog', 'personal', 'trainer_private')
      and exercise_source_id is not null
    )
  );

create index if not exists workout_plan_exercises_source_idx
  on public.workout_plan_exercises (exercise_source_kind, exercise_source_id)
  where exercise_source_id is not null;

create index if not exists performed_sets_source_idx
  on public.performed_sets (exercise_source_kind, exercise_source_id)
  where exercise_source_id is not null;

-- A V2 source is resolved at write time only. Callers cannot provide a name,
-- instructions, measurement type, or a snapshot: all of those values come
-- from the authorized source row and become immutable with the plan step.
create or replace function public.resolve_workout_plan_step_source_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.workout_plans%rowtype;
  v_exercise public.exercises%rowtype;
  v_catalog public.exercise_catalog%rowtype;
  v_source_changed boolean;
  v_client_id uuid;
begin
  if new.exercise_source_kind is null and new.exercise_source_id is null then
    -- Historical rows are intentionally not backfilled or reinterpreted.
    return new;
  end if;

  if new.exercise_source_kind is null or new.exercise_source_id is null then
    raise exception 'Exercise source kind and id must be provided together' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    v_source_changed := old.exercise_source_kind is distinct from new.exercise_source_kind
      or old.exercise_source_id is distinct from new.exercise_source_id;
    if not v_source_changed then
      if new.exercise_snapshot is distinct from old.exercise_snapshot
        or new.exercise_id is distinct from old.exercise_id then
        raise exception 'Exercise source snapshot is immutable' using errcode = '42501';
      end if;
      return new;
    end if;
  end if;

  select * into v_plan
  from public.workout_plans
  where id = new.plan_id and user_id = new.user_id;
  if not found then
    raise exception 'Workout plan must belong to step owner' using errcode = '23514';
  end if;

  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  case new.exercise_source_kind
    when 'catalog' then
      if v_plan.plan_origin = 'personal' then
        if v_plan.user_id is distinct from (select auth.uid()) then
          raise exception 'Personal plan ownership required' using errcode = '42501';
        end if;
      elsif v_plan.plan_origin = 'trainer_assigned' then
        if v_plan.assigned_by_trainer_id is distinct from (select auth.uid())
           or v_plan.assignment_link_id is null then
          raise exception 'Trainer assignment ownership required' using errcode = '42501';
        end if;
        select client_id into v_client_id
        from public.trainer_client_links
        where id = v_plan.assignment_link_id
          and trainer_id = (select auth.uid())
          and client_id = v_plan.user_id
          and status = 'active';
        if v_client_id is null then
          raise exception 'Active trainer connection required' using errcode = '42501';
        end if;
      else
        raise exception 'Unsupported workout plan origin' using errcode = '22023';
      end if;
      select * into v_catalog
      from public.exercise_catalog
      where id = new.exercise_source_id
        and publication_status = 'published';
      if not found then
        raise exception 'Published catalog exercise not found' using errcode = '42501';
      end if;
      -- Catalog snapshots deliberately have no live private exercise FK.
      new.exercise_id := null;
      new.exercise_snapshot := jsonb_build_object(
        'source_kind', 'catalog',
        'source_id', v_catalog.id,
        'name', v_catalog.name,
        'instructions', v_catalog.technique_description,
        'measurement_type', v_catalog.measurement_type
      );

    when 'personal' then
      if v_plan.plan_origin <> 'personal' or v_plan.user_id is distinct from (select auth.uid()) then
        raise exception 'Personal plans may use only their owner exercise' using errcode = '42501';
      end if;
      select * into v_exercise
      from public.exercises
      where id = new.exercise_source_id and user_id = v_plan.user_id;
      if not found then
        raise exception 'Personal exercise not found' using errcode = '42501';
      end if;
      new.exercise_id := v_exercise.id;
      new.exercise_snapshot := jsonb_build_object(
        'source_kind', 'personal',
        'source_id', v_exercise.id,
        'name', v_exercise.name,
        'instructions', v_exercise.instructions,
        'measurement_type', v_exercise.measurement_type
      );

    when 'trainer_private' then
      if v_plan.plan_origin <> 'trainer_assigned'
         or v_plan.assigned_by_trainer_id is distinct from (select auth.uid())
         or v_plan.assignment_link_id is null then
        raise exception 'Trainer assignment ownership required' using errcode = '42501';
      end if;
      select client_id into v_client_id
      from public.trainer_client_links
      where id = v_plan.assignment_link_id
        and trainer_id = (select auth.uid())
        and client_id = v_plan.user_id
        and status = 'active';
      if v_client_id is null then
        raise exception 'Active trainer connection required' using errcode = '42501';
      end if;
      select * into v_exercise
      from public.exercises
      where id = new.exercise_source_id and user_id = (select auth.uid());
      if not found then
        raise exception 'Trainer exercise not found' using errcode = '42501';
      end if;
      -- Client-owned assignment rows never retain a live trainer exercise FK.
      new.exercise_id := null;
      new.exercise_snapshot := jsonb_build_object(
        'source_kind', 'trainer_private',
        'source_id', v_exercise.id,
        'name', v_exercise.name,
        'instructions', v_exercise.instructions,
        'measurement_type', v_exercise.measurement_type
      );

    else
      raise exception 'Unsupported exercise source kind' using errcode = '22023';
  end case;

  return new;
end;
$$;

drop trigger if exists resolve_workout_plan_step_source_before_write on public.workout_plan_exercises;
create trigger resolve_workout_plan_step_source_before_write
before insert or update of exercise_source_kind, exercise_source_id, exercise_snapshot, exercise_id
on public.workout_plan_exercises
for each row execute function public.resolve_workout_plan_step_source_before_write();

-- Existing generic plan validation is kept deliberately small and is shared by
-- both V2 writers. Source authorization is enforced by the trigger above.
create or replace function public.assert_workout_step_targets(
  p_measurement_type text,
  p_target_sets smallint,
  p_target_reps_min smallint,
  p_target_duration_seconds integer,
  p_target_distance_m numeric,
  p_rest_seconds integer
) returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_measurement_type not in ('reps', 'duration', 'distance')
     or p_target_sets not between 1 and 100
     or p_rest_seconds not between 0 and 3600
     or (p_measurement_type = 'reps' and coalesce(p_target_reps_min, 0) < 1)
     or (p_measurement_type = 'duration' and coalesce(p_target_duration_seconds, 0) < 1)
     or (p_measurement_type = 'distance'
         and coalesce(p_target_distance_m, 0) < 1
         and coalesce(p_target_duration_seconds, 0) < 1) then
    raise exception 'Invalid exercise settings' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.save_my_workout_plan_v2(
  p_plan_id uuid default null,
  p_name text default null,
  p_description text default null,
  p_level text default null,
  p_estimated_duration_minutes smallint default null,
  p_steps jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_plan public.workout_plans%rowtype;
  v_step jsonb;
  v_existing public.workout_plan_exercises%rowtype;
  v_step_id uuid;
  v_seen_step_ids uuid[] := '{}';
  v_position integer := 0;
  v_target_sets smallint;
  v_rest_seconds integer;
  v_measurement_type text;
  v_source_kind text;
  v_source_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 120
     or (p_description is not null and char_length(p_description) > 3000)
     or (p_level is not null and p_level not in ('beginner', 'intermediate', 'advanced'))
     or (p_estimated_duration_minutes is not null and p_estimated_duration_minutes not between 1 and 600)
     or jsonb_typeof(p_steps) <> 'array'
     or jsonb_array_length(p_steps) = 0 then
    raise exception 'Invalid workout plan' using errcode = '22023';
  end if;

  if p_plan_id is null then
    insert into public.workout_plans (user_id, name, description, level, estimated_duration_minutes, plan_origin)
    values (v_user, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_level, p_estimated_duration_minutes, 'personal')
    returning * into v_plan;
  else
    update public.workout_plans
    set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
        level = p_level, estimated_duration_minutes = p_estimated_duration_minutes
    where id = p_plan_id and user_id = v_user and plan_origin = 'personal'
    returning * into v_plan;
    if not found then raise exception 'Personal workout plan not found' using errcode = 'P0002'; end if;
  end if;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_position := v_position + 1;
    if jsonb_typeof(v_step) <> 'object' then raise exception 'Invalid workout step' using errcode = '22023'; end if;
    v_step_id := nullif(v_step ->> 'step_id', '')::uuid;
    v_source_kind := nullif(v_step ->> 'exercise_source_kind', '');
    v_source_id := nullif(v_step ->> 'exercise_source_id', '')::uuid;
    if (v_source_kind is null) <> (v_source_id is null) then
      raise exception 'Exercise source kind and id must be provided together' using errcode = '22023';
    end if;
    v_target_sets := coalesce((v_step ->> 'target_sets')::smallint, 1);
    v_rest_seconds := coalesce((v_step ->> 'rest_seconds')::integer, 60);

    if v_step_id is null then
      if v_source_kind is null then raise exception 'New workout steps require an exercise source' using errcode = '22023'; end if;
      insert into public.workout_plan_exercises (
        plan_id, user_id, exercise_source_kind, exercise_source_id, day_number, sort_order,
        target_sets, target_reps_min, target_reps_max, target_duration_seconds, target_distance_m,
        target_weight_kg, rest_seconds, notes
      ) values (
        v_plan.id, v_user, v_source_kind, v_source_id,
        coalesce((v_step ->> 'day_number')::smallint, 1), v_position, v_target_sets,
        nullif(v_step ->> 'target_reps_min', '')::smallint,
        nullif(v_step ->> 'target_reps_max', '')::smallint,
        nullif(v_step ->> 'target_duration_seconds', '')::integer,
        nullif(v_step ->> 'target_distance_m', '')::numeric,
        nullif(v_step ->> 'target_weight_kg', '')::numeric,
        v_rest_seconds, nullif(trim(coalesce(v_step ->> 'notes', '')), '')
      ) returning id, exercise_snapshot ->> 'measurement_type' into v_step_id, v_measurement_type;
    else
      select * into v_existing from public.workout_plan_exercises
      where id = v_step_id and plan_id = v_plan.id and user_id = v_user;
      if not found then raise exception 'Workout step not found' using errcode = '42501'; end if;
      if v_step_id = any(v_seen_step_ids) then raise exception 'Duplicate workout step' using errcode = '22023'; end if;
      if v_source_kind is null then
        if v_existing.exercise_snapshot is null then
          select measurement_type into v_measurement_type
          from public.exercises
          where id = v_existing.exercise_id and user_id = v_user;
          if v_measurement_type is null then
            raise exception 'Legacy personal exercise not found' using errcode = '23503';
          end if;
        end if;
        update public.workout_plan_exercises
        set day_number = coalesce((v_step ->> 'day_number')::smallint, 1), sort_order = v_position,
            target_sets = v_target_sets, target_reps_min = nullif(v_step ->> 'target_reps_min', '')::smallint,
            target_reps_max = nullif(v_step ->> 'target_reps_max', '')::smallint,
            target_duration_seconds = nullif(v_step ->> 'target_duration_seconds', '')::integer,
            target_distance_m = nullif(v_step ->> 'target_distance_m', '')::numeric,
            target_weight_kg = nullif(v_step ->> 'target_weight_kg', '')::numeric,
            rest_seconds = v_rest_seconds, notes = nullif(trim(coalesce(v_step ->> 'notes', '')), '')
        where id = v_step_id
        returning coalesce(exercise_snapshot ->> 'measurement_type', v_measurement_type) into v_measurement_type;
      else
        update public.workout_plan_exercises
        set exercise_source_kind = v_source_kind, exercise_source_id = v_source_id,
            day_number = coalesce((v_step ->> 'day_number')::smallint, 1), sort_order = v_position,
            target_sets = v_target_sets, target_reps_min = nullif(v_step ->> 'target_reps_min', '')::smallint,
            target_reps_max = nullif(v_step ->> 'target_reps_max', '')::smallint,
            target_duration_seconds = nullif(v_step ->> 'target_duration_seconds', '')::integer,
            target_distance_m = nullif(v_step ->> 'target_distance_m', '')::numeric,
            target_weight_kg = nullif(v_step ->> 'target_weight_kg', '')::numeric,
            rest_seconds = v_rest_seconds, notes = nullif(trim(coalesce(v_step ->> 'notes', '')), '')
        where id = v_step_id
        returning exercise_snapshot ->> 'measurement_type' into v_measurement_type;
      end if;
    end if;
    perform public.assert_workout_step_targets(
      v_measurement_type, v_target_sets, nullif(v_step ->> 'target_reps_min', '')::smallint,
      nullif(v_step ->> 'target_duration_seconds', '')::integer,
      nullif(v_step ->> 'target_distance_m', '')::numeric, v_rest_seconds
    );
    v_seen_step_ids := array_append(v_seen_step_ids, v_step_id);
  end loop;

  delete from public.workout_plan_exercises
  where plan_id = v_plan.id and user_id = v_user and id <> all(v_seen_step_ids);
  return public.get_my_workout_plan_v2(v_plan.id);
end;
$$;

create or replace function public.save_trainer_assigned_workout_plan_v2(
  p_link_id uuid,
  p_plan_id uuid default null,
  p_name text default null,
  p_description text default null,
  p_level text default null,
  p_estimated_duration_minutes smallint default null,
  p_steps jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trainer uuid := (select auth.uid());
  v_client uuid := public.trainer_assignment_client_id(p_link_id);
  v_plan public.workout_plans%rowtype;
  v_step jsonb;
  v_existing public.workout_plan_exercises%rowtype;
  v_step_id uuid;
  v_seen_step_ids uuid[] := '{}';
  v_position integer := 0;
  v_target_sets smallint;
  v_rest_seconds integer;
  v_measurement_type text;
  v_source_kind text;
  v_source_id uuid;
begin
  if v_trainer is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 120
     or (p_description is not null and char_length(p_description) > 3000)
     or (p_level is not null and p_level not in ('beginner', 'intermediate', 'advanced'))
     or (p_estimated_duration_minutes is not null and p_estimated_duration_minutes not between 1 and 600)
     or jsonb_typeof(p_steps) <> 'array'
     or jsonb_array_length(p_steps) = 0 then
    raise exception 'Invalid workout plan' using errcode = '22023';
  end if;

  if p_plan_id is null then
    insert into public.workout_plans (
      user_id, name, description, level, estimated_duration_minutes,
      plan_origin, assigned_by_trainer_id, assignment_link_id
    ) values (
      v_client, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_level,
      p_estimated_duration_minutes, 'trainer_assigned', v_trainer, p_link_id
    ) returning * into v_plan;
  else
    update public.workout_plans
    set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
        level = p_level, estimated_duration_minutes = p_estimated_duration_minutes
    where id = p_plan_id and user_id = v_client and plan_origin = 'trainer_assigned'
      and assigned_by_trainer_id = v_trainer and assignment_link_id = p_link_id
    returning * into v_plan;
    if not found then raise exception 'Assigned workout plan not found' using errcode = 'P0002'; end if;
  end if;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_position := v_position + 1;
    if jsonb_typeof(v_step) <> 'object' then raise exception 'Invalid workout step' using errcode = '22023'; end if;
    v_step_id := nullif(v_step ->> 'step_id', '')::uuid;
    v_source_kind := nullif(v_step ->> 'exercise_source_kind', '');
    v_source_id := nullif(v_step ->> 'exercise_source_id', '')::uuid;
    if (v_source_kind is null) <> (v_source_id is null) then
      raise exception 'Exercise source kind and id must be provided together' using errcode = '22023';
    end if;
    if v_source_kind is not null and v_source_kind not in ('catalog', 'trainer_private') then
      raise exception 'Trainer assignments require a catalog or trainer exercise source' using errcode = '42501';
    end if;
    v_target_sets := coalesce((v_step ->> 'target_sets')::smallint, 1);
    v_rest_seconds := coalesce((v_step ->> 'rest_seconds')::integer, 60);

    if v_step_id is null then
      if v_source_kind is null then raise exception 'New workout steps require an exercise source' using errcode = '22023'; end if;
      insert into public.workout_plan_exercises (
        plan_id, user_id, exercise_source_kind, exercise_source_id, day_number, sort_order,
        target_sets, target_reps_min, target_reps_max, target_duration_seconds, target_distance_m,
        target_weight_kg, rest_seconds, notes
      ) values (
        v_plan.id, v_client, v_source_kind, v_source_id,
        coalesce((v_step ->> 'day_number')::smallint, 1), v_position, v_target_sets,
        nullif(v_step ->> 'target_reps_min', '')::smallint,
        nullif(v_step ->> 'target_reps_max', '')::smallint,
        nullif(v_step ->> 'target_duration_seconds', '')::integer,
        nullif(v_step ->> 'target_distance_m', '')::numeric,
        nullif(v_step ->> 'target_weight_kg', '')::numeric,
        v_rest_seconds, nullif(trim(coalesce(v_step ->> 'notes', '')), '')
      ) returning id, exercise_snapshot ->> 'measurement_type' into v_step_id, v_measurement_type;
    else
      select * into v_existing from public.workout_plan_exercises
      where id = v_step_id and plan_id = v_plan.id and user_id = v_client;
      if not found or v_step_id = any(v_seen_step_ids) then raise exception 'Workout step not found' using errcode = '42501'; end if;
      if v_source_kind is null then
        update public.workout_plan_exercises
        set day_number = coalesce((v_step ->> 'day_number')::smallint, 1), sort_order = v_position,
            target_sets = v_target_sets, target_reps_min = nullif(v_step ->> 'target_reps_min', '')::smallint,
            target_reps_max = nullif(v_step ->> 'target_reps_max', '')::smallint,
            target_duration_seconds = nullif(v_step ->> 'target_duration_seconds', '')::integer,
            target_distance_m = nullif(v_step ->> 'target_distance_m', '')::numeric,
            target_weight_kg = nullif(v_step ->> 'target_weight_kg', '')::numeric,
            rest_seconds = v_rest_seconds, notes = nullif(trim(coalesce(v_step ->> 'notes', '')), '')
        where id = v_step_id
        returning coalesce(exercise_snapshot ->> 'measurement_type', 'reps') into v_measurement_type;
      else
        update public.workout_plan_exercises
        set exercise_source_kind = v_source_kind, exercise_source_id = v_source_id,
            day_number = coalesce((v_step ->> 'day_number')::smallint, 1), sort_order = v_position,
            target_sets = v_target_sets, target_reps_min = nullif(v_step ->> 'target_reps_min', '')::smallint,
            target_reps_max = nullif(v_step ->> 'target_reps_max', '')::smallint,
            target_duration_seconds = nullif(v_step ->> 'target_duration_seconds', '')::integer,
            target_distance_m = nullif(v_step ->> 'target_distance_m', '')::numeric,
            target_weight_kg = nullif(v_step ->> 'target_weight_kg', '')::numeric,
            rest_seconds = v_rest_seconds, notes = nullif(trim(coalesce(v_step ->> 'notes', '')), '')
        where id = v_step_id
        returning exercise_snapshot ->> 'measurement_type' into v_measurement_type;
      end if;
    end if;
    perform public.assert_workout_step_targets(
      v_measurement_type, v_target_sets, nullif(v_step ->> 'target_reps_min', '')::smallint,
      nullif(v_step ->> 'target_duration_seconds', '')::integer,
      nullif(v_step ->> 'target_distance_m', '')::numeric, v_rest_seconds
    );
    v_seen_step_ids := array_append(v_seen_step_ids, v_step_id);
  end loop;

  delete from public.workout_plan_exercises
  where plan_id = v_plan.id and user_id = v_client and id <> all(v_seen_step_ids);
  return public.get_trainer_assigned_workout_plan_v2(p_link_id, v_plan.id);
end;
$$;

-- V2 reads use the immutable snapshot for every source. The client may read a
-- trainer-assigned plan but never the trainer-private source id.
create or replace function public.get_my_workout_plan_v2(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'id', plan.id, 'name', plan.name, 'description', plan.description,
    'level', plan.level, 'estimated_duration_minutes', plan.estimated_duration_minutes,
    'is_active', plan.is_active, 'plan_origin', plan.plan_origin,
    'assigned_by_trainer_id', plan.assigned_by_trainer_id, 'trainer_name', trainer.display_name,
    'exercises', coalesce(steps.items, '[]'::jsonb)
  ) into v_result
  from public.workout_plans plan
  left join public.profiles trainer on trainer.id = plan.assigned_by_trainer_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'step_id', step.id,
      'exercise_id', step.exercise_id,
      'exercise_source_kind', coalesce(step.exercise_source_kind,
        case when plan.plan_origin = 'personal' and step.exercise_id is not null then 'personal'
             when plan.plan_origin = 'trainer_assigned' and step.exercise_id is not null then 'trainer_private' end),
      'exercise_source_id', case
        when plan.plan_origin = 'trainer_assigned' then null
        else coalesce(step.exercise_source_id, step.exercise_id)
      end,
      'exercise_snapshot', step.exercise_snapshot,
      'name', coalesce(step.exercise_snapshot ->> 'name', exercise.name),
      'instructions', coalesce(step.exercise_snapshot ->> 'instructions', exercise.instructions),
      'measurement_type', coalesce(step.exercise_snapshot ->> 'measurement_type', exercise.measurement_type),
      'day_number', step.day_number, 'sort_order', step.sort_order,
      'target_sets', step.target_sets, 'target_reps_min', step.target_reps_min,
      'target_reps_max', step.target_reps_max, 'target_duration_seconds', step.target_duration_seconds,
      'target_distance_m', step.target_distance_m, 'target_weight_kg', step.target_weight_kg,
      'rest_seconds', step.rest_seconds, 'notes', step.notes
    ) order by step.day_number, step.sort_order) items
    from public.workout_plan_exercises step
    left join public.exercises exercise
      on exercise.id = step.exercise_id and exercise.user_id = plan.user_id
    where step.plan_id = plan.id and step.user_id = plan.user_id
      and (step.exercise_snapshot is not null or exercise.id is not null)
  ) steps on true
  where plan.id = p_plan_id and plan.user_id = (select auth.uid());
  if v_result is null then raise exception 'Workout plan not found' using errcode = 'P0002'; end if;
  return v_result;
end;
$$;

create or replace function public.get_trainer_assigned_workout_plan_v2(p_link_id uuid, p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_client uuid := public.trainer_assignment_client_id(p_link_id); v_result jsonb;
begin
  select jsonb_build_object(
    'id', plan.id, 'name', plan.name, 'description', plan.description,
    'level', plan.level, 'estimated_duration_minutes', plan.estimated_duration_minutes,
    'is_active', plan.is_active, 'plan_origin', plan.plan_origin,
    'assigned_by_trainer_id', plan.assigned_by_trainer_id,
    'exercises', coalesce(steps.items, '[]'::jsonb)
  ) into v_result
  from public.workout_plans plan
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'step_id', step.id, 'exercise_id', step.exercise_id,
      'exercise_source_kind', coalesce(step.exercise_source_kind,
        case when step.exercise_id is not null then 'trainer_private' end),
      'exercise_source_id', coalesce(step.exercise_source_id, step.exercise_id),
      'exercise_snapshot', step.exercise_snapshot,
      'name', step.exercise_snapshot ->> 'name',
      'instructions', step.exercise_snapshot ->> 'instructions',
      'measurement_type', step.exercise_snapshot ->> 'measurement_type',
      'day_number', step.day_number, 'sort_order', step.sort_order,
      'target_sets', step.target_sets, 'target_reps_min', step.target_reps_min,
      'target_reps_max', step.target_reps_max, 'target_duration_seconds', step.target_duration_seconds,
      'target_distance_m', step.target_distance_m, 'target_weight_kg', step.target_weight_kg,
      'rest_seconds', step.rest_seconds, 'notes', step.notes
    ) order by step.day_number, step.sort_order) items
    from public.workout_plan_exercises step
    where step.plan_id = plan.id and step.user_id = v_client
  ) steps on true
  where plan.id = p_plan_id and plan.user_id = v_client and plan.plan_origin = 'trainer_assigned'
    and plan.assigned_by_trainer_id = (select auth.uid()) and plan.assignment_link_id = p_link_id;
  if v_result is null then raise exception 'Assigned workout plan not found' using errcode = 'P0002'; end if;
  return v_result;
end;
$$;

create or replace function public.get_my_workout_session_v2(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'id', session.id, 'plan_id', session.plan_id, 'source_type', session.source_type,
    'title', session.title, 'status', session.status, 'started_at', session.started_at,
    'completed_at', session.completed_at, 'overall_rpe', session.overall_rpe, 'notes', session.notes,
    'plan_snapshot', case when session.source_type = 'trainer_assignment' then
      coalesce((select jsonb_agg(step - 'exercise_source_id') from jsonb_array_elements(session.plan_snapshot) step), '[]'::jsonb)
      else session.plan_snapshot end,
    'sets', coalesce(sets.items, '[]'::jsonb)
  ) into v_result
  from public.workout_sessions session
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', item.id, 'client_set_key', item.client_set_key, 'session_step_id', item.session_step_id,
      'exercise_name', item.exercise_name, 'set_number', item.set_number, 'reps', item.reps,
      'weight_kg', item.weight_kg, 'duration_seconds', item.duration_seconds,
      'distance_m', item.distance_m, 'rpe', item.rpe, 'is_completed', item.is_completed,
      'completed_at', item.completed_at, 'notes', item.notes
    ) order by item.completed_at, item.created_at) items
    from public.performed_sets item
    where item.workout_session_id = session.id and item.user_id = session.user_id
  ) sets on true
  where session.id = p_session_id and session.user_id = (select auth.uid());
  if v_result is null then raise exception 'Workout session not found' using errcode = 'P0002'; end if;
  return v_result;
end;
$$;

create or replace function public.start_personal_workout_v2(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_snapshot jsonb;
  v_plan public.workout_plans%rowtype;
  v_session public.workout_sessions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_session from public.workout_sessions
  where user_id = v_user and status = 'in_progress' for update;
  if found then return public.get_my_workout_session_v2(v_session.id); end if;

  select * into v_plan from public.workout_plans
  where id = p_plan_id and user_id = v_user and is_active;
  if not found then raise exception 'Active workout plan not found' using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'step_id', step.id,
    'exercise_id', case when step.exercise_source_kind = 'personal' then step.exercise_source_id else step.exercise_id end,
    'exercise_source_kind', coalesce(step.exercise_source_kind,
      case when v_plan.plan_origin = 'personal' and step.exercise_id is not null then 'personal'
           when v_plan.plan_origin = 'trainer_assigned' and step.exercise_id is not null then 'trainer_private' end),
    'exercise_source_id', coalesce(step.exercise_source_id, step.exercise_id),
    'exercise_snapshot', step.exercise_snapshot,
    'name', coalesce(step.exercise_snapshot ->> 'name', exercise.name),
    'instructions', coalesce(step.exercise_snapshot ->> 'instructions', exercise.instructions),
    'measurement_type', coalesce(step.exercise_snapshot ->> 'measurement_type', exercise.measurement_type),
    'day_number', step.day_number, 'sort_order', step.sort_order,
    'target_sets', step.target_sets, 'target_reps_min', step.target_reps_min,
    'target_reps_max', step.target_reps_max, 'target_duration_seconds', step.target_duration_seconds,
    'target_distance_m', step.target_distance_m, 'target_weight_kg', step.target_weight_kg,
    'rest_seconds', step.rest_seconds, 'notes', step.notes
  ) order by step.day_number, step.sort_order), '[]'::jsonb)
  into v_snapshot
  from public.workout_plan_exercises step
  left join public.exercises exercise
    on exercise.id = step.exercise_id and exercise.user_id = v_user
  where step.plan_id = v_plan.id and step.user_id = v_user
    and (step.exercise_snapshot is not null or exercise.id is not null);
  if jsonb_array_length(v_snapshot) = 0 then raise exception 'Workout plan has no exercises' using errcode = '23514'; end if;

  insert into public.workout_sessions (user_id, plan_id, source_type, title, status, plan_snapshot)
  values (v_user, v_plan.id, case when v_plan.plan_origin = 'trainer_assigned' then 'trainer_assignment' else 'personal_plan' end,
    v_plan.name, 'in_progress', v_snapshot)
  returning * into v_session;
  return public.get_my_workout_session_v2(v_session.id);
end;
$$;

create or replace function public.save_my_performed_set_v2(
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
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_step jsonb;
  v_source_kind text;
  v_source_id uuid;
  v_exercise_id uuid := null;
  v_live_step_id uuid;
  v_result jsonb;
begin
  select * into v_session from public.workout_sessions
  where id = p_session_id and user_id = (select auth.uid()) and status = 'in_progress'
  for update;
  if not found then raise exception 'Active workout session not found' using errcode = 'P0002'; end if;
  if p_client_set_key is null then raise exception 'Client set key is required' using errcode = '22023'; end if;
  select step into v_step from jsonb_array_elements(v_session.plan_snapshot) step
  where step ->> 'step_id' = p_session_step_id::text;
  if v_step is null then raise exception 'Workout step does not belong to session' using errcode = '42501'; end if;
  if p_set_number < 1 or p_set_number > coalesce((v_step ->> 'target_sets')::smallint, 100) then
    raise exception 'Invalid set number' using errcode = '22023';
  end if;

  v_source_kind := nullif(v_step ->> 'exercise_source_kind', '');
  v_source_id := nullif(v_step ->> 'exercise_source_id', '')::uuid;
  if (v_source_kind is null) <> (v_source_id is null) then
    raise exception 'Invalid session source snapshot' using errcode = '23514';
  end if;
  if v_source_kind = 'personal' then
    select id into v_exercise_id from public.exercises
    where id = v_source_id and user_id = v_session.user_id;
    if v_exercise_id is null then raise exception 'Personal exercise is no longer available' using errcode = '23503'; end if;
  elsif v_session.source_type = 'personal_plan' and v_source_kind is null then
    select id into v_exercise_id from public.exercises
    where id = nullif(v_step ->> 'exercise_id', '')::uuid and user_id = v_session.user_id;
  end if;
  select id into v_live_step_id from public.workout_plan_exercises
  where id = p_session_step_id and user_id = v_session.user_id;

  insert into public.performed_sets (
    workout_session_id, user_id, exercise_id, plan_exercise_id, session_step_id,
    exercise_source_kind, exercise_source_id, client_set_key, exercise_name, set_number,
    reps, weight_kg, duration_seconds, distance_m, rpe, is_completed, completed_at, notes
  ) values (
    v_session.id, v_session.user_id, v_exercise_id, v_live_step_id, p_session_step_id,
    v_source_kind, v_source_id, p_client_set_key, v_step ->> 'name', p_set_number,
    p_reps, p_weight_kg, p_duration_seconds, p_distance_m, p_rpe, true, now(),
    nullif(trim(coalesce(p_notes, '')), '')
  ) on conflict (workout_session_id, client_set_key) where client_set_key is not null
  do update set reps = excluded.reps, weight_kg = excluded.weight_kg,
    duration_seconds = excluded.duration_seconds, distance_m = excluded.distance_m,
    rpe = excluded.rpe, notes = excluded.notes, completed_at = excluded.completed_at
  returning jsonb_build_object(
    'id', id, 'client_set_key', client_set_key, 'session_step_id', session_step_id,
    'exercise_name', exercise_name, 'set_number', set_number, 'reps', reps,
    'weight_kg', weight_kg, 'duration_seconds', duration_seconds, 'distance_m', distance_m,
    'rpe', rpe, 'is_completed', is_completed, 'completed_at', completed_at, 'notes', notes
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.resolve_workout_plan_step_source_before_write() from public, anon, authenticated;
revoke all on function public.assert_workout_step_targets(text,smallint,smallint,integer,numeric,integer) from public, anon, authenticated;
revoke all on function
  public.save_my_workout_plan_v2(uuid,text,text,text,smallint,jsonb),
  public.save_trainer_assigned_workout_plan_v2(uuid,uuid,text,text,text,smallint,jsonb),
  public.get_my_workout_plan_v2(uuid),
  public.get_trainer_assigned_workout_plan_v2(uuid,uuid),
  public.get_my_workout_session_v2(uuid),
  public.start_personal_workout_v2(uuid),
  public.save_my_performed_set_v2(uuid,uuid,uuid,smallint,integer,numeric,integer,numeric,numeric,text)
from public, anon;
grant execute on function
  public.save_my_workout_plan_v2(uuid,text,text,text,smallint,jsonb),
  public.save_trainer_assigned_workout_plan_v2(uuid,uuid,text,text,text,smallint,jsonb),
  public.get_my_workout_plan_v2(uuid),
  public.get_trainer_assigned_workout_plan_v2(uuid,uuid),
  public.get_my_workout_session_v2(uuid),
  public.start_personal_workout_v2(uuid),
  public.save_my_performed_set_v2(uuid,uuid,uuid,smallint,integer,numeric,integer,numeric,numeric,text)
to authenticated;
