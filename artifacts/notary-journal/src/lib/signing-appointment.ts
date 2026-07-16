import type { JournalEntry, NotarySettings } from './db';
import { getMissingRosterEntryFields } from './completion';
import { ACT_TYPE_TO_FEE_TYPE } from './fees';
import {
  computeSignerFeesForDocument,
  resolveJournalSharedCertMode,
  sumDocumentFeeCents,
  type CertificateStyle,
  type SignerFeeAllocation,
} from './fee-rules';
import { rosterEntryToAdditionalSigner } from './entry-signers';

/** One signer in the appointment roster — ID captured once, reused for all their docs. */
export interface SignerRosterEntry {
  slotId: string;
  signerFullName: string;
  signerAddress: string;
  signerCity: string;
  signerState: string;
  signerDOB?: string;
  signerPhone?: string;
  idType: JournalEntry['idType'];
  idNumber?: string;
  idIssuingState?: string;
  idExpirationDate?: string;
  idFrontImage?: string;
  idBackImage?: string;
  signatureImage?: string;
  signerIndexInAppointment: number;
}

/** One document row in the appointment matrix. */
export interface DocumentActSlot {
  slotId: string;
  documentType: string;
  documentDescription?: string;
  documentDate?: string;
  notarialActType: JournalEntry['notarialActType'];
  signerSlotIds: string[];
  certificateStyle: CertificateStyle;
  stampCountOverride?: number;
  feeCentsOverride?: number;
}

export interface SigningAppointmentPayload {
  appointmentId: string;
  appointmentLabel?: string;
  locationCity: string;
  locationState: string;
  locationAddress?: string;
  completedAt?: string;
  notes?: string;
  roster: SignerRosterEntry[];
  documents: DocumentActSlot[];
}

export function generateAppointmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `appt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function generateSlotId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function validateSigningAppointmentPayload(payload: SigningAppointmentPayload): string[] {
  const errors: string[] = [];
  if (!payload.appointmentId?.trim()) errors.push('appointmentId is required');
  if (!payload.locationCity?.trim() || !payload.locationState?.trim()) {
    errors.push('location city and state are required');
  }
  if (!payload.roster?.length) errors.push('at least one signer is required');
  if (!payload.documents?.length) errors.push('at least one document is required');

  payload.roster?.forEach((s, i) => {
    if (!s.slotId?.trim()) errors.push(`signer ${i + 1}: slotId is required`);
    if (!s.signerFullName?.trim()) errors.push(`signer ${i + 1}: name is required`);
    if (!s.signerAddress?.trim()) errors.push(`signer ${i + 1}: address is required`);
  });

  const rosterIds = new Set(payload.roster?.map(s => s.slotId) ?? []);
  payload.documents?.forEach((doc, i) => {
    if (!doc.documentType?.trim()) errors.push(`document ${i + 1}: type is required`);
    if (!doc.notarialActType) errors.push(`document ${i + 1}: act type is required`);
    if (!doc.signerSlotIds?.length) errors.push(`document ${i + 1}: at least one signer required`);
    doc.signerSlotIds?.forEach(sid => {
      if (!rosterIds.has(sid)) errors.push(`document ${i + 1}: unknown signer slot ${sid}`);
    });
  });

  return errors;
}

/** Full compliance validation before completing an appointment (matches single-entry rules). */
export function validateSigningAppointmentForComplete(
  payload: SigningAppointmentPayload,
  settings?: NotarySettings | null,
): string[] {
  const errors = validateSigningAppointmentPayload(payload);
  payload.roster?.forEach((s, i) => {
    const label = s.signerFullName?.trim() || `Signer ${i + 1}`;
    const missing = getMissingRosterEntryFields(
      {
        signerFullName: s.signerFullName,
        signerAddress: s.signerAddress,
        signerCity: s.signerCity,
        signerState: s.signerState,
        signerDOB: s.signerDOB,
        idType: s.idType,
        idNumber: s.idNumber,
        idExpirationDate: s.idExpirationDate,
        idFrontImage: s.idFrontImage,
      },
      settings,
      label,
    );
    errors.push(...missing);
  });
  return errors;
}

export interface ExpandedAppointmentEntry {
  draft: Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt'>;
  signerSlotId: string;
  documentSlotId: string;
}

/**
 * Entry generation for appointment matrix.
 * - Shared cert checked on a document: one journal row, all signers listed (#1, #2, #3).
 * - Shared cert unchecked: one row per signer on that document.
 * - Settings only default the shared-cert checkbox — not whether combined lines apply.
 */
export function expandAppointmentToEntries(
  payload: SigningAppointmentPayload,
  feeSettings?: Pick<import('./db').NotarySettings, 'stampFeeCents' | 'stampFeeByState' | 'defaultState' | 'journalSharedCertMode'> | null,
): ExpandedAppointmentEntry[] {
  const errors = validateSigningAppointmentPayload(payload);
  if (errors.length) throw new Error(errors.join('; '));

  const rosterById = new Map(payload.roster.map(s => [s.slotId, s]));
  const completedAt = payload.completedAt ?? new Date().toISOString();
  const totalActs = countAppointmentActs(payload, feeSettings);
  let actIndex = 0;

  const results: ExpandedAppointmentEntry[] = [];

  for (const doc of payload.documents) {
    const signers = doc.signerSlotIds
      .map(id => rosterById.get(id))
      .filter((s): s is SignerRosterEntry => !!s);

    const feeAllocations = computeSignerFeesForDocument(
      {
        notarialActType: doc.notarialActType,
        certificateStyle: doc.certificateStyle,
        signerCount: signers.length,
      },
      feeSettings,
      payload.locationState,
    );

    // Per-signing "Shared certificate" checkbox controls print layout — not Settings alone.
    const useCombinedLine = doc.certificateStyle === 'shared' && signers.length > 1;

    if (useCombinedLine) {
      actIndex += 1;
      const primary = signers[0];
      const additionalSigners = signers.slice(1).map((s, i) => rosterEntryToAdditionalSigner(s, i + 2));
      const coSignerNames = signers.slice(1).map(s => s.signerFullName.trim());
      let feeCents = sumDocumentFeeCents(feeAllocations);
      let stampCount = 1;
      if (typeof doc.feeCentsOverride === 'number') feeCents = doc.feeCentsOverride;
      if (typeof doc.stampCountOverride === 'number') stampCount = doc.stampCountOverride;

      results.push({
        signerSlotId: primary.slotId,
        documentSlotId: doc.slotId,
        draft: buildDraftFromSigner(primary, doc, payload, completedAt, {
          appointmentMeta: {
            actIndex,
            actCount: totalActs,
            feeCents,
            stampCount,
            feeAllocation: 'primary',
            certificateStyle: doc.certificateStyle,
            coSignerNames,
            additionalSigners,
          },
        }),
      });
      continue;
    }

    const coSignerNames =
      doc.certificateStyle === 'shared' && signers.length > 1
        ? signers.slice(1).map(s => s.signerFullName.trim())
        : undefined;

    signers.forEach((signer, signerIdx) => {
      actIndex += 1;
      const alloc: SignerFeeAllocation = feeAllocations[signerIdx] ?? {
        feeCents: 0,
        stampCount: 1,
        feeAllocation: 'primary',
      };

      let feeCents = alloc.feeCents;
      let stampCount = alloc.stampCount || 1;
      if (typeof doc.feeCentsOverride === 'number' && signerIdx === 0) {
        feeCents = doc.feeCentsOverride;
      }
      if (typeof doc.stampCountOverride === 'number' && signerIdx === 0) {
        stampCount = doc.stampCountOverride;
      }

      const isPrimaryShared = doc.certificateStyle === 'shared' && signerIdx === 0;

      results.push({
        signerSlotId: signer.slotId,
        documentSlotId: doc.slotId,
        draft: buildDraftFromSigner(signer, doc, payload, completedAt, {
          appointmentMeta: {
            actIndex,
            actCount: totalActs,
            feeCents,
            stampCount,
            feeAllocation: alloc.feeAllocation,
            certificateStyle: doc.certificateStyle,
            coSignerNames: isPrimaryShared ? coSignerNames : undefined,
          },
        }),
      });
    });
  }

  return results;
}

function buildDraftFromSigner(
  signer: SignerRosterEntry,
  doc: DocumentActSlot,
  payload: SigningAppointmentPayload,
  completedAt: string,
  opts: {
    appointmentMeta: {
      actIndex: number;
      actCount: number;
      feeCents: number;
      stampCount: number;
      feeAllocation: SignerFeeAllocation['feeAllocation'];
      certificateStyle: CertificateStyle;
      coSignerNames?: string[];
      additionalSigners?: ReturnType<typeof rosterEntryToAdditionalSigner>[];
    };
  },
): Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt'> {
  const { appointmentMeta: m } = opts;
  return {
    status: 'draft',
    appointmentId: payload.appointmentId,
    appointmentLabel: payload.appointmentLabel,
    signingGroupId: payload.appointmentId,
    signingGroupLabel: payload.appointmentLabel,
    signerSlotId: signer.slotId,
    signerIndexInAppointment: signer.signerIndexInAppointment,
    documentSlotId: doc.slotId,
    certificateStyle: m.certificateStyle,
    feeAllocation: m.feeAllocation,
    coSignerNames: m.coSignerNames,
    additionalSigners: m.additionalSigners,
    actIndexInGroup: m.actIndex,
    actCountInGroup: m.actCount,
    signerFullName: signer.signerFullName,
    signerAddress: signer.signerAddress,
    signerCity: signer.signerCity,
    signerState: signer.signerState,
    signerDOB: signer.signerDOB,
    signerPhone: signer.signerPhone,
    idType: signer.idType,
    idNumber: signer.idNumber,
    idIssuingState: signer.idIssuingState,
    idExpirationDate: signer.idExpirationDate,
    idFrontImage: signer.idFrontImage,
    idBackImage: signer.idBackImage,
    signatureImage: signer.signatureImage,
    documentType: doc.documentType,
    documentDescription: doc.documentDescription,
    documentDate: doc.documentDate,
    notarialActType: doc.notarialActType,
    feeCharged: m.feeCents,
    feeWaived: m.feeCents === 0 && m.feeAllocation === 'waived',
    feeType: ACT_TYPE_TO_FEE_TYPE[doc.notarialActType],
    stampCount: m.stampCount,
    locationCity: payload.locationCity,
    locationState: payload.locationState,
    locationAddress: payload.locationAddress,
    notes: payload.notes,
    completedAt,
    notarizationDateTime: completedAt,
  };
}

/** Count journal lines that will be created (shared cert on a doc = one line for all signers). */
export function countAppointmentActs(
  payload: SigningAppointmentPayload,
  _feeSettings?: Pick<import('./db').NotarySettings, 'defaultState' | 'journalSharedCertMode'> | null,
): number {
  return payload.documents.reduce((sum, doc) => {
    const n = doc.signerSlotIds.length;
    if (doc.certificateStyle === 'shared' && n > 1) {
      return sum + 1;
    }
    return sum + n;
  }, 0);
}

/** Count generated journal entries for preview. */
export function countAppointmentEntries(
  payload: SigningAppointmentPayload,
  feeSettings?: Pick<import('./db').NotarySettings, 'defaultState' | 'journalSharedCertMode'> | null,
): number {
  return countAppointmentActs(payload, feeSettings);
}

/** Total fee cents across all generated entries (respects fee engine). */
export function previewAppointmentTotalFeeCents(
  payload: SigningAppointmentPayload,
  feeSettings?: Pick<import('./db').NotarySettings, 'stampFeeCents' | 'stampFeeByState' | 'defaultState'> | null,
): number {
  try {
    const expanded = expandAppointmentToEntries(payload, feeSettings);
    return expanded.reduce((sum, e) => sum + (e.draft.feeWaived ? 0 : e.draft.feeCharged), 0);
  } catch {
    return 0;
  }
}

/** Join document slots into a comma-separated bulk input string. */
export function joinDocumentTypesForBulkInput(documents: DocumentActSlot[]): string {
  return documents.map(d => d.documentType.trim()).filter(Boolean).join(', ');
}

/**
 * When the notary types comma-separated document types, expand or shrink the
 * document matrix while preserving per-doc signer/act/cert settings by index.
 */
export function syncDocumentSlotsFromParsedTypes(
  parsed: string[],
  previous: DocumentActSlot[],
  defaultActType: JournalEntry['notarialActType'],
  customActPerDocument: boolean,
  allSignerSlotIds: string[],
  defaultCertificateStyle: import('./fee-rules').CertificateStyle = 'individual',
): DocumentActSlot[] {
  const fallbackSigners = allSignerSlotIds.length ? [...allSignerSlotIds] : [];
  const defaultCertForNewSlot = (): DocumentActSlot['certificateStyle'] =>
    fallbackSigners.length > 1 && defaultCertificateStyle === 'shared' ? 'shared' : 'individual';
  if (!parsed.length) {
    if (previous.length) return previous;
    return [
      {
        slotId: generateSlotId('doc'),
        documentType: '',
        notarialActType: defaultActType,
        signerSlotIds: fallbackSigners,
        certificateStyle: defaultCertForNewSlot(),
      },
    ];
  }
  return parsed.map((docType, i) => {
    const existing = previous[i];
    const actType =
      customActPerDocument && existing?.notarialActType
        ? existing.notarialActType
        : defaultActType;
    const signerSlotIds =
      existing?.signerSlotIds?.length ? existing.signerSlotIds : fallbackSigners;
    return {
      slotId: existing?.slotId ?? generateSlotId('doc'),
      documentType: docType,
      documentDescription: existing?.documentDescription,
      documentDate: existing?.documentDate,
      notarialActType: actType,
      signerSlotIds,
      certificateStyle:
        existing?.certificateStyle ??
        (signerSlotIds.length > 1 ? defaultCertForNewSlot() : 'individual'),
      stampCountOverride: existing?.stampCountOverride,
      feeCentsOverride: existing?.feeCentsOverride,
    };
  });
}

/** Fill gaps so a partially-filled appointment can be saved as draft entries. */
export function sanitizePayloadForDraft(payload: SigningAppointmentPayload): SigningAppointmentPayload {
  const roster = payload.roster.map((s, i) => ({
    ...s,
    signerFullName: s.signerFullName?.trim() || `Signer ${i + 1} (draft)`,
    signerAddress: s.signerAddress?.trim() || '(draft)',
    signerCity: s.signerCity?.trim() || '',
    signerState: s.signerState?.trim() || '',
  }));
  const primarySlot = roster[0]?.slotId;
  let documents = payload.documents
    .filter(d => d.documentType?.trim())
    .map(d => ({
      ...d,
      signerSlotIds:
        d.signerSlotIds?.length
          ? d.signerSlotIds
          : primarySlot
            ? [primarySlot]
            : [],
    }));
  if (!documents.length && primarySlot) {
    documents = [
      {
        slotId: generateSlotId('doc'),
        documentType: 'TBD (draft)',
        notarialActType: 'acknowledgment',
        signerSlotIds: [primarySlot],
        certificateStyle: 'individual',
      },
    ];
  }
  return {
    ...payload,
    locationCity: payload.locationCity?.trim() || '(draft)',
    locationState: payload.locationState?.trim() || 'OK',
    roster,
    documents,
  };
}
