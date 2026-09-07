-- Closing an item keeps its history. Archiving only removes it from the
-- operational queue; neither the message nor its private attachments are deleted.

alter table public.feedback
  add column if not exists admin_reply text,
  add column if not exists replied_at timestamptz,
  add column if not exists reply_seen_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.feedback
  drop constraint if exists feedback_admin_reply_length_check;

alter table public.feedback
  add constraint feedback_admin_reply_length_check
  check (admin_reply is null or char_length(trim(admin_reply)) between 3 and 1200);

create index if not exists feedback_active_queue_idx
  on public.feedback (status, created_at desc)
  where archived_at is null;

create index if not exists feedback_user_unread_reply_idx
  on public.feedback (user_id, replied_at desc)
  where admin_reply is not null and reply_seen_at is null;

create or replace function public.resolve_feedback(p_feedback_id uuid, p_reply text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator role is required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_reply, ''))) < 3 then
    raise exception 'Reply is too short' using errcode = '23514';
  end if;

  update public.feedback
  set
    status = 'resolved',
    admin_reply = trim(p_reply),
    replied_at = now(),
    reply_seen_at = null
  where id = p_feedback_id and archived_at is null;
  return found;
end;
$$;

create or replace function public.archive_feedback(p_feedback_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator role is required' using errcode = '42501';
  end if;

  update public.feedback
  set archived_at = now()
  where id = p_feedback_id and status = 'resolved' and archived_at is null;
  return found;
end;
$$;

create or replace function public.restore_feedback(p_feedback_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator role is required' using errcode = '42501';
  end if;

  update public.feedback
  set archived_at = null
  where id = p_feedback_id and archived_at is not null;
  return found;
end;
$$;

create or replace function public.mark_feedback_replies_seen(p_feedback_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.feedback
  set reply_seen_at = now()
  where id = any(coalesce(p_feedback_ids, '{}'))
    and user_id = (select auth.uid())
    and admin_reply is not null
    and reply_seen_at is null;
end;
$$;

revoke all on function public.resolve_feedback(uuid, text) from public, anon;
grant execute on function public.resolve_feedback(uuid, text) to authenticated;
revoke all on function public.archive_feedback(uuid) from public, anon;
grant execute on function public.archive_feedback(uuid) to authenticated;
revoke all on function public.restore_feedback(uuid) from public, anon;
grant execute on function public.restore_feedback(uuid) to authenticated;
revoke all on function public.mark_feedback_replies_seen(uuid[]) from public, anon;
grant execute on function public.mark_feedback_replies_seen(uuid[]) to authenticated;
