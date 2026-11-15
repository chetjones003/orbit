import { useRef, useState } from 'react';
import { COMMENT_MAX_CHARS } from '../../../shared/issues';
import { RichBody } from '../issues/RichBody';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import { countCharacters, isOverLimit, type FormatKind } from './markdown-edit';
import { drafts, type DraftKey } from './draft-store';

export interface ComposerProps {
  /** Where the text is kept while the user is away from it. Keyed by account, repo, item, and target. */
  draftKey: DraftKey;
  /** Used when there is no draft yet, for example the current text of a comment being edited. */
  initialText?: string;
  /** Text shown in the editor when it is empty. */
  placeholder: string;
  ariaLabel: string;
  /** The button label, for example "Comment" or "Save edit". */
  submitLabel: string;
  /** Renders the preview. The repo context is applied by the caller's preview function. */
  previewText: (text: string) => Promise<string>;
  /**
   * Sends the text. Resolve when saved; the box then clears. Resolve 'keep' when the text must stay,
   * for example after an edit conflict. Reject with a message the user can act on; the text is kept either way.
   */
  onSubmit: (text: string) => Promise<'keep' | void>;
  onCancel?: () => void;
  /** Links in the preview open outside Orbit, through the controlled external-open path. */
  onExternalLink: (href: string) => void;
  /** The item's own GitHub URL, used for the preview's "View on GitHub" fallback. */
  viewOnGitHubUrl: string;
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; html: string }
  | { status: 'error'; message: string };

const TOOLBAR: Array<{ kind: FormatKind; label: string; glyph: string; shortcut?: string }> = [
  { kind: 'bold', label: 'Bold', glyph: 'B', shortcut: 'Ctrl/Cmd+B' },
  { kind: 'italic', label: 'Italic', glyph: 'I', shortcut: 'Ctrl/Cmd+I' },
  { kind: 'code', label: 'Code', glyph: '<>', shortcut: 'Ctrl/Cmd+E' },
  { kind: 'link', label: 'Link', glyph: '🔗', shortcut: 'Ctrl/Cmd+K' },
  { kind: 'quote', label: 'Quote', glyph: '❝' },
  { kind: 'bullet', label: 'Bulleted list', glyph: '•' },
  { kind: 'numbered', label: 'Numbered list', glyph: '1.' },
  { kind: 'task', label: 'Task list', glyph: '☐' }
];

/**
 * Writes or edits one comment. Source editing with a Write and Preview tab. Text stays in memory
 * until it is submitted, so a failed send or a navigation never throws it away.
 */
export function Composer({
  draftKey,
  initialText,
  placeholder,
  ariaLabel,
  submitLabel,
  previewText,
  onSubmit,
  onCancel,
  onExternalLink,
  viewOnGitHubUrl
}: ComposerProps) {
  const [text, setText] = useState(() => drafts.get(draftKey) ?? initialText ?? '');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<CodeEditorHandle>(null);

  const length = countCharacters(text);
  const overLimit = isOverLimit(text);
  const empty = text.trim() === '';

  const change = (next: string): void => {
    setText(next);
    drafts.set(draftKey, next);
  };

  const loadPreview = (): void => {
    // An empty box has nothing to render, so it is shown as empty rather than sent to GitHub.
    if (text.trim() === '') {
      setPreview({ status: 'ready', html: '' });
      return;
    }
    setPreview({ status: 'loading' });
    previewText(text).then(
      (html) => setPreview({ status: 'ready', html }),
      (cause: unknown) =>
        setPreview({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'The preview could not be rendered.'
        })
    );
  };

  const showTab = (next: 'write' | 'preview'): void => {
    setTab(next);
    if (next === 'preview') loadPreview();
  };

  const send = (): void => {
    if (sending || empty || overLimit) return;
    setSending(true);
    setError(null);
    onSubmit(text).then(
      (outcome) => {
        setSending(false);
        if (outcome === 'keep') return;
        // Sent: the box is cleared and its draft is dropped.
        drafts.set(draftKey, '');
        setText(initialText ?? '');
      },
      (cause: unknown) => {
        setSending(false);
        setError(cause instanceof Error ? cause.message : 'That did not save. Your text is still here.');
      }
    );
  };

  const submitDisabled = sending || empty || overLimit;

  return (
    <div className="composer">
      <div className="composer-tabs" role="tablist" aria-label={`${ariaLabel} view`}>
        <button
          type="button"
          role="tab"
          id={`${draftKeyId(draftKey)}-write-tab`}
          aria-selected={tab === 'write'}
          aria-controls={`${draftKeyId(draftKey)}-panel`}
          className={tab === 'write' ? 'active' : ''}
          onClick={() => showTab('write')}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          aria-controls={`${draftKeyId(draftKey)}-panel`}
          className={tab === 'preview' ? 'active' : ''}
          onClick={() => showTab('preview')}
        >
          Preview
        </button>
      </div>

      <div id={`${draftKeyId(draftKey)}-panel`} role="tabpanel">
        {tab === 'write' ? (
          <>
            <div className="composer-toolbar" role="toolbar" aria-label="Formatting">
              {TOOLBAR.map((item) => (
                <button
                  type="button"
                  key={item.kind}
                  aria-label={item.label}
                  title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
                  onClick={() => editor.current?.format(item.kind)}
                >
                  {item.glyph}
                </button>
              ))}
            </div>
            <CodeEditor
              ref={editor}
              value={text}
              onChange={change}
              onSubmit={send}
              ariaLabel={ariaLabel}
              placeholder={placeholder}
            />
          </>
        ) : (
          <div className="composer-preview">
            {preview.status === 'loading' && <p role="status">Rendering preview…</p>}
            {preview.status === 'ready' && (
              <RichBody
                html={preview.html}
                viewOnGitHubUrl={viewOnGitHubUrl}
                onLink={onExternalLink}
                emptyText="Nothing to preview yet."
              />
            )}
            {preview.status === 'error' && (
              <div role="alert" className="composer-error">
                <p>{preview.message} Your text is still in the editor.</p>
                <button type="button" className="secondary-action" onClick={loadPreview}>
                  Retry preview
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="composer-footer">
        <p className={`composer-count ${overLimit ? 'over' : ''}`} role={overLimit ? 'alert' : undefined}>
          {overLimit
            ? `${length.toLocaleString('en-US')} of ${COMMENT_MAX_CHARS.toLocaleString('en-US')} characters. Shorten this comment to send it.`
            : `${length.toLocaleString('en-US')} / ${COMMENT_MAX_CHARS.toLocaleString('en-US')}`}
        </p>
        <div className="composer-actions">
          {onCancel && (
            <button type="button" className="text-action" onClick={onCancel} disabled={sending}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="primary-action"
            onClick={send}
            disabled={submitDisabled}
            title="Submit (Ctrl/Cmd+Enter)"
          >
            {sending ? 'Sending…' : submitLabel}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="composer-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** A stable id prefix for ARIA relationships, derived from the draft target. */
function draftKeyId(key: DraftKey): string {
  const target = key.target === 'new' ? 'new' : `comment-${key.target.commentId}`;
  return `composer-${key.kind}-${key.number}-${target}`.replace(/[^A-Za-z0-9-]/g, '-');
}
