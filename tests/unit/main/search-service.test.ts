import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { SearchService, buildSearchQuery, type SearchQuery } from '../../../src/main/github/search-service';
import type { SearchRequest } from '../../../src/shared/search';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 4, login: 'orbit-owner', persistent: true };

function query(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    terms: '',
    kind: 'all',
    state: 'open',
    repoFullName: null,
    labels: [],
    author: null,
    number: null,
    ...overrides
  };
}

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return { ...query(), page: 1, ...overrides };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function searchItem(overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    title: 'Crash on start',
    state: 'open',
    user: { login: 'orbit-owner' },
    labels: [{ name: 'bug', color: 'ff0000' }],
    comments: 1,
    updated_at: '2026-02-01T00:00:00Z',
    html_url: 'https://github.com/orbit-owner/app/issues/7',
    repository_url: 'https://api.github.com/repos/orbit-owner/app',
    draft: false,
    ...overrides
  };
}

function makeService(fetch: typeof globalThis.fetch, status: unknown = SIGNED_IN) {
  const auth = {
    getStatus: () => status,
    getAccessToken: vi.fn(async () => 'secret')
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  return new SearchService({ auth, apiBaseUrl: 'https://api.github.test/', fetch });
}

describe('buildSearchQuery', () => {
  it('scopes every search to the account and applies the filters', () => {
    expect(buildSearchQuery(query({ kind: 'pull', state: 'closed' }), 'orbit-owner')).toEqual({
      q: 'user:orbit-owner is:pr is:closed',
      sort: 'updated'
    });
  });

  it('leaves out the status when every state is wanted', () => {
    expect(buildSearchQuery(query({ state: 'all' }), 'orbit-owner').q).toBe('user:orbit-owner');
  });

  it('uses the chosen repo and labels, quoting labels with spaces', () => {
    expect(
      buildSearchQuery(
        query({ repoFullName: 'orbit-owner/app', labels: ['good first issue'] }),
        'orbit-owner'
      ).q
    ).toBe('user:orbit-owner is:open repo:orbit-owner/app label:"good first issue"');
  });

  it('refuses repositories that are not the account’s own', () => {
    expect(() => buildSearchQuery(query({ repoFullName: 'someone-else/app' }), 'orbit-owner')).toThrow(
      'Search covers only your own repositories.'
    );
  });

  it('keeps typed words from injecting qualifiers, and ANDs the words', () => {
    const { q, sort } = buildSearchQuery(query({ terms: 'user:someone crash fix' }), 'orbit-owner');
    expect(q).toBe('user:orbit-owner is:open usersomeone crash fix');
    expect(sort).toBeNull();
  });

  it('validates the author', () => {
    expect(buildSearchQuery(query({ author: 'octo' }), 'orbit-owner').q).toBe(
      'user:orbit-owner is:open author:octo'
    );
    expect(() => buildSearchQuery(query({ author: 'bad_name!' }), 'orbit-owner')).toThrow(
      'The author must be a GitHub account name.'
    );
  });
});

describe('SearchService.search', () => {
  it('searches, maps personal-repo items, and reports the page', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      json({ total_count: 1, incomplete_results: false, items: [searchItem()] })
    );
    const page = await makeService(fetch).search(request({ terms: 'crash' }));

    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/search/issues');
    expect(url.searchParams.get('q')).toBe('user:orbit-owner is:open crash');
    expect(url.searchParams.has('sort')).toBe(false);
    expect(page).toEqual({
      items: [
        {
          repoFullName: 'orbit-owner/app',
          number: 7,
          kind: 'issue',
          title: 'Crash on start',
          state: 'open',
          isDraft: false,
          authorLogin: 'orbit-owner',
          labels: [{ name: 'bug', color: 'ff0000' }],
          commentCount: 1,
          updatedAt: '2026-02-01T00:00:00Z',
          htmlUrl: 'https://github.com/orbit-owner/app/issues/7'
        }
      ],
      totalCount: 1,
      page: 1,
      hasNextPage: false,
      partial: false
    });
  });

  it('marks the page partial when GitHub caps the results or an item is outside the account', async () => {
    const fetch = vi.fn(async () =>
      json({
        total_count: 1500,
        incomplete_results: false,
        items: [searchItem({ repository_url: 'https://api.github.com/repos/other/app' })]
      })
    );
    const page = await makeService(fetch).search(request());
    expect(page).toMatchObject({ items: [], totalCount: 1000, hasNextPage: true, partial: true });
  });

  it('rejects bad input and signed-out sessions before calling GitHub', async () => {
    const fetch = vi.fn();
    const service = makeService(fetch as unknown as typeof globalThis.fetch);
    await expect(service.search(request({ page: 0 }))).rejects.toThrow('Search pages must');
    await expect(service.search(request({ kind: 'bogus' as SearchRequest['kind'] }))).rejects.toThrow(
      'Unknown search type.'
    );
    await expect(service.search(request({ terms: 'x'.repeat(257) }))).rejects.toThrow('Search text must');
    await expect(service.search(request({ labels: ['a', 'b', 'c', 'd', 'e', 'f'] }))).rejects.toThrow(
      'Search up to 5 labels at a time.'
    );
    expect(fetch).not.toHaveBeenCalled();

    const signedOut = makeService(fetch as unknown as typeof globalThis.fetch, { kind: 'signed-out' });
    await expect(signedOut.search(request())).rejects.toThrow('Sign in to GitHub to search.');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('SearchService number lookup', () => {
  const repos = {
    current: async () => [{ fullName: 'orbit-owner/app' }, { fullName: 'orbit-owner/site' }] as never
  };

  function makeNumberService(fetch: typeof globalThis.fetch) {
    const auth = {
      getStatus: () => SIGNED_IN,
      getAccessToken: vi.fn(async () => 'secret')
    } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
    return new SearchService({ auth, apiBaseUrl: 'https://api.github.test/', fetch, repos });
  }

  /** Issue 1236 lives in orbit-owner/site, and the single-item response leaves out its repo link. */
  function fetchFor(calls: string[]) {
    return vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === '/repos/orbit-owner/site/issues/1236') {
        const { repository_url: _omit, ...rest } = searchItem({
          number: 1236,
          title: 'Export fails on Windows'
        });
        return json(rest);
      }
      if (path === '/search/issues') {
        return json({
          total_count: 1,
          incomplete_results: false,
          items: [searchItem({ number: 9, title: 'Other 1236 note' })]
        });
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    });
  }

  it('lists the issue with that number first, found by looking it up in each personal repo', async () => {
    const calls: string[] = [];
    const page = await makeNumberService(fetchFor(calls)).search(request({ terms: '1236', number: 1236 }));
    expect(page.items.map((item) => `${item.repoFullName}#${item.number}`)).toEqual([
      'orbit-owner/site#1236'
    ]);
    expect(page.items[0]?.repoFullName).toBe('orbit-owner/site');
    expect(calls.filter((path) => path.startsWith('/repos/')).sort()).toEqual([
      '/repos/orbit-owner/app/issues/1236',
      '/repos/orbit-owner/site/issues/1236'
    ]);
    expect(calls).not.toContain('/search/issues');
  });

  it('puts the number hit ahead of text matches when there are other words', async () => {
    const calls: string[] = [];
    const page = await makeNumberService(fetchFor(calls)).search(
      request({ terms: '1236 export', number: 1236 })
    );
    expect(page.items.map((item) => item.number)).toEqual([1236, 9]);
    expect(calls).toContain('/search/issues');
  });

  it('checks only the chosen repo when one is chosen', async () => {
    const calls: string[] = [];
    await makeNumberService(fetchFor(calls)).search(
      request({ terms: '1236', number: 1236, repoFullName: 'orbit-owner/app' })
    );
    expect(calls.filter((path) => path.startsWith('/repos/'))).toEqual([
      '/repos/orbit-owner/app/issues/1236'
    ]);
  });

  it('rejects an impossible number before calling GitHub', async () => {
    const fetch = vi.fn();
    await expect(
      makeNumberService(fetch as unknown as typeof globalThis.fetch).search(request({ number: 0 }))
    ).rejects.toThrow('Issue and pull request numbers are whole numbers.');
    expect(fetch).not.toHaveBeenCalled();
  });
});
