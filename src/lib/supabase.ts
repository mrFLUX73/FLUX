import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();

export async function invokeSupabaseFunction<T>(
  functionName: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const client = await getSupabaseClient();
  if (!client || !supabaseUrl || !supabasePublishableKey) throw new Error('Supabase не настроен');

  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.user.is_anonymous) throw new Error('Для серверного поиска требуется вход');

  const response = await fetch(`${supabaseUrl}/functions/v1/${encodeURIComponent(functionName)}`, {
    method: 'POST',
    signal,
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);
export const isAnonymousAuthEnabled = import.meta.env.VITE_SUPABASE_ANONYMOUS_AUTH_ENABLED === 'true';

let clientPromise: Promise<SupabaseClient | null> | null = null;

export class SupabaseAuthScopeError extends Error {
  constructor() {
    super('Сессия пользователя изменилась');
    this.name = 'SupabaseAuthScopeError';
  }
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => createClient(
      supabaseUrl!,
      supabasePublishableKey!,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      },
    ));
  }
  return clientPromise;
}

export async function getSupabaseClientForUser(expectedUserId: string) {
  const client = await getSupabaseClient();
  if (!client || !supabaseUrl || !supabasePublishableKey) throw new Error('Supabase не настроен');

  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session || session.user.is_anonymous || session.user.id !== expectedUserId) {
    throw new SupabaseAuthScopeError();
  }

  // Freeze this short-lived data client to the JWT that belongs to the
  // expected user. A login in another tab cannot make an in-flight RPC run as
  // the newly active account.
  const accessToken = session.access_token;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(supabaseUrl, supabasePublishableKey, {
    accessToken: async () => accessToken,
  });
}
