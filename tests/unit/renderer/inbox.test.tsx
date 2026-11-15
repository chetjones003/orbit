// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inbox } from '../../../src/renderer/src/inbox/Inbox';
import type { InboxItem, InboxPage, InboxQuery } from '../../../src/shared/inbox';
import type { ConnectionStatus } from '../../../src/shared/connection';

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    repoFullName: 'orbit-owner/app',
    number: 7,
    kind: 'pull',
    title: 'Ship the inbox',
    state: 'open',
    isDraft: false,
    authorLogin: 'orbit-owner',
    labels: [{ name: 'feature', color: '00ff00' }],
    commentCount: 2,
    updatedAt: '2026-02-01T00:00:00Z',
    htmlUrl: 'https://github.com/orbit-owner/app/pull/7',
    ...overrides
  };
}

function page(overrides: Partial<InboxPage> = {}): InboxPage {
  return { tab: 'my-open-prs', items: [item()], page: 1, hasNextPage: false, partial: false, ...overrides };
}

let statusListener: ((status: ConnectionStatus) => void) | null = null;

function installApi(list: (query: InboxQuery) => Promise<InboxPage>) {
  const inboxApi = { list: vi.fn(list) };
  const refresh = {
    onStatusChanged: vi.fn((listener: (status: ConnectionStatus) => void) => {
      statusListener = listener;
      return () => {
        statusListener = null;
      };
    })
  };
  Object.defineProperty(window, 'orbit', {
    configurable: true,
    value: { inbox: inboxApi, refresh }
  });
  return { inboxApi, refresh };
}

function renderInbox(onOpenItem = vi.fn()) {
  render(<Inbox selected={null} onOpenItem={onOpenItem} />);
  return { onOpenItem };
}

describe('Inbox', () => {
  beforeEach(() => {
    statusListener = null;
  });
  afterEach(() => {
    cleanup();
  });

  it('shows the five fixed tabs and loads the first one', async () => {
    const { inboxApi } = installApi(async (query) => page({ tab: query.tab }));
    renderInbox();

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'My open PRs',
      'Assigned to me',
      'Review requested',
      'Mentioned',
      'Recently updated'
    ]);
    expect(screen.getByRole('tab', { name: 'My open PRs' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(inboxApi.list).toHaveBeenCalledWith({ tab: 'my-open-prs', page: 1 }));
  });

  it('loads a tab when the user selects it and resets to page one', async () => {
    const { inboxApi } = installApi(async (query) => page({ tab: query.tab, hasNextPage: true }));
    renderInbox();
    await screen.findByText('Ship the inbox');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(inboxApi.list).toHaveBeenLastCalledWith({ tab: 'my-open-prs', page: 2 }));

    fireEvent.click(screen.getByRole('tab', { name: 'Review requested' }));
    await waitFor(() => expect(inboxApi.list).toHaveBeenLastCalledWith({ tab: 'review-requested', page: 1 }));
    expect(screen.getByRole('tab', { name: 'Review requested' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens an item in the details panel when its row is chosen', async () => {
    installApi(async () => page());
    const { onOpenItem } = renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: /Ship the inbox/ }));
    expect(onOpenItem).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: 'orbit-owner/app', number: 7 })
    );
  });

  it('shows the repo, kind, author, and labels for each item', async () => {
    installApi(async () =>
      page({
        items: [item({ isDraft: true, kind: 'pull' }), item({ number: 9, kind: 'issue', title: 'A bug' })]
      })
    );
    renderInbox();

    const list = await screen.findByRole('list', { name: 'Inbox items' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('orbit-owner/app#7');
    expect(rows[0]).toHaveTextContent('Pull request');
    expect(rows[0]).toHaveTextContent('Draft pull request');
    expect(rows[0]).toHaveTextContent('@orbit-owner');
    expect(rows[0]).toHaveTextContent('feature');
    expect(rows[1]).toHaveTextContent('Issue');
  });

  it('labels a partial result as incomplete, never as the full list', async () => {
    installApi(async () => page({ items: [], partial: true }));
    renderInbox();

    expect(await screen.findByRole('note')).toHaveTextContent('may be incomplete');
    expect(screen.queryByText('Nothing needs your attention in this tab.')).not.toBeInTheDocument();
  });

  it('shows the empty message only for a complete empty result', async () => {
    installApi(async () => page({ items: [] }));
    renderInbox();
    expect(await screen.findByText('Nothing needs your attention in this tab.')).toBeInTheDocument();
  });

  it('shows an error, not an empty list, when a tab cannot be loaded, and retries on request', async () => {
    let fail = true;
    const { inboxApi } = installApi(async () => {
      if (fail) throw new Error('GitHub rate limit reached.');
      return page();
    });
    renderInbox();

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub rate limit reached.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Error invoking');
    expect(screen.queryByText('Nothing needs your attention in this tab.')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Ship the inbox');
    expect(inboxApi.list).toHaveBeenCalledTimes(2);
  });

  it('refetches the visible tab when a refresh completes, without clearing the list', async () => {
    const { inboxApi } = installApi(async () => page());
    renderInbox();
    await screen.findByText('Ship the inbox');

    act(() => {
      statusListener?.({ state: 'fresh', lastSuccessAt: 1, nextRetryAt: 2 });
    });
    await waitFor(() => expect(inboxApi.list).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Ship the inbox')).toBeInTheDocument();
  });

  it('does not refetch for status changes that finish no refresh', async () => {
    const { inboxApi } = installApi(async () => page());
    renderInbox();
    await screen.findByText('Ship the inbox');

    act(() => {
      statusListener?.({ state: 'offline', lastSuccessAt: null, nextRetryAt: 2 });
    });
    expect(inboxApi.list).toHaveBeenCalledTimes(1);
  });

  it('ignores a slow response for a tab the user has already left', async () => {
    let resolveFirst: (value: InboxPage) => void = () => undefined;
    installApi((query) =>
      query.tab === 'my-open-prs'
        ? new Promise<InboxPage>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(page({ tab: query.tab, items: [item({ title: 'Assigned work' })] }))
    );
    renderInbox();
    fireEvent.click(screen.getByRole('tab', { name: 'Assigned to me' }));
    await screen.findByText('Assigned work');

    await act(async () => {
      resolveFirst(page({ items: [item({ title: 'Stale PR' })] }));
    });
    expect(screen.queryByText('Stale PR')).not.toBeInTheDocument();
    expect(screen.getByText('Assigned work')).toBeInTheDocument();
  });
});
