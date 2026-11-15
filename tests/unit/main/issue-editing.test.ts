import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { IssueService } from '../../../src/main/github/issue-service';
import { WriteBlockedError } from '../../../src/main/github/write-reconcile';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 7, login: 'orbit-owner', persistent: true };
const REPO = 'orbit-owner/app';
const ISSUE_PATH = '/repos/orbit-owner/app/issues/4';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A GitHub issue payload as the REST API returns it with the HTML media type. */
function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: 104,
    number: 4,
    title: 'Crash on save',
    state: 'open',
    state_reason: null,
    user: { login: 'orbit-owner' },
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [{ login: 'helper' }],
    milestone: { number: 2, title: 'v1' },
    comments: 0,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    html_url: 'https://github.com/orbit-owner/app/issues/4',
    body: 'Steps:\n- [ ] reproduce\n- [x] report',
    body_html: '<p>Steps</p>',
    ...overrides
  };
}

type Responder = (method: string, path: string, body: unknown) => Response | Promise<Response>;

interface Harness {
  service: IssueService;
  calls: Array<{ method: string; path: string; search: string; body: unknown }>;
}

/** Routes each request through `responder` and records it, so tests can assert on what was sent. */
function makeService(responder: Responder, options: { canWrite?: () => boolean } = {}): Harness {
  const calls: Harness['calls'] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: parsed.pathname, search: parsed.search, body });
    return responder(method, parsed.pathname, body);
  });
  const auth = {
    getStatus: () => SIGNED_IN,
    getAccessToken: vi.fn(async () => 'secret')
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  const service = new IssueService({
    auth,
    apiBaseUrl: 'https://api.github.test',
    fetch: fetch as unknown as typeof globalThis.fetch,
    canWrite: options.canWrite
  });
  return { service, calls };
}

describe('IssueService.createIssue', () => {
  it('posts the title and body to the repo and returns the created issue', async () => {
    const { service, calls } = makeService((method) =>
      method === 'POST' ? json(issue({ number: 12, title: 'New bug', body: 'Details' }), 201) : json({}, 404)
    );

    const created = await service.createIssue(REPO, { title: 'New bug', body: 'Details' });

    expect(created.summary.number).toBe(12);
    expect(created.body).toBe('Details');
    expect(calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/repos/orbit-owner/app/issues',
        body: { title: 'New bug', body: 'Details' }
      })
    ]);
  });

  it('rejects an empty or over-long title before sending anything', async () => {
    const { service, calls } = makeService(() => json({}, 500));

    await expect(service.createIssue(REPO, { title: '   ', body: '' })).rejects.toThrow(/title/i);
    await expect(service.createIssue(REPO, { title: 'x'.repeat(257), body: '' })).rejects.toThrow(/256/);
    expect(calls).toEqual([]);
  });

  it('finds its own issue after an uncertain failure instead of creating a duplicate', async () => {
    let posts = 0;
    const { service } = makeService((method, path) => {
      if (method === 'POST') {
        posts++;
        return json({ message: 'Bad gateway' }, 502);
      }
      if (path === '/repos/orbit-owner/app/issues') {
        return json([issue({ number: 13, title: 'Once', body: 'Only once' })]);
      }
      return json({}, 404);
    });

    const created = await service.createIssue(REPO, { title: 'Once', body: 'Only once' });

    expect(created.summary.number).toBe(13);
    expect(posts).toBe(1);
  });

  it('refuses before sending anything while writes are paused', async () => {
    const { service, calls } = makeService(() => json({}, 500), { canWrite: () => false });

    await expect(service.createIssue(REPO, { title: 'T', body: '' })).rejects.toBeInstanceOf(
      WriteBlockedError
    );
    expect(calls).toEqual([]);
  });
});

describe('IssueService.updateIssue', () => {
  it('saves the title and body when GitHub still holds the version the user started from', async () => {
    const { service, calls } = makeService((method) =>
      method === 'PATCH'
        ? json(
            issue({
              title: 'Renamed',
              body: 'New text',
              updated_at: '2026-01-04T00:00:00Z',
              body_html: '<p>New text</p>'
            })
          )
        : json(issue())
    );

    const result = await service.updateIssue(
      REPO,
      4,
      { title: 'Renamed', body: 'New text' },
      '2026-01-03T00:00:00Z'
    );

    expect(result.kind).toBe('saved');
    if (result.kind === 'saved') {
      expect(result.issue.summary.title).toBe('Renamed');
      expect(result.issue.bodyHtml).toBe('<p>New text</p>');
    }
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.path).toBe(ISSUE_PATH);
    expect(patch?.body).toEqual({ title: 'Renamed', body: 'New text' });
  });

  it('returns the newer version and writes nothing when GitHub changed the issue since the base', async () => {
    const { service, calls } = makeService(() =>
      json(issue({ updated_at: '2026-01-09T00:00:00Z', title: 'Theirs' }))
    );

    const result = await service.updateIssue(REPO, 4, { title: 'Mine', body: 'x' }, '2026-01-03T00:00:00Z');

    expect(result.kind).toBe('conflict');
    if (result.kind === 'conflict') expect(result.current.summary.title).toBe('Theirs');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('validates the title before reading or writing', async () => {
    const { service, calls } = makeService(() => json(issue()));

    await expect(service.updateIssue(REPO, 4, { title: '', body: '' }, 'x')).rejects.toThrow(/title/i);
    expect(calls).toEqual([]);
  });
});

describe('IssueService.updateIssueFields', () => {
  it('sends the full label, assignee, and milestone choice and returns the reconciled summary', async () => {
    const { service, calls } = makeService(() =>
      json(
        issue({
          labels: [
            { name: 'bug', color: 'd73a4a' },
            { name: 'urgent', color: 'ff0000' }
          ],
          assignees: [{ login: 'helper' }, { login: 'orbit-owner' }],
          milestone: { number: 3, title: 'v2' }
        })
      )
    );

    const summary = await service.updateIssueFields(REPO, 4, {
      labels: ['bug', 'urgent'],
      assignees: ['helper', 'orbit-owner'],
      milestoneNumber: 3
    });

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({
      labels: ['bug', 'urgent'],
      assignees: ['helper', 'orbit-owner'],
      milestone: 3
    });
    expect(summary.labels.map((l) => l.name)).toEqual(['bug', 'urgent']);
    expect(summary.assignees).toEqual(['helper', 'orbit-owner']);
    expect(summary.milestone).toEqual({ number: 3, title: 'v2' });
  });

  it('clears the milestone when none is chosen', async () => {
    const { service, calls } = makeService(() => json(issue({ milestone: null })));

    const summary = await service.updateIssueFields(REPO, 4, {
      labels: [],
      assignees: [],
      milestoneNumber: null
    });

    expect(calls[0]?.body).toEqual({ labels: [], assignees: [], milestone: null });
    expect(summary.milestone).toBeNull();
  });
});

describe('IssueService.setIssueState', () => {
  it('closes as completed or as not planned', async () => {
    const { service, calls } = makeService(() =>
      json(issue({ state: 'closed', state_reason: 'not_planned' }))
    );

    const summary = await service.setIssueState(REPO, 4, 'closed', 'not_planned');

    expect(calls[0]?.body).toEqual({ state: 'closed', state_reason: 'not_planned' });
    expect(summary.state).toBe('closed');
    expect(summary.stateReason).toBe('not_planned');
  });

  it('reopens without sending a close reason', async () => {
    const { service, calls } = makeService(() => json(issue({ state: 'open' })));

    const summary = await service.setIssueState(REPO, 4, 'open');

    expect(calls[0]?.body).toEqual({ state: 'open' });
    expect(summary.state).toBe('open');
  });
});

describe('IssueService.getRepoOptions', () => {
  it('reads the labels, assignees, and open milestones the repo offers', async () => {
    const { service, calls } = makeService((_method, path) => {
      if (path.endsWith('/labels')) return json([{ name: 'bug', color: 'd73a4a' }]);
      if (path.endsWith('/assignees')) return json([{ login: 'helper' }]);
      if (path.endsWith('/milestones')) return json([{ number: 2, title: 'v1' }]);
      return json({}, 404);
    });

    const options = await service.getRepoOptions(REPO);

    expect(options).toEqual({
      labels: [{ name: 'bug', color: 'd73a4a' }],
      assignees: ['helper'],
      milestones: [{ number: 2, title: 'v1' }]
    });
    expect(calls.find((c) => c.path.endsWith('/milestones'))?.search).toContain('state=open');
  });
});

describe('IssueService.setTaskItem', () => {
  it('ticks only the requested checkbox when the body is still the version the user saw', async () => {
    const { service, calls } = makeService((method) =>
      method === 'PATCH'
        ? json(issue({ body: 'Steps:\n- [x] reproduce\n- [x] report', body_html: '<p>x</p>' }))
        : json(issue())
    );

    const result = await service.setTaskItem(REPO, 4, {
      index: 0,
      checked: true,
      expectedBody: 'Steps:\n- [ ] reproduce\n- [x] report'
    });

    expect(result.kind).toBe('saved');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      body: 'Steps:\n- [x] reproduce\n- [x] report'
    });
  });

  it('asks the user to refresh, without writing, when the body changed upstream', async () => {
    const { service, calls } = makeService(() => json(issue({ body: 'Rewritten entirely' })));

    const result = await service.setTaskItem(REPO, 4, {
      index: 0,
      checked: true,
      expectedBody: 'Steps:\n- [ ] reproduce\n- [x] report'
    });

    expect(result.kind).toBe('stale');
    if (result.kind === 'stale') expect(result.current.body).toBe('Rewritten entirely');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('refuses an index with no task item rather than editing another line', async () => {
    const { service, calls } = makeService(() => json(issue()));

    await expect(
      service.setTaskItem(REPO, 4, {
        index: 9,
        checked: true,
        expectedBody: 'Steps:\n- [ ] reproduce\n- [x] report'
      })
    ).rejects.toThrow(/no task item/i);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});
