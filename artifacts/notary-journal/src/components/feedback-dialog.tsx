import React, { useState, useRef } from 'react';
import { MessageSquarePlus, Upload, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiPath } from '@/lib/app-path';

interface FeedbackDialogProps {
  trigger?: React.ReactNode;
}

export function FeedbackDialog({ trigger }: FeedbackDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState('');
  const [type, setType] = useState('Feature Request');
  const [message, setMessage] = useState('');
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [screenshotFilename, setScreenshotFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPEG, etc.)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Image file is too large (max 5MB)');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setScreenshotBase64(reader.result as string);
      setScreenshotFilename(file.name);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setScreenshotBase64(null);
    setScreenshotFilename(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      setError('Please enter a message describing your request or feedback.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(apiPath('/api/feedback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          state: state.trim() || undefined,
          type,
          message: message.trim(),
          screenshotBase64: screenshotBase64 || undefined,
          screenshotFilename: screenshotFilename || undefined,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit feedback');
      }

      setSuccess(true);
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
        setMessage('');
        removeImage();
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-2 text-xs">
            <MessageSquarePlus className="w-4 h-4 text-primary" />
            Suggest Feature / Report Issue
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="w-5 h-5 text-primary" />
            Notary-Log Support & Suggestions
          </DialogTitle>
          <DialogDescription className="text-xs">
            Have a feature idea, state statutory question, or issue to report? Send it directly to our team.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-8 text-center space-y-3 animate-in fade-in">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h3 className="text-base font-semibold">Thank you for your feedback!</h3>
            <p className="text-xs text-muted-foreground">
              Your message and screenshot have been delivered to our developer team.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-sm">
            {error && (
              <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fb-type" className="text-xs">Category</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="fb-type" className="text-xs h-9">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Feature Request">Feature Request</SelectItem>
                    <SelectItem value="Bug / Error Report">Bug / Issue Report</SelectItem>
                    <SelectItem value="State Law / Rules Question">State Law Question</SelectItem>
                    <SelectItem value="General Feedback">General Feedback</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fb-state" className="text-xs">Your State</Label>
                <Input
                  id="fb-state"
                  placeholder="e.g. Oklahoma, PA"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fb-name" className="text-xs">Your Name (Optional)</Label>
                <Input
                  id="fb-name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fb-email" className="text-xs">Email (Optional)</Label>
                <Input
                  id="fb-email"
                  type="email"
                  placeholder="For reply"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fb-message" className="text-xs">
                Message & Details <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="fb-message"
                placeholder="Describe your feature request, statutory question, or error..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="text-xs leading-relaxed resize-none"
                required
              />
            </div>

            {/* Screenshot upload */}
            <div className="space-y-1.5">
              <Label className="text-xs">Attach Screenshot (Optional)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              {screenshotBase64 ? (
                <div className="flex items-center justify-between p-2 rounded-lg border bg-muted/30 text-xs">
                  <span className="truncate max-w-[300px] text-muted-foreground font-mono">
                    {screenshotFilename || 'screenshot.png'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeImage}
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full text-xs gap-1.5 h-9 border-dashed text-muted-foreground hover:text-foreground"
                >
                  <Upload className="w-3.5 h-3.5" /> Tap to attach error screenshot or document sample
                </Button>
              )}
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="text-xs h-9"
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading} className="gap-1.5 text-xs h-9">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquarePlus className="w-3.5 h-3.5" />}
                {loading ? 'Sending…' : 'Send to Team'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default FeedbackDialog;
