-- Workout Engine V3, Slice 3A.3.1.
--
-- Session snapshots intentionally retain the resolved source identity on the
-- server so performed-set provenance survives source deletion. A client who
-- executes a trainer assignment must never receive the trainer's private
-- exercise UUID, including the nested exercise_snapshot.source_id field.
--
-- Keep the V1 response shape for existing clients, but route it through the
-- same server-side sanitisation boundary as V2/V3. No session data is changed.

create or replace function public.get_my_workout_session_v2(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'id', session.id, 'plan_id', session.plan_id, 'source_type', session.source_type,
    'title', session.title, 'status', session.status, 'started_at', session.started_at,
    'completed_at', session.completed_at, 'overall_rpe', session.overall_rpe, 'notes', session.notes,
    'plan_snapshot', case when session.source_type = 'trainer_assignment' then
      coalesce((
        select jsonb_agg(public.client_safe_workout_step_v3(step, true) order by ordinal)
        from jsonb_array_elements(session.plan_snapshot) with ordinality as snapshot(step, ordinal)
      ), '[]'::jsonb)
      else session.plan_snapshot
    end,
    'sets', coalesce(sets.items, '[]'::jsonb)
  ) into v_result
  from public.workout_sessions session
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', item.id, 'client_set_key', item.client_set_key, 'session_step_id', item.session_step_id,
      'exercise_name', item.exercise_name, 'set_number', item.set_number, 'reps', item.reps,
      'weight_kg', item.weight_kg, 'duration_seconds', item.duration_seconds,
      'distance_m', item.distance_m, 'rpe', item.rpe, 'is_completed', item.is_completed,
      'completed_at', item.completed_at, 'notes', item.notes
    ) order by item.completed_at, item.created_at) items
    from public.performed_sets item
    where item.workout_session_id = session.id and item.user_id = session.user_id
  ) sets on true
  where session.id = p_session_id and session.user_id = (select auth.uid());
  if v_result is null then raise exception 'Workout session not found' using errcode = 'P0002'; end if;
  return v_result;
end;
$$;

-- The legacy reader remains available with the exact V1 JSON shape. Delegating
-- to V2 removes only forbidden trainer-private identity fields and retains all
-- historical plan/actual values.
create or replace function public.get_my_workout_session(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.get_my_workout_session_v2(p_session_id);
end;
$$;

create or replace function public.get_my_active_workout_session_v3()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_session_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select id into v_session_id
  from public.workout_sessions
  where user_id = (select auth.uid()) and status = 'in_progress'
  order by started_at desc
  limit 1;

  if v_session_id is null then return null; end if;
  return public.get_my_workout_session_v3(v_session_id);
end;
$$;

-- Explicitly retain authenticated-only access for every public session-read
-- entry point. Internal sanitisation helpers remain non-callable by browser
-- roles under the previous V3 contract.
revoke all on function
  public.get_my_workout_session(uuid),
  public.get_my_active_workout_session(),
  public.get_my_workout_session_v2(uuid),
  public.get_my_workout_session_v3(uuid),
  public.get_my_active_workout_session_v3()
from public, anon;

grant execute on function
  public.get_my_workout_session(uuid),
  public.get_my_active_workout_session(),
  public.get_my_workout_session_v2(uuid),
  public.get_my_workout_session_v3(uuid),
  public.get_my_active_workout_session_v3()
to authenticated;
