-- Roles are stored separately from profiles: a login name must never grant
-- privileges by itself. The first administrator is assigned manually after
-- their account is registered.

create table if not exists public.user_roles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'trainer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_roles_set_updated_at
before update on public.user_roles
for each row execute function public.set_updated_at();

insert into public.user_roles (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

create or replace function public.create_default_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger profiles_create_default_user_role
after insert on public.profiles
for each row execute function public.create_default_user_role();

alter table public.user_roles enable row level security;

create policy user_roles_select_own
on public.user_roles for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  category text not null check (category in ('bug', 'idea', 'question', 'praise')),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  message text not null check (char_length(trim(message)) between 3 and 4000),
  screen text,
  app_version text,
  reporter_display_name text,
  reporter_login text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index feedback_status_created_idx on public.feedback (status, created_at desc);
create index feedback_user_created_idx on public.feedback (user_id, created_at desc);

create trigger feedback_set_updated_at
before update on public.feedback
for each row execute function public.set_updated_at();

alter table public.feedback enable row level security;

create policy feedback_select_own_or_admin
on public.feedback for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));

create or replace function public.create_feedback(
  p_category text,
  p_message text,
  p_screen text default null,
  p_app_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_feedback_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_category not in ('bug', 'idea', 'question', 'praise') then
    raise exception 'Unsupported feedback category' using errcode = '23514';
  end if;
  if char_length(trim(coalesce(p_message, ''))) < 3 then
    raise exception 'Feedback message is too short' using errcode = '23514';
  end if;

  insert into public.feedback (
    user_id, category, message, screen, app_version, reporter_display_name, reporter_login
  )
  select
    profile.id,
    p_category,
    trim(p_message),
    nullif(trim(coalesce(p_screen, '')), ''),
    nullif(trim(coalesce(p_app_version, '')), ''),
    profile.display_name,
    profile.login
  from public.profiles as profile
  where profile.id = current_user_id
  returning id into new_feedback_id;

  if new_feedback_id is null then
    raise exception 'Profile not found' using errcode = '23503';
  end if;
  return new_feedback_id;
end;
$$;

create or replace function public.set_feedback_status(p_feedback_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator role is required' using errcode = '42501';
  end if;
  if p_status not in ('new', 'in_progress', 'resolved') then
    raise exception 'Unsupported feedback status' using errcode = '23514';
  end if;
  update public.feedback set status = p_status where id = p_feedback_id;
  return found;
end;
$$;

revoke all on function public.create_feedback(text, text, text, text) from public, anon;
grant execute on function public.create_feedback(text, text, text, text) to authenticated;
revoke all on function public.set_feedback_status(uuid, text) from public, anon;
grant execute on function public.set_feedback_status(uuid, text) to authenticated;
