import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X } from 'lucide-react';
import { useInstallPrompt } from '@/hooks/use-install-prompt';

/**
 * A non-intrusive banner that appears at the bottom of the screen on mobile
 * when the browser offers a PWA install prompt. Dismisses itself on user
 * action or when the app is already installed.
 */
export function InstallBanner() {
  const { isInstallable, handleInstall, isInstalled } = useInstallPrompt();
  const [dismissed, setDismissed] = React.useState(false);

  // Never show if already installed or user dismissed
  if (isInstalled || dismissed || !isInstallable) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed bottom-20 left-4 right-4 z-50 md:bottom-6 md:left-auto md:right-6 md:max-w-sm"
        role="banner"
        aria-label="Install app suggestion"
      >
        <div className="rounded-xl border bg-card p-4 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Download className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Install Notary Journal</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Add to your home screen for quick offline access.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="touch-none rounded p-1 hover:bg-accent"
              aria-label="Dismiss install banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={async () => {
              await handleInstall();
              setDismissed(true);
            }}
            className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 active:scale-[0.98] touch-target"
          >
            Install App
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
