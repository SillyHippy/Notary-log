import { describe, expect, it } from 'vitest';
import { extractLicenseFields } from './ocr-license';
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
