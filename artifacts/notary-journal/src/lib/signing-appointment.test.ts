import { describe, it, expect } from 'vitest';
import {
  expandAppointmentToEntries,
  validateSigningAppointmentPayload,
  countAppointmentEntries,
  previewAppointmentTotalFeeCents,
  generateSlotId,
  syncDocumentSlotsFromParsedTypes,
  joinDocumentTypesForBulkInput,
  sanitizePayloadForDraft,
  type SigningAppointmentPayload,
} from './signing-appointment';

function mockPayload(overrides?: Partial<SigningAppointmentPayload>): SigningAppointmentPayload {
  const s1 = generateSlotId('signer');
  const s2 = generateSlotId('signer');
  const d1 = generateSlotId('doc');
  return {
    appointmentId: 'appt-test',
    appointmentLabel: 'Western Sierra Loan Signing',
    locationCity: 'Glenpool',
    locationState: 'OK',
    roster: [
      {
        slotId: s1,
        signerFullName: 'Billy Bob Thornton',
        signerAddress: '123 Main St',
        signerCity: 'Glenpool',
        signerState: 'OK',
        idType: 'driver_license',
        idNumber: 'E083739931',
        signerIndexInAppointment: 1,
      },
      {
        slotId: s2,
        signerFullName: 'Jane Doe',
        signerAddress: '456 Oak Ave',
        signerCity: 'Tulsa',
        signerState: 'OK',
        idType: 'driver_license',
        idNumber: 'X1234567',
        signerIndexInAppointment: 2,
      },
    ],
    documents: [
      {
        slotId: d1,
        documentType: 'Warranty Deed',
        notarialActType: 'acknowledgment',
        signerSlotIds: [s1, s2],
        certificateStyle: 'shared',
      },
    ],
    ...overrides,
  };
}

describe('signing-appointment', () => {
  it('validates required fields', () => {
    const errors = validateSigningAppointmentPayload({
      appointmentId: '',
      locationCity: '',
      locationState: '',
      roster: [],
      documents: [],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('expands 2 signers × 1 shared doc → 1 combined entry', () => {
    const payload = mockPayload();
    const expanded = expandAppointmentToEntries(payload, { defaultState: 'OK', stampFeeCents: 500 });
    expect(expanded).toHaveLength(1);
    expect(expanded[0].draft.signerFullName).toBe('Billy Bob Thornton');
    expect(expanded[0].draft.additionalSigners).toHaveLength(1);
    expect(expanded[0].draft.additionalSigners![0].signerFullName).toBe('Jane Doe');
    expect(expanded[0].draft.documentType).toBe('Warranty Deed');
    expect(expanded[0].draft.appointmentLabel).toBe('Western Sierra Loan Signing');
    expect(expanded[0].draft.signingGroupId).toBe('appt-test');
  });

  it('OK shared cert: $5 total on one combined line', () => {
    const payload = mockPayload();
    const total = previewAppointmentTotalFeeCents(payload, { defaultState: 'OK', stampFeeCents: 500 });
    expect(total).toBe(500);
    const expanded = expandAppointmentToEntries(payload, { defaultState: 'OK', stampFeeCents: 500 });
    expect(expanded).toHaveLength(1);
    expect(expanded[0].draft.feeCharged).toBe(500);
    expect(expanded[0].draft.stampCount).toBe(1);
  });

  it('3 signers individual on 1 doc → 3 entries, $15 OK', () => {
    const s1 = generateSlotId('s');
    const s2 = generateSlotId('s');
    const s3 = generateSlotId('s');
    const payload = mockPayload({
      roster: [
        { slotId: s1, signerFullName: 'A', signerAddress: '1', signerCity: 'X', signerState: 'OK', idType: 'driver_license', signerIndexInAppointment: 1 },
        { slotId: s2, signerFullName: 'B', signerAddress: '2', signerCity: 'X', signerState: 'OK', idType: 'driver_license', signerIndexInAppointment: 2 },
        { slotId: s3, signerFullName: 'C', signerAddress: '3', signerCity: 'X', signerState: 'OK', idType: 'driver_license', signerIndexInAppointment: 3 },
      ],
      documents: [{
        slotId: generateSlotId('d'),
        documentType: 'Deed',
        notarialActType: 'acknowledgment',
        signerSlotIds: [s1, s2, s3],
        certificateStyle: 'individual',
      }],
    });
    expect(countAppointmentEntries(payload)).toBe(3);
    const total = previewAppointmentTotalFeeCents(payload, { defaultState: 'OK', stampFeeCents: 500 });
    expect(total).toBe(1500);
  });

  it('7 affidavits same signer → 7 entries', () => {
    const s1 = generateSlotId('s');
    const docs = Array.from({ length: 7 }, (_, i) => ({
      slotId: generateSlotId('d'),
      documentType: i === 6 ? 'Affidavit of Non-Service' : `Affidavit of Service ${i + 1}`,
      notarialActType: 'jurat' as const,
      signerSlotIds: [s1],
      certificateStyle: 'individual' as const,
    }));
    const payload = mockPayload({
      appointmentLabel: 'Process server batch',
      roster: [{
        slotId: s1,
        signerFullName: 'Process Server',
        signerAddress: '99 Court',
        signerCity: 'Tulsa',
        signerState: 'OK',
        idType: 'driver_license',
        signerIndexInAppointment: 1,
      }],
      documents: docs,
    });
    expect(countAppointmentEntries(payload)).toBe(7);
    const total = previewAppointmentTotalFeeCents(payload, { defaultState: 'OK', stampFeeCents: 500 });
    expect(total).toBe(3500);
  });

  it('copies ID from roster to each entry (no re-scan)', () => {
    const payload = mockPayload();
    payload.roster[0].idFrontImage = 'data:image/png;base64,abc';
    const expanded = expandAppointmentToEntries(payload, { defaultState: 'OK' });
    expect(expanded[0].draft.idFrontImage).toBe('data:image/png;base64,abc');
    expect(expanded[0].draft.idNumber).toBe('E083739931');
  });

  it('PA shared cert with setting off → still one combined line when checkbox checked', () => {
    const payload = mockPayload();
    const expanded = expandAppointmentToEntries(payload, { defaultState: 'PA', stampFeeCents: 500 });
    expect(expanded).toHaveLength(1);
    expect(expanded[0].draft.additionalSigners).toHaveLength(1);
    expect(expanded[0].draft.feeCharged).toBe(700);
  });

  it('PA shared cert: 2 signers → 1 combined journal line', () => {
    const payload = mockPayload();
    const expanded = expandAppointmentToEntries(payload, {
      defaultState: 'PA',
      stampFeeCents: 500,
    });
    expect(expanded).toHaveLength(1);
    expect(expanded[0].draft.signerFullName).toBe('Billy Bob Thornton');
    expect(expanded[0].draft.additionalSigners).toHaveLength(1);
    expect(expanded[0].draft.additionalSigners![0].signerFullName).toBe('Jane Doe');
    expect(expanded[0].draft.additionalSigners![0].signerIndex).toBe(2);
    expect(expanded[0].draft.feeCharged).toBe(700); // $5 + $2
    expect(expanded[0].draft.stampCount).toBe(1);
  });

  it('PA shared cert: 3 signers → 1 line with #1 #2 #3', () => {
    const s1 = generateSlotId('s');
    const s2 = generateSlotId('s');
    const s3 = generateSlotId('s');
    const payload = mockPayload({
      roster: [
        { slotId: s1, signerFullName: 'Alice', signerAddress: '1', signerCity: 'X', signerState: 'PA', idType: 'driver_license', signerIndexInAppointment: 1 },
        { slotId: s2, signerFullName: 'Bob', signerAddress: '2', signerCity: 'X', signerState: 'PA', idType: 'driver_license', signerIndexInAppointment: 2 },
        { slotId: s3, signerFullName: 'Carol', signerAddress: '3', signerCity: 'X', signerState: 'PA', idType: 'driver_license', signerIndexInAppointment: 3 },
      ],
      documents: [{
        slotId: generateSlotId('d'),
        documentType: 'Deed',
        notarialActType: 'acknowledgment',
        signerSlotIds: [s1, s2, s3],
        certificateStyle: 'shared',
      }],
    });
    const expanded = expandAppointmentToEntries(payload, {
      defaultState: 'PA',
      stampFeeCents: 500,
    });
    expect(expanded).toHaveLength(1);
    expect(expanded[0].draft.additionalSigners).toHaveLength(2);
    expect(expanded[0].draft.feeCharged).toBe(900); // $5 + $2 + $2
  });

  it('individual cert → separate line per signer even with multiple signers on doc', () => {
    const payload = mockPayload();
    payload.documents[0].certificateStyle = 'individual';
    const expanded = expandAppointmentToEntries(payload, { defaultState: 'OK', stampFeeCents: 500 });
    expect(expanded).toHaveLength(2);
  });

  it('shared cert sets coSignerNames on combined row', () => {
    const payload = mockPayload();
    const expanded = expandAppointmentToEntries(payload, { defaultState: 'OK' });
    expect(expanded).toHaveLength(1);
    expect(expanded[0].draft.coSignerNames).toEqual(['Jane Doe']);
  });
});

describe('syncDocumentSlotsFromParsedTypes', () => {
  it('splits comma input into separate document slots', () => {
    const signers = [generateSlotId('signer'), generateSlotId('signer')];
    const slots = syncDocumentSlotsFromParsedTypes(
      ['Deed', 'Affidavit', 'Will'],
      [],
      'acknowledgment',
      false,
      signers,
    );
    expect(slots).toHaveLength(3);
    expect(slots.map(s => s.documentType)).toEqual(['Deed', 'Affidavit', 'Will']);
    expect(slots.every(s => s.signerSlotIds.length === 2)).toBe(true);
    expect(slots.every(s => s.notarialActType === 'acknowledgment')).toBe(true);
  });

  it('preserves per-doc act type when custom act per document', () => {
    const existing = [
      {
        slotId: 'doc-1',
        documentType: 'Deed',
        notarialActType: 'jurat' as const,
        signerSlotIds: ['s1'],
        certificateStyle: 'individual' as const,
      },
    ];
    const slots = syncDocumentSlotsFromParsedTypes(
      ['Deed', 'Affidavit'],
      existing,
      'acknowledgment',
      true,
      ['s1'],
    );
    expect(slots[0].notarialActType).toBe('jurat');
    expect(slots[1].notarialActType).toBe('acknowledgment');
  });

  it('joins document slots for bulk input', () => {
    expect(
      joinDocumentTypesForBulkInput([
        { slotId: 'a', documentType: 'Deed', notarialActType: 'acknowledgment', signerSlotIds: [], certificateStyle: 'individual' },
        { slotId: 'b', documentType: 'Affidavit', notarialActType: 'acknowledgment', signerSlotIds: [], certificateStyle: 'individual' },
      ]),
    ).toBe('Deed, Affidavit');
  });
});

describe('sanitizePayloadForDraft', () => {
  it('fills gaps for partial appointment planning', () => {
    const s1 = generateSlotId('signer');
    const sanitized = sanitizePayloadForDraft({
      appointmentId: 'appt-draft',
      appointmentLabel: 'Western Sierra',
      locationCity: '',
      locationState: '',
      roster: [{ slotId: s1, signerFullName: '', signerAddress: '', signerCity: '', signerState: '', idType: 'driver_license', signerIndexInAppointment: 1 }],
      documents: [],
    });
    expect(sanitized.roster[0].signerFullName).toContain('draft');
    expect(sanitized.documents).toHaveLength(1);
    expect(sanitized.documents[0].documentType).toContain('TBD');
    const expanded = expandAppointmentToEntries(sanitized, { defaultState: 'OK', stampFeeCents: 500 });
    expect(expanded.length).toBeGreaterThan(0);
  });
});
