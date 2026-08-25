import { describe, it, expect, vi } from 'vitest';
import { createLineSplitter } from '../../../hardware/line-buffer';

describe('createLineSplitter()', () => {
  it('emits complete lines from a single chunk', () => {
    const onLine = vi.fn();
    const splitter = createLineSplitter(onLine);
    splitter.push(Buffer.from('line one\nline two\n'));
    expect(onLine.mock.calls).toEqual([['line one'], ['line two']]);
  });

  it('buffers a line split across two chunks and emits it whole', () => {
    const onLine = vi.fn();
    const splitter = createLineSplitter(onLine);
    splitter.push(Buffer.from('File downloaded success'));
    expect(onLine).not.toHaveBeenCalled();
    splitter.push(Buffer.from('fully\n'));
    expect(onLine).toHaveBeenCalledWith('File downloaded successfully');
  });

  it('handles a diagnostic line split mid-token across chunks', () => {
    const onLine = vi.fn();
    const splitter = createLineSplitter(onLine);
    splitter.push(Buffer.from('/project/effect.cpp:10:5: er'));
    splitter.push(Buffer.from("ror: use of undeclared identifier 'foo'\n"));
    expect(onLine).toHaveBeenCalledWith(
      "/project/effect.cpp:10:5: error: use of undeclared identifier 'foo'",
    );
  });

  it('flush() emits a trailing unterminated line', () => {
    const onLine = vi.fn();
    const splitter = createLineSplitter(onLine);
    splitter.push(Buffer.from('no trailing newline'));
    expect(onLine).not.toHaveBeenCalled();
    splitter.flush();
    expect(onLine).toHaveBeenCalledWith('no trailing newline');
  });

  it('flush() is a no-op when there is no pending carry', () => {
    const onLine = vi.fn();
    const splitter = createLineSplitter(onLine);
    splitter.push(Buffer.from('complete line\n'));
    onLine.mockClear();
    splitter.flush();
    expect(onLine).not.toHaveBeenCalled();
  });

  it('skips blank lines', () => {
    const onLine = vi.fn();
    const splitter = createLineSplitter(onLine);
    splitter.push(Buffer.from('one\n\n\ntwo\n'));
    expect(onLine.mock.calls).toEqual([['one'], ['two']]);
  });
});
