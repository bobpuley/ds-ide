// FR-WE-13: the one protocol every source-mutating Wiring Editor action
// follows, so an edit is always computed from — and applied to — the text the
// document currently holds:
//   - actions run one at a time, in arrival order (createEditQueue);
//   - any "append marker blocks?" prompt is answered before the text that is
//     edited is read;
//   - the document version is re-checked just before applying; on a change
//     (another action, the user, git, a coding agent) the edit is recomputed
//     once from the new text, otherwise refused — never applied to stale ranges;
//   - the file is saved only if it had no unsaved changes before the edit.
// Kept free of the `vscode` module so it can be unit-tested with fakes.

export const FILE_CHANGED_MESSAGE =
  'ds-ide: the effect source changed while the edit was being prepared — nothing was changed, try again.';

// How many times a version change may force a recompute before giving up.
const MAX_RECOMPUTES = 1;

export interface EditableDoc {
  getText(): string;
  readonly version: number;
  readonly isDirty: boolean;
  save(): Thenable<boolean>;
}

export interface SourceEditDeps<D extends EditableDoc, E> {
  /** Opens the effect source; undefined (after telling the user) when there is none. */
  openDoc(): Promise<D | undefined>;
  buildEdit(doc: D, oldText: string, newText: string): { edit: E; needsAppendConfirmation: boolean };
  applyEdit(edit: E): Thenable<boolean>;
  confirmAppend(): Promise<boolean>;
  showError(message: string): void;
}

/** Returns the new full text, or null to stop (the caller already explained why). */
export type ComputeEdit = (oldText: string) => string | null | Promise<string | null>;

export interface EditQueue {
  run<T>(job: () => Promise<T>): Promise<T>;
}

export function createEditQueue(): EditQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      const result = tail.then(job, job);
      // The chain only orders jobs; a failure is reported to its own caller.
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

/** Applies one edit; resolves to the new text, or undefined if nothing was changed. */
export async function runSourceEdit<D extends EditableDoc, E>(
  deps: SourceEditDeps<D, E>,
  compute: ComputeEdit,
  label = 'wiring',
): Promise<string | undefined> {
  const doc = await deps.openDoc();
  if (!doc) return undefined;

  let confirmed = false;
  let recomputes = 0;
  for (;;) {
    const wasDirty = doc.isDirty;
    const version = doc.version;
    const oldText = doc.getText();
    const newText = await compute(oldText);
    if (newText === null) return undefined;
    const { edit, needsAppendConfirmation } = deps.buildEdit(doc, oldText, newText);

    if (needsAppendConfirmation && !confirmed) {
      if (!(await deps.confirmAppend())) return undefined;
      confirmed = true;
      continue; // re-read: the prompt may have been open for a while
    }

    if (doc.version !== version) {
      if (recomputes++ < MAX_RECOMPUTES) continue;
      deps.showError(FILE_CHANGED_MESSAGE);
      return undefined;
    }

    if (!(await deps.applyEdit(edit))) {
      deps.showError(`ds-ide: ${label} edit could not be applied — source file was not changed.`);
      return undefined;
    }
    if (!wasDirty) await doc.save();
    return newText;
  }
}
