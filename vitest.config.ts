import { fileURLToPath } from 'node:url';
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
      // fileURLToPath, not URL.pathname: pathname is "/C:/..." on Windows.
      vscode: fileURLToPath(new URL('./src/__mocks__/vscode.ts', import.meta.url)),
    },
  },
});
