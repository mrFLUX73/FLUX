import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import type { FluxAccount } from './phonePasswordAuth';

const TURNSTILE_SCRIPT_ID = 'flux-turnstile-script';
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export type PhoneAuthMode = 'signup' | 'signin';

export type PhoneAuthSubmission = {
  mode: PhoneAuthMode;
  displayName: string;
  login: string;
  phone: string;
  password: string;
  importGuestDiary: boolean;
  captchaToken: string;
};

type TurnstileOptions = {
  sitekey: string;
  action?: string;
  appearance?: 'always' | 'execute' | 'interaction-only';
  execution?: 'render' | 'execute';
  language?: string;
  size?: 'normal' | 'compact' | 'flexible';
  theme?: 'light' | 'dark' | 'auto';
  callback: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'unsupported-callback'?: () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
export const isTurnstileConfigured = Boolean(turnstileSiteKey);

let turnstileScriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Защитная проверка загружается слишком долго')), 15_000);
    const finish = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile не загрузился'));
    };
    const fail = () => {
      window.clearTimeout(timeout);
      reject(new Error('Не удалось загрузить защитную проверку'));
    };
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', fail, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });
    document.head.append(script);
  }).catch((error) => {
    document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
    turnstileScriptPromise = null;
    throw error;
  });

  return turnstileScriptPromise;
}

function normalizeFullName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function isValidFullName(value: string) {
  const parts = normalizeFullName(value).split(' ');
  return parts.length >= 2
    && parts.every((part) => /^[\p{L}][\p{L}'’\-]*$/u.test(part));
}

function normalizeLogin(value: string) {
  return value.trim().toLocaleLowerCase('en-US');
}

function nationalPhoneDigits(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.length > 10 && (digits.startsWith('7') || digits.startsWith('8'))) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}

function formatNationalPhone(value: string) {
  const groups = [value.slice(0, 3), value.slice(3, 6), value.slice(6, 8), value.slice(8, 10)].filter(Boolean);
  if (!groups.length) return '';
  if (groups.length === 1) return `(${groups[0]}`;
  return `(${groups[0]}) ${groups[1]}${groups[2] ? `-${groups[2]}` : ''}${groups[3] ? `-${groups[3]}` : ''}`;
}

function TurnstileWidget({
  action,
  onError,
  onToken,
}: {
  action: string;
  onError: (message: string) => void;
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !turnstileSiteKey) return;

    let active = true;
    let api: TurnstileApi | null = null;
    let widgetId: string | null = null;

    loadTurnstile()
      .then((loadedApi) => {
        if (!active) return;
        api = loadedApi;
        widgetId = loadedApi.render(container, {
          sitekey: turnstileSiteKey,
          action,
          appearance: 'interaction-only',
          execution: 'render',
          language: 'ru',
          size: 'flexible',
          theme: 'light',
          callback: (token) => { if (active) onToken(token); },
          'error-callback': () => { if (active) onError('Проверка не загрузилась. Проверьте сеть или блокировщик рекламы.'); },
          'expired-callback': () => { if (active && api && widgetId) api.reset(widgetId); },
          'unsupported-callback': () => { if (active) onError('Этот браузер не поддерживает защитную проверку.'); },
        });
      })
      .catch((error: unknown) => {
        if (active) onError(error instanceof Error ? error.message : 'Не удалось запустить защитную проверку');
      });

    return () => {
      active = false;
      if (api && widgetId) api.remove(widgetId);
    };
  }, [action, onError, onToken]);

  return <div className="flux-turnstile-widget" ref={containerRef} />;
}

export function PhonePasswordAuthGate({
  guestDiaryEntryCount,
  initialMode = 'signup',
  open,
  onAuthenticated,
  onOpenChange,
}: {
  guestDiaryEntryCount: number;
  initialMode?: PhoneAuthMode;
  open: boolean;
  onAuthenticated: (submission: PhoneAuthSubmission) => Promise<FluxAccount>;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<PhoneAuthMode>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [login, setLogin] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [password, setPassword] = useState('');
  const [importGuestDiary, setImportGuestDiary] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [stage, setStage] = useState<'form' | 'captcha'>('form');
  const [error, setError] = useState('');
  const [isCaptchaPending, setIsCaptchaPending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const submissionRef = useRef<Omit<PhoneAuthSubmission, 'captchaToken'> | null>(null);
  const authInFlightRef = useRef(false);
  const isBusy = isCaptchaPending || isSubmitting;

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setStage('form');
    setError('');
    setIsCaptchaPending(false);
    setIsSubmitting(false);
    setImportGuestDiary(false);
    submissionRef.current = null;
    authInFlightRef.current = false;
  }, [initialMode, open]);

  function selectMode(nextMode: PhoneAuthMode) {
    setMode(nextMode);
    setStage('form');
    setError('');
    setIsCaptchaPending(false);
    setIsSubmitting(false);
    setPassword('');
    setImportGuestDiary(false);
    submissionRef.current = null;
    authInFlightRef.current = false;
  }

  function prepareSubmission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = normalizeFullName(displayName);
    const normalizedLogin = normalizeLogin(login);
    if (mode === 'signup' && (!isValidFullName(normalizedName) || normalizedName.length > 80)) {
      setError('Укажите имя и фамилию, например «Данил Клюшненков».');
      return;
    }
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalizedLogin)) {
      setError('Логин: от 3 до 32 латинских букв, цифр, точек, дефисов или подчёркиваний.');
      return;
    }
    if (mode === 'signup' && !/^9\d{9}$/.test(phoneDigits)) {
      setError('Введите 10 цифр российского мобильного номера.');
      return;
    }
    if (password.length < 8) {
      setError('Пароль должен содержать не меньше 8 символов.');
      return;
    }

    setError('');
    setIsCaptchaPending(true);
    setIsSubmitting(false);
    authInFlightRef.current = false;
    submissionRef.current = {
      mode,
      displayName: normalizedName,
      login: normalizedLogin,
      phone: mode === 'signup' ? `+7${phoneDigits}` : '',
      password,
      importGuestDiary: mode === 'signup' && guestDiaryEntryCount > 0 && importGuestDiary,
    };
    setStage('captcha');
    setRetryKey((value) => value + 1);
  }

  const handleTurnstileError = useCallback((message: string) => {
    authInFlightRef.current = false;
    setIsCaptchaPending(false);
    setIsSubmitting(false);
    setError(message);
  }, []);

  const handleToken = useCallback(async (captchaToken: string) => {
    const pending = submissionRef.current;
    if (!pending || authInFlightRef.current) return;
    authInFlightRef.current = true;
    setIsCaptchaPending(false);
    setIsSubmitting(true);
    setError('');
    try {
      await onAuthenticated({ ...pending, captchaToken });
      onOpenChange(false);
      setPassword('');
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Не удалось продолжить.');
      setStage('form');
      setRetryKey((value) => value + 1);
    } finally {
      authInFlightRef.current = false;
      setIsCaptchaPending(false);
      setIsSubmitting(false);
    }
  }, [onAuthenticated, onOpenChange]);

  function returnToForm() {
    authInFlightRef.current = false;
    submissionRef.current = null;
    setIsCaptchaPending(false);
    setIsSubmitting(false);
    setError('');
    setStage('form');
    setRetryKey((value) => value + 1);
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="flux-drawer flux-auth-drawer">
        <DrawerHeader className="flux-drawer-header">
          <span className="flux-sync-shield"><ShieldCheck aria-hidden="true" /></span>
          <DrawerTitle>{mode === 'signup' ? 'Создать профиль' : 'Войти в FLUX'}</DrawerTitle>
          <DrawerDescription>
            {mode === 'signup'
              ? 'Ваш дневник и тренировки будут доступны после входа на другом устройстве.'
              : 'Введите логин и пароль, указанные при регистрации.'}
          </DrawerDescription>
        </DrawerHeader>

        <div className="flux-auth-tabs" role="tablist" aria-label="Регистрация или вход">
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} disabled={isBusy} onClick={() => selectMode('signup')}>Регистрация</button>
          <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'is-active' : ''} disabled={isBusy} onClick={() => selectMode('signin')}>Вход</button>
        </div>

        {stage === 'form' ? (
          <form className="flux-auth-form" onSubmit={prepareSubmission} noValidate>
            {mode === 'signup' && (
              <label className="flux-auth-field">
                <span>Имя и фамилия</span>
                <Input
                  autoCapitalize="words"
                  autoComplete="name"
                  enterKeyHint="next"
                  maxLength={80}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Данил Клюшненков"
                  value={displayName}
                />
              </label>
            )}

            <label className="flux-auth-field">
              <span>Логин</span>
              <Input
                autoCapitalize="none"
                autoComplete="username"
                enterKeyHint="next"
                maxLength={32}
                onChange={(event) => setLogin(event.target.value.toLocaleLowerCase('en-US').replace(/[^a-z0-9._-]/g, ''))}
                placeholder="danil73"
                spellCheck={false}
                value={login}
              />
            </label>

            {mode === 'signup' && (
              <label className="flux-auth-field">
                <span>Номер телефона <small>только для профиля</small></span>
                <span className="flux-phone-control">
                  <b aria-hidden="true">+7</b>
                  <Input
                    aria-label="Номер телефона после плюс семь"
                    autoComplete="tel-national"
                    enterKeyHint="next"
                    inputMode="numeric"
                    onChange={(event) => setPhoneDigits(nationalPhoneDigits(event.target.value))}
                    placeholder="(999) 123-45-67"
                    type="tel"
                    value={formatNationalPhone(phoneDigits)}
                  />
                </span>
              </label>
            )}

            <label className="flux-auth-field">
              <span>Пароль</span>
              <span className="flux-password-control">
                <Input
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  enterKeyHint="done"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Минимум 8 символов"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </span>
            </label>

            {mode === 'signup' && guestDiaryEntryCount > 0 && (
              <label className="flux-guest-import">
                <input
                  checked={importGuestDiary}
                  onChange={(event) => setImportGuestDiary(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>Перенести гостевой дневник</strong>
                  <small>{guestDiaryEntryCount} {guestDiaryEntryCount % 10 === 1 && guestDiaryEntryCount % 100 !== 11 ? 'запись' : guestDiaryEntryCount % 10 >= 2 && guestDiaryEntryCount % 10 <= 4 && (guestDiaryEntryCount % 100 < 12 || guestDiaryEntryCount % 100 > 14) ? 'записи' : 'записей'} будут добавлены только в новый профиль.</small>
                </span>
              </label>
            )}

            {error && <p className="flux-auth-error" role="alert">{error}</p>}
            <Button className="flux-auth-submit" size="lg" type="submit">
              {mode === 'signup' ? 'Создать профиль' : 'Войти'}
            </Button>
            <p className="flux-auth-note">Нажимая кнопку, вы соглашаетесь сохранить данные профиля в Supabase.</p>
          </form>
        ) : (
          <div className="flux-auth-verification" aria-busy={isBusy}>
            <div className="flux-auth-challenge">
              {isBusy && <div className="flux-turnstile-progress" aria-live="polite"><LoaderCircle className="is-spinning" /> {isSubmitting ? (mode === 'signup' ? 'Создаём профиль…' : 'Входим…') : 'Проверяем защиту…'}</div>}
              {isCaptchaPending && (
                <TurnstileWidget
                  key={retryKey}
                  action={mode === 'signup' ? 'login_signup' : 'login_signin'}
                  onError={handleTurnstileError}
                  onToken={handleToken}
                />
              )}
            </div>
            {error && <p className="flux-auth-error" role="alert">{error}</p>}
            {!isBusy && <button className="flux-text-button" type="button" onClick={returnToForm}>Изменить данные</button>}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
