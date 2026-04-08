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
  expirationDate: string;
  country: string;
}

export function parseAAMVA(raw: string): Partial<SignerFields> {
  const fields: Partial<SignerFields> = {};
  const lines = raw.split('\n');

  for (const line of lines) {
    if (line.length < 3) continue;
    const code = line.substring(0, 3);
    const value = line.substring(3).trim();

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
        fields.state = value;
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

  return fields;
}
