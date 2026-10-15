-- Workout Editor V2 Slice 3A.1 contract checks.
-- Run only against an isolated local database after
-- 20261011130000_individual_set_targets_contract.sql. Every fixture is
-- transaction-scoped and the file always ROLLBACKs.

begin;

create temporary table slice3a1_context (
  client_id uuid not null,
  trainer_id uuid not null,
  other_client_id uuid not null,
  link_id uuid,
  personal_exercise_id uuid not null,
  trainer_exercise_id uuid not null,
  personal_plan_id uuid,
  personal_step_id uuid,
  legacy_plan_id uuid,
  legacy_step_id uuid,
  trainer_plan_id uuid,
  personal_session_id uuid
) on commit drop;
grant select, update on slice3a1_context to authenticated;

do $$
declare
  v_client uuid;
  v_trainer uuid;
  v_other_client uuid;
  v_marker text := replace(gen_random_uuid()::text, '-', '');
begin
  select account.user_id into v_client
  from public.test_accounts account join auth.users auth_user on auth_user.id = account.user_id
  where account.purpose = 'client' and lower(auth_user.email) = 'flux-workout-e2e-client@flux.local';
  select account.user_id into v_trainer
  from public.test_accounts account join auth.users auth_user on auth_user.id = account.user_id
  where account.purpose = 'trainer' and lower(auth_user.email) = 'flux-test-trainer@flux.local';
  select account.user_id into v_other_client
  from public.test_accounts account join auth.users auth_user on auth_user.id = account.user_id
  where account.purpose = 'empty_client' and lower(auth_user.email) = 'flux-empty-client@flux.local';
  if v_client is null or v_trainer is null or v_other_client is null then
    raise exception 'Required registry-owned synthetic personas are unavailable';
  end if;
  if exists (select 1 from public.trainer_client_links where trainer_id = v_trainer and client_id = v_client) then
    raise exception 'Dedicated test pair is not isolated; refusing to alter link state';
  end if;

  insert into public.exercises (user_id, name, measurement_type)
  values
    (v_client, 'Slice 3A.1 personal ' || v_marker, 'reps'),
    (v_trainer, 'Slice 3A.1 trainer ' || v_marker, 'reps');
  insert into slice3a1_context (client_id, trainer_id, other_client_id, personal_exercise_id, trainer_exercise_id)
  values (
    v_client, v_trainer, v_other_client,
    (select id from public.exercises where user_id = v_client and name = 'Slice 3A.1 personal ' || v_marker),
    (select id from public.exercises where user_id = v_trainer and name = 'Slice 3A.1 trainer ' || v_marker)
  );
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'workout_plan_exercise_sets' and relation.relrowsecurity
  ) then
    raise exception 'Planned set table is missing or RLS is disabled';
  end if;
  if has_table_privilege('anon', 'public.workout_plan_exercise_sets', 'select')
     or has_table_privilege('authenticated', 'public.workout_plan_exercise_sets', 'select') then
    raise exception 'Browser role has direct planned-set table access';
  end if;
  if has_table_privilege('anon', 'public.workout_plan_v3_write_capabilities', 'select')
     or has_table_privilege('authenticated', 'public.workout_plan_v3_write_capabilities', 'select')
     or has_table_privilege('anon', 'public.workout_plan_v3_write_capabilities', 'insert')
     or has_table_privilege('authenticated', 'public.workout_plan_v3_write_capabilities', 'insert') then
    raise exception 'Browser role has V3 write capability-table access';
  end if;
  if has_table_privilege('anon', 'public.workout_plan_v3_write_capabilities_v2', 'select')
     or has_table_privilege('authenticated', 'public.workout_plan_v3_write_capabilities_v2', 'select')
     or has_table_privilege('anon', 'public.workout_plan_v3_write_capabilities_v2', 'insert')
     or has_table_privilege('authenticated', 'public.workout_plan_v3_write_capabilities_v2', 'insert') then
    raise exception 'Browser role has V3 write capability-v2 table access';
  end if;
  if has_table_privilege('anon', 'public.workout_plan_v3_delete_capabilities', 'select')
     or has_table_privilege('authenticated', 'public.workout_plan_v3_delete_capabilities', 'select')
     or has_table_privilege('anon', 'public.workout_plan_v3_delete_capabilities', 'insert')
     or has_table_privilege('authenticated', 'public.workout_plan_v3_delete_capabilities', 'insert') then
    raise exception 'Browser role has V3 delete capability-table access';
  end if;
  if exists (
    select 1 from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'assert_workout_planned_set_targets_v3', 'replace_workout_plan_step_sets_v3',
        'workout_step_planned_sets_v3', 'read_workout_plan_step_sets_v3',
        'client_safe_workout_step_v3', 'prepare_workout_plan_steps_v3', 'sync_workout_plan_step_sets_v3',
        'acquire_workout_plan_v3_write_capability', 'release_workout_plan_v3_write_capability',
        'acquire_workout_plan_v3_write_capability_v2', 'release_workout_plan_v3_write_capability_v2',
        'acquire_workout_plan_v3_delete_capability', 'release_workout_plan_v3_delete_capability'
      )
      and (has_function_privilege('anon', procedure.oid, 'execute')
           or has_function_privilege('authenticated', procedure.oid, 'execute'))
  ) then
    raise exception 'V3 internal helper unexpectedly has browser EXECUTE';
  end if;
  if exists (
    select 1 from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'save_my_workout_plan_v3', 'save_trainer_assigned_workout_plan_v3',
        'get_my_workout_plan_v3', 'get_trainer_assigned_workout_plan_v3',
        'get_my_workout_session_v3', 'start_personal_workout_v3',
        'delete_my_workout_plan_v3', 'delete_trainer_assigned_workout_plan_v3'
      ) and has_function_privilege('anon', procedure.oid, 'execute')
  ) then
    raise exception 'Anon unexpectedly has V3 workout RPC EXECUTE';
  end if;
end;
$$;

set local role authenticated;

-- Independent targets, stable IDs, reorder, delete and legacy materialisation.
do $$
declare
  c slice3a1_context%rowtype;
  v_plan jsonb;
  v_resaved jsonb;
  v_legacy jsonb;
  v_session jsonb;
  v_set_a uuid;
  v_set_b uuid;
begin
  select * into c from slice3a1_context;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  v_plan := public.save_my_workout_plan_v3(
    null, 'Slice 3A.1 personal', null, 'beginner', 20::smallint,
    jsonb_build_array(jsonb_build_object(
      'exercise_source_kind', 'personal', 'exercise_source_id', c.personal_exercise_id,
      'planned_sets', jsonb_build_array(
        jsonb_build_object('target_reps_min', 8, 'target_weight_kg', 40, 'rest_seconds', null),
        jsonb_build_object('target_reps_min', 6, 'target_weight_kg', 50, 'rest_seconds', 90)
      )
    ))
  );
  c.personal_plan_id := (v_plan ->> 'id')::uuid;
  c.personal_step_id := (v_plan -> 'exercises' -> 0 ->> 'step_id')::uuid;
  update slice3a1_context
  set personal_plan_id = c.personal_plan_id,
      personal_step_id = c.personal_step_id;
  v_set_a := (v_plan -> 'exercises' -> 0 -> 'planned_sets' -> 0 ->> 'set_id')::uuid;
  v_set_b := (v_plan -> 'exercises' -> 0 -> 'planned_sets' -> 1 ->> 'set_id')::uuid;
  if v_set_a is null or v_set_b is null or v_set_a = v_set_b
     or v_plan -> 'exercises' -> 0 -> 'planned_sets' -> 0 ->> 'rest_seconds' is not null then
    raise exception 'V3 save did not persist independent targets and nullable rest';
  end if;

  -- A failed V3 write must release its server-issued capability as well.
  begin
    perform public.save_my_workout_plan_v3(
      null, 'Slice 3A.1 invalid', null, 'beginner', 20::smallint,
      jsonb_build_array(jsonb_build_object(
        'exercise_source_kind', 'personal', 'exercise_source_id', c.personal_exercise_id,
        'planned_sets', jsonb_build_array(jsonb_build_object('target_reps_min', 0))
      ))
    );
    raise exception 'Invalid V3 planned set unexpectedly saved';
  exception when sqlstate '23514' then null;
  end;

  -- V2 may still edit legacy steps, but it must fail closed rather than
  -- rewriting the scalar projection of a materialized V3 step.
  begin
    -- Browser-controlled custom GUC values cannot mint the server-issued
    -- capability that the trigger requires.
    perform set_config('flux.workout_plan_v3_writer', 'on', true);
    perform set_config('flux.workout_plan_v3_capability', gen_random_uuid()::text, true);
    perform public.save_my_workout_plan_v2(
      c.personal_plan_id, 'V2 must not overwrite V3', null, 'beginner', 20::smallint,
      jsonb_build_array(jsonb_build_object(
        'step_id', c.personal_step_id, 'target_sets', 1, 'target_reps_min', 12,
        'target_weight_kg', 60, 'rest_seconds', 30
      ))
    );
    raise exception 'V2 unexpectedly changed materialized V3 targets';
  exception when sqlstate '55000' then null;
  end;
  perform set_config('flux.workout_plan_v3_writer', '', true);
  perform set_config('flux.workout_plan_v3_capability', '', true);
  begin
    perform public.save_my_workout_plan(
      c.personal_plan_id, 'V1 must not delete V3', null, 'beginner', 20::smallint,
      jsonb_build_array(jsonb_build_object(
        'exercise_id', c.personal_exercise_id, 'target_sets', 1,
        'target_reps_min', 12, 'target_weight_kg', 60, 'rest_seconds', 30
      ))
    );
    raise exception 'V1 unexpectedly deleted materialized V3 targets';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.workout_plan_exercises where id = c.personal_step_id;
    raise exception 'Direct browser-role delete unexpectedly removed a materialized V3 step';
  exception when sqlstate '55000' then null;
  end;
  if (public.get_my_workout_plan_v3(c.personal_plan_id)
      -> 'exercises' -> 0 -> 'planned_sets' -> 0 ->> 'target_reps_min')::integer <> 8
     or jsonb_array_length(public.get_my_workout_plan_v3(c.personal_plan_id)
      -> 'exercises' -> 0 -> 'planned_sets') <> 2 then
    raise exception 'Rejected V2 write partially changed V3 planned sets';
  end if;

  v_resaved := public.save_my_workout_plan_v3(
    c.personal_plan_id, 'Slice 3A.1 personal', null, 'beginner', 20::smallint,
    jsonb_build_array(jsonb_build_object(
      'step_id', c.personal_step_id,
      'planned_sets', jsonb_build_array(
        jsonb_build_object('set_id', v_set_b, 'target_reps_min', 7, 'target_weight_kg', 52, 'rest_seconds', 75),
        jsonb_build_object('set_id', v_set_a, 'target_reps_min', 8, 'target_weight_kg', 40, 'rest_seconds', null)
      )
    ))
  );
  if (v_resaved -> 'exercises' -> 0 -> 'planned_sets' -> 0 ->> 'set_id')::uuid <> v_set_b
     or (v_resaved -> 'exercises' -> 0 -> 'planned_sets' -> 0 ->> 'target_reps_min')::integer <> 7 then
    raise exception 'V3 reorder did not preserve stable set id';
  end if;

  v_resaved := public.save_my_workout_plan_v3(
    c.personal_plan_id, 'Slice 3A.1 personal', null, 'beginner', 20::smallint,
    jsonb_build_array(jsonb_build_object('step_id', c.personal_step_id,
      'planned_sets', jsonb_build_array(jsonb_build_object(
        'set_id', v_set_b, 'target_reps_min', 7, 'target_weight_kg', 52, 'rest_seconds', 75
      ))))
  );
  if jsonb_array_length(v_resaved -> 'exercises' -> 0 -> 'planned_sets') <> 1
     or (v_resaved -> 'exercises' -> 0 ->> 'target_sets')::integer <> 1 then
    raise exception 'V3 delete did not update planned set collection';
  end if;

  v_legacy := public.save_my_workout_plan_v2(
    null, 'Slice 3A.1 legacy', null, null, null,
    jsonb_build_array(jsonb_build_object('exercise_source_kind', 'personal', 'exercise_source_id', c.personal_exercise_id,
      'target_sets', 2, 'target_reps_min', 10, 'target_weight_kg', 30, 'rest_seconds', 60))
  );
  update slice3a1_context
  set legacy_plan_id = (v_legacy ->> 'id')::uuid,
      legacy_step_id = (v_legacy -> 'exercises' -> 0 ->> 'step_id')::uuid;
  v_legacy := public.get_my_workout_plan_v3((select legacy_plan_id from slice3a1_context));
  if jsonb_array_length(v_legacy -> 'exercises' -> 0 -> 'planned_sets') <> 2
     or v_legacy -> 'exercises' -> 0 -> 'planned_sets' -> 0 ->> 'set_id' is not null then
    raise exception 'Legacy fallback did not return virtual planned sets';
  end if;

  perform set_config('request.jwt.claim.sub', c.other_client_id::text, true);
  begin
    perform public.get_my_workout_plan_v3(c.personal_plan_id);
    raise exception 'Cross-user V3 plan read unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);

  -- V3 session snapshots contain the exact targets at start; later plan edits
  -- cannot rewrite that in-progress session.
  v_session := public.start_personal_workout_v3(c.personal_plan_id);
  update slice3a1_context set personal_session_id = (v_session ->> 'id')::uuid;
  v_resaved := public.save_my_workout_plan_v3(
    c.personal_plan_id, 'Slice 3A.1 personal changed', null, 'beginner', 20::smallint,
    jsonb_build_array(jsonb_build_object('step_id', c.personal_step_id,
      'planned_sets', jsonb_build_array(jsonb_build_object(
        'set_id', v_set_b, 'target_reps_min', 12, 'target_weight_kg', 60, 'rest_seconds', 30
      ))))
  );
  if (public.get_my_workout_session_v3((v_session ->> 'id')::uuid)
      -> 'plan_snapshot' -> 0 -> 'planned_sets' -> 0 ->> 'target_reps_min')::integer <> 7 then
    raise exception 'Active session planned-set snapshot changed after plan edit';
  end if;
  perform public.complete_my_workout_session((v_session ->> 'id')::uuid, null);
end;
$$;

reset role;
do $$
begin
  if exists (select 1 from public.workout_plan_v3_write_capabilities)
     or exists (select 1 from public.workout_plan_v3_write_capabilities_v2) then
    raise exception 'V3 write capability leaked after a successful save';
  end if;
end;
$$;

-- Trainer V3 uses the active link to derive the client. The trainer may see
-- its source while editing; the client V3 read never receives that source id.
do $$
declare c slice3a1_context%rowtype; v_link uuid;
begin
  select * into c from slice3a1_context;
  insert into public.trainer_client_links (trainer_id, client_id, status, responded_at)
  values (c.trainer_id, c.client_id, 'active', now()) returning id into v_link;
  update slice3a1_context set link_id = v_link;
end;
$$;
set local role authenticated;

do $$
declare c slice3a1_context%rowtype; v_plan jsonb;
begin
  select * into c from slice3a1_context;
  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  v_plan := public.save_trainer_assigned_workout_plan_v3(
    c.link_id, null, 'Slice 3A.1 trainer', null, null, null,
    jsonb_build_array(jsonb_build_object('exercise_source_kind', 'trainer_private',
      'exercise_source_id', c.trainer_exercise_id,
      'planned_sets', jsonb_build_array(jsonb_build_object('target_reps_min', 8, 'rest_seconds', 60))))
  );
  update slice3a1_context set trainer_plan_id = (v_plan ->> 'id')::uuid;
  if v_plan -> 'exercises' -> 0 -> 'planned_sets' -> 0 ->> 'set_id' is null then
    raise exception 'Trainer V3 did not persist planned set';
  end if;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  if public.get_my_workout_plan_v3((select trainer_plan_id from slice3a1_context))
       -> 'exercises' -> 0 ->> 'exercise_source_id' is not null
     or public.get_my_workout_plan_v3((select trainer_plan_id from slice3a1_context))
       -> 'exercises' -> 0 -> 'exercise_snapshot' ->> 'source_id' is not null then
    raise exception 'Trainer private source id leaked through V3 client plan read';
  end if;
end;
$$;

reset role;
update public.trainer_client_links
set status = 'revoked'
where id = (select link_id from slice3a1_context);
set local role authenticated;

do $$
declare c slice3a1_context%rowtype; v_session jsonb;
begin
  select * into c from slice3a1_context;
  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  begin
    perform public.save_trainer_assigned_workout_plan_v3(
      c.link_id, c.trainer_plan_id, 'Blocked after revocation', null, null, null,
      jsonb_build_array(jsonb_build_object('planned_sets', jsonb_build_array(
        jsonb_build_object('target_reps_min', 8, 'rest_seconds', 60)
      )))
    );
    raise exception 'Revoked trainer link unexpectedly retained V3 management access';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  if jsonb_array_length(public.get_my_workout_plan_v3(c.trainer_plan_id) -> 'exercises') <> 1 then
    raise exception 'Client lost assigned plan after trainer link revocation';
  end if;
  v_session := public.start_personal_workout_v3(c.trainer_plan_id);
  if v_session -> 'plan_snapshot' -> 0 ->> 'exercise_source_id' is not null
     or v_session -> 'plan_snapshot' -> 0 -> 'exercise_snapshot' ->> 'source_id' is not null then
    raise exception 'Trainer private source id leaked through V3 client session snapshot';
  end if;
  perform public.complete_my_workout_session((v_session ->> 'id')::uuid, null);
end;
$$;

-- V3 deletion obtains a server-issued capability only after personal/trainer
-- authorisation. It may remove a materialised plan, but retains immutable
-- session history and still fails closed for an active execution.
set local role authenticated;
do $$
declare
  c slice3a1_context%rowtype;
  v_blocked jsonb;
  v_blocked_id uuid;
  v_completed_legacy jsonb;
  v_completed_legacy_id uuid;
  v_completed_legacy_session jsonb;
begin
  select * into c from slice3a1_context;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);

  v_blocked := public.save_my_workout_plan_v3(
    null, 'Slice 3A.1 deletion blocked', null, 'beginner', 20::smallint,
    jsonb_build_array(jsonb_build_object(
      'exercise_source_kind', 'personal', 'exercise_source_id', c.personal_exercise_id,
      'planned_sets', jsonb_build_array(jsonb_build_object('target_reps_min', 5, 'rest_seconds', 30))
    ))
  );
  v_blocked_id := (v_blocked ->> 'id')::uuid;
  perform public.start_personal_workout_v3(v_blocked_id);
  begin
    perform public.delete_my_workout_plan_v3(v_blocked_id);
    raise exception 'V3 personal deletion unexpectedly removed an active plan';
  exception when sqlstate '55000' then null;
  end;
  if jsonb_array_length(public.get_my_workout_plan_v3(v_blocked_id)
       -> 'exercises' -> 0 -> 'planned_sets') <> 1 then
    raise exception 'Rejected active-plan delete partially removed V3 data';
  end if;
  perform public.complete_my_workout_session((select id from public.workout_sessions
    where user_id = c.client_id and plan_id = v_blocked_id and status = 'in_progress'));
  perform public.delete_my_workout_plan_v3(v_blocked_id);
  begin
    perform public.get_my_workout_plan_v3(v_blocked_id);
    raise exception 'V3 personal deletion did not remove its plan hierarchy';
  exception when sqlstate 'P0002' then null;
  end;

  -- A forged GUC must not permit V1 to unlink a completed legacy session. The
  -- V3 delete path can perform that one referential unlink while leaving the
  -- immutable snapshot untouched.
  v_completed_legacy := public.save_my_workout_plan_v2(
    null, 'Slice 3A.1 completed legacy', null, 'beginner', 20::smallint,
    jsonb_build_array(jsonb_build_object(
      'exercise_source_kind', 'personal', 'exercise_source_id', c.personal_exercise_id,
      'target_sets', 1, 'target_reps_min', 8, 'target_weight_kg', 20, 'rest_seconds', 30
    ))
  );
  v_completed_legacy_id := (v_completed_legacy ->> 'id')::uuid;
  v_completed_legacy_session := public.start_personal_workout_v3(v_completed_legacy_id);
  perform public.complete_my_workout_session((v_completed_legacy_session ->> 'id')::uuid, null);
  perform set_config('flux.workout_plan_v3_capability', gen_random_uuid()::text, true);
  begin
    perform public.delete_my_workout_plan(v_completed_legacy_id);
    raise exception 'Forged capability unexpectedly unlinked a completed session';
  exception when sqlstate '55000' then null;
  end;
  perform set_config('flux.workout_plan_v3_capability', '', true);
  perform public.delete_my_workout_plan_v3(v_completed_legacy_id);
  if not exists (
    select 1 from public.workout_sessions
    where id = (v_completed_legacy_session ->> 'id')::uuid
      and plan_id is null
      and plan_snapshot is not null
  ) then
    raise exception 'V3 delete did not preserve completed legacy session snapshot';
  end if;

  -- The completed V3 session holds its own immutable snapshot. Deleting the
  -- plan may null its FK, but cannot remove the session or alter its targets.
  perform public.delete_my_workout_plan_v3(c.personal_plan_id);
  begin
    perform public.get_my_workout_plan_v3(c.personal_plan_id);
    raise exception 'V3 personal deletion left materialised plan data';
  exception when sqlstate 'P0002' then null;
  end;
  if not exists (
    select 1 from public.workout_sessions
    where id = c.personal_session_id
      and plan_id is null
      and (plan_snapshot -> 0 -> 'planned_sets' -> 0 ->> 'target_reps_min')::integer = 7
  ) then
    raise exception 'V3 deletion changed completed session history';
  end if;

  -- Legacy virtual-set plans have no materialised child rows and retain their
  -- existing V1 delete path.
  perform public.delete_my_workout_plan(c.legacy_plan_id);
  if exists (select 1 from public.workout_plans where id = c.legacy_plan_id) then
    raise exception 'V1 deletion no longer works for a legacy plan';
  end if;

  -- A different synthetic user cannot use a personal V3 delete entry point.
  perform set_config('request.jwt.claim.sub', c.other_client_id::text, true);
  begin
    perform public.delete_my_workout_plan_v3(c.trainer_plan_id);
    raise exception 'Cross-user V3 personal delete unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;

-- The V3 trainer delete keeps active-link enforcement. A revoked link is
-- denied before a capability is minted; an active owner can then delete the
-- exact assignment and its materialised hierarchy.
do $$
declare c slice3a1_context%rowtype;
begin
  select * into c from slice3a1_context;
  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  begin
    perform public.delete_trainer_assigned_workout_plan_v3(c.link_id, c.trainer_plan_id);
    raise exception 'Revoked trainer link unexpectedly deleted V3 assignment';
  exception when sqlstate '42501' then null;
  end;
  -- Trainer RLS deliberately cannot read the client-owned assignment row.
  -- Verify the no-partial-delete postcondition as the isolated test owner.
  reset role;
  if not exists (select 1 from public.workout_plans where id = c.trainer_plan_id) then
    raise exception 'Rejected trainer deletion partially removed an assignment';
  end if;
end;
$$;

reset role;
update public.trainer_client_links
set status = 'active'
where id = (select link_id from slice3a1_context);
set local role authenticated;

do $$
declare c slice3a1_context%rowtype;
begin
  select * into c from slice3a1_context;
  perform set_config('request.jwt.claim.sub', c.other_client_id::text, true);
  begin
    perform public.delete_trainer_assigned_workout_plan_v3(c.link_id, c.trainer_plan_id);
    raise exception 'Unrelated user unexpectedly deleted a trainer assignment';
  exception when sqlstate '42501' then null;
  end;

  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  perform public.delete_trainer_assigned_workout_plan_v3(c.link_id, c.trainer_plan_id);
  begin
    perform public.get_trainer_assigned_workout_plan_v3(c.link_id, c.trainer_plan_id);
    raise exception 'V3 trainer deletion did not remove its plan hierarchy';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;

reset role;
do $$
begin
  if exists (select 1 from public.workout_plan_v3_write_capabilities)
     or exists (select 1 from public.workout_plan_v3_write_capabilities_v2)
     or exists (select 1 from public.workout_plan_v3_delete_capabilities) then
    raise exception 'V3 capability leaked after V3 deletion';
  end if;
end;
$$;

rollback;
