// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerProps } from '../../../src/renderer/src/comments/Composer';
import { drafts, type DraftKey } from '../../../src/renderer/src/comments/draft-store';

// jsdom cannot lay out CodeMirror, so the editor is the shared textarea stand-in.
vi.mock('../../../src/renderer/src/comments/CodeEditor', async () => {
  const { FakeCodeEditor } = await import('./fakes/fake-code-editor');
  return { CodeEditor: FakeCodeEditor };
});

const REPO = 'orbit-owner/app';
const KEY: DraftKey = { login: 'orbit-owner', repoFullName: REPO, kind: 'issue', number: 4, target: 'new' };
const URL_OK = 'https://github.com/user-attachments/assets/3f2a-91bc';
const ITEM_URL = 'https://github.com/orbit-owner/app/issues/4';

const orbit = {
  attachments: { upload: vi.fn() },
  app: { openExternal: vi.fn(async () => ({ opened: true })) }
};

function image(name = 'shot.png'): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
}

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    draftKey: KEY,
    placeholder: 'Write a comment',
    ariaLabel: 'New comment',
    submitLabel: 'Comment',
    previewText: vi.fn(async (text: string) => `<p>${text}</p>`),
    onSubmit: vi.fn(async () => undefined),
    onExternalLink: vi.fn(),
    viewOnGitHubUrl: ITEM_URL,
    attachTo: { repoFullName: REPO },
    ...overrides
  };
  render(<Composer {...props} />);
  return props;
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

function paste(files: File[]): void {
  fireEvent.paste(editor(), { clipboardData: { files, types: ['Files'], getData: () => '' } });
}

describe('Composer attachments', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'orbit', { value: orbit, configurable: true, writable: true });
    orbit.attachments.upload.mockReset();
    orbit.app.openExternal.mockClear();
  });

  afterEach(() => {
    cleanup();
    drafts.clearAccount(KEY.login);
  });

  it('puts an uploading placeholder at the cursor, then replaces it with the image link', async () => {
    orbit.attachments.upload.mockResolvedValue({ kind: 'uploaded', url: URL_OK });
    renderComposer();
    fireEvent.change(editor(), { target: { value: 'Before ' } });
    editor().setSelectionRange(7, 7);

    paste([image()]);

    expect(editor().value).toContain('![Uploading shot.png (1)]()');
    await waitFor(() => expect(editor().value).toBe(`Before ![shot.png](${URL_OK})`));
    expect(orbit.attachments.upload).toHaveBeenCalledWith(
      REPO,
      expect.objectContaining({ name: 'shot.png' }),
      { acknowledgedPublic: false }
    );
  });

  it('shows an inline error with Retry and Open on GitHub, and keeps the text when the upload fails', async () => {
    orbit.attachments.upload
      .mockRejectedValueOnce(new Error('GitHub returned 422.'))
      .mockResolvedValueOnce({ kind: 'uploaded', url: URL_OK });
    renderComposer();

    paste([image()]);

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub returned 422.');
    expect(screen.getByRole('button', { name: 'Open on GitHub' })).toBeInTheDocument();
    expect(editor().value).toContain('![Uploading shot.png (1)]()');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(editor().value).toBe(`![shot.png](${URL_OK})`));
  });

  it('Open on GitHub copies the draft and opens the item so the file can be attached there', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    orbit.attachments.upload.mockRejectedValue(new Error('GitHub returned 422.'));
    renderComposer();
    fireEvent.change(editor(), { target: { value: 'Repro below' } });

    paste([image()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open on GitHub' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Repro below')));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('![Uploading shot.png (1)]()'));
    expect(orbit.app.openExternal).toHaveBeenCalledWith(ITEM_URL);
  });

  it('asks before the first upload to a public repo, then uploads once the user accepts', async () => {
    orbit.attachments.upload
      .mockResolvedValueOnce({ kind: 'public-notice' })
      .mockResolvedValueOnce({ kind: 'uploaded', url: URL_OK });
    renderComposer();

    paste([image()]);

    expect(await screen.findByText(/public on GitHub as soon as it uploads/)).toBeInTheDocument();
    expect(orbit.attachments.upload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Upload anyway' }));

    await waitFor(() => expect(editor().value).toBe(`![shot.png](${URL_OK})`));
    expect(orbit.attachments.upload).toHaveBeenLastCalledWith(REPO, expect.anything(), {
      acknowledgedPublic: true
    });
  });

  it('refuses an unsupported file in the browser, with the reason, without uploading it', async () => {
    renderComposer();

    paste([new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' })]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Attach a PNG, JPG, GIF, WebP, SVG, MP4, MOV, or WebM file.'
    );
    expect(orbit.attachments.upload).not.toHaveBeenCalled();
    expect(editor().value).toBe('');
  });

  it('will not send while an attachment is still uploading, so the placeholder never gets posted', async () => {
    let finishUpload: (result: { kind: 'uploaded'; url: string }) => void = () => undefined;
    orbit.attachments.upload.mockReturnValue(
      new Promise((resolve) => {
        finishUpload = resolve;
      })
    );
    const props = renderComposer();

    paste([image()]);
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
    // Settle the pending upload so no promise outlives the test.
    finishUpload({ kind: 'uploaded', url: URL_OK });
    await waitFor(() => expect(editor().value).toBe(`![shot.png](${URL_OK})`));
  });

  it('ignores pasted files when the composer has no repo to upload to', async () => {
    renderComposer({ attachTo: undefined });

    paste([image()]);

    expect(orbit.attachments.upload).not.toHaveBeenCalled();
    expect(editor().value).toBe('');
  });
});
