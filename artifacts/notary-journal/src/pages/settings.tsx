import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, Lock, Download, Upload, Database, Moon, Sun, AlertTriangle, CloudUpload, Cloud, CloudOff, RefreshCw, RotateCcw, CheckCircle2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { getSettings, saveSettings, getAllEntries, changePin, lock, verifyChain, importEntry, recomputeChainFrom, type NotarySettings, type ChainVerificationResult, type JournalEntry } from '@/lib/db';
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
      });
      setAutoBackup(settings.autoBackup ?? false);
      setGoogleEmail(settings.googleEmail ?? '');

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
        toast({ title: 'PIN changed', description: 'Your journal has been re-encrypted with the new PIN.' });
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
      let restamped = false;
      if (isEmptyJournal && imported > 0 && entries.some(e => !e.hash || !e.previousEntryHash)) {
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
    exportAllCSV(entries);
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
      }

      toast({
        title: 'Restore complete',
        description: `Imported ${imported} entries. Skipped ${skipped} duplicates${settingsRestored ? ', settings restored' : ''}.`,
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your notary profile and app preferences</p>
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

      <div className="text-center text-sm text-muted-foreground pt-4 pb-8">
        <p>Notary Journal App v1.0.0</p>
      </div>
    </div>
  );
}
