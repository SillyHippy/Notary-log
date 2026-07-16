import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import SignaturePad from 'signature_pad';
import { BrowserPDF417Reader } from '@zxing/browser';
import { createWorker } from 'tesseract.js';
import { Camera, Upload, Check, ChevronRight, AlertTriangle, ScanLine, X, Eraser, CheckCircle2, Loader2, MapPin, IdCard, BookOpen, Plus, Save, Eye, ZoomIn } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { consumeIntakePrefill } from '@/lib/intake-prefill';
import { Checkbox } from '@/components/ui/checkbox';

import {
  createEntry,
  completeEntry,
  createAndCompleteSigningSession,
  getSettings,
  getAllEntries,
  getEntriesBySigningGroup,
  shouldRecordSignerDOB,
  shouldRecordSignerIdNumber,
  shouldRequireSignature,
  type JournalEntry,
  type NotarySettings,
} from '@/lib/db';
import { shouldDefaultSplitDocuments } from '@/lib/fee-rules';
import { NotarizationTimeInput } from '@/components/notarization-time-input';
import {
  getDefaultNotarizationDate,
  getDefaultNotarizationTime,
  resolveNotarizationDateTimeAtComplete,
  splitNotarizationDateTime,
} from '@/lib/journal-datetime';
import { detectDeviceLocation } from '@/lib/geolocation';
import { generateSigningGroupId, parseDocumentTypesFromInput } from '@/lib/signing-session';
import { parseAAMVA } from '@/lib/aamva';
import { extractLicenseFields } from '@/lib/ocr-license';
import { parseMRZ, mrzToSignerFields, type MrzPassport } from '@/lib/mrz';
import { backupToDrive, getStoredToken } from '@/lib/gdrive';
import { ACT_TYPE_TO_FEE_TYPE, FEE_TYPES, computeStampFeeCents, feeDollarsToCents, getStampFeeCents, shouldApplyAutoFee, type FeeType } from '@/lib/fees';
import { hapticSuccess, hapticWarning } from '@/lib/haptic';
import { getMissingCompletionFields, getSignerStepFieldsToCheck } from '@/lib/completion';
import { compressImageToDataUrl } from '@/lib/image-compress';
import { SigningAppointmentWizard } from '@/pages/signing-appointment-wizard';

const entrySchema = z
  .object({
    signerFullName: z.string().min(1, 'Full name is required'),
    // Address fields are conditionally required: a passport's MRZ has no
    // address, so we relax these when idType === 'passport' and validate
    // them in superRefine instead.
    signerAddress: z.string().optional().default(''),
    signerCity: z.string().optional().default(''),
    signerState: z.string().max(2).optional().default(''),
    // DOB / ID number / expiration are conditionally required based on the
    // notary's compliance toggles in Settings. The schema accepts empty
    // strings; nextStep() enforces presence only when the corresponding
    // toggle is on, and the disabled fields are hidden in the UI.
    signerDOB: z.string().optional().default(''),
    signerPhone: z.string().optional(),
    idType: z.enum(['driver_license', 'passport', 'state_id', 'military_id', 'other']),
    idNumber: z.string().optional().default(''),
    idIssuingState: z.string().optional(),
    idExpirationDate: z.string().optional().default(''),
    documentType: z.string().min(1, 'Document type is required'),
    documentDate: z.string().optional(),
    notarizationDate: z.string().optional().default(''),
    notarizationTime: z.string().optional().default(''),
    documentDescription: z.string().optional(),
    notarialActType: z.enum(['acknowledgment', 'jurat', 'copy_certification', 'signature_witnessing', 'other']),
    feeType: z.enum(FEE_TYPES),
    stampCount: z.coerce.number().min(1).default(1),
    additionalFee: z.coerce.number().min(0).default(0),
    feeCharged: z.coerce.number().min(0),
    feeWaived: z.boolean().default(false),
    locationCity: z.string().min(1, 'Location city is required'),
    locationState: z.string().min(2, 'Location state is required'),
    locationAddress: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.idType !== 'passport') {
      if (!data.signerAddress)
        ctx.addIssue({ path: ['signerAddress'], code: 'custom', message: 'Address is required' });
      if (!data.signerCity)
        ctx.addIssue({ path: ['signerCity'], code: 'custom', message: 'City is required' });
      if (!data.signerState || data.signerState.length < 2)
        ctx.addIssue({ path: ['signerState'], code: 'custom', message: 'State is required' });
    }
  });

type EntryFormValues = z.infer<typeof entrySchema>;

// sessionStorage key for the half-filled form snapshot we take just before
// reloading to the PIN screen on a locked-DB error. Restored on mount so the
// user doesn't lose what they typed. Excludes ID images / signature blobs so
// the snapshot stays small and no biometric data persists.
const DRAFT_KEY = 'notary-journal:newEntryDraft';

// sessionStorage key for multi-signer prefill. When a notary completes an
// entry and clicks "Add Another Signer", the document/location fields from
// the just-saved entry are stashed here so the next new-entry page can
// pre-populate them. Consumed once on mount, then removed.
const MULTI_SIGNER_KEY = 'notary-journal:multiSignerPrefill';

/** Fresh signer/ID fields when starting another signer on the same document. */
const EMPTY_SIGNER_WIZARD_DEFAULTS: EntryFormValues = {
  signerFullName: '',
  signerAddress: '',
  signerCity: '',
  signerState: '',
  signerDOB: '',
  signerPhone: '',
  idType: 'driver_license',
  idNumber: '',
  idIssuingState: '',
  idExpirationDate: '',
  documentType: '',
  documentDate: new Date().toISOString().split('T')[0],
  notarizationDate: getDefaultNotarizationDate(),
  notarizationTime: getDefaultNotarizationTime(),
  notarialActType: 'acknowledgment',
  feeType: 'Acknowledgment',
  stampCount: 1,
  additionalFee: 0,
  feeCharged: 0,
  feeWaived: false,
  locationCity: '',
  locationState: '',
  notes: '',
};

function applyMultiSignerDocumentPrefill(
  form: ReturnType<typeof useForm<EntryFormValues>>,
  prefill: Record<string, unknown>,
  isFeeAppDerivedRef: MutableRefObject<boolean>,
) {
  if (prefill.documentType) form.setValue('documentType', prefill.documentType as string);
  if (prefill.documentDate) form.setValue('documentDate', prefill.documentDate as string);
  if (prefill.documentDescription) form.setValue('documentDescription', prefill.documentDescription as string);
  if (prefill.notarialActType) form.setValue('notarialActType', prefill.notarialActType as JournalEntry['notarialActType']);
  if (prefill.feeType) form.setValue('feeType', prefill.feeType as string);
  if (prefill.feeCharged !== undefined) {
    form.setValue('feeCharged', (prefill.feeCharged as number) / 100);
    isFeeAppDerivedRef.current = false;
  }
  if (prefill.additionalFee !== undefined) form.setValue('additionalFee', prefill.additionalFee as number);
  if (prefill.feeWaived !== undefined) form.setValue('feeWaived', prefill.feeWaived as boolean);
  if (prefill.locationCity) form.setValue('locationCity', prefill.locationCity as string);
  if (prefill.locationState) form.setValue('locationState', prefill.locationState as string);
  if (prefill.locationAddress) form.setValue('locationAddress', prefill.locationAddress as string);
  if (prefill.notarizationDateTime) {
    const { date, time } = splitNotarizationDateTime(prefill.notarizationDateTime as string);
    form.setValue('notarizationDate', date);
    form.setValue('notarizationTime', time);
  }
}

const STEPS = ['Scan ID', 'Signer', 'Notarial Act', 'Signature', 'Review'];

/** Review step index — skip Signature (3) when journal signature is waived. */
function reviewStepIndex(settings: NotarySettings | null | undefined): number {
  return shouldRequireSignature(settings ?? undefined) ? 4 : 3;
}

type ScanResult =
  | { method: 'barcode'; success: true }
  | { method: 'ocr'; text: string; confidence: number }
  | { method: 'mrz'; text: string; confidence: number; passport: MrzPassport };


/**
 * Short, mobile-friendly label for an ID type. Used in narrow review cells
 * where the full "Driver's License" string overflows the column.
 */
function shortIdType(idType: string): string {
  switch (idType) {
    case 'driver_license': return 'DL';
    case 'state_id':       return 'State ID';
    case 'passport':       return 'Passport';
    case 'military_id':    return 'Military ID';
    default:               return idType.replace('_', ' ');
  }
}

function cameraErrorMessage(err: unknown): string {
  const e = err as { name?: string; message?: string } | null | undefined;
  const name = e?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was blocked. Open your browser settings for this site and allow Camera, then try again. Tip: tap the lock icon in the address bar.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device, or the rear camera is unavailable. Try the "Upload Image" button — it can use your phone\'s camera too.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Another app or tab is already using the camera. Close it (or reboot the browser) and try again.';
  }
  if (name === 'SecurityError') {
    return 'The browser blocked camera access for security reasons. Make sure the page is loaded over HTTPS.';
  }
  return e?.message || 'Could not open the camera. Try the "Upload Image" button instead — it can use your phone\'s camera.';
}

export function NewEntry() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [currentStep, setCurrentStep] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  // scanMode: 'idle' = show buttons | 'barcode-live' = live ZXing scan | 'photo-capture' = manual photo + OCR
  const [scanMode, setScanMode] = useState<'idle' | 'barcode-live' | 'photo-capture'>('idle');
  const [liveScanSuccess, setLiveScanSuccess] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [idFrontImage, setIdFrontImage] = useState<string | undefined>();
  const [idBackImage, setIdBackImage] = useState<string | undefined>();
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [signatureImage, setSignatureImage] = useState<string | undefined>();
  const [needsReview, setNeedsReview] = useState(false);
  // Populated when MRZ parses but one or more check digits fail. The Signer
  // step shows a warning banner so the notary verifies the affected fields
  // before saving.
  const [mrzWarning, setMrzWarning] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationDetected, setLocationDetected] = useState(false);
  const locationAutoTried = useRef(false);
  // After completing an entry, offer to add another signer on the same document.
  const [lastCompletedId, setLastCompletedId] = useState<number | null>(null);
  const [lastCompletedCount, setLastCompletedCount] = useState(1);
  /** When on, comma-separated document types create one journal line per document. */
  const [multiDocumentSplit, setMultiDocumentSplit] = useState(true);
  const [customActPerDocument, setCustomActPerDocument] = useState(false);
  const [perDocumentActTypes, setPerDocumentActTypes] = useState<JournalEntry['notarialActType'][]>([]);
  /** Single signer entry vs multi-signer signing appointment (same + button). */
  const [wizardMode, setWizardMode] = useState<'single' | 'appointment'>('single');

  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const photoVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const signaturePadRef = useRef<SignaturePad | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);

  const form = useForm<EntryFormValues>({
    resolver: zodResolver(entrySchema),
    defaultValues: {
      signerFullName: '',
      signerAddress: '',
      signerCity: '',
      signerState: '',
      signerDOB: '',
      signerPhone: '',
      idType: 'driver_license',
      idNumber: '',
      idIssuingState: '',
      idExpirationDate: '',
      documentType: '',
      documentDate: new Date().toISOString().split('T')[0],
      notarizationDate: getDefaultNotarizationDate(),
      notarizationTime: getDefaultNotarizationTime(),
      notarialActType: 'acknowledgment',
      feeType: 'Acknowledgment',
      stampCount: 1,
      additionalFee: 0,
      feeCharged: 0,
      feeWaived: false,
      locationCity: '',
      locationState: '',
      notes: '',
    }
  });

  const [appSettings, setAppSettings] = useState<NotarySettings | null>(null);
  // Tracks whether the current `feeCharged` value was put there by the app
  // (true) or typed by the user (false). While app-derived, picking a new
  // notarial-act/fee-type re-applies the configured default. As soon as the
  // user types into the fee input we stop overwriting their value.
  const isFeeAppDerivedRef = useRef(true);
  const signingGroupIdRef = useRef<string | null>(null);
  const notarizationDateEditedRef = useRef(false);
  const notarizationTimeEditedRef = useRef(false);

  const snapNotarizationDateTimeIfAuto = () => {
    if (!notarizationTimeEditedRef.current) {
      form.setValue('notarizationTime', getDefaultNotarizationTime());
    }
    if (!notarizationDateEditedRef.current) {
      form.setValue('notarizationDate', getDefaultNotarizationDate());
    }
  };
  const signingGroupLabelRef = useRef<string | undefined>(undefined);

  const watchedDocumentType = form.watch('documentType');
  const parsedDocumentTypes = parseDocumentTypesFromInput(watchedDocumentType ?? '');
  const willSplitDocuments = multiDocumentSplit && parsedDocumentTypes.length > 1;

  const NOTARIAL_ACT_OPTIONS: { value: JournalEntry['notarialActType']; label: string }[] = [
    { value: 'acknowledgment', label: 'Acknowledgment' },
    { value: 'jurat', label: 'Jurat' },
    { value: 'copy_certification', label: 'Copy Certification' },
    { value: 'signature_witnessing', label: 'Signature Witnessing' },
    { value: 'other', label: 'Other' },
  ];

  const resolveActTypeForDocument = (index: number): JournalEntry['notarialActType'] => {
    if (customActPerDocument && perDocumentActTypes[index]) {
      return perDocumentActTypes[index];
    }
    return form.getValues('notarialActType');
  };

  const perActFeeDollars = willSplitDocuments
    ? getStampFeeCents(appSettings ?? undefined) / 100
    : null;

  // Keep per-document act type array in sync when document list changes.
  useEffect(() => {
    const defaultAct = form.getValues('notarialActType');
    setPerDocumentActTypes(prev =>
      parsedDocumentTypes.map((_, i) => prev[i] ?? defaultAct),
    );
  }, [parsedDocumentTypes.join('|'), form]);

  // Multi-document: stamp count = number of acts; total fee = per-stamp × count + additional.
  useEffect(() => {
    if (!appSettings || !willSplitDocuments) return;
    if (!isFeeAppDerivedRef.current || form.getValues('feeWaived')) return;
    const count = parsedDocumentTypes.length;
    form.setValue('stampCount', count);
    const stampCents = computeStampFeeCents(count, appSettings);
    const addFee = Number(form.getValues('additionalFee')) || 0;
    form.setValue('feeCharged', stampCents / 100 + addFee);
  }, [willSplitDocuments, parsedDocumentTypes.length, appSettings, form]);

  // Auto-enable split mode when the notary lists multiple documents with commas.
  useEffect(() => {
    if (parseDocumentTypesFromInput(form.getValues('documentType')).length > 1) {
      setMultiDocumentSplit(true);
    }
  }, [watchedDocumentType, form]);

  // Load defaults (skipped when ?multiSigner= — handled by dedicated effect below)
  useEffect(() => {
    getSettings().then(settings => {
      setAppSettings(settings);
      setMultiDocumentSplit(shouldDefaultSplitDocuments(settings));
      if (new URLSearchParams(window.location.search).has('multiSigner')) {
        return;
      }
      form.setValue('locationCity', settings.defaultCity);
      form.setValue('locationState', settings.defaultState);
      // Prefill the initial fee from the default for "Acknowledgment" if any.
      const stampCents = computeStampFeeCents(1, settings);
      form.setValue('feeCharged', stampCents > 0 ? stampCents / 100 : 0);
      isFeeAppDerivedRef.current = true;

      // Restore a draft saved just before a lock-induced reload, if any.
      // Done after defaults so the user's typed values win over the
      // settings-derived prefills. Restoration is one-shot — we drop the
      // snapshot the moment we apply it so a later cancel/refresh starts
      // clean. Image/signature blobs were intentionally excluded from the
      // snapshot, so they remain empty here (the user re-scans).
      try {
        const raw = sessionStorage.getItem(DRAFT_KEY);
        if (raw) {
          sessionStorage.removeItem(DRAFT_KEY);
          const draft = JSON.parse(raw) as Partial<EntryFormValues>;
          form.reset({ ...form.getValues(), ...draft });
          // The user typed the fee themselves before the lock, so don't let
          // the auto-fee logic overwrite it on the next field change.
          if (draft.feeCharged !== undefined) {
            isFeeAppDerivedRef.current = false;
          }
          toast({
            title: 'Draft restored',
            description: 'Your in-progress entry was recovered.',
          });
        } else {
          // No draft to restore — check for multi-signer prefill.
          // When the user completed an entry and clicked "Add Another Signer",
          // the document/location/fee fields were stashed here. We apply them
          // so only the signer-specific fields need to be filled in.
          try {
            const prefillRaw = sessionStorage.getItem(MULTI_SIGNER_KEY);
            if (prefillRaw) {
              sessionStorage.removeItem(MULTI_SIGNER_KEY);
              const prefill = JSON.parse(prefillRaw);
              applyMultiSignerDocumentPrefill(form, prefill, isFeeAppDerivedRef);
              toast({
                title: 'Multi-signer mode',
                description: 'Document and location fields carried over. Fill in the new signer\'s details.',
              });
            }
          } catch {
            // Corrupt prefill — ignore and start fresh.
          }

          // Also check for intake prefill (from Client Requests → Start Entry)
          try {
            const intake = consumeIntakePrefill();
            if (intake) {
              // Primary signer
              if (intake.signerFirstName) form.setValue('signerFullName', `${intake.signerFirstName} ${intake.signerMiddleName} ${intake.signerLastName}`.trim());
              if (intake.phone) form.setValue('signerPhone', intake.phone);
              if (intake.address) form.setValue('signerAddress', intake.address);
              if (intake.city) form.setValue('signerCity', intake.city);
              if (intake.state) form.setValue('signerState', intake.state);
              if (intake.notes) form.setValue('notes', intake.notes);
              // ID info
              if (intake.idType) form.setValue('idType', intake.idType.toLowerCase().replace(/'/g, '').replace(/ /g, '_') as never);
              if (intake.idNumber) form.setValue('idNumber', intake.idNumber);
              if (intake.idIssuedBy) form.setValue('idIssuingState', intake.idIssuedBy);
              if (intake.idExpirationDate) form.setValue('idExpirationDate', intake.idExpirationDate);
              // ID images
              if (intake.idFrontFiles?.length) setIdFrontImage(intake.idFrontFiles[0]);
              if (intake.idBackFiles?.length) setIdBackImage(intake.idBackFiles[0]);
              // Date
              if (intake.preferredDate) form.setValue('documentDate', intake.preferredDate);
              // Services → notarial act type (use first selected)
              if (intake.servicesPerformed?.length) {
                const first = intake.servicesPerformed[0].toLowerCase().replace(/ /g, '_');
                const actMap: Record<string, JournalEntry['notarialActType']> = {
                  'acknowledgement': 'acknowledgment',
                  'jurat': 'jurat',
                  'copy_certification': 'copy_certification',
                  'signature_witnessing': 'signature_witnessing',
                  'oath': 'other',
                  'other': 'other',
                };
                form.setValue('notarialActType', actMap[first] ?? 'acknowledgment');
              }
              // Payment info → total amount
              if (intake.totalAmount) {
                form.setValue('feeCharged', parseFloat(intake.totalAmount) || 0);
                isFeeAppDerivedRef.current = false;
              }

              toast({
                title: 'Request loaded',
                description: `Pre-filled from ${intake.signerFirstName || 'client'}'s submission.`,
              });
            }
          } catch {
            // Corrupt intake data — ignore
          }

        }
      } catch {
        // Corrupt JSON or unavailable storage — ignore and start fresh.
      }
    });
  }, [form, toast]);

  // Add another signer: remount stays on same route — reset signer/ID state and apply document prefill only
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('multiSigner')) return;

    let prefill: Record<string, unknown> | null = null;
    try {
      const raw = sessionStorage.getItem(MULTI_SIGNER_KEY);
      if (raw) {
        sessionStorage.removeItem(MULTI_SIGNER_KEY);
        prefill = JSON.parse(raw) as Record<string, unknown>;
      }
    } catch {
      prefill = null;
    }

    sessionStorage.removeItem(DRAFT_KEY);
    setCurrentStep(0);
    setIdFrontImage(undefined);
    setIdBackImage(undefined);
    setSignatureImage(undefined);
    setScanResult(null);
    setScanMode('idle');
    setNeedsReview(false);
    setMrzWarning(null);
    setLastCompletedId(null);
    setIsSaving(false);
    form.reset({ ...EMPTY_SIGNER_WIZARD_DEFAULTS });

    getSettings().then(settings => {
      setAppSettings(settings);
      if (prefill) {
        applyMultiSignerDocumentPrefill(form, prefill, isFeeAppDerivedRef);
        if (typeof prefill.signingGroupId === 'string') {
          signingGroupIdRef.current = prefill.signingGroupId;
        }
        if (typeof prefill.signingGroupLabel === 'string') {
          signingGroupLabelRef.current = prefill.signingGroupLabel;
        }
        toast({
          title: 'Multi-signer mode',
          description: "Document and location carried over. Enter the new signer's name, address, and ID.",
        });
      }
    });

    params.delete('multiSigner');
    const qs = params.toString();
    const next = qs ? `/entry/new?${qs}` : '/entry/new';
    window.history.replaceState(null, '', next);
  }, [location, form, toast]);

  // When the user picks a different notarial act or fee category, keep the
  // two in sync and re-apply the saved default whenever the fee is still
  // app-derived. Manual edits (handled in the input's onChange below) flip
  // the ref so we never clobber a deliberate value.
  useEffect(() => {
    const sub = form.watch((value, { name }) => {
      if (!appSettings) return;

      // Helper: recompute total = stamp fee + additional fee
      const recompute = (count?: number, addFee?: number) => {
        if (isFeeAppDerivedRef.current && !value.feeWaived) {
          const c = count ?? Number(value.stampCount) ?? 1;
          const a = addFee ?? Number(value.additionalFee) ?? 0;
          const stampCents = computeStampFeeCents(c, appSettings);
          form.setValue('feeCharged', (stampCents / 100) + a);
        }
      };

      // User picked a different notarial act → mirror its fee category and
      // attempt to auto-fill the dollar amount.
      if (name === 'notarialActType') {
        const act = value.notarialActType as JournalEntry['notarialActType'] | undefined;
        if (!act) return;
        const mappedFeeType = ACT_TYPE_TO_FEE_TYPE[act];
        form.setValue('feeType', mappedFeeType);
        recompute();
      }

      // User picked a different fee category directly.
      if (name === 'feeType') {
        const ft = value.feeType as FeeType | undefined;
        if (!ft) return;
        const next = shouldApplyAutoFee({
          feeType: ft,
          isWaived: !!value.feeWaived,
          isAppDerived: isFeeAppDerivedRef.current,
          settings: appSettings,
        });
        if (next !== null) {
          const addFee = Number(value.additionalFee) || 0;
          form.setValue('feeCharged', (next / 100) + addFee);
        }
      }

      if (name === 'stampCount') {
        recompute(Number(value.stampCount));
      }

      // User changed additional fee (travel, mobile, etc.) → add to total
      if (name === 'additionalFee' && !value.feeWaived) {
        const addFee = Number(value.additionalFee) || 0;
        const count = Number(value.stampCount) || 1;
        const stampCents = computeStampFeeCents(count, appSettings);
        form.setValue('feeCharged', (stampCents / 100) + addFee);
      }

      // Toggling Waive off restores app-derived behaviour for the next change.
      if (name === 'feeWaived' && !value.feeWaived) {
        isFeeAppDerivedRef.current = true;
      }
    });
    return () => sub.unsubscribe();
  }, [form, appSettings]);

  // Init SignaturePad when step 3 becomes active
  useEffect(() => {
    if (currentStep === 3 && shouldRequireSignature(appSettings ?? undefined) && sigCanvasRef.current) {
      // Resize canvas to parent
      const canvas = sigCanvasRef.current;
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }

      signaturePadRef.current = new SignaturePad(canvas, {
        backgroundColor: 'rgb(255, 255, 255)',
        penColor: 'rgb(0, 0, 0)'
      });
    }
  }, [currentStep]);

  // Stop everything when unmounting
  useEffect(() => {
    return () => {
      scannerControlsRef.current?.stop();
      stopPhotoCamera();
    };
  }, []);

  const stopPhotoCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const stopLiveScan = useCallback(() => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    liveStreamRef.current?.getTracks().forEach(t => t.stop());
    liveStreamRef.current = null;
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null;
    }
  }, []);

  // Start live barcode scan: get camera stream ourselves, then decode frames via canvas
  const startLiveScan = async () => {
    setLiveScanSuccess(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Your browser does not expose a camera API. This usually means the page was opened over plain HTTP — try the HTTPS URL.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      liveStreamRef.current = stream;
      setScanMode('barcode-live');
    } catch (err) {
      toast({ title: 'Camera Error', description: cameraErrorMessage(err), variant: 'destructive' });
    }
  };

  // Once barcode-live mode is active and the video element is mounted, attach stream and start frame loop
  useEffect(() => {
    if (scanMode !== 'barcode-live' || !liveVideoRef.current || !liveStreamRef.current) return;

    const videoEl = liveVideoRef.current;
    videoEl.srcObject = liveStreamRef.current;
    videoEl.setAttribute('playsinline', 'true');

    let stopped = false;
    const reader = new BrowserPDF417Reader();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    let lastAttempt = 0;

    const tick = () => {
      if (stopped) return;
      const now = Date.now();
      if (now - lastAttempt >= 400 && videoEl.readyState >= videoEl.HAVE_ENOUGH_DATA && videoEl.videoWidth > 0) {
        lastAttempt = now;
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        try {
          const result = reader.decodeFromCanvas(canvas);
          if (result) {
            stopped = true;
            stopLiveScan();
            const fields = parseAAMVA(result.getText());
            if (Object.keys(fields).length > 0) {
              applyExtractedFields(fields as Record<string, string>);
              setScanResult({ method: 'barcode', success: true });
              setLiveScanSuccess(true);
              hapticSuccess();
              toast({ title: 'Barcode Scanned!', description: 'License data extracted. Review the fields and continue.' });
            } else {
              toast({ title: 'Barcode Read but Empty', description: 'Could not parse license data. Try photo mode.', variant: 'destructive' });
              setScanMode('idle');
            }
            return;
          }
        } catch {
          // NotFoundException is normal while scanning — keep looping
        }
      }
      requestAnimationFrame(tick);
    };

    videoEl.play().then(() => {
      if (!stopped) requestAnimationFrame(tick);
    }).catch(() => {
      if (!stopped) {
        toast({ title: 'Camera Error', description: 'Could not start video. Try Upload Photos instead.', variant: 'destructive' });
        setScanMode('idle');
      }
    });

    return () => {
      stopped = true;
      liveStreamRef.current?.getTracks().forEach(t => t.stop());
      liveStreamRef.current = null;
      if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
    };
  }, [scanMode, stopLiveScan]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Start photo capture mode (manual stream → OCR)
  const startPhotoCapture = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Your browser does not expose a camera API. This usually means the page was opened over plain HTTP — try the HTTPS URL.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanMode('photo-capture');
    } catch (err) {
      toast({ title: 'Camera Error', description: cameraErrorMessage(err), variant: 'destructive' });
    }
  };

  // Attach stream to photo video element after it renders
  useEffect(() => {
    if (scanMode === 'photo-capture' && photoVideoRef.current && streamRef.current) {
      photoVideoRef.current.srcObject = streamRef.current;
    }
  }, [scanMode]);

  const detectLocation = async (quiet = false) => {
    setIsLocating(true);
    const result = await detectDeviceLocation();
    setIsLocating(false);
    if (result.ok) {
      const { city, state, address } = result.location;
      if (city) form.setValue('locationCity', city);
      if (state) form.setValue('locationState', state);
      if (address) form.setValue('locationAddress', address);
      setLocationDetected(true);
      setTimeout(() => setLocationDetected(false), 4000);
      if (!quiet) {
        const parts = [address, city, state].filter(Boolean);
        toast({ title: 'Location detected', description: parts.join(', ') });
      }
    } else if (!quiet) {
      const messages: Record<string, string> = {
        unsupported: 'Your browser does not support location detection.',
        denied: 'Permission denied or GPS unavailable — please enter manually.',
        timeout: 'GPS timed out — try again or enter manually.',
        lookup_failed: 'Could not determine city — please enter manually.',
      };
      toast({ title: 'Location unavailable', description: messages[result.reason], variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (currentStep === 2 && !locationAutoTried.current) {
      locationAutoTried.current = true;
      detectLocation(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  const applyExtractedFields = (
    fields: Record<string, string>,
    mode: 'replace' | 'fillGaps' = 'replace',
  ) => {
    // Compliance toggles can hide the DOB / ID# / expiration fields entirely.
    // When that's the case we MUST also drop them from the parsed scan
    // payload, otherwise a hidden field could still be silently populated and
    // persisted via the spread in saveEntry.
    const recordDOB = shouldRecordSignerDOB(appSettings ?? undefined);
    const recordId = shouldRecordSignerIdNumber(appSettings ?? undefined);
    const FIELD_MAP: Array<[keyof typeof fields, string]> = [
      ['fullName', 'signerFullName'],
      ['address', 'signerAddress'],
      ['city', 'signerCity'],
      ['state', 'signerState'],
      ['dob', 'signerDOB'],
      ['idNumber', 'idNumber'],
      ['idIssuingState', 'idIssuingState'],
      ['expirationDate', 'idExpirationDate'],
    ];
    for (const [from, to] of FIELD_MAP) {
      if (!recordDOB && to === 'signerDOB') continue;
      // Only the full ID# is gated; expiration date is always allowed.
      if (!recordId && to === 'idNumber') continue;
      const v = fields[from as string];
      if (!v) continue;
      if (mode === 'fillGaps' && form.getValues(to as never)) continue;
      form.setValue(to as never, v as never);
    }
  };

  /**
   * Run OCR over an image and return raw text + confidence. Field extraction
   * is delegated to the typed parser modules so we can unit-test the
   * heuristics independently of the camera path.
   */
  const runOcr = async (imageSrc: string): Promise<{ text: string; confidence: number }> => {
    toast({ title: 'Scanning...', description: 'Analyzing ID text via OCR. This may take a moment.' });
    const worker = await createWorker('eng');

    // Tesseract config tuned for driver's license / ID card OCR:
    //   PSM 6   = uniform block of text (good for the dense label/value layout)
    //   Oem 1   = LSTM neural net only (best accuracy, no legacy fallback)
    //   whitelist = uppercase letters, digits, common punctuation (no lowercase noise)
    //   tessedit_preserve_min_wd_len = 1 (don't discard single-letter tokens like "A ST")
    await worker.setParameters({
      tessedit_pageseg_mode: 6 as never,
      ocr_engine_mode: 1 as never,
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:#/-@',
      tessedit_preserve_min_wd_len: 1,
    });

    const { data } = await worker.recognize(imageSrc);
    await worker.terminate();
    return { text: data.text, confidence: data.confidence };
  };

  /**
   * Photo-mode dispatch: passport → MRZ parser, anything else → license OCR.
   * In both cases we set scanResult, mark needsReview when confidence is low,
   * and (for passports) surface a check-digit warning if any fail.
   */
  const processImageOCR = async (
    imageSrc: string,
    applyMode: 'replace' | 'fillGaps' = 'replace',
  ) => {
    setIsScanning(true);
    if (applyMode === 'replace') setMrzWarning(null);
    try {
      const { text, confidence } = await runOcr(imageSrc);
      const isPassport = form.getValues('idType') === 'passport';

      if (isPassport) {
        const mrz = parseMRZ(text);
        if (mrz.ok && mrz.passport) {
          applyExtractedFields(mrzToSignerFields(mrz.passport), applyMode);
          setScanResult({ method: 'mrz', text, confidence, passport: mrz.passport });
          // Compose warnings from check digits AND low OCR confidence so the
          // notary always sees a banner when the data is questionable.
          const lowConfidence = confidence < 70;
          if (!mrz.passport.allCheckDigitsValid || lowConfidence) {
            const failing = Object.entries(mrz.passport.checkDigits)
              .filter(([, ok]) => !ok)
              .map(([name]) => name);
            const parts: string[] = [];
            if (failing.length > 0) {
              parts.push(`MRZ check digit mismatch (${failing.join(', ')})`);
            }
            if (lowConfidence) {
              parts.push(`low OCR confidence (${Math.round(confidence)}%)`);
            }
            setMrzWarning(`${parts.join(' and ')} — please verify before saving.`);
            setNeedsReview(true);
            hapticWarning();
            toast({
              title: 'MRZ Read with Warnings',
              description: parts.join(' / ') + '. Verify the extracted fields.',
              variant: 'destructive',
            });
          } else {
            toast({ title: 'Passport MRZ Read', description: 'Passport data extracted. Review the fields.' });
            hapticSuccess();
          }
        } else {
          toast({
            title: 'MRZ Not Found',
            description: 'Could not locate two MRZ lines on the photo. Try a clearer shot of the back page.',
            variant: 'destructive',
          });
          setScanResult({ method: 'ocr', text, confidence });
        }
      } else {
        const fields = extractLicenseFields(text);
        if (Object.keys(fields).length > 0) {
          applyExtractedFields(fields as Record<string, string>, applyMode);
        }
        if (confidence < 70) {
          setNeedsReview(true);
          hapticWarning();
          toast({
            title: 'Low Confidence Scan',
            description: 'OCR confidence is low. Please verify the extracted fields.',
            variant: 'destructive',
          });
        } else {
          toast({ title: 'Text Extracted', description: 'OCR complete. Review the extracted fields.' });
          hapticSuccess();
        }
        setScanResult({ method: 'ocr', text, confidence });
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Scan Failed', description: 'Could not process the image. Please enter details manually.', variant: 'destructive' });
    }
    setIsScanning(false);
  };

  const handlePhotoCapture = async () => {
    if (!photoVideoRef.current || !canvasRef.current) return;
    const video = photoVideoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const fullResUrl = canvas.toDataURL('image/jpeg');
    const compressedUrl = await compressImageToDataUrl(fullResUrl, 800, 0.7);
    const isPassport = form.getValues('idType') === 'passport';

    if (isPassport) {
      // Passports only need one photo of the data page; the MRZ lives at
      // the bottom of that single page.
      processImageOCR(fullResUrl);
      setIdFrontImage(compressedUrl);
      stopPhotoCamera();
      setScanMode('idle');
      return;
    }

    if (!idFrontImage) {
      // OCR the FRONT at full resolution, then store compressed.
      processImageOCR(fullResUrl, 'replace');
      setIdFrontImage(compressedUrl);
      toast({ title: 'Front captured', description: 'Optionally capture the BACK to fill any missing fields.' });
    } else {
      // BACK image is processed in 'fillGaps' mode so a confident front
      // OCR is never overwritten by a noisier back scan.
      processImageOCR(fullResUrl, 'fillGaps');
      setIdBackImage(compressedUrl);
      stopPhotoCamera();
      setScanMode('idle');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, isBack: boolean) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const fullResUrl = event.target?.result as string;
        const compressedUrl = await compressImageToDataUrl(fullResUrl, 800, 0.7);
        // Passports are a single-page document; any upload — first or
        // replacement — should be processed as the authoritative scan in
        // 'replace' mode rather than the license front/back heuristic.
        const isPassport = form.getValues('idType') === 'passport';
        if (isPassport) {
          processImageOCR(fullResUrl, 'replace');
          setIdFrontImage(compressedUrl);
          setIdBackImage(undefined);
          return;
        }
        // OCR at full resolution, store compressed.
        if (isBack) {
          processImageOCR(fullResUrl, 'fillGaps');
          setIdBackImage(compressedUrl);
        } else {
          processImageOCR(fullResUrl, 'replace');
          setIdFrontImage(compressedUrl);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const clearSignature = () => {
    if (signaturePadRef.current) {
      signaturePadRef.current.clear();
      setSignatureImage(undefined);
    }
  };

  const confirmSignature = () => {
    if (signaturePadRef.current && !signaturePadRef.current.isEmpty()) {
      snapNotarizationDateTimeIfAuto();
      setSignatureImage(signaturePadRef.current.toDataURL('image/png'));
      setCurrentStep(4);
    } else {
      toast({ title: 'Missing Signature', description: 'Please have the signer sign the pad.', variant: 'destructive' });
    }
  };

  const nextStep = async () => {
    // Validate step before advancing
    if (currentStep === 1) {
      const fieldsToCheck = getSignerStepFieldsToCheck({ idType: form.getValues('idType') });
      form.clearErrors(['signerDOB', 'idNumber', 'idExpirationDate']);
      const isValid = await form.trigger(fieldsToCheck);
      if (!isValid) return;
    }
    if (currentStep === 2) {
      const isValid = await form.trigger(['documentType', 'notarialActType', 'locationCity', 'locationState', 'feeCharged']);
      if (!isValid) return;
    }
    // Skip signature step (3) when the notary has disabled it
    if (currentStep === 2 && !shouldRequireSignature(appSettings ?? undefined)) {
      setCurrentStep(reviewStepIndex(appSettings));
    } else {
      setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
    }
  };

  const saveEntry = async (status: 'draft' | 'completed') => {
    setIsSaving(true);
    try {
      const data = form.getValues();
      if (status === 'completed') {
        const missingFields = getMissingCompletionFields(
          { ...data, idFrontImage },
          appSettings,
        );
        if (missingFields.length > 0) {
          const signerStepFields = new Set([
            'Signer full name',
            'Address',
            'City',
            'State',
            'Date of birth',
            'ID expiration date',
            'ID number',
            'ID front photo',
          ]);
          const needsScan = missingFields.includes('ID front photo');
          setCurrentStep(
            needsScan ? 0 : missingFields.some(field => signerStepFields.has(field)) ? 1 : 2,
          );
          toast({
            title: 'Required fields missing',
            description: `Fill in ${missingFields.join(', ')} before completing the entry.`,
            variant: 'destructive',
          });
          hapticWarning();
          setIsSaving(false);
          return;
        }
      }

      // Coerce fee to a finite cents integer. An empty/NaN field becomes 0.
      const feeCents = feeDollarsToCents(data.feeCharged);

      // Defense in depth: we already hide DOB / ID# / expiration in the UI
      // when their toggles are off and we scrub them in applyExtractedFields,
      // but a stale value could still be in form state if the notary toggled
      // a setting mid-flow. Scrub once more right before persistence.
      const recordDOB = shouldRecordSignerDOB(appSettings ?? undefined);
      const recordId = shouldRecordSignerIdNumber(appSettings ?? undefined);
      const scrubbed = { ...data };
      if (!recordDOB) scrubbed.signerDOB = '';
      // Only the full ID# is gated; expiration is always recorded.
      if (!recordId) scrubbed.idNumber = '';

      const notarizationIso = status === 'completed'
        ? resolveNotarizationDateTimeAtComplete(
            scrubbed.notarizationDate,
            scrubbed.notarizationTime,
            {
              dateManuallyEdited: notarizationDateEditedRef.current,
              timeManuallyEdited: notarizationTimeEditedRef.current,
            },
          )
        : resolveNotarizationDateTimeAtComplete(
            scrubbed.notarizationDate,
            scrubbed.notarizationTime,
            { dateManuallyEdited: true, timeManuallyEdited: true },
          );
      const { notarizationDate: _nd, notarizationTime: _nt, ...entryFormFields } = scrubbed;

      const docTypes = parseDocumentTypesFromInput(entryFormFields.documentType);
      const splitIntoSession = status === 'completed' && multiDocumentSplit && docTypes.length > 1;

      if (splitIntoSession) {
        const groupId = signingGroupIdRef.current ?? generateSigningGroupId();
        signingGroupIdRef.current = groupId;
        const perActFeeCents = entryFormFields.feeWaived
          ? 0
          : getStampFeeCents(appSettings ?? undefined, entryFormFields.locationState);

        const shared = {
          signerFullName: entryFormFields.signerFullName,
          signerAddress: entryFormFields.signerAddress ?? '',
          signerCity: entryFormFields.signerCity ?? '',
          signerState: entryFormFields.signerState ?? '',
          signerDOB: entryFormFields.signerDOB,
          signerPhone: entryFormFields.signerPhone,
          idType: entryFormFields.idType,
          idNumber: entryFormFields.idNumber,
          idIssuingState: entryFormFields.idIssuingState,
          idExpirationDate: entryFormFields.idExpirationDate,
          idFrontImage,
          idBackImage,
          signatureImage: shouldRequireSignature(appSettings ?? undefined) ? signatureImage : undefined,
          locationCity: entryFormFields.locationCity,
          locationState: entryFormFields.locationState,
          locationAddress: entryFormFields.locationAddress,
          completedAt: notarizationIso,
          notes: entryFormFields.notes,
          needsReview,
          extractedRawText: scanResult?.method === 'mrz' || scanResult?.method === 'ocr' ? scanResult.text : undefined,
          extractionMethod:
            scanResult?.method === 'barcode' ? 'barcode' as const
            : scanResult?.method === 'mrz' ? 'mrz' as const
            : scanResult?.method === 'ocr' ? 'ocr' as const
            : undefined,
          extractionConfidence: scanResult?.confidence,
        };

        const ids = await createAndCompleteSigningSession({
          signingGroupId: groupId,
          signingGroupLabel: entryFormFields.signerFullName?.trim() || undefined,
          shared,
          acts: docTypes.map((doc, i) => {
            const actType = resolveActTypeForDocument(i);
            return {
              documentType: doc,
              documentDescription: entryFormFields.documentDescription,
              documentDate: entryFormFields.documentDate,
              notarialActType: actType,
              feeType: ACT_TYPE_TO_FEE_TYPE[actType],
              feeChargedCents: perActFeeCents,
              stampCount: 1,
              feeWaived: entryFormFields.feeWaived,
            };
          }),
        });

        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {
          // ignore
        }

        toast({
          title: 'Success',
          description: `${ids.length} journal entries saved.`,
        });
        hapticSuccess();

        (async () => {
          try {
            const settings = await getSettings();
            const shouldBackup = settings.backupFrequency === 'after-entry' || settings.backupFrequency === 'daily';
            if (shouldBackup && getStoredToken()) {
              const allEntries = await getAllEntries();
              await backupToDrive(allEntries, settings);
            }
          } catch {
            // Silent failure for auto-backup
          }
        })();

        setLastCompletedId(ids[0] ?? null);
        setLastCompletedCount(ids.length);
        setIsSaving(false);
        return;
      }

      // Build the entry, omitting optional scan-only fields entirely when
      // they don't apply (don't write `undefined` into the encrypted blob).
      const baseEntry: Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt'> = {
        status,
        ...entryFormFields,
        notarizationDateTime: notarizationIso,
        feeCharged: feeCents,
        stampCount: Math.max(1, Math.round(Number(data.stampCount) || 1)),
        idFrontImage,
        idBackImage,
        signatureImage: shouldRequireSignature(appSettings ?? undefined) ? signatureImage : undefined,
        needsReview,
      };
      if (scanResult?.method === 'barcode') {
        baseEntry.extractionMethod = 'barcode';
      } else if (scanResult?.method === 'mrz') {
        baseEntry.extractionMethod = 'mrz';
        baseEntry.extractedRawText = scanResult.text;
        baseEntry.extractionConfidence = scanResult.confidence;
      } else if (scanResult?.method === 'ocr') {
        baseEntry.extractionMethod = 'ocr';
        baseEntry.extractedRawText = scanResult.text;
        baseEntry.extractionConfidence = scanResult.confidence;
      }
      if (status === 'completed') {
        baseEntry.completedAt = notarizationIso;
      }

      let groupId = signingGroupIdRef.current;
      if (status === 'completed') {
        if (!groupId) {
          groupId = generateSigningGroupId();
          signingGroupIdRef.current = groupId;
        }
        const siblings = await getEntriesBySigningGroup(groupId);
        const d = form.getValues();
        baseEntry.signingGroupId = groupId;
        baseEntry.signingGroupLabel = signingGroupLabelRef.current || d.signerFullName?.trim() || undefined;
        baseEntry.actIndexInGroup = siblings.length + 1;
      }

      const id = await createEntry(baseEntry);

      // Successful save — drop any leftover draft snapshot so a future
      // visit to /new starts from defaults rather than a stale recovery.
      // Best-effort: if sessionStorage is unavailable we don't want a
      // completed save to be reported as a failure.
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }

      // For completed entries, stamp the chain hash linking to the previous completed entry
      if (status === 'completed') {
        await completeEntry(id);
      }

      toast({ title: 'Success', description: `Entry saved as ${status}.` });
      hapticSuccess();

      // Silent auto-backup — runs in background, never blocks redirect
      (async () => {
        try {
          const settings = await getSettings();
          const shouldBackup = settings.backupFrequency === 'after-entry' || settings.backupFrequency === 'daily';
          if (shouldBackup && getStoredToken()) {
            const allEntries = await getAllEntries();
            await backupToDrive(allEntries, settings);
          }
        } catch {
          // Silent failure for auto-backup
        }
      })();

      // Stash document/location/fee fields so "Add Another Signer" on the
      // entry-detail page can pre-fill the next entry. Tiny payload; consumed
      // only if the user clicks the button.
      if (status === 'completed') {
        try {
          const d = form.getValues();
          sessionStorage.setItem(MULTI_SIGNER_KEY, JSON.stringify({
            documentType: d.documentType,
            documentDate: d.documentDate,
            documentDescription: d.documentDescription,
            notarialActType: d.notarialActType,
            feeType: d.feeType,
            feeCharged: feeCents, // store in cents (matches DB)
            additionalFee: d.additionalFee,
            feeWaived: d.feeWaived,
            locationCity: d.locationCity,
            locationState: d.locationState,
            locationAddress: d.locationAddress,
            signingGroupId: signingGroupIdRef.current,
            signingGroupLabel: signingGroupLabelRef.current || d.signerFullName?.trim() || undefined,
          }));
        } catch { /* ignore */ }
      }

      // For completed entries, show the "add another signer" prompt instead
      // of auto-redirecting. For drafts, go straight to the entry.
      if (status === 'completed') {
        setLastCompletedId(id);
        setLastCompletedCount(1);
      } else {
        setLocation(`/entry/${id}`);
      }
      setIsSaving(false);
    } catch (err) {
      console.error('Save entry failed', err);
      const rawMsg = err instanceof Error ? err.message : String(err);

      // Locked database (in-memory crypto key was cleared, e.g. after an
      // HMR reload in dev or a tab reload). Reload so App.tsx re-runs its
      // init effect and routes the user to <PinLock>. We skip the toast
      // because the page navigates immediately and the toast wouldn't be
      // visible — the PIN screen is self-explanatory.
      if (/locked/i.test(rawMsg)) {
        // Snapshot the in-progress form so the user doesn't lose what they
        // typed when App.tsx routes them to <PinLock> after the reload.
        // Image/signature blobs are intentionally excluded — they'd bloat
        // sessionStorage and we don't want biometric data lingering there.
        try {
          const snapshot = form.getValues();
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot));
        } catch {
          // Storage quota or serialization error — proceed with reload
          // anyway; losing the draft is no worse than the prior behavior.
        }
        window.location.reload();
        return;
      }

      toast({
        title: 'Failed to save entry',
        description: rawMsg || 'Unknown error',
        variant: 'destructive',
      });
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto h-full flex flex-col pb-24 md:pb-8">
      {wizardMode === 'appointment' ? (
        <SigningAppointmentWizard onBack={() => setWizardMode('single')} />
      ) : (
      <>
      {/* Mode toggle — same + flow */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="default" size="sm" disabled>Single signer</Button>
        <Button variant="outline" size="sm" onClick={() => setWizardMode('appointment')} data-testid="btn-appointment-mode">
          Signing appointment (multiple signers)
        </Button>
      </div>
      {/* Progress Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-6 tracking-tight">New Journal Entry</h1>
        <div className="flex items-center justify-between relative">
          <div className="absolute left-0 top-1/2 w-full h-1 bg-muted -z-10 -translate-y-1/2 rounded-full"></div>
          <div className="absolute left-0 top-1/2 h-1 bg-primary -z-10 -translate-y-1/2 rounded-full transition-all duration-300" style={{ width: `${(currentStep / (STEPS.length - 1)) * 100}%` }}></div>
          
          {STEPS.map((step, i) => (
            <div key={step} className="flex flex-col items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm transition-colors ${
                i < currentStep ? 'bg-primary text-primary-foreground' : 
                i === currentStep ? 'bg-primary ring-4 ring-primary/20 text-primary-foreground' : 
                'bg-card border-2 border-muted-foreground/30 text-muted-foreground'
              }`}>
                {i < currentStep ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-xs font-medium hidden md:block ${i <= currentStep ? 'text-foreground' : 'text-muted-foreground'}`}>
                {step}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* STEP 0: ID SCAN */}
        {currentStep === 0 && (
          <div className="flex-1 flex flex-col space-y-4">

            {/* Document-type segmented control. The selection drives the
                scanner (PDF417 vs MRZ) and the helper text below, and is
                kept in sync with the idType form value used on the Signer
                step. */}
            {scanMode === 'idle' && !liveScanSuccess && (() => {
              const currentIdType = form.watch('idType');
              const isPassport = currentIdType === 'passport';
              const isStateId = currentIdType === 'state_id';
              const setType = (t: 'driver_license' | 'state_id' | 'passport') => {
                if (form.getValues('idType') === t) return;
                form.setValue('idType', t);
                // Clear stale scan artifacts AND any previously extracted
                // signer/ID fields so PII from the prior document type
                // isn't silently saved against the new one.
                setIdFrontImage(undefined);
                setIdBackImage(undefined);
                setScanResult(null);
                setMrzWarning(null);
                setNeedsReview(false);
                form.setValue('signerFullName', '');
                form.setValue('signerAddress', '');
                form.setValue('signerCity', '');
                form.setValue('signerState', '');
                form.setValue('signerDOB', '');
                form.setValue('idNumber', '');
                form.setValue('idIssuingState', '');
                form.setValue('idExpirationDate', '');
              };
              return (
                <>
                  <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Document type">
                    <Button
                      type="button"
                      variant={!isPassport && !isStateId ? 'default' : 'outline'}
                      onClick={() => setType('driver_license')}
                      className="gap-2"
                      data-testid="doctype-license"
                      aria-pressed={!isPassport && !isStateId}
                    >
                      <IdCard className="w-4 h-4" />
                      <span className="sm:hidden">DL</span>
                      <span className="hidden sm:inline">Driver's License</span>
                    </Button>
                    <Button
                      type="button"
                      variant={isStateId ? 'default' : 'outline'}
                      onClick={() => setType('state_id')}
                      className="gap-2"
                      data-testid="doctype-id"
                      aria-pressed={isStateId}
                    >
                      <IdCard className="w-4 h-4" />
                      <span className="sm:hidden">ID</span>
                      <span className="hidden sm:inline">ID Card</span>
                    </Button>
                    <Button
                      type="button"
                      variant={isPassport ? 'default' : 'outline'}
                      onClick={() => setType('passport')}
                      className="gap-2"
                      data-testid="doctype-passport"
                      aria-pressed={isPassport}
                    >
                      <BookOpen className="w-4 h-4" /> Passport
                    </Button>
                  </div>

                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 text-center">
                    <ScanLine className="w-12 h-12 text-primary mx-auto mb-4" />
                    <h2 className="text-xl font-bold mb-2">
                      {isPassport ? 'Scan Passport' : 'Scan Signer ID'}
                    </h2>
                    <p className="text-muted-foreground max-w-md mx-auto mb-6 text-sm">
                      {isPassport ? (
                        <>
                          Photograph the <strong>full data page</strong> of the passport so the
                          two lines of monospace text at the bottom (the MRZ) are sharp and well-lit.
                        </>
                      ) : (
                        <>
                          Point the camera at the <strong>barcode on the back</strong> of the
                          license for instant fill-in. Use photo mode if the barcode won't read.
                        </>
                      )}
                    </p>
                    <div className="flex flex-col sm:flex-row justify-center gap-3">
                      {!isPassport && (
                        <Button onClick={startLiveScan} className="gap-2" size="lg">
                          <ScanLine className="w-5 h-5" /> Scan Barcode
                        </Button>
                      )}
                      <Button
                        onClick={startPhotoCapture}
                        variant={isPassport ? 'default' : 'outline'}
                        size="lg"
                        className="gap-2"
                      >
                        <Camera className="w-5 h-5" />
                        {isPassport ? 'Take Photo (MRZ)' : 'Take Photos (OCR)'}
                      </Button>
                      <div className="relative">
                        <Button variant="ghost" size="lg" className="gap-2 w-full">
                          <Upload className="w-5 h-5" /> Upload / Camera
                        </Button>
                        {/* `capture="environment"` lets mobile browsers open the
                            native camera app directly — far more reliable than
                            getUserMedia on iOS Safari. Desktop browsers ignore
                            it and fall back to the regular file picker. */}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          onChange={(e) => handleFileUpload(e, !!idFrontImage)}
                        />
                      </div>
                    </div>

                    {/* Skip path: lets the notary advance past the scan step
                        without scanning, so they can fill the entry while
                        talking to the signer and scan the ID later from the
                        entry detail page or the edit page. The "Save as
                        Draft" footer button is still available too, but a
                        clearly-labeled Skip on this step makes the
                        draft-then-scan workflow discoverable. */}
                    <div className="mt-5 pt-4 border-t border-primary/10 text-center">
                      <Button
                        type="button"
                        variant="link"
                        className="text-sm text-muted-foreground hover:text-primary"
                        onClick={() => setCurrentStep(1)}
                        data-testid="button-skip-scan"
                      >
                        Skip — fill manually or scan later
                      </Button>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* ── LIVE BARCODE SCAN MODE ── */}
            {scanMode === 'barcode-live' && !liveScanSuccess && (
              <div className="flex flex-col gap-3">
                <div className="relative rounded-xl overflow-hidden bg-black w-full mx-auto" style={{ aspectRatio: '4/3', maxHeight: '60vh' }}>
                  {/* ZXing manages its own stream on this element */}
                  <video ref={liveVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  {/* Scan window overlay */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="border-2 border-primary rounded-lg w-4/5 h-1/3 relative">
                      <span className="absolute -top-6 left-0 right-0 text-center text-white text-xs font-semibold drop-shadow">
                        Point at barcode on BACK of ID
                      </span>
                      {/* Animated scan line */}
                      <div className="absolute left-0 right-0 h-0.5 bg-primary/80 animate-bounce top-1/2" />
                    </div>
                  </div>
                  {/* Scanning indicator */}
                  <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                    <Loader2 className="w-3 h-3 animate-spin" /> Scanning…
                  </div>
                  {/* Close button */}
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-3 right-3 rounded-full w-9 h-9"
                    onClick={() => { stopLiveScan(); setScanMode('idle'); }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                {/* Fallback to photo mode */}
                <div className="text-center">
                  <p className="text-muted-foreground text-xs mb-2">Barcode not reading?</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => { stopLiveScan(); startPhotoCapture(); }}
                  >
                    <Camera className="w-4 h-4" /> Take Photos Instead (OCR)
                  </Button>
                </div>
              </div>
            )}

            {/* ── BARCODE SUCCESS ── */}
            {liveScanSuccess && (
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl p-6 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400 mx-auto mb-3" />
                <h2 className="text-xl font-bold mb-1 text-green-800 dark:text-green-300">Barcode Scanned!</h2>
                <p className="text-green-700 dark:text-green-400 text-sm mb-4">
                  License data was extracted. Review and correct the fields on the next step.
                </p>
                <div className="flex flex-col items-center gap-3">
                  {/* Capture ID photo — always available, not just when settings require it */}
                  <Button onClick={startPhotoCapture} variant="outline" className="gap-2">
                    <Camera className="w-4 h-4" /> Also Capture ID Photo
                  </Button>
                  {appSettings?.requireIdFrontPhoto && !idFrontImage && (
                    <p className="text-xs text-muted-foreground">
                      ⚠️ Your settings require a front-of-ID photo.
                    </p>
                  )}
                  <div className="flex justify-center gap-3">
                    <Button
                      onClick={() => setCurrentStep(1)}
                      className="gap-2"
                      disabled={!!appSettings?.requireIdFrontPhoto && !idFrontImage}
                    >
                      <Check className="w-4 h-4" /> Review Signer Info
                    </Button>
                    <Button variant="ghost" onClick={() => { setLiveScanSuccess(false); setScanMode('idle'); }} size="sm">
                      Rescan
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ── PHOTO CAPTURE MODE ── */}
            {scanMode === 'photo-capture' && (
              <div className="flex flex-col gap-3">
                <div className="relative rounded-xl overflow-hidden bg-black w-full mx-auto" style={{ aspectRatio: '4/3', maxHeight: '60vh' }}>
                  <video ref={photoVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  <div className="absolute inset-0 border-4 border-primary/40 m-6 rounded-lg pointer-events-none" />
                  <div className="absolute top-3 left-3 bg-black/60 text-white text-xs px-2 py-1 rounded-full font-semibold">
                    {form.getValues('idType') === 'passport'
                      ? 'Capture: PASSPORT data page (MRZ at bottom)'
                      : !idFrontImage
                        ? 'Capture: FRONT of ID'
                        : 'Capture: BACK of ID (for OCR)'}
                  </div>
                  {/* Buttons */}
                  <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
                    <Button
                      variant="destructive"
                      size="icon"
                      className="rounded-full w-11 h-11"
                      onClick={() => { stopPhotoCamera(); setScanMode('idle'); }}
                    >
                      <X className="w-5 h-5" />
                    </Button>
                    <Button size="icon" className="rounded-full w-16 h-16" onClick={handlePhotoCapture} disabled={isScanning} data-testid="button-capture">
                      <Camera className="w-7 h-7" />
                    </Button>
                  </div>
                </div>
                {isScanning && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Running OCR…
                  </div>
                )}
              </div>
            )}

            <canvas ref={canvasRef} className="hidden" />

            {/* Captured photo thumbnails */}
            {(idFrontImage || idBackImage) && (
              <div className="grid grid-cols-2 gap-3">
                {idFrontImage && (
                  <div className="relative rounded-lg overflow-hidden border group">
                    <img
                      src={idFrontImage}
                      alt="ID Front"
                      className="w-full h-28 object-cover cursor-pointer"
                      onClick={() => setExpandedImage(idFrontImage)}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                    <button
                      className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded-full hover:bg-red-600 transition-colors"
                      onClick={(e) => { e.stopPropagation(); setIdFrontImage(undefined); }}
                      aria-label="Delete front ID photo"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 text-center font-medium pointer-events-none">Front</div>
                    <div className="absolute bottom-6 right-1 text-white/80 pointer-events-none">
                      <ZoomIn className="w-3 h-3" />
                    </div>
                  </div>
                )}
                {idBackImage && (
                  <div className="relative rounded-lg overflow-hidden border group">
                    <img
                      src={idBackImage}
                      alt="ID Back"
                      className="w-full h-28 object-cover cursor-pointer"
                      onClick={() => setExpandedImage(idBackImage)}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                    <button
                      className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded-full hover:bg-red-600 transition-colors"
                      onClick={(e) => { e.stopPropagation(); setIdBackImage(undefined); }}
                      aria-label="Delete back ID photo"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 text-center font-medium pointer-events-none">Back</div>
                    <div className="absolute bottom-6 right-1 text-white/80 pointer-events-none">
                      <ZoomIn className="w-3 h-3" />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end mt-auto pt-4">
              <Button variant="ghost" onClick={() => setCurrentStep(1)} className="text-muted-foreground text-sm" data-testid="button-skip-scan">
                Skip — scan ID later <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 1 & 2: FORMS */}
        {(currentStep === 1 || currentStep === 2) && (
          <div className="flex-1 overflow-y-auto pr-2 pb-4">
            {currentStep === 1 && mrzWarning && (
              <Alert className="mb-6 bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900" data-testid="alert-mrz-warning">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                <AlertTitle>
                  {mrzWarning.startsWith('MRZ check digit')
                    ? 'MRZ Check Digit Mismatch'
                    : 'Review Extracted Data'}
                </AlertTitle>
                <AlertDescription>{mrzWarning}</AlertDescription>
              </Alert>
            )}
            {needsReview && currentStep === 1 && !mrzWarning && (
              <Alert className="mb-6 bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                <AlertTitle>Review Extracted Data</AlertTitle>
                <AlertDescription>
                  The ID scan confidence was low. Please verify all extracted fields carefully.
                </AlertDescription>
              </Alert>
            )}

            <Form {...form}>
              <form className="space-y-6">
                <div className={currentStep === 1 ? 'block' : 'hidden'}>
                  <Card>
                    <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={form.control} name="signerFullName" render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Full Name *</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="signerAddress" render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Street Address {form.watch('idType') === 'passport' ? <span className="text-muted-foreground">(optional)</span> : '*'}</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="signerCity" render={({ field }) => (
                        <FormItem>
                          <FormLabel>City {form.watch('idType') === 'passport' ? <span className="text-muted-foreground">(optional)</span> : '*'}</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="signerState" render={({ field }) => (
                        <FormItem>
                          <FormLabel>State {form.watch('idType') === 'passport' ? <span className="text-muted-foreground">(optional)</span> : '*'}</FormLabel>
                          <FormControl><Input {...field} maxLength={2} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      {shouldRecordSignerDOB(appSettings ?? undefined) && (
                        <FormField control={form.control} name="signerDOB" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Date of Birth *</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      )}
                      <FormField control={form.control} name="signerPhone" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number</FormLabel>
                          <FormControl><Input type="tel" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </CardContent>
                  </Card>

                  <h3 className="text-lg font-bold mt-6 mb-4">Identification Used</h3>
                  <Card>
                    <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={form.control} name="idType" render={({ field }) => (
                        <FormItem>
                          <FormLabel>ID Type *</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Select ID type" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="driver_license">Driver's License</SelectItem>
                              <SelectItem value="state_id">State ID</SelectItem>
                              <SelectItem value="passport">Passport</SelectItem>
                              <SelectItem value="military_id">Military ID</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      {shouldRecordSignerIdNumber(appSettings ?? undefined) && (
                        <FormField control={form.control} name="idNumber" render={({ field }) => (
                          <FormItem>
                            <FormLabel>ID Number *</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      )}
                      <FormField control={form.control} name="idIssuingState" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Issuing State/Authority</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      {/* Expiration date is always shown — not gated by the
                          ID-number toggle. */}
                      {true && (
                        <FormField control={form.control} name="idExpirationDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel>ID Expiration Date *</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className={currentStep === 2 ? 'block' : 'hidden'}>
                  <Card>
                    <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={form.control} name="notarialActType" render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Notarial Act Type *</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Select act type" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="acknowledgment">Acknowledgment</SelectItem>
                              <SelectItem value="jurat">Jurat</SelectItem>
                              <SelectItem value="copy_certification">Copy Certification</SelectItem>
                              <SelectItem value="signature_witnessing">Signature Witnessing</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="documentType" render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Document Type *</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. Warranty Deed — or Deed, Affidavit, Will for multiple"
                              {...field}
                              onChange={(e) => {
                                field.onChange(e);
                                if (parseDocumentTypesFromInput(e.target.value).length > 1) {
                                  setMultiDocumentSplit(true);
                                }
                              }}
                            />
                          </FormControl>
                          <FormDescription className="text-xs">
                            Separate multiple documents with commas — each gets its own journal line when you complete.
                          </FormDescription>
                          {parsedDocumentTypes.length > 1 && (
                            <div className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-2">
                              <p className="font-medium text-foreground">
                                {parsedDocumentTypes.length} journal lines on complete:
                              </p>
                              <ul className="space-y-2">
                                {parsedDocumentTypes.map((doc, i) => (
                                  <li key={`${doc}-${i}`} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                    <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                                    <span className="font-medium text-foreground flex-1">{doc}</span>
                                    {customActPerDocument && (
                                      <Select
                                        value={perDocumentActTypes[i] ?? form.getValues('notarialActType')}
                                        onValueChange={(v) => {
                                          setPerDocumentActTypes(prev => {
                                            const next = [...prev];
                                            next[i] = v as JournalEntry['notarialActType'];
                                            return next;
                                          });
                                        }}
                                      >
                                        <SelectTrigger className="h-8 text-xs w-full sm:w-[10rem]">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {NOTARIAL_ACT_OPTIONS.map(opt => (
                                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    )}
                                  </li>
                                ))}
                              </ul>
                              <div className="flex items-start gap-2 pt-1">
                                <Checkbox
                                  id="custom-act-per-document"
                                  checked={customActPerDocument}
                                  onCheckedChange={(checked) => setCustomActPerDocument(checked === true)}
                                  data-testid="checkbox-custom-act-per-document"
                                />
                                <label htmlFor="custom-act-per-document" className="text-xs leading-snug text-muted-foreground cursor-pointer">
                                  Different act type per document (e.g. some acknowledgments, some jurats)
                                </label>
                              </div>
                              {perActFeeDollars !== null && !form.watch('feeWaived') && (
                                <p className="text-muted-foreground">
                                  ${perActFeeDollars.toFixed(2)} per act × {parsedDocumentTypes.length} ={' '}
                                  <span className="font-medium text-foreground">
                                    ${(perActFeeDollars * parsedDocumentTypes.length).toFixed(2)}
                                  </span>
                                  {(Number(form.watch('additionalFee')) || 0) > 0 && (
                                    <> + ${Number(form.watch('additionalFee')).toFixed(2)} additional</>
                                  )}
                                </p>
                              )}
                            </div>
                          )}
                          <div className="flex items-start gap-2 mt-2">
                            <Checkbox
                              id="multi-document-split"
                              checked={multiDocumentSplit}
                              onCheckedChange={(checked) => setMultiDocumentSplit(checked === true)}
                              data-testid="checkbox-multi-document-split"
                            />
                            <label htmlFor="multi-document-split" className="text-xs leading-snug text-muted-foreground cursor-pointer">
                              One journal line per document (turn off to keep everything on a single line)
                            </label>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="documentDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Document Date</FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="md:col-span-2 grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="notarizationDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Notarization Date</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                {...field}
                                data-testid="input-notarization-date"
                                onChange={e => {
                                  notarizationDateEditedRef.current = true;
                                  field.onChange(e);
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="notarizationTime" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Notarization Time</FormLabel>
                            <FormControl>
                              <NotarizationTimeInput
                                value={field.value || getDefaultNotarizationTime()}
                                onChange={v => {
                                  notarizationTimeEditedRef.current = true;
                                  field.onChange(v);
                                }}
                                data-testid="input-notarization-time"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <p className="md:col-span-2 text-xs text-muted-foreground -mt-2">
                        When you performed the notarial act — shown on your printed journal. Use 12-hour time (AM/PM). Leave as-is to use the time when you sign or complete.
                      </p>
                      
                      <div className="md:col-span-2 border-y py-4 my-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">Notarization Location *</span>
                          {locationDetected ? (
                            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                              <Check className="w-3 h-3" /> Detected
                            </span>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-2 text-xs"
                              onClick={() => detectLocation(false)}
                              disabled={isLocating}
                            >
                              {isLocating
                                ? <><Loader2 className="w-3 h-3 animate-spin" /> Detecting…</>
                                : <><MapPin className="w-3 h-3" /> Use My Location</>
                              }
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">Auto-detects on this step, or tap to refresh. Fills street address when GPS is precise enough.</p>
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="locationCity" render={({ field }) => (
                            <FormItem>
                              <FormLabel>City</FormLabel>
                              <FormControl><Input {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="locationState" render={({ field }) => (
                            <FormItem>
                              <FormLabel>State</FormLabel>
                              <FormControl><Input {...field} maxLength={2} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                      </div>

                      <FormField control={form.control} name="feeType" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fee Type *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-fee-type"><SelectValue /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {FEE_TYPES.map(ft => (
                                <SelectItem key={ft} value={ft}>{ft}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs">For year-end report breakdowns.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <div className="space-y-3 md:col-span-2">
                        {/* Stamp count — auto-set when splitting multiple documents */}
                        {!willSplitDocuments && (
                        <FormField control={form.control} name="stampCount" render={({ field }) => (
                          <FormItem>
                            <FormLabel># of Stamps (Notarial Acts)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={1}
                                step={1}
                                {...field}
                                data-testid="input-stamp-count"
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Each notarial act requires one stamp. The per-stamp rate is set in Settings.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />
                        )}

                        {/* Additional fees — travel, mobile, etc. */}
                        <FormField control={form.control} name="additionalFee" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Additional Fees ($) — travel, mobile, etc.</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                {...field}
                                disabled={form.watch('feeWaived')}
                                onChange={(e) => {
                                  isFeeAppDerivedRef.current = false;
                                  field.onChange(e);
                                }}
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Any extra charges beyond the per-stamp notarial fee.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />

                        {/* Total fee — auto-computed, manual override possible */}
                        <FormField control={form.control} name="feeCharged" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Total Fee Charged ($)</FormLabel>
                            <div className="flex gap-2">
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  {...field}
                                  disabled={form.watch('feeWaived')}
                                  value={form.watch('feeWaived') ? 0 : field.value}
                                  data-testid="input-fee-charged"
                                  className="font-bold text-base"
                                  onChange={(e) => {
                                    // Manual override — stop auto-filling
                                    isFeeAppDerivedRef.current = false;
                                    field.onChange(e);
                                  }}
                                />
                              </FormControl>
                              <Button
                                type="button"
                                variant={form.watch('feeWaived') ? 'default' : 'outline'}
                                onClick={() => {
                                const isWaived = !form.getValues('feeWaived');
                                form.setValue('feeWaived', isWaived);
                                if (isWaived) {
                                  form.setValue('feeCharged', 0);
                                } else {
                                  // Reset to app-derived AND immediately
                                  // restore the configured default for the
                                  // currently-selected fee type so the user
                                  // doesn't have to re-pick to see it.
                                  isFeeAppDerivedRef.current = true;
                                  const ft = form.getValues('feeType') as FeeType | undefined;
                                  const next = ft
                                    ? shouldApplyAutoFee({
                                        feeType: ft,
                                        isWaived: false,
                                        isAppDerived: true,
                                        settings: appSettings,
                                      })
                                    : null;
                                  if (next !== null) form.setValue('feeCharged', next / 100);
                                }
                              }}
                            >
                              Waive Fee
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )} />
                      </div>

                      <FormField control={form.control} name="notes" render={({ field }) => (
                        <FormItem className="md:col-span-2 mt-2">
                          <FormLabel>Additional Notes</FormLabel>
                          <FormControl><Textarea placeholder="Any other details..." className="h-20" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </CardContent>
                  </Card>
                </div>
              </form>
            </Form>
          </div>
        )}

        {/* STEP 3: SIGNATURE */}
        {currentStep === 3 && shouldRequireSignature(appSettings ?? undefined) && (
          <div className="flex-1 flex flex-col h-full space-y-4">
            <div className="bg-muted/30 p-4 rounded-lg border text-center">
              <h3 className="font-semibold text-lg">Signer Signature Required</h3>
              <p className="text-sm text-muted-foreground mt-1">Please have {form.getValues('signerFullName') || 'the signer'} sign inside the box below.</p>
            </div>
            
            <div className="flex-1 relative border-2 border-primary/30 border-dashed rounded-xl bg-white overflow-hidden min-h-[300px]">
              <canvas ref={sigCanvasRef} className="w-full h-full cursor-crosshair touch-none bg-white"></canvas>
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
                <span className="text-6xl font-serif text-black font-bold tracking-widest rotate-[-10deg]">SIGN HERE</span>
              </div>
              <div className="absolute bottom-4 right-4 z-10 flex gap-2">
                <Button variant="secondary" size="sm" onClick={clearSignature} className="shadow-md">
                  <Eraser className="w-4 h-4 mr-2" /> Clear
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: REVIEW */}
        {currentStep === reviewStepIndex(appSettings) && (
          <div className="flex-1 overflow-y-auto pr-2 space-y-6 pb-6">
            <Alert className="bg-primary/10 border-primary/20">
              <Check className="h-4 w-4 text-primary" />
              <AlertTitle>Review Entry</AlertTitle>
              <AlertDescription>
                Please review all details before completing the entry. A completed entry cannot be changed, only amended.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="py-3 bg-muted/50 border-b">
                  <CardTitle className="text-sm font-medium">Signer Information</CardTitle>
                </CardHeader>
                <CardContent className="py-4 text-sm space-y-2">
                  <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Name:</span> <span className="col-span-2 min-w-0 font-medium break-words">{form.getValues('signerFullName')}</span></div>
                  <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Address:</span> <span className="col-span-2 min-w-0 break-words">{form.getValues('signerAddress')}, {form.getValues('signerCity')}, {form.getValues('signerState')}</span></div>
                  {shouldRecordSignerDOB(appSettings ?? undefined) && (
                    <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">DOB:</span> <span className="col-span-2 min-w-0 break-words">{form.getValues('signerDOB')}</span></div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 bg-muted/50 border-b">
                  <CardTitle className="text-sm font-medium">Identification</CardTitle>
                </CardHeader>
                <CardContent className="py-4 text-sm space-y-2">
                  <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Type:</span> <span className="col-span-2 min-w-0 capitalize break-words">{shortIdType(form.getValues('idType'))}</span></div>
                  {shouldRecordSignerIdNumber(appSettings ?? undefined) && (
                    <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Number:</span> <span className="col-span-2 min-w-0 break-words">{form.getValues('idNumber')}</span></div>
                  )}
                  {/* Expiration always shown — not toggle-gated. */}
                  <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Expires:</span> <span className="col-span-2 min-w-0 break-words">{form.getValues('idExpirationDate')}</span></div>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader className="py-3 bg-muted/50 border-b">
                  <CardTitle className="text-sm font-medium">
                    {willSplitDocuments ? `Notarial Acts (${parsedDocumentTypes.length})` : 'Notarial Act'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-4 text-sm space-y-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {willSplitDocuments ? (
                    <>
                      <div className="md:col-span-2">
                        <div className="grid grid-cols-3 gap-1 mb-2">
                          <span className="text-muted-foreground">Acts:</span>
                          <span className="col-span-2">
                            <ul className="space-y-1">
                              {parsedDocumentTypes.map((doc, i) => {
                                const act = resolveActTypeForDocument(i);
                                return (
                                  <li key={`${doc}-${i}`} className="text-sm">
                                    <span className="font-medium">{doc}</span>
                                    <span className="text-muted-foreground"> — {act.replace(/_/g, ' ')}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Completing will create {parsedDocumentTypes.length} separate journal entries (one line per document when printed).
                        </p>
                      </div>
                      <div>
                        <div className="grid grid-cols-3 gap-1 mb-2"><span className="text-muted-foreground">Notarization:</span> <span className="col-span-2">{form.getValues('notarizationDate')} {form.getValues('notarizationTime')}</span></div>
                        <div className="grid grid-cols-3 gap-1 mb-2"><span className="text-muted-foreground">Document date:</span> <span className="col-span-2">{form.getValues('documentDate')}</span></div>
                      </div>
                      <div>
                        <div className="grid grid-cols-3 gap-1 mb-2"><span className="text-muted-foreground">Location:</span> <span className="col-span-2">{form.getValues('locationCity')}, {form.getValues('locationState')}</span></div>
                        <div className="grid grid-cols-3 gap-1 mb-1">
                          <span className="text-muted-foreground">Fee:</span>
                          <span className="col-span-2 font-medium">
                            {form.getValues('feeWaived')
                              ? 'Waived'
                              : `$${Number(form.getValues('feeCharged')).toFixed(2)} total`}
                          </span>
                        </div>
                        {!form.getValues('feeWaived') && perActFeeDollars !== null && (
                          <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground">
                            <span></span>
                            <span className="col-span-2">
                              ${perActFeeDollars.toFixed(2)} × {parsedDocumentTypes.length} acts
                              {(Number(form.getValues('additionalFee')) || 0) > 0 && (
                                <> + ${Number(form.getValues('additionalFee')).toFixed(2)} additional</>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="grid grid-cols-3 gap-1 mb-2"><span className="text-muted-foreground">Act Type:</span> <span className="col-span-2 font-medium capitalize">{form.getValues('notarialActType').replace('_', ' ')}</span></div>
                        <div className="grid grid-cols-3 gap-1 mb-2"><span className="text-muted-foreground">Document:</span> <span className="col-span-2">{form.getValues('documentType')}</span></div>
                        <div className="grid grid-cols-3 gap-1 mb-2"><span className="text-muted-foreground">Notarization:</span> <span className="col-span-2">{form.getValues('notarizationDate')} {form.getValues('notarizationTime')}</span></div>
                        <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Document date:</span> <span className="col-span-2">{form.getValues('documentDate')}</span></div>
                      </div>
                      <div>
                        <div className="grid grid-cols-3 gap-1 mb-2"><span className="text-muted-foreground">Location:</span> <span className="col-span-2">{form.getValues('locationCity')}, {form.getValues('locationState')}</span></div>
                        <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Fee:</span> <span className="col-span-2 font-medium">{form.getValues('feeWaived') ? 'Waived' : `$${Number(form.getValues('feeCharged')).toFixed(2)}`}</span></div>
                        {!form.getValues('feeWaived') && (Number(form.getValues('additionalFee')) || 0) > 0 && (
                          <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground mt-1">
                            <span></span>
                            <span className="col-span-2">
                              Stamp: ${(() => {
                                const c = Number(form.getValues('stampCount')) || 1;
                                return (computeStampFeeCents(c, appSettings ?? undefined) / 100).toFixed(2);
                              })()} · Additional: ${Number(form.getValues('additionalFee')).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="mt-6 pt-4 border-t border-border flex flex-wrap justify-between gap-3">
        <Button 
          variant="outline" 
          onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
          disabled={currentStep === 0 || isSaving}
        >
          Back
        </Button>

        <div className="flex flex-wrap gap-3 ml-auto">
          {/* Save-as-draft is available from step 1 onward so notaries can
              stash a partially-filled entry (e.g. before scanning the ID)
              and finish it from the entry detail page later. */}
          {currentStep >= 1 && currentStep < reviewStepIndex(appSettings) && (
            <Button
              variant="secondary"
              onClick={() => saveEntry('draft')}
              disabled={isSaving}
              data-testid="button-save-draft"
            >
              {isSaving ? 'Saving...' : 'Save as Draft'}
            </Button>
          )}

          {/* "Save Draft & Continue" — bypasses validation on Step 2 (Signer
              Info) so notaries taking phone orders can advance without a full
              address. Saves as draft first, then moves to the next step. */}
          {currentStep === 1 && (
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await saveEntry('draft');
                  setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
                  toast({
                    title: 'Saved as draft',
                    description: 'You can fill in missing details later.',
                  });
                } catch (err) {
                  toast({
                    title: 'Save failed',
                    description: err instanceof Error ? err.message : 'Could not save draft.',
                    variant: 'destructive',
                  });
                }
              }}
              className="gap-2"
            >
              <Save className="w-4 h-4" /> Save Draft &amp; Continue
            </Button>
          )}

          {currentStep < 3 && (
            <Button onClick={nextStep} className="gap-2" disabled={isScanning} data-testid="button-next">
              Next Step <ChevronRight className="w-4 h-4" />
            </Button>
          )}

          {currentStep === 3 && shouldRequireSignature(appSettings ?? undefined) && (
            <Button onClick={confirmSignature} className="gap-2" disabled={!shouldRequireSignature(appSettings ?? undefined)}>
              Confirm Signature <ChevronRight className="w-4 h-4" />
            </Button>
          )}

          {currentStep === reviewStepIndex(appSettings) && (
            <div className="flex gap-3 w-full sm:w-auto">
              <Button variant="secondary" onClick={() => saveEntry('draft')} disabled={isSaving}>
                Save Draft
              </Button>
              <Button onClick={() => saveEntry('completed')} disabled={isSaving} className="flex-1 sm:flex-none">
                {isSaving
                  ? 'Completing...'
                  : willSplitDocuments
                    ? `Complete ${parsedDocumentTypes.length} Entries`
                    : 'Complete Entry'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Post-completion: "Add Another Signer" prompt */}
      {lastCompletedId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Add another signer">
          <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-semibold">
                {lastCompletedCount > 1 ? `${lastCompletedCount} Entries Saved` : 'Entry Saved'}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {lastCompletedCount > 1
                  ? 'Each document was saved as its own journal line. You can view them grouped in the journal.'
                  : 'Add another signer to this same document?'}
              </p>
            </div>
            <div className="mt-5 flex flex-col gap-2">
              {lastCompletedCount <= 1 && (
              <Button
                onClick={() => {
                  setLastCompletedId(null);
                  setLastCompletedCount(1);
                  setLocation(`/entry/new?multiSigner=${Date.now()}`);
                }}
                className="w-full"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Another Signer
              </Button>
              )}
              <Button
                variant={lastCompletedCount > 1 ? 'default' : 'outline'}
                onClick={() => {
                  setLastCompletedId(null);
                  setLastCompletedCount(1);
                  if (lastCompletedCount > 1) {
                    setLocation('/journal');
                  } else {
                    setLocation(`/entry/${lastCompletedId}`);
                  }
                }}
                className="w-full"
              >
                {lastCompletedCount > 1 ? 'View Journal' : 'View Entry'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setLastCompletedId(null);
                  setLastCompletedCount(1);
                  setLocation('/journal');
                }}
                className="w-full text-muted-foreground"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Full-size ID image modal */}
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpandedImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white p-2 hover:bg-white/20 rounded-full"
            onClick={() => setExpandedImage(null)}
            aria-label="Close image"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={expandedImage}
            alt="ID document"
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      </>
      )}
    </div>
  );
}
