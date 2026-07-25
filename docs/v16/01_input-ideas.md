# 01 — Input Ideas (v16)

> **v1 complete** — ds-ide 0.1.0–0.1.7 (M0–M7), all ACs green. Full v1 ideas archived in
> [`docs/v1/01_input-ideas.md`](v1/01_input-ideas.md).
>
> **v2 complete** — ds-ide 0.2.0–0.2.9 (M8–M15), all ACs green. Full v2 ideas archived in
> [`docs/v2/01_input-ideas.md`](v2/01_input-ideas.md).
>
> **v3 complete** — ds-ide 0.3.0–0.3.3 (M16–M18), all ACs green. Full v3 ideas archived in
> [`docs/v3/01_input-ideas.md`](v3/01_input-ideas.md).
>
> **v4 complete** — ds-ide 0.4.0–0.4.3 (M19–M22), all ACs green. Full v4 ideas archived in
> [`docs/v4/01_input-ideas.md`](v4/01_input-ideas.md).
>
> **v5 complete** — ds-ide 0.5.0–0.5.1 (M23–M24), all ACs green. Full v5 ideas archived in
> [`docs/v5/01_input-ideas.md`](v5/01_input-ideas.md).
>
> **v6 complete** — archived to `docs/v6/` on 2026-06-21. Full v6 ideas archived in
> [`docs/v6/01_input-ideas.md`](v6/01_input-ideas.md).
>
> **v7 complete** — archived to `docs/v7/` on 2026-06-21. Full v7 ideas archived in
> [`docs/v7/01_input-ideas.md`](v7/01_input-ideas.md).
>
> **v8 complete** — archived to `docs/v8/` on 2026-06-22. Full v8 ideas archived in
> [`docs/v8/01_input-ideas.md`](v8/01_input-ideas.md).
>
> **v9 complete** — archived to `docs/v9/` on 2026-06-29. Full v9 ideas archived in
> [`docs/v9/01_input-ideas.md`](v9/01_input-ideas.md).
>
> **v10 complete** — archived to `docs/v10/` on 2026-06-30. Full v10 ideas archived in
> [`docs/v10/01_input-ideas.md`](v10/01_input-ideas.md).
>
> **v11 complete** — archived to `docs/v11/` on 2026-07-04. Full v11 ideas archived in
> [`docs/v11/01_input-ideas.md`](v11/01_input-ideas.md).
>
> **v12 complete** — archived to `docs/v12/` on 2026-07-05. Full v12 ideas archived in
> [`docs/v12/01_input-ideas.md`](v12/01_input-ideas.md).
>
> **v13 complete** — archived to `docs/v13/` on 2026-07-05. Full v13 ideas archived in
> [`docs/v13/01_input-ideas.md`](v13/01_input-ideas.md).
>
> **v14 complete** — archived to `docs/v14/` on 2026-07-22. Full v14 ideas archived in
> [`docs/v14/01_input-ideas.md`](v14/01_input-ideas.md).
>
> **v15 complete** — archived to `docs/v15/` on 2026-07-25. Full v15 ideas archived in
> [`docs/v15/01_input-ideas.md`](v15/01_input-ideas.md).

---

## v16 intake log

- **Bug — host MIDI bridge silently unavailable after a VS Code update (native module ABI
  mismatch).** Observed: at extension activation, the console/Output shows `ds-ide: MIDI host
  bridge unavailable — Error: The module '.../node_modules/midi/build/Release/midi.node' was
  compiled against a different Node.js version using NODE_MODULE_VERSION 137. This version of
  Node.js requires NODE_MODULE_VERSION 146.` after VS Code bumped its bundled Electron/Node.js
  version. Expected: the host MIDI bridge (FR-DEV-18) keeps working across ordinary VS Code
  updates on the same machine/arch, the way it's already documented to survive a missing/broken
  addon gracefully (`host-bridge.ts`'s try/catch — no crash, just "bridge unavailable"). A
  separate `(node:29036) [DEP0169] DeprecationWarning: url.parse() ...` line appeared in the same
  console output — investigated and ruled out as unrelated to ds-ide: `dist/extension.js`
  contains zero references to the `url` module, and neither runtime-loaded dependency in the MIDI
  bridge's require chain (`bindings`, `file-uri-to-path`) uses `url.parse` anywhere in their
  source. Out of scope for this bug — almost certainly VS Code/Electron internals or another
  extension in the same window. (2026-07-25)
