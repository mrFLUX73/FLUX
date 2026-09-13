import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Flashlight, FlashlightOff, Link, LoaderCircle, Share2, UserRound, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { startTrainerInviteQrScanner, type BarcodeScannerSession } from '../nutrition/barcodeScanner';
import { trainerInviteUrl } from './invite';
import type { TrainerInvitePreview } from './repository';

async function copyText(value: string) {
  if (!navigator.clipboard?.writeText) throw new Error('copy unavailable');
  await navigator.clipboard.writeText(value);
}

export function TrainerInviteDrawer({ open, onOpenChange, trainerName, code, onNotice }: { open: boolean; onOpenChange: (open: boolean) => void; trainerName: string; code: string | null; onNotice: (title: string, description: string, type?: 'success' | 'error' | 'info') => void }) {
  const url = useMemo(() => code ? trainerInviteUrl(code) : '', [code]);
  const [qr, setQr] = useState('');
  useEffect(() => {
    let active = true;
    setQr('');
    if (!open || !url) return;
    void QRCode.toDataURL(url, { width: 620, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#102018', light: '#ffffff' } })
      .then((value) => { if (active) setQr(value); })
      .catch(() => { if (active) onNotice('Не удалось создать QR', 'Попробуйте ещё раз или используйте код вручную.', 'error'); });
    return () => { active = false; };
  }, [onNotice, open, url]);
  const share = async () => {
    if (!url) return;
    const text = 'Приглашаю вас в FLUX. Откройте ссылку, чтобы подключиться ко мне как к тренеру.';
    try {
      if (navigator.share) await navigator.share({ title: 'Приглашение в FLUX', text, url });
      else { await copyText(url); onNotice('Ссылка скопирована', 'Отправьте её клиенту удобным способом.', 'success'); }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onNotice('Не удалось поделиться', 'Попробуйте скопировать ссылку позже.', 'error');
    }
  };
  return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent className="flux-drawer flux-trainer-invite-drawer"><DrawerHeader className="flux-drawer-header"><DrawerTitle>Пригласить клиента</DrawerTitle><DrawerDescription>Персональное приглашение FLUX</DrawerDescription></DrawerHeader><div className="flux-trainer-invite-body">{qr ? <img className="flux-trainer-invite-qr" src={qr} alt={`QR-приглашение тренера ${trainerName}`} /> : <div className="flux-trainer-invite-qr is-loading"><LoaderCircle className="is-spinning" /></div>}<section><small>Ваше приглашение</small><strong>{trainerName}</strong><p>Клиент может отсканировать QR камерой телефона или внутри FLUX.</p></section><Button type="button" onClick={() => { void share(); }} disabled={!url}><Share2 /> Поделиться приглашением</Button><div className="flux-trainer-invite-code"><span><small>Код для ручного ввода</small><strong>{code ?? 'Создаём код…'}</strong></span><button type="button" aria-label="Скопировать код тренера" disabled={!code} onClick={() => { if (code) void copyText(code).then(() => onNotice('Код скопирован', 'Его можно отправить клиенту вручную.', 'success')).catch(() => onNotice('Не удалось скопировать', 'Выделите код и скопируйте его вручную.', 'error')); }}><Copy /></button></div>{url && <button type="button" className="flux-trainer-invite-link" onClick={() => { void copyText(url).then(() => onNotice('Ссылка скопирована', 'Отправьте её клиенту удобным способом.', 'success')).catch(() => onNotice('Не удалось скопировать', 'Попробуйте системное меню «Поделиться».', 'error')); }}><Link /> Скопировать ссылку</button>}</div></DrawerContent></Drawer>;
}

export function TrainerInviteConfirmationDrawer({ open, code, preview, loading, error, onOpenChange, onConfirm, onCancel }: { open: boolean; code: string | null; preview: TrainerInvitePreview | null; loading: boolean; error: string; onOpenChange: (open: boolean) => void; onConfirm: () => void; onCancel: () => void }) {
  const state = preview?.connectionState;
  const title = state === 'already_active' ? 'Вы уже подключены' : state === 'already_pending' ? 'Заявка уже отправлена' : state === 'active_other' ? 'Сначала завершите текущую связь' : 'Подключиться к тренеру';
  const description = state === 'already_active' ? `Вы уже подключены к ${preview?.trainerName ?? 'этому тренеру'}.` : state === 'already_pending' ? `Ожидаем подтверждения от ${preview?.trainerName ?? 'тренера'}.` : state === 'active_other' ? 'Чтобы подключиться к другому тренеру, сначала завершите текущую связь.' : 'Отправить запрос на подключение?';
  return <Drawer open={open} onOpenChange={(next) => { if (!next) onCancel(); else onOpenChange(next); }}><DrawerContent className="flux-drawer flux-trainer-invite-confirm"><DrawerHeader className="flux-drawer-header"><DrawerTitle>{title}</DrawerTitle><DrawerDescription>{loading ? 'Проверяем приглашение…' : description}</DrawerDescription></DrawerHeader><div className="flux-trainer-invite-confirm-body">{loading ? <LoaderCircle className="is-spinning" /> : error ? <p className="flux-trainer-invite-error">{error}</p> : preview && <><span className="flux-trainer-invite-person"><UserRound /><i><small>Тренер FLUX</small><strong>{preview.trainerName}</strong></i></span>{state === 'available' && <p>Заявка появится у тренера. Подключение начнётся только после его подтверждения.</p>}</>}<div className="flux-trainer-invite-actions">{state === 'available' && !loading && !error && <Button type="button" onClick={onConfirm} disabled={!code}><Check /> Подключиться</Button>}<Button type="button" variant={state === 'available' ? 'ghost' : 'secondary'} onClick={onCancel}>{state === 'available' ? 'Отмена' : 'Закрыть'}</Button></div></div></DrawerContent></Drawer>;
}

export function TrainerQrScannerDrawer({ open, onOpenChange, onScanned, onNotice }: { open: boolean; onOpenChange: (open: boolean) => void; onScanned: (value: string) => void; onNotice: (title: string, description: string, type?: 'success' | 'error' | 'info') => void }) {
  const videoRef = useRef<HTMLVideoElement>(null); const sessionRef = useRef<BarcodeScannerSession | null>(null);
  const onScannedRef = useRef(onScanned); const onNoticeRef = useRef(onNotice);
  const runRef = useRef(0);
  const [state, setState] = useState<'permission' | 'requesting' | 'scanning' | 'error'>('permission'); const [message, setMessage] = useState(''); const [torch, setTorch] = useState(false); const [supportsTorch, setSupportsTorch] = useState(false);
  useEffect(() => { onScannedRef.current = onScanned; onNoticeRef.current = onNotice; }, [onNotice, onScanned]);
  const stopCamera = () => {
    runRef.current += 1;
    sessionRef.current?.stop(); sessionRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; }
  };
  useEffect(() => {
    if (open) { setState('permission'); setMessage(''); setTorch(false); setSupportsTorch(false); }
    return () => stopCamera();
  }, [open]);
  const startCamera = async () => {
    // This handler deliberately begins getUserMedia in the tap itself. Safari
    // and Home Screen PWAs can reject or suspend camera requests begun later
    // from a React effect after the user gesture has finished.
    stopCamera();
    const run = runRef.current;
    setState('requesting'); setMessage(''); setTorch(false); setSupportsTorch(false);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setState('error'); setMessage('Камера доступна только в защищённой версии FLUX. Откройте сайт по HTTPS.'); return; }
    const video = videoRef.current;
    if (!video) { setState('error'); setMessage('Не удалось подготовить экран камеры. Закройте окно и попробуйте снова.'); return; }
    try {
      const session = await startTrainerInviteQrScanner({ video, onQr: (value) => { if (run === runRef.current) { sessionRef.current = null; onScannedRef.current(value); } }, onReady: (ready) => { if (run === runRef.current) { setState('scanning'); setSupportsTorch(ready.supportsTorch); } } });
      if (run !== runRef.current) session.stop(); else sessionRef.current = session;
    } catch (error) {
      if (run !== runRef.current) return;
      const name = error instanceof DOMException ? error.name : '';
      setState('error');
      setMessage(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'FLUX не получил доступ к камере. Разрешите доступ в настройках Safari или iPhone и попробуйте снова.'
        : name === 'NotFoundError' || name === 'DevicesNotFoundError'
          ? 'На устройстве не найдена доступная камера.'
          : name === 'NotReadableError' || name === 'TrackStartError'
            ? 'Камера занята другим приложением. Закройте его и попробуйте снова.'
            : 'Не удалось получить изображение с камеры. Попробуйте снова или используйте код тренера вручную.');
    }
  };
  const toggleTorch = async () => { try { await sessionRef.current?.setTorch(!torch); setTorch((value) => !value); } catch { onNoticeRef.current('Не удалось включить подсветку', 'Попробуйте изменить освещение.', 'info'); } };
  return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent className="flux-drawer flux-trainer-qr-scanner"><DrawerHeader className="flux-drawer-header"><DrawerTitle>Сканировать QR тренера</DrawerTitle><DrawerDescription>{state === 'scanning' ? 'Наведите камеру на приглашение FLUX.' : 'FLUX запросит доступ к камере только после вашего нажатия.'}</DrawerDescription></DrawerHeader><div className="flux-trainer-qr-camera"><video ref={videoRef} autoPlay muted playsInline />{state === 'permission' && <span>Нажмите «Включить камеру», затем разрешите доступ в системном окне.</span>}{state === 'requesting' && <span><LoaderCircle className="is-spinning" /> Разрешите доступ к камере…</span>}{state === 'error' && <p>{message}</p>}{state === 'scanning' && <i aria-hidden="true" />}</div>{state !== 'scanning' && <Button type="button" className="flux-trainer-qr-start" onClick={() => { void startCamera(); }}>{state === 'error' ? 'Попробовать снова' : 'Включить камеру'}</Button>}{supportsTorch && state === 'scanning' && <Button type="button" variant="secondary" size="sm" className="flux-trainer-qr-torch" onClick={() => { void toggleTorch(); }}>{torch ? <FlashlightOff /> : <Flashlight />}{torch ? 'Выключить подсветку' : 'Включить подсветку'}</Button>}<Button type="button" variant="ghost" className="flux-trainer-qr-close" onClick={() => onOpenChange(false)}><X /> Закрыть</Button></DrawerContent></Drawer>;
}

export function TrainerRevokeConfirmationDrawer({ open, link, userId, saving, onOpenChange, onConfirm }: { open: boolean; link: { id: string; trainerId: string; trainerName: string; clientName: string } | null; userId: string; saving: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const byTrainer = link?.trainerId === userId; const counterpart = byTrainer ? link?.clientName : link?.trainerName;
  return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent className="flux-drawer flux-trainer-revoke-confirm"><DrawerHeader className="flux-drawer-header"><DrawerTitle>{byTrainer ? `Завершить работу с ${counterpart ?? 'клиентом'}?` : `Отключиться от ${counterpart ?? 'тренера'}?`}</DrawerTitle><DrawerDescription>{byTrainer ? 'Клиент больше не будет доступен в вашем кабинете и активном чате.' : `${counterpart ?? 'Тренер'} больше не сможет видеть ваши данные как тренер и писать вам как активному клиенту.`}</DrawerDescription></DrawerHeader><div className="flux-trainer-invite-actions"><Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Отмена</Button><Button type="button" onClick={onConfirm} disabled={saving}>{saving ? <LoaderCircle className="is-spinning" /> : 'Завершить связь'}</Button></div></DrawerContent></Drawer>;
}
