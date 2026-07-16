import { describe, it, expect } from 'vitest';
import {
  computeSignerFeesForDocument,
  resolveFeeScheduleState,
  resolveJournalSharedCertMode,
  defaultSharedCertificateStyle,
  shouldDefaultSplitDocuments,
  sumDocumentFeeCents,
} from './fee-rules';

describe('fee-rules', () => {
  const okSettings = { defaultState: 'OK', stampFeeCents: 500 };
  const paSettings = { defaultState: 'PA', stampFeeCents: 500 };

  it('resolves OK and PA schedules', () => {
    expect(resolveFeeScheduleState({ defaultState: 'OK' })).toBe('OK');
    expect(resolveFeeScheduleState({ defaultState: 'PA' })).toBe('PA');
    expect(resolveFeeScheduleState({ defaultState: 'TX' })).toBe('GENERIC');
  });

  it('OK shared ack: 3 signers = $5 total on primary', () => {
    const allocs = computeSignerFeesForDocument(
      { notarialActType: 'acknowledgment', certificateStyle: 'shared', signerCount: 3 },
      okSettings,
    );
    expect(allocs).toHaveLength(3);
    expect(sumDocumentFeeCents(allocs)).toBe(500);
    expect(allocs[0].feeCents).toBe(500);
    expect(allocs[1].feeAllocation).toBe('waived');
    expect(allocs[2].feeAllocation).toBe('waived');
  });

  it('OK individual ack: 3 signers = $15 total', () => {
    const allocs = computeSignerFeesForDocument(
      { notarialActType: 'acknowledgment', certificateStyle: 'individual', signerCount: 3 },
      okSettings,
    );
    expect(sumDocumentFeeCents(allocs)).toBe(1500);
    expect(allocs.every(a => a.feeCents === 500)).toBe(true);
  });

  it('PA shared ack: 3 signers = $9 ($5+$2+$2)', () => {
    const allocs = computeSignerFeesForDocument(
      { notarialActType: 'acknowledgment', certificateStyle: 'shared', signerCount: 3 },
      paSettings,
    );
    expect(sumDocumentFeeCents(allocs)).toBe(900);
    expect(allocs[0].feeCents).toBe(900);
  });

  it('journal shared-cert mode defaults to separate_lines for all states', () => {
    expect(resolveJournalSharedCertMode({ defaultState: 'PA' })).toBe('separate_lines');
    expect(resolveJournalSharedCertMode({ defaultState: 'OK' })).toBe('separate_lines');
    expect(resolveJournalSharedCertMode({ defaultState: 'PA', journalSharedCertMode: 'combined_line' })).toBe('combined_line');
    expect(resolveJournalSharedCertMode({ defaultState: 'PA', journalSharedCertMode: 'separate_lines' })).toBe('separate_lines');
  });

  it('defaultSharedCertificateStyle follows journal mode', () => {
    expect(defaultSharedCertificateStyle({ defaultState: 'PA' })).toBe('individual');
    expect(defaultSharedCertificateStyle({ defaultState: 'OK' })).toBe('individual');
    expect(defaultSharedCertificateStyle({ defaultState: 'PA', journalSharedCertMode: 'combined_line' })).toBe('shared');
    expect(defaultSharedCertificateStyle({ defaultState: 'PA', journalSharedCertMode: 'separate_lines' })).toBe('individual');
  });

  it('shouldDefaultSplitDocuments defaults true unless explicitly false', () => {
    expect(shouldDefaultSplitDocuments({})).toBe(true);
    expect(shouldDefaultSplitDocuments({ journalSplitDocumentsDefault: false })).toBe(false);
  });
});
