-- Trainer-assigned plans reuse the existing plan and Workout Engine model.
-- The client remains the execution owner; the trainer is only an authenticated
-- assignment author while the exact trainer-client link is active.

alter table public.workout_plans
  add column if not exists plan_origin text not null default 'personal'
    check (plan_origin in ('personal', 'trainer_assigned')),
  -- Links are archived by status, not deleted. RESTRICT keeps an assignment's
  -- required historical references intact and cannot violate the shape check.
  add column if not exists assigned_by_trainer_id uuid references public.profiles(id) on delete restrict,
  add column if not exists assignment_link_id uuid references public.trainer_client_links(id) on delete restrict,
  add constraint workout_plans_assignment_shape check (
    (plan_origin = 'personal' and assigned_by_trainer_id is null and assignment_link_id is null)
    or (plan_origin = 'trainer_assigned' and assigned_by_trainer_id is not null and assignment_link_id is not null)
  );

create index if not exists workout_plans_assignment_author_idx
  on public.workout_plans (assigned_by_trainer_id, assignment_link_id, updated_at desc)
  where plan_origin = 'trainer_assigned';

-- A trainer step may reference only an exercise owned by that trainer. The
-- source reference is deliberately nullable: an assigned step continues to
-- work from its snapshot after the trainer deletes the source exercise.
alter table public.workout_plan_exercises
  add column if not exists exercise_snapshot jsonb;
alter table public.workout_plan_exercises
  drop constraint if exists workout_plan_exercises_exercise_id_user_id_fkey;
alter table public.workout_plan_exercises
  drop constraint if exists workout_plan_exercises_exercise_id_fkey;
alter table public.workout_plan_exercises
  alter column exercise_id drop not null,
  add constraint workout_plan_exercises_exercise_id_fkey
  foreign key (exercise_id) references public.exercises(id) on delete set null;

-- Performed sets are client-owned. An assigned plan may use a trainer-owned
-- source exercise, so this old same-user FK cannot represent that relationship.
-- The session snapshot supplies the authoritative exercise contract instead.
alter table public.performed_sets
  drop constraint if exists performed_sets_exercise_id_user_id_fkey;

-- The Workout Engine writes sets only through save_my_performed_set. Removing
-- the old same-user FK must not create a second, weaker browser write path.
revoke all on table public.performed_sets from authenticated;
grant select on table public.performed_sets to authenticated;

-- A set is valid only when its exact session snapshot authorizes the step.
-- Trainer assignments deliberately store exercise_id as NULL: the snapshot is
-- durable even when the trainer later removes their source exercise.
create or replace function public.validate_performed_set_references()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_session public.workout_sessions%rowtype; v_snapshot_step jsonb; v_snapshot_exercise_id uuid; v_live_step public.workout_plan_exercises%rowtype;
begin
  select * into v_session from public.workout_sessions where id = new.workout_session_id and user_id = new.user_id;
  if not found then raise exception 'Workout session must belong to the set owner' using errcode = '23514'; end if;
  if new.session_step_id is null then raise exception 'Performed set must reference a session snapshot step' using errcode = '23514'; end if;
  select step into v_snapshot_step from jsonb_array_elements(v_session.plan_snapshot) step where step ->> 'step_id' = new.session_step_id::text;
  if v_snapshot_step is null then raise exception 'Performed set step does not belong to the workout session snapshot' using errcode = '23514'; end if;
  v_snapshot_exercise_id := nullif(v_snapshot_step ->> 'exercise_id', '')::uuid;
  if v_session.source_type = 'trainer_assignment' then
    if new.exercise_id is not null then raise exception 'Trainer-assigned performed sets cannot reference a live exercise' using errcode = '23514'; end if;
  elsif new.exercise_id is distinct from v_snapshot_exercise_id then
    raise exception 'Performed set exercise does not match its session snapshot' using errcode = '23514';
  end if;
  if new.plan_exercise_id is not null then
    select * into v_live_step from public.workout_plan_exercises where id = new.plan_exercise_id and user_id = new.user_id;
    if not found or v_live_step.id is distinct from new.session_step_id or v_live_step.plan_id is distinct from v_session.plan_id then
      raise exception 'Live plan step does not match its workout session' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists validate_performed_set_references_before_write on public.performed_sets;
create trigger validate_performed_set_references_before_write
before insert or update of workout_session_id, user_id, exercise_id, plan_exercise_id, session_step_id
on public.performed_sets for each row execute function public.validate_performed_set_references();

-- Direct client mutations remain available only for personal plans/steps.
drop policy if exists workout_plans_manage_own on public.workout_plans;
create policy workout_plans_manage_personal on public.workout_plans for all to authenticated
using (user_id = (select auth.uid()) and plan_origin = 'personal')
with check (user_id = (select auth.uid()) and plan_origin = 'personal');
drop policy if exists workout_plan_exercises_manage_own on public.workout_plan_exercises;
create policy workout_plan_exercises_manage_personal on public.workout_plan_exercises for all to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.workout_plans p where p.id = plan_id and p.user_id = (select auth.uid()) and p.plan_origin = 'personal'
))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.workout_plans p where p.id = plan_id and p.user_id = (select auth.uid()) and p.plan_origin = 'personal'
) and exists (
  select 1 from public.exercises e where e.id = exercise_id and e.user_id = (select auth.uid())
));

create or replace function public.trainer_assignment_client_id(p_link_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_client_id uuid;
begin
  select client_id into v_client_id from public.trainer_client_links
  where id = p_link_id and trainer_id = (select auth.uid()) and status = 'active';
  if v_client_id is null then raise exception 'Active trainer connection required' using errcode = '42501'; end if;
  return v_client_id;
end; $$;

create or replace function public.get_trainer_assigned_workout_plans(p_link_id uuid)
returns table(id uuid, name text, description text, estimated_duration_minutes smallint, exercise_count integer, is_active boolean, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with client as (select public.trainer_assignment_client_id(p_link_id) id)
  select p.id, p.name, p.description, p.estimated_duration_minutes, count(s.id)::integer, p.is_active, p.updated_at
  from public.workout_plans p join client c on c.id = p.user_id
  left join public.workout_plan_exercises s on s.plan_id = p.id
  where p.plan_origin = 'trainer_assigned' and p.assigned_by_trainer_id = (select auth.uid()) and p.assignment_link_id = p_link_id
  group by p.id order by p.updated_at desc;
$$;

create or replace function public.archive_trainer_assigned_workout_plan(p_link_id uuid,p_plan_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_client uuid := public.trainer_assignment_client_id(p_link_id); begin
  update public.workout_plans set is_active=false where id=p_plan_id and user_id=v_client and plan_origin='trainer_assigned' and assigned_by_trainer_id=(select auth.uid()) and assignment_link_id=p_link_id;
  if not found then raise exception 'Assigned workout plan not found' using errcode='P0002'; end if;
end; $$;

revoke all on function public.trainer_assignment_client_id(uuid), public.get_trainer_assigned_workout_plans(uuid), public.archive_trainer_assigned_workout_plan(uuid,uuid) from public, anon;
grant execute on function public.get_trainer_assigned_workout_plans(uuid), public.archive_trainer_assigned_workout_plan(uuid,uuid) to authenticated;

-- The original personal editor RPCs predate plan_origin. Keep their public
-- names, but make the personal-only boundary explicit so a client cannot use
-- them to mutate an assignment through RPC.
create or replace function public.save_my_workout_plan(
  p_plan_id uuid default null, p_name text default null, p_description text default null,
  p_level text default null, p_estimated_duration_minutes smallint default null, p_steps jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_plan public.workout_plans%rowtype; v_step jsonb; v_position integer := 0; v_exercise public.exercises%rowtype; v_sets smallint; v_rest integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 120 or p_description is not null and char_length(p_description) > 3000 or p_level is not null and p_level not in ('beginner','intermediate','advanced') or p_estimated_duration_minutes is not null and p_estimated_duration_minutes not between 1 and 600 or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then raise exception 'Invalid workout plan' using errcode = '22023'; end if;
  if p_plan_id is null then
    insert into public.workout_plans (user_id,name,description,level,estimated_duration_minutes,plan_origin) values (v_user,trim(p_name),nullif(trim(coalesce(p_description,'')),''),p_level,p_estimated_duration_minutes,'personal') returning * into v_plan;
  else
    update public.workout_plans set name=trim(p_name), description=nullif(trim(coalesce(p_description,'')),''), level=p_level, estimated_duration_minutes=p_estimated_duration_minutes where id=p_plan_id and user_id=v_user and plan_origin='personal' returning * into v_plan;
    if not found then raise exception 'Personal workout plan not found' using errcode = 'P0002'; end if;
    delete from public.workout_plan_exercises where plan_id=v_plan.id and user_id=v_user;
  end if;
  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_position := v_position + 1;
    if (v_step ->> 'exercise_id') is null then raise exception 'Exercise is required' using errcode = '22023'; end if;
    select * into v_exercise from public.exercises where id=(v_step ->> 'exercise_id')::uuid and user_id=v_user;
    if not found then raise exception 'Exercise not found' using errcode = 'P0002'; end if;
    v_sets := coalesce((v_step ->> 'target_sets')::smallint,1); v_rest := coalesce((v_step ->> 'rest_seconds')::integer,60);
    if v_sets not between 1 and 100 or v_rest not between 0 and 3600 or (v_exercise.measurement_type='reps' and coalesce((v_step ->> 'target_reps_min')::smallint,0)<1) or (v_exercise.measurement_type='duration' and coalesce((v_step ->> 'target_duration_seconds')::integer,0)<1) or (v_exercise.measurement_type='distance' and coalesce((v_step ->> 'target_distance_m')::numeric,0)<1 and coalesce((v_step ->> 'target_duration_seconds')::integer,0)<1) then raise exception 'Invalid exercise settings' using errcode = '22023'; end if;
    insert into public.workout_plan_exercises (plan_id,user_id,exercise_id,day_number,sort_order,target_sets,target_reps_min,target_reps_max,target_duration_seconds,target_distance_m,target_weight_kg,rest_seconds,notes) values (v_plan.id,v_user,v_exercise.id,1,v_position,v_sets,case when v_exercise.measurement_type='reps' then (v_step ->> 'target_reps_min')::smallint end,case when v_exercise.measurement_type='reps' then nullif(v_step ->> 'target_reps_max','')::smallint end,case when v_exercise.measurement_type in ('duration','distance') then nullif(v_step ->> 'target_duration_seconds','')::integer end,case when v_exercise.measurement_type='distance' then nullif(v_step ->> 'target_distance_m','')::numeric end,case when v_exercise.measurement_type='reps' then nullif(v_step ->> 'target_weight_kg','')::numeric end,v_rest,nullif(trim(coalesce(v_step ->> 'notes','')),''));
  end loop;
  return public.get_my_workout_plan(v_plan.id);
end; $$;

create or replace function public.duplicate_my_workout_plan(p_plan_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_source public.workout_plans%rowtype; v_copy public.workout_plans%rowtype;
begin
  select * into v_source from public.workout_plans where id=p_plan_id and user_id=(select auth.uid()) and plan_origin='personal';
  if not found then raise exception 'Personal workout plan not found' using errcode='P0002'; end if;
  insert into public.workout_plans(user_id,name,description,goal,level,estimated_duration_minutes,is_active,plan_origin) values((select auth.uid()),left('Копия · ' || v_source.name,120),v_source.description,v_source.goal,v_source.level,v_source.estimated_duration_minutes,true,'personal') returning * into v_copy;
  insert into public.workout_plan_exercises(plan_id,user_id,exercise_id,day_number,sort_order,target_sets,target_reps_min,target_reps_max,target_duration_seconds,target_distance_m,target_weight_kg,rest_seconds,notes) select v_copy.id,user_id,exercise_id,day_number,sort_order,target_sets,target_reps_min,target_reps_max,target_duration_seconds,target_distance_m,target_weight_kg,rest_seconds,notes from public.workout_plan_exercises where plan_id=v_source.id and user_id=(select auth.uid());
  return public.get_my_workout_plan(v_copy.id);
end; $$;

create or replace function public.archive_my_workout_plan(p_plan_id uuid) returns void language plpgsql security definer set search_path = '' as $$ begin
  update public.workout_plans set is_active=false where id=p_plan_id and user_id=(select auth.uid()) and plan_origin='personal'; if not found then raise exception 'Personal workout plan not found' using errcode='P0002'; end if;
end; $$;

create or replace function public.delete_my_workout_plan(p_plan_id uuid) returns void language plpgsql security definer set search_path = '' as $$ begin
  if exists(select 1 from public.workout_sessions where user_id=(select auth.uid()) and plan_id=p_plan_id and status='in_progress') then raise exception 'Finish the active workout before deleting this plan' using errcode='55000'; end if;
  delete from public.workout_plans where id=p_plan_id and user_id=(select auth.uid()) and plan_origin='personal'; if not found then raise exception 'Personal workout plan not found' using errcode='P0002'; end if;
end; $$;

-- Assigned-plan management resolves the client only from an active link. No
-- arbitrary client UUID is accepted by these entry points.
create or replace function public.get_trainer_assigned_workout_plan(p_link_id uuid, p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_client uuid := public.trainer_assignment_client_id(p_link_id); v_result jsonb;
begin
  select jsonb_build_object('id',plan.id,'name',plan.name,'description',plan.description,'level',plan.level,'estimated_duration_minutes',plan.estimated_duration_minutes,'is_active',plan.is_active,'plan_origin',plan.plan_origin,'assigned_by_trainer_id',plan.assigned_by_trainer_id,'exercises',coalesce(steps.items,'[]'::jsonb)) into v_result
  from public.workout_plans plan left join lateral (
    select jsonb_agg(jsonb_build_object('step_id',step.id,'exercise_id',step.exercise_id,'name',step.exercise_snapshot->>'name','instructions',step.exercise_snapshot->>'instructions','measurement_type',step.exercise_snapshot->>'measurement_type','day_number',step.day_number,'sort_order',step.sort_order,'target_sets',step.target_sets,'target_reps_min',step.target_reps_min,'target_reps_max',step.target_reps_max,'target_duration_seconds',step.target_duration_seconds,'target_distance_m',step.target_distance_m,'target_weight_kg',step.target_weight_kg,'rest_seconds',step.rest_seconds,'notes',step.notes) order by step.day_number,step.sort_order) items from public.workout_plan_exercises step where step.plan_id=plan.id and step.user_id=v_client
  ) steps on true where plan.id=p_plan_id and plan.user_id=v_client and plan.plan_origin='trainer_assigned' and plan.assigned_by_trainer_id=(select auth.uid()) and plan.assignment_link_id=p_link_id;
  if v_result is null then raise exception 'Assigned workout plan not found' using errcode='P0002'; end if; return v_result;
end; $$;

create or replace function public.delete_trainer_assigned_workout_plan(p_link_id uuid,p_plan_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_client uuid := public.trainer_assignment_client_id(p_link_id); begin
  delete from public.workout_plans where id=p_plan_id and user_id=v_client and plan_origin='trainer_assigned' and assigned_by_trainer_id=(select auth.uid()) and assignment_link_id=p_link_id;
  if not found then raise exception 'Assigned workout plan not found' using errcode='P0002'; end if;
end; $$;

create or replace function public.save_trainer_assigned_workout_plan(
  p_link_id uuid, p_plan_id uuid default null, p_name text default null, p_description text default null,
  p_level text default null, p_estimated_duration_minutes smallint default null, p_steps jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_client uuid := public.trainer_assignment_client_id(p_link_id); v_plan uuid; v_step jsonb; v_position integer := 0; v_exercise public.exercises%rowtype; v_sets smallint; v_rest integer;
begin
  if char_length(trim(coalesce(p_name,''))) not between 1 and 120 or p_description is not null and char_length(p_description)>3000 or p_level is not null and p_level not in ('beginner','intermediate','advanced') or p_estimated_duration_minutes is not null and p_estimated_duration_minutes not between 1 and 600 or jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps)=0 then raise exception 'Invalid workout plan' using errcode='22023'; end if;
  if p_plan_id is null then
    insert into public.workout_plans(user_id,name,description,level,estimated_duration_minutes,plan_origin,assigned_by_trainer_id,assignment_link_id) values(v_client,trim(p_name),nullif(trim(coalesce(p_description,'')),''),p_level,p_estimated_duration_minutes,'trainer_assigned',(select auth.uid()),p_link_id) returning id into v_plan;
  else
    update public.workout_plans set name=trim(p_name),description=nullif(trim(coalesce(p_description,'')),''),level=p_level,estimated_duration_minutes=p_estimated_duration_minutes where id=p_plan_id and user_id=v_client and plan_origin='trainer_assigned' and assigned_by_trainer_id=(select auth.uid()) and assignment_link_id=p_link_id returning id into v_plan;
    if v_plan is null then raise exception 'Assigned workout plan not found' using errcode='P0002'; end if;
    delete from public.workout_plan_exercises where plan_id=v_plan and user_id=v_client;
  end if;
  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_position:=v_position+1;
    if (v_step->>'exercise_id') is null then raise exception 'Exercise is required' using errcode='22023'; end if;
    select * into v_exercise from public.exercises where id=(v_step->>'exercise_id')::uuid and user_id=(select auth.uid());
    if not found then raise exception 'Trainer exercise not found' using errcode='42501'; end if;
    v_sets:=coalesce((v_step->>'target_sets')::smallint,1); v_rest:=coalesce((v_step->>'rest_seconds')::integer,60);
    if v_sets not between 1 and 100 or v_rest not between 0 and 3600 or (v_exercise.measurement_type='reps' and coalesce((v_step->>'target_reps_min')::smallint,0)<1) or (v_exercise.measurement_type='duration' and coalesce((v_step->>'target_duration_seconds')::integer,0)<1) or (v_exercise.measurement_type='distance' and coalesce((v_step->>'target_distance_m')::numeric,0)<1 and coalesce((v_step->>'target_duration_seconds')::integer,0)<1) then raise exception 'Invalid exercise settings' using errcode='22023'; end if;
    insert into public.workout_plan_exercises(plan_id,user_id,exercise_id,exercise_snapshot,day_number,sort_order,target_sets,target_reps_min,target_reps_max,target_duration_seconds,target_distance_m,target_weight_kg,rest_seconds,notes) values(v_plan,v_client,v_exercise.id,jsonb_build_object('name',v_exercise.name,'instructions',v_exercise.instructions,'measurement_type',v_exercise.measurement_type),1,v_position,v_sets,case when v_exercise.measurement_type='reps' then (v_step->>'target_reps_min')::smallint end,case when v_exercise.measurement_type='reps' then nullif(v_step->>'target_reps_max','')::smallint end,case when v_exercise.measurement_type in ('duration','distance') then nullif(v_step->>'target_duration_seconds','')::integer end,case when v_exercise.measurement_type='distance' then nullif(v_step->>'target_distance_m','')::numeric end,case when v_exercise.measurement_type='reps' then nullif(v_step->>'target_weight_kg','')::numeric end,v_rest,nullif(trim(coalesce(v_step->>'notes','')),''));
  end loop;
  return v_plan;
end; $$;

-- Client reads are ownership-scoped, not link-scoped: an assignment remains
-- visible and runnable after the trainer connection ends. Its step metadata
-- comes only from the immutable assignment snapshot.
drop function public.get_my_workout_plans();
create function public.get_my_workout_plans()
returns table(id uuid,name text,description text,level text,estimated_duration_minutes smallint,exercise_count integer,is_active boolean,updated_at timestamptz,plan_origin text,assigned_by_trainer_id uuid,trainer_name text)
language sql stable security definer set search_path = '' as $$
  select plan.id,plan.name,plan.description,plan.level,plan.estimated_duration_minutes,count(step.id)::integer,plan.is_active,plan.updated_at,plan.plan_origin,plan.assigned_by_trainer_id,trainer.display_name
  from public.workout_plans plan
  left join public.workout_plan_exercises step on step.plan_id=plan.id and step.user_id=plan.user_id
  left join public.profiles trainer on trainer.id=plan.assigned_by_trainer_id
  where plan.user_id=(select auth.uid()) group by plan.id,trainer.display_name order by plan.is_active desc,plan.updated_at desc;
$$;

create or replace function public.get_my_workout_plan(p_plan_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  select jsonb_build_object('id',plan.id,'name',plan.name,'description',plan.description,'level',plan.level,'estimated_duration_minutes',plan.estimated_duration_minutes,'is_active',plan.is_active,'plan_origin',plan.plan_origin,'assigned_by_trainer_id',plan.assigned_by_trainer_id,'trainer_name',trainer.display_name,'exercises',coalesce(steps.items,'[]'::jsonb)) into v_result
  from public.workout_plans plan left join public.profiles trainer on trainer.id=plan.assigned_by_trainer_id left join lateral (
    select jsonb_agg(jsonb_build_object('step_id',step.id,'exercise_id',step.exercise_id,'name',case when plan.plan_origin='trainer_assigned' then step.exercise_snapshot->>'name' else exercise.name end,'instructions',case when plan.plan_origin='trainer_assigned' then step.exercise_snapshot->>'instructions' else exercise.instructions end,'measurement_type',case when plan.plan_origin='trainer_assigned' then step.exercise_snapshot->>'measurement_type' else exercise.measurement_type end,'day_number',step.day_number,'sort_order',step.sort_order,'target_sets',step.target_sets,'target_reps_min',step.target_reps_min,'target_reps_max',step.target_reps_max,'target_duration_seconds',step.target_duration_seconds,'target_distance_m',step.target_distance_m,'target_weight_kg',step.target_weight_kg,'rest_seconds',step.rest_seconds,'notes',step.notes) order by step.day_number,step.sort_order) items
    from public.workout_plan_exercises step left join public.exercises exercise on exercise.id=step.exercise_id and exercise.user_id=plan.user_id
    where step.plan_id=plan.id and step.user_id=plan.user_id and (plan.plan_origin='trainer_assigned' and step.exercise_snapshot is not null or plan.plan_origin='personal' and exercise.id is not null)
  ) steps on true where plan.id=p_plan_id and plan.user_id=(select auth.uid());
  if v_result is null then raise exception 'Workout plan not found' using errcode='P0002'; end if; return v_result;
end; $$;

create or replace function public.start_personal_workout(p_plan_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_snapshot jsonb; v_plan public.workout_plans%rowtype; v_session public.workout_sessions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_session from public.workout_sessions where user_id=v_user and status='in_progress' for update; if found then return public.get_my_workout_session(v_session.id); end if;
  select * into v_plan from public.workout_plans where id=p_plan_id and user_id=v_user and is_active; if not found then raise exception 'Active workout plan not found' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('step_id',step.id,'exercise_id',step.exercise_id,'name',case when v_plan.plan_origin='trainer_assigned' then step.exercise_snapshot->>'name' else exercise.name end,'instructions',case when v_plan.plan_origin='trainer_assigned' then step.exercise_snapshot->>'instructions' else exercise.instructions end,'measurement_type',case when v_plan.plan_origin='trainer_assigned' then step.exercise_snapshot->>'measurement_type' else exercise.measurement_type end,'day_number',step.day_number,'sort_order',step.sort_order,'target_sets',step.target_sets,'target_reps_min',step.target_reps_min,'target_reps_max',step.target_reps_max,'target_duration_seconds',step.target_duration_seconds,'target_distance_m',step.target_distance_m,'target_weight_kg',step.target_weight_kg,'rest_seconds',step.rest_seconds,'notes',step.notes) order by step.day_number,step.sort_order),'[]'::jsonb) into v_snapshot from public.workout_plan_exercises step left join public.exercises exercise on exercise.id=step.exercise_id and exercise.user_id=v_user where step.plan_id=v_plan.id and step.user_id=v_user and (v_plan.plan_origin='trainer_assigned' and step.exercise_snapshot is not null or v_plan.plan_origin='personal' and exercise.id is not null);
  if jsonb_array_length(v_snapshot)=0 then raise exception 'Workout plan has no exercises' using errcode='23514'; end if;
  insert into public.workout_sessions(user_id,plan_id,source_type,title,status,plan_snapshot) values(v_user,v_plan.id,case when v_plan.plan_origin='trainer_assigned' then 'trainer_assignment' else 'personal_plan' end,v_plan.name,'in_progress',v_snapshot) returning * into v_session;
  return public.get_my_workout_session(v_session.id);
end; $$;

create or replace function public.save_my_performed_set(p_session_id uuid,p_client_set_key uuid,p_session_step_id uuid,p_set_number smallint,p_reps integer default null,p_weight_kg numeric default null,p_duration_seconds integer default null,p_distance_m numeric default null,p_rpe numeric default null,p_notes text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.workout_sessions%rowtype; v_step jsonb; v_exercise_id uuid := null; v_live_step_id uuid; v_result jsonb;
begin
  select * into v_session from public.workout_sessions where id=p_session_id and user_id=(select auth.uid()) and status='in_progress' for update; if not found then raise exception 'Active workout session not found' using errcode='P0002'; end if;
  if p_client_set_key is null then raise exception 'Client set key is required' using errcode='22023'; end if;
  select step into v_step from jsonb_array_elements(v_session.plan_snapshot) step where step->>'step_id'=p_session_step_id::text; if v_step is null then raise exception 'Workout step does not belong to session' using errcode='42501'; end if;
  if p_set_number<1 or p_set_number>coalesce((v_step->>'target_sets')::smallint,100) then raise exception 'Invalid set number' using errcode='22023'; end if;
  if v_session.source_type='personal_plan' then select id into v_exercise_id from public.exercises where id=(v_step->>'exercise_id')::uuid and user_id=v_session.user_id; end if;
  select id into v_live_step_id from public.workout_plan_exercises where id=p_session_step_id and user_id=v_session.user_id;
  insert into public.performed_sets(workout_session_id,user_id,exercise_id,plan_exercise_id,session_step_id,client_set_key,exercise_name,set_number,reps,weight_kg,duration_seconds,distance_m,rpe,is_completed,completed_at,notes) values(v_session.id,v_session.user_id,v_exercise_id,v_live_step_id,p_session_step_id,p_client_set_key,v_step->>'name',p_set_number,p_reps,p_weight_kg,p_duration_seconds,p_distance_m,p_rpe,true,now(),nullif(trim(coalesce(p_notes,'')),'')) on conflict (workout_session_id,client_set_key) where client_set_key is not null do update set reps=excluded.reps,weight_kg=excluded.weight_kg,duration_seconds=excluded.duration_seconds,distance_m=excluded.distance_m,rpe=excluded.rpe,notes=excluded.notes,completed_at=excluded.completed_at returning jsonb_build_object('id',id,'client_set_key',client_set_key,'session_step_id',session_step_id,'exercise_name',exercise_name,'set_number',set_number,'reps',reps,'weight_kg',weight_kg,'duration_seconds',duration_seconds,'distance_m',distance_m,'rpe',rpe,'is_completed',is_completed,'completed_at',completed_at,'notes',notes) into v_result;
  return v_result;
end; $$;

revoke all on function public.get_trainer_assigned_workout_plan(uuid,uuid), public.delete_trainer_assigned_workout_plan(uuid,uuid) from public, anon;
grant execute on function public.get_trainer_assigned_workout_plan(uuid,uuid), public.delete_trainer_assigned_workout_plan(uuid,uuid) to authenticated;
revoke all on function public.get_my_workout_plans() from public, anon;
grant execute on function public.get_my_workout_plans() to authenticated;
revoke all on function public.save_trainer_assigned_workout_plan(uuid,uuid,text,text,text,smallint,jsonb), public.validate_performed_set_references() from public, anon;
grant execute on function public.save_trainer_assigned_workout_plan(uuid,uuid,text,text,text,smallint,jsonb) to authenticated;
revoke all on function public.validate_performed_set_references() from authenticated;
