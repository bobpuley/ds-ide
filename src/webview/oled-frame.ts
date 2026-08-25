// Pure OLED frame decoding/frame-rate helpers (FR-DEV-15) — no DOM access
// beyond atob(), a global in both the browser webview sandbox and Node 16+,
// so this is unit-testable directly (FR-IPC-6's convention).

// Decodes a base64-encoded framebuffer payload back to raw bytes. Returns
// null (rather than throwing) on malformed input — a corrupted IPC frame
// must degrade the OLED preview, not break the message listener that calls
// this for the rest of the session (FR-EXT-17).
export function decodeOledFrame(base64: string): Uint8Array | null {
  if (base64.length === 0) return new Uint8Array(0);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// Frames per second over a trailing window, from an ordered list of frame
// arrival timestamps (ms). Returns 0 when fewer than two timestamps fall
// within the window — nothing to measure a rate from yet.
export function computeFrameRate(timestamps: number[], windowMs = 1000): number {
  if (timestamps.length < 2) return 0;
  const latest = timestamps[timestamps.length - 1]!;
  const cutoff = latest - windowMs;
  const inWindow = timestamps.filter(t => t >= cutoff);
  if (inWindow.length < 2) return 0;
  const span = inWindow[inWindow.length - 1]! - inWindow[0]!;
  if (span <= 0) return 0;
  return ((inWindow.length - 1) / span) * 1000;
}
