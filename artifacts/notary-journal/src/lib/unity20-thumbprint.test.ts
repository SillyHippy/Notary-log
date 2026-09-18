import { describe, expect, it } from 'vitest';
import { isUnity20NativeAvailable } from './unity20-thumbprint';

describe('unity20-thumbprint', () => {
  it('is unavailable in the browser/PWA (no Capacitor native plugin)', () => {
    expect(isUnity20NativeAvailable()).toBe(false);
  });
});
