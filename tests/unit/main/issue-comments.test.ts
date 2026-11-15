import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { IssueService } from '../../../src/main/github/issue-service';
import { WriteBlockedError } from '../../../src/main/github/write-reconcile';
import { GitHubRequestError } from '../../../src/main/github/github-client';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 7, login: 'orbit-owner', persistent: true };
const HTML = 'application/vnd.github.html+json';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
}

function comment(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    user: { login: 'orbit-owner' },
    body: 'Thanks **a lot**',
    created_at: '2026-01-05T00:00:00Z',
    updated_at: '2026-01-05T00:00:00Z',
    html_url: 'https://github.com/orbit-owner/app/issues/4#issuecomment-501',
    body_html: '<p>Thanks <strong>a lot</strong></p>',
    ...overrides
  };
}

interface Harness {
  service: IssueService;
  fetch: ReturnType<typeof vi.fn>;
}

function makeService(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
  options: { canWrite?: () => boolean } = {}
): Harness {
  const fetch = vi.fn(async (url: string, init: RequestInit) => responder(url, init));
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
  return { service, fetch };
}

describe('IssueService.previewMarkdown', () => {
  it('renders the text as GFM in the repo context and returns the HTML', async () => {
    const { service, fetch } = makeService(() => htmlResponse('<p>Hi <strong>there</strong></p>'));

    const html = await service.previewMarkdown('orbit-owner/app', 'Hi **there**');

    expect(html).toBe('<p>Hi <strong>there</strong></p>');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.test/markdown');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      text: 'Hi **there**',
      mode: 'gfm',
      context: 'orbit-owner/app'
    });
  });
});

describe('IssueService.createComment', () => {
  it('posts the body to the issue and returns the saved comment with rendered HTML', async () => {
    const { service, fetch } = makeService(() => jsonResponse(comment(), 201));

    const saved = await service.createComment('orbit-owner/app', 4, 'Thanks **a lot**');

    expect(saved).toEqual({
      id: 501,
      authorLogin: 'orbit-owner',
      body: 'Thanks **a lot**',
      createdAt: '2026-01-05T00:00:00Z',
      updatedAt: '2026-01-05T00:00:00Z',
      htmlUrl: 'https://github.com/orbit-owner/app/issues/4#issuecomment-501',
      bodyHtml: '<p>Thanks <strong>a lot</strong></p>'
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.test/repos/orbit-owner/app/issues/4/comments');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).accept).toBe(HTML);
    expect(JSON.parse(String(init.body))).toEqual({ body: 'Thanks **a lot**' });
  });

  it('refuses before sending anything while writes are paused', async () => {
    const { service, fetch } = makeService(() => jsonResponse(comment(), 201), { canWrite: () => false });

    await expect(service.createComment('orbit-owner/app', 4, 'hello')).rejects.toBeInstanceOf(
      WriteBlockedError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an empty or over-long body before sending anything', async () => {
    const { service, fetch } = makeService(() => jsonResponse(comment(), 201));

    await expect(service.createComment('orbit-owner/app', 4, '   ')).rejects.toThrow('empty');
    await expect(service.createComment('orbit-owner/app', 4, 'x'.repeat(65_537))).rejects.toThrow('65,536');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('finds its own comment on the thread after an uncertain failure, instead of posting twice', async () => {
    let posts = 0;
    const { service, fetch } = makeService((_url, init) => {
      if (init.method === 'POST') {
        posts++;
        throw new TypeError('socket hang up');
      }
      // Reconcile reads the thread's comments; the earlier POST did land.
      return jsonResponse([comment({ body: 'hello', created_at: new Date().toISOString() })]);
    });

    const saved = await service.createComment('orbit-owner/app', 4, 'hello');

    expect(saved.body).toBe('hello');
    expect(posts).toBe(1);
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('GitHubRequestError kinds from comment writes', () => {
  it('surfaces a definite rejection without retrying', async () => {
    const { service, fetch } = makeService(() => jsonResponse({ message: 'Unprocessable' }, 422));

    await expect(service.createComment('orbit-owner/app', 4, 'hello')).rejects.toBeInstanceOf(
      GitHubRequestError
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('IssueService.updateComment', () => {
  const BASE = '2026-01-05T00:00:00Z';

  it('saves the new body when the comment is unchanged since the user started editing', async () => {
    const { service, fetch } = makeService((_url, init) => {
      if (init.method === 'PATCH')
        return jsonResponse(
          comment({ body: 'Edited', updated_at: '2026-01-06T00:00:00Z', body_html: '<p>Edited</p>' })
        );
      return jsonResponse(comment());
    });

    const result = await service.updateComment('orbit-owner/app', 501, 'Edited', BASE);

    expect(result).toEqual({
      kind: 'saved',
      comment: expect.objectContaining({ id: 501, body: 'Edited', updatedAt: '2026-01-06T00:00:00Z' })
    });
    const patch = fetch.mock.calls.find(
      ([, init]) => (init as RequestInit).method === 'PATCH'
    ) as unknown as [string, RequestInit];
    expect(patch[0]).toBe('https://api.github.test/repos/orbit-owner/app/issues/comments/501');
    expect(JSON.parse(String(patch[1].body))).toEqual({ body: 'Edited' });
  });

  it('returns the newer version and does not overwrite when GitHub changed the comment since the base', async () => {
    const newer = comment({
      body: 'Changed by a teammate',
      updated_at: '2026-01-07T00:00:00Z',
      body_html: '<p>Changed</p>'
    });
    const { service, fetch } = makeService(() => jsonResponse(newer));

    const result = await service.updateComment('orbit-owner/app', 501, 'Mine', BASE);

    expect(result.kind).toBe('conflict');
    expect(result).toEqual({
      kind: 'conflict',
      current: expect.objectContaining({ body: 'Changed by a teammate' })
    });
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit).method === 'PATCH')).toBe(false);
  });

  it('refuses to edit a comment written by someone else, without sending a write', async () => {
    const { service, fetch } = makeService(() => jsonResponse(comment({ user: { login: 'someone-else' } })));

    await expect(service.updateComment('orbit-owner/app', 501, 'Mine', BASE)).rejects.toThrow('your own');
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit).method === 'PATCH')).toBe(false);
  });

  it('validates the new body before reading or writing', async () => {
    const { service, fetch } = makeService(() => jsonResponse(comment()));

    await expect(service.updateComment('orbit-owner/app', 501, '  ', BASE)).rejects.toThrow('empty');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('IssueService.deleteComment', () => {
  it("deletes the user's own comment", async () => {
    const { service, fetch } = makeService((_url, init) => {
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return jsonResponse(comment());
    });

    await service.deleteComment('orbit-owner/app', 501);

    const del = fetch.mock.calls.find(([, init]) => (init as RequestInit).method === 'DELETE') as unknown as [
      string
    ];
    expect(del[0]).toBe('https://api.github.test/repos/orbit-owner/app/issues/comments/501');
  });

  it('treats a comment that is already gone after an uncertain failure as deleted', async () => {
    let deleteAttempted = false;
    const { service } = makeService((_url, init) => {
      if (init.method === 'DELETE') {
        deleteAttempted = true;
        throw new TypeError('socket hang up');
      }
      // Before the DELETE the comment exists; afterwards GitHub no longer has it, so the DELETE landed.
      return deleteAttempted ? jsonResponse({ message: 'Not Found' }, 404) : jsonResponse(comment());
    });

    await expect(service.deleteComment('orbit-owner/app', 501)).resolves.toBeUndefined();
  });

  it("refuses to delete someone else's comment", async () => {
    const { service, fetch } = makeService(() => jsonResponse(comment({ user: { login: 'someone-else' } })));

    await expect(service.deleteComment('orbit-owner/app', 501)).rejects.toThrow('your own');
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit).method === 'DELETE')).toBe(false);
  });
});
