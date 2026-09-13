-- Keep the product rule in the database: a client may have many historical
-- requests, but never more than one accepted trainer connection.
create unique index if not exists trainer_client_links_one_active_trainer_per_client_idx
  on public.trainer_client_links (client_id)
  where status = 'active';

-- Return an explicit result for idempotent requests instead of moving an
-- accepted connection back to pending. The only input remains the invite
-- code; trainer_id and client_id are always derived server-side.
drop function if exists public.request_trainer_connection(text);
create function public.request_trainer_connection(p_invite_code text)
returns table(link_id uuid, status text, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_trainer_id uuid;
  existing_link_id uuid;
  existing_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select trainer_profiles.user_id into requested_trainer_id
  from public.trainer_profiles
  join public.user_roles on user_roles.user_id = trainer_profiles.user_id
  where trainer_profiles.invite_code = upper(trim(p_invite_code))
    and user_roles.role = 'trainer';

  if requested_trainer_id is null then
    raise exception 'Trainer code not found' using errcode = 'P0002';
  end if;

  if requested_trainer_id = (select auth.uid()) then
    raise exception 'Cannot connect to your own trainer account' using errcode = 'P0001';
  end if;

  select links.id, links.status into existing_link_id, existing_status
  from public.trainer_client_links links
  where links.trainer_id = requested_trainer_id
    and links.client_id = (select auth.uid())
  for update;

  if existing_link_id is not null then
    if existing_status = 'active' then
      return query select existing_link_id, existing_status, 'already_active'::text;
      return;
    end if;

    if existing_status = 'pending' then
      return query select existing_link_id, existing_status, 'already_pending'::text;
      return;
    end if;

    update public.trainer_client_links
    set status = 'pending', responded_at = null, updated_at = now()
    where id = existing_link_id;
    return query select existing_link_id, 'pending'::text, 'created'::text;
    return;
  end if;

  if exists (
    select 1
    from public.trainer_client_links links
    where links.client_id = (select auth.uid())
      and links.status = 'active'
      and links.trainer_id <> requested_trainer_id
  ) then
    raise exception 'Client already has an active trainer' using errcode = 'P0001';
  end if;

  insert into public.trainer_client_links (trainer_id, client_id, status, responded_at)
  values (requested_trainer_id, (select auth.uid()), 'pending', null)
  returning id into existing_link_id;

  return query select existing_link_id, 'pending'::text, 'created'::text;
end;
$$;

-- The index above is the final guard for concurrent accepts. This check gives
-- the trainer a controlled business error before that database guard is hit.
create or replace function public.respond_to_trainer_connection(p_link_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_client_id uuid;
begin
  if not exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'trainer'
  ) then
    raise exception 'Trainer role is required' using errcode = '42501';
  end if;

  select links.client_id into requested_client_id
  from public.trainer_client_links links
  where links.id = p_link_id
    and links.trainer_id = (select auth.uid())
    and links.status = 'pending'
  for update;

  if requested_client_id is null then
    raise exception 'Connection request not found' using errcode = 'P0002';
  end if;

  if coalesce(p_accept, false) and exists (
    select 1
    from public.trainer_client_links links
    where links.client_id = requested_client_id
      and links.status = 'active'
      and links.id <> p_link_id
  ) then
    raise exception 'Client already has an active trainer' using errcode = 'P0001';
  end if;

  update public.trainer_client_links
  set status = case when coalesce(p_accept, false) then 'active' else 'declined' end,
      responded_at = now()
  where id = p_link_id;
end;
$$;

revoke all on function public.request_trainer_connection(text) from public, anon;
revoke all on function public.respond_to_trainer_connection(uuid, boolean) from public, anon;
grant execute on function public.request_trainer_connection(text), public.respond_to_trainer_connection(uuid, boolean) to authenticated;
