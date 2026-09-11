-- Messenger MVP: keep the two existing data models, but expose a compact,
-- authorised trainer inbox and private server-originated realtime signals.
-- Direct reads from trainer_messages remain forbidden.

create or replace function public.get_my_trainer_inbox()
returns table(
  link_id uuid,
  status text,
  created_at timestamptz,
  responded_at timestamptz,
  trainer_id uuid,
  trainer_name text,
  trainer_code text,
  client_id uuid,
  client_name text,
  last_message_id uuid,
  last_message_body text,
  last_message_at timestamptz,
  last_message_author_id uuid,
  unread_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    links.id, links.status, links.created_at, links.responded_at,
    links.trainer_id, trainer.display_name, trainer_profile.invite_code,
    links.client_id, client.display_name,
    latest.id, latest.body, latest.created_at, latest.author_id,
    coalesce(unread.count, 0)::integer
  from public.trainer_client_links links
  join public.profiles trainer on trainer.id = links.trainer_id
  join public.profiles client on client.id = links.client_id
  left join public.trainer_profiles trainer_profile on trainer_profile.user_id = links.trainer_id
  left join lateral (
    select message.id, message.body, message.created_at, message.author_id
    from public.trainer_messages message
    where message.link_id = links.id
    order by message.created_at desc, message.id desc
    limit 1
  ) latest on true
  left join lateral (
    select count(*)::integer as count
    from public.trainer_messages message
    where message.link_id = links.id
      and message.author_id <> (select auth.uid())
      and message.seen_at is null
  ) unread on true
  where links.status = 'active'
    and (links.trainer_id = (select auth.uid()) or links.client_id = (select auth.uid()))
  order by latest.created_at desc nulls last, links.responded_at desc nulls last, links.created_at desc;
$$;

revoke all on function public.get_my_trainer_inbox() from public, anon;
grant execute on function public.get_my_trainer_inbox() to authenticated;

-- Browser clients receive private Broadcast events only. They still have no
-- SELECT/INSERT access to trainer_messages; database triggers publish events.
create or replace function public.can_receive_trainer_realtime(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare link_id uuid;
begin
  if p_topic !~ '^trainer-chat:[0-9a-fA-F-]{36}$' then return false; end if;
  link_id := substring(p_topic from 'trainer-chat:([0-9a-fA-F-]{36})')::uuid;
  return public.is_active_trainer_link(link_id);
end;
$$;

revoke all on function public.can_receive_trainer_realtime(text) from public, anon;
grant execute on function public.can_receive_trainer_realtime(text) to authenticated;

drop policy if exists flux_messenger_realtime_receive on realtime.messages;
create policy flux_messenger_realtime_receive
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and (
    realtime.topic() = ('trainer-user:' || (select auth.uid())::text)
    or public.can_receive_trainer_realtime(realtime.topic())
    or realtime.topic() = ('feedback-user:' || (select auth.uid())::text)
    or (realtime.topic() = 'feedback-admin' and public.is_admin())
  )
);

create or replace function public.broadcast_trainer_message_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare link_row public.trainer_client_links%rowtype;
begin
  select * into link_row from public.trainer_client_links where id = new.link_id;
  if link_row.id is null then return new; end if;
  perform realtime.broadcast_changes('trainer-chat:' || new.link_id::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  perform realtime.broadcast_changes('trainer-user:' || link_row.trainer_id::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  perform realtime.broadcast_changes('trainer-user:' || link_row.client_id::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  return new;
end;
$$;

create or replace function public.broadcast_feedback_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  owner_id := coalesce(new.user_id, old.user_id);
  if owner_id is not null then
    perform realtime.broadcast_changes('feedback-user:' || owner_id::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  end if;
  perform realtime.broadcast_changes('feedback-admin', tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  return new;
end;
$$;

create or replace function public.broadcast_feedback_message_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; item_id uuid := coalesce(new.feedback_id, old.feedback_id);
begin
  select user_id into owner_id from public.feedback where id = item_id;
  if owner_id is not null then
    perform realtime.broadcast_changes('feedback-user:' || owner_id::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  end if;
  perform realtime.broadcast_changes('feedback-admin', tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  return new;
end;
$$;

drop trigger if exists trainer_messages_realtime_broadcast on public.trainer_messages;
create trigger trainer_messages_realtime_broadcast after insert or update on public.trainer_messages
for each row execute function public.broadcast_trainer_message_change();
drop trigger if exists feedback_realtime_broadcast on public.feedback;
create trigger feedback_realtime_broadcast after insert or update on public.feedback
for each row execute function public.broadcast_feedback_change();
drop trigger if exists feedback_messages_realtime_broadcast on public.feedback_messages;
create trigger feedback_messages_realtime_broadcast after insert or update on public.feedback_messages
for each row execute function public.broadcast_feedback_message_change();

revoke all on function public.broadcast_trainer_message_change(), public.broadcast_feedback_change(), public.broadcast_feedback_message_change() from public, anon, authenticated;
