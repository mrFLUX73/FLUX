import { getSupabaseClientForUser } from '../../lib/supabase';

export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'praise';
export type FeedbackStatus = 'new' | 'in_progress' | 'resolved';

export type FeedbackDraft = {
  category: FeedbackCategory;
  message: string;
  screen: string;
  appVersion: string;
  attachments?: File[];
};

export type FeedbackMessage = {
  id: string;
  body: string;
  createdAt: string;
  isSupport: boolean;
  seenAt: string | null;
};

export type FeedbackItem = {
  id: string;
  category: FeedbackCategory;
  message: string;
  screen: string;
  appVersion: string;
  createdAt: string;
  status: FeedbackStatus;
  reporterName: string;
  reporterLogin: string;
  attachments: string[];
  archivedAt: string | null;
  messages: FeedbackMessage[];
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
  attachments: string[] | null;
  archived_at: string | null;
};

type StoredFeedbackMessage = {
  id: string;
  feedback_id: string;
  body: string;
  created_at: string;
  is_support: boolean;
  seen_at: string | null;
};

const attachmentBucket = 'feedback-attachments';
const allowedAttachmentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const maxAttachmentBytes = 8 * 1024 * 1024;
const feedbackColumns = 'id,category,message,screen,app_version,status,reporter_display_name,reporter_login,created_at,attachments,archived_at';
const messageColumns = 'id,feedback_id,body,created_at,is_support,seen_at';

function toMessage(value: StoredFeedbackMessage): FeedbackMessage {
  return { id: value.id, body: value.body, createdAt: value.created_at, isSupport: value.is_support, seenAt: value.seen_at };
}

function toItem(value: StoredFeedback, messages: FeedbackMessage[]): FeedbackItem {
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
    attachments: value.attachments ?? [],
    archivedAt: value.archived_at,
    messages,
  };
}

async function attachMessages(userId: string, feedback: StoredFeedback[]) {
  if (!feedback.length) return [];
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client
    .from('feedback_messages')
    .select(messageColumns)
    .in('feedback_id', feedback.map((item) => item.id))
    .order('created_at', { ascending: true })
    .returns<StoredFeedbackMessage[]>();
  if (error) throw error;
  const byFeedback = new Map<string, FeedbackMessage[]>();
  for (const message of data ?? []) {
    const list = byFeedback.get(message.feedback_id) ?? [];
    list.push(toMessage(message));
    byFeedback.set(message.feedback_id, list);
  }
  return feedback.map((item) => toItem(item, byFeedback.get(item.id) ?? []));
}

export async function submitFeedback(userId: string, draft: FeedbackDraft) {
  const client = await getSupabaseClientForUser(userId);
  const files = draft.attachments ?? [];
  if (files.length > 3) throw new Error('Можно приложить не больше трёх изображений');
  if (files.some((file) => !allowedAttachmentTypes.has(file.type) || file.size > maxAttachmentBytes)) throw new Error('Подойдут JPG, PNG, WEBP или HEIC до 8 МБ');

  const uploadedPaths: string[] = [];
  try {
    const attachmentPaths = await Promise.all(files.map(async (file) => {
      const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/heif' ? 'heif' : file.type === 'image/heic' ? 'heic' : 'jpg';
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await client.storage.from(attachmentBucket).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      uploadedPaths.push(path);
      return path;
    }));
    const { error } = await client.rpc('create_feedback', { p_category: draft.category, p_message: draft.message.trim(), p_screen: draft.screen, p_app_version: draft.appVersion, p_attachments: attachmentPaths });
    if (error) throw error;
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from(attachmentBucket).remove(uploadedPaths);
    throw error;
  }
}

export async function loadAdminFeedback(userId: string, archived = false) {
  const client = await getSupabaseClientForUser(userId);
  let query = client.from('feedback').select(feedbackColumns).order('created_at', { ascending: false });
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  const { data, error } = await query.returns<StoredFeedback[]>();
  if (error) throw error;
  return attachMessages(userId, data ?? []);
}

export async function loadMyFeedback(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.from('feedback').select(feedbackColumns).eq('user_id', userId).order('created_at', { ascending: false }).limit(50).returns<StoredFeedback[]>();
  if (error) throw error;
  return attachMessages(userId, data ?? []);
}

export async function countUnreadFeedbackReplies(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('count_unread_feedback_messages');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export async function getFeedbackAttachmentUrl(userId: string, attachmentPath: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.storage.from(attachmentBucket).createSignedUrl(attachmentPath, 60 * 5);
  if (error || !data?.signedUrl) throw error ?? new Error('Не удалось открыть вложение');
  return data.signedUrl;
}

export async function updateFeedbackStatus(userId: string, feedbackId: string, status: FeedbackStatus) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('set_feedback_status', { p_feedback_id: feedbackId, p_status: status });
  if (error) throw error;
  if (data !== true) throw new Error('Обращение не найдено');
}

export async function resolveFeedback(userId: string, feedbackId: string, reply: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('resolve_feedback', { p_feedback_id: feedbackId, p_reply: reply.trim() });
  if (error) throw error;
  if (data !== true) throw new Error('Обращение не найдено');
}

export async function sendFeedbackMessage(userId: string, feedbackId: string, body: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('send_feedback_message', { p_feedback_id: feedbackId, p_body: body.trim() });
  if (error || !data) throw error ?? new Error('Не удалось отправить сообщение');
  return data as string;
}

export async function startSupportConversation(userId: string, recipient: string, body: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('start_support_conversation', { p_recipient: recipient.trim(), p_body: body.trim() });
  if (error || !data) throw error ?? new Error('Не удалось начать диалог');
  return data as string;
}

export async function archiveFeedback(userId: string, feedbackId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('archive_feedback', { p_feedback_id: feedbackId });
  if (error) throw error;
  if (data !== true) throw new Error('Не удалось архивировать обращение');
}

export async function restoreFeedback(userId: string, feedbackId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('restore_feedback', { p_feedback_id: feedbackId });
  if (error) throw error;
  if (data !== true) throw new Error('Не удалось восстановить обращение');
}

export async function markFeedbackMessagesSeen(userId: string, messageIds: string[]) {
  if (!messageIds.length) return;
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('mark_feedback_messages_seen', { p_message_ids: messageIds });
  if (error) throw error;
}
