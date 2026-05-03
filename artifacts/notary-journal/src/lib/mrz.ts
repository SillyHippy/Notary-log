/**
 * ICAO 9303 TD3 (passport) Machine-Readable Zone parser.
 *
 * TD3 is two lines of exactly 44 monospace characters at the bottom of every
 * passport's data page. We accept either a single string (lines joined with
 * \n or \r\n) or two pre-split strings. Spaces are stripped because OCR
 * commonly inserts them into the filler runs of '<'.
 *
 * Layout (line indices are 0-based):
 *   Line 1:
 *     0      : 'P' (document type / class — first letter must be P)
 *     1      : sub-type or '<'
 *     2..4   : issuing country / organisation (3 letters)
 *     5..43  : name field, surname<<given names, padded with '<'
 *   Line 2:
 *     0..8   : passport number
 *     9      : check digit for passport number
 *     10..12 : nationality (3 letters)
 *     13..18 : DOB (YYMMDD)
 *     19     : check digit for DOB
 *     20     : sex (M / F / <)
 *     21..26 : expiry (YYMMDD)
 *     27     : check digit for expiry
 *     28..41 : personal number (14 chars, padded with '<')
 *     42     : check digit for personal number (may be '<' if unused)
 *     43     : composite check digit over passport-num+check, dob+check,
 *              expiry+check, personal-num+check
 */

export interface MrzPassport {
  documentType: string;
  issuingCountry: string;
  surname: string;
  givenNames: string;
  fullName: string;
  passportNumber: string;
  nationality: string;
  /** ISO YYYY-MM-DD */
  dob: string;
  /** 'M' | 'F' | '' (when MRZ has '<') */
  sex: string;
  /** ISO YYYY-MM-DD */
  expirationDate: string;
  personalNumber: string;
  /** Per-field check digit results. true = passed, false = failed/invalid. */
  checkDigits: {
    passportNumber: boolean;
    dob: boolean;
    expiry: boolean;
    personalNumber: boolean;
    composite: boolean;
  };
  /** Convenience: true iff every check digit above is true. */
  allCheckDigitsValid: boolean;
}

const FILLER = '<';

/**
 * Compute the ICAO 7-3-1 check digit over a string.
 * Digits 0-9 map to themselves, letters A-Z map to 10-35, '<' is 0.
 */
export function mrzCheckDigit(input: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    let value: number;
    if (ch >= '0' && ch <= '9') {
      value = ch.charCodeAt(0) - 48;
    } else if (ch >= 'A' && ch <= 'Z') {
      value = ch.charCodeAt(0) - 55; // 'A' (65) → 10
    } else if (ch === FILLER) {
      value = 0;
    } else {
      // Unknown character — treat as 0 so the digit will simply mismatch.
      value = 0;
    }
    sum += value * weights[i % 3];
  }
  return sum % 10;
}

function stripFiller(s: string): string {
  return s.replace(/<+$/g, '').replace(/</g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse a 6-char YYMMDD MRZ date. `windowFor` controls how the 2-digit year
 * is expanded:
 *   - 'past' (DOB): years > current 2-digit year → 1900+yy, else 2000+yy.
 *   - 'future' (expiry): always 2000+yy (passports are valid ≤ 10 years).
 */
function parseMrzDate(yymmdd: string, windowFor: 'past' | 'future'): string {
  if (!/^\d{6}$/.test(yymmdd)) return '';
  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = yymmdd.substring(2, 4);
  const dd = yymmdd.substring(4, 6);
  let year: number;
  if (windowFor === 'future') {
    year = 2000 + yy;
  } else {
    const currentYY = new Date().getFullYear() % 100;
    year = yy > currentYY ? 1900 + yy : 2000 + yy;
  }
  // Sanity: month 01-12, day 01-31. If invalid we still return the formatted
  // string — the caller can decide what to do; check digit will usually fail.
  return `${year}-${mm}-${dd}`;
}

/** Split surname / given names from the MRZ name field. */
function splitName(nameField: string): { surname: string; givenNames: string } {
  const sep = nameField.indexOf('<<');
  if (sep === -1) {
    return { surname: stripFiller(nameField), givenNames: '' };
  }
  return {
    surname: stripFiller(nameField.substring(0, sep)),
    givenNames: stripFiller(nameField.substring(sep + 2)),
  };
}

/**
 * Normalize raw OCR text into the two MRZ lines. Strips spaces, pads short
 * lines with '<' to the canonical 44-char width, and returns null if we
 * can't find two plausible lines.
 */
function normalizeLines(input: string | [string, string]): [string, string] | null {
  let l1: string;
  let l2: string;
  if (Array.isArray(input)) {
    [l1, l2] = input;
  } else {
    const cleaned = input.replace(/\r/g, '\n');
    const lines = cleaned
      .split('\n')
      .map((l) => l.replace(/\s+/g, '').toUpperCase())
      .filter((l) => l.length > 0);
    if (lines.length < 2) return null;
    // Pick the last two non-empty lines that look MRZ-ish (mostly A-Z0-9<).
    const mrzLike = lines.filter((l) => /^[A-Z0-9<]+$/.test(l) && l.length >= 30);
    if (mrzLike.length < 2) return null;
    l1 = mrzLike[mrzLike.length - 2];
    l2 = mrzLike[mrzLike.length - 1];
  }
  l1 = l1.replace(/\s+/g, '').toUpperCase();
  l2 = l2.replace(/\s+/g, '').toUpperCase();
  // Pad / truncate to 44.
  if (l1.length < 44) l1 = l1.padEnd(44, FILLER);
  if (l2.length < 44) l2 = l2.padEnd(44, FILLER);
  l1 = l1.substring(0, 44);
  l2 = l2.substring(0, 44);
  return [l1, l2];
}

export interface MrzParseResult {
  ok: boolean;
  /** Present when the layout was parseable, even if check digits failed. */
  passport?: MrzPassport;
  error?: string;
}

export function parseMRZ(input: string | [string, string]): MrzParseResult {
  const lines = normalizeLines(input);
  if (!lines) return { ok: false, error: 'Could not locate two MRZ lines.' };
  const [l1, l2] = lines;

  if (l1[0] !== 'P') {
    return { ok: false, error: 'Not a TD3 passport MRZ (line 1 must start with P).' };
  }

  const documentType = l1.substring(0, 2).replace(/</g, '').trim() || 'P';
  const issuingCountry = l1.substring(2, 5);
  const { surname, givenNames } = splitName(l1.substring(5, 44));

  const passportNumberRaw = l2.substring(0, 9);
  const passportCheck = l2[9];
  const nationality = l2.substring(10, 13);
  const dobRaw = l2.substring(13, 19);
  const dobCheck = l2[19];
  const sexRaw = l2[20];
  const expiryRaw = l2.substring(21, 27);
  const expiryCheck = l2[27];
  const personalNumberRaw = l2.substring(28, 42);
  const personalCheck = l2[42];
  const compositeCheck = l2[43];

  const checks = {
    passportNumber: mrzCheckDigit(passportNumberRaw) === parseInt(passportCheck, 10),
    dob: mrzCheckDigit(dobRaw) === parseInt(dobCheck, 10),
    expiry: mrzCheckDigit(expiryRaw) === parseInt(expiryCheck, 10),
    // Personal number check digit may legitimately be '<' when the field is
    // entirely filler — treat that as "not applicable / passing".
    personalNumber:
      personalCheck === FILLER && personalNumberRaw.replace(/</g, '') === ''
        ? true
        : mrzCheckDigit(personalNumberRaw) === parseInt(personalCheck, 10),
    composite:
      mrzCheckDigit(
        passportNumberRaw + passportCheck + dobRaw + dobCheck + expiryRaw + expiryCheck +
          personalNumberRaw + personalCheck,
      ) === parseInt(compositeCheck, 10),
  };

  const sex = sexRaw === 'M' || sexRaw === 'F' ? sexRaw : '';

  const passport: MrzPassport = {
    documentType,
    issuingCountry,
    surname,
    givenNames,
    fullName: [givenNames, surname].filter(Boolean).join(' ').trim(),
    passportNumber: passportNumberRaw.replace(/</g, ''),
    nationality,
    dob: parseMrzDate(dobRaw, 'past'),
    sex,
    expirationDate: parseMrzDate(expiryRaw, 'future'),
    personalNumber: personalNumberRaw.replace(/</g, ''),
    checkDigits: checks,
    allCheckDigitsValid:
      checks.passportNumber && checks.dob && checks.expiry && checks.personalNumber && checks.composite,
  };

  return { ok: true, passport };
}

/** Map a parsed passport into the wizard's signer-info field shape. */
export function mrzToSignerFields(p: MrzPassport): Record<string, string> {
  const fields: Record<string, string> = {
    fullName: p.fullName,
    idNumber: p.passportNumber,
    idIssuingState: p.issuingCountry,
    dob: p.dob,
    expirationDate: p.expirationDate,
  };
  return fields;
}
