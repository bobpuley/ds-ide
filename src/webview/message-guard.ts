// Runtime shape check for incoming postMessage payloads (FR-EXT-22) — the
// messages.ts discriminated unions are TypeScript-only and erased at
// runtime, so a drift between the host and webview sides (or a malformed
// message) otherwise fails silently on unchecked field access instead of
// being rejected. No DOM access, so this is unit-testable directly.
export function hasKnownCommand(data: unknown, knownCommands: ReadonlySet<string>): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'command' in data &&
    typeof (data as { command: unknown }).command === 'string' &&
    knownCommands.has((data as { command: string }).command)
  );
}
