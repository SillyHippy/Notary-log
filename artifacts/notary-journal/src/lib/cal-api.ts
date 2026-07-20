import { getSettings, saveSettings } from '@/lib/db';
import { apiPath } from '@/lib/app-path';

let ensureInflight: Promise<{ token: string; name: string; email: string }> | null = null;

async function resolveNotaryToken(explicit?: string): Promise<string> {
  const t = explicit?.trim() || (await getSettings()).zoComputerToken?.trim();
  if (!t) {
    throw new Error(
      'No account token yet. Open Settings — your token is created automatically at the top under Cal scheduling setup.',
    );
  }
  return t;
}

/** Returns true if token exists on server; false if missing/401. */
export async function verifyNotaryToken(token: string): Promise<boolean> {
  const t = token.trim();
  if (!t) return false;
  const res = await fetch(apiPath('/api/me'), { headers: authHeaders(t) });
  return res.ok;
}

function authHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Notary-Token': token,
    Authorization: `Bearer ${token}`,
  };
}

export type CalMeConfig = {
  slug: string | null;
  calBookingUrl: string | null;
  calUsername?: string | null;
  displayName: string;
  hasWebhookSecret: boolean;
  webhookPath: string;
};

export type PublicBookConfig = {
  displayName: string;
  calBookingUrl: string;
  calLink: string | null;
  slug: string;
};

export type CalBooking = {
  id: string;
  cal_uid: string;
  status: string;
  title: string | null;
  start_time: string;
  end_time: string | null;
  attendee_name: string | null;
  attendee_email: string | null;
  attendee_phone: string | null;
  location: string | null;
  price_cents: number | null;
  currency: string | null;
  journal_linked_at: string | null;
  dismissed_at: string | null;
  created_at: string;
};

export async function fetchPublicBook(slug: string): Promise<PublicBookConfig> {
  const res = await fetch(apiPath(`/api/book/${encodeURIComponent(slug)}`));
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Book page not found (${res.status})`);
  }
  return res.json() as Promise<PublicBookConfig>;
}

export async function registerNotaryAccount(body?: {
  name?: string;
  email?: string;
}): Promise<{ token: string; name: string; email: string }> {
  const res = await fetch(apiPath('/api/notary/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Register failed (${res.status})`);
  }
  const data = (await res.json()) as { token: string; name: string; email: string };
  return data;
}

async function persistNotaryToken(token: string): Promise<void> {
  const latest = await getSettings();
  await saveSettings({ ...latest, zoComputerToken: token });
}

/** Create or recover a server account for this device (deduped). */
export async function ensureNotaryAccount(body?: {
  name?: string;
  email?: string;
  /** Always register a fresh server user (old token stops working). */
  force?: boolean;
}): Promise<{ token: string; name: string; email: string }> {
  const settings = await getSettings();
  const existing = settings.zoComputerToken?.trim();
  if (!body?.force && existing && (await verifyNotaryToken(existing))) {
    return {
      token: existing,
      name: settings.notaryName?.trim() || 'Notary',
      email: settings.notaryEmail?.trim() || 'notary@localhost',
    };
  }
  if (existing) {
    await persistNotaryToken('');
  }
  if (body?.force) {
    const created = await registerNotaryAccount(body);
    await persistNotaryToken(created.token);
    return created;
  }
  if (!ensureInflight) {
    ensureInflight = registerNotaryAccount(body)
      .then(async (created) => {
        await persistNotaryToken(created.token);
        return created;
      })
      .finally(() => {
        ensureInflight = null;
      });
  }
  return ensureInflight;
}

/** Resolve a token that works on the server — register if missing/invalid. */
export async function resolveWorkingNotaryToken(body?: {
  name?: string;
  email?: string;
}): Promise<string> {
  const settings = await getSettings();
  const existing = settings.zoComputerToken?.trim();
  if (existing && (await verifyNotaryToken(existing))) {
    return existing;
  }
  const created = await ensureNotaryAccount(body);
  return created.token;
}

export type CalPlatformConfig = {
  webhookUrl: string;
  webhookSecret: string | null;
  webhookPath: string;
};

/** Shared Cal webhook URL + secret (same for all notaries on this host). */
export async function fetchCalPlatformConfig(): Promise<CalPlatformConfig> {
  const res = await fetch(apiPath('/api/cal/platform'));
  if (!res.ok) throw new Error('Failed to load Cal webhook config');
  return res.json() as Promise<CalPlatformConfig>;
}

export async function getCalMe(authToken?: string): Promise<CalMeConfig> {
  const token = await resolveNotaryToken(authToken);
  const res = await fetch(apiPath('/api/me/cal'), { headers: authHeaders(token) });
  if (res.status === 401) throw new Error('Unauthorized: invalid account token');
  if (!res.ok) throw new Error('Failed to load Cal settings');
  return res.json() as Promise<CalMeConfig>;
}

export async function patchCalMe(
  body: {
    slug?: string;
    calBookingUrl?: string;
    calWebhookSecret?: string;
    displayName?: string;
  },
  authToken?: string,
): Promise<CalMeConfig & { ok: boolean }> {
  const token = await resolveNotaryToken(authToken);
  const res = await fetch(apiPath('/api/me/cal'), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Save failed (${res.status})`);
  }
  return data as CalMeConfig & { ok: boolean };
}

export async function listBookings(opts?: {
  status?: string;
}): Promise<CalBooking[]> {
  const token = await resolveNotaryToken();
  const q = new URLSearchParams();
  if (opts?.status) q.set('status', opts.status);
  const qs = q.toString();
  const res = await fetch(apiPath(`/api/bookings${qs ? `?${qs}` : ''}`), {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to load bookings');
  const data = (await res.json()) as { bookings: CalBooking[] };
  return data.bookings || [];
}

export async function dismissBooking(id: string): Promise<void> {
  const token = await resolveNotaryToken();
  const res = await fetch(apiPath(`/api/bookings/${encodeURIComponent(id)}/dismiss`), {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Dismiss failed');
}

export async function markBookingJournalLinked(id: string): Promise<void> {
  const token = await resolveNotaryToken();
  const res = await fetch(
    apiPath(`/api/bookings/${encodeURIComponent(id)}/journal-linked`),
    { method: 'POST', headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error('Link mark failed');
}

/** Server-side Cal OAuth ciphertext + profile for journal backup (same host). */
export type CalOAuthBinding = {
  v: number;
  accessTokenEnc: string;
  refreshTokenEnc?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
  connectedAt?: string | null;
  calUsername?: string | null;
  calBookingUrl?: string | null;
  calUserId?: string | null;
  calEventSlug?: string | null;
  calDefaultEventTypeId?: number | null;
  managedWebhookId?: string | null;
  slug?: string | null;
  displayName?: string | null;
};

export async function fetchCalOAuthBinding(
  authToken?: string,
): Promise<CalOAuthBinding | null> {
  try {
    const token = await resolveNotaryToken(authToken);
    const res = await fetch(apiPath('/api/cal/oauth/binding'), {
      headers: authHeaders(token),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { binding?: CalOAuthBinding | null };
    return data.binding ?? null;
  } catch {
    return null;
  }
}

export async function restoreCalOAuthBinding(
  binding: CalOAuthBinding,
  authToken?: string,
): Promise<{ ok: boolean; username?: string | null }> {
  const token = await resolveNotaryToken(authToken);
  const res = await fetch(apiPath('/api/cal/oauth/binding'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ binding }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `Restore OAuth failed (${res.status})`,
    );
  }
  return data as { ok: boolean; username?: string | null };
}

export type CalOAuthStatus = {
  oauthConfigured: boolean;
  connected: boolean;
  username: string | null;
  calUserId: string | null;
  calBookingUrl: string | null;
  slug: string | null;
  displayName: string | null;
  scope: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  managedWebhookId: string | null;
  redirectUri: string;
};

export async function getCalOAuthStatus(authToken?: string): Promise<CalOAuthStatus> {
  const token = await resolveNotaryToken(authToken);
  const res = await fetch(apiPath('/api/cal/oauth/status'), {
    headers: authHeaders(token),
  });
  if (res.status === 401) throw new Error('Unauthorized: invalid account token');
  if (!res.ok) throw new Error('Failed to load OAuth status');
  return res.json() as Promise<CalOAuthStatus>;
}

export async function startCalOAuth(authToken?: string): Promise<{ authorizeUrl: string }> {
  const token = await resolveNotaryToken(authToken);
  const res = await fetch(apiPath('/api/cal/oauth/start'), {
    headers: authHeaders(token),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `OAuth start failed (${res.status})`);
  }
  return data as { authorizeUrl: string };
}

export async function disconnectCalOAuth(authToken?: string): Promise<void> {
  const token = await resolveNotaryToken(authToken);
  const res = await fetch(apiPath('/api/cal/oauth/disconnect'), {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'Disconnect failed');
  }
}
