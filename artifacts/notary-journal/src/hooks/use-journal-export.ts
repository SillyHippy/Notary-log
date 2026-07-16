import { useCallback } from 'react';
import { getAllEntries, getSettings } from '@/lib/db';
import { exportAllCSV, exportAllJSON, exportAllPDF, exportJournalTablePDF } from '@/lib/export';
import { useToast } from '@/hooks/use-toast';

export function useJournalExport() {
  const { toast } = useToast();

  const handleExportPDF = useCallback(async () => {
    const entries = await getAllEntries();
    const settings = await getSettings();
    exportAllPDF(entries, settings);
  }, []);

  const handleExportCSV = useCallback(async () => {
    const entries = await getAllEntries();
    exportAllCSV(entries, await getSettings());
  }, []);

  const handleExportJSON = useCallback(async () => {
    const entries = await getAllEntries();
    const settings = await getSettings();
    exportAllJSON(entries, settings);
  }, []);

  const handlePrintJournal = useCallback(async () => {
    const entries = await getAllEntries();
    const settings = await getSettings();
    const completed = entries.filter(e => e.status === 'completed' || e.status === 'amended');
    if (completed.length === 0) {
      toast({ title: 'No entries', description: 'No completed entries to print.', variant: 'destructive' });
      return;
    }
    exportJournalTablePDF(completed, settings);
  }, [toast]);

  return {
    handleExportPDF,
    handleExportCSV,
    handleExportJSON,
    handlePrintJournal,
  };
}
