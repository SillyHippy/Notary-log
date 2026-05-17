import * as React from 'react';
import { Link } from 'wouter';
import {
  listSubmissions,
  getSubmission,
  markSubmissionRead,
  type IntakeRequest,
} from '@/lib/formspree-api';
import { stashIntakePrefill } from '@/lib/intake-prefill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import {
  ClipboardPaste,
  Loader2,
  Settings,
  User,
  FileText,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

/**
 * Client Requests page — shows pending intake submissions from Formspree.
 * Also offers a "Paste Submission" dialog for non-webhook platforms.
 */
export function ClientRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = React.useState<IntakeRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [configured, setConfigured] = React.useState(true);

  const loadSubmissions = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const subs = await listSubmissions();
      setRequests(subs as unknown as IntakeRequest[]);
      setConfigured(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      if (msg.includes('not configured')) {
        setConfigured(false);
      } else {
        setError(msg);
      }
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  const handleStartEntry = async (request: IntakeRequest) => {
    try {
      // Fetch full submission with file data
      const full = await getSubmission(request.id);
      stashIntakePrefill(full);
      await markSubmissionRead(request.id);
      window.location.href = '/entry/new';
    } catch (err) {
      toast({
        title: 'Failed to load submission',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const unreadCount = requests.filter((r) => !r.read).length;

  // Not configured
  if (!configured) {
    return (
      <div className="min-h-[100dvh] bg-background p-4 pb-24 md:ml-64 md:p-8">
        <h1 className="text-2xl font-bold mb-6">Client Requests</h1>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Not Configured</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-3">
              Set up your Formspree form to receive client intake submissions.
            </p>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>Create a free form at formspree.io</li>
              <li>Get your API token from Settings → API</li>
              <li>Add them in Settings → Client Intake</li>
            </ol>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="mt-4 gap-2"
            >
              <Link href="/settings">
                <Settings className="w-4 h-4" /> Open Settings
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background p-4 pb-24 md:ml-64 md:p-8 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading requests…</p>
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="min-h-[100dvh] bg-background p-4 pb-24 md:ml-64 md:p-8">
        <h1 className="text-2xl font-bold mb-6">Client Requests</h1>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription className="mt-2">{error}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={loadSubmissions}
        >
          Retry
        </Button>
      </div>
    );
  }

  // Empty
  if (requests.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-background p-4 pb-24 md:ml-64 md:p-8">
        <h1 className="text-2xl font-bold mb-6">Client Requests</h1>
        <div className="text-center py-16">
          <ClipboardPaste className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
          <h2 className="text-lg font-semibold">No requests yet</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            Share your intake link with clients. When they submit, their
            requests will appear here.
          </p>
        </div>
      </div>
    );
  }

  // List
  return (
    <div className="min-h-[100dvh] bg-background p-4 pb-24 md:ml-64 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Client Requests</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {unreadCount} unread
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadSubmissions}
          className="gap-2"
        >
          <Loader2 className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      <div className="space-y-3">
        {requests.map((req) => (
          <Card
            key={req.id}
            className={
              !req.read ? 'border-primary/50 bg-primary/5' : undefined
            }
          >
            <CardHeader className="py-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-semibold">
                    {[req.signerFirstName, req.signerMiddleName, req.signerLastName]
                      .filter(Boolean)
                      .join(' ') || 'Unknown'}
                  </CardTitle>
                  {!req.read && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/20 text-primary">
                      New
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(req.createdAt).toLocaleDateString()}
                </span>
              </div>
            </CardHeader>
            <CardContent className="py-3 pt-0">
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mb-3">
                {req.phone && (
                  <div>
                    <span className="text-foreground">Phone:</span> {req.phone}
                  </div>
                )}
                {req.city && (
                  <div>
                    <span className="text-foreground">Location:</span>{' '}
                    {req.city}, {req.state}
                  </div>
                )}
                {(req.idFrontFiles.length + req.idBackFiles.length) > 0 && (
                  <div>
                    <FileText className="w-3 h-3 inline mr-1" />
                    {req.idFrontFiles.length + req.idBackFiles.length} ID
                    file(s)
                  </div>
                )}
                {req.servicesPerformed.length > 0 && (
                  <div>
                    <span className="text-foreground">Services:</span>{' '}
                    {req.servicesPerformed.join(', ')}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleStartEntry(req)}
                  className="flex-1 gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Start Entry
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
