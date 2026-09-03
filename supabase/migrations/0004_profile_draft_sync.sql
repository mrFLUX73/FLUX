-- Persist the remaining onboarding fields used by the FLUX profile form.

alter table public.nutrition_goals
  add column if not exists weight_change_pace_kg_per_week numeric(3, 2),
  add column if not exists workouts_per_week smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'nutrition_goals_weight_change_pace_check'
      and conrelid = 'public.nutrition_goals'::regclass
  ) then
    alter table public.nutrition_goals
      add constraint nutrition_goals_weight_change_pace_check
      check (
        weight_change_pace_kg_per_week is null
        or weight_change_pace_kg_per_week in (0.25, 0.50, 0.75)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'nutrition_goals_workouts_per_week_check'
      and conrelid = 'public.nutrition_goals'::regclass
  ) then
    alter table public.nutrition_goals
      add constraint nutrition_goals_workouts_per_week_check
      check (workouts_per_week is null or workouts_per_week between 0 and 7);
  end if;
end;
$$;

comment on column public.nutrition_goals.weight_change_pace_kg_per_week is
  'Target absolute weekly weight change selected during onboarding.';

comment on column public.nutrition_goals.workouts_per_week is
  'Planned number of workouts per week used for nutrition calculations.';
