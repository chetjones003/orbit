import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService, NotSignedInError, ReauthRequiredError } from '../../../src/main/github/auth-service';
import { CredentialStore, type StoredCredentials } from '../../../src/main/github/credential-store';
import type { AuthStatus } from '../../../src/shared/auth';
import { startFakeGitHub, type FakeGitHub } from '../../fakes/github';

type Json = Record<string, unknown>;

const SECRET_TOKENS = ['gho_A_ACCESS', 'ghr_A_REFRESH', 'gho_B_ACCESS', 'ghr_B_REFRESH', 'gho_A_ROTATED'];

function tokens(access: string, refresh: string, expiresIn = 28800): Json {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: expiresIn,
    refresh_token_expires_in: 15811200
  };
}

const noSafeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => Buffer.alloc(0),
  decryptString: () => ''
};

/** Stored credentials in a deliberately broken state. */
const brokenStore = {
  save: async () => {
    throw new Error('disk full');
  },
  load: async () => null,
  clear: async () => undefined
};

describe('AuthService', () => {
  let dir: string;
  let fake: FakeGitHub;
  /** Responses for the device-flow token endpoint, consumed in order. */
  let deviceTokenQueue: Json[];
  /** Responses for refresh_token grants, consumed in order. */
  let refreshQueue: Json[];
  /** Which GitHub login each access token belongs to. */
  let loginByToken: Record<string, string>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'orbit-auth-'));
    deviceTokenQueue = [];
    refreshQueue = [];
    loginByToken = {
      'Bearer gho_A_ACCESS': 'chetjones003',
      'Bearer gho_B_ACCESS': 'other-user',
      'Bearer gho_A_ROTATED': 'chetjones003'
    };
    fake = await startFakeGitHub([
      {
        method: 'POST',
        path: '/login/device/code',
        body: {
          device_code: 'dev-1',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 1
        }
      },
      {
        method: 'POST',
        path: '/login/oauth/access_token',
        respond: (req) => {
          const isRefresh = new URLSearchParams(req.body).get('grant_type') === 'refresh_token';
          const queue = isRefresh ? refreshQueue : deviceTokenQueue;
          return { body: queue.shift() ?? { error: 'authorization_pending' } };
        }
      },
      {
        method: 'GET',
        path: '/user',
        respond: (req) => ({
          body: { login: loginByToken[String(req.headers['authorization'])] ?? 'unknown' }
        })
      }
    ]);
  });

  afterEach(async () => {
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeService(
    overrides: { store?: unknown; fetch?: typeof fetch; now?: () => number } = {}
  ): AuthService {
    return new AuthService({
      oauthBaseUrl: fake.url,
      apiBaseUrl: fake.url,
      store: (overrides.store ?? new CredentialStore({ dir, safeStorage: noSafeStorage })) as CredentialStore,
      fetch: overrides.fetch,
      now: overrides.now,
      sleep: async () => undefined
    });
  }

  /** Waits until the status satisfies a predicate. Status changes are the public signal. */
  async function waitForStatus(
    service: AuthService,
    predicate: (s: AuthStatus) => boolean
  ): Promise<AuthStatus> {
    await vi.waitFor(() => {
      expect(predicate(service.getStatus())).toBe(true);
    });
    return service.getStatus();
  }

  it('starts with a device code and reports pending without exposing any token', async () => {
    deviceTokenQueue.push({ error: 'authorization_pending' });
    const service = makeService();
    const status = await service.startSignIn();
    expect(status).toMatchObject({
      kind: 'device-pending',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device'
    });
    service.cancelSignIn();
  });

  it('signs in after authorization, identifies the account, and persists credentials', async () => {
    deviceTokenQueue.push({ error: 'authorization_pending' }, tokens('gho_A_ACCESS', 'ghr_A_REFRESH'));
    const service = makeService();
    await service.startSignIn();
    const status = await waitForStatus(service, (s) => s.kind === 'signed-in');
    expect(status).toMatchObject({ kind: 'signed-in', login: 'chetjones003', persistent: true });
    const saved = await new CredentialStore({ dir, safeStorage: noSafeStorage }).load();
    expect(saved).toMatchObject({
      login: 'chetjones003',
      accessToken: 'gho_A_ACCESS',
      refreshToken: 'ghr_A_REFRESH'
    });
  });

  it('never includes tokens in status objects the renderer receives', async () => {
    deviceTokenQueue.push(tokens('gho_A_ACCESS', 'ghr_A_REFRESH'));
    const service = makeService();
    const seen: AuthStatus[] = [];
    service.onStatusChange((s) => seen.push(s));
    await service.startSignIn();
    await waitForStatus(service, (s) => s.kind === 'signed-in');
    const serialized = JSON.stringify(seen);
    for (const secret of SECRET_TOKENS) expect(serialized).not.toContain(secret);
  });

  it('shows signed-out with a clear notice when the user denies access', async () => {
    deviceTokenQueue.push({ error: 'access_denied' });
    const service = makeService();
    await service.startSignIn();
    const status = await waitForStatus(service, (s) => s.kind === 'signed-out' && s.notice !== undefined);
    expect(status).toMatchObject({ kind: 'signed-out' });
    expect(status.kind === 'signed-out' && status.notice).toMatch(/denied/i);
    expect(await new CredentialStore({ dir, safeStorage: noSafeStorage }).load()).toBeNull();
  });

  it('shows signed-out with a notice when the device code expires', async () => {
    deviceTokenQueue.push({ error: 'expired_token' });
    const service = makeService();
    await service.startSignIn();
    const status = await waitForStatus(service, (s) => s.kind === 'signed-out' && s.notice !== undefined);
    expect(status.kind === 'signed-out' && status.notice).toMatch(/expired/i);
  });

  it('honours slow_down by lengthening the poll interval', async () => {
    const sleeps: number[] = [];
    deviceTokenQueue.push({ error: 'slow_down', interval: 6 }, tokens('gho_A_ACCESS', 'ghr_A_REFRESH'));
    const service = new AuthService({
      oauthBaseUrl: fake.url,
      apiBaseUrl: fake.url,
      store: new CredentialStore({ dir, safeStorage: noSafeStorage }),
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });
    await service.startSignIn();
    await waitForStatus(service, (s) => s.kind === 'signed-in');
    expect(sleeps).toEqual([1000, 6000]);
  });

  it('keeps the session in memory and warns when credentials cannot be saved', async () => {
    deviceTokenQueue.push(tokens('gho_A_ACCESS', 'ghr_A_REFRESH'));
    const service = makeService({ store: brokenStore });
    await service.startSignIn();
    const status = await waitForStatus(service, (s) => s.kind === 'signed-in');
    expect(status).toMatchObject({ kind: 'signed-in', login: 'chetjones003', persistent: false });
    expect(status.kind === 'signed-in' && status.notice).toMatch(/will not survive quitting/i);
  });

  it('refreshes an expiring access token once even when two callers ask at the same time', async () => {
    deviceTokenQueue.push(tokens('gho_A_ACCESS', 'ghr_A_REFRESH', 30));
    refreshQueue.push(tokens('gho_A_ROTATED', 'ghr_A_REFRESH2'));
    const service = makeService();
    await service.startSignIn();
    await waitForStatus(service, (s) => s.kind === 'signed-in');

    const [first, second] = await Promise.all([service.getAccessToken(), service.getAccessToken()]);
    expect(first).toBe('gho_A_ROTATED');
    expect(second).toBe('gho_A_ROTATED');
    const refreshes = fake.received.filter((r) => r.body.includes('grant_type=refresh_token'));
    expect(refreshes).toHaveLength(1);
  });

  it('saves a rotated refresh token together with the new access token', async () => {
    deviceTokenQueue.push(tokens('gho_A_ACCESS', 'ghr_A_REFRESH', 30));
    refreshQueue.push(tokens('gho_A_ROTATED', 'ghr_A_REFRESH2'));
    const service = makeService();
    await service.startSignIn();
    await waitForStatus(service, (s) => s.kind === 'signed-in');
    await service.getAccessToken();
    const saved = (await new CredentialStore({
      dir,
      safeStorage: noSafeStorage
    }).load()) as StoredCredentials;
    expect(saved).toMatchObject({ accessToken: 'gho_A_ROTATED', refreshToken: 'ghr_A_REFRESH2' });
  });

  it('asks for reauthentication when refresh is rejected, and keeps the session id for the same account', async () => {
    deviceTokenQueue.push(tokens('gho_A_ACCESS', 'ghr_A_REFRESH', 30));
    refreshQueue.push({ error: 'bad_refresh_token' });
    const service = makeService();
    await service.startSignIn();
    const signedIn = await waitForStatus(service, (s) => s.kind === 'signed-in');
    const originalSessionId = signedIn.kind === 'signed-in' ? signedIn.sessionId : -1;

    await expect(service.getAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(service.getStatus()).toMatchObject({ kind: 'reauth-required', login: 'chetjones003' });

    // Same account signs in again: in-memory work for this session is preserved.
    deviceTokenQueue.push(tokens('gho_A_ACCESS', 'ghr_A_REFRESH'));
    await service.startSignIn();
    const after = await waitForStatus(service, (s) => s.kind === 'signed-in');
    expect(after).toMatchObject({ kind: 'signed-in', login: 'chetjones003', sessionId: originalSessionId });
  });

  it('starts a new session id when a different account signs in', async () => {
    deviceTokenQueue.push(tokens('gho_A_ACCESS', 'ghr_A_REFRESH'));
    const service = makeService();
    await service.startSignIn();
    const first = await waitForStatus(service, (s) => s.kind === 'signed-in');

    deviceTokenQueue.push(tokens('gho_B_ACCESS', 'ghr_B_REFRESH'));
    await service.startSignIn();
    const second = await waitForStatus(service, (s) => s.kind === 'signed-in' && s.login === 'other-user');
    if (first.kind !== 'signed-in' || second.kind !== 'signed-in')
      throw new Error('expected two signed-in states');
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it('sign-out clears stored credentials and returns to signed-out', async () => {
    deviceTokenQueue.push(tokens('gho_A_ACCESS', 'ghr_A_REFRESH'));
    const service = makeService();
    await service.startSignIn();
    await waitForStatus(service, (s) => s.kind === 'signed-in');
    const status = await service.signOut();
    expect(status).toEqual({ kind: 'signed-out' });
    expect(await new CredentialStore({ dir, safeStorage: noSafeStorage }).load()).toBeNull();
    await expect(service.getAccessToken()).rejects.toBeInstanceOf(NotSignedInError);
  });

  it('discards a refresh that finishes after sign-out', async () => {
    deviceTokenQueue.push(tokens('gho_A_ACCESS', 'ghr_A_REFRESH', 30));
    refreshQueue.push(tokens('gho_A_ROTATED', 'ghr_A_REFRESH2'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // Only the refresh grant waits; sign-in itself runs normally.
    const gatedFetch: typeof fetch = async (input, init) => {
      if (String(init?.body ?? '').includes('grant_type=refresh_token')) await gate;
      return fetch(input, init);
    };
    const service = makeService({ fetch: gatedFetch });
    await service.startSignIn();
    await waitForStatus(service, (s) => s.kind === 'signed-in');

    const pendingRefresh = service.getAccessToken().catch((e: unknown) => e);
    await service.signOut();
    release();
    const outcome = await pendingRefresh;
    expect(outcome).toBeInstanceOf(NotSignedInError);
    expect(service.getStatus()).toEqual({ kind: 'signed-out' });
    expect(await new CredentialStore({ dir, safeStorage: noSafeStorage }).load()).toBeNull();
  });

  it('discards a device-flow result after the user cancels sign-in', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gatedFetch: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/login/oauth/access_token')) await gate;
      return fetch(input, init);
    };
    deviceTokenQueue.push(tokens('gho_A_ACCESS', 'ghr_A_REFRESH'));
    const service = makeService({ fetch: gatedFetch });
    await service.startSignIn();
    service.cancelSignIn();
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(service.getStatus()).toEqual({ kind: 'signed-out' });
    expect(await new CredentialStore({ dir, safeStorage: noSafeStorage }).load()).toBeNull();
  });

  it('restores a stored session on start without contacting GitHub', async () => {
    await new CredentialStore({ dir, safeStorage: noSafeStorage }).save({
      login: 'chetjones003',
      accessToken: 'gho_A_ACCESS',
      refreshToken: 'ghr_A_REFRESH',
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 86_400_000
    });
    const service = makeService();
    await service.initialize();
    expect(service.getStatus()).toMatchObject({ kind: 'signed-in', login: 'chetjones003', persistent: true });
    expect(fake.requests).toEqual([]);
  });

  it('signs out with a notice when stored credentials are unreadable', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'credentials.json'), '{corrupt');
    const service = makeService();
    await service.initialize();
    expect(service.getStatus()).toMatchObject({ kind: 'signed-out' });
    const current = service.getStatus();
    expect(current.kind === 'signed-out' ? current.notice : '').toMatch(/sign in again/i);
  });
});

describe('AuthService account switch persistence', () => {
  it('removes the previous account credentials when the new account cannot be saved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-switch-'));
    const real = new CredentialStore({ dir, safeStorage: noSafeStorage });
    const fake = await startFakeGitHub([
      {
        method: 'POST',
        path: '/login/device/code',
        body: {
          device_code: 'd',
          user_code: 'U-1',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 1
        }
      },
      {
        method: 'POST',
        path: '/login/oauth/access_token',
        respond: () => ({ body: deviceQueue.shift() ?? { error: 'authorization_pending' } })
      },
      {
        method: 'GET',
        path: '/user',
        respond: (req) => ({
          body: { login: req.headers['authorization'] === 'Bearer gho_B' ? 'other-user' : 'chetjones003' }
        })
      }
    ]);
    const deviceQueue: Array<Record<string, unknown>> = [
      { access_token: 'gho_A', refresh_token: 'ghr_A', expires_in: 28800, refresh_token_expires_in: 15811200 }
    ];
    const store = {
      save: async (creds: StoredCredentials) => {
        if (creds.login === 'other-user') throw new Error('disk full');
        await real.save(creds);
      },
      load: () => real.load(),
      clear: () => real.clear()
    };
    const service = new AuthService({
      oauthBaseUrl: fake.url,
      apiBaseUrl: fake.url,
      store,
      sleep: async () => undefined
    });
    try {
      await service.startSignIn();
      await vi.waitFor(() => expect(service.getStatus().kind).toBe('signed-in'));
      deviceQueue.push({
        access_token: 'gho_B',
        refresh_token: 'ghr_B',
        expires_in: 28800,
        refresh_token_expires_in: 15811200
      });
      await service.startSignIn();
      await vi.waitFor(() =>
        expect(service.getStatus()).toMatchObject({
          kind: 'signed-in',
          login: 'other-user',
          persistent: false
        })
      );
      expect(await real.load()).toBeNull();
    } finally {
      await fake.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
