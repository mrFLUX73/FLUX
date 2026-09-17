import { spawn, spawnSync } from 'node:child_process';
import { loadE2eEnvironment } from './e2e-environment.mjs';

const baseUrl = process.env.FLUX_E2E_BASE_URL ?? 'http://127.0.0.1:4179';
const { values } = loadE2eEnvironment();
const environment = { ...process.env, ...values, FLUX_E2E_BASE_URL: baseUrl, FLUX_E2E_MANAGED_PREVIEW: '1' };
let preview;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: environment });
  return result.status ?? 1;
}

async function responding() {
  try { return (await fetch(`${baseUrl}/flux-e2e-meta.json`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
}

async function waitForPreview() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await responding()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

try {
  if (run('node', ['tools/e2e-build.mjs']) !== 0) process.exitCode = 1;
  else {
    if (!await responding()) {
      preview = spawn('pnpm', ['preview', '--host', '127.0.0.1', '--port', '4179'], { stdio: 'ignore', env: environment });
      if (!await waitForPreview()) throw new Error('Local FLUX E2E preview did not start.');
    }
    if (run('node', ['tools/e2e-preflight.mjs']) !== 0) process.exitCode = 1;
    else process.exitCode = run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to start local FLUX E2E preview.');
  process.exitCode = 1;
} finally {
  if (preview && !preview.killed) preview.kill('SIGTERM');
}
