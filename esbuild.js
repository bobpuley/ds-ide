// @ts-check
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: {
    'extension': 'src/extension.ts',
  },
  bundle: true,
  outdir: 'dist',
  // 'midi' is a native addon (RtMidi bindings, FR-DEV-18's host MIDI bridge)
  // — esbuild can't inline a compiled .node binary, so it stays external and
  // ships as real node_modules files instead (package.json's `package`
  // script no longer passes vsce's --no-dependencies for this reason).
  external: ['vscode', 'midi'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: {
    'webview/controls-webview': 'src/webview/controls-webview.ts',
    'webview/scope-webview': 'src/webview/scope-webview.ts',
    'webview/wiring-webview': 'src/webview/wiring-webview.ts',
    'webview/oled-webview': 'src/webview/oled-webview.ts',
    'webview/midi-webview': 'src/webview/midi-webview.ts',
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  platform: 'browser',
  target: 'chrome114',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const [extensionCtx, webviewCtx] = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { extensionConfig, webviewConfig };
