-- Private text-only communication and a narrow client overview for an active
-- trainer relationship. Neither side receives unrestricted table access.

create table if not exists public.trainer_messages (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.trainer_client_links (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

create index if not exists trainer_messages_link_created_idx on public.trainer_messages (link_id, created_at);
create index if not exists trainer_messages_unread_idx on public.trainer_messages (link_id, created_at desc) where seen_at is null;

alter table public.trainer_messages enable row level security;
revoke all on table public.trainer_messages from anon, authenticated;

create or replace function public.is_active_trainer_link(p_link_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trainer_client_links
    where id = p_link_id
      and status = 'active'
      and ((trainer_id = (select auth.uid())) or (client_id = (select auth.uid())))
  );
$$;

create or replace function public.get_trainer_messages(p_link_id uuid)
returns table(id uuid, body text, author_id uuid, created_at timestamptz, seen_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_trainer_link(p_link_id) then
    raise exception 'Active trainer connection required' using errcode = '42501';
  end if;
  return query
    select message.id, message.body, message.author_id, message.created_at, message.seen_at
    from public.trainer_messages message
    where message.link_id = p_link_id
    order by message.created_at asc;
end;
$$;

create or replace function public.send_trainer_message(p_link_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare message_id uuid;
begin
  if not public.is_active_trainer_link(p_link_id) then
    raise exception 'Active trainer connection required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_body, ''))) < 1 then
    raise exception 'Message is empty' using errcode = '23514';
  end if;
  insert into public.trainer_messages (link_id, author_id, body)
  values (p_link_id, (select auth.uid()), trim(p_body))
  returning id into message_id;
  return message_id;
end;
$$;

create or replace function public.mark_trainer_messages_seen(p_message_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.trainer_messages message
  set seen_at = now()
  from public.trainer_client_links link
  where message.id = any(coalesce(p_message_ids, '{}'))
    and message.link_id = link.id
    and message.seen_at is null
    and message.author_id <> (select auth.uid())
    and link.status = 'active'
    and (link.trainer_id = (select auth.uid()) or link.client_id = (select auth.uid()));
$$;

create or replace function public.count_unread_trainer_messages()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.trainer_messages message
  join public.trainer_client_links link on link.id = message.link_id
  where message.seen_at is null
    and message.author_id <> (select auth.uid())
    and link.status = 'active'
    and (link.trainer_id = (select auth.uid()) or link.client_id = (select auth.uid()));
$$;

create or replace function public.get_trainer_client_overview(p_client_id uuid)
returns table(
  client_id uuid, client_name text, current_weight_kg numeric,
  calorie_goal integer, protein_goal numeric, fat_goal numeric, carbs_goal numeric,
  today_kcal numeric, today_protein numeric, today_fat numeric, today_carbs numeric,
  meals_today integer, nutrition_days_7 integer, workouts_7 integer, last_workout_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.trainer_client_links
    where status = 'active'
      and ((trainer_id = (select auth.uid()) and client_id = p_client_id) or (client_id = (select auth.uid()) and client_id = p_client_id))
  ) then
    raise exception 'Active trainer connection required' using errcode = '42501';
  end if;
  return query
  select
    profile.id, coalesce(profile.display_name, 'Клиент'), profile.current_weight_kg,
    goals.daily_calories, goals.protein_g, goals.fat_g, goals.carbohydrates_g,
    coalesce(today.kcal, 0), coalesce(today.protein, 0), coalesce(today.fat, 0), coalesce(today.carbs, 0),
    coalesce(today.meals, 0)::integer, coalesce(days.days, 0)::integer, coalesce(workouts.count, 0)::integer, workouts.last_at
  from public.profiles profile
  left join public.nutrition_goals goals on goals.user_id = profile.id
  left join lateral (
    select sum(item.energy_kcal) kcal, sum(item.protein_g) protein, sum(item.fat_g) fat, sum(item.carbohydrates_g) carbs, count(distinct meal.id) meals
    from public.meals meal join public.meal_items item on item.meal_id = meal.id
    where meal.user_id = profile.id and meal.eaten_at::date = current_date
  ) today on true
  left join lateral (
    select count(distinct meal.eaten_at::date) days from public.meals meal
    where meal.user_id = profile.id and meal.eaten_at >= now() - interval '7 days'
  ) days on true
  left join lateral (
    select count(*) count, max(session.completed_at) last_at from public.workout_sessions session
    where session.user_id = profile.id and session.status = 'completed' and session.completed_at >= now() - interval '7 days'
  ) workouts on true
  where profile.id = p_client_id;
end;
$$;

revoke all on function public.is_active_trainer_link(uuid), public.get_trainer_messages(uuid), public.send_trainer_message(uuid, text), public.mark_trainer_messages_seen(uuid[]), public.count_unread_trainer_messages(), public.get_trainer_client_overview(uuid) from public, anon;
grant execute on function public.get_trainer_messages(uuid), public.send_trainer_message(uuid, text), public.mark_trainer_messages_seen(uuid[]), public.count_unread_trainer_messages(), public.get_trainer_client_overview(uuid) to authenticated;
