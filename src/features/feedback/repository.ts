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

export async function loadAdminFeedback(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client
    .from('feedback')
    .select('id,category,message,screen,app_version,status,reporter_display_name,reporter_login,created_at,attachments')
    .order('created_at', { ascending: false })
    .returns<StoredFeedback[]>();
  if (error) throw error;
  return (data ?? []).map(fromStored);
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
