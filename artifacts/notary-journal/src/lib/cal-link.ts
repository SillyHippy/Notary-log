/** Parse Cal.com username or booking URLs into embed calLink + canonical URL. */

export type ParsedCal = {
  calLink: string;
  username?: string;
  eventSlug?: string;
  /** Canonical https://cal.com/... */
  bookingUrl: string;
};

/**
 * Accepts any of:
 * - your-cal-username
 * - cal.com/your-cal-username
 * - https://cal.com/your-cal-username
 * - https://cal.com/your-cal-username/mobile-notary
 */
export function parseCalBookingUrl(input: string): ParsedCal | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare username
  if (/^[a-zA-Z0-9]([a-zA-Z0-9._+-]*[a-zA-Z0-9])?$/.test(raw) && !raw.includes('/')) {
    const username = raw.toLowerCase();
    return {
      calLink: username,
      username,
      bookingUrl: `https://cal.com/${username}`,
    };
  }

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^\/+/, '');
    if (/^(www\.)?cal\.com\//i.test(candidate) || /^app\.cal\.com\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    } else if (/^[a-zA-Z0-9._+-]+(\/[a-zA-Z0-9._+-]+)?$/.test(candidate)) {
      candidate = `https://cal.com/${candidate}`;
    } else {
      return null;
    }
  }

  try {
    const u = new URL(candidate);
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'cal.com' && host !== 'app.cal.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 1) return null;
    const username = parts[0];
    if (parts.length === 1) {
      return {
        calLink: username,
        username,
        bookingUrl: `https://cal.com/${username}`,
      };
    }
    const eventSlug = parts[1];
    return {
      calLink: `${username}/${eventSlug}`,
      username,
      eventSlug,
      bookingUrl: `https://cal.com/${username}/${eventSlug}`,
    };
  } catch {
    return null;
  }
}

export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length < 2 || slug.length > 48) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug);
}

/** Suggest a public book slug from Cal username (safe chars only). */
export function slugFromCalUsername(username: string): string {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export function isCalHostMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.VITE_CAL_HOST_MODE === '1') return true;
  const host = window.location.hostname;
  if (host.includes('notary-log-cal')) return true;
  return false;
}
