import { useRef, useState } from 'react';
import { COMMENT_MAX_CHARS } from '../../../shared/issues';
import {
  attachmentMarkdown,
  checkAttachment,
  replaceFirst,
  uploadPlaceholder
} from '../../../shared/attachments';
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
  /** Lets an empty box be sent, for example an issue whose description is optional. */
  allowEmpty?: boolean;
  /** Blocks sending for a reason the text box cannot see, such as a missing title. */
  submitDisabled?: boolean;
  /** Links in the preview open outside Orbit, through the controlled external-open path. */
  onExternalLink: (href: string) => void;
  /** The item's own GitHub URL, used for the preview's "View on GitHub" fallback. */
  viewOnGitHubUrl: string;
  /** When set, files can be attached to this repo: from the Attach button, a paste, or a drop. */
  attachTo?: { repoFullName: string };
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; html: string }
  | { status: 'error'; message: string };

/** One attachment on its way into the text. Failed and waiting uploads keep their file so they can be retried. */
interface Upload {
  id: number;
  name: string;
  /** The text standing in for the file in the editor. Empty when the file was refused before any placeholder. */
  placeholder: string;
  file: File;
  status: 'uploading' | 'notice' | 'failed';
  message?: string;
}

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

const ATTACHMENT_EXTENSIONS = '.png,.jpg,.jpeg,.gif,.webp,.svg,.mp4,.mov,.webm';

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
  allowEmpty = false,
  submitDisabled: blockedByCaller = false,
  onExternalLink,
  viewOnGitHubUrl,
  attachTo
}: ComposerProps) {
  const [text, setText] = useState(() => drafts.get(draftKey) ?? initialText ?? '');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const editor = useRef<CodeEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Uploads finish asynchronously, so they read the latest text here rather than from a render's closure.
  const textRef = useRef(text);
  const nextUploadId = useRef(0);

  const length = countCharacters(text);
  const overLimit = isOverLimit(text);
  const empty = text.trim() === '';
  const attaching = uploads.length > 0;

  const change = (next: string): void => {
    textRef.current = next;
    setText(next);
    drafts.set(draftKey, next);
  };

  /** Inserts at an offset through the editor, so the cursor and undo history stay with the user. */
  const insertAt = (at: number, insert: string): void => {
    const from = Math.min(at, textRef.current.length);
    if (editor.current) {
      editor.current.apply({
        changes: { from, to: from, insert },
        selection: { anchor: from + insert.length, head: from + insert.length }
      });
    } else {
      change(textRef.current.slice(0, from) + insert + textRef.current.slice(from));
    }
  };

  /** Swaps the placeholder for its Markdown, or removes it when `markdown` is empty. A placeholder the user deleted is left alone. */
  const replacePlaceholder = (placeholderText: string, markdown: string): void => {
    if (placeholderText === '') return;
    const at = textRef.current.indexOf(placeholderText);
    if (at === -1) return;
    if (editor.current) {
      editor.current.apply({
        changes: { from: at, to: at + placeholderText.length, insert: markdown },
        selection: { anchor: at + markdown.length, head: at + markdown.length }
      });
    } else {
      change(replaceFirst(textRef.current, placeholderText, markdown));
    }
  };

  const updateUpload = (id: number, patch: Partial<Upload>): void => {
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  };

  const dismissUpload = (upload: Upload): void => {
    replacePlaceholder(upload.placeholder, '');
    setUploads((list) => list.filter((u) => u.id !== upload.id));
  };

  /** Uploads one file. A refusal made in the browser never reaches main. */
  const runUpload = (upload: Upload, acknowledgedPublic: boolean): void => {
    const check = checkAttachment({ name: upload.name, size: upload.file.size }, 'paid');
    if (!check.ok) {
      updateUpload(upload.id, { status: 'failed', message: check.message });
      return;
    }
    updateUpload(upload.id, { status: 'uploading', message: undefined });
    readBytes(upload.file)
      .then((bytes) =>
        window.orbit.attachments.upload(
          attachTo?.repoFullName ?? '',
          { name: upload.name, bytes },
          { acknowledgedPublic }
        )
      )
      .then(
        (result) => {
          if (result.kind === 'public-notice') {
            updateUpload(upload.id, { status: 'notice' });
            return;
          }
          replacePlaceholder(upload.placeholder, attachmentMarkdown(check.kind, upload.name, result.url));
          setUploads((list) => list.filter((u) => u.id !== upload.id));
        },
        (cause: unknown) =>
          updateUpload(upload.id, {
            status: 'failed',
            message: cause instanceof Error ? cause.message : 'The upload did not finish.'
          })
      );
  };

  /** Puts a placeholder at each offset, then uploads each file. Unsupported files show their error without a placeholder. */
  const attachFiles = (files: File[], at: number): void => {
    let offset = at;
    for (const file of files) {
      nextUploadId.current += 1;
      const id = nextUploadId.current;
      const check = checkAttachment({ name: file.name, size: file.size }, 'paid');
      if (!check.ok) {
        setUploads((list) => [
          ...list,
          { id, name: file.name, placeholder: '', file, status: 'failed', message: check.message }
        ]);
        continue;
      }
      const placeholderText = uploadPlaceholder(id, file.name);
      insertAt(offset, placeholderText);
      offset += placeholderText.length;
      const upload: Upload = { id, name: file.name, placeholder: placeholderText, file, status: 'uploading' };
      setUploads((list) => [...list, upload]);
      runUpload(upload, false);
    }
  };

  const openOnGitHub = (): void => {
    // The item opens in the browser with the draft on the clipboard, so the file can be attached there.
    // Placeholders stand for files that never reached GitHub, so they are left out of the copied draft.
    const draft = uploads.reduce(
      (text, upload) => replaceFirst(text, upload.placeholder, ''),
      textRef.current
    );
    void navigator.clipboard?.writeText(draft).catch(() => undefined);
    void window.orbit.app.openExternal(viewOnGitHubUrl);
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
    if (sending || (!allowEmpty && empty) || overLimit || blockedByCaller || attaching) return;
    setSending(true);
    setError(null);
    onSubmit(text).then(
      (outcome) => {
        setSending(false);
        if (outcome === 'keep') return;
        // Sent: the box is cleared and its draft is dropped.
        drafts.set(draftKey, '');
        textRef.current = initialText ?? '';
        setText(initialText ?? '');
      },
      (cause: unknown) => {
        setSending(false);
        setError(cause instanceof Error ? cause.message : 'That did not save. Your text is still here.');
      }
    );
  };

  const submitDisabled = sending || (!allowEmpty && empty) || overLimit || blockedByCaller || attaching;

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
              {attachTo && (
                <>
                  <button
                    type="button"
                    aria-label="Attach file"
                    title="Attach a PNG, JPG, GIF, WebP, SVG, MP4, MOV, or WebM"
                    onClick={() => fileInput.current?.click()}
                  >
                    📎
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept={ATTACHMENT_EXTENSIONS}
                    multiple
                    hidden
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      // Clear the input so picking the same file again still fires a change.
                      event.target.value = '';
                      if (files.length > 0)
                        attachFiles(files, editor.current?.cursor() ?? textRef.current.length);
                    }}
                  />
                </>
              )}
            </div>
            <CodeEditor
              ref={editor}
              value={text}
              onChange={change}
              onSubmit={send}
              ariaLabel={ariaLabel}
              placeholder={placeholder}
              onFiles={attachTo ? attachFiles : undefined}
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

      {uploads.length > 0 && (
        <ul className="composer-uploads">
          {uploads.map((upload) => (
            <li key={upload.id}>
              {upload.status === 'uploading' && <p role="status">Uploading {upload.name}…</p>}
              {upload.status === 'notice' && (
                <div role="alert" className="composer-error">
                  <p>
                    This repo is public. {upload.name} becomes public on GitHub as soon as it uploads, and
                    anyone with the link can open it. Orbit will not ask again.
                  </p>
                  <button type="button" className="primary-action" onClick={() => runUpload(upload, true)}>
                    Upload anyway
                  </button>
                  <button type="button" className="text-action" onClick={() => dismissUpload(upload)}>
                    Remove
                  </button>
                </div>
              )}
              {upload.status === 'failed' && (
                <div role="alert" className="composer-error">
                  <p>
                    {upload.name} was not attached. {upload.message} Your text is still here.
                  </p>
                  <button type="button" className="secondary-action" onClick={() => runUpload(upload, false)}>
                    Retry
                  </button>
                  <button type="button" className="secondary-action" onClick={openOnGitHub}>
                    Open on GitHub
                  </button>
                  <button type="button" className="text-action" onClick={() => dismissUpload(upload)}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

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
            title={attaching ? 'Finish or remove the attachments first' : 'Submit (Ctrl/Cmd+Enter)'}
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

/** The file's bytes, read in the renderer and handed to main, which makes the upload request. */
async function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}

/** A stable id prefix for ARIA relationships, derived from the draft target. */
function draftKeyId(key: DraftKey): string {
  const target = typeof key.target === 'string' ? key.target : `comment-${key.target.commentId}`;
  return `composer-${key.kind}-${key.number}-${target}`.replace(/[^A-Za-z0-9-]/g, '-');
}
