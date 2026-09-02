-- Public-facing account details for Montage-style login.
-- Supabase Auth keeps the password and the hidden `<login>@flux.local` email.
-- The phone is private profile data only; it is not verified or used to sign in.

alter table public.profiles
  add column if not exists login text,
  add column if not exists phone_e164 text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_login_format_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_login_format_check
      check (login is null or login ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_phone_e164_format_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_phone_e164_format_check
      check (phone_e164 is null or phone_e164 ~ '^\+7[0-9]{10}$');
  end if;
end;
$$;

create unique index if not exists profiles_login_unique_idx
  on public.profiles (lower(login))
  where login is not null;

comment on column public.profiles.login is
  'User-facing unique login. Supabase Auth uses the matching hidden @flux.local address.';

comment on column public.profiles.phone_e164 is
  'Private unverified contact number in E.164 format. Not an authentication identity.';
