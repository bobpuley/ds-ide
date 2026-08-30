import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/e2e/**/*.test.js',
  workspaceFolder: 'src/test/e2e/fixtures/basic-effect-project',
  mocha: {
    timeout: 30000,
  },
});
