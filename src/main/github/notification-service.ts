import type { AuthService } from './auth-service';
import { GitHubClient } from './github-client';

export type { NotificationTarget, NotificationItem, NotificationDelivery } from '../../shared/notifications';
import type { NotificationDelivery, NotificationItem, NotificationTarget } from '../../shared/notifications';

export interface NotificationPoll {
  /** Milliseconds from X-Poll-Interval, when GitHub sent one. */
  pollIntervalMs?: number;
  /** Null when nothing new needs telling. */
  delivery: NotificationDelivery | null;
}

export interface NotificationServiceOptions {
  auth: Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  apiBaseUrl: string;
  client?: GitHubClient;
}

/** Above this many new notifications in one poll, the user gets one summary instead of one each. */
const CATCH_UP_LIMIT = 3;

/** Shape of one entry in GitHub's notification list; only the fields Orbit reads are typed. */
interface RawThread {
  id: string;
  reason: string;
  updated_at: string;
  repository: { full_name: string; owner: { login: string } };
  subject: { title: string; type: string; url: string | null };
}

/**
 * Polls the signed-in user's unread notifications on their personal repos and
 * decides what is new. Dedupe state lives in memory for one session. Nothing
 * is persisted.
 */
export class NotificationService {
  private readonly auth: NotificationServiceOptions['auth'];
  private readonly client: GitHubClient;
  private sessionId: number | null = null;
  /** Thread id plus updated_at for every notification already seen in this session. */
  private seen = new Set<string>();
  private baselined = false;

  constructor(options: NotificationServiceOptions) {
    this.auth = options.auth;
    this.client = options.client ?? new GitHubClient({ apiBaseUrl: options.apiBaseUrl });
  }

  async poll(): Promise<NotificationPoll> {
    const status = this.auth.getStatus();
    if (status.kind !== 'signed-in') throw new Error('Sign in to GitHub to receive notifications.');
    if (this.sessionId !== status.sessionId) {
      // A different account starts a new session, so its first poll is quiet again.
      this.sessionId = status.sessionId;
      this.seen = new Set();
      this.baselined = false;
    }
    const token = await this.auth.getAccessToken();
    const result = await this.client.getWithMeta<unknown>('/notifications?participating=false', {
      token,
      scope: String(status.sessionId)
    });
    // The account may have changed while GitHub answered. That answer belongs to the old session.
    const current = this.auth.getStatus();
    if (current.kind !== 'signed-in' || current.sessionId !== status.sessionId) {
      return { pollIntervalMs: result.pollIntervalMs, delivery: null };
    }
    if (!Array.isArray(result.data)) throw new Error('GitHub returned an invalid notification list.');
    const login = status.login.toLowerCase();
    const mine = (result.data as RawThread[]).filter(
      (thread) => thread?.repository?.owner?.login?.toLowerCase() === login
    );
    const fresh = mine.filter((thread) => !this.seen.has(dedupeKey(thread)));
    for (const thread of mine) this.seen.add(dedupeKey(thread));

    const pollIntervalMs = result.pollIntervalMs;
    if (!this.baselined) {
      this.baselined = true;
      const delivery: NotificationDelivery | null =
        mine.length > 0 ? { kind: 'summary', count: mine.length, desktop: false } : null;
      return { pollIntervalMs, delivery };
    }
    if (fresh.length === 0) return { pollIntervalMs, delivery: null };
    if (fresh.length > CATCH_UP_LIMIT) {
      return { pollIntervalMs, delivery: { kind: 'summary', count: fresh.length, desktop: true } };
    }
    return {
      pollIntervalMs,
      delivery: { kind: 'items', items: fresh.map(toItem) }
    };
  }

  /** Marks one thread read on GitHub. A failure throws, so the caller keeps the thread unread and reports it. */
  async markRead(threadId: string): Promise<void> {
    const status = this.auth.getStatus();
    if (status.kind !== 'signed-in') throw new Error('Sign in to GitHub to update notifications.');
    const token = await this.auth.getAccessToken();
    await this.client.send('PATCH', `/notifications/threads/${encodeURIComponent(threadId)}`, {
      token,
      scope: String(status.sessionId)
    });
  }
}

function dedupeKey(thread: RawThread): string {
  return `${thread.id}\u0000${thread.updated_at}`;
}

function toItem(thread: RawThread): NotificationItem {
  return {
    threadId: thread.id,
    repoFullName: thread.repository.full_name,
    title: thread.subject.title,
    reason: thread.reason,
    subjectType: thread.subject.type,
    updatedAt: thread.updated_at,
    target: parseTarget(thread.subject.url)
  };
}

/** Maps an API subject URL such as .../repos/o/r/issues/12 to the item it names. */
export function parseTarget(url: string | null | undefined): NotificationTarget | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = /\/repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)$/.exec(path);
  if (!match) return null;
  return {
    kind: match[3] === 'pulls' ? 'pull' : 'issue',
    repoFullName: `${match[1]}/${match[2]}`,
    number: Number(match[4])
  };
}
