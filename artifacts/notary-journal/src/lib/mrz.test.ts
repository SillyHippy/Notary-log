import { describe, expect, it } from 'vitest';
import { mrzCheckDigit, parseMRZ, mrzToSignerFields } from './mrz';
import { mrzFixtures } from './__fixtures__/mrz-fixtures';

describe('mrzCheckDigit', () => {
  it('matches ICAO worked examples', () => {
    // From ICAO 9303 Part 4 Appendix to Section 4.
    expect(mrzCheckDigit('L898902C<')).toBe(3);
    expect(mrzCheckDigit('740812')).toBe(2);
    expect(mrzCheckDigit('120415')).toBe(9);
    expect(mrzCheckDigit('ZE184226B<<<<<')).toBe(1);
  });

  it('treats < as 0', () => {
    expect(mrzCheckDigit('<<<<<<')).toBe(0);
  });
});

describe('parseMRZ — fixtures', () => {
  for (const fx of mrzFixtures) {
    it(fx.name, () => {
      const result = parseMRZ(fx.lines);
      expect(result.ok).toBe(true);
      const p = result.passport!;
      expect(p.surname).toBe(fx.expected.surname);
      expect(p.givenNames).toBe(fx.expected.givenNames);
      expect(p.fullName).toBe(fx.expected.fullName);
      expect(p.issuingCountry).toBe(fx.expected.issuingCountry);
      expect(p.nationality).toBe(fx.expected.nationality);
      expect(p.passportNumber).toBe(fx.expected.passportNumber);
      expect(p.dob).toBe(fx.expected.dob);
      expect(p.sex).toBe(fx.expected.sex);
      expect(p.expirationDate).toBe(fx.expected.expirationDate);
      if (fx.expected.personalNumber !== undefined) {
        expect(p.personalNumber).toBe(fx.expected.personalNumber);
      }

      const failing = fx.expectedFailingChecks ?? [];
      const allFields = ['passportNumber','dob','expiry','personalNumber','composite'] as const;
      for (const field of allFields) {
        expect(
          p.checkDigits[field],
          `expected check digit "${field}" to be ${!failing.includes(field)}`
        ).toBe(!failing.includes(field));
      }
      expect(p.allCheckDigitsValid).toBe(failing.length === 0);
    });
  }
});

describe('parseMRZ — input handling', () => {
  it('accepts a single string with newline-joined lines', () => {
    const r = parseMRZ(
      'P<USADOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<\n1234567897USA8001014M3001019<<<<<<<<<<<<<<<8',
    );
    expect(r.ok).toBe(true);
    expect(r.passport?.surname).toBe('DOE');
  });

  it('strips spurious spaces inserted by OCR inside filler runs', () => {
    const r = parseMRZ([
      'P<USADOE<<JOHN<<<< <<<<<<<<<<<<<<<<<<<<<<<<<',
      '1234567897USA8001014M3001019<<<<<<<<<<<<<<<8',
    ]);
    expect(r.ok).toBe(true);
    expect(r.passport?.surname).toBe('DOE');
  });

  it('rejects lines whose first character is not P', () => {
    const r = parseMRZ([
      'I<USADOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<',
      '1234567897USA8001014M3001019<<<<<<<<<<<<<<<8',
    ]);
    expect(r.ok).toBe(false);
  });

  it('returns an error when fewer than two MRZ-shaped lines are present', () => {
    expect(parseMRZ('hello world').ok).toBe(false);
    expect(parseMRZ('').ok).toBe(false);
  });
});

describe('mrzToSignerFields', () => {
  it('maps a parsed passport to wizard signer fields', () => {
    const r = parseMRZ(mrzFixtures[1].lines);
    expect(r.ok).toBe(true);
    const fields = mrzToSignerFields(r.passport!);
    expect(fields.fullName).toBe('JOHN DOE');
    expect(fields.idNumber).toBe('123456789');
    expect(fields.idIssuingState).toBe('USA');
    expect(fields.dob).toBe('1980-01-01');
    expect(fields.expirationDate).toBe('2030-01-01');
  });
});
