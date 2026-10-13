import { defineConfig } from 'vitest/config';

/** Security-rules tests: run against the Firestore emulator (`npm run test:rules` at the root). */
export default defineConfig({
  test: {
    include: ['test-rules/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
