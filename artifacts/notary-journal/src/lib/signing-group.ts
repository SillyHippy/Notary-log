import type { JournalEntry } from './db';

export type JournalDisplayRow =
  | { kind: 'solo'; entry: JournalEntry }
  | { kind: 'group'; groupId: string; label: string; entries: JournalEntry[] };

/**
 * Collapse entries that share a signingGroupId into one grouped row for the
 * journal list. Ungrouped entries pass through as solo rows. Order follows
 * the sorted input: a group appears at the position of its first member.
 */
export function buildJournalDisplayRows(entries: JournalEntry[]): JournalDisplayRow[] {
  const byGroup = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    if (!e.signingGroupId) continue;
    const list = byGroup.get(e.signingGroupId) ?? [];
    list.push(e);
    byGroup.set(e.signingGroupId, list);
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
    const gid = entry.signingGroupId;
    if (gid) {
      if (shownGroups.has(gid)) continue;
      shownGroups.add(gid);
      const members = byGroup.get(gid) ?? [entry];
      const label =
        entry.signingGroupLabel ||
        `${entry.signerFullName || 'Signing'} · ${members.length} act${members.length === 1 ? '' : 's'}`;
      rows.push({ kind: 'group', groupId: gid, label, entries: members });
    } else {
      rows.push({ kind: 'solo', entry });
    }
  }
  return rows;
}

export function groupLabel(entry: JournalEntry, memberCount?: number): string {
  if (entry.signingGroupLabel) return entry.signingGroupLabel;
  const count = memberCount ?? entry.actCountInGroup;
  const name = entry.signerFullName || 'Signing';
  if (count && count > 1) return `${name} · ${count} acts`;
  if (entry.actIndexInGroup && entry.actCountInGroup && entry.actCountInGroup > 1) {
    return `${name} · act ${entry.actIndexInGroup} of ${entry.actCountInGroup}`;
  }
  return name;
}
