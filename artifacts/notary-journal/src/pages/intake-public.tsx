import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExpandableImage } from '@/components/expandable-image';
import {
  compressImageDataUrl,
  fetchIntakeConfig,
  submitIntake,
  type IntakeFormConfig,
} from '@/lib/intake';

function getSecretFromUrl(): string {
  return new URLSearchParams(window.location.search).get('k') ?? '';
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function UploadRow({
  label,
  image,
  onFile,
}: {
  label: string;
  image?: string;
  onFile: (f: File) => void;
}) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <div className="relative flex-1">
        <Button type="button" variant="outline" size="sm" className="w-full gap-2" asChild>
          <label>
            <Upload className="w-4 h-4" />
            {label}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
        </Button>
      </div>
      {image && (
        <ExpandableImage
          src={image}
          alt={label}
          label={label}
          className="relative w-16 h-12 rounded overflow-hidden border border-border hover:ring-2 ring-primary transition-all shrink-0"
        />
      )}
    </div>
  );
}

export function IntakePublic() {
  const [secret] = useState(getSecretFromUrl);
  const [config, setConfig] = useState<IntakeFormConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [signerFullName, setSignerFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [signerAddress, setSignerAddress] = useState('');
  const [signerCity, setSignerCity] = useState('');
  const [signerState, setSignerState] = useState('');
  const [notes, setNotes] = useState('');
  const [preferredDate, setPreferredDate] = useState('');
  const [idFrontImage, setIdFrontImage] = useState<string | undefined>();
  const [idBackImage, setIdBackImage] = useState<string | undefined>();

  useEffect(() => {
    if (!secret) {
      setError('Invalid link — ask your notary for a new intake URL.');
      setLoading(false);
      return;
    }
    fetchIntakeConfig(secret)
      .then((c) => {
        if (!c) {
          setError(
            'This intake link is not active on this website. The notary must open Settings → Client intake form on this same site, click Save form options, then send you the new link. (A Cloudflare link will not work on Netlify, and vice versa.)',
          );
        } else {
          setConfig(c);
        }
      })
      .catch(() => setError('Could not load form.'))
      .finally(() => setLoading(false));
  }, [secret]);

  const handleImage = async (file: File, slot: 'front' | 'back') => {
    const reader = new FileReader();
    reader.onload = async () => {
      const raw = reader.result as string;
      try {
        const compressed = await compressImageDataUrl(raw);
        if (slot === 'front') setIdFrontImage(compressed);
        else setIdBackImage(compressed);
      } catch {
        if (slot === 'front') setIdFrontImage(raw);
        else setIdBackImage(raw);
      }
    };
    reader.readAsDataURL(file);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret || !signerFullName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitIntake(secret, {
        signerFullName: signerFullName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        signerAddress: signerAddress.trim() || undefined,
        signerCity: signerCity.trim() || undefined,
        signerState: signerState.trim().toUpperCase().slice(0, 2) || undefined,
        notes: notes.trim() || undefined,
        preferredDate: preferredDate || undefined,
        idFrontImage,
        idBackImage,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <PageShell>
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </PageShell>
    );
  }

  if (done) {
    return (
      <PageShell>
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center">
            <CheckCircle2 className="w-14 h-14 text-green-600 mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Submitted</h1>
            <p className="text-muted-foreground text-sm">
              Your notary will review your request. You may close this page.
            </p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Card className="max-w-lg w-full my-8">
        <CardHeader>
          <CardTitle>{config?.title ?? 'Notarization Request'}</CardTitle>
          <CardDescription>
            ID photos are optional — your notary can scan your ID at the appointment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="text-sm text-destructive mb-4" role="alert">{error}</p>
          )}
          {config && (
            <form onSubmit={onSubmit} className="space-y-4">
              <Field label="Full name *">
                <Input
                  required
                  value={signerFullName}
                  onChange={(e) => setSignerFullName(e.target.value)}
                  autoComplete="name"
                />
              </Field>
              {config.showEmail && (
                <Field label="Email">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
              )}
              {config.showPhone && (
                <Field label="Phone">
                  <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
              )}
              {config.showAddress && (
                <>
                  <Field label="Address">
                    <Input value={signerAddress} onChange={(e) => setSignerAddress(e.target.value)} />
                  </Field>
                  <Field label="City">
                    <Input value={signerCity} onChange={(e) => setSignerCity(e.target.value)} />
                  </Field>
                  <Field label="State">
                    <Input maxLength={2} value={signerState} onChange={(e) => setSignerState(e.target.value)} />
                  </Field>
                </>
              )}
              {config.showPreferredDate && (
                <Field label="Preferred date">
                  <Input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} />
                </Field>
              )}
              {config.showNotes && (
                <Field label="Notes">
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="h-20" />
                </Field>
              )}
              {config.allowIdUpload && (
                <Field label="ID photos (optional)">
                  <UploadRow label="Front" image={idFrontImage} onFile={(f) => void handleImage(f, 'front')} />
                  <UploadRow label="Back" image={idBackImage} onFile={(f) => void handleImage(f, 'back')} />
                </Field>
              )}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Submit request
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
