import { useEffect, useRef, useState } from 'react';
import { BrowserPDF417Reader } from '@zxing/browser';
import { createWorker } from 'tesseract.js';
import { Camera, Upload, ScanLine, Loader2, CheckCircle2, AlertTriangle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { parseAAMVA } from '@/lib/aamva';
import { extractLicenseFields } from '@/lib/ocr-license';
import { parseMRZ, mrzToSignerFields } from '@/lib/mrz';

export type ScanExtraction = {
  method: 'barcode' | 'ocr' | 'mrz';
  text?: string;
  confidence?: number;
};

export type ScanResultPayload = {
  fields: Record<string, string>;
  extraction: ScanExtraction;
  warning?: string;
};

interface IdScanCardProps {
  /** Currently-selected idType from the host form. Drives extraction strategy. */
  idType: 'driver_license' | 'passport' | 'state_id' | 'military_id' | 'other';
  /** Existing front/back images on the entry, if any. */
  initialFrontImage?: string;
  initialBackImage?: string;
  /**
   * Called with the new images and extracted fields whenever the user
   * captures or uploads. The host (edit page) is responsible for applying
   * the fields to its form and updating its image state for save.
   */
  onScan: (payload: {
    frontImage?: string;
    backImage?: string;
    result: ScanResultPayload;
  }) => void;
  /** Optional auto-open hint — defaults to expanded. */
  defaultExpanded?: boolean;
}

/**
 * Reusable ID-scan UI for draft entries on the edit page. Mirrors the same
 * three-mode flow used in the new-entry wizard:
 *   - Live PDF417 barcode scan (camera + ZXing video reader) for licenses
 *   - Photo capture / file upload + OCR fallback (front/back of card)
 *   - Manual entry — the host form's signer/ID inputs are always editable
 *     beneath the card, so a notary can always type the data by hand.
 *
 * For licenses we first try a PDF417 decode of the (back-of-card) image,
 * since the barcode contains all the structured AAMVA fields. If that fails
 * or returns nothing useful, we fall back to OCR. Passports go straight to
 * OCR + MRZ parsing.
 */
export function IdScanCard({
  idType,
  initialFrontImage,
  initialBackImage,
  onScan,
  defaultExpanded = true,
}: IdScanCardProps) {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isScanning, setIsScanning] = useState(false);
  const [frontImage, setFrontImage] = useState<string | undefined>(initialFrontImage);
  const [backImage, setBackImage] = useState<string | undefined>(initialBackImage);
  const [lastResult, setLastResult] = useState<ScanResultPayload | null>(null);
  const [liveScanActive, setLiveScanActive] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveReaderRef = useRef<BrowserPDF417Reader | null>(null);
  const liveLoopActiveRef = useRef(false);

  const isPassport = idType === 'passport';

  const stopLiveScan = () => {
    liveLoopActiveRef.current = false;
    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach((t) => t.stop());
      liveStreamRef.current = null;
    }
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null;
    }
    liveReaderRef.current = null;
    setLiveScanActive(false);
  };

  // Make absolutely sure the camera stream is released when the card
  // unmounts (e.g. user navigates away mid-scan).
  useEffect(() => {
    return () => {
      stopLiveScan();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Open the rear camera and run a PDF417 frame loop until we either decode
   * a barcode or the user cancels. Captures the snapshot frame as the
   * "back of ID" image so the host entry has visible evidence of the scan.
   */
  const startLiveScan = async () => {
    if (isPassport) {
      toast({
        title: 'Passports use photo mode',
        description: 'Live barcode scan is for driver licenses and state IDs only.',
      });
      return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera not available in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      liveStreamRef.current = stream;
      liveReaderRef.current = new BrowserPDF417Reader();
      setLiveScanActive(true);
    } catch (err) {
      console.error('Live scan camera error', err);
      toast({
        title: 'Camera unavailable',
        description: 'Use Upload / Camera below to capture a photo instead.',
        variant: 'destructive',
      });
      stopLiveScan();
    }
  };

  // Once the video element is mounted, attach the stream and start a
  // throttled frame-grab loop that tries to decode a PDF417 barcode.
  useEffect(() => {
    if (!liveScanActive || !liveVideoRef.current || !liveStreamRef.current) return;
    const videoEl = liveVideoRef.current;
    videoEl.srcObject = liveStreamRef.current;
    videoEl.setAttribute('playsinline', 'true');

    let lastAttempt = 0;
    let raf = 0;
    liveLoopActiveRef.current = true;

    const tryFrame = () => {
      if (!liveLoopActiveRef.current) return;
      const now = performance.now();
      // Throttle to ~2.5 fps — PDF417 decode is CPU-heavy on phones.
      if (
        now - lastAttempt >= 400 &&
        videoEl.readyState >= videoEl.HAVE_ENOUGH_DATA &&
        videoEl.videoWidth > 0
      ) {
        lastAttempt = now;
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx && liveReaderRef.current) {
          try {
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
            const result = liveReaderRef.current.decodeFromCanvas(canvas);
            if (result) {
              const fields = parseAAMVA(result.getText()) as Record<string, string>;
              if (Object.keys(fields).length > 0) {
                // Capture the frame as the back-of-ID image so the entry
                // has visible scan evidence.
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                liveLoopActiveRef.current = false;
                stopLiveScan();
                const payload: ScanResultPayload = {
                  fields,
                  extraction: { method: 'barcode' },
                };
                setBackImage(dataUrl);
                setLastResult(payload);
                onScan({ frontImage, backImage: dataUrl, result: payload });
                toast({
                  title: 'Barcode Scanned!',
                  description: 'Data extracted. Review the fields below.',
                });
                return;
              }
            }
          } catch {
            // ZXing throws when no barcode is present in the frame —
            // ignore and try the next one.
          }
        }
      }
      raf = requestAnimationFrame(tryFrame);
    };

    videoEl
      .play()
      .then(() => {
        raf = requestAnimationFrame(tryFrame);
      })
      .catch((err) => {
        console.error('Could not start live video', err);
        toast({
          title: 'Camera Error',
          description: 'Could not start live preview. Try Upload / Camera below.',
          variant: 'destructive',
        });
        stopLiveScan();
      });

    return () => {
      liveLoopActiveRef.current = false;
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveScanActive]);

  const tryDecodeBarcode = async (dataUrl: string): Promise<Record<string, string> | null> => {
    try {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const reader = new BrowserPDF417Reader();
      const result = reader.decodeFromCanvas(canvas);
      if (!result) return null;
      const fields = parseAAMVA(result.getText());
      return Object.keys(fields).length > 0 ? (fields as Record<string, string>) : null;
    } catch {
      // No barcode found in this image — caller should fall back to OCR.
      return null;
    }
  };

  const runOcr = async (dataUrl: string): Promise<{ text: string; confidence: number }> => {
    const worker = await createWorker('eng');
    const { data } = await worker.recognize(dataUrl);
    await worker.terminate();
    return { text: data.text, confidence: data.confidence };
  };

  const processImage = async (dataUrl: string, side: 'front' | 'back') => {
    setIsScanning(true);
    try {
      // Passport: single page → MRZ via OCR.
      if (isPassport) {
        toast({ title: 'Scanning passport…', description: 'Reading the MRZ. This may take a moment.' });
        const { text, confidence } = await runOcr(dataUrl);
        const mrz = parseMRZ(text);
        if (mrz.ok && mrz.passport) {
          const fields = mrzToSignerFields(mrz.passport) as Record<string, string>;
          let warning: string | undefined;
          const lowConfidence = confidence < 70;
          if (!mrz.passport.allCheckDigitsValid || lowConfidence) {
            const failing = Object.entries(mrz.passport.checkDigits)
              .filter(([, ok]) => !ok)
              .map(([name]) => name);
            const parts: string[] = [];
            if (failing.length > 0) parts.push(`MRZ check digit mismatch (${failing.join(', ')})`);
            if (lowConfidence) parts.push(`low OCR confidence (${Math.round(confidence)}%)`);
            warning = `${parts.join(' and ')} — please verify before saving.`;
          }
          const payload: ScanResultPayload = {
            fields,
            extraction: { method: 'mrz', text, confidence },
            warning,
          };
          setLastResult(payload);
          onScan({ frontImage: dataUrl, backImage: undefined, result: payload });
          toast({
            title: warning ? 'MRZ Read with Warnings' : 'Passport MRZ Read',
            description: warning ?? 'Passport data extracted. Review the fields.',
            variant: warning ? 'destructive' : 'default',
          });
        } else {
          // Persist the photo even when MRZ parsing fails — the image itself
          // is evidence the notary captured during the act, and we don't want
          // a failed extraction to silently drop it from the saved entry.
          const payload: ScanResultPayload = {
            fields: {},
            extraction: { method: 'mrz', text, confidence },
            warning: 'MRZ not detected — please enter passport details manually.',
          };
          setLastResult(payload);
          onScan({ frontImage: dataUrl, backImage: undefined, result: payload });
          toast({
            title: 'MRZ Not Found',
            description: 'Image saved as evidence, but no MRZ detected. Enter the details manually.',
            variant: 'destructive',
          });
        }
        return;
      }

      // License / state ID: prefer PDF417 barcode (back of card), then OCR.
      let fields: Record<string, string> | null = null;
      let extraction: ScanExtraction;
      let confidenceText: string | undefined;

      // The back of the card holds the barcode; for the front upload we still
      // try a barcode decode in case the user uploaded the back as "front".
      toast({ title: 'Scanning ID…', description: 'Trying barcode first, then OCR if needed.' });
      const barcodeFields = await tryDecodeBarcode(dataUrl);
      if (barcodeFields) {
        fields = barcodeFields;
        extraction = { method: 'barcode' };
      } else {
        const { text, confidence } = await runOcr(dataUrl);
        const ocrFields = extractLicenseFields(text);
        fields = (ocrFields ?? null) as Record<string, string> | null;
        extraction = { method: 'ocr', text, confidence };
        if (confidence < 70) {
          confidenceText = `Low OCR confidence (${Math.round(confidence)}%) — verify the extracted fields.`;
        }
      }

      if (!fields || Object.keys(fields).length === 0) {
        toast({
          title: 'Nothing Extracted',
          description: 'Could not read structured data from this image. You can still save it as a reference photo.',
          variant: 'destructive',
        });
        // Still save the image — it's evidence even if no text came out.
        if (side === 'front') {
          setFrontImage(dataUrl);
          onScan({ frontImage: dataUrl, backImage, result: { fields: {}, extraction } });
        } else {
          setBackImage(dataUrl);
          onScan({ frontImage, backImage: dataUrl, result: { fields: {}, extraction } });
        }
        return;
      }

      const payload: ScanResultPayload = {
        fields,
        extraction,
        warning: confidenceText,
      };
      setLastResult(payload);

      if (side === 'front') {
        setFrontImage(dataUrl);
        onScan({ frontImage: dataUrl, backImage, result: payload });
      } else {
        setBackImage(dataUrl);
        onScan({ frontImage, backImage: dataUrl, result: payload });
      }

      toast({
        title: extraction.method === 'barcode' ? 'Barcode Scanned!' : 'Text Extracted',
        description: confidenceText ?? 'Data extracted. Review the fields.',
        variant: confidenceText ? 'destructive' : 'default',
      });
    } catch (err) {
      console.error('Scan failed', err);
      // Even on a hard failure, push the captured image up so the user
      // doesn't lose what they just photographed. They can fill in fields
      // manually and re-save.
      const payload: ScanResultPayload = {
        fields: {},
        extraction: { method: isPassport ? 'mrz' : 'ocr' },
        warning: 'Scan failed — image saved, please enter details manually.',
      };
      setLastResult(payload);
      if (side === 'front') {
        setFrontImage(dataUrl);
        onScan({ frontImage: dataUrl, backImage, result: payload });
      } else {
        setBackImage(dataUrl);
        onScan({ frontImage, backImage: dataUrl, result: payload });
      }
      toast({
        title: 'Scan Failed',
        description: 'Image saved, but extraction errored out. Please enter details manually.',
        variant: 'destructive',
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>, side: 'front' | 'back') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      // Show the image immediately (snappy feedback) before extraction completes.
      if (side === 'front') setFrontImage(dataUrl);
      else setBackImage(dataUrl);
      processImage(dataUrl, side);
    };
    reader.readAsDataURL(file);
    // Allow re-uploading the same file later (browsers ignore unchanged values).
    e.target.value = '';
  };

  return (
    <Card className="border-primary/30" data-testid="card-id-scan">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-primary" />
            Scan ID
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(prev => !prev)}
            data-testid="button-toggle-scan"
          >
            {isExpanded ? 'Hide' : 'Show'}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {isPassport
            ? 'Upload or photograph the data page so the two-line MRZ at the bottom is readable.'
            : 'Upload or photograph the front and (optionally) back of the ID. We try the barcode first, then OCR.'}
        </p>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {/* ── LIVE BARCODE SCAN MODE ── */}
          {liveScanActive && (
            <div className="flex flex-col gap-3" data-testid="live-scan-panel">
              <div
                className="relative rounded-xl overflow-hidden bg-black w-full mx-auto"
                style={{ aspectRatio: '4/3', maxHeight: '50vh' }}
              >
                <video
                  ref={liveVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="border-2 border-emerald-400 rounded-lg w-4/5 h-1/2 opacity-70" />
                </div>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Hold the back of the license inside the box. Scan happens
                automatically when the barcode is recognized.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={stopLiveScan}
                className="gap-2"
                data-testid="button-cancel-live-scan"
              >
                <X className="w-4 h-4" /> Cancel Live Scan
              </Button>
            </div>
          )}

          {/* Live PDF417 entry point — only shown for licenses / state IDs.
              Manual entry is always available because the host form's
              signer/ID inputs sit beneath the card. */}
          {!liveScanActive && !isPassport && (
            <Button
              type="button"
              variant="default"
              className="w-full gap-2"
              onClick={startLiveScan}
              disabled={isScanning}
              data-testid="button-start-live-scan"
            >
              <ScanLine className="w-4 h-4" />
              Scan Barcode (Live)
            </Button>
          )}

          {lastResult?.warning && (
            <Alert className="bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
              <AlertTitle>Review Extracted Data</AlertTitle>
              <AlertDescription>{lastResult.warning}</AlertDescription>
            </Alert>
          )}

          {lastResult && !lastResult.warning && lastResult.extraction.method !== 'ocr' && (
            <Alert className="bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
              <AlertTitle>
                {lastResult.extraction.method === 'barcode' ? 'Barcode Scanned' : 'Passport MRZ Read'}
              </AlertTitle>
              <AlertDescription>Data extracted. Review the fields below before saving.</AlertDescription>
            </Alert>
          )}

          <div className={isPassport ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {isPassport ? 'Data Page' : 'Front of ID'}
              </p>
              {frontImage ? (
                <div className="relative rounded-lg overflow-hidden border bg-black/5">
                  <img
                    src={frontImage}
                    alt={isPassport ? 'Passport data page' : 'ID front'}
                    className="w-full h-32 object-contain cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setExpandedImage(frontImage)}
                  />
                </div>
              ) : (
                <div className="h-32 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">
                  No image yet
                </div>
              )}
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  disabled={isScanning}
                  onClick={() => frontInputRef.current?.click()}
                  data-testid="button-upload-front"
                >
                  {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                  {frontImage ? 'Replace' : 'Upload / Camera'}
                </Button>
                <input
                  ref={frontInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handleFile(e, 'front')}
                />
              </div>
            </div>

            {!isPassport && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Back of ID (barcode)
                </p>
                {backImage ? (
                  <div className="relative rounded-lg overflow-hidden border bg-black/5">
                    <img
                      src={backImage}
                      alt="ID back"
                      className="w-full h-32 object-contain cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => setExpandedImage(backImage)}
                    />
                  </div>
                ) : (
                  <div className="h-32 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">
                    No image yet
                  </div>
                )}
                <div className="relative">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2"
                    disabled={isScanning}
                    onClick={() => backInputRef.current?.click()}
                    data-testid="button-upload-back"
                  >
                    {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {backImage ? 'Replace' : 'Upload / Camera'}
                  </Button>
                  <input
                    ref={backInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleFile(e, 'back')}
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}

      {/* Full-size image modal */}
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
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
    </Card>
  );
}
