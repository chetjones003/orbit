import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { InboxService, buildInboxSearchQuery } from '../../../src/main/github/inbox-service';
import type { InboxTab } from '../../../src/shared/inbox';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 3, login: 'orbit-owner', persistent: true };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function searchItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    number: 7,
    title: 'Ship the inbox',
    state: 'open',
    user: { login: 'orbit-owner' },
    labels: [{ name: 'feature', color: '00ff00' }],
    comments: 2,
    updated_at: '2026-02-01T00:00:00Z',
    html_url: 'https://github.com/orbit-owner/app/pull/7',
    repository_url: 'https://api.github.com/repos/orbit-owner/app',
    draft: false,
    pull_request: { url: 'https://api.github.com/repos/orbit-owner/app/pulls/7' },
    ...overrides
  };
}

function makeService(fetch: typeof globalThis.fetch, status: unknown = SIGNED_IN) {
  const auth = {
    getStatus: () => status,
    getAccessToken: vi.fn(async () => 'secret')
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  return new InboxService({ auth, apiBaseUrl: 'https://api.github.test/', fetch });
}

describe('buildInboxSearchQuery', () => {
  const cases: Array<[InboxTab, string]> = [
    ['my-open-prs', 'is:pr is:open author:orbit-owner user:orbit-owner'],
    ['assigned', 'is:open assignee:orbit-owner user:orbit-owner'],
    ['review-requested', 'is:pr is:open review-requested:orbit-owner user:orbit-owner'],
    ['mentioned', 'is:open mentions:orbit-owner user:orbit-owner'],
    ['recent', 'is:open user:orbit-owner']
  ];
  it.each(cases)('builds the %s tab query scoped to personal repos', (tab, expected) => {
    expect(buildInboxSearchQuery(tab, 'orbit-owner')).toBe(expected);
  });
});

describe('InboxService.list', () => {
  it('searches with the tab query, sorted by update time, and maps items', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      json({ total_count: 1, incomplete_results: false, items: [searchItem()] })
    );
    const page = await makeService(fetch).list({ tab: 'my-open-prs', page: 1 });

    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://api.github.test/search/issues');
    expect(url.searchParams.get('q')).toBe('is:pr is:open author:orbit-owner user:orbit-owner');
    expect(url.searchParams.get('sort')).toBe('updated');
    expect(url.searchParams.get('order')).toBe('desc');
    expect(url.searchParams.get('per_page')).toBe('30');
    expect(url.searchParams.get('page')).toBe('1');
    expect(page).toEqual({
      tab: 'my-open-prs',
      page: 1,
      hasNextPage: false,
      partial: false,
      items: [
        {
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
          htmlUrl: 'https://github.com/orbit-owner/app/pull/7'
        }
      ]
    });
  });

  it('marks issues as issues and keeps the draft flag for pull requests', async () => {
    const fetch = vi.fn(async () =>
      json({
        total_count: 2,
        incomplete_results: false,
        items: [
          searchItem({ number: 1, title: 'A bug', pull_request: undefined, draft: undefined }),
          searchItem({
            number: 2,
            draft: true,
            pull_request: { url: 'https://api.github.test/repos/orbit-owner/app/pulls/2' }
          })
        ]
      })
    );
    const page = await makeService(fetch).list({ tab: 'assigned', page: 1 });
    expect(page.items.map((item) => [item.number, item.kind, item.isDraft])).toEqual([
      [1, 'issue', false],
      [2, 'pull', true]
    ]);
  });

  it('reports the next page only when more matching results exist', async () => {
    const fetch = vi.fn(async () =>
      json({ total_count: 31, incomplete_results: false, items: [searchItem()] })
    );
    const page = await makeService(fetch).list({ tab: 'recent', page: 1 });
    expect(page.hasNextPage).toBe(true);
  });

  it('labels a page partial when GitHub says the search results are incomplete', async () => {
    const fetch = vi.fn(async () =>
      json({ total_count: 1, incomplete_results: true, items: [searchItem()] })
    );
    await expect(makeService(fetch).list({ tab: 'mentioned', page: 1 })).resolves.toMatchObject({
      partial: true
    });
  });

  it('labels a result partial when search matches exceed the 1,000 results GitHub returns', async () => {
    const fetch = vi.fn(async () =>
      json({ total_count: 1500, incomplete_results: false, items: [searchItem()] })
    );
    const page = await makeService(fetch).list({ tab: 'recent', page: 1 });
    expect(page).toMatchObject({ partial: true, hasNextPage: true });
  });

  it('skips and labels partial any item that is not in a repo the signed-in account owns', async () => {
    const fetch = vi.fn(async () =>
      json({
        total_count: 2,
        incomplete_results: false,
        items: [
          searchItem({ repository_url: 'https://api.github.test/repos/an-org/shared' }),
          searchItem({ number: 8 })
        ]
      })
    );
    const page = await makeService(fetch).list({ tab: 'assigned', page: 1 });
    expect(page.items.map((item) => item.number)).toEqual([8]);
    expect(page.partial).toBe(true);
  });

  it('labels a result partial when an item is malformed', async () => {
    const fetch = vi.fn(async () =>
      json({ total_count: 2, incomplete_results: false, items: [searchItem(), { number: 'x' }] })
    );
    const page = await makeService(fetch).list({ tab: 'assigned', page: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.partial).toBe(true);
  });

  it('refuses to search while signed out', async () => {
    const fetch = vi.fn();
    await expect(makeService(fetch, { kind: 'signed-out' }).list({ tab: 'recent', page: 1 })).rejects.toThrow(
      'Sign in to GitHub'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unknown tabs and invalid pages before calling GitHub', async () => {
    const fetch = vi.fn();
    const service = makeService(fetch);
    await expect(service.list({ tab: 'everything' as InboxTab, page: 1 })).rejects.toThrow();
    await expect(service.list({ tab: 'recent', page: 0 })).rejects.toThrow();
    await expect(service.list({ tab: 'recent', page: 1.5 })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a response that is not a search result, so it never reads as empty', async () => {
    const fetch = vi.fn(async () => json(['not', 'a', 'search']));
    await expect(makeService(fetch).list({ tab: 'recent', page: 1 })).rejects.toThrow('invalid inbox result');
  });
});
