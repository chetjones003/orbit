import { useEffect, useState } from 'react';
import type { MergeMethod, PullActions as PullActionsData } from '../../../shared/issues';
import { Modal } from '../chrome/Modal';
import { SectionHead } from './SectionHead';

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

const STALE_MESSAGE = 'This pull request changed since you opened it. Review the new head, then try again.';

/**
 * Merge, auto-merge, and draft state for one pull request. Every action is pinned to the head commit the panel
 * loaded, so a head that moved since is refused, not merged. Workflow runs live in the CI section.
 */
export function PullActionsPanel({ repoFullName, number, onChanged }: PullActionsPanelProps) {
  const [actions, setActions] = useState<PullActionsData | null>(null);
  const [method, setMethod] = useState<MergeMethod | ''>('');
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [confirmMerge, setConfirmMerge] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.orbit.pulls.actions(repoFullName, number).then(
      (next) => {
        if (cancelled) return;
        setActions(next);
        setMethod((current) =>
          current !== '' && next.allowedMergeMethods.includes(current)
            ? current
            : (next.allowedMergeMethods[0] ?? '')
        );
        setDeleteBranch(next.deleteBranchOnMerge && next.headInRepo);
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the actions.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number, loadVersion]);

  /** Runs one action and reloads afterwards. A stale head is an error, never a success. */
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
      setLoadVersion((version) => version + 1);
      onChanged();
    }
  };

  const merge = (): void => {
    if (!actions || method === '') return;
    setConfirmMerge(true);
  };

  const confirmMergeAction = async (): Promise<void> => {
    const currentActions = actions;
    const currentMethod = method;
    if (!currentActions || currentMethod === '') return;
    setConfirmMerge(false);
    return run(async () => {
      const result = await window.orbit.pulls.merge(repoFullName, number, {
        method: currentMethod,
        deleteBranch,
        expectedHeadSha: currentActions.headSha
      });
      if (result.kind === 'new-commits') {
        setError(STALE_MESSAGE);
        return null;
      }
      if (result.branchDeleted) return `Merged and deleted ${currentActions.headRef}.`;
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

  if (error && !actions) {
    return (
      <p role="alert" className="session-notice">
        {error}
      </p>
    );
  }
  if (!actions) {
    return <p className="detail-muted">Loading actions…</p>;
  }

  const canMerge =
    !busy &&
    !actions.draft &&
    !actions.merged &&
    actions.state === 'open' &&
    actions.allowedMergeMethods.length > 0;
  const open = !actions.merged && actions.state === 'open';

  return (
    <section aria-label="Pull request actions" className="detail-card pull-actions">
      <SectionHead icon="merge" title="Merge">
        {open && (
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={() => void toggleDraft()}
          >
            {actions.draft ? 'Mark ready for review' : 'Convert to draft'}
          </button>
        )}
      </SectionHead>
      {!open ? (
        <p className="detail-muted">
          {actions.merged ? 'This pull request is merged.' : 'This pull request is closed.'}
        </p>
      ) : (
        <>
          <div className="merge-row">
            <label className="merge-field">
              <span>Method</span>
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
            <label className="merge-check">
              <input
                type="checkbox"
                checked={deleteBranch}
                disabled={busy || !actions.headInRepo}
                onChange={(event) => setDeleteBranch(event.target.checked)}
              />
              <span>Delete branch after merge</span>
            </label>
          </div>
          <button
            type="button"
            className="primary-action merge-button"
            disabled={!canMerge}
            onClick={() => void merge()}
          >
            Merge
          </button>
          {actions.draft && (
            <p className="detail-muted">Mark the pull request ready for review before merging.</p>
          )}
          <div className="merge-auto">
            {actions.autoMergeMethod ? (
              <>
                <span className="merge-auto-note">Auto-merge is on. It merges once the checks pass.</span>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={busy}
                  onClick={() => void toggleAutoMerge(false)}
                >
                  Disable auto-merge
                </button>
              </>
            ) : (
              <>
                <span className="merge-auto-note">
                  {actions.allowAutoMerge
                    ? 'Merge automatically once the checks pass.'
                    : 'Auto-merge is not allowed in this repo.'}
                </span>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={busy || !actions.allowAutoMerge || method === ''}
                  onClick={() => void toggleAutoMerge(true)}
                >
                  Enable auto-merge
                </button>
              </>
            )}
          </div>
        </>
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
      {confirmMerge && (
        <Modal
          title="Merge this pull request?"
          onClose={() => setConfirmMerge(false)}
          className="merge-confirm-modal"
        >
          <p className="detail-muted merge-confirm-description">
            {deleteBranch
              ? 'This merges the pull request into its base branch and deletes the head branch.'
              : 'This merges the pull request into its base branch.'}
          </p>
          <div className="merge-confirm-actions">
            <button type="button" className="secondary-action" onClick={() => setConfirmMerge(false)}>
              Cancel
            </button>
            <button type="button" className="primary-action" onClick={() => void confirmMergeAction()}>
              Merge
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
