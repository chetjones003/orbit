import { COMMENT_MAX_CHARS, ISSUE_BODY_MAX_CHARS, ISSUE_TITLE_MAX_CHARS } from '../../shared/issues';
import {
  checkAttachment,
  isSafeAttachmentUrl,
  type AccountPlan,
  type AttachmentFile,
  type AttachmentUploadResult
} from '../../shared/attachments';
import type {
  CommentUpdateResult,
  IssueCloseReason,
  IssueComment,
  IssueContentInput,
  IssueDetail,
  IssueEditResult,
  IssueFieldsInput,
  IssueLabel,
  IssueListPage,
  IssueListQuery,
  IssueMilestone,
  IssueRepoOptions,
  IssueSnapshot,
  IssueStateFilter,
  IssueSummary,
  TaskToggleResult
} from '../../shared/issues';
import type { AuthService } from './auth-service';
import { GitHubClient, GitHubRequestError } from './github-client';
import { setTaskItemChecked } from './task-list';
import { runWrite, WriteBlockedError } from './write-reconcile';

/** Page size requested from GitHub. A full page means another page may exist. */
export const ISSUES_PER_PAGE = 30;
const COMMENTS_PER_PAGE = 100;
/** Upper bound on comment pages read for one issue (1,000 comments). */
const COMMENT_PAGE_LIMIT = 10;
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
  assignees?: Array<{ login: string } | null>;
  milestone?: { number: number; title: string } | null;
  comments: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  body?: string | null;
  body_html?: string | null;
  pull_request?: unknown;
}

interface GitHubCommentResponse {
  id: number;
  user: { login: string } | null;
  body?: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  body_html?: string | null;
}

/** Remembers whether the user has acknowledged that uploads to public repos are public at once. */
export interface AttachmentNoticeStore {
  isAcknowledged(): Promise<boolean>;
  acknowledge(): Promise<void>;
}

export interface IssueServiceOptions {
  auth: Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  apiBaseUrl: string;
  /** Host that receives attachment uploads. */
  uploadsBaseUrl?: string;
  /** Shared client, so ETags are reused. Created internally when omitted. */
  client?: GitHubClient;
  fetch?: typeof fetch;
  /** False while GitHub is unreachable or rate limiting. Writes are then refused before sending. */
  canWrite?: () => boolean;
  /** Where the public-upload acknowledgement is kept. Held in memory when omitted. */
  attachmentNotice?: AttachmentNoticeStore;
}

/**
 * Reads issues for the signed-in user's own repositories. Nothing is persisted;
 * results are returned to the caller and never stored on disk.
 */
export class IssueService {
  private readonly auth: IssueServiceOptions['auth'];
  private readonly client: GitHubClient;
  private readonly canWrite: () => boolean;
  private readonly notice: AttachmentNoticeStore;

  constructor(options: IssueServiceOptions) {
    this.auth = options.auth;
    this.client =
      options.client ??
      new GitHubClient({
        apiBaseUrl: options.apiBaseUrl,
        uploadsBaseUrl: options.uploadsBaseUrl,
        fetch: options.fetch
      });
    this.canWrite = options.canWrite ?? (() => true);
    this.notice = options.attachmentNotice ?? memoryNotice();
  }

  /**
   * Uploads a file for the user to link from a comment or issue body in one of their repos. The file's type and
   * size are checked before any request is sent. A public repo returns 'public-notice' until the user acknowledges
   * that the upload is public at once; nothing is uploaded before that.
   */
  async uploadAttachment(
    repoFullName: string,
    file: AttachmentFile,
    options: { acknowledgedPublic: boolean }
  ): Promise<AttachmentUploadResult> {
    const { owner, repo } = this.validateRepo(repoFullName);
    if (typeof file?.name !== 'string' || !(file.bytes instanceof Uint8Array)) {
      throw new Error('Choose a file to attach.');
    }
    // Type and image size first, with the most generous video limit, so nothing is requested for a file that can never be uploaded.
    const preliminary = checkAttachment({ name: file.name, size: file.bytes.byteLength }, 'paid');
    if (!preliminary.ok) throw new Error(preliminary.message);
    this.assertCanWrite();
    const { token, scope } = await this.session();

    const access = readRepoAccess(
      await this.client.get<unknown>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        token,
        scope
      })
    );
    if (!access.canPush) throw new Error('You need write access to this repo to attach files.');

    const plan = preliminary.kind === 'video' ? await this.accountPlan(token, scope) : 'free';
    const checked = checkAttachment({ name: file.name, size: file.bytes.byteLength }, plan);
    if (!checked.ok) throw new Error(checked.message);

    if (!access.isPrivate) {
      if (options.acknowledgedPublic) {
        if (!(await this.notice.isAcknowledged())) await this.notice.acknowledge();
      } else if (!(await this.notice.isAcknowledged())) {
        return { kind: 'public-notice' };
      }
    }

    const params = new URLSearchParams({
      name: file.name,
      content_type: checked.contentType,
      repository_id: String(access.id)
    });
    const response = await this.client.send<unknown>(
      'POST',
      `/user-attachments/assets?${params.toString()}`,
      {
        token,
        scope,
        base: 'uploads',
        rawBody: { bytes: file.bytes, contentType: checked.contentType },
        accept: 'application/json'
      }
    );
    const href = (response as { href?: unknown } | null)?.href;
    if (typeof href !== 'string' || !isSafeAttachmentUrl(href)) {
      throw new Error('GitHub did not return an attachment link.');
    }
    return { kind: 'uploaded', url: href };
  }

  /** Account plan decides the video limit. An unknown plan gets the free limit, the lower one. */
  private async accountPlan(token: string, scope: string): Promise<AccountPlan> {
    const me = await this.client.get<unknown>('/user', { token, scope });
    const name = (me as { plan?: { name?: unknown } } | null)?.plan?.name;
    return typeof name === 'string' && name !== 'free' ? 'paid' : 'free';
  }

  /** Renders Markdown the way GitHub will show it, in the repo's context (issue links, mentions). */
  async previewMarkdown(repoFullName: string, text: string): Promise<string> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateCommentBody(text);
    const { token, scope } = await this.session();
    return this.client.send<string>('POST', '/markdown', {
      token,
      scope,
      body: { text, mode: 'gfm', context: `${owner}/${repo}` },
      text: true
    });
  }

  /**
   * Edits one of the signed-in user's own comments. `baseUpdatedAt` is the version the user started from:
   * if GitHub holds a newer one, nothing is written and the newer comment is returned as a conflict.
   */
  async updateComment(
    repoFullName: string,
    commentId: number,
    body: string,
    baseUpdatedAt: string
  ): Promise<CommentUpdateResult> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateCommentId(commentId);
    validateCommentBody(body);
    this.assertCanWrite();
    const path = commentPath(owner, repo, commentId);
    const { token, scope } = await this.session();
    const login = this.signedInLogin();
    const current = await this.readOwnComment(path, token, scope, login);
    if (current.updatedAt !== baseUpdatedAt) return { kind: 'conflict', current };

    const saved = await runWrite<IssueComment>({
      canWrite: this.canWrite,
      attempt: async () =>
        toComment(
          await this.client.send<unknown>('PATCH', path, {
            token,
            scope,
            body: { body },
            accept: HTML_ACCEPT
          })
        ) ?? throwInvalid('GitHub returned an invalid comment.'),
      reconcile: async () => {
        const now = await this.readComment(path, token, scope);
        return now && now.body === body ? { applied: true, value: now } : { applied: false };
      }
    });
    return { kind: 'saved', comment: saved };
  }

  /** Deletes one of the signed-in user's own comments. A delete that already landed is not repeated. */
  async deleteComment(repoFullName: string, commentId: number): Promise<void> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateCommentId(commentId);
    this.assertCanWrite();
    const path = commentPath(owner, repo, commentId);
    const { token, scope } = await this.session();
    await this.readOwnComment(path, token, scope, this.signedInLogin());

    await runWrite<void>({
      canWrite: this.canWrite,
      attempt: async () => {
        await this.client.send<unknown>('DELETE', path, { token, scope });
      },
      reconcile: async () => {
        // A comment GitHub no longer has was deleted by the earlier request.
        const now = await this.readComment(path, token, scope);
        return now === null ? { applied: true, value: undefined } : { applied: false };
      }
    });
  }

  /** Posts a comment. An uncertain failure is reconciled by looking for the comment before retrying. */
  async createComment(repoFullName: string, number: number, body: string): Promise<IssueComment> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    validateCommentBody(body);
    const path = `${itemPath(owner, repo, 'issues', number)}/comments`;
    const startedAt = Date.now();
    const { token, scope } = await this.session();
    const me = this.auth.getStatus();
    const login = me.kind === 'signed-in' ? me.login : '';

    return runWrite<IssueComment>({
      canWrite: this.canWrite,
      attempt: async () =>
        toComment(
          await this.client.send<unknown>('POST', path, {
            token,
            scope,
            body: { body },
            accept: HTML_ACCEPT
          })
        ) ?? throwInvalid('GitHub returned an invalid comment.'),
      reconcile: async () => {
        // Look for the comment this request would have created, from the moment it was sent.
        const since = new Date(startedAt - RECONCILE_SKEW_MS).toISOString();
        const thread = await this.client.get<unknown>(
          `${path}?since=${since}&per_page=${COMMENTS_PER_PAGE}`,
          {
            token,
            scope,
            accept: HTML_ACCEPT
          }
        );
        const match = (Array.isArray(thread) ? (thread as unknown[]) : [])
          .map(toComment)
          .find((c): c is IssueComment => c !== null && c.authorLogin === login && c.body === body);
        return match ? { applied: true, value: match } : { applied: false };
      }
    });
  }

  /**
   * Opens a new issue in one of the signed-in user's repos. An uncertain failure is reconciled by looking
   * for the issue this request would have created, so it is never created twice.
   */
  async createIssue(repoFullName: string, input: IssueContentInput): Promise<IssueSnapshot> {
    const { owner, repo } = this.validateRepo(repoFullName);
    const content = validateIssueContent(input);
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
    const startedAt = Date.now();
    const { token, scope } = await this.session();
    const login = this.signedInLogin();

    return runWrite<IssueSnapshot>({
      canWrite: this.canWrite,
      attempt: async () =>
        toSnapshotOrThrow(
          await this.client.send<unknown>('POST', path, {
            token,
            scope,
            body: content,
            accept: HTML_ACCEPT
          })
        ),
      reconcile: async () => {
        const since = new Date(startedAt - RECONCILE_SKEW_MS).toISOString();
        const recent = await this.client.get<unknown>(
          `${path}?creator=${encodeURIComponent(login)}&state=all&sort=created&direction=desc&since=${since}&per_page=${ISSUES_PER_PAGE}`,
          { token, scope, accept: HTML_ACCEPT }
        );
        const match = (Array.isArray(recent) ? (recent as unknown[]) : [])
          .map(toSnapshot)
          .find(
            (s): s is IssueSnapshot =>
              s !== null && s.summary.title === content.title && s.body === content.body
          );
        return match ? { applied: true, value: match } : { applied: false };
      }
    });
  }

  /**
   * Edits the title and body of one of the signed-in user's issues. `base` is the title and body the user
   * started from. If GitHub's title or body differs from them, nothing is written and the current issue is
   * returned as a conflict. Other changes to the issue, such as a new comment, do not count.
   */
  async updateIssue(
    repoFullName: string,
    number: number,
    input: IssueContentInput,
    base: IssueContentInput
  ): Promise<IssueEditResult> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    const content = validateIssueContent(input);
    this.assertCanWrite();
    const path = itemPath(owner, repo, 'issues', number);
    const { token, scope } = await this.session();
    const current = await this.readIssueSnapshot(path, token, scope);
    if (current.summary.title !== base.title || current.body !== base.body) {
      return { kind: 'conflict', current };
    }

    const saved = await runWrite<IssueSnapshot>({
      canWrite: this.canWrite,
      attempt: async () =>
        toSnapshotOrThrow(
          await this.client.send<unknown>('PATCH', path, { token, scope, body: content, accept: HTML_ACCEPT })
        ),
      reconcile: async () => {
        const now = await this.readIssueSnapshot(path, token, scope);
        return now.summary.title === content.title && now.body === content.body
          ? { applied: true, value: now }
          : { applied: false };
      }
    });
    return { kind: 'saved', issue: saved };
  }

  /** Replaces an issue's labels, assignees, and milestone with the given choices. Returns GitHub's reconciled summary. */
  async updateIssueFields(
    repoFullName: string,
    number: number,
    fields: IssueFieldsInput
  ): Promise<IssueSummary> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    const input = validateFields(fields);
    this.assertCanWrite();
    const path = itemPath(owner, repo, 'issues', number);
    const { token, scope } = await this.session();

    return runWrite<IssueSummary>({
      canWrite: this.canWrite,
      attempt: async () =>
        toSummary(
          await this.client.send<unknown>('PATCH', path, {
            token,
            scope,
            body: {
              labels: input.labels,
              assignees: input.assignees,
              milestone: input.milestoneNumber
            }
          })
        ) ?? throwInvalid('GitHub returned an invalid issue.'),
      reconcile: async () => {
        const now = (await this.readIssueSnapshot(path, token, scope)).summary;
        const sameLabels = sameMembers(
          now.labels.map((l) => l.name),
          input.labels
        );
        const sameAssignees = sameMembers(now.assignees, input.assignees);
        const sameMilestone = (now.milestone?.number ?? null) === input.milestoneNumber;
        return sameLabels && sameAssignees && sameMilestone
          ? { applied: true, value: now }
          : { applied: false };
      }
    });
  }

  /** Closes an issue as completed or not planned, or reopens it. */
  async setIssueState(
    repoFullName: string,
    number: number,
    state: 'open' | 'closed',
    reason?: IssueCloseReason
  ): Promise<IssueSummary> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    if (state !== 'open' && state !== 'closed') throw new Error('An issue can only be open or closed.');
    const stateReason = state === 'closed' ? (reason ?? 'completed') : null;
    if (stateReason !== null && stateReason !== 'completed' && stateReason !== 'not_planned') {
      throw new Error('Close an issue as completed or not planned.');
    }
    this.assertCanWrite();
    const path = itemPath(owner, repo, 'issues', number);
    const { token, scope } = await this.session();
    const body = stateReason === null ? { state } : { state, state_reason: stateReason };

    return runWrite<IssueSummary>({
      canWrite: this.canWrite,
      attempt: async () =>
        toSummary(await this.client.send<unknown>('PATCH', path, { token, scope, body })) ??
        throwInvalid('GitHub returned an invalid issue.'),
      reconcile: async () => {
        const now = (await this.readIssueSnapshot(path, token, scope)).summary;
        return now.state === state && (stateReason === null || now.stateReason === stateReason)
          ? { applied: true, value: now }
          : { applied: false };
      }
    });
  }

  /** The labels, assignees, and open milestones the repo offers. The first page of each. */
  async getRepoOptions(repoFullName: string): Promise<IssueRepoOptions> {
    const { owner, repo } = this.validateRepo(repoFullName);
    const { token, scope } = await this.session();
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const [labels, assignees, milestones] = await Promise.all([
      this.client.get<unknown>(`${base}/labels?per_page=${COMMENTS_PER_PAGE}`, { token, scope }),
      this.client.get<unknown>(`${base}/assignees?per_page=${COMMENTS_PER_PAGE}`, { token, scope }),
      this.client.get<unknown>(`${base}/milestones?state=open&per_page=${COMMENTS_PER_PAGE}`, {
        token,
        scope
      })
    ]);
    if (!Array.isArray(labels) || !Array.isArray(assignees) || !Array.isArray(milestones)) {
      throw new Error('GitHub returned invalid repo options.');
    }
    // A list that fills its first page may have more entries that were not read.
    const partial = [labels, assignees, milestones].some((page) => page.length >= COMMENTS_PER_PAGE);
    return {
      labels: (labels as unknown[]).flatMap(toLabel),
      assignees: (assignees as unknown[]).flatMap((raw) => {
        const login = (raw as { login?: unknown } | null)?.login;
        return typeof login === 'string' ? [login] : [];
      }),
      milestones: (milestones as unknown[]).flatMap(toMilestone),
      partial
    };
  }

  /**
   * Ticks or unticks one task checkbox in an issue body. The checkbox is changed only if the body on GitHub
   * is still `expectedBody`, the text the user saw. Otherwise nothing is written and the current body is returned.
   */
  async setTaskItem(
    repoFullName: string,
    number: number,
    input: { index: number; checked: boolean; expectedBody: string }
  ): Promise<TaskToggleResult> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    if (!Number.isInteger(input.index) || input.index < 0) throw new Error('Task items are numbered from 0.');
    this.assertCanWrite();
    const path = itemPath(owner, repo, 'issues', number);
    const { token, scope } = await this.session();
    const current = await this.readIssueSnapshot(path, token, scope);
    if (current.body !== input.expectedBody) return { kind: 'stale', current };

    const nextBody = setTaskItemChecked(current.body, input.index, input.checked);
    if (nextBody === current.body) return { kind: 'saved', issue: current };
    const saved = await runWrite<IssueSnapshot>({
      canWrite: this.canWrite,
      attempt: async () =>
        toSnapshotOrThrow(
          await this.client.send<unknown>('PATCH', path, {
            token,
            scope,
            body: { body: nextBody },
            accept: HTML_ACCEPT
          })
        ),
      reconcile: async () => {
        const now = await this.readIssueSnapshot(path, token, scope);
        return now.body === nextBody ? { applied: true, value: now } : { applied: false };
      }
    });
    return { kind: 'saved', issue: saved };
  }

  /** Reads one issue with its raw body, the version writes are checked against. */
  private async readIssueSnapshot(path: string, token: string, scope: string): Promise<IssueSnapshot> {
    const raw = await this.client.get<unknown>(path, { token, scope, accept: HTML_ACCEPT });
    return toSnapshotOrThrow(raw);
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
    const base = itemPath(owner, repo, 'issues', number);
    const { token, scope } = await this.session();

    const issueBody = await this.client.get<unknown>(base, { token, scope, accept: HTML_ACCEPT });
    if (isPullRequest(issueBody)) throw new Error('That number is not an issue. It is a pull request.');
    const summary = toSummary(issueBody);
    if (!summary) throw new Error('GitHub returned an invalid issue.');
    const bodyHtml = (issueBody as GitHubIssueResponse).body_html ?? '';
    const { comments, commentsPartial } = await this.fetchComments(base, token, scope);
    return { summary, body: rawBody(issueBody), bodyHtml, comments, commentsPartial };
  }

  /** A pull request conversation, read with the same shape as an issue. */
  async getPullDetail(repoFullName: string, number: number): Promise<IssueDetail> {
    const { owner, repo } = this.validateRepo(repoFullName);
    if (!Number.isInteger(number) || number < 1)
      throw new Error('Issue numbers must be positive whole numbers.');
    const base = itemPath(owner, repo, 'issues', number);
    const { token, scope } = await this.session();

    const pullBody = await this.client.get<unknown>(itemPath(owner, repo, 'pulls', number), {
      token,
      scope,
      accept: HTML_ACCEPT
    });
    const summary = toSummary(pullBody);
    if (!summary) throw new Error('GitHub returned an invalid pull request.');
    const bodyHtml = (pullBody as GitHubIssueResponse).body_html ?? '';
    const { comments, commentsPartial } = await this.fetchComments(base, token, scope);
    return { summary, body: rawBody(pullBody), bodyHtml, comments, commentsPartial };
  }

  /**
   * Follows comment pages until GitHub returns a short page. Stops at COMMENT_PAGE_LIMIT pages;
   * a thread longer than that is reported as partial, never as complete.
   */
  private async fetchComments(
    base: string,
    token: string,
    scope: string
  ): Promise<{ comments: IssueComment[]; commentsPartial: boolean }> {
    const comments: IssueComment[] = [];
    let dropped = false;
    for (let page = 1; page <= COMMENT_PAGE_LIMIT; page++) {
      const body = await this.client.get<unknown>(
        `${base}/comments?per_page=${COMMENTS_PER_PAGE}&page=${page}`,
        { token, scope, accept: HTML_ACCEPT }
      );
      if (!Array.isArray(body)) throw new Error('GitHub returned invalid comments.');
      for (const raw of body as unknown[]) {
        const comment = toComment(raw);
        if (comment) comments.push(comment);
        else dropped = true;
      }
      if (body.length < COMMENTS_PER_PAGE) return { comments, commentsPartial: dropped };
    }
    return { comments, commentsPartial: true };
  }

  private assertCanWrite(): void {
    if (!this.canWrite()) throw new WriteBlockedError();
  }

  private signedInLogin(): string {
    const status = this.auth.getStatus();
    if (status.kind !== 'signed-in') throw new Error('Sign in to GitHub to load issues.');
    return status.login;
  }

  /** Reads a comment, or null when GitHub no longer has it. */
  private async readComment(path: string, token: string, scope: string): Promise<IssueComment | null> {
    try {
      const raw = await this.client.get<unknown>(path, { token, scope, accept: HTML_ACCEPT });
      return toComment(raw) ?? throwInvalid('GitHub returned an invalid comment.');
    } catch (error) {
      if (error instanceof GitHubRequestError && error.status === 404) return null;
      throw error;
    }
  }

  /** Reads a comment that the signed-in user may change. Other people's comments are refused. */
  private async readOwnComment(
    path: string,
    token: string,
    scope: string,
    login: string
  ): Promise<IssueComment> {
    const comment = await this.readComment(path, token, scope);
    if (comment === null) throw new Error('That comment no longer exists on GitHub.');
    if (comment.authorLogin !== login) throw new Error('You can only change your own comments.');
    return comment;
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

/** A repo counts as public only when GitHub says so; anything unclear gets the public-upload notice. */
function readRepoAccess(raw: unknown): { id: number; isPrivate: boolean; canPush: boolean } {
  const repo = raw as { id?: unknown; private?: unknown; permissions?: { push?: unknown } } | null;
  if (typeof repo?.id !== 'number') throw new Error('GitHub returned an invalid repo.');
  return {
    id: repo.id,
    isPrivate: repo.private === true,
    canPush: repo.permissions?.push === true
  };
}

function memoryNotice(): AttachmentNoticeStore {
  let acknowledged = false;
  return {
    isAcknowledged: async () => acknowledged,
    acknowledge: async () => {
      acknowledged = true;
    }
  };
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
    assignees: (item.assignees ?? []).flatMap((a) => (typeof a?.login === 'string' ? [a.login] : [])),
    milestone: toMilestone(item.milestone ?? null)[0] ?? null,
    commentCount: item.comments,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    htmlUrl: item.html_url
  };
}

/** Repo item path, for issues or pulls. */
function itemPath(owner: string, repo: string, kind: 'issues' | 'pulls', number: number): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${kind}/${number}`;
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
    body: item.body ?? '',
    bodyHtml: item.body_html ?? ''
  };
}

/** Allows for clock skew between Orbit and GitHub when searching for a comment that may have landed. */
const RECONCILE_SKEW_MS = 60_000;

function validateItemNumber(number: unknown): void {
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
    throw new Error('Issue numbers must be positive whole numbers.');
  }
}

/** Comment bodies must have visible text and fit GitHub's limit. Checked before any request is sent. */
export function validateCommentBody(body: unknown): asserts body is string {
  if (typeof body !== 'string' || body.trim() === '') throw new Error('A comment cannot be empty.');
  if ([...body].length > COMMENT_MAX_CHARS) {
    throw new Error(`Comments can be at most ${COMMENT_MAX_CHARS.toLocaleString('en-US')} characters.`);
  }
}

function validateCommentId(commentId: unknown): void {
  if (typeof commentId !== 'number' || !Number.isInteger(commentId) || commentId < 1) {
    throw new Error('Comment ids must be positive whole numbers.');
  }
}

function commentPath(owner: string, repo: string, commentId: number): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${commentId}`;
}

function throwInvalid(message: string): never {
  throw new Error(message);
}

/** An issue's summary plus its raw body and rendered body, as GitHub returns it with the HTML media type. */
function toSnapshot(raw: unknown): IssueSnapshot | null {
  const summary = toSummary(raw);
  if (!summary) return null;
  return { summary, body: rawBody(raw), bodyHtml: (raw as GitHubIssueResponse).body_html ?? '' };
}

function toSnapshotOrThrow(raw: unknown): IssueSnapshot {
  return toSnapshot(raw) ?? throwInvalid('GitHub returned an invalid issue.');
}

function rawBody(raw: unknown): string {
  return (raw as GitHubIssueResponse | null)?.body ?? '';
}

function toMilestone(raw: unknown): IssueMilestone[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const milestone = raw as { number?: unknown; title?: unknown };
  if (typeof milestone.number !== 'number' || typeof milestone.title !== 'string') return [];
  return [{ number: milestone.number, title: milestone.title }];
}

/** GitHub's limit for a label name. */
const LABEL_NAME_MAX_CHARS = 50;

function validateIssueContent(input: unknown): { title: string; body: string } {
  const { title, body } = (input ?? {}) as Partial<IssueContentInput>;
  if (typeof title !== 'string' || title.trim() === '') throw new Error('An issue needs a title.');
  if ([...title.trim()].length > ISSUE_TITLE_MAX_CHARS) {
    throw new Error(`Titles can be at most ${ISSUE_TITLE_MAX_CHARS} characters.`);
  }
  if (typeof body !== 'string') throw new Error('The issue body must be text.');
  if ([...body].length > ISSUE_BODY_MAX_CHARS) {
    throw new Error(
      `Issue descriptions can be at most ${ISSUE_BODY_MAX_CHARS.toLocaleString('en-US')} characters.`
    );
  }
  return { title: title.trim(), body };
}

function validateFields(input: unknown): IssueFieldsInput {
  const { labels, assignees, milestoneNumber } = (input ?? {}) as Partial<IssueFieldsInput>;
  if (
    !Array.isArray(labels) ||
    !labels.every((l) => typeof l === 'string' && l !== '' && l.length <= LABEL_NAME_MAX_CHARS)
  ) {
    throw new Error('Labels must be names of up to 50 characters.');
  }
  if (!Array.isArray(assignees) || !assignees.every((a) => typeof a === 'string' && OWNER_PATTERN.test(a))) {
    throw new Error('Assignees must be GitHub logins.');
  }
  if (
    milestoneNumber !== null &&
    (typeof milestoneNumber !== 'number' || !Number.isInteger(milestoneNumber) || milestoneNumber < 1)
  ) {
    throw new Error('A milestone must be a positive whole number, or none.');
  }
  return { labels, assignees, milestoneNumber };
}

/** True when both lists hold the same names, ignoring order. */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
}

function toLabel(raw: unknown): IssueLabel[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const label = raw as { name?: unknown; color?: unknown };
  if (typeof label.name !== 'string' || typeof label.color !== 'string') return [];
  return [{ name: label.name, color: label.color }];
}
