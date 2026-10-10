import assert from 'node:assert/strict';
import { baselineCheck, buildMetadataCheck, environmentCheck, syntheticAuthCheck } from './e2e-preflight-checks.mjs';
import { TEST_PERSONAS } from './e2e-contract.mjs';
import { isOwnedNutritionFixtureProduct } from './e2e-nutrition-fixture-hygiene.mjs';

const validEnv = {
  VITE_SUPABASE_URL: 'x', VITE_SUPABASE_PUBLISHABLE_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x',
  ...Object.fromEntries(Object.values(TEST_PERSONAS).flatMap(({ env }) => [[`TEST_${env}_LOGIN`, 'x'], [`TEST_${env}_PASSWORD`, 'x']])),
};
assert.equal(environmentCheck(validEnv).ok, true);
assert.equal(environmentCheck({}).ok, false);
console.log('[PASS] missing environment fails closed');
assert.equal(buildMetadataCheck({ kind: 'flux-e2e-test-build', fingerprint: 'fresh' }, 'fresh').ok, true);
assert.equal(buildMetadataCheck({ kind: 'flux-e2e-test-build', fingerprint: 'stale' }, 'fresh').ok, false);
console.log('[PASS] stale or wrong bundle fails closed');
assert.equal(syntheticAuthCheck({ user: { id: 'synthetic' } }).ok, true);
assert.equal(syntheticAuthCheck(null).ok, false);
console.log('[PASS] synthetic auth failure is blocked');
assert.equal(baselineCheck({ clientPlans: 1, activeLink: true, isolated: true }).ok, true);
assert.equal(baselineCheck({ clientPlans: 0, activeLink: true, isolated: true }).ok, false);
console.log('[PASS] invalid baseline is blocked');
assert.equal(isOwnedNutritionFixtureProduct({ id: 'exact-id', owner_id: 'synthetic', name: 'Яйцо [FLUX E2E nutrition:12345678-1234-1234-1234-123456789abc]' }), true);
assert.equal(isOwnedNutritionFixtureProduct({ id: 'exact-id', owner_id: 'synthetic', name: 'Яйцо [FLUX E2E nutrition:not-a-uuid]' }), false);
assert.equal(isOwnedNutritionFixtureProduct({ id: 'exact-id', owner_id: 'synthetic', name: 'Legacy nutrition product' }), false);
console.log('[PASS] orphan nutrition-product marker requires exact UUID ownership proof');
console.log('E2E preflight local checks: PASS');
