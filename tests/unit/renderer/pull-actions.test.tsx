// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PullActionsPanel } from '../../../src/renderer/src/issues/PullActions';
import { NewPullForm } from '../../../src/renderer/src/issues/NewPullForm';
import type { PullActions, WorkflowRun } from '../../../src/shared/issues';

function actions(overrides: Partial<PullActions> = {}): PullActions {
  return {
    headSha: 'head-1',
    headRef: 'feature',
    headInRepo: true,
    draft: false,
    merged: false,
    state: 'open',
    allowedMergeMethods: ['merge', 'squash'],
    allowAutoMerge: true,
    autoMergeMethod: null,
    deleteBranchOnMerge: false,
    ...overrides
  };
}

const RUNS: WorkflowRun[] = [
  {
    id: 11,
    name: 'CI',
    status: 'completed',
    conclusion: 'failure',
    htmlUrl: 'https://github.com/x/y/actions/runs/11'
  }
];

function installApi(overrides: Record<string, unknown> = {}) {
  const pulls = {
    actions: vi.fn(async () => actions()),
    runs: vi.fn(async () => RUNS),
    merge: vi.fn(async () => ({ kind: 'merged', sha: 'merge-sha', branchDeleted: false })),
    setAutoMerge: vi.fn(async () => ({ kind: 'changed' })),
    setDraft: vi.fn(async () => undefined),
    rerun: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ number: 9 })),
    branches: vi.fn(async () => ['main', 'feature']),
    ...overrides
  };
  Object.defineProperty(window, 'orbit', {
    configurable: true,
    value: { pulls, app: { openExternal: vi.fn() } }
  });
  return pulls;
}

describe('PullActionsPanel', () => {
  beforeEach(() => {
    installApi();
  });
  afterEach(() => {
    cleanup();
  });

  it('merges with the chosen method, pinned to the head the user is looking at', async () => {
    const pulls = installApi();
    render(<PullActionsPanel repoFullName="orbit-owner/app" number={7} onChanged={() => {}} />);
    await screen.findByRole('button', { name: 'Merge' });

    fireEvent.change(screen.getByLabelText('Merge method'), { target: { value: 'squash' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));

    await waitFor(() =>
      expect(pulls.merge).toHaveBeenCalledWith('orbit-owner/app', 7, {
        method: 'squash',
        deleteBranch: false,
        expectedHeadSha: 'head-1'
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/merged/i);
  });

  it('says the pull request changed and merges nothing when the head moved', async () => {
    const pulls = installApi({
      merge: vi.fn(async () => ({ kind: 'stale', headSha: 'head-2' }))
    });
    const onChanged = vi.fn();
    render(<PullActionsPanel repoFullName="orbit-owner/app" number={7} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed since you opened it/i);
    expect(onChanged).toHaveBeenCalled();
    expect(pulls.merge).toHaveBeenCalledTimes(1);
  });

  it('keeps Merge disabled for a draft pull request', async () => {
    installApi({ actions: vi.fn(async () => actions({ draft: true })) });
    render(<PullActionsPanel repoFullName="orbit-owner/app" number={7} onChanged={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Merge' })).toBeDisabled();
  });

  it('marks a draft ready for review', async () => {
    const pulls = installApi({ actions: vi.fn(async () => actions({ draft: true })) });
    render(<PullActionsPanel repoFullName="orbit-owner/app" number={7} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark ready for review' }));
    await waitFor(() => expect(pulls.setDraft).toHaveBeenCalledWith('orbit-owner/app', 7, false));
  });

  it('turns auto-merge on with the chosen method, pinned to the head', async () => {
    const pulls = installApi();
    render(<PullActionsPanel repoFullName="orbit-owner/app" number={7} onChanged={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Merge method'), { target: { value: 'merge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable auto-merge' }));
    await waitFor(() =>
      expect(pulls.setAutoMerge).toHaveBeenCalledWith('orbit-owner/app', 7, {
        enabled: true,
        method: 'merge',
        expectedHeadSha: 'head-1'
      })
    );
  });

  it('re-runs only the failed jobs or the whole workflow run', async () => {
    const pulls = installApi();
    render(<PullActionsPanel repoFullName="orbit-owner/app" number={7} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Re-run failed jobs for CI' }));
    await waitFor(() => expect(pulls.rerun).toHaveBeenCalledWith('orbit-owner/app', 11, 'failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Re-run all jobs for CI' }));
    await waitFor(() => expect(pulls.rerun).toHaveBeenCalledWith('orbit-owner/app', 11, 'all'));
  });
});

describe('NewPullForm', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens a pull request from the chosen branch and reports its number', async () => {
    const pulls = installApi();
    const onCreated = vi.fn();
    render(<NewPullForm repoFullName="orbit-owner/app" onCreated={onCreated} onCancel={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Compare branch'), { target: { value: 'feature' } });
    fireEvent.change(screen.getByLabelText('Base branch'), { target: { value: 'main' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Add x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open pull request' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(9));
    expect(pulls.create).toHaveBeenCalledWith('orbit-owner/app', {
      title: 'Add x',
      body: '',
      head: 'feature',
      base: 'main',
      draft: false
    });
  });

  it('needs a title and two different branches before it will open anything', async () => {
    const pulls = installApi();
    render(<NewPullForm repoFullName="orbit-owner/app" onCreated={() => {}} onCancel={() => {}} />);
    await screen.findByLabelText('Compare branch');
    expect(screen.getByRole('button', { name: 'Open pull request' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Add x' } });
    fireEvent.change(screen.getByLabelText('Compare branch'), { target: { value: 'main' } });
    fireEvent.change(screen.getByLabelText('Base branch'), { target: { value: 'main' } });
    expect(screen.getByRole('button', { name: 'Open pull request' })).toBeDisabled();
    expect(pulls.create).not.toHaveBeenCalled();
  });
});
