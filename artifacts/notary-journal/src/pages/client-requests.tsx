import * as React from 'react';
import {
  listSubmissions,
  getSubmission,
  markSubmissionRead,
  deleteSubmission,
  type IntakeSubmission,
  type IntakeRequest,
} from '@/lib/intake-api';
import { stashIntakePrefill } from '@/lib/intake-prefill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import {
  ClipboardPaste,
  Loader2,
  User,
  FileText,
  Check,
  X,
  Eye,
  ChevronDown,
} from 'lucide-react';

/**
 * Client Requests page — shows pending intake submissions received via Web3Forms webhook.
 * Accept → creates draft entry + deletes request. Deny → deletes request. Details → expand card.
 */
export function ClientRequests() {
  const { toast } = useToast();
  const [submissions, setSubmissions] = React.useState<IntakeSubmission[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedCards, setExpandedCards] = React.useState<Set<string>>(new Set());
  const [expandedData, setExpandedData] = React.useState<Record<string, IntakeRequest>>({});

  const toggleCard = (name: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const loadSubmissions = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const subs = await listSubmissions();
      setSubmissions(subs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      // Show a friendlier message when the key is not configured
      if (msg.includes('Intake key not configured')) {
        setError('Intake key not configured. Please add your Web3Forms key in Settings.');
      } else {
        setError(msg);
      }
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  const handleAccept = async (sub: IntakeSubmission) => {
    try {
      const full = await getSubmission(sub.name);
      stashIntakePrefill(full);
      await deleteSubmission(sub.name);
      setSubmissions(prev => prev.filter(s => s.name !== sub.name));
      window.location.href = '/entry/new';
    } catch (err) {
      toast({
        title: 'Failed to accept request',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleDeny = async (sub: IntakeSubmission) => {
    try {
      await deleteSubmission(sub.name);
      setSubmissions(prev => prev.filter(s => s.name !== sub.name));
      toast({ title: 'Request denied', description: 'The intake request has been removed.' });
    } catch (err) {
      toast({
        title: 'Failed to deny request',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleViewDetails = async (sub: IntakeSubmission) => {
    if (expandedData[sub.name]) {
      toggleCard(sub.name);
      return;
    }
    try {
      const full = await getSubmission(sub.name);
      setExpandedData(prev => ({ ...prev, [sub.name]: full }));
      toggleCard(sub.name);
    } catch (err) {
      toast({
        title: 'Failed to load details',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

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

  if (error) {
    return (
      <div className="min-h-[100dvh] bg-background p-4 pb-24 md:ml-64 md:p-8">
        <h1 className="text-2xl font-bold mb-6">Client Requests</h1>
        <Alert variant="destructive">
          <AlertDescription className="mt-2">{error}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" className="mt-4" onClick={loadSubmissions}>
          Retry
        </Button>
      </div>
    );
  }

  if (submissions.length === 0) {
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

  return (
    <div className="min-h-[100dvh] bg-background p-4 pb-24 md:ml-64 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Client Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {submissions.length} submission{submissions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadSubmissions} className="gap-2">
          <Loader2 className="w-4 h-4" /> Refresh
        </Button>
      </div>

      <div className="space-y-3">
        {submissions.map((sub) => {
          const isExpanded = expandedCards.has(sub.name);
          const data = expandedData[sub.name];
          const shortName = sub.name.replace('intake-', '').split('-').slice(0, 2).join('-');

          return (
            <Card key={sub.name}>
              <CardHeader className="py-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <CardTitle className="text-sm font-semibold">
                      {shortName}
                    </CardTitle>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(sub.modifiedTime).toLocaleDateString()}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="py-3 pt-0">
                {!isExpanded && (
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mb-3">
                    <div>
                      <FileText className="w-3 h-3 inline mr-1" />
                      {(sub.size / 1024).toFixed(0)} KB
                    </div>
                  </div>
                )}

                {isExpanded && data && (
                  <div className="mb-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      {/* Primary Signer */}
                      <div className="space-y-2">
                        <h4 className="font-semibold text-primary">Primary Signer</h4>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <dt className="text-muted-foreground">Name</dt>
                          <dd>{[data.signerFirstName, data.signerMiddleName, data.signerLastName].filter(Boolean).join(' ') || '—'}</dd>
                          <dt className="text-muted-foreground">Email</dt>
                          <dd>{data.email || '—'}</dd>
                          <dt className="text-muted-foreground">Phone</dt>
                          <dd>{data.phone || '—'}</dd>
                          <dt className="text-muted-foreground">Address</dt>
                          <dd>
                            {[data.address, data.address2].filter(Boolean).join(', ') || '—'}
                            <br />
                            {[data.city, data.state, data.zip].filter(Boolean).join(', ') || '—'}
                          </dd>
                        </dl>
                      </div>

                      {/* ID Information */}
                      <div className="space-y-2">
                        <h4 className="font-semibold text-primary">ID Information</h4>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <dt className="text-muted-foreground">Type</dt>
                          <dd>{data.idType || '—'}</dd>
                          <dt className="text-muted-foreground">Number</dt>
                          <dd>{data.idNumber || '—'}</dd>
                          <dt className="text-muted-foreground">Issued By</dt>
                          <dd>{data.idIssuedBy || '—'}</dd>
                          <dt className="text-muted-foreground">Date Issued</dt>
                          <dd>{data.idDateIssued || '—'}</dd>
                          <dt className="text-muted-foreground">Expiration</dt>
                          <dd>{data.idExpirationDate || '—'}</dd>
                        </dl>
                      </div>

                      {/* ID Photos */}
                      {(data.idFrontImage || data.idBackImage) && (
                        <div className="md:col-span-2 space-y-2">
                          <h4 className="font-semibold text-primary">ID Photos</h4>
                          <div className="flex flex-wrap gap-4">
                            {data.idFrontImage && (
                              <div className="space-y-1">
                                <span className="text-xs font-medium text-muted-foreground">ID Front</span>
                                <img
                                  src={data.idFrontImage}
                                  alt="ID Front"
                                  className="w-32 h-20 object-cover rounded border"
                                />
                              </div>
                            )}
                            {data.idBackImage && (
                              <div className="space-y-1">
                                <span className="text-xs font-medium text-muted-foreground">ID Back</span>
                                <img
                                  src={data.idBackImage}
                                  alt="ID Back"
                                  className="w-32 h-20 object-cover rounded border"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Service Details */}
                      <div className="space-y-2">
                        <h4 className="font-semibold text-primary">Service Details</h4>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <dt className="text-muted-foreground">Services</dt>
                          <dd>{data.servicesPerformed.join(', ') || '—'}</dd>
                          <dt className="text-muted-foreground">Type</dt>
                          <dd>{data.serviceType || '—'}</dd>
                          <dt className="text-muted-foreground">Preferred Date</dt>
                          <dd>{data.preferredDate || '—'}</dd>
                        </dl>
                      </div>

                      {/* Payment */}
                      <div className="space-y-2">
                        <h4 className="font-semibold text-primary">Payment</h4>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <dt className="text-muted-foreground">Method</dt>
                          <dd>{data.paymentMethod || '—'}</dd>
                          <dt className="text-muted-foreground">Amount</dt>
                          <dd>{data.totalAmount || '—'}</dd>
                          <dt className="text-muted-foreground">Payer</dt>
                          <dd>{data.payerName || '—'}</dd>
                        </dl>
                      </div>

                      {/* Additional Signer */}
                      {data.hasSigner2 && (
                        <div className="space-y-2">
                          <h4 className="font-semibold text-primary">Additional Signer</h4>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <dt className="text-muted-foreground">Name</dt>
                            <dd>{[data.signer2FirstName, data.signer2LastName].filter(Boolean).join(' ') || '—'}</dd>
                            <dt className="text-muted-foreground">Phone</dt>
                            <dd>{data.signer2Phone || '—'}</dd>
                            <dt className="text-muted-foreground">ID Type</dt>
                            <dd>{data.signer2IdType || '—'}</dd>
                            <dt className="text-muted-foreground">ID Number</dt>
                            <dd>{data.signer2IdNumber || '—'}</dd>
                            <dt className="text-muted-foreground">Issued By</dt>
                            <dd>{data.signer2IdIssuedBy || '—'}</dd>
                            <dt className="text-muted-foreground">Expiration</dt>
                            <dd>{data.signer2IdExpirationDate || '—'}</dd>
                          </dl>
                        </div>
                      )}

                      {/* Notes */}
                      {data.notes && (
                        <div className="md:col-span-2 space-y-1">
                          <h4 className="font-semibold text-primary">Notes</h4>
                          <p className="text-xs text-muted-foreground">{data.notes}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                    onClick={() => handleAccept(sub)}
                  >
                    <Check className="w-4 h-4" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-2 text-red-600 border-red-300 hover:bg-red-50"
                    onClick={() => handleDeny(sub)}
                  >
                    <X className="w-4 h-4" />
                    Deny
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-2"
                    onClick={() => handleViewDetails(sub)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 rotate-180" />
                    ) : (
                      <>
                        <Eye className="w-4 h-4" />
                        Details
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
