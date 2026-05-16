import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { format } from 'date-fns';
import { ArrowLeft, Download, FileSignature, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { getSettings, type NotarySettings } from '@/lib/db';
import {
  dismissIntake,
  getIntakeSubmission,
  listIntakeSubmissions,
  markIntakeRead,
  stashIntakePrefill,
  type IntakeSubmission,
} from '@/lib/intake';
import { archiveIntakeToDrive } from '@/lib/gdrive-intake';

export function IntakeQueue() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [settings, setSettings] = useState<NotarySettings | null>(null);
  const [items, setItems] = useState<IntakeSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const s = await getSettings();
    setSettings(s);
    if (!s.intakeSecret) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const list = await listIntakeSubmissions(s.intakeSecret, false);
      setItems(list);
    } catch (err) {
      toast({
        title: 'Could not load requests',
        description: err instanceof Error ? err.message : 'Is intake enabled on your server?',
        variant: 'destructive',
      });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEntry = async (item: IntakeSubmission) => {
    if (!settings?.intakeSecret) return;
    try {
      const full = await getIntakeSubmission(settings.intakeSecret, item.id);
      await markIntakeRead(settings.intakeSecret, item.id);
      stashIntakePrefill({
        ...full.fields,
        intakeId: full.id,
      });
      if (settings.archiveIntakeToDrive) {
        try {
          await archiveIntakeToDrive(full, settings);
        } catch (e) {
          toast({
            title: 'Drive archive failed',
            description: e instanceof Error ? e.message : 'Entry will still open.',
            variant: 'destructive',
          });
        }
      }
      setLocation('/entry/new');
    } catch (err) {
      toast({
        title: 'Failed to open request',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const dismiss = async (id: string) => {
    if (!settings?.intakeSecret) return;
    try {
      await dismissIntake(settings.intakeSecret, id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast({ title: 'Request dismissed' });
    } catch (err) {
      toast({
        title: 'Dismiss failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const downloadZip = async (item: IntakeSubmission) => {
    const lines = [
      `Name: ${item.fields.signerFullName}`,
      item.fields.email ? `Email: ${item.fields.email}` : '',
      item.fields.phone ? `Phone: ${item.fields.phone}` : '',
      item.fields.notes ? `Notes: ${item.fields.notes}` : '',
      item.fields.preferredDate ? `Preferred: ${item.fields.preferredDate}` : '',
    ].filter(Boolean);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `intake-${item.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    if (item.fields.idFrontImage) {
      const a2 = document.createElement('a');
      a2.href = item.fields.idFrontImage;
      a2.download = `intake-${item.id}-front.jpg`;
      a2.click();
    }
    if (item.fields.idBackImage) {
      const a3 = document.createElement('a');
      a3.href = item.fields.idBackImage;
      a3.download = `intake-${item.id}-back.jpg`;
      a3.click();
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-24">
      <Button variant="ghost" className="gap-2 pl-0" onClick={() => setLocation('/')}>
        <ArrowLeft className="w-4 h-4" /> Dashboard
      </Button>
      <div>
        <h1 className="text-2xl font-bold">Client requests</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Submissions from your public intake form.
        </p>
      </div>
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !settings?.intakeSecret ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Enable client intake in Settings to generate your form link.
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No requests yet. Share your intake link from Settings.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg">{item.fields.signerFullName}</CardTitle>
                  {!item.read && <Badge>New</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {format(new Date(item.createdAt), 'MMM d, yyyy h:mm a')}
                  {item.fields.phone ? ` · ${item.fields.phone}` : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="gap-1" onClick={() => void startEntry(item)}>
                    <FileSignature className="w-4 h-4" /> Start journal entry
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => void downloadZip(item)}>
                    <Download className="w-4 h-4" /> Download
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => void dismiss(item.id)}>
                    <Trash2 className="w-4 h-4" /> Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
