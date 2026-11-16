import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { IssueService } from '../../../src/main/github/issue-service';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 7, login: 'orbit-owner', persistent: true };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function issue(number: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 1000 + number,
    number,
    title: `Issue ${number}`,
    state: 'open',
    state_reason: null,
    user: { login: 'someone' },
    labels: [{ name: 'bug', color: 'd73a4a' }],
    comments: 2,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    html_url: `https://github.com/orbit-owner/app/issues/${number}`,
    ...overrides
  };
}

function makeService(fetch: typeof globalThis.fetch, status = SIGNED_IN) {
  const auth = {
    getStatus: () => status,
    getAccessToken: vi.fn(async () => 'secret')
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  return new IssueService({ auth, apiBaseUrl: 'https://api.github.test', fetch });
}

describe('IssueService.listIssues', () => {
  it('requests the owner repo issues with state, label, author, and paging filters', async () => {
    const fetch = vi.fn(async () => jsonResponse([]));
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    await service.listIssues({
      repoFullName: 'orbit-owner/app',
      state: 'closed',
      label: 'bug',
      author: 'someone',
      page: 2
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.test/repos/orbit-owner/app/issues?state=closed&labels=bug&creator=someone&per_page=30&page=2',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer secret' }) })
    );
  });

  it('omits label and author parameters when they are not set', async () => {
    const fetch = vi.fn(async () => jsonResponse([]));
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    await service.listIssues({ repoFullName: 'orbit-owner/app', state: 'open', page: 1 });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.test/repos/orbit-owner/app/issues?state=open&per_page=30&page=1',
      expect.anything()
    );
  });

  it('maps issues to summaries and leaves out pull requests', async () => {
    const fetch = vi.fn(async () => jsonResponse([issue(4), issue(5, { pull_request: { url: 'x' } })]));
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const page = await service.listIssues({ repoFullName: 'orbit-owner/app', state: 'open', page: 1 });

    expect(page.items).toEqual([
      {
        id: 1004,
        number: 4,
        title: 'Issue 4',
        state: 'open',
        stateReason: null,
        subIssues: null,
        authorLogin: 'someone',
        labels: [{ name: 'bug', color: 'd73a4a' }],
        assignees: [],
        milestone: null,
        commentCount: 2,
        createdAt: '2026-01-02T00:00:00Z',
        updatedAt: '2026-01-03T00:00:00Z',
        htmlUrl: 'https://github.com/orbit-owner/app/issues/4'
      }
    ]);
    expect(page.partial).toBe(false);
  });

  it('reports a next page when GitHub returned a full page', async () => {
    const full = Array.from({ length: 30 }, (_, i) => issue(i + 1));
    const service = makeService(vi.fn(async () => jsonResponse(full)) as unknown as typeof globalThis.fetch);

    const page = await service.listIssues({ repoFullName: 'orbit-owner/app', state: 'open', page: 1 });

    expect(page.hasNextPage).toBe(true);
    expect(page.items).toHaveLength(30);
  });

  it('flags a page as partial when an item is malformed, instead of presenting it as complete', async () => {
    const fetch = vi.fn(async () => jsonResponse([issue(4), { id: 9, number: 'x' }]));
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const page = await service.listIssues({ repoFullName: 'orbit-owner/app', state: 'open', page: 1 });

    expect(page.items.map((item) => item.number)).toEqual([4]);
    expect(page.partial).toBe(true);
  });

  it('refuses repositories owned by anyone other than the signed-in account', async () => {
    const fetch = vi.fn();
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    await expect(service.listIssues({ repoFullName: 'an-org/app', state: 'open', page: 1 })).rejects.toThrow(
      'personal repos'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['page zero', { page: 0 }],
    ['unknown state', { state: 'merged' }],
    ['a malformed repo name', { repoFullName: 'orbit-owner/app/../x' }]
  ])('rejects %s before calling GitHub', async (_label, override) => {
    const fetch = vi.fn();
    const service = makeService(fetch as unknown as typeof globalThis.fetch);
    const query = { repoFullName: 'orbit-owner/app', state: 'open', page: 1, ...override };

    await expect(service.listIssues(query as never)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a signed-in account', async () => {
    const service = makeService(
      vi.fn() as unknown as typeof globalThis.fetch,
      {
        kind: 'signed-out'
      } as never
    );
    await expect(
      service.listIssues({ repoFullName: 'orbit-owner/app', state: 'open', page: 1 })
    ).rejects.toThrow('Sign in');
  });
});

describe('IssueService.listPulls', () => {
  it('requests a repository pull list with filters and maps branch and draft details', async () => {
    const pull = issue(4, { draft: true, head: { ref: 'feature/x' }, base: { ref: 'main' } });
    delete (pull as { comments?: number }).comments;
    const fetch = vi.fn(async (_url: string) => jsonResponse([pull]));
    const service = makeService(fetch as unknown as typeof globalThis.fetch);
    const page = await service.listPulls({
      repoFullName: 'orbit-owner/app',
      state: 'open',
      label: 'bug',
      author: 'someone',
      page: 1
    });
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      '/repos/orbit-owner/app/pulls?state=open&per_page=100&page=1'
    );
    expect(page.items[0]).toMatchObject({ number: 4, draft: true, headRef: 'feature/x', baseRef: 'main' });
  });
});

describe('IssueService.getIssueDetail', () => {
  const comment = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    user: { login: 'commenter' },
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    html_url: `https://github.com/orbit-owner/app/issues/4#issuecomment-${id}`,
    body: `comment ${id} **source**`,
    body_html: `<p>comment ${id}</p>`,
    ...overrides
  });

  it('requests the issue and its comments as GitHub-rendered HTML', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/comments?per_page=100&page=1')) return jsonResponse([comment(1)]);
      return jsonResponse({ ...issue(4), body_html: '<p>Body</p>' });
    });
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const detail = await service.getIssueDetail('orbit-owner/app', 4);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.test/repos/orbit-owner/app/issues/4',
      expect.objectContaining({
        headers: expect.objectContaining({ accept: 'application/vnd.github.html+json' })
      })
    );
    expect(detail.summary.number).toBe(4);
    expect(detail.bodyHtml).toBe('<p>Body</p>');
    expect(detail.comments).toEqual([
      {
        id: 1,
        authorLogin: 'commenter',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
        htmlUrl: 'https://github.com/orbit-owner/app/issues/4#issuecomment-1',
        body: 'comment 1 **source**',
        bodyHtml: '<p>comment 1</p>'
      }
    ]);
    expect(detail.commentsPartial).toBe(false);
  });

  it('uses an empty body when the issue has none', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes('/comments') ? jsonResponse([]) : jsonResponse({ ...issue(4), body_html: null })
    );
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const detail = await service.getIssueDetail('orbit-owner/app', 4);

    expect(detail.bodyHtml).toBe('');
  });

  it('follows comment pages until a short page, so a long thread is complete', async () => {
    const pages: Record<string, unknown[]> = {
      '/comments?per_page=100&page=1': Array.from({ length: 100 }, (_, i) => comment(i + 1)),
      '/comments?per_page=100&page=2': Array.from({ length: 3 }, (_, i) => comment(101 + i))
    };
    const fetch = vi.fn(async (url: string) => {
      const key = Object.keys(pages).find((page) => url.endsWith(page));
      if (key) return jsonResponse(pages[key]);
      return jsonResponse({ ...issue(4), body_html: '' });
    });
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const detail = await service.getIssueDetail('orbit-owner/app', 4);

    expect(detail.comments).toHaveLength(103);
    expect(detail.commentsPartial).toBe(false);
  });

  it('flags comments as partial when the comment page limit is reached', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => comment(i + 1));
    const fetch = vi.fn(async (url: string) =>
      url.includes('/comments') ? jsonResponse(fullPage) : jsonResponse({ ...issue(4), body_html: '' })
    );
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const detail = await service.getIssueDetail('orbit-owner/app', 4);

    expect(detail.comments).toHaveLength(1000);
    expect(detail.commentsPartial).toBe(true);
    const commentRequests = fetch.mock.calls.filter(([url]) => String(url).includes('/comments'));
    expect(commentRequests).toHaveLength(10);
  });

  it('refuses pull request numbers', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ...issue(4), pull_request: { url: 'x' } }));
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    await expect(service.getIssueDetail('orbit-owner/app', 4)).rejects.toThrow('not an issue');
  });

  it('rejects issue numbers that are not positive integers before calling GitHub', async () => {
    const fetch = vi.fn();
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    await expect(service.getIssueDetail('orbit-owner/app', 0)).rejects.toThrow();
    await expect(service.getIssueDetail('orbit-owner/app', 1.5)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('IssueService.getPullDetail', () => {
  it('reads the pull request body from the pulls endpoint and its conversation comments from the issue', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/comments')) return jsonResponse([]);
      return jsonResponse({ ...issue(7), body_html: '<p>Change</p>', pull_request: { url: 'x' } });
    });
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const detail = await service.getPullDetail('orbit-owner/app', 7);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.test/repos/orbit-owner/app/pulls/7',
      expect.objectContaining({
        headers: expect.objectContaining({ accept: 'application/vnd.github.html+json' })
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.test/repos/orbit-owner/app/issues/7/comments?per_page=100&page=1',
      expect.anything()
    );
    expect(detail.summary.number).toBe(7);
    expect(detail.bodyHtml).toBe('<p>Change</p>');
  });

  it('rejects a repo the signed-in account does not own before calling GitHub', async () => {
    const fetch = vi.fn();
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    await expect(service.getPullDetail('an-org/app', 7)).rejects.toThrow('personal repos');
    expect(fetch).not.toHaveBeenCalled();
  });
});
