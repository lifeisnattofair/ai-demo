import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.js'],
    passWithNoTests: true,
    globalSetup: ['tests/db/globalSetup.js'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
