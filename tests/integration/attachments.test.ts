import { afterEach, describe, expect, it } from 'vitest';
import { startFakeGitHub, type FakeGitHub, type FakeRoute } from '../fakes/github';
import { GitHubClient } from '../../src/main/github/github-client';
import { IssueService } from '../../src/main/github/issue-service';
import type { IssueServiceOptions } from '../../src/main/github/issue-service';

/**
 * Real HTTP against the controlled GitHub stand-in for an attachment upload: the request GitHub receives
 * (path, query, token, content type, raw bytes) and the link that comes back. Routine runs never touch
 * real GitHub.
 */
const REPO_PATH = '/repos/orbit-owner/app';
const UPLOAD_PATH = '/user-attachments/assets?name=shot.png&content_type=image%2Fpng&repository_id=555';
const LINK = 'https://github.com/user-attachments/assets/3f2a-91bc';

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
    uploadsBaseUrl: url,
    client: new GitHubClient({ apiBaseUrl: url, uploadsBaseUrl: url }),
    canWrite
  });
}

async function start(routes: FakeRoute[]): Promise<FakeGitHub> {
  fake = await startFakeGitHub(routes);
  return fake;
}

describe('attachment upload over HTTP', () => {
  it('posts the raw file to the uploads endpoint with the token and returns the link GitHub issues', async () => {
    const server = await start([
      { method: 'GET', path: REPO_PATH, body: { id: 555, private: true, permissions: { push: true } } },
      { method: 'POST', path: UPLOAD_PATH, status: 201, body: { href: LINK } }
    ]);
    const bytes = new TextEncoder().encode('PNG-bytes');

    const result = await service(server.url).uploadAttachment(
      'orbit-owner/app',
      { name: 'shot.png', bytes },
      { acknowledgedPublic: false }
    );

    expect(result).toEqual({ kind: 'uploaded', url: LINK });
    const upload = server.received.find((r) => r.method === 'POST' && r.path === UPLOAD_PATH);
    expect(upload?.headers['authorization']).toBe('Bearer token');
    expect(upload?.headers['content-type']).toBe('image/png');
    expect(upload?.body).toBe('PNG-bytes');
  });

  it('sends nothing to the uploads endpoint when the user lacks write access', async () => {
    const server = await start([
      { method: 'GET', path: REPO_PATH, body: { id: 555, private: true, permissions: { push: false } } },
      { method: 'POST', path: UPLOAD_PATH, status: 201, body: { href: LINK } }
    ]);

    await expect(
      service(server.url).uploadAttachment(
        'orbit-owner/app',
        { name: 'shot.png', bytes: new Uint8Array([1, 2, 3]) },
        { acknowledgedPublic: false }
      )
    ).rejects.toThrow('You need write access to this repo to attach files.');
    expect(server.received.some((r) => r.path === UPLOAD_PATH)).toBe(false);
  });

  it('surfaces an endpoint that refuses the file, so the composer can offer the GitHub fallback', async () => {
    const server = await start([
      { method: 'GET', path: REPO_PATH, body: { id: 555, private: true, permissions: { push: true } } },
      { method: 'POST', path: UPLOAD_PATH, status: 422, body: { message: 'unprocessable' } }
    ]);

    await expect(
      service(server.url).uploadAttachment(
        'orbit-owner/app',
        { name: 'shot.png', bytes: new Uint8Array([1]) },
        { acknowledgedPublic: false }
      )
    ).rejects.toThrow('GitHub returned 422.');
  });
});
