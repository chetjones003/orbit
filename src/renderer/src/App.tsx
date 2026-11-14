import { useEffect, useState } from 'react';
import type { AppInfo } from '../../shared/ipc';

/**
 * Scaffold shell. It proves the typed preload bridge works and marks the page
 * ready for the packaged smoke test.
 */
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.orbit.app.getInfo().then((next) => {
      if (cancelled) return;
      setInfo(next);
      document.documentElement.dataset.orbitReady = 'true';
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-3 bg-base-200 p-6">
      <h1 className="text-3xl font-bold">Orbit</h1>
      <p className="text-base-content/70">
        {info ? `${info.name} ${info.version} on ${info.platform}` : 'Starting…'}
      </p>
    </main>
  );
}
