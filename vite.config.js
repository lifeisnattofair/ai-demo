import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  resolve: {
    alias: {
      '@policy': r('./supabase/functions/_shared/policy'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: r('./index.html'),
        admin: r('./admin.html'),
      },
    },
  },
});
