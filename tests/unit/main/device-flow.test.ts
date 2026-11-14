import { afterEach, describe, expect, it } from 'vitest';
import {
  ORBIT_CLIENT_ID,
  ORBIT_SCOPES,
  pollDeviceToken,
  refreshTokens,
  RefreshRejectedError,
  requestDeviceCode
} from '../../../src/main/github/device-flow';
import { startFakeGitHub, type FakeGitHub } from '../../fakes/github';

describe('device flow client', () => {
  let fake: FakeGitHub | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  it('uses Orbit client ID and the agreed scopes', () => {
    expect(ORBIT_CLIENT_ID).toBe('Ov23liaksIKemjW5EXuD');
    expect(ORBIT_SCOPES).toBe('repo project workflow offline_access');
  });

  it('requests a device code with Orbit client ID and scopes', async () => {
    fake = await startFakeGitHub([
      {
        method: 'POST',
        path: '/login/device/code',
        body: {
          device_code: 'dev-123',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        }
      }
    ]);
    const result = await requestDeviceCode({ oauthBaseUrl: fake.url });
    expect(result).toEqual({
      deviceCode: 'dev-123',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5
    });
    const body = new URLSearchParams(fake.received[0]?.body);
    expect(body.get('client_id')).toBe(ORBIT_CLIENT_ID);
    expect(body.get('scope')).toBe(ORBIT_SCOPES);
    expect(fake.received[0]?.headers['accept']).toBe('application/json');
  });

  it('maps authorization_pending, slow_down, expired_token, and access_denied', async () => {
    let call = 0;
    const outcomes = [
      { error: 'authorization_pending' },
      { error: 'slow_down', interval: 10 },
      { error: 'expired_token' },
      { error: 'access_denied' }
    ];
    fake = await startFakeGitHub([
      {
        method: 'POST',
        path: '/login/oauth/access_token',
        respond: () => ({ body: outcomes[call++] })
      }
    ]);
    const opts = { oauthBaseUrl: fake.url };
    expect(await pollDeviceToken(opts, 'dev-123')).toEqual({ kind: 'pending' });
    expect(await pollDeviceToken(opts, 'dev-123')).toEqual({ kind: 'slow-down', interval: 10 });
    expect(await pollDeviceToken(opts, 'dev-123')).toEqual({ kind: 'expired' });
    expect(await pollDeviceToken(opts, 'dev-123')).toEqual({ kind: 'denied' });
  });

  it('returns token material on success, including the refresh token', async () => {
    fake = await startFakeGitHub([
      {
        method: 'POST',
        path: '/login/oauth/access_token',
        body: {
          access_token: 'gho_access',
          token_type: 'bearer',
          scope: 'repo,project,workflow',
          refresh_token: 'ghr_refresh',
          expires_in: 28800,
          refresh_token_expires_in: 15811200
        }
      }
    ]);
    const result = await pollDeviceToken({ oauthBaseUrl: fake.url }, 'dev-123');
    expect(result).toEqual({
      kind: 'tokens',
      tokens: {
        accessToken: 'gho_access',
        refreshToken: 'ghr_refresh',
        accessExpiresIn: 28800,
        refreshExpiresIn: 15811200
      }
    });
    const body = new URLSearchParams(fake.received[0]?.body);
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    expect(body.get('device_code')).toBe('dev-123');
  });

  it('refreshes tokens and reports a rejected refresh token as RefreshRejectedError', async () => {
    fake = await startFakeGitHub([
      {
        method: 'POST',
        path: '/login/oauth/access_token',
        respond: (req) =>
          new URLSearchParams(req.body).get('refresh_token') === 'ghr_good'
            ? {
                body: {
                  access_token: 'gho_new',
                  refresh_token: 'ghr_rotated',
                  expires_in: 28800,
                  refresh_token_expires_in: 15811200
                }
              }
            : { body: { error: 'bad_refresh_token' } }
      }
    ]);
    const opts = { oauthBaseUrl: fake.url };
    expect(await refreshTokens(opts, 'ghr_good')).toEqual({
      accessToken: 'gho_new',
      refreshToken: 'ghr_rotated',
      accessExpiresIn: 28800,
      refreshExpiresIn: 15811200
    });
    await expect(refreshTokens(opts, 'ghr_bad')).rejects.toBeInstanceOf(RefreshRejectedError);
  });
});
