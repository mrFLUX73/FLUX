import { getSupabaseClientForUser } from '../../lib/supabase';

export type TrainerLink = {
  id: string;
  status: 'pending' | 'active' | 'declined' | 'revoked';
  createdAt: string;
  trainerId: string;
  trainerName: string;
  trainerCode: string | null;
  clientId: string;
  clientName: string;
};

export type TrainerMessage = {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
  seenAt: string | null;
};

export type TrainerClientOverview = {
  clientId: string;
  clientName: string;
  currentWeightKg: number | null;
  calorieGoal: number | null;
  proteinGoal: number | null;
  fatGoal: number | null;
  carbsGoal: number | null;
  todayKcal: number;
  todayProtein: number;
  todayFat: number;
  todayCarbs: number;
  mealsToday: number;
  nutritionDays7: number;
  workouts7: number;
  lastWorkoutAt: string | null;
};

type TrainerHubRow = {
  link_id: string;
  status: TrainerLink['status'];
  created_at: string;
  trainer_id: string;
  trainer_name: string;
  trainer_code: string | null;
  client_id: string;
  client_name: string;
};

export async function loadTrainerHub(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_trainer_hub');
  if (error) throw error;
  return ((data ?? []) as TrainerHubRow[]).map((row) => ({
    id: row.link_id,
    status: row.status,
    createdAt: row.created_at,
    trainerId: row.trainer_id,
    trainerName: row.trainer_name,
    trainerCode: row.trainer_code,
    clientId: row.client_id,
    clientName: row.client_name,
  }));
}

export async function loadMyTrainerCode(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_trainer_code');
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}

export async function setAccountRole(userId: string, role: 'user' | 'trainer') {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('set_my_account_role', { p_role: role });
  if (error) throw error;
  const result = (data as { role: 'user' | 'trainer'; trainer_code: string | null }[] | null)?.[0];
  if (!result) throw new Error('Не удалось изменить роль');
  return { role: result.role, trainerCode: result.trainer_code };
}

export async function requestTrainerConnection(userId: string, code: string) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('request_trainer_connection', { p_invite_code: code });
  if (error) throw error;
}

export async function respondToTrainerConnection(userId: string, linkId: string, accept: boolean) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('respond_to_trainer_connection', { p_link_id: linkId, p_accept: accept });
  if (error) throw error;
}

export async function loadTrainerMessages(userId: string, linkId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_trainer_messages', { p_link_id: linkId });
  if (error) throw error;
  return ((data ?? []) as { id: string; body: string; author_id: string; created_at: string; seen_at: string | null }[]).map((message) => ({
    id: message.id, body: message.body, authorId: message.author_id, createdAt: message.created_at, seenAt: message.seen_at,
  }));
}

export async function sendTrainerMessage(userId: string, linkId: string, body: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('send_trainer_message', { p_link_id: linkId, p_body: body.trim() });
  if (error || !data) throw error ?? new Error('Не удалось отправить сообщение');
  return data as string;
}

export async function markTrainerMessagesSeen(userId: string, messageIds: string[]) {
  if (!messageIds.length) return;
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('mark_trainer_messages_seen', { p_message_ids: messageIds });
  if (error) throw error;
}

export async function countUnreadTrainerMessages(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('count_unread_trainer_messages');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export async function loadTrainerClientOverview(userId: string, clientId: string): Promise<TrainerClientOverview | null> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_trainer_client_overview', { p_client_id: clientId });
  if (error) throw error;
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  const number = (key: string) => typeof row[key] === 'number' ? row[key] : Number(row[key] ?? 0);
  return {
    clientId: String(row.client_id), clientName: String(row.client_name ?? 'Клиент'),
    currentWeightKg: row.current_weight_kg == null ? null : number('current_weight_kg'),
    calorieGoal: row.calorie_goal == null ? null : number('calorie_goal'), proteinGoal: row.protein_goal == null ? null : number('protein_goal'), fatGoal: row.fat_goal == null ? null : number('fat_goal'), carbsGoal: row.carbs_goal == null ? null : number('carbs_goal'),
    todayKcal: number('today_kcal'), todayProtein: number('today_protein'), todayFat: number('today_fat'), todayCarbs: number('today_carbs'), mealsToday: number('meals_today'), nutritionDays7: number('nutrition_days_7'), workouts7: number('workouts_7'), lastWorkoutAt: row.last_workout_at == null ? null : String(row.last_workout_at),
  };
}
