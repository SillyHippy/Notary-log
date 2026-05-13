import type { BackupEnvelope } from './export';

export interface ZoBackupConfig {
  apiUrl: string;
  backupKey: string;
}

export interface ZoBackupFile {
  name: string;
  modifiedTime?: string;
  size?: number;
}

interface ZoBackupRequestConfig extends ZoBackupConfig {
  fetchImpl?: typeof fetch;
}

interface UploadZoBackupConfig extends ZoBackupRequestConfig {
  payload: BackupEnvelope;
  now?: Date;
}

interface DownloadZoBackupConfig extends ZoBackupRequestConfig {
  fileName: string;
}

function normalizeApiUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim();
  if (!trimmed) throw new Error('Zo backup API URL is required.');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Zo backup API URL must start with http:// or https://.');
  }
  return trimmed.replace(/\/+$/, '');
}

function requireBackupKey(backupKey: string): string {
  const trimmed = backupKey.trim();
  if (!trimmed) throw new Error('Zo backup key is required.');
  return trimmed;
}

function getFetch(fetchImpl?: typeof fetch): typeof fetch {
  const impl = fetchImpl ?? globalThis.fetch;
  if (!impl) throw new Error('Fetch is not available in this browser.');
  return impl;
}

function authHeaders(backupKey: string): HeadersInit {
  return { Authorization: `Bearer ${requireBackupKey(backupKey)}` };
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  return text || res.statusText || `HTTP ${res.status}`;
}

function backupFileName(now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `notary-journal-backup-${day}.json`;
}

export async function listZoBackups(config: ZoBackupRequestConfig): Promise<ZoBackupFile[]> {
  const apiUrl = normalizeApiUrl(config.apiUrl);
  const res = await getFetch(config.fetchImpl)(apiUrl, {
    headers: authHeaders(config.backupKey),
  });
  if (!res.ok) throw new Error(`Zo backup list failed: ${await readError(res)}`);

  const data = await res.json();
  if (!data || typeof data !== 'object' || !Array.isArray(data.files)) {
    throw new Error('Zo backup API returned an invalid file list.');
  }
  return data.files.map((file: unknown) => {
    if (!file || typeof file !== 'object' || typeof (file as ZoBackupFile).name !== 'string') {
      throw new Error('Zo backup API returned an invalid file item.');
    }
    const item = file as ZoBackupFile;
    return {
      name: item.name,
      modifiedTime: item.modifiedTime,
      size: item.size,
    };
  });
}

export async function uploadZoBackup(config: UploadZoBackupConfig): Promise<string> {
  const apiUrl = normalizeApiUrl(config.apiUrl);
  const filename = backupFileName(config.now);
  const res = await getFetch(config.fetchImpl)(apiUrl, {
    method: 'POST',
    headers: {
      ...authHeaders(config.backupKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename,
      backup: config.payload,
    }),
  });
  if (!res.ok) throw new Error(`Zo backup upload failed: ${await readError(res)}`);

  const data = await res.json().catch(() => null);
  if (data && typeof data === 'object' && typeof (data as { name?: unknown }).name === 'string') {
    return (data as { name: string }).name;
  }
  return filename;
}

export async function downloadZoBackupText(config: DownloadZoBackupConfig): Promise<string> {
  const apiUrl = normalizeApiUrl(config.apiUrl);
  const fileName = config.fileName.trim();
  if (!fileName) throw new Error('Zo backup file name is required.');

  const res = await getFetch(config.fetchImpl)(`${apiUrl}?file=${encodeURIComponent(fileName)}`, {
    headers: authHeaders(config.backupKey),
  });
  if (!res.ok) throw new Error(`Zo backup download failed: ${await readError(res)}`);
  return res.text();
}
