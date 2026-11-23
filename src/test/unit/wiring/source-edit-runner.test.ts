import { describe, it, expect, vi } from 'vitest';
import {
  createEditQueue, runSourceEdit, FILE_CHANGED_MESSAGE,
  type EditableDoc, type SourceEditDeps,
} from '../../../wiring/source-edit-runner';

// A fake document whose text changes only through apply() or touch(); each
// change bumps the version, like a VS Code TextDocument.
function makeDoc(text: string, isDirty = false) {
  const doc = {
    text, version: 1, isDirty,
    getText: () => doc.text,
    save: vi.fn(async () => { doc.isDirty = false; return true; }),
    touch(next: string) { doc.text = next; doc.version++; doc.isDirty = true; },
  };
  return doc;
}
type FakeDoc = ReturnType<typeof makeDoc>;

// The "edit" is simply the new full text; applying it replaces the document.
function makeDeps(doc: FakeDoc, opts: { needsAppend?: boolean; confirm?: boolean; log?: string[] } = {}) {
  const log = opts.log ?? [];
  const deps: SourceEditDeps<FakeDoc & EditableDoc, string> = {
    openDoc: vi.fn(async () => doc),
    buildEdit: (_d, _old, newText) => ({ edit: newText, needsAppendConfirmation: opts.needsAppend ?? false }),
    applyEdit: vi.fn(async (edit: string) => {
      await new Promise((r) => setTimeout(r, 1));
      doc.text = edit; doc.version++; doc.isDirty = true;
      log.push('apply');
      return true;
    }),
    confirmAppend: vi.fn(async () => { log.push('confirm'); return opts.confirm ?? true; }),
    showError: vi.fn(),
  };
  return deps;
}

describe('createEditQueue (FR-WE-13)', () => {
  it('runs jobs one at a time, in arrival order', async () => {
    const q = createEditQueue();
    const order: string[] = [];
    const job = (name: string, ms: number) => async () => {
      order.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end ${name}`);
    };
    await Promise.all([q.run(job('a', 5)), q.run(job('b', 1))]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('a failing job does not block the next one', async () => {
    const q = createEditQueue();
    const failed = q.run(async () => { throw new Error('boom'); });
    const next = q.run(async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});

describe('runSourceEdit (FR-WE-13)', () => {
  it('two queued edits both land: the second reads the text the first produced', async () => {
    const doc = makeDoc('base');
    const deps = makeDeps(doc);
    const q = createEditQueue();
    await Promise.all([
      q.run(() => runSourceEdit(deps, (t) => `${t}+A`)),
      q.run(() => runSourceEdit(deps, (t) => `${t}+B`)),
    ]);
    expect(doc.text).toBe('base+A+B');
  });

  it('recomputes from the new text when the document changes before the edit is applied', async () => {
    const doc = makeDoc('base');
    const deps = makeDeps(doc);
    let calls = 0;
    const result = await runSourceEdit(deps, async (t) => {
      calls++;
      if (calls === 1) { await Promise.resolve(); doc.touch('changed'); }
      return `${t}+A`;
    });
    expect(calls).toBe(2);
    expect(doc.text).toBe('changed+A');
    expect(result).toBe('changed+A');
  });

  it('refuses with a message when the document keeps changing, and applies nothing', async () => {
    const doc = makeDoc('base');
    const deps = makeDeps(doc);
    const result = await runSourceEdit(deps, async (t) => { doc.touch(`${t}!`); return `${t}+A`; });
    expect(result).toBeUndefined();
    expect(deps.applyEdit).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalledWith(FILE_CHANGED_MESSAGE);
  });

  it('asks for the append confirmation before reading the text it edits', async () => {
    const doc = makeDoc('base');
    const log: string[] = [];
    const deps = makeDeps(doc, { needsAppend: true, log });
    const reads: string[] = [];
    await runSourceEdit(deps, (t) => { reads.push(`${log.join(',')}|${t}`); return `${t}+A`; });
    // The read whose result is applied happens after the prompt.
    expect(reads.at(-1)).toBe('confirm|base');
    expect(deps.confirmAppend).toHaveBeenCalledOnce();
    expect(doc.text).toBe('base+A');
  });

  it('applies nothing when the append confirmation is declined', async () => {
    const doc = makeDoc('base');
    const deps = makeDeps(doc, { needsAppend: true, confirm: false });
    expect(await runSourceEdit(deps, (t) => `${t}+A`)).toBeUndefined();
    expect(deps.applyEdit).not.toHaveBeenCalled();
  });

  it('saves after the edit when the document was clean before it', async () => {
    const doc = makeDoc('base', false);
    const deps = makeDeps(doc);
    await runSourceEdit(deps, (t) => `${t}+A`);
    expect(doc.save).toHaveBeenCalledOnce();
  });

  it('leaves the document dirty when it had unsaved changes before the edit', async () => {
    const doc = makeDoc('base', true);
    const deps = makeDeps(doc);
    await runSourceEdit(deps, (t) => `${t}+A`);
    expect(doc.save).not.toHaveBeenCalled();
    expect(doc.isDirty).toBe(true);
  });

  it('stops without editing when compute returns null (the handler already explained why)', async () => {
    const doc = makeDoc('base');
    const deps = makeDeps(doc);
    expect(await runSourceEdit(deps, () => null)).toBeUndefined();
    expect(deps.applyEdit).not.toHaveBeenCalled();
    expect(deps.showError).not.toHaveBeenCalled();
  });

  it('reports a rejected applyEdit and does not save', async () => {
    const doc = makeDoc('base');
    const deps = makeDeps(doc);
    vi.mocked(deps.applyEdit).mockResolvedValueOnce(false);
    expect(await runSourceEdit(deps, (t) => `${t}+A`, 'wiring')).toBeUndefined();
    expect(deps.showError).toHaveBeenCalledWith(expect.stringMatching(/wiring edit could not be applied/));
    expect(doc.save).not.toHaveBeenCalled();
  });
});
