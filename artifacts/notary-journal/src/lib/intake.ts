/** Client-side API for the deployment's intake queue (Zo / server.ts v1). */

import type { NotarySettings } from './db';

export interface IntakeSubmissionFields {
  signerFullName: string;
  email?: string;
  phone?: string;
  signerAddress?: string;
  signerCity?: string;
  signerState?: string;
  notes?: string;
  preferredDate?: string;
  idFrontImage?: string;
  idBackImage?: string;
}

export interface IntakeSubmission {
  id: string;
  createdAt: string;
  read: boolean;
  fields: IntakeSubmissionFields;
}

export interface IntakeFormConfig {
  title: string;
  allowIdUpload: boolean;
  showEmail: boolean;
  showPhone: boolean;
  showAddress: boolean;
  showNotes: boolean;
  showPreferredDate: boolean;
}

const INTAKE_PREFILL_KEY = 'notary-journal:intakePrefill';

export function getIntakeApiBase(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

export async function checkIntakeApiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getIntakeApiBase()}/api/intake/health`, { method: 'GET' });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

export async function fetchIntakeConfig(secret: string): Promise<IntakeFormConfig | null> {
  try {
    const q = new URLSearchParams({ k: secret });
    const res = await fetch(`${getIntakeApiBase()}/api/intake/config?${q}`);
    if (!res.ok) return null;
    return (await res.json()) as IntakeFormConfig;
  } catch {
    return null;
  }
}

export async function submitIntake(
  secret: string,
  fields: IntakeSubmissionFields,
): Promise<{ id: string }> {
  const res = await fetch(`${getIntakeApiBase()}/api/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, fields }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Submit failed (${res.status})`);
  }
  return (await res.json()) as { id: string };
}

export async function listIntakeSubmissions(
  secret: string,
  unreadOnly = false,
): Promise<IntakeSubmission[]> {
  const q = unreadOnly ? '?unread=true' : '';
  const res = await fetch(`${getIntakeApiBase()}/api/intake${q}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`Failed to load intake (${res.status})`);
  const data = (await res.json()) as { submissions: IntakeSubmission[] };
  return data.submissions ?? [];
}

export async function getIntakeSubmission(
  secret: string,
  id: string,
): Promise<IntakeSubmission> {
  const res = await fetch(`${getIntakeApiBase()}/api/intake/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`Intake not found (${res.status})`);
  return (await res.json()) as IntakeSubmission;
}

export async function dismissIntake(secret: string, id: string): Promise<void> {
  const res = await fetch(`${getIntakeApiBase()}/api/intake/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`Failed to dismiss (${res.status})`);
}

export async function markIntakeRead(secret: string, id: string): Promise<void> {
  const res = await fetch(`${getIntakeApiBase()}/api/intake/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`Failed to mark read (${res.status})`);
}

/** Stash intake fields for the new-entry wizard (consumed on mount). */
export function stashIntakePrefill(fields: IntakeSubmissionFields & { intakeId?: string }): void {
  sessionStorage.setItem(INTAKE_PREFILL_KEY, JSON.stringify(fields));
}

export function consumeIntakePrefill(): (IntakeSubmissionFields & { intakeId?: string }) | null {
  try {
    const raw = sessionStorage.getItem(INTAKE_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(INTAKE_PREFILL_KEY);
    return JSON.parse(raw) as IntakeSubmissionFields & { intakeId?: string };
  } catch {
    return null;
  }
}

export const INTAKE_PREFILL_STORAGE_KEY = INTAKE_PREFILL_KEY;

/** Compress image data URL for upload (max dimension + JPEG quality). */
export async function compressImageDataUrl(
  dataUrl: string,
  maxDim = 1200,
  quality = 0.82,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

export function buildIntakeFormConfig(settings: NotarySettings): IntakeFormConfig {
  return {
    title: settings.intakeFormTitle?.trim() || `${settings.notaryName || 'Notary'} — Request Appointment`,
    allowIdUpload: settings.intakeAllowIdUpload !== false,
    showEmail: settings.intakeShowEmail !== false,
    showPhone: settings.intakeShowPhone !== false,
    showAddress: settings.intakeShowAddress !== false,
    showNotes: settings.intakeShowNotes !== false,
    showPreferredDate: settings.intakeShowPreferredDate !== false,
  };
}

export function getIntakeShareUrl(secret: string): string {
  const base = getIntakeApiBase().replace(/\/$/, '');
  return `${base}/intake?k=${encodeURIComponent(secret)}`;
}

export function generateIntakeSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Push intake secret + form config to the deployment server (Zo / server.ts). */
export async function syncIntakeSettingsToServer(
  secret: string,
  config: IntakeFormConfig,
): Promise<void> {
  const res = await fetch(`${getIntakeApiBase()}/api/intake/settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ secret, config }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Failed to sync intake settings (${res.status})`);
  }
}
