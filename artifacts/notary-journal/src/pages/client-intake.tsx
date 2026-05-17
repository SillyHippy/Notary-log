import * as React from 'react';
import { useLocation } from 'wouter';
import SignaturePad from 'signature_pad';
import { Camera, Check, ChevronRight, ChevronLeft, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileUploadZone } from '@/components/file-upload-zone';

const WEBHOOK_URL = import.meta.env.VITE_INTAKE_WEBHOOK_URL ?? '';

function getUrlKey(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('key');
}

const STEPS = [
  'Notarization',
  'Signer',
  'ID Details',
  'ID Uploads',
  'Signer 2',
  'Documents',
  'Payment',
  'Signature',
];

const SERVICES = [
  'Acknowledgement',
  'Jurat',
  'Copy Certification',
  'Signature Witnessing',
  'Oath',
  'Other',
] as const;

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
  'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
  'TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const ID_TYPES = ["Driver's License", 'State ID', 'Passport', 'Military ID', 'Other'];

export function ClientIntake() {
  const [, setLocation] = useLocation();
  const [step, setStep] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [needsSigner2, setNeedsSigner2] = React.useState(false);
  const [needDoc2, setNeedDoc2] = React.useState(false);
  const [needDoc3, setNeedDoc3] = React.useState(false);
  const [signatureConfirmed, setSignatureConfirmed] = React.useState(false);

  const sigCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const sigPadRef = React.useRef<SignaturePad | null>(null);

  // Form state
  const [form, setForm] = React.useState({
    preferredDate: new Date().toISOString().split('T')[0],
    services: [] as string[],
    serviceType: 'In-Office',
    // Primary signer
    signerFirstName: '',
    signerMiddleName: '',
    signerLastName: '',
    email: '',
    phone: '',
    signerAddress: '',
    signerAddress2: '',
    signerCity: '',
    signerState: '',
    signerZip: '',
    // ID
    idType: "Driver's License",
    idNumber: '',
    idIssuedBy: '',
    idDateIssued: '',
    idExpirationDate: '',
    // Files
    idFrontFiles: [] as File[],
    idBackFiles: [] as File[],
    notes: '',
    // Signer 2
    signer2FirstName: '',
    signer2LastName: '',
    signer2Phone: '',
    signer2IdType: "Driver's License",
    signer2IdNumber: '',
    signer2IdIssuedBy: '',
    signer2IdExpirationDate: '',
    signer2IdFrontFiles: [] as File[],
    signer2IdBackFiles: [] as File[],
    // Documents
    doc1Type: '',
    doc1Date: '',
    doc2Type: '',
    doc2Date: '',
    doc3Type: '',
    doc3Date: '',
    // Payment
    paymentMethod: 'Cash',
    totalAmount: '',
    payerName: '',
  });

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleService = (s: string) =>
    setForm((prev) => ({
      ...prev,
      services: prev.services.includes(s)
        ? prev.services.filter((x) => x !== s)
        : [...prev.services, s],
    }));

  // SignaturePad init
  React.useEffect(() => {
    if (step === 7 && sigCanvasRef.current && !sigPadRef.current) {
      const canvas = sigCanvasRef.current;
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = Math.max(parent.clientHeight, 150);
      }
      sigPadRef.current = new SignaturePad(canvas, {
        backgroundColor: 'rgba(255,255,255,0)',
        penColor: 'rgb(0,0,0)',
      });
    }
  }, [step]);

  // Resize canvas on window resize
  React.useEffect(() => {
    if (step !== 7 || !sigCanvasRef.current) return;
    const handleResize = () => {
      const canvas = sigCanvasRef.current;
      if (!canvas || !sigPadRef.current) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const data = sigPadRef.current.toData();
      canvas.width = parent.clientWidth;
      canvas.height = Math.max(parent.clientHeight, 150);
      sigPadRef.current.fromData(data);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [step]);

  const clearSignature = () => sigPadRef.current?.clear();

  const isSigEmpty = () => sigPadRef.current?.isEmpty() ?? true;

  // Validation per step
  const validateStep = (s: number): string | null => {
    switch (s) {
      case 0: // Notarization
        if (!form.preferredDate) return 'Preferred date is required.';
        if (form.services.length === 0) return 'Select at least one service.';
        return null;
      case 1: // Signer
        if (!form.signerFirstName.trim()) return 'First name is required.';
        if (!form.signerLastName.trim()) return 'Last name is required.';
        if (!form.signerAddress.trim()) return 'Address is required.';
        if (!form.signerCity.trim()) return 'City is required.';
        if (!form.signerState) return 'State is required.';
        return null;
      case 2: // ID Details
        if (!form.idNumber.trim()) return 'ID number is required.';
        if (!form.idIssuedBy.trim()) return 'Issued by is required.';
        return null;
      case 3: // ID Uploads
        if (form.idFrontFiles.length === 0) return 'Upload ID front.';
        if (form.idBackFiles.length === 0) return 'Upload ID back.';
        return null;
      case 4: // Signer 2 (optional, skip if toggled off)
        if (!needsSigner2) return null;
        if (!form.signer2FirstName.trim()) return 'Signer 2 first name is required.';
        if (!form.signer2LastName.trim()) return 'Signer 2 last name is required.';
        return null;
      case 5: // Documents
        if (!form.doc1Type.trim()) return 'Document type is required.';
        return null;
      case 6: // Payment
        if (!form.totalAmount) return 'Total amount is required.';
        return null;
      case 7: // Signature
        if (isSigEmpty()) return 'Please provide your signature.';
        if (!signatureConfirmed) return 'You must confirm the signature.';
        return null;
      default:
        return null;
    }
  };

  const [stepError, setStepError] = React.useState<string | null>(null);

  const nextStep = () => {
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const prevStep = () => {
    setStepError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  // Submit to Web3Forms
  const handleSubmit = async () => {
    const err = validateStep(7);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setSubmitting(true);
    setSubmitError(null);

    const urlKey = getUrlKey();
    if (!urlKey) {
      setSubmitError('Please use the full link provided by your notary (it should include ?key=...).');
      setSubmitting(false);
      return;
    }

    try {
      // Build JSON payload — Web3Forms accepts JSON or form-data
      const payload: Record<string, unknown> = {
        access_key: urlKey,
        preferredDate: form.preferredDate,
        servicesPerformed: form.services.join(', '),
        serviceType: form.serviceType,
        signerFirstName: form.signerFirstName,
        signerMiddleName: form.signerMiddleName,
        signerLastName: form.signerLastName,
        email: form.email,
        phone: form.phone,
        signerAddress: form.signerAddress,
        signerAddress2: form.signerAddress2,
        signerCity: form.signerCity,
        signerState: form.signerState,
        signerZip: form.signerZip,
        idType: form.idType,
        idNumber: form.idNumber,
        idIssuedBy: form.idIssuedBy,
        idDateIssued: form.idDateIssued,
        idExpirationDate: form.idExpirationDate,
        notes: form.notes,
        hasSigner2: needsSigner2 ? 'Yes' : 'No',
        paymentMethod: form.paymentMethod,
        totalAmount: form.totalAmount,
        payerName: form.payerName,
        doc1Type: form.doc1Type,
        doc1Date: form.doc1Date,
        doc2Type: needDoc2 ? form.doc2Type : '',
        doc2Date: needDoc2 ? form.doc2Date : '',
        doc3Type: needDoc3 ? form.doc3Type : '',
        doc3Date: needDoc3 ? form.doc3Date : '',
      };

      if (needsSigner2) {
        payload.signer2FirstName = form.signer2FirstName;
        payload.signer2LastName = form.signer2LastName;
        payload.signer2Phone = form.signer2Phone;
        payload.signer2IdType = form.signer2IdType;
        payload.signer2IdNumber = form.signer2IdNumber;
        payload.signer2IdIssuedBy = form.signer2IdIssuedBy;
        payload.signer2IdExpirationDate = form.signer2IdExpirationDate;
      }

      // Convert files to base64 for JSON submission
      const fileToBase64 = (file: File): Promise<string> =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });

      if (form.idFrontFiles.length) {
        const encoded = await Promise.all(form.idFrontFiles.map(fileToBase64));
        payload.idFrontFiles = encoded;
      }
      if (form.idBackFiles.length) {
        const encoded = await Promise.all(form.idBackFiles.map(fileToBase64));
        payload.idBackFiles = encoded;
      }
      if (needsSigner2 && form.signer2IdFrontFiles.length) {
        const encoded = await Promise.all(form.signer2IdFrontFiles.map(fileToBase64));
        payload.signer2IdFrontFiles = encoded;
      }
      if (needsSigner2 && form.signer2IdBackFiles.length) {
        const encoded = await Promise.all(form.signer2IdBackFiles.map(fileToBase64));
        payload.signer2IdBackFiles = encoded;
      }

      // Signature as base64
      const sigData = sigPadRef.current?.toDataURL();
      if (sigData) payload.eSignature = sigData;

      // Submit to Web3Forms
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setSubmitError(data.message || 'Submission failed. Try again.');
      }
    } catch {
      setSubmitError('Network error. Check your connection and try again.');
    }
    setSubmitting(false);
  };

  // ── Submitted state ──
  if (submitted) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-xl font-bold">Request Submitted!</h1>
          <p className="text-sm text-muted-foreground mt-2">
            The notary will review your information and contact you shortly.
          </p>
        </div>
      </div>
    );
  }

  // ── Not configured ──
  if (!getUrlKey() && step === 0) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
        <Alert>
          <AlertDescription>
            Please use the full link provided by your notary (it should include ?key=...).
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col safe-all">
      {/* Header */}
      <header className="border-b bg-card px-4 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <h1 className="text-lg font-bold">Notary Intake Form</h1>
          <span className="text-xs text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden max-w-2xl mx-auto">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-4 pb-8">

          {stepError && (
            <Alert variant="destructive">
              <AlertDescription>{stepError}</AlertDescription>
            </Alert>
          )}

          {/* STEP 0: Notarization Details */}
          {step === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Notarization Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Preferred Date *</Label>
                  <Input
                    type="date"
                    value={form.preferredDate}
                    onChange={(e) => update('preferredDate', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Services Performed *</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {SERVICES.map((s) => (
                      <div key={s} className="flex items-center gap-2">
                        <Checkbox
                          id={`svc-${s}`}
                          checked={form.services.includes(s)}
                          onCheckedChange={() => toggleService(s)}
                        />
                        <Label htmlFor={`svc-${s}`} className="text-sm cursor-pointer">
                          {s}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Service Type</Label>
                  <Select
                    value={form.serviceType}
                    onValueChange={(v) => update('serviceType', v)}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Mobile">Mobile</SelectItem>
                      <SelectItem value="In-Office">In-Office</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* STEP 1: Primary Signer */}
          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Primary Signer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>First Name *</Label>
                    <Input
                      value={form.signerFirstName}
                      onChange={(e) => update('signerFirstName', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Middle Name</Label>
                    <Input
                      value={form.signerMiddleName}
                      onChange={(e) => update('signerMiddleName', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Last Name *</Label>
                    <Input
                      value={form.signerLastName}
                      onChange={(e) => update('signerLastName', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => update('email', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => update('phone', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label>Address *</Label>
                  <Input
                    value={form.signerAddress}
                    onChange={(e) => update('signerAddress', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Address Line 2</Label>
                  <Input
                    value={form.signerAddress2}
                    onChange={(e) => update('signerAddress2', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <Label>City *</Label>
                    <Input
                      value={form.signerCity}
                      onChange={(e) => update('signerCity', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>State *</Label>
                    <Select
                      value={form.signerState}
                      onValueChange={(v) => update('signerState', v)}
                    >
                      <SelectTrigger className="mt-1"><SelectValue placeholder="State" /></SelectTrigger>
                      <SelectContent>
                        {STATES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>ZIP</Label>
                    <Input
                      value={form.signerZip}
                      onChange={(e) => update('signerZip', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* STEP 2: ID Details */}
          {step === 2 && (
            <Card>
              <CardHeader>
                <CardTitle>Identification Used</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>ID Type *</Label>
                  <Select
                    value={form.idType}
                    onValueChange={(v) => update('idType', v)}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ID_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>ID Number *</Label>
                  <Input
                    value={form.idNumber}
                    onChange={(e) => update('idNumber', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Issued By / State *</Label>
                  <Input
                    value={form.idIssuedBy}
                    onChange={(e) => update('idIssuedBy', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Date Issued</Label>
                    <Input
                      type="date"
                      value={form.idDateIssued}
                      onChange={(e) => update('idDateIssued', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Expiration Date *</Label>
                    <Input
                      type="date"
                      value={form.idExpirationDate}
                      onChange={(e) => update('idExpirationDate', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* STEP 3: ID Uploads */}
          {step === 3 && (
            <Card>
              <CardHeader>
                <CardTitle>Upload ID Documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FileUploadZone
                  label="ID Front *"
                  description="Upload a clear photo of the front of the ID"
                  maxFiles={3}
                  capture="environment"
                  files={form.idFrontFiles}
                  onFilesChange={(f) => update('idFrontFiles', f)}
                />
                <FileUploadZone
                  label="ID Back *"
                  description="Upload a clear photo of the back of the ID"
                  maxFiles={3}
                  capture="environment"
                  files={form.idBackFiles}
                  onFilesChange={(f) => update('idBackFiles', f)}
                />
              </CardContent>
            </Card>
          )}

          {/* STEP 4: Additional Signer */}
          {step === 4 && (
            <Card>
              <CardHeader>
                <CardTitle>Additional Signer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                  <Checkbox
                    id="need-signer2"
                    checked={needsSigner2}
                    onCheckedChange={(v) => setNeedsSigner2(!!v)}
                  />
                  <Label htmlFor="need-signer2" className="cursor-pointer">
                    Need an additional signer or witness?
                  </Label>
                </div>

                {needsSigner2 && (
                  <div className="space-y-4 pt-2 border-t">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>First Name *</Label>
                        <Input
                          value={form.signer2FirstName}
                          onChange={(e) => update('signer2FirstName', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Last Name *</Label>
                        <Input
                          value={form.signer2LastName}
                          onChange={(e) => update('signer2LastName', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Phone</Label>
                      <Input
                        type="tel"
                        value={form.signer2Phone}
                        onChange={(e) => update('signer2Phone', e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>ID Type</Label>
                        <Select
                          value={form.signer2IdType}
                          onValueChange={(v) => update('signer2IdType', v)}
                        >
                          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ID_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>ID Number</Label>
                        <Input
                          value={form.signer2IdNumber}
                          onChange={(e) => update('signer2IdNumber', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Issued By</Label>
                      <Input
                        value={form.signer2IdIssuedBy}
                        onChange={(e) => update('signer2IdIssuedBy', e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Expiration Date</Label>
                      <Input
                        type="date"
                        value={form.signer2IdExpirationDate}
                        onChange={(e) => update('signer2IdExpirationDate', e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <FileUploadZone
                      label="Signer 2 ID Front"
                      maxFiles={3}
                      capture="environment"
                      files={form.signer2IdFrontFiles}
                      onFilesChange={(f) => update('signer2IdFrontFiles', f)}
                    />
                    <FileUploadZone
                      label="Signer 2 ID Back"
                      maxFiles={3}
                      capture="environment"
                      files={form.signer2IdBackFiles}
                      onFilesChange={(f) => update('signer2IdBackFiles', f)}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* STEP 5: Documents */}
          {step === 5 && (
            <Card>
              <CardHeader>
                <CardTitle>Documents to Notarize</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Doc 1 */}
                <div className="p-3 rounded-lg border bg-card">
                  <h3 className="font-semibold text-sm mb-3">Document 1 *</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Type / Name</Label>
                      <Input
                        value={form.doc1Type}
                        onChange={(e) => update('doc1Type', e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={form.doc1Date}
                        onChange={(e) => update('doc1Date', e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>

                {/* Doc 2 */}
                <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                  <Checkbox
                    id="need-doc2"
                    checked={needDoc2}
                    onCheckedChange={(v) => setNeedDoc2(!!v)}
                  />
                  <Label htmlFor="need-doc2" className="cursor-pointer">
                    Additional document (2)?
                  </Label>
                </div>
                {needDoc2 && (
                  <div className="p-3 rounded-lg border bg-card">
                    <h3 className="font-semibold text-sm mb-3">Document 2</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Type / Name</Label>
                        <Input
                          value={form.doc2Type}
                          onChange={(e) => update('doc2Type', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Date</Label>
                        <Input
                          type="date"
                          value={form.doc2Date}
                          onChange={(e) => update('doc2Date', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Doc 3 */}
                <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                  <Checkbox
                    id="need-doc3"
                    checked={needDoc3}
                    onCheckedChange={(v) => setNeedDoc3(!!v)}
                  />
                  <Label htmlFor="need-doc3" className="cursor-pointer">
                    Additional document (3)?
                  </Label>
                </div>
                {needDoc3 && (
                  <div className="p-3 rounded-lg border bg-card">
                    <h3 className="font-semibold text-sm mb-3">Document 3</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Type / Name</Label>
                        <Input
                          value={form.doc3Type}
                          onChange={(e) => update('doc3Type', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Date</Label>
                        <Input
                          type="date"
                          value={form.doc3Date}
                          onChange={(e) => update('doc3Date', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* STEP 6: Payment */}
          {step === 6 && (
            <Card>
              <CardHeader>
                <CardTitle>Service &amp; Payment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Payment Method</Label>
                  <Select
                    value={form.paymentMethod}
                    onValueChange={(v) => update('paymentMethod', v)}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Credit Card">Credit Card</SelectItem>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Check">Check</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Total Amount ($) *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.totalAmount}
                    onChange={(e) => update('totalAmount', e.target.value)}
                    className="mt-1 text-lg font-bold"
                  />
                </div>
                <div>
                  <Label>Who is paying?</Label>
                  <Select
                    value={form.payerName || 'Primary Signer'}
                    onValueChange={(v) => update('payerName', v === 'Primary Signer' ? '' : v)}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Primary Signer">Primary Signer</SelectItem>
                      <SelectItem value="other">Other (type name)</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.payerName && (
                    <Input
                      placeholder="Payer name"
                      value={form.payerName}
                      onChange={(e) => update('payerName', e.target.value)}
                      className="mt-2"
                    />
                  )}
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => update('notes', e.target.value)}
                    className="mt-1"
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* STEP 7: E-Signature */}
          {step === 7 && (
            <Card>
              <CardHeader>
                <CardTitle>E-Signature</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert className="bg-muted/50 border-muted">
                  <AlertDescription className="text-xs">
                    By signing, I confirm that the signature below is my true, correct,
                    and authorized signature. I acknowledge that my signature, whether
                    handwritten or electronic, is legally binding and shall have the same
                    force and effect as a physical signature under applicable law.
                  </AlertDescription>
                </Alert>

                <div>
                  <Label>Signature *</Label>
                  <div className="mt-2 relative border-2 border-primary/30 border-dashed rounded-xl bg-white overflow-hidden min-h-[200px]">
                    <canvas
                      ref={sigCanvasRef}
                      className="w-full h-full cursor-crosshair touch-none"
                    />
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
                      <span className="text-4xl font-serif font-bold tracking-widest rotate-[-10deg]">
                        SIGN HERE
                      </span>
                    </div>
                    <div className="absolute bottom-2 right-2 z-10">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={clearSignature}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg border">
                  <Checkbox
                    id="sig-confirm"
                    checked={signatureConfirmed}
                    onCheckedChange={(v) => setSignatureConfirmed(!!v)}
                  />
                  <Label htmlFor="sig-confirm" className="text-xs cursor-pointer leading-tight">
                    Yes, I confirm that the signature above is my true, correct, and authorized
                    signature, and I agree to the terms stated herein.
                  </Label>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t bg-card px-4 py-3">
        <div className="max-w-2xl mx-auto flex justify-between gap-3">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={step === 0 || submitting}
            className="gap-2"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button onClick={nextStep} className="gap-2">
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" /> Submit Request
                </>
              )}
            </Button>
          )}
        </div>
        {submitError && (
          <p className="text-xs text-destructive text-center mt-2">{submitError}</p>
        )}
      </div>
    </div>
  );
}
