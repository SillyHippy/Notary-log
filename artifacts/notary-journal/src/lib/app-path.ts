/** App base path from Vite (e.g. "" or "/notary"). */
export function appBasePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, '') || '';
}

/** In-app route path with base prefix (for window.location or absolute URLs). */
export function appPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = appBasePath();
  return base ? `${base}${normalized}` : normalized;
}

/** Full URL for an in-app route on the current origin. */
export function appOriginPath(path: string): string {
  return `${window.location.origin}${appPath(path)}`;
}

/** Strip the Vite base prefix from a browser pathname (e.g. /notary/intake → /intake). */
export function relativeAppPath(pathname: string): string {
  const base = appBasePath();
  if (base && (pathname === base || pathname.startsWith(`${base}/`))) {
    const rest = pathname.slice(base.length) || '/';
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return pathname;
}

/** Public routes that must work without PIN (client intake + Cal book). */
export function isPublicAppPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const rel = relativeAppPath(p);
  return (
    rel === '/intake' ||
    rel.startsWith('/intake/') ||
    rel === '/book' ||
    rel.startsWith('/book/')
  );
}

/** Same-origin API path respecting base (e.g. /notary/api/intake behind reverse proxy). */
export function apiPath(path: string): string {
  return appPath(path.startsWith('/') ? path : `/${path}`);
}
