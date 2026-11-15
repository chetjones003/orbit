export type GitHubRequestErrorKind = 'rate-limited' | 'transient' | 'http';

/**
 * A failed GitHub call. `rate-limited` carries the earliest retry time GitHub
 * named; `transient` means the request may or may not have reached GitHub.
 */
export class GitHubRequestError extends Error {
  readonly kind: GitHubRequestErrorKind;
  readonly status: number | undefined;
  readonly resetAt: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: GitHubRequestErrorKind,
    message: string,
    details: { status?: number; resetAt?: number; retryAfterMs?: number } = {}
  ) {
    super(message);
    this.name = 'GitHubRequestError';
    this.kind = kind;
    this.status = details.status;
    this.resetAt = details.resetAt;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export interface GitHubClientOptions {
  apiBaseUrl: string;
  /** Host for attachment uploads. Defaults to GitHub's uploads host. */
  uploadsBaseUrl?: string;
  fetch?: typeof fetch;
}

export interface GitHubRequestOptions {
  token: string;
  /** Cache partition, normally the session id. Bodies never cross partitions. */
  scope: string;
  /** Media type to request. Defaults to the JSON media type. */
  accept?: string;
}

export interface GitHubResult<T> {
  data: T;
  /** Milliseconds from X-Poll-Interval, when GitHub sent one. */
  pollIntervalMs?: number;
  /** True when GitHub answered 304 and the cached body was reused. */
  notModified: boolean;
}

interface CacheEntry {
  etag: string;
  body: unknown;
}

/**
 * Thin REST client for GitHub. It keeps an in-memory ETag cache so unchanged
 * responses cost a conditional request. Nothing is written to disk.
 */
export class GitHubClient {
  private readonly apiBaseUrl: string;
  private readonly uploadsBaseUrl: string;
  private readonly apiFetch: typeof fetch;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: GitHubClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '');
    this.uploadsBaseUrl = (options.uploadsBaseUrl ?? 'https://uploads.github.com').replace(/\/$/, '');
    this.apiFetch = options.fetch ?? fetch;
  }

  async get<T>(path: string, options: GitHubRequestOptions): Promise<T> {
    return (await this.getWithMeta<T>(path, options)).data;
  }

  async getWithMeta<T>(path: string, options: GitHubRequestOptions): Promise<GitHubResult<T>> {
    const url = `${this.apiBaseUrl}${path}`;
    const accept = options.accept ?? 'application/vnd.github+json';
    const key = `${options.scope}\u0000${accept}\u0000${url}`;
    const cached = this.cache.get(key);
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.token}`,
      accept
    };
    if (cached) headers['if-none-match'] = cached.etag;

    const response = await this.dispatch(url, { headers }, cached !== undefined);
    const pollIntervalMs = readSeconds(response.headers.get('x-poll-interval'), 1000);

    if (response.status === 304 && cached) {
      return { data: cached.body as T, pollIntervalMs, notModified: true };
    }

    const body = (await response.json()) as T;
    const etag = response.headers.get('etag');
    if (etag) this.cache.set(key, { etag, body });
    return { data: body, pollIntervalMs, notModified: false };
  }

  /**
   * Sends a write (POST, PATCH, or DELETE). Writes are never cached. A transient
   * failure means the request may have reached GitHub, so callers must reconcile
   * before retrying. `text` returns the raw body, for media types such as rendered HTML.
   */
  async send<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    options: GitHubWriteOptions
  ): Promise<T> {
    const root = options.base === 'uploads' ? this.uploadsBaseUrl : this.apiBaseUrl;
    const url = `${root}${path}`;
    const accept = options.accept ?? 'application/vnd.github+json';
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.token}`,
      accept
    };
    const init: RequestInit = { method, headers };
    if (options.rawBody) {
      headers['content-type'] = options.rawBody.contentType;
      init.body = options.rawBody.bytes;
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const response = await this.dispatch(url, init, false);
    // 204 and 205 carry no body (205 Reset Content is what marking a notification read returns).
    if (response.status === 204 || response.status === 205) return undefined as T;
    if (options.text) return (await response.text()) as T;
    return (await response.json()) as T;
  }

  /**
   * Performs one request and maps every failure to a GitHubRequestError. A 304 is
   * returned as-is only when the caller holds a cached body to reuse.
   */
  private async dispatch(url: string, init: RequestInit, allowNotModified: boolean): Promise<Response> {
    let response: Response;
    try {
      response = await this.apiFetch(url, init);
    } catch {
      throw new GitHubRequestError('transient', 'GitHub could not be reached.');
    }

    if (allowNotModified && response.status === 304) return response;
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      const retryAfterMs = readSeconds(response.headers.get('retry-after'), 1000);
      const resetSeconds = readSeconds(response.headers.get('x-ratelimit-reset'), 1000);
      // Secondary limits can arrive as a bare 403 that names the limit in its message.
      const named = response.status === 403 && /rate limit/i.test(await response.text().catch(() => ''));
      if (remaining === '0' || retryAfterMs !== undefined || response.status === 429 || named) {
        throw new GitHubRequestError('rate-limited', 'GitHub rate limit reached.', {
          status: response.status,
          resetAt: resetSeconds,
          retryAfterMs
        });
      }
    }
    if (response.status >= 500) {
      throw new GitHubRequestError('transient', `GitHub is unavailable (${response.status}).`, {
        status: response.status
      });
    }
    if (!response.ok) {
      throw new GitHubRequestError('http', `GitHub returned ${response.status}.`, {
        status: response.status
      });
    }
    return response;
  }
}

export interface GitHubWriteOptions extends GitHubRequestOptions {
  /** JSON request body. */
  body?: unknown;
  /** Send to the uploads host instead of the REST API. */
  base?: 'uploads';
  /** Raw request bytes for an attachment upload. Takes precedence over `body`. */
  rawBody?: { bytes: Uint8Array; contentType: string };
  /** Return the raw response text instead of parsing JSON. */
  text?: boolean;
}

function readSeconds(value: string | null, unitMs: number): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * unitMs : undefined;
}
