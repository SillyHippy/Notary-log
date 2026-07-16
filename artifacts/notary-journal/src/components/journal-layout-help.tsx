import { useState } from 'react';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type PreviewRow = {
  entry: string;
  date: string;
  signer: string;
  address: string;
  document: string;
  act: string;
  fee: string;
  tall?: boolean;
};

function PrintPreviewTable({ rows, caption }: { rows: PreviewRow[]; caption: string }) {
  return (
    <div className="rounded-md border overflow-hidden text-[10px] sm:text-xs font-mono bg-white">
      <div className="bg-[#1e3a5f] text-white px-2 py-1.5 font-sans text-[10px] font-semibold">
        Print Journal — {caption}
      </div>
      <div className="grid grid-cols-[minmax(1.5rem,auto)_minmax(3.5rem,auto)_1fr_1fr_minmax(3rem,auto)_minmax(2.5rem,auto)] gap-x-1 gap-y-0 border-b bg-slate-100 px-1 py-1 font-sans font-semibold text-muted-foreground">
        <span>#</span>
        <span>Date</span>
        <span>Signer</span>
        <span>Address</span>
        <span>Document</span>
        <span>Fee</span>
      </div>
      {rows.map((row, i) => (
        <div
          key={`${row.entry}-${i}`}
          className={`grid grid-cols-[minmax(1.5rem,auto)_minmax(3.5rem,auto)_1fr_1fr_minmax(3rem,auto)_minmax(2.5rem,auto)] gap-x-1 px-1 py-1.5 border-b last:border-b-0 whitespace-pre-line leading-snug ${
            i % 2 === 0 ? 'bg-slate-50' : 'bg-white'
          } ${row.tall ? 'min-h-[3.5rem]' : ''}`}
        >
          <span>{row.entry}</span>
          <span>{row.date}</span>
          <span>{row.signer}</span>
          <span>{row.address}</span>
          <span>{row.document}</span>
          <span className="text-right">{row.fee}</span>
        </div>
      ))}
    </div>
  );
}

const HELP_TOPICS = [
  {
    id: 'split-docs',
    title: 'One journal line per document (default)',
    description:
      'Comma-separated documents (Deed, Affidavit, Will) print as separate lines — one document per row.',
    preview: (
      <PrintPreviewTable
        caption="3 documents, 1 signer"
        rows={[
          { entry: '12', date: '7/16/26', signer: 'Billy Bob', address: '123 Main, Glenpool, OK', document: 'Deed', act: 'ack', fee: '$5.00' },
          { entry: '13', date: '7/16/26', signer: 'Billy Bob', address: '123 Main, Glenpool, OK', document: 'Affidavit', act: 'ack', fee: '$5.00' },
          { entry: '14', date: '7/16/26', signer: 'Billy Bob', address: '123 Main, Glenpool, OK', document: 'Will', act: 'ack', fee: '$5.00' },
        ]}
      />
    ),
  },
  {
    id: 'combined-signers',
    title: 'Combine co-signers on one journal line',
    description:
      'Check this on the Documents step before you complete. Multiple signers on one certificate print on one entry with signer #1, #2, #3.',
    preview: (
      <PrintPreviewTable
        caption="1 document, 3 signers — combined"
        rows={[
          {
            entry: '15',
            date: '7/16/26',
            signer: '#1 Billy Bob\n#2 Jane Doe\n#3 Kim Deason',
            address: '#1 123 Main, Glenpool, OK\n#2 456 Oak, Tulsa, OK\n#3 789 Elm, OK',
            document: 'Warranty Deed',
            act: 'ack',
            fee: '$9.00',
            tall: true,
          },
        ]}
      />
    ),
  },
  {
    id: 'separate-signers',
    title: 'Separate line per signer (checkbox off)',
    description:
      'Same three signers on one document, but combine co-signers unchecked — each signer gets their own journal line.',
    preview: (
      <PrintPreviewTable
        caption="1 document, 3 signers — separate"
        rows={[
          { entry: '16', date: '7/16/26', signer: 'Billy Bob', address: '123 Main, Glenpool, OK', document: 'Warranty Deed', act: 'ack', fee: '$5.00' },
          { entry: '17', date: '7/16/26', signer: 'Jane Doe', address: '456 Oak, Tulsa, OK', document: 'Warranty Deed', act: 'ack', fee: '$2.00' },
          { entry: '18', date: '7/16/26', signer: 'Kim Deason', address: '789 Elm, OK', document: 'Warranty Deed', act: 'ack', fee: '$2.00' },
        ]}
      />
    ),
  },
  {
    id: 'combined-docs',
    title: 'Combine documents on one line (split off)',
    description:
      'Turn off “one journal line per document” to list multiple document names on a single row for the same signer.',
    preview: (
      <PrintPreviewTable
        caption="3 documents combined, 1 signer"
        rows={[
          {
            entry: '19',
            date: '7/16/26',
            signer: 'Billy Bob',
            address: '123 Main, Glenpool, OK',
            document: 'Deed, Affidavit, Will',
            act: 'ack',
            fee: '$5.00',
          },
        ]}
      />
    ),
  },
] as const;

export function JournalLayoutHelp() {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <HelpCircle className="w-5 h-5 text-primary" />
          Journal layout help
        </CardTitle>
        <CardDescription>
          Tap each option to see how it looks when you print the journal. Settings set the default — you can still change the checkboxes during each signing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {HELP_TOPICS.map(topic => {
          const open = openId === topic.id;
          return (
            <div key={topic.id} className="rounded-lg border shadow-sm overflow-hidden">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-between h-auto py-3 px-4 rounded-none hover:bg-muted/50"
                onClick={() => setOpenId(open ? null : topic.id)}
                data-testid={`help-topic-${topic.id}`}
              >
                <span className="text-left font-medium text-sm">{topic.title}</span>
                {open ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
              </Button>
              {open && (
                <div className="px-4 pb-4 space-y-3 border-t bg-muted/20">
                  <p className="text-sm text-muted-foreground pt-3">{topic.description}</p>
                  {topic.preview}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
