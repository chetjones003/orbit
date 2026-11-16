import type { IssueSummary } from '../../../shared/issues';

/**
 * Tells the side lists about changes made elsewhere in the app, so they stay in step without a reload. An edited item
 * is patched in its row; a newly created item makes its repository reload its first page.
 */

export interface ItemChange {
  repoFullName: string;
  number: number;
  summary: IssueSummary;
}

type ItemListener = (change: ItemChange) => void;
type CreatedListener = (repoFullName: string) => void;

const itemListeners = new Set<ItemListener>();
const createdListeners = new Set<CreatedListener>();

export function publishItemChange(change: ItemChange): void {
  for (const listener of itemListeners) listener(change);
}

export function publishItemCreated(repoFullName: string): void {
  for (const listener of createdListeners) listener(repoFullName);
}

/** Calls `listener` for each change. Returns the function that stops listening. */
export function subscribeItemChanges(listener: ItemListener): () => void {
  itemListeners.add(listener);
  return () => {
    itemListeners.delete(listener);
  };
}

/** Calls `listener` with the repository name of each newly created item. Returns the function that stops listening. */
export function subscribeItemCreated(listener: CreatedListener): () => void {
  createdListeners.add(listener);
  return () => {
    createdListeners.delete(listener);
  };
}
