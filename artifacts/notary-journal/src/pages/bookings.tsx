import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import {
  dismissBooking,
  listBookings,
  markBookingJournalLinked,
  type CalBooking,
} from '@/lib/cal-api';
import { stashBookingPrefill } from '@/lib/booking-prefill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Calendar, Play, EyeOff, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function BookingsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [rows, setRows] = useState<CalBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listBookings();
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isPending = (b: CalBooking) => {
    const s = (b.status || '').toUpperCase();
    return s === 'PENDING' || s === 'REQUESTED';
  };

  const pending = rows.filter(isPending);
  const upcoming = rows.filter(
    (b) =>
      !isPending(b) &&
      b.status?.toUpperCase() !== 'CANCELLED' &&
      b.status?.toUpperCase() !== 'REJECTED' &&
      new Date(b.start_time).getTime() >= Date.now() - 3600_000,
  );
  const past = rows.filter((b) => !pending.includes(b) && !upcoming.includes(b));

  async function startEntry(b: CalBooking) {
    stashBookingPrefill(b);
    try {
      await markBookingJournalLinked(b.id);
    } catch {
      /* non-fatal */
    }
    setLocation('/entry/new');
  }

  async function onDismiss(b: CalBooking) {
    try {
      await dismissBooking(b.id);
      toast({ title: 'Hidden', description: 'Booking dismissed from list.' });
      await load();
    } catch (e) {
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Dismiss failed',
        variant: 'destructive',
      });
    }
  }

  function statusLabel(st: string) {
    const s = (st || '').toUpperCase();
    if (s === 'ACCEPTED') return 'Booked';
    if (s === 'CANCELLED') return 'Cancelled';
    if (s === 'REJECTED') return 'Rejected';
    if (s === 'PENDING' || s === 'REQUESTED') return 'Pending (Cal)';
    return s || 'Booked';
  }

  function renderCard(b: CalBooking, opts?: { pending?: boolean }) {
    const st = (b.status || '').toUpperCase();
    const pending = opts?.pending || isPending(b);
    return (
      <Card key={b.id} className="mb-3">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                {b.attendee_name || 'Client'}
              </CardTitle>
              <CardDescription>{formatWhen(b.start_time)}</CardDescription>
            </div>
            <Badge
              variant={
                st === 'CANCELLED' || st === 'REJECTED'
                  ? 'destructive'
                  : pending
                    ? 'outline'
                    : 'secondary'
              }
            >
              {statusLabel(st)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {b.attendee_email && (
            <p className="text-muted-foreground">{b.attendee_email}</p>
          )}
          {b.attendee_phone && (
            <p className="text-muted-foreground">{b.attendee_phone}</p>
          )}
          {b.location && <p className="text-muted-foreground">{b.location}</p>}
          {b.title && <p>{b.title}</p>}
          {typeof b.price_cents === 'number' && (
            <p className="font-medium">
              {b.currency || 'USD'} {(b.price_cents / 100).toFixed(2)}
            </p>
          )}
          {pending ? (
            <p className="text-xs text-muted-foreground">
              Waiting on you in Cal.com — open Cal and accept or reject this request.
              It will move here once confirmed.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Confirmed on Cal.com. Start journal when you do the signing, or Dismiss to hide.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {!pending && (
              <Button size="sm" className="gap-1" onClick={() => void startEntry(b)}>
                <Play className="w-4 h-4" />
                Start journal entry
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1" onClick={() => void onDismiss(b)}>
              <EyeOff className="w-4 h-4" />
              Dismiss
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary" />
            Bookings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Appointments synced from Cal.com webhooks. Configure Cal in Settings.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      )}

      {!loading && error && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p className="mb-2">{error}</p>
            <p className="text-xs">
              Paste your Zo token in Settings and connect a Cal booking link + webhook.
            </p>
            <Button className="mt-4" variant="outline" onClick={() => setLocation('/settings')}>
              Open Settings
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && rows.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="font-medium">No bookings yet</p>
            <p className="text-sm text-muted-foreground">
              1. Settings → Cal scheduling → paste your Cal.com link and slug
              <br />
              2. In Cal → Developer → Webhooks, add the webhook URL shown in Settings
              <br />
              3. Book a test slot — it will appear here
            </p>
            <Button onClick={() => setLocation('/settings')}>Cal settings</Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && pending.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Pending approval (Cal)
          </h2>
          {pending.map((b) => renderCard(b, { pending: true }))}
        </section>
      )}

      {!loading && !error && upcoming.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Upcoming
          </h2>
          {upcoming.map((b) => renderCard(b))}
        </section>
      )}

      {!loading && !error && past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Past / other
          </h2>
          {past.map(renderCard)}
        </section>
      )}
    </div>
  );
}

export default BookingsPage;
