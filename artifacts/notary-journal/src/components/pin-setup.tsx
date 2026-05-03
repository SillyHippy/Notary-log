import { useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { setupCrypto, needsMigration, migratePlaintext, verifyLegacyPin } from '@/lib/db';

interface PinSetupProps {
  hasLegacyData: boolean;
  legacyPinHash: string | null;
  onComplete: () => void;
}

export function PinSetup({ hasLegacyData, legacyPinHash, onComplete }: PinSetupProps) {
  // Phase 1: legacy PIN gate (only if a previous plaintext-mode pinHash exists)
  const [legacyVerified, setLegacyVerified] = useState(legacyPinHash === null);
  const [legacyPin, setLegacyPin] = useState('');
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [legacyAttempts, setLegacyAttempts] = useState(0);
  const [legacyBusy, setLegacyBusy] = useState(false);

  // Phase 2: new PIN setup
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const verifyLegacy = async () => {
    setLegacyError(null);
    if (!legacyPinHash) { setLegacyVerified(true); return; }
    if (legacyPin.length !== 4) { setLegacyError('Enter your existing 4-digit PIN.'); return; }
    setLegacyBusy(true);
    try {
      const ok = await verifyLegacyPin(legacyPin, legacyPinHash);
      if (ok) {
        setLegacyVerified(true);
      } else {
        const next = legacyAttempts + 1;
        setLegacyAttempts(next);
        setLegacyError('Incorrect PIN.');
        setLegacyPin('');
      }
    } catch (err) {
      setLegacyError(err instanceof Error ? err.message : 'Verification failed');
    }
    setLegacyBusy(false);
  };

  const submit = async () => {
    setError(null);
    if (pin.length !== 4) { setError('PIN must be exactly 4 digits.'); return; }
    if (pin !== confirm) { setError('PINs do not match.'); return; }
    setBusy(true);
    try {
      await setupCrypto(pin);
      if (await needsMigration()) {
        await migratePlaintext((done, total) => setProgress({ done, total }));
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background text-foreground p-6">
      <div className="max-w-md w-full space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="p-4 bg-primary/10 rounded-full mb-4">
            <ShieldCheck className="w-12 h-12 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">
            {!legacyVerified
              ? 'Verify your current PIN'
              : hasLegacyData
                ? 'Encrypt your journal'
                : 'Set up your PIN'}
          </h1>
          <p className="text-muted-foreground text-sm mt-2">
            {!legacyVerified
              ? 'This device already has PIN protection. Enter your existing PIN before setting up encryption.'
              : hasLegacyData
                ? 'Choose a 4-digit PIN. Your existing entries will be encrypted on this device using a key derived from this PIN.'
                : 'Choose a 4-digit PIN. Your journal will be encrypted on this device using a key derived from this PIN.'}
          </p>
        </div>

        {legacyVerified && (
          <Alert variant="default" className="bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900">
            <AlertTitle className="text-sm">Important</AlertTitle>
            <AlertDescription className="text-xs">
              If you forget this PIN, your encrypted data on this device cannot be recovered. Always keep a recent backup (Google Drive or downloaded JSON) so you can restore on a new device. A 4-digit PIN protects against casual access on a lost device but is not strong against an attacker with offline access to your browser storage — keep this device physically secure.
            </AlertDescription>
          </Alert>
        )}

        {!legacyVerified ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="legacy-pin">Current PIN</Label>
              <Input
                id="legacy-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoFocus
                value={legacyPin}
                onChange={e => setLegacyPin(e.target.value.replace(/[^0-9]/g, ''))}
                data-testid="input-legacy-pin"
                disabled={legacyBusy}
              />
            </div>
            {legacyError && <p className="text-sm text-destructive">{legacyError}</p>}
            {legacyAttempts > 0 && !legacyError && (
              <p className="text-xs text-muted-foreground">{legacyAttempts} failed attempt{legacyAttempts === 1 ? '' : 's'}</p>
            )}
            <Button className="w-full" onClick={verifyLegacy} disabled={legacyBusy} data-testid="button-verify-legacy">
              {legacyBusy ? 'Verifying…' : 'Continue'}
            </Button>
          </div>
        ) : progress ? (
          <div className="space-y-3 text-center" data-testid="migration-progress">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
            <p className="text-sm font-medium">Encrypting your journal…</p>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: progress.total === 0 ? '100%' : `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{progress.done} / {progress.total} records</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="setup-pin">4-digit PIN</Label>
              <Input
                id="setup-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoFocus
                value={pin}
                onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                data-testid="input-setup-pin"
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-confirm">Confirm PIN</Label>
              <Input
                id="setup-confirm"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={confirm}
                onChange={e => setConfirm(e.target.value.replace(/[^0-9]/g, ''))}
                data-testid="input-setup-confirm"
                disabled={busy}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={submit} disabled={busy} data-testid="button-setup-submit">
              {busy ? 'Setting up…' : hasLegacyData ? 'Encrypt journal' : 'Create PIN'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
