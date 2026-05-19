import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PrivacyPolicy() {
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

      <h1 className="text-3xl font-bold tracking-tight mb-6">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
      </p>

      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-3">Overview</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Notary Journal is a mobile and web application designed for notaries public to record and manage their notarial acts. This policy describes what data the app collects, how it is stored, and your rights regarding that data.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Data We Store</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            All journal entries and personal data are stored <strong>locally on your device</strong> in an encrypted database. The following types of data may be stored:
          </p>
          <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
            <li><strong>Signer information:</strong> Full name, email, phone number, physical address, date of birth</li>
            <li><strong>Government ID details:</strong> ID type, ID number, issuing state/agency, issue date, expiration date</li>
            <li><strong>ID photos:</strong> Photographs of the front and/or back of government-issued identification documents</li>
            <li><strong>Notarization details:</strong> Document type, date, location, notarial act type, fee charged</li>
            <li><strong>Signatures:</strong> Digital signature images captured on the device</li>
            <li><strong>App settings:</strong> Your notary profile, commission number, state, fee schedule, and preferences</li>
          </ul>
          <p className="text-sm text-muted-foreground leading-relaxed mt-3">
            Your entire journal database is encrypted at rest using AES-GCM 256-bit encryption. A key derived from your 4-digit PIN protects the data on this device.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Optional Cloud Backup (Google Drive)</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            If you choose to enable Google Drive backup, your encrypted journal data is uploaded to your personal Google Drive account. The backup is a JSON file containing your encrypted database — Google cannot read the contents without your PIN. Backups are only performed when you manually trigger them or when auto-backup is enabled after completing a journal entry. You may disconnect Google Drive access at any time from Settings.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Client Intake Form (Web3Forms)</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            If you share your client intake form link with clients, their submissions are sent via the Web3Forms webhook service. Intake submissions include the client&apos;s name, contact information, ID details, ID photos, and service preferences. These submissions are stored temporarily on your device until you review and accept or deny them. Accepted submissions are converted into journal entries; denied submissions are deleted.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Data We Do NOT Collect</h2>
          <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
            <li>We do not collect analytics or telemetry data</li>
            <li>We do not track your location or usage patterns</li>
            <li>We do not sell or share your data with third parties</li>
            <li>We do not store your PIN or encryption keys on any server</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Data Retention</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Journal entries remain on your device indefinitely until you manually delete them or wipe the app data. Many states require notaries to retain journal records for 5–10 years after the last commission term. You are responsible for maintaining backups (via Google Drive or exported JSON files) in accordance with your state&apos;s requirements.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Your Rights</h2>
          <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
            <li><strong>Export:</strong> You can export your entire journal as a JSON file from Settings at any time</li>
            <li><strong>Delete:</strong> You can delete individual entries or wipe all data from the app</li>
            <li><strong>Backup:</strong> You can back up to Google Drive or download encrypted backups</li>
            <li><strong>Revoke access:</strong> You can disconnect Google Drive and delete remote backup files</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Security</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            All journal data is encrypted at rest using AES-GCM 256-bit encryption with a key derived from your PIN via PBKDF2. Biometric unlock (Face ID, fingerprint) uses the WebAuthn PRF extension to wrap the encryption key — your PIN is never stored on the device. While encryption protects against casual access if your device is lost, it is not a substitute for physical device security. Keep your device physically secure and your PIN confidential.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Changes to This Policy</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We may update this privacy policy from time to time. The date at the top of this page reflects the last update. Continued use of the app after changes constitutes acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Contact</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            If you have questions about this privacy policy or the data stored in the app, please contact the developer through the app&apos;s support channels.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">State Notary Guidelines Disclaimer</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            <strong>Important:</strong> This app is a record-keeping and journal management tool. It is <strong>not legal advice</strong> and does not guarantee compliance with any specific state&apos;s notary laws, rules, or requirements.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Notary laws vary significantly by state and are subject to change. You are solely responsible for consulting your state&apos;s official notary handbook, statutes, and administrative rules to ensure that your journal meets all applicable legal requirements. If you are unsure about your state&apos;s requirements, contact your state&apos;s notary regulating authority or a qualified attorney.
          </p>
        </section>
      </div>
    </div>
  );
}
