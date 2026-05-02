import { describe, expect, it } from 'vitest';
import { parseAAMVA } from './aamva';
import { fixtures } from './__fixtures__/aamva-fixtures';

describe('parseAAMVA', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const parsed = parseAAMVA(fixture.raw);
      for (const [key, expectedValue] of Object.entries(fixture.expected)) {
        expect(
          parsed[key as keyof typeof parsed],
          `field "${key}" did not match for fixture: ${fixture.name}`,
        ).toBe(expectedValue);
      }
    });
  }

  it('returns an empty object for empty input', () => {
    expect(parseAAMVA('')).toEqual({});
  });

  it('ignores unknown 3-letter codes without throwing', () => {
    const raw = ['@', 'XYZsome unknown payload', 'DAJTX', 'DAQ12345678'].join('\n');
    const parsed = parseAAMVA(raw);
    expect(parsed.idNumber).toBe('12345678');
    expect(parsed.state).toBe('TX');
  });

  it('normalizes \\r\\n and \\r line endings', () => {
    const raw = '@\r\nDAQ12345678\rDAJTX\r\nDCSDOE\nDACJOHN';
    const parsed = parseAAMVA(raw);
    expect(parsed.idNumber).toBe('12345678');
    expect(parsed.state).toBe('TX');
    expect(parsed.fullName).toBe('JOHN DOE');
  });

  it('truncates a 9-digit ZIP to the leading 5 digits', () => {
    const raw = ['DAK123456789', 'DAJTX'].join('\n');
    expect(parseAAMVA(raw).postalCode).toBe('12345');
  });

  it('builds fullName from first + last when DAA is absent', () => {
    const raw = ['DCSSMITH', 'DACJOHN'].join('\n');
    expect(parseAAMVA(raw).fullName).toBe('JOHN SMITH');
  });
});
