/**
 * OCR fixtures for the front of US driver's licenses. These strings mirror
 * the raw text that tesseract.js typically emits for the top issuing
 * states — line order, label spelling, and whitespace are preserved.
 *
 * Cases focus on formats whose previous parse was either wrong or empty:
 *   - California (numbered "1 LAST" / "2 FIRST" lines)
 *   - Texas      (LN / FN labels, DL # label)
 *   - New York   (numbered, ID # label)
 *   - Florida    (LN / FN labels, multi-word given name)
 *   - Pennsylvania (DLN prefix, comma-separated name)
 *   - Illinois   (numbered, "DL" inline label)
 *   - Federal PIV / military ID (LN/FN, USID prefix)
 */
export interface OcrLicenseFixture {
  name: string;
  raw: string;
  expected: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    dob?: string;
    idNumber?: string;
    expirationDate?: string;
    issueDate?: string;
    idIssuingState?: string;
  };
}

export const ocrLicenseFixtures: OcrLicenseFixture[] = [
  {
    name: 'California — numbered name lines, DL label',
    raw: [
      'CALIFORNIA',
      'DRIVER LICENSE',
      'DL B1234567',
      '1 SAMPLE',
      '2 ALEXANDER J',
      '8 2570 24TH STREET',
      'SAN FRANCISCO, CA 94110',
      'DOB 03/12/1990',
      'EXP 03/12/2028',
      'ISS 04/01/2024',
      'CLASS C SEX M HAIR BRN EYES BRN',
    ].join('\n'),
    expected: {
      fullName: 'ALEXANDER J SAMPLE',
      firstName: 'ALEXANDER J',
      lastName: 'SAMPLE',
      address: '2570 24TH STREET',
      city: 'SAN FRANCISCO',
      state: 'CA',
      postalCode: '94110',
      dob: '1990-03-12',
      expirationDate: '2028-03-12',
      issueDate: '2024-04-01',
      idNumber: 'B1234567',
      idIssuingState: 'CA',
    },
  },
  {
    name: 'Texas — LN/FN labels, DL # prefix',
    raw: [
      'TEXAS',
      'DRIVER LICENSE',
      'DL # 12345678',
      'LN GARCIA',
      'FN MARIA ELENA',
      '456 ELM ST',
      'AUSTIN, TX 78701',
      'DOB: 03/15/1985',
      'EXP: 06/30/2028',
      'ISS: 07/01/2023',
      'SEX F EYES BRN',
    ].join('\n'),
    expected: {
      fullName: 'MARIA ELENA GARCIA',
      firstName: 'MARIA ELENA',
      lastName: 'GARCIA',
      address: '456 ELM ST',
      city: 'AUSTIN',
      state: 'TX',
      postalCode: '78701',
      dob: '1985-03-15',
      expirationDate: '2028-06-30',
      issueDate: '2023-07-01',
      idNumber: '12345678',
      idIssuingState: 'TX',
    },
  },
  {
    name: 'New York — numbered lines, ID label',
    raw: [
      'NEW YORK STATE',
      'DRIVER LICENSE',
      'ID 123 456 789',
      '1 OBRIEN',
      '2 PATRICK SEAN',
      '8 1200 MAIN ST APT 4B',
      'BROOKLYN, NY 11201',
      'DOB 11/04/1978',
      'EXP 11/04/2027',
      'ISSUED 11/04/2019',
    ].join('\n'),
    expected: {
      fullName: 'PATRICK SEAN OBRIEN',
      firstName: 'PATRICK SEAN',
      lastName: 'OBRIEN',
      address: '1200 MAIN ST APT 4B',
      city: 'BROOKLYN',
      state: 'NY',
      postalCode: '11201',
      dob: '1978-11-04',
      expirationDate: '2027-11-04',
      issueDate: '2019-11-04',
      idNumber: '123456789',
      idIssuingState: 'NY',
    },
  },
  {
    name: 'Ohio — numbered name lines, lic # label',
    raw: [
      'OHIO',
      'DRIVER LICENSE',
      'Lic # AB123456',
      '1 BAKER',
      '2 EMILY ROSE',
      '8 4400 EUCLID AVE',
      'CLEVELAND, OH 44103',
      'DOB 02/14/1989',
      'EXP 02/14/2028',
      'ISS 02/14/2024',
    ].join('\n'),
    expected: {
      fullName: 'EMILY ROSE BAKER',
      firstName: 'EMILY ROSE',
      lastName: 'BAKER',
      address: '4400 EUCLID AVE',
      city: 'CLEVELAND',
      state: 'OH',
      postalCode: '44103',
      dob: '1989-02-14',
      expirationDate: '2028-02-14',
      issueDate: '2024-02-14',
      idNumber: 'AB123456',
      idIssuingState: 'OH',
    },
  },
  {
    name: 'Georgia — LN/FN labels, DL number',
    raw: [
      'GEORGIA',
      'DRIVER LICENSE',
      'LN WASHINGTON',
      'FN ANDRE M',
      'DL: 052345678',
      '900 PEACHTREE ST NE',
      'ATLANTA, GA 30309',
      'DOB 12/01/1980',
      'EXP 12/01/2029',
      'SEX M',
    ].join('\n'),
    expected: {
      fullName: 'ANDRE M WASHINGTON',
      firstName: 'ANDRE M',
      lastName: 'WASHINGTON',
      address: '900 PEACHTREE ST NE',
      city: 'ATLANTA',
      state: 'GA',
      postalCode: '30309',
      dob: '1980-12-01',
      expirationDate: '2029-12-01',
      idNumber: '052345678',
      idIssuingState: 'GA',
    },
  },
  {
    name: 'Florida — LN/FN labels, multi-word given name',
    raw: [
      'FLORIDA',
      'DRIVER LICENSE',
      'LN MARTINEZ',
      'FN ANA SOFIA',
      '789 PALM AVE',
      'MIAMI, FL 33101',
      'DOB 07/22/1982',
      'EXP 07/22/2030',
      'LIC: M626-789-82-345-0',
    ].join('\n'),
    expected: {
      fullName: 'ANA SOFIA MARTINEZ',
      firstName: 'ANA SOFIA',
      lastName: 'MARTINEZ',
      address: '789 PALM AVE',
      city: 'MIAMI',
      state: 'FL',
      postalCode: '33101',
      dob: '1982-07-22',
      expirationDate: '2030-07-22',
      idIssuingState: 'FL',
    },
  },
  {
    name: 'Pennsylvania — DLN prefix, LAST, FIRST name format',
    raw: [
      'PENNSYLVANIA',
      'DRIVER LICENSE',
      'JOHNSON, ROBERT MICHAEL',
      'DLN 12 345 678',
      '321 OAK RD',
      'PHILADELPHIA, PA 19103',
      'DOB 05/18/1975',
      'EXP 05/18/2029',
    ].join('\n'),
    expected: {
      fullName: 'ROBERT MICHAEL JOHNSON',
      firstName: 'ROBERT MICHAEL',
      lastName: 'JOHNSON',
      address: '321 OAK RD',
      city: 'PHILADELPHIA',
      state: 'PA',
      postalCode: '19103',
      dob: '1975-05-18',
      expirationDate: '2029-05-18',
      idNumber: '12345678',
      idIssuingState: 'PA',
    },
  },
  {
    name: 'Illinois — numbered lines, DL label',
    raw: [
      'ILLINOIS',
      'DRIVER LICENSE',
      'DL: A123-4567-8901',
      '1 NGUYEN',
      '2 LINH THUY',
      '8 555 N WACKER DR',
      'CHICAGO, IL 60606',
      'DOB 09/02/1991',
      'EXP 09/02/2026',
    ].join('\n'),
    expected: {
      fullName: 'LINH THUY NGUYEN',
      firstName: 'LINH THUY',
      lastName: 'NGUYEN',
      address: '555 N WACKER DR',
      city: 'CHICAGO',
      state: 'IL',
      postalCode: '60606',
      dob: '1991-09-02',
      expirationDate: '2026-09-02',
      idIssuingState: 'IL',
    },
  },
  {
    name: 'Federal PIV / military ID — LN/FN, USID prefix',
    raw: [
      'UNITED STATES',
      'UNIFORMED SERVICES IDENTIFICATION',
      'LN HARRIS',
      'FN DANIEL R',
      'USID 1234567890',
      'EXP 12/31/2027',
      'DOB 04/05/1988',
    ].join('\n'),
    expected: {
      fullName: 'DANIEL R HARRIS',
      firstName: 'DANIEL R',
      lastName: 'HARRIS',
      dob: '1988-04-05',
      expirationDate: '2027-12-31',
      idNumber: '1234567890',
    },
  },
];
