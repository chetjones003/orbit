import { useEffect, useState } from 'react';
import type { MotionSetting } from '../../../shared/ipc';

/**
 * 'full' slides and grows the side panels. 'fade' only fades them, which is what Windows' "animation effects off"
 * asks for: no sliding or growing, but a change still reads as a change.
 */
export type MotionMode = 'full' | 'fade';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** True while Windows has animations off. Electron reports that as reduced motion. */
export function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => readReducedMotion());

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

function readReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** The motion the panels use: the setting wins when it asks for always; otherwise Windows decides. */
export function motionMode(setting: MotionSetting | undefined, systemReducedMotion: boolean): MotionMode {
  return setting !== 'always' && systemReducedMotion ? 'fade' : 'full';
}
