import { useState, useEffect, lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
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
const SigningSession = lazy(() => import("@/pages/signing-session").then(m => ({ default: m.SigningSession })));
const EntryDetail = lazy(() => import("@/pages/entry-detail").then(m => ({ default: m.EntryDetail })));
const EditEntry = lazy(() => import("@/pages/edit-entry").then(m => ({ default: m.EditEntry })));
const Settings = lazy(() => import("@/pages/settings").then(m => ({ default: m.Settings })));
const Reports = lazy(() => import("@/pages/reports").then(m => ({ default: m.Reports })));
const PrivacyPolicy = lazy(() => import("@/pages/privacy-policy").then(m => ({ default: m.PrivacyPolicy })));
const TermsOfUse = lazy(() => import("@/pages/terms-of-use").then(m => ({ default: m.TermsOfUse })));
const NotFound = lazy(() => import("@/pages/not-found"));
const ClientIntake = lazy(() => import("@/pages/client-intake").then(m => ({ default: m.ClientIntake })));
const ClientRequests = lazy(() => import("@/pages/client-requests").then(m => ({ default: m.ClientRequests })));
import { hasCryptoSetup, inspectLegacy, getDarkModePref, tryRestoreFromSessionCache, isUnlocked } from "@/lib/db";

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
          <Route path="/entry/new/session" component={SigningSession} />
          <Route path="/entry/:id/edit" component={EditEntry} />
          <Route path="/entry/:id" component={EntryDetail} />
          <Route path="/requests" component={ClientRequests} />
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
  const [location] = useLocation();
  return location.startsWith('/intake');
}

type AppMode = 'loading' | 'setup' | 'locked' | 'unlocked';

function App() {
  const [mode, setMode] = useState<AppMode>('loading');
  const [hasLegacyData, setHasLegacyData] = useState(false);
  const [legacyPinHash, setLegacyPinHash] = useState<string | null>(null);
  const isPublic = useIsPublicRoute();

  useEffect(() => {
    (async () => {
      try {
        // Theme — read from localStorage so it works pre-unlock
        const dark = getDarkModePref();
        document.documentElement.classList.toggle('dark', dark);

        if (await hasCryptoSetup()) {
          // Try to restore the in-memory key from sessionStorage so a tab
          // refresh / Vite HMR full-reload doesn't drop the user back to
          // the PIN screen. The cache is bound to the tab's lifetime and
          // expires after a sliding idle timeout — see `db.ts`.
          const restored = await tryRestoreFromSessionCache();
          setMode(restored ? 'unlocked' : 'locked');
        } else {
          // Look at legacy plaintext data to tailor the setup copy
          const legacy = await inspectLegacy();
          // If they had darkMode in legacy plaintext settings, mirror it now
          if (legacy.entryCount > 0 && legacy.darkMode) {
            document.documentElement.classList.add('dark');
          }
          setHasLegacyData(legacy.entryCount > 0);
          setLegacyPinHash(legacy.hadPinHash);
          setMode('setup');
        }
      } catch (err) {
        console.error("Failed to initialize app", err);
        // Fail open to setup so the user is never locked out of a fresh install
        setMode('setup');
      }
    })();
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

  if (mode === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
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
