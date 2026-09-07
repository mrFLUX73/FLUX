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
  adminReply: string;
  repliedAt: string | null;
  replySeenAt: string | null;
  archivedAt: string | null;
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
  admin_reply: string | null;
  replied_at: string | null;
  reply_seen_at: string | null;
  archived_at: string | null;
};

const attachmentBucket = 'feedback-attachments';
const allowedAttachmentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const maxAttachmentBytes = 8 * 1024 * 1024;

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
    attachments: value.attachments ?? [],
    adminReply: value.admin_reply ?? '',
    repliedAt: value.replied_at,
    replySeenAt: value.reply_seen_at,
    archivedAt: value.archived_at,
  };
}

export async function submitFeedback(userId: string, draft: FeedbackDraft) {
  const client = await getSupabaseClientForUser(userId);
  const files = draft.attachments ?? [];
  if (files.length > 3) throw new Error('Можно приложить не больше трёх изображений');
  if (files.some((file) => !allowedAttachmentTypes.has(file.type) || file.size > maxAttachmentBytes)) {
    throw new Error('Подойдут JPG, PNG, WEBP или HEIC до 8 МБ');
  }

  const uploadedPaths: string[] = [];
  try {
    const attachmentPaths = await Promise.all(files.map(async (file) => {
      const extension = file.type === 'image/png' ? 'png'
        : file.type === 'image/webp' ? 'webp'
          : file.type === 'image/heif' ? 'heif'
            : file.type === 'image/heic' ? 'heic' : 'jpg';
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await client.storage.from(attachmentBucket).upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      uploadedPaths.push(path);
      return path;
    }));

    const { error } = await client.rpc('create_feedback', {
      p_category: draft.category,
      p_message: draft.message.trim(),
      p_screen: draft.screen,
      p_app_version: draft.appVersion,
      p_attachments: attachmentPaths,
    });
    if (error) throw error;
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from(attachmentBucket).remove(uploadedPaths);
    throw error;
  }
}

const feedbackColumns = 'id,category,message,screen,app_version,status,reporter_display_name,reporter_login,created_at,attachments,admin_reply,replied_at,reply_seen_at,archived_at';

export async function loadAdminFeedback(userId: string, archived = false) {
  const client = await getSupabaseClientForUser(userId);
  let query = client
    .from('feedback')
    .select(feedbackColumns)
    .order('created_at', { ascending: false });
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  const { data, error } = await query.returns<StoredFeedback[]>();
  if (error) throw error;
  return (data ?? []).map(fromStored);
}

export async function loadMyFeedback(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client
    .from('feedback')
    .select(feedbackColumns)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<StoredFeedback[]>();
  if (error) throw error;
  return (data ?? []).map(fromStored);
}

export async function countUnreadFeedbackReplies(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { count, error } = await client
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('admin_reply', 'is', null)
    .is('reply_seen_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function getFeedbackAttachmentUrl(userId: string, attachmentPath: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.storage.from(attachmentBucket).createSignedUrl(attachmentPath, 60 * 5);
  if (error || !data?.signedUrl) throw error ?? new Error('Не удалось открыть вложение');
  return data.signedUrl;
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

export async function resolveFeedback(userId: string, feedbackId: string, reply: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('resolve_feedback', {
    p_feedback_id: feedbackId,
    p_reply: reply.trim(),
  });
  if (error) throw error;
  if (data !== true) throw new Error('Обращение не найдено');
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

export async function markFeedbackRepliesSeen(userId: string, feedbackIds: string[]) {
  if (!feedbackIds.length) return;
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('mark_feedback_replies_seen', { p_feedback_ids: feedbackIds });
  if (error) throw error;
}
