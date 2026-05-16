import { useCallback, useEffect, useState } from 'react';
import { ClipboardCopy, Link2, Loader2, RefreshCw, Server, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { getSettings, saveSettings, type NotarySettings } from '@/lib/db';
import {
  buildIntakeFormConfig,
  checkIntakeApiHealth,
  fetchIntakeConfig,
  generateIntakeSecret,
  getIntakeShareUrl,
  syncIntakeSettingsToServer,
} from '@/lib/intake';

export function IntakeSetupCard() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [serverLive, setServerLive] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<NotarySettings | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [allowId, setAllowId] = useState(true);
  const [showEmail, setShowEmail] = useState(true);
  const [showPhone, setShowPhone] = useState(true);
  const [showAddress, setShowAddress] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [showPreferredDate, setShowPreferredDate] = useState(true);
  const [archiveDrive, setArchiveDrive] = useState(false);

  const applySettingsToForm = (s: NotarySettings) => {
    setSettings(s);
    setFormTitle(s.intakeFormTitle ?? '');
    setAllowId(s.intakeAllowIdUpload !== false);
    setShowEmail(s.intakeShowEmail !== false);
    setShowPhone(s.intakeShowPhone !== false);
    setShowAddress(s.intakeShowAddress !== false);
    setShowNotes(s.intakeShowNotes !== false);
    setShowPreferredDate(s.intakeShowPreferredDate !== false);
    setArchiveDrive(!!s.archiveIntakeToDrive);
  };

  /** Push form config to this host's intake API (required before clients can open the link). */
  const publishFormToServer = useCallback(async (s: NotarySettings) => {
    const config = buildIntakeFormConfig({
      ...s,
      intakeFormTitle: formTitle,
      intakeAllowIdUpload: allowId,
      intakeShowEmail: showEmail,
      intakeShowPhone: showPhone,
      intakeShowAddress: showAddress,
      intakeShowNotes: showNotes,
      intakeShowPreferredDate: showPreferredDate,
    });
    await syncIntakeSettingsToServer(s.intakeSecret!, config);
    const live = await fetchIntakeConfig(s.intakeSecret!);
    setServerLive(!!live);
    return !!live;
  }, [formTitle, allowId, showEmail, showPhone, showAddress, showNotes, showPreferredDate]);

  useEffect(() => {
    void (async () => {
      const health = await checkIntakeApiHealth();
      setApiOk(health);
      const s = await getSettings();
      applySettingsToForm(s);
      if (!health || !s.intakeSecret) {
        setServerLive(s.intakeSecret ? false : null);
        return;
      }
      try {
        await publishFormToServer(s);
      } catch {
        setServerLive(false);
      }
    })();
  }, [publishFormToServer]);

  const shareUrl = settings?.intakeSecret ? getIntakeShareUrl(settings.intakeSecret) : '';

  const persist = async (patch: Partial<NotarySettings>) => {
    const current = await getSettings();
    const next = { ...current, ...patch } as NotarySettings;
    await saveSettings(next);
    setSettings(next);
    return next;
  };

  const generateLink = async () => {
    setBusy(true);
    try {
      const secret = generateIntakeSecret();
      const next = await persist({
        intakeSecret: secret,
        intakeFormTitle: formTitle || undefined,
        intakeAllowIdUpload: allowId,
        intakeShowEmail: showEmail,
        intakeShowPhone: showPhone,
        intakeShowAddress: showAddress,
        intakeShowNotes: showNotes,
        intakeShowPreferredDate: showPreferredDate,
        archiveIntakeToDrive: archiveDrive,
      });
      const live = await publishFormToServer(next);
      if (!live) throw new Error('Form did not publish to server');
      toast({ title: 'Intake link ready', description: 'Copy and share with clients.' });
    } catch (err) {
      toast({
        title: 'Setup failed',
        description: err instanceof Error ? err.message : 'Server may not support intake (use Zo, Cloudflare Workers, or git-connected Netlify).',
        variant: 'destructive',
      });
    }
    setBusy(false);
  };

  const saveOptions = async () => {
    if (!settings?.intakeSecret) {
      toast({ title: 'Generate a link first', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const next = await persist({
        intakeFormTitle: formTitle,
        intakeAllowIdUpload: allowId,
        intakeShowEmail: showEmail,
        intakeShowPhone: showPhone,
        intakeShowAddress: showAddress,
        intakeShowNotes: showNotes,
        intakeShowPreferredDate: showPreferredDate,
        archiveIntakeToDrive: archiveDrive,
      });
      const live = await publishFormToServer(next);
      if (!live) throw new Error('Server did not accept form settings');
      toast({ title: 'Intake settings saved', description: 'Client form is live on this site.' });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
    setBusy(false);
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    toast({ title: 'Link copied' });
  };

  return (
    <Card data-testid="card-intake-setup">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-primary" />
          Client intake form
        </CardTitle>
        <CardDescription>
          Works on Zo, Cloudflare Workers, and git-connected Netlify (not drag-and-drop zip). Each
          deployment has its own link — share the URL from <strong>this</strong> site only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-muted-foreground shrink-0" />
            {apiOk === null ? (
              <span className="text-muted-foreground">Checking server…</span>
            ) : apiOk ? (
              <span className="text-green-700 dark:text-green-400">Intake API available on this site</span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">
                Intake API not detected — static-only hosting cannot receive form submissions.
              </span>
            )}
          </div>
          {settings?.intakeSecret && apiOk && (
            <div className="flex items-center gap-2 pl-6">
              {serverLive === null ? (
                <span className="text-muted-foreground">Checking client form…</span>
              ) : serverLive ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <span className="text-green-700 dark:text-green-400">Client form is live — safe to share link</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                  <span className="text-destructive">
                    Form not published on server — click Save form options below
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="intake-title">Form title</Label>
          <Input
            id="intake-title"
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            placeholder="Request notarization"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleRow label="Optional ID photos" checked={allowId} onCheckedChange={setAllowId} />
          <ToggleRow label="Email field" checked={showEmail} onCheckedChange={setShowEmail} />
          <ToggleRow label="Phone field" checked={showPhone} onCheckedChange={setShowPhone} />
          <ToggleRow label="Address fields" checked={showAddress} onCheckedChange={setShowAddress} />
          <ToggleRow label="Notes" checked={showNotes} onCheckedChange={setShowNotes} />
          <ToggleRow label="Preferred date" checked={showPreferredDate} onCheckedChange={setShowPreferredDate} />
          <ToggleRow
            label="Archive to Google Drive (Jobs folder)"
            checked={archiveDrive}
            onCheckedChange={setArchiveDrive}
          />
        </div>

        {shareUrl && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Shareable link (this site only)</p>
            <p className="text-sm break-all font-mono">{shareUrl}</p>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void copyLink()}>
              <ClipboardCopy className="w-4 h-4" /> Copy link
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t bg-muted/30 px-6 py-4">
        <Button type="button" onClick={() => void generateLink()} disabled={busy || !apiOk} className="gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {settings?.intakeSecret ? 'Rotate link' : 'Generate link'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void saveOptions()} disabled={busy || !settings?.intakeSecret || !apiOk}>
          Save form options
        </Button>
      </CardFooter>
    </Card>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
