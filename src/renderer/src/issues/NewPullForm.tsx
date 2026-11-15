import { useEffect, useState } from 'react';
import { COMMENT_MAX_CHARS } from '../../../shared/issues';

export interface NewPullFormProps {
  repoFullName: string;
  /** Called with the new pull request's number once GitHub has created it. */
  onCreated: (number: number) => void;
  onCancel: () => void;
}

/**
 * Opens a pull request from one branch into another in a personal repo. Both branches come from the repo
 * itself, so the head is always in the same repo and can be merged or deleted from Orbit.
 */
export function NewPullForm({ repoFullName, onCreated, onCancel }: NewPullFormProps) {
  const [branches, setBranches] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [head, setHead] = useState('');
  const [base, setBase] = useState('');
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.orbit.pulls.branches(repoFullName).then(
      (names) => {
        if (cancelled) return;
        setBranches(names);
        setBase((current) => current || (names.includes('main') ? 'main' : (names[0] ?? '')));
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'Could not load branches.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName]);

  const ready = title.trim() !== '' && head !== '' && base !== '' && head !== base && !busy;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const created = await window.orbit.pulls.create(repoFullName, {
        title: title.trim(),
        body,
        head,
        base,
        draft
      });
      onCreated(created.number);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The pull request could not be opened. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <p role="alert" className="session-notice">
        {loadError}
      </p>
    );
  }
  if (branches === null) {
    return <p className="empty-state">Loading branches…</p>;
  }

  return (
    <section className="new-pull" aria-label="New pull request">
      <h3>New pull request</h3>
      <label className="field">
        <span>Compare branch</span>
        <select aria-label="Compare branch" value={head} onChange={(event) => setHead(event.target.value)}>
          <option value="">Choose a branch</option>
          {branches.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Base branch</span>
        <select aria-label="Base branch" value={base} onChange={(event) => setBase(event.target.value)}>
          <option value="">Choose a branch</option>
          {branches.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Title</span>
        <input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea
          aria-label="Description"
          value={body}
          maxLength={COMMENT_MAX_CHARS}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <label className="field">
        <input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />
        <span>Open as draft</span>
      </label>
      {head !== '' && head === base && <p>The compare and base branches must be different.</p>}
      {error && (
        <p role="alert" className="session-notice">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="secondary-action" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="primary-action" disabled={!ready} onClick={() => void submit()}>
          Open pull request
        </button>
      </div>
    </section>
  );
}
