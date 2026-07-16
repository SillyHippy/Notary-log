import type { JournalEntry } from './db';

/** Today's date in local timezone (YYYY-MM-DD). */
export function getDefaultNotarizationDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Current local time as 24-hour HH:mm (internal). */
export function getDefaultNotarizationTime24(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Current local time in 12-hour form (e.g. "2:30 PM") for form fields. */
export function getDefaultNotarizationTime(): string {
  return formatTime12Hour(getDefaultNotarizationTime24());
}

/** Convert 24-hour HH:mm to 12-hour with AM/PM (no seconds). */
export function formatTime12Hour(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr ?? '', 10);
  const m = (mStr ?? '00').padStart(2, '0').slice(0, 2);
  if (Number.isNaN(h)) return '12:00 PM';
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${period}`;
}

/** Parse 12-hour ("2:30 PM") or 24-hour ("14:30") to HH:mm. */
export function parseTimeTo24Hour(timeStr: string): string | undefined {
  const trimmed = timeStr?.trim() ?? '';
  if (!trimmed) return undefined;
  const twelve = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (twelve) {
    let h = parseInt(twelve[1], 10);
    const m = twelve[2];
    const pm = twelve[3].toUpperCase() === 'PM';
    if (h < 1 || h > 12) return undefined;
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  const twentyFour = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFour) {
    const h = parseInt(twentyFour[1], 10);
    const m = twentyFour[2];
    if (h < 0 || h > 23) return undefined;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  return undefined;
}

/** Split 12-hour time into hour (1–12), minute, and AM/PM for pickers. */
export function splitTime12Hour(time12: string): { hour: number; minute: number; period: 'AM' | 'PM' } {
  const h24 = parseTimeTo24Hour(time12) ?? getDefaultNotarizationTime24();
  const [hStr, mStr] = h24.split(':');
  let h = parseInt(hStr ?? '12', 10);
  const minute = parseInt(mStr ?? '0', 10) || 0;
  const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return { hour: h, minute, period };
}

/** Build 12-hour time string from picker parts. */
export function buildTime12Hour(hour: number, minute: number, period: 'AM' | 'PM'): string {
  let h = hour;
  if (h < 1 || h > 12) h = 12;
  const m = Math.min(59, Math.max(0, minute));
  const h24 = parseTimeTo24Hour(`${h}:${String(m).padStart(2, '0')} ${period}`) ?? '12:00';
  return formatTime12Hour(h24);
}

/** Combine local date + time inputs into an ISO timestamp (seconds always 0). */
export function combineLocalDateAndTime(dateStr: string, timeStr: string): string | undefined {
  if (!dateStr?.trim()) return undefined;
  const time24 = parseTimeTo24Hour(timeStr?.trim() || '') ?? '12:00';
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time24.split(':').map(Number);
  if (!y || !mo || !d || Number.isNaN(hh) || Number.isNaN(mm)) return undefined;
  return new Date(y, mo - 1, d, hh, mm, 0, 0).toISOString();
}

/** Split an ISO timestamp into local date + 12-hour time for form fields. */
export function splitNotarizationDateTime(iso?: string): { date: string; time: string } {
  if (!iso) {
    return { date: getDefaultNotarizationDate(), time: getDefaultNotarizationTime() };
  }
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return { date: `${y}-${m}-${day}`, time: formatTime12Hour(`${h}:${min}`) };
}

/** Best timestamp for when the notarial act occurred. */
export function getEntryNotarizationIso(entry: JournalEntry): string {
  return entry.notarizationDateTime ?? entry.completedAt ?? entry.createdAt;
}

/** Human-readable date + time for journal list, detail, and print (12h, no seconds). */
export function formatJournalDateTime(entry: JournalEntry, compact = false): string {
  const d = new Date(getEntryNotarizationIso(entry));
  if (compact) {
    const datePart = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
    const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${datePart}\n${timePart}`;
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Resolve notarization ISO from optional date/time form fields. */
export function resolveNotarizationDateTime(
  dateStr?: string,
  timeStr?: string,
  fallbackIso?: string,
): string {
  const combined = combineLocalDateAndTime(dateStr ?? '', timeStr ?? '');
  if (combined) return combined;
  if (fallbackIso) {
    const d = new Date(fallbackIso);
    return new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      0,
      0,
    ).toISOString();
  }
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    0,
    0,
  ).toISOString();
}

export type NotarizationDateTimeOptions = {
  /** User typed or changed the date field — keep their value on complete. */
  dateManuallyEdited?: boolean;
  /** User typed or changed the time field — keep their value on complete. */
  timeManuallyEdited?: boolean;
};

/**
 * Resolve ISO at complete/signature: honors manual date/time when set;
 * otherwise snaps to the current local date/time at that moment (no seconds).
 */
export function resolveNotarizationDateTimeAtComplete(
  dateStr?: string,
  timeStr?: string,
  options: NotarizationDateTimeOptions = {},
): string {
  const now = new Date();
  if (!options.dateManuallyEdited && !options.timeManuallyEdited) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      0,
      0,
    ).toISOString();
  }
  const date = options.dateManuallyEdited
    ? (dateStr?.trim() || getDefaultNotarizationDate())
    : getDefaultNotarizationDate();
  if (!options.timeManuallyEdited) {
    const [y, mo, d] = date.split('-').map(Number);
    return new Date(y, mo - 1, d, now.getHours(), now.getMinutes(), 0, 0).toISOString();
  }
  return resolveNotarizationDateTime(date, timeStr);
}
