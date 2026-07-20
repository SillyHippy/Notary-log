import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, Lock, Download, Upload, Database, Moon, Sun, AlertTriangle, CloudUpload, Cloud, CloudOff, RefreshCw, RotateCcw, CheckCircle2, ShieldCheck, ShieldAlert, Wallet, Stamp, Trash2, Fingerprint, ExternalLink, Loader2, ChevronDown, ChevronUp, Calendar, Copy } from 'lucide-react';
import { appOriginPath } from '@/lib/app-path';
import { getCalMe, patchCalMe, restoreCalOAuthBinding } from '@/lib/cal-api';
import { parseCalBookingUrl, isCalHostMode } from '@/lib/cal-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { resolveJournalSharedCertMode } from '@/lib/fee-rules';
import { getSettings, saveSettings, getAllEntries, changePin, lock, verifyChain, importEntry, recomputeChainFrom, wipeAllLocalData, shouldRequireSignature, type NotarySettings, type ChainVerificationResult, type JournalEntry } from '@/lib/db';
import {
  isPlatformAuthenticatorAvailable,
  isPrfLikelySupported,
  isBiometricEnabled,
  enableBiometric,
  clearBiometric,
} from '@/lib/biometric';
import { THRESHOLD_OPTIONS, DEFAULT_THRESHOLD_DAYS, clearSnooze } from '@/lib/backup-nudge';
import { loadBackupPanelVisibility, resolveBackupPanelVisibility } from '@/lib/backup-visibility';
import { DEFAULT_STAMP_FEE_CENTS, FEE_TYPES, type FeeType } from '@/lib/fees';
import { BACKUP_FORMAT_VERSION, parseBackupFile } from '@/lib/export';
import {
  isGdriveConfigured,
  isGdriveReady,
  ensureGoogleIdentityLoaded,
  getStoredToken,
  getLastBackupTime,
  signInAndGetEmail,
  disconnectGdrive,
  backupToDrive,
  listBackupFiles,
  restoreFromDrive,
  type BackupFile,
} from '@/lib/gdrive';
import {
  downloadZoBackupText,
  listZoBackups,
  uploadZoBackup,
  type ZoBackupFile,
} from '@/lib/zo-backup';
import { JournalLayoutHelp } from '@/components/journal-layout-help';
import { CalSetupPanel } from '@/components/cal-setup-panel';

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

const ZO_BACKUP_URL_KEY = 'zo_backup_api_url';
const ZO_BACKUP_KEY_KEY = 'zo_backup_key';
const ZO_LAST_BACKUP_KEY = 'zo_last_backup';

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
  const [stampFeeDollars, setStampFeeDollars] = useState('');
  const [savingStampFee, setSavingStampFee] = useState(false);
  const [requireIdPhoto, setRequireIdPhoto] = useState(false);
  const [requireSignature, setRequireSignature] = useState(true);
  const [journalCombinedLine, setJournalCombinedLine] = useState(false);
  const [journalSplitDocuments, setJournalSplitDocuments] = useState(true);
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
  const [showGoogleBackup, setShowGoogleBackup] = useState(true);
  const [showZoBackup, setShowZoBackup] = useState(false);

  // Google Drive state
  const [isConnected, setIsConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState('');
  const [backupFrequency, setBackupFrequency] = useState<'off' | 'after-entry' | 'daily'>('off');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([]);
  const [showRestoreList, setShowRestoreList] = useState(false);
  const [selectedFile, setSelectedFile] = useState<BackupFile | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const gisCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Zo backup state (no Google/OAuth required)
  const [zoApiUrl, setZoApiUrl] = useState('');
  const [zoBackupKey, setZoBackupKey] = useState('');
  const [zoLastBackup, setZoLastBackup] = useState<string | null>(null);
  const [zoBusy, setZoBusy] = useState(false);
  const [isZoLoadingFiles, setIsZoLoadingFiles] = useState(false);
  const [zoBackupFiles, setZoBackupFiles] = useState<ZoBackupFile[]>([]);
  const [showZoRestoreList, setShowZoRestoreList] = useState(false);
  const [selectedZoFile, setSelectedZoFile] = useState<ZoBackupFile | null>(null);
  const [isZoRestoring, setIsZoRestoring] = useState(false);

  // Client Intake state
  const [web3formsKey, setWeb3formsKey] = useState('');
  const [zoComputerToken, setZoComputerToken] = useState('');
  const [intakeSaving, setIntakeSaving] = useState(false);
  const [intakeTesting, setIntakeTesting] = useState(false);

  // Cal.com scheduling (multi-tenant host)
  const [calSlug, setCalSlug] = useState('');
  const [calUsername, setCalUsername] = useState('');
  const [calBookingUrl, setCalBookingUrl] = useState('');
  const [calWebhookSecret, setCalWebhookSecret] = useState('');
  const [calDisplayName, setCalDisplayName] = useState('');
  const [calWebhookPath, setCalWebhookPath] = useState('/api/cal/webhook');
  const [platformWebhookSecret, setPlatformWebhookSecret] = useState('');
  const [calSaving, setCalSaving] = useState(false);
  const [calLoaded, setCalLoaded] = useState(false);
  const calHost = isCalHostMode();

  // Collapsible sections state — persisted to localStorage
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('notary-settings-collapsed');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const toggleSection = (id: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('notary-settings-collapsed', JSON.stringify([...next]));
      return next;
    });
  };

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

  // Load Google Identity Services on demand when Drive backup is configured.
  useEffect(() => {
    if (!isGdriveConfigured()) return;

    let cancelled = false;
    void ensureGoogleIdentityLoaded().then(() => {
      if (!cancelled && isGdriveReady()) setGisReady(true);
    });

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
    return () => {
      cancelled = true;
      if (gisCheckRef.current) clearInterval(gisCheckRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const safety = window.setTimeout(() => {
      if (!cancelled) setIsLoading(false);
    }, 8000);

    async function loadData() {
      try {
      const settings = await getSettings();
      if (cancelled) return;
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
      setBackupFrequency((settings.backupFrequency as 'off' | 'after-entry' | 'daily') ?? (settings.autoBackup ? 'after-entry' : 'off'));
      setGoogleEmail(settings.googleEmail ?? '');
      setBackupReminderDays(settings.backupReminderDays ?? DEFAULT_THRESHOLD_DAYS);
      setManualBackupOnly(!!settings.manualBackupOnly);
      setWeb3formsKey(settings.web3formsKey ?? '');
      setZoComputerToken(settings.zoComputerToken ?? '');
      // Cal host: CalSetupPanel owns token + Cal config (avoids stale-token 401 on load).
      if (settings.zoComputerToken?.trim() && !isCalHostMode()) {
        try {
          const cal = await getCalMe();
          setCalSlug(cal.slug || '');
          setCalUsername(cal.calUsername || cal.slug || '');
          setCalBookingUrl(cal.calBookingUrl || '');
          setCalDisplayName(cal.displayName || '');
          setCalWebhookPath(cal.webhookPath || '/api/cal/webhook');
          setPlatformWebhookSecret(
            (cal as { platformWebhookSecret?: string }).platformWebhookSecret ||
              '',
          );
          setCalLoaded(true);
        } catch {
          setCalLoaded(false);
        }
      }
      const hasZoConfig = !!(
        localStorage.getItem(ZO_BACKUP_URL_KEY) ||
        localStorage.getItem(ZO_BACKUP_KEY_KEY) ||
        localStorage.getItem(ZO_LAST_BACKUP_KEY)
      );
      const localVisibility = loadBackupPanelVisibility(localStorage, hasZoConfig);
      const settingsVisibility = resolveBackupPanelVisibility({
        googlePreference: settings.showGoogleBackup ?? localVisibility.google,
        zoPreference: settings.showZoBackup ?? localVisibility.zo,
        hasZoConfig,
      });
      setShowGoogleBackup(settingsVisibility.google);
      setShowZoBackup(settingsVisibility.zo);

      hydrateFeeAndSealStateFrom(settings);

      // Biometric is "supported" only if both a platform authenticator and
      // the WebAuthn PRF extension are available. Cap wait so Settings never hangs.
      try {
        const platform = await Promise.race([
          isPlatformAuthenticatorAvailable(),
          new Promise<boolean>((r) => window.setTimeout(() => r(false), 1500)),
        ]);
        if (!platform) {
          setBiometricSupported(false);
          setBiometricUnsupportedExplained('no-platform');
        } else {
          const prfOk = await Promise.race([
            isPrfLikelySupported(),
            new Promise<boolean>((r) => window.setTimeout(() => r(true), 1500)),
          ]);
          setBiometricSupported(prfOk);
          setBiometricUnsupportedExplained(prfOk ? null : 'no-prf');
          if (prfOk) {
            const enabled = await Promise.race([
              isBiometricEnabled(),
              new Promise<boolean>((r) => window.setTimeout(() => r(false), 1000)),
            ]);
            setBiometricEnabled(enabled);
          }
        }
      } catch {
        setBiometricSupported(false);
        setBiometricUnsupportedExplained('no-platform');
      }

      try {
        const entries = await getAllEntries();
        if (!cancelled) setEntryCount(entries.length);
      } catch {
        /* entry count optional on load */
      }
      } catch (err) {
        console.error('Failed to load settings', err);
        toast({
          title: 'Could not load settings',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      } finally {
        window.clearTimeout(safety);
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadData();
    return () => {
      cancelled = true;
      window.clearTimeout(safety);
    };

    // Load initial Google Drive state
    setIsConnected(!!getStoredToken());
    setLastBackup(getLastBackupTime());

    const storedZoApiUrl = localStorage.getItem(ZO_BACKUP_URL_KEY) ?? '';
    const storedZoBackupKey = localStorage.getItem(ZO_BACKUP_KEY_KEY) ?? '';
    const storedZoLastBackup = localStorage.getItem(ZO_LAST_BACKUP_KEY);
    setZoApiUrl(storedZoApiUrl);
    setZoBackupKey(storedZoBackupKey);
    setZoLastBackup(storedZoLastBackup);

    const visibility = loadBackupPanelVisibility(
      localStorage,
      !!(storedZoApiUrl || storedZoBackupKey || storedZoLastBackup),
    );
    setShowGoogleBackup(visibility.google);
    setShowZoBackup(visibility.zo);
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

  const syncBackupPanelVisibilityFromSettings = (settings: Partial<NotarySettings>) => {
    if (typeof settings.showGoogleBackup === 'boolean') {
      setShowGoogleBackup(settings.showGoogleBackup);
      saveBackupPanelVisibility(localStorage, 'google', settings.showGoogleBackup);
    }
    if (typeof settings.showZoBackup === 'boolean') {
      setShowZoBackup(settings.showZoBackup);
      saveBackupPanelVisibility(localStorage, 'zo', settings.showZoBackup);
    }
  };

  const handleGoogleBackupPanelToggle = async (checked: boolean) => {
    setShowGoogleBackup(checked);
    saveBackupPanelVisibility(localStorage, 'google', checked);
    const current = await getSettings();
    await saveSettings({ ...current, showGoogleBackup: checked } as NotarySettings);
    if (!checked) {
      setShowRestoreList(false);
      setSelectedFile(null);
    }
  };

  const handleZoBackupPanelToggle = async (checked: boolean) => {
    setShowZoBackup(checked);
    saveBackupPanelVisibility(localStorage, 'zo', checked);
    const current = await getSettings();
    await saveSettings({ ...current, showZoBackup: checked } as NotarySettings);
    if (!checked) {
      setShowZoRestoreList(false);
      setSelectedZoFile(null);
    }
  };

  const handleSaveStampFee = async () => {
    setSavingStampFee(true);
    try {
      const raw = stampFeeDollars.trim();
      const dollars = raw === '' ? DEFAULT_STAMP_FEE_CENTS / 100 : Number(raw);
      const cents = Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : DEFAULT_STAMP_FEE_CENTS;
      const current = await getSettings();
      await saveSettings({ ...current, stampFeeCents: cents } as NotarySettings);
      toast({ title: 'Stamp fee saved', description: 'New entries will use this amount per notarial act (stamp).' });
    } catch (err) {
      toast({ title: 'Failed to save stamp fee', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
    setSavingStampFee(false);
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
    const stampCents = settings.stampFeeCents ?? DEFAULT_STAMP_FEE_CENTS;
    setStampFeeDollars(stampCents > 0 ? (stampCents / 100).toFixed(2) : '');
    setRequireIdPhoto(!!settings.requireIdFrontPhoto);
    setRequireSignature(settings.requireSignerSignature !== false);
    setJournalCombinedLine(resolveJournalSharedCertMode(settings) === 'combined_line');
    setJournalSplitDocuments(settings.journalSplitDocumentsDefault !== false);
    setSealImage(settings.sealImage);
  }

  const handleImportJSON = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const { detectedVersion, entries, settings: importedSettings, calHostBinding } = parseBackupFile(text);

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
        syncBackupPanelVisibilityFromSettings(sanitized);
        // Refresh local form state so restored fees/seal show up immediately.
        hydrateFeeAndSealStateFrom(await getSettings());
      }

      // Cal OAuth binding (ciphertext) — same host only; best-effort after settings
      let calRestored = false;
      if (calHostBinding && isCalHostMode()) {
        try {
          const s = await getSettings();
          if (s.zoComputerToken?.trim()) {
            await restoreCalOAuthBinding(calHostBinding, s.zoComputerToken);
            calRestored = true;
          }
        } catch (err) {
          console.warn('Cal OAuth binding restore skipped', err);
        }
      }

      toast({
        title: 'Import complete',
        description: `Format v${detectedVersion}: imported ${imported}, skipped ${skipped} duplicates`
          + (restamped ? ', chain restamped' : '')
          + (settingsRestored ? ', settings restored' : '')
          + (calRestored ? ', Cal.com connection restored' : '')
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

  const saveZoConfigFromState = () => {
    const url = zoApiUrl.trim();
    const key = zoBackupKey.trim();
    localStorage.setItem(ZO_BACKUP_URL_KEY, url);
    localStorage.setItem(ZO_BACKUP_KEY_KEY, key);
    setZoApiUrl(url);
    setZoBackupKey(key);
    return { apiUrl: url, backupKey: key };
  };

  const handleSaveZoConfig = () => {
    saveZoConfigFromState();
    toast({ title: 'Zo backup saved', description: 'This browser will use your Zo backup endpoint.' });
  };

  const handleTestZoConnection = async () => {
    setZoBusy(true);
    try {
      const config = saveZoConfigFromState();
      const files = await listZoBackups(config);
      setZoBackupFiles(files);
      toast({ title: 'Zo backup connected', description: `Found ${files.length} backup file${files.length === 1 ? '' : 's'}.` });
    } catch (err) {
      toast({ title: 'Zo backup test failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
    setZoBusy(false);
  };

  const handleZoBackupNow = async () => {
    setZoBusy(true);
    try {
      const config = saveZoConfigFromState();
      const entries = await getAllEntries();
      const settings = await getSettings();
      const name = await uploadZoBackup({
        ...config,
        payload: {
          version: BACKUP_FORMAT_VERSION,
          exportedAt: new Date().toISOString(),
          entries,
          settings,
        },
      });
      const now = new Date().toISOString();
      localStorage.setItem(ZO_LAST_BACKUP_KEY, now);
      setZoLastBackup(now);
      toast({ title: 'Zo backup complete', description: `Saved ${name}.` });
    } catch (err) {
      toast({ title: 'Zo backup failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
    setZoBusy(false);
  };

  const handleShowZoRestoreList = async () => {
    if (showZoRestoreList) {
      setShowZoRestoreList(false);
      return;
    }
    setIsZoLoadingFiles(true);
    setShowZoRestoreList(true);
    try {
      const config = saveZoConfigFromState();
      const files = await listZoBackups(config);
      setZoBackupFiles(files);
    } catch (err) {
      toast({ title: 'Could not list Zo backups', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
      setShowZoRestoreList(false);
    }
    setIsZoLoadingFiles(false);
  };

  const handleConfirmZoRestore = async () => {
    if (!selectedZoFile) return;
    setIsZoRestoring(true);
    try {
      const config = saveZoConfigFromState();
      const text = await downloadZoBackupText({ ...config, fileName: selectedZoFile.name });
      const parsed = parseBackupFile(text);

      const startCount = (await getAllEntries()).length;
      const isEmptyJournal = startCount === 0;

      let imported = 0;
      let skipped = 0;
      for (const entry of parsed.entries) {
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

      let restamped = false;
      if (isEmptyJournal && imported > 0 && parsed.entries.some(e => !e.hash)) {
        await recomputeChainFrom(1);
        restamped = true;
      }

      let settingsRestored = false;
      if (parsed.settings && Object.keys(parsed.settings).length > 0 && window.confirm(
        'This Zo backup includes notary settings (name, commission, defaults). ' +
        'Overwrite your current settings with the values from the backup?'
      )) {
        const current = await getSettings();
        const sanitized: Partial<NotarySettings> = { ...parsed.settings };
        delete (sanitized as Partial<NotarySettings> & { pinHash?: string }).pinHash;
        await saveSettings({ ...current, ...sanitized, id: 1, pinEnabled: true });
        settingsRestored = true;
        syncBackupPanelVisibilityFromSettings(sanitized);
        hydrateFeeAndSealStateFrom(await getSettings());
      }

      let calRestored = false;
      if (parsed.calHostBinding && isCalHostMode()) {
        try {
          const s = await getSettings();
          if (s.zoComputerToken?.trim()) {
            await restoreCalOAuthBinding(parsed.calHostBinding, s.zoComputerToken);
            calRestored = true;
          }
        } catch (err) {
          console.warn('Cal OAuth binding restore skipped', err);
        }
      }

      toast({
        title: 'Zo restore complete',
        description: `Imported ${imported} entries. Skipped ${skipped} duplicates`
          + (restamped ? ', chain restamped' : '')
          + (settingsRestored ? ', settings restored' : '')
          + (calRestored ? ', Cal.com connection restored' : '')
          + '.',
      });
      setSelectedZoFile(null);
      setShowZoRestoreList(false);
      const newEntries = await getAllEntries();
      setEntryCount(newEntries.length);
    } catch (err) {
      toast({ title: 'Zo restore failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
    setIsZoRestoring(false);
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

  const handleBackupFrequencyChange = async (value: string) => {
    const freq = value as 'off' | 'after-entry' | 'daily';
    setBackupFrequency(freq);
    const current = await getSettings();
    await saveSettings({ ...current, backupFrequency: value, autoBackup: freq !== 'off' });
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
        syncBackupPanelVisibilityFromSettings(sanitized);
        hydrateFeeAndSealStateFrom(await getSettings());
      }

      let calRestored = false;
      const driveBinding = (payload as { calHostBinding?: import('@/lib/export').CalHostBinding | null }).calHostBinding;
      if (driveBinding && isCalHostMode()) {
        try {
          const s = await getSettings();
          if (s.zoComputerToken?.trim()) {
            await restoreCalOAuthBinding(driveBinding, s.zoComputerToken);
            calRestored = true;
          }
        } catch (err) {
          console.warn('Cal OAuth binding restore skipped', err);
        }
      }

      toast({
        title: 'Restore complete',
        description: `Imported ${imported} entries. Skipped ${skipped} duplicates`
          + (restamped ? ', chain restamped' : '')
          + (settingsRestored ? ', settings restored' : '')
          + (calRestored ? ', Cal.com connection restored' : '')
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

  const handleSaveIntakeSettings = async () => {
    setIntakeSaving(true);
    try {
      const current = await getSettings();
      await saveSettings({
        ...current,
        web3formsKey: web3formsKey.trim() || undefined,
        zoComputerToken: zoComputerToken.trim() || undefined,
      });
      toast({ title: 'Saved', description: 'Intake settings saved.' });
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
    setIntakeSaving(false);
  };

  const handleSaveCalSettings = async () => {
    setCalSaving(true);
    try {
      const rawCal = calBookingUrl.trim();
      const parsed = rawCal ? parseCalBookingUrl(rawCal) : null;
      if (rawCal && !parsed) {
        throw new Error(
          'Enter your Cal username (e.g. your-cal-username) or a cal.com link',
        );
      }

      const result = await patchCalMe({
        calBookingUrl: parsed?.bookingUrl || '',
        displayName: calDisplayName.trim() || undefined,
      });
      setCalSlug(result.slug || '');
      setCalUsername(result.calUsername || result.slug || '');
      setCalBookingUrl(result.calBookingUrl || '');
      setCalDisplayName(result.displayName || '');
      setCalWebhookPath(result.webhookPath || '/api/cal/webhook');
      setPlatformWebhookSecret(
        (result as { platformWebhookSecret?: string }).platformWebhookSecret ||
          platformWebhookSecret,
      );
      setCalWebhookSecret('');
      setCalLoaded(true);
      toast({ title: 'Cal settings saved', description: 'Public book link updated.' });
    } catch (err) {
      toast({
        title: 'Cal save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
    setCalSaving(false);
  };

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: label });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  const activeIntakeKey = zoComputerToken.trim() || web3formsKey.trim();
  const publicBookUrl = calSlug.trim()
    ? appOriginPath(`/book/${calSlug.trim().toLowerCase()}`)
    : '';
  const webhookFullUrl = `${window.location.origin}/api/cal/webhook`;
  const webhookSecretDisplay = platformWebhookSecret || calWebhookSecret;

  const handleTestIntake = async () => {
    setIntakeTesting(true);
    try {
      const { testIntakeConnection } = await import('@/lib/intake-api');
      const result = await testIntakeConnection();
      toast({
        title: result.ok ? 'Intake connected' : 'Intake test failed',
        description: result.message,
        variant: result.ok ? 'default' : 'destructive',
      });
    } catch (err) {
      toast({
        title: 'Intake test failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
    setIntakeTesting(false);
  };

  const handleCopyIntakeLink = async () => {
    const { appOriginPath } = await import('@/lib/app-path');
    const url = `${appOriginPath('/intake')}?key=${activeIntakeKey}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied', description: 'Share this link with your clients.' });
    } catch {
      toast({ title: 'Copy failed', description: `Your intake link is: ${url}`, variant: 'destructive' });
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-8 pb-32 md:pb-0 min-w-0 overflow-x-hidden">
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
          Reports & Export →
        </Link>
      </div>

      {calHost && (
        <CalSetupPanel onTokenChange={setZoComputerToken} />
      )}

      {/* ── Data & Integrity (top) ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Data & Integrity
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleSection('data-integrity')}>
              {collapsedSections.has('data-integrity') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
          <CardDescription>Verify your journal and export copies for your records</CardDescription>
        </CardHeader>
        {!collapsedSections.has('data-integrity') && (
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/20">
            <Database className="w-8 h-8 text-primary" />
            <div>
              <p className="font-medium text-foreground">Local Storage</p>
              <p className="text-sm text-muted-foreground">{entryCount} entries saved locally on this device.</p>
            </div>
          </div>

          <Button
            variant="outline"
            onClick={handleVerifyChain}
            disabled={verifying}
            className="gap-2 w-full sm:w-auto"
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

          <Alert variant="default" className="bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-900">
            <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertTitle>Data Privacy</AlertTitle>
            <AlertDescription>
              All journal data is stored locally in your browser. Export regularly from{' '}
              <Link href="/reports" className="font-medium underline">Reports</Link>.
            </AlertDescription>
          </Alert>
        </CardContent>
        )}
      </Card>

      {/* ── Backup & Restore (top) ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle className="flex items-center gap-2">
              <Cloud className="w-5 h-5 text-primary" />
              Backup & Restore
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleSection('backup-restore')}>
              {collapsedSections.has('backup-restore') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
          <CardDescription>Back up your journal or restore from a previous backup</CardDescription>
        </CardHeader>
        {!collapsedSections.has('backup-restore') && (
        <CardContent className="space-y-5">
          <div className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
            <div className="space-y-0.5 pr-4">
              <p className="text-sm font-medium">Show Google Drive backup</p>
              <p className="text-xs text-muted-foreground">Cloud backup via Google Drive OAuth.</p>
            </div>
            <Switch
              checked={showGoogleBackup}
              onCheckedChange={handleGoogleBackupPanelToggle}
              data-testid="switch-show-google-backup"
            />
          </div>

          <div className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
            <div className="space-y-0.5 pr-4">
              <p className="text-sm font-medium">Show Zo backup</p>
              <p className="text-xs text-muted-foreground">Self-host backup for Zo Computer deployments.</p>
            </div>
            <Switch
              checked={showZoBackup}
              onCheckedChange={handleZoBackupPanelToggle}
              data-testid="switch-show-zo-backup"
            />
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

          {showZoBackup && (
          <div className="rounded-lg border">
            <button
              type="button"
              className="flex w-full items-center justify-between p-4 text-left"
              onClick={() => toggleSection('backup-zo')}
            >
              <span className="text-sm font-medium flex items-center gap-2">
                <CloudUpload className="w-4 h-4 text-primary" />
                Zo Backup
              </span>
              {collapsedSections.has('backup-zo') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
            {!collapsedSections.has('backup-zo') && (
            <div className="px-4 pb-4 space-y-5 border-t pt-4">
              <Alert variant="default" className="bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900">
                <Cloud className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                <AlertTitle>Easy self-host backup</AlertTitle>
                <AlertDescription>
                  Create `/api/backup` in Zo Space, then paste the endpoint and backup key here.
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="zoBackupUrl">Zo backup API URL</Label>
                  <Input
                    id="zoBackupUrl"
                    placeholder="https://your-handle.zo.space/api/backup"
                    value={zoApiUrl}
                    onChange={e => setZoApiUrl(e.target.value)}
                    data-testid="input-zo-backup-url"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zoBackupKey">Backup key</Label>
                  <Input
                    id="zoBackupKey"
                    type="password"
                    placeholder="Paste the key Zo generated"
                    value={zoBackupKey}
                    onChange={e => setZoBackupKey(e.target.value)}
                    data-testid="input-zo-backup-key"
                  />
                </div>
              </div>

              {zoLastBackup && (
                <p className="text-sm text-muted-foreground">
                  Last Zo backup: {formatRelativeTime(zoLastBackup)}
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" className="gap-2" onClick={handleSaveZoConfig} disabled={zoBusy} data-testid="button-save-zo-backup">
                  <Save className="w-4 h-4" /> Save Zo Settings
                </Button>
                <Button variant="outline" className="gap-2" onClick={handleTestZoConnection} disabled={zoBusy} data-testid="button-test-zo-backup">
                  <RefreshCw className={`w-4 h-4 ${zoBusy ? 'animate-spin' : ''}`} /> Test Connection
                </Button>
                <Button variant="outline" className="gap-2" onClick={handleZoBackupNow} disabled={zoBusy} data-testid="button-backup-zo-now">
                  <CloudUpload className="w-4 h-4" /> Backup to Zo
                </Button>
                <Button variant="outline" className="gap-2" onClick={handleShowZoRestoreList} disabled={isZoLoadingFiles || zoBusy} data-testid="button-restore-zo">
                  <RotateCcw className={`w-4 h-4 ${isZoLoadingFiles ? 'animate-spin' : ''}`} />
                  {isZoLoadingFiles ? 'Loading...' : showZoRestoreList ? 'Hide Zo Backups' : 'Restore from Zo'}
                </Button>
              </div>

              {showZoRestoreList && !isZoLoadingFiles && (
                <div className="border rounded-lg divide-y animate-in slide-in-from-top-2">
                  {zoBackupFiles.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No Zo backup files found.</p>
                  ) : (
                    zoBackupFiles.map(file => (
                      <div key={file.name} className="p-3 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          {file.modifiedTime && (
                            <p className="text-xs text-muted-foreground">{formatRelativeTime(file.modifiedTime)}</p>
                          )}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setSelectedZoFile(file)} data-testid={`button-restore-zo-file-${file.name}`}>
                          Restore
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {selectedZoFile && (
                <div className="p-4 border border-amber-300 rounded-lg bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 space-y-3 animate-in slide-in-from-top-2">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    Restore from "{selectedZoFile.name}"?
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    Entries in the backup will be merged with your existing journal. Duplicate entry numbers will be skipped.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleConfirmZoRestore} disabled={isZoRestoring} data-testid="button-confirm-zo-restore">
                      {isZoRestoring ? 'Restoring...' : 'Confirm Restore'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedZoFile(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
          )}

          {showGoogleBackup && (
          <div className="rounded-lg border">
            <button
              type="button"
              className="flex w-full items-center justify-between p-4 text-left"
              onClick={() => toggleSection('backup-google')}
            >
              <span className="text-sm font-medium flex items-center gap-2">
                <Cloud className="w-4 h-4 text-primary" />
                Cloud Backup (Google Drive)
              </span>
              {collapsedSections.has('backup-google') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
            {!collapsedSections.has('backup-google') && (
            <div className="px-4 pb-4 space-y-5 border-t pt-4">
              {!configured && (
                <p className="text-sm text-muted-foreground">
                  Google Drive backup is not enabled. Contact the app administrator to set it up.
                </p>
              )}

              {configured && (
                <>
                  <div className="space-y-3 rounded-lg border p-4 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">Remind me to back up</p>
                        <p className="text-xs text-muted-foreground">Show a banner on the dashboard if my last backup is older than this.</p>
                      </div>
                      <Select value={String(backupReminderDays)} onValueChange={handleBackupReminderChange} disabled={manualBackupOnly}>
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
                        <p className="text-xs text-muted-foreground">Suppresses the dashboard reminder.</p>
                      </div>
                      <Switch checked={manualBackupOnly} onCheckedChange={handleManualBackupOnlyToggle} data-testid="switch-manual-backup-only" />
                    </div>
                  </div>

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
                      <div className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium flex items-center gap-2">
                            <CloudUpload className="w-4 h-4 text-primary" />
                            Auto-backup
                          </p>
                          <p className="text-xs text-muted-foreground">How often to back up to Drive</p>
                        </div>
                        <Select value={backupFrequency} onValueChange={handleBackupFrequencyChange} data-testid="select-backup-frequency">
                          <SelectTrigger className="w-[160px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="off">Off</SelectItem>
                            <SelectItem value="after-entry">After each entry</SelectItem>
                            <SelectItem value="daily">Daily</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <Button variant="outline" className="gap-2" onClick={handleBackupNow} disabled={isBackingUp} data-testid="button-backup-now">
                          <CloudUpload className="w-4 h-4" />
                          {isBackingUp ? 'Backing up…' : 'Backup now'}
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={handleShowRestoreList} disabled={isLoadingFiles} data-testid="button-restore-gdrive">
                          <RotateCcw className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                          {isLoadingFiles ? 'Loading...' : showRestoreList ? 'Hide Backups' : 'Restore from Drive'}
                        </Button>
                      </div>

                      {showRestoreList && !isLoadingFiles && (
                        <div className="border rounded-lg divide-y animate-in slide-in-from-top-2">
                          {backupFiles.length === 0 ? (
                            <p className="p-4 text-sm text-muted-foreground">No backup files found.</p>
                          ) : (
                            backupFiles.map(file => (
                              <div key={file.id} className="p-3 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{file.name}</p>
                                  <p className="text-xs text-muted-foreground">{formatRelativeTime(file.modifiedTime)}</p>
                                </div>
                                <Button size="sm" variant="outline" onClick={() => handleRestore(file)} data-testid={`button-restore-file-${file.id}`}>
                                  Restore
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {selectedFile && (
                        <div className="p-4 border border-amber-300 rounded-lg bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 space-y-3 animate-in slide-in-from-top-2">
                          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                            Restore from "{selectedFile.name}"?
                          </p>
                          <p className="text-xs text-amber-800 dark:text-amber-300">
                            Entries in the backup will be merged with your existing journal. Duplicate entry numbers will be skipped.
                          </p>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleConfirmRestore} disabled={isRestoring} data-testid="button-confirm-restore">
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
            </div>
            )}
          </div>
          )}
        </CardContent>
        )}
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <CardTitle>Notary Profile</CardTitle>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleSection('notary-profile')}>
                  {collapsedSections.has('notary-profile') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </Button>
              </div>
              <CardDescription>Your official commission information used for journal entries</CardDescription>
            </CardHeader>
            {!collapsedSections.has('notary-profile') && (
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
                      <FormDescription>
                        Used for fee rules in signing appointments (OK: $5/act; PA ack: $5 + $2 per additional name on shared cert).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
            )}
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
              <div className="flex items-center justify-between w-full">
                <CardTitle>Journal Compliance</CardTitle>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleSection('journal-compliance')}>
                  {collapsedSections.has('journal-compliance') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </Button>
              </div>
              <CardDescription>
                Match what your state allows you to record. Defaults are on for most states.
              </CardDescription>
            </CardHeader>
            {!collapsedSections.has('journal-compliance') && (
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
              <FormField
                control={form.control}
                name="recordSignerIdNumber"
                render={() => (
                  <FormItem className="flex flex-row items-start justify-between gap-4 rounded-lg border p-4 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base font-medium">Require signer signature</FormLabel>
                      <FormDescription>
                        When off, the signature step is skipped and entries can be completed without a
                        signer&apos;s signature. Turn off for states that don&apos;t require a journal
                        signature (e.g. Pennsylvania).
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={requireSignature}
                        onCheckedChange={async (checked) => {
                          setRequireSignature(checked);
                          const current = await getSettings();
                          await saveSettings({ ...current, requireSignerSignature: checked } as NotarySettings);
                          toast({ title: checked ? 'Signature required' : 'Signature optional', description: 'Compliance preference saved.' });
                        }}
                        data-testid="switch-require-signature"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="flex flex-row items-start justify-between gap-4 rounded-lg border p-4 shadow-sm">
                <div className="space-y-0.5">
                  <p className="text-base font-medium">Require ID front photo</p>
                  <p className="text-sm text-muted-foreground">
                    When on, you must capture the front of the signer&apos;s ID before completing an entry (including after a barcode scan).
                  </p>
                </div>
                <Switch
                  checked={requireIdPhoto}
                  onCheckedChange={async (checked) => {
                    setRequireIdPhoto(checked);
                    const current = await getSettings();
                    await saveSettings({ ...current, requireIdFrontPhoto: checked } as NotarySettings);
                    toast({ title: checked ? 'ID photo required' : 'ID photo optional', description: 'Preference saved.' });
                  }}
                  data-testid="switch-require-id-photo"
                />
              </div>
              <div className="flex flex-row items-start justify-between gap-4 rounded-lg border p-4 shadow-sm">
                <div className="space-y-0.5">
                  <p className="text-base font-medium">Default: combine co-signers on one journal line</p>
                  <p className="text-sm text-muted-foreground">
                    When on, shared-certificate signings start with &quot;combine co-signers&quot; checked
                    (one entry with signer #1, #2, #3). Off by default — turn on if you usually want one line for co-signers.
                    You can still change it per signing on the Documents step.
                  </p>
                </div>
                <Switch
                  checked={journalCombinedLine}
                  onCheckedChange={async (checked) => {
                    setJournalCombinedLine(checked);
                    const current = await getSettings();
                    await saveSettings({
                      ...current,
                      journalSharedCertMode: checked ? 'combined_line' : 'separate_lines',
                    } as NotarySettings);
                    toast({
                      title: checked ? 'Combined line default' : 'Separate lines default',
                      description: 'Journal layout preference saved.',
                    });
                  }}
                  data-testid="switch-journal-combined-line"
                />
              </div>
              <div className="flex flex-row items-start justify-between gap-4 rounded-lg border p-4 shadow-sm">
                <div className="space-y-0.5">
                  <p className="text-base font-medium">Default: one journal line per document</p>
                  <p className="text-sm text-muted-foreground">
                    When you type comma-separated document types (deed, affidavit, will), this controls
                    whether each document gets its own journal line by default. You can still toggle it
                    on each entry.
                  </p>
                </div>
                <Switch
                  checked={journalSplitDocuments}
                  onCheckedChange={async (checked) => {
                    setJournalSplitDocuments(checked);
                    const current = await getSettings();
                    await saveSettings({
                      ...current,
                      journalSplitDocumentsDefault: checked,
                    } as NotarySettings);
                    toast({
                      title: checked ? 'Split documents by default' : 'Single line by default',
                      description: 'Journal layout preference saved.',
                    });
                  }}
                  data-testid="switch-journal-split-documents"
                />
              </div>
              <JournalLayoutHelp />
            </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <CardTitle>Security & Appearance</CardTitle>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleSection('security-appearance')}>
                  {collapsedSections.has('security-appearance') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </Button>
              </div>
              <CardDescription>App access and display preferences</CardDescription>
            </CardHeader>
            {!collapsedSections.has('security-appearance') && (
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
            )}
            <CardFooter className="bg-muted/30 border-t px-6 py-4">
              <Button type="submit" disabled={isSaving} className="gap-2" data-testid="button-save-settings">
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Settings'}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>

      {!calHost && (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              Cal.com scheduling
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleSection('cal-scheduling')}>
              {collapsedSections.has('cal-scheduling') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
          <CardDescription>
            Replace public intake with your Cal.com booking page. Clients open your book link; fees/payments stay in Cal.
            {calHost
              ? ' Requires your personal account token (create above) — not a shared server token.'
              : ' Requires Zo Computer form token above (same token authenticates API).'}
          </CardDescription>
        </CardHeader>
        {!collapsedSections.has('cal-scheduling') && (
        <CardContent className="space-y-4">
          {!zoComputerToken.trim() && (
            <Alert>
              <AlertDescription>
                {calHost
                  ? 'Create your personal account above first, then configure Cal here.'
                  : 'Save a Zo Computer form token first, then configure Cal here.'}
              </AlertDescription>
            </Alert>
          )}
          <div>
            <Label htmlFor="cal-display-name">Display name (public)</Label>
            <Input
              id="cal-display-name"
              className="mt-1"
              value={calDisplayName}
              onChange={(e) => setCalDisplayName(e.target.value)}
              placeholder="Jane Mobile Notary"
            />
          </div>
          <div>
            <Label htmlFor="cal-booking-url">Cal username or link</Label>
            <Input
              id="cal-booking-url"
              className="mt-1 font-mono text-sm"
              value={calBookingUrl}
              onChange={(e) => setCalBookingUrl(e.target.value)}
              placeholder="your-cal-username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Must match your Cal profile username exactly — webhooks route by this value.
              Your public book link:
              {" "}
              <span className="font-mono">
                {publicBookUrl || `${appOriginPath('/book/')}your-cal-username`}
              </span>
            </p>
            {calUsername && (
              <p className="text-xs mt-2">
                Linked for webhooks: <span className="font-mono font-medium">{calUsername}</span>
              </p>
            )}
          </div>
          <div className="rounded-lg border bg-muted/50 p-3 space-y-3">
            <p className="text-sm font-medium">Cal webhook (same for everyone)</p>
            <p className="text-xs text-muted-foreground">
              Cal.com usernames are unique — there is only one{" "}
              <span className="font-mono">cal.com/your-cal-username</span>. All notaries paste{" "}
              <strong>this same URL and secret</strong> into their own Cal account. Incoming
              bookings go only to the notary whose username matches.
            </p>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Subscriber URL</p>
              <p className="text-sm font-mono break-all">{webhookFullUrl}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1 mt-2"
                onClick={() => void copyText("Webhook URL", webhookFullUrl)}
              >
                <Copy className="w-3 h-3" /> Copy webhook URL
              </Button>
            </div>
            {webhookSecretDisplay ? (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Shared secret</p>
                <p className="text-sm font-mono break-all">{webhookSecretDisplay}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1 mt-2"
                  onClick={() => void copyText("Webhook secret", webhookSecretDisplay)}
                >
                  <Copy className="w-3 h-3" /> Copy secret
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Save Cal settings once (with Zo token) to load the shared secret.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Cal → Settings → Developer → Webhooks → New → paste URL + secret → enable Booking
              Created (and Cancelled/Rescheduled if you want).
            </p>
          </div>
          {publicBookUrl && (
            <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Public book link</p>
              <p className="text-sm font-mono break-all">{publicBookUrl}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => void copyText('Book link', publicBookUrl)}>
                  <Copy className="w-3 h-3" /> Copy book link
                </Button>
              </div>
            </div>
          )}
          <Button
            onClick={() => void handleSaveCalSettings()}
            disabled={calSaving || !zoComputerToken.trim()}
            className="gap-2"
          >
            {calSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Cal settings
          </Button>
        </CardContent>
        )}
      </Card>
      )}

      {/* ── Client Intake Form ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle className="flex items-center gap-2">
              Client Intake Form
              <span className="inline-flex items-center rounded-full border bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400 border-purple-500/30">
                BETA
              </span>
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleSection('client-intake')}>
              {collapsedSections.has('client-intake') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
          <CardDescription>
            Share a link with clients so they can submit their info before the appointment.
            On Zo Computer, use a Zo form token; otherwise use{' '}
            <a href="https://web3forms.com" target="_blank" rel="noreferrer" className="underline">Web3Forms</a> (free).
          </CardDescription>
        </CardHeader>
        {!collapsedSections.has('client-intake') && (
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-2">
            {calHost ? (
              <>
                <p className="font-medium">Cal host — account token</p>
                <p className="text-muted-foreground text-xs">
                  Your token is created automatically in <strong>Cal scheduling setup</strong> at the
                  top of this page. Legacy intake form is optional on the Cal host.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">Zo Computer (recommended on Zo deploy)</p>
                <p className="text-muted-foreground text-xs">
                  Paste the token from your Zo deploy prompt (SQLite user row). When set on Zo, intake uses the built-in server — no Web3Forms required.
                </p>
              </>
            )}
            {!calHost && (
              <>
                <p className="font-medium mt-3">Web3Forms (Cloudflare, Netlify, static, or Zo fallback)</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
                  <li>Get a free key at <a href="https://web3forms.com" target="_blank" rel="noreferrer" className="underline text-foreground">web3forms.com</a></li>
                  <li>Paste below — kept if you switch back from Zo intake</li>
                </ol>
              </>
            )}
          </div>

          {!calHost && (
          <div>
            <Label htmlFor="zo-computer-token">Zo Computer Form Token</Label>
            <Input
              id="zo-computer-token"
              placeholder="Paste token from Zo deploy (Zo Computer only)"
              value={zoComputerToken}
              onChange={(e) => setZoComputerToken(e.target.value)}
              className="mt-1 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              On first Zo deploy, copy Zo Intake Token from server logs (created automatically). Clear to use Web3Forms only.
            </p>
          </div>
          )}

          {calHost && zoComputerToken.trim() && (
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground mb-1">Your account token (from Cal setup above)</p>
            <p className="text-sm font-mono break-all">{zoComputerToken}</p>
          </div>
          )}

          {!calHost && (
          <div>
            <Label htmlFor="web3forms-key">Web3Forms Access Key</Label>
            <Input
              id="web3forms-key"
              placeholder="Paste your Web3Forms access key here"
              value={web3formsKey}
              onChange={(e) => setWeb3formsKey(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Found at web3forms.com — no account or signup required
            </p>
          </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleSaveIntakeSettings}
              disabled={intakeSaving}
              className="gap-2"
            >
              {intakeSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </Button>
            <Button
              variant="outline"
              onClick={handleTestIntake}
              disabled={intakeTesting || (!zoComputerToken.trim() && !web3formsKey.trim())}
              className="gap-2"
            >
              {intakeTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Test connection
            </Button>
            <Button
              variant="outline"
              onClick={handleCopyIntakeLink}
              disabled={!activeIntakeKey}
              className="gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Copy Intake Link
            </Button>
          </div>

          {activeIntakeKey && (
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground mb-1">
                Intake link ({zoComputerToken.trim() ? 'Zo Computer' : 'Web3Forms'}):
              </p>
              <p className="text-sm font-mono break-all">{appOriginPath('/intake')}?key={activeIntakeKey}</p>
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {/* ── Default Fees Card ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              Default Fees
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleSection('default-fees')}>
              {collapsedSections.has('default-fees') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
          <CardDescription>
            Pre-fill the fee on new entries based on the type of notarial act. Leave blank to use $0.
          </CardDescription>
        </CardHeader>
        {!collapsedSections.has('default-fees') && (
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
        )}
        <CardFooter className="bg-muted/30 border-t px-6 py-4">
          <Button onClick={handleSaveDefaultFees} disabled={savingFees} className="gap-2" data-testid="button-save-default-fees">
            <Save className="w-4 h-4" /> {savingFees ? 'Saving...' : 'Save Default Fees'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              Stamp Fee
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleSection('stamp-fee')}>
              {collapsedSections.has('stamp-fee') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
          <CardDescription>
            Statutory fee per stamp. On new entries, # of stamps × this rate fills the notarial fee. Mobile/travel stays in Default Fees above.
          </CardDescription>
        </CardHeader>
        {!collapsedSections.has('stamp-fee') && (
        <CardContent>
          <div className="flex items-center justify-between gap-3 max-w-sm">
            <Label htmlFor="stamp-fee">Fee per stamp</Label>
            <div className="relative w-32">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                id="stamp-fee"
                type="number"
                step="0.01"
                min="0"
                className="pl-6"
                value={stampFeeDollars}
                onChange={(e) => setStampFeeDollars(e.target.value)}
                data-testid="input-stamp-fee"
              />
            </div>
          </div>
        </CardContent>
        )}
        <CardFooter className="bg-muted/30 border-t px-6 py-4">
          <Button onClick={handleSaveStampFee} disabled={savingStampFee} className="gap-2" data-testid="button-save-stamp-fee">
            <Save className="w-4 h-4" /> {savingStampFee ? 'Saving...' : 'Save stamp fee'}
          </Button>
        </CardFooter>
      </Card>

      {/* ── Notary Seal or Logo Card ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle className="flex items-center gap-2">
              <Stamp className="w-5 h-5 text-primary" />
              Seal/Logo
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleSection('seal-logo')}>
              {collapsedSections.has('seal-logo') ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
          <CardDescription>
            Upload a small PNG or JPG of your seal or logo (recommended ~300×300 pixels). It will be stamped in the lower-right corner of every page in your exported PDFs.
          </CardDescription>
        </CardHeader>
        {!collapsedSections.has('seal-logo') && (
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
        )}
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
                        // Cap wipe so UI never freezes if IDB hangs
                        await Promise.race([
                          wipeAllLocalData(),
                          new Promise<void>((resolve) =>
                            window.setTimeout(resolve, 6000),
                          ),
                        ]);
                      } catch (err) {
                        console.warn('wipe incomplete', err);
                      }
                      // Always hard-reload with cache buster so splash/init runs clean
                      const base = import.meta.env.BASE_URL || '/';
                      const url = `${base}${base.includes('?') ? '&' : '?'}reset=${Date.now()}`;
                      window.location.replace(url);
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

      <div className="text-center text-sm text-muted-foreground pt-4 pb-8 space-y-1">
        <p>Notary Journal App v1.1.0</p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          <span>·</span>
          <Link href="/terms" className="text-primary hover:underline">
            Terms of Use
          </Link>
        </div>
      </div>
    </div>
  );
}
