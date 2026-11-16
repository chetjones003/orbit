import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { IssueService } from '../../../src/main/github/issue-service';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 7, login: 'orbit-owner', persistent: true };
const ISSUE_URL = 'https://api.github.test/repos/orbit-owner/app/issues/1';

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
    labels: [],
    comments: 0,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    html_url: `https://github.com/orbit-owner/app/issues/${number}`,
    ...overrides
  };
}

function makeService(fetch: typeof globalThis.fetch) {
  const auth = {
    getStatus: () => SIGNED_IN,
    getAccessToken: vi.fn(async () => 'secret')
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  return new IssueService({ auth, apiBaseUrl: 'https://api.github.test', fetch });
}

describe('sub-issues', () => {
  it('reads the sub-issue count of each issue in a list', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse([
        issue(1, { sub_issues_summary: { total: 3, completed: 1, percent_completed: 33 } }),
        issue(2)
      ])
    );
    const service = makeService(fetch as unknown as typeof globalThis.fetch);
    const page = await service.listIssues({ repoFullName: 'orbit-owner/app', state: 'open', page: 1 });
    expect(page.items[0]?.subIssues).toEqual({ total: 3, completed: 1 });
    expect(page.items[1]?.subIssues).toBeNull();
  });

  it('loads the children and the parent of an issue in its detail', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === ISSUE_URL) {
        return jsonResponse(
          issue(1, {
            body: 'Parent body',
            sub_issues_summary: { total: 2, completed: 1 },
            parent_issue_url: 'https://api.github.test/repos/orbit-owner/app/issues/9'
          })
        );
      }
      if (url.endsWith('/sub_issues?per_page=100')) {
        return jsonResponse([issue(2, { state: 'closed' }), issue(3)]);
      }
      if (url.endsWith('/parent')) return jsonResponse(issue(9, { title: 'The epic' }));
      return jsonResponse([]);
    });
    const service = makeService(fetch as unknown as typeof globalThis.fetch);
    const detail = await service.getIssueDetail('orbit-owner/app', 1);
    expect(detail.subIssues?.map((entry) => [entry.number, entry.state])).toEqual([
      [2, 'closed'],
      [3, 'open']
    ]);
    expect(detail.parent).toMatchObject({ number: 9, title: 'The epic', state: 'open' });
  });

  it('shows no children when the sub-issue read fails, and keeps the rest of the issue', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === ISSUE_URL)
        return jsonResponse(issue(1, { sub_issues_summary: { total: 2, completed: 0 } }));
      if (url.endsWith('/sub_issues?per_page=100')) return jsonResponse({ message: 'nope' }, 500);
      return jsonResponse([]);
    });
    const service = makeService(fetch as unknown as typeof globalThis.fetch);
    const detail = await service.getIssueDetail('orbit-owner/app', 1);
    expect(detail.summary.number).toBe(1);
    expect(detail.subIssues).toEqual([]);
    expect(detail.parent).toBeNull();
  });
});
