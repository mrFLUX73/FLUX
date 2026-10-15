-- Workout Engine V3 Slice 3A.3.3.2 checkpoint contract.
-- Run only against the isolated PostgreSQL test runtime after
-- 20261013170000_workout_execution_checkpoint.sql. All fixtures roll back.

begin;

create temporary table checkpoint_context (
  client_id uuid not null,
  other_client_id uuid not null,
  personal_session_id uuid not null,
  trainer_session_id uuid not null,
  personal_step_id uuid not null,
  trainer_step_id uuid not null
) on commit drop;
grant select on checkpoint_context to authenticated;

do $$
declare
  v_client uuid;
  v_other uuid;
  v_personal_session uuid := gen_random_uuid();
  v_trainer_session uuid := gen_random_uuid();
  v_personal_step uuid := gen_random_uuid();
  v_trainer_step uuid := gen_random_uuid();
begin
  select account.user_id into v_client
  from public.test_accounts account join auth.users auth_user on auth_user.id = account.user_id
  where account.purpose = 'client' and lower(auth_user.email) = 'flux-workout-e2e-client@flux.local';
  select account.user_id into v_other
  from public.test_accounts account join auth.users auth_user on auth_user.id = account.user_id
  where account.purpose = 'client' and lower(auth_user.email) = 'flux-nutrition-e2e-client@flux.local';
  if v_client is null or v_other is null then raise exception 'Required dedicated synthetic checkpoint personas are unavailable'; end if;

  insert into public.workout_sessions (id, user_id, plan_id, source_type, title, status, plan_snapshot)
  values
    (v_personal_session, v_client, null, 'personal_plan', 'Checkpoint personal', 'in_progress',
      jsonb_build_array(jsonb_build_object('step_id', v_personal_step, 'name', 'Checkpoint personal exercise', 'target_sets', 2,
        'measurement_type', 'duration', 'planned_sets', jsonb_build_array(
          jsonb_build_object('set_id', gen_random_uuid(), 'set_number', 1, 'target_duration_seconds', 30, 'rest_seconds', 15),
          jsonb_build_object('set_id', gen_random_uuid(), 'set_number', 2, 'target_duration_seconds', 30, 'rest_seconds', 0)
        )))),
    (v_trainer_session, v_other, null, 'trainer_assignment', 'Checkpoint trainer', 'in_progress',
      jsonb_build_array(jsonb_build_object('step_id', v_trainer_step, 'name', 'Checkpoint trainer exercise', 'target_sets', 1,
        'measurement_type', 'reps', 'planned_sets', jsonb_build_array(
          jsonb_build_object('set_id', gen_random_uuid(), 'set_number', 1, 'target_reps_min', 8, 'rest_seconds', 0)
        ))));
  insert into checkpoint_context values (v_client, v_other, v_personal_session, v_trainer_session, v_personal_step, v_trainer_step);
end;
$$;

do $$
begin
  if not exists (select 1 from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
                 where namespace.nspname = 'public' and relation.relname = 'workout_execution_checkpoints' and relation.relrowsecurity) then
    raise exception 'Checkpoint table is missing or RLS is disabled';
  end if;
  if has_table_privilege('anon', 'public.workout_execution_checkpoints', 'select')
     or has_table_privilege('authenticated', 'public.workout_execution_checkpoints', 'insert') then
    raise exception 'Browser role has direct checkpoint-table access';
  end if;
  if has_function_privilege('anon', 'public.get_my_workout_execution_checkpoint(uuid)', 'execute')
     or has_function_privilege('anon', 'public.save_my_workout_execution_checkpoint(uuid,uuid,smallint,text,integer,timestamptz,boolean,timestamptz,integer,integer,numeric,integer,numeric,numeric,text,uuid,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.clear_workout_execution_checkpoint_after_set()', 'execute') then
    raise exception 'Checkpoint grants are unsafe';
  end if;
end;
$$;

set local role authenticated;

-- Running duration, stale revision, manual correction and performed-set cleanup.
do $$
declare c checkpoint_context%rowtype; v_checkpoint jsonb; v_updated jsonb; v_key uuid := gen_random_uuid();
begin
  select * into c from checkpoint_context;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  v_checkpoint := public.save_my_workout_execution_checkpoint(
    p_session_id => c.personal_session_id, p_session_step_id => c.personal_step_id, p_set_number => 1::smallint,
    p_phase => 'active', p_duration_accumulated_seconds => 12, p_duration_started_at => now() - interval '3 seconds',
    p_duration_is_manual => false, p_rest_ends_at => null, p_rest_total_seconds => null, p_draft_reps => null, p_draft_weight_kg => null,
    p_draft_duration_seconds => null, p_draft_distance_m => null, p_draft_rpe => 8::numeric,
    p_draft_notes => 'draft duration', p_client_set_key => v_key, p_revision => null
  );
  if (v_checkpoint ->> 'revision')::integer <> 1 or v_checkpoint ->> 'phase' <> 'active'
     or (v_checkpoint ->> 'draft_rpe')::numeric <> 8 then raise exception 'Initial checkpoint did not persist: %', v_checkpoint; end if;
  if public.get_my_workout_execution_checkpoint(c.personal_session_id) ->> 'client_set_key' <> v_key::text then
    raise exception 'Owner could not read own checkpoint';
  end if;
  begin
    perform public.save_my_workout_execution_checkpoint(
      p_session_id => c.personal_session_id, p_session_step_id => c.personal_step_id, p_set_number => 1::smallint,
      p_phase => 'paused', p_duration_accumulated_seconds => 12, p_duration_started_at => null, p_duration_is_manual => false,
      p_rest_ends_at => null, p_rest_total_seconds => null, p_draft_reps => null, p_draft_weight_kg => null, p_draft_duration_seconds => null,
      p_draft_distance_m => null, p_draft_rpe => null, p_draft_notes => null, p_client_set_key => v_key, p_revision => null);
    raise exception 'Stale checkpoint write unexpectedly succeeded';
  exception when sqlstate '40001' then null;
  end;
  v_updated := public.save_my_workout_execution_checkpoint(
    p_session_id => c.personal_session_id, p_session_step_id => c.personal_step_id, p_set_number => 1::smallint,
    p_phase => 'paused', p_duration_accumulated_seconds => 14, p_duration_started_at => null, p_duration_is_manual => true,
    p_rest_ends_at => null, p_rest_total_seconds => null, p_draft_reps => null, p_draft_weight_kg => null, p_draft_duration_seconds => 17,
    p_draft_distance_m => null, p_draft_rpe => 6::numeric, p_draft_notes => 'manual duration', p_client_set_key => v_key,
    p_revision => (v_checkpoint ->> 'revision')::integer);
  if (v_updated ->> 'revision')::integer <> 2 or not (v_updated ->> 'duration_is_manual')::boolean
     or (v_updated ->> 'draft_duration_seconds')::integer <> 17 then raise exception 'Checkpoint revision/manual duration was not saved'; end if;
  begin
    perform public.save_my_workout_execution_checkpoint(
      p_session_id => c.personal_session_id, p_session_step_id => c.personal_step_id, p_set_number => 99::smallint,
      p_phase => 'ready', p_duration_accumulated_seconds => 0, p_duration_started_at => null, p_duration_is_manual => false,
      p_rest_ends_at => null, p_rest_total_seconds => null, p_draft_reps => null, p_draft_weight_kg => null, p_draft_duration_seconds => null,
      p_draft_distance_m => null, p_draft_rpe => null, p_draft_notes => null, p_client_set_key => gen_random_uuid(),
      p_revision => (v_updated ->> 'revision')::integer);
    raise exception 'Invalid snapshot set unexpectedly accepted';
  exception when sqlstate '22023' then null;
  end;
  perform public.save_my_performed_set(
    p_session_id => c.personal_session_id, p_client_set_key => v_key, p_session_step_id => c.personal_step_id,
    p_set_number => 1::smallint, p_reps => null, p_weight_kg => null, p_duration_seconds => 17,
    p_distance_m => null, p_rpe => 6::numeric, p_notes => 'manual duration'
  );
  if public.get_my_workout_execution_checkpoint(c.personal_session_id) is not null then
    raise exception 'Saved performed set did not clear its checkpoint';
  end if;
end;
$$;

-- Owner isolation, trainer-assigned client session, completion cleanup and completed-session denial.
do $$
declare c checkpoint_context%rowtype; v_checkpoint jsonb; v_key uuid := gen_random_uuid();
begin
  select * into c from checkpoint_context;
  perform set_config('request.jwt.claim.sub', c.other_client_id::text, true);
  v_checkpoint := public.save_my_workout_execution_checkpoint(
    p_session_id => c.trainer_session_id, p_session_step_id => c.trainer_step_id, p_set_number => 1::smallint,
    p_phase => 'rest', p_duration_accumulated_seconds => 0, p_duration_started_at => null, p_duration_is_manual => false,
    p_rest_ends_at => now() + interval '20 seconds', p_rest_total_seconds => 20, p_draft_reps => 8, p_draft_weight_kg => 20::numeric,
    p_draft_duration_seconds => null, p_draft_distance_m => null, p_draft_rpe => 6::numeric,
    p_draft_notes => 'trainer client draft', p_client_set_key => v_key, p_revision => null);
  if v_checkpoint ->> 'phase' <> 'rest' then raise exception 'Trainer-assigned checkpoint did not save for the client'; end if;
  perform public.complete_my_workout_session(c.trainer_session_id, 6, null);
  if public.get_my_workout_execution_checkpoint(c.trainer_session_id) is not null then
    raise exception 'Completion did not clear checkpoint';
  end if;
  begin
    perform public.save_my_workout_execution_checkpoint(
      p_session_id => c.trainer_session_id, p_session_step_id => c.trainer_step_id, p_set_number => 1::smallint,
      p_phase => 'ready', p_duration_accumulated_seconds => 0, p_duration_started_at => null, p_duration_is_manual => false,
      p_rest_ends_at => null, p_rest_total_seconds => null, p_draft_reps => null, p_draft_weight_kg => null, p_draft_duration_seconds => null,
      p_draft_distance_m => null, p_draft_rpe => null, p_draft_notes => null, p_client_set_key => gen_random_uuid(), p_revision => null);
    raise exception 'Completed session checkpoint unexpectedly saved';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  if public.get_my_workout_execution_checkpoint(c.trainer_session_id) is not null then
    raise exception 'Cross-user checkpoint read unexpectedly succeeded';
  end if;
  begin
    perform public.save_my_workout_execution_checkpoint(
      p_session_id => c.trainer_session_id, p_session_step_id => c.trainer_step_id, p_set_number => 1::smallint,
      p_phase => 'ready', p_duration_accumulated_seconds => 0, p_duration_started_at => null, p_duration_is_manual => false,
      p_rest_ends_at => null, p_rest_total_seconds => null, p_draft_reps => null, p_draft_weight_kg => null, p_draft_duration_seconds => null,
      p_draft_distance_m => null, p_draft_rpe => null, p_draft_notes => null, p_client_set_key => gen_random_uuid(), p_revision => null);
    raise exception 'Cross-user checkpoint write unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;

rollback;
