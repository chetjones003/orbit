import type { InboxItem } from '../../shared/inbox';
import {
  SEARCH_KINDS,
  SEARCH_LABELS_MAX,
  SEARCH_STATES,
  SEARCH_TEXT_MAX,
  type SearchPage,
  type SearchRequest
} from '../../shared/search';
import type { AuthService } from './auth-service';
import type { RepoService } from './repo-service';
import { GitHubClient, GitHubRequestError } from './github-client';
import { SEARCH_RESULT_CAP, isSearchResponse, toInboxItem } from './inbox-service';

/** A request without its page number, which is what the query is built from. */
export type SearchQuery = Omit<SearchRequest, 'page'>;

/** Results per search page. */
const SEARCH_PER_PAGE = 30;
const MAX_PAGE = Math.ceil(SEARCH_RESULT_CAP / SEARCH_PER_PAGE);
/** Repos checked at once when looking a number up across them. */
const LOOKUP_BATCH = 6;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
/** Largest issue or pull request number GitHub hands out in practice. */
const NUMBER_MAX = 999_999_999;

/**
 * The GitHub search query for one request. Always limited to the account's own repos, so nothing in the request
 * can widen the search to other people's repositories. The request already holds structured filters, so the
 * words are only stripped of the characters that would turn them into GitHub qualifiers.
 */
export function buildSearchQuery(request: SearchQuery, login: string): { q: string; sort: 'updated' | null } {
  if (!LOGIN_PATTERN.test(login)) throw new Error('The signed-in account name is not valid.');
  const parts = [`user:${login}`];

  if (request.kind === 'issue') parts.push('is:issue');
  else if (request.kind === 'pull') parts.push('is:pr');
  if (request.state !== 'all') parts.push(`is:${request.state}`);

  if (request.repoFullName) {
    const pieces = request.repoFullName.split('/');
    const [owner, name] = pieces;
    if (
      pieces.length !== 2 ||
      owner?.toLowerCase() !== login.toLowerCase() ||
      !name ||
      !REPO_NAME_PATTERN.test(name)
    ) {
      throw new Error('Search covers only your own repositories.');
    }
    parts.push(`repo:${owner}/${name}`);
  }

  for (const label of request.labels) {
    const clean = label.replace(/"/g, '').trim();
    if (clean) parts.push(`label:"${clean}"`);
  }

  if (request.author !== null) {
    if (!LOGIN_PATTERN.test(request.author)) throw new Error('The author must be a GitHub account name.');
    parts.push(`author:${request.author}`);
  }

  const words = request.terms
    .split(/\s+/)
    .map((word) => word.replace(/["':]/g, ''))
    .filter(Boolean);
  parts.push(...words);
  return { q: parts.join(' '), sort: words.length === 0 ? 'updated' : null };
}

/** True when the only words typed are the number itself, such as "1236" or "#1236". */
function isNumberOnly(terms: string, number: number): boolean {
  const words = terms.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => word.replace(/^#/, '') === String(number));
}

/** Whether an item a number lookup found also meets the chosen type, status, labels, and author. */
function matchesFilters(item: InboxItem, request: SearchQuery): boolean {
  if (request.kind === 'issue' && item.kind !== 'issue') return false;
  if (request.kind === 'pull' && item.kind !== 'pull') return false;
  if (request.state !== 'all' && item.state !== request.state) return false;
  if (request.author && item.authorLogin.toLowerCase() !== request.author.toLowerCase()) return false;
  return request.labels.every((wanted) =>
    item.labels.some((label) => label.name.toLowerCase() === wanted.toLowerCase())
  );
}

const itemKey = (item: InboxItem): string => `${item.repoFullName}#${item.number}`;

export interface SearchServiceOptions {
  auth: Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  apiBaseUrl: string;
  /** Shared client, so ETags are reused across refreshes. Created internally when omitted. */
  client?: GitHubClient;
  fetch?: typeof fetch;
  /** Lists the account's personal repos, so a number can be looked up in each of them. */
  repos?: Pick<RepoService, 'current'>;
}

/**
 * Cross-repo search for issues and pull requests in the signed-in account's personal repos.
 * Nothing is persisted; the shared client keeps only in-memory ETags.
 */
export class SearchService {
  private readonly auth: SearchServiceOptions['auth'];
  private readonly client: GitHubClient;
  private readonly repos: SearchServiceOptions['repos'];

  constructor(options: SearchServiceOptions) {
    this.auth = options.auth;
    this.repos = options.repos;
    this.client =
      options.client ?? new GitHubClient({ apiBaseUrl: options.apiBaseUrl, fetch: options.fetch });
  }

  async search(request: SearchRequest): Promise<SearchPage> {
    if (typeof request.terms !== 'string' || request.terms.length > SEARCH_TEXT_MAX)
      throw new Error(`Search text must be ${SEARCH_TEXT_MAX} characters or fewer.`);
    if (!SEARCH_KINDS.includes(request.kind)) throw new Error('Unknown search type.');
    if (!SEARCH_STATES.includes(request.state)) throw new Error('Unknown search state.');
    if (
      !Array.isArray(request.labels) ||
      request.labels.length > SEARCH_LABELS_MAX ||
      request.labels.some((label) => typeof label !== 'string' || label.length > 100)
    )
      throw new Error(`Search up to ${SEARCH_LABELS_MAX} labels at a time.`);
    if (request.author !== null && typeof request.author !== 'string')
      throw new Error('The author must be a GitHub account name.');
    if (request.repoFullName !== null && typeof request.repoFullName !== 'string')
      throw new Error('Search covers only your own repositories.');
    if (
      request.number !== null &&
      (!Number.isInteger(request.number) || request.number < 1 || request.number > NUMBER_MAX)
    )
      throw new Error('Issue and pull request numbers are whole numbers.');
    if (!Number.isInteger(request.page) || request.page < 1 || request.page > MAX_PAGE)
      throw new Error('Search pages must be positive whole numbers within GitHub’s search limit.');
    const status = this.auth.getStatus();
    if (status.kind !== 'signed-in') throw new Error('Sign in to GitHub to search.');

    const { page, ...query } = request;
    const { q, sort } = buildSearchQuery(query, status.login);
    const token = await this.auth.getAccessToken();
    const scope = String(status.sessionId);

    // A number is looked up directly, on the first page only, and listed before any text matches.
    const hits =
      request.number !== null && page === 1
        ? await this.findByNumber(request.number, query, status.login, token, scope)
        : { items: [] as InboxItem[], partial: false };
    if (request.number !== null && isNumberOnly(request.terms, request.number)) {
      return {
        items: hits.items,
        totalCount: hits.items.length,
        page,
        hasNextPage: false,
        partial: hits.partial
      };
    }

    const params = new URLSearchParams({
      q,
      per_page: String(SEARCH_PER_PAGE),
      page: String(page)
    });
    if (sort) {
      params.set('sort', sort);
      params.set('order', 'desc');
    }
    const body = await this.client.get<unknown>(`/search/issues?${params.toString()}`, { token, scope });
    if (!isSearchResponse(body)) throw new Error('GitHub returned an invalid search result.');

    const found: InboxItem[] = [];
    let partial = body.incomplete_results || body.total_count > SEARCH_RESULT_CAP || hits.partial;
    for (const raw of body.items) {
      const item = toInboxItem(raw, status.login);
      if (item) found.push(item);
      else partial = true;
    }

    // Lookup hits lead, and a search result for the same item is not listed twice.
    const seen = new Set(hits.items.map(itemKey));
    const items = [...hits.items, ...found.filter((item) => !seen.has(itemKey(item)))];
    const visibleTotal = Math.min(body.total_count, SEARCH_RESULT_CAP);
    return {
      items,
      totalCount: visibleTotal + items.length - found.length,
      page,
      hasNextPage: page * SEARCH_PER_PAGE < visibleTotal,
      partial
    };
  }

  /**
   * The issue or pull request with this number in each repo it could be in: the one repo chosen, or every personal
   * repo. A repo without that number answers 404 and is skipped. Other failures mark the result partial.
   */
  private async findByNumber(
    number: number,
    query: SearchQuery,
    login: string,
    token: string,
    scope: string
  ): Promise<{ items: InboxItem[]; partial: boolean }> {
    const names = query.repoFullName
      ? [query.repoFullName]
      : ((await this.repos?.current()) ?? [])
          .map((repo) => repo.fullName)
          .filter((fullName) => fullName.split('/')[0]?.toLowerCase() === login.toLowerCase());

    const items: InboxItem[] = [];
    let partial = false;
    for (let start = 0; start < names.length; start += LOOKUP_BATCH) {
      const batch = names.slice(start, start + LOOKUP_BATCH);
      const results = await Promise.allSettled(
        batch.map((fullName) =>
          this.client.get<unknown>(
            `/repos/${fullName.split('/').map(encodeURIComponent).join('/')}/issues/${number}`,
            {
              token,
              scope
            }
          )
        )
      );
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const missing = result.reason instanceof GitHubRequestError && result.reason.status === 404;
          if (!missing) partial = true;
          return;
        }
        const fullName = batch[index] ?? '';
        const raw = result.value;
        // The single-item response may omit the repo link, so the repo this request was made for is used.
        const withRepo =
          raw && typeof raw === 'object' && !('repository_url' in raw)
            ? { ...raw, repository_url: `https://api.github.com/repos/${fullName}` }
            : raw;
        const item = toInboxItem(withRepo, login);
        if (item && matchesFilters(item, query)) items.push(item);
      });
    }
    return { items, partial };
  }
}
