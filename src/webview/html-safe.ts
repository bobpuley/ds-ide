// Escapes a JSON payload for safe embedding in a webview's HTML data-island
// (`<script type="application/json">...</script>`) — prevents embedded
// `</script`>/`<`/`&` characters from prematurely closing the surrounding
// tag or being misinterpreted by the HTML parser (FR-EXT-26).
export function safeJson(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

// Escapes text for an HTML text node or a double-quoted attribute value in
// host-generated webview markup (FR-UDM-5's palette chips).
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
