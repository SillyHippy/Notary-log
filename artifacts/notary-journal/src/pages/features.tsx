import React, { useState } from 'react';
import { Link } from 'wouter';
import {
  ShieldCheck,
  Smartphone,
  Tablet,
  QrCode,
  Calendar,
  Lock,
  Printer,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Sparkles,
  ArrowRight,
  Fingerprint,
  Scale,
  AlertTriangle,
  FileCheck,
  Eye,
  Laptop,
  BookOpen,
  MessageSquarePlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { FeedbackDialog } from '@/components/feedback-dialog';

export function FeaturesPage() {
  const [deviceMode, setDeviceMode] = useState<'phone' | 'tablet' | 'desktop'>('phone');

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-6xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight">Notary-Log</span>
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                100% Free
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://github.com/SillyHippy/Notary-log"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground hidden sm:inline-flex items-center gap-1 font-medium transition-colors"
            >
              GitHub <ExternalLink className="w-3 h-3" />
            </a>
            <Button asChild size="sm" className="gap-1.5 shadow-sm">
              <Link href="/">
                Launch Journal <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-16 sm:py-24 border-b bg-gradient-to-b from-muted/30 via-background to-background">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center space-y-6">
          <Badge variant="outline" className="px-3 py-1 gap-1.5 border-primary/30 text-primary font-medium text-xs rounded-full">
            <Sparkles className="w-3.5 h-3.5" /> In-Person Mobile & Table Notary Journal
          </Badge>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground sm:leading-tight">
            Stop Carrying a Heavy Paper Log Book.
          </h1>

          <p className="text-base sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Notary-Log is a free, offline-first digital electronic journal for mobile notaries and signing agents. Your records stay encrypted on your device with cryptographic tamper-evident proof and instant PDF exports.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
            <Button asChild size="lg" className="gap-2 h-12 px-6 text-base font-semibold shadow-md">
              <Link href="/">
                Open Journal Web App <ChevronRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-12 px-6 text-base font-semibold">
              <a href="#compliance">
                50-State Statutory Matrix
              </a>
            </Button>
          </div>

          <div className="pt-8 flex flex-wrap justify-center items-center gap-y-2 gap-x-6 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Device-Local AES-GCM Encryption
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> SHA-256 Tamper-Proof Chain
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Works 100% Offline (PWA)
            </span>
          </div>
        </div>
      </section>

      {/* Visual App Tour & Screenshots (3-Way Switcher) */}
      <section id="screenshots" className="py-16 sm:py-24 max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <Badge variant="outline" className="px-3 py-1 text-xs font-semibold rounded-full border-primary/30 text-primary">
            <Eye className="w-3.5 h-3.5 mr-1" /> Live App Tour
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">How It Looks On Every Screen</h2>
          <p className="text-muted-foreground text-sm sm:text-base">
            Responsive and touch-optimized whether you use your phone on the go, an iPad at the closing table, or your laptop at your desk.
          </p>

          {/* 3-Way Toggle Button */}
          <div className="inline-flex p-1 rounded-xl bg-muted border shadow-sm mt-4 flex-wrap justify-center gap-1">
            <button
              onClick={() => setDeviceMode('phone')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                deviceMode === 'phone'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Smartphone className="w-4 h-4" /> Phone View
            </button>
            <button
              onClick={() => setDeviceMode('tablet')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                deviceMode === 'tablet'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Tablet className="w-4 h-4" /> Tablet / iPad View
            </button>
            <button
              onClick={() => setDeviceMode('desktop')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                deviceMode === 'desktop'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Laptop className="w-4 h-4" /> Desktop / Reports
            </button>
          </div>
        </div>

        {/* 1. PHONE VIEW GALLERY */}
        {deviceMode === 'phone' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-4 animate-in fade-in duration-300">
            {/* Phone 1: Dashboard */}
            <div className="space-y-3 text-center">
              <div className="mx-auto max-w-[270px] rounded-[38px] p-2.5 bg-neutral-900 shadow-2xl border-4 border-neutral-800">
                <div className="rounded-[30px] overflow-hidden bg-background border">
                  <img
                    src="/screenshots/mobile-dashboard.png"
                    alt="Mobile Dashboard"
                    className="w-full h-auto object-cover"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <h4 className="font-semibold text-sm">1. Mobile Dashboard</h4>
                <p className="text-xs text-muted-foreground">Quick stats, hash verification badge, and 1-tap new entry.</p>
              </div>
            </div>

            {/* Phone 2: New Entry & ID Scan */}
            <div className="space-y-3 text-center">
              <div className="mx-auto max-w-[270px] rounded-[38px] p-2.5 bg-neutral-900 shadow-2xl border-4 border-neutral-800">
                <div className="rounded-[30px] overflow-hidden bg-background border">
                  <img
                    src="/screenshots/mobile-entry.png"
                    alt="Mobile New Entry"
                    className="w-full h-auto object-cover"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <h4 className="font-semibold text-sm">2. Fast Table Entry</h4>
                <p className="text-xs text-muted-foreground">PDF417 license barcode scanner + instant auto-fill.</p>
              </div>
            </div>

            {/* Phone 3: Journal List */}
            <div className="space-y-3 text-center">
              <div className="mx-auto max-w-[270px] rounded-[38px] p-2.5 bg-neutral-900 shadow-2xl border-4 border-neutral-800">
                <div className="rounded-[30px] overflow-hidden bg-background border">
                  <img
                    src="/screenshots/mobile-journal.png"
                    alt="Mobile Journal Entries"
                    className="w-full h-auto object-cover"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <h4 className="font-semibold text-sm">3. Journal Ledger</h4>
                <p className="text-xs text-muted-foreground">Sequential chronological list with instant search & filter.</p>
              </div>
            </div>

            {/* Phone 4: Settings & Security */}
            <div className="space-y-3 text-center">
              <div className="mx-auto max-w-[270px] rounded-[38px] p-2.5 bg-neutral-900 shadow-2xl border-4 border-neutral-800">
                <div className="rounded-[30px] overflow-hidden bg-background border">
                  <img
                    src="/screenshots/mobile-settings.png"
                    alt="Mobile Settings and Cryptography"
                    className="w-full h-auto object-cover"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <h4 className="font-semibold text-sm">4. Tamper Verification</h4>
                <p className="text-xs text-muted-foreground">SHA-256 rolling chain audit & biometric unlock settings.</p>
              </div>
            </div>
          </div>
        )}

        {/* 2. TABLET / IPAD VIEW GALLERY */}
        {deviceMode === 'tablet' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 animate-in fade-in duration-300">
            {/* Tablet 1: Table Entry */}
            <div className="space-y-3">
              <div className="rounded-[28px] p-3 bg-neutral-900 shadow-2xl border-4 border-neutral-800">
                <div className="rounded-[20px] overflow-hidden bg-background border">
                  <img
                    src="/screenshots/tablet-entry.png"
                    alt="Tablet Entry View"
                    className="w-full h-auto object-cover"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className="text-center space-y-1">
                <h4 className="font-semibold text-base">Tablet Signing & ID Capture</h4>
                <p className="text-xs text-muted-foreground">Large on-screen signature pad, easy signer review, and fast act categorization on iPad/Android tablets.</p>
              </div>
            </div>

            {/* Tablet 2: Reports / Ledgers */}
            <div className="space-y-3">
              <div className="rounded-[28px] p-3 bg-neutral-900 shadow-2xl border-4 border-neutral-800">
                <div className="rounded-[20px] overflow-hidden bg-background border">
                  <img
                    src="/screenshots/tablet-reports.png"
                    alt="Tablet Reports View"
                    className="w-full h-auto object-cover"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className="text-center space-y-1">
                <h4 className="font-semibold text-base">Tablet Journal & Audit View</h4>
                <p className="text-xs text-muted-foreground">Full multi-column journal ledger, date filtering, and instant one-tap PDF export.</p>
              </div>
            </div>
          </div>
        )}

        {/* 3. DESKTOP VIEW GALLERY */}
        {deviceMode === 'desktop' && (
          <div className="space-y-12 animate-in fade-in duration-300">
            {/* Desktop 1: Entry Form */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-5 space-y-3">
                <div className="inline-flex p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <QrCode className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold">Comprehensive Signing Workflows</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Easily split multi-document signing sessions (e.g. Deeds, Notes, Affidavits) into separate statutory journal lines, capture touch signatures, and scan state IDs in seconds.
                </p>
                <ul className="text-xs space-y-1.5 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Camera PDF417 & MRZ Passport auto-fill
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Touch / stylus signature capture
                  </li>
                </ul>
              </div>
              <div className="lg:col-span-7 rounded-xl border bg-card shadow-lg overflow-hidden p-2">
                <img
                  src="/screenshots/new-entry.png"
                  alt="New Notary Entry Screen"
                  className="rounded-lg w-full h-auto object-cover border"
                  loading="lazy"
                />
              </div>
            </div>

            {/* Desktop 2: Print Journal */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7 order-2 lg:order-1 rounded-xl border bg-card shadow-lg overflow-hidden p-2">
                <img
                  src="/screenshots/official-journal-print-sample.png"
                  alt="Official Print Journal PDF Ledger"
                  className="rounded-lg w-full h-auto object-cover border shadow-sm"
                  loading="lazy"
                />
              </div>
              <div className="lg:col-span-5 order-1 lg:order-2 space-y-3">
                <div className="inline-flex p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Printer className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold">Official Print Journal PDF & CSV</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Generate a court-ready, NNA-style formatted multi-column official PDF ledger complete with your commission seal, page numbers, line item details, and verified hash signatures for state inspections.
                </p>
                <ul className="text-xs space-y-1.5 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Formatted multi-column PDF log with seal
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Full CSV export for Schedule C bookkeeping
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Core Feature Grid */}
      <section className="py-16 sm:py-20 max-w-6xl mx-auto px-4 sm:px-6 border-t">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Features Built for Independent Notaries</h2>
          <p className="text-muted-foreground text-sm sm:text-base">
            Everything you need for clean recordkeeping without monthly fees.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="border shadow-sm flex flex-col justify-between">
            <CardHeader>
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-2">
                <Lock className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg">Cryptographic SHA-256 Chain</CardTitle>
              <CardDescription>
                Every completed act generates a sequential SHA-256 cryptographic hash linked to the previous entry, proving records have not been altered or deleted.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground pt-0">
              ✓ One-click chain integrity verification badge
            </CardContent>
          </Card>

          <Card className="border shadow-sm flex flex-col justify-between">
            <CardHeader>
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-2">
                <QrCode className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg">ID Barcode & MRZ Scanner</CardTitle>
              <CardDescription>
                Scan state driver&apos;s licenses or passport MRZ codes with your camera to instantly fill signer name, address, ID number, and expiration date.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground pt-0">
              ✓ Optional encrypted ID photo capture (Front & Back)
            </CardContent>
          </Card>

          <Card className="border shadow-sm flex flex-col justify-between">
            <CardHeader>
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-2">
                <Fingerprint className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg">Multi-Signer & Touch Signatures</CardTitle>
              <CardDescription>
                Capture on-screen digital signatures per signer with touch or stylus. Handle multi-signer loan packages, co-signers, and batch split-act signings.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground pt-0">
              ✓ Supports FaceID / TouchID / WebAuthn biometric unlock
            </CardContent>
          </Card>

          <Card className="border shadow-sm flex flex-col justify-between">
            <CardHeader>
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-2">
                <Printer className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg">NNA-Style Print Journal PDF</CardTitle>
              <CardDescription>
                Export official formatted multi-column journal ledgers with your commission seal, page numbering, and line-item details ready for state audits.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground pt-0">
              ✓ Full CSV spreadsheet export for Schedule C bookkeeping
            </CardContent>
          </Card>

          <Card className="border shadow-sm flex flex-col justify-between">
            <CardHeader>
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-2">
                <Calendar className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg">Integrated Booking (Cal.com)</CardTitle>
              <CardDescription>
                Share your personal link (<code>/book/your-name</code>) with clients. Sync your availability, collect upfront fees with Stripe, and convert bookings into entries with 1 tap.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground pt-0">
              ✓ 100% Free calendar scheduling via Cal.com
            </CardContent>
          </Card>

          <Card className="border shadow-sm flex flex-col justify-between">
            <CardHeader>
              <div className="w-10 h-10 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-2">
                <Smartphone className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg">100% Offline PWA Storage</CardTitle>
              <CardDescription>
                Install to your home screen on iOS or Android. Works in basements, hospitals, and rural locations without cell service. Data is stored strictly on your device.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground pt-0">
              ✓ Optional encrypted Google Drive backups
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Authoritative 50-State Statutory Compliance Matrix */}
      <section id="compliance" className="py-16 bg-muted/40 border-y">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-1.5 p-1.5 px-3.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Scale className="w-4 h-4" /> 50-State In-Person Recordkeeping Matrix
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">State Statutory Compliance Breakdown (2026)</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Notary-Log is engineered specifically for in-person wet-ink and paper notarizations where the notary maintains a secure electronic journal instead of a physical paper book. Below is the statutory landscape across all US jurisdictions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Column 1: Mandatory for ALL Acts */}
            <Card className="bg-card border flex flex-col">
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <CardTitle className="text-sm font-bold uppercase tracking-wide">Mandatory (All Acts)</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  States requiring a journal for all notarial acts and authorizing secure electronic formats.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs text-muted-foreground flex-1 overflow-y-auto">
                <div>
                  <strong className="text-foreground block font-semibold">Oklahoma</strong>
                  <span>49 OS § 5 (HB 2265, eff. Nov 1, 2025) — Mandatory journal for all acts; expressly authorizes bound book or secure electronic format.</span>
                </div>
                <div>
                  <strong className="text-foreground block font-semibold">Pennsylvania</strong>
                  <span>57 Pa.C.S. § 319 / 4 Pa. Code § 167.34 — Consecutively numbered, tamper-evident hash, PIN protection, PDF inspection export.</span>
                </div>
                <div>
                  <strong className="text-foreground block font-semibold">Texas</strong>
                  <span>Tex. Gov&apos;t Code § 406.014 / 1 TAC § 87.50 — Mandatory for all notarial acts with full signer ID logging.</span>
                </div>
                <div>
                  <strong className="text-foreground block font-semibold">Colorado</strong>
                  <span>C.R.S. § 24-21-519 / 8 CCR 1505-11 — Full RULONA electronic journal standard.</span>
                </div>
                <div>
                  <strong className="text-foreground block font-semibold">Illinois</strong>
                  <span>5 ILCS 312/3-107 / 14 Ill. Admin. Code § 176.910 (eff. 2024) — Mandatory for all acts.</span>
                </div>
                <div>
                  <strong className="text-foreground block font-semibold">Utah & Virginia (2026 Laws)</strong>
                  <span>Utah Code § 46-1-13 (SB 139) & Va. Code § 47.1-14 (eff. July 1, 2026).</span>
                </div>
                <div>
                  <strong className="text-foreground block font-semibold">Other Mandatory States</strong>
                  <span>Delaware (29 Del. C. § 4309), DC, Kansas, Maryland, Massachusetts, Mississippi, Missouri, Montana, Nevada, New Jersey, New Mexico, North Dakota, Oregon, Vermont, Washington, Wyoming.</span>
                </div>
              </CardContent>
            </Card>

            {/* Column 2: Mandatory for Electronic / RON Only */}
            <Card className="bg-card border flex flex-col">
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                  <FileCheck className="w-5 h-5" />
                  <CardTitle className="text-sm font-bold uppercase tracking-wide">Mandatory for E-Acts / RON</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Mandatory journal for electronic acts; optional/best-practice for traditional paper acts.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs text-muted-foreground flex-1 overflow-y-auto">
                <div>
                  <strong className="text-foreground block font-semibold">New York</strong>
                  <span>Exec. Law § 135-c / 19 NYCRR § 182.9 — Mandatory electronic journal for electronic acts with 10-year retention; recommended for traditional paper acts.</span>
                </div>
                <div>
                  <strong className="text-foreground block font-semibold">Georgia</strong>
                  <span>O.C.G.A. § 45-17-8 / HB 1292 (eff. 2025) — Mandatory for real estate instruments by self-filers and e-notarizations.</span>
                </div>
                <div>
                  <strong className="text-foreground block font-semibold">Indiana, Iowa, Ohio, Wisconsin</strong>
                  <span>Mandatory for electronic notarial acts and RON; voluntary best practice for traditional paper notarizations.</span>
                </div>
                <div>
                  <strong className="text-foreground block font-semibold">Tennessee & Idaho</strong>
                  <span>Mandatory for electronic notarizations; voluntary for traditional in-person paper acts.</span>
                </div>
              </CardContent>
            </Card>

            {/* Column 3: Universal Best Practice & Exceptions */}
            <Card className="bg-card border flex flex-col">
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <BookOpen className="w-5 h-5" />
                  <CardTitle className="text-sm font-bold uppercase tracking-wide">Best-Practice & Nuances</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Voluntary states and specific physical ink thumbprint / tangible restrictions.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs text-muted-foreground flex-1 overflow-y-auto">
                <div>
                  <strong className="text-foreground block font-semibold">Florida</strong>
                  <span>Fla. Stat. § 117.05 — Strongly recommended best practice for traditional acts (mandatory for RON).</span>
                </div>
                <div>
                  <strong className="text-foreground block font-semibold">Other Voluntary States</strong>
                  <span>Alabama (fee log required if charging), Arkansas, Connecticut, Kentucky, Louisiana, Maine, Michigan, Nebraska, North Carolina, South Carolina, South Dakota, Rhode Island.</span>
                </div>
                <div className="pt-2 border-t text-amber-900 dark:text-amber-200">
                  <strong className="block font-semibold">⚠️ Physical Ink Thumbprint Note (California)</strong>
                  <span>Cal. Gov. Code § 8206 requires a physical ink thumbprint in a tangible paper log for Deeds of Trust, Real Estate Deeds, and Powers of Attorney.</span>
                </div>
                <div className="text-amber-900 dark:text-amber-200">
                  <strong className="block font-semibold">⚠️ Tangible Paper Rule (Arizona & Hawaii)</strong>
                  <span>ARS § 41-319 & HRS § 456-15 mandate tangible paper journals for traditional wet-ink notarizations.</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Legal Disclaimer */}
          <div className="p-4 rounded-lg bg-muted/60 border text-xs text-muted-foreground space-y-1.5">
            <p className="font-semibold text-foreground">Statutory Disclaimer & In-Person Focus</p>
            <p>
              Notary-Log is an electronic recordkeeping journal for in-person wet-ink and paper notarizations. It is NOT a Remote Online Notarization (RON) platform and does not perform remote audio/video session recording. Statutory requirements and administrative rules vary by jurisdiction and are subject to legislative updates. Information presented is compiled from public state statutes for informational reference and does not constitute formal legal advice. Notaries are solely responsible for ensuring compliance with their local commissioning authority rules.
            </p>
          </div>
        </div>
      </section>

      {/* Call to Action Banner & Feedback */}
      <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6 text-center space-y-6">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Ready to streamline your notary workflow?</h2>
        <p className="text-muted-foreground text-sm sm:text-base max-w-xl mx-auto">
          No credit card, no sign-up forms, and no monthly fees. Just open the web app, set your 4-digit PIN on your device, and start logging notarizations.
        </p>
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="h-12 px-8 text-base font-semibold shadow-md">
            <Link href="/">
              Launch Notary-Log Web App
            </Link>
          </Button>
          <FeedbackDialog
            trigger={
              <Button variant="outline" size="lg" className="h-12 px-6 text-base font-semibold gap-2">
                <MessageSquarePlus className="w-5 h-5 text-primary" />
                Suggest Feature / Question
              </Button>
            }
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t py-8 bg-muted/20 text-xs text-muted-foreground">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} Notary-Log. Built for independent professional mobile notaries.</p>
          <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1">
            <FeedbackDialog
              trigger={
                <button className="hover:underline text-muted-foreground hover:text-foreground">
                  Suggest Feature / Report Issue
                </button>
              }
            />
            <Link href="/privacy" className="inline-flex min-h-11 items-center hover:underline">Privacy Policy</Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center hover:underline">Terms of Use</Link>
            <a href="https://github.com/SillyHippy/Notary-log" target="_blank" rel="noreferrer" className="hover:underline">
              GitHub Source
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default FeaturesPage;
