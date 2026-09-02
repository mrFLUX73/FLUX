import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

const TURNSTILE_SCRIPT_ID = 'flux-turnstile-script';
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileOptions = {
  sitekey: string;
  action?: string;
  appearance?: 'always' | 'execute' | 'interaction-only';
  execution?: 'render' | 'execute';
  language?: string;
  size?: 'normal' | 'compact' | 'flexible';
  theme?: 'light' | 'dark' | 'auto';
  callback: (token: string) => void;
  'error-callback'?: (errorCode?: string) => void;
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

function TurnstileWidget({ onError, onToken }: { onError: (message: string) => void; onToken: (token: string) => void }) {
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
          action: 'anonymous_signin',
          appearance: 'interaction-only',
          execution: 'render',
          language: 'ru',
          size: 'flexible',
          theme: 'light',
          callback: (token) => { if (active) onToken(token); },
          'error-callback': () => { if (active) onError('Проверка не загрузилась. Проверьте сеть или блокировщик рекламы.'); },
          'expired-callback': () => {
            if (active && api && widgetId) api.reset(widgetId);
          },
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
  }, [onError, onToken]);

  return <div className="flux-turnstile-widget" ref={containerRef} />;
}

export function AnonymousSyncGate({
  open,
  onOpenChange,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (token: string) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setError('');
      setIsVerifying(false);
      verifyingRef.current = false;
    }
  }, [open]);

  const handleError = useCallback((message: string) => setError(message), []);

  const handleToken = useCallback(async (token: string) => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setIsVerifying(true);
    setError('');
    try {
      await onVerified(token);
    } catch {
      setError('Не удалось подключить синхронизацию. Попробуйте ещё раз.');
      setIsVerifying(false);
      verifyingRef.current = false;
      setRetryKey((value) => value + 1);
    }
  }, [onVerified]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="flux-drawer flux-sync-drawer">
        <DrawerHeader className="flux-drawer-header">
          <span className="flux-sync-shield"><ShieldCheck aria-hidden="true" /></span>
          <DrawerTitle>Подключить синхронизацию</DrawerTitle>
          <DrawerDescription>Быстрая проверка защищает дневник от автоматических регистраций.</DrawerDescription>
        </DrawerHeader>
        <div className="flux-turnstile-area">
          {isVerifying ? (
            <div className="flux-turnstile-progress"><LoaderCircle className="is-spinning" /> Сохраняем безопасную сессию…</div>
          ) : (
            <TurnstileWidget key={retryKey} onError={handleError} onToken={handleToken} />
          )}
          {error && <p className="flux-turnstile-error" role="alert">{error}</p>}
        </div>
        {error && !isVerifying && <Button variant="secondary" onClick={() => { setError(''); setRetryKey((value) => value + 1); }}>Повторить проверку</Button>}
      </DrawerContent>
    </Drawer>
  );
}
