import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { extensionConfig, webviewConfig } = require('../../../../esbuild.js');

describe('esbuild configs', () => {
  it('builds the extension host with the node platform', () => {
    expect(extensionConfig.platform).toBe('node');
    expect(extensionConfig.format).toBe('cjs');
    expect(extensionConfig.external).toContain('vscode');
    expect(Object.keys(extensionConfig.entryPoints)).toEqual(['extension']);
  });

  it('builds webviews with the browser platform', () => {
    expect(webviewConfig.platform).toBe('browser');
    expect(webviewConfig.format).toBe('iife');
    expect(webviewConfig.external ?? []).not.toContain('vscode');
    expect(Object.keys(webviewConfig.entryPoints).sort()).toEqual([
      'webview/controls-webview',
      'webview/midi-webview',
      'webview/oled-webview',
      'webview/scope-webview',
      'webview/wiring-webview',
    ]);
  });

  it('keeps extension and webview outputs in the same dist directory', () => {
    expect(extensionConfig.outdir).toBe('dist');
    expect(webviewConfig.outdir).toBe('dist');
  });
});
