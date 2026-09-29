import { describe, it, expect, vi } from 'vitest';
import { readThemeColor, onThemeChange, type ThemeObserverFactory } from '../../../webview/theme/theme-runtime';

describe('readThemeColor (FR-THM-2)', () => {
  it('reads and trims a --ds-* value from computed style', () => {
    const style = { getPropertyValue: vi.fn(() => '  #3794ff ') };
    expect(readThemeColor('--ds-trace-in', style)).toBe('#3794ff');
    expect(style.getPropertyValue).toHaveBeenCalledWith('--ds-trace-in');
  });

  it('accepts a name without the leading dashes', () => {
    const style = { getPropertyValue: vi.fn(() => '#fff') };
    readThemeColor('trace-in', style);
    expect(style.getPropertyValue).toHaveBeenCalledWith('--ds-trace-in');
  });

  it('returns the fallback when the variable is empty', () => {
    const style = { getPropertyValue: () => '' };
    expect(readThemeColor('--ds-grid', style, '#888')).toBe('#888');
  });
});

describe('onThemeChange (FR-THM-5)', () => {
  function fakeFactory() {
    let fire: () => void = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    const factory: ThemeObserverFactory = cb => {
      fire = cb;
      return { observe, disconnect };
    };
    return { factory, observe, disconnect, fire: () => fire() };
  }

  it('observes the target for class and theme-id attribute changes', () => {
    const f = fakeFactory();
    const target = {} as Node;
    onThemeChange(() => {}, { target, createObserver: f.factory });
    expect(f.observe).toHaveBeenCalledWith(target, {
      attributes: true,
      attributeFilter: ['class', 'data-vscode-theme-id'],
    });
  });

  it('fires the callback once per observer notification', () => {
    const f = fakeFactory();
    const cb = vi.fn();
    onThemeChange(cb, { target: {} as Node, createObserver: f.factory });
    expect(cb).not.toHaveBeenCalled();
    f.fire();
    expect(cb).toHaveBeenCalledTimes(1);
    f.fire();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('disposes cleanly and is idempotent', () => {
    const f = fakeFactory();
    const cb = vi.fn();
    const dispose = onThemeChange(cb, { target: {} as Node, createObserver: f.factory });
    dispose();
    dispose();
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    f.fire();
    expect(cb).not.toHaveBeenCalled();
  });
});
