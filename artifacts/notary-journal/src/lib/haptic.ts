/**
 * Lightweight haptic-feedback helper.
 *
 * Uses the Vibration API (supported on Android Chrome, Edge, Opera;
 * silently no-ops on iOS Safari and desktop browsers).
 */

/** Short tap — barcode scanned, entry saved, toast-worthy success. */
export function hapticSuccess(): void {
  try {
    navigator.vibrate?.([40, 30, 40]);
  } catch {
    // Vibration API unavailable or blocked — silently ignore.
  }
}

/** Single light tap — button press, step change. */
export function hapticTap(): void {
  try {
    navigator.vibrate?.(15);
  } catch {
    // Silently ignore.
  }
}

/** Two quick pulses — warning / needs-review. */
export function hapticWarning(): void {
  try {
    navigator.vibrate?.([30, 50, 30, 50, 30]);
  } catch {
    // Silently ignore.
  }
}
