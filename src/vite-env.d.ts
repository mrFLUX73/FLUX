/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_ANONYMOUS_AUTH_ENABLED?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __FLUX_APP_VERSION__: string;
declare const __FLUX_BUILD_NUMBER__: string;
declare const __FLUX_COMMIT_SHA__: string;
declare const __FLUX_BUILD_DATE__: string;
