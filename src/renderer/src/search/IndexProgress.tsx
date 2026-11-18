import type { IndexStatus } from '../../../shared/search';

/** A small line in the bottom corner while the search index is reading GitHub. Nothing shows once it is done. */
export function IndexProgress({ status }: { status: IndexStatus | null }) {
  if (!status?.syncing) return null;
  const label =
    status.reposTotal > 0
      ? `Indexing search · ${status.reposRead} of ${status.reposTotal} repos`
      : 'Indexing search…';
  return (
    <div className="index-progress" role="status" aria-live="polite">
      <span className="ci-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
