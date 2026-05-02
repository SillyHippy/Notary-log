export interface SignerFields {
  firstName: string;
  lastName: string;
  fullName: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  dob: string;
  idNumber: string;
  idIssuingState: string;
  expirationDate: string;
  country: string;
}

export function parseAAMVA(raw: string): Partial<SignerFields> {
  const fields: Partial<SignerFields> = {};

  // Normalize line endings (some states use \r\n or \r)
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (line.length < 3) continue;

    // Oklahoma (and some other states) concatenate the "DL" subfile designator
    // directly before the first field with no newline: e.g. "DLDAQJ1234567"
    // Strip known 2-letter subfile prefixes (DL, ZA-ZZ) when followed by a field code
    if (/^(DL|DM|DZ|Z[A-Z])[A-Z]{3}/.test(line)) {
      line = line.substring(2);
    }

    const code = line.substring(0, 3);
    const value = line.substring(3).trim();
    if (!value) continue;

    switch (code) {
      case 'DAA':
        fields.fullName = value;
        break;
      case 'DAC':
      case 'DCT':
        fields.firstName = value;
        break;
      case 'DAB':
      case 'DCS':
        fields.lastName = value;
        break;
      case 'DAG':
        fields.address = value;
        break;
      case 'DAI':
        fields.city = value;
        break;
      case 'DAJ':
        // Address state — for a driver's license this is also the issuing state
        fields.state = value;
        fields.idIssuingState = value;
        break;
      case 'DAK':
        fields.postalCode = value.substring(0, 5);
        break;
      case 'DBB':
        if (value.length === 8) {
          fields.dob = `${value.substring(4, 8)}-${value.substring(0, 2)}-${value.substring(2, 4)}`;
        }
        break;
      case 'DAQ':
        fields.idNumber = value;
        break;
      case 'DCF':
        // Fallback for states that store license number in Document Discriminator
        if (!fields.idNumber) {
          fields.idNumber = value;
        }
        break;
      case 'DBA':
        if (value.length === 8) {
          fields.expirationDate = `${value.substring(4, 8)}-${value.substring(0, 2)}-${value.substring(2, 4)}`;
        }
        break;
      case 'DCG':
        fields.country = value;
        break;
    }
  }

  if (!fields.fullName && fields.firstName && fields.lastName) {
    fields.fullName = `${fields.firstName} ${fields.lastName}`;
  }

  // Oklahoma quirk: the barcode's DAQ field contains the full Document
  // Discriminator (license number + DOB + issue date + suffix character),
  // not just the license number printed on the card. The actual DL number
  // is the leading 1 uppercase letter + 9 digits. Trim it back to that.
  if (fields.idIssuingState === 'OK' && fields.idNumber && fields.idNumber.length > 10) {
    const okMatch = fields.idNumber.match(/^[A-Z]\d{9}/);
    if (okMatch) {
      fields.idNumber = okMatch[0];
    }
  }

  return fields;
}
