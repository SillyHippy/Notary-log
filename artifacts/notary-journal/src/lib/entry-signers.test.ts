import { describe, it, expect } from 'vitest';
import { formatEntrySignerNames, formatEntrySignerList, entryHasMultipleSigners, formatSignerFullAddress, formatEntryAddressLines, formatEntrySignerLines, formatEntryIdTypeLines } from './entry-signers';
import type { JournalEntry } from './db';

function mockEntry(overrides?: Partial<JournalEntry>): JournalEntry {
  return {
    entryNumber: 1,
    status: 'completed',
    signerFullName: 'Billy Bob',
    signerAddress: '123 Main',
    signerCity: 'Glenpool',
    signerState: 'OK',
    idType: 'driver_license',
    documentType: 'Deed',
    notarialActType: 'acknowledgment',
    feeCharged: 500,
    feeWaived: false,
    locationCity: 'Glenpool',
    locationState: 'OK',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('entry-signers', () => {
  it('formats primary name only', () => {
    expect(formatEntrySignerNames(mockEntry())).toBe('Billy Bob');
  });

  it('formats additional signers on combined line', () => {
    const entry = mockEntry({
      additionalSigners: [
        {
          signerIndex: 2,
          signerFullName: 'Jane Doe',
          signerAddress: '456 Oak',
          signerCity: 'Tulsa',
          signerState: 'OK',
          idType: 'driver_license',
        },
      ],
    });
    expect(formatEntrySignerNames(entry)).toBe('Billy Bob, Jane Doe');
    expect(formatEntrySignerList(entry)).toBe('#1 Billy Bob · #2 Jane Doe');
    expect(formatEntrySignerLines(entry)).toBe('#1 Billy Bob\n#2 Jane Doe');
    expect(entryHasMultipleSigners(entry)).toBe(true);
  });

  it('formats full street + city + state for journal print', () => {
    expect(formatSignerFullAddress(mockEntry())).toBe('123 Main, Glenpool, OK');
    const entry = mockEntry({
      additionalSigners: [
        {
          signerIndex: 2,
          signerFullName: 'Jane Doe',
          signerAddress: '564 East 138th Place',
          signerCity: 'Glenpool',
          signerState: 'OK',
          idType: 'driver_license',
        },
      ],
    });
    expect(formatEntryAddressLines(entry)).toBe(
      '#1 123 Main, Glenpool, OK\n#2 564 East 138th Place, Glenpool, OK',
    );
    expect(formatEntryIdTypeLines(entry)).toBe(
      '#1 driver license\n#2 driver license',
    );
  });

  it('single signer omits # prefix on print lines', () => {
    expect(formatEntrySignerLines(mockEntry())).toBe('Billy Bob');
    expect(formatEntryAddressLines(mockEntry())).toBe('123 Main, Glenpool, OK');
    expect(formatEntryIdTypeLines(mockEntry())).toBe('driver license');
  });
});
