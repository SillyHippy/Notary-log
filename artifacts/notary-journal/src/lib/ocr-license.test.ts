import { describe, expect, it } from 'vitest';
import { extractLicenseFields, mergeLicenseFields } from './ocr-license';
import { ocrLicenseFixtures } from './__fixtures__/ocr-license-fixtures';

describe('extractLicenseFields', () => {
  for (const fx of ocrLicenseFixtures) {
    it(fx.name, () => {
      const parsed = extractLicenseFields(fx.raw);
      for (const [key, expected] of Object.entries(fx.expected)) {
        expect(
          parsed[key as keyof typeof parsed],
          `field "${key}" mismatch on fixture: ${fx.name}`,
        ).toBe(expected);
      }
    });
  }

  it('returns an empty object for empty input', () => {
    expect(extractLicenseFields('')).toEqual({});
  });

  it('does not mistake a date for an ID number', () => {
    const parsed = extractLicenseFields('EXP 12/31/2030\nDOB 01/01/1990');
    expect(parsed.idNumber).toBeUndefined();
    expect(parsed.expirationDate).toBe('2030-12-31');
    expect(parsed.dob).toBe('1990-01-01');
  });
});

describe('mergeLicenseFields', () => {
  // The photo-capture flow OCRs the FRONT of a license first (where most
  // printed fields live) and then the BACK. The result MUST preserve the
  // front fields and only fill gaps from the back, mirroring how
  // handlePhotoCapture invokes processImageOCR with mode 'replace' then
  // 'fillGaps'. These tests pin that contract.
  it('keeps front fields when back has different values', () => {
    const front = { fullName: 'JANE DOE', address: '1 MAIN ST', dob: '1990-01-01' };
    const back = { fullName: 'WRONG NAME', expirationDate: '2030-12-31' };
    const merged = mergeLicenseFields(front, back);
    expect(merged.fullName).toBe('JANE DOE');
    expect(merged.address).toBe('1 MAIN ST');
    expect(merged.dob).toBe('1990-01-01');
    expect(merged.expirationDate).toBe('2030-12-31');
  });

  it('fills gaps from back when front is missing a field', () => {
    const front = { fullName: 'JANE DOE' };
    const back = { idNumber: 'X1234567', expirationDate: '2030-12-31' };
    const merged = mergeLicenseFields(front, back);
    expect(merged.fullName).toBe('JANE DOE');
    expect(merged.idNumber).toBe('X1234567');
    expect(merged.expirationDate).toBe('2030-12-31');
  });

  it('treats empty strings on the front as gaps', () => {
    const front = { fullName: 'JANE DOE', idNumber: '' };
    const back = { idNumber: 'X1234567' };
    expect(mergeLicenseFields(front, back).idNumber).toBe('X1234567');
  });
});
