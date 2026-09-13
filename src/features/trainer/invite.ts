export const trainerInvitePattern = /^TR-[A-Z0-9]{8}$/;
const pendingInviteStorageKey = 'flux:pending-trainer-invite';

export function normalizeTrainerInvite(value: string | null | undefined) {
  const code = value?.trim().toUpperCase() ?? '';
  return trainerInvitePattern.test(code) ? code : null;
}

export function trainerInviteUrl(code: string) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  base.searchParams.set('invite', code);
  return base.toString();
}

export function readInviteFromLocation() {
  return normalizeTrainerInvite(new URLSearchParams(window.location.search).get('invite'));
}

export function savePendingTrainerInvite(code: string) {
  sessionStorage.setItem(pendingInviteStorageKey, JSON.stringify({ code, savedAt: Date.now() }));
}

export function readPendingTrainerInvite() {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingInviteStorageKey) ?? '{}') as { code?: string; savedAt?: number };
    return typeof value.savedAt === 'number' && Date.now() - value.savedAt < 24 * 60 * 60 * 1000
      ? normalizeTrainerInvite(value.code)
      : null;
  } catch {
    return null;
  }
}

export function clearPendingTrainerInvite() {
  sessionStorage.removeItem(pendingInviteStorageKey);
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function parseTrainerInviteQr(value: string) {
  const direct = normalizeTrainerInvite(value);
  if (direct) return direct;
  try {
    const parsed = new URL(value);
    if (parsed.origin !== window.location.origin) return null;
    const expectedPath = new URL(import.meta.env.BASE_URL, window.location.origin).pathname;
    if (parsed.pathname !== expectedPath) return null;
    return normalizeTrainerInvite(parsed.searchParams.get('invite'));
  } catch {
    return null;
  }
}
