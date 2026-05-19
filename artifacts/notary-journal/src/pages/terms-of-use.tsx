import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TermsOfUse() {
  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto pb-32 md:pb-0">
      <div className="mb-6">
        <Link href="/settings">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Settings
          </Button>
        </Link>
      </div>

      <h1 className="text-3xl font-bold tracking-tight mb-6">Terms of Use</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
      </p>

      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-3">License</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            Notary Journal is provided under a non-commercial software license governed by the laws of Oklahoma and the United States. The full license text is available{' '}
            <a href="https://github.com/iannazzi/Notary-log/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              on GitHub
            </a>.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            In summary: you are free to use, copy, modify, and distribute this software for non-commercial purposes. Commercial use requires a separate written license agreement. You may not sell, resell, rent, lease, sublicense, or bundle the Software into any commercial product or service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Disclaimer of Warranty</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The Software is provided <strong>"AS IS"</strong>, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability arising from the use of the Software.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Limitation of Liability</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            For permitted non-commercial users: in no event shall the copyright holder&apos;s total liability exceed fifty dollars (USD $50.00). This limitation does not apply to claims arising from unauthorized commercial use, which are subject to the liquidated damages provisions in the full license.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">State Notary Guidelines Disclaimer</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            <strong>Important:</strong> This app is a record-keeping and journal management tool. It is <strong>not legal advice</strong> and does not guarantee compliance with any specific state&apos;s notary laws, rules, or requirements.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Notary laws vary significantly by state and are subject to change. You are solely responsible for:
          </p>
          <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc mt-2">
            <li>Consulting your state&apos;s official notary handbook, statutes, and administrative rules</li>
            <li>Ensuring that this journal meets your state&apos;s record-keeping format requirements</li>
            <li>Knowing which information must be recorded for each notarial act under your state&apos;s law</li>
            <li>Maintaining the required retention period (typically 5–10 years, varying by state)</li>
            <li>Complying with any state-specific requirements for ID verification, journal entries, or seal usage</li>
          </ul>
          <p className="text-sm text-muted-foreground leading-relaxed mt-3">
            If you are unsure about your state&apos;s requirements, contact your state&apos;s notary regulating authority or a qualified attorney.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Governing Law</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            These terms shall be governed by and construed in accordance with the laws of the State of Oklahoma. Any disputes shall be filed exclusively in the United States District Court for the Northern District of Oklahoma (Tulsa Division) or the District Court of Tulsa County, Oklahoma.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Copyright</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            © {new Date().getFullYear()} Joseph Iannazzi (Just Legal Solutions). All rights reserved. This software is a copyrighted work protected under the Copyright Act of 1976.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Contact</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            For questions about these terms, licensing inquiries, or commercial use requests, contact:
          </p>
          <ul className="text-sm text-muted-foreground space-y-1 ml-4 mt-2">
            <li>Joseph Iannazzi — Just Legal Solutions</li>
            <li>
              <a href="mailto:joseph@justlegalsolutions.org" className="text-primary underline">joseph@justlegalsolutions.org</a>
            </li>
            <li>
              <a href="mailto:iannazzi.joseph@gmail.com" className="text-primary underline">iannazzi.joseph@gmail.com</a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
