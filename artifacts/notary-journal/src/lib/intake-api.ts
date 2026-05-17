/**
 * Intake API client — talks to our own server's /api/intake endpoints.
 *
 * The server stores submissions received from Web3Forms webhooks.
 * This client lists them and fetches individual submissions for prefill.
 * Every request must include ?access_key=<Web3Forms Access Key> for multi-user isolation.
 */

import { getSettings } from '@/lib/db';

const INTAKE_BASE = '/api/intake';

/** Retrieve the Web3Forms access key from settings (IndexedDB), falling back to localStorage. */
async function getWeb3FormsKey(): Promise<string | null> {
  // Try IndexedDB settings first
  try {
    const settings = await getSettings();
    if (settings.web3formsKey) return settings.web3formsKey;
  } catch {
    // fall through
  }
  // Fallback: localStorage (for tests or manual override)
  return localStorage.getItem('web3forms_key');
}

/** Build the base URL with the access_key query parameter. */
async function getIntakeUrl(path: string): Promise<string> {
  const key = await getWeb3FormsKey();
  if (!key) throw new Error('Intake key not configured. Please add your Web3Forms key in Settings.');
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}access_key=${encodeURIComponent(key)}`;
}

/** Raw submission stored on the server */
export interface IntakeSubmission {
  name: string;
  modifiedTime: string;
  size: number;
}

/** Normalized intake request for the app */
export interface IntakeRequest {
  id: string;
  createdAt: string;
  read: boolean;
  // Primary signer
  signerFirstName: string;
  signerMiddleName: string;
  signerLastName: string;
  email: string;
  phone: string;
  address: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  // ID
  idType: string;
  idNumber: string;
  idIssuedBy: string;
  idDateIssued: string;
  idExpirationDate: string;
  // ID files (base64 data URLs)
  idFrontFiles: string[];
  idBackFiles: string[];
  // Services
  servicesPerformed: string[];
  serviceType: string;
  preferredDate: string;
  notes: string;
  // Documents
  documents: Array<{ type: string; date: string }>;
  // Payment
  paymentMethod: string;
  totalAmount: string;
  payerName: string;
  // E-signature
  eSignature: string;
  // Additional signer (Signer 2)
  hasSigner2: boolean;
  signer2FirstName: string;
  signer2LastName: string;
  signer2Phone: string;
  signer2IdType: string;
  signer2IdNumber: string;
  signer2IdIssuedBy: string;
  signer2IdExpirationDate: string;
  signer2IdFrontFiles: string[];
  signer2IdBackFiles: string[];
}

/** Get the backup key from settings for auth */
async function getBackupKey(): Promise<string | null> {
  // The backup key is stored server-side; the app gets it from the startup log
  // We use a stored key in localStorage for convenience
  return localStorage.getItem('zo_backup_key');
}

/** Build auth headers — access_key is now in the URL, so headers stay empty */
async function authHeaders(): Promise<HeadersInit> {
  return {};
}

/** List all intake submissions — requires access_key */
export async function listSubmissions(): Promise<IntakeSubmission[]> {
  const url = await getIntakeUrl(INTAKE_BASE);
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Intake key not configured. Please add your Web3Forms key in Settings.');
    throw new Error(`Intake API error: ${res.status}`);
  }
  const json = await res.json();
  return json.files || [];
}

/** Fetch a single submission by filename — requires access_key */
export async function getSubmission(fileName: string): Promise<IntakeRequest> {
  const url = await getIntakeUrl(`${INTAKE_BASE}?file=${encodeURIComponent(fileName)}`);
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Intake key not configured. Please add your Web3Forms key in Settings.');
    throw new Error(`Intake API error: ${res.status}`);
  }
  const raw = await res.json();
  return normalizeSubmission(raw, fileName);
}

/** Mark a submission as read (we track this client-side in localStorage) */
export async function markSubmissionRead(fileName: string): Promise<void> {
  try {
    const read = JSON.parse(localStorage.getItem('intake_read') || '{}');
    read[fileName] = true;
    localStorage.setItem('intake_read', JSON.stringify(read));
  } catch {
    // ignore
  }
}

/** Delete a submission from the intake store — requires access_key */
export async function deleteSubmission(fileName: string): Promise<void> {
  const url = await getIntakeUrl(`${INTAKE_BASE}?file=${encodeURIComponent(fileName)}&_method=DELETE`);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('Intake key not configured. Please add your Web3Forms key in Settings.');
    throw new Error(`Failed to delete: ${res.status}`);
  }
}

/** Check if a submission has been read */
function isSubmissionRead(fileName: string): boolean {
  try {
    const read = JSON.parse(localStorage.getItem('intake_read') || '{}');
    return !!read[fileName];
  } catch {
    return false;
  }
}

/**
 * Normalize raw server data into the app's IntakeRequest shape.
 */
function normalizeSubmission(raw: Record<string, unknown>, fileName: string): IntakeRequest {
  const d = raw;
  const str = (key: string, fallback = '') => String(d[key] ?? fallback).trim();
  const multi = (key: string): string[] => {
    const val = d[key];
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  };

  const hasSigner2 = str('hasSigner2', 'no').toLowerCase() === 'yes';

  return {
    id: fileName,
    createdAt: raw.submitted_at ? String(raw.submitted_at) : new Date().toISOString(),
    read: isSubmissionRead(fileName),
    signerFirstName: str('signerFirstName'),
    signerMiddleName: str('signerMiddleName'),
    signerLastName: str('signerLastName'),
    email: str('email'),
    phone: str('phone'),
    address: str('signerAddress'),
    address2: str('signerAddress2'),
    city: str('signerCity'),
    state: str('signerState'),
    zip: str('signerZip'),
    idType: str('idType'),
    idNumber: str('idNumber'),
    idIssuedBy: str('idIssuedBy'),
    idDateIssued: str('idDateIssued'),
    idExpirationDate: str('idExpirationDate'),
    idFrontFiles: Array.isArray(d.idFrontFiles) ? d.idFrontFiles.map(String) : [],
    idBackFiles: Array.isArray(d.idBackFiles) ? d.idBackFiles.map(String) : [],
    servicesPerformed: multi('servicesPerformed'),
    serviceType: str('serviceType'),
    preferredDate: str('preferredDate'),
    notes: str('notes'),
    documents: [],
    paymentMethod: str('paymentMethod'),
    totalAmount: str('totalAmount'),
    payerName: str('payerName'),
    eSignature: str('eSignature'),
    hasSigner2,
    signer2FirstName: str('signer2FirstName'),
    signer2LastName: str('signer2LastName'),
    signer2Phone: str('signer2Phone'),
    signer2IdType: str('signer2IdType'),
    signer2IdNumber: str('signer2IdNumber'),
    signer2IdIssuedBy: str('signer2IdIssuedBy'),
    signer2IdExpirationDate: str('signer2IdExpirationDate'),
    signer2IdFrontFiles: Array.isArray(d.signer2IdFrontFiles) ? d.signer2IdFrontFiles.map(String) : [],
    signer2IdBackFiles: Array.isArray(d.signer2IdBackFiles) ? d.signer2IdBackFiles.map(String) : [],
  };
}

/** Test the intake connection — validates server reachability and key validity */
export async function testIntakeConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const url = await getIntakeUrl(INTAKE_BASE);
    const res = await fetch(url);
    if (res.ok) return { ok: true, message: 'Connected to intake endpoint successfully.' };
    if (res.status === 401) return { ok: false, message: 'Intake key not configured or invalid. Please add your Web3Forms key in Settings.' };
    return { ok: false, message: `Intake API error: ${res.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed.' };
  }
}
