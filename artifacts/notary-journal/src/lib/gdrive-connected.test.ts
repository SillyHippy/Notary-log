import { describe, expect, it } from 'vitest';
import { shouldShowDriveConnected } from './gdrive';

describe('shouldShowDriveConnected', () => {
  it('stays connected after reload when email is saved even if the GIS token is gone', () => {
    expect(shouldShowDriveConnected({
      googleEmail: 'iannazzi.joseph@gmail.com',
      isSetUp: false,
    })).toBe(true);
  });

  it('stays connected from durable Drive setup (folder/last-backup) without email', () => {
    expect(shouldShowDriveConnected({
      googleEmail: '',
      isSetUp: true,
    })).toBe(true);
  });

  it('shows Connect when nothing is saved', () => {
    expect(shouldShowDriveConnected({
      googleEmail: '   ',
      isSetUp: false,
    })).toBe(false);
  });
});
