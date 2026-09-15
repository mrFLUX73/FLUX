-- The insert branch of the first notes RPC must finish immediately. Otherwise
-- PostgreSQL continues into the update branch and reports a false "not found".
create or replace function public.save_trainer_client_note(p_link_id uuid, p_note_id uuid default null, p_body text default '')
returns table(id uuid, body text, created_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := public.trainer_workspace_client_id(p_link_id);
begin
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Note must contain 1 to 2000 characters' using errcode = '22023';
  end if;

  if p_note_id is null then
    return query insert into public.trainer_client_notes (trainer_id, client_id, body)
      values ((select auth.uid()), v_client_id, trim(p_body))
      returning trainer_client_notes.id, trainer_client_notes.body, trainer_client_notes.created_at, trainer_client_notes.updated_at;
    return;
  end if;

  update public.trainer_client_notes note set body = trim(p_body)
  where note.id = p_note_id and note.trainer_id = (select auth.uid()) and note.client_id = v_client_id;
  if not found then raise exception 'Note not found' using errcode = 'P0002'; end if;

  return query select note.id, note.body, note.created_at, note.updated_at
  from public.trainer_client_notes note
  where note.id = p_note_id and note.trainer_id = (select auth.uid()) and note.client_id = v_client_id;
end;
$$;

revoke all on function public.save_trainer_client_note(uuid, uuid, text) from public, anon;
grant execute on function public.save_trainer_client_note(uuid, uuid, text) to authenticated;
