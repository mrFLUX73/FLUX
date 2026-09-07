import { useEffect, useMemo, useRef, useState } from 'react';
import { Bug, CheckCircle2, Heart, ImagePlus, Lightbulb, LoaderCircle, MessageCircle, Paperclip, RefreshCw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import {
  getFeedbackAttachmentUrl,
  loadAdminFeedback,
  submitFeedback,
  updateFeedbackStatus,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackStatus,
} from './repository';

const categories: { id: FeedbackCategory; label: string; hint: string; icon: typeof Bug }[] = [
  { id: 'bug', label: 'Ошибка', hint: 'Что-то не сработало', icon: Bug },
  { id: 'idea', label: 'Идея', hint: 'Как сделать лучше', icon: Lightbulb },
  { id: 'question', label: 'Вопрос', hint: 'Нужна подсказка', icon: MessageCircle },
  { id: 'praise', label: 'Спасибо', hint: 'Что вам понравилось', icon: Heart },
];

const statusLabels: Record<FeedbackStatus, string> = {
  new: 'Новое',
  in_progress: 'В работе',
  resolved: 'Готово',
};

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function FeedbackDrawer({
  open,
  onOpenChange,
  userId,
  screen,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  screen: string;
  onSubmitted?: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const attachmentInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setCategory('idea');
    setMessage('');
    setError('');
    setAttachments([]);
  }, [open]);

  const canSubmit = message.trim().length >= 3 && !submitting;
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await submitFeedback(userId, { category, message, screen, appVersion: 'FLUX web', attachments });
      onOpenChange(false);
      onSubmitted?.();
    } catch {
      setError('Не удалось отправить обращение. Проверьте интернет и повторите попытку.');
    } finally {
      setSubmitting(false);
    }
  };

  const addAttachments = (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files);
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
    if (incoming.some((file) => !allowed.has(file.type) || file.size > 8 * 1024 * 1024)) {
      setError('Подойдут JPG, PNG, WEBP или HEIC до 8 МБ.');
      return;
    }
    setAttachments((current) => {
      const next = [...current, ...incoming].slice(0, 3);
      if (current.length + incoming.length > 3) setError('К обращению можно приложить до трёх изображений.');
      return next;
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="flux-drawer flux-feedback-drawer">
        <DrawerHeader className="flux-drawer-header">
          <DrawerTitle>Обратная связь</DrawerTitle>
          <DrawerDescription>Сообщение увидит команда FLUX. Экран добавим к обращению автоматически.</DrawerDescription>
        </DrawerHeader>
        <div className="flux-feedback-body">
          <div className="flux-feedback-categories" aria-label="Тип обращения">
            {categories.map((item) => {
              const Icon = item.icon;
              return <button type="button" key={item.id} className={category === item.id ? 'is-active' : ''} onClick={() => setCategory(item.id)}><Icon /><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>;
            })}
          </div>
          <label className="flux-feedback-message"><span>Расскажите подробнее</span><textarea value={message} maxLength={4000} placeholder="Например: после сканирования продукт не нашёлся…" onChange={(event) => setMessage(event.target.value)} /></label>
          <input ref={attachmentInput} className="flux-feedback-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={(event) => { addAttachments(event.target.files); event.currentTarget.value = ''; }} />
          <div className="flux-feedback-attachments">
            <button type="button" className="flux-feedback-attachment-trigger" onClick={() => attachmentInput.current?.click()}><ImagePlus /> Скриншот или фото</button>
            <span>До 3 изображений по 8 МБ</span>
          </div>
          {attachments.length > 0 && <div className="flux-feedback-attachment-list">{attachments.map((file, index) => <span key={`${file.name}-${file.lastModified}`}><Paperclip /> <b>{file.name}</b><button type="button" aria-label={`Удалить ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, candidateIndex) => candidateIndex !== index))}><X /></button></span>)}</div>}
          <div className="flux-feedback-meta"><span>Экран: {screen}</span><span>{message.length}/4000</span></div>
          {error && <p className="flux-feedback-error" role="alert">{error}</p>}
          <Button type="button" className="flux-feedback-submit" size="lg" disabled={!canSubmit} onClick={() => { void submit(); }}>{submitting ? <><LoaderCircle className="animate-spin" /> Отправляю…</> : <><MessageCircle /> Отправить</>}</Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function AdminFeedbackScreen({ userId }: { userId: string }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | FeedbackStatus>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [openingAttachment, setOpeningAttachment] = useState<string | null>(null);

  const refresh = async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      setItems(await loadAdminFeedback(userId));
    } catch {
      setError('Не удалось загрузить обращения. Проверьте соединение и обновите список.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const openAttachment = async (path: string) => {
    setOpeningAttachment(path);
    setError('');
    try {
      const url = await getFeedbackAttachmentUrl(userId, path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError('Не удалось открыть вложение. Попробуйте ещё раз.');
    } finally {
      setOpeningAttachment(null);
    }
  };

  useEffect(() => { void refresh(); }, [userId]);

  const visibleItems = useMemo(() => filter === 'all' ? items : items.filter((item) => item.status === filter), [filter, items]);
  const newCount = items.filter((item) => item.status === 'new').length;
  const inProgressCount = items.filter((item) => item.status === 'in_progress').length;

  const changeStatus = async (item: FeedbackItem, status: FeedbackStatus) => {
    if (status === item.status) return;
    setUpdatingId(item.id);
    try {
      await updateFeedbackStatus(userId, item.id, status);
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status } : candidate));
    } catch {
      setError('Статус не изменился. Попробуйте ещё раз.');
    } finally {
      setUpdatingId(null);
    }
  };

  return <section className="flux-admin-screen">
    <div className="flux-page-heading">
      <div className="flux-page-heading-row"><div><span className="flux-eyebrow">Администрирование</span><h1>Управление</h1></div><Button type="button" variant="secondary" size="icon" aria-label="Обновить обращения" onClick={() => { void refresh(true); }} disabled={refreshing}>{refreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button></div>
      <p>Обратная связь от пользователей FLUX.</p>
    </div>
    <section className="flux-admin-stats"><div><span>Новые</span><strong>{newCount}</strong></div><div><span>В работе</span><strong>{inProgressCount}</strong></div></section>
    <div className="flux-admin-filters" aria-label="Фильтр обращений">
      {([['all', 'Все'], ['new', 'Новые'], ['in_progress', 'В работе'], ['resolved', 'Готово']] as const).map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}
    </div>
    {loading ? <div className="flux-admin-state"><LoaderCircle className="animate-spin" /> Загружаем обращения…</div> : error && !items.length ? <div className="flux-admin-state is-error"><p>{error}</p><Button type="button" variant="secondary" onClick={() => { void refresh(); }}>Повторить</Button></div> : visibleItems.length ? <div className="flux-admin-list">{visibleItems.map((item) => {
      const category = categories.find((candidate) => candidate.id === item.category) ?? categories[1];
      const Icon = category.icon;
      return <article className="flux-admin-feedback" key={item.id}>
        <header><span className={`flux-admin-category is-${item.category}`}><Icon /> {category.label}</span><time>{formatCreatedAt(item.createdAt)}</time></header>
        <p>{item.message}</p>
        {item.attachments.length > 0 && <div className="flux-admin-attachments">{item.attachments.map((path, index) => <button type="button" key={path} disabled={openingAttachment === path} onClick={() => { void openAttachment(path); }}><Paperclip /> {openingAttachment === path ? 'Открываю…' : `Вложение ${index + 1}`}</button>)}</div>}
        <footer><span>{item.reporterName}{item.reporterLogin ? ` · @${item.reporterLogin}` : ''}</span><select value={item.status} disabled={updatingId === item.id} onChange={(event) => { void changeStatus(item, event.target.value as FeedbackStatus); }} aria-label={`Статус обращения: ${item.message.slice(0, 40)}`}><option value="new">{statusLabels.new}</option><option value="in_progress">{statusLabels.in_progress}</option><option value="resolved">{statusLabels.resolved}</option></select></footer>
      </article>;
    })}</div> : <div className="flux-admin-state"><CheckCircle2 /> Здесь пока тихо. Новые обращения появятся в этом списке.</div>}
    {error && items.length > 0 && <p className="flux-admin-inline-error" role="alert">{error}</p>}
  </section>;
}
