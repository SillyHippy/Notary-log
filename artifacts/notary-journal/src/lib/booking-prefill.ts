/**
 * Prefill New Entry from a Cal booking row (sessionStorage handoff).
 */
import type { CalBooking } from './cal-api';
import type { IntakeRequest } from './intake-api';
import { stashIntakePrefill } from './intake-prefill';

const KEY = 'notary-journal:bookingPrefill';

export function stashBookingPrefill(booking: CalBooking): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(booking));
  } catch {
    /* ignore */
  }
  // Also map into intake prefill shape so new-entry already handles fields
  const name = booking.attendee_name || '';
  const parts = name.trim().split(/\s+/);
  const first = parts[0] || '';
  const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
  const preferredDate = booking.start_time
    ? booking.start_time.slice(0, 10)
    : undefined;
  const fee =
    typeof booking.price_cents === 'number'
      ? (booking.price_cents / 100).toFixed(2)
      : undefined;

  const intake: IntakeRequest = {
    id: booking.id,
    signerFirstName: first,
    signerLastName: last,
    phone: booking.attendee_phone || undefined,
    notes: [
      booking.title,
      booking.location,
      booking.start_time
        ? `Appointment: ${new Date(booking.start_time).toLocaleString()}`
        : '',
      booking.cal_uid ? `Cal UID: ${booking.cal_uid}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    preferredDate,
    totalAmount: fee,
  } as IntakeRequest;
  stashIntakePrefill(intake);
}

export function consumeBookingPrefill(): CalBooking | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as CalBooking;
  } catch {
    return null;
  }
}
