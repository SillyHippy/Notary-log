import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectDeviceLocation } from './geolocation';

describe('detectDeviceLocation', () => {
  const mockGeolocation = {
    getCurrentPosition: vi.fn(),
  };

  beforeEach(() => {
    vi.stubGlobal('navigator', {
      geolocation: mockGeolocation,
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('returns unsupported when geolocation is missing', async () => {
    vi.stubGlobal('navigator', {});
    const result = await detectDeviceLocation();
    expect(result).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('returns city, state, and street address from reverse geocode', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({ coords: { latitude: 35.99, longitude: -96.0 } } as GeolocationPosition);
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        address: {
          house_number: '123',
          road: 'Main St',
          city: 'Glenpool',
          state: 'Oklahoma',
        },
      }),
    } as Response);

    const result = await detectDeviceLocation();
    expect(result).toEqual({
      ok: true,
      location: { city: 'Glenpool', state: 'OK', address: '123 Main St' },
    });
  });

  it('returns denied when permission is blocked', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation(
      (_s: PositionCallback, error: PositionErrorCallback) => {
        error({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
      },
    );
    const result = await detectDeviceLocation();
    expect(result).toEqual({ ok: false, reason: 'denied' });
  });
});
