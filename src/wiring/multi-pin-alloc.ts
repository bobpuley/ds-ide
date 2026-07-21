// Auto-assigns the remaining pins for a 'pins'-attachment device (FR-DEV-8)
// from a single clicked pin, so the Wiring Editor's existing one-click popup
// flow needs no redesign for a multi-pin device: the user clicks one pin
// (which becomes the first/primary pin), and the rest are claimed from the
// nearest free assignable pins after it, in ascending pin-number order.
import type { PinDef } from '../devices/pin-table.gen';

// Returns `count` total pins starting with `clickedPin` (so the result
// always has length `count`, never just the extras), or null if there
// aren't enough free assignable pins after the clicked one, or the clicked
// pin itself isn't a valid assignable pin.
export function allocateAdjacentPins(
  clickedPin: number,
  count: number,
  pinDefs: PinDef[],
  occupiedPins: Set<number>,
): number[] | null {
  const assignable = pinDefs
    .filter(d => d.pin !== null)
    .map(d => d.pin as number)
    .sort((a, b) => a - b);

  const startIdx = assignable.indexOf(clickedPin);
  if (startIdx === -1) return null;

  const result: number[] = [clickedPin];
  for (let i = startIdx + 1; i < assignable.length && result.length < count; i++) {
    const candidate = assignable[i]!;
    if (!occupiedPins.has(candidate)) result.push(candidate);
  }

  return result.length === count ? result : null;
}
