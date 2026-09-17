import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const envPath = resolve('.env.e2e.local');
if (!existsSync(envPath)) throw new Error('Создайте .env.e2e.local: pnpm e2e:prepare');
const parsed = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/); return match ? [[match[1], match[2]]] : [];
}));
const environment = { ...process.env, ...parsed };
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: environment });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Reset remains separate from browser testing. The runner below builds an E2E
// candidate, proves it in preflight, and only then starts Playwright.
if (!process.argv.includes('--no-reset')) run('node', ['tools/test-fixtures.mjs', 'reset']);
const authProofOnly = process.argv.includes('--auth-proof');
const authPocOnly = process.argv.includes('--auth-poc');
const visualDiagnosticOnly = process.argv.includes('--visual-diagnostic');
const fullSmokeOnly = process.argv.includes('--full-smoke');
const targetedRegressionOnly = process.argv.includes('--targeted-regression');
run('node', ['tools/run-e2e.mjs', ...(authProofOnly ? ['e2e/auth-state.spec.ts'] : authPocOnly ? ['e2e/auth-poc.spec.ts'] : visualDiagnosticOnly ? ['e2e/visual-diagnostic.spec.ts'] : fullSmokeOnly ? ['e2e/full-smoke.spec.ts'] : targetedRegressionOnly ? ['e2e/targeted-regression.spec.ts'] : [])]);
