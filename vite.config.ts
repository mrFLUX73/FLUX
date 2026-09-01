import path from 'node:path';

import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

function githubPagesBase() {
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (!repository || repository.endsWith('.github.io')) return '/';
  return `/${repository}/`;
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? githubPagesBase() : '/',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    react(),
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
