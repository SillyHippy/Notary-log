/**
 * Intake API client — Zo Computer SQLite intake or legacy Web3Forms JSON files.
 *
 * On Zo Computer with zoComputerToken configured, lists/fetches/deletes via
 * token-validated /api/intake. Otherwise uses Web3Forms key + file webhook store.
 */

import { getSettings } from '@/lib/db';

const INTAKE_BASE = '/api/intake';

export type IntakeMode = 'zo' | 'web3forms';

/** True when the app is served from Zo Computer (same-origin Zo APIs available). */
export function isZoHost(): boolean {
  const host = window.location.hostname;
  return (
    host.endsWith('.zocomputer.io') ||
    host === 'localhost' ||
    host === '127.0.0.1'
  );
}

async function getSettingsKeys(): Promise<{
  zoToken: string | null;
  web3Key: string | null;
}> {
  try {
    const settings = await getSettings();
    return {
      zoToken: settings.zoComputerToken?.trim() || null,
      web3Key: settings.web3formsKey?.trim() || null,
    };
  } catch {
    return { zoToken: null, web3Key: null };
  }
}

/** Active intake backend for the notary dashboard. */
export async function getIntakeMode(): Promise<IntakeMode> {
  const { zoToken, web3Key } = await getSettingsKeys();
  if (isZoHost() && zoToken) return 'zo';
  if (web3Key) return 'web3forms';
  throw new Error('Intake key not configured. Add a Zo Computer token or Web3Forms key in Settings.');
}

/** Key sent as ?key= on intake API requests. */
export async function getActiveIntakeKey(): Promise<string> {
  const mode = await getIntakeMode();
  const { zoToken, web3Key } = await getSettingsKeys();
  const key = mode === 'zo' ? zoToken : web3Key;
  if (!key) {
    throw new Error(
      mode === 'zo'
        ? 'Zo Computer form token not configured. Add your token in Settings.'
        : 'Intake key not configured. Please add your Web3Forms key in Settings.',
    );
  }
  return key;
}

async function getIntakeUrl(path: string): Promise<string> {
  const key = await getActiveIntakeKey();
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}key=${encodeURIComponent(key)}`;
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
  idType: string;
  idNumber: string;
  idIssuedBy: string;
  idDateIssued: string;
  idExpirationDate: string;
  idFrontFiles: string[];
  idBackFiles: string[];
  idFrontImage?: string;
  idBackImage?: string;
  servicesPerformed: string[];
  serviceType: string;
  preferredDate: string;
  notes: string;
  documents: Array<{ type: string; date: string }>;
  paymentMethod: string;
  totalAmount: string;
  payerName: string;
  eSignature: string;
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

export async function listSubmissions(): Promise<IntakeSubmission[]> {
  const url = await getIntakeUrl(INTAKE_BASE);
  const res = await fetch(url);
  if (!res.ok) {
    const mode = await getIntakeMode().catch(() => 'web3forms' as IntakeMode);
    if (res.status === 401) {
      throw new Error(
        mode === 'zo'
          ? 'Zo Computer form token invalid. Check Settings.'
          : 'Intake key not configured. Please add your Web3Forms key in Settings.',
      );
    }
    throw new Error(`Intake API error: ${res.status}`);
  }
  const json = await res.json();
  return json.files || [];
}

export async function getSubmission(fileName: string): Promise<IntakeRequest> {
  const url = await getIntakeUrl(`${INTAKE_BASE}?file=${encodeURIComponent(fileName)}`);
  const res = await fetch(url);
  if (!res.ok) {
    const mode = await getIntakeMode().catch(() => 'web3forms' as IntakeMode);
    if (res.status === 401) {
      throw new Error(
        mode === 'zo'
          ? 'Zo Computer form token invalid. Check Settings.'
          : 'Intake key not configured. Please add your Web3Forms key in Settings.',
      );
    }
    throw new Error(`Intake API error: ${res.status}`);
  }
  const raw = await res.json();
  return normalizeSubmission(raw, fileName);
}

export async function markSubmissionRead(fileName: string): Promise<void> {
  try {
    const read = JSON.parse(localStorage.getItem('intake_read') || '{}');
    read[fileName] = true;
    localStorage.setItem('intake_read', JSON.stringify(read));
  } catch {
    // ignore
  }
}

export async function deleteSubmission(fileName: string): Promise<void> {
  const url = await getIntakeUrl(`${INTAKE_BASE}?file=${encodeURIComponent(fileName)}`);
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const mode = await getIntakeMode().catch(() => 'web3forms' as IntakeMode);
    if (res.status === 401) {
      throw new Error(
        mode === 'zo'
          ? 'Zo Computer form token invalid. Check Settings.'
          : 'Intake key not configured. Please add your Web3Forms key in Settings.',
      );
    }
    throw new Error(`Failed to delete: ${res.status}`);
  }
}

function isSubmissionRead(fileName: string): boolean {
  try {
    const read = JSON.parse(localStorage.getItem('intake_read') || '{}');
    return !!read[fileName];
  } catch {
    return false;
  }
}

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
  const idFrontFiles = Array.isArray(d.idFrontFiles) ? d.idFrontFiles.map(String) : [];
  const idBackFiles = Array.isArray(d.idBackFiles) ? d.idBackFiles.map(String) : [];

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
    idFrontFiles,
    idBackFiles,
    idFrontImage: idFrontFiles[0],
    idBackImage: idBackFiles[0],
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

export async function testIntakeConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const mode = await getIntakeMode();
    const url = await getIntakeUrl(INTAKE_BASE);
    const res = await fetch(url);
    if (res.ok) {
      return {
        ok: true,
        message:
          mode === 'zo'
            ? 'Connected to Zo Computer intake successfully.'
            : 'Connected to intake endpoint successfully.',
      };
    }
    if (res.status === 401) {
      return {
        ok: false,
        message:
          mode === 'zo'
            ? 'Zo Computer form token invalid. Check Settings or create a user row in SQLite.'
            : 'Web3Forms key invalid or not configured.',
      };
    }
    return { ok: false, message: `Intake API error: ${res.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed.' };
  }
}

/** Probe whether a URL key is a Zo Computer intake token (same-origin Zo host only). */
export async function isZoIntakeToken(urlKey: string): Promise<boolean> {
  if (!isZoHost() || !urlKey) return false;
  try {
    const res = await fetch(
      `${INTAKE_BASE}?key=${encodeURIComponent(urlKey)}&probe=1`,
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { valid?: boolean; mode?: string };
    return data.valid === true && data.mode === "zo";
  } catch {
    return false;
  }
}
