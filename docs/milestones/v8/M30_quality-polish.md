# M30 — Extension Quality Polish

**Semver:** 0.9.2  
**Status:** sprint-complete  
**Source:** `docs/06_nodejs_review.md` + `docs/06_vscode_extension_review.md` (2026-06-21)

Covers the twelve LOW-urgency quality improvements: XSS escaping, Windows diagnostics, project layout detection, dead code removal, disposal cleanup, marketplace metadata, memory footprint, test isolation, and correctness hardening.

---

## Sprint Tasks

- [ ] **FR-EQ-9 · AC-70** — Fix `safeJson` in `controls-view-provider.ts` and `wiring-panel.ts` to use full JSON-in-HTML escaping: replace `<`, `>`, and `&` with `<`, `>`, `&` after `JSON.stringify`. *DoD: a controller ID containing `<script>` survives `safeJson` without any `<` or `>` characters in the output.*

- [ ] **FR-EQ-9 · AC-71** — Fix `parseBuildLine` regex in `build-diagnostics.ts` to handle Windows drive-letter paths (`C:\path\file.cpp:12:5:`). Add at least one Windows-path test case to `build-diagnostics.test.ts`. *DoD: the new test case produces a valid `ParsedDiagnostic` with correct file, line, and column.*

- [ ] **FR-EQ-9 · AC-72** — Extend `detectEffectSrc` to fall back to `src/*.cpp` and `source/*.cpp` subdirectories when no `.cpp` is found at the project root. Update the error message to reference the `ds-ide.effectSource` setting. *DoD: a project with `src/effect.cpp` and no root-level `.cpp` is detected without manual configuration.*

- [ ] **FR-EQ-9 · AC-73** — Remove the dead `WiringPanel` class (lines 80–136 of `wiring-panel.ts`). Only types, `PIN_DEFS`, and `buildHtml` should remain exported from that file. *DoD: no `WiringPanel` class in `wiring-panel.ts`; all existing tests still pass.*

- [ ] **FR-EQ-9 · AC-74** — Fix double-disposal of `manager` and `scopePanel`: keep disposal in exactly one place — `context.subscriptions` (preferred) — and make `deactivate()` a no-op or remove the redundant calls. *DoD: `dispose()` on manager and scopePanel is called exactly once on extension shutdown.*

- [ ] **FR-EQ-9 · AC-75** — Add `icon`, `repository`, `keywords`, and `homepage` fields to `package.json`. Update `categories` to include `"Debuggers"`. *DoD: `vsce package` runs without icon-missing or metadata warnings.*

- [ ] **FR-EQ-9 · AC-76** — Remove `retainContextWhenHidden: true` from both sidebar webview view provider registrations (`CONTROLS_VIEW_ID`, `WIRING_VIEW_ID`). Verify that the existing `_flush()` and `postWiredPins` rehydration logic correctly restores state when the panel is re-expanded after being hidden. *DoD: controls and wiring state are correctly restored after collapsing and re-expanding each sidebar panel.*

- [ ] **FR-EQ-9 · AC-77** — Eliminate `!` non-null assertions throughout `extension.ts` by encapsulating all module-level singletons (`manager`, `scopePanel`, `controlsViewProvider`, `wiringViewProvider`, `potStore`, `buttonStore`) in a single object initialized at the top of `activate()`. *DoD: TypeScript strict mode reports no non-null assertion warnings in `extension.ts`.*

- [ ] **FR-EQ-9 · AC-78** — Add `vi.resetModules()` and dynamic re-import to `extension.test.ts` so module-level state is reset between test cases. Replace the brittle `expect(subscriptions.length).toBe(21)` assertion with targeted per-registration assertions (one assertion per known command/provider/listener). *DoD: each test in the suite starts with a clean module state; the subscription test no longer uses a magic count.*

- [ ] **FR-EQ-9 · AC-79** — Set `localResourceRoots: []` on all `WebviewPanel` and `WebviewView` options that load no file-system resources. *DoD: `ScopePanel` and `WiringViewProvider` panel options include `localResourceRoots: []`.*

- [ ] **FR-EQ-9 · AC-80** — Coerce numeric values (`freq`, `amplitude`, `sampleRate`, `bufferSize`, `wavLoop`) before interpolation into HTML attributes in `scope-panel.ts` using `Number(x) || defaultValue`. *DoD: a manually corrupted `workspaceState` value (e.g., `freq: "injected"`) produces the default frequency in the rendered HTML, not the raw string.*

- [ ] **FR-EQ-9 · AC-81** — Add a `controls-writer.test.ts` test confirming that `removeInitFromSource` with an ID that is a strict prefix of another control's ID (e.g., `vol` when `volume` also exists) does not accidentally delete the `volume` init line. *DoD: test is green; `volume.Init(...)` line is preserved.*
