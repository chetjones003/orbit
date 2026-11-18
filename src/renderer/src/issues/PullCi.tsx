import { useEffect, useState } from 'react';
import type { WorkflowGraphJob, WorkflowJob, WorkflowRun } from '../../../shared/issues';
import { StatusGlyph, WorkflowGraph } from './WorkflowGraph';
import { SectionHead } from './SectionHead';

export { formatDuration, groupName, jobTone } from './ci-model';

export interface PullCiProps {
  repoFullName: string;
  number: number;
}

/**
 * The CI section of a pull request: each workflow run as GitHub draws it, with live timers for running jobs,
 * the log of any job on demand, and buttons to re-run or cancel. Every write is pinned to the head commit.
 */
export function PullCi({ repoFullName, number }: PullCiProps) {
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);
  const [headSha, setHeadSha] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.orbit.pulls.runs(repoFullName, number),
      window.orbit.pulls.actions(repoFullName, number)
    ]).then(
      ([nextRuns, actions]) => {
        if (cancelled) return;
        setRuns(nextRuns);
        setHeadSha(actions.headSha);
        setLoadError(null);
      },
      (failure: unknown) => {
        if (!cancelled)
          setLoadError(failure instanceof Error ? failure.message : 'The CI results could not be loaded.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number, version]);

  const active = runs?.some((run) => run.status !== 'completed') ?? false;
  // While anything runs: the clock ticks every second, and the runs are read again every 15 seconds.
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => setVersion((value) => value + 1), 15000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [active]);

  return (
    <div className="ci" aria-label="Workflow runs">
      <SectionHead icon="refresh" title="Checks" count={runs?.length ?? null}>
        {runs !== null && (
          <span className={`ci-summary ${active ? 'running' : ''}`}>
            {runs.length === 0 ? 'No workflow runs for this commit.' : active ? 'Running' : 'Finished'}
          </span>
        )}
      </SectionHead>
      {loadError && (
        <p role="alert" className="session-notice">
          {loadError}
        </p>
      )}
      {runs === null && !loadError && <p className="detail-muted">Loading CI results…</p>}
      {runs?.map((run) => (
        <RunBlock
          key={run.id}
          run={run}
          repoFullName={repoFullName}
          headSha={headSha}
          now={now}
          onChanged={(message) => {
            setNotice(message);
            setVersion((value) => value + 1);
          }}
        />
      ))}
      {notice && (
        <p role="status" className="session-notice">
          {notice}
        </p>
      )}
    </div>
  );
}

interface RunBlockProps {
  run: WorkflowRun;
  repoFullName: string;
  headSha: string | null;
  now: number;
  onChanged: (message: string) => void;
}

function RunBlock({ run, repoFullName, headSha, now, onChanged }: RunBlockProps) {
  const [jobs, setJobs] = useState<WorkflowJob[] | null>(null);
  const [declared, setDeclared] = useState<WorkflowGraphJob[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const runActive = run.status !== 'completed';

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.orbit.actions.jobs(repoFullName, run.id),
      window.orbit.actions.workflowGraph(repoFullName, run.id)
    ]).then(
      ([nextJobs, nextDeclared]) => {
        if (cancelled) return;
        setJobs(nextJobs);
        setDeclared(nextDeclared);
        setJobsError(null);
      },
      (failure: unknown) => {
        if (!cancelled)
          setJobsError(failure instanceof Error ? failure.message : 'These jobs could not be loaded.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, run.id, run.status, version]);

  useEffect(() => {
    if (!runActive) return;
    const refresh = setInterval(() => setVersion((value) => value + 1), 15000);
    return () => clearInterval(refresh);
  }, [runActive]);

  const act = async (work: () => Promise<string>): Promise<void> => {
    setBusy(true);
    try {
      onChanged(await work());
    } catch (failure) {
      onChanged(failure instanceof Error ? failure.message : 'That action failed. Try again.');
    } finally {
      setBusy(false);
      setVersion((value) => value + 1);
    }
  };

  const cancel = (): Promise<void> =>
    act(async () => {
      await window.orbit.actions.cancelRun(repoFullName, run.id);
      return `Cancellation requested for ${run.name}.`;
    });

  const rerun = (mode: 'all' | 'failed'): Promise<void> =>
    act(async () => {
      if (headSha === null) throw new Error('The commit is not loaded yet. Try again in a moment.');
      const result = await window.orbit.pulls.rerun(repoFullName, run.id, mode, headSha);
      if (result.kind === 'new-commits')
        return 'This pull request has new commits. Review them before re-running.';
      return `Re-run requested for ${run.name}.`;
    });

  const runTone = runActive
    ? 'running'
    : run.conclusion === 'success'
      ? 'passed'
      : run.conclusion === 'failure'
        ? 'failed'
        : 'stopped';

  return (
    <section className="ci-run" aria-label={run.name}>
      <header className="ci-run-head">
        <StatusGlyph tone={runTone} />
        <span className="ci-run-name">{run.name}</span>
        <span className="ci-run-state">
          {runActive ? run.status.replace('_', ' ') : (run.conclusion ?? run.status)}
        </span>
        <span className="ci-run-actions">
          {runActive && (
            <button type="button" className="secondary-action" disabled={busy} onClick={() => void cancel()}>
              Cancel run
            </button>
          )}
          {!runActive && (
            <>
              {run.conclusion !== 'success' && (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={busy}
                  aria-label={`Re-run failed jobs for ${run.name}`}
                  onClick={() => void rerun('failed')}
                >
                  Re-run failed jobs
                </button>
              )}
              <button
                type="button"
                className="secondary-action"
                disabled={busy}
                aria-label={`Re-run all jobs for ${run.name}`}
                onClick={() => void rerun('all')}
              >
                Re-run all jobs
              </button>
            </>
          )}
          <button
            type="button"
            className="text-action"
            onClick={() => void window.orbit.app.openExternal(run.htmlUrl)}
          >
            Open on GitHub
          </button>
        </span>
      </header>
      {jobsError && (
        <p role="alert" className="session-notice">
          {jobsError}
        </p>
      )}
      {jobs === null && !jobsError && <p className="detail-muted">Loading jobs…</p>}
      {jobs !== null && jobs.length > 0 && (
        <div className="ci-run-body">
          <WorkflowGraph repoFullName={repoFullName} jobs={jobs} declared={declared} now={now} />
        </div>
      )}
      {jobs !== null && jobs.length === 0 && (
        <p className="detail-muted ci-run-body">This run has no jobs yet.</p>
      )}
    </section>
  );
}
