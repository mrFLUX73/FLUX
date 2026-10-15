-- FLUX Workout Editor V2, Slice 3A.2.1 deletion contract checks.
-- Run only against an isolated database after
-- 20261012164152_workout_plan_v3_delete_compatibility.sql. The fixtures are
-- transaction-scoped and this file always ROLLBACKs.

begin;

create temporary table slice3a21_context (
  client_id uuid not null,
  trainer_id uuid not null,
  other_client_id uuid not null,
  client_exercise_id uuid not null,
  trainer_exercise_id uuid not null,
  personal_plan_id uuid not null,
  personal_step_id uuid not null,
  personal_session_id uuid not null,
  personal_performed_set_id uuid not null,
  legacy_plan_id uuid not null,
  trainer_link_id uuid not null,
  trainer_plan_id uuid not null,
  trainer_step_id uuid not null,
  trainer_session_id uuid not null
) on commit drop;
grant select on slice3a21_context to authenticated;

do $$
declare
  v_client uuid;
  v_trainer uuid;
  v_other_client uuid;
  v_personal_exercise uuid;
  v_trainer_exercise uuid;
  v_personal_plan uuid;
  v_personal_step uuid;
  v_personal_session uuid;
  v_personal_performed_set uuid;
  v_legacy_plan uuid;
  v_link uuid;
  v_trainer_plan uuid;
  v_trainer_step uuid;
  v_trainer_session uuid;
  v_marker text := replace(gen_random_uuid()::text, '-', '');
begin
  select account.user_id into v_client
  from public.test_accounts account
  join auth.users auth_user on auth_user.id = account.user_id
  where account.purpose = 'client'
    and lower(auth_user.email) = 'flux-workout-e2e-client@flux.local';
  select account.user_id into v_trainer
  from public.test_accounts account
  join auth.users auth_user on auth_user.id = account.user_id
  where account.purpose = 'trainer'
    and lower(auth_user.email) = 'flux-test-trainer@flux.local';
  select account.user_id into v_other_client
  from public.test_accounts account
  join auth.users auth_user on auth_user.id = account.user_id
  where account.purpose = 'empty_client'
    and lower(auth_user.email) = 'flux-empty-client@flux.local';
  if v_client is null or v_trainer is null or v_other_client is null then
    raise exception 'Required registry-owned synthetic personas are unavailable';
  end if;
  if exists (
    select 1 from public.trainer_client_links
    where trainer_id = v_trainer and client_id = v_client
  ) then
    raise exception 'Dedicated local test pair is not isolated';
  end if;

  insert into public.exercises (user_id, name, measurement_type)
  values (v_client, 'Slice 3A.2.1 personal ' || v_marker, 'reps')
  returning id into v_personal_exercise;
  insert into public.exercises (user_id, name, measurement_type)
  values (v_trainer, 'Slice 3A.2.1 trainer ' || v_marker, 'reps')
  returning id into v_trainer_exercise;

  insert into public.workout_plans (user_id, name, plan_origin, is_active)
  values (v_client, 'Slice 3A.2.1 personal ' || v_marker, 'personal', true)
  returning id into v_personal_plan;
  insert into public.workout_plan_exercises (
    plan_id, user_id, exercise_id, day_number, sort_order, target_sets,
    target_reps_min, target_weight_kg, rest_seconds
  ) values (
    v_personal_plan, v_client, v_personal_exercise, 1, 1, 1, 8, 20, 45
  ) returning id into v_personal_step;
  insert into public.workout_plan_exercise_sets (
    plan_exercise_id, user_id, set_number, target_reps_min, target_weight_kg, rest_seconds
  ) values (v_personal_step, v_client, 1, 8, 20, 45);
  insert into public.workout_sessions (
    user_id, plan_id, title, status, started_at, completed_at, source_type, plan_snapshot
  ) values (
    v_client, v_personal_plan, 'Slice 3A.2.1 personal history', 'completed', now() - interval '1 hour', now(),
    'personal_plan', jsonb_build_array(jsonb_build_object(
      'step_id', v_personal_step,
      'exercise_id', v_personal_exercise,
      'name', 'Snapshot stays immutable',
      'target_sets', 1,
      'planned_sets', jsonb_build_array(jsonb_build_object('target_reps_min', 8))
    ))
  ) returning id into v_personal_session;
  insert into public.performed_sets (
    workout_session_id, user_id, exercise_id, plan_exercise_id, session_step_id,
    exercise_name, set_number, reps, weight_kg, is_completed
  ) values (
    v_personal_session, v_client, v_personal_exercise, v_personal_step, v_personal_step,
    'Snapshot stays immutable', 1, 8, 20, true
  ) returning id into v_personal_performed_set;

  insert into public.workout_plans (user_id, name, plan_origin, is_active)
  values (v_client, 'Slice 3A.2.1 legacy ' || v_marker, 'personal', true)
  returning id into v_legacy_plan;
  insert into public.workout_plan_exercises (
    plan_id, user_id, exercise_id, day_number, sort_order, target_sets,
    target_reps_min, target_weight_kg, rest_seconds
  ) values (
    v_legacy_plan, v_client, v_personal_exercise, 1, 1, 1, 8, 20, 45
  );

  insert into public.trainer_client_links (trainer_id, client_id, status, responded_at)
  values (v_trainer, v_client, 'active', now())
  returning id into v_link;
  insert into public.workout_plans (
    user_id, name, plan_origin, assigned_by_trainer_id, assignment_link_id, is_active
  ) values (
    v_client, 'Slice 3A.2.1 trainer ' || v_marker, 'trainer_assigned', v_trainer, v_link, true
  ) returning id into v_trainer_plan;
  insert into public.workout_plan_exercises (
    plan_id, user_id, exercise_id, day_number, sort_order, target_sets,
    target_reps_min, target_weight_kg, rest_seconds
  ) values (
    v_trainer_plan, v_client, v_personal_exercise, 1, 1, 1, 8, 20, 45
  ) returning id into v_trainer_step;
  insert into public.workout_plan_exercise_sets (
    plan_exercise_id, user_id, set_number, target_reps_min, target_weight_kg, rest_seconds
  ) values (v_trainer_step, v_client, 1, 8, 20, 45);
  insert into public.workout_sessions (
    user_id, plan_id, title, status, started_at, completed_at, source_type, plan_snapshot
  ) values (
    v_client, v_trainer_plan, 'Slice 3A.2.1 trainer history', 'completed', now() - interval '1 hour', now(),
    'trainer_assignment', jsonb_build_array(jsonb_build_object('name', 'Trainer snapshot stays immutable'))
  ) returning id into v_trainer_session;

  insert into slice3a21_context values (
    v_client, v_trainer, v_other_client, v_personal_exercise, v_trainer_exercise,
    v_personal_plan, v_personal_step, v_personal_session, v_personal_performed_set, v_legacy_plan,
    v_link, v_trainer_plan, v_trainer_step, v_trainer_session
  );
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'workout_plan_v3_delete_capabilities' and relation.relrowsecurity
  ) then
    raise exception 'V3 delete capability table is missing or RLS is disabled';
  end if;
  if has_table_privilege('anon', 'public.workout_plan_v3_delete_capabilities', 'select')
     or has_table_privilege('authenticated', 'public.workout_plan_v3_delete_capabilities', 'select')
     or has_table_privilege('anon', 'public.workout_plan_v3_delete_capabilities', 'insert')
     or has_table_privilege('authenticated', 'public.workout_plan_v3_delete_capabilities', 'insert') then
    raise exception 'Browser role has V3 delete capability-table access';
  end if;
  if has_function_privilege('anon', 'public.delete_my_workout_plan_v3(uuid)', 'execute')
     or has_function_privilege('anon', 'public.delete_trainer_assigned_workout_plan_v3(uuid,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_my_workout_plan_v3(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_trainer_assigned_workout_plan_v3(uuid,uuid)', 'execute') then
    raise exception 'V3 public delete RPC grants are incorrect';
  end if;
  if has_function_privilege('authenticated', 'public.acquire_workout_plan_v3_delete_capability(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.release_workout_plan_v3_delete_capability(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.guard_materialized_workout_step_v3()', 'execute') then
    raise exception 'Browser role has internal V3 delete helper EXECUTE';
  end if;
end;
$$;

set local role authenticated;

-- A browser cannot delete a protected step or forge the capability through a
-- custom GUC. The failed V1 deletion is atomic: plan, set and history remain.
do $$
declare c slice3a21_context%rowtype;
begin
  select * into c from slice3a21_context;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  begin
    delete from public.workout_plan_exercises where id = c.personal_step_id;
    raise exception 'Direct delete unexpectedly removed a materialised V3 step';
  exception when sqlstate '55000' then null;
  end;
  perform set_config('flux.workout_plan_v3_capability', gen_random_uuid()::text, true);
  begin
    perform public.delete_my_workout_plan(c.personal_plan_id);
    raise exception 'Forged GUC unexpectedly deleted materialised V3 plan';
  exception when sqlstate '55000' then null;
  end;
  perform set_config('flux.workout_plan_v3_capability', '', true);
  if jsonb_array_length(public.get_my_workout_plan_v3(c.personal_plan_id)
       -> 'exercises' -> 0 -> 'planned_sets') <> 1
     or not exists (select 1 from public.workout_sessions where id = c.personal_session_id and plan_id = c.personal_plan_id) then
    raise exception 'Rejected V1 delete partially changed V3 fixture';
  end if;
end;
$$;

-- V3 delete removes only the plan hierarchy and unlinks, but does not rewrite,
-- the completed session snapshot.
do $$
declare c slice3a21_context%rowtype;
begin
  select * into c from slice3a21_context;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  perform public.delete_my_workout_plan_v3(c.personal_plan_id);
  begin
    perform public.get_my_workout_plan_v3(c.personal_plan_id);
    raise exception 'V3 personal delete did not remove plan hierarchy';
  exception when sqlstate 'P0002' then null;
  end;
  if not exists (
    select 1 from public.workout_sessions
    where id = c.personal_session_id and plan_id is null
      and plan_snapshot -> 0 ->> 'name' = 'Snapshot stays immutable'
      and (plan_snapshot -> 0 -> 'planned_sets' -> 0 ->> 'target_reps_min')::integer = 8
  ) then
    raise exception 'V3 personal delete changed completed session history';
  end if;
  if not exists (
    select 1 from public.performed_sets
    where id = c.personal_performed_set_id
      and workout_session_id = c.personal_session_id
      and session_step_id = c.personal_step_id
      and plan_exercise_id is null
      and reps = 8
      and weight_kg = 20
  ) then
    raise exception 'V3 personal delete did not preserve performed set history';
  end if;
  perform public.delete_my_workout_plan_v3(c.legacy_plan_id);
  if exists (select 1 from public.workout_plans where id = c.legacy_plan_id) then
    raise exception 'V3 delete did not support a legacy virtual-set plan';
  end if;
end;
$$;

-- Cross-user and revoked-link attempts are rejected before a capability is
-- minted. The authorised trainer can delete only after the exact link is active.
do $$
declare c slice3a21_context%rowtype;
begin
  select * into c from slice3a21_context;
  perform set_config('request.jwt.claim.sub', c.other_client_id::text, true);
  begin
    perform public.delete_trainer_assigned_workout_plan_v3(c.trainer_link_id, c.trainer_plan_id);
    raise exception 'Unrelated user unexpectedly deleted trainer assignment';
  exception when sqlstate '42501' then null;
  end;
end;
$$;

reset role;
update public.trainer_client_links set status = 'revoked'
where id = (select trainer_link_id from slice3a21_context);
set local role authenticated;

do $$
declare c slice3a21_context%rowtype;
begin
  select * into c from slice3a21_context;
  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  begin
    perform public.delete_trainer_assigned_workout_plan_v3(c.trainer_link_id, c.trainer_plan_id);
    raise exception 'Revoked trainer unexpectedly deleted assignment';
  exception when sqlstate '42501' then null;
  end;
end;
$$;

reset role;
update public.trainer_client_links set status = 'active'
where id = (select trainer_link_id from slice3a21_context);
set local role authenticated;

do $$
declare c slice3a21_context%rowtype;
begin
  select * into c from slice3a21_context;
  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  perform public.delete_trainer_assigned_workout_plan_v3(c.trainer_link_id, c.trainer_plan_id);
  begin
    perform public.get_trainer_assigned_workout_plan_v3(c.trainer_link_id, c.trainer_plan_id);
    raise exception 'V3 trainer delete did not remove assignment hierarchy';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;

reset role;
do $$
begin
  if not exists (
    select 1
    from public.workout_sessions session
    join slice3a21_context context on context.trainer_session_id = session.id
    where session.plan_id is null
      and session.plan_snapshot = jsonb_build_array(jsonb_build_object('name', 'Trainer snapshot stays immutable'))
  ) then
    raise exception 'V3 trainer delete did not preserve and unlink completed session history';
  end if;
  if exists (select 1 from public.workout_plan_v3_delete_capabilities) then
    raise exception 'V3 delete capability leaked after successful deletion';
  end if;
end;
$$;

rollback;
