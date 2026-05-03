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
import { getEntry, updateEntry, type JournalEntry } from '@/lib/db';
import { FEE_TYPES, resolveFeeType } from '@/lib/fees';

const editSchema = z.object({
  signerFullName: z.string().min(1, 'Full name is required'),
  signerAddress: z.string().min(1, 'Address is required'),
  signerCity: z.string().min(1, 'City is required'),
  signerState: z.string().min(2, 'State is required').max(2),
  signerDOB: z.string().min(1, 'Date of birth is required'),
  signerPhone: z.string().optional(),
  idType: z.enum(['driver_license', 'passport', 'state_id', 'military_id', 'other']),
  idNumber: z.string().min(1, 'ID number is required'),
  idIssuingState: z.string().optional(),
  idExpirationDate: z.string().min(1, 'Expiration date is required'),
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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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
      const e = await getEntry(id);
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
      form.reset({
        signerFullName: e.signerFullName,
        signerAddress: e.signerAddress,
        signerCity: e.signerCity,
        signerState: e.signerState,
        signerDOB: e.signerDOB,
        signerPhone: e.signerPhone || '',
        idType: e.idType,
        idNumber: e.idNumber,
        idIssuingState: e.idIssuingState || '',
        idExpirationDate: e.idExpirationDate,
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

  const onSubmit = async (data: EditFormValues) => {
    if (!entry) return;
    setIsSaving(true);
    try {
      const feeNum = typeof data.feeCharged === 'number' ? data.feeCharged : Number(data.feeCharged);
      const feeCents = Number.isFinite(feeNum) ? Math.round(feeNum * 100) : 0;
      await updateEntry(id, {
        ...data,
        feeCharged: feeCents,
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
        toast({
          title: 'Journal is locked',
          description: 'Please re-enter your PIN to save these changes.',
          variant: 'destructive',
        });
        setIsSaving(false);
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
              <FormField control={form.control} name="signerDOB" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of Birth</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-signer-dob" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
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
              <FormField control={form.control} name="idNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>ID Number</FormLabel>
                  <FormControl><Input {...field} data-testid="input-id-number" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="idIssuingState" render={({ field }) => (
                <FormItem>
                  <FormLabel>Issuing State (optional)</FormLabel>
                  <FormControl><Input {...field} maxLength={2} data-testid="input-id-issuing-state" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
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
