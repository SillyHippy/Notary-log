import * as React from 'react';
import { Mail, Send, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Formspree endpoint — set via env: VITE_NEWSLETTER_FORM_ACTION
// Free tier: 50 submissions/month at formspree.io
const FORM_ACTION = import.meta.env.VITE_NEWSLETTER_FORM_ACTION ?? '';

interface NewsletterSignupProps {
  /** Heading shown above the signup form. Defaults to a friendly prompt. */
  title?: string;
  /** Description shown below the heading. */
  description?: string;
}

/**
 * A compact newsletter/waitlist signup form powered by Formspree.
 * Zero backend — submissions go straight to formspree.io via their free tier.
 *
 * Setup:
 *   1. Create a free form at https://formspree.io
 *   2. Copy the form ID (e.g. `xnqkvpzy`)
 *   3. Set env: VITE_NEWSLETTER_FORM_ACTION=https://formspree.io/f/xnqkvpzy
 *
 * If no env is set, the component hides itself (no broken UI).
 */
export function NewsletterSignup({ title, description }: NewsletterSignupProps) {
  const [email, setEmail] = React.useState('');
  const [status, setStatus] = React.useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = React.useState('');

  // Don't render anything if Formspree isn't configured
  if (!FORM_ACTION) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) return;

    setStatus('submitting');
    setErrorMsg('');

    try {
      const res = await fetch(FORM_ACTION, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, _subject: 'Notary Journal — New signup' }),
      });
      if (res.ok) {
        setStatus('success');
        setEmail('');
      } else {
        setStatus('error');
        setErrorMsg('Something went wrong. Try again.');
      }
    } catch {
      setStatus('error');
      setErrorMsg('Network error. Check your connection and try again.');
    }
  };

  if (status === 'success') {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-sm font-medium">You're on the list!</p>
            <p className="text-xs text-muted-foreground">We'll keep you posted on updates.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">{title ?? 'Stay in the loop'}</CardTitle>
        </div>
        <CardDescription className="text-xs">
          {description ?? 'Get notified about new features, compliance updates, and tips.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === 'submitting'}
            className="flex-1"
            aria-label="Email address for newsletter"
            required
          />
          <Button type="submit" disabled={status === 'submitting' || !email} size="sm" className="shrink-0">
            {status === 'submitting' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Send className="mr-1 h-4 w-4" />
                Subscribe
              </>
            )}
          </Button>
        </form>
        {status === 'error' && (
          <p className="mt-2 text-xs text-destructive">{errorMsg}</p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Powered by <a href="https://formspree.io" target="_blank" rel="noreferrer" className="underline">Formspree</a> · free tier, no spam.
        </p>
      </CardContent>
    </Card>
  );
}
