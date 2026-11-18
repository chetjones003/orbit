import type { ConflictSet } from '../../../shared/conflicts';

/** How long a loaded conflict set is reused. Commits still check both heads, so a set that has gone stale cannot land. */
const REUSE_MS = 60_000;

interface Entry {
  loadedAt: number;
  load: Promise<ConflictSet>;
}

const entries = new Map<string, Entry>();

const keyOf = (repo: string, number: number): string => `${repo}#${number}`;

/** The conflicts of a pull request. A set loaded in the last minute is reused. A failed load is not kept. */
export function loadConflicts(repo: string, number: number): Promise<ConflictSet> {
  const key = keyOf(repo, number);
  const hit = entries.get(key);
  if (hit && Date.now() - hit.loadedAt < REUSE_MS) return hit.load;
  const load = window.orbit.pulls.conflicts(repo, number);
  entries.set(key, { loadedAt: Date.now(), load });
  load.catch(() => {
    if (entries.get(key)?.load === load) entries.delete(key);
  });
  return load;
}

/** Starts loading a pull request's conflicts before anyone opens the resolver. */
export function prefetchConflicts(repo: string, number: number): void {
  loadConflicts(repo, number).catch(() => undefined);
}

/** Drops a pull request's loaded conflicts, so the next open reads GitHub again. */
export function forgetConflicts(repo: string, number: number): void {
  entries.delete(keyOf(repo, number));
}

/** Empties the cache. Tests use it so one test's set is not reused by the next. */
export function resetConflictCache(): void {
  entries.clear();
}
