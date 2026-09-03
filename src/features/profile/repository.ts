import { getSupabaseClientForUser } from '../../lib/supabase';
import type { FluxAccount } from '../auth/phonePasswordAuth';
import {
  createProfileDraft,
  type DefaultAvatar,
  type ProfileDraft,
} from './ProfileScreen';

type StoredProfile = {
  display_name: string | null;
  birth_date: string | null;
  biological_sex: string | null;
  height_cm: number | null;
  current_weight_kg: number | null;
};

type StoredNutritionGoal = {
  goal_type: string;
  activity_level: string | null;
  target_weight_kg: number | null;
  weight_change_pace_kg_per_week: number | null;
  workouts_per_week: number | null;
};

function optionalNumber(value: string) {
  return value === '' ? null : Number(value);
}

function activityFromDatabase(value: string | null): ProfileDraft['activity'] {
  if (value === 'moderate') return 'medium';
  if (value === 'high' || value === 'very_high') return 'high';
  if (value === 'sedentary' || value === 'light') return 'low';
  return '';
}

function activityToDatabase(value: ProfileDraft['activity']) {
  if (value === 'medium') return 'moderate';
  if (value === 'high') return 'high';
  if (value === 'low') return 'sedentary';
  return null;
}

function goalFromDatabase(value: string | undefined): ProfileDraft['goal'] {
  return value === 'lose' || value === 'maintain' || value === 'gain' ? value : '';
}

function paceFromDatabase(value: number | null | undefined): ProfileDraft['paceKgPerWeek'] {
  const pace = value == null ? '' : String(Number(value));
  return pace === '0.25' || pace === '0.5' || pace === '0.75' ? pace : '';
}

export async function loadProfileDraft(userId: string, account: FluxAccount) {
  const client = await getSupabaseClientForUser(userId);
  const [profileResult, goalResult] = await Promise.all([
    client
      .from('profiles')
      .select('display_name,birth_date,biological_sex,height_cm,current_weight_kg')
      .eq('id', userId)
      .single<StoredProfile>(),
    client
      .from('nutrition_goals')
      .select('goal_type,activity_level,target_weight_kg,weight_change_pace_kg_per_week,workouts_per_week')
      .eq('user_id', userId)
      .maybeSingle<StoredNutritionGoal>(),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (goalResult.error) throw goalResult.error;

  const initial = createProfileDraft(account);
  const profile = profileResult.data;
  const goal = goalResult.data;
  const calculationSex = profile.biological_sex === 'female' || profile.biological_sex === 'male'
    ? profile.biological_sex
    : '';
  const draft: ProfileDraft = {
    displayName: profile.display_name?.trim() || initial.displayName,
    birthDate: profile.birth_date ?? '',
    calculationSex,
    heightCm: profile.height_cm == null ? '' : String(Number(profile.height_cm)),
    currentWeightKg: profile.current_weight_kg == null ? '' : String(Number(profile.current_weight_kg)),
    goal: goal ? goalFromDatabase(goal.goal_type) : initial.goal,
    targetWeightKg: goal?.target_weight_kg == null ? '' : String(Number(goal.target_weight_kg)),
    paceKgPerWeek: goal ? paceFromDatabase(goal.weight_change_pace_kg_per_week) || initial.paceKgPerWeek : initial.paceKgPerWeek,
    activity: activityFromDatabase(goal?.activity_level ?? null),
    workoutsPerWeek: goal?.workouts_per_week == null ? '' : String(goal.workouts_per_week),
  };
  const avatar: DefaultAvatar = calculationSex === 'female' ? 'bun' : 'short-hair';

  return { avatar, draft };
}

export async function saveProfileDraft(userId: string, draft: ProfileDraft) {
  const displayName = draft.displayName.trim();
  if (!displayName) throw new Error('Укажите имя и фамилию');

  const client = await getSupabaseClientForUser(userId);
  const { error: profileError } = await client
    .from('profiles')
    .update({
      display_name: displayName,
      birth_date: draft.birthDate || null,
      biological_sex: draft.calculationSex || null,
      height_cm: optionalNumber(draft.heightCm),
      current_weight_kg: optionalNumber(draft.currentWeightKg),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    })
    .eq('id', userId)
    .select('id')
    .single();
  if (profileError) throw profileError;

  const { error: goalError } = await client
    .from('nutrition_goals')
    .upsert({
      user_id: userId,
      goal_type: draft.goal || 'maintain',
      activity_level: activityToDatabase(draft.activity),
      target_weight_kg: optionalNumber(draft.targetWeightKg),
      weight_change_pace_kg_per_week: optionalNumber(draft.paceKgPerWeek),
      workouts_per_week: optionalNumber(draft.workoutsPerWeek),
    }, { onConflict: 'user_id' });
  if (goalError) throw goalError;
}
