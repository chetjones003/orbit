import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { GitHubRequestError } from '../../../src/main/github/github-client';
import { GitHubClient } from '../../../src/main/github/github-client';
import { NotificationService } from '../../../src/main/github/notification-service';

const API = 'https://api.github.test';
const LOGIN = 'orbit-owner';

interface ThreadOptions {
  id: string;
  repo?: string;
  owner?: string;
  title?: string;
  subjectType?: string;
  subjectUrl?: string | null;
  updatedAt?: string;
  reason?: string;
}

function thread(opts: ThreadOptions) {
  const repo = opts.repo ?? 'orbit-owner/app';
  const subjectUrl = opts.subjectUrl === undefined ? `${API}/repos/${repo}/issues/12` : opts.subjectUrl;
  return {
    id: opts.id,
    unread: true,
    reason: opts.reason ?? 'mention',
    updated_at: opts.updatedAt ?? '2026-01-01T10:00:00Z',
    repository: { full_name: repo, owner: { login: opts.owner ?? LOGIN } },
    subject: { title: opts.title ?? 'Fix the thing', type: opts.subjectType ?? 'Issue', url: subjectUrl }
  };
}

function json(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

/** A fake GitHub that serves a mutable list of unread threads at /notifications. */
function harness(options: { sessionId?: number } = {}) {
  let threads: unknown[] = [];
  let pollHeader: Record<string, string> = {};
  const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Response(null, { status: 205 });
    return json(threads, pollHeader);
  });
  const status = {
    kind: 'signed-in' as const,
    sessionId: options.sessionId ?? 7,
    login: LOGIN,
    persistent: true
  };
  const auth = {
    getStatus: () => status,
    getAccessToken: vi.fn(async () => 'secret')
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  const client = new GitHubClient({ apiBaseUrl: API, fetch });
  const service = new NotificationService({ auth, apiBaseUrl: API, client });
  return {
    fetch,
    service,
    setThreads(next: unknown[]) {
      threads = next;
    },
    setPollInterval(seconds: string) {
      pollHeader = { 'x-poll-interval': seconds };
    },
    setSession(sessionId: number) {
      status.sessionId = sessionId;
    }
  };
}

describe('NotificationService', () => {
  it('reports a quiet baseline summary on the first poll instead of individual items', async () => {
    const h = harness();
    h.setThreads([thread({ id: '1' }), thread({ id: '2', title: 'Second' })]);

    const result = await h.service.poll();

    expect(result.delivery).toEqual({ kind: 'summary', count: 2, desktop: false });
  });

  it('polls only unread notifications of personal repos and asks for them with the owner filter', async () => {
    const h = harness();
    h.setThreads([thread({ id: '1' }), thread({ id: '2', repo: 'an-org/shared', owner: 'an-org' })]);

    await h.service.poll();

    expect(h.fetch).toHaveBeenCalledWith(
      `${API}/notifications?participating=false`,
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer secret' }) })
    );
    const result = await h.service.poll();
    expect(result.delivery).toBeNull();
  });

  it('emits the new personal notifications as items with their issue or pull target', async () => {
    const h = harness();
    h.setThreads([thread({ id: '1' })]);
    await h.service.poll(); // quiet baseline

    h.setThreads([
      thread({ id: '1' }),
      thread({ id: '2', title: 'Review please', subjectUrl: `${API}/repos/orbit-owner/app/pulls/30` }),
      thread({ id: '3', title: 'Release', subjectType: 'Release', subjectUrl: null })
    ]);
    const result = await h.service.poll();

    expect(result.delivery).toMatchObject({
      kind: 'items',
      items: [
        {
          threadId: '2',
          repoFullName: 'orbit-owner/app',
          title: 'Review please',
          reason: 'mention',
          target: { kind: 'pull', repoFullName: 'orbit-owner/app', number: 30 }
        },
        { threadId: '3', title: 'Release', target: null }
      ]
    });
  });

  it('does not repeat a notification it already reported in this session', async () => {
    const h = harness();
    h.setThreads([thread({ id: '1' })]);
    await h.service.poll();
    h.setThreads([thread({ id: '1' }), thread({ id: '2' })]);
    await h.service.poll();

    const again = await h.service.poll();

    expect(again.delivery).toBeNull();
  });

  it('reports a thread again when GitHub shows it updated since it was reported', async () => {
    const h = harness();
    h.setThreads([thread({ id: '1' })]);
    await h.service.poll();
    h.setThreads([thread({ id: '1' }), thread({ id: '2' })]);
    await h.service.poll();

    h.setThreads([thread({ id: '1' }), thread({ id: '2', updatedAt: '2026-01-01T12:00:00Z' })]);
    const result = await h.service.poll();

    expect(result.delivery).toMatchObject({ kind: 'items', items: [{ threadId: '2' }] });
  });

  it('summarises a large catch-up instead of one desktop notification per item', async () => {
    const h = harness();
    h.setThreads([]);
    await h.service.poll();

    h.setThreads([1, 2, 3, 4, 5].map((n) => thread({ id: String(n) })));
    const result = await h.service.poll();

    expect(result.delivery).toEqual({ kind: 'summary', count: 5, desktop: true });
  });

  it('starts quiet again when the signed-in account changes', async () => {
    const h = harness({ sessionId: 7 });
    h.setThreads([thread({ id: '1' })]);
    await h.service.poll();

    h.setSession(8);
    h.setThreads([thread({ id: '1' }), thread({ id: '9' })]);
    const result = await h.service.poll();

    expect(result.delivery).toEqual({ kind: 'summary', count: 2, desktop: false });
  });

  it('passes through GitHub X-Poll-Interval so the engine can slow down', async () => {
    const h = harness();
    h.setPollInterval('120');
    h.setThreads([]);

    await expect(h.service.poll()).resolves.toMatchObject({ pollIntervalMs: 120_000 });
  });

  it('marks a thread read with a PATCH to its thread endpoint', async () => {
    const h = harness();
    await h.service.markRead('42');

    expect(h.fetch).toHaveBeenCalledWith(
      `${API}/notifications/threads/42`,
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('surfaces a mark-read failure so the caller can report it', async () => {
    const fetch = vi.fn(async () => json({ message: 'boom' }, {}, 500));
    const auth = {
      getStatus: () => ({ kind: 'signed-in' as const, sessionId: 7, login: LOGIN, persistent: true }),
      getAccessToken: vi.fn(async () => 'secret')
    } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
    const service = new NotificationService({
      auth,
      apiBaseUrl: API,
      client: new GitHubClient({ apiBaseUrl: API, fetch })
    });

    await expect(service.markRead('42')).rejects.toBeInstanceOf(GitHubRequestError);
  });

  it('delivers nothing when the account changed while the poll was in flight', async () => {
    let session = 7;
    const fetch = vi.fn(async () => {
      session = 8; // the account changes while GitHub is answering
      return json([thread({ id: '1' })]);
    });
    const auth = {
      getStatus: () => ({ kind: 'signed-in' as const, sessionId: session, login: LOGIN, persistent: true }),
      getAccessToken: vi.fn(async () => 'secret')
    } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
    const service = new NotificationService({
      auth,
      apiBaseUrl: API,
      client: new GitHubClient({ apiBaseUrl: API, fetch })
    });

    await expect(service.poll()).resolves.toMatchObject({ delivery: null });
  });

  it('refuses to poll while signed out', async () => {
    const auth = {
      getStatus: () => ({ kind: 'signed-out' as const }),
      getAccessToken: vi.fn()
    } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
    const service = new NotificationService({ auth, apiBaseUrl: API });

    await expect(service.poll()).rejects.toThrow(/sign in/i);
  });
});
