-- FLUX Workout Editor V2, Slice 3A.1.
--
-- Individual planned set targets are stored separately from performed_sets.
-- The latter is immutable execution history and must never double as a plan.
-- V1/V2 functions deliberately remain unchanged; callers opt into V3.

create table public.workout_plan_exercise_sets (
  id uuid primary key default gen_random_uuid(),
  plan_exercise_id uuid not null,
  user_id uuid not null,
  set_number smallint not null check (set_number between 1 and 100),
  target_reps_min smallint check (target_reps_min is null or target_reps_min between 1 and 1000),
  target_reps_max smallint check (target_reps_max is null or target_reps_max between 1 and 1000),
  target_duration_seconds integer check (target_duration_seconds is null or target_duration_seconds > 0),
  target_distance_m numeric(10, 2) check (target_distance_m is null or target_distance_m > 0),
  target_weight_kg numeric(8, 2) check (target_weight_kg is null or target_weight_kg >= 0),
  rest_seconds integer check (rest_seconds is null or rest_seconds between 0 and 3600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_plan_exercise_sets_plan_step_number_key
    unique (plan_exercise_id, set_number) deferrable initially immediate,
  constraint workout_plan_exercise_sets_reps_range
    check (target_reps_max is null or target_reps_min is null or target_reps_max >= target_reps_min),
  foreign key (plan_exercise_id, user_id)
    references public.workout_plan_exercises (id, user_id)
    on delete cascade
);

create index workout_plan_exercise_sets_user_step_idx
  on public.workout_plan_exercise_sets (user_id, plan_exercise_id, set_number);

create trigger workout_plan_exercise_sets_set_updated_at
before update on public.workout_plan_exercise_sets
for each row execute function public.set_updated_at();

-- Planned targets are exposed only through SECURITY DEFINER RPCs below. The
-- table is not a browser Data API surface, including for the plan owner.
alter table public.workout_plan_exercise_sets enable row level security;
revoke all on table public.workout_plan_exercise_sets from public, anon, authenticated;
grant select, insert, update, delete on table public.workout_plan_exercise_sets to service_role;

-- A V3 save uses the compatible V2 writer for common plan fields.  The
-- trigger below therefore receives a server-issued, one-statement capability
-- instead of trusting a browser-controlled custom GUC.
create table public.workout_plan_v3_write_capabilities (
  capability uuid primary key,
  backend_pid integer not null check (backend_pid > 0),
  transaction_id bigint not null,
  created_at timestamptz not null default now()
);

alter table public.workout_plan_v3_write_capabilities enable row level security;
revoke all on table public.workout_plan_v3_write_capabilities from public, anon, authenticated;

create or replace function public.assert_workout_planned_set_targets_v3(
  p_measurement_type text,
  p_target_reps_min smallint,
  p_target_reps_max smallint,
  p_target_duration_seconds integer,
  p_target_distance_m numeric,
  p_target_weight_kg numeric,
  p_rest_seconds integer
) returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_measurement_type not in ('reps', 'duration', 'distance')
     or (p_target_weight_kg is not null and p_target_weight_kg = 'NaN'::numeric)
     or (p_target_distance_m is not null and p_target_distance_m = 'NaN'::numeric)
     or (p_rest_seconds is not null and p_rest_seconds not between 0 and 3600)
     or (p_measurement_type = 'reps' and coalesce(p_target_reps_min, 0) < 1)
     or (p_measurement_type = 'reps' and (p_target_duration_seconds is not null or p_target_distance_m is not null))
     or (p_measurement_type <> 'reps' and (p_target_reps_min is not null or p_target_reps_max is not null or p_target_weight_kg is not null))
     or (p_measurement_type = 'duration' and coalesce(p_target_duration_seconds, 0) < 1)
     or (p_measurement_type = 'duration' and p_target_distance_m is not null)
     or (p_measurement_type = 'distance'
         and coalesce(p_target_distance_m, 0) < 1
         and coalesce(p_target_duration_seconds, 0) < 1)
     or (p_target_reps_max is not null and p_target_reps_min is not null and p_target_reps_max < p_target_reps_min) then
    raise exception 'Invalid planned set targets' using errcode = '22023';
  end if;
end;
$$;

-- Creates, updates, reorders and deletes only the targets belonging to the
-- exact server-owned plan step. Deferrable ordering permits a 1<->2 swap in a
-- single save without a temporary invalid ordinal.
create or replace function public.replace_workout_plan_step_sets_v3(
  p_plan_exercise_id uuid,
  p_user_id uuid,
  p_measurement_type text,
  p_sets jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set jsonb;
  v_set_id uuid;
  v_seen_ids uuid[] := '{}';
  v_position smallint := 0;
  v_reps_min smallint;
  v_reps_max smallint;
  v_duration integer;
  v_distance numeric;
  v_weight numeric;
  v_rest integer;
begin
  if jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) not between 1 and 100 then
    raise exception 'A workout step requires between 1 and 100 planned sets' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workout_plan_exercises
    where id = p_plan_exercise_id and user_id = p_user_id
  ) then
    raise exception 'Workout step not found' using errcode = '42501';
  end if;

  set constraints public.workout_plan_exercise_sets_plan_step_number_key deferred;
  for v_set in select value from jsonb_array_elements(p_sets) loop
    v_position := v_position + 1;
    if jsonb_typeof(v_set) <> 'object' then
      raise exception 'Invalid planned set' using errcode = '22023';
    end if;
    v_set_id := nullif(v_set ->> 'set_id', '')::uuid;
    v_reps_min := nullif(v_set ->> 'target_reps_min', '')::smallint;
    v_reps_max := nullif(v_set ->> 'target_reps_max', '')::smallint;
    v_duration := nullif(v_set ->> 'target_duration_seconds', '')::integer;
    v_distance := nullif(v_set ->> 'target_distance_m', '')::numeric;
    v_weight := nullif(v_set ->> 'target_weight_kg', '')::numeric;
    v_rest := nullif(v_set ->> 'rest_seconds', '')::integer;
    perform public.assert_workout_planned_set_targets_v3(
      p_measurement_type, v_reps_min, v_reps_max, v_duration, v_distance, v_weight, v_rest
    );

    if v_set_id is null then
      insert into public.workout_plan_exercise_sets (
        plan_exercise_id, user_id, set_number, target_reps_min, target_reps_max,
        target_duration_seconds, target_distance_m, target_weight_kg, rest_seconds
      ) values (
        p_plan_exercise_id, p_user_id, v_position, v_reps_min, v_reps_max,
        v_duration, v_distance, v_weight, v_rest
      ) returning id into v_set_id;
    else
      if v_set_id = any(v_seen_ids) then
        raise exception 'Duplicate planned set id' using errcode = '22023';
      end if;
      update public.workout_plan_exercise_sets
      set set_number = v_position, target_reps_min = v_reps_min, target_reps_max = v_reps_max,
          target_duration_seconds = v_duration, target_distance_m = v_distance,
          target_weight_kg = v_weight, rest_seconds = v_rest
      where id = v_set_id and plan_exercise_id = p_plan_exercise_id and user_id = p_user_id;
      if not found then
        raise exception 'Planned set does not belong to workout step' using errcode = '42501';
      end if;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_set_id);
  end loop;

  delete from public.workout_plan_exercise_sets
  where plan_exercise_id = p_plan_exercise_id and user_id = p_user_id
    and id <> all(v_seen_ids);
end;
$$;

-- V3 readers return persisted set IDs when present. Legacy scalar targets are
-- represented as virtual, id-less sets until their first V3 save; no backfill
-- or rewrite of user plans is required.
create or replace function public.workout_step_planned_sets_v3(p_step jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_step -> 'planned_sets') = 'array' then p_step -> 'planned_sets'
    else (
      select coalesce(jsonb_agg(jsonb_build_object(
        'set_id', null,
        'set_number', ordinal,
        'target_reps_min', nullif(p_step ->> 'target_reps_min', '')::smallint,
        'target_reps_max', nullif(p_step ->> 'target_reps_max', '')::smallint,
        'target_duration_seconds', nullif(p_step ->> 'target_duration_seconds', '')::integer,
        'target_distance_m', nullif(p_step ->> 'target_distance_m', '')::numeric,
        'target_weight_kg', nullif(p_step ->> 'target_weight_kg', '')::numeric,
        'rest_seconds', nullif(p_step ->> 'rest_seconds', '')::integer
      ) order by ordinal), '[]'::jsonb)
      from generate_series(1, coalesce(nullif(p_step ->> 'target_sets', '')::integer, 0)) ordinal
    )
  end;
$$;

create or replace function public.read_workout_plan_step_sets_v3(
  p_plan_exercise_id uuid,
  p_user_id uuid,
  p_target_sets smallint,
  p_target_reps_min smallint,
  p_target_reps_max smallint,
  p_target_duration_seconds integer,
  p_target_distance_m numeric,
  p_target_weight_kg numeric,
  p_rest_seconds integer
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_agg(jsonb_build_object(
        'set_id', target.id, 'set_number', target.set_number,
        'target_reps_min', target.target_reps_min, 'target_reps_max', target.target_reps_max,
        'target_duration_seconds', target.target_duration_seconds,
        'target_distance_m', target.target_distance_m, 'target_weight_kg', target.target_weight_kg,
        'rest_seconds', target.rest_seconds
      ) order by target.set_number)
      from public.workout_plan_exercise_sets target
      where target.plan_exercise_id = p_plan_exercise_id and target.user_id = p_user_id
    ),
    public.workout_step_planned_sets_v3(jsonb_build_object(
      'target_sets', p_target_sets, 'target_reps_min', p_target_reps_min,
      'target_reps_max', p_target_reps_max, 'target_duration_seconds', p_target_duration_seconds,
      'target_distance_m', p_target_distance_m, 'target_weight_kg', p_target_weight_kg,
      'rest_seconds', p_rest_seconds
    ))
  );
$$;

-- A client may execute a trainer-assigned plan, but must never receive the
-- trainer's live private exercise id, including through the immutable source
-- snapshot. Trainer editor reads use a separate, authorized RPC and are not
-- sanitized here.
create or replace function public.client_safe_workout_step_v3(p_step jsonb, p_hide_source_id boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when not p_hide_source_id then p_step else
    (p_step - 'exercise_source_id') || case
      when jsonb_typeof(p_step -> 'exercise_snapshot') = 'object'
        then jsonb_build_object('exercise_snapshot', (p_step -> 'exercise_snapshot') - 'source_id')
      else '{}'::jsonb
    end
  end;
$$;

-- Flatten V3 input only for the existing V2 source/ownership writer. V2 keeps
-- authorizing sources and creates immutable exercise snapshots. The first set
-- remains the compatibility projection for V1/V2 consumers until Engine V3.
create or replace function public.prepare_workout_plan_steps_v3(p_steps jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_step jsonb;
  v_first_set jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then
    raise exception 'Invalid workout plan' using errcode = '22023';
  end if;
  for v_step in select value from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(v_step) <> 'object'
       or jsonb_typeof(v_step -> 'planned_sets') <> 'array'
       or jsonb_array_length(v_step -> 'planned_sets') not between 1 and 100 then
      raise exception 'Each workout step requires planned_sets' using errcode = '22023';
    end if;
    v_first_set := v_step -> 'planned_sets' -> 0;
    if jsonb_typeof(v_first_set) <> 'object' then
      raise exception 'Invalid planned set' using errcode = '22023';
    end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'step_id', v_step -> 'step_id',
      'exercise_source_kind', v_step -> 'exercise_source_kind',
      'exercise_source_id', v_step -> 'exercise_source_id',
      'day_number', v_step -> 'day_number',
      'target_sets', jsonb_array_length(v_step -> 'planned_sets'),
      'target_reps_min', v_first_set -> 'target_reps_min',
      'target_reps_max', v_first_set -> 'target_reps_max',
      'target_duration_seconds', v_first_set -> 'target_duration_seconds',
      'target_distance_m', v_first_set -> 'target_distance_m',
      'target_weight_kg', v_first_set -> 'target_weight_kg',
      'rest_seconds', coalesce(v_first_set -> 'rest_seconds', '60'::jsonb),
      'notes', v_step -> 'notes'
    ));
  end loop;
  return v_result;
end;
$$;

create or replace function public.sync_workout_plan_step_sets_v3(
  p_v2_result jsonb,
  p_v3_steps jsonb,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_saved jsonb;
  v_position integer := 0;
  v_step_id uuid;
  v_measurement_type text;
begin
  for v_input in select value from jsonb_array_elements(p_v3_steps) loop
    v_position := v_position + 1;
    select item into v_saved
    from jsonb_array_elements(p_v2_result -> 'exercises') item
    where (item ->> 'sort_order')::integer = v_position;
    if v_saved is null then
      raise exception 'Saved workout step was not returned' using errcode = '23514';
    end if;
    v_step_id := (v_saved ->> 'step_id')::uuid;
    v_measurement_type := v_saved ->> 'measurement_type';
    perform public.replace_workout_plan_step_sets_v3(
      v_step_id, p_user_id, v_measurement_type, v_input -> 'planned_sets'
    );
  end loop;
end;
$$;

create or replace function public.acquire_workout_plan_v3_write_capability()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_capability uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  insert into public.workout_plan_v3_write_capabilities (capability, backend_pid, transaction_id)
  values (v_capability, pg_backend_pid(), txid_current());
  perform set_config('flux.workout_plan_v3_capability', v_capability::text, true);
  return v_capability;
end;
$$;

create or replace function public.release_workout_plan_v3_write_capability(p_capability uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.workout_plan_v3_write_capabilities
  where capability = p_capability
    and backend_pid = pg_backend_pid()
    and transaction_id = txid_current();
  if not found then
    raise exception 'Invalid V3 workout write capability' using errcode = '42501';
  end if;
  perform set_config('flux.workout_plan_v3_capability', '', true);
end;
$$;

-- V1/V2 only understand the scalar compatibility projection. Once a step has
-- persisted V3 planned sets, a V1/V2 write or delete must fail closed. A GUC
-- is only a transport for an uncommitted server-issued capability bound to the
-- current backend and transaction; callers cannot mint a valid capability.
create or replace function public.guard_materialized_workout_step_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capability text := current_setting('flux.workout_plan_v3_capability', true);
  v_server_v3_write boolean := false;
begin
  if v_capability ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select exists (
      select 1 from public.workout_plan_v3_write_capabilities
      where capability = v_capability::uuid
        and backend_pid = pg_backend_pid()
        and transaction_id = txid_current()
    ) into v_server_v3_write;
  end if;
  if exists (
    select 1 from public.workout_plan_exercise_sets
    where plan_exercise_id = old.id and user_id = old.user_id
  ) and not v_server_v3_write and (
    tg_op = 'DELETE' or (
    new.exercise_id is distinct from old.exercise_id
    or new.exercise_source_kind is distinct from old.exercise_source_kind
    or new.exercise_source_id is distinct from old.exercise_source_id
    or new.exercise_snapshot is distinct from old.exercise_snapshot
    or new.target_sets is distinct from old.target_sets
    or new.target_reps_min is distinct from old.target_reps_min
    or new.target_reps_max is distinct from old.target_reps_max
    or new.target_duration_seconds is distinct from old.target_duration_seconds
    or new.target_distance_m is distinct from old.target_distance_m
    or new.target_weight_kg is distinct from old.target_weight_kg
    or new.rest_seconds is distinct from old.rest_seconds
    )
  ) then
    raise exception 'Workout step has individual planned sets; save it with the V3 contract'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists guard_materialized_workout_step_v3 on public.workout_plan_exercises;
create trigger guard_materialized_workout_step_v3
before update of exercise_id, exercise_source_kind, exercise_source_id, exercise_snapshot,
  target_sets, target_reps_min, target_reps_max, target_duration_seconds,
  target_distance_m, target_weight_kg, rest_seconds
on public.workout_plan_exercises
for each row execute function public.guard_materialized_workout_step_v3();

drop trigger if exists guard_materialized_workout_step_v3_delete on public.workout_plan_exercises;
create trigger guard_materialized_workout_step_v3_delete
before delete on public.workout_plan_exercises
for each row execute function public.guard_materialized_workout_step_v3();

create or replace function public.get_my_workout_plan_v3(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_base jsonb; v_steps jsonb;
begin
  v_base := public.get_my_workout_plan_v2(p_plan_id);
  select coalesce(jsonb_agg(public.client_safe_workout_step_v3(
    step, (v_base ->> 'plan_origin') = 'trainer_assigned'
  ) || jsonb_build_object('planned_sets',
    public.read_workout_plan_step_sets_v3(
      (step ->> 'step_id')::uuid, (select auth.uid()),
      (step ->> 'target_sets')::smallint, nullif(step ->> 'target_reps_min', '')::smallint,
      nullif(step ->> 'target_reps_max', '')::smallint, nullif(step ->> 'target_duration_seconds', '')::integer,
      nullif(step ->> 'target_distance_m', '')::numeric, nullif(step ->> 'target_weight_kg', '')::numeric,
      nullif(step ->> 'rest_seconds', '')::integer
    )
  ) order by (step ->> 'day_number')::integer, (step ->> 'sort_order')::integer), '[]'::jsonb)
  into v_steps from jsonb_array_elements(v_base -> 'exercises') step;
  -- plan ownership is the authenticated subject for a personal read, including
  -- client reads of trainer-assigned plans.
  return v_base || jsonb_build_object('exercises', v_steps);
end;
$$;

create or replace function public.get_trainer_assigned_workout_plan_v3(p_link_id uuid, p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_base jsonb; v_steps jsonb; v_client uuid := public.trainer_assignment_client_id(p_link_id);
begin
  v_base := public.get_trainer_assigned_workout_plan_v2(p_link_id, p_plan_id);
  select coalesce(jsonb_agg(step || jsonb_build_object('planned_sets',
    public.read_workout_plan_step_sets_v3(
      (step ->> 'step_id')::uuid, v_client,
      (step ->> 'target_sets')::smallint, nullif(step ->> 'target_reps_min', '')::smallint,
      nullif(step ->> 'target_reps_max', '')::smallint, nullif(step ->> 'target_duration_seconds', '')::integer,
      nullif(step ->> 'target_distance_m', '')::numeric, nullif(step ->> 'target_weight_kg', '')::numeric,
      nullif(step ->> 'rest_seconds', '')::integer
    )
  ) order by (step ->> 'day_number')::integer, (step ->> 'sort_order')::integer), '[]'::jsonb)
  into v_steps from jsonb_array_elements(v_base -> 'exercises') step;
  return v_base || jsonb_build_object('exercises', v_steps);
end;
$$;

create or replace function public.save_my_workout_plan_v3(
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
declare v_user uuid := (select auth.uid()); v_flat_steps jsonb; v_saved jsonb; v_capability uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  v_capability := public.acquire_workout_plan_v3_write_capability();
  begin
    v_flat_steps := public.prepare_workout_plan_steps_v3(p_steps);
    v_saved := public.save_my_workout_plan_v2(
      p_plan_id, p_name, p_description, p_level, p_estimated_duration_minutes, v_flat_steps
    );
    perform public.sync_workout_plan_step_sets_v3(v_saved, p_steps, v_user);
  exception when others then
    perform public.release_workout_plan_v3_write_capability(v_capability);
    raise;
  end;
  perform public.release_workout_plan_v3_write_capability(v_capability);
  return public.get_my_workout_plan_v3((v_saved ->> 'id')::uuid);
end;
$$;

create or replace function public.save_trainer_assigned_workout_plan_v3(
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
declare v_client uuid := public.trainer_assignment_client_id(p_link_id); v_flat_steps jsonb; v_saved jsonb; v_capability uuid;
begin
  -- trainer_assignment_client_id enforces the authenticated trainer and an
  -- active link before any client-owned row is selected or written.
  v_capability := public.acquire_workout_plan_v3_write_capability();
  begin
    v_flat_steps := public.prepare_workout_plan_steps_v3(p_steps);
    v_saved := public.save_trainer_assigned_workout_plan_v2(
      p_link_id, p_plan_id, p_name, p_description, p_level, p_estimated_duration_minutes, v_flat_steps
    );
    perform public.sync_workout_plan_step_sets_v3(v_saved, p_steps, v_client);
  exception when others then
    perform public.release_workout_plan_v3_write_capability(v_capability);
    raise;
  end;
  perform public.release_workout_plan_v3_write_capability(v_capability);
  return public.get_trainer_assigned_workout_plan_v3(p_link_id, (v_saved ->> 'id')::uuid);
end;
$$;

create or replace function public.get_my_workout_session_v3(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_base jsonb; v_steps jsonb;
begin
  v_base := public.get_my_workout_session_v2(p_session_id);
  select coalesce(jsonb_agg(public.client_safe_workout_step_v3(
    step, (v_base ->> 'source_type') = 'trainer_assignment'
  ) || jsonb_build_object(
    'planned_sets', public.workout_step_planned_sets_v3(step)
  ) order by (step ->> 'day_number')::integer, (step ->> 'sort_order')::integer), '[]'::jsonb)
  into v_steps from jsonb_array_elements(v_base -> 'plan_snapshot') step;
  return v_base || jsonb_build_object('plan_snapshot', v_steps);
end;
$$;

create or replace function public.start_personal_workout_v3(p_plan_id uuid)
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
  if found then return public.get_my_workout_session_v3(v_session.id); end if;

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
    'rest_seconds', step.rest_seconds, 'notes', step.notes,
    'planned_sets', public.read_workout_plan_step_sets_v3(
      step.id, v_user, step.target_sets, step.target_reps_min, step.target_reps_max,
      step.target_duration_seconds, step.target_distance_m, step.target_weight_kg, step.rest_seconds
    )
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
  return public.get_my_workout_session_v3(v_session.id);
end;
$$;

revoke all on function
  public.assert_workout_planned_set_targets_v3(text,smallint,smallint,integer,numeric,numeric,integer),
  public.replace_workout_plan_step_sets_v3(uuid,uuid,text,jsonb),
  public.workout_step_planned_sets_v3(jsonb),
  public.read_workout_plan_step_sets_v3(uuid,uuid,smallint,smallint,smallint,integer,numeric,numeric,integer),
  public.client_safe_workout_step_v3(jsonb,boolean),
  public.prepare_workout_plan_steps_v3(jsonb),
  public.sync_workout_plan_step_sets_v3(jsonb,jsonb,uuid),
  public.acquire_workout_plan_v3_write_capability(),
  public.release_workout_plan_v3_write_capability(uuid),
  public.guard_materialized_workout_step_v3()
from public, anon, authenticated;

revoke all on function
  public.save_my_workout_plan_v3(uuid,text,text,text,smallint,jsonb),
  public.save_trainer_assigned_workout_plan_v3(uuid,uuid,text,text,text,smallint,jsonb),
  public.get_my_workout_plan_v3(uuid),
  public.get_trainer_assigned_workout_plan_v3(uuid,uuid),
  public.get_my_workout_session_v3(uuid),
  public.start_personal_workout_v3(uuid)
from public, anon;

grant execute on function
  public.save_my_workout_plan_v3(uuid,text,text,text,smallint,jsonb),
  public.save_trainer_assigned_workout_plan_v3(uuid,uuid,text,text,text,smallint,jsonb),
  public.get_my_workout_plan_v3(uuid),
  public.get_trainer_assigned_workout_plan_v3(uuid,uuid),
  public.get_my_workout_session_v3(uuid),
  public.start_personal_workout_v3(uuid)
to authenticated;
