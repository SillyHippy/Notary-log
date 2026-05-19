import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { format } from 'date-fns';
import { Search, Filter, FileText, ChevronRight, AlertCircle, Eye, EyeOff, ArrowUpDown, ArrowUp, ArrowDown, Trash2, X, Check, PenLine, ScanLine, Printer } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getAllEntries, searchEntries, deleteEntry, getSettings, shouldRecordSignerIdNumber, type JournalEntry, type NotarySettings } from '@/lib/db';
import { exportJournalTablePDF } from '@/lib/export';
import { useToast } from '@/hooks/use-toast';

type SortField = 'date' | 'name' | 'entry';
type SortDir = 'asc' | 'desc';

export function JournalList() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const searchParams = new URLSearchParams(window.location.search);
  const initialQuery = searchParams.get('q') || '';
  
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [showMasked, setShowMasked] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [needsIdScanFilter, setNeedsIdScanFilter] = useState(false);
  const [settings, setSettings] = useState<NotarySettings | null>(null);
  // Compliance: when this notary's state forbids storing the ID number, hide
  // the entire ID Number column (header + cell + masking control) so it never
  // appears on screen — even masked — for entries that may have been written
  // before the toggle flipped.
  const showIdColumn = shouldRecordSignerIdNumber(settings ?? undefined);

  useEffect(() => {
    loadEntries(initialQuery);
    getSettings().then(setSettings).catch(() => setSettings(null));
  }, [initialQuery]);

  const loadEntries = async (query: string) => {
    setIsLoading(true);
    let data;
    if (query.trim()) {
      data = await searchEntries(query);
    } else {
      data = await getAllEntries();
    }
    setEntries(data);
    setIsLoading(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setLocation(`/journal?q=${encodeURIComponent(searchQuery)}`);
    } else {
      setLocation('/journal');
    }
  };

  const handleDeleteFromList = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await deleteEntry(id);
    setConfirmDeleteId(null);
    setEntries(prev => prev.filter(en => en.id !== id));
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const filteredAndSorted = entries
    .filter(entry => {
      if (activeTab !== 'all' && entry.status !== activeTab) return false;
      if (needsIdScanFilter) {
        if (entry.status !== 'draft' || entry.idFrontImage) return false;
      }
      const entryDate = new Date(entry.createdAt);
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (entryDate < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (entryDate > to) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sortField === 'name') {
        cmp = (a.signerFullName || '').localeCompare(b.signerFullName || '');
      } else if (sortField === 'entry') {
        cmp = (a.entryNumber || 0) - (b.entryNumber || 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800';
      case 'draft': return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800';
      case 'amended': return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800';
      default: return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700';
    }
  };

  const maskIdNumber = (id: string | undefined) => {
    if (!id) return <span className="text-muted-foreground italic">—</span>;
    if (showMasked) return id;
    if (id.length <= 4) return '****' + id;
    return '****' + id.slice(-4);
  };

  const hasDateFilter = dateFrom || dateTo;
  const hasActiveFilter = hasDateFilter || needsIdScanFilter;

  // Pagination
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(filteredAndSorted.length / PAGE_SIZE);
  const pagedEntries = filteredAndSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [activeTab, needsIdScanFilter, dateFrom, dateTo, searchQuery, sortField, sortDir]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto h-full flex flex-col pb-32 md:pb-0">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Journal</h1>
          <p className="text-muted-foreground mt-1">Manage and review your notarial acts</p>
        </div>
        
        <form onSubmit={handleSearch} className="relative flex-1 md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search by signer name or entry number..." 
            className="pl-9 bg-card"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-journal-search"
          />
        </form>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          data-testid="button-print-journal"
          onClick={async () => {
            try {
              const [all, s] = await Promise.all([getAllEntries(), getSettings()]);
              const completed = all.filter(e => e.status === 'completed' || e.status === 'amended');
              if (completed.length === 0) {
                toast({ title: 'No entries', description: 'There are no completed entries to print.', variant: 'destructive' });
                return;
              }
              exportJournalTablePDF(completed, s);
              toast({ title: 'Journal PDF generated', description: `${completed.length} entries exported.` });
            } catch (err) {
              toast({ title: 'Export failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
            }
          }}
        >
          <Printer className="w-4 h-4" /> Print Journal
        </Button>
      </div>

      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
            <TabsList className="grid grid-cols-3 w-full sm:w-auto">
              <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
              <TabsTrigger value="draft" data-testid="tab-draft">Drafts</TabsTrigger>
              <TabsTrigger value="completed" data-testid="tab-completed">Completed</TabsTrigger>
            </TabsList>
          </Tabs>
          
          {showIdColumn && (
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2"
              onClick={() => setShowMasked(!showMasked)}
              data-testid="button-toggle-mask"
            >
              {showMasked ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showMasked ? 'Hide ID Numbers' : 'Show ID Numbers'}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setNeedsIdScanFilter(v => !v)}
            data-testid="chip-needs-id-scan"
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors",
              needsIdScanFilter
                ? "bg-orange-100 border-orange-300 text-orange-800 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-300"
                : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <ScanLine className="w-3.5 h-3.5" />
            Needs ID scan
            {needsIdScanFilter && <X className="w-3 h-3 ml-0.5" />}
          </button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="w-4 h-4" />
            <span>Date range:</span>
          </div>
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-auto h-8 text-sm bg-card"
            placeholder="From"
            data-testid="input-date-from"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-auto h-8 text-sm bg-card"
            placeholder="To"
            data-testid="input-date-to"
          />
          {hasDateFilter && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setDateFrom(''); setDateTo(''); }} data-testid="button-clear-date-filter">
              Clear dates
            </Button>
          )}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm flex-1 overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="p-8 flex justify-center items-center flex-1">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center flex-1">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-medium text-foreground">No entries found</h3>
            <p className="text-muted-foreground mt-1 mb-6">
              {searchQuery || hasActiveFilter ? 'Try adjusting your filters.' : 'There are no entries in this view.'}
            </p>
            {(searchQuery || hasActiveFilter) && (
              <Button variant="outline" onClick={() => { setSearchQuery(''); setDateFrom(''); setDateTo(''); setNeedsIdScanFilter(false); setLocation('/journal'); }} data-testid="button-clear-search">
                Clear Filters
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b border-border">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <button className="flex items-center hover:text-foreground transition-colors" onClick={() => handleSort('entry')} data-testid="sort-entry">
                      Entry # <SortIcon field="entry" />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <button className="flex items-center hover:text-foreground transition-colors" onClick={() => handleSort('date')} data-testid="sort-date">
                      Date <SortIcon field="date" />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <button className="flex items-center hover:text-foreground transition-colors" onClick={() => handleSort('name')} data-testid="sort-name">
                      Signer <SortIcon field="name" />
                    </button>
                  </th>
                  {showIdColumn && <th scope="col" className="px-4 py-3 font-medium">ID Number</th>}
                  <th scope="col" className="px-4 py-3 font-medium">Act Type</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">Fee</th>
                  <th scope="col" className="px-4 py-3 font-medium text-center">Status</th>
                  <th scope="col" className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedEntries.map((entry) => (
                  <tr 
                    key={entry.id} 
                    className="group hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => { if (confirmDeleteId === entry.id) return; setLocation(`/entry/${entry.id}`); }}
                    data-testid={`row-entry-${entry.id}`}
                  >
                    <td className="px-4 py-3 font-medium whitespace-nowrap">
                      {entry.entryNumber}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {format(new Date(entry.createdAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {entry.signerFullName || <span className="text-muted-foreground italic">None</span>}
                    </td>
                    {showIdColumn && (
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {maskIdNumber(entry.idNumber)}
                      </td>
                    )}
                    <td className="px-4 py-3 capitalize">
                      {entry.notarialActType.replace('_', ' ')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {entry.feeWaived ? 'Waived' : entry.feeCharged === 0 ? '$0.00' : `$${(entry.feeCharged / 100).toFixed(2)}`}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Badge variant="outline" className={cn("capitalize shadow-sm font-medium", getStatusColor(entry.status))}>
                          {entry.status === 'draft' && <AlertCircle className="w-3 h-3 mr-1 inline-block" />}
                          {entry.status}
                        </Badge>
                        {entry.status === 'draft' && !entry.idFrontImage && (
                          <Badge
                            variant="outline"
                            className="text-orange-800 bg-orange-50 border-orange-200 dark:text-orange-300 dark:bg-orange-900/20 dark:border-orange-800 font-medium shadow-sm whitespace-nowrap"
                            data-testid={`badge-needs-id-scan-${entry.id}`}
                          >
                            <ScanLine className="w-3 h-3 mr-1 inline-block" />
                            Needs ID scan
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      {confirmDeleteId === entry.id ? (
                        <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                          <Button variant="destructive" size="sm" className="h-9 px-3 gap-1 text-sm font-medium" onClick={e => handleDeleteFromList(e, entry.id!)}>
                            <Check className="w-4 h-4" /> Delete
                          </Button>
                          <Button variant="outline" size="sm" className="h-9 px-3 border-border bg-background text-foreground" onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          {entry.status === 'draft' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 w-9 p-0 sm:opacity-0 sm:group-hover:opacity-100 text-primary/70 hover:text-primary hover:bg-primary/10"
                              onClick={e => { e.stopPropagation(); setLocation(`/entry/${entry.id}/edit?complete=1`); }}
                              data-testid={`btn-continue-${entry.id}`}
                              title="Continue &amp; Sign"
                            >
                              <PenLine className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0 sm:opacity-0 sm:group-hover:opacity-100 text-foreground/40 hover:text-destructive hover:bg-destructive/10"
                            onClick={e => { e.stopPropagation(); setConfirmDeleteId(entry.id!); }}
                            data-testid={`btn-delete-${entry.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredAndSorted.length)} of {filteredAndSorted.length}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground px-2">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}
