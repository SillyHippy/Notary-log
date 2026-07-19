import { describe, it, expect, beforeEach } from 'vitest';
import { stashBookingPrefill, consumeBookingPrefill } from './booking-prefill';
import { consumeIntakePrefill } from './intake-prefill';
import type { CalBooking } from './cal-api';

function mockBooking(overrides?: Partial<CalBooking>): CalBooking {
  return {
    id: 'bk-1',
    cal_uid: 'cal-uid-1',
    status: 'ACCEPTED',
    title: 'Mobile Notary',
    start_time: '2026-07-20T15:00:00.000Z',
    end_time: '2026-07-20T16:00:00.000Z',
    attendee_name: 'Jane Marie Doe',
    attendee_email: 'jane@example.com',
    attendee_phone: '555-0100',
    location: '123 Main St',
    price_cents: 7500,
    currency: 'USD',
    journal_linked_at: null,
    dismissed_at: null,
    created_at: '2026-07-19T12:00:00.000Z',
    ...overrides,
  };
}

describe('booking-prefill', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it('maps single-signer Cal booking into intake prefill fields', () => {
    stashBookingPrefill(mockBooking());
    const intake = consumeIntakePrefill();
    expect(intake).toMatchObject({
      signerFirstName: 'Jane',
      signerLastName: 'Marie Doe',
      phone: '555-0100',
      preferredDate: '2026-07-20',
      totalAmount: '75.00',
    });
    expect(intake?.notes).toContain('Mobile Notary');
    expect(intake?.notes).toContain('cal-uid-1');
  });

  it('stores and consumes booking prefill blob', () => {
    const booking = mockBooking({ attendee_name: 'Bob Smith' });
    stashBookingPrefill(booking);
    const consumed = consumeBookingPrefill();
    expect(consumed?.attendee_name).toBe('Bob Smith');
    expect(consumeBookingPrefill()).toBeNull();
  });
});
