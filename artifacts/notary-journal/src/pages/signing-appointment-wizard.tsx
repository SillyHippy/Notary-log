import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import SignaturePad from 'signature_pad';
import { Check, ChevronRight, Plus, Trash2, Users, FileText, MapPin, Loader2, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  createAndCompleteSigningAppointment,
  createDraftSigningAppointment,
  getSettings,
  shouldRecordSignerDOB,
  shouldRecordSignerIdNumber,
  shouldRequireSignature,
  type JournalEntry,
  type NotarySettings,
} from '@/lib/db';
import { IdScanCard } from '@/components/id-scan-card';
import { NotarizationTimeInput } from '@/components/notarization-time-input';
import { getMissingRosterEntryFields } from '@/lib/completion';
import { detectDeviceLocation } from '@/lib/geolocation';
import { parseDocumentTypesFromInput } from '@/lib/signing-session';
import { getStampFeeCents } from '@/lib/fees';
import {
  generateAppointmentId,
  generateSlotId,
  countAppointmentEntries,
  previewAppointmentTotalFeeCents,
  syncDocumentSlotsFromParsedTypes,
  joinDocumentTypesForBulkInput,
  type SignerRosterEntry,
  type DocumentActSlot,
  type SigningAppointmentPayload,
} from '@/lib/signing-appointment';
import { resolveFeeScheduleState, defaultSharedCertificateStyle, type CertificateStyle } from '@/lib/fee-rules';
import {
  getDefaultNotarizationDate,
  getDefaultNotarizationTime,
  resolveNotarizationDateTimeAtComplete,
} from '@/lib/journal-datetime';
import { hapticSuccess, hapticWarning } from '@/lib/haptic';

const APPT_STEPS = ['Appointment', 'Signers', 'Documents', 'Signatures', 'Review'];
const APPOINTMENT_DRAFT_KEY = 'notary-appointment-wizard-draft';

interface AppointmentWizardSnapshot {
  appointmentId: string;
  step: number;
  appointmentLabel: string;
  locationCity: string;
  locationState: string;
  locationAddress: string;
  notes: string;
  notarizationDate: string;
  notarizationTime: string;
  roster: SignerRosterEntry[];
  documents: DocumentActSlot[];
  bulkDocumentInput: string;
  defaultActType: JournalEntry['notarialActType'];
  customActPerDocument: boolean;
}

const ACT_OPTIONS: { value: JournalEntry['notarialActType']; label: string }[] = [
  { value: 'acknowledgment', label: 'Acknowledgment' },
  { value: 'jurat', label: 'Jurat' },
  { value: 'copy_certification', label: 'Copy Certification' },
  { value: 'signature_witnessing', label: 'Signature Witnessing' },
  { value: 'other', label: 'Other' },
];

function emptySigner(index: number): SignerRosterEntry {
  return {
    slotId: generateSlotId('signer'),
    signerFullName: '',
    signerAddress: '',
    signerCity: '',
    signerState: '',
    signerDOB: '',
    idType: 'driver_license',
    idNumber: '',
    idExpirationDate: '',
    signerIndexInAppointment: index,
  };
}

function emptyDocument(signerIds: string[], defaultCert: CertificateStyle = 'individual'): DocumentActSlot {
  return {
    slotId: generateSlotId('doc'),
    documentType: '',
    notarialActType: 'acknowledgment',
    signerSlotIds: signerIds.length ? [signerIds[0]] : [],
    certificateStyle: signerIds.length > 1 && defaultCert === 'shared' ? 'shared' : 'individual',
  };
}

interface SigningAppointmentWizardProps {
  onBack: () => void;
}

export function SigningAppointmentWizard({ onBack }: SigningAppointmentWizardProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<NotarySettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [appointmentId, setAppointmentId] = useState(() => generateAppointmentId());

  const [appointmentLabel, setAppointmentLabel] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationState, setLocationState] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [notarizationDate, setNotarizationDate] = useState(getDefaultNotarizationDate);
  const [notarizationTime, setNotarizationTime] = useState(getDefaultNotarizationTime);
  const [isLocating, setIsLocating] = useState(false);
  const [locationDetected, setLocationDetected] = useState(false);
  const locationAutoTried = useRef(false);
  const draftRestored = useRef(false);
  const notarizationDateEditedRef = useRef(false);
  const notarizationTimeEditedRef = useRef(false);

  const snapNotarizationDateTimeIfAuto = () => {
    if (!notarizationTimeEditedRef.current) {
      setNotarizationTime(getDefaultNotarizationTime());
    }
    if (!notarizationDateEditedRef.current) {
      setNotarizationDate(getDefaultNotarizationDate());
    }
  };

  const [roster, setRoster] = useState<SignerRosterEntry[]>([emptySigner(1)]);
  const [documents, setDocuments] = useState<DocumentActSlot[]>([]);
  const [activeSignerIdx, setActiveSignerIdx] = useState(0);
  const [bulkDocumentInput, setBulkDocumentInput] = useState('');
  const [defaultActType, setDefaultActType] = useState<JournalEntry['notarialActType']>('acknowledgment');
  const [customActPerDocument, setCustomActPerDocument] = useState(false);

  const sigRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const padRefs = useRef<Map<string, SignaturePad>>(new Map());
  const rosterSignerIds = roster.map(r => r.slotId).join(',');

  const persistWizardSnapshot = useCallback((nextStep = step) => {
    const snap: AppointmentWizardSnapshot = {
      appointmentId,
      step: nextStep,
      appointmentLabel,
      locationCity,
      locationState,
      locationAddress,
      notes,
      notarizationDate,
      notarizationTime,
      roster,
      documents,
      bulkDocumentInput,
      defaultActType,
      customActPerDocument,
    };
    try {
      localStorage.setItem(APPOINTMENT_DRAFT_KEY, JSON.stringify(snap));
    } catch {
      // ignore quota errors
    }
  }, [
    appointmentId,
    step,
    appointmentLabel,
    locationCity,
    locationState,
    locationAddress,
    notes,
    notarizationDate,
    notarizationTime,
    roster,
    documents,
    bulkDocumentInput,
    defaultActType,
    customActPerDocument,
  ]);

  const clearWizardSnapshot = () => {
    try {
      localStorage.removeItem(APPOINTMENT_DRAFT_KEY);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s);
      if (!draftRestored.current) {
        setLocationCity(s.defaultCity || '');
        setLocationState(s.defaultState || '');
      }
    });
  }, []);

  useEffect(() => {
    if (draftRestored.current) return;
    draftRestored.current = true;
    try {
      const raw = localStorage.getItem(APPOINTMENT_DRAFT_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw) as AppointmentWizardSnapshot;
      setAppointmentId(snap.appointmentId || generateAppointmentId());
      setStep(snap.step ?? 0);
      setAppointmentLabel(snap.appointmentLabel ?? '');
      setLocationCity(snap.locationCity ?? '');
      setLocationState(snap.locationState ?? '');
      setLocationAddress(snap.locationAddress ?? '');
      setNotes(snap.notes ?? '');
      setNotarizationDate(snap.notarizationDate ?? getDefaultNotarizationDate());
      setNotarizationTime(snap.notarizationTime ?? getDefaultNotarizationTime());
      if (snap.roster?.length) setRoster(snap.roster);
      if (snap.documents?.length) setDocuments(snap.documents);
      setBulkDocumentInput(snap.bulkDocumentInput ?? joinDocumentTypesForBulkInput(snap.documents ?? []));
      setDefaultActType(snap.defaultActType ?? 'acknowledgment');
      setCustomActPerDocument(snap.customActPerDocument ?? false);
      toast({
        title: 'Draft restored',
        description: 'Your in-progress appointment was recovered.',
      });
    } catch {
      // corrupt snapshot — start fresh
    }
  }, [toast]);

  const applyDetectedLocation = (loc: { city: string; state: string; address?: string }, quiet = false) => {
    if (loc.city) setLocationCity(loc.city);
    if (loc.state) setLocationState(loc.state);
    if (loc.address) setLocationAddress(loc.address);
    if (loc.city || loc.state) {
      setLocationDetected(true);
      setTimeout(() => setLocationDetected(false), 4000);
      if (!quiet) {
        const parts = [loc.address, loc.city, loc.state].filter(Boolean);
        toast({ title: 'Location detected', description: parts.join(', ') });
      }
    }
  };

  const runLocationDetect = async (quiet = false) => {
    setIsLocating(true);
    const result = await detectDeviceLocation();
    setIsLocating(false);
    if (result.ok) {
      applyDetectedLocation(result.location, quiet);
    } else if (!quiet) {
      const messages: Record<string, string> = {
        unsupported: 'Your browser does not support location detection.',
        denied: 'Location permission denied — enter city and state manually.',
        timeout: 'GPS timed out — try again or enter manually.',
        lookup_failed: 'Could not look up address — enter manually.',
      };
      toast({ title: 'Location unavailable', description: messages[result.reason], variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (step === 0 && !locationAutoTried.current) {
      locationAutoTried.current = true;
      runLocationDetect(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (roster.length && documents.length === 0 && !bulkDocumentInput.trim()) {
      const defaultCert = defaultSharedCertificateStyle(settings ?? undefined);
      setDocuments([emptyDocument(roster.map(r => r.slotId), defaultCert)]);
    }
  }, [roster.length, documents.length, bulkDocumentInput, settings]);

  useEffect(() => {
    if (step !== 2) return;
    const parsed = parseDocumentTypesFromInput(bulkDocumentInput);
    if (!parsed.length) return;
    const defaultCert = defaultSharedCertificateStyle(settings ?? undefined);
    setDocuments(prev =>
      syncDocumentSlotsFromParsedTypes(
        parsed,
        prev,
        defaultActType,
        customActPerDocument,
        roster.map(r => r.slotId),
        defaultCert,
      ),
    );
  }, [bulkDocumentInput, defaultActType, customActPerDocument, rosterSignerIds, step, settings]);

  useEffect(() => {
    if (step === 2 && !bulkDocumentInput.trim() && documents.length) {
      setBulkDocumentInput(joinDocumentTypesForBulkInput(documents));
    }
  }, [step, bulkDocumentInput, documents]);

  useEffect(() => {
    if (step === 3 && shouldRequireSignature(settings ?? undefined)) {
      roster.forEach(s => {
        const canvas = sigRefs.current.get(s.slotId);
        if (canvas && !padRefs.current.has(s.slotId)) {
          const pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)' });
          padRefs.current.set(s.slotId, pad);
        }
      });
    }
  }, [step, roster, settings]);

  const updateSigner = (idx: number, patch: Partial<SignerRosterEntry>) => {
    setRoster(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addSigner = () => {
    setRoster(prev => [...prev, emptySigner(prev.length + 1)]);
    setActiveSignerIdx(roster.length);
  };

  const removeSigner = (idx: number) => {
    if (roster.length <= 1) return;
    const removed = roster[idx];
    setRoster(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, signerIndexInAppointment: i + 1 })));
    setDocuments(prev =>
      prev.map(d => ({
        ...d,
        signerSlotIds: d.signerSlotIds.filter(id => id !== removed.slotId),
      })),
    );
    setActiveSignerIdx(Math.max(0, idx - 1));
  };

  const addDocument = () => {
    const defaultCert = defaultSharedCertificateStyle(settings ?? undefined);
    const next = [...documents, emptyDocument(roster.map(r => r.slotId), defaultCert)];
    setDocuments(next);
    setBulkDocumentInput(joinDocumentTypesForBulkInput(next));
  };

  const removeDocument = (docIdx: number) => {
    const defaultCert = defaultSharedCertificateStyle(settings ?? undefined);
    const next = documents.filter((_, i) => i !== docIdx);
    setDocuments(next.length ? next : [emptyDocument(roster.map(r => r.slotId), defaultCert)]);
    setBulkDocumentInput(joinDocumentTypesForBulkInput(next));
  };

  const updateDocument = (idx: number, patch: Partial<DocumentActSlot>) => {
    setDocuments(prev => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const handleSignerScan = (
    idx: number,
    payload: {
      frontImage?: string;
      backImage?: string;
      result: {
        fields: Record<string, string>;
        extraction: { method: 'barcode' | 'ocr' | 'mrz'; text?: string; confidence?: number };
      };
    },
  ) => {
    const recordDOB = shouldRecordSignerDOB(settings ?? undefined);
    const recordId = shouldRecordSignerIdNumber(settings ?? undefined);
    const FIELD_MAP: Array<[string, keyof SignerRosterEntry, boolean]> = [
      ['fullName', 'signerFullName', true],
      ['address', 'signerAddress', true],
      ['city', 'signerCity', true],
      ['state', 'signerState', true],
      ['dob', 'signerDOB', recordDOB],
      ['idNumber', 'idNumber', recordId],
      ['idIssuingState', 'idIssuingState', true],
      ['expirationDate', 'idExpirationDate', true],
    ];
    const patch: Partial<SignerRosterEntry> = {};
    for (const [from, to, allowed] of FIELD_MAP) {
      if (!allowed) continue;
      const v = payload.result.fields[from];
      if (v) (patch as Record<string, unknown>)[to] = v;
    }
    if (payload.frontImage !== undefined) patch.idFrontImage = payload.frontImage;
    if (payload.backImage !== undefined) patch.idBackImage = payload.backImage;
    updateSigner(idx, patch);
    const fieldCount = Object.keys(patch).filter(k => !k.endsWith('Image')).length;
    toast({
      title: 'ID scanned',
      description: fieldCount > 0
        ? `Signer ${idx + 1} updated from ${payload.result.extraction.method} scan.`
        : 'ID image attached.',
    });
  };

  const toggleDocSigner = (docIdx: number, slotId: string, checked: boolean) => {
    const defaultCert = defaultSharedCertificateStyle(settings ?? undefined);
    setDocuments(prev =>
      prev.map((d, i) => {
        if (i !== docIdx) return d;
        const nextIds = checked
          ? [...d.signerSlotIds, slotId]
          : d.signerSlotIds.filter(id => id !== slotId);
        const uniqueIds = [...new Set(nextIds)];
        let certificateStyle = d.certificateStyle;
        if (uniqueIds.length > 1 && certificateStyle === 'individual' && defaultCert === 'shared') {
          certificateStyle = 'shared';
        }
        if (uniqueIds.length <= 1) {
          certificateStyle = 'individual';
        }
        return { ...d, signerSlotIds: uniqueIds, certificateStyle };
      }),
    );
  };

  const buildPayload = (opts?: { forComplete?: boolean }): SigningAppointmentPayload => {
    const sigRequired = shouldRequireSignature(settings ?? undefined);
    const rosterWithSigs = roster.map(s => {
      if (!sigRequired) return s;
      const pad = padRefs.current.get(s.slotId);
      const data = pad && !pad.isEmpty() ? pad.toDataURL('image/png') : s.signatureImage;
      return { ...s, signatureImage: data };
    });
    const completedAt = opts?.forComplete
      ? resolveNotarizationDateTimeAtComplete(notarizationDate, notarizationTime, {
          dateManuallyEdited: notarizationDateEditedRef.current,
          timeManuallyEdited: notarizationTimeEditedRef.current,
        })
      : resolveNotarizationDateTimeAtComplete(notarizationDate, notarizationTime, {
          dateManuallyEdited: true,
          timeManuallyEdited: true,
        });
    return {
      appointmentId,
      appointmentLabel: appointmentLabel.trim() || undefined,
      locationCity,
      locationState,
      locationAddress: locationAddress || undefined,
      notes: notes || undefined,
      roster: rosterWithSigs,
      documents,
      completedAt,
    };
  };

  const validateStep = (): string | null => {
    if (step === 0) {
      if (!locationCity.trim() || !locationState.trim()) return 'Location city and state are required.';
      return null;
    }
    if (step === 1) {
      for (let i = 0; i < roster.length; i++) {
        const s = roster[i];
        if (!s.signerFullName.trim()) return `Signer ${i + 1}: name is required.`;
        if (!s.signerAddress.trim()) return `Signer ${i + 1}: address is required.`;
      }
      return null;
    }
    if (step === 2) {
      if (!documents.length) return 'Add at least one document.';
      for (let i = 0; i < documents.length; i++) {
        const d = documents[i];
        if (!d.documentType.trim()) return `Document ${i + 1}: type is required.`;
        if (!d.signerSlotIds.length) return `Document ${i + 1}: select at least one signer.`;
      }
      return null;
    }
    if (step === 3 && shouldRequireSignature(settings ?? undefined)) {
      for (const s of roster) {
        const pad = padRefs.current.get(s.slotId);
        if (!pad || pad.isEmpty()) return `Capture signature for ${s.signerFullName || 'signer'}.`;
      }
    }
    return null;
  };

  const validateForComplete = (): string | null => {
    if (!locationCity.trim() || !locationState.trim()) return 'Location city and state are required.';
    if (!documents.length) return 'Add at least one document.';
    for (let i = 0; i < roster.length; i++) {
      const s = roster[i];
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
        `Signer ${i + 1}`,
      );
      if (missing.length) return missing[0];
    }
    for (let i = 0; i < documents.length; i++) {
      const d = documents[i];
      if (!d.documentType.trim()) return `Document ${i + 1}: type is required.`;
      if (!d.signerSlotIds.length) return `Document ${i + 1}: select at least one signer.`;
    }
    if (shouldRequireSignature(settings ?? undefined)) {
      for (const s of roster) {
        const pad = padRefs.current.get(s.slotId);
        if (!pad || pad.isEmpty()) return `Capture signature for ${s.signerFullName || 'signer'}.`;
      }
    }
    return null;
  };

  const nextStep = () => {
    const err = validateStep();
    if (err) {
      toast({ title: 'Required', description: err, variant: 'destructive' });
      hapticWarning();
      return;
    }
    if (step === 2 && !shouldRequireSignature(settings ?? undefined)) {
      snapNotarizationDateTimeIfAuto();
      setStep(4);
    } else {
      if (step === 3) snapNotarizationDateTimeIfAuto();
      setStep(s => Math.min(s + 1, APPT_STEPS.length - 1));
    }
  };

  const handleSaveDraft = async (opts?: { continueAfter?: boolean; stayOnPage?: boolean }) => {
    setIsSaving(true);
    try {
      persistWizardSnapshot();
      const payload = buildPayload();
      const ids = await createDraftSigningAppointment(payload, settings ?? undefined);
      const planningOnly = step <= 1 && !appointmentLabel.trim() && roster.every(s => !s.signerFullName.trim());
      toast({
        title: 'Saved as draft',
        description: opts?.continueAfter
          ? 'You can fill in missing details later.'
          : planningOnly
            ? 'Planning draft saved. Reopen Signing Appointment anytime to continue where you left off.'
            : `${ids.length} draft ${ids.length === 1 ? 'entry' : 'entries'} in Journal → Drafts. Reopen Signing Appointment to keep editing this visit.`,
      });
      hapticSuccess();
      if (opts?.continueAfter) {
        setStep(s => Math.min(s + 1, APPT_STEPS.length - 1));
      } else if (!opts?.stayOnPage) {
        setLocation('/journal');
      }
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async () => {
    const err = validateForComplete();
    if (err) {
      toast({ title: 'Required', description: err, variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const payload = buildPayload({ forComplete: true });
      const ids = await createAndCompleteSigningAppointment(payload, settings ?? undefined);
      clearWizardSnapshot();
      toast({
        title: 'Appointment saved',
        description: `${ids.length} journal entries created.`,
      });
      hapticSuccess();
      setLocation('/journal');
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
      setIsSaving(false);
    }
  };

  const payload = buildPayload();
  const entryCount = countAppointmentEntries(payload, settings ?? undefined);
  const totalFee = previewAppointmentTotalFeeCents(payload, settings ?? undefined);
  const feeState = resolveFeeScheduleState(settings ?? undefined);
  const paCombined = feeState === 'PA';
  const parsedDocumentTypes = parseDocumentTypesFromInput(bulkDocumentInput);
  const perActFeeDollars = getStampFeeCents(settings ?? undefined, locationState) / 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Signing Appointment</h1>
          <p className="text-sm text-muted-foreground">
            Multiple signers · ID once per person · combine co-signers = one entry with signer #1, #2, #3
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}>← Single entry</Button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {APPT_STEPS.map((label, i) => (
          <div
            key={label}
            className={`flex items-center gap-1 text-xs whitespace-nowrap px-2 py-1 rounded-full ${
              i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-primary/20' : 'bg-muted text-muted-foreground'
            }`}
          >
            {i < step ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
            {label}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="w-5 h-5" /> Appointment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Appointment name (optional)</Label>
              <Input
                placeholder="e.g. Western Sierra Loan Signing"
                value={appointmentLabel}
                onChange={e => setAppointmentLabel(e.target.value)}
                data-testid="input-appointment-label"
              />
              <p className="text-xs text-muted-foreground mt-1">Shows in journal — not on individual print lines.</p>
            </div>
            <div>
              <Label>Notarization location *</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 w-full"
                onClick={() => runLocationDetect(false)}
                disabled={isLocating}
                data-testid="btn-detect-location"
              >
                {isLocating ? (
                  <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Detecting…</>
                ) : locationDetected ? (
                  <><Check className="w-3 h-3 mr-2 text-green-600" /> Location detected</>
                ) : (
                  <><MapPin className="w-3 h-3 mr-2" /> Use My Location</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">
                Auto-detects city and state on this step. Fills street address when GPS is precise enough.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>City *</Label>
                <Input value={locationCity} onChange={e => setLocationCity(e.target.value)} />
              </div>
              <div>
                <Label>State *</Label>
                <Input value={locationState} onChange={e => setLocationState(e.target.value.toUpperCase().slice(0, 2))} />
              </div>
            </div>
            <div>
              <Label>Address (optional)</Label>
              <Input
                placeholder="Street address when known"
                value={locationAddress}
                onChange={e => setLocationAddress(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Notarization Date</Label>
                <Input
                  type="date"
                  value={notarizationDate}
                  onChange={e => {
                    notarizationDateEditedRef.current = true;
                    setNotarizationDate(e.target.value);
                  }}
                  data-testid="input-appt-notarization-date"
                />
              </div>
              <div>
                <Label>Notarization Time</Label>
                <div className="mt-1">
                  <NotarizationTimeInput
                    value={notarizationTime}
                    onChange={v => {
                      notarizationTimeEditedRef.current = true;
                      setNotarizationTime(v);
                    }}
                    data-testid="input-appt-notarization-time"
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              When the notarial acts are performed — shown on your printed journal. Use 12-hour time (AM/PM). Leave as-is to use the time when you complete.
            </p>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {roster.map((s, i) => (
              <Button
                key={s.slotId}
                variant={activeSignerIdx === i ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveSignerIdx(i)}
              >
                <Users className="w-3.5 h-3.5 mr-1" />
                {s.signerFullName.trim() || `Signer ${i + 1}`}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={addSigner}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add signer
            </Button>
          </div>

          {roster[activeSignerIdx] && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Signer {activeSignerIdx + 1}</CardTitle>
                {roster.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeSigner(activeSignerIdx)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Scan ID once — info is reused for every document this signer touches.</p>
                <div>
                  <Label>ID Type *</Label>
                  <Select
                    value={roster[activeSignerIdx].idType}
                    onValueChange={v => updateSigner(activeSignerIdx, { idType: v as SignerRosterEntry['idType'] })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="driver_license">Driver License</SelectItem>
                      <SelectItem value="passport">Passport</SelectItem>
                      <SelectItem value="state_id">State ID</SelectItem>
                      <SelectItem value="military_id">Military ID</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <IdScanCard
                  key={roster[activeSignerIdx].slotId}
                  idType={roster[activeSignerIdx].idType}
                  initialFrontImage={roster[activeSignerIdx].idFrontImage}
                  initialBackImage={roster[activeSignerIdx].idBackImage}
                  onScan={payload => handleSignerScan(activeSignerIdx, payload)}
                />
                <div>
                  <Label>Full Name *</Label>
                  <Input
                    className="mt-1"
                    placeholder="Signer full legal name"
                    value={roster[activeSignerIdx].signerFullName}
                    onChange={e => updateSigner(activeSignerIdx, { signerFullName: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Street Address *</Label>
                  <Input
                    className="mt-1"
                    placeholder="Street address"
                    value={roster[activeSignerIdx].signerAddress}
                    onChange={e => updateSigner(activeSignerIdx, { signerAddress: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>City</Label>
                    <Input
                      className="mt-1"
                      placeholder="City"
                      value={roster[activeSignerIdx].signerCity}
                      onChange={e => updateSigner(activeSignerIdx, { signerCity: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>State</Label>
                    <Input
                      className="mt-1"
                      placeholder="ST"
                      value={roster[activeSignerIdx].signerState}
                      onChange={e => updateSigner(activeSignerIdx, { signerState: e.target.value.toUpperCase().slice(0, 2) })}
                    />
                  </div>
                </div>
                {shouldRecordSignerDOB(settings ?? undefined) && (
                  <div>
                    <Label>Date of Birth *</Label>
                    <Input
                      className="mt-1"
                      type="date"
                      value={roster[activeSignerIdx].signerDOB ?? ''}
                      onChange={e => updateSigner(activeSignerIdx, { signerDOB: e.target.value })}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {shouldRecordSignerIdNumber(settings ?? undefined) && (
                    <div>
                      <Label>ID Number *</Label>
                      <Input
                        className="mt-1"
                        placeholder="ID number"
                        value={roster[activeSignerIdx].idNumber ?? ''}
                        onChange={e => updateSigner(activeSignerIdx, { idNumber: e.target.value })}
                      />
                    </div>
                  )}
                  <div className={shouldRecordSignerIdNumber(settings ?? undefined) ? '' : 'col-span-2'}>
                    <Label>ID Expiration Date *</Label>
                    <Input
                      className="mt-1"
                      type="date"
                      value={roster[activeSignerIdx].idExpirationDate ?? ''}
                      onChange={e => updateSigner(activeSignerIdx, { idExpirationDate: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Issuing State / Authority</Label>
                  <Input
                    className="mt-1"
                    placeholder="e.g. OK"
                    value={roster[activeSignerIdx].idIssuingState ?? ''}
                    onChange={e => updateSigner(activeSignerIdx, { idIssuingState: e.target.value.toUpperCase().slice(0, 2) })}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Button variant="outline" onClick={addSigner} className="w-full">
            <Plus className="w-4 h-4 mr-2" /> Add another signer
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {roster.length > 1 && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <p className="font-medium text-foreground">Multiple signers on a document?</p>
              <p className="text-xs text-muted-foreground mt-1">
                Check <strong>Combine co-signers on one journal line</strong> on each document before you complete
                if they share one certificate — one entry with signer #1, #2, #3. Settings can default this on for you.
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Fee schedule: <strong>{feeState}</strong> — shared acknowledgment = one stamp; individual = per signer.
          </p>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Documents &amp; acts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Document types *</Label>
                <Input
                  placeholder="e.g. Warranty Deed — or Deed, Affidavit, Will for multiple"
                  value={bulkDocumentInput}
                  onChange={e => {
                    const v = e.target.value;
                    setBulkDocumentInput(v);
                    if (parseDocumentTypesFromInput(v).length > 1) {
                      setCustomActPerDocument(prev => prev);
                    }
                  }}
                  data-testid="input-bulk-documents"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Separate multiple documents with commas — each gets its own journal line when you complete.
                </p>
              </div>

              <div>
                <Label>Notarial act type (default)</Label>
                <Select
                  value={defaultActType}
                  onValueChange={v => {
                    const act = v as JournalEntry['notarialActType'];
                    setDefaultActType(act);
                    if (!customActPerDocument) {
                      setDocuments(prev => prev.map(d => ({ ...d, notarialActType: act })));
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACT_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {parsedDocumentTypes.length > 1 && (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-2">
                  <p className="font-medium text-foreground">
                    {parsedDocumentTypes.length} journal lines on complete:
                  </p>
                  <ul className="space-y-2">
                    {parsedDocumentTypes.map((doc, i) => (
                      <li key={`${doc}-${i}`} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                        <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                        <span className="font-medium text-foreground flex-1">{doc}</span>
                        {customActPerDocument && documents[i] && (
                          <Select
                            value={documents[i].notarialActType}
                            onValueChange={v => updateDocument(i, { notarialActType: v as JournalEntry['notarialActType'] })}
                          >
                            <SelectTrigger className="h-8 text-xs w-full sm:w-[10rem]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ACT_OPTIONS.map(o => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-start gap-2 pt-1">
                    <Checkbox
                      id="appt-custom-act-per-document"
                      checked={customActPerDocument}
                      onCheckedChange={c => setCustomActPerDocument(c === true)}
                      data-testid="checkbox-appt-custom-act-per-document"
                    />
                    <label htmlFor="appt-custom-act-per-document" className="text-xs leading-snug text-muted-foreground cursor-pointer">
                      Different act type per document (e.g. some acknowledgments, some jurats)
                    </label>
                  </div>
                  {perActFeeDollars > 0 && (
                    <p className="text-muted-foreground">
                      ${perActFeeDollars.toFixed(2)} per act × {entryCount} acts ={' '}
                      <span className="font-medium text-foreground">
                        ${(totalFee / 100).toFixed(2)}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {documents.map((doc, docIdx) => (
            <Card key={doc.slotId}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" /> {doc.documentType.trim() || `Document ${docIdx + 1}`}
                </CardTitle>
                {documents.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeDocument(docIdx)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {customActPerDocument && parsedDocumentTypes.length <= 1 && (
                  <Select
                    value={doc.notarialActType}
                    onValueChange={v => updateDocument(docIdx, { notarialActType: v as JournalEntry['notarialActType'] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACT_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div>
                  <Label className="text-xs">Signers on this document</Label>
                  <div className="flex flex-wrap gap-3 mt-2">
                    {roster.map(s => (
                      <label key={s.slotId} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={doc.signerSlotIds.includes(s.slotId)}
                          onCheckedChange={c => toggleDocSigner(docIdx, s.slotId, !!c)}
                        />
                        {s.signerFullName.trim() || `Signer ${s.signerIndexInAppointment}`}
                      </label>
                    ))}
                  </div>
                </div>
                {doc.signerSlotIds.length > 1 && (
                  <div
                    className={`rounded-md border px-3 py-2 space-y-2 ${
                      doc.certificateStyle === 'shared' ? 'border-primary/40 bg-primary/5' : 'border-amber-200 bg-amber-50/80'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id={`shared-${doc.slotId}`}
                        checked={doc.certificateStyle === 'shared'}
                        onCheckedChange={c =>
                          updateDocument(docIdx, { certificateStyle: c ? 'shared' : 'individual' })
                        }
                        className="mt-0.5"
                      />
                      <Label htmlFor={`shared-${doc.slotId}`} className="text-sm font-normal leading-snug">
                        <span className="font-medium text-foreground">Combine co-signers on one journal line</span>
                        <span className="block text-xs text-muted-foreground mt-1">
                          One stamp / one act — one entry with signer #1, #2, #3. Unchecked = separate print line per signer.
                        </span>
                      </Label>
                    </div>
                    {doc.certificateStyle !== 'shared' && (
                      <p className="text-xs text-amber-800 pl-6">
                        Print will show {doc.signerSlotIds.length} separate lines for this document unless you check this before completing.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" onClick={addDocument} className="w-full">
            <Plus className="w-4 h-4 mr-2" /> Add document
          </Button>
        </div>
      )}

      {step === 3 && shouldRequireSignature(settings ?? undefined) && (
        <div className="space-y-4">
          {roster.map(s => (
            <Card key={s.slotId}>
              <CardHeader><CardTitle className="text-base">{s.signerFullName} — signature</CardTitle></CardHeader>
              <CardContent>
                <canvas
                  ref={el => { if (el) sigRefs.current.set(s.slotId, el); }}
                  className="border rounded-md w-full touch-none"
                  style={{ height: 160 }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => padRefs.current.get(s.slotId)?.clear()}
                >
                  Clear
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {step === 4 && (
        <Card>
          <CardHeader><CardTitle>Review</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {appointmentLabel && <p><span className="text-muted-foreground">Appointment:</span> {appointmentLabel}</p>}
            <p><span className="text-muted-foreground">Notarization:</span> {notarizationDate} {notarizationTime}</p>
            <p><span className="text-muted-foreground">Location:</span> {locationCity}, {locationState}</p>
            <p><span className="text-muted-foreground">Signers:</span> {roster.length}</p>
            <p><span className="text-muted-foreground">Documents:</span> {documents.length}</p>
            <p><span className="text-muted-foreground">Journal lines:</span> {entryCount}</p>
            <p className="font-medium">
              Total fees: ${(totalFee / 100).toFixed(2)} ({feeState} schedule)
            </p>
            <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto">
              {roster.map(s => (
                <div key={s.slotId}>
                  <p className="font-medium">{s.signerFullName}</p>
                  <ul className="text-xs text-muted-foreground ml-3">
                    {documents
                      .filter(d => d.signerSlotIds.includes(s.slotId))
                      .map(d => (
                        <li key={d.slotId}>
                          {d.documentType} ({d.notarialActType.replace('_', ' ')})
                          {d.certificateStyle === 'shared' ? ' · shared cert' : ''}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {paCombined
                ? 'Shared certificates create one journal line with all signer names (#1, #2, #3).'
                : 'Print/PDF shows one line per journal entry.'}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-3 pb-8">
        <Button variant="outline" disabled={step === 0 || isSaving} onClick={() => setStep(s => s - 1)}>Back</Button>

        {step < APPT_STEPS.length - 1 && (
          <Button
            variant="secondary"
            onClick={() => handleSaveDraft({ stayOnPage: step <= 1 })}
            disabled={isSaving}
            data-testid="button-save-appointment-draft"
          >
            {isSaving ? 'Saving…' : step <= 1 ? 'Save planning draft' : 'Save as Draft'}
          </Button>
        )}

        {step === 1 && (
          <Button
            variant="secondary"
            onClick={() => handleSaveDraft({ continueAfter: true })}
            disabled={isSaving}
            className="gap-2"
          >
            <Save className="w-4 h-4" /> Save Draft &amp; Continue
          </Button>
        )}

        {step < APPT_STEPS.length - 1 ? (
          <Button onClick={nextStep} className="flex-1" disabled={isSaving}>
            Continue <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={handleComplete} disabled={isSaving} className="flex-1">
            {isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : `Complete ${entryCount} entries`}
          </Button>
        )}
      </div>
    </div>
  );
}
