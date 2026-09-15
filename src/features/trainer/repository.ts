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

export type TrainerInboxLink = TrainerLink & {
  respondedAt: string | null;
  lastMessageId: string | null;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  lastMessageAuthorId: string | null;
  unreadCount: number;
};

export type TrainerMessage = {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
  seenAt: string | null;
};

export type TrainerConnectionRequestOutcome = 'created' | 'already_pending' | 'already_active';
export type TrainerConnectionErrorReason = 'invalid_code' | 'own_trainer' | 'active_trainer_exists';

export type TrainerInvitePreview = {
  trainerName: string;
  connectionState: 'available' | 'already_pending' | 'already_active' | 'active_other';
};

export class TrainerConnectionError extends Error {
  constructor(public readonly reason: TrainerConnectionErrorReason) {
    super(reason);
    this.name = 'TrainerConnectionError';
  }
}

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

export type TrainerNutritionItem = { id: string; name: string; amountG: number; kcal: number; protein: number; fat: number; carbs: number };
export type TrainerNutritionMeal = { id: string; type: string; eatenAt: string; items: TrainerNutritionItem[] };
export type TrainerClientNutrition = { day: string; goalKcal: number | null; kcal: number; protein: number; fat: number; carbs: number; meals: TrainerNutritionMeal[] };
export type TrainerWorkoutPlan = { name: string; description: string | null; durationMinutes: number | null };
export type TrainerWorkoutSession = { id: string; title: string; status: string; startedAt: string; completedAt: string | null };
export type TrainerClientWorkouts = { plan: TrainerWorkoutPlan | null; sessions: TrainerWorkoutSession[] };
export type TrainerClientNote = { id: string; body: string; createdAt: string; updatedAt: string };

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

function toTrainerConnectionError(error: unknown) {
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : '';
  if (message === 'Trainer code not found') return new TrainerConnectionError('invalid_code');
  if (message === 'Cannot connect to your own trainer account') return new TrainerConnectionError('own_trainer');
  if (message === 'Client already has an active trainer') return new TrainerConnectionError('active_trainer_exists');
  return error;
}

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

export async function loadTrainerInbox(userId: string): Promise<TrainerInboxLink[]> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_trainer_inbox');
  if (error) throw error;
  return ((data ?? []) as Array<{
    link_id: string; status: TrainerLink['status']; created_at: string; responded_at: string | null;
    trainer_id: string; trainer_name: string | null; trainer_code: string | null;
    client_id: string; client_name: string | null; last_message_id: string | null;
    last_message_body: string | null; last_message_at: string | null;
    last_message_author_id: string | null; unread_count: number | string | null;
  }>).map((row) => ({
    id: row.link_id,
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    trainerId: row.trainer_id,
    trainerName: row.trainer_name ?? 'Тренер',
    trainerCode: row.trainer_code,
    clientId: row.client_id,
    clientName: row.client_name ?? 'Клиент',
    lastMessageId: row.last_message_id,
    lastMessageBody: row.last_message_body,
    lastMessageAt: row.last_message_at,
    lastMessageAuthorId: row.last_message_author_id,
    unreadCount: Number(row.unread_count ?? 0),
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
  const { data, error } = await client.rpc('request_trainer_connection', { p_invite_code: code });
  if (error) throw toTrainerConnectionError(error);
  // A deployed client may briefly meet the previous RPC contract while the
  // database migration is being applied. Keep that request usable; the new
  // server-side rules take effect as soon as migration 0021 is present.
  if (typeof data === 'string') return { linkId: data, status: 'pending' as const, outcome: 'created' as const };
  const row = (data as { link_id?: string; status?: TrainerLink['status']; outcome?: TrainerConnectionRequestOutcome }[] | null)?.[0];
  if (!row?.link_id || !row.status || !row.outcome) throw new Error('Не удалось обработать заявку');
  return { linkId: row.link_id, status: row.status, outcome: row.outcome };
}

export async function loadTrainerInvitePreview(userId: string, code: string): Promise<TrainerInvitePreview> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_trainer_invite_preview', { p_invite_code: code });
  if (error) throw toTrainerConnectionError(error);
  const row = (data as { trainer_name?: string | null; connection_state?: TrainerInvitePreview['connectionState'] }[] | null)?.[0];
  if (!row?.trainer_name || !row.connection_state) throw new Error('Не удалось открыть приглашение');
  return { trainerName: row.trainer_name, connectionState: row.connection_state };
}

export async function respondToTrainerConnection(userId: string, linkId: string, accept: boolean) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('respond_to_trainer_connection', { p_link_id: linkId, p_accept: accept });
  if (error) throw toTrainerConnectionError(error);
}

export async function revokeTrainerConnection(userId: string, linkId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('revoke_trainer_connection', { p_link_id: linkId });
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

export async function loadUnreadTrainerLinkIds(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_unread_trainer_link_ids');
  if (error) throw error;
  return ((data ?? []) as { link_id: string }[]).map((row) => row.link_id);
}

export async function loadTrainerClientOverview(userId: string, linkId: string): Promise<TrainerClientOverview | null> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_trainer_client_overview', { p_client_id: linkId });
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

function readNumber(value: unknown) { return typeof value === 'number' ? value : Number(value ?? 0); }

export async function loadTrainerClientNutrition(userId: string, linkId: string, day: string): Promise<TrainerClientNutrition> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_trainer_client_nutrition', { p_link_id: linkId, p_day: day });
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  const meals = Array.isArray(row.meals) ? row.meals : [];
  return { day: String(row.day ?? day), goalKcal: row.goal_kcal == null ? null : readNumber(row.goal_kcal), kcal: readNumber(row.kcal), protein: readNumber(row.protein), fat: readNumber(row.fat), carbs: readNumber(row.carbs), meals: meals.map((meal) => {
    const item = meal as Record<string, unknown>;
    return { id: String(item.id), type: String(item.type), eatenAt: String(item.eaten_at), items: (Array.isArray(item.items) ? item.items : []).map((raw) => { const value = raw as Record<string, unknown>; return { id: String(value.id), name: String(value.name), amountG: readNumber(value.amount_g), kcal: readNumber(value.kcal), protein: readNumber(value.protein), fat: readNumber(value.fat), carbs: readNumber(value.carbs) }; }) };
  }) };
}

export async function loadTrainerClientWorkouts(userId: string, linkId: string): Promise<TrainerClientWorkouts> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_trainer_client_workouts', { p_link_id: linkId });
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>; const plan = row.plan as Record<string, unknown> | null;
  return { plan: plan ? { name: String(plan.name), description: plan.description == null ? null : String(plan.description), durationMinutes: plan.duration_minutes == null ? null : readNumber(plan.duration_minutes) } : null, sessions: (Array.isArray(row.sessions) ? row.sessions : []).map((raw) => { const value = raw as Record<string, unknown>; return { id: String(value.id), title: String(value.title), status: String(value.status), startedAt: String(value.started_at), completedAt: value.completed_at == null ? null : String(value.completed_at) }; }) };
}

export async function loadTrainerClientNotes(userId: string, linkId: string): Promise<TrainerClientNote[]> {
  const client = await getSupabaseClientForUser(userId); const { data, error } = await client.rpc('get_trainer_client_notes', { p_link_id: linkId });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), body: String(row.body), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
}

export async function saveTrainerClientNote(userId: string, linkId: string, body: string, noteId?: string) {
  const client = await getSupabaseClientForUser(userId); const { data, error } = await client.rpc('save_trainer_client_note', { p_link_id: linkId, p_note_id: noteId ?? null, p_body: body });
  if (error) throw error;
  const row = (data as Record<string, unknown>[] | null)?.[0]; if (!row) throw new Error('Не удалось сохранить заметку');
  return { id: String(row.id), body: String(row.body), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } satisfies TrainerClientNote;
}

export async function deleteTrainerClientNote(userId: string, linkId: string, noteId: string) {
  const client = await getSupabaseClientForUser(userId); const { error } = await client.rpc('delete_trainer_client_note', { p_link_id: linkId, p_note_id: noteId });
  if (error) throw error;
}
