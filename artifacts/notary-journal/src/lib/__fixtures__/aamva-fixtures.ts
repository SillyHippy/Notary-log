export interface AamvaFixture {
  name: string;
  description: string;
  raw: string;
  expected: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    dob?: string;
    idNumber?: string;
    idIssuingState?: string;
    expirationDate?: string;
    country?: string;
  };
}

const oklahomaRaw = [
  '@',
  '\x1e\rANSI 636026080002DL00410288ZO03290008',
  'DLDAQE083739931011492100125R',
  'DCSSMITH',
  'DACJOHN',
  'DBB11141992',
  'DBA01012030',
  'DAG123 MAIN ST',
  'DAITULSA',
  'DAJOK',
  'DAK741030000',
  'DCGUSA',
].join('\n');

const texasRaw = [
  '@',
  '\x1e\rANSI 636015080002DL00410279',
  'DAQ12345678',
  'DCSGARCIA',
  'DACMARIA',
  'DBB03151985',
  'DBA06302028',
  'DAG456 ELM ST',
  'DAIAUSTIN',
  'DAJTX',
  'DAK787010000',
  'DCGUSA',
].join('\n');

const kansasSubfileRaw = [
  '@',
  '\x1e\rANSI 636022080002DL00410279',
  'DLDAQK01234567',
  'DLDCSDOE',
  'DLDACJANE',
  'DLDBB07041990',
  'DLDBA12312029',
  'DLDAG789 OAK AVE',
  'DLDAITOPEKA',
  'DLDAJKS',
  'DLDAK666010000',
  'DLDCGUSA',
].join('\n');

const californiaDcfFallbackRaw = [
  '@',
  '\x1e\rANSI 636014080002DL00410279',
  'DCFCAFALLBACK123',
  'DCSDOE',
  'DACJANE',
  'DBB05151988',
  'DBA09092027',
  'DAG999 PALM ST',
  'DAILOS ANGELES',
  'DAJCA',
  'DAK900010000',
  'DCGUSA',
].join('\n');

const oklahomaShortIdRaw = [
  '@',
  '\x1e\rANSI 636026080002DL00410288',
  'DAQA123456789',
  'DCSDOE',
  'DACJOHN',
  'DBB02021970',
  'DBA02022030',
  'DAG1 SHORT WAY',
  'DAINORMAN',
  'DAJOK',
  'DAK730000000',
  'DCGUSA',
].join('\n');

const oklahomaNonMatchingDaqRaw = [
  '@',
  '\x1e\rANSI 636026080002DL00410288',
  'DAQ987654321ABC',
  'DCSDOE',
  'DACJOHN',
  'DBB02021970',
  'DBA02022030',
  'DAG1 SHORT WAY',
  'DAINORMAN',
  'DAJOK',
  'DAK730000000',
  'DCGUSA',
].join('\n');

export const fixtures: AamvaFixture[] = [
  {
    name: 'Oklahoma (DAQ contains full Document Discriminator)',
    description:
      'OK packs license number + DOB + issue date + suffix into DAQ. Parser ' +
      'should trim back to leading [A-Z]\\d{9}. Also exercises the "DL" ' +
      'subfile-prefix concatenation on the first data line.',
    raw: oklahomaRaw,
    expected: {
      firstName: 'JOHN',
      lastName: 'SMITH',
      fullName: 'JOHN SMITH',
      address: '123 MAIN ST',
      city: 'TULSA',
      state: 'OK',
      idIssuingState: 'OK',
      postalCode: '74103',
      dob: '1992-11-14',
      idNumber: 'E083739931',
      expirationDate: '2030-01-01',
      country: 'USA',
    },
  },
  {
    name: 'Texas (clean modern format)',
    description:
      'TX uses DAQ for the license number directly with no quirks. Verifies ' +
      'baseline parsing for a non-OK state stays unchanged.',
    raw: texasRaw,
    expected: {
      firstName: 'MARIA',
      lastName: 'GARCIA',
      fullName: 'MARIA GARCIA',
      address: '456 ELM ST',
      city: 'AUSTIN',
      state: 'TX',
      idIssuingState: 'TX',
      postalCode: '78701',
      dob: '1985-03-15',
      idNumber: '12345678',
      expirationDate: '2028-06-30',
      country: 'USA',
    },
  },
  {
    name: 'Kansas (every line carries the "DL" subfile prefix)',
    description:
      'Some states emit every field line prefixed with "DL". Parser must ' +
      'strip the prefix before extracting the 3-letter code, on every line.',
    raw: kansasSubfileRaw,
    expected: {
      firstName: 'JANE',
      lastName: 'DOE',
      fullName: 'JANE DOE',
      address: '789 OAK AVE',
      city: 'TOPEKA',
      state: 'KS',
      idIssuingState: 'KS',
      postalCode: '66601',
      dob: '1990-07-04',
      idNumber: 'K01234567',
      expirationDate: '2029-12-31',
      country: 'USA',
    },
  },
  {
    name: 'California (DAQ missing — DCF used as fallback)',
    description:
      'When a card omits DAQ, DCF (Document Discriminator) is used as the ' +
      'license number. Verifies the fallback path still works.',
    raw: californiaDcfFallbackRaw,
    expected: {
      firstName: 'JANE',
      lastName: 'DOE',
      fullName: 'JANE DOE',
      address: '999 PALM ST',
      city: 'LOS ANGELES',
      state: 'CA',
      idIssuingState: 'CA',
      postalCode: '90001',
      dob: '1988-05-15',
      idNumber: 'CAFALLBACK123',
      expirationDate: '2027-09-09',
      country: 'USA',
    },
  },
  {
    name: 'Oklahoma (DAQ already exactly 10 chars — no trim needed)',
    description:
      'Guards against over-eager trimming: an OK card whose DAQ is already ' +
      'the printed 10-character license number should pass through unchanged.',
    raw: oklahomaShortIdRaw,
    expected: {
      idNumber: 'A123456789',
      idIssuingState: 'OK',
      state: 'OK',
    },
  },
  {
    name: 'Oklahoma (DAQ does not match expected pattern — fall back to raw)',
    description:
      'If an OK DAQ value is unexpectedly long but does not start with one ' +
      'letter + nine digits, the parser must leave the raw value alone ' +
      'rather than silently dropping data.',
    raw: oklahomaNonMatchingDaqRaw,
    expected: {
      idNumber: '987654321ABC',
      idIssuingState: 'OK',
      state: 'OK',
    },
  },
];
