-- A trainer needs to recover their own invite code even before the first
-- connection exists; direct table access remains prohibited by RLS.
create or replace function public.get_my_trainer_code()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select trainer_profiles.invite_code
  from public.trainer_profiles
  where trainer_profiles.user_id = (select auth.uid());
$$;

revoke all on function public.get_my_trainer_code() from public, anon;
grant execute on function public.get_my_trainer_code() to authenticated;
