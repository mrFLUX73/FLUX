import assert from 'node:assert/strict';
import { baselineCheck, buildMetadataCheck, environmentCheck, syntheticAuthCheck } from './e2e-preflight-checks.mjs';

const validEnv = { VITE_SUPABASE_URL: 'x', VITE_SUPABASE_PUBLISHABLE_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', TEST_TRAINER_LOGIN: 'x', TEST_TRAINER_PASSWORD: 'x', TEST_CLIENT_LOGIN: 'x', TEST_CLIENT_PASSWORD: 'x', TEST_EMPTY_CLIENT_LOGIN: 'x', TEST_EMPTY_CLIENT_PASSWORD: 'x', TEST_OTHER_TRAINER_LOGIN: 'x', TEST_OTHER_TRAINER_PASSWORD: 'x' };
assert.equal(environmentCheck(validEnv).ok, true);
assert.equal(environmentCheck({}).ok, false);
console.log('[PASS] missing environment fails closed');
assert.equal(buildMetadataCheck({ kind: 'flux-e2e-test-build', fingerprint: 'fresh' }, 'fresh').ok, true);
assert.equal(buildMetadataCheck({ kind: 'flux-e2e-test-build', fingerprint: 'stale' }, 'fresh').ok, false);
console.log('[PASS] stale or wrong bundle fails closed');
assert.equal(syntheticAuthCheck({ user: { id: 'synthetic' } }).ok, true);
assert.equal(syntheticAuthCheck(null).ok, false);
console.log('[PASS] synthetic auth failure is blocked');
assert.equal(baselineCheck({ clientPlans: 1, emptyPlans: 0, activeLink: true, isolated: true }).ok, true);
assert.equal(baselineCheck({ clientPlans: 0, emptyPlans: 0, activeLink: true, isolated: true }).ok, false);
console.log('[PASS] invalid baseline is blocked');
console.log('E2E preflight local checks: PASS');
