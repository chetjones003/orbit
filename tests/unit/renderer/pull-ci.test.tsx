// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDuration, groupName, jobTone, PullCi } from '../../../src/renderer/src/issues/PullCi';
import type { WorkflowGraphJob, WorkflowJob, WorkflowRun } from '../../../src/shared/issues';

function job(id: number, name: string, status: string, conclusion: string | null): WorkflowJob {
  return {
    id,
    name,
    status,
    conclusion,
    startedAt: status === 'queued' ? null : '2026-11-15T10:00:00Z',
    completedAt: status === 'completed' ? '2026-11-15T10:03:00Z' : null,
    htmlUrl: 'https://github.com/o/r/actions/runs/1/job/' + id
  };
}

const run: WorkflowRun = {
  id: 7,
  name: 'CI',
  status: 'in_progress',
  conclusion: null,
  htmlUrl: 'https://github.com/o/r/actions/runs/7'
};

describe('CI helpers', () => {
  it('formats durations as m:ss, and h:mm:ss past an hour', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('reads a job’s tone from its status and conclusion', () => {
    expect(jobTone({ status: 'in_progress', conclusion: null })).toBe('running');
    expect(jobTone({ status: 'queued', conclusion: null })).toBe('queued');
    expect(jobTone({ status: 'completed', conclusion: 'success' })).toBe('passed');
    expect(jobTone({ status: 'completed', conclusion: 'failure' })).toBe('failed');
    expect(jobTone({ status: 'completed', conclusion: 'cancelled' })).toBe('stopped');
  });

  it('groups matrix jobs under their shared name', () => {
    expect(groupName('build (windows-latest)')).toBe('build');
    expect(groupName('lint')).toBe('lint');
  });
});

describe('PullCi', () => {
  afterEach(() => {
    cleanup();
    delete (window as { orbit?: unknown }).orbit;
  });

  function installApi(jobs: WorkflowJob[]) {
    const api = {
      pulls: {
        runs: vi.fn(async () => [run]),
        actions: vi.fn(async () => ({ headSha: 'head-1' })),
        rerun: vi.fn(async () => ({ kind: 'changed' }))
      },
      actions: {
        jobs: vi.fn(async () => jobs),
        workflowGraph: vi.fn(async () => [] as WorkflowGraphJob[]),
        jobLogs: vi.fn(async () => '##[group]Run lint\nno problems\n##[endgroup]'),
        cancelRun: vi.fn(async () => ({ kind: 'changed' }))
      },
      app: { openExternal: vi.fn() }
    };
    window.orbit = api as unknown as typeof window.orbit;
    return api;
  }

  it('draws a matrix as one node and offers cancel while the run is active', async () => {
    const api = installApi([
      job(1, 'build (windows-latest)', 'completed', 'success'),
      job(2, 'build (macos-latest)', 'completed', 'success'),
      job(3, 'build (ubuntu-latest)', 'completed', 'failure'),
      job(4, 'smoke test', 'in_progress', null)
    ]);
    render(<PullCi repoFullName="o/r" number={14} />);

    const runSection = await screen.findByRole('region', { name: 'CI' });
    expect(await within(runSection).findByText('Matrix: build')).toBeInTheDocument();
    expect(within(runSection).getByText('2 of 3 jobs completed')).toBeInTheDocument();
    expect(within(runSection).getByRole('button', { name: /smoke test, Running/ })).toBeInTheDocument();

    fireEvent.click(within(runSection).getByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(api.actions.cancelRun).toHaveBeenCalledWith('o/r', 7));
  });

  it('lists a matrix’s jobs when asked and opens one job’s log', async () => {
    const api = installApi([
      job(1, 'build (windows-latest)', 'completed', 'success'),
      job(2, 'build (ubuntu-latest)', 'completed', 'failure')
    ]);
    render(<PullCi repoFullName="o/r" number={14} />);

    const runSection = await screen.findByRole('region', { name: 'CI' });
    fireEvent.click(await within(runSection).findByRole('button', { name: 'Show all jobs' }));
    fireEvent.click(within(runSection).getByRole('button', { name: /build \(windows-latest\), Passed/ }));
    expect(await screen.findByText(/no problems/)).toBeInTheDocument();
    expect(api.actions.jobLogs).toHaveBeenCalledWith('o/r', 1);
  });

  it('opens a job’s log on demand', async () => {
    const api = installApi([job(1, 'lint', 'completed', 'success')]);
    render(<PullCi repoFullName="o/r" number={14} />);

    fireEvent.click(await screen.findByRole('button', { name: /lint, Passed/ }));
    expect(await screen.findByText(/no problems/)).toBeInTheDocument();
    expect(api.actions.jobLogs).toHaveBeenCalledWith('o/r', 1);
  });
});
