// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PullDiffView } from '../../../src/renderer/src/issues/PullDiff';
import { drafts } from '../../../src/renderer/src/comments/draft-store';
import type { PullFile, PullReviewState, PullReviewThread } from '../../../src/shared/issues';

const PATCH = '@@ -1,2 +1,2 @@\n-old line\n+new line\n same';

function file(overrides: Partial<PullFile> = {}): PullFile {
  return {
    filename: 'src/a.ts',
    previousFilename: null,
    status: 'modified',
    additions: 1,
    deletions: 1,
    patch: PATCH,
    noPatchReason: null,
    ...overrides
  };
}

function thread(overrides: Partial<PullReviewThread> = {}): PullReviewThread {
  return {
    id: 'T1',
    path: 'src/a.ts',
    line: 2,
    originalLine: 2,
    isResolved: false,
    isOutdated: false,
    diffHunk: '@@ -1,2 +1,2 @@',
    comments: [
      {
        id: 501,
        authorLogin: 'reviewer',
        createdAt: '2026-01-04T00:00:00Z',
        htmlUrl: 'https://github.com/orbit-owner/app/pull/7#r501',
        body: 'Rename this',
        bodyHtml: '<p>Rename this</p>'
      }
    ],
    commentsPartial: false,
    ...overrides
  };
}

function review(overrides: Partial<PullReviewState> = {}): PullReviewState {
  return { headSha: 'head-1', isOwnPull: false, pending: null, ...overrides };
}

interface MockOptions {
  state?: PullReviewState;
  threads?: PullReviewThread[];
}

/** Installs window.orbit with the pull-request reads and review writes the panel uses. */
function mockOrbit({ state = review(), threads = [] }: MockOptions = {}) {
  const api = {
    pulls: {
      files: vi.fn(async () => ({ files: [file()], partial: false })),
      threads: vi.fn(async () => ({ threads, partial: false })),
      reviewState: vi.fn(async () => state),
      addReviewComment: vi.fn(async () => ({
        kind: 'saved',
        comment: { id: 900, path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'Nit' }
      })),
      replyToReviewThread: vi.fn(async () => ({
        kind: 'saved',
        comment: { id: 902, path: 'src/a.ts', side: 'RIGHT', line: 2, body: 'Reply' }
      })),
      setReviewThreadResolved: vi.fn(async () => true),
      submitReview: vi.fn(async () => ({ kind: 'submitted' }))
    },
    app: { openExternal: vi.fn(async () => ({ opened: true })) }
  };
  window.orbit = api as unknown as typeof window.orbit;
  return api;
}

function renderView() {
  return render(
    <PullDiffView repoFullName="orbit-owner/app" number={7} onLink={vi.fn()} signedInLogin="orbit-owner" />
  );
}

/** The gutter cell for a new-side line, which opens the comment box when clicked. */
function clickNewLineGutter(container: HTMLElement, lineNumber: number) {
  const cell = [...container.querySelectorAll('td')].find(
    (td) => td.classList.contains('diff-gutter-insert') && td.textContent?.trim() === String(lineNumber)
  );
  if (!cell) throw new Error(`no gutter cell for line ${lineNumber}`);
  fireEvent.click(cell);
}

describe('PullDiffView review', () => {
  afterEach(() => {
    cleanup();
    drafts.clearAccount('orbit-owner');
  });

  it('keeps unsent review text when the pull request is left and reopened', async () => {
    mockOrbit();
    const first = renderView();
    await screen.findByText('new line');
    clickNewLineGutter(first.container, 1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment on src/a.ts, new side, line 1' }), {
      target: { value: 'Half written' }
    });
    first.unmount();

    const second = renderView();
    await screen.findByText('new line');
    clickNewLineGutter(second.container, 1);
    expect(
      (screen.getByRole('textbox', { name: 'Comment on src/a.ts, new side, line 1' }) as HTMLTextAreaElement)
        .value
    ).toBe('Half written');
  });

  it('shows the pending review recovered from GitHub, with its count and comments', async () => {
    mockOrbit({
      state: review({
        pending: {
          id: 'REV_1',
          commitSha: 'head-1',
          comments: [{ id: 900, path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'Nit about naming' }],
          commentsPartial: false
        }
      })
    });
    renderView();

    expect(await screen.findByText('1 pending comment')).toBeTruthy();
    expect(screen.getByText('Nit about naming')).toBeTruthy();
    expect(screen.getByText('src/a.ts, new side, line 1')).toBeTruthy();
  });

  it('saves a comment on a clicked diff line, anchored to that line, into the pending review', async () => {
    const api = mockOrbit();
    const { container } = renderView();
    await screen.findByText('new line');

    clickNewLineGutter(container, 1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment on src/a.ts, new side, line 1' }), {
      target: { value: 'Nit' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() =>
      expect(api.pulls.addReviewComment).toHaveBeenCalledWith('orbit-owner/app', 7, {
        anchor: { path: 'src/a.ts', side: 'RIGHT', line: 1 },
        body: 'Nit',
        reviewedHeadSha: 'head-1'
      })
    );
  });

  it('keeps the comment text and says so when new commits arrive before it is saved', async () => {
    const api = mockOrbit();
    api.pulls.addReviewComment.mockResolvedValueOnce({ kind: 'new-commits', headSha: 'head-2' } as never);
    const { container } = renderView();
    await screen.findByText('new line');

    clickNewLineGutter(container, 1);
    const box = screen.getByRole('textbox', { name: 'Comment on src/a.ts, new side, line 1' });
    fireEvent.change(box, { target: { value: 'Nit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/New commits/);
    expect(
      (screen.getByRole('textbox', { name: 'Comment on src/a.ts, new side, line 1' }) as HTMLTextAreaElement)
        .value
    ).toBe('Nit');
  });

  it('pauses commenting and submitting after new commits until they are acknowledged', async () => {
    mockOrbit({
      state: review({
        headSha: 'head-2',
        pending: { id: 'REV_1', commitSha: 'head-1', comments: [], commentsPartial: false }
      })
    });
    renderView();

    expect(await screen.findByRole('button', { name: 'Acknowledge new commits' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect((screen.getByRole('button', { name: 'Submit review' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge new commits' }));
    expect((screen.getByRole('button', { name: 'Submit review' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('resolves a thread, then offers to reopen it', async () => {
    const api = mockOrbit({ threads: [thread()] });
    // GitHub holds the resolved state once the write has landed; the reload that follows reads it.
    let resolved = false;
    api.pulls.setReviewThreadResolved.mockImplementation(async () => {
      resolved = true;
      return true;
    });
    api.pulls.threads.mockImplementation(async () => ({
      threads: [thread({ isResolved: resolved })],
      partial: false
    }));
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve thread' }));

    await waitFor(() =>
      expect(api.pulls.setReviewThreadResolved).toHaveBeenCalledWith('orbit-owner/app', 7, 'T1', true)
    );
    expect(await screen.findByRole('button', { name: 'Reopen thread' })).toBeTruthy();
  });

  it('replies to a thread into the pending review', async () => {
    const api = mockOrbit({ threads: [thread()] });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply to thread on src/a.ts' }), {
      target: { value: 'Reply' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() =>
      expect(api.pulls.replyToReviewThread).toHaveBeenCalledWith('orbit-owner/app', 7, {
        threadId: 'T1',
        body: 'Reply',
        reviewedHeadSha: 'head-1'
      })
    );
  });

  it('offers Comment, Approve, and Request changes, and no approval on the user own pull request', async () => {
    mockOrbit({ state: review({ isOwnPull: true }) });
    renderView();
    await screen.findByText('new line');
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));

    expect((screen.getByRole('radio', { name: 'Comment' }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('radio', { name: 'Approve' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: 'Request changes' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('submits the review with the chosen event and summary', async () => {
    const api = mockOrbit();
    renderView();
    await screen.findByText('new line');
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Request changes' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Review summary' }), {
      target: { value: 'Fix naming' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

    await waitFor(() =>
      expect(api.pulls.submitReview).toHaveBeenCalledWith('orbit-owner/app', 7, {
        event: 'REQUEST_CHANGES',
        body: 'Fix naming',
        reviewedHeadSha: 'head-1'
      })
    );
  });

  it('keeps the summary when submission fails', async () => {
    const api = mockOrbit();
    api.pulls.submitReview.mockRejectedValueOnce(new Error('GitHub returned 503.'));
    renderView();
    await screen.findByText('new line');
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Review summary' }), {
      target: { value: 'Keep me' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Review summary' }) as HTMLTextAreaElement).value).toBe(
      'Keep me'
    );
  });
});

describe('PullDiffView refresh and in-flight saves', () => {
  afterEach(() => {
    cleanup();
    drafts.clearAccount('orbit-owner');
  });

  it('makes a comment box read-only while its save is in flight, so typed text is never cleared unsent', async () => {
    const api = mockOrbit();
    let finish: (value: unknown) => void = () => undefined;
    api.pulls.addReviewComment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never
    );
    const { container } = renderView();
    await screen.findByText('new line');
    clickNewLineGutter(container, 1);
    const box = screen.getByRole('textbox', {
      name: 'Comment on src/a.ts, new side, line 1'
    }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Nit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => expect(box.disabled).toBe(true));
    finish({ kind: 'saved', comment: { id: 900, path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'Nit' } });
  });

  it('reloads the changed files on refresh', async () => {
    const api = mockOrbit({
      state: review({
        headSha: 'head-2',
        pending: { id: 'REV_1', commitSha: 'head-1', comments: [], commentsPartial: false }
      })
    });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(api.pulls.files.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('keeps acknowledgement off when the diff cannot be reloaded after new commits', async () => {
    const api = mockOrbit({
      state: review({
        headSha: 'head-2',
        pending: { id: 'REV_1', commitSha: 'head-1', comments: [], commentsPartial: false }
      })
    });
    let calls = 0;
    api.pulls.files.mockImplementation(async () => {
      calls += 1;
      if (calls > 1) throw new Error('offline');
      return { files: [file()], partial: false };
    });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText(/could not be reloaded/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Acknowledge new commits' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe('PullDiffView round 2 regressions', () => {
  afterEach(() => {
    cleanup();
    drafts.clearAccount('orbit-owner');
  });

  it('does not close or clear a newer box for the same line when an older save finishes', async () => {
    const api = mockOrbit();
    let finish: (value: unknown) => void = () => undefined;
    api.pulls.addReviewComment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never
    );
    const { container } = renderView();
    await screen.findByText('new line');
    clickNewLineGutter(container, 1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment on src/a.ts, new side, line 1' }), {
      target: { value: 'Nit' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(api.pulls.addReviewComment).toHaveBeenCalled());

    // Move the composer to another line, return to line 1, and type newer text there.
    const lineTwo = [...container.querySelectorAll('td.diff-gutter-normal')].filter(
      (td) => td.textContent?.trim() === '2'
    );
    fireEvent.click(lineTwo[lineTwo.length - 1]);
    clickNewLineGutter(container, 1);
    const newer = screen.getByRole('textbox', {
      name: 'Comment on src/a.ts, new side, line 1'
    }) as HTMLTextAreaElement;
    fireEvent.change(newer, { target: { value: 'Nit, revised' } });

    finish({ kind: 'saved', comment: { id: 900, path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'Nit' } });

    await waitFor(() => expect(api.pulls.reviewState.mock.calls.length).toBeGreaterThan(1));
    const still = screen.getByRole('textbox', {
      name: 'Comment on src/a.ts, new side, line 1'
    }) as HTMLTextAreaElement;
    expect(still.value).toBe('Nit, revised');
  });

  it('disables Cancel while a save is in flight', async () => {
    const api = mockOrbit();
    api.pulls.addReviewComment.mockImplementationOnce(() => new Promise(() => undefined) as never);
    const { container } = renderView();
    await screen.findByText('new line');
    clickNewLineGutter(container, 1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment on src/a.ts, new side, line 1' }), {
      target: { value: 'Nit' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    );
  });

  it('keeps acknowledgement off until the files for the new head have loaded', async () => {
    const api = mockOrbit({
      state: review({
        headSha: 'head-2',
        pending: { id: 'REV_1', commitSha: 'head-1', comments: [], commentsPartial: false }
      })
    });
    let release: (value: unknown) => void = () => undefined;
    let calls = 0;
    api.pulls.files.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return { files: [file()], partial: false };
      return new Promise((resolve) => {
        release = resolve;
      }) as never;
    });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(calls).toBe(2));

    expect(
      (screen.getByRole('button', { name: 'Acknowledge new commits' }) as HTMLButtonElement).disabled
    ).toBe(true);
    release({ files: [file()], partial: false });
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Acknowledge new commits' }) as HTMLButtonElement).disabled
      ).toBe(false)
    );
  });
});
