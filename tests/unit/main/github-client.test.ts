import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubRequestError } from '../../../src/main/github/github-client';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

describe('GitHubClient', () => {
  it('sends the bearer token and returns the parsed body', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, [{ id: 1 }], { etag: '"v1"' }));
    const client = new GitHubClient({ apiBaseUrl: 'https://api.github.test/', fetch });

    await expect(client.get('/user/repos', { token: 'tok', scope: 's1' })).resolves.toEqual([{ id: 1 }]);
    expect(fetch).toHaveBeenCalledWith('https://api.github.test/user/repos', {
      headers: { authorization: 'Bearer tok', accept: 'application/vnd.github+json' }
    });
  });

  it('revalidates with If-None-Match and reuses the cached body on 304', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { n: 1 }, { etag: '"v1"' }))
      .mockResolvedValueOnce(jsonResponse(304, null, { etag: '"v1"' }));
    const client = new GitHubClient({ apiBaseUrl: 'https://api.github.test', fetch });

    await client.get('/x', { token: 'tok', scope: 's1' });
    const second = await client.get<{ n: number }>('/x', { token: 'tok', scope: 's1' });

    expect(second).toEqual({ n: 1 });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ headers: { 'if-none-match': '"v1"' } });
  });

  it('never shares cached bodies between sessions', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { who: 'a' }, { etag: '"a"' }))
      .mockResolvedValueOnce(jsonResponse(200, { who: 'b' }));
    const client = new GitHubClient({ apiBaseUrl: 'https://api.github.test', fetch });

    await client.get('/x', { token: 'a', scope: 'session-a' });
    await client.get('/x', { token: 'b', scope: 'session-b' });

    expect(fetch.mock.calls[1]?.[1]).not.toMatchObject({ headers: { 'if-none-match': '"a"' } });
  });

  it('reports a primary rate limit with the reset time', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(
        403,
        { message: 'API rate limit exceeded' },
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1800000000'
        }
      )
    );
    const client = new GitHubClient({ apiBaseUrl: 'https://api.github.test', fetch });

    const error = await client.get('/x', { token: 't', scope: 's' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitHubRequestError);
    expect(error).toMatchObject({ kind: 'rate-limited', resetAt: 1800000000000 });
  });

  it('reports a secondary rate limit from Retry-After', async () => {
    const fetch = vi.fn(async () => jsonResponse(429, {}, { 'retry-after': '30' }));
    const client = new GitHubClient({ apiBaseUrl: 'https://api.github.test', fetch });

    const error = await client.get('/x', { token: 't', scope: 's' }).catch((e: unknown) => e);

    expect(error).toMatchObject({ kind: 'rate-limited', retryAfterMs: 30000 });
  });

  it('classifies network failures and 5xx responses as transient', async () => {
    const network = new GitHubClient({
      apiBaseUrl: 'https://api.github.test',
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    });
    const server = new GitHubClient({
      apiBaseUrl: 'https://api.github.test',
      fetch: vi.fn(async () => jsonResponse(503, {}))
    });

    await expect(network.get('/x', { token: 't', scope: 's' })).rejects.toMatchObject({ kind: 'transient' });
    await expect(server.get('/x', { token: 't', scope: 's' })).rejects.toMatchObject({
      kind: 'transient',
      status: 503
    });
  });

  it('reports other HTTP errors without a retry hint', async () => {
    const client = new GitHubClient({
      apiBaseUrl: 'https://api.github.test',
      fetch: vi.fn(async () => jsonResponse(404, { message: 'Not Found' }))
    });

    await expect(client.get('/x', { token: 't', scope: 's' })).rejects.toMatchObject({
      kind: 'http',
      status: 404
    });
  });

  it('reads X-Poll-Interval as a hint for the next poll', async () => {
    const client = new GitHubClient({
      apiBaseUrl: 'https://api.github.test',
      fetch: vi.fn(async () => jsonResponse(200, [], { 'x-poll-interval': '90' }))
    });

    const result = await client.getWithMeta('/notifications', { token: 't', scope: 's' });

    expect(result.pollIntervalMs).toBe(90000);
  });
});
