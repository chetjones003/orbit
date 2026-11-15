import { useEffect, useState } from 'react';
import type { MergeMethod, PullActions as PullActionsData, WorkflowRun } from '../../../shared/issues';

const METHOD_LABELS: Record<MergeMethod, string> = {
  merge: 'Merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge'
};

export interface PullActionsPanelProps {
  repoFullName: string;
  number: number;
  /** Called after a change, so the pull request's details can be reloaded. */
  onChanged: () => void;
}

/**
 * The write actions for one pull request: merge, auto-merge, draft state, and workflow re-runs. Every
 * action is pinned to the head commit the panel loaded, so a head that moved since is refused, not merged.
 */
export function PullActionsPanel({ repoFullName, number, onChanged }: PullActionsPanelProps) {
  const [actions, setActions] = useState<PullActionsData | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [method, setMethod] = useState<MergeMethod | ''>('');
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.orbit.pulls.actions(repoFullName, number),
      window.orbit.pulls.runs(repoFullName, number)
    ]).then(
      ([nextActions, nextRuns]) => {
        if (cancelled) return;
        setActions(nextActions);
        setRuns(nextRuns);
        setMethod((current) =>
          current !== '' && nextActions.allowedMergeMethods.includes(current)
            ? current
            : (nextActions.allowedMergeMethods[0] ?? '')
        );
        setDeleteBranch(nextActions.deleteBranchOnMerge && nextActions.headInRepo);
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the actions.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number, loadVersion]);

  const reload = (): void => {
    setLoadVersion((version) => version + 1);
    onChanged();
  };

  /**
   * Runs one action and reloads afterwards. `work` returns the status to show, or null when it reported
   * its own outcome (a stale head is shown as an error, never as success).
   */
  const run = async (work: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const message = await work();
      if (message !== null) setStatus(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That action failed. Try again.');
    } finally {
      setBusy(false);
      reload();
    }
  };

  const STALE_MESSAGE = 'This pull request changed since you opened it. Review the new head, then try again.';

  const merge = (): Promise<void> => {
    if (!actions || method === '') return Promise.resolve();
    return run(async () => {
      const result = await window.orbit.pulls.merge(repoFullName, number, {
        method,
        deleteBranch,
        expectedHeadSha: actions.headSha
      });
      if (result.kind === 'new-commits') {
        setError(STALE_MESSAGE);
        return null;
      }
      if (result.branchDeleted) return `Merged and deleted ${actions.headRef}.`;
      return deleteBranch ? 'Merged. The branch was not deleted.' : 'Merged.';
    });
  };

  const toggleAutoMerge = (enabled: boolean): Promise<void> => {
    if (!actions) return Promise.resolve();
    return run(async () => {
      const result = await window.orbit.pulls.setAutoMerge(repoFullName, number, {
        enabled,
        ...(enabled && method !== '' ? { method } : {}),
        expectedHeadSha: actions.headSha
      });
      if (result.kind === 'new-commits') {
        setError(STALE_MESSAGE);
        return null;
      }
      return enabled ? 'Auto-merge is on.' : 'Auto-merge is off.';
    });
  };

  const toggleDraft = (): Promise<void> => {
    if (!actions) return Promise.resolve();
    return run(async () => {
      const result = await window.orbit.pulls.setDraft(repoFullName, number, !actions.draft, actions.headSha);
      if (result.kind === 'new-commits') {
        setError(STALE_MESSAGE);
        return null;
      }
      return actions.draft ? 'Marked ready for review.' : 'Converted to draft.';
    });
  };

  const rerun = (runId: number, name: string, mode: 'all' | 'failed'): Promise<void> =>
    run(async () => {
      if (!actions) return null;
      const result = await window.orbit.pulls.rerun(repoFullName, runId, mode, actions.headSha);
      if (result.kind === 'new-commits') {
        setError(STALE_MESSAGE);
        return null;
      }
      return `Re-run requested for ${name}.`;
    });

  if (error && !actions) {
    return (
      <p role="alert" className="session-notice">
        {error}
      </p>
    );
  }
  if (!actions) {
    return <p className="empty-state">Loading actions…</p>;
  }

  const canMerge =
    !busy &&
    !actions.draft &&
    !actions.merged &&
    actions.state === 'open' &&
    actions.allowedMergeMethods.length > 0;

  return (
    <section aria-label="Pull request actions" className="pull-actions">
      <h3>Actions</h3>
      <div className="pull-actions-draft">
        <button className="secondary-action" disabled={busy} onClick={() => void toggleDraft()}>
          {actions.draft ? 'Mark ready for review' : 'Convert to draft'}
        </button>
      </div>

      {actions.merged || actions.state !== 'open' ? (
        <p>{actions.merged ? 'Merged.' : 'Closed.'}</p>
      ) : (
        <div className="pull-actions-merge">
          <label className="field">
            <span>Merge method</span>
            <select
              aria-label="Merge method"
              value={method}
              disabled={busy || actions.allowedMergeMethods.length === 0}
              onChange={(event) => setMethod(event.target.value as MergeMethod)}
            >
              {actions.allowedMergeMethods.length === 0 && (
                <option value="">No merge method is allowed</option>
              )}
              {actions.allowedMergeMethods.map((allowed) => (
                <option key={allowed} value={allowed}>
                  {METHOD_LABELS[allowed]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <input
              type="checkbox"
              checked={deleteBranch}
              disabled={busy || !actions.headInRepo}
              onChange={(event) => setDeleteBranch(event.target.checked)}
            />
            <span>Delete branch after merge</span>
          </label>
          <button className="primary-action" disabled={!canMerge} onClick={() => void merge()}>
            Merge
          </button>
          {actions.draft && <p>Mark the pull request ready for review before merging.</p>}
          {actions.autoMergeMethod ? (
            <button className="secondary-action" disabled={busy} onClick={() => void toggleAutoMerge(false)}>
              Disable auto-merge
            </button>
          ) : (
            <button
              className="secondary-action"
              disabled={busy || !actions.allowAutoMerge || method === ''}
              onClick={() => void toggleAutoMerge(true)}
            >
              Enable auto-merge
            </button>
          )}
          {!actions.allowAutoMerge && <p>Auto-merge is not allowed in this repo.</p>}
        </div>
      )}

      <h3>Workflow runs</h3>
      {runs.length === 0 ? (
        <p>No workflow runs for this commit.</p>
      ) : (
        <ul className="pull-actions-runs">
          {runs.map((workflow) => (
            <li key={workflow.id}>
              {workflow.name}: {workflow.conclusion ?? workflow.status}{' '}
              <button
                className="secondary-action"
                disabled={busy}
                aria-label={`Re-run failed jobs for ${workflow.name}`}
                onClick={() => void rerun(workflow.id, workflow.name, 'failed')}
              >
                Re-run failed jobs
              </button>{' '}
              <button
                className="secondary-action"
                disabled={busy}
                aria-label={`Re-run all jobs for ${workflow.name}`}
                onClick={() => void rerun(workflow.id, workflow.name, 'all')}
              >
                Re-run all jobs
              </button>
            </li>
          ))}
        </ul>
      )}

      {status && (
        <p role="status" className="session-notice">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="session-notice">
          {error}
        </p>
      )}
    </section>
  );
}
