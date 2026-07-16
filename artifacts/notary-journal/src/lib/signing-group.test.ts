import { describe, expect, it } from 'vitest';
import {
  buildJournalDisplayRows,
  buildAppointmentDisplayRows,
  buildSignerSubgroups,
} from './signing-group';
import type { JournalEntry } from './db';

function mockEntry(partial: Partial<JournalEntry> & { entryNumber: number }): JournalEntry {
  return {
    status: 'completed',
    signerFullName: 'Test',
    signerAddress: '1 Main',
    signerCity: 'Tulsa',
    signerState: 'OK',
    idType: 'driver_license',
    documentType: 'Deed',
    notarialActType: 'acknowledgment',
    feeCharged: 500,
    feeWaived: false,
    locationCity: 'Tulsa',
    locationState: 'OK',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    ...partial,
  };
}

describe('buildJournalDisplayRows', () => {
  it('groups entries with the same signingGroupId', () => {
    const rows = buildJournalDisplayRows([
      mockEntry({ id: 1, entryNumber: 1, signingGroupId: 'g1', actIndexInGroup: 1, actCountInGroup: 2 }),
      mockEntry({ id: 2, entryNumber: 2, signingGroupId: 'g1', actIndexInGroup: 2, actCountInGroup: 2, documentType: 'Will' }),
      mockEntry({ id: 3, entryNumber: 3 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('group');
    if (rows[0].kind === 'group') {
      expect(rows[0].entries).toHaveLength(2);
    }
    expect(rows[1].kind).toBe('solo');
  });

  it('leaves ungrouped entries as solo rows', () => {
    const rows = buildJournalDisplayRows([
      mockEntry({ id: 1, entryNumber: 1 }),
      mockEntry({ id: 2, entryNumber: 2 }),
    ]);
    expect(rows.every(r => r.kind === 'solo')).toBe(true);
  });

  it('uses appointment row for multi-signer groups', () => {
    const apptId = 'appt-1';
    const rows = buildJournalDisplayRows([
      mockEntry({
        id: 1, entryNumber: 1, signerFullName: 'Billy', signingGroupId: apptId,
        appointmentId: apptId, appointmentLabel: 'Western Sierra', signerSlotId: 's1',
        signerIndexInAppointment: 1, actIndexInGroup: 1, actCountInGroup: 2,
      }),
      mockEntry({
        id: 2, entryNumber: 2, signerFullName: 'Jane', signingGroupId: apptId,
        appointmentId: apptId, appointmentLabel: 'Western Sierra', signerSlotId: 's2',
        signerIndexInAppointment: 2, actIndexInGroup: 2, actCountInGroup: 2,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('appointment');
    if (rows[0].kind === 'appointment') {
      expect(rows[0].label).toBe('Western Sierra');
      expect(rows[0].signerGroups).toHaveLength(2);
    }
  });
});

describe('buildAppointmentDisplayRows', () => {
  it('nests signers under appointment label', () => {
    const apptId = 'appt-1';
    const entries = [
      mockEntry({
        id: 1, entryNumber: 1, signerFullName: 'Billy', signingGroupId: apptId,
        appointmentId: apptId, appointmentLabel: 'Western Sierra', signerSlotId: 's1',
        signerIndexInAppointment: 1, actIndexInGroup: 1, actCountInGroup: 3,
      }),
      mockEntry({
        id: 2, entryNumber: 2, signerFullName: 'Billy', signingGroupId: apptId,
        appointmentId: apptId, appointmentLabel: 'Western Sierra', signerSlotId: 's1',
        signerIndexInAppointment: 1, documentType: 'Note', actIndexInGroup: 2, actCountInGroup: 3,
      }),
      mockEntry({
        id: 3, entryNumber: 3, signerFullName: 'Jane', signingGroupId: apptId,
        appointmentId: apptId, appointmentLabel: 'Western Sierra', signerSlotId: 's2',
        signerIndexInAppointment: 2, documentType: 'Deed', actIndexInGroup: 3, actCountInGroup: 3,
      }),
    ];
    const rows = buildAppointmentDisplayRows(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0].signerGroups).toHaveLength(2);
    expect(rows[0].signerGroups[0].entries).toHaveLength(2);
    expect(rows[0].header.totalActCount).toBe(3);
  });
});

describe('buildSignerSubgroups', () => {
  it('groups entries by signer slot', () => {
    const groups = buildSignerSubgroups([
      mockEntry({ entryNumber: 1, signerFullName: 'A', signerSlotId: 's1' }),
      mockEntry({ entryNumber: 2, signerFullName: 'A', signerSlotId: 's1', documentType: 'Note' }),
      mockEntry({ entryNumber: 3, signerFullName: 'B', signerSlotId: 's2' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].actCount).toBe(2);
    expect(groups[1].actCount).toBe(1);
  });
});
