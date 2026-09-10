-- The header bell must open the conversation that actually has an unread
-- message, including for a trainer with more than one active client.

create or replace function public.get_my_unread_trainer_link_ids()
returns table(link_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select message.link_id
  from public.trainer_messages message
  join public.trainer_client_links link on link.id = message.link_id
  where message.seen_at is null
    and message.author_id <> (select auth.uid())
    and link.status = 'active'
    and (link.trainer_id = (select auth.uid()) or link.client_id = (select auth.uid()))
  group by message.link_id
  order by max(message.created_at) desc;
$$;

revoke all on function public.get_my_unread_trainer_link_ids() from public, anon;
grant execute on function public.get_my_unread_trainer_link_ids() to authenticated;
