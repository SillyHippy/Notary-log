/**
 * Heuristic OCR field extractor for the front of a US driver's license / ID
 * card. Used as a fallback when PDF417 scan fails or isn't present (paper
 * IDs, weird state formats, military IDs).
 *
 * The patterns below were tightened against fixtures that mirror real OCR
 * output (with typical confusions like O/0, I/1, S/5) for the top US issuing
 * states. Each rule is intentionally narrow: false positives are worse than
 * misses because the wizard always lets the notary edit the result.
 */

export interface OcrLicenseFields {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  dob?: string;
  idNumber?: string;
  idIssuingState?: string;
  issueDate?: string;
  expirationDate?: string;
}

const STATE_ABBRS = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

/** Convert MM/DD/YYYY (or MM-DD-YY etc.) to ISO YYYY-MM-DD. */
function toIsoDate(raw: string, futureBias: boolean): string | undefined {
  const parts = raw.split(/[\/\-.]/);
  if (parts.length !== 3) return undefined;
  let [m, d, y] = parts.map((p) => parseInt(p, 10));
  if (isNaN(m) || isNaN(d) || isNaN(y)) return undefined;
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  if (y < 100) y = futureBias ? 2000 + y : (y > new Date().getFullYear() % 100 ? 1900 + y : 2000 + y);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DATE_RX = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;

/**
 * Find a date that follows one of the labels in `labels`. Tolerant of
 * arbitrary punctuation between the label and the digits.
 */
function findLabeledDate(text: string, labels: RegExp, futureBias: boolean): string | undefined {
  const rx = new RegExp(`(?:${labels.source})[^0-9\\n]{0,20}(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4})`, 'i');
  const m = text.match(rx);
  if (!m) return undefined;
  return toIsoDate(m[1], futureBias);
}

function extractName(text: string): { fullName?: string; firstName?: string; lastName?: string } {
  // 1) Modern AAMVA-style human-readable: "1 LASTNAME" / "2 FIRSTNAME MIDDLE"
  //    These appear on CA, NY, IL, OH and several others.
  const ln = text.match(/(?:^|\n)\s*1\s+([A-Z][A-Z'\- ]{1,40})(?:\n|$)/m);
  const fn = text.match(/(?:^|\n)\s*2\s+([A-Z][A-Z'\- ]{1,40})(?:\n|$)/m);
  if (ln && fn) {
    const last = ln[1].trim();
    const first = fn[1].trim();
    return { lastName: last, firstName: first, fullName: `${first} ${last}` };
  }

  // 2) Explicit LN/FN labels (TX, FL, GA, federal ID). Use [^\S\n]+ for the
  //    inline gap so we don't slurp the next line's content into the name.
  const lnFn = text.match(
    /\bLN[^\S\n]+([A-Z'\-]+(?:[^\S\n]+[A-Z'\-]+)*)[^\S\n]*\n[^\S\n]*FN[^\S\n]+([A-Z'\-]+(?:[^\S\n]+[A-Z'\-]+)*)/i,
  );
  if (lnFn) {
    return {
      lastName: lnFn[1].trim(),
      firstName: lnFn[2].trim(),
      fullName: `${lnFn[2].trim()} ${lnFn[1].trim()}`,
    };
  }
  // Same shape but on the same line: "LN GARCIA FN MARIA"
  const lnFnInline = text.match(
    /\bLN[^\S\n]+([A-Z'\-]+(?:[^\S\n]+[A-Z'\-]+)*)[^\S\n]+FN[^\S\n]+([A-Z'\-]+(?:[^\S\n]+[A-Z'\-]+)*)/i,
  );
  if (lnFnInline) {
    return {
      lastName: lnFnInline[1].trim(),
      firstName: lnFnInline[2].trim(),
      fullName: `${lnFnInline[2].trim()} ${lnFnInline[1].trim()}`,
    };
  }

  // 3) "LAST, FIRST MIDDLE" (PA and some older formats)
  const lastFirst = text.match(/\b([A-Z][A-Z'\-]{1,30}),\s+([A-Z][A-Z' \-]{1,40})\b/);
  if (lastFirst) {
    return {
      lastName: lastFirst[1].trim(),
      firstName: lastFirst[2].trim(),
      fullName: `${lastFirst[2].trim()} ${lastFirst[1].trim()}`,
    };
  }

  return {};
}

/**
 * Find a US-style street address line: starts with a house number, contains
 * a street-suffix keyword. Avoids matching dates, ID numbers, or zip codes.
 */
function extractAddressBlock(
  lines: string[],
): { address?: string; city?: string; state?: string; postalCode?: string } {
  const SUFFIX =
    /\b(ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|RD|ROAD|DR|DRIVE|LN|LANE|CT|COURT|WAY|PL|PLACE|PKWY|PARKWAY|HWY|HIGHWAY|TRL|TRAIL|TER|TERRACE|CIR|CIRCLE|LOOP|XING|CROSSING)\b/i;
  let addressIdx = -1;
  let address: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    // Strip leading AAMVA address-indicator "8 " (CA / NY / IL print "8" as
    // the address-line label). Without this, the address would start with
    // a stray "8".
    const line = lines[i].replace(/^8\s+(?=\d{1,6}\s)/, '');
    if (/^\d{1,6}\s+[A-Z0-9]/.test(line) && SUFFIX.test(line)) {
      address = line.replace(/\s+/g, ' ').trim();
      addressIdx = i;
      break;
    }
  }
  // The "City ST 12345" line is normally the next non-empty line.
  let city: string | undefined;
  let state: string | undefined;
  let postalCode: string | undefined;
  if (addressIdx >= 0) {
    for (let j = addressIdx + 1; j < Math.min(addressIdx + 4, lines.length); j++) {
      const m = lines[j].match(/^([A-Z][A-Z .'\-]+?),?\s+([A-Z]{2})\s+(\d{5})(?:-?\d{4})?$/);
      if (m && STATE_ABBRS.has(m[2])) {
        city = m[1].trim();
        state = m[2];
        postalCode = m[3];
        break;
      }
    }
  }
  // Fallback: search for a "ST 12345" pattern anywhere if we missed the city/state line.
  if (!state) {
    for (const line of lines) {
      const m = line.match(/\b([A-Z]{2})\s+(\d{5})(?:-?\d{4})?\b/);
      if (m && STATE_ABBRS.has(m[1])) {
        state = m[1];
        postalCode = m[2];
        break;
      }
    }
  }
  return { address, city, state, postalCode };
}

/**
 * Find a license number. We bias toward labeled patterns (DL, LIC, NO, ID)
 * but accept a positionally plausible alphanumeric token of 6–14 chars when
 * no label is present. Avoids matching dates and zip codes.
 */
function extractIdNumber(text: string, lines: string[]): string | undefined {
  // Pennsylvania-style "DLN" prefix — checked first because PA prints
  // "DRIVER LICENSE" right above the surname, which can otherwise let the
  // generic LICENSE label below grab a name token.
  const pa = text.match(/\bDLN[\s#:.]*([0-9][0-9 ]{6,14})/i);
  if (pa) return pa[1].replace(/\s+/g, '');
  // Labeled forms — most reliable. We scan line-by-line (to avoid the
  // "DRIVER LICENSE" header capturing the *next* line as its number) and
  // try the most specific labels first.
  const LABELS: RegExp[] = [
    /\b(?:DLN|USID|EDL)[\s#:.]+([A-Z0-9][A-Z0-9 \-]{5,20})/i,
    /\bDL[\s#:.]+([A-Z0-9][A-Z0-9 \-]{5,20})/i,
    /\bID[\s#:.]+([A-Z0-9][A-Z0-9 \-]{5,20})/i,
    /\bLic\b[\s#:.]+([A-Z0-9][A-Z0-9 \-]{5,20})/i,
    /\b(?:NO\.?|NUM(?:BER)?)[\s#:.]+([A-Z0-9][A-Z0-9 \-]{5,20})/i,
    // Generic LICENSE label — last resort because the word also appears
    // in "DRIVER LICENSE" headers.
    /\bLICENSE[\s#:.]+([A-Z0-9][A-Z0-9 \-]{5,20})/i,
  ];
  for (const line of lines) {
    for (const re of LABELS) {
      const m = line.match(re);
      if (!m) continue;
      const raw = m[1];
      const cleaned = raw.replace(/[\s\-]/g, '').toUpperCase();
      if (cleaned.length < 6 || cleaned.length > 14) continue;
      if (!/\d/.test(cleaned)) continue;
      if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(raw)) continue;
      return cleaned;
    }
  }
  // Last-resort positional: look for a token of letters+digits (or 8+ digits)
  // on a line that doesn't otherwise look like a name or address.
  for (const line of lines) {
    if (SKIP_FOR_ID.test(line)) continue;
    const tokens = line.split(/\s+/);
    for (const tok of tokens) {
      if (/^[A-Z]?\d{7,12}$/.test(tok)) return tok;
      if (/^[A-Z]\d{6,12}$/.test(tok)) return tok;
    }
  }
  return undefined;
}

const SKIP_FOR_ID =
  /\b(EXP|DOB|ISS|EXPIRES|EXPIRY|BIRTH|ISSUED|HEIGHT|WEIGHT|EYES|HAIR|ADDRESS|SEX|CLASS|END|REST)\b/i;

export function extractLicenseFields(rawText: string): OcrLicenseFields {
  const text = rawText.replace(/\r/g, '\n');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: OcrLicenseFields = {};

  Object.assign(out, extractName(text));
  Object.assign(out, extractAddressBlock(lines));

  const dob = findLabeledDate(text, /DOB|D\.?O\.?B|Date\s*of\s*Birth|Birth/i, false);
  if (dob) out.dob = dob;

  const exp = findLabeledDate(text, /EXP|EXPIRES?|EXPIRY|EXPIRATION/i, true);
  if (exp) out.expirationDate = exp;

  const iss = findLabeledDate(text, /ISS|ISSUED|ISSUE\s*DATE|ISSUEDATE/i, false);
  if (iss) out.issueDate = iss;

  const idn = extractIdNumber(text, lines);
  if (idn) out.idNumber = idn;

  // The issuing state on the front of a US license is normally the same as
  // the address state. This is a best-effort signal and is overwritten by
  // the wizard if PDF417 also fired.
  if (out.state) out.idIssuingState = out.state;

  return out;
}
