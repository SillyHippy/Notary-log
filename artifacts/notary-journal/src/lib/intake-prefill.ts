/**
 * Intake prefill handoff — bridges a Client Request submission
 * into the New Entry form via sessionStorage.
 *
 * Flow:
 *   1. User taps "Start Entry" on a request in Client Requests
 *   2. This function writes the request data to sessionStorage
 *   3. App navigates to /entry/new
 *   4. New Entry's useEffect reads and clears the payload, auto-filling the form
 *
 * Key: `notary-journal:intakePrefill`
 */

import type { IntakeRequest } from './intake-api';

const STORAGE_KEY = 'notary-journal:intakePrefill';

/**
 * Stash an intake request into sessionStorage for the New Entry page to consume.
 * Call this right before navigating to `/entry/new`.
 */
export function stashIntakePrefill(request: IntakeRequest): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(request));
  } catch {
    // sessionStorage full or unavailable — silently ignore.
    // The user will have to fill the form manually.
  }
}

/**
 * Consume a prefilled intake request from sessionStorage.
 * Returns the request data if available, or null.
 * Clears the storage after reading (one-shot).
 */
export function consumeIntakePrefill(): IntakeRequest | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw) as IntakeRequest;
  } catch {
    return null;
  }
}

/** Check if there's a pending intake prefill (without consuming it) */
export function hasIntakePrefill(): boolean {
  try {
    return !!sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}
