import { useState, useEffect, useRef } from 'react';
import { LockKeyhole, Delete, Fingerprint } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { unlock as unlockDB, needsMigration, migratePlaintext } from '@/lib/db';
import {
  isBiometricEnabled,
  isPlatformAuthenticatorAvailable,
  unlockWithBiometric,
} from '@/lib/biometric';

interface PinLockProps {
  onUnlock: () => void;
}

const FAIL_LOCKOUT_THRESHOLD = 10;
const FAIL_LOCKOUT_MS = 30_000;

export function PinLock({ onUnlock }: PinLockProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const checkingRef = useRef(false);
  const autoTriedRef = useRef(false);

  // Tick for lockout countdown
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [lockedUntil]);

  useEffect(() => {
    if (pin.length === 4 && !checkingRef.current) {
      checkPin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const enabled = await isBiometricEnabled();
        if (!enabled) return;
        const available = await isPlatformAuthenticatorAvailable();
        if (cancelled || !available) return;
        setBiometricAvailable(true);
        if (!autoTriedRef.current) {
          autoTriedRef.current = true;
          // Prompt once on mount; user can fall back to PIN if they dismiss.
          tryBiometric();
        }
      } catch {/* biometric stays unavailable */}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishUnlock = async (): Promise<boolean> => {
    // Resume any interrupted plaintext→encrypted migration; fail closed.
    try {
      if (await needsMigration()) {
        await migratePlaintext(() => {});
        if (await needsMigration()) {
          throw new Error('Migration finished but plaintext data remains. Try again.');
        }
      }
      onUnlock();
      return true;
    } catch (mErr) {
      console.error('Resume migration after unlock failed', mErr);
      return false;
    }
  };

  const tryBiometric = async () => {
    if (biometricBusy) return;
    setBiometricBusy(true);
    setBiometricError(null);
    try {
      const ok = await unlockWithBiometric();
      if (!ok) {
        // Cancel / stale key / PRF unavailable — fall back silently to PIN.
        setBiometricBusy(false);
        return;
      }
      const ok2 = await finishUnlock();
      if (!ok2) {
        setError(true);
        setTimeout(() => { setError(false); }, 2000);
      }
    } catch (err) {
      console.error('Biometric unlock failed', err);
      setBiometricError('Biometric unlock failed. Use your PIN.');
    }
    setBiometricBusy(false);
  };

  const checkPin = async () => {
    if (lockedUntil && now < lockedUntil) return;
    checkingRef.current = true;
    setBusy(true);
    try {
      const ok = await unlockDB(pin);
      if (ok) {
        setFailCount(0);
        const ok2 = await finishUnlock();
        if (!ok2) {
          setError(true);
          setTimeout(() => { setPin(''); setError(false); checkingRef.current = false; }, 2000);
          setBusy(false);
          return;
        }
      } else {
        const newFails = failCount + 1;
        setFailCount(newFails);
        setError(true);
        if (newFails >= FAIL_LOCKOUT_THRESHOLD) {
          setLockedUntil(Date.now() + FAIL_LOCKOUT_MS);
        }
        setTimeout(() => {
          setPin('');
          setError(false);
          checkingRef.current = false;
        }, 800);
        setBusy(false);
        return;
      }
    } catch (err) {
      console.error('Unlock error', err);
      setError(true);
      setTimeout(() => { setPin(''); setError(false); checkingRef.current = false; }, 800);
    }
    setBusy(false);
  };

  const lockoutSecondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const isLockedOut = lockoutSecondsLeft > 0;

  const handleKeypad = (num: string) => {
    if (pin.length < 4 && !error && !busy && !isLockedOut) {
      setPin(prev => prev + num);
    }
  };

  const handleDelete = () => {
    if (!error && !busy && !isLockedOut) setPin(prev => prev.slice(0, -1));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center justify-center max-w-sm w-full p-6">
        <div className="mb-8 p-4 bg-primary/10 rounded-full">
          <LockKeyhole className="w-12 h-12 text-primary" />
        </div>

        <h1 className="text-2xl font-bold mb-2">Enter PIN</h1>
        <p className="text-muted-foreground text-sm mb-8 text-center">
          Unlock and decrypt your notary journal
        </p>

        <div className="flex gap-4 mb-6">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-all ${
                i < pin.length
                  ? 'bg-primary border-primary'
                  : error
                    ? 'border-destructive'
                    : 'border-muted-foreground'
              }`}
            />
          ))}
        </div>

        {isLockedOut ? (
          <p className="text-destructive mb-4 font-medium text-sm" data-testid="pin-lockout">
            Too many wrong attempts. Try again in {lockoutSecondsLeft}s.
          </p>
        ) : error ? (
          <p className="text-destructive mb-4 font-medium animate-in fade-in slide-in-from-bottom-2">
            Incorrect PIN
          </p>
        ) : biometricError ? (
          <p className="text-amber-600 dark:text-amber-400 mb-4 text-sm" data-testid="biometric-error">
            {biometricError}
          </p>
        ) : failCount > 0 ? (
          <p className="text-muted-foreground text-xs mb-4">
            {FAIL_LOCKOUT_THRESHOLD - failCount} attempts remaining
          </p>
        ) : null}

        {biometricAvailable && (
          <Button
            type="button"
            variant="outline"
            className="mb-6 w-full h-12 gap-2"
            onClick={tryBiometric}
            disabled={biometricBusy || busy || isLockedOut}
            data-testid="button-biometric-unlock"
          >
            <Fingerprint className="w-5 h-5" />
            {biometricBusy ? 'Waiting for biometric…' : 'Use biometric'}
          </Button>
        )}

        <div className="grid grid-cols-3 gap-4 w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <Button
              key={num}
              variant="outline"
              size="lg"
              className="h-16 text-2xl font-medium rounded-2xl no-default-hover-elevate hover-elevate-2 bg-card"
              onClick={() => handleKeypad(num.toString())}
              data-testid={`button-pin-${num}`}
              disabled={isLockedOut || busy}
            >
              {num}
            </Button>
          ))}
          <div />
          <Button
            variant="outline"
            size="lg"
            className="h-16 text-2xl font-medium rounded-2xl no-default-hover-elevate hover-elevate-2 bg-card"
            onClick={() => handleKeypad('0')}
            data-testid="button-pin-0"
            disabled={isLockedOut || busy}
          >
            0
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="h-16 rounded-2xl"
            onClick={handleDelete}
            disabled={pin.length === 0 || isLockedOut || busy}
            data-testid="button-pin-delete"
          >
            <Delete className="w-6 h-6" />
          </Button>
        </div>
      </div>
    </div>
  );
}
