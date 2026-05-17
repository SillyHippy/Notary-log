import * as React from 'react';

/**
 * Tracks the browser's online/offline status in real time.
 * Returns `true` when connected, `false` when offline.
 * Initial value comes from `navigator.onLine` at render time.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = React.useState(navigator.onLine);

  React.useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return online;
}
