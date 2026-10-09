import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.js', 'server.js'],
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 }
    }
  }
});
