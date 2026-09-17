import { missingE2eKeys } from './e2e-environment.mjs';

export function environmentCheck(values) {
  const missing = missingE2eKeys(values);
  return missing.length ? { ok: false, reason: `Missing required E2E configuration (${missing.length} value${missing.length === 1 ? '' : 's'}).` } : { ok: true };
}

export function buildMetadataCheck(metadata, fingerprint) {
  if (!metadata || metadata.kind !== 'flux-e2e-test-build') return { ok: false, reason: 'Candidate bundle was not built with the FLUX E2E test environment.' };
  if (!metadata.fingerprint || metadata.fingerprint !== fingerprint) return { ok: false, reason: 'Test bundle does not match current browser source inputs.' };
  return { ok: true };
}

export function syntheticAuthCheck(result) {
  return result?.user?.id ? { ok: true } : { ok: false, reason: 'Synthetic authentication could not be confirmed.' };
}

export function baselineCheck({ clientPlans, emptyPlans, activeLink, isolated }) {
  if (clientPlans < 1) return { ok: false, reason: 'Test Client baseline workout plan is missing.' };
  if (emptyPlans !== 0) return { ok: false, reason: 'Empty Client is not empty.' };
  if (!activeLink) return { ok: false, reason: 'Test Trainer ↔ Test Client active baseline link is missing.' };
  if (!isolated) return { ok: false, reason: 'Other Trainer must not be linked to Test Client.' };
  return { ok: true };
}
