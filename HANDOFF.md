# M18 Handoff — Wiring Editor

**Date:** 2026-06-19  
**Branch:** `feat/m18-wiring-editor`  
**Milestone file:** `docs/milestones/v3/M18.md`  
**Status:** All T18-1…T18-4 implementation complete; **awaiting human-driven test gate (AC-19, AC-23) before sprint close**

---

## What was done

All four M18 tasks are implemented and all 313 automated tests pass.

| Task | File(s) | Status |
|------|---------|--------|
| T18-4 | `src/wiring/controls-writer.ts` | ✅ done |
| T18-1/2/3 | `src/wiring/wiring-panel.ts` | ✅ done |
| T18-4 tests | `src/test/unit/wiring/controls-writer.test.ts` | ✅ 16 tests |
| T18-1/2/3 tests | `src/test/unit/wiring/wiring-panel.test.ts` | ✅ PIN_DEFS + HTML + WiringPanel |
| Extension wiring | `src/extension.ts` — `ds-ide.openWiringEditor` command | ✅ done |
| Package manifest | `package.json` — `ds-ide.openWiringEditor` in contributes.commands | ✅ done |
| Extension test | `src/test/unit/extension.test.ts` — subscription count 13→14 | ✅ fixed |

Modified files not yet committed:
- `docs/05_dev-plan.md`
- `docs/milestones/v3/M18.md`
- `package.json`
- `src/__mocks__/vscode.ts`
- `src/extension.ts`
- `src/test/unit/extension.test.ts`

New (untracked) files:
- `src/wiring/controls-writer.ts`
- `src/wiring/wiring-panel.ts`
- `src/test/unit/wiring/controls-writer.test.ts`
- `src/test/unit/wiring/wiring-panel.test.ts`

---

## Architecture recap (do not re-derive)

- **`controls-writer.ts`** — pure TS, no VS Code deps. `declarationLine(id, kind, pin)`, `insertIntoSource(src, id, kind, pin)`, `removeFromSource(src, id)`. Block markers: `// ds-ide:controls:begin` / `// ds-ide:controls:end`.
- **`wiring-panel.ts`** — `WiringPanel` class (same pattern as `ScopePanel`): `show(wiredPins)`, `postWiredPins(pins)`, `dispose()`. Exports `PIN_DEFS` (40 entries), `buildHtml(wiredPins)`. PIN_DEFS embedded as JSON in webview JS via `safeJson()` (escapes `</` → `<\/`).
- **`extension.ts`** — `ds-ide.openWiringEditor` command lazily creates `WiringPanel` with `onWirePin` / `onUnwirePin` callbacks. Each callback: opens TextDocument → applies `vscode.WorkspaceEdit` (undoable) → re-parses with `parseControlsConvention` → posts updated `wiredPins` to C10 and updated `controlsConfig` to C2 (scope panel).

---

## Immediate next steps

### 1. Commit all staged changes

All changes are on `feat/m18-wiring-editor`. Stage and commit:

```
git add docs/05_dev-plan.md docs/milestones/v3/M18.md package.json \
        src/__mocks__/vscode.ts src/extension.ts src/test/unit/extension.test.ts \
        src/wiring/ src/test/unit/wiring/
git commit -m "feat(M18): Wiring Editor — pinout SVG, click-to-assign, C++ block writer (0.3.3)"
```

### 2. Human-driven test gate (sprint-close protocol)

Ask the user to run manual tests for:
- **AC-19**: Open Wiring Editor → click an unassigned pin → select Pot → confirm with default id → verify pin shows assigned in diagram AND C++ convention block is written in effect source.
- **AC-23**: Click an assigned pin → click Remove → verify pin shows unassigned in SVG AND annotation line removed from C++ source.

Also verify no regression to AC-18 (Controls Editor reads the declaration correctly).

Use `AskUserQuestion`:
> "Please run AC-19 (assign a Pot) and AC-23 (remove it) in the Wiring Editor, then report results. All green?"

### 3. Sprint close (if tests green)

Follow the sprint-close protocol from `docs/05_dev-plan.md` § Sprint-close protocol:

1. Merge `feat/m18-wiring-editor` into `main`
2. Run `git tag --list --sort=v:refname` → highest tag is `0.3.2` → propose `0.3.3`
3. Confirm tag with user
4. Prepend `## 0.3.3 — 2026-06-19` section to `CHANGELOG.md`
5. `git add CHANGELOG.md && git commit -m "chore: update changelog for 0.3.3"`
6. `git tag -a 0.3.3 -m "0.3.3"`
7. `git push && git push --tags`
8. Update `docs/milestones/v3/M18.md` status → released; update Milestone Registry in `docs/05_dev-plan.md`

---

## Suggested skills

Invoke these at the start of the next session (in order):

1. `/doc-creator-driver:implement M18` — this is the primary driver skill; it will pick up from the pending human-test gate and execute the sprint-close steps automatically.
2. `/typescript-expert` — already loaded by the driver, available for any TS issues during sprint close.

---

## Known issues / notes

- The M18.md header still says `v0.3.2` in the title line (harmless, version field below it is correctly `0.3.3`).
- `tests/human-driven/showcase.js` does not exist in this project — no showcase update needed.
- `docs/archived-doc-access-log.md` — check for open entries at session start per CLAUDE.md protocol.
