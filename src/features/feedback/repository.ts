import { getSupabaseClientForUser } from '../../lib/supabase';

export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'praise';
export type FeedbackStatus = 'new' | 'in_progress' | 'resolved';

export type FeedbackDraft = {
  category: FeedbackCategory;
  message: string;
  screen: string;
  appVersion: string;
};

export type FeedbackItem = FeedbackDraft & {
  id: string;
  createdAt: string;
  status: FeedbackStatus;
  reporterName: string;
  reporterLogin: string;
};

type StoredFeedback = {
  id: string;
  category: FeedbackCategory;
  message: string;
  screen: string | null;
  app_version: string | null;
  status: FeedbackStatus;
  reporter_display_name: string | null;
  reporter_login: string | null;
  created_at: string;
};

function fromStored(value: StoredFeedback): FeedbackItem {
  return {
    id: value.id,
    category: value.category,
    message: value.message,
    screen: value.screen ?? 'Неизвестный экран',
    appVersion: value.app_version ?? '—',
    status: value.status,
    reporterName: value.reporter_display_name ?? 'Пользователь FLUX',
    reporterLogin: value.reporter_login ?? '',
    createdAt: value.created_at,
  };
}

export async function submitFeedback(userId: string, draft: FeedbackDraft) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('create_feedback', {
    p_category: draft.category,
    p_message: draft.message.trim(),
    p_screen: draft.screen,
    p_app_version: draft.appVersion,
  });
  if (error) throw error;
}

export async function loadAdminFeedback(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client
    .from('feedback')
    .select('id,category,message,screen,app_version,status,reporter_display_name,reporter_login,created_at')
    .order('created_at', { ascending: false })
    .returns<StoredFeedback[]>();
  if (error) throw error;
  return (data ?? []).map(fromStored);
}

export async function updateFeedbackStatus(userId: string, feedbackId: string, status: FeedbackStatus) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('set_feedback_status', {
    p_feedback_id: feedbackId,
    p_status: status,
  });
  if (error) throw error;
  if (data !== true) throw new Error('Обращение не найдено');
}
