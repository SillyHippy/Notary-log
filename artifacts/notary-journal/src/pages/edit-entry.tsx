import { useState, useEffect, useRef } from 'react';
import { useLocation, useParams } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import SignaturePad from 'signature_pad';
import { ArrowLeft, Save, PenTool, Eraser, CheckCircle2, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  getEntry,
  updateEntry,
  completeEntry,
  getSettings,
  shouldRecordSignerDOB,
  shouldRecordSignerIdNumber,
  type JournalEntry,
  type NotarySettings,
} from '@/lib/db';
// Note: updateEntry is imported above and reused for both the scan-time
// auto-save (handleScanResult) and the user-clicks-Save path (onSubmit).
import { FEE_TYPES, feeDollarsToCents, resolveFeeType } from '@/lib/fees';
import { IdScanCard } from '@/components/id-scan-card';

// Schema is intentionally lenient on the optional-by-policy fields
// (signerDOB, idNumber, idExpirationDate). Whether they're enforced is
// driven by the notary's compliance toggles, checked in onSubmit below.
const editSchema = z.object({
  signerFullName: z.string().min(1, 'Full name is required'),
  signerAddress: z.string().min(1, 'Address is required'),
  signerCity: z.string().min(1, 'City is required'),
  signerState: z.string().min(2, 'State is required').max(2),
  signerDOB: z.string().optional().default(''),
  signerPhone: z.string().optional(),
  idType: z.enum(['driver_license', 'passport', 'state_id', 'military_id', 'other']),
  idNumber: z.string().optional().default(''),
  idIssuingState: z.string().optional(),
  idExpirationDate: z.string().optional().default(''),
  documentType: z.string().min(1, 'Document type is required'),
  documentDate: z.string().optional(),
  documentDescription: z.string().optional(),
  notarialActType: z.enum(['acknowledgment', 'jurat', 'copy_certification', 'signature_witnessing', 'other']),
  feeType: z.enum(FEE_TYPES),
  feeCharged: z.coerce.number().min(0),
  feeWaived: z.boolean().default(false),
  locationCity: z.string().min(1, 'Location city is required'),
  locationState: z.string().min(2, 'Location state is required').max(2),
  locationAddress: z.string().optional(),
  notes: z.string().optional(),
});

type EditFormValues = z.infer<typeof editSchema>;

export function EditEntry() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || '0', 10);
  const { toast } = useToast();

  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [settings, setSettings] = useState<NotarySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Local copy of the scan images so the user can re-scan a draft without
  // needing to type anything. Saved alongside the form on submit.
  const [idFrontImage, setIdFrontImage] = useState<string | undefined>();
  const [idBackImage, setIdBackImage] = useState<string | undefined>();
  const [scanMethod, setScanMethod] = useState<'barcode' | 'mrz' | 'ocr' | 'manual' | undefined>();
  const [scanRawText, setScanRawText] = useState<string | undefined>();
  const [scanConfidence, setScanConfidence] = useState<number | undefined>();
  // Derived from URL: ?scan=1 auto-expands the scan card. Wired up in
  // entry-detail.tsx's "Scan ID Now" button so the user lands directly on
  // the scan UI without scrolling.
  const [scanAutoExpand, setScanAutoExpand] = useState(false);

  // "Complete mode" — entered via ?complete=1 from "Continue & Sign" CTA.
  // Shows the signature capture section and a "Sign & Complete Entry" button.
  const [completeMode, setCompleteMode] = useState(false);
  const [signatureImage, setSignatureImage] = useState<string | undefined>();
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signaturePadRef = useRef<SignaturePad | null>(null);

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      signerFullName: '',
      signerAddress: '',
      signerCity: '',
      signerState: '',
      signerDOB: '',
      idType: 'driver_license',
      idNumber: '',
      idExpirationDate: '',
      documentType: '',
      notarialActType: 'acknowledgment',
      feeType: 'Acknowledgment',
      feeCharged: 0,
      feeWaived: false,
      locationCity: '',
      locationState: '',
    },
  });

  useEffect(() => {
    const loadEntry = async () => {
      if (!id) return;
      // Auto-open scan card when arriving from the "Scan ID Now" CTA.
      // Activate complete mode when arriving from "Continue & Sign" CTA.
      try {
        const u = new URL(window.location.href);
        if (u.searchParams.get('scan') === '1') setScanAutoExpand(true);
        if (u.searchParams.get('complete') === '1') setCompleteMode(true);
      } catch {
        // Non-browser env; fine to skip.
      }

      const [e, s] = await Promise.all([getEntry(id), getSettings()]);
      if (!e) {
        toast({ title: 'Not Found', description: 'Entry not found.', variant: 'destructive' });
        setLocation('/journal');
        return;
      }
      if (e.status !== 'draft') {
        toast({ title: 'Cannot Edit', description: 'Only draft entries can be edited.', variant: 'destructive' });
        setLocation(`/entry/${id}`);
        return;
      }
      setEntry(e);
      setSettings(s);
      setIdFrontImage(e.idFrontImage);
      setIdBackImage(e.idBackImage);
      setScanMethod(e.extractionMethod);
      setScanRawText(e.extractedRawText);
      setScanConfidence(e.extractionConfidence);
      form.reset({
        signerFullName: e.signerFullName,
        signerAddress: e.signerAddress,
        signerCity: e.signerCity,
        signerState: e.signerState,
        signerDOB: e.signerDOB || '',
        signerPhone: e.signerPhone || '',
        idType: e.idType,
        idNumber: e.idNumber || '',
        idIssuingState: e.idIssuingState || '',
        idExpirationDate: e.idExpirationDate || '',
        documentType: e.documentType,
        documentDate: e.documentDate || '',
        documentDescription: e.documentDescription || '',
        notarialActType: e.notarialActType,
        feeType: resolveFeeType(e),
        feeCharged: e.feeCharged / 100,
        feeWaived: e.feeWaived,
        locationCity: e.locationCity,
        locationState: e.locationState,
        locationAddress: e.locationAddress || '',
        notes: e.notes || '',
      });
      setIsLoading(false);
    };
    loadEntry();
  }, [id, form, setLocation, toast]);

  const wantsDOB = shouldRecordSignerDOB(settings ?? undefined);
  const wantsIdNumber = shouldRecordSignerIdNumber(settings ?? undefined);

  const handleScanResult = async ({
    frontImage,
    backImage,
    result,
  }: {
    frontImage?: string;
    backImage?: string;
    result: { fields: Record<string, string>; extraction: { method: 'barcode' | 'ocr' | 'mrz'; text?: string; confidence?: number } };
  }) => {
    if (frontImage !== undefined) setIdFrontImage(frontImage);
    if (backImage !== undefined) setIdBackImage(backImage);

    setScanMethod(result.extraction.method);
    setScanRawText(result.extraction.text);
    setScanConfidence(result.extraction.confidence);

    // Apply extracted fields. Honor the compliance toggles — we don't want
    // to silently fill DOB / ID# when the notary has them disabled.
    // Maps scan-result key → (formField, journalEntryField, allowedByToggle).
    const FIELD_MAP: Array<[string, keyof EditFormValues, keyof JournalEntry, boolean]> = [
      ['fullName', 'signerFullName', 'signerFullName', true],
      ['address', 'signerAddress', 'signerAddress', true],
      ['city', 'signerCity', 'signerCity', true],
      ['state', 'signerState', 'signerState', true],
      ['dob', 'signerDOB', 'signerDOB', wantsDOB],
      ['idNumber', 'idNumber', 'idNumber', wantsIdNumber],
      ['idIssuingState', 'idIssuingState', 'idIssuingState', true],
      // Expiration date is never gated by the ID-number toggle — every
      // state allows recording it as part of the standard ID record.
      ['expirationDate', 'idExpirationDate', 'idExpirationDate', true],
    ];

    // Build the IndexedDB patch in lockstep with the form updates so the
    // parsed signer/ID values are persisted to disk *immediately*, not just
    // pushed into transient form state. Spec: "on a successful scan,
    // populates the draft's signer fields and ID fields, attaches the
    // front/back ID images, and saves the updated draft in place."
    const fieldPatch: Partial<JournalEntry> = {};
    for (const [from, formKey, entryKey, allowed] of FIELD_MAP) {
      if (!allowed) continue;
      const v = result.fields[from];
      if (!v) continue;
      form.setValue(formKey as never, v as never, { shouldDirty: true });
      (fieldPatch as Record<string, unknown>)[entryKey] = v;
    }

    // Auto-persist the scan result back onto the draft so the captured
    // image, extraction metadata, AND parsed signer/ID values survive even
    // if the notary navigates away before clicking Save Changes.
    if (entry?.id != null) {
      try {
        const patch: Partial<JournalEntry> = {
          ...fieldPatch,
          extractionMethod: result.extraction.method,
          extractedRawText: result.extraction.text,
          extractionConfidence: result.extraction.confidence,
        };
        if (frontImage !== undefined) patch.idFrontImage = frontImage;
        if (backImage !== undefined) patch.idBackImage = backImage;
        await updateEntry(entry.id, patch);
        const fieldCount = Object.keys(fieldPatch).length;
        toast({
          title: 'Scan saved',
          description: fieldCount > 0
            ? `Draft updated with ${fieldCount} field${fieldCount === 1 ? '' : 's'} from the ID.`
            : 'ID image attached to this draft.',
        });
      } catch (err) {
        // Non-fatal: the form-level Save Changes button will retry the write.
        console.error('Auto-save of scan result failed', err);
      }
    }
  };

  const onSubmit = async (data: EditFormValues) => {
    if (!entry) return;

    // Conditional required-field check: only enforce when the toggle is on.
    if (wantsDOB && !data.signerDOB) {
      form.setError('signerDOB', { type: 'manual', message: 'Date of birth is required' });
      return;
    }
    // Expiration date is always required.
    if (!data.idExpirationDate) {
      form.setError('idExpirationDate', { type: 'manual', message: 'Expiration date is required' });
      return;
    }
    if (wantsIdNumber && !data.idNumber) {
      form.setError('idNumber', { type: 'manual', message: 'ID number is required' });
      return;
    }

    setIsSaving(true);
    try {
      const feeCents = feeDollarsToCents(data.feeCharged);
      // Defense in depth: the form already hides DOB/ID#/expiration when the
      // toggles are off, but we explicitly scrub them here too so a stale
      // value (e.g. typed before the toggle flipped) cannot leak into the
      // persisted entry.
      const scrubbed: EditFormValues = { ...data };
      if (!wantsDOB) scrubbed.signerDOB = '';
      // Only the full ID# is gated; expiration is always allowed.
      if (!wantsIdNumber) scrubbed.idNumber = '';
      await updateEntry(id, {
        ...scrubbed,
        feeCharged: feeCents,
        idFrontImage,
        idBackImage,
        extractionMethod: scanMethod,
        extractedRawText: scanRawText,
        extractionConfidence: scanConfidence,
        editHistory: [
          ...(entry.editHistory || []),
          { field: 'form', oldValue: '', newValue: 'updated', date: new Date().toISOString() },
        ],
      });
      toast({ title: 'Saved', description: 'Draft entry updated.' });
      setLocation(`/entry/${id}`);
    } catch (err) {
      console.error('Edit entry save failed', err);
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (/locked/i.test(rawMsg)) {
        // Reload so App.tsx routes the user to <PinLock>; toast would
        // not be visible across the navigation.
        window.location.reload();
        return;
      }
      toast({
        title: 'Failed to save changes',
        description: rawMsg || 'Unknown error',
        variant: 'destructive',
      });
      setIsSaving(false);
    }
  };

  // Initialise the signature pad whenever complete mode becomes active and the
  // canvas element is in the DOM.  We do this in a separate effect so the
  // canvas has had a chance to render.
  useEffect(() => {
    if (!completeMode || !sigCanvasRef.current) return;
    const canvas = sigCanvasRef.current;
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
    signaturePadRef.current = new SignaturePad(canvas, {
      backgroundColor: 'rgba(255, 255, 255, 0)',
      penColor: 'rgb(0, 0, 0)',
    });
    return () => {
      signaturePadRef.current?.off();
      signaturePadRef.current = null;
    };
  }, [completeMode]);

  // Returns a list of human-readable labels for fields that must be non-empty
  // before the entry can be completed (taking compliance toggles into account).
  const getMissingFields = (): string[] => {
    const data = form.getValues();
    const missing: string[] = [];
    if (!data.signerFullName) missing.push('Signer full name');
    if (!data.signerAddress) missing.push('Address');
    if (!data.signerCity) missing.push('City');
    if (!data.signerState) missing.push('State');
    if (wantsDOB && !data.signerDOB) missing.push('Date of birth');
    if (!data.idExpirationDate) missing.push('ID expiration date');
    if (wantsIdNumber && !data.idNumber) missing.push('ID number');
    if (!data.documentType) missing.push('Document type');
    if (!data.locationCity) missing.push('Location city');
    if (!data.locationState) missing.push('Location state');
    return missing;
  };

  const handleComplete = async (data: EditFormValues) => {
    if (!entry) return;

    if (signaturePadRef.current?.isEmpty()) {
      toast({ title: 'Signature required', description: 'Please have the signer sign before completing.', variant: 'destructive' });
      return;
    }
    const sigData = signaturePadRef.current?.toDataURL('image/png');

    setIsSaving(true);
    try {
      const feeCents = feeDollarsToCents(data.feeCharged);
      const scrubbed: EditFormValues = { ...data };
      if (!wantsDOB) scrubbed.signerDOB = '';
      if (!wantsIdNumber) scrubbed.idNumber = '';
      // Persist the latest form values + signature image first, then call
      // completeEntry() which stamps the chain hash.
      await updateEntry(id, {
        ...scrubbed,
        feeCharged: feeCents,
        idFrontImage,
        idBackImage,
        signatureImage: sigData,
        extractionMethod: scanMethod,
        extractedRawText: scanRawText,
        extractionConfidence: scanConfidence,
        editHistory: [
          ...(entry.editHistory || []),
          { field: 'form', oldValue: '', newValue: 'updated before sign', date: new Date().toISOString() },
        ],
      });
      await completeEntry(id);
      toast({ title: 'Entry completed', description: `Entry #${entry.entryNumber} has been signed and completed.` });
      setLocation(`/entry/${id}`);
    } catch (err) {
      console.error('Complete entry failed', err);
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (/locked/i.test(rawMsg)) {
        window.location.reload();
        return;
      }
      toast({
        title: 'Failed to complete entry',
        description: rawMsg || 'Unknown error — the entry remains a draft.',
        variant: 'destructive',
      });
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!entry) return null;

  const currentIdType = form.watch('idType');

  const missingFields = completeMode ? getMissingFields() : [];
  const canComplete = completeMode && missingFields.length === 0 && !isSaving;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24 md:pb-8">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" className="gap-2 pl-0 hover:bg-transparent hover:text-primary" onClick={() => setLocation(`/entry/${id}`)}>
          <ArrowLeft className="w-4 h-4" /> Back to Entry
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          {completeMode ? `Complete Entry #${entry.entryNumber}` : `Edit Draft Entry #${entry.entryNumber}`}
        </h1>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Scan card lives at the top of the edit page so the "draft now,
              scan later" workflow is one tap away. The card is collapsible
              once the user has worked through it. */}
          <IdScanCard
            idType={currentIdType}
            initialFrontImage={idFrontImage}
            initialBackImage={idBackImage}
            onScan={handleScanResult}
            defaultExpanded={scanAutoExpand || (!idFrontImage && !idBackImage)}
          />

          <Card>
            <CardHeader>
              <CardTitle>Signer Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="signerFullName" render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input {...field} data-testid="input-signer-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="signerAddress" render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Address</FormLabel>
                  <FormControl><Input {...field} data-testid="input-signer-address" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="signerCity" render={({ field }) => (
                <FormItem>
                  <FormLabel>City</FormLabel>
                  <FormControl><Input {...field} data-testid="input-signer-city" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="signerState" render={({ field }) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <FormControl><Input {...field} maxLength={2} placeholder="IL" data-testid="input-signer-state" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {wantsDOB && (
                <FormField control={form.control} name="signerDOB" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of Birth</FormLabel>
                    <FormControl><Input type="date" {...field} data-testid="input-signer-dob" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <FormField control={form.control} name="signerPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone (optional)</FormLabel>
                  <FormControl><Input type="tel" {...field} data-testid="input-signer-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Identification</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="idType" render={({ field }) => (
                <FormItem>
                  <FormLabel>ID Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-id-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="driver_license">Driver License</SelectItem>
                      <SelectItem value="passport">Passport</SelectItem>
                      <SelectItem value="state_id">State ID</SelectItem>
                      <SelectItem value="military_id">Military ID</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              {wantsIdNumber && (
                <FormField control={form.control} name="idNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ID Number</FormLabel>
                    <FormControl><Input {...field} data-testid="input-id-number" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <FormField control={form.control} name="idIssuingState" render={({ field }) => (
                <FormItem>
                  <FormLabel>Issuing State (optional)</FormLabel>
                  <FormControl><Input {...field} maxLength={2} data-testid="input-id-issuing-state" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {/* Expiration is always shown — never gated by the ID# toggle. */}
              <FormField control={form.control} name="idExpirationDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Expiration Date</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-id-expiration" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notarial Act</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="documentType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Document Type</FormLabel>
                  <FormControl><Input {...field} data-testid="input-document-type" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="documentDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Document Date (optional)</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-document-date" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="notarialActType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Act Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-act-type">
                        <SelectValue />
                      </SelectTrigger>
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
              <FormField control={form.control} name="feeType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fee Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-fee-type-edit">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {FEE_TYPES.map(ft => (
                        <SelectItem key={ft} value={ft}>{ft}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="feeCharged" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fee ($)</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Input type="number" min={0} step={0.01} {...field} data-testid="input-fee" />
                      <Button type="button" variant="outline" onClick={() => { form.setValue('feeCharged', 0); form.setValue('feeWaived', true); }} data-testid="button-no-fee">
                        No Fee
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="locationCity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location City</FormLabel>
                  <FormControl><Input {...field} data-testid="input-location-city" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="locationState" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location State</FormLabel>
                  <FormControl><Input {...field} maxLength={2} data-testid="input-location-state" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl><Textarea rows={3} {...field} data-testid="textarea-notes" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* SIGNATURE CAPTURE — only visible in complete mode */}
          {completeMode && (
            <Card className="border-primary/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <PenTool className="w-5 h-5 text-primary" /> Signer Signature
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {missingFields.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium mb-1">Fill in required fields before signing:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {missingFields.map(f => <li key={f}>{f}</li>)}
                      </ul>
                    </div>
                  </div>
                )}

                <div className="relative border-2 border-primary/30 border-dashed rounded-xl bg-white overflow-hidden" style={{ minHeight: '220px' }}>
                  <canvas
                    ref={sigCanvasRef}
                    className="w-full h-full cursor-crosshair touch-none"
                    style={{ display: 'block', minHeight: '220px' }}
                    data-testid="signature-canvas"
                  />
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
                    <span className="text-5xl font-serif text-black font-bold tracking-widest rotate-[-10deg]">SIGN HERE</span>
                  </div>
                  <div className="absolute bottom-3 right-3 z-10">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="shadow-md gap-2"
                      onClick={() => signaturePadRef.current?.clear()}
                    >
                      <Eraser className="w-3.5 h-3.5" /> Clear
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Have the signer draw their signature inside the box above using a finger, stylus, or mouse.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-3 justify-end">
            <Button type="button" variant="outline" onClick={() => setLocation(`/entry/${id}`)} disabled={isSaving} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving} className="gap-2" data-testid="button-save-edit">
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
            {completeMode && (
              <Button
                type="button"
                disabled={!canComplete}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={form.handleSubmit(handleComplete)}
                data-testid="button-sign-complete"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isSaving ? 'Completing...' : 'Sign & Complete Entry'}
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
