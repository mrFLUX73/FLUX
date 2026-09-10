-- Trainer mode is an opt-in capability of the existing account. A connection
-- is never created by a visible profile id: the client must use a trainer's
-- code and the trainer then explicitly accepts it.

create table if not exists public.trainer_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  invite_code text not null unique check (invite_code ~ '^TR-[A-Z0-9]{8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trainer_client_links (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (trainer_id, client_id),
  check (trainer_id <> client_id)
);

create index if not exists trainer_client_links_trainer_status_idx
  on public.trainer_client_links (trainer_id, status, created_at desc);
create index if not exists trainer_client_links_client_status_idx
  on public.trainer_client_links (client_id, status, created_at desc);

drop trigger if exists trainer_profiles_set_updated_at on public.trainer_profiles;
create trigger trainer_profiles_set_updated_at before update on public.trainer_profiles
for each row execute function public.set_updated_at();
drop trigger if exists trainer_client_links_set_updated_at on public.trainer_client_links;
create trigger trainer_client_links_set_updated_at before update on public.trainer_client_links
for each row execute function public.set_updated_at();

alter table public.trainer_profiles enable row level security;
alter table public.trainer_client_links enable row level security;

-- All access is through narrowly scoped RPCs below. This keeps private names
-- and client relationships out of ordinary table reads.
revoke all on table public.trainer_profiles, public.trainer_client_links from anon, authenticated;

create or replace function public.make_trainer_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate text;
begin
  loop
    candidate := 'TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.trainer_profiles where invite_code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.set_my_account_role(p_role text)
returns table(role text, trainer_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_role text;
  code text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_role not in ('user', 'trainer') then raise exception 'Unsupported role' using errcode = '22023'; end if;

  select user_roles.role into current_role from public.user_roles where user_id = (select auth.uid()) for update;
  if current_role = 'admin' then
    return query select current_role, null::text;
    return;
  end if;

  update public.user_roles set role = p_role where user_id = (select auth.uid());
  if p_role = 'trainer' then
    insert into public.trainer_profiles (user_id, invite_code)
    values ((select auth.uid()), public.make_trainer_code())
    on conflict (user_id) do nothing;
    select invite_code into code from public.trainer_profiles where user_id = (select auth.uid());
  end if;
  return query select p_role, code;
end;
$$;

create or replace function public.get_my_trainer_hub()
returns table(
  link_id uuid,
  status text,
  created_at timestamptz,
  trainer_id uuid,
  trainer_name text,
  trainer_code text,
  client_id uuid,
  client_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    links.id, links.status, links.created_at,
    links.trainer_id, trainer.display_name, trainer_profile.invite_code,
    links.client_id, client.display_name
  from public.trainer_client_links links
  join public.profiles trainer on trainer.id = links.trainer_id
  join public.profiles client on client.id = links.client_id
  left join public.trainer_profiles trainer_profile on trainer_profile.user_id = links.trainer_id
  where links.trainer_id = (select auth.uid()) or links.client_id = (select auth.uid())
  order by links.created_at desc;
$$;

create or replace function public.request_trainer_connection(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  trainer uuid;
  link_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select trainer_profiles.user_id into trainer
  from public.trainer_profiles
  join public.user_roles on user_roles.user_id = trainer_profiles.user_id
  where trainer_profiles.invite_code = upper(trim(p_invite_code)) and user_roles.role = 'trainer';
  if trainer is null then raise exception 'Trainer code not found' using errcode = 'P0002'; end if;

  insert into public.trainer_client_links (trainer_id, client_id, status, responded_at)
  values (trainer, (select auth.uid()), 'pending', null)
  on conflict (trainer_id, client_id) do update
    set status = 'pending', responded_at = null, updated_at = now()
  returning id into link_id;
  return link_id;
end;
$$;

create or replace function public.respond_to_trainer_connection(p_link_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role = 'trainer') then
    raise exception 'Trainer role is required' using errcode = '42501';
  end if;
  update public.trainer_client_links
  set status = case when p_accept then 'active' else 'declined' end, responded_at = now()
  where id = p_link_id and trainer_id = (select auth.uid()) and status = 'pending';
  if not found then raise exception 'Connection request not found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.make_trainer_code() from public, anon, authenticated;
revoke all on function public.set_my_account_role(text) from public, anon;
revoke all on function public.get_my_trainer_hub() from public, anon;
revoke all on function public.request_trainer_connection(text) from public, anon;
revoke all on function public.respond_to_trainer_connection(uuid, boolean) from public, anon;
grant execute on function public.set_my_account_role(text), public.get_my_trainer_hub(), public.request_trainer_connection(text), public.respond_to_trainer_connection(uuid, boolean) to authenticated;
