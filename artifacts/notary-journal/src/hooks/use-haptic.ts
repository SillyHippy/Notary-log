import { useCallback } from 'react';
import { hapticTap, hapticSuccess, hapticWarning } from '@/lib/haptic';

/**
 * Hook providing haptic feedback callbacks.
 * Wraps the bare functions so components can call them without importing
 * the library directly — useful for consistent patterns and future
 * extensions (e.g. Web Haptics API, fallback animations).
 *
 * Usage:
 *   const { tap, success, warning } = useHaptic();
 *   <button onClick={() => { success(); saveEntry(); }}>Save</button>
 */
export function useHaptic() {
  const tap = useCallback(() => hapticTap(), []);
  const success = useCallback(() => hapticSuccess(), []);
  const warning = useCallback(() => hapticWarning(), []);

  return { tap, success, warning };
}
