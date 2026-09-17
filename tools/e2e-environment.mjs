import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEST_PERSONAS } from './e2e-contract.mjs';

export const E2E_ENV_PATH = resolve(process.env.FLUX_E2E_ENV_FILE ?? '.env.e2e.local');

export function parseEnvironment(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    return match ? [[match[1], match[2]]] : [];
  }));
}

export function loadE2eEnvironment() {
  if (!existsSync(E2E_ENV_PATH)) return { values: {}, missingFile: true };
  return { values: parseEnvironment(readFileSync(E2E_ENV_PATH, 'utf8')), missingFile: false };
}

export function requiredE2eKeys() {
  return [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    ...Object.values(TEST_PERSONAS).flatMap(({ env }) => [`TEST_${env}_LOGIN`, `TEST_${env}_PASSWORD`]),
  ];
}

export function missingE2eKeys(values) {
  return requiredE2eKeys().filter((key) => !values[key]);
}
