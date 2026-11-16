// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueDetailView } from '../../../src/renderer/src/issues/IssueDetail';
import { drafts } from '../../../src/renderer/src/comments/draft-store';
import type { IssueComment, IssueDetail, IssueSummary } from '../../../src/shared/issues';
import { projectsStub } from './fakes/projects';

vi.mock('../../../src/renderer/src/comments/CodeEditor', async () => {
  const { FakeCodeEditor } = await import('./fakes/fake-code-editor');
  return { CodeEditor: FakeCodeEditor };
});

const SUMMARY: IssueSummary = {
  id: 104,
  number: 4,
  title: 'Crash on save',
  state: 'open',
  stateReason: null,
  assignees: [],
  milestone: null,
  authorLogin: 'someone',
  labels: [],
  commentCount: 2,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-03T00:00:00Z',
  htmlUrl: 'https://github.com/orbit-owner/app/issues/4'
};

const MINE: IssueComment = {
  id: 9,
  authorLogin: 'orbit-owner',
  createdAt: '2026-01-04T00:00:00Z',
  updatedAt: '2026-01-04T00:00:00Z',
  htmlUrl: 'https://github.com/orbit-owner/app/issues/4#issuecomment-9',
  body: 'Original text',
  bodyHtml: '<p>Original text</p>'
};

const THEIRS: IssueComment = {
  id: 10,
  authorLogin: 'commenter',
  createdAt: '2026-01-05T00:00:00Z',
  updatedAt: '2026-01-05T00:00:00Z',
  htmlUrl: 'https://github.com/orbit-owner/app/issues/4#issuecomment-10',
  body: 'Someone else',
  bodyHtml: '<p>Someone else</p>'
};

function detail(): IssueDetail {
  return { summary: SUMMARY, bodyHtml: '<p>Body</p>', comments: [MINE, THEIRS], commentsPartial: false };
}

function renderView(kind: 'issue' | 'pull' = 'issue') {
  render(
    <IssueDetailView
      repoFullName="orbit-owner/app"
      number={4}
      signedInLogin="orbit-owner"
      kind={kind}
      onOpenIssue={vi.fn()}
    />
  );
}

let api: {
  issues: { detail: ReturnType<typeof vi.fn> };
  pulls: { detail: ReturnType<typeof vi.fn> };
  markdown: { preview: ReturnType<typeof vi.fn> };
  comments: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  app: { openExternal: ReturnType<typeof vi.fn> };
};

/** Opens the comment menu and picks an action from it. */
function clickCommentAction(name: 'Edit' | 'Delete'): void {
  fireEvent.click(screen.getAllByRole('button', { name: 'Comment options' })[0] as HTMLElement);
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

describe('IssueDetailView comments', () => {
  beforeEach(() => {
    api = {
      projects: projectsStub(),
      issues: {
        links: vi.fn(async () => ({ pulls: [], commits: [], partial: false })),
        detail: vi.fn(async () => detail()),
        repoOptions: vi.fn(async () => ({ labels: [], assignees: [], milestones: [] }))
      },
      pulls: {
        detail: vi.fn(async () => detail()),
        files: vi.fn(async () => ({ files: [], partial: false })),
        threads: vi.fn(async () => ({ threads: [], partial: false })),
        actions: vi.fn(async () => ({
          headSha: 'head-1',
          headRef: 'feature',
          headInRepo: true,
          draft: false,
          merged: false,
          state: 'open',
          allowedMergeMethods: ['merge'],
          allowAutoMerge: false,
          autoMergeMethod: null,
          deleteBranchOnMerge: false
        })),
        runs: vi.fn(async () => [])
      },
      markdown: { preview: vi.fn(async (_repo: string, text: string) => `<p>${text}</p>`) },
      comments: {
        create: vi.fn(async (_repo: string, _number: number, body: string) => ({
          ...MINE,
          id: 11,
          body,
          bodyHtml: `<p>${body}</p>`
        })),
        update: vi.fn(),
        delete: vi.fn(async () => undefined)
      },
      app: { openExternal: vi.fn(async () => ({ opened: true })) }
    };
    window.orbit = api as unknown as typeof window.orbit;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) }
    });
  });

  afterEach(() => {
    cleanup();
    drafts.clearAccount('orbit-owner');
    vi.restoreAllMocks();
  });

  it('posts a new comment at the end of the thread and announces it', async () => {
    renderView();
    await screen.findByText('Original text');

    fireEvent.change(screen.getByRole('textbox', { name: 'Write a comment' }), {
      target: { value: 'Thanks!' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByText('Thanks!')).toBeInTheDocument();
    expect(api.comments.create).toHaveBeenCalledWith('orbit-owner/app', 4, 'Thanks!');
    expect(screen.getByRole('status')).toHaveTextContent('Comment posted');
  });

  it("offers Edit and Delete only on the signed-in user's own comments", async () => {
    renderView();
    await screen.findByText('Original text');

    expect(screen.getAllByRole('button', { name: 'Comment options' })).toHaveLength(1);
  });

  it('saves an edit against the version it started from and updates the comment in place', async () => {
    api.comments.update.mockResolvedValueOnce({
      kind: 'saved',
      comment: {
        ...MINE,
        body: 'Fixed text',
        bodyHtml: '<p>Fixed text</p>',
        updatedAt: '2026-01-10T00:00:00Z'
      }
    });
    renderView();
    await screen.findByText('Original text');

    clickCommentAction('Edit');
    const editor = screen.getByRole('textbox', { name: 'Edit comment' });
    expect(editor).toHaveValue('Original text');
    fireEvent.change(editor, { target: { value: 'Fixed text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Edit comment' })).not.toBeInTheDocument()
    );
    expect(screen.getByText('Fixed text', { selector: 'p' })).toBeInTheDocument();
    expect(api.comments.update).toHaveBeenCalledWith(
      'orbit-owner/app',
      9,
      'Fixed text',
      '2026-01-04T00:00:00Z'
    );
  });

  it('keeps the edit and offers three ways forward when GitHub has a newer version', async () => {
    const newer = {
      ...MINE,
      body: 'Their edit',
      bodyHtml: '<p>Their edit</p>',
      updatedAt: '2026-01-09T00:00:00Z'
    };
    api.comments.update.mockResolvedValueOnce({ kind: 'conflict', current: newer }).mockResolvedValueOnce({
      kind: 'saved',
      comment: { ...newer, body: 'Fixed text', bodyHtml: '<p>Fixed text</p>' }
    });
    renderView();
    await screen.findByText('Original text');

    clickCommentAction('Edit');
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit comment' }), {
      target: { value: 'Fixed text' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('changed on GitHub');
    expect(screen.getByRole('textbox', { name: 'Edit comment' })).toHaveValue('Fixed text');

    fireEvent.click(screen.getByRole('button', { name: 'View theirs' }));
    expect(await screen.findByText('Their edit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite with mine' }));
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Edit comment' })).not.toBeInTheDocument()
    );
    // The overwrite is made against GitHub's newer version, so it applies cleanly.
    expect(api.comments.update).toHaveBeenLastCalledWith(
      'orbit-owner/app',
      9,
      'Fixed text',
      '2026-01-09T00:00:00Z'
    );
  });

  it('copies my version to the clipboard and keeps theirs on the page', async () => {
    const newer = {
      ...MINE,
      body: 'Their edit',
      bodyHtml: '<p>Their edit</p>',
      updatedAt: '2026-01-09T00:00:00Z'
    };
    api.comments.update.mockResolvedValueOnce({ kind: 'conflict', current: newer });
    renderView();
    await screen.findByText('Original text');

    clickCommentAction('Edit');
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit comment' }), {
      target: { value: 'Mine only' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Copy mine' }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Mine only'));
    expect(await screen.findByText('Their edit')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Edit comment' })).not.toBeInTheDocument();
  });

  it('deletes an own comment after the user confirms', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderView();
    await screen.findByText('Original text');

    clickCommentAction('Delete');

    await waitFor(() => expect(screen.queryByText('Original text')).not.toBeInTheDocument());
    expect(api.comments.delete).toHaveBeenCalledWith('orbit-owner/app', 9);
    expect(screen.getByRole('status')).toHaveTextContent('Comment deleted');
  });

  it('does not delete when the user declines the confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderView();
    await screen.findByText('Original text');

    clickCommentAction('Delete');

    expect(api.comments.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Original text')).toBeInTheDocument();
  });

  it('shows no composer or comment actions on pull requests yet', async () => {
    renderView('pull');
    await screen.findByText('Original text');

    expect(screen.queryByRole('textbox', { name: 'Write a comment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Comment options' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Comments' })).queryByRole('button', {
        name: 'Comment options'
      })
    ).toBeNull();
  });
});
