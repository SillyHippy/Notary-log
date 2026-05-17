import { ReactNode } from 'react';
import { Navigation } from './navigation';
import { InstallBanner } from './install-banner';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-[100dvh] bg-background w-full">
      <Navigation />
      <InstallBanner />
      <main className="md:ml-64 pb-20 md:pb-0 min-h-[100dvh]">
        {children}
      </main>
    </div>
  );
}
