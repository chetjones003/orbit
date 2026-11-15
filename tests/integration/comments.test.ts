import { afterEach, describe, expect, it } from 'vitest';
import { startFakeGitHub, type FakeGitHub } from '../fakes/github';
import { GitHubClient } from '../../src/main/github/github-client';
import { IssueService } from '../../src/main/github/issue-service';
import type { IssueServiceOptions } from '../../src/main/github/issue-service';

/**
 * Real HTTP against the controlled GitHub stand-in: comment writes, their headers and bodies, edit
 * conflicts, and the write gate. Routine runs never touch real GitHub.
 */
const COMMENTS_PATH = '/repos/orbit-owner/app/issues/4/comments';
const COMMENT_PATH = '/repos/orbit-owner/app/issues/comments/9';
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

const mine = {
  id: 9,
  user: { login: 'orbit-owner' },
  body: 'Original text',
  body_html: '<p>Original text</p>',
  created_at: '2026-01-04T00:00:00Z',
  updated_at: '2026-01-04T00:00:00Z',
  html_url: 'https://github.com/orbit-owner/app/issues/4#issuecomment-9'
};

describe('comments over HTTP', () => {
  it('renders previews in the repo context and posts a comment with the rendered HTML', async () => {
    fake = await startFakeGitHub([
      { method: 'POST', path: '/markdown', headers: { 'content-type': 'text/html' }, body: '<p>hi</p>' },
      { method: 'POST', path: COMMENTS_PATH, status: 201, body: { ...mine, id: 10, body: 'hi' } }
    ]);
    const issues = service(fake.url);

    await expect(issues.previewMarkdown('orbit-owner/app', 'hi')).resolves.toBe('<p>hi</p>');
    const saved = await issues.createComment('orbit-owner/app', 4, 'hi');

    expect(saved).toMatchObject({ id: 10, body: 'hi' });
    const preview = fake.received.find((r) => r.path === '/markdown');
    expect(JSON.parse(preview?.body ?? '{}')).toEqual({
      text: 'hi',
      mode: 'gfm',
      context: 'orbit-owner/app'
    });
    const post = fake.received.find((r) => r.method === 'POST' && r.path === COMMENTS_PATH);
    expect(post?.headers['accept']).toBe('application/vnd.github.html+json');
    expect(post?.headers['authorization']).toBe('Bearer token');
  });

  it('sends an edit as a PATCH only when GitHub still holds the version the user started from', async () => {
    fake = await startFakeGitHub([
      { method: 'GET', path: COMMENT_PATH, body: mine },
      { method: 'PATCH', path: COMMENT_PATH, body: { ...mine, body: 'Fixed', body_html: '<p>Fixed</p>' } }
    ]);

    const result = await service(fake.url).updateComment('orbit-owner/app', 9, 'Fixed', mine.updated_at);

    expect(result).toMatchObject({ kind: 'saved', comment: { body: 'Fixed' } });
    expect(fake.received.some((r) => r.method === 'PATCH')).toBe(true);
  });

  it('does not write over a newer version GitHub holds, and returns it instead', async () => {
    const newer = {
      ...mine,
      body: 'Teammate edit',
      body_html: '<p>Teammate edit</p>',
      updated_at: '2026-01-09T00:00:00Z'
    };
    fake = await startFakeGitHub([{ method: 'GET', path: COMMENT_PATH, body: newer }]);

    const result = await service(fake.url).updateComment('orbit-owner/app', 9, 'Mine', mine.updated_at);

    expect(result).toMatchObject({ kind: 'conflict', current: { body: 'Teammate edit' } });
    expect(fake.received.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it("deletes the user's own comment with one DELETE request", async () => {
    fake = await startFakeGitHub([
      { method: 'GET', path: COMMENT_PATH, body: mine },
      { method: 'DELETE', path: COMMENT_PATH, status: 204 }
    ]);

    await service(fake.url).deleteComment('orbit-owner/app', 9);

    expect(fake.received.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  });

  it('sends nothing at all while writes are paused', async () => {
    fake = await startFakeGitHub([{ method: 'POST', path: COMMENTS_PATH, status: 201, body: mine }]);

    await expect(service(fake.url, () => false).createComment('orbit-owner/app', 4, 'hello')).rejects.toThrow(
      'paused'
    );
    expect(fake.received).toHaveLength(0);
  });
});
