import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout";
import { PinLock } from "@/components/pin-lock";
import { PinSetup } from "@/components/pin-setup";
import { Dashboard } from "@/pages/dashboard";
import { JournalList } from "@/pages/journal-list";
import { NewEntry } from "@/pages/new-entry";
import { EntryDetail } from "@/pages/entry-detail";
import { EditEntry } from "@/pages/edit-entry";
import { Settings } from "@/pages/settings";
import { Reports } from "@/pages/reports";

import { hasCryptoSetup, inspectLegacy, getDarkModePref } from "@/lib/db";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/journal" component={JournalList} />
        <Route path="/entry/new" component={NewEntry} />
        <Route path="/entry/:id/edit" component={EditEntry} />
        <Route path="/entry/:id" component={EntryDetail} />
        <Route path="/reports" component={Reports} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

type AppMode = 'loading' | 'setup' | 'locked' | 'unlocked';

function App() {
  const [mode, setMode] = useState<AppMode>('loading');
  const [hasLegacyData, setHasLegacyData] = useState(false);
  const [legacyPinHash, setLegacyPinHash] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Theme — read from localStorage so it works pre-unlock
        const dark = getDarkModePref();
        document.documentElement.classList.toggle('dark', dark);

        if (await hasCryptoSetup()) {
          setMode('locked');
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

  if (mode === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
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
