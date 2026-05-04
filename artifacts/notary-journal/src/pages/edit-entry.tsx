import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ArrowLeft, Save } from 'lucide-react';

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
  getSettings,
  shouldRecordSignerDOB,
  shouldRecordSignerIdNumber,
  type JournalEntry,
  type NotarySettings,
} from '@/lib/db';
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
      try {
        const u = new URL(window.location.href);
        if (u.searchParams.get('scan') === '1') setScanAutoExpand(true);
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

  const handleScanResult = ({
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
    const FIELD_MAP: Array<[string, keyof EditFormValues, boolean]> = [
      ['fullName', 'signerFullName', true],
      ['address', 'signerAddress', true],
      ['city', 'signerCity', true],
      ['state', 'signerState', true],
      ['dob', 'signerDOB', wantsDOB],
      ['idNumber', 'idNumber', wantsIdNumber],
      ['idIssuingState', 'idIssuingState', true],
      ['expirationDate', 'idExpirationDate', wantsIdNumber],
    ];
    for (const [from, to, allowed] of FIELD_MAP) {
      if (!allowed) continue;
      const v = result.fields[from];
      if (v) form.setValue(to as never, v as never, { shouldDirty: true });
    }
  };

  const onSubmit = async (data: EditFormValues) => {
    if (!entry) return;

    // Conditional required-field check: only enforce when the toggle is on.
    if (wantsDOB && !data.signerDOB) {
      form.setError('signerDOB', { type: 'manual', message: 'Date of birth is required' });
      return;
    }
    if (wantsIdNumber) {
      if (!data.idNumber) {
        form.setError('idNumber', { type: 'manual', message: 'ID number is required' });
        return;
      }
      if (!data.idExpirationDate) {
        form.setError('idExpirationDate', { type: 'manual', message: 'Expiration date is required' });
        return;
      }
    }

    setIsSaving(true);
    try {
      const feeCents = feeDollarsToCents(data.feeCharged);
      await updateEntry(id, {
        ...data,
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

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!entry) return null;

  const currentIdType = form.watch('idType');

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24 md:pb-8">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" className="gap-2 pl-0 hover:bg-transparent hover:text-primary" onClick={() => setLocation(`/entry/${id}`)}>
          <ArrowLeft className="w-4 h-4" /> Back to Entry
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Edit Draft Entry #{entry.entryNumber}</h1>
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
              {wantsIdNumber && (
                <FormField control={form.control} name="idExpirationDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expiration Date</FormLabel>
                    <FormControl><Input type="date" {...field} data-testid="input-id-expiration" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
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

          <div className="flex gap-3 justify-end">
            <Button type="button" variant="outline" onClick={() => setLocation(`/entry/${id}`)} disabled={isSaving} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving} className="gap-2" data-testid="button-save-edit">
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
