import { useEffect, useRef, useState } from 'react';
import type { ConflictSet } from '../../../shared/conflicts';
import type { EditorKeys } from '../../../shared/ipc';
import { conflictBlocks, resolveBlock, type BlockChoice } from './merge3';
import { FileEditor, type FileEditorHandle } from './FileEditor';
import { forgetConflicts, loadConflicts } from './conflict-cache';
import {
  canCommit,
  commitFiles,
  planResolution,
  type Resolution,
  type ResolverFile,
  type SideChoice,
  type SideChoices
} from './resolution';

export interface ConflictResolverProps {
  repoFullName: string;
  number: number;
  /** Returns to the pull request. */
  onClose: () => void;
  /** Called once the resolving commit lands, so the pull request reloads its status. */
  onResolved: () => void;
}

interface Loaded {
  set: ConflictSet;
  plan: Resolution;
  keys: EditorKeys;
  wrap: boolean;
}

const LOAD_ERROR = 'The conflicts could not be loaded. Try again later.';
const COMMIT_ERROR = 'The resolution was not committed. Your edits are kept; try again.';

/**
 * Resolves a pull request's merge conflicts in the window. Files that both branches changed sit on the left; the
 * selected file opens in the editor on the right, with conflict markers where the two branches disagree.
 */
export function ConflictResolver({ repoFullName, number, onClose, onResolved }: ConflictResolverProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<SideChoices>({});
  const editor = useRef<FileEditorHandle | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committedSha, setCommittedSha] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setLoadError(null);
    setCommittedSha(null);
    setChoices({});
    Promise.all([loadConflicts(repoFullName, number), window.orbit.settings.get()]).then(
      ([set, settings]) => {
        if (cancelled) return;
        const plan = planResolution(set);
        setTexts(Object.fromEntries(plan.files.map((file) => [file.path, file.initial])));
        setSelected(plan.files[0]?.path ?? null);
        setLoaded({ set, plan, keys: settings.editorKeys, wrap: settings.editorWordWrap });
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : LOAD_ERROR);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number]);

  if (committedSha !== null) {
    return (
      <section className="conflict-resolver" aria-label="Resolve conflicts">
        <ResolverHeader onClose={onClose} />
        <div className="conflict-done" role="status">
          <strong>Conflicts resolved.</strong>
          <p>
            Committed {committedSha.slice(0, 7)} to the head branch. GitHub is checking the new commit; the
            status updates when the pull request reloads.
          </p>
        </div>
      </section>
    );
  }

  if (loadError !== null) {
    return (
      <section className="conflict-resolver" aria-label="Resolve conflicts">
        <ResolverHeader onClose={onClose} />
        <p className="session-notice" role="alert">
          {loadError}
        </p>
      </section>
    );
  }

  if (loaded === null) {
    return (
      <section className="conflict-resolver" aria-label="Resolve conflicts">
        <ResolverHeader onClose={onClose} />
        <p className="empty-state loading-line" role="status">
          <span className="ci-spinner" aria-hidden="true" />
          Loading conflicts…
        </p>
      </section>
    );
  }

  const { set, plan, keys, wrap } = loaded;
  const textOf = (file: ResolverFile): string => texts[file.path] ?? file.initial;
  const ready = canCommit(plan.files, texts, choices);
  const filesLeft = plan.files.filter(
    (file) => file.state !== 'blocked' && conflictBlocks(textOf(file)).length > 0
  );
  const current = plan.files.find((file) => file.path === selected) ?? null;

  const setText = (path: string, text: string): void =>
    setTexts((previous) => ({ ...previous, [path]: text }));

  const keepSide = (path: string, side: SideChoice): void =>
    setChoices((previous) => ({ ...previous, [path]: side }));

  // Keeps one side of one block. The buttons sit above each block in the editor, so the block is always the one clicked.
  const keepBlock = (index: number, choice: BlockChoice): void => {
    if (!current) return;
    setText(current.path, resolveBlock(textOf(current), index, choice));
  };

  const commit = async (): Promise<void> => {
    if (!ready || committing) return;
    setCommitError(null);
    setCommitting(true);
    try {
      const result = await window.orbit.pulls.resolveConflicts(repoFullName, number, {
        expectedHeadSha: set.headSha,
        expectedBaseSha: set.baseSha,
        files: commitFiles(plan, texts, choices)
      });
      setCommittedSha(result.sha);
      onResolved();
    } catch (cause) {
      // The set may be stale; the next open reads GitHub again. The edits stay here.
      forgetConflicts(repoFullName, number);
      setCommitError(cause instanceof Error ? cause.message : COMMIT_ERROR);
    } finally {
      setCommitting(false);
    }
  };

  const nothingToResolve = plan.files.length === 0;

  return (
    <section className="conflict-resolver" aria-label="Resolve conflicts">
      <ResolverHeader onClose={onClose} />

      {nothingToResolve ? (
        <p className="empty-state" role="status">
          Orbit found no conflicting files. GitHub&apos;s status may be out of date. Reload the pull request.
        </p>
      ) : (
        <div className="conflict-body">
          <nav className="conflict-files" aria-label="Files with conflicts">
            <p className="conflict-files-head">
              {plan.files.length} {plan.files.length === 1 ? 'file' : 'files'}
              {filesLeft.length > 0 ? `, ${filesLeft.length} to resolve` : ', all resolved'}
            </p>
            <ul>
              {plan.files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    className={`conflict-file ${file.state}`}
                    aria-pressed={file.path === selected}
                    onClick={() => setSelected(file.path)}
                  >
                    <span className="conflict-file-path">{file.path}</span>
                    <span className="conflict-file-status">
                      {fileStatus(file, textOf(file), choices[file.path], set)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="conflict-pane">
            {current?.state === 'blocked' ? (
              <div className="conflict-blocked" role="alert">
                <p>
                  <strong>{current.path}</strong>
                </p>
                <p>{current.reason}</p>
                <p>Keep one branch's whole version of this file. Choose one, then commit.</p>
                <div className="conflict-sides" role="group" aria-label="Keep a whole version">
                  <button
                    type="button"
                    className="secondary-action"
                    aria-pressed={choices[current.path] === 'head'}
                    onClick={() => keepSide(current.path, 'head')}
                  >
                    Keep {set.headRef} {current.headBlob === null ? '(delete the file)' : 'version'}
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    aria-pressed={choices[current.path] === 'base'}
                    onClick={() => keepSide(current.path, 'base')}
                  >
                    Keep {set.baseRef} {current.baseBlob === null ? '(delete the file)' : 'version'}
                  </button>
                </div>
              </div>
            ) : current ? (
              <>
                <div className="conflict-toolbar" role="toolbar" aria-label="Conflict actions">
                  <span className="conflict-path">{current.path}</span>
                  <span className="conflict-keys">{keys === 'vim' ? 'Vim keys' : 'Standard keys'}</span>
                  {conflictBlocks(textOf(current)).length > 0 && (
                    <>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => editor.current?.previousConflict()}
                      >
                        Previous conflict
                      </button>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => editor.current?.nextConflict()}
                      >
                        Next conflict
                      </button>
                    </>
                  )}
                </div>
                <FileEditor
                  key={current.path}
                  ref={editor}
                  path={current.path}
                  value={textOf(current)}
                  onChange={(text) => setText(current.path, text)}
                  keys={keys}
                  wrap={wrap}
                  ariaLabel={`Resolved text of ${current.path}`}
                  sideLabels={{ head: set.headRef, base: set.baseRef }}
                  onKeep={keepBlock}
                />
              </>
            ) : null}
          </div>
        </div>
      )}

      <footer className="conflict-footer">
        <p className="conflict-footnote">
          {plan.baseOnly.length > 0
            ? `${plan.baseOnly.length} ${plan.baseOnly.length === 1 ? 'file' : 'files'} changed only on ${set.baseRef} will be included as they are.`
            : ''}
        </p>
        {commitError && (
          <p className="session-notice" role="alert">
            {commitError}
          </p>
        )}
        <button
          type="button"
          className="primary-action"
          disabled={!ready || committing || nothingToResolve}
          onClick={() => void commit()}
        >
          {committing ? 'Committing…' : 'Commit resolution'}
        </button>
      </footer>
    </section>
  );
}

function fileStatus(
  file: ResolverFile,
  text: string,
  choice: SideChoice | undefined,
  set: ConflictSet
): string {
  if (file.state === 'blocked') {
    return choice === undefined
      ? 'Choose a version'
      : `Keeps ${choice === 'head' ? set.headRef : set.baseRef}`;
  }
  const left = conflictBlocks(text).length;
  if (left > 0) return `${left} ${left === 1 ? 'conflict' : 'conflicts'}`;
  return file.state === 'merged' ? 'Merged cleanly' : 'Resolved';
}

function ResolverHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="conflict-head">
      <button type="button" className="secondary-action" onClick={onClose}>
        ← Back to pull request
      </button>
      <h3>Resolve conflicts</h3>
    </header>
  );
}
