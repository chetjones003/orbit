// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerProps } from '../../../src/renderer/src/comments/Composer';
import { drafts, type DraftKey } from '../../../src/renderer/src/comments/draft-store';

// jsdom cannot lay out CodeMirror, so the editor is the shared textarea stand-in.
vi.mock('../../../src/renderer/src/comments/CodeEditor', async () => {
  const { FakeCodeEditor } = await import('./fakes/fake-code-editor');
  return { CodeEditor: FakeCodeEditor };
});

const KEY: DraftKey = {
  login: 'orbit-owner',
  repoFullName: 'orbit-owner/app',
  kind: 'issue',
  number: 4,
  target: 'new'
};

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    draftKey: KEY,
    placeholder: 'Write a comment',
    ariaLabel: 'New comment',
    submitLabel: 'Comment',
    previewText: vi.fn(async (text: string) => `<p>${text}</p>`),
    onSubmit: vi.fn(async () => undefined),
    onExternalLink: vi.fn(),
    viewOnGitHubUrl: 'https://github.com/orbit-owner/app/issues/4',
    ...overrides
  };
  render(<Composer {...props} />);
  return props;
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

describe('Composer', () => {
  afterEach(() => {
    cleanup();
    drafts.clearAccount(KEY.login);
  });

  it('keeps what the user typed as a draft, so leaving and returning shows it again', () => {
    const { unmount } = render(
      <Composer
        draftKey={KEY}
        placeholder="Write a comment"
        ariaLabel="New comment"
        submitLabel="Comment"
        previewText={vi.fn()}
        onSubmit={vi.fn()}
        onExternalLink={vi.fn()}
        viewOnGitHubUrl="https://github.com/orbit-owner/app/issues/4"
      />
    );
    fireEvent.change(editor(), { target: { value: 'Still thinking about this' } });
    unmount();

    renderComposer();

    expect(editor().value).toBe('Still thinking about this');
  });

  it('sends the text with Ctrl+Enter, then clears the box and its draft once it is saved', async () => {
    const props = renderComposer();
    fireEvent.change(editor(), { target: { value: 'Thanks, fixed in 2.1' } });

    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(editor().value).toBe(''));
    expect(props.onSubmit).toHaveBeenCalledWith('Thanks, fixed in 2.1');
    expect(drafts.get(KEY)).toBeUndefined();
  });

  it('keeps the text and says why when sending fails, so nothing typed is lost', async () => {
    renderComposer({
      onSubmit: vi.fn(async () => Promise.reject(new Error('GitHub is unavailable (503).')))
    });
    fireEvent.change(editor(), { target: { value: 'Please keep me' } });

    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub is unavailable (503).');
    expect(editor().value).toBe('Please keep me');
    expect(drafts.get(KEY)).toBe('Please keep me');
  });

  it('blocks submitting an empty comment', () => {
    const props = renderComposer();
    fireEvent.change(editor(), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('shows the count and blocks submit over the 65,536 character limit', () => {
    const props = renderComposer();
    fireEvent.change(editor(), { target: { value: 'x'.repeat(65_537) } });

    expect(screen.getByText(/65,537 of 65,536 characters/)).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('renders the Markdown preview in the repo context and returns to the same text', async () => {
    const props = renderComposer();
    fireEvent.change(editor(), { target: { value: 'Hi **there**' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));

    await waitFor(() => expect(props.previewText).toHaveBeenCalledWith('Hi **there**'));
    expect(await screen.findByText('Hi **there**')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Write' }));
    expect(editor().value).toBe('Hi **there**');
  });

  it('shows the empty-state preview for an empty box without asking GitHub to render nothing', async () => {
    const props = renderComposer();

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));

    expect(await screen.findByText('Nothing to preview yet.')).toBeInTheDocument();
    expect(props.previewText).not.toHaveBeenCalled();
  });

  it('keeps the text when the preview fails, and retries the preview on request', async () => {
    const previewText = vi
      .fn<(text: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('Preview is unavailable.'))
      .mockResolvedValueOnce('<p>ok</p>');
    renderComposer({ previewText });
    fireEvent.change(editor(), { target: { value: 'draft text' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Preview is unavailable.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(await screen.findByText('ok')).toBeInTheDocument();
    expect(previewText).toHaveBeenCalledTimes(2);
  });

  it('applies bold from the toolbar to the selected text', () => {
    renderComposer();
    fireEvent.change(editor(), { target: { value: 'hello world' } });
    editor().setSelectionRange(6, 11);

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

    expect(editor().value).toBe('hello **world**');
  });
});
