import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { format } from 'date-fns';
import { 
  FileText, 
  Search, 
  FileSignature, 
  Wallet,
  Clock,
  ArrowRight,
  ShieldCheck,
  User,
  Calendar,
  AlertCircle,
  FileBarChart,
  CloudUpload,
  X,
  ScanLine
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatJournalDateTime } from '@/lib/journal-datetime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { 
  getStats, 
  getRecentEntries, 
  getSettings, 
  getAllEntries,
  type JournalEntry,
  type NotarySettings
} from '@/lib/db';
import {
  isGdriveConfigured,
  isGdriveSetUp,
  getLastBackupTime,
  backupToDrive,
} from '@/lib/gdrive';
import {
  computeBackupNudge,
  getSnoozeUntilMs,
  snoozeForOneDay,
  clearSnooze,
  DEFAULT_THRESHOLD_DAYS,
  type BackupNudgeState,
} from '@/lib/backup-nudge';
export function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState({ total: 0, completed: 0, draft: 0, thisMonth: 0, totalFees: 0, needsIdScan: 0 });
  const [recentEntries, setRecentEntries] = useState<JournalEntry[]>([]);
  const [settings, setSettings] = useState<NotarySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [nudge, setNudge] = useState<BackupNudgeState>({ kind: 'none', daysSince: null, message: '' });
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const refreshNudge = async (settingsData: NotarySettings | null) => {
    const snoozeUntilMs = await getSnoozeUntilMs();
    setNudge(computeBackupNudge({
      lastBackupIso: getLastBackupTime(),
      thresholdDays: settingsData?.backupReminderDays ?? DEFAULT_THRESHOLD_DAYS,
      snoozeUntilMs,
      manualBackupOnly: !!settingsData?.manualBackupOnly,
      gdriveAvailable: isGdriveConfigured(),
      // Use durable setup state, not the OAuth access token (which expires
      // hourly). backupToDrive() will silently re-auth via getValidToken().
      gdriveConnected: isGdriveSetUp(),
      now: Date.now(),
    }));
  };

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);

      const [statsData, recentData, settingsData] = await Promise.all([
        getStats(),
        getRecentEntries(5),
        getSettings()
      ]);
      
      setStats(statsData);
      setRecentEntries(recentData);
      setSettings(settingsData);
      refreshNudge(settingsData);
      setIsLoading(false);
    };
    
    loadData();
  }, []);

  const handleBackupNow = async () => {
    setNudgeBusy(true);
    try {
      const entries = await getAllEntries();
      const s = await getSettings();
      await backupToDrive(entries, s);
      await clearSnooze();
      toast({ title: 'Backup complete', description: 'Journal backed up to Google Drive.' });
      await refreshNudge(s);
    } catch (err) {
      toast({
        title: 'Backup failed',
        description: err instanceof Error ? err.message : 'Could not back up to Drive.',
        variant: 'destructive',
      });
    }
    setNudgeBusy(false);
  };

  const handleSnooze = async () => {
    await snoozeForOneDay();
    await refreshNudge(settings);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setLocation(`/journal?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
      case 'draft': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800';
      case 'amended': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700';
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <div className="space-y-2 mb-8">
          <div className="h-8 w-48 bg-muted rounded animate-pulse" />
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-muted rounded-xl animate-pulse mt-8" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto pb-32 md:pb-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {settings?.notaryName || 'Notary Journal'}
          </h1>
          {settings?.commissionNumber && (
            <p className="text-muted-foreground flex items-center gap-2 mt-1">
              <ShieldCheck className="w-4 h-4" />
              Commission #{settings.commissionNumber}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <form onSubmit={handleSearch} className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search signer or entry #" 
              className="pl-9 bg-card border-border shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-dashboard"
            />
          </form>
        </div>
      </div>

      {/* Backup-staleness nudge */}
      {nudge.kind !== 'none' && (
        <div
          className="mb-6 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          data-testid="backup-nudge-banner"
        >
          <CloudUpload className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0" />
          <div className="flex-1 text-sm text-amber-900 dark:text-amber-200">
            {nudge.message}
          </div>
          <div className="flex gap-2">
            {nudge.kind === 'never-configured' ? (
              <Link href="/settings">
                <Button size="sm" data-testid="button-nudge-setup">
                  Open settings
                </Button>
              </Link>
            ) : (
              <Button
                size="sm"
                onClick={handleBackupNow}
                disabled={nudgeBusy}
                data-testid="button-nudge-backup-now"
              >
                {nudgeBusy ? 'Backing up…' : 'Back up now'}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSnooze}
              disabled={nudgeBusy}
              data-testid="button-nudge-snooze"
              title="Dismiss for today"
              aria-label="Dismiss for today"
            >
              <X className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Dismiss for today</span>
            </Button>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="shadow-sm hover-elevate">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Entries</p>
              <FileText className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm hover-elevate">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">This Month</p>
              <Calendar className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold">{stats.thisMonth}</div>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm hover-elevate">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Completed</p>
              <FileSignature className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold">{stats.completed}</div>
          </CardContent>
        </Card>
        
        <Link href="/reports" data-testid="link-dashboard-reports">
          <Card className="shadow-sm hover-elevate cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-center justify-between space-y-0 pb-2">
                <p className="text-sm font-medium text-muted-foreground">Total Fees</p>
                <FileBarChart className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="text-3xl font-bold">${(stats.totalFees / 100).toFixed(2)}</div>
              <p className="text-xs text-muted-foreground mt-1">View annual report →</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Needs ID scan nudge */}
      {stats.needsIdScan > 0 && (
        <Link href="/journal" data-testid="link-needs-id-scan-widget">
          <div className="mb-8 rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 p-4 flex items-center gap-4 hover:bg-orange-100 dark:hover:bg-orange-950/30 transition-colors cursor-pointer">
            <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/40 border border-orange-200 dark:border-orange-800 flex items-center justify-center shrink-0">
              <ScanLine className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-orange-900 dark:text-orange-200">
                {stats.needsIdScan} draft{stats.needsIdScan !== 1 ? 's' : ''} need{stats.needsIdScan === 1 ? 's' : ''} an ID scan
              </p>
              <p className="text-xs text-orange-700 dark:text-orange-400 mt-0.5">
                These entries were saved without an ID image. Tap to review them in your journal.
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-orange-500 dark:text-orange-400 shrink-0" />
          </div>
        </Link>
      )}

      {/* Recent Entries */}
      <Card className="shadow-md border-border/60">
        <CardHeader className="border-b border-border/50 pb-4 bg-muted/20">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Entries</CardTitle>
              <CardDescription>Your most recent journal records</CardDescription>
            </div>
            <Link href="/journal">
              <Button variant="ghost" size="sm" className="gap-1 text-primary hover:text-primary/80" data-testid="button-view-all">
                View all <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentEntries.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-lg font-medium text-foreground">No entries yet</h3>
              <p className="text-muted-foreground mt-1 mb-6">Start tracking your notarial acts by creating a new entry.</p>
              <Link href="/entry/new">
                <Button data-testid="button-create-first-entry">Create Entry</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentEntries.map(entry => (
                <Link 
                  key={entry.id} 
                  href={`/entry/${entry.id}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-muted/30 transition-colors gap-4"
                  data-testid={`link-recent-entry-${entry.id}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 font-bold">
                      #{entry.entryNumber}
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground flex items-center gap-2">
                        {entry.signerFullName || <span className="text-muted-foreground italic">No name provided</span>}
                        {entry.status === 'draft' && <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                      </h4>
                      <div className="text-sm text-muted-foreground flex items-center gap-3 mt-1 flex-wrap">
                        <span className="flex items-center gap-1">
                          <User className="w-3.5 h-3.5" />
                          {entry.notarialActType.replace('_', ' ')}
                        </span>
                        <span className="hidden sm:inline text-border">•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {formatJournalDateTime(entry)}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 sm:flex-col sm:items-end justify-between">
                    <Badge variant="outline" className={cn("capitalize shadow-sm", getStatusColor(entry.status))}>
                      {entry.status}
                    </Badge>
                    <span className="text-sm font-medium">
                      {entry.feeWaived ? 'Waived' : entry.feeCharged === 0 ? '$0.00' : `$${(entry.feeCharged / 100).toFixed(2)}`}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
