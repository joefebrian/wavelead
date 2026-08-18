import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['tests/setup.ts'],
    globals: false,
    // Run one test file at a time so shared-DB tests don't step on each other.
    fileParallelism: false,
    // Ensure repositories/service imports work via @/ alias.
    alias: { '@/': new URL('./', import.meta.url).pathname },
  },
});
