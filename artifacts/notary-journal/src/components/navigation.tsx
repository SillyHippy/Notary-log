import { Link, useLocation } from 'wouter';
import { LayoutDashboard, BookOpen, Plus, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Navigation() {
  const [location] = useLocation();

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/journal', label: 'Journal', icon: BookOpen },
  ];

  const secondaryNavItems = [
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <>
      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border pb-safe">
        <div className="flex items-center justify-around h-16 px-2 relative">
          <Link href="/" className={cn("flex flex-col items-center justify-center w-16 h-full text-xs font-medium transition-colors", location === '/' ? "text-primary" : "text-muted-foreground")} data-testid="link-nav-dashboard">
            <LayoutDashboard className="w-5 h-5 mb-1" />
            <span className="sr-only">Dashboard</span>
          </Link>
          
          <Link href="/journal" className={cn("flex flex-col items-center justify-center w-16 h-full text-xs font-medium transition-colors", location.startsWith('/journal') ? "text-primary" : "text-muted-foreground")} data-testid="link-nav-journal">
            <BookOpen className="w-5 h-5 mb-1" />
            <span className="sr-only">Journal</span>
          </Link>
          
          <div className="flex-1 flex justify-center -mt-6">
            <Link href="/entry/new" className="flex items-center justify-center w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-all hover:-translate-y-1 active:translate-y-0" data-testid="link-nav-new-entry">
              <Plus className="w-6 h-6" />
              <span className="sr-only">New Entry</span>
            </Link>
          </div>
          
          <Link href="/settings" className={cn("flex flex-col items-center justify-center w-16 h-full text-xs font-medium transition-colors", location.startsWith('/settings') ? "text-primary" : "text-muted-foreground")} data-testid="link-nav-settings">
            <Settings className="w-5 h-5 mb-1" />
            <span className="sr-only">Settings</span>
          </Link>
        </div>
      </div>

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
