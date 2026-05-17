/**
 * Formspree REST API client for the Client Intake feature.
 *
 * Polls Formspree for new submissions so the app can show a pending queue
 * without needing a webhook bridge. Works on the free tier.
 *
 * Setup:
 *   1. Create a form at formspree.io
 *   2. Get the form ID (from the endpoint URL)
 *   3. Generate an API token in Formspree → Settings → API
 *   4. Store both in the app settings (IndexedDB)
 */

import { getSettings } from '@/lib/db';

const FORMSPREE_API_BASE = 'https://api.formspree.io';

/** Raw submission from Formspree's API */
export interface FormspreeSubmission {
  id: string;
  createdAt: string;
  data: Record<string, unknown>;
  files?: Array<{
    name: string;
    url: string;
    size: number;
    type: string;
  }>;
  read: boolean;
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
  documents: Array<{
    type: string;
    date: string;
    fileNames: string[];
  }>;
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

/** Get Formspree form ID and API token from settings */
async function getFormspreeConfig(): Promise<{
  formId: string;
  apiToken: string;
} | null> {
  const settings = await getSettings();
  const formId = (settings as unknown as Record<string, unknown>).intakeFormId as
    | string
    | undefined;
  const apiToken = (settings as unknown as Record<string, unknown>).intakeApiToken as
    | string
    | undefined;
  if (!formId || !apiToken) return null;
  return { formId, apiToken };
}

/** Fetch all submissions for the configured form */
export async function listSubmissions(): Promise<FormspreeSubmission[]> {
  const config = await getFormspreeConfig();
  if (!config) return [];

  const res = await fetch(
    `${FORMSPREE_API_BASE}/forms/${config.formId}/submissions`,
    {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Accept: 'application/json',
      },
    }
  );

  if (!res.ok) {
    throw new Error(
      `Formspree API error: ${res.status} ${res.statusText}`
    );
  }

  const json = await res.json();
  // Formspree returns { results: [...], next: string|null }
  const results: FormspreeSubmission[] = json.results || [];
  return results;
}

/** Fetch a single submission with its files as base64 data URLs */
export async function getSubmission(id: string): Promise<IntakeRequest> {
  const config = await getFormspreeConfig();
  if (!config) throw new Error('Formspree not configured');

  const res = await fetch(
    `${FORMSPREE_API_BASE}/forms/${config.formId}/submissions/${id}`,
    {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Accept: 'application/json',
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Formspree API error: ${res.status}`);
  }

  const submission: FormspreeSubmission = await res.json();
  return normalizeSubmission(submission);
}

/** Mark a submission as read (acknowledged) */
export async function markSubmissionRead(id: string): Promise<void> {
  const config = await getFormspreeConfig();
  if (!config) return;

  await fetch(
    `${FORMSPREE_API_BASE}/forms/${config.formId}/submissions/${id}/read`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ read: true }),
    }
  );
}

/**
 * Normalize a raw Formspree submission into the app's IntakeRequest shape.
 * Downloads any attached files and converts them to base64 data URLs.
 */
async function normalizeSubmission(
  submission: FormspreeSubmission
): Promise<IntakeRequest> {
  const d = submission.data || {};

  // Helper: safely extract string from form data
  const str = (key: string, fallback = '') =>
    String(d[key] ?? fallback).trim();

  // Helper: parse a multi-select (Formspree sends as comma-separated or array)
  const multi = (key: string): string[] => {
    const val = d[key];
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string')
      return val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return [];
  };

  // Helper: download a file URL and convert to base64 data URL
  const fileToDataUrl = async (url: string): Promise<string> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return '';
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  };

  // Determine which files are front vs back based on name patterns
  const idFrontFiles: string[] = [];
  const idBackFiles: string[] = [];
  const signer2IdFrontFiles: string[] = [];
  const signer2IdBackFiles: string[] = [];

  if (submission.files?.length) {
    for (const file of submission.files) {
      const dataUrl = await fileToDataUrl(file.url);
      if (!dataUrl) continue;

      const lowerName = file.name.toLowerCase();
      if (lowerName.includes('front') || lowerName.includes('id_front')) {
        // Signer 2 files have "signer2" or "signer_2" in the name
        if (
          lowerName.includes('signer2') ||
          lowerName.includes('signer_2') ||
          lowerName.includes('s2_')
        ) {
          signer2IdFrontFiles.push(dataUrl);
        } else {
          idFrontFiles.push(dataUrl);
        }
      } else if (lowerName.includes('back') || lowerName.includes('id_back')) {
        if (
          lowerName.includes('signer2') ||
          lowerName.includes('signer_2') ||
          lowerName.includes('s2_')
        ) {
          signer2IdBackFiles.push(dataUrl);
        } else {
          idBackFiles.push(dataUrl);
        }
      } else {
        // Unknown — put in front bucket by default
        if (
          lowerName.includes('signer2') ||
          lowerName.includes('signer_2') ||
          lowerName.includes('s2_')
        ) {
          signer2IdFrontFiles.push(dataUrl);
        } else {
          idFrontFiles.push(dataUrl);
        }
      }
    }
  }

  const hasSigner2 =
    str('hasSigner2', 'no').toLowerCase() === 'yes' ||
    str('needAdditionalSigner', 'no').toLowerCase() === 'yes';

  return {
    id: submission.id,
    createdAt: submission.createdAt,
    read: submission.read ?? false,
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
    servicesPerformed: multi('servicesPerformed'),
    serviceType: str('serviceType'),
    preferredDate: str('preferredDate'),
    notes: str('notes'),
    documents: [], // Document file data comes through the same files array
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
    signer2IdFrontFiles,
    signer2IdBackFiles,
  };
}

/** Test the Formspree connection (validates token + form ID) */
export async function testFormspreeConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const config = await getFormspreeConfig();
    if (!config) return { ok: false, message: 'Formspree not configured in Settings.' };

    const res = await fetch(
      `${FORMSPREE_API_BASE}/forms/${config.formId}/submissions?limit=1`,
      {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (res.ok) return { ok: true, message: 'Connected to Formspree successfully.' };
    if (res.status === 401) return { ok: false, message: 'Invalid API token. Check Settings → Client Intake.' };
    if (res.status === 404) return { ok: false, message: 'Form not found. Check your Form Endpoint URL.' };
    return { ok: false, message: `Formspree error: ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Connection failed.',
    };
  }
}
