-- FLUX Workout Editor V2, Slice 3A.2.1.
--
-- V1/V2 writers intentionally fail closed once a workout step has persisted
-- V3 planned sets. Their delete RPCs cascade through workout_plan_exercises,
-- so they correctly hit that guard. These explicit V3 entry points obtain the
-- dedicated server-issued, plan-bound delete capability. They first unlink
-- only completed-session plan pointers, then issue one parent delete.
-- PostgreSQL performs the remaining child cascades atomically; all execution
-- snapshots and recorded workout values remain immutable.

-- Delete capability is intentionally separate from V3 write capability. A
-- trigger executed by a referential action cannot safely rely on a custom GUC
-- handoff, but it can validate this unforgeable server row against the exact
-- plan, owner, backend and transaction.
create table public.workout_plan_v3_delete_capabilities (
  capability uuid primary key,
  plan_id uuid not null,
  user_id uuid not null,
  backend_pid integer not null check (backend_pid > 0),
  transaction_id bigint not null,
  created_at timestamptz not null default now()
);

alter table public.workout_plan_v3_delete_capabilities enable row level security;
revoke all on table public.workout_plan_v3_delete_capabilities from public, anon, authenticated;

create or replace function public.acquire_workout_plan_v3_delete_capability(
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
  insert into public.workout_plan_v3_delete_capabilities (
    capability, plan_id, user_id, backend_pid, transaction_id
  ) values (
    v_capability, p_plan_id, p_user_id, pg_backend_pid(), txid_current()
  );
  return v_capability;
end;
$$;

create or replace function public.release_workout_plan_v3_delete_capability(p_capability uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.workout_plan_v3_delete_capabilities
  where capability = p_capability
    and backend_pid = pg_backend_pid()
    and transaction_id = txid_current();
  if not found then
    raise exception 'Invalid V3 workout delete capability' using errcode = '42501';
  end if;
end;
$$;

-- A completed session normally admits no mutation. The one narrow exception
-- below permits an authorised V3 delete RPC to unlink its plan pointer before
-- it deletes that parent row. The exact plan/user/backend/transaction must be
-- present in the private capability table. No browser role can read or write
-- that table, or execute its mint/release helpers.
create or replace function public.prevent_completed_workout_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_server_v3_delete boolean := false;
begin
  if old.status = 'completed' then
    if new.plan_id is null
       and old.plan_id is not null
       and (to_jsonb(new) - 'plan_id' - 'updated_at')
           is not distinct from (to_jsonb(old) - 'plan_id' - 'updated_at') then
      select exists (
        select 1
        from public.workout_plan_v3_delete_capabilities
        where plan_id = old.plan_id
          and user_id = old.user_id
          and backend_pid = pg_backend_pid()
          and transaction_id = txid_current()
      ) into v_server_v3_delete;
      if v_server_v3_delete then
        return new;
      end if;
    end if;
    raise exception 'Completed workout sessions are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_completed_workout_mutation() from public, anon, authenticated;

create or replace function public.guard_materialized_workout_step_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capability text := current_setting('flux.workout_plan_v3_capability', true);
  v_server_v3_write boolean := false;
  v_server_v3_delete boolean := false;
begin
  if v_capability ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select exists (
      select 1 from public.workout_plan_v3_write_capabilities
      where capability = v_capability::uuid
        and backend_pid = pg_backend_pid()
        and transaction_id = txid_current()
    ) into v_server_v3_write;
  end if;
  if tg_op = 'DELETE' then
    select exists (
      select 1 from public.workout_plan_v3_delete_capabilities
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

revoke all on function public.acquire_workout_plan_v3_delete_capability(uuid, uuid),
  public.release_workout_plan_v3_delete_capability(uuid),
  public.guard_materialized_workout_step_v3()
from public, anon, authenticated;

create or replace function public.delete_my_workout_plan_v3(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_delete_capability uuid;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Preserve the V1/V2 contract: an active execution must be finished first.
  if exists (
    select 1
    from public.workout_sessions
    where user_id = v_user
      and plan_id = p_plan_id
      and status = 'in_progress'
  ) then
    raise exception 'Finish the active workout before deleting this plan'
      using errcode = '55000';
  end if;

  -- Lock and authorise the exact personal plan before minting a capability.
  perform 1
  from public.workout_plans
  where id = p_plan_id
    and user_id = v_user
    and plan_origin = 'personal'
  for update;
  if not found then
    raise exception 'Personal workout plan not found' using errcode = 'P0002';
  end if;

  v_delete_capability := public.acquire_workout_plan_v3_delete_capability(p_plan_id, v_user);
  begin
    -- Do this before the parent DELETE while the plan-bound server capability
    -- exists. It changes no snapshot or performed-set data.
    update public.workout_sessions
    set plan_id = null
    where user_id = v_user
      and plan_id = p_plan_id
      and status = 'completed';

    -- This one parent delete atomically cascades through protected V3 steps
    -- and their planned sets. The guard accepts only this plan-bound,
    -- server-issued delete capability, never a client-provided marker.
    delete from public.workout_plans
    where id = p_plan_id
      and user_id = v_user
      and plan_origin = 'personal';
    if not found then
      raise exception 'Personal workout plan not found' using errcode = 'P0002';
    end if;
  exception when others then
    perform public.release_workout_plan_v3_delete_capability(v_delete_capability);
    raise;
  end;
  perform public.release_workout_plan_v3_delete_capability(v_delete_capability);
end;
$$;

create or replace function public.delete_trainer_assigned_workout_plan_v3(
  p_link_id uuid,
  p_plan_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trainer uuid := (select auth.uid());
  v_client uuid;
  v_delete_capability uuid;
begin
  if v_trainer is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- The client is never accepted from the browser. This helper verifies the
  -- caller is the trainer for an active link before any client row is read.
  v_client := public.trainer_assignment_client_id(p_link_id);

  perform 1
  from public.workout_plans
  where id = p_plan_id
    and user_id = v_client
    and plan_origin = 'trainer_assigned'
    and assigned_by_trainer_id = v_trainer
    and assignment_link_id = p_link_id
  for update;
  if not found then
    raise exception 'Assigned workout plan not found' using errcode = 'P0002';
  end if;

  v_delete_capability := public.acquire_workout_plan_v3_delete_capability(p_plan_id, v_client);
  begin
    update public.workout_sessions
    set plan_id = null
    where user_id = v_client
      and plan_id = p_plan_id
      and status = 'completed';

    delete from public.workout_plans
    where id = p_plan_id
      and user_id = v_client
      and plan_origin = 'trainer_assigned'
      and assigned_by_trainer_id = v_trainer
      and assignment_link_id = p_link_id;
    if not found then
      raise exception 'Assigned workout plan not found' using errcode = 'P0002';
    end if;
  exception when others then
    perform public.release_workout_plan_v3_delete_capability(v_delete_capability);
    raise;
  end;
  perform public.release_workout_plan_v3_delete_capability(v_delete_capability);
end;
$$;

-- SECURITY DEFINER functions otherwise receive PUBLIC EXECUTE by default.
revoke all on function public.delete_my_workout_plan_v3(uuid) from public, anon;
revoke all on function public.delete_trainer_assigned_workout_plan_v3(uuid, uuid) from public, anon;
grant execute on function public.delete_my_workout_plan_v3(uuid) to authenticated;
grant execute on function public.delete_trainer_assigned_workout_plan_v3(uuid, uuid) to authenticated;
