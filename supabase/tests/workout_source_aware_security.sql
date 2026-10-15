-- Workout Editor V2 Slice 2C behavioural security contract.
--
-- Run only through a privileged maintenance connection against the linked
-- project after the Slice 2C migration. Every created row belongs to registry
-- verified synthetic accounts and this entire script ends in ROLLBACK.

begin;

create temporary table slice2c_context (
  trainer_id uuid not null,
  other_trainer_id uuid not null,
  client_id uuid not null,
  link_id uuid not null,
  personal_exercise_id uuid not null,
  trainer_exercise_id uuid not null,
  other_trainer_exercise_id uuid not null,
  catalog_a_id uuid not null,
  catalog_b_id uuid not null,
  catalog_draft_id uuid not null,
  catalog_archived_id uuid not null,
  personal_plan_id uuid,
  personal_catalog_step_id uuid,
  personal_private_step_id uuid,
  trainer_plan_id uuid,
  trainer_private_step_id uuid
) on commit drop;

grant select, update on slice2c_context to authenticated;

do $$
declare
  v_trainer uuid;
  v_other_trainer uuid;
  v_client uuid;
  v_link uuid;
  v_muscle uuid := gen_random_uuid();
  v_catalog_a uuid := gen_random_uuid();
  v_catalog_b uuid := gen_random_uuid();
  v_catalog_draft uuid := gen_random_uuid();
  v_catalog_archived uuid := gen_random_uuid();
  v_personal_exercise uuid := gen_random_uuid();
  v_trainer_exercise uuid := gen_random_uuid();
  v_other_trainer_exercise uuid := gen_random_uuid();
  v_marker text := replace(gen_random_uuid()::text, '-', '');
begin
  select account.user_id into v_trainer
  from public.test_accounts account
  join auth.users user_account on user_account.id = account.user_id
  where account.purpose = 'trainer' and lower(user_account.email) = 'flux-test-trainer@flux.local';
  select account.user_id into v_other_trainer
  from public.test_accounts account
  join auth.users user_account on user_account.id = account.user_id
  where account.purpose = 'other_trainer' and lower(user_account.email) = 'flux-other-trainer@flux.local';
  select account.user_id into v_client
  from public.test_accounts account
  join auth.users user_account on user_account.id = account.user_id
  where account.purpose = 'client' and lower(user_account.email) = 'flux-workout-e2e-client@flux.local';
  if v_trainer is null or v_other_trainer is null or v_client is null then
    raise exception 'Required dedicated synthetic personas are not registered';
  end if;
  if exists (
    select 1 from public.trainer_client_links
    where trainer_id = v_trainer and client_id = v_client
  ) or exists (
    select 1 from public.trainer_client_links
    where client_id = v_client and status = 'active'
  ) then
    raise exception 'Dedicated workout E2E client is not isolated; refusing to alter its link state';
  end if;

  insert into public.muscle_groups (id, slug, name_ru)
  values (v_muscle, 'slice2c-' || substr(v_marker, 1, 16), 'Slice 2C test');
  insert into public.exercise_catalog (
    id, slug, name, measurement_type, technique_description,
    primary_muscle_group_id, publication_status
  ) values
    (v_catalog_a, 'slice2c-a-' || substr(v_marker, 1, 12), 'Slice 2C catalog A', 'reps', 'A technique.', v_muscle, 'published'),
    (v_catalog_b, 'slice2c-b-' || substr(v_marker, 1, 12), 'Slice 2C catalog B', 'reps', 'B technique.', v_muscle, 'published'),
    (v_catalog_draft, 'slice2c-d-' || substr(v_marker, 1, 12), 'Slice 2C draft', 'reps', 'Draft technique.', v_muscle, 'draft'),
    (v_catalog_archived, 'slice2c-z-' || substr(v_marker, 1, 12), 'Slice 2C archived', 'reps', 'Archived technique.', v_muscle, 'archived');
  insert into public.exercise_catalog_muscle_groups (catalog_exercise_id, muscle_group_id, role)
  values
    (v_catalog_a, v_muscle, 'primary'), (v_catalog_b, v_muscle, 'primary'),
    (v_catalog_draft, v_muscle, 'primary'), (v_catalog_archived, v_muscle, 'primary');

  insert into public.exercises (id, user_id, name, measurement_type)
  values
    (v_personal_exercise, v_client, 'Slice 2C personal ' || v_marker, 'reps'),
    (v_trainer_exercise, v_trainer, 'Slice 2C trainer ' || v_marker, 'reps'),
    (v_other_trainer_exercise, v_other_trainer, 'Slice 2C other trainer ' || v_marker, 'reps');
  insert into public.trainer_client_links (trainer_id, client_id, status, responded_at)
  values (v_trainer, v_client, 'active', now())
  returning id into v_link;

  insert into slice2c_context (
    trainer_id, other_trainer_id, client_id, link_id, personal_exercise_id,
    trainer_exercise_id, other_trainer_exercise_id, catalog_a_id, catalog_b_id,
    catalog_draft_id, catalog_archived_id
  ) values (
    v_trainer, v_other_trainer, v_client, v_link, v_personal_exercise,
    v_trainer_exercise, v_other_trainer_exercise, v_catalog_a, v_catalog_b,
    v_catalog_draft, v_catalog_archived
  );
end;
$$;

set constraints all immediate;
set local role authenticated;

-- Personal catalog/private sources, archived/draft rejection, forged step ID,
-- V1 save/start/set compatibility, and initial snapshot creation.
do $$
declare
  c slice2c_context%rowtype;
  v_plan jsonb;
  v_v1_plan jsonb;
  v_v1_session jsonb;
  v_step jsonb;
begin
  select * into c from slice2c_context;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  v_plan := public.save_my_workout_plan_v2(
    null, 'Slice 2C personal', null, 'beginner', 20::smallint,
    jsonb_build_array(
      jsonb_build_object('exercise_source_kind', 'catalog', 'exercise_source_id', c.catalog_a_id,
        'target_sets', 2, 'target_reps_min', 8, 'rest_seconds', 30),
      jsonb_build_object('exercise_source_kind', 'personal', 'exercise_source_id', c.personal_exercise_id,
        'target_sets', 2, 'target_reps_min', 8, 'rest_seconds', 30)
    )
  );
  update slice2c_context
  set personal_plan_id = (v_plan ->> 'id')::uuid,
      personal_catalog_step_id = (v_plan -> 'exercises' -> 0 ->> 'step_id')::uuid,
      personal_private_step_id = (v_plan -> 'exercises' -> 1 ->> 'step_id')::uuid;
  if v_plan -> 'exercises' -> 0 -> 'exercise_snapshot' ->> 'source_id' <> c.catalog_a_id::text
     or v_plan -> 'exercises' -> 1 -> 'exercise_snapshot' ->> 'source_id' <> c.personal_exercise_id::text then
    raise exception 'V2 personal source snapshot was not derived server-side';
  end if;

  begin
    perform public.save_my_workout_plan_v2(null, 'Draft rejected', null, null, null,
      jsonb_build_array(jsonb_build_object('exercise_source_kind', 'catalog', 'exercise_source_id', c.catalog_draft_id,
        'target_sets', 1, 'target_reps_min', 8, 'rest_seconds', 30)));
    raise exception 'Draft catalog source unexpectedly accepted';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.save_my_workout_plan_v2(null, 'Archived rejected', null, null, null,
      jsonb_build_array(jsonb_build_object('exercise_source_kind', 'catalog', 'exercise_source_id', c.catalog_archived_id,
        'target_sets', 1, 'target_reps_min', 8, 'rest_seconds', 30)));
    raise exception 'Archived catalog source unexpectedly accepted';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.save_my_workout_plan_v2((select personal_plan_id from slice2c_context), 'Forged step', null, null, null,
      jsonb_build_array(jsonb_build_object('step_id', gen_random_uuid(), 'exercise_source_kind', 'catalog',
        'exercise_source_id', c.catalog_a_id, 'target_sets', 1, 'target_reps_min', 8, 'rest_seconds', 30)));
    raise exception 'Forged workout step id unexpectedly accepted';
  exception when sqlstate '42501' then null;
  end;

  v_v1_plan := public.save_my_workout_plan(
    null, 'Slice 2C V1', null, 'beginner', 20::smallint,
    jsonb_build_array(jsonb_build_object('exercise_id', c.personal_exercise_id,
      'target_sets', 1, 'target_reps_min', 8, 'rest_seconds', 30))
  );
  v_v1_session := public.start_personal_workout((v_v1_plan ->> 'id')::uuid);
  v_step := v_v1_session -> 'plan_snapshot' -> 0;
  perform public.save_my_performed_set(
    (v_v1_session ->> 'id')::uuid, gen_random_uuid(), (v_step ->> 'step_id')::uuid,
    1::smallint, 8::integer, null::numeric, null::integer, null::numeric,
    null::numeric, null::text
  );
  perform public.complete_my_workout_session((v_v1_session ->> 'id')::uuid, null, null);
end;
$$;

reset role;

-- Direct source/snapshot mutation is rejected by the trigger even for a
-- privileged caller with a valid synthetic auth identity. Archive catalog A
-- only after it was selected; unchanged source survives the later V2 save.
do $$
declare c slice2c_context%rowtype;
begin
  select * into c from slice2c_context;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  begin
    update public.workout_plan_exercises
    set exercise_snapshot = jsonb_build_object('name', 'forged')
    where id = c.personal_catalog_step_id;
    raise exception 'Snapshot mutation unexpectedly accepted';
  exception when sqlstate '42501' then null;
  end;
  update public.exercise_catalog set publication_status = 'archived' where id = c.catalog_a_id;
end;
$$;

set local role authenticated;

-- An unchanged archived step is preserved. A later source change produces a
-- new plan snapshot while the active session retains its original identity.
do $$
declare
  c slice2c_context%rowtype;
  v_plan jsonb;
  v_session jsonb;
  v_raw_snapshot jsonb;
  v_set jsonb;
begin
  select * into c from slice2c_context;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  v_plan := public.save_my_workout_plan_v2(
    c.personal_plan_id, 'Slice 2C personal', null, 'beginner', 20::smallint,
    jsonb_build_array(
      jsonb_build_object('step_id', c.personal_catalog_step_id, 'exercise_source_kind', 'catalog',
        'exercise_source_id', c.catalog_a_id, 'target_sets', 2, 'target_reps_min', 8, 'rest_seconds', 30),
      jsonb_build_object('step_id', c.personal_private_step_id, 'exercise_source_kind', 'personal',
        'exercise_source_id', c.personal_exercise_id, 'target_sets', 2, 'target_reps_min', 8, 'rest_seconds', 30)
    )
  );
  if v_plan -> 'exercises' -> 0 -> 'exercise_snapshot' ->> 'source_id' <> c.catalog_a_id::text then
    raise exception 'Unchanged archived step was not preserved';
  end if;
  v_session := public.start_personal_workout_v2(c.personal_plan_id);
  v_plan := public.save_my_workout_plan_v2(
    c.personal_plan_id, 'Slice 2C personal renamed', null, 'beginner', 20::smallint,
    jsonb_build_array(
      jsonb_build_object('step_id', c.personal_catalog_step_id, 'exercise_source_kind', 'catalog',
        'exercise_source_id', c.catalog_b_id, 'target_sets', 2, 'target_reps_min', 8, 'rest_seconds', 30),
      jsonb_build_object('step_id', c.personal_private_step_id, 'exercise_source_kind', 'personal',
        'exercise_source_id', c.personal_exercise_id, 'target_sets', 2, 'target_reps_min', 8, 'rest_seconds', 30)
    )
  );
  if v_plan -> 'exercises' -> 0 -> 'exercise_snapshot' ->> 'source_id' <> c.catalog_b_id::text then
    raise exception 'Changed source did not create a new plan snapshot';
  end if;
  select plan_snapshot into v_raw_snapshot from public.workout_sessions where id = (v_session ->> 'id')::uuid;
  if v_raw_snapshot -> 0 ->> 'exercise_source_id' <> c.catalog_a_id::text then
    raise exception 'Active session snapshot changed after plan edit';
  end if;
  v_set := public.save_my_performed_set_v2(
    (v_session ->> 'id')::uuid, gen_random_uuid(), c.personal_catalog_step_id,
    1::smallint, 8::integer, null::numeric, null::integer, null::numeric,
    null::numeric, null::text
  );
  if not exists (
    select 1 from public.performed_sets
    where id = (v_set ->> 'id')::uuid and exercise_source_kind = 'catalog'
      and exercise_source_id = c.catalog_a_id and exercise_id is null
  ) then
    raise exception 'Performed-set source identity was not derived from session snapshot';
  end if;
  perform public.complete_my_workout_session((v_session ->> 'id')::uuid, null, null);
end;
$$;

-- Trainer-only sources and client disclosure boundary. Revoking the link
-- blocks trainer management but does not remove the client-owned assignment.
do $$
declare c slice2c_context%rowtype; v_plan jsonb;
begin
  select * into c from slice2c_context;
  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  v_plan := public.save_trainer_assigned_workout_plan_v2(
    c.link_id, null, 'Slice 2C trainer', null, 'beginner', 20::smallint,
    jsonb_build_array(
      jsonb_build_object('exercise_source_kind', 'catalog', 'exercise_source_id', c.catalog_b_id,
        'target_sets', 1, 'target_reps_min', 8, 'rest_seconds', 30),
      jsonb_build_object('exercise_source_kind', 'trainer_private', 'exercise_source_id', c.trainer_exercise_id,
        'target_sets', 1, 'target_reps_min', 8, 'rest_seconds', 30)
    )
  );
  update slice2c_context
  set trainer_plan_id = (v_plan ->> 'id')::uuid,
      trainer_private_step_id = (v_plan -> 'exercises' -> 1 ->> 'step_id')::uuid;
  if v_plan -> 'exercises' -> 1 ->> 'exercise_source_id' <> c.trainer_exercise_id::text then
    raise exception 'Trainer editor did not receive its own private source identity';
  end if;
  begin
    perform public.save_trainer_assigned_workout_plan_v2(
      c.link_id, null, 'Foreign private rejected', null, null, null,
      jsonb_build_array(jsonb_build_object('exercise_source_kind', 'trainer_private',
        'exercise_source_id', c.other_trainer_exercise_id, 'target_sets', 1,
        'target_reps_min', 8, 'rest_seconds', 30))
    );
    raise exception 'Foreign trainer private source unexpectedly accepted';
  exception when sqlstate '42501' then null;
  end;
end;
$$;

reset role;
update public.trainer_client_links
set status = 'revoked'
where id = (select link_id from slice2c_context);
set local role authenticated;

do $$
declare c slice2c_context%rowtype; v_plan jsonb; v_session jsonb;
begin
  select * into c from slice2c_context;
  perform set_config('request.jwt.claim.sub', c.trainer_id::text, true);
  begin
    perform public.get_trainer_assigned_workout_plan_v2(c.link_id, c.trainer_plan_id);
    raise exception 'Revoked trainer link unexpectedly retained management access';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub', c.client_id::text, true);
  v_plan := public.get_my_workout_plan_v2(c.trainer_plan_id);
  if v_plan -> 'exercises' -> 1 ->> 'exercise_source_id' is not null then
    raise exception 'Trainer private source id leaked to client';
  end if;
  v_session := public.start_personal_workout_v2(c.trainer_plan_id);
  if v_session ->> 'source_type' <> 'trainer_assignment'
     or v_session -> 'plan_snapshot' -> 1 ? 'exercise_source_id' then
    raise exception 'Client assignment execution did not preserve the V2 disclosure boundary';
  end if;
  perform public.complete_my_workout_session((v_session ->> 'id')::uuid, null, null);
end;
$$;

rollback;
