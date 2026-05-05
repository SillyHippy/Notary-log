import { useEffect } from 'react';

/**
 * Global keyboard shortcuts. Mounted once in App.tsx.
 *
 * - `/` — focus the first visible search input
 *   (dashboard or journal-list, whichever is on screen)
 *
 * All shortcuts are suppressed while the user is typing in an input,
 * textarea, select, or contentEditable element.
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when the user is already in a form field.
      const tag = (e.target as HTMLElement).tagName;
      const editable = (e.target as HTMLElement).isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) {
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        // Find the first search input on the current page by data-testid
        const searchInput =
          document.querySelector<HTMLInputElement>('[data-testid="input-journal-search"]') ??
          document.querySelector<HTMLInputElement>('[data-testid="input-search-dashboard"]');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
