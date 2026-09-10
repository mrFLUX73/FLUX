import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Bell, Bug, CheckCircle2, ClipboardList, Heart, ImagePlus, Lightbulb, LoaderCircle, MessageCircle, Paperclip, RefreshCw, Send, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { archiveFeedback, getFeedbackAttachmentUrl, loadAdminFeedback, loadMyFeedback, markFeedbackMessagesSeen, resolveFeedback, restoreFeedback, sendFeedbackMessage, submitFeedback, updateFeedbackStatus, type FeedbackCategory, type FeedbackItem, type FeedbackMessage, type FeedbackStatus } from './repository';
import { loadProductSuggestions, reviewProductSuggestion, type ProductSuggestion } from '../nutrition/productSuggestions';

const categories: { id: FeedbackCategory; label: string; hint: string; icon: typeof Bug }[] = [
  { id: 'bug', label: 'Ошибка', hint: 'Что-то не сработало', icon: Bug },
  { id: 'idea', label: 'Идея', hint: 'Как сделать лучше', icon: Lightbulb },
  { id: 'question', label: 'Вопрос', hint: 'Нужна подсказка', icon: MessageCircle },
  { id: 'praise', label: 'Спасибо', hint: 'Что вам понравилось', icon: Heart },
];
const statusLabels: Record<FeedbackStatus, string> = { new: 'Новое', in_progress: 'В работе', resolved: 'Готово' };

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatMacro(value: number) {
  return (Math.round(value * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function Conversation({ messages, viewer }: { messages: FeedbackMessage[]; viewer: 'author' | 'support' }) {
  if (!messages.length) return null;
  return <div className="flux-feedback-conversation" aria-label="Диалог по обращению">{messages.map((message) => {
    const own = viewer === 'author' ? !message.isSupport : message.isSupport;
    return <div className={`flux-feedback-bubble${own ? ' is-own' : ''}`} key={message.id}><span>{message.isSupport ? 'Поддержка FLUX' : 'Пользователь'} · {formatCreatedAt(message.createdAt)}</span><p>{message.body}</p></div>;
  })}</div>;
}

function inlineMessage(now: string, id: string, body: string, isSupport: boolean): FeedbackMessage {
  return { id, body: body.trim(), isSupport, createdAt: now, seenAt: isSupport ? null : now };
}

export function FeedbackDrawer({ open, onOpenChange, userId, screen, initialView, onSubmitted, onRepliesRead }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  screen: string;
  initialView?: 'compose' | 'inbox';
  onSubmitted?: () => void;
  onRepliesRead?: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [view, setView] = useState<'compose' | 'inbox'>('compose');
  const [myItems, setMyItems] = useState<FeedbackItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const attachmentInput = useRef<HTMLInputElement>(null);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const items = await loadMyFeedback(userId);
      setMyItems(items);
      if (items.some((item) => item.messages.some((message) => message.isSupport && !message.seenAt))) setView('inbox');
    } finally { setHistoryLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    setCategory('idea'); setMessage(''); setError(''); setAttachments([]); setView(initialView ?? 'compose'); setReplyingId(null); setReplyText('');
    void loadHistory();
  }, [initialView, open, userId]);

  useEffect(() => {
    if (!open || view !== 'inbox') return;
    const unreadIds = myItems.flatMap((item) => item.messages.filter((message) => message.isSupport && !message.seenAt).map((message) => message.id));
    if (!unreadIds.length) return;
    setMyItems((items) => items.map((item) => ({ ...item, messages: item.messages.map((message) => unreadIds.includes(message.id) ? { ...message, seenAt: new Date().toISOString() } : message) })));
    onRepliesRead?.();
    void markFeedbackMessagesSeen(userId, unreadIds);
  }, [myItems, onRepliesRead, open, userId, view]);

  const canSubmit = message.trim().length >= 3 && !submitting;
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setError('');
    try { await submitFeedback(userId, { category, message, screen, appVersion: 'FLUX web', attachments }); onOpenChange(false); onSubmitted?.(); }
    catch { setError('Не удалось отправить обращение. Проверьте интернет и повторите попытку.'); }
    finally { setSubmitting(false); }
  };
  const addAttachments = (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files); const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
    if (incoming.some((file) => !allowed.has(file.type) || file.size > 8 * 1024 * 1024)) { setError('Подойдут JPG, PNG, WEBP или HEIC до 8 МБ.'); return; }
    setAttachments((current) => { const next = [...current, ...incoming].slice(0, 3); if (current.length + incoming.length > 3) setError('К обращению можно приложить до трёх изображений.'); return next; });
  };
  const sendReply = async (item: FeedbackItem) => {
    if (replyText.trim().length < 1 || sendingReply) return;
    setSendingReply(true); setError('');
    try {
      const body = replyText.trim(); const id = await sendFeedbackMessage(userId, item.id, body); const now = new Date().toISOString();
      setMyItems((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, status: 'in_progress', archivedAt: null, messages: [...candidate.messages, inlineMessage(now, id, body, false)] } : candidate));
      setReplyingId(null); setReplyText('');
    } catch { setError('Не удалось отправить сообщение. Проверьте интернет и повторите попытку.'); }
    finally { setSendingReply(false); }
  };
  const unreadCount = myItems.flatMap((item) => item.messages).filter((message) => message.isSupport && !message.seenAt).length;

  return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent className="flux-drawer flux-feedback-drawer">
    <DrawerHeader className="flux-drawer-header"><DrawerTitle>Сообщения FLUX</DrawerTitle><DrawerDescription>{view === 'compose' ? 'Напишите команде — контекст текущего экрана добавим автоматически.' : 'Диалоги по вашим обращениям и ответы команды FLUX.'}</DrawerDescription></DrawerHeader>
    <div className="flux-feedback-tabs" aria-label="Сообщения FLUX"><button type="button" className={view === 'inbox' ? 'is-active' : ''} onClick={() => setView('inbox')}><Bell /> Сообщения{unreadCount > 0 && <b>{unreadCount}</b>}</button><button type="button" className={view === 'compose' ? 'is-active' : ''} onClick={() => setView('compose')}><MessageCircle /> Новое сообщение</button></div>
    <div className="flux-feedback-body">
      {view === 'compose' ? <>
        <div className="flux-feedback-categories" aria-label="Тип обращения">{categories.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={category === item.id ? 'is-active' : ''} onClick={() => setCategory(item.id)}><Icon /><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>; })}</div>
        <label className="flux-feedback-message"><span>Расскажите подробнее</span><textarea value={message} maxLength={4000} placeholder="Например: после сканирования продукт не нашёлся…" onChange={(event) => setMessage(event.target.value)} /></label>
        <input ref={attachmentInput} className="flux-feedback-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={(event) => { addAttachments(event.target.files); event.currentTarget.value = ''; }} />
        <div className="flux-feedback-attachments"><button type="button" className="flux-feedback-attachment-trigger" onClick={() => attachmentInput.current?.click()}><ImagePlus /> Скриншот или фото</button><span>До 3 изображений по 8 МБ</span></div>
        {attachments.length > 0 && <div className="flux-feedback-attachment-list">{attachments.map((file, index) => <span key={`${file.name}-${file.lastModified}`}><Paperclip /> <b>{file.name}</b><button type="button" aria-label={`Удалить ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, candidateIndex) => candidateIndex !== index))}><X /></button></span>)}</div>}
        <div className="flux-feedback-meta"><span>Экран: {screen}</span><span>{message.length}/4000</span></div>{error && <p className="flux-feedback-error" role="alert">{error}</p>}
        <Button type="button" className="flux-feedback-submit" size="lg" disabled={!canSubmit} onClick={() => { void submit(); }}>{submitting ? <><LoaderCircle className="animate-spin" /> Отправляю…</> : <><MessageCircle /> Отправить</>}</Button>
      </> : historyLoading ? <div className="flux-feedback-history-state"><LoaderCircle className="animate-spin" /> Загружаем обращения…</div> : myItems.length ? <div className="flux-feedback-history-list">{myItems.map((item) => {
        const categoryItem = categories.find((candidate) => candidate.id === item.category) ?? categories[1];
        return <article className="flux-feedback-history-item" key={item.id}><header><span>{categoryItem.label}</span><time>{formatCreatedAt(item.createdAt)}</time></header><p>{item.message}</p><small className={`is-${item.status}`}>{statusLabels[item.status]}</small><Conversation messages={item.messages} viewer="author" />{replyingId === item.id ? <div className="flux-feedback-inline-composer"><textarea autoFocus value={replyText} maxLength={1200} placeholder="Уточните у поддержки…" onChange={(event) => setReplyText(event.target.value)} /><div><button type="button" onClick={() => { setReplyingId(null); setReplyText(''); }}>Отмена</button><button type="button" disabled={sendingReply || !replyText.trim()} onClick={() => { void sendReply(item); }}>{sendingReply ? 'Отправляю…' : 'Отправить'}</button></div></div> : <button type="button" className="flux-feedback-reply-trigger" onClick={() => { setReplyingId(item.id); setReplyText(''); }}>Уточнить у FLUX</button>}</article>;
      })}</div> : <div className="flux-feedback-history-state"><ClipboardList /> Пока нет отправленных обращений.</div>}
    </div>
  </DrawerContent></Drawer>;
}

type AdminFilter = 'active' | FeedbackStatus | 'archive';

function ProductSuggestionQueue({ userId }: { userId: string }) {
  const [items, setItems] = useState<ProductSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true); setError('');
    try { setItems(await loadProductSuggestions(userId)); }
    catch { setError('Не удалось загрузить предложения продуктов.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [userId]);
  const review = async (item: ProductSuggestion, decision: 'approved' | 'rejected') => {
    setUpdatingId(item.id); setError('');
    try {
      await reviewProductSuggestion(userId, item.id, decision);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch { setError('Решение не сохранилось. Попробуйте ещё раз.'); }
    finally { setUpdatingId(null); }
  };

  return <section className="flux-product-suggestions-admin">
    <div className="flux-admin-section-heading"><div><span className="flux-eyebrow">Общая база</span><h2>Предложения продуктов</h2></div><span>{items.length}</span></div>
    {loading ? <div className="flux-product-suggestions-state"><LoaderCircle className="animate-spin" /> Проверяем очередь…</div>
      : items.length ? <div className="flux-product-suggestions-list">{items.map((item) => <article key={item.id} className="flux-product-suggestion-card">
        <header><div><strong>{item.name}</strong><span>{item.brand ?? 'Без бренда'}{item.barcode ? ` · ${item.barcode}` : ''}</span></div><time>{formatCreatedAt(item.createdAt)}</time></header>
        <div className="flux-product-suggestion-macros"><span>{Math.round(item.kcalPer100)} <small>ккал</small></span><span>Б {formatMacro(item.proteinPer100)}</span><span>Ж {formatMacro(item.fatPer100)}</span><span>У {formatMacro(item.carbsPer100)}</span></div>
        <footer><span>на 100 {item.servingUnit === 'ml' ? 'мл' : 'г'} · {item.source === 'manual' ? 'вручную' : item.source.replace('_', ' ')}</span><div><button type="button" className="is-reject" disabled={updatingId === item.id} onClick={() => { void review(item, 'rejected'); }}>Отклонить</button><button type="button" className="is-approve" disabled={updatingId === item.id} onClick={() => { void review(item, 'approved'); }}>{updatingId === item.id ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />} В общую базу</button></div></footer>
      </article>)}</div> : <div className="flux-product-suggestions-state"><CheckCircle2 /> Очередь продуктов пуста.</div>}
    {error && <p className="flux-admin-inline-error" role="alert">{error}</p>}
  </section>;
}

export function AdminFeedbackScreen({ userId }: { userId: string }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState('');
  const [filter, setFilter] = useState<AdminFilter>('active'); const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [openingAttachment, setOpeningAttachment] = useState<string | null>(null); const [activeAttachmentUrl, setActiveAttachmentUrl] = useState<string | null>(null);
  const [closingItem, setClosingItem] = useState<FeedbackItem | null>(null); const [closingReply, setClosingReply] = useState(''); const [closingError, setClosingError] = useState('');
  const [replyingItem, setReplyingItem] = useState<FeedbackItem | null>(null); const [replyText, setReplyText] = useState(''); const [replyError, setReplyError] = useState('');

  const refresh = async (quiet = false, target = filter) => { quiet ? setRefreshing(true) : setLoading(true); setError(''); try { setItems(await loadAdminFeedback(userId, target === 'archive')); } catch { setError('Не удалось загрузить обращения. Проверьте соединение и обновите список.'); } finally { setLoading(false); setRefreshing(false); } };
  const selectFilter = (next: AdminFilter) => { setFilter(next); void refresh(false, next); };
  const openAttachment = async (path: string) => { setOpeningAttachment(path); setError(''); try { setActiveAttachmentUrl(await getFeedbackAttachmentUrl(userId, path)); } catch { setError('Не удалось открыть вложение. Попробуйте ещё раз.'); } finally { setOpeningAttachment(null); } };
  useEffect(() => { void refresh(false, 'active'); }, [userId]);
  useEffect(() => { if (!activeAttachmentUrl) return; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setActiveAttachmentUrl(null); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [activeAttachmentUrl]);
  useEffect(() => {
    const unreadIds = items.flatMap((item) => item.messages.filter((message) => !message.isSupport && !message.seenAt).map((message) => message.id));
    if (!unreadIds.length) return;
    setItems((current) => current.map((item) => ({ ...item, messages: item.messages.map((message) => unreadIds.includes(message.id) ? { ...message, seenAt: new Date().toISOString() } : message) })));
    void markFeedbackMessagesSeen(userId, unreadIds);
  }, [items, userId]);

  const visibleItems = useMemo(() => filter === 'archive' ? items : filter === 'active' ? items.filter((item) => item.status !== 'resolved') : items.filter((item) => item.status === filter), [filter, items]);
  const newCount = items.filter((item) => item.status === 'new').length; const inProgressCount = items.filter((item) => item.status === 'in_progress').length;
  const changeStatus = async (item: FeedbackItem, status: FeedbackStatus) => { if (status === item.status) return; if (status === 'resolved') { setClosingItem(item); setClosingReply(''); setClosingError(''); return; } setUpdatingId(item.id); try { await updateFeedbackStatus(userId, item.id, status); setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status } : candidate)); } catch { setError('Статус не изменился. Попробуйте ещё раз.'); } finally { setUpdatingId(null); } };
  const closeFeedback = async () => { if (!closingItem || closingReply.trim().length < 3) { setClosingError('Напишите коротко, что сделано или что проверить.'); return; } setUpdatingId(closingItem.id); setClosingError(''); try { const body = closingReply.trim(); await resolveFeedback(userId, closingItem.id, body); const now = new Date().toISOString(); setItems((current) => current.map((item) => item.id === closingItem.id ? { ...item, status: 'resolved', messages: [...item.messages, inlineMessage(now, crypto.randomUUID(), body, true)] } : item)); setClosingItem(null); } catch { setClosingError('Не удалось закрыть обращение. Попробуйте ещё раз.'); } finally { setUpdatingId(null); } };
  const sendSupportReply = async () => { if (!replyingItem || replyText.trim().length < 1) { setReplyError('Введите сообщение.'); return; } setUpdatingId(replyingItem.id); setReplyError(''); try { const body = replyText.trim(); const id = await sendFeedbackMessage(userId, replyingItem.id, body); const now = new Date().toISOString(); setItems((current) => current.map((item) => item.id === replyingItem.id ? { ...item, status: 'in_progress', messages: [...item.messages, inlineMessage(now, id, body, true)] } : item)); setReplyingItem(null); setReplyText(''); } catch { setReplyError('Не удалось отправить сообщение. Попробуйте ещё раз.'); } finally { setUpdatingId(null); } };
  const toggleArchive = async (item: FeedbackItem) => { setUpdatingId(item.id); try { if (filter === 'archive') await restoreFeedback(userId, item.id); else await archiveFeedback(userId, item.id); setItems((current) => current.filter((candidate) => candidate.id !== item.id)); } catch { setError(filter === 'archive' ? 'Не удалось восстановить обращение.' : 'Не удалось отправить обращение в архив.'); } finally { setUpdatingId(null); } };

  return <><section className="flux-admin-screen">
    <div className="flux-page-heading"><div className="flux-page-heading-row"><div><span className="flux-eyebrow">Администрирование</span><h1>Управление</h1></div><Button type="button" variant="secondary" size="icon" aria-label="Обновить обращения" onClick={() => { void refresh(true); }} disabled={refreshing}>{refreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button></div><p>{filter === 'archive' ? 'Архив обращений. Записи и вложения сохранены.' : 'Рабочая очередь и диалоги с пользователями FLUX.'}</p></div>
    <section className="flux-admin-stats"><div><span>Новые</span><strong>{newCount}</strong></div><div><span>В работе</span><strong>{inProgressCount}</strong></div></section>
    <ProductSuggestionQueue userId={userId} />
    <div className="flux-admin-filters" aria-label="Фильтр обращений">{([['active', 'Очередь'], ['new', 'Новые'], ['in_progress', 'В работе'], ['resolved', 'Готово'], ['archive', 'Архив']] as const).map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} onClick={() => selectFilter(id)}>{label}</button>)}</div>
    {loading ? <div className="flux-admin-state"><LoaderCircle className="animate-spin" /> Загружаем обращения…</div> : error && !items.length ? <div className="flux-admin-state is-error"><p>{error}</p><Button type="button" variant="secondary" onClick={() => { void refresh(); }}>Повторить</Button></div> : visibleItems.length ? <div className="flux-admin-list">{visibleItems.map((item) => { const categoryItem = categories.find((candidate) => candidate.id === item.category) ?? categories[1]; const Icon = categoryItem.icon; return <article className="flux-admin-feedback" key={item.id}><header><span className={`flux-admin-category is-${item.category}`}><Icon /> {categoryItem.label}</span><time>{formatCreatedAt(item.createdAt)}</time></header><p>{item.message}</p>{item.attachments.length > 0 && <div className="flux-admin-attachments">{item.attachments.map((path, index) => <button type="button" key={path} disabled={openingAttachment === path} onClick={() => { void openAttachment(path); }}><Paperclip /> {openingAttachment === path ? 'Открываю…' : `Вложение ${index + 1}`}</button>)}</div>}<Conversation messages={item.messages} viewer="support" /><footer><span>{item.reporterName}{item.reporterLogin ? ` · @${item.reporterLogin}` : ''}</span>{filter === 'archive' ? <button type="button" className="flux-admin-archive-button" disabled={updatingId === item.id} onClick={() => { void toggleArchive(item); }}><ArchiveRestore /> Вернуть</button> : <div className="flux-admin-actions"><button type="button" className="flux-admin-reply-button" disabled={updatingId === item.id} onClick={() => { setReplyingItem(item); setReplyText(''); setReplyError(''); }}>Ответить</button><select value={item.status} disabled={updatingId === item.id} onChange={(event) => { void changeStatus(item, event.target.value as FeedbackStatus); }} aria-label={`Статус обращения: ${item.message.slice(0, 40)}`}><option value="new">{statusLabels.new}</option><option value="in_progress">{statusLabels.in_progress}</option><option value="resolved">{statusLabels.resolved}</option></select>{item.status === 'resolved' && <button type="button" className="flux-admin-archive-button" disabled={updatingId === item.id} onClick={() => { void toggleArchive(item); }} aria-label="Архивировать обращение"><Archive /></button>}</div>}</footer></article>; })}</div> : <div className="flux-admin-state"><CheckCircle2 /> {filter === 'archive' ? 'Архив пока пуст.' : 'В этой очереди пока нет обращений.'}</div>}{error && items.length > 0 && <p className="flux-admin-inline-error" role="alert">{error}</p>}
  </section>
  <Drawer open={Boolean(replyingItem)} onOpenChange={(next) => { if (!next) setReplyingItem(null); }}><DrawerContent className="flux-drawer flux-feedback-reply-drawer"><DrawerHeader className="flux-drawer-header"><DrawerTitle>Сообщение пользователю</DrawerTitle><DrawerDescription>Диалог сохранится у этого обращения и будет виден автору.</DrawerDescription></DrawerHeader><div className="flux-feedback-reply-body"><label className="flux-feedback-message"><span>Ваш ответ</span><textarea autoFocus value={replyText} maxLength={1200} placeholder="Напишите пользователю…" onChange={(event) => setReplyText(event.target.value)} /></label>{replyError && <p className="flux-feedback-error" role="alert">{replyError}</p>}<Button type="button" className="flux-feedback-submit" size="lg" disabled={Boolean(replyingItem && updatingId === replyingItem.id)} onClick={() => { void sendSupportReply(); }}>{replyingItem && updatingId === replyingItem.id ? <><LoaderCircle className="animate-spin" /> Отправляю…</> : <><Send /> Отправить</>}</Button></div></DrawerContent></Drawer>
  <Drawer open={Boolean(closingItem)} onOpenChange={(next) => { if (!next) setClosingItem(null); }}><DrawerContent className="flux-drawer flux-feedback-reply-drawer"><DrawerHeader className="flux-drawer-header"><DrawerTitle>Закрыть с ответом</DrawerTitle><DrawerDescription>Автор увидит сообщение и сможет продолжить диалог.</DrawerDescription></DrawerHeader><div className="flux-feedback-reply-body"><label className="flux-feedback-message"><span>Что сделано или что проверить?</span><textarea autoFocus value={closingReply} maxLength={1200} placeholder="Например: поправили поиск по яйцам. Попробуйте обновить приложение и проверить ещё раз." onChange={(event) => setClosingReply(event.target.value)} /></label>{closingError && <p className="flux-feedback-error" role="alert">{closingError}</p>}<Button type="button" className="flux-feedback-submit" size="lg" disabled={Boolean(closingItem && updatingId === closingItem.id)} onClick={() => { void closeFeedback(); }}>{closingItem && updatingId === closingItem.id ? <><LoaderCircle className="animate-spin" /> Отправляю…</> : <><Send /> Отправить и закрыть</>}</Button></div></DrawerContent></Drawer>
  {activeAttachmentUrl && <div className="flux-attachment-viewer" role="dialog" aria-modal="true" aria-label="Просмотр вложения" onMouseDown={() => setActiveAttachmentUrl(null)}><div className="flux-attachment-viewer-card" onMouseDown={(event) => event.stopPropagation()}><button type="button" aria-label="Закрыть просмотр вложения" onClick={() => setActiveAttachmentUrl(null)}><X /></button><img src={activeAttachmentUrl} alt="Вложение к обратной связи" /></div></div>}
  </>;
}
