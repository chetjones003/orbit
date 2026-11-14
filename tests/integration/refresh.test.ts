import { afterEach, describe, expect, it } from 'vitest';
import { startFakeGitHub, type FakeGitHub } from '../fakes/github';
import { GitHubClient } from '../../src/main/github/github-client';
import { RepoService, type RepoServiceOptions } from '../../src/main/github/repo-service';
import { RefreshEngine } from '../../src/main/github/refresh-engine';

/**
 * Real HTTP against a controlled GitHub stand-in: conditional requests, rate
 * limits, and unreachable GitHub, through the same modules the app wires together.
 */
const REPOS_PATH = '/user/repos?type=owner&sort=updated&per_page=100&page=1';
const repo = {
  id: 1,
  name: 'app',
  full_name: 'orbit-owner/app',
  description: null,
  private: false,
  fork: false,
  archived: false,
  default_branch: 'main',
  updated_at: '2026-01-01T00:00:00Z',
  html_url: 'https://github.com/orbit-owner/app',
  owner: { login: 'orbit-owner' }
};
const auth = {
  getStatus: () => ({ kind: 'signed-in' as const, sessionId: 1, login: 'orbit-owner', persistent: true }),
  getAccessToken: async () => 'token'
} as unknown as RepoServiceOptions['auth'];

let fake: FakeGitHub | undefined;

afterEach(async () => {
  await fake?.close().catch(() => undefined);
  fake = undefined;
});

function wire(url: string) {
  const repos = new RepoService({ auth, apiBaseUrl: url, client: new GitHubClient({ apiBaseUrl: url }) });
  const engine = new RefreshEngine({
    refresh: () => repos.listPersonalRepos().then(() => undefined),
    manualCooldownMs: 0
  });
  return { repos, engine };
}

describe('refresh over HTTP', () => {
  it('revalidates with ETags, reuses the cached list on 304, and serves it from memory', async () => {
    fake = await startFakeGitHub([
      {
        method: 'GET',
        path: REPOS_PATH,
        respond: (req) =>
          req.headers['if-none-match'] === '"v1"'
            ? { status: 304 }
            : { status: 200, body: [repo], headers: { etag: '"v1"' } }
      }
    ]);
    const { repos, engine } = wire(fake.url);

    await expect(engine.refreshNow()).resolves.toEqual({ started: true });
    await expect(engine.refreshNow()).resolves.toEqual({ started: true });

    const repoCalls = fake.received.filter((r) => r.path === REPOS_PATH);
    expect(repoCalls).toHaveLength(2);
    expect(repoCalls[1]?.headers['if-none-match']).toBe('"v1"');
    expect(engine.getStatus().state).toBe('fresh');
    await expect(repos.current()).resolves.toMatchObject([{ fullName: 'orbit-owner/app' }]);
    expect(fake.received.filter((r) => r.path === REPOS_PATH)).toHaveLength(2);
    engine.stop();
  });

  it('waits for the rate-limit reset GitHub names, and does not call GitHub again before then', async () => {
    const resetSeconds = Math.floor(Date.now() / 1000) + 600;
    fake = await startFakeGitHub([
      {
        method: 'GET',
        path: REPOS_PATH,
        respond: () => ({
          status: 403,
          body: { message: 'API rate limit exceeded' },
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetSeconds) }
        })
      }
    ]);
    const { engine } = wire(fake.url);

    await engine.refreshNow();
    expect(engine.getStatus()).toMatchObject({ state: 'rate-limited', nextRetryAt: resetSeconds * 1000 });

    await expect(engine.refreshNow()).resolves.toMatchObject({ started: false, reason: 'rate-limited' });
    expect(fake.received.filter((r) => r.path === REPOS_PATH)).toHaveLength(1);
    engine.stop();
  });

  it('reports offline, keeping the last successful time, when GitHub cannot be reached', async () => {
    const server = await startFakeGitHub([]);
    const url = server.url;
    await server.close();
    const { engine } = wire(url);

    await engine.refreshNow();
    expect(engine.getStatus()).toMatchObject({ state: 'offline', lastSuccessAt: null });
    expect(engine.getStatus().nextRetryAt).toBeGreaterThan(Date.now());
    engine.stop();
  });
});
