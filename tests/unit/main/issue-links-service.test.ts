import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { IssueService } from '../../../src/main/github/issue-service';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 7, login: 'orbit-owner', persistent: true };
const API = 'https://api.github.test';
const SHA_A = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
const SHA_B = 'b1c2d3e4f5a6b7c8d9e0b1c2d3e4f5a6b7c8d9e0';

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
  return new IssueService({ auth, apiBaseUrl: API, fetch });
}

function commit(sha: string) {
  return {
    sha,
    html_url: `https://github.com/orbit-owner/app/commit/${sha}`,
    commit: {
      message: `Commit ${sha.slice(0, 4)}\n\nbody`,
      author: { name: 'Chet', date: '2026-03-01T00:00:00Z' }
    },
    author: { login: 'chetjones003' }
  };
}

const pullEvent = {
  event: 'cross-referenced',
  source: {
    type: 'issue',
    issue: {
      number: 40,
      title: 'The fix',
      state: 'closed',
      html_url: 'https://github.com/orbit-owner/app/pull/40',
      user: { login: 'chetjones003' },
      pull_request: { merged_at: '2026-03-02T00:00:00Z' }
    }
  }
};

describe('getIssueLinks', () => {
  it('reads the timeline and the details of the linked commits', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/issues/9/timeline')) {
        return jsonResponse([
          pullEvent,
          { event: 'referenced', commit_id: SHA_A },
          { event: 'closed', commit_id: SHA_B }
        ]);
      }
      if (url.endsWith(`/commits/${SHA_A}`)) return jsonResponse(commit(SHA_A));
      if (url.endsWith(`/commits/${SHA_B}`)) return jsonResponse(commit(SHA_B));
      return jsonResponse({ message: 'unexpected' }, 404);
    });
    const service = makeService(fetch as unknown as typeof globalThis.fetch);
    const links = await service.getIssueLinks('orbit-owner/app', 9);
    expect(links.partial).toBe(false);
    expect(links.pulls).toEqual([
      {
        number: 40,
        title: 'The fix',
        state: 'closed',
        merged: true,
        htmlUrl: 'https://github.com/orbit-owner/app/pull/40',
        authorLogin: 'chetjones003'
      }
    ]);
    // Newest first: the closing commit was recorded last.
    expect(links.commits.map((entry) => entry.sha)).toEqual([SHA_B, SHA_A]);
    expect(links.commits[0]).toMatchObject({ message: 'Commit b1c2', authorLogin: 'chetjones003' });
  });

  it('reads every timeline page until GitHub returns a short one', async () => {
    const filler = Array.from({ length: 100 }, () => ({ event: 'labeled' }));
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('page=1')) return jsonResponse(filler);
      if (url.endsWith('page=2')) return jsonResponse([pullEvent]);
      return jsonResponse([]);
    });
    const service = makeService(fetch as unknown as typeof globalThis.fetch);
    const links = await service.getIssueLinks('orbit-owner/app', 9);
    expect(links.pulls.map((pull) => pull.number)).toEqual([40]);
    expect(links.partial).toBe(false);
  });

  it('marks the links partial when a commit cannot be read, and keeps the rest', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/timeline')) {
        return jsonResponse([
          { event: 'referenced', commit_id: SHA_A },
          { event: 'referenced', commit_id: SHA_B }
        ]);
      }
      if (url.endsWith(`/commits/${SHA_A}`)) return jsonResponse(commit(SHA_A));
      return jsonResponse({ message: 'gone' }, 404);
    });
    const service = makeService(fetch as unknown as typeof globalThis.fetch);
    const links = await service.getIssueLinks('orbit-owner/app', 9);
    expect(links.commits.map((entry) => entry.sha)).toEqual([SHA_A]);
    expect(links.partial).toBe(true);
  });

  it('fails when the timeline itself cannot be read', async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: 'nope' }, 500));
    const service = makeService(fetch as unknown as typeof globalThis.fetch);
    await expect(service.getIssueLinks('orbit-owner/app', 9)).rejects.toThrow();
  });
});
