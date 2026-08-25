// Runtime shape check for incoming postMessage payloads (FR-EXT-22) — the
// messages.ts discriminated unions are TypeScript-only and erased at
// runtime, so a drift between the host and webview sides (or a malformed
// message) otherwise fails silently on unchecked field access instead of
// being rejected. No DOM access, so this is unit-testable directly.
//
// Generic over T so a call site with an explicit type argument (e.g.
// `hasKnownCommand<ControlsWebviewMessage>(data, KNOWN)`) gets a real type
// predicate — narrowing `data` to T instead of requiring a separate `as T`
// cast afterward (FR-EXT-33). Existing untyped call sites (just checking the
// boolean) are unaffected: T falls back to its constraint and the runtime
// check is identical either way.
export function hasKnownCommand<T extends { command: string } = { command: string }>(
  data: unknown,
  knownCommands: ReadonlySet<T['command']>,
): data is T {
  return (
    typeof data === 'object' &&
    data !== null &&
    'command' in data &&
    typeof (data as { command: unknown }).command === 'string' &&
    (knownCommands as ReadonlySet<string>).has((data as { command: string }).command)
  );
}

// Exhaustiveness sentinel for a discriminated-union switch (FR-EXT-33) — if
// a variant is added to a messages.ts union and a handler's switch doesn't
// grow a matching case, `msg` in the default branch is no longer `never`
// and the call to this function fails to compile. At runtime (an
// already-narrowed-but-somehow-unmatched message, which should be
// unreachable) it logs rather than throws, since these run inside
// onDidReceiveMessage callbacks the extension host doesn't wrap.
export function assertNever(value: never, context: string): void {
  console.error(`ds-ide: ${context}: unhandled message command`, value);
}
