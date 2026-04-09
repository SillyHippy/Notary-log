import type { JournalEntry, NotarySettings } from './db';

declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string; expires_in?: number }) => void;
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
          revoke: (token: string, callback: () => void) => void;
        };
      };
    };
  }
}

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Notary Journal Backups';
const LATEST_FILE_NAME = 'notary-journal-latest.json';
const TOKEN_KEY = 'gdrive_token';
const TOKEN_EXPIRY_KEY = 'gdrive_token_expiry';
const FOLDER_ID_KEY = 'gdrive_folder_id';
const CLIENT_ID_KEY = 'gdrive_client_id';
const LAST_BACKUP_KEY = 'gdrive_last_backup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenClient: any = null;

export function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || '';
}

export function setClientId(id: string) {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
  tokenClient = null; // reset so it reinitializes with new client ID
}

export function isGdriveConfigured(): boolean {
  return !!getClientId();
}

export function getStoredToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry) - 60_000) return null; // expire 1 min early
  return token;
}

export function getLastBackupTime(): string | null {
  return localStorage.getItem(LAST_BACKUP_KEY);
}

export function disconnectGdrive() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
  localStorage.removeItem(FOLDER_ID_KEY);
  tokenClient = null;
}

export function isGdriveReady(): boolean {
  return !!window.google?.accounts?.oauth2;
}

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
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error || 'No access token returned'));
            return;
          }
          localStorage.setItem(TOKEN_KEY, resp.access_token);
          localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + (resp.expires_in ?? 3600) * 1000));
          resolve(resp.access_token);
        },
      });
    }
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export async function getValidToken(): Promise<string> {
  const stored = getStoredToken();
  if (stored) return stored;
  return signInWithGoogle();
}

async function driveRequest(token: string, method: string, url: string, body?: unknown): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Drive API error ${res.status}: ${text}`);
  }
  return res;
}

async function getOrCreateFolder(token: string): Promise<string> {
  const cached = localStorage.getItem(FOLDER_ID_KEY);
  if (cached) return cached;

  // Search for existing folder
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await driveRequest(token, 'GET', `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
  const searchData = await searchRes.json();

  if (searchData.files?.length > 0) {
    const id: string = searchData.files[0].id;
    localStorage.setItem(FOLDER_ID_KEY, id);
    return id;
  }

  // Create folder
  const createRes = await driveRequest(token, 'POST', 'https://www.googleapis.com/drive/v3/files', {
    name: FOLDER_NAME,
    mimeType: 'application/vnd.google-apps.folder',
  });
  const createData = await createRes.json();
  localStorage.setItem(FOLDER_ID_KEY, createData.id);
  return createData.id;
}

async function uploadFile(token: string, folderId: string, name: string, content: string, existingId?: string): Promise<string> {
  const metadata = { name, parents: existingId ? undefined : [folderId] };
  const boundary = 'notary_boundary_' + Date.now();
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

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  const res = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
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
  return data.id;
}

async function findFile(token: string, folderId: string, name: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`);
  const res = await driveRequest(token, 'GET', `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

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
  await uploadFile(token, folderId, LATEST_FILE_NAME, content, latestId ?? undefined);

  // Also save a dated copy
  const dateStr = new Date().toISOString().split('T')[0];
  const datedName = `notary-journal-backup-${dateStr}.json`;
  await uploadFile(token, folderId, datedName, content);

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
  const res = await driveRequest(token, 'GET',
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`
  );
  const data = await res.json();
  return data.files ?? [];
}

export async function restoreFromDrive(fileId: string): Promise<BackupPayload> {
  const token = await getValidToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to download backup: ${res.status}`);
  const data: BackupPayload = await res.json();
  return data;
}
