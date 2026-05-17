import * as React from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

interface UseInstallPromptReturn {
  /** Whether the browser supports the install prompt (PWA-capable). */
  isInstallable: boolean;
  /** Fire the install prompt. Returns the user's choice. */
  handleInstall: () => Promise<{ outcome: 'accepted' | 'dismissed' } | null>;
  /** Whether the app is already installed (running in standalone/display mode). */
  isInstalled: boolean;
}

/**
 * Hook for the PWA `beforeinstallprompt` event.
 *
 * Usage:
 *   const { isInstallable, handleInstall, isInstalled } = useInstallPrompt();
 *   if (isInstallable && !isInstalled) return <button onClick={handleInstall}>Install</button>;
 */
export function useInstallPrompt(): UseInstallPromptReturn {
  const [deferredPrompt, setDeferredPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = React.useState(() => {
    // Running in standalone mode (installed PWA or native app)
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  });

  React.useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Listen for display-mode changes (e.g. user installs after page load)
  React.useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const onChange = () => setIsInstalled(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const handleInstall = React.useCallback(async () => {
    if (!deferredPrompt) return null;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return { outcome };
  }, [deferredPrompt]);

  return {
    isInstallable: !!deferredPrompt && !isInstalled,
    handleInstall,
    isInstalled,
  };
}
