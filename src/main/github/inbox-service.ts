import {
  INBOX_TABS,
  type InboxItem,
  type InboxPage,
  type InboxQuery,
  type InboxTab
} from '../../shared/inbox';
import type { IssueLabel } from '../../shared/issues';
import type { AuthService } from './auth-service';
import { GitHubClient } from './github-client';

/** Results per search page. */
const INBOX_PER_PAGE = 30;
/** GitHub's search API returns at most this many results for one query. */
export const SEARCH_RESULT_CAP = 1000;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const MAX_PAGE = Math.ceil(SEARCH_RESULT_CAP / INBOX_PER_PAGE);

/** Search-side qualifiers for each fixed tab. `login` is the signed-in account. */
const TAB_QUALIFIERS: Record<InboxTab, (login: string) => string> = {
  'my-open-prs': (login) => `is:pr is:open author:${login}`,
  assigned: (login) => `is:open assignee:${login}`,
  'review-requested': (login) => `is:pr is:open review-requested:${login}`,
  mentioned: (login) => `is:open mentions:${login}`,
  recent: () => 'is:open'
};

/** The search query for one tab, always limited to the account's own repos. */
export function buildInboxSearchQuery(tab: InboxTab, login: string): string {
  return `${TAB_QUALIFIERS[tab](login)} user:${login}`;
}

export interface SearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: unknown[];
}

export interface InboxServiceOptions {
  auth: Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  apiBaseUrl: string;
  /** Shared client, so ETags are reused across refreshes. Created internally when omitted. */
  client?: GitHubClient;
  fetch?: typeof fetch;
}

/**
 * Reads the signed-in account's inbox tabs from GitHub search. Nothing is persisted;
 * the shared client keeps only in-memory ETags.
 */
export class InboxService {
  private readonly auth: InboxServiceOptions['auth'];
  private readonly client: GitHubClient;

  constructor(options: InboxServiceOptions) {
    this.auth = options.auth;
    this.client =
      options.client ?? new GitHubClient({ apiBaseUrl: options.apiBaseUrl, fetch: options.fetch });
  }

  async list(query: InboxQuery): Promise<InboxPage> {
    if (!INBOX_TABS.includes(query.tab)) throw new Error('Unknown inbox tab.');
    if (!Number.isInteger(query.page) || query.page < 1 || query.page > MAX_PAGE)
      throw new Error('Inbox pages must be positive whole numbers within GitHub’s search limit.');
    const status = this.auth.getStatus();
    if (status.kind !== 'signed-in') throw new Error('Sign in to GitHub to load your inbox.');
    const login = status.login;
    if (!LOGIN_PATTERN.test(login)) throw new Error('The signed-in account name is not valid.');

    const token = await this.auth.getAccessToken();
    const params = new URLSearchParams({
      q: buildInboxSearchQuery(query.tab, login),
      sort: 'updated',
      order: 'desc',
      per_page: String(INBOX_PER_PAGE),
      page: String(query.page)
    });
    const body = await this.client.get<unknown>(`/search/issues?${params.toString()}`, {
      token,
      scope: String(status.sessionId)
    });
    if (!isSearchResponse(body)) throw new Error('GitHub returned an invalid inbox result.');

    const items: InboxItem[] = [];
    let partial = body.incomplete_results || body.total_count > SEARCH_RESULT_CAP;
    for (const raw of body.items) {
      const item = toInboxItem(raw, login);
      if (item) items.push(item);
      else partial = true;
    }
    const visibleTotal = Math.min(body.total_count, SEARCH_RESULT_CAP);
    return {
      tab: query.tab,
      items,
      page: query.page,
      hasNextPage: query.page * INBOX_PER_PAGE < visibleTotal,
      partial
    };
  }
}

export function isSearchResponse(value: unknown): value is SearchResponse {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<SearchResponse>;
  return (
    typeof body.total_count === 'number' &&
    typeof body.incomplete_results === 'boolean' &&
    Array.isArray(body.items)
  );
}

/** Returns null for a result that is malformed or outside the account's own repos. */
export function toInboxItem(raw: unknown, login: string): InboxItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const repoFullName = repoFromUrl(item['repository_url']);
  if (!repoFullName || repoFullName.split('/')[0]?.toLowerCase() !== login.toLowerCase()) return null;
  const user = item['user'] as { login?: unknown } | null | undefined;
  if (
    typeof item['number'] !== 'number' ||
    typeof item['title'] !== 'string' ||
    (item['state'] !== 'open' && item['state'] !== 'closed') ||
    typeof user?.login !== 'string' ||
    typeof item['comments'] !== 'number' ||
    typeof item['updated_at'] !== 'string' ||
    typeof item['html_url'] !== 'string' ||
    !Array.isArray(item['labels'])
  ) {
    return null;
  }
  const labels = (item['labels'] as Array<Record<string, unknown>>)
    .filter((label) => typeof label?.['name'] === 'string')
    .map((label): IssueLabel => ({
      name: label['name'] as string,
      color: typeof label['color'] === 'string' ? label['color'] : ''
    }));
  const isPull = item['pull_request'] !== undefined && item['pull_request'] !== null;
  return {
    repoFullName,
    number: item['number'],
    kind: isPull ? 'pull' : 'issue',
    title: item['title'],
    state: item['state'],
    isDraft: isPull && item['draft'] === true,
    authorLogin: user.login,
    labels,
    commentCount: item['comments'],
    updatedAt: item['updated_at'],
    htmlUrl: item['html_url']
  };
}

/** `https://api.github.com/repos/owner/name` → `owner/name`. */
function repoFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /\/repos\/([^/]+)\/([^/]+)$/.exec(value);
  return match ? `${match[1]}/${match[2]}` : null;
}
