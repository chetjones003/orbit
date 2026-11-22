import { useEffect, useState } from 'react';
import type { PullDetail } from '../../../shared/issues';
import { subscribeItemsRefresh } from '../shell/list-events';
import { mergeReadiness } from './merge-readiness';
import { Icon } from '../icons';
import { MergeSplitButton, PullActionNotices, usePullActions } from './PullActions';
import { SectionHead } from './SectionHead';

export interface PullStatusCardProps {
  repoFullName: string;
  number: number;
  pullDetail: PullDetail;
  /** Called after a merge, auto-merge, or draft change, so the details can be reloaded. */
  onChanged: () => void;
  onResolve: () => void;
}

/** A pull request's readiness at a glance: draft and mergeability, its branches, and the merge button. */
export function PullStatusCard({
  repoFullName,
  number,
  pullDetail,
  onChanged,
  onResolve
}: PullStatusCardProps) {
  const merge = usePullActions(repoFullName, number, onChanged);
  const unresolvedThreads = useUnresolvedThreads(repoFullName, number);
  const { summary } = pullDetail;
  const open = summary.state === 'open' && !pullDetail.merged;
  const readiness = mergeReadiness({
    draft: merge.actions?.draft ?? summary.draft,
    mergeable: pullDetail.mergeable,
    mergeableState: pullDetail.mergeableState,
    checks: pullDetail.checks,
    unresolvedThreads,
    allowedMethods: merge.actions?.allowedMergeMethods.length ?? 1
  });

  return (
    <section aria-label="Pull request details" className="detail-card pr-summary">
      <SectionHead icon="pull" title="Status">
        <MergeSplitButton state={merge} readiness={readiness} />
      </SectionHead>
      <div className="pr-status-row">
        <span className={`pr-pill ${summary.draft ? 'draft' : 'ready'}`}>
          {summary.draft ? 'Draft' : 'Ready for review'}
        </span>
        <span
          className={`pr-pill ${pullDetail.mergeable === null ? 'checking' : pullDetail.mergeable ? 'ok' : 'bad'}`}
        >
          {pullDetail.mergeable === null
            ? 'Checking mergeability'
            : pullDetail.mergeable
              ? `Mergeable · ${pullDetail.mergeableState}`
              : `Has conflicts with ${summary.baseRef}`}
        </span>
      </div>
      {open && readiness.reasons.length > 0 && (
        <ul className={`merge-reasons ${readiness.tone}`} aria-label="Before merging">
          {readiness.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <div className="pr-branches">
        <code>{summary.headRef}</code>
        <Icon name="chevronRight" size={14} />
        <code>{summary.baseRef}</code>
      </div>
      {pullDetail.mergeable === false && summary.state === 'open' && (
        <div className="pr-conflicts">
          <p className="detail-muted">
            Both branches changed the same lines. GitHub cannot merge this until they are resolved, and checks
            may not run on this commit.
          </p>
          <button type="button" className="primary-action" onClick={onResolve}>
            Resolve conflicts
          </button>
        </div>
      )}
      <PullActionNotices state={merge} />
    </section>
  );
}

/** How many review threads are still unresolved, or null while they load. Reloads on a refresh. */
function useUnresolvedThreads(repoFullName: string, number: number): number | null {
  const [count, setCount] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeItemsRefresh(() => setVersion((current) => current + 1)), []);
  useEffect(() => {
    let cancelled = false;
    window.orbit.pulls.threads(repoFullName, number).then(
      (page) => {
        if (!cancelled) setCount(page.threads.filter((thread) => !thread.isResolved).length);
      },
      () => {
        // Unknown counts as zero: thread state is optional, and a failed read should not paint the button red.
        if (!cancelled) setCount(0);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number, version]);
  return count;
}
