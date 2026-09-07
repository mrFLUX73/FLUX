import type { User } from '@supabase/supabase-js';

import { getSupabaseClient, getSupabaseClientForUser } from '../../lib/supabase';

export type FluxAccount = {
  id: string;
  displayName: string;
  login: string;
  phone: string;
  isAdmin: boolean;
};

export type LoginPasswordCredentials = {
  login: string;
  password: string;
  captchaToken: string;
};

export type RegistrationCredentials = LoginPasswordCredentials & {
  displayName: string;
  phone: string;
};

const LOGIN_DOMAIN = 'flux.local';
const ACCOUNT_CACHE_KEY = 'flux.account.v1';

export function loadCachedAccount(): FluxAccount | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACCOUNT_CACHE_KEY) ?? 'null') as Partial<FluxAccount> | null;
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null;
    return {
      id: parsed.id,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
      login: typeof parsed.login === 'string' ? parsed.login : '',
      phone: typeof parsed.phone === 'string' ? parsed.phone : '',
      isAdmin: parsed.isAdmin === true,
    };
  } catch {
    return null;
  }
}

export function cacheAccount(account: FluxAccount) {
  try {
    window.localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(account));
  } catch {
    // The active session still works when private storage is unavailable.
  }
}

export function clearCachedAccount() {
  try {
    window.localStorage.removeItem(ACCOUNT_CACHE_KEY);
  } catch {
    // Nothing else to clear when private storage is unavailable.
  }
}

function technicalEmail(login: string) {
  return `${login}@${LOGIN_DOMAIN}`;
}

function friendlyAuthError(error: unknown, mode: 'signin' | 'signup') {
  const message = error instanceof Error ? error.message.toLocaleLowerCase('ru-RU') : '';

  if (message.includes('invalid login credentials')) {
    return 'Неверный логин или пароль.';
  }
  if (message.includes('already registered') || message.includes('already exists')) {
    return 'Такой логин уже занят. Попробуйте другой или войдите.';
  }
  if (message.includes('password')) {
    return 'Пароль не подходит требованиям безопасности.';
  }
  if (message.includes('captcha')) {
    return 'Защитная проверка истекла. Попробуйте ещё раз.';
  }
  if (message.includes('confirmation') || message.includes('confirm')) {
    return 'В Supabase пока включено подтверждение технической почты.';
  }

  return mode === 'signin'
    ? 'Не удалось войти. Проверьте данные и соединение.'
    : 'Не удалось создать профиль. Попробуйте ещё раз.';
}

function fallbackAccount(user: User): FluxAccount {
  const login = user.email?.endsWith(`@${LOGIN_DOMAIN}`)
    ? user.email.slice(0, -(`@${LOGIN_DOMAIN}`.length))
    : '';
  return {
    id: user.id,
    displayName: String(user.user_metadata?.display_name ?? '').trim(),
    login,
    phone: '',
    isAdmin: false,
  };
}

function isInvalidSessionError(error: unknown) {
  const status = Number((error as { status?: unknown })?.status);
  const message = error instanceof Error ? error.message.toLocaleLowerCase('en-US') : '';
  return status === 401 || status === 403 || /invalid.*jwt|jwt.*expired|session.*missing|user.*not.*found/.test(message);
}

async function accountFromVerifiedUser(user: User, fallbackName = ''): Promise<FluxAccount> {
  const client = await getSupabaseClientForUser(user.id);

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('display_name,login,phone_e164')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) throw profileError;

  const { data: role, error: roleError } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (roleError) throw roleError;

  const displayName = String(profile?.display_name ?? fallbackName).trim();
  const fallbackLogin = user.email?.endsWith(`@${LOGIN_DOMAIN}`)
    ? user.email.slice(0, -(`@${LOGIN_DOMAIN}`.length))
    : '';
  return {
    id: user.id,
    displayName,
    login: String(profile?.login ?? fallbackLogin),
    phone: String(profile?.phone_e164 ?? ''),
    isAdmin: role?.role === 'admin',
  };
}

async function accountFromUser(userId: string, fallbackName = ''): Promise<FluxAccount> {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase не настроен');
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (data.user?.id !== userId) throw new Error('Сессия пользователя изменилась');
  return accountFromVerifiedUser(data.user, fallbackName);
}

export async function getCurrentAccount(): Promise<FluxAccount | null> {
  const client = await getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const user = data.session?.user;
  if (!user || user.is_anonymous) return null;

  const { data: verifiedData, error: verificationError } = await client.auth.getUser();
  if (verificationError) {
    return isInvalidSessionError(verificationError) ? null : fallbackAccount(user);
  }
  if (!verifiedData.user || verifiedData.user.id !== user.id) return null;

  try {
    return await accountFromVerifiedUser(verifiedData.user, String(user.user_metadata?.display_name ?? ''));
  } catch {
    // The persisted Auth session still identifies the storage owner when the
    // profile request is temporarily offline. Never fall back to guest data.
    return fallbackAccount(verifiedData.user);
  }
}

export async function registerWithLogin(credentials: RegistrationCredentials) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase не настроен');

  try {
    const { data: existingSession } = await client.auth.getSession();
    if (existingSession.session?.user.is_anonymous) {
      await client.auth.signOut({ scope: 'local' });
    }

    const { data, error } = await client.auth.signUp({
      email: technicalEmail(credentials.login),
      password: credentials.password,
      options: {
        captchaToken: credentials.captchaToken,
        data: { display_name: credentials.displayName, login: credentials.login },
      },
    });
    if (error) throw error;
    if (!data.user) throw new Error('Supabase не создал пользователя');
    if (data.user.identities?.length === 0) throw new Error('User already registered');
    if (!data.session) {
      throw new Error('Включено обязательное подтверждение email');
    }

    const profileClient = await getSupabaseClientForUser(data.user.id);
    const { error: profileError } = await profileClient
      .from('profiles')
      .update({
        display_name: credentials.displayName,
        login: credentials.login,
        phone_e164: credentials.phone,
        onboarding_completed: true,
      })
      .eq('id', data.user.id);
    if (profileError) throw profileError;

    return await accountFromUser(data.user.id, credentials.displayName);
  } catch (error) {
    throw new Error(friendlyAuthError(error, 'signup'));
  }
}

export async function signInWithLogin(credentials: LoginPasswordCredentials) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase не настроен');

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: technicalEmail(credentials.login),
      password: credentials.password,
      options: { captchaToken: credentials.captchaToken },
    });
    if (error) throw error;
    if (!data.user) throw new Error('Supabase не вернул пользователя');

    return await accountFromUser(data.user.id, String(data.user.user_metadata?.display_name ?? ''));
  } catch (error) {
    throw new Error(friendlyAuthError(error, 'signin'));
  }
}
