export const GOOGLE_BACKUP_VISIBLE_KEY = 'backup_google_visible';
export const ZO_BACKUP_VISIBLE_KEY = 'backup_zo_visible';

type BackupPanel = 'google' | 'zo';

interface BackupVisibilityStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface BackupPanelVisibility {
  google: boolean;
  zo: boolean;
}

interface ResolveBackupPanelVisibilityInput {
  googlePreference: boolean | null;
  zoPreference: boolean | null;
  hasZoConfig: boolean;
}

function readBooleanPreference(
  storage: BackupVisibilityStorage,
  key: string,
): boolean | null {
  const value = storage.getItem(key);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function resolveBackupPanelVisibility({
  googlePreference,
  zoPreference,
  hasZoConfig,
}: ResolveBackupPanelVisibilityInput): BackupPanelVisibility {
  return {
    google: googlePreference ?? true,
    zo: zoPreference ?? hasZoConfig,
  };
}

export function loadBackupPanelVisibility(
  storage: BackupVisibilityStorage,
  hasZoConfig: boolean,
): BackupPanelVisibility {
  return resolveBackupPanelVisibility({
    googlePreference: readBooleanPreference(storage, GOOGLE_BACKUP_VISIBLE_KEY),
    zoPreference: readBooleanPreference(storage, ZO_BACKUP_VISIBLE_KEY),
    hasZoConfig,
  });
}

export function saveBackupPanelVisibility(
  storage: BackupVisibilityStorage,
  panel: BackupPanel,
  isVisible: boolean,
): void {
  const key = panel === 'google' ? GOOGLE_BACKUP_VISIBLE_KEY : ZO_BACKUP_VISIBLE_KEY;
  storage.setItem(key, String(isVisible));
}
