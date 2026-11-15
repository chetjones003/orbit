import { afterEach, describe, expect, it } from 'vitest';
import { startFakeGitHub, type FakeGitHub } from '../fakes/github';
import { GitHubClient, GitHubRequestError } from '../../src/main/github/github-client';
import { InboxService, buildInboxSearchQuery } from '../../src/main/github/inbox-service';
import type { InboxServiceOptions } from '../../src/main/github/inbox-service';

/**
 * Real HTTP against a controlled GitHub stand-in: the inbox search query is sent
 * exactly as built, and GitHub's answers, including rate limits, reach the caller.
 */
const LOGIN = 'orbit-owner';
const auth = {
  getStatus: () => ({ kind: 'signed-in' as const, sessionId: 1, login: LOGIN, persistent: true }),
  getAccessToken: async () => 'token'
} as unknown as InboxServiceOptions['auth'];

/** The exact path the service requests for the first page of a tab. */
function searchPath(query: string, page = 1): string {
  return `/search/issues?${new URLSearchParams({
    q: query,
    sort: 'updated',
    order: 'desc',
    per_page: '30',
    page: String(page)
  }).toString()}`;
}

const pullItem = {
  id: 501,
  number: 12,
  title: 'Review me',
  state: 'open',
  user: { login: LOGIN },
  labels: [{ name: 'needs-review', color: 'ff0000' }],
  comments: 4,
  updated_at: '2026-03-01T10:00:00Z',
  html_url: 'https://github.com/orbit-owner/app/pull/12',
  repository_url: 'https://api.github.com/repos/orbit-owner/app',
  draft: false,
  pull_request: { url: 'https://api.github.com/repos/orbit-owner/app/pulls/12' }
};

let fake: FakeGitHub | undefined;

afterEach(async () => {
  await fake?.close().catch(() => undefined);
  fake = undefined;
});

function serviceFor(url: string): InboxService {
  return new InboxService({ auth, apiBaseUrl: url, client: new GitHubClient({ apiBaseUrl: url }) });
}

describe('inbox over HTTP', () => {
  it('searches the review-requested tab and maps the results', async () => {
    const query = buildInboxSearchQuery('review-requested', LOGIN);
    fake = await startFakeGitHub([
      {
        method: 'GET',
        path: searchPath(query),
        body: { total_count: 1, incomplete_results: false, items: [pullItem] }
      }
    ]);

    await expect(serviceFor(fake.url).list({ tab: 'review-requested', page: 1 })).resolves.toEqual({
      tab: 'review-requested',
      page: 1,
      hasNextPage: false,
      partial: false,
      items: [
        {
          repoFullName: 'orbit-owner/app',
          number: 12,
          kind: 'pull',
          title: 'Review me',
          state: 'open',
          isDraft: false,
          authorLogin: LOGIN,
          labels: [{ name: 'needs-review', color: 'ff0000' }],
          commentCount: 4,
          updatedAt: '2026-03-01T10:00:00Z',
          htmlUrl: 'https://github.com/orbit-owner/app/pull/12'
        }
      ]
    });
    expect(fake.requests).toEqual([{ method: 'GET', path: searchPath(query) }]);
  });

  it('labels GitHub’s incomplete search results as partial', async () => {
    const query = buildInboxSearchQuery('mentioned', LOGIN);
    fake = await startFakeGitHub([
      {
        method: 'GET',
        path: searchPath(query),
        body: { total_count: 1, incomplete_results: true, items: [pullItem] }
      }
    ]);
    await expect(serviceFor(fake.url).list({ tab: 'mentioned', page: 1 })).resolves.toMatchObject({
      partial: true
    });
  });

  it('surfaces a rate limit as an error instead of an empty tab', async () => {
    const query = buildInboxSearchQuery('assigned', LOGIN);
    fake = await startFakeGitHub([
      {
        method: 'GET',
        path: searchPath(query),
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' },
        body: { message: 'API rate limit exceeded' }
      }
    ]);
    const failure = await serviceFor(fake.url)
      .list({ tab: 'assigned', page: 1 })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(failure).toBeInstanceOf(GitHubRequestError);
    expect((failure as GitHubRequestError).kind).toBe('rate-limited');
  });
});
