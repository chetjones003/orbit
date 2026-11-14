import type {
  IssueComment,
  IssueDetail,
  IssueLabel,
  IssueListPage,
  IssueListQuery,
  IssueStateFilter,
  IssueSummary
} from '../../shared/issues';
import type { AuthService } from './auth-service';
import { GitHubClient } from './github-client';

/** Page size requested from GitHub. A full page means another page may exist. */
export const ISSUES_PER_PAGE = 30;
const COMMENTS_PER_PAGE = 100;
const HTML_ACCEPT = 'application/vnd.github.html+json';
const STATES: readonly IssueStateFilter[] = ['open', 'closed', 'all'];
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const TEXT_FILTER_MAX = 100;

interface GitHubIssueResponse {
  id: number;
  number: number;
  title: string;
  state: string;
  state_reason?: string | null;
  user: { login: string } | null;
  labels: Array<{ name: string; color: string } | string>;
  comments: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  body_html?: string | null;
  pull_request?: unknown;
}

interface GitHubCommentResponse {
  id: number;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  body_html?: string | null;
}

export interface IssueServiceOptions {
  auth: Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  apiBaseUrl: string;
  /** Shared client, so ETags are reused. Created internally when omitted. */
  client?: GitHubClient;
  fetch?: typeof fetch;
}

/**
 * Reads issues for the signed-in user's own repositories. Nothing is persisted;
 * results are returned to the caller and never stored on disk.
 */
export class IssueService {
  private readonly auth: IssueServiceOptions['auth'];
  private readonly client: GitHubClient;

  constructor(options: IssueServiceOptions) {
    this.auth = options.auth;
    this.client =
      options.client ?? new GitHubClient({ apiBaseUrl: options.apiBaseUrl, fetch: options.fetch });
  }

  async listIssues(query: IssueListQuery): Promise<IssueListPage> {
    const { owner, repo } = this.validateRepo(query.repoFullName);
    const state = validateState(query.state);
    const page = validatePage(query.page);
    const params = new URLSearchParams({ state });
    if (query.label !== undefined) params.set('labels', validateText(query.label, 'label'));
    if (query.author !== undefined) params.set('creator', validateText(query.author, 'author'));
    params.set('per_page', String(ISSUES_PER_PAGE));
    params.set('page', String(page));

    const { token, scope } = await this.session();
    const body = await this.client.get<unknown>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params.toString()}`,
      { token, scope }
    );
    if (!Array.isArray(body)) throw new Error('GitHub returned an invalid issue list.');

    const items: IssueSummary[] = [];
    let partial = false;
    for (const raw of body as unknown[]) {
      // Pull requests share this endpoint; they are not issues.
      if (isPullRequest(raw)) continue;
      const summary = toSummary(raw);
      if (summary) items.push(summary);
      else partial = true;
    }
    return { items, page, hasNextPage: body.length === ISSUES_PER_PAGE, partial };
  }

  async getIssueDetail(repoFullName: string, number: number): Promise<IssueDetail> {
    const { owner, repo } = this.validateRepo(repoFullName);
    if (!Number.isInteger(number) || number < 1)
      throw new Error('Issue numbers must be positive whole numbers.');
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`;
    const { token, scope } = await this.session();

    const issueBody = await this.client.get<unknown>(base, { token, scope, accept: HTML_ACCEPT });
    if (isPullRequest(issueBody)) throw new Error('That number is not an issue. It is a pull request.');
    const summary = toSummary(issueBody);
    if (!summary) throw new Error('GitHub returned an invalid issue.');
    const bodyHtml = (issueBody as GitHubIssueResponse).body_html ?? '';

    const commentsBody = await this.client.get<unknown>(
      `${base}/comments?per_page=${COMMENTS_PER_PAGE}&page=1`,
      { token, scope, accept: HTML_ACCEPT }
    );
    if (!Array.isArray(commentsBody)) throw new Error('GitHub returned invalid comments.');
    const comments: IssueComment[] = [];
    let droppedComment = false;
    for (const raw of commentsBody as unknown[]) {
      const comment = toComment(raw);
      if (comment) comments.push(comment);
      else droppedComment = true;
    }
    return {
      summary,
      bodyHtml,
      comments,
      commentsPartial: droppedComment || commentsBody.length === COMMENTS_PER_PAGE
    };
  }

  private validateRepo(repoFullName: unknown): { owner: string; repo: string } {
    const parts = typeof repoFullName === 'string' ? repoFullName.split('/') : [];
    const [owner, repo] = parts;
    if (parts.length !== 2 || !owner || !repo || !OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) {
      throw new Error('Repository names must look like owner/name.');
    }
    if (repo === '.' || repo === '..') throw new Error('Repository names must look like owner/name.');
    const signedIn = this.auth.getStatus();
    if (signedIn.kind !== 'signed-in') throw new Error('Sign in to GitHub to load issues.');
    if (owner.toLowerCase() !== signedIn.login.toLowerCase()) {
      throw new Error('Only personal repos, owned by the signed-in account, can be opened.');
    }
    return { owner, repo };
  }

  private async session(): Promise<{ token: string; scope: string }> {
    const status = this.auth.getStatus();
    if (status.kind !== 'signed-in') throw new Error('Sign in to GitHub to load issues.');
    return { token: await this.auth.getAccessToken(), scope: String(status.sessionId) };
  }
}

function validateState(state: unknown): IssueStateFilter {
  if (typeof state === 'string' && (STATES as readonly string[]).includes(state)) {
    return state as IssueStateFilter;
  }
  throw new Error('Issue state must be open, closed, or all.');
}

function validatePage(page: unknown): number {
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 10_000) {
    throw new Error('Page must be a whole number from 1.');
  }
  return page;
}

function validateText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > TEXT_FILTER_MAX) {
    throw new Error(`The ${field} filter is invalid.`);
  }
  // Filters are user text; reject control characters so they cannot reach headers or logs.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`The ${field} filter is invalid.`);
  return value;
}

function isPullRequest(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'pull_request' in raw &&
    (raw as { pull_request?: unknown }).pull_request != null
  );
}

function toSummary(raw: unknown): IssueSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Partial<GitHubIssueResponse>;
  if (
    typeof item.id !== 'number' ||
    typeof item.number !== 'number' ||
    typeof item.title !== 'string' ||
    (item.state !== 'open' && item.state !== 'closed') ||
    typeof item.html_url !== 'string' ||
    typeof item.created_at !== 'string' ||
    typeof item.updated_at !== 'string' ||
    typeof item.comments !== 'number' ||
    !Array.isArray(item.labels)
  ) {
    return null;
  }
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    state: item.state,
    stateReason: item.state_reason ?? null,
    authorLogin: item.user?.login ?? 'ghost',
    labels: item.labels.flatMap(toLabel),
    commentCount: item.comments,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    htmlUrl: item.html_url
  };
}

function toComment(raw: unknown): IssueComment | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Partial<GitHubCommentResponse>;
  if (
    typeof item.id !== 'number' ||
    typeof item.created_at !== 'string' ||
    typeof item.updated_at !== 'string' ||
    typeof item.html_url !== 'string'
  ) {
    return null;
  }
  return {
    id: item.id,
    authorLogin: item.user?.login ?? 'ghost',
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    htmlUrl: item.html_url,
    bodyHtml: item.body_html ?? ''
  };
}

function toLabel(raw: unknown): IssueLabel[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const label = raw as { name?: unknown; color?: unknown };
  if (typeof label.name !== 'string' || typeof label.color !== 'string') return [];
  return [{ name: label.name, color: label.color }];
}
