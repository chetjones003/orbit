/**
 * GitHub OAuth device flow and token refresh. Pure HTTP against injectable
 * endpoints so tests can point it at the fake GitHub server. No Electron imports.
 */

/** Orbit's own OAuth App (public client ID; device flow needs no secret). */
export const ORBIT_CLIENT_ID = 'Ov23liaksIKemjW5EXuD';
export const ORBIT_SCOPES = 'repo project workflow offline_access';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export interface OAuthOptions {
  /** Base URL for github.com OAuth endpoints. */
  oauthBaseUrl: string;
  clientId?: string;
  scope?: string;
  fetch?: typeof fetch;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the device code expires. */
  expiresIn: number;
  /** Minimum seconds between polls. */
  interval: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  accessExpiresIn: number;
  /** Seconds until the refresh token expires. */
  refreshExpiresIn: number;
}

export type PollResult =
  | { kind: 'pending' }
  | { kind: 'slow-down'; interval?: number }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'tokens'; tokens: TokenSet };

/** The refresh token was rejected; the user must sign in again. */
export class RefreshRejectedError extends Error {
  constructor(code: string) {
    super(`GitHub rejected the refresh token (${code})`);
    this.name = 'RefreshRejectedError';
  }
}

/** Network or server failure; the existing session may still be valid. */
export class TransientAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientAuthError';
  }
}

type Json = Record<string, unknown>;

async function postForm(opts: OAuthOptions, path: string, params: Record<string, string>): Promise<Json> {
  const doFetch = opts.fetch ?? fetch;
  const body = new URLSearchParams(params).toString();
  let res: Response;
  try {
    res = await doFetch(`${opts.oauthBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    });
  } catch {
    throw new TransientAuthError('Could not reach GitHub');
  }
  if (res.status >= 500) throw new TransientAuthError(`GitHub returned ${res.status}`);
  return (await res.json()) as Json;
}

export async function requestDeviceCode(opts: OAuthOptions): Promise<DeviceCode> {
  const json = await postForm(opts, '/login/device/code', {
    client_id: opts.clientId ?? ORBIT_CLIENT_ID,
    scope: opts.scope ?? ORBIT_SCOPES
  });
  if (typeof json['error'] === 'string') {
    throw new TransientAuthError(`Could not start sign-in (${json['error']})`);
  }
  return {
    deviceCode: String(json['device_code']),
    userCode: String(json['user_code']),
    verificationUri: String(json['verification_uri']),
    expiresIn: Number(json['expires_in']),
    interval: Number(json['interval'])
  };
}

function toTokenSet(json: Json): TokenSet {
  return {
    accessToken: String(json['access_token']),
    refreshToken: String(json['refresh_token']),
    accessExpiresIn: Number(json['expires_in']),
    refreshExpiresIn: Number(json['refresh_token_expires_in'])
  };
}

export async function pollDeviceToken(opts: OAuthOptions, deviceCode: string): Promise<PollResult> {
  const json = await postForm(opts, '/login/oauth/access_token', {
    client_id: opts.clientId ?? ORBIT_CLIENT_ID,
    device_code: deviceCode,
    grant_type: DEVICE_GRANT
  });
  switch (json['error']) {
    case undefined:
      return { kind: 'tokens', tokens: toTokenSet(json) };
    case 'authorization_pending':
      return { kind: 'pending' };
    case 'slow_down':
      return {
        kind: 'slow-down',
        interval:
          Number.isFinite(Number(json['interval'])) && json['interval'] !== undefined
            ? Number(json['interval'])
            : undefined
      };
    case 'expired_token':
      return { kind: 'expired' };
    case 'access_denied':
      return { kind: 'denied' };
    default:
      throw new TransientAuthError(`Sign-in failed (${String(json['error'])})`);
  }
}

export async function refreshTokens(opts: OAuthOptions, refreshToken: string): Promise<TokenSet> {
  const json = await postForm(opts, '/login/oauth/access_token', {
    client_id: opts.clientId ?? ORBIT_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  if (typeof json['error'] === 'string') {
    throw new RefreshRejectedError(json['error']);
  }
  return toTokenSet(json);
}
