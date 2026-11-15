import { COMMENT_MAX_CHARS, ISSUE_BODY_MAX_CHARS, ISSUE_TITLE_MAX_CHARS } from '../../shared/issues';
import type {
  PendingReview,
  PendingReviewComment,
  PullReviewState,
  ReviewAnchor,
  ReviewCommentResult,
  ReviewEvent,
  ReviewSubmitResult
} from '../../shared/issues';
import { anchorInPatch } from './review-anchor';
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
  TaskToggleResult,
  PullListQuery,
  PullListPage,
  PullSummary,
  PullDetail,
  PullReview,
  PullCheck,
  PullFile,
  PullFileNoPatchReason,
  PullFileStatus,
  PullFilesPage,
  PullReviewComment,
  PullReviewThread,
  PullReviewThreadsPage
} from '../../shared/issues';
import type { AuthService } from './auth-service';
import { GitHubClient, GitHubRequestError } from './github-client';
import { setTaskItemChecked } from './task-list';
import { runWrite, WriteBlockedError, type ReconcileResult } from './write-reconcile';

/** Page size requested from GitHub. A full page means another page may exist. */
export const ISSUES_PER_PAGE = 30;
const PULLS_PER_PAGE = 100;
const PULL_LIST_PAGE_LIMIT = 10;
const COMMENTS_PER_PAGE = 100;
/** Upper bound on comment pages read for one issue (1,000 comments). */
const COMMENT_PAGE_LIMIT = 10;
const HTML_ACCEPT = 'application/vnd.github.html+json';
const STATES: readonly IssueStateFilter[] = ['open', 'closed', 'all'];
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const TEXT_FILTER_MAX = 100;
const PULL_FILES_PER_PAGE = 100;
/** Upper bound on file pages (3,000 files), the most GitHub lists for one pull request. */
const PULL_FILES_PAGE_LIMIT = 30;
const REVIEW_THREADS_QUERY = `query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        totalCount
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 100) {
            totalCount
            nodes {
              fullDatabaseId
              author { login }
              body
              bodyHTML
              createdAt
              url
              diffHunk
            }
          }
        }
      }
    }
  }
}`;

const REVIEW_STATE_QUERY = `query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      headRefOid
      author { login }
      reviews(first: 5, states: [PENDING]) {
        nodes {
          id
          commit { oid }
        }
      }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          diffSide
          comments(first: 100) {
            nodes { fullDatabaseId path line body state }
          }
        }
      }
    }
  }
}`;
const RECENT_REVIEWS_QUERY = `query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(last: 10) {
        nodes { id state body author { login } }
      }
    }
  }
}`;
const ADD_REVIEW = `mutation ($input: AddPullRequestReviewInput!) {
  addPullRequestReview(input: $input) { pullRequestReview { id commit { oid } } }
}`;
const ADD_REVIEW_THREAD = `mutation ($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) {
    thread { id diffSide comments(first: 1) { nodes { fullDatabaseId path line body } } }
  }
}`;
const ADD_REVIEW_THREAD_REPLY = `mutation ($input: AddPullRequestReviewThreadReplyInput!) {
  addPullRequestReviewThreadReply(input: $input) { comment { fullDatabaseId path line body } }
}`;
const RESOLVE_THREAD = `mutation ($input: ResolveReviewThreadInput!) {
  resolveReviewThread(input: $input) { thread { id isResolved } }
}`;
const UNRESOLVE_THREAD = `mutation ($input: UnresolveReviewThreadInput!) {
  unresolveReviewThread(input: $input) { thread { id isResolved } }
}`;
const SUBMIT_REVIEW = `mutation ($input: SubmitPullRequestReviewInput!) {
  submitPullRequestReview(input: $input) { pullRequestReview { id state } }
}`;
const THREAD_SIDE_QUERY = `query ($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { diffSide } } }`;
const THREAD_STATE_QUERY = `query ($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { isResolved } } }`;
const REVIEW_STATE_NODE_QUERY = `query ($id: ID!) { node(id: $id) { ... on PullRequestReview { state } } }`;
const REVIEW_EVENTS: readonly ReviewEvent[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'];

/** A pull request's head, author, and the user's pending review, as one read. */
/** What a submit attempt has learned, kept while its outcome is unknown. */
interface SubmitState {
  /** Reviews the user had before the first attempt. */
  baselineIds: ReadonlySet<string>;
  /** The pending review the submit was sent for, when there was one. */
  pendingId: string | null;
}

interface ReviewPullRequest {
  /** GitHub's node id, needed to start a review. */
  id: string;
  headSha: string;
  authorLogin: string;
  pending: PendingReview | null;
}

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
  /** Writes whose last attempt ended in an unknown outcome, keyed by what they do. */
  private readonly uncertain = new Map<string, unknown>();

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

  async listPulls(query: PullListQuery): Promise<PullListPage> {
    const { owner, repo } = this.validateRepo(query.repoFullName);
    const page = validatePage(query.page);
    const state = validateState(query.state);
    const label = query.label === undefined ? undefined : validateText(query.label, 'label');
    const author = query.author === undefined ? undefined : validateText(query.author, 'author');
    const { token, scope } = await this.session();
    const matches: PullSummary[] = [];
    let partial = false;
    let exhausted = false;
    for (let sourcePage = 1; sourcePage <= PULL_LIST_PAGE_LIMIT; sourcePage++) {
      const params = new URLSearchParams({
        state,
        per_page: String(PULLS_PER_PAGE),
        page: String(sourcePage)
      });
      const body = await this.client.get<unknown>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${params}`,
        { token, scope }
      );
      if (!Array.isArray(body)) throw new Error('GitHub returned an invalid pull request list.');
      for (const raw of body as unknown[]) {
        const item = toPullSummary(raw);
        if (!item) {
          partial = true;
          continue;
        }
        if (label && !item.labels.some((candidate) => candidate.name.toLowerCase() === label.toLowerCase()))
          continue;
        if (author && item.authorLogin.toLowerCase() !== author.toLowerCase()) continue;
        matches.push(item);
      }
      if (body.length < PULLS_PER_PAGE) {
        exhausted = true;
        break;
      }
      if (sourcePage === PULL_LIST_PAGE_LIMIT) partial = true;
      if (matches.length >= page * ISSUES_PER_PAGE + 1) break;
    }
    if (!exhausted && matches.length < page * ISSUES_PER_PAGE + 1) partial = true;
    const start = (page - 1) * ISSUES_PER_PAGE;
    return {
      items: matches.slice(start, start + ISSUES_PER_PAGE),
      page,
      hasNextPage: matches.length > start + ISSUES_PER_PAGE,
      partial
    };
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
  async getPullDetail(repoFullName: string, number: number): Promise<PullDetail> {
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
    const pr = pullBody as {
      head?: { sha?: string };
      mergeable?: unknown;
      mergeable_state?: unknown;
      merged?: unknown;
    };
    const [reviewsRaw, runsRaw] = await Promise.all([
      this.client.get<unknown>(`${itemPath(owner, repo, 'pulls', number)}/reviews?per_page=100&page=1`, {
        token,
        scope
      }),
      this.client.get<unknown>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(String(pr.head?.sha ?? ''))}/check-runs?per_page=100`,
        { token, scope }
      )
    ]);
    const reviews: PullReview[] = Array.isArray(reviewsRaw)
      ? reviewsRaw.flatMap((raw: unknown) => {
          if (typeof raw !== 'object' || raw === null) return [];
          const r = raw as {
            id?: unknown;
            user?: { login?: unknown } | null;
            state?: unknown;
            submitted_at?: unknown;
            body?: unknown;
            html_url?: unknown;
          };
          return typeof r.id === 'number'
            ? [
                {
                  id: r.id,
                  authorLogin: typeof r.user?.login === 'string' ? r.user.login : 'unknown',
                  state: String(r.state ?? 'COMMENTED'),
                  submittedAt: typeof r.submitted_at === 'string' ? r.submitted_at : null,
                  body: typeof r.body === 'string' ? r.body : '',
                  htmlUrl: typeof r.html_url === 'string' ? r.html_url : ''
                }
              ]
            : [];
        })
      : [];
    const runs =
      (
        runsRaw as {
          check_runs?: Array<{ name?: unknown; status?: unknown; conclusion?: unknown; html_url?: unknown }>;
        } | null
      )?.check_runs ?? [];
    const checks: PullCheck[] = runs.flatMap((c) =>
      typeof c.name === 'string'
        ? [
            {
              name: c.name,
              status: String(c.status ?? 'queued'),
              conclusion: typeof c.conclusion === 'string' ? c.conclusion : null,
              detailsUrl: typeof c.html_url === 'string' ? c.html_url : null
            }
          ]
        : []
    );
    const checkRunTotal = (runsRaw as { total_count?: unknown } | null)?.total_count;
    return {
      summary: toPullSummary(pullBody) ?? { ...summary, draft: false, headRef: '', baseRef: '' },
      body: rawBody(pullBody),
      bodyHtml,
      comments,
      commentsPartial,
      reviews,
      reviewsPartial: !Array.isArray(reviewsRaw) || reviewsRaw.length >= 100,
      checks,
      checksPartial: typeof checkRunTotal === 'number' && checkRunTotal > checks.length,
      mergeable: typeof pr.mergeable === 'boolean' ? pr.mergeable : null,
      mergeableState: String(pr.mergeable_state ?? 'unknown'),
      merged: pr.merged === true
    };
  }

  /** Changed files of a pull request, each with its unified diff where GitHub returns one. */
  async getPullFiles(repoFullName: string, number: number): Promise<PullFilesPage> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    const { token, scope } = await this.session();
    const files: PullFile[] = [];
    let partial = false;
    for (let page = 1; page <= PULL_FILES_PAGE_LIMIT; page++) {
      const body = await this.client.get<unknown>(
        `${itemPath(owner, repo, 'pulls', number)}/files?per_page=${PULL_FILES_PER_PAGE}&page=${page}`,
        { token, scope }
      );
      if (!Array.isArray(body)) throw new Error('GitHub returned an invalid list of changed files.');
      for (const raw of body as unknown[]) {
        const file = toPullFile(raw);
        if (file) files.push(file);
        else partial = true;
      }
      if (body.length < PULL_FILES_PER_PAGE) return { files, partial };
    }
    return { files, partial: true };
  }

  /**
   * Review threads of a pull request, with resolved and outdated state, which only GraphQL reports.
   * One query reads up to 100 threads of up to 100 replies each; anything beyond is reported as partial.
   */
  async getPullReviewThreads(repoFullName: string, number: number): Promise<PullReviewThreadsPage> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    const { token, scope } = await this.session();
    // GraphQL is a read, but it is sent as a POST, so it goes through the write path.
    const response = await this.client.send<unknown>('POST', '/graphql', {
      token,
      scope,
      body: { query: REVIEW_THREADS_QUERY, variables: { owner, name: repo, number } }
    });
    const pullRequest = (response as { data?: { repository?: { pullRequest?: unknown } | null } } | null)
      ?.data?.repository?.pullRequest;
    const connection = (pullRequest as { reviewThreads?: unknown } | null | undefined)?.reviewThreads as
      { totalCount?: unknown; nodes?: unknown } | undefined;
    if (!connection || !Array.isArray(connection.nodes)) {
      throw new Error('GitHub returned invalid review threads.');
    }
    const threads = (connection.nodes as unknown[]).flatMap((raw) => toReviewThread(raw) ?? []);
    const invalid = (connection.nodes as unknown[]).length - threads.length;
    const total = typeof connection.totalCount === 'number' ? connection.totalCount : threads.length;
    return { threads, partial: invalid > 0 || total > connection.nodes.length };
  }

  /** The signed-in user's pending review and the pull request's head, read from GitHub. Nothing is stored locally. */
  async getPullReviewState(repoFullName: string, number: number): Promise<PullReviewState> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    const { token, scope } = await this.session();
    const login = this.signedInLogin();
    const pr = await this.readReviewPullRequest(owner, repo, number, token, scope);
    return {
      headSha: pr.headSha,
      isOwnPull: pr.authorLogin.toLowerCase() === login.toLowerCase(),
      pending: pr.pending
    };
  }

  /**
   * Saves a comment on a changed line into the user's pending review, starting the review if there is none.
   * The line must be part of the diff. Nothing is written when the reviewed commit is no longer the head.
   */
  async addReviewComment(
    repoFullName: string,
    number: number,
    input: { anchor: ReviewAnchor; body: string; reviewedHeadSha: string }
  ): Promise<ReviewCommentResult> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    const anchor = validateAnchor(input?.anchor);
    validateCommentBody(input?.body);
    validateSha(input?.reviewedHeadSha);
    this.assertCanWrite();
    const { token, scope } = await this.session();
    const pr = await this.readReviewPullRequest(owner, repo, number, token, scope);
    if (pr.headSha !== input.reviewedHeadSha) return { kind: 'new-commits', headSha: pr.headSha };

    const files = await this.getPullFiles(repoFullName, number);
    const file = files.files.find((candidate) => candidate.filename === anchor.path);
    if (!file || file.patch === null || !anchorInPatch(file.patch, anchor)) {
      throw new Error('That line is not part of the diff, so it cannot take a comment.');
    }
    const body = input.body;
    const key = ['comment', owner, repo, number, anchor.path, anchor.side, anchor.line, body].join('\u0000');
    return this.keyedWrite<ReviewCommentResult, { existingIds: ReadonlySet<number> }>(
      key,
      async () => ({ existingIds: new Set((pr.pending?.comments ?? []).map((c) => c.id)) }),
      ({ existingIds }) => ({
        attempt: async () => {
          const ensured = await this.ensurePendingReview(owner, repo, number, pr.headSha, token, scope);
          if ('headSha' in ensured) return { kind: 'new-commits', headSha: ensured.headSha };
          const data = await this.graphql<{
            addPullRequestReviewThread?: { thread?: { diffSide?: unknown; comments?: { nodes?: unknown } } };
          }>(
            ADD_REVIEW_THREAD,
            {
              input: {
                pullRequestId: pr.id,
                pullRequestReviewId: ensured.reviewId,
                path: anchor.path,
                line: anchor.line,
                side: anchor.side,
                body
              }
            },
            token,
            scope
          );
          const thread = data?.addPullRequestReviewThread?.thread;
          const nodes = Array.isArray(thread?.comments?.nodes) ? (thread.comments.nodes as unknown[]) : [];
          const comment =
            nodes.map((node) => toPendingComment(node, thread?.diffSide)).find((c) => c !== null) ??
            throwInvalid('GitHub returned an invalid review comment.');
          return { kind: 'saved', comment };
        },
        reconcile: async () => {
          const now = await this.readReviewPullRequest(owner, repo, number, token, scope);
          const match = now.pending?.comments.find(
            (c) =>
              !existingIds.has(c.id) &&
              c.path === anchor.path &&
              c.side === anchor.side &&
              c.line === anchor.line &&
              c.body === body
          );
          return match ? { applied: true, value: { kind: 'saved', comment: match } } : { applied: false };
        }
      })
    );
  }

  /** Replies to a review thread inside the user's pending review. Refused when the reviewed commit is no longer the head. */
  async replyToReviewThread(
    repoFullName: string,
    number: number,
    input: { threadId: string; body: string; reviewedHeadSha: string }
  ): Promise<ReviewCommentResult> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    validateNodeId(input?.threadId);
    validateCommentBody(input?.body);
    validateSha(input?.reviewedHeadSha);
    this.assertCanWrite();
    const { token, scope } = await this.session();
    const pr = await this.readReviewPullRequest(owner, repo, number, token, scope);
    if (pr.headSha !== input.reviewedHeadSha) return { kind: 'new-commits', headSha: pr.headSha };
    const { threadId, body } = input;

    const side = await this.threadSide(threadId, token, scope);
    const key = ['reply', owner, repo, number, threadId, body].join('\u0000');
    return this.keyedWrite<ReviewCommentResult, { existingIds: ReadonlySet<number> }>(
      key,
      async () => ({ existingIds: new Set((pr.pending?.comments ?? []).map((c) => c.id)) }),
      ({ existingIds }) => ({
        attempt: async () => {
          const ensured = await this.ensurePendingReview(owner, repo, number, pr.headSha, token, scope);
          if ('headSha' in ensured) return { kind: 'new-commits', headSha: ensured.headSha };
          const data = await this.graphql<{ addPullRequestReviewThreadReply?: { comment?: unknown } }>(
            ADD_REVIEW_THREAD_REPLY,
            { input: { pullRequestReviewId: ensured.reviewId, pullRequestReviewThreadId: threadId, body } },
            token,
            scope
          );
          const comment =
            toPendingComment(data?.addPullRequestReviewThreadReply?.comment, side) ??
            throwInvalid('GitHub returned an invalid reply.');
          return { kind: 'saved', comment };
        },
        reconcile: async () => {
          const now = await this.readReviewPullRequest(owner, repo, number, token, scope);
          const match = now.pending?.comments.find((c) => !existingIds.has(c.id) && c.body === body);
          return match ? { applied: true, value: { kind: 'saved', comment: match } } : { applied: false };
        }
      })
    );
  }

  /** Resolves or reopens a review thread. Resolves with the thread's state as GitHub now holds it. */
  async setReviewThreadResolved(
    repoFullName: string,
    number: number,
    threadId: string,
    resolved: boolean
  ): Promise<boolean> {
    this.validateRepo(repoFullName);
    validateItemNumber(number);
    validateNodeId(threadId);
    this.assertCanWrite();
    const { token, scope } = await this.session();
    return runWrite<boolean>({
      canWrite: this.canWrite,
      attempt: async () => {
        const data = await this.graphql<Record<string, { thread?: { isResolved?: unknown } } | undefined>>(
          resolved ? RESOLVE_THREAD : UNRESOLVE_THREAD,
          { input: { threadId } },
          token,
          scope
        );
        const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
        const isResolved = data?.[field]?.thread?.isResolved;
        if (typeof isResolved !== 'boolean') throw new Error('GitHub returned an invalid review thread.');
        return isResolved;
      },
      reconcile: async () => {
        const now = await this.readNode(threadId, THREAD_STATE_QUERY, token, scope);
        return now && now.isResolved === resolved ? { applied: true, value: resolved } : { applied: false };
      }
    });
  }

  /**
   * Submits the user's review as Comment, Approve, or Request changes. With no pending review, the review
   * is created with the event. The head is checked before each attempt, and nothing is sent when it has moved.
   */
  async submitReview(
    repoFullName: string,
    number: number,
    input: { event: ReviewEvent; body: string; reviewedHeadSha: string }
  ): Promise<ReviewSubmitResult> {
    const { owner, repo } = this.validateRepo(repoFullName);
    validateItemNumber(number);
    if (!REVIEW_EVENTS.includes(input?.event))
      throw new Error('Choose Comment, Approve, or Request changes.');
    const body = typeof input.body === 'string' ? input.body : '';
    if ([...body].length > COMMENT_MAX_CHARS) {
      throw new Error(`Reviews can be at most ${COMMENT_MAX_CHARS.toLocaleString('en-US')} characters.`);
    }
    validateSha(input.reviewedHeadSha);
    this.assertCanWrite();
    const { token, scope } = await this.session();
    const login = this.signedInLogin();
    const pr = await this.readReviewPullRequest(owner, repo, number, token, scope);
    if (input.event !== 'COMMENT' && pr.authorLogin.toLowerCase() === login.toLowerCase()) {
      throw new Error("You can't approve or request changes on your own pull request.");
    }
    if (pr.headSha !== input.reviewedHeadSha) return { kind: 'new-commits', headSha: pr.headSha };

    const key = ['submit', owner, repo, number, input.event, body].join('\u0000');
    return this.keyedWrite<ReviewSubmitResult, SubmitState>(
      key,
      async () => ({
        baselineIds: new Set(
          (await this.readRecentOwnReviews(owner, repo, number, token, scope, login)).map((r) => r.id)
        ),
        pendingId: null
      }),
      (state) => ({
        attempt: async () => {
          const current = await this.readReviewPullRequest(owner, repo, number, token, scope);
          if (current.headSha !== input.reviewedHeadSha)
            return { kind: 'new-commits', headSha: current.headSha };
          if (current.pending) {
            state.pendingId = current.pending.id;
            await this.graphql(
              SUBMIT_REVIEW,
              { input: { pullRequestReviewId: state.pendingId, event: input.event, body } },
              token,
              scope
            );
          } else {
            await this.graphql(
              ADD_REVIEW,
              { input: { pullRequestId: current.id, commitOID: current.headSha, event: input.event, body } },
              token,
              scope
            );
          }
          return { kind: 'submitted' };
        },
        reconcile: async () => {
          if (state.pendingId !== null) {
            const node = await this.readNode(state.pendingId, REVIEW_STATE_NODE_QUERY, token, scope);
            return node && node.state !== 'PENDING'
              ? { applied: true, value: { kind: 'submitted' } }
              : { applied: false };
          }
          // A review created by the failed request is one the user did not have before the first attempt.
          const now = await this.readRecentOwnReviews(owner, repo, number, token, scope, login);
          return now.some((r) => !state.baselineIds.has(r.id) && r.body === body && r.state !== 'PENDING')
            ? { applied: true, value: { kind: 'submitted' } }
            : { applied: false };
        }
      })
    );
  }

  /** A pull request's head and author, plus the user's pending review, in one read. */
  private async readReviewPullRequest(
    owner: string,
    repo: string,
    number: number,
    token: string,
    scope: string
  ): Promise<ReviewPullRequest> {
    const data = await this.graphql<{ repository?: { pullRequest?: unknown } | null }>(
      REVIEW_STATE_QUERY,
      { owner, name: repo, number },
      token,
      scope
    );
    const pr = data?.repository?.pullRequest as
      | {
          id?: unknown;
          headRefOid?: unknown;
          author?: { login?: unknown } | null;
          reviews?: { nodes?: unknown };
          reviewThreads?: unknown;
        }
      | null
      | undefined;
    if (!pr || typeof pr.id !== 'string' || typeof pr.headRefOid !== 'string') {
      throw new Error('GitHub returned an invalid pull request.');
    }
    const nodes = Array.isArray(pr.reviews?.nodes) ? (pr.reviews.nodes as unknown[]) : [];
    const first = nodes[0] as { id?: unknown; commit?: { oid?: unknown } } | undefined;
    const threads = pr.reviewThreads as { totalCount?: unknown; nodes?: unknown } | undefined;
    const threadNodes = Array.isArray(threads?.nodes) ? (threads.nodes as unknown[]) : [];
    const pendingComments = threadNodes.flatMap((thread) => pendingCommentsOf(thread));
    const threadsPartial = typeof threads?.totalCount === 'number' && threads.totalCount > threadNodes.length;
    return {
      id: pr.id,
      headSha: pr.headRefOid,
      authorLogin: typeof pr.author?.login === 'string' ? pr.author.login : '',
      pending: first ? toPendingReview(first, pendingComments, threadsPartial) : null
    };
  }

  /**
   * Runs a write keyed by what it does. When an earlier attempt of the same write ended in an uncertain
   * outcome, its state is kept, and the next call reconciles against GitHub before any new attempt, so the
   * write is never repeated because a response was lost.
   */
  private async keyedWrite<T, S>(
    key: string,
    snapshot: () => Promise<S>,
    build: (state: S) => { attempt: () => Promise<T>; reconcile: () => Promise<ReconcileResult<T>> }
  ): Promise<T> {
    const retrying = this.uncertain.has(key);
    const state = retrying ? (this.uncertain.get(key) as S) : await snapshot();
    this.uncertain.set(key, state);
    const ops = build(state);
    // Set when GitHub definitively refused an attempt, so no write landed and the baseline can go.
    let rejected = false;
    const attempt = async (): Promise<T> => {
      try {
        return await ops.attempt();
      } catch (error) {
        // Only an explicit refusal (HTTP error or rate limit) proves nothing was written. Anything else, such as a
        // response that cannot be read after a landed write, leaves the outcome unknown.
        if (error instanceof GitHubRequestError && (error.kind === 'http' || error.kind === 'rate-limited')) {
          rejected = true;
        }
        throw error;
      }
    };
    try {
      if (retrying) {
        const done = await ops.reconcile();
        if (done.applied) {
          this.uncertain.delete(key);
          return done.value;
        }
      }
      const value = await runWrite<T>({ canWrite: this.canWrite, attempt, reconcile: ops.reconcile });
      this.uncertain.delete(key);
      return value;
    } catch (error) {
      // Keep the baseline unless the write was definitely not sent. A failed reconcile read leaves the outcome
      // unknown, so the baseline stays and the next call reconciles again instead of writing a second copy.
      if (rejected || error instanceof WriteBlockedError) this.uncertain.delete(key);
      throw error;
    }
  }

  /**
   * The id of the user's pending review, starting one on `expectedHead` when none exists. Reads fresh state
   * each time, so a head that has moved since the caller's check is reported instead of written against.
   */
  private async ensurePendingReview(
    owner: string,
    repo: string,
    number: number,
    expectedHead: string,
    token: string,
    scope: string
  ): Promise<{ reviewId: string } | { headSha: string }> {
    const current = await this.readReviewPullRequest(owner, repo, number, token, scope);
    if (current.headSha !== expectedHead) return { headSha: current.headSha };
    if (current.pending) return { reviewId: current.pending.id };
    const data = await this.graphql<{ addPullRequestReview?: { pullRequestReview?: { id?: unknown } } }>(
      ADD_REVIEW,
      { input: { pullRequestId: current.id, commitOID: expectedHead } },
      token,
      scope
    );
    const id = data?.addPullRequestReview?.pullRequestReview?.id;
    if (typeof id !== 'string') throw new Error('GitHub returned an invalid review.');
    // The head may have moved while the review was being created. The caller must not write against it.
    const after = await this.readReviewPullRequest(owner, repo, number, token, scope);
    if (after.headSha !== expectedHead) return { headSha: after.headSha };
    return { reviewId: id };
  }

  /** The user's most recent reviews on a pull request, for finding a review whose request had an uncertain outcome. */
  private async readRecentOwnReviews(
    owner: string,
    repo: string,
    number: number,
    token: string,
    scope: string,
    login: string
  ): Promise<Array<{ id: string; body: string; state: string }>> {
    const data = await this.graphql<{
      repository?: { pullRequest?: { reviews?: { nodes?: unknown } } | null } | null;
    }>(RECENT_REVIEWS_QUERY, { owner, name: repo, number }, token, scope);
    const nodes = data?.repository?.pullRequest?.reviews?.nodes;
    if (!Array.isArray(nodes)) return [];
    return (
      nodes as Array<{ id?: unknown; body?: unknown; state?: unknown; author?: { login?: unknown } | null }>
    )
      .filter(
        (node) =>
          typeof node.author?.login === 'string' &&
          node.author.login.toLowerCase() === login.toLowerCase() &&
          typeof node.body === 'string' &&
          typeof node.id === 'string'
      )
      .map((node) => ({ id: node.id as string, body: node.body as string, state: String(node.state ?? '') }));
  }

  /** The side of the diff a review thread sits on. Replies inherit it. */
  private async threadSide(threadId: string, token: string, scope: string): Promise<'LEFT' | 'RIGHT'> {
    const node = await this.readNode(threadId, THREAD_SIDE_QUERY, token, scope);
    const side = node?.diffSide;
    if (side !== 'LEFT' && side !== 'RIGHT')
      throw new Error('That review thread is not on this pull request.');
    return side;
  }

  /** A GraphQL node's fields, or null when GitHub no longer has the node. */
  private async readNode(
    id: string,
    query: string,
    token: string,
    scope: string
  ): Promise<Record<string, unknown> | null> {
    const data = await this.graphql<{ node?: Record<string, unknown> | null }>(query, { id }, token, scope);
    return data?.node ?? null;
  }

  /** GraphQL sends errors in a 200 response; any error means the request was refused, not retried. */
  private async graphql<T = unknown>(
    query: string,
    variables: Record<string, unknown>,
    token: string,
    scope: string
  ): Promise<T> {
    const response = await this.client.send<{ data?: T; errors?: unknown } | null>('POST', '/graphql', {
      token,
      scope,
      body: { query, variables }
    });
    if (Array.isArray(response?.errors) && response.errors.length > 0) {
      throw new Error('GitHub refused the review request.');
    }
    return (response?.data ?? {}) as T;
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

const PULL_FILE_STATUSES: readonly PullFileStatus[] = [
  'added',
  'removed',
  'modified',
  'renamed',
  'copied',
  'changed',
  'unchanged'
];

function toPullFile(raw: unknown): PullFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const file = raw as {
    filename?: unknown;
    previous_filename?: unknown;
    status?: unknown;
    additions?: unknown;
    deletions?: unknown;
    changes?: unknown;
    patch?: unknown;
  };
  if (
    typeof file.filename !== 'string' ||
    typeof file.status !== 'string' ||
    !PULL_FILE_STATUSES.includes(file.status as PullFileStatus) ||
    typeof file.additions !== 'number' ||
    typeof file.deletions !== 'number' ||
    typeof file.changes !== 'number'
  ) {
    return null;
  }
  const patch = typeof file.patch === 'string' ? file.patch : null;
  // GitHub omits the patch for binary files, which have no changed lines, and for diffs it will not return.
  const noPatchReason: PullFileNoPatchReason | null =
    patch !== null ? null : file.changes === 0 ? 'binary' : 'too-large';
  return {
    filename: file.filename,
    previousFilename: typeof file.previous_filename === 'string' ? file.previous_filename : null,
    status: file.status as PullFileStatus,
    additions: file.additions,
    deletions: file.deletions,
    patch,
    noPatchReason
  };
}

interface GraphQLReviewComment {
  fullDatabaseId?: unknown;
  author?: { login?: unknown } | null;
  body?: unknown;
  bodyHTML?: unknown;
  createdAt?: unknown;
  url?: unknown;
  diffHunk?: unknown;
}

function toReviewThread(raw: unknown): PullReviewThread | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const thread = raw as {
    id?: unknown;
    isResolved?: unknown;
    isOutdated?: unknown;
    path?: unknown;
    line?: unknown;
    originalLine?: unknown;
    comments?: { totalCount?: unknown; nodes?: unknown };
  };
  if (
    typeof thread.id !== 'string' ||
    typeof thread.path !== 'string' ||
    !Array.isArray(thread.comments?.nodes)
  ) {
    return null;
  }
  const nodes = thread.comments.nodes as GraphQLReviewComment[];
  const comments: PullReviewComment[] = nodes.flatMap((node) => {
    const id = databaseIdOf(node.fullDatabaseId);
    if (id === null || typeof node.createdAt !== 'string' || typeof node.url !== 'string') {
      return [];
    }
    return [
      {
        id,
        authorLogin: typeof node.author?.login === 'string' ? node.author.login : 'ghost',
        createdAt: node.createdAt,
        htmlUrl: node.url,
        body: typeof node.body === 'string' ? node.body : '',
        bodyHtml: typeof node.bodyHTML === 'string' ? node.bodyHTML : ''
      }
    ];
  });
  const totalComments =
    typeof thread.comments.totalCount === 'number' ? thread.comments.totalCount : nodes.length;
  return {
    id: thread.id,
    path: thread.path,
    line: typeof thread.line === 'number' ? thread.line : null,
    originalLine: typeof thread.originalLine === 'number' ? thread.originalLine : null,
    isResolved: thread.isResolved === true,
    isOutdated: thread.isOutdated === true,
    diffHunk: typeof nodes[0]?.diffHunk === 'string' ? nodes[0].diffHunk : '',
    comments,
    commentsPartial: totalComments > nodes.length || comments.length < nodes.length
  };
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

function toPullSummary(raw: unknown): PullSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const pullRaw = raw as Record<string, unknown>;
  const summary = toSummary({
    ...pullRaw,
    comments: typeof pullRaw.comments === 'number' ? pullRaw.comments : 0
  });
  if (!summary) return null;
  const pull = raw as { draft?: unknown; head?: { ref?: unknown }; base?: { ref?: unknown } };
  return {
    ...summary,
    draft: pull.draft === true,
    headRef: typeof pull.head?.ref === 'string' ? pull.head.ref : '',
    baseRef: typeof pull.base?.ref === 'string' ? pull.base.ref : ''
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

function validateSha(sha: unknown): void {
  if (typeof sha !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(sha))
    throw new Error('The reviewed commit is missing.');
}

function validateNodeId(id: unknown): void {
  if (typeof id !== 'string' || id.length === 0 || id.length > 200)
    throw new Error('That review thread is invalid.');
}

function validateAnchor(input: unknown): ReviewAnchor {
  const anchor = input as Partial<ReviewAnchor> | null | undefined;
  if (typeof anchor?.path !== 'string' || anchor.path.length === 0 || anchor.path.length > 1024) {
    throw new Error('Choose a line in a changed file.');
  }
  if (anchor.side !== 'LEFT' && anchor.side !== 'RIGHT')
    throw new Error('Choose the old or new side of the diff.');
  if (typeof anchor.line !== 'number' || !Number.isInteger(anchor.line) || anchor.line < 1) {
    throw new Error('Choose a line in a changed file.');
  }
  return { path: anchor.path, side: anchor.side, line: anchor.line };
}

/** GitHub's BigInt database ids arrive as strings in JSON. Anything that is not a positive safe integer is rejected. */
function databaseIdOf(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A pending comment. The side belongs to its thread, not to the comment, so the thread's side is passed in. */
function toPendingComment(raw: unknown, side: unknown): PendingReviewComment | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const node = raw as { fullDatabaseId?: unknown; path?: unknown; line?: unknown; body?: unknown };
  const id = databaseIdOf(node.fullDatabaseId);
  if (id === null || typeof node.path !== 'string') return null;
  if (side !== 'LEFT' && side !== 'RIGHT') return null;
  return {
    id,
    path: node.path,
    side,
    line: typeof node.line === 'number' ? node.line : null,
    body: typeof node.body === 'string' ? node.body : ''
  };
}

/** The viewer's pending comments in one thread. Only the viewer can see their own pending comments. */
function pendingCommentsOf(thread: unknown): PendingReviewComment[] {
  const t = thread as { diffSide?: unknown; comments?: { nodes?: unknown } } | null;
  if (typeof t !== 'object' || t === null || !Array.isArray(t.comments?.nodes)) return [];
  return (t.comments.nodes as Array<{ state?: unknown }>).flatMap((node) =>
    node?.state === 'PENDING' ? (toPendingComment(node, t.diffSide) ?? []) : []
  );
}

function toPendingReview(
  raw: { id?: unknown; commit?: { oid?: unknown } },
  comments: PendingReviewComment[],
  commentsPartial: boolean
): PendingReview | null {
  if (typeof raw.id !== 'string' || typeof raw.commit?.oid !== 'string') return null;
  return { id: raw.id, commitSha: raw.commit.oid, comments, commentsPartial };
}
