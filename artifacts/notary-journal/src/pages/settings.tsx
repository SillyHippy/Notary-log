import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, Lock, Download, Database, Moon, Sun, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { getSettings, saveSettings, getAllEntries, type NotarySettings } from '@/lib/db';
import { exportAllCSV, exportAllJSON, exportAllPDF } from '@/lib/export';

const settingsSchema = z.object({
  notaryName: z.string().min(1, 'Notary name is required'),
  commissionNumber: z.string().min(1, 'Commission number is required'),
  commissionExpiration: z.string().min(1, 'Expiration date is required'),
  defaultCity: z.string().min(1, 'Default city is required'),
  defaultState: z.string().min(2, 'Default state is required').max(2, 'Use 2-letter state code'),
  pinEnabled: z.boolean(),
  pinHash: z.string().optional(),
  darkMode: z.boolean(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export function Settings() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [entryCount, setEntryCount] = useState(0);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      notaryName: '',
      commissionNumber: '',
      commissionExpiration: '',
      defaultCity: '',
      defaultState: '',
      pinEnabled: false,
      darkMode: false,
    }
  });

  useEffect(() => {
    async function loadData() {
      const settings = await getSettings();
      form.reset({
        notaryName: settings.notaryName || '',
        commissionNumber: settings.commissionNumber || '',
        commissionExpiration: settings.commissionExpiration || '',
        defaultCity: settings.defaultCity || '',
        defaultState: settings.defaultState || '',
        pinEnabled: settings.pinEnabled || false,
        pinHash: settings.pinHash,
        darkMode: settings.darkMode || false,
      });
      
      const entries = await getAllEntries();
      setEntryCount(entries.length);
      setIsLoading(false);
    }
    loadData();
  }, [form]);

  const hashPin = async (pin: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const onSubmit = async (data: SettingsFormValues) => {
    setIsSaving(true);
    
    if (data.pinEnabled && showPinSetup) {
      if (pinInput.length !== 4) {
        toast({ title: 'Invalid PIN', description: 'PIN must be 4 digits', variant: 'destructive' });
        setIsSaving(false);
        return;
      }
      if (pinInput !== confirmPinInput) {
        toast({ title: 'PIN mismatch', description: 'PINs do not match', variant: 'destructive' });
        setIsSaving(false);
        return;
      }
      data.pinHash = await hashPin(pinInput);
      setShowPinSetup(false);
    }
    
    if (!data.pinEnabled) {
      data.pinHash = undefined;
    }

    await saveSettings(data as NotarySettings);
    
    // Apply dark mode
    if (data.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    toast({ title: 'Settings saved', description: 'Your preferences have been updated.' });
    setIsSaving(false);
  };

  const handleExportPDF = async () => {
    const entries = await getAllEntries();
    const settings = await getSettings();
    exportAllPDF(entries, settings);
  };

  const handleExportCSV = async () => {
    const entries = await getAllEntries();
    exportAllCSV(entries);
  };

  const handleExportJSON = async () => {
    const entries = await getAllEntries();
    exportAllJSON(entries);
  };

  if (isLoading) {
    return <div className="p-8 animate-pulse flex flex-col gap-4">
      <div className="h-8 w-48 bg-muted rounded"></div>
      <div className="h-64 w-full bg-muted rounded"></div>
    </div>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your notary profile and app preferences</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Notary Profile</CardTitle>
              <CardDescription>Your official commission information used for journal entries</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="notaryName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane Doe" {...field} data-testid="input-notary-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="commissionNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Commission Number</FormLabel>
                      <FormControl>
                        <Input placeholder="123456789" {...field} data-testid="input-commission-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="commissionExpiration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Commission Expiration</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-commission-expiration" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border">
                <FormField
                  control={form.control}
                  name="defaultCity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default City</FormLabel>
                      <FormControl>
                        <Input placeholder="Springfield" {...field} data-testid="input-default-city" />
                      </FormControl>
                      <FormDescription>Pre-fills location for new entries</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="defaultState"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default State</FormLabel>
                      <FormControl>
                        <Input placeholder="IL" maxLength={2} {...field} data-testid="input-default-state" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Security & Appearance</CardTitle>
              <CardDescription>App access and display preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="pinEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base flex items-center gap-2">
                        <Lock className="w-4 h-4 text-primary" />
                        PIN Lock
                      </FormLabel>
                      <FormDescription>
                        Require a 4-digit PIN to access the journal
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          if (checked) setShowPinSetup(true);
                          else setShowPinSetup(false);
                        }}
                        data-testid="switch-pin-enabled"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {showPinSetup && (
                <div className="p-4 border rounded-lg bg-muted/50 space-y-4 animate-in slide-in-from-top-2">
                  <h4 className="font-medium text-sm">Set up your PIN</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="pin">Enter 4-digit PIN</Label>
                      <Input 
                        id="pin" 
                        type="password" 
                        maxLength={4} 
                        value={pinInput} 
                        onChange={e => setPinInput(e.target.value.replace(/[^0-9]/g, ''))}
                        data-testid="input-pin-setup"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirmPin">Confirm PIN</Label>
                      <Input 
                        id="confirmPin" 
                        type="password" 
                        maxLength={4} 
                        value={confirmPinInput} 
                        onChange={e => setConfirmPinInput(e.target.value.replace(/[^0-9]/g, ''))}
                        data-testid="input-pin-confirm"
                      />
                    </div>
                  </div>
                </div>
              )}

              <FormField
                control={form.control}
                name="darkMode"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base flex items-center gap-2">
                        {field.value ? <Moon className="w-4 h-4 text-primary" /> : <Sun className="w-4 h-4 text-primary" />}
                        Dark Mode
                      </FormLabel>
                      <FormDescription>
                        Switch between light and dark themes
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-dark-mode"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="bg-muted/30 border-t px-6 py-4">
              <Button type="submit" disabled={isSaving} className="gap-2" data-testid="button-save-settings">
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Settings'}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>

      <Card>
        <CardHeader>
          <CardTitle>Data & Export</CardTitle>
          <CardDescription>Manage your journal data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/20">
            <Database className="w-8 h-8 text-primary" />
            <div>
              <p className="font-medium text-foreground">Local Storage</p>
              <p className="text-sm text-muted-foreground">{entryCount} entries saved locally on this device.</p>
            </div>
          </div>
          
          <Alert variant="default" className="bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-900">
            <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertTitle>Data Privacy</AlertTitle>
            <AlertDescription>
              All journal data is stored locally in your browser. Clearing your browser data will delete your journal. Please export regularly for backup.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Button variant="outline" className="gap-2 w-full" onClick={handleExportPDF} data-testid="button-export-pdf">
              <Download className="w-4 h-4" /> Export PDF
            </Button>
            <Button variant="outline" className="gap-2 w-full" onClick={handleExportCSV} data-testid="button-export-csv">
              <Download className="w-4 h-4" /> Export CSV
            </Button>
            <Button variant="outline" className="gap-2 w-full" onClick={handleExportJSON} data-testid="button-export-json">
              <Download className="w-4 h-4" /> Export JSON
            </Button>
          </div>
        </CardContent>
      </Card>
      
      <div className="text-center text-sm text-muted-foreground pt-4 pb-8">
        <p>Notary Journal App v1.0.0</p>
      </div>
    </div>
  );
}
