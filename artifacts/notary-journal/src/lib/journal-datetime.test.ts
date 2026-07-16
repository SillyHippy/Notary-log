import { describe, expect, it } from 'vitest';
import {
  buildTime12Hour,
  combineLocalDateAndTime,
  formatJournalDateTime,
  formatTime12Hour,
  getDefaultNotarizationDate,
  getDefaultNotarizationTime,
  getEntryNotarizationIso,
  parseTimeTo24Hour,
  resolveNotarizationDateTime,
  resolveNotarizationDateTimeAtComplete,
  splitNotarizationDateTime,
  splitTime12Hour,
} from './journal-datetime';
import type { JournalEntry } from './db';

function minimalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 1,
    entryNumber: 1,
    status: 'completed',
    signerFullName: 'Test',
    signerAddress: '1 Main',
    signerCity: 'Tulsa',
    signerState: 'OK',
    idType: 'driver_license',
    documentType: 'Deed',
    notarialActType: 'acknowledgment',
    feeCharged: 500,
    feeWaived: false,
    locationCity: 'Tulsa',
    locationState: 'OK',
    createdAt: '2026-07-15T10:00:00.000Z',
    updatedAt: '2026-07-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('journal-datetime', () => {
  it('combines local date and 12-hour time to ISO with zero seconds', () => {
    const iso = combineLocalDateAndTime('2026-07-15', '2:30 PM');
    expect(iso).toBeTruthy();
    const d = new Date(iso!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
    expect(d.getSeconds()).toBe(0);
  });

  it('parses 12-hour and 24-hour time strings', () => {
    expect(parseTimeTo24Hour('2:30 PM')).toBe('14:30');
    expect(parseTimeTo24Hour('12:00 AM')).toBe('00:00');
    expect(parseTimeTo24Hour('12:00 PM')).toBe('12:00');
    expect(parseTimeTo24Hour('14:30')).toBe('14:30');
  });

  it('formats 24-hour to 12-hour AM/PM', () => {
    expect(formatTime12Hour('14:30')).toBe('2:30 PM');
    expect(formatTime12Hour('00:15')).toBe('12:15 AM');
    expect(formatTime12Hour('12:00')).toBe('12:00 PM');
  });

  it('splits ISO into local date and 12-hour time', () => {
    const { date, time } = splitNotarizationDateTime('2026-07-15T14:30:00.000Z');
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(time).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it('builds and splits 12-hour picker values', () => {
    const built = buildTime12Hour(3, 45, 'PM');
    expect(built).toBe('3:45 PM');
    const parts = splitTime12Hour(built);
    expect(parts.hour).toBe(3);
    expect(parts.minute).toBe(45);
    expect(parts.period).toBe('PM');
  });

  it('prefers notarizationDateTime over completedAt and createdAt', () => {
    const entry = minimalEntry({
      notarizationDateTime: '2026-07-16T18:00:00.000Z',
      completedAt: '2026-07-15T12:00:00.000Z',
      createdAt: '2026-07-14T08:00:00.000Z',
    });
    expect(getEntryNotarizationIso(entry)).toBe('2026-07-16T18:00:00.000Z');
  });

  it('formats journal date/time for display without seconds', () => {
    const entry = minimalEntry({ notarizationDateTime: '2026-07-15T19:12:00.000Z' });
    const text = formatJournalDateTime(entry);
    expect(text.length).toBeGreaterThan(5);
    expect(text).toMatch(/2026/);
    expect(text).not.toMatch(/:\d{2}:\d{2}/);
  });

  it('resolveNotarizationDateTime uses form fields first', () => {
    const iso = resolveNotarizationDateTime('2026-07-15', '9:00 AM');
    expect(new Date(iso).getHours()).toBe(9);
    expect(new Date(iso).getSeconds()).toBe(0);
  });

  it('defaults date and time helpers return valid strings', () => {
    expect(getDefaultNotarizationDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(getDefaultNotarizationTime()).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it('resolveNotarizationDateTimeAtComplete honors manual time', () => {
    const iso = resolveNotarizationDateTimeAtComplete('2026-07-15', '9:15 AM', {
      dateManuallyEdited: true,
      timeManuallyEdited: true,
    });
    expect(new Date(iso).getHours()).toBe(9);
    expect(new Date(iso).getMinutes()).toBe(15);
    expect(new Date(iso).getSeconds()).toBe(0);
  });

  it('resolveNotarizationDateTimeAtComplete uses now when time not manually edited', () => {
    const iso = resolveNotarizationDateTimeAtComplete('2020-01-01', '12:00 AM', {
      dateManuallyEdited: false,
      timeManuallyEdited: false,
    });
    const d = new Date(iso);
    const now = new Date();
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
    expect(d.getFullYear()).toBe(now.getFullYear());
    expect(d.getMonth()).toBe(now.getMonth());
    expect(d.getDate()).toBe(now.getDate());
  });
});
