import { useEffect, useState } from 'react';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger
} from '@ui-sdk/react/menu';
import type { MergeMethod, PullActions as PullActionsData } from '../../../shared/issues';
import { Modal } from '../chrome/Modal';
import { Icon } from '../icons';
import { subscribeItemsRefresh } from '../shell/list-events';
import type { MergeReadiness } from './merge-readiness';

const METHOD_LABELS: Record<MergeMethod, string> = {
  merge: 'Merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge'
};

/** The button text for each method: what pressing it does. */
const METHOD_ACTIONS: Record<MergeMethod, string> = {
  merge: 'Merge',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge'
};

const METHOD_HINTS: Record<MergeMethod, string> = {
  merge: 'All commits are added to the base branch with a merge commit.',
  squash: 'All commits are combined into one commit on the base branch.',
  rebase: 'All commits are rebased and added to the base branch.'
};

const ALL_METHODS: MergeMethod[] = ['merge', 'squash', 'rebase'];

const STALE_MESSAGE = 'This pull request changed since you opened it. Review the new head, then try again.';

export interface PullActionsState {
  actions: PullActionsData | null;
  method: MergeMethod | '';
  setMethod: (method: MergeMethod) => void;
  deleteBranch: boolean;
  setDeleteBranch: (value: boolean) => void;
  busy: boolean;
  status: string | null;
  error: string | null;
  merge: () => Promise<void>;
  toggleAutoMerge: (enabled: boolean) => Promise<void>;
  toggleDraft: () => Promise<void>;
}

/**
 * Merge, auto-merge, and draft state for one pull request. Every action is pinned to the head commit that was
 * loaded, so a head that moved since is refused, not merged.
 */
export function usePullActions(
  repoFullName: string,
  number: number,
  onChanged: () => void
): PullActionsState {
  const [actions, setActions] = useState<PullActionsData | null>(null);
  const [method, setMethod] = useState<MergeMethod | ''>('');
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => subscribeItemsRefresh(() => setLoadVersion((version) => version + 1)), []);

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
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Could not load the merge options.');
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

  const merge = (): Promise<void> => {
    const current = actions;
    const chosen = method;
    if (!current || chosen === '') return Promise.resolve();
    return run(async () => {
      const result = await window.orbit.pulls.merge(repoFullName, number, {
        method: chosen,
        deleteBranch,
        expectedHeadSha: current.headSha
      });
      if (result.kind === 'new-commits') {
        setError(STALE_MESSAGE);
        return null;
      }
      if (result.branchDeleted) return `Merged and deleted ${current.headRef}.`;
      return deleteBranch ? 'Merged. The branch was not deleted.' : 'Merged.';
    });
  };

  const toggleAutoMerge = (enabled: boolean): Promise<void> => {
    if (!actions) return Promise.resolve();
    const headSha = actions.headSha;
    return run(async () => {
      const result = await window.orbit.pulls.setAutoMerge(repoFullName, number, {
        enabled,
        ...(enabled && method !== '' ? { method } : {}),
        expectedHeadSha: headSha
      });
      if (result.kind === 'new-commits') {
        setError(STALE_MESSAGE);
        return null;
      }
      return enabled ? 'Auto-merge is on. It merges once the checks pass.' : 'Auto-merge is off.';
    });
  };

  const toggleDraft = (): Promise<void> => {
    if (!actions) return Promise.resolve();
    const { draft, headSha } = actions;
    return run(async () => {
      const result = await window.orbit.pulls.setDraft(repoFullName, number, !draft, headSha);
      if (result.kind === 'new-commits') {
        setError(STALE_MESSAGE);
        return null;
      }
      return draft ? 'Marked ready for review.' : 'Converted to draft.';
    });
  };

  return {
    actions,
    method,
    setMethod,
    deleteBranch,
    setDeleteBranch,
    busy,
    status,
    error,
    merge,
    toggleAutoMerge,
    toggleDraft
  };
}

/**
 * A split button for a section header: the main half merges with the chosen method, after a confirmation; the
 * arrow opens the merge options (method, branch cleanup, auto-merge, draft).
 */
export function MergeSplitButton({
  state,
  readiness
}: {
  state: PullActionsState;
  /** Colours the button: green when ready, neutral when only optional items are open, red when blocked. */
  readiness?: MergeReadiness;
}) {
  const { actions, method, busy } = state;
  const [confirming, setConfirming] = useState(false);

  if (!actions) {
    return (
      <span className="merge-split loading" aria-busy="true">
        Loading…
      </span>
    );
  }
  if (actions.merged || actions.state !== 'open') {
    return <span className="merge-split-note">{actions.merged ? 'Merged' : 'Closed'}</span>;
  }

  const allowed = actions.allowedMergeMethods;
  const canMerge = !busy && !actions.draft && method !== '';
  const label = method === '' ? 'Merge' : METHOD_ACTIONS[method];
  const disabledReason = actions.draft
    ? 'Mark the pull request ready for review before merging.'
    : allowed.length === 0
      ? 'No merge method is allowed in this repo.'
      : undefined;

  const onAction = (value: string): void => {
    if (value === 'auto-on') void state.toggleAutoMerge(true);
    else if (value === 'auto-off') void state.toggleAutoMerge(false);
    else if (value === 'draft') void state.toggleDraft();
  };

  return (
    <div className={`merge-split ${readiness?.tone ?? 'caution'}`} data-tone={readiness?.tone ?? 'caution'}>
      <button
        type="button"
        className="merge-split-main"
        disabled={!canMerge}
        title={
          disabledReason ??
          (readiness && readiness.reasons.length > 0 ? readiness.reasons.join(' · ') : undefined)
        }
        onClick={() => setConfirming(true)}
      >
        <Icon name="merge" size={14} />
        {label}
      </button>
      <Menu onAction={onAction}>
        <MenuTrigger className="merge-split-toggle" aria-label="Merge options" disabled={busy}>
          <Icon name="chevronDown" size={14} />
        </MenuTrigger>
        <MenuContent
          className="merge-menu"
          aria-label="Merge options"
          side="bottom"
          align="end"
          sideOffset={6}
        >
          <div className="merge-menu-label">Merge method</div>
          <MenuRadioGroup<MergeMethod>
            value={method === '' ? undefined : method}
            onValueChange={(value) => state.setMethod(value)}
          >
            {ALL_METHODS.map((candidate) => {
              const enabled = allowed.includes(candidate);
              return (
                <MenuRadioItem
                  key={candidate}
                  value={candidate}
                  disabled={!enabled}
                  closeOnSelect
                  className="merge-menu-item merge-menu-method"
                >
                  <span className="merge-menu-check" aria-hidden="true">
                    {method === candidate && <Icon name="check" size={13} />}
                  </span>
                  <span className="merge-menu-text">
                    <strong>{METHOD_LABELS[candidate]}</strong>
                    <span>{enabled ? METHOD_HINTS[candidate] : 'Not allowed in this repo.'}</span>
                  </span>
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
          <MenuSeparator className="menu-separator" />
          <MenuCheckboxItem
            value="delete-branch"
            checked={state.deleteBranch}
            disabled={!actions.headInRepo}
            closeOnSelect={false}
            onCheckedChange={(checked) => state.setDeleteBranch(checked)}
            className="merge-menu-item"
          >
            <span className="merge-menu-check" aria-hidden="true">
              {state.deleteBranch && <Icon name="check" size={13} />}
            </span>
            <span className="merge-menu-text">
              <strong>Delete branch after merge</strong>
            </span>
          </MenuCheckboxItem>
          <MenuSeparator className="menu-separator" />
          {actions.autoMergeMethod ? (
            <MenuItem value="auto-off" className="merge-menu-item">
              <span className="merge-menu-check" aria-hidden="true" />
              <span className="merge-menu-text">
                <strong>Disable auto-merge</strong>
              </span>
            </MenuItem>
          ) : (
            <MenuItem
              value="auto-on"
              disabled={!actions.allowAutoMerge || method === ''}
              className="merge-menu-item"
            >
              <span className="merge-menu-check" aria-hidden="true" />
              <span className="merge-menu-text">
                <strong>Enable auto-merge</strong>
                <span>
                  {actions.allowAutoMerge
                    ? 'Merge automatically once the checks pass.'
                    : 'Not allowed in this repo.'}
                </span>
              </span>
            </MenuItem>
          )}
          <MenuItem value="draft" className="merge-menu-item">
            <span className="merge-menu-check" aria-hidden="true" />
            <span className="merge-menu-text">
              <strong>{actions.draft ? 'Mark ready for review' : 'Convert to draft'}</strong>
            </span>
          </MenuItem>
        </MenuContent>
      </Menu>
      {confirming && method !== '' && (
        <Modal
          title={`${METHOD_LABELS[method]}?`}
          onClose={() => setConfirming(false)}
          className="merge-confirm-modal"
        >
          <p className="detail-muted merge-confirm-description">
            {METHOD_HINTS[method]}
            {state.deleteBranch ? ` The ${actions.headRef} branch is deleted afterwards.` : ''}
          </p>
          <div className="merge-confirm-actions">
            <button type="button" className="secondary-action" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={() => {
                setConfirming(false);
                void state.merge();
              }}
            >
              {label}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** What the last merge action did, or why it failed. Shown in the section body under the header. */
export function PullActionNotices({ state }: { state: PullActionsState }) {
  const { actions, status, error } = state;
  return (
    <>
      {actions?.autoMergeMethod && !actions.merged && (
        <p className="detail-muted merge-auto-note">
          Auto-merge is on ({METHOD_LABELS[actions.autoMergeMethod]}). It merges once the checks pass.
        </p>
      )}
      {actions?.draft && actions.state === 'open' && (
        <p className="detail-muted">Mark the pull request ready for review before merging.</p>
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
    </>
  );
}
