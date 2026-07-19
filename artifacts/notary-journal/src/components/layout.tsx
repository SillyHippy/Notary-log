import { ReactNode, useEffect, useRef } from 'react';
import { Navigation } from './navigation';
import { InstallBanner } from './install-banner';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { getSettings, getAllEntries } from '@/lib/db';
import { backupToDrive, getStoredToken } from '@/lib/gdrive';

interface LayoutProps {
  children: ReactNode;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

export function Layout({ children }: LayoutProps) {
  const online = useOnlineStatus();
  const lastBackupCheckRef = useRef<number>(0);

  // Daily backup scheduler — runs when backupFrequency === 'daily'
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const settings = await getSettings();
        if (settings.backupFrequency !== 'daily') return;
        if (!getStoredToken()) return;

        const now = Date.now();
        if (now - lastBackupCheckRef.current < CHECK_INTERVAL_MS) return;
        lastBackupCheckRef.current = now;

        // Check if last backup was more than 24 hours ago
        const lastBackupStr = localStorage.getItem('lastBackupTime');
        if (lastBackupStr) {
          const lastBackup = parseInt(lastBackupStr, 10);
          if (now - lastBackup < ONE_DAY_MS) return;
        }

        // Perform daily backup
        const allEntries = await getAllEntries();
        await backupToDrive(allEntries, settings);
      } catch {
        // Silent failure for scheduled backup
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background w-full min-w-0 overflow-x-hidden">
      {!online && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-500/90 dark:bg-amber-600/90 text-amber-950 dark:text-amber-100 text-xs font-medium text-center py-1.5 backdrop-blur-sm" data-testid="offline-banner">
          You're offline — entries are saved locally and will be backed up when you reconnect.
        </div>
      )}
      <Navigation />
      <InstallBanner />
      <main className={`md:ml-64 pb-20 md:pb-0 min-h-[100dvh] min-w-0 overflow-x-hidden${!online ? ' pt-6' : ''}`}>
        {children}
      </main>
    </div>
  );
}
