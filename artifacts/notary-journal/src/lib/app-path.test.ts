import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('app-path public routes', () => {
  beforeEach(() => {
    vi.stubEnv('BASE_URL', '/notary/');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('detects /notary/intake as public', async () => {
    const { isPublicAppPath, relativeAppPath, apiPath } = await import('./app-path');
    expect(relativeAppPath('/notary/intake')).toBe('/intake');
    expect(isPublicAppPath('/notary/intake')).toBe(true);
    expect(isPublicAppPath('/notary/')).toBe(false);
    expect(apiPath('/api/intake')).toBe('/notary/api/intake');
  });

  it('detects root /intake as public when no base path', async () => {
    vi.stubEnv('BASE_URL', '/');
    vi.resetModules();
    const { isPublicAppPath, apiPath } = await import('./app-path');
    expect(isPublicAppPath('/intake')).toBe(true);
    expect(apiPath('/api/bootstrap')).toBe('/api/bootstrap');
  });
});
