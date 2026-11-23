import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@policy': r('./supabase/functions/_shared/policy'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['tests/db/**', 'node_modules/**', 'tools/**', 'design/**'],
    passWithNoTests: true,
  },
});
