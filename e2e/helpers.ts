import { createClient } from '@supabase/supabase-js';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type Persona = 'TRAINER' | 'CLIENT' | 'EMPTY_CLIENT' | 'OTHER_TRAINER';

function environment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`E2E environment variable ${name} is required`);
  return value;
}

export function credentials(persona: Persona) {
  return { login: environment(`TEST_${persona}_LOGIN`), password: environment(`TEST_${persona}_PASSWORD`) };
}

// Production has Turnstile enabled, so a headless local preview cannot use the
// public password form without weakening CAPTCHA. A one-time magic link is
// generated server-side only for a registry-owned synthetic account, then
// verified with the publishable client to create the same browser session.
// No service-role value reaches Vite, the page, or a screenshot.
export async function fixtureSession(persona: Persona) {
  const { login, password } = credentials(persona);
  const url = environment('VITE_SUPABASE_URL');
  const key = environment('VITE_SUPABASE_PUBLISHABLE_KEY');
  const serviceRole = environment('SUPABASE_SERVICE_ROLE_KEY');
  // Read the password as a required fixture credential: this prevents a stale
  // local config from silently authenticating a different account.
  if (!password) throw new Error(`Missing local fixture password for ${persona}`);
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: `${login}@flux.local` });
  if (linkError || !link.properties.hashed_token) throw new Error(`Fixture session link failed for ${persona}: ${linkError?.message ?? 'missing token'}`);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
  if (error || !data.session) throw new Error(`Fixture session verification failed for ${persona}: ${error?.message ?? 'missing session'}`);
  return data.session;
}

const authBootstrapPath = '/__flux_e2e_auth_bootstrap__.html';
const localSupabaseScriptPath = '/__flux_e2e_supabase__.js';

// These routes exist only inside the Playwright browser context. The SDK is
// read from the already-installed local dependency rather than a CDN, so no
// test token is ever given to a third party. Supabase itself persists the
// session for the preview origin through its documented browser API.
const authBootstrapDocument = `<!doctype html><html><body>
  <script src="${localSupabaseScriptPath}"></script>
  <script>
    window.__fluxSetTestSession = async function (input) {
      const client = window.supabase.createClient(input.url, input.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
      const result = await client.auth.setSession({ access_token: input.accessToken, refresh_token: input.refreshToken });
      if (result.error) return { error: result.error.message };
      const user = await client.auth.getUser();
      if (user.error || !user.data.user) return { error: user.error ? user.error.message : 'User was not restored' };
      return { userId: user.data.user.id, sessionUserId: result.data.session ? result.data.session.user.id : null };
    };
  </script>
</body></html>`;

export function statePath(persona: Persona) {
  const file = { CLIENT: 'client', TRAINER: 'trainer', EMPTY_CLIENT: 'empty-client', OTHER_TRAINER: 'other-trainer' }[persona];
  return path.join('.e2e', 'auth', `${file}.json`);
}

export async function authenticatedContext(browser: Browser, persona: Persona, width = 390): Promise<{ context: BrowserContext; page: Page; userId: string }> {
  const session = await fixtureSession(persona);
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  const localSdk = await readFile(path.join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), 'utf8');
  await page.route(`**${localSupabaseScriptPath}`, (route) => route.fulfill({ contentType: 'application/javascript', body: localSdk }));
  await page.route(`**${authBootstrapPath}`, (route) => route.fulfill({ contentType: 'text/html', body: authBootstrapDocument }));
  const baseUrl = process.env.FLUX_E2E_BASE_URL ?? 'http://127.0.0.1:4179';
  await page.goto(`${baseUrl}${authBootstrapPath}`);
  await expect.poll(() => page.evaluate(() => typeof (window as typeof window & { __fluxSetTestSession?: unknown }).__fluxSetTestSession === 'function')).toBe(true);
  const result = await page.evaluate(async ({ url, key, accessToken, refreshToken }) => {
    const setSession = (window as typeof window & { __fluxSetTestSession: (input: { url: string; key: string; accessToken: string; refreshToken: string }) => Promise<{ userId?: string; sessionUserId?: string; error?: string }> }).__fluxSetTestSession;
    return setSession({ url, key, accessToken, refreshToken });
  }, { url: environment('VITE_SUPABASE_URL'), key: environment('VITE_SUPABASE_PUBLISHABLE_KEY'), accessToken: session.access_token, refreshToken: session.refresh_token });
  if (result.error || !result.userId || result.userId !== session.user.id || result.sessionUserId !== session.user.id) {
    await context.close();
    throw new Error(`Official browser session setup failed for ${persona}: ${result.error ?? 'unexpected user identity'}`);
  }
  await page.goto(baseUrl);
  return { context, page, userId: result.userId };
}

export async function signedInPage(browser: Browser, persona: Persona, width = 390): Promise<{ context: BrowserContext; page: Page }> {
  const { context, page } = await authenticatedContext(browser, persona, width);
  return { context, page };
}

export function collectRuntime(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  return () => errors;
}

export async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const outOfBounds = await page.locator('button, input, textarea, select, a').evaluateAll((nodes) => nodes
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
    }).map((node) => (node as HTMLElement).innerText || node.getAttribute('aria-label') || node.tagName));
  expect(outOfBounds, `Interactive elements outside viewport: ${outOfBounds.join(', ')}`).toEqual([]);
}

export async function openApp(page: Page) {
  await expect(page.getByLabel('Приложение FLUX')).toBeVisible();
}

export async function settleUi(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.flux-content, .flux-content > *')]
    .every((element) => element.getAnimations().every((animation) => animation.playState !== 'running'))).catch(() => undefined);
  await page.waitForTimeout(250);
}

export async function stableScreenshot(page: Page, path: string) {
  await settleUi(page);
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
}

export async function storedSessionRpcStatus(page: Page, fn: string, body: Record<string, unknown>) {
  const localSdk = await readFile(path.join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), 'utf8');
  await page.addScriptTag({ content: localSdk });
  return page.evaluate(async ({ url, key, fn, body }) => {
    const client = (window as typeof window & { supabase: { createClient: typeof createClient } }).supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) return { status: 0, authenticated: false };
    const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${sessionData.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, authenticated: true, userId: sessionData.session.user.id };
  }, { url: environment('VITE_SUPABASE_URL'), key: environment('VITE_SUPABASE_PUBLISHABLE_KEY'), fn, body });
}
