import { useEffect, useMemo, useState } from 'react';
import { Download, FileBarChart, Calendar, Wallet } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

import { getAllEntries, getSettings, type JournalEntry, type NotarySettings } from '@/lib/db';
import { availableReportYears, MONTH_LABELS, rollupYear, type YearRollup } from '@/lib/fees';
import { exportYearReportCSV, exportYearReportPDF } from '@/lib/export';

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Reports() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [settings, setSettings] = useState<NotarySettings | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    (async () => {
      const [e, s] = await Promise.all([getAllEntries(), getSettings()]);
      setEntries(e);
      setSettings(s);
      const years = availableReportYears(e);
      if (years.length > 0) setYear(years[0]);
      setIsLoading(false);
    })();
  }, []);

  const years = useMemo(() => availableReportYears(entries), [entries]);
  const rollup: YearRollup = useMemo(
    () => rollupYear(entries, year, settings),
    [entries, year, settings],
  );

  const monthlyChartData = useMemo(
    () => rollup.monthly.map((b, i) => ({
      month: MONTH_LABELS[i],
      Collected: Number((b.collectedCents / 100).toFixed(2)),
      Acts: b.count,
    })),
    [rollup],
  );

  const feeTypeRows = useMemo(
    () => Object.keys(rollup.byType).sort().map(ft => ({ ft, ...rollup.byType[ft] })),
    [rollup],
  );

  const actRows = useMemo(
    () => Object.keys(rollup.byAct).sort().map(act => ({ act, ...rollup.byAct[act] })),
    [rollup],
  );

  const handleExportPDF = () => {
    if (!settings) return;
    try {
      exportYearReportPDF(entries, settings, year);
    } catch (err) {
      toast({
        title: 'Could not export PDF',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleExportCSV = () => {
    if (!settings) return;
    try {
      exportYearReportCSV(entries, settings, year);
    } catch (err) {
      toast({
        title: 'Could not export CSV',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-64 bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileBarChart className="w-7 h-7 text-primary" />
            Annual Report
          </h1>
          <p className="text-muted-foreground mt-1">
            Year-end summary of your notarial acts and fees collected.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-32" data-testid="select-report-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" className="gap-2" onClick={handleExportPDF} data-testid="button-export-report-pdf">
            <Download className="w-4 h-4" /> PDF
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleExportCSV} data-testid="button-export-report-csv">
            <Download className="w-4 h-4" /> CSV
          </Button>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Acts</p>
              <Calendar className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold" data-testid="text-total-acts">{rollup.totals.count}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {rollup.totals.chargedCount} charged · {rollup.totals.waivedCount} waived
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between pb-2">
              <p className="text-sm font-medium text-muted-foreground">Fees Collected</p>
              <Wallet className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold" data-testid="text-total-collected">
              {fmtUsd(rollup.totals.collectedCents)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between pb-2">
              <p className="text-sm font-medium text-muted-foreground">Fees Waived</p>
              <Wallet className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold" data-testid="text-total-waived">
              {fmtUsd(rollup.totals.waivedEstimatedCents)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {rollup.totals.waivedCount} act{rollup.totals.waivedCount === 1 ? '' : 's'} (est. value from defaults)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between pb-2">
              <p className="text-sm font-medium text-muted-foreground">Avg per Charged Act</p>
              <Wallet className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold">
              {rollup.totals.chargedCount > 0
                ? fmtUsd(Math.round(rollup.totals.collectedCents / rollup.totals.chargedCount))
                : '$0.00'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly chart */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Breakdown</CardTitle>
          <CardDescription>Fees collected each month in {year}</CardDescription>
        </CardHeader>
        <CardContent>
          {rollup.totals.count === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No completed entries for {year} yet.
            </p>
          ) : (
            <div className="w-full h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === 'Collected' ? [`$${value.toFixed(2)}`, name] : [value, name]
                    }
                  />
                  <Legend />
                  <Bar dataKey="Collected" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-fee-type breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Breakdown by Fee Type</CardTitle>
          <CardDescription>Itemized totals by category for {year}</CardDescription>
        </CardHeader>
        <CardContent>
          {feeTypeRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No completed entries for {year} yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-fee-type-breakdown">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Fee Type</th>
                    <th className="py-2 pr-4 font-medium text-right">Acts</th>
                    <th className="py-2 pr-4 font-medium text-right">Charged</th>
                    <th className="py-2 pr-4 font-medium text-right">Collected</th>
                    <th className="py-2 pr-4 font-medium text-right">Waived (acts)</th>
                    <th className="py-2 pr-4 font-medium text-right">Waived (est. $)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {feeTypeRows.map(row => (
                    <tr key={row.ft}>
                      <td className="py-2 pr-4 font-medium">{row.ft}</td>
                      <td className="py-2 pr-4 text-right">{row.count}</td>
                      <td className="py-2 pr-4 text-right">{row.chargedCount}</td>
                      <td className="py-2 pr-4 text-right">{fmtUsd(row.collectedCents)}</td>
                      <td className="py-2 pr-4 text-right">{row.waivedCount}</td>
                      <td className="py-2 pr-4 text-right">{fmtUsd(row.waivedEstimatedCents)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-semibold bg-muted/30">
                    <td className="py-2 pr-4">Total</td>
                    <td className="py-2 pr-4 text-right">{rollup.totals.count}</td>
                    <td className="py-2 pr-4 text-right">{rollup.totals.chargedCount}</td>
                    <td className="py-2 pr-4 text-right">{fmtUsd(rollup.totals.collectedCents)}</td>
                    <td className="py-2 pr-4 text-right">{rollup.totals.waivedCount}</td>
                    <td className="py-2 pr-4 text-right">{fmtUsd(rollup.totals.waivedEstimatedCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-notarial-act-type breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Breakdown by Notarial Act Type</CardTitle>
          <CardDescription>
            Acts grouped by the notarial act recorded on each entry, for {year}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No completed entries for {year} yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-act-type-breakdown">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Notarial Act</th>
                    <th className="py-2 pr-4 font-medium text-right">Acts</th>
                    <th className="py-2 pr-4 font-medium text-right">Charged</th>
                    <th className="py-2 pr-4 font-medium text-right">Collected</th>
                    <th className="py-2 pr-4 font-medium text-right">Waived (acts)</th>
                    <th className="py-2 pr-4 font-medium text-right">Waived (est. $)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {actRows.map(row => (
                    <tr key={row.act}>
                      <td className="py-2 pr-4 font-medium">{row.act}</td>
                      <td className="py-2 pr-4 text-right">{row.count}</td>
                      <td className="py-2 pr-4 text-right">{row.chargedCount}</td>
                      <td className="py-2 pr-4 text-right">{fmtUsd(row.collectedCents)}</td>
                      <td className="py-2 pr-4 text-right">{row.waivedCount}</td>
                      <td className="py-2 pr-4 text-right">{fmtUsd(row.waivedEstimatedCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
