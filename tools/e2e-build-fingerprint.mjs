import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const roots = ['src', 'public'];
const files = ['index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'package.json', 'pnpm-lock.yaml'];

function collect(directory, paths) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) collect(full, paths);
    else if (entry.isFile()) paths.push(full);
  }
}

// This covers every browser source file, public asset and build input. If that
// set cannot be read, callers must fail closed rather than trust a stale dist.
export function currentBuildFingerprint(root = process.cwd()) {
  const paths = [];
  for (const directory of roots) collect(resolve(root, directory), paths);
  for (const file of files) {
    const full = resolve(root, file);
    if (existsSync(full) && statSync(full).isFile()) paths.push(full);
  }
  if (!paths.length) throw new Error('No browser build inputs found');
  const hash = createHash('sha256');
  for (const full of paths.sort()) {
    hash.update(relative(root, full));
    hash.update('\0');
    hash.update(readFileSync(full));
    hash.update('\0');
  }
  return hash.digest('hex');
}
