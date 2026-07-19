import { useEffect, useMemo, useState } from 'react';
import { useRoute } from 'wouter';
import { fetchPublicBook, type PublicBookConfig } from '@/lib/cal-api';
import { parseCalBookingUrl } from '@/lib/cal-link';
import { Loader2, Calendar, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Public booking page — Cal.com embed via iframe (reliable on mobile).
 * Profile links (username only) show all event types; event links show one type.
 */
export function PublicBook() {
  const [, params] = useRoute('/book/:slug');
  const slug = params?.slug || '';
  const [cfg, setCfg] = useState<PublicBookConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const embedSrc = useMemo(() => {
    if (!cfg?.calBookingUrl) return null;
    const parsed = parseCalBookingUrl(cfg.calBookingUrl);
    const base = parsed?.bookingUrl || cfg.calBookingUrl;
    try {
      const u = new URL(base);
      // embed-friendly query Cal documents for embeds
      u.searchParams.set('embed', 'true');
      u.searchParams.set('theme', 'auto');
      return u.toString();
    } catch {
      return base;
    }
  }, [cfg]);

  useEffect(() => {
    let cancelled = false;
    setIframeLoaded(false);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPublicBook(slug);
        if (!cancelled) setCfg(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !cfg) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-background text-foreground">
        <Calendar className="w-12 h-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Booking unavailable</h1>
        <p className="text-muted-foreground text-center max-w-md">
          {error || 'This notary has not configured a public booking page.'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-4 py-4 max-w-3xl mx-auto w-full shrink-0">
        <div className="flex items-center gap-2 text-primary mb-1">
          <Calendar className="w-5 h-5" />
          <span className="text-sm font-medium">Schedule a notarization</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{cfg.displayName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose an event type and time below. Fees and reminders are handled in Cal.
        </p>
        {cfg.calBookingUrl && (
          <Button variant="link" className="px-0 h-auto mt-2" asChild>
            <a href={cfg.calBookingUrl} target="_blank" rel="noreferrer">
              Open in Cal.com <ExternalLink className="w-3 h-3 ml-1 inline" />
            </a>
          </Button>
        )}
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-0 sm:px-2 py-2 relative min-h-[70vh]">
        {!iframeLoaded && embedSrc && (
          <div className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}
        {embedSrc ? (
          <iframe
            title={`Book with ${cfg.displayName}`}
            src={embedSrc}
            className="w-full min-h-[75vh] h-[calc(100vh-11rem)] border-0 rounded-lg bg-background relative z-10"
            allow="camera; microphone; fullscreen; payment"
            loading="eager"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => setIframeLoaded(true)}
          />
        ) : (
          <div className="p-6 text-center">
            <Button asChild>
              <a href={cfg.calBookingUrl} target="_blank" rel="noreferrer">
                Continue to booking
              </a>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

export default PublicBook;
