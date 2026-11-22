// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OverlayHost } from '@ui-sdk/react/overlays';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PullCi } from '../../../src/renderer/src/issues/PullCi';
import {
  MergeSplitButton,
  PullActionNotices,
  usePullActions
} from '../../../src/renderer/src/issues/PullActions';
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
    setDraft: vi.fn(async () => ({ kind: 'changed' })),
    rerun: vi.fn(async () => ({ kind: 'changed' })),
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

function MergeHarness({ onChanged = () => {} }: { onChanged?: () => void }) {
  const state = usePullActions('orbit-owner/app', 7, onChanged);
  return (
    <>
      <MergeSplitButton state={state} />
      <PullActionNotices state={state} />
      <OverlayHost />
    </>
  );
}

describe('Merge split button', () => {
  beforeEach(() => {
    // jsdom has no layout; the menu scrolls its highlighted item into view.
    Element.prototype.scrollIntoView ??= () => {};
    installApi();
  });
  afterEach(() => {
    cleanup();
  });

  it('merges with the method chosen from the dropdown, pinned to the head the user is looking at', async () => {
    const pulls = installApi();
    render(<MergeHarness />);
    await screen.findByRole('button', { name: 'Merge' });

    fireEvent.click(screen.getByRole('button', { name: 'Merge options' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Squash and merge/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Squash and merge' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Squash and merge' })
    );

    await waitFor(() =>
      expect(pulls.merge).toHaveBeenCalledWith('orbit-owner/app', 7, {
        method: 'squash',
        deleteBranch: false,
        expectedHeadSha: 'head-1'
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/merged/i);
  });

  it('offers every method, and disables the ones the repo does not allow', async () => {
    render(<MergeHarness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge options' }));
    expect(await screen.findByRole('menuitemradio', { name: /Rebase and merge/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitemradio', { name: /Merge commit/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('says the pull request changed and merges nothing when the head moved', async () => {
    const pulls = installApi({
      merge: vi.fn(async () => ({ kind: 'new-commits', headSha: 'head-2' }))
    });
    const onChanged = vi.fn();
    render(<MergeHarness onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Merge' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed since you opened it/i);
    expect(onChanged).toHaveBeenCalled();
    expect(pulls.merge).toHaveBeenCalledTimes(1);
  });

  it('keeps Merge disabled for a draft pull request', async () => {
    installApi({ actions: vi.fn(async () => actions({ draft: true })) });
    render(<MergeHarness />);
    expect(await screen.findByRole('button', { name: 'Merge' })).toBeDisabled();
  });

  it('marks a draft ready for review from the dropdown', async () => {
    const pulls = installApi({ actions: vi.fn(async () => actions({ draft: true })) });
    render(<MergeHarness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mark ready for review/ }));
    await waitFor(() => expect(pulls.setDraft).toHaveBeenCalledWith('orbit-owner/app', 7, false, 'head-1'));
  });

  it('turns auto-merge on with the chosen method, pinned to the head', async () => {
    const pulls = installApi();
    render(<MergeHarness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Enable auto-merge/ }));
    await waitFor(() =>
      expect(pulls.setAutoMerge).toHaveBeenCalledWith('orbit-owner/app', 7, {
        enabled: true,
        method: 'merge',
        expectedHeadSha: 'head-1'
      })
    );
  });

  it('deletes the branch after merge when that option is checked', async () => {
    const pulls = installApi();
    render(<MergeHarness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge options' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Delete branch after merge/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Merge' }));
    await waitFor(() =>
      expect(pulls.merge).toHaveBeenCalledWith('orbit-owner/app', 7, {
        method: 'merge',
        deleteBranch: true,
        expectedHeadSha: 'head-1'
      })
    );
  });
});

describe('PullCi', () => {
  afterEach(() => {
    cleanup();
  });

  it('re-runs only the failed jobs or the whole workflow run', async () => {
    const pulls = installApi();
    (window.orbit as unknown as { actions: unknown }).actions = {
      jobs: vi.fn(async () => []),
      workflowGraph: vi.fn(async () => []),
      jobLogs: vi.fn(async () => ''),
      cancelRun: vi.fn(async () => ({ kind: 'changed' }))
    };
    render(<PullCi repoFullName="orbit-owner/app" number={7} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Re-run failed jobs for CI' }));
    await waitFor(() => expect(pulls.rerun).toHaveBeenCalledWith('orbit-owner/app', 11, 'failed', 'head-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Re-run all jobs for CI' }));
    await waitFor(() => expect(pulls.rerun).toHaveBeenCalledWith('orbit-owner/app', 11, 'all', 'head-1'));
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
