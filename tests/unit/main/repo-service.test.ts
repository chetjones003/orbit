import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { RepoService } from '../../../src/main/github/repo-service';

function response(items: unknown[], ok = true): Response {
  return new Response(JSON.stringify(items), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json' }
  });
}

describe('RepoService', () => {
  it('returns only repos owned by the signed-in user and requests the owner endpoint', async () => {
    const status = { kind: 'signed-in' as const, sessionId: 3, login: 'orbit-owner', persistent: true };
    const fetch = vi.fn(async () =>
      response([
        {
          id: 1,
          name: 'app',
          full_name: 'orbit-owner/app',
          description: null,
          private: false,
          fork: false,
          archived: false,
          default_branch: 'main',
          updated_at: '2026-01-01',
          html_url: 'https://github.com/orbit-owner/app',
          owner: { login: 'orbit-owner' }
        },
        {
          id: 2,
          name: 'org',
          full_name: 'an-org/org',
          description: null,
          private: true,
          fork: false,
          archived: false,
          default_branch: 'main',
          updated_at: '2026-01-01',
          html_url: 'https://github.com/an-org/org',
          owner: { login: 'an-org' }
        }
      ])
    );
    const auth = { getStatus: () => status, getAccessToken: vi.fn(async () => 'secret') } as unknown as Pick<
      AuthService,
      'getStatus' | 'getAccessToken'
    >;
    const service = new RepoService({ auth, apiBaseUrl: 'https://api.github.test/', fetch });

    await expect(service.listPersonalRepos()).resolves.toMatchObject([
      { id: 1, fullName: 'orbit-owner/app' }
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.test/user/repos?type=owner&sort=updated&per_page=100&page=1',
      { headers: { authorization: 'Bearer secret', accept: 'application/vnd.github+json' } }
    );
  });

  it('discards a response if the active account changes while GitHub is responding', async () => {
    let calls = 0;
    const auth = {
      getStatus: () =>
        ++calls === 1
          ? { kind: 'signed-in' as const, sessionId: 3, login: 'one', persistent: true }
          : { kind: 'signed-in' as const, sessionId: 4, login: 'two', persistent: true },
      getAccessToken: vi.fn(async () => 'secret')
    } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
    const service = new RepoService({
      auth,
      apiBaseUrl: 'https://api.github.test',
      fetch: async () => response([])
    });
    await expect(service.listPersonalRepos()).rejects.toThrow('account changed');
  });

  it('requires a signed-in account', async () => {
    const auth = {
      getStatus: () => ({ kind: 'signed-out' as const }),
      getAccessToken: vi.fn()
    } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
    const service = new RepoService({ auth, apiBaseUrl: 'https://api.github.test', fetch: vi.fn() });
    await expect(service.listPersonalRepos()).rejects.toThrow('Sign in');
  });
});

describe('RepoService snapshot', () => {
  it('serves the last successful list from memory without calling GitHub again', async () => {
    const status = { kind: 'signed-in' as const, sessionId: 5, login: 'orbit-owner', persistent: true };
    const fetch = vi.fn(async () => response([]));
    const auth = {
      getStatus: () => status,
      getAccessToken: vi.fn(async () => 'secret')
    } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
    const service = new RepoService({ auth, apiBaseUrl: 'https://api.github.test', fetch });

    await service.listPersonalRepos();
    await service.current();
    await service.current();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
