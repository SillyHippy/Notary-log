import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { format } from 'date-fns';
import { Search, Filter, FileText, ChevronRight, AlertCircle, Eye, EyeOff, ArrowUpDown, ArrowUp, ArrowDown, Trash2, X, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getAllEntries, searchEntries, deleteEntry, type JournalEntry } from '@/lib/db';

type SortField = 'date' | 'name' | 'entry';
type SortDir = 'asc' | 'desc';

export function JournalList() {
  const [location, setLocation] = useLocation();
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

  useEffect(() => {
    loadEntries(initialQuery);
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

  const maskIdNumber = (id: string) => {
    if (!id) return '';
    if (showMasked) return id;
    if (id.length <= 4) return '****' + id;
    return '****' + id.slice(-4);
  };

  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto h-full flex flex-col">
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
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
              {searchQuery || hasDateFilter ? 'Try adjusting your filters.' : 'There are no entries in this view.'}
            </p>
            {(searchQuery || hasDateFilter) && (
              <Button variant="outline" onClick={() => { setSearchQuery(''); setDateFrom(''); setDateTo(''); setLocation('/journal'); }} data-testid="button-clear-search">
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
                  <th scope="col" className="px-4 py-3 font-medium">ID Number</th>
                  <th scope="col" className="px-4 py-3 font-medium">Act Type</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">Fee</th>
                  <th scope="col" className="px-4 py-3 font-medium text-center">Status</th>
                  <th scope="col" className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredAndSorted.map((entry) => (
                  <tr 
                    key={entry.id} 
                    className="group hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setLocation(`/entry/${entry.id}`)}
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
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {maskIdNumber(entry.idNumber)}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {entry.notarialActType.replace('_', ' ')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {entry.feeWaived ? 'Waived' : entry.feeCharged === 0 ? '$0.00' : `$${(entry.feeCharged / 100).toFixed(2)}`}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className={cn("capitalize shadow-sm font-medium", getStatusColor(entry.status))}>
                        {entry.status === 'draft' && <AlertCircle className="w-3 h-3 mr-1 inline-block" />}
                        {entry.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      {confirmDeleteId === entry.id ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-xs text-muted-foreground mr-1 whitespace-nowrap hidden sm:inline">Delete?</span>
                          <Button variant="destructive" size="sm" className="h-8 px-3 gap-1 text-xs" onClick={e => handleDeleteFromList(e, entry.id!)}>
                            <Check className="w-3.5 h-3.5" /> Yes
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 sm:opacity-0 sm:group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={e => { e.stopPropagation(); setConfirmDeleteId(entry.id!); }}
                          data-testid={`btn-delete-${entry.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}
