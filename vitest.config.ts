import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/journal.ts',
        'src/types.ts',
        'src/paths.ts',
        'src/embeddings.ts',
        'src/search.ts',
      ],
      exclude: ['src/**/*.d.ts'],
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 60000,
  },
});
