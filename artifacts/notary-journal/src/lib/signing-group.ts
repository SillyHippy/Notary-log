import type { JournalEntry } from './db';
import { ACT_TYPE_LABELS } from './fees';
import { formatEntrySignerNames } from './entry-signers';

export type GroupJournalHeader = {
  signerName: string;
  date: Date;
  entryNumberStart: number;
  entryNumberEnd: number;
  actCount: number;
  idNumber?: string;
  actTypeSummary: string;
  totalFeeCents: number;
  allFeesWaived: boolean;
};

export type AppointmentJournalHeader = {
  label: string;
  date: Date;
  entryNumberStart: number;
  entryNumberEnd: number;
  signerCount: number;
  totalActCount: number;
  actTypeSummary: string;
  totalFeeCents: number;
  allFeesWaived: boolean;
};

export type SignerSubgroup = {
  signerSlotId: string;
  signerName: string;
  idNumber?: string;
  entries: JournalEntry[];
  actCount: number;
  totalFeeCents: number;
};

export type JournalDisplayRow =
  | { kind: 'solo'; entry: JournalEntry }
  | { kind: 'group'; groupId: string; label: string; header: GroupJournalHeader; entries: JournalEntry[] }
  | { kind: 'appointment'; appointmentId: string; label: string; header: AppointmentJournalHeader; signerGroups: SignerSubgroup[]; entries: JournalEntry[] };

export type AppointmentDisplayRow = Extract<JournalDisplayRow, { kind: 'appointment' }>;

/** One label if every act matches; otherwise comma-separated unique act types. */
export function summarizeActTypes(members: JournalEntry[]): string {
  const labels = members.map(
    m => ACT_TYPE_LABELS[m.notarialActType] ?? m.notarialActType.replace(/_/g, ' '),
  );
  const unique = [...new Set(labels)];
  if (unique.length === 1) return unique[0];
  return unique.join(', ');
}

export function sumGroupFeeCents(members: JournalEntry[]): { totalCents: number; allWaived: boolean } {
  const allWaived = members.length > 0 && members.every(m => m.feeWaived);
  const totalCents = members.reduce(
    (sum, m) => sum + (m.feeWaived ? 0 : Math.max(0, Math.round(m.feeCharged || 0))),
    0,
  );
  return { totalCents, allWaived };
}

/** Journal list header: signer + date, not document names. */
export function buildGroupJournalHeader(members: JournalEntry[]): GroupJournalHeader {
  const first = members[0];
  const last = members[members.length - 1];
  const { totalCents, allWaived } = sumGroupFeeCents(members);
  return {
    signerName: formatEntrySignerNames(first) || 'Unknown signer',
    date: new Date(first.createdAt),
    entryNumberStart: first.entryNumber ?? 0,
    entryNumberEnd: last.entryNumber ?? first.entryNumber ?? 0,
    actCount: members.length,
    idNumber: first.idNumber?.trim() || undefined,
    actTypeSummary: summarizeActTypes(members),
    totalFeeCents: totalCents,
    allFeesWaived: allWaived,
  };
}

function groupExportLabel(entry: JournalEntry, members: JournalEntry[]): string {
  const custom = entry.signingGroupLabel?.trim();
  const signer = entry.signerFullName?.trim();
  if (custom && signer && custom !== signer && !looksLikeDocumentList(custom, members)) {
    return custom;
  }
  return signer || 'Signing';
}

/** Heuristic: auto-generated labels from comma-separated document types. */
function looksLikeDocumentList(label: string, members: JournalEntry[]): boolean {
  const docs = members.map(m => m.documentType?.trim()).filter(Boolean);
  if (docs.length === 0) return false;
  const joined = docs.join(', ');
  if (label === joined) return true;
  const labelParts = label.split(',').map(s => s.trim().toLowerCase());
  const docSet = new Set(docs.map(d => d!.toLowerCase()));
  return labelParts.length > 1 && labelParts.every(p => docSet.has(p) || [...docSet].some(d => d.includes(p)));
}

function uniqueSignerKeys(members: JournalEntry[]): string[] {
  const keys = new Set<string>();
  for (const m of members) {
    keys.add(m.signerSlotId ?? m.signerFullName?.trim() ?? `entry-${m.entryNumber}`);
    m.additionalSigners?.forEach(s => {
      keys.add(`co-${s.signerIndex}-${s.signerFullName?.trim()}`);
    });
  }
  return [...keys];
}

function isMultiSignerGroup(members: JournalEntry[]): boolean {
  return uniqueSignerKeys(members).length > 1;
}

function appointmentLabelForGroup(members: JournalEntry[]): string {
  const first = members[0];
  return (
    first.appointmentLabel?.trim()
    || first.signingGroupLabel?.trim()
    || 'Signing appointment'
  );
}

export function buildSignerSubgroups(members: JournalEntry[]): SignerSubgroup[] {
  const bySigner = new Map<string, JournalEntry[]>();
  for (const e of members) {
    const key = e.signerSlotId ?? e.signerFullName?.trim() ?? `entry-${e.entryNumber}`;
    const list = bySigner.get(key) ?? [];
    list.push(e);
    bySigner.set(key, list);
  }
  const groups: SignerSubgroup[] = [];
  for (const [slotId, entries] of bySigner) {
    entries.sort((a, b) => {
      const ai = a.actIndexInGroup ?? a.entryNumber;
      const bi = b.actIndexInGroup ?? b.entryNumber;
      return ai - bi || a.entryNumber - b.entryNumber;
    });
    const { totalCents } = sumGroupFeeCents(entries);
    groups.push({
      signerSlotId: slotId,
      signerName: entries[0].signerFullName?.trim() || 'Unknown signer',
      idNumber: entries[0].idNumber?.trim() || undefined,
      entries,
      actCount: entries.length,
      totalFeeCents: totalCents,
    });
  }
  groups.sort((a, b) => {
    const ai = a.entries[0]?.signerIndexInAppointment ?? a.entries[0]?.entryNumber ?? 0;
    const bi = b.entries[0]?.signerIndexInAppointment ?? b.entries[0]?.entryNumber ?? 0;
    return ai - bi;
  });
  return groups;
}

export function buildAppointmentJournalHeader(
  members: JournalEntry[],
  label: string,
  signerGroups: SignerSubgroup[],
): AppointmentJournalHeader {
  const first = members[0];
  const last = members[members.length - 1];
  const { totalCents, allWaived } = sumGroupFeeCents(members);
  return {
    label,
    date: new Date(first.createdAt),
    entryNumberStart: first.entryNumber ?? 0,
    entryNumberEnd: last.entryNumber ?? first.entryNumber ?? 0,
    signerCount: signerGroups.length,
    totalActCount: members.length,
    actTypeSummary: summarizeActTypes(members),
    totalFeeCents: totalCents,
    allFeesWaived: allWaived,
  };
}

/** Build appointment rows for multi-signer groups only. */
export function buildAppointmentDisplayRows(entries: JournalEntry[]): AppointmentDisplayRow[] {
  const byAppt = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const id = e.appointmentId ?? e.signingGroupId;
    if (!id) continue;
    const list = byAppt.get(id) ?? [];
    list.push(e);
    byAppt.set(id, list);
  }

  const rows: AppointmentDisplayRow[] = [];
  for (const [apptId, members] of byAppt) {
    if (!isMultiSignerGroup(members)) continue;
    members.sort((a, b) => {
      const ai = a.actIndexInGroup ?? a.entryNumber;
      const bi = b.actIndexInGroup ?? b.entryNumber;
      return ai - bi || a.entryNumber - b.entryNumber;
    });
    const signerGroups = buildSignerSubgroups(members);
    const label = appointmentLabelForGroup(members);
    const header = buildAppointmentJournalHeader(members, label, signerGroups);
    rows.push({
      kind: 'appointment',
      appointmentId: apptId,
      label,
      header,
      signerGroups,
      entries: members,
    });
  }
  return rows;
}

/**
 * Collapse entries that share a signingGroupId into one grouped row for the
 * journal list. Ungrouped entries pass through as solo rows. Order follows
 * the sorted input: a group appears at the position of its first member.
 */
export function buildJournalDisplayRows(entries: JournalEntry[]): JournalDisplayRow[] {
  const byGroup = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const gid = e.signingGroupId ?? e.appointmentId;
    if (!gid) continue;
    const list = byGroup.get(gid) ?? [];
    list.push(e);
    byGroup.set(gid, list);
  }
  for (const list of byGroup.values()) {
    list.sort((a, b) => {
      const ai = a.actIndexInGroup ?? a.entryNumber;
      const bi = b.actIndexInGroup ?? b.entryNumber;
      return ai - bi || a.entryNumber - b.entryNumber;
    });
  }

  const shownGroups = new Set<string>();
  const rows: JournalDisplayRow[] = [];

  for (const entry of entries) {
    const gid = entry.signingGroupId ?? entry.appointmentId;
    if (gid) {
      if (shownGroups.has(gid)) continue;
      shownGroups.add(gid);
      const members = byGroup.get(gid) ?? [entry];

      if (isMultiSignerGroup(members)) {
        const signerGroups = buildSignerSubgroups(members);
        const label = appointmentLabelForGroup(members);
        const header = buildAppointmentJournalHeader(members, label, signerGroups);
        rows.push({
          kind: 'appointment',
          appointmentId: gid,
          label,
          header,
          signerGroups,
          entries: members,
        });
      } else {
        const header = buildGroupJournalHeader(members);
        const label = groupExportLabel(entry, members);
        rows.push({ kind: 'group', groupId: gid, label, header, entries: members });
      }
    } else {
      rows.push({ kind: 'solo', entry });
    }
  }
  return rows;
}

export function groupLabel(entry: JournalEntry, memberCount?: number): string {
  const count = memberCount ?? entry.actCountInGroup;
  const name = entry.signerFullName?.trim() || 'Signing';
  const custom = entry.signingGroupLabel?.trim();
  if (custom && custom !== name && count && count > 1) {
    return `${custom} · ${name}`;
  }
  if (count && count > 1) return `${name} · ${count} acts`;
  if (entry.actIndexInGroup && entry.actCountInGroup && entry.actCountInGroup > 1) {
    return `${name} · act ${entry.actIndexInGroup} of ${entry.actCountInGroup}`;
  }
  return custom && custom !== name ? custom : name;
}
