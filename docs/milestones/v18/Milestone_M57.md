# M57 — Extension API, Type & Maintainability Polish

**Version:** 0.17.5
**Status:** in progress
**Source:** parallel code-review reconciliation (`docs/06_nodejs_review.md`, 2026-08-25)

## Goal

Close the remaining 13 MEDIUM findings covering type safety, API design, performance, dependency hygiene, and maintainability — duplicated helpers, an unenforced message contract, an unbatched high-frequency render path, an unpinned native dependency, and copy-pasted codegen boilerplate. None of these are correctness-critical on their own, but together they're the accumulated drag this review batch exists to clear before the next feature milestone.

## Sprint Tasks

### [x] refactor: consolidate the duplicated el<T>() DOM-lookup helper (FR-EXT-27)

Five webview-context files independently redeclare the same DOM-lookup helper, casting away `document.getElementById`'s `| null` return type without checking it.

**Affected files:** `src/webview/controls-webview.ts`, `src/webview/midi-webview.ts`, `src/webview/oled-webview.ts`, `src/webview/wiring-webview.ts`, `src/webview/scope-webview.ts`

**DoD:**
- A single shared webview-context utility replaces the 5 duplicated `el<T>()` declarations
- The utility either throws a descriptive error on a null lookup or returns `T | null` and forces callers to handle it

---

### [x] fix: validate JSON.parse'd data-island content before casting (FR-EXT-28)

Config/state data embedded by the extension host into `<script type="application/json">` data islands is parsed and cast with no runtime shape validation.

**Affected files:** `src/webview/controls-webview.ts`, `src/webview/wiring-webview.ts`

**DoD:**
- Parsed data-island content is checked against a light runtime shape check before being cast to its TypeScript type
- A missing/malformed data island surfaces a visible error state in the webview instead of silently defaulting to `{}`/`[]`

---

### [x] fix: use one consistent null-safety convention for REGISTRY[kind] (FR-EXT-29)

`removeFromSource` defensively uses optional chaining on a registry lookup while every other call site in the same file uses a non-null assertion.

**Affected files:** `src/wiring/controls-writer.ts`

**DoD:**
- All `REGISTRY[kind]` access sites use the same convention (either all `!`-asserted with a documented invariant, or all optional-chained with explicit handling)

---

### [x] refactor: replace DeployCoordinator's 17-parameter constructor with an options object (FR-EXT-30)

A single constructor accepts 17 positional arguments, several of the same type adjacent to one another, making transposition errors at the call site easy to introduce and impossible for the type checker to catch.

**Affected files:** `src/extension.ts`

**DoD:**
- `DeployCoordinator`'s constructor accepts a single grouped options object (e.g. `{ manager, statusBar, stores, panels, ... }`)
- The call site is updated accordingly with no behavior change

---

### [x] fix: adopt one error contract across codegen/*.ts strategies (FR-EXT-31)

The same category of problem — bad input reaching a codegen function — is handled four different ways across `oled.ts` (throws), `midi-usb.ts` (silent fallback), `pot.ts`/`toggle.ts` (silent clamp), producing plausible-but-wrong generated code with zero diagnostic in the silent-fallback cases.

**Affected files:** `src/devices/codegen/oled.ts`, `src/devices/codegen/midi-usb.ts`, `src/devices/codegen/pot.ts`, `src/devices/codegen/toggle.ts`

**DoD:**
- One documented contract (throw for structurally-impossible input; fall back only for values with a genuinely intended default) is applied consistently across all four files
- `pot.ts`'s `pinToAdcChannel` and similar silent-fallback paths no longer produce plausible-but-wrong generated code for out-of-range input without a diagnostic

---

### [x] refactor: split controls-webview.ts into per-concern modules (FR-EXT-32)

One flat 744-line module owns convention-mode canvas rendering, the legacy YAML editor canvas, drag-and-drop, save serialization, the SD-card viewer, and the OLED live-preview strip via 13+ module-scoped mutable variables with no encapsulation between concerns.

**Affected files:** `src/webview/controls-webview.ts`

**DoD:**
- Convention canvas, YAML editor canvas, drag-and-drop, save serialization, SD-card viewer, and OLED live-preview strip are split into separate modules/objects, each owning its own state
- No behavior change; file size and shared-mutable-state surface are both reduced

---

### [x] fix: enforce the messages.ts contract at webview/host message boundaries (FR-EXT-33)

None of the five `onDidReceiveMessage`/`postMessage` handlers import the message-type unions from `messages.ts`; each re-derives per-field checks by hand, so an added/renamed variant produces no compile-time reminder to add a handler branch.

**Affected files:** `src/webview/messages.ts`, `src/sidebar/controls-editor-panel.ts`, `src/sidebar/wiring-editor-panel.ts`, `src/webview/scope-panel.ts`, `src/webview/oled-panel.ts`, `src/webview/midi-panel.ts`

**DoD:**
- Each of the five handler sites narrows incoming messages via a runtime type guard derived from `messages.ts`'s discriminated union
- Adding/renaming a variant in `messages.ts` produces a compile-time error at any handler missing the new branch

---

### [x] perf: coalesce scope/spectrum webview updates via raf-coalesce.ts (FR-EXT-34)

`scope-webview.ts` calls `draw()`/resizes+redraws synchronously on every incoming `'scope'`/`'spectrum'` message even though `raf-coalesce.ts` exists specifically to coalesce a high-frequency call stream to one-per-frame, and is already used for pot/encoder drag.

**Affected files:** `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`

**DoD:**
- Incoming `'scope'`/`'spectrum'` payloads are routed through `createRafCoalescer` before calling `draw()`/`drawSpectrum()`
- Redraw rate is capped at one per animation frame regardless of incoming message rate

---

### [x] perf: batch MIDI monitor DOM rebuilds (FR-EXT-35)

`renderMonitor()` clears and rebuilds up to 50 rows synchronously on every single `midiRx`/`midiTx` message with no batching, thrashing full DOM teardown/rebuild on a rapid CC stream.

**Affected files:** `src/webview/midi-webview.ts`

**DoD:**
- `renderMonitor()` is batched via `raf-coalesce.ts` instead of rebuilding on every message

---

### [x] chore: pin the native midi dependency to an exact version (FR-EXT-36)

The only runtime dependency, `midi` (native RtMidi bindings), is declared with an unrestricted `^2.0.0` caret range despite being more prone to ABI/behavior breakage across minor version bumps than a pure-JS package.

**Affected files:** `package.json`, `src/midi/host-bridge.ts`

**DoD:**
- `midi` is pinned to an exact (or `~2.0.0`) version instead of `^2.0.0`
- A smoke test verifies the installed `midi` package satisfies the `MidiInputLike` shape used in `host-bridge.ts`

---

### [x] refactor: factor a shared codegen strategy helper (FR-EXT-37)

Four codegen strategy files independently redeclare the same shape — a handle-name constant, a decl regex, an init-prefix constant, and the strategy object — roughly 70% copy-pasted across files.

**Affected files:** `src/devices/codegen/sdcard.ts`, `src/devices/codegen/midi-trs.ts`, `src/devices/codegen/midi-usb.ts`, `src/devices/codegen/oled.ts`

**DoD:**
- A `makeSimplePeripheralCodegen({ declLine, initLinePrefixes })` helper (new `codegen/shared.ts`) is factored out
- `sdcard.ts` and `midi-trs.ts` build on it directly; `midi-usb.ts`/`oled.ts` extend it for their bus-variant behavior
- No behavior change to generated code

---

### [ ] refactor: move truncId/TRUNC_MAX_LEN into a shared webview-importable module (FR-EXT-38)

The same truncation constant and logic is defined twice — once exported from a host-side panel file, once re-declared unexported in the webview file — because the two run under different tsconfigs.

**Affected files:** `src/sidebar/controls-editor-panel.ts`, `src/webview/controls-webview.ts`

**DoD:**
- `truncId`/`TRUNC_MAX_LEN` is defined once in a new or existing pure module importable from both the panel and webview tsconfig contexts
- Both call sites import the shared implementation instead of hand-copying it

---

### [ ] test: add integration coverage for EmulatorManager 'error' handling (FR-EXT-39)

Unit tests for `IpcClient`/`EmulatorManager` register `'error'` listeners to make assertions, which means the test suite never exercised the "zero listeners attached" scenario that FR-EXT-6 fixes — a false sense of coverage on the exact path most likely to crash the Extension Host.

**Affected files:** `src/test/unit/emulator/manager.test.ts`, `src/extension.ts`

**DoD:**
- A test constructs the `EmulatorManager` wiring the same way `activate()` does (or activates the extension) and asserts an `'error'` emission is handled without crashing the process
- The test suite can no longer pass while production code omits the `'error'` listener added in FR-EXT-6
