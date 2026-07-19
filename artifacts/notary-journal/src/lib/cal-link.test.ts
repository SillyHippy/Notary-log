import { describe, expect, it } from 'vitest';
import { isValidSlug, parseCalBookingUrl, slugFromCalUsername } from './cal-link';
import { isPublicAppPath } from './app-path';

describe('parseCalBookingUrl', () => {
  it('accepts bare username', () => {
    const p = parseCalBookingUrl('your-cal-username');
    expect(p?.username).toBe('your-cal-username');
    expect(p?.calLink).toBe('your-cal-username');
    expect(p?.bookingUrl).toBe('https://cal.com/your-cal-username');
  });

  it('accepts full profile URL', () => {
    const p = parseCalBookingUrl('https://cal.com/your-cal-username');
    expect(p?.calLink).toBe('your-cal-username');
    expect(p?.bookingUrl).toBe('https://cal.com/your-cal-username');
  });

  it('accepts cal.com/user without scheme', () => {
    const p = parseCalBookingUrl('cal.com/your-cal-username');
    expect(p?.bookingUrl).toBe('https://cal.com/your-cal-username');
  });

  it('parses event URL', () => {
    const p = parseCalBookingUrl('https://cal.com/jane/mobile-notary');
    expect(p?.calLink).toBe('jane/mobile-notary');
    expect(p?.bookingUrl).toBe('https://cal.com/jane/mobile-notary');
  });

  it('rejects non-cal hosts', () => {
    expect(parseCalBookingUrl('https://evil.com/a/b')).toBeNull();
  });
});

describe('slugFromCalUsername', () => {
  it('normalizes username', () => {
    expect(slugFromCalUsername('your-cal-username')).toBe('your-cal-username');
  });
});

describe('isValidSlug', () => {
  it('accepts good slugs', () => {
    expect(isValidSlug('ab')).toBe(true);
    expect(isValidSlug('jane-mobile')).toBe(true);
  });
  it('rejects bad slugs', () => {
    expect(isValidSlug('A')).toBe(false);
    expect(isValidSlug('-ab')).toBe(false);
  });
});

describe('isPublicAppPath book', () => {
  it('treats /book/slug as public', () => {
    expect(isPublicAppPath('/book/jane')).toBe(true);
    expect(isPublicAppPath('/settings')).toBe(false);
  });
});
