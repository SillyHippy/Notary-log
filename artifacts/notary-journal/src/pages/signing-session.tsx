import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import SignaturePad from 'signature_pad';
import {
  Check, ChevronRight, Plus, Trash2, Eraser, CheckCircle2, Loader2,
  MapPin, FileStack, User,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IdScanCard } from '@/components/id-scan-card';
import { useToast } from '@/hooks/use-toast';
import {
  createAndCompleteSigningSession,
  getSettings,
  shouldRecordSignerDOB,
  shouldRecordSignerIdNumber,
  shouldRequireSignature,
  type JournalEntry,
  type NotarySettings,
} from '@/lib/db';
import {
  generateSigningGroupId,
  type SigningActRow,
  type SigningSessionPayload,
} from '@/lib/signing-session';
import { ACT_TYPE_TO_FEE_TYPE, FEE_TYPES, computeStampFeeCents, getStampFeeCents } from '@/lib/fees';
import { getMissingSigningActFields, getMissingSigningSessionSharedFields } from '@/lib/completion';
import { hapticSuccess } from '@/lib/haptic';

const BASE_STEPS = ['Signer & ID', 'Documents', 'Location', 'Signature', 'Review'] as const;

function reviewStepIndex(settings: NotarySettings | null): number {
  return shouldRequireSignature(settings ?? undefined) ? 4 : 3;
}

function signatureStepIndex(settings: NotarySettings | null): number {
  return shouldRequireSignature(settings ?? undefined) ? 3 : -1;
}

function emptyAct(settings: NotarySettings | null): SigningActRow & { feeType: string } {
  const stamp = getStampFeeCents(settings ?? undefined);
  return {
    documentType: '',
    documentDescription: '',
    documentDate: new Date().toISOString().split('T')[0],
    notarialActType: 'acknowledgment',
    feeType: 'Acknowledgment',
    feeChargedCents: stamp,
    stampCount: 1,
    feeWaived: false,
  };
}

export function SigningSession() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [settings, setSettings] = useState<NotarySettings | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [completedIds, setCompletedIds] = useState<number[] | null>(null);

  const [signingGroupId] = useState(() => generateSigningGroupId());
  const [signingGroupLabel, setSigningGroupLabel] = useState('');

  const [signerFullName, setSignerFullName] = useState('');
  const [signerAddress, setSignerAddress] = useState('');
  const [signerCity, setSignerCity] = useState('');
  const [signerState, setSignerState] = useState('');
  const [signerDOB, setSignerDOB] = useState('');
  const [signerPhone, setSignerPhone] = useState('');
  const [idType, setIdType] = useState<JournalEntry['idType']>('driver_license');
  const [idNumber, setIdNumber] = useState('');
  const [idIssuingState, setIdIssuingState] = useState('');
  const [idExpirationDate, setIdExpirationDate] = useState('');
  const [idFrontImage, setIdFrontImage] = useState<string | undefined>();
  const [idBackImage, setIdBackImage] = useState<string | undefined>();
  const [extractionMethod, setExtractionMethod] = useState<JournalEntry['extractionMethod']>();
  const [extractionConfidence, setExtractionConfidence] = useState<number | undefined>();
  const [extractedRawText, setExtractedRawText] = useState<string | undefined>();

  const [acts, setActs] = useState<Array<SigningActRow & { feeType: string }>>([emptyAct(null)]);
  const [locationCity, setLocationCity] = useState('');
  const [locationState, setLocationState] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [notes, setNotes] = useState('');

  const [signatureImage, setSignatureImage] = useState<string | undefined>();
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const signaturePadRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s);
      setLocationCity(s.defaultCity || '');
      setLocationState(s.defaultState || '');
      setActs([emptyAct(s)]);
    }).catch(() => setSettings(null));
  }, []);

  useEffect(() => {
    const sigStep = signatureStepIndex(settings);
    if (currentStep === sigStep && sigStep >= 0 && sigCanvasRef.current) {
      const canvas = sigCanvasRef.current;
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = 200;
      }
      signaturePadRef.current = new SignaturePad(canvas, {
        backgroundColor: 'rgb(255, 255, 255)',
        penColor: 'rgb(0, 0, 0)',
      });
    }
  }, [currentStep, settings]);

  const steps = shouldRequireSignature(settings ?? undefined)
    ? [...BASE_STEPS]
    : BASE_STEPS.filter(s => s !== 'Signature');

  const updateAct = (index: number, patch: Partial<SigningActRow & { feeType: string }>) => {
    setActs(prev => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const addAct = () => {
    setActs(prev => [...prev, emptyAct(settings)]);
  };

  const removeAct = (index: number) => {
    if (acts.length <= 1) return;
    setActs(prev => prev.filter((_, i) => i !== index));
  };

  const applyScanFields = (fields: Record<string, string>) => {
    if (fields.signerFullName) setSignerFullName(fields.signerFullName);
    if (fields.signerAddress) setSignerAddress(fields.signerAddress);
    if (fields.signerCity) setSignerCity(fields.signerCity);
    if (fields.signerState) setSignerState(fields.signerState);
    if (fields.signerDOB) setSignerDOB(fields.signerDOB);
    if (fields.idNumber) setIdNumber(fields.idNumber);
    if (fields.idIssuingState) setIdIssuingState(fields.idIssuingState);
    if (fields.idExpirationDate) setIdExpirationDate(fields.idExpirationDate);
  };

  const nextStep = () => {
    if (currentStep === 0) {
      const missing = getMissingSigningSessionSharedFields(
        {
          signerFullName, signerAddress, signerCity, signerState, signerDOB,
          idNumber, idExpirationDate, idType, idFrontImage,
        },
        settings,
      );
      if (missing.length) {
        toast({ title: 'Missing fields', description: missing.join(', '), variant: 'destructive' });
        return;
      }
    }
    if (currentStep === 1) {
      const missing = getMissingSigningActFields(acts);
      if (missing.length) {
        toast({ title: 'Missing documents', description: missing.join(', '), variant: 'destructive' });
        return;
      }
    }
    if (currentStep === 2) {
      if (!locationCity.trim() || locationState.trim().length < 2) {
        toast({ title: 'Location required', description: 'Enter city and state.', variant: 'destructive' });
        return;
      }
    }
    setCurrentStep(s => Math.min(s + 1, reviewStepIndex(settings)));
  };

  const confirmSignature = () => {
    if (signaturePadRef.current && !signaturePadRef.current.isEmpty()) {
      setSignatureImage(signaturePadRef.current.toDataURL('image/png'));
      setCurrentStep(reviewStepIndex(settings));
    } else {
      toast({ title: 'Missing signature', description: 'Please have the signer sign the pad.', variant: 'destructive' });
    }
  };

  const clearSignature = () => {
    signaturePadRef.current?.clear();
    setSignatureImage(undefined);
  };

  const completeSession = async () => {
    setIsSaving(true);
    try {
      const payload: SigningSessionPayload = {
        signingGroupId,
        signingGroupLabel: signingGroupLabel.trim() || undefined,
        shared: {
          signerFullName: signerFullName.trim(),
          signerAddress: signerAddress.trim(),
          signerCity: signerCity.trim(),
          signerState: signerState.trim(),
          signerDOB: signerDOB || undefined,
          signerPhone: signerPhone || undefined,
          idType,
          idNumber: idNumber || undefined,
          idIssuingState: idIssuingState || undefined,
          idExpirationDate: idExpirationDate || undefined,
          idFrontImage,
          idBackImage,
          signatureImage: shouldRequireSignature(settings ?? undefined) ? signatureImage : undefined,
          locationCity: locationCity.trim(),
          locationState: locationState.trim(),
          locationAddress: locationAddress || undefined,
          notes: notes || undefined,
          extractionMethod,
          extractionConfidence,
          extractedRawText,
        },
        acts: acts.map(a => ({
          documentType: a.documentType.trim(),
          documentDescription: a.documentDescription,
          documentDate: a.documentDate,
          notarialActType: a.notarialActType,
          feeType: a.feeType,
          feeChargedCents: a.feeWaived ? 0 : a.feeChargedCents,
          feeWaived: a.feeWaived,
          stampCount: a.stampCount ?? 1,
        })),
      };

      const ids = await createAndCompleteSigningSession(payload);
      hapticSuccess();
      toast({
        title: 'Signing complete',
        description: `${ids.length} journal ${ids.length === 1 ? 'entry' : 'entries'} created.`,
      });
      setCompletedIds(ids);
      setIsSaving(false);
    } catch (err) {
      toast({
        title: 'Failed to complete signing',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      setIsSaving(false);
    }
  };

  const recordDOB = shouldRecordSignerDOB(settings ?? undefined);
  const recordId = shouldRecordSignerIdNumber(settings ?? undefined);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto h-full flex flex-col pb-24 md:pb-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1 tracking-tight">Signing Session</h1>
        <p className="text-sm text-muted-foreground mb-6">
          One signer, multiple documents — each prints as a separate journal line.
        </p>
        <div className="flex items-center justify-between relative">
          <div className="absolute left-0 top-1/2 w-full h-1 bg-muted -z-10 -translate-y-1/2 rounded-full" />
          <div
            className="absolute left-0 top-1/2 h-1 bg-primary -z-10 -translate-y-1/2 rounded-full transition-all duration-300"
            style={{ width: `${(currentStep / Math.max(steps.length - 1, 1)) * 100}%` }}
          />
          {steps.map((step, i) => (
            <div key={step} className="flex flex-col items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm transition-colors ${
                i < currentStep ? 'bg-primary text-primary-foreground'
                  : i === currentStep ? 'bg-primary ring-4 ring-primary/20 text-primary-foreground'
                    : 'bg-card border-2 border-muted-foreground/30 text-muted-foreground'
              }`}>
                {i < currentStep ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className="text-[10px] sm:text-xs font-medium text-muted-foreground hidden sm:block max-w-[4.5rem] text-center leading-tight">
                {step}
              </span>
            </div>
          ))}
        </div>
      </div>

      {currentStep === 0 && (
        <div className="space-y-6 flex-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="w-5 h-5 text-primary" /> Signer &amp; identification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <IdScanCard
                idType={idType}
                initialFrontImage={idFrontImage}
                initialBackImage={idBackImage}
                onScan={({ frontImage, backImage, result }) => {
                  if (frontImage) setIdFrontImage(frontImage);
                  if (backImage) setIdBackImage(backImage);
                  applyScanFields(result.fields);
                  setExtractionMethod(result.extraction.method as JournalEntry['extractionMethod']);
                  if (result.extraction.confidence != null) setExtractionConfidence(result.extraction.confidence);
                  if (result.extraction.text) setExtractedRawText(result.extraction.text);
                }}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium">Full name</label>
                  <Input value={signerFullName} onChange={e => setSignerFullName(e.target.value)} data-testid="session-signer-name" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium">Address</label>
                  <Input value={signerAddress} onChange={e => setSignerAddress(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">City</label>
                  <Input value={signerCity} onChange={e => setSignerCity(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">State</label>
                  <Input value={signerState} onChange={e => setSignerState(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
                </div>
                {recordDOB && (
                  <div>
                    <label className="text-sm font-medium">Date of birth</label>
                    <Input type="date" value={signerDOB} onChange={e => setSignerDOB(e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium">Phone</label>
                  <Input value={signerPhone} onChange={e => setSignerPhone(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">ID type</label>
                  <Select value={idType} onValueChange={v => setIdType(v as JournalEntry['idType'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="driver_license">Driver&apos;s license</SelectItem>
                      <SelectItem value="state_id">State ID</SelectItem>
                      <SelectItem value="passport">Passport</SelectItem>
                      <SelectItem value="military_id">Military ID</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {recordId && (
                  <div>
                    <label className="text-sm font-medium">ID number</label>
                    <Input value={idNumber} onChange={e => setIdNumber(e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium">ID expiration</label>
                  <Input type="date" value={idExpirationDate} onChange={e => setIdExpirationDate(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {currentStep === 1 && (
        <div className="space-y-4 flex-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileStack className="w-5 h-5 text-primary" /> Documents &amp; acts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Signing label (optional)</label>
                <Input
                  placeholder="e.g. Western Sierra loan signing"
                  value={signingGroupLabel}
                  onChange={e => setSigningGroupLabel(e.target.value)}
                  data-testid="session-group-label"
                />
                <p className="text-xs text-muted-foreground mt-1">Shown in the journal when grouped.</p>
              </div>
              {acts.map((act, i) => (
                <div key={i} className="rounded-lg border p-4 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">Act {i + 1}</span>
                    {acts.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeAct(i)} className="text-destructive h-8">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="text-sm font-medium">Document type</label>
                      <Input
                        placeholder="Affidavit of Service, Warranty Deed, …"
                        value={act.documentType}
                        onChange={e => updateAct(i, { documentType: e.target.value })}
                        data-testid={`session-doc-type-${i}`}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-sm font-medium">Description (optional)</label>
                      <Input
                        value={act.documentDescription ?? ''}
                        onChange={e => updateAct(i, { documentDescription: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Act type</label>
                      <Select
                        value={act.notarialActType}
                        onValueChange={v => {
                          const actType = v as JournalEntry['notarialActType'];
                          const feeType = ACT_TYPE_TO_FEE_TYPE[actType];
                          const feeCents = computeStampFeeCents(act.stampCount ?? 1, settings);
                          updateAct(i, { notarialActType: actType, feeType, feeChargedCents: feeCents });
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="acknowledgment">Acknowledgment</SelectItem>
                          <SelectItem value="jurat">Jurat</SelectItem>
                          <SelectItem value="copy_certification">Copy certification</SelectItem>
                          <SelectItem value="signature_witnessing">Signature witnessing</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Document date</label>
                      <Input
                        type="date"
                        value={act.documentDate ?? ''}
                        onChange={e => updateAct(i, { documentDate: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Stamps</label>
                      <Input
                        type="number"
                        min={1}
                        value={act.stampCount ?? 1}
                        onChange={e => {
                          const count = Math.max(1, parseInt(e.target.value, 10) || 1);
                          updateAct(i, {
                            stampCount: count,
                            feeChargedCents: computeStampFeeCents(count, settings),
                          });
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Fee ($)</label>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        disabled={act.feeWaived}
                        value={(act.feeChargedCents / 100).toFixed(2)}
                        onChange={e => updateAct(i, { feeChargedCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                      />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={act.feeWaived ?? false}
                          onChange={e => updateAct(i, { feeWaived: e.target.checked })}
                        />
                        Fee waived
                      </label>
                    </div>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={addAct} className="w-full gap-2" data-testid="session-add-act">
                <Plus className="w-4 h-4" /> Add another document
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {currentStep === 2 && (
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MapPin className="w-5 h-5 text-primary" /> Location
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">City</label>
                <Input value={locationCity} onChange={e => setLocationCity(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">State</label>
                <Input value={locationState} onChange={e => setLocationState(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Address (optional)</label>
                <Input value={locationAddress} onChange={e => setLocationAddress(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Notes (optional)</label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === signatureStepIndex(settings) && (
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-lg">Signer signature</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              One signature applies to all {acts.length} act{acts.length === 1 ? '' : 's'} in this session.
            </p>
            <div className="border rounded-lg overflow-hidden bg-white">
              <canvas ref={sigCanvasRef} className="w-full touch-none" style={{ height: 200 }} />
            </div>
            <div className="flex gap-2 mt-3">
              <Button type="button" variant="outline" size="sm" onClick={clearSignature} className="gap-1">
                <Eraser className="w-4 h-4" /> Clear
              </Button>
            </div>
            {signatureImage && (
              <p className="text-sm text-emerald-600 mt-2 flex items-center gap-1">
                <Check className="w-4 h-4" /> Signature captured
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {currentStep === reviewStepIndex(settings) && (
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-lg">Review &amp; complete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
              <p><span className="text-muted-foreground">Signer:</span> <strong>{signerFullName}</strong></p>
              <p><span className="text-muted-foreground">Location:</span> {locationCity}, {locationState}</p>
              {signingGroupLabel && (
                <p><span className="text-muted-foreground">Label:</span> {signingGroupLabel}</p>
              )}
              <p><span className="text-muted-foreground">Acts:</span> {acts.length} (separate journal lines on print)</p>
            </div>
            <ul className="space-y-2">
              {acts.map((act, i) => (
                <li key={i} className="flex justify-between text-sm border-b pb-2">
                  <span>{act.documentType || `Act ${i + 1}`}</span>
                  <span className="text-muted-foreground capitalize">
                    {act.notarialActType.replace('_', ' ')}
                    {' · '}
                    {act.feeWaived ? 'Waived' : `$${(act.feeChargedCents / 100).toFixed(2)}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {completedIds === null && (
        <div className="mt-8 flex justify-between items-center gap-3 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
            disabled={currentStep === 0 || isSaving}
          >
            Back
          </Button>
          <div className="flex gap-3">
            {currentStep < reviewStepIndex(settings) && currentStep !== signatureStepIndex(settings) && (
              <Button onClick={nextStep} className="gap-2" data-testid="session-next">
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            )}
            {currentStep === signatureStepIndex(settings) && (
              <Button onClick={confirmSignature} className="gap-2">
                Confirm signature <ChevronRight className="w-4 h-4" />
              </Button>
            )}
            {currentStep === reviewStepIndex(settings) && (
              <Button onClick={completeSession} disabled={isSaving} data-testid="session-complete">
                {isSaving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Completing…</>
                ) : (
                  `Complete ${acts.length} ${acts.length === 1 ? 'entry' : 'entries'}`
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      {completedIds !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-lg font-semibold">Signing saved</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {completedIds.length} journal {completedIds.length === 1 ? 'entry' : 'entries'} created and sealed.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button onClick={() => setLocation(`/entry/${completedIds[0]}`)} className="w-full">
                View first entry
              </Button>
              <Button variant="outline" onClick={() => setLocation('/journal')} className="w-full">
                Back to journal
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setCompletedIds(null);
                  setCurrentStep(0);
                  setActs([emptyAct(settings)]);
                  setSignerFullName('');
                  setSignerAddress('');
                  setSignerCity('');
                  setSignerState('');
                  setSignerDOB('');
                  setIdFrontImage(undefined);
                  setIdBackImage(undefined);
                  setSignatureImage(undefined);
                  setSigningGroupLabel('');
                }}
                className="w-full text-muted-foreground"
              >
                New signing session
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
