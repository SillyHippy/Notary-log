import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout";
import { PinLock } from "@/components/pin-lock";
import { Dashboard } from "@/pages/dashboard";
import { JournalList } from "@/pages/journal-list";
import { NewEntry } from "@/pages/new-entry";
import { EntryDetail } from "@/pages/entry-detail";
import { EditEntry } from "@/pages/edit-entry";
import { Settings } from "@/pages/settings";

import { getSettings } from "@/lib/db";

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
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinHash, setPinHash] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    const initApp = async () => {
      try {
        const settings = await getSettings();
        if (settings.darkMode) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }

        if (settings.pinEnabled && settings.pinHash) {
          setPinEnabled(true);
          setPinHash(settings.pinHash);
          setUnlocked(false);
        } else {
          setUnlocked(true);
        }
      } catch (err) {
        console.error("Failed to load settings", err);
        setUnlocked(true);
      } finally {
        setIsLoading(false);
      }
    };
    
    initApp();
  }, []);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-foreground"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {pinEnabled && !unlocked ? (
          <PinLock onUnlock={() => setUnlocked(true)} expectedHash={pinHash} />
        ) : (
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
