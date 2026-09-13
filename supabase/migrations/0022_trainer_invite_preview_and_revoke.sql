-- Preview is deliberately read-only: opening an invite never creates a link.
create or replace function public.get_trainer_invite_preview(p_invite_code text)
returns table(trainer_name text, connection_state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requested_trainer_id uuid;
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

  if exists (
    select 1 from public.trainer_client_links links
    where links.trainer_id = requested_trainer_id
      and links.client_id = (select auth.uid())
      and links.status = 'active'
  ) then
    return query select profile.display_name, 'already_active'::text
    from public.profiles profile where profile.id = requested_trainer_id;
    return;
  end if;

  if exists (
    select 1 from public.trainer_client_links links
    where links.trainer_id = requested_trainer_id
      and links.client_id = (select auth.uid())
      and links.status = 'pending'
  ) then
    return query select profile.display_name, 'already_pending'::text
    from public.profiles profile where profile.id = requested_trainer_id;
    return;
  end if;

  if exists (
    select 1 from public.trainer_client_links links
    where links.client_id = (select auth.uid()) and links.status = 'active'
  ) then
    return query select profile.display_name, 'active_other'::text
    from public.profiles profile where profile.id = requested_trainer_id;
    return;
  end if;

  return query select profile.display_name, 'available'::text
  from public.profiles profile where profile.id = requested_trainer_id;
end;
$$;

-- Keep the row and its messages as history; active-only RPCs automatically
-- remove both parties' access to chat and client overview after this update.
create or replace function public.revoke_trainer_connection(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.trainer_client_links
  set status = 'revoked', updated_at = now()
  where id = p_link_id
    and status = 'active'
    and (trainer_id = (select auth.uid()) or client_id = (select auth.uid()));

  if not found then
    raise exception 'Active trainer connection not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.get_trainer_invite_preview(text), public.revoke_trainer_connection(uuid) from public, anon;
grant execute on function public.get_trainer_invite_preview(text), public.revoke_trainer_connection(uuid) to authenticated;
