import { useState, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, Lock, Download, Upload, Database, Moon, Sun, AlertTriangle, CloudUpload, Cloud, CloudOff, RefreshCw, RotateCcw, CheckCircle2, ShieldCheck, ShieldAlert, Wallet, Stamp, Trash2, Fingerprint } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { getSettings, saveSettings, getAllEntries, changePin, lock, verifyChain, importEntry, recomputeChainFrom, wipeAllLocalData, type NotarySettings, type ChainVerificationResult, type JournalEntry } from '@/lib/db';
import {
  isPlatformAuthenticatorAvailable,
  isPrfLikelySupported,
  isBiometricEnabled,
  enableBiometric,
  clearBiometric,
} from '@/lib/biometric';
import { THRESHOLD_OPTIONS, DEFAULT_THRESHOLD_DAYS, clearSnooze } from '@/lib/backup-nudge';
import { FEE_TYPES, type FeeType } from '@/lib/fees';
import { exportAllCSV, exportAllJSON, exportAllPDF, parseBackupFile } from '@/lib/export';
import {
  isGdriveConfigured,
  isGdriveReady,
  getStoredToken,
  getLastBackupTime,
  signInAndGetEmail,
  disconnectGdrive,
  backupToDrive,
  listBackupFiles,
  restoreFromDrive,
  type BackupFile,
} from '@/lib/gdrive';

const settingsSchema = z.object({
  notaryName: z.string().min(1, 'Notary name is required'),
  commissionNumber: z.string().min(1, 'Commission number is required'),
  commissionExpiration: z.string().min(1, 'Expiration date is required'),
  defaultCity: z.string().min(1, 'Default city is required'),
  defaultState: z.string().min(2, 'Default state is required').max(2, 'Use 2-letter state code'),
  darkMode: z.boolean(),
  recordSignerDOB: z.boolean(),
  recordSignerIdNumber: z.boolean(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return '1 hour ago';
  if (hrs < 24) return `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export function Settings() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [entryCount, setEntryCount] = useState(0);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);

  // Change-PIN dialog state
  const [showChangePin, setShowChangePin] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [changePinBusy, setChangePinBusy] = useState(false);
  const [changePinError, setChangePinError] = useState<string | null>(null);

  // Chain verification state
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<ChainVerificationResult | null>(null);

  // JSON import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  // Default fees + seal image state
  const [defaultFees, setDefaultFees] = useState<Record<string, string>>({});
  const [savingFees, setSavingFees] = useState(false);
  const [sealImage, setSealImage] = useState<string | undefined>(undefined);
  const [sealBusy, setSealBusy] = useState(false);
  const sealInputRef = useRef<HTMLInputElement>(null);

  // Biometric unlock state
  const [biometricSupported, setBiometricSupported] = useState(false);
  // 'no-platform' = device has no platform authenticator at all;
  // 'no-prf'      = device has one but the WebAuthn PRF extension is missing;
  // null          = supported (or not enough info to explain).
  const [biometricUnsupportedExplained, setBiometricUnsupportedExplained] =
    useState<null | 'no-platform' | 'no-prf'>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricEnrollPin, setBiometricEnrollPin] = useState('');
  const [showBiometricEnroll, setShowBiometricEnroll] = useState(false);

  // Backup-nudge preferences
  const [backupReminderDays, setBackupReminderDays] = useState<number>(DEFAULT_THRESHOLD_DAYS);
  const [manualBackupOnly, setManualBackupOnly] = useState(false);

  // Google Drive state
  const [isConnected, setIsConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState('');
  const [autoBackup, setAutoBackup] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([]);
  const [showRestoreList, setShowRestoreList] = useState(false);
  const [selectedFile, setSelectedFile] = useState<BackupFile | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const gisCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      notaryName: '',
      commissionNumber: '',
      commissionExpiration: '',
      defaultCity: '',
      defaultState: '',
      darkMode: false,
      recordSignerDOB: true,
      recordSignerIdNumber: true,
    }
  });

  // Poll until GIS library loads (loaded async in index.html)
  useEffect(() => {
    if (isGdriveReady()) {
      setGisReady(true);
      return;
    }
    gisCheckRef.current = setInterval(() => {
      if (isGdriveReady()) {
        setGisReady(true);
        if (gisCheckRef.current) clearInterval(gisCheckRef.current);
      }
    }, 500);
    return () => { if (gisCheckRef.current) clearInterval(gisCheckRef.current); };
  }, []);

  useEffect(() => {
    async function loadData() {
      const settings = await getSettings();
      form.reset({
        notaryName: settings.notaryName || '',
        commissionNumber: settings.commissionNumber || '',
        commissionExpiration: settings.commissionExpiration || '',
        defaultCity: settings.defaultCity || '',
        defaultState: settings.defaultState || '',
        darkMode: settings.darkMode || false,
        // Treat undefined as ON so notaries who upgrade with prior data
        // don't suddenly find DOB/ID# fields disappearing.
        recordSignerDOB: settings.recordSignerDOB !== false,
        recordSignerIdNumber: settings.recordSignerIdNumber !== false,
      });
      setAutoBackup(settings.autoBackup ?? false);
      setGoogleEmail(settings.googleEmail ?? '');
      setBackupReminderDays(settings.backupReminderDays ?? DEFAULT_THRESHOLD_DAYS);
      setManualBackupOnly(!!settings.manualBackupOnly);

      hydrateFeeAndSealStateFrom(settings);

      // Biometric is "supported" only if both a platform authenticator and
      // the WebAuthn PRF extension are available.
      try {
        const platform = await isPlatformAuthenticatorAvailable();
        if (!platform) {
          setBiometricSupported(false);
          setBiometricUnsupportedExplained('no-platform');
        } else {
          const prfOk = await isPrfLikelySupported();
          setBiometricSupported(prfOk);
          setBiometricUnsupportedExplained(prfOk ? null : 'no-prf');
          if (prfOk) setBiometricEnabled(await isBiometricEnabled());
        }
      } catch {
        setBiometricSupported(false);
        setBiometricUnsupportedExplained('no-platform');
      }

      const entries = await getAllEntries();
      setEntryCount(entries.length);
      setIsLoading(false);
    }
    loadData();

    // Load initial Google Drive state
    setIsConnected(!!getStoredToken());
    setLastBackup(getLastBackupTime());
  }, [form]);

  const onSubmit = async (data: SettingsFormValues) => {
    setIsSaving(true);
    const current = await getSettings();
    await saveSettings({ ...current, ...data, pinEnabled: true } as NotarySettings);

    if (data.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    toast({ title: 'Settings saved', description: 'Your preferences have been updated.' });
    setIsSaving(false);
  };

  const handleChangePin = async () => {
    setChangePinError(null);
    if (oldPin.length !== 4) { setChangePinError('Enter your current 4-digit PIN.'); return; }
    if (newPin.length !== 4) { setChangePinError('New PIN must be 4 digits.'); return; }
    if (newPin !== newPinConfirm) { setChangePinError('New PINs do not match.'); return; }
    setChangePinBusy(true);
    try {
      const ok = await changePin(oldPin, newPin);
      if (!ok) {
        setChangePinError('Current PIN is incorrect.');
      } else {
        // Wrapped key is now stale; user can re-enroll with the new PIN.
        try {
          if (await isBiometricEnabled()) {
            await clearBiometric();
            setBiometricEnabled(false);
          }
        } catch {/* non-fatal */}
        toast({ title: 'PIN changed', description: 'Your journal has been re-encrypted with the new PIN. Re-enable biometric unlock if you use it.' });
        setShowChangePin(false);
        setOldPin(''); setNewPin(''); setNewPinConfirm('');
      }
    } catch (err) {
      setChangePinError(err instanceof Error ? err.message : 'Failed to change PIN');
    }
    setChangePinBusy(false);
  };

  const handleLockNow = () => {
    lock();
    window.location.reload();
  };

  const handleEnableBiometric = async () => {
    setBiometricBusy(true);
    try {
      if (biometricEnrollPin.length !== 4) {
        toast({ title: 'Enter your PIN', description: 'Confirm your current 4-digit PIN to enable biometric unlock.', variant: 'destructive' });
        setBiometricBusy(false);
        return;
      }
      await enableBiometric(biometricEnrollPin);
      setBiometricEnabled(true);
      setShowBiometricEnroll(false);
      setBiometricEnrollPin('');
      toast({ title: 'Biometric unlock enabled', description: 'You can now unlock with Face ID, Touch ID, or your device biometric.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      // PRF failure: flip to the disabled "unsupported" row immediately.
      if (/PRF/.test(msg)) {
        setBiometricSupported(false);
        setBiometricUnsupportedExplained('no-prf');
        setShowBiometricEnroll(false);
        setBiometricEnrollPin('');
      }
      toast({ title: 'Biometric setup failed', description: msg, variant: 'destructive' });
    }
    setBiometricBusy(false);
  };

  const handleDisableBiometric = async () => {
    setBiometricBusy(true);
    try {
      await clearBiometric();
      setBiometricEnabled(false);
      toast({ title: 'Biometric unlock disabled' });
    } catch (err) {
      toast({ title: 'Could not disable biometric', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
    setBiometricBusy(false);
  };

  const handleBackupReminderChange = async (value: string) => {
    const days = Number.parseInt(value, 10);
    if (!Number.isFinite(days)) return;
    setBackupReminderDays(days);
    const current = await getSettings();
    await saveSettings({ ...current, backupReminderDays: days } as NotarySettings);
    await clearSnooze();
    toast({ title: 'Backup reminder updated', description: `You'll be reminded if your backup is older than ${days} days.` });
  };

  const handleManualBackupOnlyToggle = async (checked: boolean) => {
    setManualBackupOnly(checked);
    const current = await getSettings();
    await saveSettings({ ...current, manualBackupOnly: checked } as NotarySettings);
    if (checked) await clearSnooze();
  };

  const handleSaveDefaultFees = async () => {
    setSavingFees(true);
    try {
      const cents: Record<string, number> = {};
      for (const ft of FEE_TYPES) {
        const raw = (defaultFees[ft] ?? '').trim();
        const dollars = Number(raw);
        cents[ft] = raw === '' || !Number.isFinite(dollars) || dollars < 0
          ? 0
          : Math.round(dollars * 100);
      }
      const current = await getSettings();
      await saveSettings({ ...current, defaultFees: cents } as NotarySettings);
      toast({ title: 'Default fees saved', description: 'New entries will use these amounts.' });
    } catch (err) {
      toast({ title: 'Failed to save fees', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
    setSavingFees(false);
  };

  // Resize an uploaded seal image to a max edge (~600px) and return a JPEG/PNG
  // data URL ≤ ~200 KB. Keeps backups light (the seal is embedded on every PDF).
  async function resizeImageToDataUrl(file: File, maxEdge = 600, maxBytes = 200_000): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error ?? new Error('Read failed'));
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Invalid image'));
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(img, 0, 0, w, h);
    // Try PNG first to preserve transparency; fall back to JPEG if too big.
    // The base64 representation is ~37% larger than the raw byte count, so we
    // compare data-URL length against `maxBytes * 1.37`. If even the lowest
    // quality JPEG can't get under the cap we throw — backups embed this on
    // every PDF, so we won't silently let a 1 MB PNG through.
    const cap = Math.round(maxBytes * 1.37);
    let out = canvas.toDataURL('image/png');
    if (out.length > cap) {
      let q = 0.85;
      out = canvas.toDataURL('image/jpeg', q);
      while (out.length > cap && q > 0.4) {
        q -= 0.1;
        out = canvas.toDataURL('image/jpeg', q);
      }
    }
    if (out.length > cap) {
      throw new Error(
        `Seal image is too large after compression (${Math.round(out.length / 1024)} KB; limit ~${Math.round(maxBytes / 1024)} KB). Try a smaller or simpler image.`,
      );
    }
    return out;
  }

  const handleSealUpload = async (file: File) => {
    setSealBusy(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      const current = await getSettings();
      await saveSettings({ ...current, sealImage: dataUrl } as NotarySettings);
      setSealImage(dataUrl);
      toast({ title: 'Seal or logo saved', description: 'Your seal or logo will appear on exported PDFs.' });
    } catch (err) {
      toast({ title: 'Could not save seal or logo', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
    setSealBusy(false);
  };

  const handleRemoveSeal = async () => {
    setSealBusy(true);
    try {
      const current = await getSettings();
      const { sealImage: _drop, ...rest } = current;
      await saveSettings({ ...rest } as NotarySettings);
      setSealImage(undefined);
      toast({ title: 'Seal or logo removed' });
    } catch (err) {
      toast({ title: 'Failed to remove seal or logo', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
    setSealBusy(false);
  };

  const handleVerifyChain = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await verifyChain();
      setVerifyResult(result);
    } catch (err) {
      toast({ title: 'Verification failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
    setVerifying(false);
  };

  /**
   * Sync the on-page Default Fees editor and Notary Seal preview from a fresh
   * `NotarySettings` snapshot. Called both on initial load and after any
   * restore (JSON import or Drive restore) so the user sees their restored
   * values immediately without having to reload the page.
   */
  function hydrateFeeAndSealStateFrom(settings: NotarySettings): void {
    const fees: Record<string, string> = {};
    for (const ft of FEE_TYPES) {
      const cents = settings.defaultFees?.[ft] ?? 0;
      fees[ft] = cents > 0 ? (cents / 100).toFixed(2) : '';
    }
    setDefaultFees(fees);
    setSealImage(settings.sealImage);
  }

  const handleImportJSON = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const { detectedVersion, entries, settings: importedSettings } = parseBackupFile(text);

      const startCount = (await getAllEntries()).length;
      const isEmptyJournal = startCount === 0;

      let imported = 0, skipped = 0;
      for (const e of entries) {
        const { id: _id, ...rest } = e as JournalEntry & { id?: number };
        try {
          await importEntry(rest);
          imported++;
        } catch (err) {
          if (err instanceof Error && (err as Error & { code?: string }).code === 'DUPLICATE') skipped++;
          else throw err;
        }
      }

      // Restamp the chain for legacy/v1 imports into an empty journal so they
      // verify cleanly. We never restamp into a non-empty journal — that could
      // mask tampering on the user's existing entries.
      // Detect legacy by MISSING `hash` only — `previousEntryHash === ""` is
      // the valid genesis value for entry #1 in a v2 backup and must NOT
      // trigger a restamp (which could otherwise normalize tampered chains).
      let restamped = false;
      if (isEmptyJournal && imported > 0 && entries.some(e => !e.hash)) {
        await recomputeChainFrom(1);
        restamped = true;
      }

      // Apply settings if the user confirms. Strip legacy `pinHash` and force
      // `pinEnabled: true` so an obsolete plaintext-mode hash is never carried
      // forward into encrypted settings or future backups.
      let settingsRestored = false;
      if (importedSettings && window.confirm(
        'This backup includes settings (notary name, commission, defaults). ' +
        'Overwrite your current settings with the values from the backup?'
      )) {
        const current = await getSettings();
        const sanitized: Partial<NotarySettings> = { ...importedSettings };
        delete (sanitized as Partial<NotarySettings> & { pinHash?: string }).pinHash;
        await saveSettings({ ...current, ...sanitized, id: 1, pinEnabled: true });
        settingsRestored = true;
        // Refresh local form state so restored fees/seal show up immediately.
        hydrateFeeAndSealStateFrom(await getSettings());
      }

      toast({
        title: 'Import complete',
        description: `Format v${detectedVersion}: imported ${imported}, skipped ${skipped} duplicates`
          + (restamped ? ', chain restamped' : '')
          + (settingsRestored ? ', settings restored' : '')
          + '.',
      });
      const all = await getAllEntries();
      setEntryCount(all.length);
    } catch (err) {
      toast({ title: 'Import failed', description: err instanceof Error ? err.message : 'Could not parse file', variant: 'destructive' });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportPDF = async () => {
    const entries = await getAllEntries();
    const settings = await getSettings();
    exportAllPDF(entries, settings);
  };

  const handleExportCSV = async () => {
    const entries = await getAllEntries();
    exportAllCSV(entries, await getSettings());
  };

  const handleExportJSON = async () => {
    const entries = await getAllEntries();
    const settings = await getSettings();
    exportAllJSON(entries, settings);
  };

  // ── Google Drive handlers ───────────────────────────────────────────────────

  const handleConnect = async () => {
    if (!gisReady) {
      toast({ title: 'Not ready', description: 'Google services still loading. Please wait a moment and try again.' });
      return;
    }
    try {
      const { email } = await signInAndGetEmail();
      setIsConnected(true);
      setGoogleEmail(email);
      const current = await getSettings();
      await saveSettings({ ...current, googleEmail: email });
      toast({ title: 'Connected', description: 'Google Drive connected successfully.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect';
      toast({ title: 'Connection failed', description: msg, variant: 'destructive' });
    }
  };

  const handleDisconnect = async () => {
    disconnectGdrive();
    setIsConnected(false);
    setGoogleEmail('');
    setBackupFiles([]);
    setShowRestoreList(false);
    const current = await getSettings();
    await saveSettings({ ...current, googleEmail: '' });
    toast({ title: 'Disconnected', description: 'Google Drive disconnected.' });
  };

  const handleAutoBackupToggle = async (checked: boolean) => {
    setAutoBackup(checked);
    const current = await getSettings();
    await saveSettings({ ...current, autoBackup: checked });
  };

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    try {
      const entries = await getAllEntries();
      const settings = await getSettings();
      await backupToDrive(entries, settings);
      const now = new Date().toISOString();
      setLastBackup(now);
      toast({ title: 'Backup complete', description: 'Journal backed up to Google Drive.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Backup failed';
      // If token expired, clear connected state
      if (msg.includes('401') || msg.includes('403')) {
        setIsConnected(false);
      }
      toast({ title: 'Backup failed', description: msg, variant: 'destructive' });
    }
    setIsBackingUp(false);
  };

  const handleShowRestoreList = async () => {
    if (showRestoreList) {
      setShowRestoreList(false);
      return;
    }
    setIsLoadingFiles(true);
    setShowRestoreList(true);
    try {
      const files = await listBackupFiles();
      setBackupFiles(files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to list backups';
      toast({ title: 'Could not list backups', description: msg, variant: 'destructive' });
      setShowRestoreList(false);
    }
    setIsLoadingFiles(false);
  };

  const handleRestore = async (file: BackupFile) => {
    setSelectedFile(file);
  };

  const handleConfirmRestore = async () => {
    if (!selectedFile) return;
    setIsRestoring(true);
    try {
      const payload = await restoreFromDrive(selectedFile.id);
      if (!payload.entries || !Array.isArray(payload.entries)) {
        throw new Error('Invalid backup file format');
      }

      const startCount = (await getAllEntries()).length;
      const isEmptyJournal = startCount === 0;

      let imported = 0;
      let skipped = 0;
      for (const entry of payload.entries) {
        // Strip the IDB auto-key `id` so the store assigns a fresh one, but keep entryNumber
        const { id: _id, ...rest } = entry as typeof entry & { id?: number };
        try {
          await importEntry(rest);
          imported++;
        } catch (err) {
          if (err instanceof Error && (err as Error & { code?: string }).code === 'DUPLICATE') {
            skipped++;
          } else {
            throw err;
          }
        }
      }

      // Restamp legacy v1 chains imported into an empty journal so they verify
      // cleanly. Never restamp into a non-empty journal — that could mask real
      // tampering on the user's existing entries. Use missing `hash` (not empty
      // `previousEntryHash`) as the legacy signal; "" is the valid genesis.
      let restamped = false;
      if (isEmptyJournal && imported > 0 && payload.entries.some(e => !e.hash)) {
        await recomputeChainFrom(1);
        restamped = true;
      }

      let settingsRestored = false;
      const importedSettings = payload.settings as Partial<NotarySettings> | undefined;
      if (importedSettings && Object.keys(importedSettings).length > 0 && window.confirm(
        'This backup includes notary settings (name, commission, defaults). ' +
        'Overwrite your current settings with the values from the backup?'
      )) {
        const current = await getSettings();
        const sanitized: Partial<NotarySettings> = { ...importedSettings };
        delete (sanitized as Partial<NotarySettings> & { pinHash?: string }).pinHash;
        await saveSettings({ ...current, ...sanitized, id: 1, pinEnabled: true });
        settingsRestored = true;
        hydrateFeeAndSealStateFrom(await getSettings());
      }

      toast({
        title: 'Restore complete',
        description: `Imported ${imported} entries. Skipped ${skipped} duplicates`
          + (restamped ? ', chain restamped' : '')
          + (settingsRestored ? ', settings restored' : '')
          + '.',
      });
      setSelectedFile(null);
      setShowRestoreList(false);
      const newEntries = await getAllEntries();
      setEntryCount(newEntries.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Restore failed';
      toast({ title: 'Restore failed', description: msg, variant: 'destructive' });
    }
    setIsRestoring(false);
  };

  if (isLoading) {
    return <div className="p-8 animate-pulse flex flex-col gap-4">
      <div className="h-8 w-48 bg-muted rounded"></div>
      <div className="h-64 w-full bg-muted rounded"></div>
    </div>;
  }

  const configured = isGdriveConfigured();

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your notary profile and app preferences</p>
        </div>
        <Link
          href="/reports"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline whitespace-nowrap"
          data-testid="link-settings-reports"
        >
          View Annual Report →
        </Link>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Notary Profile</CardTitle>
              <CardDescription>Your official commission information used for journal entries</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="notaryName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane Doe" {...field} data-testid="input-notary-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="commissionNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Commission Number</FormLabel>
                      <FormControl>
                        <Input placeholder="123456789" {...field} data-testid="input-commission-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="commissionExpiration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Commission Expiration</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-commission-expiration" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border">
                <FormField
                  control={form.control}
                  name="defaultCity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default City</FormLabel>
                      <FormControl>
                        <Input placeholder="Springfield" {...field} data-testid="input-default-city" />
                      </FormControl>
                      <FormDescription>Pre-fills location for new entries</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="defaultState"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default State</FormLabel>
                      <FormControl>
                        <Input placeholder="IL" maxLength={2} {...field} data-testid="input-default-state" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* ── Journal Compliance Card ─────────────────────────────────
              Some states (e.g. CA) bar notaries from recording a signer's
              date of birth or full ID number in the journal. Toggling
              these off hides the inputs in the new/edit flows, omits the
              rows from PDF/CSV exports, and leaves the fields blank on
              new entries. Defaults to ON to match the most common
              jurisdictions.                                              */}
          <Card>
            <CardHeader>
              <CardTitle>Journal Compliance</CardTitle>
              <CardDescription>
                Match what your state allows you to record. Defaults are on for most states.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Compliance toggles save IMMEDIATELY on change, not on the
                  bottom "Save Settings" button. These rules drive what's
                  visible in the new-entry / edit-entry / detail screens, so
                  forgetting to scroll down and click Save would silently put
                  the notary out of compliance. */}
              <FormField
                control={form.control}
                name="recordSignerDOB"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start justify-between gap-4 rounded-lg border p-4 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base font-medium">Record signer date of birth</FormLabel>
                      <FormDescription>
                        Turn off if your state prohibits storing signers' DOB (e.g. California).
                        The DOB field is hidden from new entries and omitted from exports.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={async (checked) => {
                          field.onChange(checked);
                          const current = await getSettings();
                          await saveSettings({ ...current, recordSignerDOB: checked } as NotarySettings);
                          toast({ title: checked ? 'Recording DOB' : 'DOB hidden', description: 'Compliance preference saved.' });
                        }}
                        data-testid="switch-record-signer-dob"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="recordSignerIdNumber"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start justify-between gap-4 rounded-lg border p-4 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base font-medium">Record signer ID number</FormLabel>
                      <FormDescription>
                        Turn off if your state prohibits storing the full ID number.
                        ID type, issuing state, and expiration date are still recorded
                        regardless — those are the standard "what kind of ID did you check"
                        fields that every state allows.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={async (checked) => {
                          field.onChange(checked);
                          const current = await getSettings();
                          await saveSettings({ ...current, recordSignerIdNumber: checked } as NotarySettings);
                          toast({ title: checked ? 'Recording ID number' : 'ID number hidden', description: 'Compliance preference saved.' });
                        }}
                        data-testid="switch-record-signer-id-number"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Security & Appearance</CardTitle>
              <CardDescription>App access and display preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border p-4 shadow-sm space-y-4">
                <div className="flex flex-row items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-base font-medium flex items-center gap-2">
                      <Lock className="w-4 h-4 text-primary" />
                      PIN & Encryption
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Your journal is encrypted at rest with a key derived from your PIN. PIN cannot be disabled — it protects your data.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowChangePin(v => !v)} data-testid="button-change-pin">
                    {showChangePin ? 'Cancel' : 'Change PIN'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleLockNow} data-testid="button-lock-now">
                    Lock now
                  </Button>
                </div>

                {biometricSupported && (
                  <div className="border-t pt-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium flex items-center gap-2">
                          <Fingerprint className="w-4 h-4 text-primary" />
                          Biometric unlock
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Unlock with Face ID, Touch ID, or your device biometric. Your PIN is required once to enroll; after that, an encrypted copy of your journal&apos;s encryption key is stored locked behind your device biometric. Your PIN itself is never stored.
                        </p>
                      </div>
                      <Switch
                        checked={biometricEnabled}
                        disabled={biometricBusy}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setShowBiometricEnroll(true);
                          } else {
                            handleDisableBiometric();
                          }
                        }}
                        data-testid="switch-biometric-unlock"
                      />
                    </div>

                    {showBiometricEnroll && !biometricEnabled && (
                      <div className="p-4 border rounded-lg bg-muted/50 space-y-3 animate-in slide-in-from-top-2">
                        <h4 className="font-medium text-sm">Confirm your PIN to enable biometric</h4>
                        <p className="text-xs text-muted-foreground">
                          We need your current PIN once to derive your journal&apos;s encryption key. We then store the key wrapped behind your device biometric — your PIN is never stored.
                        </p>
                        <div className="space-y-2">
                          <Label htmlFor="biometricPin">Current PIN</Label>
                          <Input
                            id="biometricPin"
                            type="password"
                            inputMode="numeric"
                            maxLength={4}
                            value={biometricEnrollPin}
                            onChange={e => setBiometricEnrollPin(e.target.value.replace(/[^0-9]/g, ''))}
                            data-testid="input-biometric-enroll-pin"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleEnableBiometric}
                            disabled={biometricBusy || biometricEnrollPin.length !== 4}
                            data-testid="button-confirm-enable-biometric"
                          >
                            {biometricBusy ? 'Setting up…' : 'Enable biometric'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => { setShowBiometricEnroll(false); setBiometricEnrollPin(''); }}
                            disabled={biometricBusy}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!biometricSupported && biometricUnsupportedExplained && (
                  <div className="border-t pt-4">
                    <div className="flex items-start gap-3 opacity-70" data-testid="biometric-unsupported-row">
                      <Fingerprint className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">Biometric unlock unavailable</p>
                        <p className="text-xs text-muted-foreground">
                          {biometricUnsupportedExplained === 'no-platform'
                            ? "This device or browser doesn't expose a built-in biometric sensor (Face ID, Touch ID, Windows Hello, or Android biometric) to the web. Your PIN still works as normal."
                            : "Your device has a biometric sensor, but this browser doesn't support the WebAuthn PRF extension we need to wrap your encryption key. Try Chrome or Edge 132+, Safari 18+, or Samsung Internet on a recent Android device. Your PIN still works as normal."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {showChangePin && (
                  <div className="p-4 border rounded-lg bg-muted/50 space-y-3 animate-in slide-in-from-top-2">
                    <h4 className="font-medium text-sm">Change your PIN</h4>
                    <p className="text-xs text-muted-foreground">All entries will be re-encrypted with the new PIN.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="oldPin">Current PIN</Label>
                        <Input id="oldPin" type="password" inputMode="numeric" maxLength={4}
                          value={oldPin} onChange={e => setOldPin(e.target.value.replace(/[^0-9]/g, ''))}
                          data-testid="input-current-pin" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="newPin">New PIN</Label>
                        <Input id="newPin" type="password" inputMode="numeric" maxLength={4}
                          value={newPin} onChange={e => setNewPin(e.target.value.replace(/[^0-9]/g, ''))}
                          data-testid="input-new-pin" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="newPinConfirm">Confirm new PIN</Label>
                        <Input id="newPinConfirm" type="password" inputMode="numeric" maxLength={4}
                          value={newPinConfirm} onChange={e => setNewPinConfirm(e.target.value.replace(/[^0-9]/g, ''))}
                          data-testid="input-new-pin-confirm" />
                      </div>
                    </div>
                    {changePinError && <p className="text-sm text-destructive">{changePinError}</p>}
                    <Button type="button" size="sm" onClick={handleChangePin} disabled={changePinBusy} data-testid="button-confirm-change-pin">
                      {changePinBusy ? 'Re-encrypting…' : 'Save new PIN'}
                    </Button>
                  </div>
                )}
              </div>

              <FormField
                control={form.control}
                name="darkMode"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base flex items-center gap-2">
                        {field.value ? <Moon className="w-4 h-4 text-primary" /> : <Sun className="w-4 h-4 text-primary" />}
                        Dark Mode
                      </FormLabel>
                      <FormDescription>
                        Switch between light and dark themes
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-dark-mode"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="bg-muted/30 border-t px-6 py-4">
              <Button type="submit" disabled={isSaving} className="gap-2" data-testid="button-save-settings">
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Settings'}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>

      {/* ── Default Fees Card ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Default Fees
          </CardTitle>
          <CardDescription>
            Pre-fill the fee on new entries based on the type of notarial act. Leave blank to use $0.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {FEE_TYPES.map(ft => (
            <div key={ft} className="flex items-center justify-between gap-3">
              <Label htmlFor={`fee-${ft}`} className="text-sm">{ft}</Label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id={`fee-${ft}`}
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  className="pl-6"
                  value={defaultFees[ft] ?? ''}
                  onChange={e => setDefaultFees(prev => ({ ...prev, [ft]: e.target.value }))}
                  data-testid={`input-default-fee-${ft.toLowerCase().replace(/\s+/g, '-')}`}
                />
              </div>
            </div>
          ))}
        </CardContent>
        <CardFooter className="bg-muted/30 border-t px-6 py-4">
          <Button onClick={handleSaveDefaultFees} disabled={savingFees} className="gap-2" data-testid="button-save-default-fees">
            <Save className="w-4 h-4" /> {savingFees ? 'Saving...' : 'Save Default Fees'}
          </Button>
        </CardFooter>
      </Card>

      {/* ── Notary Seal or Logo Card ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stamp className="w-5 h-5 text-primary" />
            Notary Seal or Logo
          </CardTitle>
          <CardDescription>
            Upload a small PNG or JPG of your seal or logo (recommended ~300×300 pixels). It will be stamped in the lower-right corner of every page in your exported PDFs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sealImage ? (
            <div className="flex items-center gap-4 p-3 border rounded-lg bg-muted/30">
              <img src={sealImage} alt="Notary seal or logo" className="w-20 h-20 object-contain bg-white border rounded" />
              <div className="flex-1 text-sm text-muted-foreground">
                Seal or logo saved. It will be embedded in PDF exports.
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleRemoveSeal}
                disabled={sealBusy}
                data-testid="button-remove-seal"
              >
                <Trash2 className="w-4 h-4" /> Remove
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No seal or logo uploaded yet.</p>
          )}
          <input
            ref={sealInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleSealUpload(f);
              if (sealInputRef.current) sealInputRef.current.value = '';
            }}
            data-testid="input-seal-upload"
          />
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => sealInputRef.current?.click()}
            disabled={sealBusy}
            data-testid="button-upload-seal"
          >
            <Upload className="w-4 h-4" /> {sealBusy ? 'Processing...' : sealImage ? 'Replace Seal or Logo' : 'Upload Seal or Logo'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Image is resized to about 600px and stored locally. PNG with transparency works best.
          </p>
        </CardContent>
      </Card>

      {/* ── Cloud Backup Card ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-primary" />
            Cloud Backup
          </CardTitle>
          <CardDescription>Back up your journal to Google Drive automatically</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Not configured: show admin note */}
          {!configured && (
            <p className="text-sm text-muted-foreground">
              Google Drive backup is not enabled. Contact the app administrator to set it up.
            </p>
          )}

          {/* Backup-staleness reminder controls (always shown when Drive is configured) */}
          {configured && (
            <div className="space-y-3 rounded-lg border p-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Remind me to back up</p>
                  <p className="text-xs text-muted-foreground">Show a banner on the dashboard if my last backup is older than this.</p>
                </div>
                <Select
                  value={String(backupReminderDays)}
                  onValueChange={handleBackupReminderChange}
                  disabled={manualBackupOnly}
                >
                  <SelectTrigger className="w-40" data-testid="select-backup-reminder-days">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THRESHOLD_OPTIONS.map(d => (
                      <SelectItem key={d} value={String(d)} data-testid={`select-backup-reminder-${d}`}>
                        Every {d} days
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-row items-start justify-between gap-4 pt-3 border-t">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">I'll handle backups manually</p>
                  <p className="text-xs text-muted-foreground">
                    Suppresses the dashboard reminder. Use this if you back up via JSON export instead of Drive.
                  </p>
                </div>
                <Switch
                  checked={manualBackupOnly}
                  onCheckedChange={handleManualBackupOnlyToggle}
                  data-testid="switch-manual-backup-only"
                />
              </div>
            </div>
          )}

          {/* Configured: show connection status */}
          {configured && (
            <>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  {isConnected
                    ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                    : <CloudOff className="w-5 h-5 text-muted-foreground" />
                  }
                  <div>
                    <p className="font-medium text-sm">{isConnected ? 'Google Drive connected' : 'Not connected'}</p>
                    {isConnected && googleEmail && (
                      <p className="text-xs text-muted-foreground">{googleEmail}</p>
                    )}
                    {isConnected && lastBackup && (
                      <p className="text-xs text-muted-foreground">Last backup: {formatRelativeTime(lastBackup)}</p>
                    )}
                    {isConnected && !lastBackup && (
                      <p className="text-xs text-muted-foreground">No backup yet</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!isConnected ? (
                    <Button size="sm" onClick={handleConnect} disabled={!gisReady} data-testid="button-connect-gdrive">
                      {gisReady ? 'Connect Google Drive' : 'Loading...'}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={handleDisconnect} data-testid="button-disconnect-gdrive">
                      Disconnect
                    </Button>
                  )}
                </div>
              </div>

              {isConnected && (
                <>
                  {/* Auto-backup toggle */}
                  <div className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium flex items-center gap-2">
                        <CloudUpload className="w-4 h-4 text-primary" />
                        Auto-backup
                      </p>
                      <p className="text-xs text-muted-foreground">Silently back up to Drive after each new entry</p>
                    </div>
                    <Switch
                      checked={autoBackup}
                      onCheckedChange={handleAutoBackupToggle}
                      data-testid="switch-auto-backup"
                    />
                  </div>

                  {/* Manual backup + restore */}
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={handleBackupNow}
                      disabled={isBackingUp}
                      data-testid="button-backup-now"
                    >
                      <RefreshCw className={`w-4 h-4 ${isBackingUp ? 'animate-spin' : ''}`} />
                      {isBackingUp ? 'Backing up...' : 'Backup Now'}
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={handleShowRestoreList}
                      disabled={isLoadingFiles}
                      data-testid="button-restore-drive"
                    >
                      <RotateCcw className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                      {isLoadingFiles ? 'Loading...' : showRestoreList ? 'Hide Backups' : 'Restore from Drive'}
                    </Button>
                  </div>

                  {/* Restore file list */}
                  {showRestoreList && !isLoadingFiles && (
                    <div className="border rounded-lg divide-y animate-in slide-in-from-top-2">
                      {backupFiles.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground">No backup files found in your Drive.</p>
                      ) : (
                        backupFiles.map(file => (
                          <div key={file.id} className="p-3 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{file.name}</p>
                              <p className="text-xs text-muted-foreground">{formatRelativeTime(file.modifiedTime)}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRestore(file)}
                              data-testid={`button-restore-file-${file.id}`}
                            >
                              Restore
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Restore confirmation */}
                  {selectedFile && (
                    <div className="p-4 border border-amber-300 rounded-lg bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 space-y-3 animate-in slide-in-from-top-2">
                      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                        Restore from "{selectedFile.name}"?
                      </p>
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        Entries in the backup will be merged with your existing journal. Duplicate entry numbers will be skipped. Your current entries will not be deleted.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleConfirmRestore}
                          disabled={isRestoring}
                          data-testid="button-confirm-restore"
                        >
                          {isRestoring ? 'Restoring...' : 'Confirm Restore'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedFile(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Data & Export Card ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Data & Export</CardTitle>
          <CardDescription>Manage your journal data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/20">
            <Database className="w-8 h-8 text-primary" />
            <div>
              <p className="font-medium text-foreground">Local Storage</p>
              <p className="text-sm text-muted-foreground">{entryCount} entries saved locally on this device.</p>
            </div>
          </div>

          <Alert variant="default" className="bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-900">
            <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertTitle>Data Privacy</AlertTitle>
            <AlertDescription>
              All journal data is stored locally in your browser. Clearing your browser data will delete your journal. Please export regularly for backup.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Button variant="outline" className="gap-2 w-full" onClick={handleExportPDF} data-testid="button-export-pdf">
              <Download className="w-4 h-4" /> Export PDF
            </Button>
            <Button variant="outline" className="gap-2 w-full" onClick={handleExportCSV} data-testid="button-export-csv">
              <Download className="w-4 h-4" /> Export CSV
            </Button>
            <Button variant="outline" className="gap-2 w-full" onClick={handleExportJSON} data-testid="button-export-json">
              <Download className="w-4 h-4" /> Export JSON
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleImportJSON(file);
            }}
            data-testid="input-import-json"
          />
          <Button
            variant="outline"
            className="gap-2 w-full"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            data-testid="button-import-json"
          >
            <Upload className="w-4 h-4" /> {importing ? 'Importing…' : 'Import from JSON file'}
          </Button>
        </CardContent>
      </Card>

      {/* ── Tamper-evident chain verification ─────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Journal Integrity</CardTitle>
          <CardDescription>Verify the tamper-evident hash chain for all completed entries</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            onClick={handleVerifyChain}
            disabled={verifying}
            className="gap-2"
            data-testid="button-verify-chain"
          >
            <ShieldCheck className="w-4 h-4" />
            {verifying ? 'Verifying…' : 'Verify entire journal'}
          </Button>

          {verifyResult && (
            <Alert
              variant="default"
              className={
                verifyResult.issues.length === 0
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900'
                  : 'bg-destructive/10 text-destructive border-destructive/30'
              }
              data-testid="alert-verify-result"
            >
              {verifyResult.issues.length === 0 ? (
                <ShieldCheck className="h-4 w-4" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
              <AlertTitle>
                {verifyResult.issues.length === 0
                  ? `All ${verifyResult.okCount} entries verified`
                  : `${verifyResult.issues.length} of ${verifyResult.totalChecked} entries failed verification`}
              </AlertTitle>
              {verifyResult.issues.length > 0 && (
                <AlertDescription>
                  <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
                    {verifyResult.issues.slice(0, 10).map((iss, i) => (
                      <li key={i}>Entry #{iss.entryNumber}: {iss.reason}</li>
                    ))}
                    {verifyResult.issues.length > 10 && (
                      <li>…and {verifyResult.issues.length - 10} more</li>
                    )}
                  </ul>
                </AlertDescription>
              )}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ── Danger zone ───────────────────────────────────────────────── */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Permanently delete everything stored in this browser — entries, settings, your PIN setup,
            and any cached keys. This cannot be undone. Export a backup first if you need one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!confirmWipe ? (
            <Button
              variant="outline"
              className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmWipe(true)}
              data-testid="button-reset-journal"
            >
              <Trash2 className="w-4 h-4" /> Reset journal (delete all local data)
            </Button>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Are you absolutely sure?</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  This will erase every entry, your PIN, and all settings on this device. The app will
                  reload to a fresh setup screen.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={wiping}
                    onClick={async () => {
                      setWiping(true);
                      try {
                        await wipeAllLocalData();
                        // Hard reload so App.tsx re-runs init against the fresh DB.
                        window.location.replace(import.meta.env.BASE_URL || '/');
                      } catch (err) {
                        setWiping(false);
                        toast({
                          title: 'Could not reset',
                          description: err instanceof Error ? err.message : 'Unknown error',
                          variant: 'destructive',
                        });
                      }
                    }}
                    data-testid="button-confirm-reset"
                  >
                    {wiping ? 'Erasing…' : 'Yes, delete everything'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmWipe(false)} disabled={wiping}>
                    Cancel
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="text-center text-sm text-muted-foreground pt-4 pb-8">
        <p>Notary Journal App v1.1.0</p>
      </div>
    </div>
  );
}
