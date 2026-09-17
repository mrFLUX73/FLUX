import { spawnSync } from 'node:child_process';
import { currentBuildFingerprint } from './e2e-build-fingerprint.mjs';
import { loadE2eEnvironment } from './e2e-environment.mjs';
import { environmentCheck } from './e2e-preflight-checks.mjs';

const { values, missingFile } = loadE2eEnvironment();
const environment = environmentCheck(values);
if (missingFile || !environment.ok) {
  console.error('[FAIL] environment');
  console.error(missingFile ? 'Create .env.e2e.local before building an E2E candidate.' : environment.reason);
  process.exit(1);
}

const result = spawnSync('pnpm', ['build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...values,
    VITE_FLUX_E2E_BUILD: '1',
    VITE_FLUX_E2E_SOURCE_FINGERPRINT: currentBuildFingerprint(),
  },
});
process.exit(result.status ?? 1);
