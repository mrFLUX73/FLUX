-- Workout Engine V3, Slice 3A.3.3.2.
--
-- A checkpoint is a private, mutable execution cursor for one active workout.
-- It deliberately never changes the immutable session plan_snapshot and is
-- deleted transactionally after a performed set is persisted or a session is
-- completed. Browser roles cannot address the table directly.

create table public.workout_execution_checkpoints (
  workout_session_id uuid primary key,
  user_id uuid not null,
  session_step_id uuid not null,
  set_number smallint not null check (set_number between 1 and 1000),
  phase text not null check (phase in ('ready', 'active', 'paused', 'rest', 'next')),
  duration_accumulated_seconds integer not null default 0 check (duration_accumulated_seconds >= 0),
  duration_started_at timestamptz,
  duration_is_manual boolean not null default false,
  rest_ends_at timestamptz,
  rest_total_seconds integer check (rest_total_seconds is null or rest_total_seconds > 0),
  draft_reps integer check (draft_reps is null or draft_reps >= 0),
  draft_weight_kg numeric(8, 2) check (draft_weight_kg is null or draft_weight_kg >= 0),
  draft_duration_seconds integer check (draft_duration_seconds is null or draft_duration_seconds >= 0),
  draft_distance_m numeric(10, 2) check (draft_distance_m is null or draft_distance_m >= 0),
  draft_rpe numeric(3, 1) check (draft_rpe is null or draft_rpe between 1 and 10),
  draft_notes text check (draft_notes is null or char_length(draft_notes) <= 1000),
  client_set_key uuid not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((phase = 'rest') = (rest_ends_at is not null)),
  check ((phase = 'rest') = (rest_total_seconds is not null)),
  check (duration_started_at is null or phase = 'active'),
  foreign key (workout_session_id, user_id)
    references public.workout_sessions (id, user_id)
    on delete cascade
);

create index workout_execution_checkpoints_user_idx
  on public.workout_execution_checkpoints (user_id, updated_at desc);

alter table public.workout_execution_checkpoints enable row level security;
revoke all on table public.workout_execution_checkpoints from public, anon, authenticated;

create or replace function public.clear_workout_execution_checkpoint_after_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.workout_execution_checkpoints checkpoint
  where checkpoint.workout_session_id = new.workout_session_id
    and checkpoint.user_id = new.user_id
    and checkpoint.session_step_id = new.session_step_id
    and checkpoint.set_number = new.set_number;
  return new;
end;
$$;

drop trigger if exists performed_sets_clear_execution_checkpoint on public.performed_sets;
create trigger performed_sets_clear_execution_checkpoint
after insert or update on public.performed_sets
for each row execute function public.clear_workout_execution_checkpoint_after_set();

create or replace function public.clear_workout_execution_checkpoint_after_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'in_progress' and new.status = 'completed' then
    delete from public.workout_execution_checkpoints checkpoint
    where checkpoint.workout_session_id = new.id and checkpoint.user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists workout_sessions_clear_execution_checkpoint on public.workout_sessions;
create trigger workout_sessions_clear_execution_checkpoint
after update on public.workout_sessions
for each row execute function public.clear_workout_execution_checkpoint_after_completion();

create or replace function public.get_my_workout_execution_checkpoint(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_checkpoint public.workout_execution_checkpoints%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select checkpoint.* into v_checkpoint
  from public.workout_execution_checkpoints checkpoint
  join public.workout_sessions session
    on session.id = checkpoint.workout_session_id and session.user_id = checkpoint.user_id
  where checkpoint.workout_session_id = p_session_id
    and checkpoint.user_id = (select auth.uid())
    and session.status = 'in_progress';
  if not found then return null; end if;
  if exists (
    select 1 from public.performed_sets item
    where item.workout_session_id = v_checkpoint.workout_session_id
      and item.user_id = v_checkpoint.user_id
      and item.session_step_id = v_checkpoint.session_step_id
      and item.set_number = v_checkpoint.set_number
      and item.is_completed
  ) then
    return null;
  end if;
  return jsonb_build_object(
    'workout_session_id', v_checkpoint.workout_session_id,
    'session_step_id', v_checkpoint.session_step_id,
    'set_number', v_checkpoint.set_number,
    'phase', v_checkpoint.phase,
    'duration_accumulated_seconds', v_checkpoint.duration_accumulated_seconds,
    'duration_started_at', v_checkpoint.duration_started_at,
    'duration_is_manual', v_checkpoint.duration_is_manual,
    'rest_ends_at', v_checkpoint.rest_ends_at,
    'rest_total_seconds', v_checkpoint.rest_total_seconds,
    'draft_reps', v_checkpoint.draft_reps,
    'draft_weight_kg', v_checkpoint.draft_weight_kg,
    'draft_duration_seconds', v_checkpoint.draft_duration_seconds,
    'draft_distance_m', v_checkpoint.draft_distance_m,
    'draft_rpe', v_checkpoint.draft_rpe,
    'draft_notes', v_checkpoint.draft_notes,
    'client_set_key', v_checkpoint.client_set_key,
    'revision', v_checkpoint.revision,
    'updated_at', v_checkpoint.updated_at
  );
end;
$$;

create or replace function public.save_my_workout_execution_checkpoint(
  p_session_id uuid,
  p_session_step_id uuid,
  p_set_number smallint,
  p_phase text,
  p_duration_accumulated_seconds integer,
  p_duration_started_at timestamptz,
  p_duration_is_manual boolean,
  p_rest_ends_at timestamptz,
  p_rest_total_seconds integer,
  p_draft_reps integer,
  p_draft_weight_kg numeric,
  p_draft_duration_seconds integer,
  p_draft_distance_m numeric,
  p_draft_rpe numeric,
  p_draft_notes text,
  p_client_set_key uuid,
  p_revision integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_checkpoint public.workout_execution_checkpoints%rowtype;
  v_step jsonb;
  v_valid_set boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_phase not in ('ready', 'active', 'paused', 'rest', 'next')
     or p_duration_accumulated_seconds is null or p_duration_accumulated_seconds < 0
     or p_set_number is null or p_set_number < 1 or p_client_set_key is null then
    raise exception 'Invalid workout execution checkpoint' using errcode = '22023';
  end if;
  if (p_duration_started_at is not null and p_phase <> 'active')
     or (p_phase = 'rest') <> (p_rest_ends_at is not null)
     or (p_phase = 'rest') <> (p_rest_total_seconds is not null)
     or p_rest_total_seconds is not null and p_rest_total_seconds <= 0 then
    raise exception 'Invalid checkpoint timer state' using errcode = '22023';
  end if;
  if p_draft_reps is not null and p_draft_reps < 0
     or p_draft_weight_kg is not null and p_draft_weight_kg < 0
     or p_draft_duration_seconds is not null and p_draft_duration_seconds < 0
     or p_draft_distance_m is not null and p_draft_distance_m < 0
     or p_draft_rpe is not null and p_draft_rpe not between 1 and 10
     or p_draft_notes is not null and char_length(p_draft_notes) > 1000 then
    raise exception 'Invalid checkpoint draft values' using errcode = '22023';
  end if;

  select * into v_session from public.workout_sessions
  where id = p_session_id and user_id = (select auth.uid()) and status = 'in_progress'
  for update;
  if not found then raise exception 'Active workout session not found' using errcode = 'P0002'; end if;

  select step into v_step from jsonb_array_elements(v_session.plan_snapshot) step
  where step ->> 'step_id' = p_session_step_id::text;
  if v_step is null then raise exception 'Workout step does not belong to session' using errcode = '42501'; end if;
  select exists (
    select 1 from jsonb_array_elements(coalesce(v_step -> 'planned_sets', '[]'::jsonb)) planned
    where (planned ->> 'set_number')::smallint = p_set_number
  ) into v_valid_set;
  if not v_valid_set then
    v_valid_set := p_set_number <= coalesce((v_step ->> 'target_sets')::smallint, 0);
  end if;
  if not v_valid_set then raise exception 'Workout set does not belong to session snapshot' using errcode = '22023'; end if;
  if exists (
    select 1 from public.performed_sets item
    where item.workout_session_id = v_session.id and item.user_id = v_session.user_id
      and item.session_step_id = p_session_step_id and item.set_number = p_set_number and item.is_completed
  ) then
    raise exception 'Cannot checkpoint a saved workout set' using errcode = '55000';
  end if;

  select * into v_checkpoint from public.workout_execution_checkpoints
  where workout_session_id = v_session.id for update;
  if found then
    if p_revision is null or p_revision <> v_checkpoint.revision then
      raise exception 'Workout checkpoint is stale; reload the active workout' using errcode = '40001';
    end if;
    update public.workout_execution_checkpoints
    set session_step_id = p_session_step_id, set_number = p_set_number, phase = p_phase,
        duration_accumulated_seconds = p_duration_accumulated_seconds,
        duration_started_at = p_duration_started_at, duration_is_manual = coalesce(p_duration_is_manual, false),
        rest_ends_at = p_rest_ends_at, rest_total_seconds = p_rest_total_seconds,
        draft_reps = p_draft_reps, draft_weight_kg = p_draft_weight_kg,
        draft_duration_seconds = p_draft_duration_seconds, draft_distance_m = p_draft_distance_m,
        draft_rpe = p_draft_rpe, draft_notes = nullif(trim(coalesce(p_draft_notes, '')), ''),
        client_set_key = p_client_set_key, revision = revision + 1, updated_at = now()
    where workout_session_id = v_session.id
    returning * into v_checkpoint;
  else
    if p_revision is not null then raise exception 'Workout checkpoint is stale; reload the active workout' using errcode = '40001'; end if;
    insert into public.workout_execution_checkpoints (
      workout_session_id, user_id, session_step_id, set_number, phase,
      duration_accumulated_seconds, duration_started_at, duration_is_manual, rest_ends_at, rest_total_seconds,
      draft_reps, draft_weight_kg, draft_duration_seconds, draft_distance_m, draft_rpe,
      draft_notes, client_set_key
    ) values (
      v_session.id, v_session.user_id, p_session_step_id, p_set_number, p_phase,
      p_duration_accumulated_seconds, p_duration_started_at, coalesce(p_duration_is_manual, false), p_rest_ends_at, p_rest_total_seconds,
      p_draft_reps, p_draft_weight_kg, p_draft_duration_seconds, p_draft_distance_m, p_draft_rpe,
      nullif(trim(coalesce(p_draft_notes, '')), ''), p_client_set_key
    ) returning * into v_checkpoint;
  end if;
  return public.get_my_workout_execution_checkpoint(v_checkpoint.workout_session_id);
end;
$$;

create or replace function public.clear_my_workout_execution_checkpoint(
  p_session_id uuid,
  p_revision integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_session public.workout_sessions%rowtype; v_checkpoint public.workout_execution_checkpoints%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_session from public.workout_sessions
  where id = p_session_id and user_id = (select auth.uid()) and status = 'in_progress'
  for update;
  if not found then raise exception 'Active workout session not found' using errcode = 'P0002'; end if;
  select * into v_checkpoint from public.workout_execution_checkpoints where workout_session_id = v_session.id for update;
  if not found then return; end if;
  if p_revision is not null and p_revision <> v_checkpoint.revision then
    raise exception 'Workout checkpoint is stale; reload the active workout' using errcode = '40001';
  end if;
  delete from public.workout_execution_checkpoints where workout_session_id = v_session.id;
end;
$$;

revoke all on function public.clear_workout_execution_checkpoint_after_set() from public, anon, authenticated;
revoke all on function public.clear_workout_execution_checkpoint_after_completion() from public, anon, authenticated;
revoke all on function public.get_my_workout_execution_checkpoint(uuid),
  public.save_my_workout_execution_checkpoint(uuid,uuid,smallint,text,integer,timestamptz,boolean,timestamptz,integer,integer,numeric,integer,numeric,numeric,text,uuid,integer),
  public.clear_my_workout_execution_checkpoint(uuid,integer)
from public, anon;
grant execute on function public.get_my_workout_execution_checkpoint(uuid),
  public.save_my_workout_execution_checkpoint(uuid,uuid,smallint,text,integer,timestamptz,boolean,timestamptz,integer,integer,numeric,integer,numeric,numeric,text,uuid,integer),
  public.clear_my_workout_execution_checkpoint(uuid,integer)
to authenticated;
