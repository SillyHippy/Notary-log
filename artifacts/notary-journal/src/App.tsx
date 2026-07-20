import { useState, useEffect, lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Layout } from "@/components/layout";
import { PinLock } from "@/components/pin-lock";
import { PinSetup } from "@/components/pin-setup";
import { useGlobalShortcuts } from "@/hooks/use-shortcuts";

// Lazy-load pages so the initial bundle stays small
const Dashboard = lazy(() => import("@/pages/dashboard").then(m => ({ default: m.Dashboard })));
const JournalList = lazy(() => import("@/pages/journal-list").then(m => ({ default: m.JournalList })));
const NewEntry = lazy(() => import("@/pages/new-entry").then(m => ({ default: m.NewEntry })));
const EntryDetail = lazy(() => import("@/pages/entry-detail").then(m => ({ default: m.EntryDetail })));
const EditEntry = lazy(() => import("@/pages/edit-entry").then(m => ({ default: m.EditEntry })));
const Settings = lazy(() => import("@/pages/settings").then(m => ({ default: m.Settings })));
const Reports = lazy(() => import("@/pages/reports").then(m => ({ default: m.Reports })));
const PrivacyPolicy = lazy(() => import("@/pages/privacy-policy").then(m => ({ default: m.PrivacyPolicy })));
const TermsOfUse = lazy(() => import("@/pages/terms-of-use").then(m => ({ default: m.TermsOfUse })));
const NotFound = lazy(() => import("@/pages/not-found"));
const ClientIntake = lazy(() => import("@/pages/client-intake").then(m => ({ default: m.ClientIntake })));
const ClientRequests = lazy(() => import("@/pages/client-requests").then(m => ({ default: m.ClientRequests })));
const PublicBook = lazy(() => import("@/pages/public-book").then(m => ({ default: m.PublicBook })));
const BookingsPage = lazy(() => import("@/pages/bookings").then(m => ({ default: m.BookingsPage })));
import { hasCryptoSetup, inspectLegacy, getDarkModePref, tryRestoreFromSessionCache, isUnlocked, getSettings, saveSettings } from "@/lib/db";
import { ensureNotaryAccount } from "@/lib/cal-api";
import { isZoHost } from "@/lib/intake-api";
import { isCalHostMode } from "@/lib/cal-link";
import { apiPath, isPublicAppPath } from "@/lib/app-path";
import { dismissSplash } from "@/lib/splash";

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

/** Public intake form — rendered outside auth, no PIN required */
function PublicRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/book/:slug" component={PublicBook} />
        <Route path="/intake" component={ClientIntake} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function Router() {
  useGlobalShortcuts();
  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/journal" component={JournalList} />
          <Route path="/entry/new" component={NewEntry} />
          <Route path="/entry/new/session">
            <Redirect to="/entry/new" />
          </Route>
          <Route path="/entry/:id/edit" component={EditEntry} />
          <Route path="/entry/:id" component={EntryDetail} />
          <Route path="/requests" component={ClientRequests} />
          <Route path="/bookings" component={BookingsPage} />
          <Route path="/reports" component={Reports} />
          <Route path="/settings" component={Settings} />
          <Route path="/privacy" component={PrivacyPolicy} />
          <Route path="/terms" component={TermsOfUse} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

/**
 * Checks if the current path is a public route (no auth needed).
 * This ensures clients can access the intake form without any PIN.
 */
function useIsPublicRoute(): boolean {
  return isPublicAppPath();
}

type AppMode = 'loading' | 'setup' | 'locked' | 'unlocked';

function App() {
  const [mode, setMode] = useState<AppMode>('loading');
  const [hasLegacyData, setHasLegacyData] = useState(false);
  const [legacyPinHash, setLegacyPinHash] = useState<string | null>(null);
  const isPublic = useIsPublicRoute();

  useEffect(() => {
    let finished = false;
    const finishInit = (next: AppMode) => {
      if (finished) return;
      finished = true;
      dismissSplash();
      setMode(next);
    };

    // Hard ceiling: never leave the static HTML splash forever (IDB hang after wipe).
    const safety = window.setTimeout(() => {
      console.warn('App init timed out — forcing PIN setup');
      finishInit('setup');
    }, 6000);

    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      new Promise((resolve, reject) => {
        const t = window.setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
        p.then(
          (v) => {
            window.clearTimeout(t);
            resolve(v);
          },
          (e) => {
            window.clearTimeout(t);
            reject(e);
          },
        );
      });

    (async () => {
      try {
        // Theme — read from localStorage so it works pre-unlock
        const dark = getDarkModePref();
        document.documentElement.classList.toggle('dark', dark);

        const hasCrypto = await withTimeout(hasCryptoSetup(), 4000, 'hasCryptoSetup');
        if (hasCrypto) {
          // Try to restore the in-memory key from sessionStorage so a tab
          // refresh / Vite HMR full-reload doesn't drop the user back to
          // the PIN screen. The cache is bound to the tab's lifetime and
          // expires after a sliding idle timeout — see `db.ts`.
          const restored = await withTimeout(
            tryRestoreFromSessionCache(),
            3000,
            'tryRestoreFromSessionCache',
          );
          finishInit(restored ? 'unlocked' : 'locked');
        } else {
          // Look at legacy plaintext data to tailor the setup copy
          const legacy = await withTimeout(inspectLegacy(), 3000, 'inspectLegacy');
          // If they had darkMode in legacy plaintext settings, mirror it now
          if (legacy.entryCount > 0 && legacy.darkMode) {
            document.documentElement.classList.add('dark');
          }
          setHasLegacyData(legacy.entryCount > 0);
          setLegacyPinHash(legacy.hadPinHash);
          finishInit('setup');
        }
      } catch (err) {
        console.error("Failed to initialize app", err);
        // Fail open to setup so the user is never locked out of a fresh install
        finishInit('setup');
      } finally {
        window.clearTimeout(safety);
      }
    })();

    return () => {
      window.clearTimeout(safety);
    };
  }, []);

  // Self-heal "Database is locked" errors that can happen when the in-memory
  // crypto key gets dropped while pages stay mounted (Vite HMR full-reload of
  // db.ts in dev, or the sliding idle-timeout expiring while a page is open).
  // We listen for unhandled rejections + window focus and either re-import
  // the key from the sessionStorage cache, or fall back to the PIN screen.
  useEffect(() => {
    if (mode !== 'unlocked') return;

    const recover = async () => {
      if (isUnlocked()) return;
      const restored = await tryRestoreFromSessionCache();
      if (!restored) setMode('locked');
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = String(e.reason?.message ?? e.reason ?? '');
      if (/database is locked/i.test(msg)) {
        e.preventDefault(); // suppress Vite's red overlay in dev
        void recover();
      }
    };
    const onError = (e: ErrorEvent) => {
      if (/database is locked/i.test(String(e.message ?? ''))) {
        e.preventDefault();
        void recover();
      }
    };
    const onFocus = () => { void recover(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void recover(); };

    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mode]);

  // Cal multi-tenant host: auto-create personal account token on first unlock (per device).
  useEffect(() => {
    if (mode !== 'unlocked' || !isCalHostMode()) return;
    void (async () => {
      try {
        const settings = await getSettings();
        if (settings.zoComputerToken?.trim()) return;
        const created = await ensureNotaryAccount({
          name: settings.notaryName?.trim() || undefined,
          email: settings.notaryEmail?.trim() || undefined,
        });
        await saveSettings({
          ...settings,
          zoComputerToken: created.token.trim(),
        });
      } catch {
        // Settings page will retry and show errors.
      }
    })();
  }, [mode]);

  // On Zo deploys, auto-fill intake token from server when Settings has none yet.
  // Cal multi-tenant host: each notary must create/use their own token — never share one.
  useEffect(() => {
    if (mode !== 'unlocked' || !isZoHost() || isCalHostMode()) return;
    void (async () => {
      try {
        const settings = await getSettings();
        if (settings.zoComputerToken?.trim()) return;
        const res = await fetch(apiPath('/api/bootstrap'));
        if (!res.ok) return;
        const data = (await res.json()) as { intakeToken?: string | null };
        if (data.intakeToken?.trim()) {
          await saveSettings({ ...settings, zoComputerToken: data.intakeToken.trim() });
        }
      } catch {
        // Non-fatal — user can paste token manually in Settings.
      }
    })();
  }, [mode]);

  // Keep the static HTML splash visible until finishInit() removes it.
  if (mode === 'loading') {
    return null;
  }

  // Public intake form — accessible without any PIN or setup
  if (isPublic) {
    return (
      <QueryClientProvider client={queryClient}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <PublicRoutes />
        </WouterRouter>
        <Toaster />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {mode === 'setup' && (
          <PinSetup
            hasLegacyData={hasLegacyData}
            legacyPinHash={legacyPinHash}
            onComplete={() => setMode('unlocked')}
          />
        )}
        {mode === 'locked' && (
          <PinLock onUnlock={() => setMode('unlocked')} />
        )}
        {mode === 'unlocked' && (
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        )}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
