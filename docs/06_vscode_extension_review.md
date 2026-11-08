# 06 — VS Code Extension Review (v23)

> **v22 review archived** — [`docs/v22/06_vscode_extension_review.md`](v22/06_vscode_extension_review.md).

*v23 review not yet generated. Run the appropriate `/doc-creator-driver:*-review` command to produce it.*

## Findings recorded outside a full review

### [MEDIUM] `realtime_unavailable` notice is easy to lose in the Scope

**Found:** 2026-10-06, M80 sprint-gate human test on macOS — "it just returns automatically on sine option, no error
messages (as I can see)". **Deferred** by the user until the Windows-support initiative (v25) is closed; fix
together with the CoreAudio Live-input finding in `06_emulator_review.md`.

**Observed:** the emulator emits exactly one `{"type":"event","kind":"realtime_unavailable"}` and nothing after it
(verified by driving `effect_emu` directly), and the source selector reverts to *Sine*, yet the user saw no message.

**Cause (partly confirmed):** `src/webview/scope-webview.ts` handles `realtime_unavailable` by writing
`REALTIME_UNAVAILABLE_TEXT` straight into the events strip and returning — unlike every other event it is not added
to `activeEvents` or the event history (`logEvent`), so any later re-render of the strip (another event's chips) or a
`status` with `running: false` erases it with no trace. Whether one of those fired in this session was not
reproduced outside VS Code.

**Also:** after the fallback the host's session state still says `input: 'live'` (`extension.ts` only resets the
webview's selector), so the next deploy (`sendPostDeployState`) asks for real-time mode again and fails again.

**Fix direction:** log `realtime_unavailable` in the event history and keep it in the strip until the user changes
source; make the host reset the stored audio source to sine on `realtime_unavailable`; add a webview test.
