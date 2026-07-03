import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: {
      vscode: new URL('./src/__mocks__/vscode.ts', import.meta.url).pathname,
    },
  },
});
