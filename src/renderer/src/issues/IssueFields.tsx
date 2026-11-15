import { useEffect, useState } from 'react';
import type { IssueLabel, IssueMilestone, IssueRepoOptions, IssueSummary } from '../../../shared/issues';

export interface IssueFieldsProps {
  repoFullName: string;
  number: number;
  summary: IssueSummary;
  /** Shows the change at once, then GitHub's version once it is saved, or the previous one if it is refused. */
  onChange: (summary: IssueSummary) => void;
  onError: (message: string) => void;
}

/**
 * The repo's open milestones, plus the issue's own milestone when it is no longer open. Without it the
 * select would show "No milestone" for an issue that still has one.
 */
function milestonesWithCurrent(offered: IssueMilestone[], current: IssueMilestone | null): IssueMilestone[] {
  if (!current || offered.some((m) => m.number === current.number)) return offered;
  return [current, ...offered];
}

/**
 * Labels, assignees, and milestone of one issue. A change shows at once; it is reversed if GitHub refuses it,
 * and GitHub's reconciled summary replaces the optimistic one when it is accepted. Only one change is sent at a
 * time, because each sends the complete lists: overlapping requests could undo one another on GitHub.
 */
export function IssueFields({ repoFullName, number, summary, onChange, onError }: IssueFieldsProps) {
  const [options, setOptions] = useState<IssueRepoOptions | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Wrapped so a synchronous failure is handled the same way as a rejected request.
    Promise.resolve()
      .then(() => window.orbit.issues.repoOptions(repoFullName))
      .then(
        (next) => {
          if (!cancelled) setOptions(next);
        },
        () => {
          if (!cancelled) setLoadFailed(true);
        }
      );
    return () => {
      cancelled = true;
    };
  }, [repoFullName]);

  const send = (optimistic: IssueSummary): void => {
    if (saving) return;
    const previous = summary;
    setSaving(true);
    onChange(optimistic);
    window.orbit.issues
      .updateFields(repoFullName, number, {
        labels: optimistic.labels.map((label) => label.name),
        assignees: optimistic.assignees,
        milestoneNumber: optimistic.milestone?.number ?? null
      })
      .then(
        (saved) => {
          setSaving(false);
          onChange(saved);
        },
        () => {
          setSaving(false);
          onChange(previous);
          onError('Could not save that change. It has been undone.');
        }
      );
  };

  const toggleLabel = (label: IssueLabel): void => {
    const on = summary.labels.some((l) => l.name === label.name);
    send({
      ...summary,
      labels: on ? summary.labels.filter((l) => l.name !== label.name) : [...summary.labels, label]
    });
  };

  const toggleAssignee = (login: string): void => {
    const on = summary.assignees.includes(login);
    send({
      ...summary,
      assignees: on ? summary.assignees.filter((a) => a !== login) : [...summary.assignees, login]
    });
  };

  const chooseMilestone = (value: string): void => {
    const number = value === '' ? null : Number(value);
    const milestone = number === null ? null : (options?.milestones.find((m) => m.number === number) ?? null);
    send({ ...summary, milestone });
  };

  return (
    <section className="issue-fields" aria-label="Issue fields">
      {loadFailed && (
        <p className="session-notice" role="status">
          Could not load the labels, assignees, and milestones for this repo.
        </p>
      )}
      {options && (
        <>
          {options.partial && (
            <p className="session-notice" role="status">
              Only the first 100 labels, assignees, or milestones are shown.
            </p>
          )}
          <fieldset>
            <legend>Labels</legend>
            {options.labels.map((label) => (
              <label className="check-option" key={label.name}>
                <input
                  type="checkbox"
                  checked={summary.labels.some((l) => l.name === label.name)}
                  onChange={() => toggleLabel(label)}
                  disabled={saving}
                />
                <span>{label.name}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Assignees</legend>
            {options.assignees.map((login) => (
              <label className="check-option" key={login}>
                <input
                  type="checkbox"
                  checked={summary.assignees.includes(login)}
                  onChange={() => toggleAssignee(login)}
                  disabled={saving}
                />
                <span>{login}</span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Milestone</span>
            <select
              aria-label="Milestone"
              value={summary.milestone ? String(summary.milestone.number) : ''}
              onChange={(event) => chooseMilestone(event.target.value)}
              disabled={saving}
            >
              <option value="">No milestone</option>
              {milestonesWithCurrent(options.milestones, summary.milestone).map((milestone) => (
                <option key={milestone.number} value={String(milestone.number)}>
                  {milestone.title}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </section>
  );
}
