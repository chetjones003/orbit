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

function makeService(fetch: typeof globalThis.fetch) {
  const auth = {
    getStatus: () => SIGNED_IN,
    getAccessToken: vi.fn(async () => 'secret')
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  return new IssueService({ auth, apiBaseUrl: 'https://api.github.test', fetch });
}

function pullFile(filename: string, overrides: Record<string, unknown> = {}) {
  return {
    filename,
    previous_filename: undefined,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: '@@ -1 +1 @@\n-old\n+new',
    ...overrides
  };
}

describe('IssueService.getPullFiles', () => {
  it('maps each changed file with its status, counts, and unified patch', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse([
        pullFile('src/a.ts'),
        pullFile('src/new.ts', { status: 'renamed', previous_filename: 'src/old.ts' }),
        pullFile('src/gone.ts', { status: 'removed', additions: 0, deletions: 3, changes: 3 })
      ])
    );
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const page = await service.getPullFiles('orbit-owner/app', 7);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.test/repos/orbit-owner/app/pulls/7/files?per_page=100&page=1',
      expect.anything()
    );
    expect(page.partial).toBe(false);
    expect(page.files).toEqual([
      {
        filename: 'src/a.ts',
        previousFilename: null,
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch: '@@ -1 +1 @@\n-old\n+new',
        noPatchReason: null
      },
      expect.objectContaining({ filename: 'src/new.ts', status: 'renamed', previousFilename: 'src/old.ts' }),
      expect.objectContaining({ filename: 'src/gone.ts', status: 'removed' })
    ]);
  });

  it('explains a missing patch as binary when the file has no changed lines, and as too large otherwise', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse([
        pullFile('logo.png', { patch: undefined, additions: 0, deletions: 0, changes: 0 }),
        pullFile('huge.json', { patch: undefined, additions: 5000, deletions: 0, changes: 5000 })
      ])
    );
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const page = await service.getPullFiles('orbit-owner/app', 7);

    expect(page.files[0]).toMatchObject({ patch: null, noPatchReason: 'binary' });
    expect(page.files[1]).toMatchObject({ patch: null, noPatchReason: 'too-large' });
  });

  it('follows pages while GitHub returns full pages, and marks the list partial at the page limit', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => pullFile(`f${i}.ts`));
    const fetch = vi.fn(async () => jsonResponse(fullPage));
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const page = await service.getPullFiles('orbit-owner/app', 7);

    expect(fetch).toHaveBeenCalledTimes(30);
    expect(page.files).toHaveLength(3000);
    expect(page.partial).toBe(true);
  });
});

function thread(overrides: Record<string, unknown>) {
  return {
    id: 'T1',
    isResolved: false,
    isOutdated: false,
    path: 'src/a.ts',
    line: 12,
    originalLine: 12,
    comments: { totalCount: 1, nodes: [] },
    ...overrides
  };
}

describe('IssueService.getPullReviewThreads', () => {
  it('reads review threads through GraphQL with resolved, outdated, and original context', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                totalCount: 2,
                nodes: [
                  thread({
                    id: 'T1',
                    isResolved: true,
                    comments: {
                      totalCount: 2,
                      nodes: [
                        {
                          fullDatabaseId: '501',
                          author: { login: 'reviewer' },
                          body: 'Rename this',
                          bodyHTML: '<p>Rename this</p>',
                          createdAt: '2026-01-04T00:00:00Z',
                          url: 'https://github.com/orbit-owner/app/pull/7#r501',
                          diffHunk: '@@ -10,3 +10,3 @@'
                        },
                        {
                          fullDatabaseId: '502',
                          author: null,
                          body: 'Done',
                          bodyHTML: '<p>Done</p>',
                          createdAt: '2026-01-05T00:00:00Z',
                          url: 'https://github.com/orbit-owner/app/pull/7#r502',
                          diffHunk: '@@ -10,3 +10,3 @@'
                        }
                      ]
                    }
                  }),
                  thread({
                    id: 'T2',
                    isOutdated: true,
                    path: 'src/b.ts',
                    line: null,
                    originalLine: 4,
                    comments: {
                      totalCount: 1,
                      nodes: [
                        {
                          fullDatabaseId: '600',
                          author: { login: 'reviewer' },
                          body: 'Old note',
                          bodyHTML: '<p>Old note</p>',
                          createdAt: '2026-01-06T00:00:00Z',
                          url: 'https://github.com/orbit-owner/app/pull/7#r600',
                          diffHunk: '@@ -4 +4 @@'
                        }
                      ]
                    }
                  })
                ]
              }
            }
          }
        }
      })
    );
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const page = await service.getPullReviewThreads('orbit-owner/app', 7);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.test/graphql',
      expect.objectContaining({ method: 'POST' })
    );
    expect(page.partial).toBe(false);
    expect(page.threads[0]).toMatchObject({
      id: 'T1',
      path: 'src/a.ts',
      line: 12,
      isResolved: true,
      isOutdated: false,
      diffHunk: '@@ -10,3 +10,3 @@',
      commentsPartial: false
    });
    expect(page.threads[0]?.comments.map((c) => [c.id, c.authorLogin, c.body])).toEqual([
      [501, 'reviewer', 'Rename this'],
      [502, 'ghost', 'Done']
    ]);
    expect(page.threads[1]).toMatchObject({ id: 'T2', isOutdated: true, line: null, originalLine: 4 });
  });

  it('reports the thread list as partial when GitHub has more threads than it returned', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        data: { repository: { pullRequest: { reviewThreads: { totalCount: 101, nodes: [] } } } }
      })
    );
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    const page = await service.getPullReviewThreads('orbit-owner/app', 7);

    expect(page.threads).toEqual([]);
    expect(page.partial).toBe(true);
  });

  it('throws when GraphQL reports errors instead of returning an empty thread list', async () => {
    const fetch = vi.fn(async () => jsonResponse({ errors: [{ message: 'Something failed' }] }));
    const service = makeService(fetch as unknown as typeof globalThis.fetch);

    await expect(service.getPullReviewThreads('orbit-owner/app', 7)).rejects.toThrow('review threads');
  });
});
