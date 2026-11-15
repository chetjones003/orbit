import { afterEach, describe, expect, it } from 'vitest';
import { startFakeGitHub, type FakeGitHub, type FakeRoute } from '../fakes/github';
import { GitHubClient } from '../../src/main/github/github-client';
import { IssueService } from '../../src/main/github/issue-service';
import type { IssueServiceOptions } from '../../src/main/github/issue-service';

/**
 * Real HTTP against the controlled GitHub stand-in: issue creates, edits with conflicts, field and state
 * writes, and task checkboxes, including the headers and bodies GitHub receives. Routine runs never touch
 * real GitHub.
 */
const ISSUE_PATH = '/repos/orbit-owner/app/issues/4';
const ISSUES_PATH = '/repos/orbit-owner/app/issues';
const HTML = 'application/vnd.github.html+json';
const BODY = 'Steps:\n- [ ] reproduce\n- [x] report';

const auth = {
  getStatus: () => ({ kind: 'signed-in' as const, sessionId: 1, login: 'orbit-owner', persistent: true }),
  getAccessToken: async () => 'token'
} as unknown as IssueServiceOptions['auth'];

let fake: FakeGitHub | undefined;

afterEach(async () => {
  await fake?.close().catch(() => undefined);
  fake = undefined;
});

function service(url: string, canWrite?: () => boolean): IssueService {
  return new IssueService({
    auth,
    apiBaseUrl: url,
    client: new GitHubClient({ apiBaseUrl: url }),
    canWrite
  });
}

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: 104,
    number: 4,
    title: 'Crash on save',
    state: 'open',
    state_reason: null,
    user: { login: 'orbit-owner' },
    labels: [],
    assignees: [],
    milestone: null,
    comments: 0,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    html_url: 'https://github.com/orbit-owner/app/issues/4',
    body: BODY,
    body_html: '<ul><li>reproduce</li></ul>',
    ...overrides
  };
}

async function start(routes: FakeRoute[]): Promise<FakeGitHub> {
  fake = await startFakeGitHub(routes);
  return fake;
}

describe('issue writes over HTTP', () => {
  it('creates an issue with the HTML media type and the title and body as JSON', async () => {
    const server = await start([
      {
        method: 'POST',
        path: ISSUES_PATH,
        status: 201,
        body: issue({ number: 12, title: 'New bug', body: 'x' })
      }
    ]);

    const created = await service(server.url).createIssue('orbit-owner/app', { title: 'New bug', body: 'x' });

    expect(created.summary.number).toBe(12);
    const sent = server.received.find((r) => r.method === 'POST' && r.path === ISSUES_PATH);
    expect(JSON.parse(sent?.body ?? '{}')).toEqual({ title: 'New bug', body: 'x' });
    expect(sent?.headers.accept).toBe(HTML);
  });

  it('writes nothing when GitHub holds a newer issue than the one the edit started from', async () => {
    const server = await start([
      {
        method: 'GET',
        path: ISSUE_PATH,
        body: issue({ updated_at: '2026-01-09T00:00:00Z', title: 'Renamed by a teammate' })
      },
      { method: 'PATCH', path: ISSUE_PATH, body: issue() }
    ]);

    const result = await service(server.url).updateIssue(
      'orbit-owner/app',
      4,
      { title: 'Mine', body: BODY },
      { title: 'Crash on save', body: BODY }
    );

    expect(result.kind).toBe('conflict');
    expect(server.requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('sends the labels, assignees, and milestone as the full lists GitHub should hold', async () => {
    const server = await start([
      {
        method: 'PATCH',
        path: ISSUE_PATH,
        body: issue({
          labels: [{ name: 'bug', color: 'd73a4a' }],
          assignees: [{ login: 'helper' }],
          milestone: { number: 2, title: 'v1' }
        })
      },
      { method: 'GET', path: ISSUE_PATH, body: issue({ labels: [{ name: 'bug', color: 'd73a4a' }] }) }
    ]);

    const summary = await service(server.url).updateIssueFields('orbit-owner/app', 4, {
      labels: ['bug'],
      assignees: ['helper'],
      milestoneNumber: 2
    });

    const sent = server.received.find((r) => r.method === 'PATCH');
    expect(JSON.parse(sent?.body ?? '{}')).toEqual({ labels: ['bug'], assignees: ['helper'], milestone: 2 });
    expect(summary.assignees).toEqual(['helper']);
  });

  it('ticks one checkbox in the body and leaves every other line as it was', async () => {
    const server = await start([
      { method: 'GET', path: ISSUE_PATH, body: issue() },
      { method: 'PATCH', path: ISSUE_PATH, body: issue({ body: 'Steps:\n- [x] reproduce\n- [x] report' }) }
    ]);

    const result = await service(server.url).setTaskItem('orbit-owner/app', 4, {
      index: 0,
      checked: true,
      expectedBody: BODY
    });

    expect(result.kind).toBe('saved');
    const sent = server.received.find((r) => r.method === 'PATCH');
    expect(JSON.parse(sent?.body ?? '{}')).toEqual({ body: 'Steps:\n- [x] reproduce\n- [x] report' });
  });

  it('sends nothing at all while writes are paused', async () => {
    const server = await start([]);

    await expect(
      service(server.url, () => false).setIssueState('orbit-owner/app', 4, 'closed', 'completed')
    ).rejects.toThrow(/paused/i);
    expect(server.requests).toEqual([]);
  });
});
