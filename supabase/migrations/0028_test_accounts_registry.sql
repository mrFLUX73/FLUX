-- Internal registry for deterministic FLUX test fixtures. This is deliberately
-- separate from profiles: a user must never be able to mark their own account
-- as a test account through the public API.
create table if not exists public.test_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  purpose text not null check (purpose in ('trainer', 'client', 'empty_client', 'other_trainer')),
  created_at timestamptz not null default now()
);

alter table public.test_accounts enable row level security;

-- There are intentionally no authenticated policies. Registry membership is
-- managed only by the local service-role fixture tool.
revoke all on table public.test_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.test_accounts to service_role;

comment on table public.test_accounts is
  'Server-only registry of synthetic accounts used by FLUX E2E fixtures. Never expose through frontend queries.';
