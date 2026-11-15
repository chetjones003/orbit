import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { IssueService } from '../../../src/main/github/issue-service';
import { anchorInPatch } from '../../../src/main/github/review-anchor';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 7, login: 'orbit-owner', persistent: true };
const PATCH = '@@ -1,2 +1,2 @@\n-old line\n+new line\n same';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PENDING_COMMENT = {
  databaseId: 900,
  path: 'src/a.ts',
  line: 1,
  originalLine: 1,
  diffSide: 'RIGHT',
  body: 'Nit'
};

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'PR_1',
    headRefOid: 'head-1',
    author: { login: 'someone-else' },
    reviews: { nodes: [] },
    ...overrides
  };
}

function pendingReview(comments: unknown[] = []) {
  return {
    id: 'REV_1',
    commit: { oid: 'head-1' },
    comments: { totalCount: comments.length, nodes: comments }
  };
}

/**
 * A fake GitHub. GraphQL requests are answered by `graphql`, which receives the query text and
 * variables and returns the `data` object, or a Response to send as-is (for failures).
 */
function fakeGitHub(options: {
  graphql: (query: string, variables: Record<string, unknown>) => unknown;
  files?: unknown[];
}) {
  const requests: Array<{ url: string; query: string; variables: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/graphql')) {
      const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      requests.push({ url, query: body.query, variables: body.variables });
      const result = options.graphql(body.query, body.variables);
      return result instanceof Response ? result : jsonResponse({ data: result });
    }
    if (url.includes('/pulls/7/files')) return jsonResponse(options.files ?? []);
    return jsonResponse({}, 404);
  });
  const mutations = (name: string) =>
    requests.filter((r) => /^\s*mutation/.test(r.query) && r.query.includes(`${name}(`));
  const first = (name: string) => {
    const [request] = mutations(name);
    if (!request) throw new Error(`no ${name} mutation was sent`);
    return request;
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests, mutations, first };
}

function makeService(fetch: typeof globalThis.fetch) {
  const auth = {
    getStatus: () => SIGNED_IN,
    getAccessToken: vi.fn(async () => 'secret')
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  return new IssueService({ auth, apiBaseUrl: 'https://api.github.test', fetch });
}

const FILES = [
  { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1, changes: 2, patch: PATCH }
];

describe('anchorInPatch', () => {
  it('accepts new-side lines that the diff shows and old-side lines it removes or keeps', () => {
    expect(anchorInPatch(PATCH, { path: 'src/a.ts', side: 'RIGHT', line: 1 })).toBe(true);
    expect(anchorInPatch(PATCH, { path: 'src/a.ts', side: 'RIGHT', line: 2 })).toBe(true);
    expect(anchorInPatch(PATCH, { path: 'src/a.ts', side: 'LEFT', line: 1 })).toBe(true);
    expect(anchorInPatch(PATCH, { path: 'src/a.ts', side: 'LEFT', line: 2 })).toBe(true);
  });

  it('rejects lines outside the hunks, and removed lines on the new side', () => {
    expect(anchorInPatch(PATCH, { path: 'src/a.ts', side: 'RIGHT', line: 3 })).toBe(false);
    expect(anchorInPatch(PATCH, { path: 'src/a.ts', side: 'LEFT', line: 3 })).toBe(false);
    // The removed line is old line 1 only; the new side at line 1 is the added line.
    const removedOnly = '@@ -5,1 +5,0 @@\n-gone';
    expect(anchorInPatch(removedOnly, { path: 'x', side: 'RIGHT', line: 5 })).toBe(false);
    expect(anchorInPatch(removedOnly, { path: 'x', side: 'LEFT', line: 5 })).toBe(true);
  });
});

describe('IssueService.getPullReviewState', () => {
  it('reports the head, whether the user wrote the pull request, and the pending review with its comments', async () => {
    const gh = fakeGitHub({
      graphql: () => ({
        repository: {
          pullRequest: pullRequest({
            author: { login: 'orbit-owner' },
            reviews: { nodes: [pendingReview([PENDING_COMMENT])] }
          })
        }
      })
    });
    const service = makeService(gh.fetch);

    const state = await service.getPullReviewState('orbit-owner/app', 7);

    expect(state).toEqual({
      headSha: 'head-1',
      isOwnPull: true,
      pending: {
        id: 'REV_1',
        commitSha: 'head-1',
        comments: [{ id: 900, path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'Nit' }],
        commentsPartial: false
      }
    });
  });

  it('reports no pending review when the user has none on GitHub', async () => {
    const gh = fakeGitHub({ graphql: () => ({ repository: { pullRequest: pullRequest() } }) });
    const state = await makeService(gh.fetch).getPullReviewState('orbit-owner/app', 7);
    expect(state).toMatchObject({ headSha: 'head-1', isOwnPull: false, pending: null });
  });
});

describe('IssueService.addReviewComment', () => {
  it('starts a pending review on the head commit, then adds the comment to it', async () => {
    const gh = fakeGitHub({
      files: FILES,
      graphql: (query) => {
        if (query.includes('headRefOid')) return { repository: { pullRequest: pullRequest() } };
        if (query.includes('addPullRequestReview(')) {
          return { addPullRequestReview: { pullRequestReview: { id: 'REV_1', commit: { oid: 'head-1' } } } };
        }
        return {
          addPullRequestReviewThread: {
            thread: { id: 'T_new', comments: { nodes: [PENDING_COMMENT] } }
          }
        };
      }
    });

    const result = await makeService(gh.fetch).addReviewComment('orbit-owner/app', 7, {
      anchor: { path: 'src/a.ts', side: 'RIGHT', line: 1 },
      body: 'Nit',
      reviewedHeadSha: 'head-1'
    });

    expect(result).toEqual({
      kind: 'saved',
      comment: { id: 900, path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'Nit' }
    });
    expect(gh.first('addPullRequestReview').variables.input).toEqual({
      pullRequestId: 'PR_1',
      commitOID: 'head-1'
    });
    expect(gh.first('addPullRequestReviewThread').variables.input).toEqual({
      pullRequestId: 'PR_1',
      pullRequestReviewId: 'REV_1',
      path: 'src/a.ts',
      line: 1,
      side: 'RIGHT',
      body: 'Nit'
    });
  });

  it('reuses the existing pending review instead of starting a second one', async () => {
    const gh = fakeGitHub({
      files: FILES,
      graphql: (query) => {
        if (query.includes('headRefOid')) {
          return { repository: { pullRequest: pullRequest({ reviews: { nodes: [pendingReview()] } }) } };
        }
        return {
          addPullRequestReviewThread: { thread: { id: 'T_new', comments: { nodes: [PENDING_COMMENT] } } }
        };
      }
    });

    await makeService(gh.fetch).addReviewComment('orbit-owner/app', 7, {
      anchor: { path: 'src/a.ts', side: 'RIGHT', line: 1 },
      body: 'Nit',
      reviewedHeadSha: 'head-1'
    });

    expect(gh.mutations('addPullRequestReview')).toHaveLength(0);
  });

  it('refuses a line that is not part of the diff, before sending any write', async () => {
    const gh = fakeGitHub({
      files: FILES,
      graphql: () => ({ repository: { pullRequest: pullRequest() } })
    });

    await expect(
      makeService(gh.fetch).addReviewComment('orbit-owner/app', 7, {
        anchor: { path: 'src/a.ts', side: 'RIGHT', line: 99 },
        body: 'Nit',
        reviewedHeadSha: 'head-1'
      })
    ).rejects.toThrow(/not part of the diff/);
    expect(gh.mutations('addPullRequestReviewThread')).toHaveLength(0);
  });

  it('sends nothing when the reviewed commit is no longer the head, and reports the new head', async () => {
    const gh = fakeGitHub({
      files: FILES,
      graphql: () => ({ repository: { pullRequest: pullRequest({ headRefOid: 'head-2' }) } })
    });

    const result = await makeService(gh.fetch).addReviewComment('orbit-owner/app', 7, {
      anchor: { path: 'src/a.ts', side: 'RIGHT', line: 1 },
      body: 'Nit',
      reviewedHeadSha: 'head-1'
    });

    expect(result).toEqual({ kind: 'new-commits', headSha: 'head-2' });
    expect(gh.mutations('addPullRequestReviewThread')).toHaveLength(0);
    expect(gh.mutations('addPullRequestReview')).toHaveLength(0);
  });

  it('does not add the comment twice when the write fails in transit but GitHub has it', async () => {
    let landed = false;
    const gh = fakeGitHub({
      files: FILES,
      graphql: (query) => {
        if (query.includes('headRefOid')) {
          return {
            repository: {
              pullRequest: pullRequest({
                reviews: { nodes: [pendingReview(landed ? [PENDING_COMMENT] : [])] }
              })
            }
          };
        }
        landed = true;
        return new Response('', { status: 503 });
      }
    });

    const result = await makeService(gh.fetch).addReviewComment('orbit-owner/app', 7, {
      anchor: { path: 'src/a.ts', side: 'RIGHT', line: 1 },
      body: 'Nit',
      reviewedHeadSha: 'head-1'
    });

    expect(result).toEqual({
      kind: 'saved',
      comment: { id: 900, path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'Nit' }
    });
    expect(gh.mutations('addPullRequestReviewThread')).toHaveLength(1);
  });
});

describe('IssueService.replyToReviewThread', () => {
  it('attaches the reply to the pending review by its id', async () => {
    const gh = fakeGitHub({
      graphql: (query) => {
        if (query.includes('headRefOid')) {
          return { repository: { pullRequest: pullRequest({ reviews: { nodes: [pendingReview()] } }) } };
        }
        return {
          addPullRequestReviewThreadReply: {
            comment: { databaseId: 902, path: 'src/a.ts', line: 1, diffSide: 'RIGHT', body: 'Reply' }
          }
        };
      }
    });

    const result = await makeService(gh.fetch).replyToReviewThread('orbit-owner/app', 7, {
      threadId: 'T1',
      body: 'Reply',
      reviewedHeadSha: 'head-1'
    });

    expect(result).toEqual({
      kind: 'saved',
      comment: { id: 902, path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'Reply' }
    });
    expect(gh.first('addPullRequestReviewThreadReply').variables.input).toEqual({
      pullRequestReviewId: 'REV_1',
      pullRequestReviewThreadId: 'T1',
      body: 'Reply'
    });
  });
});

describe('IssueService.replyToReviewThread reconcile', () => {
  it('does not report an identical comment that was already pending as this reply', async () => {
    const earlier = { databaseId: 950, path: 'src/a.ts', line: 2, diffSide: 'RIGHT', body: 'LGTM' };
    const gh = fakeGitHub({
      graphql: (query) => {
        if (query.includes('headRefOid')) {
          return {
            repository: { pullRequest: pullRequest({ reviews: { nodes: [pendingReview([earlier])] } }) }
          };
        }
        return new Response('', { status: 503 });
      }
    });

    await expect(
      makeService(gh.fetch).replyToReviewThread('orbit-owner/app', 7, {
        threadId: 'T1',
        body: 'LGTM',
        reviewedHeadSha: 'head-1'
      })
    ).rejects.toThrow();
    expect(gh.mutations('addPullRequestReviewThreadReply')).toHaveLength(3);
  });
});

describe('IssueService.setReviewThreadResolved', () => {
  it('resolves and reopens a thread through its node id', async () => {
    const gh = fakeGitHub({
      graphql: (query) =>
        query.includes('unresolveReviewThread(')
          ? { unresolveReviewThread: { thread: { id: 'T1', isResolved: false } } }
          : { resolveReviewThread: { thread: { id: 'T1', isResolved: true } } }
    });
    const service = makeService(gh.fetch);

    expect(await service.setReviewThreadResolved('orbit-owner/app', 7, 'T1', true)).toBe(true);
    expect(gh.first('resolveReviewThread').variables.input).toEqual({ threadId: 'T1' });

    expect(await service.setReviewThreadResolved('orbit-owner/app', 7, 'T1', false)).toBe(false);
    expect(gh.first('unresolveReviewThread').variables.input).toEqual({ threadId: 'T1' });
  });
});

describe('IssueService.submitReview', () => {
  it('refuses to approve or request changes on the user own pull request', async () => {
    const gh = fakeGitHub({
      graphql: () => ({
        repository: { pullRequest: pullRequest({ author: { login: 'orbit-owner' } }) }
      })
    });

    await expect(
      makeService(gh.fetch).submitReview('orbit-owner/app', 7, {
        event: 'APPROVE',
        body: '',
        reviewedHeadSha: 'head-1'
      })
    ).rejects.toThrow(/your own pull request/);
    expect(gh.mutations('submitPullRequestReview')).toHaveLength(0);
  });

  it('submits the pending review with the chosen event', async () => {
    const gh = fakeGitHub({
      graphql: (query) => {
        if (query.includes('headRefOid')) {
          return { repository: { pullRequest: pullRequest({ reviews: { nodes: [pendingReview()] } }) } };
        }
        return { submitPullRequestReview: { pullRequestReview: { id: 'REV_1', state: 'COMMENTED' } } };
      }
    });

    const result = await makeService(gh.fetch).submitReview('orbit-owner/app', 7, {
      event: 'COMMENT',
      body: 'Looks good',
      reviewedHeadSha: 'head-1'
    });

    expect(result).toEqual({ kind: 'submitted' });
    expect(gh.first('submitPullRequestReview').variables.input).toEqual({
      pullRequestReviewId: 'REV_1',
      event: 'COMMENT',
      body: 'Looks good'
    });
  });

  it('sends nothing and reports the new head when commits were pushed after the reviewed commit', async () => {
    const gh = fakeGitHub({
      graphql: (query) => {
        if (query.includes('headRefOid')) {
          return {
            repository: {
              pullRequest: pullRequest({ headRefOid: 'head-2', reviews: { nodes: [pendingReview()] } })
            }
          };
        }
        return {};
      }
    });

    const result = await makeService(gh.fetch).submitReview('orbit-owner/app', 7, {
      event: 'COMMENT',
      body: '',
      reviewedHeadSha: 'head-1'
    });

    expect(result).toEqual({ kind: 'new-commits', headSha: 'head-2' });
    expect(gh.mutations('submitPullRequestReview')).toHaveLength(0);
  });

  it('treats a failed submit as applied when GitHub no longer holds the review as pending', async () => {
    let submitted = false;
    const gh = fakeGitHub({
      graphql: (query) => {
        if (query.includes('headRefOid')) {
          return {
            repository: {
              pullRequest: pullRequest({ reviews: { nodes: submitted ? [] : [pendingReview()] } })
            }
          };
        }
        if (query.includes('node(id')) return { node: { state: 'COMMENTED' } };
        submitted = true;
        return new Response('', { status: 503 });
      }
    });

    const result = await makeService(gh.fetch).submitReview('orbit-owner/app', 7, {
      event: 'COMMENT',
      body: 'Looks good',
      reviewedHeadSha: 'head-1'
    });

    expect(result).toEqual({ kind: 'submitted' });
    expect(gh.mutations('submitPullRequestReview')).toHaveLength(1);
  });
});
