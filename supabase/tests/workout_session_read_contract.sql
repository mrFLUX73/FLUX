-- Workout Engine V3, Slice 3A.3.1 session-read contract.
--
-- Run only against an isolated PostgreSQL/Supabase runtime after
-- 20261013110000_safe_workout_session_read_contract.sql. Fixtures belong to
-- registry-verified synthetic accounts and this script always ROLLBACKs.

begin;

create temporary table slice3a31_context (
  client_id uuid not null,
  trainer_id uuid not null,
  other_client_id uuid not null,
  trainer_exercise_id uuid not null,
  link_id uuid not null,
  trainer_plan_id uuid not null,
  v3_session_id uuid,
  completed_session_id uuid
) on commit drop;
grant select, update on slice3a31_context to authenticated;

-- Public readers must be authenticated-only SECURITY DEFINER functions with
-- an empty search_path. The new V3 active reader is part of this same boundary.
do $$
begin
  if (select count(*) from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname in (
          'get_my_workout_session', 'get_my_active_workout_session',
          'get_my_workout_session_v2', 'get_my_workout_session_v3',
          'get_my_active_workout_session_v3'
        )) <> 5 then
    raise exception 'Expected public session-read RPC is missing';
  end if;

  if exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'get_my_workout_session', 'get_my_active_workout_session',
        'get_my_workout_session_v2', 'get_my_workout_session_v3',
        'get_my_active_workout_session_v3'
      )
      and (
        not procedure.prosecdef
        or not exists (
          select 1 from unnest(coalesce(procedure.proconfig, '{}'::text[])) setting
          where setting in ('search_path=', 'search_path=""')
        )
        or has_function_privilege('anon', procedure.oid, 'execute')
      )
  ) then
    raise exception 'Session-read RPC security-definer/search_path/grant contract failed';
  end if;

  if exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'get_my_workout_session', 'get_my_active_workout_session',
        'get_my_workout_session_v2', 'get_my_workout_session_v3',
        'get_my_active_workout_session_v3'
      )
      and not has_function_privilege('authenticated', procedure.oid, 'execute')
  ) then
    raise exception 'Authenticated lost session-read RPC EXECUTE';
  end if;
end;
$$;

do $$
declare
  v_client uuid;
  v_trainer uuid;
  v_other_client uuid;
  v_exercise uuid;
  v_link uuid;
  v_plan jsonb;
  v_marker text := replace(gen_random_uuid()::text, '-', '');
begin
  select account.user_id into v_client
  from public.test_accounts account join auth.users user_account on user_account.id = account.user_id
  where account.purpose = 'client' and lower(user_account.email) = 'flux-workout-e2e-client@flux.local';
  select account.user_id into v_trainer
  from public.test_accounts account join auth.users user_account on user_account.id = account.user_id
  where account.purpose = 'trainer' and lower(user_account.email) = 'flux-test-trainer@flux.local';
  select account.user_id into v_other_client
  from public.test_accounts account join auth.users user_account on user_account.id = account.user_id
  where account.purpose = 'empty_client' and lower(user_account.email) = 'flux-empty-client@flux.local';
  if v_client is null or v_trainer is null or v_other_client is null then
    raise exception 'Required registry-owned synthetic personas are unavailable';
  end if;
  if exists (
    select 1 from public.trainer_client_links
    where trainer_id = v_trainer and client_id = v_client
  ) then
    raise exception 'Dedicated session-read test pair is not isolated';
  end if;

  insert into public.exercises (user_id, name, measurement_type)
  values (v_trainer, 'Slice 3A.3.1 trainer ' || v_marker, 'reps')
  returning id into v_exercise;
  insert into public.trainer_client_links (trainer_id, client_id, status, responded_at)
  values (v_trainer, v_client, 'active', now())
  returning id into v_link;

  insert into slice3a31_context (
    client_id, trainer_id, other_client_id, trainer_exercise_id, link_id, trainer_plan_id
  ) values (v_client, v_trainer, v_other_client, v_exercise, v_link, gen_random_uuid());

  -- The plan id is filled below by the trainer's authorised V3 writer.
end;
$$;

set local role authenticated;

-- Create a real V3 trainer assignment under the trainer identity. The client
-- must be able to execute it, but never receive the private source UUID.
do $$
declare c slice3a31_context%rowtype; v_plan jsonb;
begin
  select * into c from slice3a31_context;
  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  v_plan := public.save_trainer_assigned_workout_plan_v3(
    c.link_id, null, 'Slice 3A.3.1 assignment', null, 'beginner', 20::smallint,
    jsonb_build_array(jsonb_build_object(
      'exercise_source_kind', 'trainer_private', 'exercise_source_id', c.trainer_exercise_id,
      'planned_sets', jsonb_build_array(
        jsonb_build_object('target_reps_min', 8, 'target_weight_kg', 20, 'rest_seconds', 45),
        jsonb_build_object('target_reps_min', 6, 'target_weight_kg', 25, 'rest_seconds', 75)
      )
    ))
  );
  update slice3a31_context set trainer_plan_id = (v_plan ->> 'id')::uuid;
end;
$$;

-- V3 active/read and the legacy V1/V2 readers must all hide both the top-level
-- source id and the nested immutable exercise_snapshot.source_id.
do $$
declare
  c slice3a31_context%rowtype;
  v_v3 jsonb;
  v_v3_active jsonb;
  v_v2 jsonb;
  v_v1 jsonb;
  v_v1_active jsonb;
  v_raw_source text;
begin
  select * into c from slice3a31_context;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  v_v3 := public.start_personal_workout_v3(c.trainer_plan_id);
  update slice3a31_context set v3_session_id = (v_v3 ->> 'id')::uuid;

  if jsonb_array_length(v_v3 -> 'plan_snapshot' -> 0 -> 'planned_sets') <> 2
     or (v_v3 -> 'plan_snapshot' -> 0 -> 'planned_sets' -> 0 ->> 'set_number')::integer <> 1
     or (v_v3 -> 'plan_snapshot' -> 0 -> 'planned_sets' -> 0 ->> 'target_reps_min')::integer <> 8
     or (v_v3 -> 'plan_snapshot' -> 0 -> 'planned_sets' -> 1 ->> 'set_number')::integer <> 2
     or (v_v3 -> 'plan_snapshot' -> 0 -> 'planned_sets' -> 1 ->> 'target_reps_min')::integer <> 6 then
    raise exception 'V3 active session did not preserve planned-set order and targets';
  end if;

  v_v3_active := public.get_my_active_workout_session_v3();
  v_v2 := public.get_my_workout_session_v2((v_v3 ->> 'id')::uuid);
  v_v1 := public.get_my_workout_session((v_v3 ->> 'id')::uuid);
  v_v1_active := public.get_my_active_workout_session();
  foreach v_v3 in array array[v_v3, v_v3_active, v_v2, v_v1, v_v1_active] loop
    if v_v3::text like '%' || c.trainer_exercise_id::text || '%' then
      raise exception 'Trainer-private source identifier leaked through a public session reader';
    end if;
  end loop;

  reset role;
  select plan_snapshot -> 0 -> 'exercise_snapshot' ->> 'source_id'
  into v_raw_source
  from public.workout_sessions
  where id = (select v3_session_id from slice3a31_context);
  if v_raw_source <> c.trainer_exercise_id::text then
    raise exception 'Fixture did not contain the trainer-private source in its server snapshot';
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);

  v_v3 := public.complete_my_workout_session((select v3_session_id from slice3a31_context), 3, null);
  update slice3a31_context set completed_session_id = (v_v3 ->> 'id')::uuid;
  if v_v3::text like '%' || c.trainer_exercise_id::text || '%' then
    raise exception 'Completed-session response leaked trainer-private source identity';
  end if;
  if (v_v3 ->> 'overall_rpe')::numeric <> 3
     or (public.get_my_workout_session((select completed_session_id from slice3a31_context)) ->> 'overall_rpe')::numeric <> 3
     or (public.get_my_workout_session_v2((select completed_session_id from slice3a31_context)) ->> 'overall_rpe')::numeric <> 3
     or (public.get_my_workout_session_v3((select completed_session_id from slice3a31_context)) ->> 'overall_rpe')::numeric <> 3 then
    raise exception 'Completed-session overall RPE was not preserved by every public reader';
  end if;
  if public.get_my_active_workout_session_v3() is not null
     or public.get_my_active_workout_session() is not null then
    raise exception 'Active reader did not return null after session completion';
  end if;
end;
$$;

-- Cross-user reads must fail while a client retains safe access to its own
-- completed historical snapshot even after trainer-link revocation.
do $$
declare c slice3a31_context%rowtype; v_result jsonb;
begin
  select * into c from slice3a31_context;
  perform set_config('request.jwt.claim.sub', c.other_client_id::text, true);
  begin
    perform public.get_my_workout_session(c.completed_session_id);
    raise exception 'Cross-user V1 session read unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.get_my_workout_session_v2(c.completed_session_id);
    raise exception 'Cross-user V2 session read unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.get_my_workout_session_v3(c.completed_session_id);
    raise exception 'Cross-user V3 session read unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;

  reset role;
  update public.trainer_client_links set status = 'revoked' where id = c.link_id;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  begin
    perform public.get_trainer_assigned_workout_plan_v3(c.link_id, c.trainer_plan_id);
    raise exception 'Revoked trainer link unexpectedly retained management access';
  exception when sqlstate '42501' then null;
  end;

  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  v_result := public.get_my_workout_session_v3(c.completed_session_id);
  if v_result::text like '%' || c.trainer_exercise_id::text || '%' then
    raise exception 'Revoked link changed client-safe history boundary';
  end if;
end;
$$;

-- Existing V1 and V2 start contracts remain callable. Their responses now use
-- the hardened legacy reader; V3 can safely read either resulting snapshot.
do $$
declare c slice3a31_context%rowtype; v_session jsonb; v_safe jsonb;
begin
  select * into c from slice3a31_context;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  v_session := public.start_personal_workout(c.trainer_plan_id);
  if v_session::text like '%' || c.trainer_exercise_id::text || '%' then
    raise exception 'V1 start response leaked trainer-private source identity';
  end if;
  v_safe := public.get_my_active_workout_session_v3();
  if v_safe::text like '%' || c.trainer_exercise_id::text || '%'
     or jsonb_array_length(v_safe -> 'plan_snapshot' -> 0 -> 'planned_sets') <> 2 then
    raise exception 'V3 active reader failed for a V1-started session';
  end if;
  v_safe := public.complete_my_workout_session((v_session ->> 'id')::uuid, 10, null);
  if (v_safe ->> 'overall_rpe')::numeric <> 10
     or (public.get_my_workout_session_v3((v_session ->> 'id')::uuid) ->> 'overall_rpe')::numeric <> 10 then
    raise exception 'V1-started session lost a permitted overall RPE';
  end if;

  v_session := public.start_personal_workout_v2(c.trainer_plan_id);
  if v_session::text like '%' || c.trainer_exercise_id::text || '%' then
    raise exception 'V2 start response leaked trainer-private source identity';
  end if;
  v_safe := public.get_my_active_workout_session_v3();
  if v_safe::text like '%' || c.trainer_exercise_id::text || '%'
     or jsonb_array_length(v_safe -> 'plan_snapshot' -> 0 -> 'planned_sets') <> 2 then
    raise exception 'V3 active reader failed for a V2-started session';
  end if;
  v_safe := public.complete_my_workout_session((v_session ->> 'id')::uuid, null, null);
  if v_safe ->> 'overall_rpe' is not null
     or public.get_my_workout_session_v3((v_session ->> 'id')::uuid) ->> 'overall_rpe' is not null then
    raise exception 'Session without overall RPE did not retain a null value';
  end if;
end;
$$;

-- A completed snapshot stays readable after its assigned plan and underlying
-- trainer-private exercise are gone. This exercises the immutable-history path
-- without exposing the removed source identity.
reset role;
update public.trainer_client_links
set status = 'active'
where id = (select link_id from slice3a31_context);
set local role authenticated;

do $$
declare c slice3a31_context%rowtype;
begin
  select * into c from slice3a31_context;
  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  perform public.delete_trainer_assigned_workout_plan_v3(c.link_id, c.trainer_plan_id);

  reset role;
  delete from public.exercises where id = c.trainer_exercise_id and user_id = c.trainer_id;
  if exists (select 1 from public.exercises where id = c.trainer_exercise_id) then
    raise exception 'Test trainer-private source was not deleted';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  if public.get_my_workout_session(c.completed_session_id)::text like '%' || c.trainer_exercise_id::text || '%'
     or public.get_my_workout_session_v2(c.completed_session_id)::text like '%' || c.trainer_exercise_id::text || '%'
     or public.get_my_workout_session_v3(c.completed_session_id)::text like '%' || c.trainer_exercise_id::text || '%'
     or jsonb_array_length(public.get_my_workout_session_v3(c.completed_session_id) -> 'plan_snapshot' -> 0 -> 'planned_sets') <> 2 then
    raise exception 'Deleted source/plan did not preserve a client-safe V3 historical snapshot';
  end if;
end;
$$;

reset role;
rollback;
