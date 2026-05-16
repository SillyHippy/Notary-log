import type { NotarySettings } from './db';
import type { IntakeSubmission } from './intake';
import { getValidToken } from './gdrive';

const JOBS_FOLDER_NAME = 'Jobs';

async function driveGet(token: string, url: string): Promise<Response> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive API error ${res.status}`);
  return res;
}

async function drivePost(token: string, url: string, body: Record<string, unknown>): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Drive API error ${res.status}`);
  return res;
}

async function findFolder(token: string, parentId: string, name: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const res = await driveGet(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
  const data = await res.json();
  return (data.files?.[0]?.id as string) ?? null;
}

async function createFolder(token: string, parentId: string, name: string): Promise<string> {
  const res = await drivePost(token, 'https://www.googleapis.com/drive/v3/files', {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId],
  });
  const data = await res.json();
  return data.id as string;
}

async function getOrCreateChildFolder(token: string, parentId: string, name: string): Promise<string> {
  const existing = await findFolder(token, parentId, name);
  if (existing) return existing;
  return createFolder(token, parentId, name);
}

async function uploadBinary(
  token: string,
  parentId: string,
  name: string,
  mimeType: string,
  base64DataUrl: string,
): Promise<void> {
  const base64 = base64DataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const metadata = { name, parents: [parentId] };
  const boundary = `boundary_${Date.now()}`;
  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  ];
  const tail = `\r\n--${boundary}--`;

  const enc = new TextEncoder();
  const part1 = enc.encode(bodyParts[0]);
  const part2 = enc.encode(bodyParts[1]);
  const part3 = bytes;
  const part4 = enc.encode(tail);
  const total = new Uint8Array(part1.length + part2.length + part3.length + part4.length);
  total.set(part1, 0);
  total.set(part2, part1.length);
  total.set(part3, part1.length + part2.length);
  total.set(part4, part1.length + part2.length + part3.length);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: total,
  });
  if (!res.ok) throw new Error(`Drive upload failed ${res.status}`);
}

/** Archive one intake submission under Notary Journal Backups / Jobs / folder name. */
export async function archiveIntakeToDrive(
  submission: IntakeSubmission,
  settings: NotarySettings,
  jobLabel?: string,
): Promise<void> {
  const token = await getValidToken();
  const backupFolderId = localStorage.getItem('gdrive_folder_id');
  if (!backupFolderId) throw new Error('Connect Google Drive in Settings first');

  const jobsId = await getOrCreateChildFolder(token, backupFolderId, JOBS_FOLDER_NAME);
  const folderName = jobLabel ?? `INTAKE-${submission.id} - ${submission.fields.signerFullName}`.slice(0, 80);
  const jobFolderId = await getOrCreateChildFolder(token, jobsId, folderName);

  const summary = JSON.stringify(
    { ...submission.fields, id: submission.id, createdAt: submission.createdAt },
    null,
    2,
  );
  const summaryBlob = new Blob([summary], { type: 'application/json' });
  const summaryText = await summaryBlob.text();

  await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'multipart/related; boundary=boundary_summary',
    },
    body: [
      '--boundary_summary',
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name: 'intake-summary.json', parents: [jobFolderId] }),
      '--boundary_summary',
      'Content-Type: application/json',
      '',
      summaryText,
      '--boundary_summary--',
    ].join('\r\n'),
  });

  if (submission.fields.idFrontImage) {
    await uploadBinary(token, jobFolderId, 'id-front.jpg', 'image/jpeg', submission.fields.idFrontImage);
  }
  if (submission.fields.idBackImage) {
    await uploadBinary(token, jobFolderId, 'id-back.jpg', 'image/jpeg', submission.fields.idBackImage);
  }
}
