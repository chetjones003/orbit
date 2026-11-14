import type { AuthStatus } from '../../shared/auth';
import { CredentialUnavailableError, type StoredCredentials } from './credential-store';
import {
  pollDeviceToken,
  refreshTokens,
  requestDeviceCode,
  RefreshRejectedError,
  TransientAuthError,
  type DeviceCode,
  type OAuthOptions,
  type PollResult,
  type TokenSet
} from './device-flow';

/** The store operations the service needs. CredentialStore satisfies this. */
export interface CredentialStoreLike {
  save(creds: StoredCredentials): Promise<void>;
  load(): Promise<StoredCredentials | null>;
  clear(): Promise<void>;
}

export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in to GitHub');
    this.name = 'NotSignedInError';
  }
}

export class ReauthRequiredError extends Error {
  constructor(readonly login: string) {
    super(`GitHub sign-in for ${login} must be renewed`);
    this.name = 'ReauthRequiredError';
  }
}

export interface AuthServiceOptions {
  oauthBaseUrl: string;
  apiBaseUrl: string;
  store: CredentialStoreLike;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Refresh the access token when it has less than this much life left. */
const REFRESH_MARGIN_MS = 60_000;
const NOT_PERSISTED_NOTICE = 'Sign-in will not survive quitting Orbit: credentials could not be saved.';
const REAUTH_NOTICE = 'Your GitHub sign-in has expired. Sign in again to continue.';

interface Session {
  sessionId: number;
  login: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  persistent: boolean;
  needsReauth: boolean;
}

/**
 * Owns GitHub credentials in the main process. The renderer only sees AuthStatus.
 * Token refresh is single-flight, and every store write is queued so a late write
 * cannot resurrect credentials after sign-out.
 */
export class AuthService {
  private status: AuthStatus = { kind: 'signed-out' };
  private session: Session | null = null;
  private sessionSeq = 0;
  /** Incremented to cancel the active device flow; a flow only applies results while it is current. */
  private flowId = 0;
  private refreshing: Promise<string> | null = null;
  private storeChain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(status: AuthStatus) => void>();
  private readonly oauth: OAuthOptions;
  private readonly apiFetch: typeof fetch;
  private readonly store: CredentialStoreLike;
  private readonly apiBaseUrl: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: AuthServiceOptions) {
    this.oauth = { oauthBaseUrl: options.oauthBaseUrl, fetch: options.fetch };
    this.apiFetch = options.fetch ?? fetch;
    this.apiBaseUrl = options.apiBaseUrl;
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  getStatus(): AuthStatus {
    return this.status;
  }

  onStatusChange(listener: (status: AuthStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Restores a stored session without contacting GitHub. Unreadable data is discarded. */
  async initialize(): Promise<void> {
    let creds: StoredCredentials | null;
    try {
      creds = await this.store.load();
    } catch (error) {
      if (!(error instanceof CredentialUnavailableError)) throw error;
      await this.enqueue(() => this.store.clear()).catch(() => undefined);
      this.setStatus({
        kind: 'signed-out',
        notice: 'Stored sign-in could not be read. Sign in again to continue.'
      });
      return;
    }
    if (!creds) return;
    this.session = this.toSession(creds, ++this.sessionSeq, true);
    this.setStatus(this.signedInStatus());
  }

  /** Starts the device flow. Resolves with the pending status; the outcome arrives as status changes. */
  async startSignIn(): Promise<AuthStatus> {
    if (this.status.kind === 'device-pending') return this.status;
    const flow = ++this.flowId;
    let code: DeviceCode;
    try {
      code = await requestDeviceCode(this.oauth);
    } catch {
      if (flow === this.flowId) this.endFlow(flow, 'Could not reach GitHub to start sign-in. Try again.');
      return this.status;
    }
    if (flow !== this.flowId) return this.status;
    const expiresAt = this.now() + code.expiresIn * 1000;
    this.setStatus({
      kind: 'device-pending',
      userCode: code.userCode,
      verificationUri: code.verificationUri,
      expiresAt
    });
    void this.pollUntilDone(flow, code.deviceCode, code.interval, expiresAt);
    return this.status;
  }

  cancelSignIn(): AuthStatus {
    if (this.status.kind !== 'device-pending') return this.status;
    this.flowId++;
    this.setStatus(this.restoreStatus());
    return this.status;
  }

  async signOut(): Promise<AuthStatus> {
    this.flowId++;
    this.session = null;
    this.refreshing = null;
    let notice: string | undefined;
    try {
      await this.enqueue(() => this.store.clear());
    } catch {
      notice = 'Signed out, but stored credentials could not be removed.';
    }
    this.setStatus(notice ? { kind: 'signed-out', notice } : { kind: 'signed-out' });
    return this.status;
  }

  /** Returns a usable access token, refreshing it first if it is close to expiry. */
  async getAccessToken(): Promise<string> {
    const session = this.session;
    if (!session) throw new NotSignedInError();
    if (session.needsReauth) throw new ReauthRequiredError(session.login);
    if (session.accessExpiresAt - this.now() > REFRESH_MARGIN_MS) return session.accessToken;
    return this.refresh(session);
  }

  private refresh(session: Session): Promise<string> {
    if (this.refreshing) return this.refreshing;
    const run = (async (): Promise<string> => {
      let tokens: TokenSet;
      try {
        tokens = await refreshTokens(this.oauth, session.refreshToken);
      } catch (error) {
        if (error instanceof RefreshRejectedError) {
          if (this.session === session) {
            session.needsReauth = true;
            this.setStatus(this.restoreStatus());
          }
          throw new ReauthRequiredError(session.login);
        }
        throw error;
      }
      if (this.session !== session) throw new NotSignedInError();
      this.applyTokens(session, tokens);
      await this.persist(session);
      return session.accessToken;
    })();
    this.refreshing = run;
    const clear = (): void => {
      if (this.refreshing === run) this.refreshing = null;
    };
    run.then(clear, clear);
    return run;
  }

  private async pollUntilDone(
    flow: number,
    deviceCode: string,
    intervalSeconds: number,
    expiresAt: number
  ): Promise<void> {
    let interval = intervalSeconds;
    while (flow === this.flowId) {
      if (this.now() >= expiresAt) {
        this.endFlow(flow, 'The sign-in code expired. Start sign-in again.');
        return;
      }
      await this.sleep(interval * 1000);
      if (flow !== this.flowId) return;

      let result: PollResult;
      try {
        result = await pollDeviceToken(this.oauth, deviceCode);
      } catch (error) {
        if (error instanceof TransientAuthError) continue;
        this.endFlow(flow, 'Sign-in failed. Try again.');
        return;
      }
      if (flow !== this.flowId) return;

      switch (result.kind) {
        case 'pending':
          continue;
        case 'slow-down':
          interval = result.interval ?? interval + 5;
          continue;
        case 'expired':
          this.endFlow(flow, 'The sign-in code expired. Start sign-in again.');
          return;
        case 'denied':
          this.endFlow(flow, 'Sign-in was denied on GitHub.');
          return;
        case 'tokens':
          await this.completeSignIn(flow, result.tokens);
          return;
      }
    }
  }

  private async completeSignIn(flow: number, tokens: TokenSet): Promise<void> {
    let login: string;
    try {
      login = await this.fetchLogin(tokens.accessToken);
    } catch {
      this.endFlow(flow, 'Could not confirm your GitHub account. Try signing in again.');
      return;
    }
    if (flow !== this.flowId) return;
    this.flowId++;

    const previous = this.session;
    // Same account re-authenticating keeps its session id so in-memory work survives.
    const sessionId = previous && previous.login === login ? previous.sessionId : ++this.sessionSeq;
    const session = this.toSession(
      { login, accessToken: '', refreshToken: '', accessExpiresAt: 0, refreshExpiresAt: 0 },
      sessionId,
      false
    );
    this.applyTokens(session, tokens);
    // A different account replaces the old one on disk, even if the new save fails.
    if (previous && previous.login !== login) {
      await this.enqueue(() => this.store.clear()).catch(() => undefined);
    }
    this.session = session;
    await this.persist(session);
    this.setStatus(this.signedInStatus());
  }

  private async fetchLogin(accessToken: string): Promise<string> {
    const res = await this.apiFetch(`${this.apiBaseUrl}/user`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json' }
    });
    if (!res.ok) throw new TransientAuthError(`GitHub returned ${res.status}`);
    const body = (await res.json()) as { login?: unknown };
    if (typeof body.login !== 'string') throw new TransientAuthError('GitHub did not return a login');
    return body.login;
  }

  private endFlow(flow: number, notice: string): void {
    if (flow !== this.flowId) return;
    this.flowId++;
    this.setStatus(this.restoreStatus(notice));
  }

  /** Writes the session to disk. Skipped if the session has been replaced or signed out. */
  private persist(session: Session): Promise<void> {
    return this.enqueue(async () => {
      if (this.session !== session) return;
      const wasPersistent = session.persistent;
      try {
        await this.store.save({
          login: session.login,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          accessExpiresAt: session.accessExpiresAt,
          refreshExpiresAt: session.refreshExpiresAt
        });
        session.persistent = true;
      } catch {
        session.persistent = false;
      }
      if (session.persistent !== wasPersistent && this.status.kind === 'signed-in') {
        this.setStatus(this.signedInStatus());
      }
    });
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.storeChain.then(op);
    this.storeChain = run.catch(() => undefined);
    return run;
  }

  private applyTokens(session: Session, tokens: TokenSet): void {
    const now = this.now();
    session.accessToken = tokens.accessToken;
    session.refreshToken = tokens.refreshToken;
    session.accessExpiresAt = now + tokens.accessExpiresIn * 1000;
    session.refreshExpiresAt = now + tokens.refreshExpiresIn * 1000;
    session.needsReauth = false;
  }

  private toSession(creds: StoredCredentials, sessionId: number, persistent: boolean): Session {
    return { ...creds, sessionId, persistent, needsReauth: false };
  }

  private signedInStatus(): AuthStatus {
    const session = this.session;
    if (!session) return { kind: 'signed-out' };
    return session.persistent
      ? { kind: 'signed-in', sessionId: session.sessionId, login: session.login, persistent: true }
      : {
          kind: 'signed-in',
          sessionId: session.sessionId,
          login: session.login,
          persistent: false,
          notice: NOT_PERSISTED_NOTICE
        };
  }

  /** The status to show when a pending flow ends or is cancelled, keeping any existing session. */
  private restoreStatus(notice?: string): AuthStatus {
    const session = this.session;
    if (!session) return notice ? { kind: 'signed-out', notice } : { kind: 'signed-out' };
    if (session.needsReauth) {
      return {
        kind: 'reauth-required',
        sessionId: session.sessionId,
        login: session.login,
        notice: notice ?? REAUTH_NOTICE
      };
    }
    const signedIn = this.signedInStatus();
    return notice && signedIn.kind === 'signed-in' ? { ...signedIn, notice } : signedIn;
  }

  private setStatus(next: AuthStatus): void {
    this.status = next;
    for (const listener of this.listeners) listener(next);
  }
}
