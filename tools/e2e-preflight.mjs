import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { BASELINE, TEST_PERSONAS } from './e2e-contract.mjs';
import { currentBuildFingerprint } from './e2e-build-fingerprint.mjs';
import { loadE2eEnvironment } from './e2e-environment.mjs';
import { baselineCheck, buildMetadataCheck, environmentCheck, syntheticAuthCheck } from './e2e-preflight-checks.mjs';

const baseUrl = process.env.FLUX_E2E_BASE_URL ?? 'http://127.0.0.1:4179';
const results = [];
function report(name, result) { results.push(result.ok); console.log(`[${result.ok ? 'PASS' : 'FAIL'}] ${name}`); if (!result.ok) console.log(result.reason); }
function safeFailure(name, fallback) { report(name, { ok: false, reason: fallback }); }

async function fetchMetadata() {
  const response = await fetch(`${baseUrl}/flux-e2e-meta.json`, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error('not available');
  return response.json();
}

const { values, missingFile } = loadE2eEnvironment();
const environment = missingFile ? { ok: false, reason: 'Create .env.e2e.local before running E2E.' } : environmentCheck(values);
report('environment', environment);

let localMetadata;
let fingerprint;
if (environment.ok) {
  try {
    fingerprint = currentBuildFingerprint();
    localMetadata = JSON.parse(readFileSync('dist/flux-e2e-meta.json', 'utf8'));
    report('bundle environment', buildMetadataCheck(localMetadata, fingerprint));
  } catch {
    safeFailure('bundle environment', 'No readable FLUX E2E candidate bundle was found. Run pnpm e2e:build first.');
  }
  try {
    const servedMetadata = await fetchMetadata();
    report('build freshness', buildMetadataCheck(servedMetadata, fingerprint));
    report('preview', buildMetadataCheck(servedMetadata, localMetadata?.fingerprint));
  } catch {
    safeFailure('build freshness', `No compatible local FLUX preview is serving ${baseUrl}.`);
    safeFailure('preview', 'Start the local FLUX E2E preview or use pnpm e2e:targeted.');
  }
} else {
  safeFailure('bundle environment', 'Skipped because environment is invalid.');
  safeFailure('build freshness', 'Skipped because environment is invalid.');
  safeFailure('preview', 'Skipped because environment is invalid.');
}

if (environment.ok && results.every(Boolean)) {
  const admin = createClient(values.VITE_SUPABASE_URL, values.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const publicClient = createClient(values.VITE_SUPABASE_URL, values.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ids = {};
  try {
    const { data: registry, error } = await admin.from('test_accounts').select('user_id,purpose');
    if (error) throw error;
    const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) throw usersError;
    for (const [key, persona] of Object.entries(TEST_PERSONAS)) {
      const login = values[`TEST_${persona.env}_LOGIN`];
      const user = users.users.find((entry) => entry.email?.toLowerCase() === `${login}@flux.local`.toLowerCase());
      if (!user || !registry.some((entry) => entry.user_id === user.id && entry.purpose === persona.purpose)) throw new Error(key);
      ids[key] = user.id;
    }
    report('synthetic registry', { ok: true });
  } catch {
    safeFailure('synthetic registry', 'Synthetic registry does not match the required test personas.');
  }
  if (results.every(Boolean)) {
    try {
      const login = values.TEST_CLIENT_LOGIN;
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: `${login}@flux.local` });
      if (linkError || !link.properties.hashed_token) throw linkError;
      const { data, error } = await publicClient.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
      if (error) throw error;
      report('synthetic auth', syntheticAuthCheck(data));
    } catch {
      safeFailure('synthetic auth', 'Synthetic authentication could not be confirmed.');
    }
  } else safeFailure('synthetic auth', 'Skipped because synthetic registry is invalid.');
  if (results.every(Boolean)) {
    try {
      const [clientPlans, emptyPlans, activeLink, otherTrainerLink] = await Promise.all([
        admin.from('workout_plans').select('id', { count: 'exact', head: true }).eq('user_id', ids.client).eq('name', BASELINE.clientPlanName),
        admin.from('workout_plans').select('id', { count: 'exact', head: true }).eq('user_id', ids.empty_client),
        admin.from('trainer_client_links').select('id', { count: 'exact', head: true }).eq('trainer_id', ids.trainer).eq('client_id', ids.client).eq('status', 'active'),
        admin.from('trainer_client_links').select('id', { count: 'exact', head: true }).eq('trainer_id', ids.other_trainer).eq('client_id', ids.client).eq('status', 'active'),
      ]);
      if (clientPlans.error || emptyPlans.error || activeLink.error || otherTrainerLink.error) throw new Error('baseline query');
      report('baseline', baselineCheck({ clientPlans: clientPlans.count ?? 0, emptyPlans: emptyPlans.count ?? 0, activeLink: (activeLink.count ?? 0) > 0, isolated: (otherTrainerLink.count ?? 0) === 0 }));
    } catch {
      safeFailure('baseline', 'Synthetic baseline could not be confirmed.');
    }
  } else safeFailure('baseline', 'Skipped because synthetic authentication is invalid.');
} else {
  safeFailure('synthetic registry', 'Skipped until bundle and preview checks pass.');
  safeFailure('synthetic auth', 'Skipped until bundle and preview checks pass.');
  safeFailure('baseline', 'Skipped until bundle and preview checks pass.');
}

if (results.every(Boolean)) console.log('\nREADY FOR E2E');
else { console.log('\nE2E NOT STARTED'); process.exitCode = 1; }
