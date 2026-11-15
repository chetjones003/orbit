import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Diff,
  Hunk,
  getChangeKey,
  isInsert,
  isNormal,
  type ChangeData,
  type HunkData,
  type ViewType
} from 'react-diff-view';
import 'react-diff-view/style/index.css';
import type {
  PullFile,
  PullFilesPage,
  PullReviewThread,
  PullReviewThreadsPage
} from '../../../shared/issues';
import { RichBody } from './RichBody';
import { fileNote, isLargePatch, parseFileDiff } from './pull-diff';

export interface PullDiffViewProps {
  repoFullName: string;
  number: number;
  /** Compact panel shows the unified diff. The expanded view can also show a split diff. */
  variant?: 'panel' | 'expanded';
  onLink: (href: string) => void;
}

const LOAD_ERROR = 'The changed files could not be loaded. Try again later.';

/** Changed files with a file navigator, and each file's diff with its review threads. */
export function PullDiffView({ repoFullName, number, variant = 'panel', onLink }: PullDiffViewProps) {
  const [filesPage, setFilesPage] = useState<PullFilesPage | null>(null);
  const [threadsPage, setThreadsPage] = useState<PullReviewThreadsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [viewType, setViewType] = useState<ViewType>('unified');
  const [loadedLarge, setLoadedLarge] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      window.orbit.pulls.files(repoFullName, number),
      window.orbit.pulls.threads(repoFullName, number)
    ]).then(
      ([files, threads]) => {
        if (cancelled) return;
        setFilesPage(files);
        setThreadsPage(threads);
      },
      () => {
        if (!cancelled) setError(LOAD_ERROR);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number]);

  if (error) return <p role="alert">{error}</p>;
  if (!filesPage || !threadsPage) {
    return (
      <p className="empty-state" role="status">
        Loading changed files…
      </p>
    );
  }
  const file = filesPage.files[Math.min(selected, filesPage.files.length - 1)];
  if (!file) return <p>No changed files.</p>;

  const note = fileNote(file);
  const threadsForFile = threadsPage.threads.filter((thread) => thread.path === file.filename);

  return (
    <section aria-label="Changed files" className={`pull-diff ${variant}`}>
      {filesPage.partial && <p role="note">Some changed files may not be shown.</p>}
      {threadsPage.partial && <p role="note">Some review threads may not be shown.</p>}
      <div className="pull-diff-layout">
        <nav aria-label="File navigator">
          <ul>
            {filesPage.files.map((candidate, index) => (
              <li key={candidate.filename}>
                <button
                  className="secondary-action"
                  aria-current={index === selected ? 'true' : undefined}
                  onClick={() => setSelected(index)}
                >
                  {candidate.filename} <span aria-label="additions">+{candidate.additions}</span>{' '}
                  <span aria-label="deletions">−{candidate.deletions}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="pull-diff-file">
          <div className="pull-diff-toolbar">
            <h3>{file.filename}</h3>
            {variant === 'expanded' && (
              <button
                className="secondary-action"
                onClick={() => setViewType((current) => (current === 'unified' ? 'split' : 'unified'))}
              >
                {viewType === 'unified' ? 'Split view' : 'Unified view'}
              </button>
            )}
          </div>
          {note && <p className="pull-diff-note">{note}</p>}
          <FileBody
            file={file}
            viewType={viewType}
            loaded={loadedLarge.has(file.filename)}
            onLoad={() => setLoadedLarge((current) => new Set(current).add(file.filename))}
            threads={threadsForFile}
            repoFullName={repoFullName}
            number={number}
            onLink={onLink}
          />
        </div>
      </div>
    </section>
  );
}

interface FileBodyProps {
  file: PullFile;
  viewType: ViewType;
  loaded: boolean;
  onLoad: () => void;
  threads: PullReviewThread[];
  repoFullName: string;
  number: number;
  onLink: (href: string) => void;
}

function FileBody({ file, viewType, loaded, onLoad, threads, repoFullName, number, onLink }: FileBodyProps) {
  const large = file.patch !== null && isLargePatch(file.patch);
  const parsed = useMemo(
    () => (file.patch !== null && (!large || loaded) ? parseFileDiff(file) : null),
    [file, large, loaded]
  );

  const filesUrl = `https://github.com/${repoFullName}/pull/${number}/files`;
  if (file.patch === null || (large && !loaded)) {
    const lines = file.patch === null ? null : file.patch.split('\n').length;
    return (
      <>
        {file.patch !== null && (
          <button className="secondary-action" onClick={onLoad}>
            Load diff ({lines} lines)
          </button>
        )}
        {file.noPatchReason === 'too-large' && (
          <a
            href={filesUrl}
            onClick={(event) => {
              event.preventDefault();
              void window.orbit.app.openExternal(filesUrl);
            }}
          >
            View the diff on GitHub ↗
          </a>
        )}
        <ThreadList threads={threads} onLink={onLink} />
      </>
    );
  }

  if (!parsed) return null;
  const widgets = threadWidgets(parsed.hunks, threads, onLink);
  const unplaced = threads.filter((thread) => !widgets.placed.has(thread.id));

  return (
    <>
      <Diff viewType={viewType} diffType={parsed.type} hunks={parsed.hunks} widgets={widgets.map}>
        {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
      </Diff>
      {unplaced.length > 0 && <h4>Other threads on this file</h4>}
      <ThreadList threads={unplaced} onLink={onLink} />
    </>
  );
}

/**
 * Pins each current thread under the diff line it refers to. A thread whose line is gone (outdated,
 * or not in the diff) is left unplaced and shown with its original context instead.
 */
function threadWidgets(hunks: HunkData[], threads: PullReviewThread[], onLink: (href: string) => void) {
  const map: Record<string, ReactNode> = {};
  const placed = new Set<string>();
  for (const thread of threads) {
    if (thread.line === null || thread.isOutdated) continue;
    const change = findChangeAtNewLine(hunks, thread.line);
    if (!change) continue;
    const key = getChangeKey(change);
    placed.add(thread.id);
    map[key] = (
      <>
        {map[key]}
        <ThreadCard thread={thread} onLink={onLink} />
      </>
    );
  }
  return { map, placed };
}

function findChangeAtNewLine(hunks: HunkData[], line: number): ChangeData | null {
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (isInsert(change) && change.lineNumber === line) return change;
      if (isNormal(change) && change.newLineNumber === line) return change;
    }
  }
  return null;
}

function ThreadList({ threads, onLink }: { threads: PullReviewThread[]; onLink: (href: string) => void }) {
  return (
    <>
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} onLink={onLink} />
      ))}
    </>
  );
}

function ThreadCard({ thread, onLink }: { thread: PullReviewThread; onLink: (href: string) => void }) {
  const status = thread.isOutdated ? 'Outdated' : thread.isResolved ? 'Resolved' : 'Open';
  return (
    <section aria-label={`Review thread on ${thread.path}`} className="pull-thread">
      <p>
        <strong>{status}</strong>
        {thread.line !== null ? ` · line ${thread.line}` : ` · was line ${thread.originalLine ?? 'unknown'}`}
      </p>
      {thread.isOutdated && thread.diffHunk && (
        <>
          <p>The code changed after this comment. Its original context:</p>
          <pre>{thread.diffHunk}</pre>
        </>
      )}
      {thread.comments.map((comment) => (
        <article key={comment.id}>
          <p>
            @{comment.authorLogin} · {new Date(comment.createdAt).toLocaleDateString()}
          </p>
          <RichBody
            html={comment.bodyHtml}
            viewOnGitHubUrl={comment.htmlUrl}
            onLink={onLink}
            emptyText="No comment text."
          />
        </article>
      ))}
      {thread.commentsPartial && <p role="note">Some replies may not be shown.</p>}
    </section>
  );
}
