-- A feedback item stays a task; this table is its private, two-way conversation.
-- Text is tiny compared with attachments and is retained with the archived item.

create table if not exists public.feedback_messages (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  is_support boolean not null default false,
  body text not null check (char_length(trim(body)) between 1 and 1200),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

create index if not exists feedback_messages_feedback_created_idx
  on public.feedback_messages (feedback_id, created_at);

create index if not exists feedback_messages_unread_idx
  on public.feedback_messages (feedback_id, created_at desc)
  where seen_at is null;

alter table public.feedback_messages enable row level security;

drop policy if exists feedback_messages_select_author_or_admin on public.feedback_messages;
create policy feedback_messages_select_author_or_admin
on public.feedback_messages for select to authenticated
using (
  exists (
    select 1 from public.feedback
    where feedback.id = feedback_messages.feedback_id
      and (feedback.user_id = (select auth.uid()) or (select public.is_admin()))
  )
);

-- Preserve the first-generation one-way replies as the first support message.
insert into public.feedback_messages (feedback_id, is_support, body, created_at, seen_at)
select feedback.id, true, feedback.admin_reply, coalesce(feedback.replied_at, feedback.updated_at), feedback.reply_seen_at
from public.feedback as feedback
where feedback.admin_reply is not null
  and not exists (
    select 1 from public.feedback_messages as message
    where message.feedback_id = feedback.id
      and message.is_support = true
      and message.body = feedback.admin_reply
  );

create or replace function public.send_feedback_message(p_feedback_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  feedback_owner uuid;
  sender_is_support boolean := public.is_admin();
  new_message_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_body, ''))) < 1 then
    raise exception 'Message is too short' using errcode = '23514';
  end if;

  select user_id into feedback_owner from public.feedback where id = p_feedback_id;
  if feedback_owner is null then
    raise exception 'Feedback not found' using errcode = 'P0002';
  end if;
  if feedback_owner <> current_user_id and not sender_is_support then
    raise exception 'Feedback author or administrator required' using errcode = '42501';
  end if;

  insert into public.feedback_messages (feedback_id, author_id, is_support, body)
  values (p_feedback_id, current_user_id, sender_is_support, trim(p_body))
  returning id into new_message_id;

  update public.feedback
  set
    status = case when status in ('new', 'resolved') then 'in_progress' else status end,
    archived_at = null
  where id = p_feedback_id;

  return new_message_id;
end;
$$;

create or replace function public.resolve_feedback(p_feedback_id uuid, p_reply text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if not public.is_admin() then
    raise exception 'Administrator role is required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_reply, ''))) < 3 then
    raise exception 'Reply is too short' using errcode = '23514';
  end if;

  update public.feedback
  set status = 'resolved', admin_reply = trim(p_reply), replied_at = now(), reply_seen_at = null
  where id = p_feedback_id and archived_at is null;
  if not found then return false; end if;

  insert into public.feedback_messages (feedback_id, author_id, is_support, body)
  values (p_feedback_id, current_user_id, true, trim(p_reply));
  return true;
end;
$$;

create or replace function public.mark_feedback_messages_seen(p_message_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.feedback_messages as message
  set seen_at = now()
  where message.id = any(coalesce(p_message_ids, '{}'))
    and message.seen_at is null
    and exists (
      select 1 from public.feedback
      where feedback.id = message.feedback_id
        and (
          (feedback.user_id = (select auth.uid()) and message.is_support)
          or ((select public.is_admin()) and not message.is_support)
        )
    );
end;
$$;

create or replace function public.count_unread_feedback_messages()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.feedback_messages as message
  join public.feedback on feedback.id = message.feedback_id
  where message.seen_at is null
    and feedback.user_id = (select auth.uid())
    and message.is_support = true;
$$;

revoke all on function public.send_feedback_message(uuid, text) from public, anon;
grant execute on function public.send_feedback_message(uuid, text) to authenticated;
revoke all on function public.mark_feedback_messages_seen(uuid[]) from public, anon;
grant execute on function public.mark_feedback_messages_seen(uuid[]) to authenticated;
revoke all on function public.count_unread_feedback_messages() from public, anon;
grant execute on function public.count_unread_feedback_messages() to authenticated;
