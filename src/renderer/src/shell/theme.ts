import { useEffect, useState } from 'react';
import type { ColorScheme } from '../../../shared/themes';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** True while Windows uses its dark app theme. Electron follows the OS colour mode here. */
export function useSystemPrefersDark(): boolean {
  const [dark, setDark] = useState(() => readPrefersDark());

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (): void => setDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return dark;
}

function readPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** The light or dark variant that shows: System follows Windows, the others are fixed. */
export function resolveColorScheme(scheme: ColorScheme, systemPrefersDark: boolean): 'light' | 'dark' {
  if (scheme === 'system') return systemPrefersDark ? 'dark' : 'light';
  return scheme;
}
