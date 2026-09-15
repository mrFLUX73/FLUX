-- get_trainer_client_overview has a RETURNS TABLE field named client_id.
-- PostgreSQL therefore treats an unqualified client_id in PL/pgSQL as
-- ambiguous. Qualify the trainer-link column so the base workspace RPC can
-- resolve the active client again.
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
declare
  requested_client_id uuid;
begin
  select links.client_id into requested_client_id
  from public.trainer_client_links as links
  where links.id = p_client_id
    and links.trainer_id = (select auth.uid())
    and links.status = 'active';

  if requested_client_id is null then
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
  where profile.id = requested_client_id;
end;
$$;

revoke all on function public.get_trainer_client_overview(uuid) from public, anon;
grant execute on function public.get_trainer_client_overview(uuid) to authenticated;
