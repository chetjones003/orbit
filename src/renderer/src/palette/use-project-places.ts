import { useEffect, useState } from 'react';
import type { CustomViewDefinition } from '../../../shared/custom-views';
import type { ProjectSummary } from '../../../shared/projects';

export interface ProjectPlaces {
  projects: ProjectSummary[];
  customViews: CustomViewDefinition[];
}

const NONE: ProjectPlaces = { projects: [], customViews: [] };

/**
 * The projects and custom views the palette can jump to. They load the first time the palette opens and refresh
 * quietly on later opens, so what was loaded shows at once. A failed refresh keeps the last list.
 */
export function useProjectPlaces(signedIn: boolean, paletteOpen: boolean): ProjectPlaces {
  const [places, setPlaces] = useState<ProjectPlaces>(NONE);

  useEffect(() => {
    if (!signedIn) {
      setPlaces(NONE);
      return undefined;
    }
    if (!paletteOpen) return undefined;
    let cancelled = false;
    void Promise.resolve()
      .then(() => window.orbit.projects.list())
      .then(
        ({ projects }) => {
          if (!cancelled) setPlaces((current) => ({ ...current, projects }));
        },
        () => undefined
      );
    // Read fresh each time: the Projects view saves custom views straight to settings.
    void Promise.resolve()
      .then(() => window.orbit.settings.get())
      .then(
        ({ customViews }) => {
          if (!cancelled) setPlaces((current) => ({ ...current, customViews }));
        },
        () => undefined
      );
    return () => {
      cancelled = true;
    };
  }, [signedIn, paletteOpen]);

  return places;
}
