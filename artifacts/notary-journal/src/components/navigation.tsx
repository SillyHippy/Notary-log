import { Link, useLocation } from 'wouter';
import { LayoutDashboard, BookOpen, Plus, Settings, FileBarChart, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Navigation() {
  const [location] = useLocation();

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/journal', label: 'Journal', icon: BookOpen },
    { href: '/requests', label: 'Requests', icon: Inbox },
    { href: '/reports', label: 'Reports', icon: FileBarChart },
  ];

  const secondaryNavItems = [
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <>
      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border pb-safe" aria-label="Main navigation">
        <div className="flex items-center justify-around h-16 px-2 relative">
          <Link href="/" className={cn("flex flex-col items-center justify-center w-16 h-full text-xs font-medium transition-colors touch-target", location === '/' ? "text-primary" : "text-muted-foreground")} data-testid="link-nav-dashboard" aria-label="Dashboard" aria-current={location === '/' ? 'page' : undefined}>
            <LayoutDashboard className="w-5 h-5 mb-1" aria-hidden="true" />
            <span className="sr-only">Dashboard</span>
          </Link>

          <Link href="/journal" className={cn("flex flex-col items-center justify-center w-16 h-full text-xs font-medium transition-colors touch-target", location.startsWith('/journal') ? "text-primary" : "text-muted-foreground")} data-testid="link-nav-journal" aria-label="Journal" aria-current={location.startsWith('/journal') ? 'page' : undefined}>
            <BookOpen className="w-5 h-5 mb-1" aria-hidden="true" />
            <span className="sr-only">Journal</span>
          </Link>

          <Link href="/requests" className={cn("flex flex-col items-center justify-center w-16 h-full text-xs font-medium transition-colors touch-target", location.startsWith('/requests') ? "text-primary" : "text-muted-foreground")} data-testid="link-nav-requests" aria-label="Client Requests" aria-current={location.startsWith('/requests') ? 'page' : undefined}>
            <Inbox className="w-5 h-5 mb-1" aria-hidden="true" />
            <span className="sr-only">Requests</span>
          </Link>

          <Link href="/reports" className={cn("flex flex-col items-center justify-center w-16 h-full text-xs font-medium transition-colors touch-target", location.startsWith('/reports') ? "text-primary" : "text-muted-foreground")} data-testid="link-nav-reports" aria-label="Reports" aria-current={location.startsWith('/reports') ? 'page' : undefined}>
            <FileBarChart className="w-5 h-5 mb-1" aria-hidden="true" />
            <span className="sr-only">Reports</span>
          </Link>

          {/* FAB slot — takes space of a nav item, button floats above */}
          <div className="flex flex-col items-center justify-center w-16 h-full" aria-hidden="true">
            <Link href="/entry/new" className="flex items-center justify-center w-14 h-14 -translate-y-1/2 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-all active:translate-y-0 touch-target" data-testid="link-nav-new-entry" aria-label="New journal entry">
              <Plus className="w-6 h-6" aria-hidden="true" />
              <span className="sr-only">New Entry</span>
            </Link>
          </div>

          <Link href="/settings" className={cn("flex flex-col items-center justify-center w-16 h-full text-xs font-medium transition-colors touch-target", location.startsWith('/settings') ? "text-primary" : "text-muted-foreground")} data-testid="link-nav-settings" aria-label="Settings" aria-current={location.startsWith('/settings') ? 'page' : undefined}>
            <Settings className="w-5 h-5 mb-1" aria-hidden="true" />
            <span className="sr-only">Settings</span>
          </Link>
        </div>
      </nav>

      {/* Desktop Sidebar */}
      <div className="hidden md:flex flex-col w-64 h-screen fixed left-0 top-0 border-r border-border bg-sidebar text-sidebar-foreground">
        <div className="p-6 border-b border-border">
          <h1 className="text-xl font-bold tracking-tight text-sidebar-primary">Notary Journal</h1>
        </div>

        <div className="flex-1 py-6 px-4 flex flex-col gap-2">
          <div className="mb-6">
            <Link href="/entry/new" className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground font-medium rounded-lg h-12 shadow-sm hover:opacity-90 transition-opacity" data-testid="link-nav-new-entry-desktop">
              <Plus className="w-5 h-5" />
              New Entry
            </Link>
          </div>

          <div className="space-y-1">
            {navItems.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md font-medium transition-colors",
                  location === item.href || (item.href !== '/' && location.startsWith(item.href))
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"
                )}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            ))}
          </div>

          <div className="mt-auto space-y-1">
            {secondaryNavItems.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md font-medium transition-colors",
                  location.startsWith(item.href)
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"
                )}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
