const STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  'District of Columbia': 'DC',
};

export interface DetectedLocation {
  city: string;
  state: string;
  address?: string;
}

function formatStreetAddress(addr: Record<string, string>): string | undefined {
  const parts = [addr.house_number, addr.road || addr.pedestrian || addr.footway]
    .filter(Boolean)
    .join(' ')
    .trim();
  return parts || undefined;
}

async function reverseGeocode(lat: number, lon: number): Promise<DetectedLocation> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
    { headers: { 'User-Agent': 'NotaryJournal/1.0' } },
  );
  if (!res.ok) throw new Error(`Geocode failed: ${res.status}`);
  const data = await res.json();
  const addr = data.address ?? {};
  const city = addr.city || addr.town || addr.village || addr.county || '';
  const stateRaw: string = addr.state || '';
  const state = STATE_ABBR[stateRaw] || stateRaw.substring(0, 2).toUpperCase();
  const address = formatStreetAddress(addr);
  return { city, state, address };
}

export type GeolocationResult =
  | { ok: true; location: DetectedLocation }
  | { ok: false; reason: 'unsupported' | 'denied' | 'timeout' | 'lookup_failed' };

/** Detect city/state (and street address when available) from device GPS. */
export function detectDeviceLocation(): Promise<GeolocationResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ ok: false, reason: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const location = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          resolve({ ok: true, location });
        } catch {
          resolve({ ok: false, reason: 'lookup_failed' });
        }
      },
      (err) => {
        const reason = err.code === err.PERMISSION_DENIED ? 'denied' : 'timeout';
        resolve({ ok: false, reason });
      },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: true },
    );
  });
}
