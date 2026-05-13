import { describe, expect, it, vi } from 'vitest';
import type { BackupEnvelope } from './export';
import {
  downloadZoBackupText,
  listZoBackups,
  uploadZoBackup,
} from './zo-backup';

const payload: BackupEnvelope = {
  version: 2,
  exportedAt: '2026-05-13T18:00:00.000Z',
  entries: [],
  settings: {
    notaryName: 'Jane Doe',
    commissionNumber: '123',
    commissionExpiration: '2030-01-01',
    defaultCity: 'Springfield',
    defaultState: 'IL',
    pinEnabled: true,
    darkMode: false,
  },
};

describe('Zo backup client', () => {
  it('lists backups with bearer auth', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      files: [
        { name: 'notary-journal-backup-2026-05-13.json', modifiedTime: '2026-05-13T18:00:00.000Z', size: 42 },
      ],
    })));

    const files = await listZoBackups({
      apiUrl: 'https://example.zo.space/api/backup',
      backupKey: 'secret',
      fetchImpl,
    });

    expect(files).toEqual([
      { name: 'notary-journal-backup-2026-05-13.json', modifiedTime: '2026-05-13T18:00:00.000Z', size: 42 },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith('https://example.zo.space/api/backup', {
      headers: { Authorization: 'Bearer secret' },
    });
  });

  it('uploads a backup with a filename and payload', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      name: 'notary-journal-backup-2026-05-13.json',
    })));

    const name = await uploadZoBackup({
      apiUrl: 'https://example.zo.space/api/backup/',
      backupKey: 'secret',
      payload,
      now: new Date('2026-05-13T18:00:00.000Z'),
      fetchImpl,
    });

    expect(name).toBe('notary-journal-backup-2026-05-13.json');
    expect(fetchImpl).toHaveBeenCalledWith('https://example.zo.space/api/backup', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: 'notary-journal-backup-2026-05-13.json',
        backup: payload,
      }),
    });
  });

  it('downloads one backup file as text', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload)));

    const text = await downloadZoBackupText({
      apiUrl: 'https://example.zo.space/api/backup',
      backupKey: 'secret',
      fileName: 'notary journal latest.json',
      fetchImpl,
    });

    expect(JSON.parse(text)).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.zo.space/api/backup?file=notary%20journal%20latest.json',
      { headers: { Authorization: 'Bearer secret' } },
    );
  });

  it('rejects missing configuration before making a request', async () => {
    const fetchImpl = vi.fn();

    await expect(listZoBackups({
      apiUrl: '',
      backupKey: 'secret',
      fetchImpl,
    })).rejects.toThrow(/Zo backup API URL/i);

    await expect(listZoBackups({
      apiUrl: 'https://example.zo.space/api/backup',
      backupKey: '',
      fetchImpl,
    })).rejects.toThrow(/backup key/i);

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
