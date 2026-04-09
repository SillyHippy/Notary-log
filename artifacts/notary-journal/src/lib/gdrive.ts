import type { JournalEntry, NotarySettings } from './db';

// ── Google Identity Services types ─────────────────────────────────────────

interface GisTokenResponse {
  access_token?: string;
  error?: string;
  expires_in?: number;
}

interface GisTokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GisTokenResponse) => void;
          }) => GisTokenClient;
          revoke: (token: string, callback: () => void) => void;
        };
      };
    };
  }
}

// ── Constants & storage keys ────────────────────────────────────────────────

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Notary Journal Backups';
const LATEST_FILE_NAME = 'notary-journal-latest.json';
const TOKEN_KEY = 'gdrive_token';
const TOKEN_EXPIRY_KEY = 'gdrive_token_expiry';
const FOLDER_ID_KEY = 'gdrive_folder_id';
const CLIENT_ID_KEY = 'gdrive_client_id';
const LAST_BACKUP_KEY = 'gdrive_last_backup';

// ── Token client with mutable resolver refs ─────────────────────────────────
// The GIS token client is initialized once with a callback that dispatches to
// the *current* pendingResolve/pendingReject so each call gets its own Promise.

let tokenClient: GisTokenClient | null = null;
let pendingResolve: ((token: string) => void) | null = null;
let pendingReject: ((err: Error) => void) | null = null;

function buildTokenClient(clientId: string): GisTokenClient {
  return window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (resp: GisTokenResponse) => {
      if (resp.error || !resp.access_token) {
        pendingReject?.(new Error(resp.error || 'No access token returned'));
      } else {
        localStorage.setItem(TOKEN_KEY, resp.access_token);
        localStorage.setItem(
          TOKEN_EXPIRY_KEY,
          String(Date.now() + (resp.expires_in ?? 3600) * 1000),
        );
        pendingResolve?.(resp.access_token);
      }
      pendingResolve = null;
      pendingReject = null;
    },
  });
}

// ── Public config API ───────────────────────────────────────────────────────

export function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || '';
}

export function setClientId(id: string): void {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
  tokenClient = null; // force rebuild with new client ID
}

export function isGdriveConfigured(): boolean {
  return !!getClientId();
}

export function isGdriveReady(): boolean {
  return !!window.google?.accounts?.oauth2;
}

// ── Token management ────────────────────────────────────────────────────────

export function getStoredToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry) - 60_000) return null; // expire 60 s early
  return token;
}

export function getLastBackupTime(): string | null {
  return localStorage.getItem(LAST_BACKUP_KEY);
}

export function disconnectGdrive(): void {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && isGdriveReady()) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
  localStorage.removeItem(FOLDER_ID_KEY);
  tokenClient = null;
  pendingResolve = null;
  pendingReject = null;
}

/**
 * Trigger Google OAuth sign-in. Returns the access token.
 * Can be called multiple times — each call gets its own Promise resolved by
 * the mutable pendingResolve/pendingReject refs updated before every request.
 */
export function signInWithGoogle(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isGdriveReady()) {
      reject(new Error('Google Identity Services not loaded yet. Please wait and try again.'));
      return;
    }
    const clientId = getClientId();
    if (!clientId) {
      reject(new Error('Google Client ID not configured.'));
      return;
    }

    // Update mutable refs BEFORE triggering the popup so the callback dispatches to this Promise
    pendingResolve = resolve;
    pendingReject = reject;

    if (!tokenClient) {
      tokenClient = buildTokenClient(clientId);
    }
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export async function getValidToken(): Promise<string> {
  const stored = getStoredToken();
  if (stored) return stored;
  return signInWithGoogle();
}

/**
 * Sign in and also fetch the user's email from Google's userinfo endpoint.
 * Returns { token, email }.
 */
export async function signInAndGetEmail(): Promise<{ token: string; email: string }> {
  const token = await signInWithGoogle();
  let email = '';
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const info = await res.json();
      email = info.email ?? '';
    }
  } catch {
    // non-fatal — we still have the token
  }
  return { token, email };
}

// ── Drive helper utilities ──────────────────────────────────────────────────

async function driveGet(token: string, url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Drive API error ${res.status}: ${text}`);
  }
  return res;
}

async function drivePost(token: string, url: string, body: unknown): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Drive API error ${res.status}: ${text}`);
  }
  return res;
}

async function uploadMultipart(
  token: string,
  method: 'POST' | 'PATCH',
  url: string,
  metadata: Record<string, unknown>,
  content: string,
): Promise<string> {
  const boundary = `notary_${Date.now()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Upload error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.id as string;
}

async function getOrCreateFolder(token: string): Promise<string> {
  const cached = localStorage.getItem(FOLDER_ID_KEY);
  if (cached) return cached;

  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const searchRes = await driveGet(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
  const searchData = await searchRes.json();

  if (searchData.files?.length > 0) {
    const id: string = searchData.files[0].id;
    localStorage.setItem(FOLDER_ID_KEY, id);
    return id;
  }

  const createRes = await drivePost(token, 'https://www.googleapis.com/drive/v3/files', {
    name: FOLDER_NAME,
    mimeType: 'application/vnd.google-apps.folder',
  });
  const createData = await createRes.json();
  localStorage.setItem(FOLDER_ID_KEY, createData.id);
  return createData.id;
}

async function findFile(token: string, folderId: string, name: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`);
  const res = await driveGet(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
  const data = await res.json();
  return (data.files?.[0]?.id as string) ?? null;
}

// ── Public Drive operations ─────────────────────────────────────────────────

export interface BackupPayload {
  version: number;
  exportedAt: string;
  entries: JournalEntry[];
  settings: NotarySettings;
}

export async function backupToDrive(entries: JournalEntry[], settings: NotarySettings): Promise<void> {
  const token = await getValidToken();
  const folderId = await getOrCreateFolder(token);

  const payload: BackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
    settings,
  };
  const content = JSON.stringify(payload, null, 2);

  // Overwrite the "latest" file
  const latestId = await findFile(token, folderId, LATEST_FILE_NAME);
  if (latestId) {
    await uploadMultipart(
      token, 'PATCH',
      `https://www.googleapis.com/upload/drive/v3/files/${latestId}?uploadType=multipart`,
      { name: LATEST_FILE_NAME },
      content,
    );
  } else {
    await uploadMultipart(
      token, 'POST',
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { name: LATEST_FILE_NAME, parents: [folderId] },
      content,
    );
  }

  // Also save a dated copy
  const dateStr = new Date().toISOString().split('T')[0];
  const datedName = `notary-journal-backup-${dateStr}.json`;
  await uploadMultipart(
    token, 'POST',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    { name: datedName, parents: [folderId] },
    content,
  );

  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
}

export interface BackupFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export async function listBackupFiles(): Promise<BackupFile[]> {
  const token = await getValidToken();
  const folderId = await getOrCreateFolder(token);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveGet(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`,
  );
  const data = await res.json();
  return (data.files as BackupFile[]) ?? [];
}

export async function restoreFromDrive(fileId: string): Promise<BackupPayload> {
  const token = await getValidToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to download backup: ${res.status}`);
  return (await res.json()) as BackupPayload;
}
