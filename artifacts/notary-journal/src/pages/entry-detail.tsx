import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import { format } from 'date-fns';
import { type LucideIcon } from 'lucide-react';
import {
  ArrowLeft, Download, FileText, User, CreditCard, CheckCircle,
  Clock, ShieldAlert, ShieldCheck, PenTool, Edit3, Image as ImageIcon, Trash2, ScanLine,
  CheckCircle2, Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  getEntry, updateEntry, deleteEntry, generateEntryHash, getSettings, getAllEntries,
  getEntriesBySigningGroup,
  recomputeChainFrom, verifyChainPure, shouldRecordSignerDOB, shouldRecordSignerIdNumber,
  type JournalEntry, type NotarySettings,
} from '@/lib/db';
import { exportEntryPDF, exportEntryCSV, exportEntryJSON, exportSigningGroupPDF } from '@/lib/export';
import { generateSigningGroupId } from '@/lib/signing-session';

export function EntryDetail() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || '0', 10);
  const { toast } = useToast();
  
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [settings, setSettings] = useState<NotarySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hashStatus, setHashStatus] = useState<'verifying' | 'valid' | 'invalid' | 'chain-broken' | 'none'>('verifying');
  
  const [isAmending, setIsAmending] = useState(false);
  const [amendmentText, setAmendmentText] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [groupSiblings, setGroupSiblings] = useState<JournalEntry[]>([]);

  useEffect(() => {
    async function loadData() {
      if (!id) {
        setLocation('/journal');
        return;
      }
      
      setIsLoading(true);
      let entryData: JournalEntry | undefined;
      let settingsData: NotarySettings | undefined;
      try {
        [entryData, settingsData] = await Promise.all([getEntry(id), getSettings()]);
      } catch (err) {
        // AES-GCM throws on tampered/corrupted ciphertext. Surface that as a
        // tamper warning rather than a crash, so the user knows their record
        // was modified outside the app.
        console.error('Failed to decrypt entry', err);
        toast({
          title: 'Tamper detected',
          description: 'This entry could not be decrypted. The stored data may have been modified.',
          variant: 'destructive',
        });
        setHashStatus('invalid');
        setIsLoading(false);
        return;
      }

      if (!entryData) {
        toast({ title: 'Error', description: 'Entry not found', variant: 'destructive' });
        setLocation('/journal');
        return;
      }

      setEntry(entryData);
      setSettings(settingsData ?? null);

      if (entryData.signingGroupId) {
        const siblings = await getEntriesBySigningGroup(entryData.signingGroupId);
        setGroupSiblings(siblings.filter(e => e.id !== entryData!.id));
      } else {
        setGroupSiblings([]);
      }

      if (entryData.status === 'completed' || entryData.status === 'amended') {
        if (!entryData.hash) {
          setHashStatus('invalid');
        } else {
          try {
            // Verify the FULL chain up to and including this entry, using
            // recomputed (not stored) hashes so tampering with any older
            // entry surfaces as a chain break here too.
            const all = await getAllEntries();
            const upTo = all.filter(e => e.entryNumber <= entryData!.entryNumber);
            const result = await verifyChainPure(upTo);
            const issue = result.issues.find(i => i.entryNumber === entryData!.entryNumber);
            const upstream = result.issues.some(i => i.entryNumber < entryData!.entryNumber);
            if (issue) {
              setHashStatus(issue.reason.includes('Chain link') ? 'chain-broken' : 'invalid');
            } else if (upstream) {
              setHashStatus('chain-broken');
            } else {
              setHashStatus('valid');
            }
          } catch (err) {
            console.error('Chain verification failed', err);
            setHashStatus('invalid');
          }
        }
      } else {
        setHashStatus('none');
      }

      setIsLoading(false);
    }
    
    loadData();
  }, [id, setLocation, toast]);

  const handleAddAmendment = async () => {
    if (!entry || !amendmentText.trim()) return;
    
    const newAmendment = {
      note: amendmentText,
      date: new Date().toISOString()
    };
    
    const amendments = [...(entry.amendments || []), newAmendment];

    // Append the amendment, then recompute this entry's signed hash AND
    // restamp every later entry in the chain so the journal stays internally
    // consistent. Without this, a legitimate amendment would later look like
    // tampering during chain verification.
    await updateEntry(id, { status: 'amended', amendments });
    await recomputeChainFrom(entry.entryNumber);
    
    setEntry({ ...entry, status: 'amended', amendments });
    setIsAmending(false);
    setAmendmentText('');
    toast({ title: 'Amendment added', description: 'The entry has been successfully amended.' });
  };

  const handleDelete = async () => {
    if (!entry) return;
    await deleteEntry(id);
    toast({ title: 'Entry deleted', description: `Entry ${entry.entryNumber} has been permanently deleted.` });
    setLocation('/journal');
  };

  if (isLoading || !entry || !settings) {
    return <div className="p-8 animate-pulse flex flex-col gap-6">
      <div className="h-8 w-32 bg-muted rounded"></div>
      <div className="h-64 w-full bg-muted rounded"></div>
    </div>;
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <Badge className="bg-emerald-500 hover:bg-emerald-600">Completed</Badge>;
      case 'draft': return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Draft</Badge>;
      case 'amended': return <Badge className="bg-blue-500 hover:bg-blue-600">Amended</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const DetailItem = ({ label, value, icon: Icon }: { label: string, value: React.ReactNode, icon?: LucideIcon }) => (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </span>
      <span className="text-base text-foreground font-medium">{value || <span className="text-muted-foreground italic">Not provided</span>}</span>
    </div>
  );

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6 pb-24">
      {/* Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button variant="ghost" className="gap-2 pl-0 hover:bg-transparent hover:text-primary" onClick={() => setLocation('/journal')}>
          <ArrowLeft className="w-4 h-4" /> Back to Journal
        </Button>
        
        <div className="flex flex-wrap items-center gap-2">
          {entry.status === 'draft' && (
            <>
              {/* Primary CTA: resume the draft and capture the signer's
                  signature so the entry can be marked completed. */}
              <Button
                variant="default"
                className="gap-2"
                onClick={() => setLocation(`/entry/${entry.id}/edit?complete=1`)}
                data-testid="button-continue-sign"
              >
                <CheckCircle2 className="w-4 h-4" />
                Continue &amp; Sign
              </Button>
              {/* Distinct CTA for the "draft now, scan later" workflow.
                  Always visible on a draft so the notary can re-scan or
                  replace the ID images at any time. Routes into the same
                  edit page but auto-opens the scan card via ?scan=1. */}
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setLocation(`/entry/${entry.id}/edit?scan=1`)}
                data-testid="button-scan-id-now"
              >
                <ScanLine className="w-4 h-4" />
                {entry.idFrontImage ? 'Re-scan ID' : 'Scan ID Now'}
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setLocation(`/entry/${entry.id}/edit`)}
                data-testid="button-edit-draft"
              >
                <Edit3 className="w-4 h-4" /> Edit Draft
              </Button>
            </>
          )}

          <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive" onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
          
          <div className="flex bg-muted/50 rounded-md p-1">
            <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => exportEntryPDF(entry, settings)}>
              <Download className="w-3.5 h-3.5" /> PDF
            </Button>
            <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => exportEntryCSV(entry, settings)}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
            <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => exportEntryJSON(entry, settings)}>
              <Download className="w-3.5 h-3.5" /> JSON
            </Button>
          </div>

          {(entry.signingGroupId && groupSiblings.length > 0) && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                try {
                  const allInGroup = [entry, ...groupSiblings].sort((a, b) => {
                    const ai = a.actIndexInGroup ?? a.entryNumber;
                    const bi = b.actIndexInGroup ?? b.entryNumber;
                    return ai - bi || a.entryNumber - b.entryNumber;
                  });
                  exportSigningGroupPDF(allInGroup, settings, entry.signingGroupLabel);
                  toast({ title: 'PDF generated', description: `${allInGroup.length} journal lines exported.` });
                } catch (err) {
                  toast({ title: 'Export failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
                }
              }}
              data-testid="button-print-signing-group"
            >
              <FileText className="w-4 h-4" /> Print signing
            </Button>
          )}

          {(entry.status === 'completed' || entry.status === 'amended') && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                try {
                  const groupId = entry.signingGroupId ?? generateSigningGroupId();
                  sessionStorage.setItem('notary-journal:multiSignerPrefill', JSON.stringify({
                    documentType: entry.documentType,
                    documentDate: entry.documentDate,
                    documentDescription: entry.documentDescription,
                    notarialActType: entry.notarialActType,
                    feeType: entry.feeType,
                    feeCharged: entry.feeCharged,
                    feeWaived: entry.feeWaived,
                    locationCity: entry.locationCity,
                    locationState: entry.locationState,
                    locationAddress: entry.locationAddress,
                    signingGroupId: groupId,
                    signingGroupLabel: entry.signingGroupLabel || entry.documentType,
                  }));
                } catch { /* ignore */ }
                setLocation(`/entry/new?multiSigner=${Date.now()}`);
              }}
              data-testid="button-add-another-signer"
            >
              <Users className="w-4 h-4" /> Add Another Signer
            </Button>
          )}
        </div>
      </div>

      {/* Title & Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-6 rounded-xl border shadow-sm">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold tracking-tight">Entry #{entry.entryNumber}</h1>
            {getStatusBadge(entry.status)}
          </div>
          <p className="text-muted-foreground flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {format(new Date(entry.createdAt), 'MMMM d, yyyy h:mm a')}
          </p>
        </div>
        
        {hashStatus !== 'none' && hashStatus !== 'verifying' && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
            hashStatus === 'valid'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900'
              : 'bg-destructive/10 text-destructive border-destructive/20'
          }`} data-testid={`badge-integrity-${hashStatus}`}>
            {hashStatus === 'valid' ? (
              <><ShieldCheck className="w-5 h-5" /> <span className="font-medium text-sm">Verified — chain intact</span></>
            ) : hashStatus === 'chain-broken' ? (
              <><ShieldAlert className="w-5 h-5" /> <span className="font-medium text-sm">Chain link broken</span></>
            ) : (
              <><ShieldAlert className="w-5 h-5" /> <span className="font-medium text-sm">Tamper detected</span></>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="w-5 h-5 text-primary" /> Signer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-y-6 gap-x-4">
              <div className="col-span-2">
                <DetailItem label="Full Name" value={entry.signerFullName} />
              </div>
              <div className="col-span-2">
                <DetailItem label="Address" value={`${entry.signerAddress}, ${entry.signerCity}, ${entry.signerState}`} />
              </div>
              {shouldRecordSignerDOB(settings) && (
                <DetailItem label="Date of Birth" value={entry.signerDOB} />
              )}
              <DetailItem label="Phone" value={entry.signerPhone} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" /> Identification
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-y-6 gap-x-4">
              <DetailItem label="ID Type" value={entry.idType.replace('_', ' ').toUpperCase()} />
              {shouldRecordSignerIdNumber(settings) && (
                <DetailItem label="ID Number" value={entry.idNumber} />
              )}
              {/* Expiration date is intentionally NOT gated by the ID-number
                  toggle — every state allows recording the expiration
                  date as part of the standard "what kind of ID did you
                  check" record. Only the full ID# is sensitive. */}
              <DetailItem label="Issuing State" value={entry.idIssuingState} />
              <DetailItem label="Expiration Date" value={entry.idExpirationDate} />
              
              {(entry.idFrontImage || entry.idBackImage) && (
                <div className="col-span-2 mt-2 pt-4 border-t">
                  <span className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" /> ID Scans
                  </span>
                  <div className="flex gap-4">
                    {entry.idFrontImage && (
                      <Dialog>
                        <DialogTrigger asChild>
                          <button className="relative w-24 h-16 rounded overflow-hidden border border-border hover:ring-2 ring-primary transition-all">
                            <img src={entry.idFrontImage} alt="ID Front" className="object-cover w-full h-full" />
                          </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl">
                          <DialogHeader><DialogTitle>ID Front</DialogTitle></DialogHeader>
                          <img src={entry.idFrontImage} alt="ID Front" className="w-full h-auto rounded" />
                        </DialogContent>
                      </Dialog>
                    )}
                    {entry.idBackImage && (
                      <Dialog>
                        <DialogTrigger asChild>
                          <button className="relative w-24 h-16 rounded overflow-hidden border border-border hover:ring-2 ring-primary transition-all">
                            <img src={entry.idBackImage} alt="ID Back" className="object-cover w-full h-full" />
                          </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl">
                          <DialogHeader><DialogTitle>ID Back</DialogTitle></DialogHeader>
                          <img src={entry.idBackImage} alt="ID Back" className="w-full h-auto rounded" />
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> Notarial Act
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-y-6 gap-x-4">
              <DetailItem label="Act Type" value={<span className="capitalize">{entry.notarialActType.replace('_', ' ')}</span>} />
              <DetailItem label="Document Type" value={entry.documentType} />
              <DetailItem label="Document Date" value={entry.documentDate} />
              <DetailItem label="Fee Charged" value={entry.feeWaived ? 'Waived' : entry.feeCharged === 0 ? '$0.00' : `$${(entry.feeCharged / 100).toFixed(2)}`} />
              <div className="col-span-2">
                <DetailItem label="Location" value={`${entry.locationCity}, ${entry.locationState}`} />
              </div>
              {entry.documentDescription && (
                <div className="col-span-2">
                  <DetailItem label="Description" value={entry.documentDescription} />
                </div>
              )}
              {entry.notes && (
                <div className="col-span-2">
                  <DetailItem label="Notes" value={entry.notes} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <PenTool className="w-5 h-5 text-primary" /> Signature
              </CardTitle>
            </CardHeader>
            <CardContent>
              {entry.signatureImage ? (
                <div className="border-2 border-dashed border-border rounded-lg p-2 bg-white flex justify-center">
                  <img src={entry.signatureImage} alt="Signer Signature" className="max-h-32 object-contain" style={{ filter: 'var(--signature-filter, none)' }} />
                </div>
              ) : (
                <div className="h-32 border-2 border-dashed border-border rounded-lg flex items-center justify-center bg-muted/30 text-muted-foreground italic">
                  No signature captured
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {(entry.signingGroupId && (groupSiblings.length > 0 || entry.signingGroupLabel)) && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              {entry.signingGroupLabel || 'Linked signing'}
            </CardTitle>
            <CardDescription>
              {entry.actIndexInGroup && entry.actCountInGroup
                ? `Act ${entry.actIndexInGroup} of ${entry.actCountInGroup} in this signing`
                : `${groupSiblings.length + 1} linked entries`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {groupSiblings.map(sib => (
              <button
                key={sib.id}
                type="button"
                className="w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-muted/50 text-left"
                onClick={() => setLocation(`/entry/${sib.id}`)}
                data-testid={`link-sibling-${sib.id}`}
              >
                <span>
                  Entry #{sib.entryNumber}
                  {sib.actIndexInGroup ? ` · act ${sib.actIndexInGroup}` : ''}
                  {sib.documentType ? ` — ${sib.documentType}` : ''}
                </span>
                <span className="text-muted-foreground capitalize">{sib.signerFullName}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Amendments Section */}
      {(entry.amendments?.length || entry.status === 'completed' || entry.status === 'amended') && (
        <Card className="border-blue-200 dark:border-blue-900">
          <CardHeader className="pb-4 bg-blue-50/50 dark:bg-blue-900/10 rounded-t-xl">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" /> Amendments
              </CardTitle>
              {(entry.status === 'completed' || entry.status === 'amended') && (
                <Dialog open={isAmending} onOpenChange={setIsAmending}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="border-blue-200 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900">
                      Add Amendment
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Amendment</DialogTitle>
                      <DialogDescription>
                        Record a correction or update to this completed entry. This will be permanently attached to the record.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Textarea 
                        placeholder="Describe the amendment..." 
                        className="min-h-[100px]"
                        value={amendmentText}
                        onChange={(e) => setAmendmentText(e.target.value)}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setIsAmending(false)}>Cancel</Button>
                      <Button onClick={handleAddAmendment} disabled={!amendmentText.trim()}>Save Amendment</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {entry.amendments && entry.amendments.length > 0 ? (
              <div className="space-y-4">
                {entry.amendments.map((amendment, i) => (
                  <div key={i} className="relative pl-6 pb-4 border-l-2 border-blue-200 dark:border-blue-800 last:border-0 last:pb-0">
                    <div className="absolute w-3 h-3 bg-blue-500 rounded-full -left-[7px] top-1"></div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">
                      {format(new Date(amendment.date), 'MMM d, yyyy h:mm a')}
                    </div>
                    <p className="text-foreground">{amendment.note}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm italic text-center py-4">No amendments recorded for this entry.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" /> Delete Entry {entry.entryNumber}?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-1">
                {entry.status !== 'draft' ? (
                  <p className="text-sm font-medium text-destructive">
                    This is a <strong>{entry.status}</strong> entry. Deleting a completed notary record is permanent and cannot be undone. Make sure you have exported a copy before proceeding.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This draft will be permanently deleted. This cannot be undone.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" className="gap-2" onClick={handleDelete}>
              <Trash2 className="w-4 h-4" /> Yes, Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
