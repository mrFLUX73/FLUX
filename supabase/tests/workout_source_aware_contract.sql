-- Workout Editor V2 Slice 2C contract checks.
--
-- Run only against an isolated local Supabase database after
-- 20261010215504_source_aware_workout_plan_contract.sql. This file is
-- intentionally read-only: behavioural RPC tests belong to the dedicated
-- synthetic E2E fixtures once the migration is applied outside production.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_plan_exercises'
      and column_name = 'exercise_source_kind'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'performed_sets'
      and column_name = 'exercise_source_id'
  ) then
    raise exception 'Source-aware workout columns are missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workout_plan_exercises'::regclass
      and conname = 'workout_plan_exercises_source_shape'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.performed_sets'::regclass
      and conname = 'performed_sets_source_shape'
  ) then
    raise exception 'Source identity shape constraints are missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.workout_plan_exercises'::regclass
      and tgname = 'resolve_workout_plan_step_source_before_write'
      and not tgisinternal
  ) then
    raise exception 'Source snapshot trigger is missing';
  end if;

  if exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'resolve_workout_plan_step_source_before_write',
        'assert_workout_step_targets'
      )
      and (
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      )
  ) then
    raise exception 'Internal source-validation helper has browser EXECUTE';
  end if;

  if (select count(*) from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname in (
          'save_my_workout_plan_v2',
          'save_trainer_assigned_workout_plan_v2',
          'get_my_workout_plan_v2',
          'get_trainer_assigned_workout_plan_v2',
          'get_my_workout_session_v2',
          'start_personal_workout_v2',
          'save_my_performed_set_v2'
        )) <> 7 then
    raise exception 'One or more V2 workout RPCs are missing';
  end if;

  if exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'save_my_workout_plan_v2',
        'save_trainer_assigned_workout_plan_v2',
        'get_my_workout_plan_v2',
        'get_trainer_assigned_workout_plan_v2',
        'get_my_workout_session_v2',
        'start_personal_workout_v2',
        'save_my_performed_set_v2'
      )
      and not procedure.prosecdef
  ) then
    raise exception 'V2 workout RPC must be SECURITY DEFINER';
  end if;
end;
$$;

set local role anon;

do $$
begin
  begin
    perform public.save_my_workout_plan_v2(null, 'forbidden', null, null, null, '[]'::jsonb);
    raise exception 'Anon V2 save unexpectedly executed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
