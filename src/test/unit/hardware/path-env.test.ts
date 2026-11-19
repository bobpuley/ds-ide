import { describe, it, expect } from 'vitest';
import { prependToPath } from '../../../hardware/path-env';

// FR-WIN-TCH-2 / FR-WIN-TCH-5: extending PATH for a child process. The rules follow
// the target platform, so Windows behaviour is tested on any host.

describe('prependToPath()', () => {
  it('puts the directories first, joined with ":" on macOS/Linux', () => {
    expect(prependToPath({ PATH: '/usr/bin:/bin' }, ['/opt/a', '/opt/b'], 'darwin')['PATH']).toBe('/opt/a:/opt/b:/usr/bin:/bin');
  });

  it('joins with ";" on Windows', () => {
    const env = prependToPath({ Path: 'C:\\Windows' }, ['C:\\tc\\bin', 'D:\\x'], 'win32');
    expect(env['Path']).toBe('C:\\tc\\bin;D:\\x;C:\\Windows');
  });

  it('on Windows writes back to the existing "Path" key instead of adding a second "PATH"', () => {
    const env = prependToPath({ Path: 'C:\\x', Other: '1' }, ['C:\\tc'], 'win32');
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')).toEqual(['Path']);
    expect(env['Other']).toBe('1');
  });

  it('creates PATH when there is none', () => {
    expect(prependToPath({}, ['/opt/a'], 'linux')['PATH']).toBe('/opt/a');
  });

  it('drops repeated and empty directories, and "."', () => {
    expect(prependToPath({ PATH: '/x' }, ['/a', '', '.', '/a', '/b'], 'darwin')['PATH']).toBe('/a:/b:/x');
  });

  it('leaves PATH untouched when there is nothing to add', () => {
    expect(prependToPath({ PATH: '/x' }, [], 'darwin')['PATH']).toBe('/x');
  });

  it('does not modify the environment it was given', () => {
    const base = { PATH: '/usr/bin' };
    prependToPath(base, ['/opt/a'], 'darwin');
    expect(base.PATH).toBe('/usr/bin');
  });
});
