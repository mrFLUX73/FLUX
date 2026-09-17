import { writeFileSync } from 'node:fs';
import path from 'node:path';

import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

function githubPagesBase() {
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (!repository || repository.endsWith('.github.io')) return '/';
  return `/${repository}/`;
}

function e2eBuildMetadata() {
  return {
    name: 'flux-e2e-build-metadata',
    closeBundle() {
      if (process.env.VITE_FLUX_E2E_BUILD !== '1') return;
      const fingerprint = process.env.VITE_FLUX_E2E_SOURCE_FINGERPRINT;
      if (!fingerprint) throw new Error('FLUX E2E build fingerprint is required');
      // This file is generated only for the local E2E candidate bundle. It
      // contains no credentials and lets preflight verify the actual preview.
      writeFileSync(path.resolve(import.meta.dirname, 'dist/flux-e2e-meta.json'), `${JSON.stringify({
        kind: 'flux-e2e-test-build', fingerprint,
      })}\n`);
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? githubPagesBase() : '/',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    react(),
    e2eBuildMetadata(),
    {
      name: 'flux-github-social-preview',
      transformIndexHtml(html) {
        const repository = process.env.GITHUB_REPOSITORY;
        if (!process.env.GITHUB_ACTIONS || !repository) return html;
        const [owner, name] = repository.split('/');
        const base = name.endsWith('.github.io') ? '/' : `/${name}/`;
        const imageUrl = `https://${owner}.github.io${base}og.png`;
        const tags = `<meta property="og:image" content="${imageUrl}" /><meta name="twitter:image" content="${imageUrl}" />`;
        return html.replace('</head>', `    ${tags}\n  </head>`);
      },
    },
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
});
