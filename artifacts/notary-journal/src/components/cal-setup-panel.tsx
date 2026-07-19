import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Loader2,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { appOriginPath } from '@/lib/app-path';
import { parseCalBookingUrl } from '@/lib/cal-link';
import {
  ensureNotaryAccount,
  fetchCalPlatformConfig,
  getCalMe,
  patchCalMe,
  resolveWorkingNotaryToken,
  verifyNotaryToken,
  type CalPlatformConfig,
} from '@/lib/cal-api';
import { getSettings, saveSettings } from '@/lib/db';

type StepState = 'done' | 'current' | 'upcoming';

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />;
  if (state === 'current') return <Circle className="h-5 w-5 text-primary shrink-0 fill-primary/20" />;
  return <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0" />;
}

type CalSetupPanelProps = {
  onTokenChange?: (token: string) => void;
};

export function CalSetupPanel({ onTokenChange }: CalSetupPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState('');
  const [accountReady, setAccountReady] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [calInput, setCalInput] = useState('');
  const [calUsername, setCalUsername] = useState('');
  const [bookSlug, setBookSlug] = useState('');
  const [platform, setPlatform] = useState<CalPlatformConfig | null>(null);

  const copyText = useCallback(
    async (label: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast({ title: 'Copied', description: label });
      } catch {
        toast({ title: 'Copy failed', variant: 'destructive' });
      }
    },
    [toast],
  );

  const applyToken = useCallback(
    async (nextToken: string, verified = false) => {
      const trimmed = nextToken.trim();
      setToken(trimmed);
      setAccountReady(verified && !!trimmed);
      onTokenChange?.(trimmed);
      const settings = await getSettings();
      await saveSettings({ ...settings, zoComputerToken: trimmed || undefined });
    },
    [onTokenChange],
  );

  const loadCalConfig = useCallback(async (authToken: string) => {
    const cal = await getCalMe(authToken);
    setCalUsername(cal.calUsername || cal.slug || '');
    setBookSlug(cal.slug || '');
    setCalInput(cal.calBookingUrl || cal.calUsername || '');
    setDisplayName(cal.displayName || '');
  }, []);

  const bootstrapAccount = useCallback(async () => {
    setCreating(true);
    try {
      const settings = await getSettings();
      const working = await resolveWorkingNotaryToken({
        name: settings.notaryName?.trim() || undefined,
        email: settings.notaryEmail?.trim() || undefined,
      });
      const ok = await verifyNotaryToken(working);
      if (!ok) {
        throw new Error('Could not create a working account token');
      }
      await applyToken(working, true);
      try {
        await loadCalConfig(working);
      } catch {
        /* cal not linked yet */
      }
      return working;
    } finally {
      setCreating(false);
    }
  }, [applyToken, loadCalConfig]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const platformConfig = await fetchCalPlatformConfig();
        if (cancelled) return;
        setPlatform(platformConfig);
        await bootstrapAccount();
        if (!cancelled) {
          toast({
            title: 'Account ready',
            description: 'Your personal token is shown below. Link your Cal username next.',
          });
        }
      } catch (err) {
        if (!cancelled) {
          toast({
            title: 'Setup failed',
            description: err instanceof Error ? err.message : 'Could not initialize account',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapAccount, toast]);

  const publicBookUrl = bookSlug.trim()
    ? `${window.location.origin}${appOriginPath(`/book/${bookSlug.trim().toLowerCase()}`)}`
    : calUsername.trim()
      ? `${window.location.origin}${appOriginPath(`/book/${calUsername.trim().toLowerCase()}`)}`
      : '';

  const webhookUrl = platform?.webhookUrl || `${window.location.origin}/api/cal/webhook`;
  const webhookSecret = platform?.webhookSecret || '';

  const hasToken = accountReady && !!token.trim();
  const hasCal = !!calUsername.trim();
  const hasBookLink = !!publicBookUrl;

  const steps = useMemo(() => {
    const s1: StepState = hasToken ? 'done' : creating ? 'current' : 'current';
    const s2: StepState = hasCal ? 'done' : hasToken ? 'current' : 'upcoming';
    const s3: StepState = hasCal ? 'current' : 'upcoming';
    const s4: StepState = hasBookLink ? 'done' : hasCal ? 'current' : 'upcoming';
    return { s1, s2, s3, s4 };
  }, [creating, hasBookLink, hasCal, hasToken]);

  const handleSaveCal = async () => {
    setSaving(true);
    try {
      const settings = await getSettings();
      const authToken = await resolveWorkingNotaryToken({
        name: settings.notaryName?.trim() || undefined,
        email: settings.notaryEmail?.trim() || undefined,
      });
      await applyToken(authToken, true);

      const raw = calInput.trim();
      const parsed = raw ? parseCalBookingUrl(raw) : null;
      if (!raw || !parsed) {
        throw new Error('Enter your Cal username (e.g. your-cal-username) or cal.com link');
      }

      const result = await patchCalMe(
        {
          calBookingUrl: parsed.bookingUrl,
          displayName: displayName.trim() || undefined,
        },
        authToken,
      );
      setCalUsername(result.calUsername || result.slug || '');
      setBookSlug(result.slug || '');
      setCalInput(result.calBookingUrl || parsed.bookingUrl);
      setDisplayName(result.displayName || '');
      toast({
        title: 'Cal linked',
        description: `Book page: /book/${result.slug || result.calUsername}`,
      });
    } catch (err) {
      toast({
        title: 'Cal save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
    setSaving(false);
  };

  const handleRecreateAccount = async () => {
    if (
      !window.confirm(
        'Create a new account? Your old token stops working and bookings tied to it will not show here.',
      )
    ) {
      return;
    }
    setCreating(true);
    try {
      const settings = await getSettings();
      await saveSettings({ ...settings, zoComputerToken: undefined });
      const created = await ensureNotaryAccount({
        name: settings.notaryName?.trim() || undefined,
        email: settings.notaryEmail?.trim() || undefined,
        force: true,
      });
      await applyToken(created.token, true);
      setCalUsername('');
      setBookSlug('');
      setCalInput('');
      toast({ title: 'New account created', description: 'Link your Cal username again.' });
    } catch (err) {
      toast({
        title: 'Create failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
    setCreating(false);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Setting up your account…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-primary" />
          Cal scheduling setup
        </CardTitle>
        <CardDescription>
          Your account token is created automatically on this device. Each notary gets their own
          token — bookings only show for the Cal username you link below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 min-w-0">
        <section className="space-y-3">
          <div className="flex items-start gap-3">
            <StepIcon state={steps.s1} />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-medium">1. Your account token (automatic)</p>
              <p className="text-sm text-muted-foreground">
                Generated when you open Settings on this phone. Stored on this device only — not
                your Cal password.
              </p>
              {creating ? (
                <Alert>
                  <AlertDescription>Creating your account…</AlertDescription>
                </Alert>
              ) : hasToken ? (
                <>
                  <p className="text-sm font-mono break-all rounded-md border bg-muted/40 p-3">{token}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => void copyText('Account token', token)}
                    >
                      <Copy className="w-3 h-3" /> Copy token
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleRecreateAccount()}
                      disabled={creating}
                    >
                      Create new account
                    </Button>
                  </div>
                </>
              ) : (
                <Button type="button" size="sm" onClick={() => void bootstrapAccount()} disabled={creating}>
                  Retry account setup
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-start gap-3">
            <StepIcon state={steps.s2} />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="font-medium">2. Link your Cal.com profile</p>
              <p className="text-sm text-muted-foreground">
                Paste your Cal username or profile link. Your public book URL will match your Cal
                username (unique — no collisions).
              </p>
              <div>
                <Label htmlFor="cal-setup-username">Cal username or link</Label>
                <Input
                  id="cal-setup-username"
                  className="mt-1 font-mono text-sm"
                  value={calInput}
                  onChange={(e) => setCalInput(e.target.value)}
                  placeholder="your-cal-username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={!hasToken || creating}
                />
              </div>
              <div>
                <Label htmlFor="cal-setup-display">Display name (public)</Label>
                <Input
                  id="cal-setup-display"
                  className="mt-1"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Jane Mobile Notary"
                  disabled={!hasToken || creating}
                />
              </div>
              {calUsername && (
                <p className="text-xs">
                  Linked: <span className="font-mono font-medium">{calUsername}</span>
                </p>
              )}
              <Button
                type="button"
                onClick={() => void handleSaveCal()}
                disabled={saving || !hasToken || creating || !calInput.trim()}
                className="gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Cal link
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-start gap-3">
            <StepIcon state={steps.s3} />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="font-medium">3. Cal webhook (same for every notary)</p>
              <p className="text-sm text-muted-foreground">
                In your Cal account → Settings → Developer → Webhooks → New. Paste both values
                below. Bookings route by your unique Cal username — not by token.
              </p>
              <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Subscriber URL</p>
                  <p className="text-sm font-mono break-all">{webhookUrl}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1 mt-2"
                    onClick={() => void copyText('Webhook URL', webhookUrl)}
                  >
                    <Copy className="w-3 h-3" /> Copy URL
                  </Button>
                </div>
                {webhookSecret ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Secret</p>
                    <p className="text-sm font-mono break-all">{webhookSecret}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1 mt-2"
                      onClick={() => void copyText('Webhook secret', webhookSecret)}
                    >
                      <Copy className="w-3 h-3" /> Copy secret
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Webhook secret not configured on server.</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Enable <strong>Booking created</strong> (and cancelled/rescheduled if you want).
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-start gap-3">
            <StepIcon state={steps.s4} />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="font-medium">4. Share your booking page</p>
              <p className="text-sm text-muted-foreground">
                Clients open this link — Cal widget embedded on Notary-log. Fees stay in Cal.
              </p>
              {publicBookUrl ? (
                <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                  <p className="text-sm font-mono break-all">{publicBookUrl}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => void copyText('Book link', publicBookUrl)}
                    >
                      <Copy className="w-3 h-3" /> Copy book link
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="gap-1" asChild>
                      <a href={publicBookUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="w-3 h-3" /> Preview
                      </a>
                    </Button>
                  </div>
                </div>
              ) : (
                <Alert>
                  <AlertDescription>Save your Cal username in step 2 to get your book link.</AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </section>

        <Alert className="bg-muted/30">
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Bookings appear under the <strong>Bookings</strong> tab (not Client Requests). Status
            comes from Cal — if your event requires confirmation, it shows as pending in Cal first.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
