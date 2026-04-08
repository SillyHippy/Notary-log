import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import SignaturePad from 'signature_pad';
import { BrowserPDF417Reader } from '@zxing/browser';
import { createWorker } from 'tesseract.js';
import { Camera, Upload, Check, ChevronRight, AlertTriangle, ScanLine, X, Eraser, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';

import { createEntry, generateEntryHash, getSettings, type JournalEntry } from '@/lib/db';
import { parseAAMVA } from '@/lib/aamva';

const entrySchema = z.object({
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
  feeCharged: z.coerce.number().min(0),
  feeWaived: z.boolean().default(false),
  locationCity: z.string().min(1, 'Location city is required'),
  locationState: z.string().min(2, 'Location state is required'),
  locationAddress: z.string().optional(),
  notes: z.string().optional(),
});

type EntryFormValues = z.infer<typeof entrySchema>;

const STEPS = ['Scan ID', 'Signer', 'Notarial Act', 'Signature', 'Review'];

type ScanResult =
  | { method: 'barcode'; success: true }
  | { method: 'ocr'; text: string; confidence: number };

export function NewEntry() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [currentStep, setCurrentStep] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  // scanMode: 'idle' = show buttons | 'barcode-live' = live ZXing scan | 'photo-capture' = manual photo + OCR
  const [scanMode, setScanMode] = useState<'idle' | 'barcode-live' | 'photo-capture'>('idle');
  const [liveScanSuccess, setLiveScanSuccess] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [idFrontImage, setIdFrontImage] = useState<string | undefined>();
  const [idBackImage, setIdBackImage] = useState<string | undefined>();
  const [signatureImage, setSignatureImage] = useState<string | undefined>();
  const [needsReview, setNeedsReview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
      notarialActType: 'acknowledgment',
      feeCharged: 0,
      feeWaived: false,
      locationCity: '',
      locationState: '',
      notes: '',
    }
  });

  // Load defaults
  useEffect(() => {
    getSettings().then(settings => {
      form.setValue('locationCity', settings.defaultCity);
      form.setValue('locationState', settings.defaultState);
    });
  }, [form]);

  // Init SignaturePad when step 3 becomes active
  useEffect(() => {
    if (currentStep === 3 && sigCanvasRef.current) {
      // Resize canvas to parent
      const canvas = sigCanvasRef.current;
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
      
      signaturePadRef.current = new SignaturePad(canvas, {
        backgroundColor: 'rgba(255, 255, 255, 0)',
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      liveStreamRef.current = stream;
      setScanMode('barcode-live');
    } catch {
      toast({ title: 'Camera Error', description: 'Could not open camera. Use Upload Photos or Upload Image instead.', variant: 'destructive' });
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanMode('photo-capture');
    } catch {
      toast({ title: 'Camera Error', description: 'Could not open camera. Use Upload Photos instead.', variant: 'destructive' });
    }
  };

  // Attach stream to photo video element after it renders
  useEffect(() => {
    if (scanMode === 'photo-capture' && photoVideoRef.current && streamRef.current) {
      photoVideoRef.current.srcObject = streamRef.current;
    }
  }, [scanMode]);

  const applyExtractedFields = (fields: Record<string, string>) => {
    if (fields.fullName) form.setValue('signerFullName', fields.fullName);
    if (fields.address) form.setValue('signerAddress', fields.address);
    if (fields.city) form.setValue('signerCity', fields.city);
    if (fields.state) form.setValue('signerState', fields.state);
    if (fields.dob) form.setValue('signerDOB', fields.dob);
    if (fields.idNumber) form.setValue('idNumber', fields.idNumber);
    if (fields.idIssuingState) form.setValue('idIssuingState', fields.idIssuingState);
    if (fields.expirationDate) form.setValue('idExpirationDate', fields.expirationDate);
  };

  const extractFieldsFromOCRText = (text: string): Record<string, string> => {
    const fields: Record<string, string> = {};
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Name: look for "LN <last> FN <first>" or "LAST, FIRST" patterns common on IDs
    const nameLnFnMatch = text.match(/LN\s+([A-Z'-]+)\s+FN\s+([A-Z'-]+)/i);
    if (nameLnFnMatch) {
      fields.fullName = `${nameLnFnMatch[2]} ${nameLnFnMatch[1]}`;
    } else {
      const nameMatch = text.match(/([A-Z]{2,}),\s*([A-Z][A-Z '-]+)/);
      if (nameMatch) fields.fullName = `${nameMatch[2].trim()} ${nameMatch[1].trim()}`;
    }

    // DOB: MM/DD/YYYY or similar
    const dobMatch = text.match(/(?:DOB|Date of Birth|Birth)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)
      || text.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
    if (dobMatch) {
      const parts = dobMatch[1].split(/[\/\-]/);
      if (parts.length === 3) {
        const [m, d, y] = parts.map(Number);
        const year = y < 100 ? 1900 + y : y;
        fields.dob = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    // ID number: DL / ID number line
    const idMatch = text.match(/(?:DL|ID|No\.?|Lic\.?|License)[:\s#]+([A-Z0-9]{6,12})/i);
    if (idMatch) fields.idNumber = idMatch[1];

    // Expiry date
    const expMatch = text.match(/(?:EXP|Expires?|Expiry)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (expMatch) {
      const parts = expMatch[1].split(/[\/\-]/);
      if (parts.length === 3) {
        const [m, d, y] = parts.map(Number);
        const year = y < 100 ? 2000 + y : y;
        fields.expirationDate = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    // US state (2-letter) from address line
    const stateMatch = text.match(/\b([A-Z]{2})\s+\d{5}/);
    if (stateMatch) fields.state = stateMatch[1];

    // Address: look for numbered street address line
    for (const line of lines) {
      if (/^\d+\s+[A-Z]/.test(line) && !fields.address) {
        fields.address = line;
      }
    }

    return fields;
  };

  const tryOCR = async (imageSrc: string): Promise<{ text: string; confidence: number }> => {
    toast({ title: 'Scanning...', description: 'Analyzing ID text via OCR. This may take a moment.' });
    const worker = await createWorker('eng');
    const { data } = await worker.recognize(imageSrc);
    await worker.terminate();
    const fields = extractFieldsFromOCRText(data.text);
    if (Object.keys(fields).length > 0) {
      applyExtractedFields(fields);
    }
    return { text: data.text, confidence: data.confidence };
  };

  // Photo mode: run OCR only (barcode already handled by live scan)
  const processImageOCR = async (imageSrc: string) => {
    setIsScanning(true);
    try {
      const { text, confidence } = await tryOCR(imageSrc);
      if (confidence < 70) {
        setNeedsReview(true);
        toast({ title: 'Low Confidence Scan', description: 'OCR confidence is low. Please verify the extracted fields.', variant: 'destructive' });
      } else {
        toast({ title: 'Text Extracted', description: 'OCR complete. Review the extracted fields.' });
      }
      setScanResult({ method: 'ocr', text, confidence });
    } catch (err) {
      console.error(err);
      toast({ title: 'Scan Failed', description: 'Could not process the image. Please enter details manually.', variant: 'destructive' });
    }
    setIsScanning(false);
  };

  const handlePhotoCapture = () => {
    if (photoVideoRef.current && canvasRef.current) {
      const video = photoVideoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        if (!idFrontImage) {
          setIdFrontImage(dataUrl);
          toast({ title: 'Front captured', description: 'Now point at the BACK of the ID for OCR.' });
        } else {
          setIdBackImage(dataUrl);
          processImageOCR(dataUrl);
          stopPhotoCamera();
          setScanMode('idle');
        }
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isBack: boolean) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (isBack) setIdBackImage(dataUrl);
        else setIdFrontImage(dataUrl);
        processImageOCR(dataUrl);
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
      setSignatureImage(signaturePadRef.current.toDataURL('image/png'));
      setCurrentStep(4);
    } else {
      toast({ title: 'Missing Signature', description: 'Please have the signer sign the pad.', variant: 'destructive' });
    }
  };

  const nextStep = async () => {
    // Validate step before advancing
    if (currentStep === 1) {
      const isValid = await form.trigger(['signerFullName', 'signerAddress', 'signerCity', 'signerState', 'signerDOB', 'idNumber', 'idExpirationDate']);
      if (!isValid) return;
    }
    if (currentStep === 2) {
      const isValid = await form.trigger(['documentType', 'notarialActType', 'locationCity', 'locationState', 'feeCharged']);
      if (!isValid) return;
    }
    setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
  };

  const saveEntry = async (status: 'draft' | 'completed') => {
    setIsSaving(true);
    try {
      const data = form.getValues();
      
      const extractionMethod: JournalEntry['extractionMethod'] =
        scanResult?.method === 'barcode' ? 'barcode'
        : scanResult?.method === 'ocr' ? 'ocr'
        : 'manual';

      const newEntry: Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt'> = {
        status,
        ...data,
        feeCharged: Math.round(data.feeCharged * 100),
        idFrontImage,
        idBackImage,
        signatureImage,
        needsReview,
        extractionMethod,
        extractedRawText: scanResult?.method === 'ocr' ? scanResult.text : undefined,
        extractionConfidence: scanResult?.method === 'ocr' ? scanResult.confidence : undefined,
        completedAt: status === 'completed' ? new Date().toISOString() : undefined,
      };

      const id = await createEntry(newEntry);
      
      // Generate hash for completed entries
      if (status === 'completed') {
        const { getEntry, updateEntry } = await import('@/lib/db');
        const entry = await getEntry(id);
        if (entry) {
          const hash = await generateEntryHash(entry);
          await updateEntry(id, { hash });
        }
      }
      
      toast({ title: 'Success', description: `Entry saved as ${status}.` });
      setLocation(`/entry/${id}`);
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to save entry.', variant: 'destructive' });
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto h-full flex flex-col pb-24 md:pb-8">
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

            {/* ── IDLE: Choose how to scan ── */}
            {scanMode === 'idle' && !liveScanSuccess && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 text-center">
                <ScanLine className="w-12 h-12 text-primary mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2">Scan Signer ID</h2>
                <p className="text-muted-foreground max-w-md mx-auto mb-6 text-sm">
                  Point the camera at the <strong>barcode on the back</strong> of the license for instant fill-in. Use photo mode if the barcode won't read.
                </p>
                <div className="flex flex-col sm:flex-row justify-center gap-3">
                  <Button onClick={startLiveScan} className="gap-2" size="lg">
                    <ScanLine className="w-5 h-5" /> Scan Barcode
                  </Button>
                  <Button onClick={startPhotoCapture} variant="outline" size="lg" className="gap-2">
                    <Camera className="w-5 h-5" /> Take Photos (OCR)
                  </Button>
                  <div className="relative">
                    <Button variant="ghost" size="lg" className="gap-2 w-full">
                      <Upload className="w-5 h-5" /> Upload Image
                    </Button>
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => handleFileUpload(e, !!idFrontImage)}
                    />
                  </div>
                </div>
              </div>
            )}

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
                <div className="flex justify-center gap-3">
                  <Button onClick={() => setCurrentStep(1)} className="gap-2">
                    <Check className="w-4 h-4" /> Review Signer Info
                  </Button>
                  <Button variant="ghost" onClick={() => { setLiveScanSuccess(false); setScanMode('idle'); }} size="sm">
                    Rescan
                  </Button>
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
                    {!idFrontImage ? 'Capture: FRONT of ID' : 'Capture: BACK of ID (for OCR)'}
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
                    <Button size="icon" className="rounded-full w-16 h-16" onClick={handlePhotoCapture}>
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
                  <div className="relative rounded-lg overflow-hidden border">
                    <img src={idFrontImage} alt="ID Front" className="w-full h-28 object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 text-center font-medium">Front</div>
                  </div>
                )}
                {idBackImage && (
                  <div className="relative rounded-lg overflow-hidden border">
                    <img src={idBackImage} alt="ID Back" className="w-full h-28 object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 text-center font-medium">Back</div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end mt-auto pt-4">
              <Button variant="ghost" onClick={() => setCurrentStep(1)} className="text-muted-foreground text-sm">
                Skip Scanning <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 1 & 2: FORMS */}
        {(currentStep === 1 || currentStep === 2) && (
          <div className="flex-1 overflow-y-auto pr-2 pb-4">
            {needsReview && currentStep === 1 && (
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
                          <FormLabel>Street Address *</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="signerCity" render={({ field }) => (
                        <FormItem>
                          <FormLabel>City *</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="signerState" render={({ field }) => (
                        <FormItem>
                          <FormLabel>State *</FormLabel>
                          <FormControl><Input {...field} maxLength={2} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="signerDOB" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date of Birth *</FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
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
                      <FormField control={form.control} name="idNumber" render={({ field }) => (
                        <FormItem>
                          <FormLabel>ID Number *</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="idIssuingState" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Issuing State/Authority</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="idExpirationDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Expiration Date *</FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
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
                        <FormItem>
                          <FormLabel>Document Type *</FormLabel>
                          <FormControl><Input placeholder="e.g. Warranty Deed" {...field} /></FormControl>
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
                      
                      <div className="md:col-span-2 grid grid-cols-2 gap-4 border-y py-4 my-2">
                        <FormField control={form.control} name="locationCity" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Location City *</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="locationState" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Location State *</FormLabel>
                            <FormControl><Input {...field} maxLength={2} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>

                      <FormField control={form.control} name="feeCharged" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fee Charged ($)</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.01" 
                                min="0" 
                                {...field} 
                                disabled={form.watch('feeWaived')}
                                value={form.watch('feeWaived') ? 0 : field.value}
                              />
                            </FormControl>
                            <Button 
                              type="button" 
                              variant={form.watch('feeWaived') ? 'default' : 'outline'} 
                              onClick={() => {
                                const isWaived = !form.getValues('feeWaived');
                                form.setValue('feeWaived', isWaived);
                                if (isWaived) form.setValue('feeCharged', 0);
                              }}
                            >
                              Waive Fee
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )} />
                      
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
        {currentStep === 3 && (
          <div className="flex-1 flex flex-col h-full space-y-4">
            <div className="bg-muted/30 p-4 rounded-lg border text-center">
              <h3 className="font-semibold text-lg">Signer Signature Required</h3>
              <p className="text-sm text-muted-foreground mt-1">Please have {form.getValues('signerFullName') || 'the signer'} sign inside the box below.</p>
            </div>
            
            <div className="flex-1 relative border-2 border-primary/30 border-dashed rounded-xl bg-white overflow-hidden min-h-[300px]">
              <canvas ref={sigCanvasRef} className="w-full h-full cursor-crosshair touch-none"></canvas>
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
        {currentStep === 4 && (
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
                  <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Name:</span> <span className="col-span-2 font-medium">{form.getValues('signerFullName')}</span></div>
                  <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Address:</span> <span className="col-span-2">{form.getValues('signerAddress')}, {form.getValues('signerCity')}, {form.getValues('signerState')}</span></div>
                  <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">DOB:</span> <span className="col-span-2">{form.getValues('signerDOB')}</span></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 bg-muted/50 border-b">
                  <CardTitle className="text-sm font-medium">Identification</CardTitle>
                </CardHeader>
                <CardContent className="py-4 text-sm space-y-2">
                  <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Type:</span> <span className="col-span-2 capitalize">{form.getValues('idType').replace('_', ' ')}</span></div>
                  <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Number:</span> <span className="col-span-2">{form.getValues('idNumber')}</span></div>
                  <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Expires:</span> <span className="col-span-2">{form.getValues('idExpirationDate')}</span></div>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader className="py-3 bg-muted/50 border-b">
                  <CardTitle className="text-sm font-medium">Notarial Act</CardTitle>
                </CardHeader>
                <CardContent className="py-4 text-sm space-y-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="grid grid-cols-3 gap-1 mb-2"><span className="text-muted-foreground">Act Type:</span> <span className="col-span-2 font-medium capitalize">{form.getValues('notarialActType').replace('_', ' ')}</span></div>
                    <div className="grid grid-cols-3 gap-1 mb-2"><span className="text-muted-foreground">Document:</span> <span className="col-span-2">{form.getValues('documentType')}</span></div>
                    <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Date:</span> <span className="col-span-2">{form.getValues('documentDate')}</span></div>
                  </div>
                  <div>
                    <div className="grid grid-cols-3 gap-1 mb-2"><span className="text-muted-foreground">Location:</span> <span className="col-span-2">{form.getValues('locationCity')}, {form.getValues('locationState')}</span></div>
                    <div className="grid grid-cols-3 gap-1"><span className="text-muted-foreground">Fee:</span> <span className="col-span-2 font-medium">{form.getValues('feeWaived') ? 'Waived' : `$${Number(form.getValues('feeCharged')).toFixed(2)}`}</span></div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="mt-6 pt-4 border-t border-border flex justify-between gap-4">
        <Button 
          variant="outline" 
          onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
          disabled={currentStep === 0 || isSaving}
        >
          Back
        </Button>
        
        {currentStep < 3 && (
          <Button onClick={nextStep} className="gap-2">
            Next Step <ChevronRight className="w-4 h-4" />
          </Button>
        )}
        
        {currentStep === 3 && (
          <Button onClick={confirmSignature} className="gap-2">
            Confirm Signature <ChevronRight className="w-4 h-4" />
          </Button>
        )}
        
        {currentStep === 4 && (
          <div className="flex gap-3 w-full sm:w-auto">
            <Button variant="secondary" onClick={() => saveEntry('draft')} disabled={isSaving}>
              Save Draft
            </Button>
            <Button onClick={() => saveEntry('completed')} disabled={isSaving} className="flex-1 sm:flex-none">
              {isSaving ? 'Completing...' : 'Complete Entry'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
