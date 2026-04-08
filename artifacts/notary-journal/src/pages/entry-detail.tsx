import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import { format } from 'date-fns';
import { type LucideIcon } from 'lucide-react';
import { 
  ArrowLeft, Download, FileText, User, CreditCard, CheckCircle, 
  Clock, ShieldAlert, ShieldCheck, PenTool, Edit3, Image as ImageIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { getEntry, updateEntry, generateEntryHash, getSettings, type JournalEntry, type NotarySettings } from '@/lib/db';
import { exportEntryPDF, exportEntryCSV, exportEntryJSON } from '@/lib/export';

export function EntryDetail() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || '0', 10);
  const { toast } = useToast();
  
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [settings, setSettings] = useState<NotarySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hashStatus, setHashStatus] = useState<'verifying' | 'valid' | 'invalid' | 'none'>('verifying');
  
  const [isAmending, setIsAmending] = useState(false);
  const [amendmentText, setAmendmentText] = useState('');

  useEffect(() => {
    async function loadData() {
      if (!id) {
        setLocation('/journal');
        return;
      }
      
      setIsLoading(true);
      const [entryData, settingsData] = await Promise.all([
        getEntry(id),
        getSettings()
      ]);
      
      if (!entryData) {
        toast({ title: 'Error', description: 'Entry not found', variant: 'destructive' });
        setLocation('/journal');
        return;
      }
      
      setEntry(entryData);
      setSettings(settingsData);
      
      if (entryData.status === 'completed' || entryData.status === 'amended') {
        if (entryData.hash) {
          const currentHash = await generateEntryHash(entryData);
          setHashStatus(currentHash === entryData.hash ? 'valid' : 'invalid');
        } else {
          setHashStatus('invalid');
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
    
    await updateEntry(id, {
      status: 'amended',
      amendments
    });
    
    setEntry({ ...entry, status: 'amended', amendments });
    setIsAmending(false);
    setAmendmentText('');
    toast({ title: 'Amendment added', description: 'The entry has been successfully amended.' });
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
            <Button variant="default" className="gap-2" onClick={() => setLocation(`/entry/${entry.id}/edit`)}>
              <Edit3 className="w-4 h-4" /> Edit Draft
            </Button>
          )}
          
          <div className="flex bg-muted/50 rounded-md p-1">
            <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => exportEntryPDF(entry, settings)}>
              <Download className="w-3.5 h-3.5" /> PDF
            </Button>
            <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => exportEntryCSV(entry)}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
            <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => exportEntryJSON(entry)}>
              <Download className="w-3.5 h-3.5" /> JSON
            </Button>
          </div>
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
        
        {hashStatus !== 'none' && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
            hashStatus === 'valid' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900' 
              : 'bg-destructive/10 text-destructive border-destructive/20'
          }`}>
            {hashStatus === 'valid' ? (
              <><ShieldCheck className="w-5 h-5" /> <span className="font-medium text-sm">Integrity Verified</span></>
            ) : (
              <><ShieldAlert className="w-5 h-5" /> <span className="font-medium text-sm">Integrity Warning</span></>
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
              <DetailItem label="Date of Birth" value={entry.signerDOB} />
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
              <DetailItem label="ID Number" value={entry.idNumber} />
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
                <div className="border-2 border-dashed border-border rounded-lg p-2 bg-white dark:bg-zinc-900 flex justify-center">
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
    </div>
  );
}
