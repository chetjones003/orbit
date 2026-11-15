import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { IssueService } from '../../../src/main/github/issue-service';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 7, login: 'orbit-owner', persistent: true };
const API = 'https://api.github.test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function repoJson(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'app',
    full_name: 'orbit-owner/app',
    private: false,
    default_branch: 'main',
    owner: { login: 'orbit-owner' },
    permissions: { push: true },
    allow_merge_commit: true,
    allow_squash_merge: true,
    allow_rebase_merge: true,
    allow_auto_merge: true,
    delete_branch_on_merge: false,
    ...overrides
  };
}

function pullJson(overrides: Record<string, unknown> = {}) {
  return {
    id: 70,
    number: 7,
    title: 'Add x',
    state: 'open',
    draft: false,
    merged: false,
    merged_at: null,
    merge_commit_sha: null,
    user: { login: 'someone-else' },
    labels: [],
    assignees: [],
    milestone: null,
    comments: 0,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
    html_url: 'https://github.com/orbit-owner/app/pull/7',
    body: '',
    head: { sha: 'head-1', ref: 'feature', repo: { full_name: 'orbit-owner/app' } },
    base: { ref: 'main' },
    ...overrides
  };
}

type RestHandler = (method: string, path: string, body: unknown) => unknown;

/**
 * A fake GitHub. REST calls go to `rest`; a handler may return a Response, a JSON body, or undefined (404),
 * or throw to model a request that never reached GitHub. GraphQL goes to `graphql`, which returns `data`.
 */
function fakeGitHub(options: {
  rest?: RestHandler;
  graphql?: (query: string, variables: Record<string, unknown>) => unknown;
}) {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const graphqlRequests: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.slice(API.length);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (path === '/graphql') {
      const parsed = body as { query: string; variables: Record<string, unknown> };
      graphqlRequests.push({ query: parsed.query, variables: parsed.variables });
      return jsonResponse({ data: options.graphql?.(parsed.query, parsed.variables) ?? {} });
    }
    requests.push({ method, path, body });
    const result = options.rest?.(method, path, body);
    if (result instanceof Response) return result;
    if (result === undefined) return jsonResponse({ message: 'Not Found' }, 404);
    return jsonResponse(result);
  });
  const sent = (method: string, path: string) =>
    requests.filter((r) => r.method === method && r.path === path);
  const mutations = (name: string) =>
    graphqlRequests.filter((r) => /^\s*mutation/.test(r.query) && r.query.includes(`${name}(`));
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    requests,
    sent,
    mutations
  };
}

function makeService(fetch: typeof globalThis.fetch) {
  const auth = {
    getStatus: () => SIGNED_IN,
    getAccessToken: vi.fn(async () => 'secret')
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  return new IssueService({ auth, apiBaseUrl: API, fetch });
}

/** The pull request's GraphQL state, for auto-merge, draft, and head reads. */
function pullGraphql(overrides: Record<string, unknown> = {}) {
  return {
    repository: {
      pullRequest: {
        id: 'PR_1',
        headRefOid: 'head-1',
        isDraft: false,
        autoMergeRequest: null,
        author: { login: 'someone-else' },
        reviews: { nodes: [] },
        reviewThreads: { totalCount: 0, nodes: [] },
        ...overrides
      }
    }
  };
}

describe('mergePull', () => {
  it('merges with the chosen method, pinned to the reviewed head', async () => {
    const gh = fakeGitHub({
      rest: (method, path) => {
        if (method === 'GET' && path === '/repos/orbit-owner/app') return repoJson();
        if (method === 'GET' && path === '/repos/orbit-owner/app/pulls/7') return pullJson();
        if (method === 'PUT' && path === '/repos/orbit-owner/app/pulls/7/merge')
          return { sha: 'merge-sha', merged: true, message: 'Pull Request successfully merged' };
        return undefined;
      }
    });
    const result = await makeService(gh.fetch).mergePull('orbit-owner/app', 7, {
      method: 'squash',
      deleteBranch: false,
      expectedHeadSha: 'head-1'
    });
    expect(result).toEqual({ kind: 'merged', sha: 'merge-sha', branchDeleted: false });
    expect(gh.sent('PUT', '/repos/orbit-owner/app/pulls/7/merge')[0]?.body).toEqual({
      merge_method: 'squash',
      sha: 'head-1'
    });
  });

  it('refuses a merge method the repo does not allow, before sending any merge', async () => {
    const gh = fakeGitHub({
      rest: (method, path) => {
        if (method === 'GET' && path === '/repos/orbit-owner/app')
          return repoJson({ allow_rebase_merge: false });
        if (method === 'GET' && path === '/repos/orbit-owner/app/pulls/7') return pullJson();
        return undefined;
      }
    });
    await expect(
      makeService(gh.fetch).mergePull('orbit-owner/app', 7, {
        method: 'rebase',
        deleteBranch: false,
        expectedHeadSha: 'head-1'
      })
    ).rejects.toThrow(/rebase/i);
    expect(gh.sent('PUT', '/repos/orbit-owner/app/pulls/7/merge')).toHaveLength(0);
  });

  it('reports stale without merging when the head has moved', async () => {
    const gh = fakeGitHub({
      rest: (method, path) => {
        if (method === 'GET' && path === '/repos/orbit-owner/app') return repoJson();
        if (method === 'GET' && path === '/repos/orbit-owner/app/pulls/7')
          return pullJson({
            head: { sha: 'head-2', ref: 'feature', repo: { full_name: 'orbit-owner/app' } }
          });
        return undefined;
      }
    });
    const result = await makeService(gh.fetch).mergePull('orbit-owner/app', 7, {
      method: 'merge',
      deleteBranch: false,
      expectedHeadSha: 'head-1'
    });
    expect(result).toEqual({ kind: 'stale', headSha: 'head-2' });
    expect(gh.sent('PUT', '/repos/orbit-owner/app/pulls/7/merge')).toHaveLength(0);
  });

  it('reconciles an uncertain merge that already landed instead of merging twice', async () => {
    let landed = false;
    const gh = fakeGitHub({
      rest: (method, path) => {
        if (method === 'GET' && path === '/repos/orbit-owner/app') return repoJson();
        if (method === 'GET' && path === '/repos/orbit-owner/app/pulls/7')
          return pullJson(
            landed
              ? {
                  state: 'closed',
                  merged: true,
                  merged_at: '2026-11-03T00:00:00Z',
                  merge_commit_sha: 'merge-sha'
                }
              : {}
          );
        if (method === 'PUT' && path === '/repos/orbit-owner/app/pulls/7/merge') {
          landed = true;
          throw new Error('connection reset');
        }
        return undefined;
      }
    });
    const result = await makeService(gh.fetch).mergePull('orbit-owner/app', 7, {
      method: 'merge',
      deleteBranch: false,
      expectedHeadSha: 'head-1'
    });
    expect(result).toEqual({ kind: 'merged', sha: 'merge-sha', branchDeleted: false });
    expect(gh.sent('PUT', '/repos/orbit-owner/app/pulls/7/merge')).toHaveLength(1);
  });

  it('deletes the head branch after merging when asked', async () => {
    const gh = fakeGitHub({
      rest: (method, path) => {
        if (method === 'GET' && path === '/repos/orbit-owner/app') return repoJson();
        if (method === 'GET' && path === '/repos/orbit-owner/app/pulls/7') return pullJson();
        if (method === 'PUT' && path === '/repos/orbit-owner/app/pulls/7/merge')
          return { sha: 'merge-sha', merged: true };
        if (method === 'DELETE' && path === '/repos/orbit-owner/app/git/refs/heads/feature')
          return new Response(null, { status: 204 });
        return undefined;
      }
    });
    const result = await makeService(gh.fetch).mergePull('orbit-owner/app', 7, {
      method: 'merge',
      deleteBranch: true,
      expectedHeadSha: 'head-1'
    });
    expect(result).toEqual({ kind: 'merged', sha: 'merge-sha', branchDeleted: true });
  });

  it('never deletes a head branch that lives in a fork', async () => {
    const gh = fakeGitHub({
      rest: (method, path) => {
        if (method === 'GET' && path === '/repos/orbit-owner/app') return repoJson();
        if (method === 'GET' && path === '/repos/orbit-owner/app/pulls/7')
          return pullJson({ head: { sha: 'head-1', ref: 'feature', repo: { full_name: 'someone/app' } } });
        if (method === 'PUT' && path === '/repos/orbit-owner/app/pulls/7/merge')
          return { sha: 'merge-sha', merged: true };
        return undefined;
      }
    });
    const result = await makeService(gh.fetch).mergePull('orbit-owner/app', 7, {
      method: 'merge',
      deleteBranch: true,
      expectedHeadSha: 'head-1'
    });
    expect(result).toEqual({ kind: 'merged', sha: 'merge-sha', branchDeleted: false });
    expect(gh.sent('DELETE', '/repos/orbit-owner/app/git/refs/heads/feature')).toHaveLength(0);
  });
});

describe('auto-merge and draft state', () => {
  it('enables auto-merge with the chosen method, pinned to the reviewed head', async () => {
    const gh = fakeGitHub({
      rest: (method, path) =>
        method === 'GET' && path === '/repos/orbit-owner/app' ? repoJson() : undefined,
      graphql: () => pullGraphql()
    });
    const result = await makeService(gh.fetch).setPullAutoMerge('orbit-owner/app', 7, {
      enabled: true,
      method: 'rebase',
      expectedHeadSha: 'head-1'
    });
    expect(result).toEqual({ kind: 'changed' });
    const [request] = gh.mutations('enablePullRequestAutoMerge');
    expect(request?.variables).toEqual({
      input: { pullRequestId: 'PR_1', mergeMethod: 'REBASE', expectedHeadOid: 'head-1' }
    });
  });

  it('disables auto-merge', async () => {
    const gh = fakeGitHub({
      rest: (method, path) =>
        method === 'GET' && path === '/repos/orbit-owner/app' ? repoJson() : undefined,
      graphql: () => pullGraphql({ autoMergeRequest: { mergeMethod: 'SQUASH' } })
    });
    await makeService(gh.fetch).setPullAutoMerge('orbit-owner/app', 7, {
      enabled: false,
      expectedHeadSha: 'head-1'
    });
    const [request] = gh.mutations('disablePullRequestAutoMerge');
    expect(request?.variables).toEqual({ input: { pullRequestId: 'PR_1' } });
  });

  it('refuses auto-merge when the repo does not allow it', async () => {
    const gh = fakeGitHub({
      rest: (method, path) =>
        method === 'GET' && path === '/repos/orbit-owner/app'
          ? repoJson({ allow_auto_merge: false })
          : undefined,
      graphql: () => pullGraphql()
    });
    await expect(
      makeService(gh.fetch).setPullAutoMerge('orbit-owner/app', 7, {
        enabled: true,
        method: 'merge',
        expectedHeadSha: 'head-1'
      })
    ).rejects.toThrow(/auto-merge/i);
    expect(gh.mutations('enablePullRequestAutoMerge')).toHaveLength(0);
  });

  it('converts a pull request to draft and marks it ready for review', async () => {
    const gh = fakeGitHub({ graphql: () => pullGraphql() });
    const service = makeService(gh.fetch);
    await service.setPullDraft('orbit-owner/app', 7, true);
    await service.setPullDraft('orbit-owner/app', 7, false);
    expect(gh.mutations('convertPullRequestToDraft')[0]?.variables).toEqual({
      input: { pullRequestId: 'PR_1' }
    });
    expect(gh.mutations('markPullRequestReadyForReview')[0]?.variables).toEqual({
      input: { pullRequestId: 'PR_1' }
    });
  });

  it('reports the allowed merge methods, draft state, and current auto-merge method', async () => {
    const gh = fakeGitHub({
      rest: (method, path) =>
        method === 'GET' && path === '/repos/orbit-owner/app'
          ? repoJson({ allow_rebase_merge: false, delete_branch_on_merge: true })
          : method === 'GET' && path === '/repos/orbit-owner/app/pulls/7'
            ? pullJson({ draft: true })
            : undefined,
      graphql: () => pullGraphql({ isDraft: true, autoMergeRequest: { mergeMethod: 'SQUASH' } })
    });
    const actions = await makeService(gh.fetch).getPullActions('orbit-owner/app', 7);
    expect(actions).toEqual({
      headSha: 'head-1',
      headRef: 'feature',
      headInRepo: true,
      draft: true,
      merged: false,
      state: 'open',
      allowedMergeMethods: ['merge', 'squash'],
      allowAutoMerge: true,
      autoMergeMethod: 'squash',
      deleteBranchOnMerge: true
    });
  });
});

describe('workflow re-runs', () => {
  const runsPath = '/repos/orbit-owner/app/actions/runs?head_sha=head-1&per_page=100';

  it('lists the workflow runs for the head commit', async () => {
    const gh = fakeGitHub({
      rest: (method, path) =>
        method === 'GET' && path === runsPath
          ? {
              total_count: 1,
              workflow_runs: [
                {
                  id: 11,
                  name: 'CI',
                  status: 'completed',
                  conclusion: 'failure',
                  html_url: 'https://github.com/orbit-owner/app/actions/runs/11'
                }
              ]
            }
          : undefined,
      graphql: () => pullGraphql()
    });
    const runs = await makeService(gh.fetch).getPullWorkflowRuns('orbit-owner/app', 7);
    expect(runs).toEqual([
      {
        id: 11,
        name: 'CI',
        status: 'completed',
        conclusion: 'failure',
        htmlUrl: 'https://github.com/orbit-owner/app/actions/runs/11'
      }
    ]);
  });

  it('re-runs failed jobs only when asked, and everything otherwise', async () => {
    const gh = fakeGitHub({
      rest: (method, path) =>
        method === 'POST' && (path.endsWith('/rerun') || path.endsWith('/rerun-failed-jobs'))
          ? new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } })
          : undefined
    });
    const service = makeService(gh.fetch);
    await service.rerunPullWorkflow('orbit-owner/app', 11, 'failed');
    await service.rerunPullWorkflow('orbit-owner/app', 11, 'all');
    expect(gh.sent('POST', '/repos/orbit-owner/app/actions/runs/11/rerun-failed-jobs')).toHaveLength(1);
    expect(gh.sent('POST', '/repos/orbit-owner/app/actions/runs/11/rerun')).toHaveLength(1);
  });
});

describe('createPull', () => {
  it('opens a pull request from a branch in the same personal repo', async () => {
    const gh = fakeGitHub({
      rest: (method, path) => {
        if (method === 'POST' && path === '/repos/orbit-owner/app/pulls')
          return jsonResponse(pullJson({ number: 9 }), 201);
        return undefined;
      }
    });
    const created = await makeService(gh.fetch).createPull('orbit-owner/app', {
      title: 'Add x',
      body: 'Details',
      head: 'feature',
      base: 'main',
      draft: true
    });
    expect(created.number).toBe(9);
    expect(gh.sent('POST', '/repos/orbit-owner/app/pulls')[0]?.body).toEqual({
      title: 'Add x',
      body: 'Details',
      head: 'feature',
      base: 'main',
      draft: true
    });
  });

  it('refuses a head branch equal to the base before sending anything', async () => {
    const gh = fakeGitHub({});
    await expect(
      makeService(gh.fetch).createPull('orbit-owner/app', {
        title: 'Add x',
        body: '',
        head: 'main',
        base: 'main',
        draft: false
      })
    ).rejects.toThrow(/different/i);
    expect(gh.requests).toHaveLength(0);
  });

  it('reconciles an uncertain create by finding the pull request it opened', async () => {
    let created = false;
    const gh = fakeGitHub({
      rest: (method, path) => {
        if (method === 'POST' && path === '/repos/orbit-owner/app/pulls') {
          created = true;
          throw new Error('connection reset');
        }
        if (
          method === 'GET' &&
          path === '/repos/orbit-owner/app/pulls?state=open&head=orbit-owner%3Afeature&per_page=100'
        )
          return created ? [pullJson({ number: 9 })] : [];
        return undefined;
      }
    });
    const pull = await makeService(gh.fetch).createPull('orbit-owner/app', {
      title: 'Add x',
      body: '',
      head: 'feature',
      base: 'main',
      draft: false
    });
    expect(pull.number).toBe(9);
    expect(gh.sent('POST', '/repos/orbit-owner/app/pulls')).toHaveLength(1);
  });
});

describe('listBranches', () => {
  it('lists the branch names of the repo', async () => {
    const gh = fakeGitHub({
      rest: (method, path) =>
        method === 'GET' && path === '/repos/orbit-owner/app/branches?per_page=100'
          ? [{ name: 'main' }, { name: 'feature' }]
          : undefined
    });
    expect(await makeService(gh.fetch).listBranches('orbit-owner/app')).toEqual(['main', 'feature']);
  });
});
