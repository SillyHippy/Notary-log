import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, Lock, Download, Database, Moon, Sun, AlertTriangle, CloudUpload, Cloud, CloudOff, RefreshCw, RotateCcw, CheckCircle2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { getSettings, saveSettings, getAllEntries, type NotarySettings } from '@/lib/db';
import { exportAllCSV, exportAllJSON, exportAllPDF } from '@/lib/export';
import {
  isGdriveConfigured,
  isGdriveReady,
  getClientId,
  setClientId,
  getStoredToken,
  getLastBackupTime,
  signInAndGetEmail,
  disconnectGdrive,
  backupToDrive,
  listBackupFiles,
  restoreFromDrive,
  type BackupFile,
} from '@/lib/gdrive';
import { importEntry } from '@/lib/db';

const settingsSchema = z.object({
  notaryName: z.string().min(1, 'Notary name is required'),
  commissionNumber: z.string().min(1, 'Commission number is required'),
  commissionExpiration: z.string().min(1, 'Expiration date is required'),
  defaultCity: z.string().min(1, 'Default city is required'),
  defaultState: z.string().min(2, 'Default state is required').max(2, 'Use 2-letter state code'),
  pinEnabled: z.boolean(),
  pinHash: z.string().optional(),
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
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [entryCount, setEntryCount] = useState(0);

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
  const [clientIdInput, setClientIdInput] = useState('');
  const [showClientIdSetup, setShowClientIdSetup] = useState(false);
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
      pinEnabled: false,
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
        pinEnabled: settings.pinEnabled || false,
        pinHash: settings.pinHash,
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
    setClientIdInput(getClientId());
  }, [form]);

  const hashPin = async (pin: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const onSubmit = async (data: SettingsFormValues) => {
    setIsSaving(true);

    if (data.pinEnabled && showPinSetup) {
      if (pinInput.length !== 4) {
        toast({ title: 'Invalid PIN', description: 'PIN must be 4 digits', variant: 'destructive' });
        setIsSaving(false);
        return;
      }
      if (pinInput !== confirmPinInput) {
        toast({ title: 'PIN mismatch', description: 'PINs do not match', variant: 'destructive' });
        setIsSaving(false);
        return;
      }
      data.pinHash = await hashPin(pinInput);
      setShowPinSetup(false);
    }

    if (!data.pinEnabled) {
      data.pinHash = undefined;
    }

    const current = await getSettings();
    await saveSettings({ ...current, ...data } as NotarySettings);

    if (data.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    toast({ title: 'Settings saved', description: 'Your preferences have been updated.' });
    setIsSaving(false);
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
    exportAllJSON(entries);
  };

  // ── Google Drive handlers ───────────────────────────────────────────────────

  const handleSaveClientId = () => {
    if (!clientIdInput.trim()) {
      toast({ title: 'Client ID required', description: 'Please paste your Google OAuth Client ID.', variant: 'destructive' });
      return;
    }
    setClientId(clientIdInput.trim());
    setShowClientIdSetup(false);
    toast({ title: 'Client ID saved', description: 'You can now connect Google Drive.' });
  };

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

      toast({
        title: 'Restore complete',
        description: `Imported ${imported} entries. Skipped ${skipped} duplicates.`,
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
              <FormField
                control={form.control}
                name="pinEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base flex items-center gap-2">
                        <Lock className="w-4 h-4 text-primary" />
                        PIN Lock
                      </FormLabel>
                      <FormDescription>
                        Require a 4-digit PIN to access the journal
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          if (checked) setShowPinSetup(true);
                          else setShowPinSetup(false);
                        }}
                        data-testid="switch-pin-enabled"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {showPinSetup && (
                <div className="p-4 border rounded-lg bg-muted/50 space-y-4 animate-in slide-in-from-top-2">
                  <h4 className="font-medium text-sm">Set up your PIN</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="pin">Enter 4-digit PIN</Label>
                      <Input
                        id="pin"
                        type="password"
                        maxLength={4}
                        value={pinInput}
                        onChange={e => setPinInput(e.target.value.replace(/[^0-9]/g, ''))}
                        data-testid="input-pin-setup"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirmPin">Confirm PIN</Label>
                      <Input
                        id="confirmPin"
                        type="password"
                        maxLength={4}
                        value={confirmPinInput}
                        onChange={e => setConfirmPinInput(e.target.value.replace(/[^0-9]/g, ''))}
                        data-testid="input-pin-confirm"
                      />
                    </div>
                  </div>
                </div>
              )}

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

          {/* Step 1: Client ID setup */}
          {!configured && !showClientIdSetup && (
            <div className="space-y-3">
              <Alert className="bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
                <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertTitle>One-time setup required</AlertTitle>
                <AlertDescription className="text-sm space-y-1">
                  <p>To use Google Drive backup, you need a free Google OAuth Client ID.</p>
                  <p className="font-medium">How to get one:</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-xs mt-1">
                    <li>Go to <span className="font-mono">console.cloud.google.com</span></li>
                    <li>Create a project &rarr; Enable "Google Drive API"</li>
                    <li>APIs &amp; Services &rarr; Credentials &rarr; Create OAuth Client ID</li>
                    <li>Application type: "Web application"</li>
                    <li>Add your app's URL to Authorized JavaScript Origins</li>
                    <li>Copy the Client ID and paste it below</li>
                  </ol>
                </AlertDescription>
              </Alert>
              <Button variant="outline" className="gap-2" onClick={() => setShowClientIdSetup(true)} data-testid="button-setup-gdrive">
                <Cloud className="w-4 h-4" /> Set Up Google Drive
              </Button>
            </div>
          )}

          {showClientIdSetup && (
            <div className="space-y-3 p-4 border rounded-lg bg-muted/30 animate-in slide-in-from-top-2">
              <Label htmlFor="clientId" className="text-sm font-medium">Google OAuth Client ID</Label>
              <Input
                id="clientId"
                placeholder="123456789012-abcdefg.apps.googleusercontent.com"
                value={clientIdInput}
                onChange={e => setClientIdInput(e.target.value)}
                data-testid="input-google-client-id"
              />
              <p className="text-xs text-muted-foreground">
                Make sure your app's domain is listed as an Authorized JavaScript Origin in your Google Cloud project.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveClientId} data-testid="button-save-client-id">Save Client ID</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowClientIdSetup(false)}>Cancel</Button>
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
                      {gisReady ? 'Connect' : 'Loading...'}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={handleDisconnect} data-testid="button-disconnect-gdrive">
                      Disconnect
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setShowClientIdSetup(true)}>
                    Change
                  </Button>
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
        </CardContent>
      </Card>

      <div className="text-center text-sm text-muted-foreground pt-4 pb-8">
        <p>Notary Journal App v1.0.0</p>
      </div>
    </div>
  );
}
