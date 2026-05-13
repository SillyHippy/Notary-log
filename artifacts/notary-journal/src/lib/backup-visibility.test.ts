import { describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_BACKUP_VISIBLE_KEY,
  ZO_BACKUP_VISIBLE_KEY,
  loadBackupPanelVisibility,
  resolveBackupPanelVisibility,
  saveBackupPanelVisibility,
} from './backup-visibility';

function storageFrom(values: Record<string, string | null> = {}) {
  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values[key] = value;
    }),
  };
}

describe('backup panel visibility', () => {
  it('shows Google by default and hides Zo until it is configured or enabled', () => {
    expect(resolveBackupPanelVisibility({
      googlePreference: null,
      zoPreference: null,
      hasZoConfig: false,
    })).toEqual({ google: true, zo: false });
  });

  it('keeps existing Zo setups visible when no manual preference exists yet', () => {
    expect(resolveBackupPanelVisibility({
      googlePreference: null,
      zoPreference: null,
      hasZoConfig: true,
    })).toEqual({ google: true, zo: true });
  });

  it('honors manual visibility choices over defaults', () => {
    expect(resolveBackupPanelVisibility({
      googlePreference: false,
      zoPreference: true,
      hasZoConfig: false,
    })).toEqual({ google: false, zo: true });
  });

  it('loads and saves visibility preferences from browser storage', () => {
    const storage = storageFrom({
      [GOOGLE_BACKUP_VISIBLE_KEY]: 'false',
      [ZO_BACKUP_VISIBLE_KEY]: 'true',
    });

    expect(loadBackupPanelVisibility(storage, false)).toEqual({
      google: false,
      zo: true,
    });

    saveBackupPanelVisibility(storage, 'google', true);
    saveBackupPanelVisibility(storage, 'zo', false);

    expect(storage.setItem).toHaveBeenCalledWith(GOOGLE_BACKUP_VISIBLE_KEY, 'true');
    expect(storage.setItem).toHaveBeenCalledWith(ZO_BACKUP_VISIBLE_KEY, 'false');
  });
});
