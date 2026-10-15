-- FLUX Workout Editor V2, Slice 3A.2.1 follow-up.
--
-- The first V3 contract used a transaction-local custom GUC only to carry a
-- server-issued write capability into the V2 compatibility writer. PostgreSQL
-- restores function-local settings on nested SECURITY DEFINER boundaries, so
-- the guard can legitimately observe no GUC while the V3 writer is active.
-- Keep the existing table/helpers intact for migration safety, but move the
-- effective handoff to a private plan-bound capability row. The trigger can
-- validate that row directly; it never treats a browser-controlled GUC as
-- authority.

create table public.workout_plan_v3_write_capabilities_v2 (
  capability uuid primary key,
  plan_id uuid not null,
  user_id uuid not null,
  backend_pid integer not null check (backend_pid > 0),
  transaction_id bigint not null,
  created_at timestamptz not null default now()
);

alter table public.workout_plan_v3_write_capabilities_v2 enable row level security;
revoke all on table public.workout_plan_v3_write_capabilities_v2 from public, anon, authenticated;

create or replace function public.acquire_workout_plan_v3_write_capability_v2(
  p_plan_id uuid,
  p_user_id uuid
)
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
  if not exists (
    select 1 from public.workout_plans
    where id = p_plan_id and user_id = p_user_id
  ) then
    raise exception 'Workout plan not found' using errcode = 'P0002';
  end if;
  insert into public.workout_plan_v3_write_capabilities_v2 (
    capability, plan_id, user_id, backend_pid, transaction_id
  ) values (
    v_capability, p_plan_id, p_user_id, pg_backend_pid(), txid_current()
  );
  return v_capability;
end;
$$;

create or replace function public.release_workout_plan_v3_write_capability_v2(p_capability uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.workout_plan_v3_write_capabilities_v2
  where capability = p_capability
    and backend_pid = pg_backend_pid()
    and transaction_id = txid_current();
  if not found then
    raise exception 'Invalid V3 workout write capability' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.guard_materialized_workout_step_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_server_v3_write boolean := false;
  v_server_v3_delete boolean := false;
begin
  select exists (
    select 1
    from public.workout_plan_v3_write_capabilities_v2
    where plan_id = old.plan_id
      and user_id = old.user_id
      and backend_pid = pg_backend_pid()
      and transaction_id = txid_current()
  ) into v_server_v3_write;

  if tg_op = 'DELETE' then
    select exists (
      select 1
      from public.workout_plan_v3_delete_capabilities
      where plan_id = old.plan_id
        and user_id = old.user_id
        and backend_pid = pg_backend_pid()
        and transaction_id = txid_current()
    ) into v_server_v3_delete;
  end if;

  if exists (
    select 1 from public.workout_plan_exercise_sets
    where plan_exercise_id = old.id and user_id = old.user_id
  ) and not v_server_v3_write and not v_server_v3_delete and (
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
declare
  v_user uuid := (select auth.uid());
  v_flat_steps jsonb;
  v_saved jsonb;
  v_capability uuid;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_plan_id is not null then
    v_capability := public.acquire_workout_plan_v3_write_capability_v2(p_plan_id, v_user);
  end if;
  begin
    v_flat_steps := public.prepare_workout_plan_steps_v3(p_steps);
    v_saved := public.save_my_workout_plan_v2(
      p_plan_id, p_name, p_description, p_level, p_estimated_duration_minutes, v_flat_steps
    );
    perform public.sync_workout_plan_step_sets_v3(v_saved, p_steps, v_user);
  exception when others then
    if v_capability is not null then
      perform public.release_workout_plan_v3_write_capability_v2(v_capability);
    end if;
    raise;
  end;
  if v_capability is not null then
    perform public.release_workout_plan_v3_write_capability_v2(v_capability);
  end if;
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
declare
  v_client uuid := public.trainer_assignment_client_id(p_link_id);
  v_flat_steps jsonb;
  v_saved jsonb;
  v_capability uuid;
begin
  if p_plan_id is not null then
    v_capability := public.acquire_workout_plan_v3_write_capability_v2(p_plan_id, v_client);
  end if;
  begin
    v_flat_steps := public.prepare_workout_plan_steps_v3(p_steps);
    v_saved := public.save_trainer_assigned_workout_plan_v2(
      p_link_id, p_plan_id, p_name, p_description, p_level, p_estimated_duration_minutes, v_flat_steps
    );
    perform public.sync_workout_plan_step_sets_v3(v_saved, p_steps, v_client);
  exception when others then
    if v_capability is not null then
      perform public.release_workout_plan_v3_write_capability_v2(v_capability);
    end if;
    raise;
  end;
  if v_capability is not null then
    perform public.release_workout_plan_v3_write_capability_v2(v_capability);
  end if;
  return public.get_trainer_assigned_workout_plan_v3(p_link_id, (v_saved ->> 'id')::uuid);
end;
$$;

revoke all on function public.acquire_workout_plan_v3_write_capability_v2(uuid, uuid),
  public.release_workout_plan_v3_write_capability_v2(uuid)
from public, anon, authenticated;

revoke all on function public.guard_materialized_workout_step_v3() from public, anon, authenticated;
