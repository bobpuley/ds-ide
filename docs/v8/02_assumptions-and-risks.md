# 02 — Assumptions & Risks (v8)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v7 complete** — all v7 bets held; risks resolved or managed.
> Archived: [`docs/v7/02_assumptions-and-risks.md`](v7/02_assumptions-and-risks.md).

## A26 — Webview sandbox implicitly trusted as a security boundary for source-file writes

> ⚠️ ASSUMPTION (IDENTIFIED, BEING FIXED in M28): The extension passed webview-provided `id` strings and `ControllerConfig` objects directly into source-file mutation and YAML write operations under the assumption that "messages come from our own JavaScript, so they are trusted." In practice, the webview sandbox prevents external network access but does not prevent a crafted message (e.g., from a future injection or logic bug) from supplying malicious field values. The `id` field becomes a C++ variable name written into user source; an invalid identifier (e.g., containing `.`, `;`, or `*/`) would corrupt the output. Fixed by FR-ES-2 (host-side structural validation before all side-effecting operations).

## A27 — VS Code webview sandbox sufficient without an explicit CSP

> ⚠️ ASSUMPTION (IDENTIFIED, BEING FIXED in M28): No CSP was set on any webview under the assumption that VS Code's built-in sandbox was sufficient to prevent XSS. VS Code's sandbox isolates the webview renderer from the host filesystem and network, but does not substitute for a `Content-Security-Policy` — inline scripts remain unrestricted without one. The VS Code Marketplace review process explicitly flags missing CSPs. Fixed by FR-ES-1 (nonce-based CSP on all three webviews).
