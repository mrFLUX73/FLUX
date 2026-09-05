import { getSupabaseClient, getSupabaseClientForUser, SupabaseAuthScopeError } from '../../lib/supabase';
import type { FluxAccount } from '../auth/phonePasswordAuth';
import {
  createProfileDraft,
  defaultThemeForSex,
  isFluxTheme,
  type DefaultAvatar,
  type FluxTheme,
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

function themeCacheKey(userId: string) {
  return `flux.profile-theme.${userId}`;
}

export function loadCachedProfileTheme(userId: string): FluxTheme | null {
  try {
    const value = window.localStorage.getItem(themeCacheKey(userId));
    return isFluxTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function cacheProfileTheme(userId: string, theme: FluxTheme) {
  try {
    window.localStorage.setItem(themeCacheKey(userId), theme);
  } catch {
    // Theme still works for this session when private storage is unavailable.
  }
}

export async function loadProfileDraft(userId: string, account: FluxAccount) {
  const [client, authClient] = await Promise.all([
    getSupabaseClientForUser(userId),
    getSupabaseClient(),
  ]);
  const [profileResult, goalResult, userResult] = await Promise.all([
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
    authClient?.auth.getUser() ?? Promise.resolve({ data: { user: null }, error: null }),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (goalResult.error) throw goalResult.error;
  const initial = createProfileDraft(account);
  const profile = profileResult.data;
  const goal = goalResult.data;
  const calculationSex = profile.biological_sex === 'female' || profile.biological_sex === 'male'
    ? profile.biological_sex
    : '';
  const storedTheme = userResult.data.user?.id === userId
    ? userResult.data.user.user_metadata?.theme_id
    : null;
  const theme = isFluxTheme(storedTheme)
    ? storedTheme
    : loadCachedProfileTheme(userId) ?? defaultThemeForSex(calculationSex);
  const draft: ProfileDraft = {
    displayName: profile.display_name?.trim() || initial.displayName,
    theme,
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

  cacheProfileTheme(userId, theme);

  return { avatar, draft };
}

export async function saveProfileDraft(userId: string, draft: ProfileDraft) {
  const displayName = draft.displayName.trim();
  if (!displayName) throw new Error('Укажите имя и фамилию');

  cacheProfileTheme(userId, draft.theme);

  const [client, authClient] = await Promise.all([
    getSupabaseClientForUser(userId),
    getSupabaseClient(),
  ]);
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

  if (!authClient) throw new Error('Supabase не настроен');
  const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session?.user.id !== userId) throw new SupabaseAuthScopeError();

  const { error: themeError } = await authClient.auth.updateUser({
    data: { theme_id: draft.theme },
  });
  if (themeError) throw themeError;
}
