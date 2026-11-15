import type { AuthStatus } from './auth';
import type { AttachmentFile, AttachmentUploadResult } from './attachments';
import type { ConnectionStatus, RefreshStart } from './connection';
import type { InboxPage, InboxQuery } from './inbox';
import type {
  ItemMemberships,
  ProjectDetail,
  ProjectFieldChange,
  ProjectItem,
  ProjectItemEditResult,
  ProjectItemsPage,
  ProjectListPage
} from './projects';
import type { NotificationDelivery, NotificationOpenResult } from './notifications';
import type {
  CommentUpdateResult,
  IssueCloseReason,
  IssueComment,
  IssueContentInput,
  IssueDetail,
  IssueEditResult,
  IssueFieldsInput,
  IssueListPage,
  IssueListQuery,
  IssueRepoOptions,
  IssueSnapshot,
  IssueSummary,
  TaskToggleResult,
  PullListQuery,
  PullListPage,
  PullDetail,
  PullFilesPage,
  PullReviewThreadsPage,
  PullReviewState,
  ReviewAnchor,
  ReviewCommentResult,
  ReviewEvent,
  ReviewSubmitResult,
  MergeMethod,
  PullActions,
  PullCreateInput,
  PullMergeResult,
  PullSummary,
  PullWriteResult,
  RerunMode,
  WorkflowRun
} from './issues';

/**
 * Contract shared by main, preload, and renderer. Keep this file free of
 * Node and DOM APIs so every process can import it.
 */
export const IpcChannels = {
  appGetInfo: 'app:get-info',
  appOpenExternal: 'app:open-external',
  authGetStatus: 'auth:get-status',
  authStartSignIn: 'auth:start-sign-in',
  authCancelSignIn: 'auth:cancel-sign-in',
  authSignOut: 'auth:sign-out',
  /** Main-to-renderer push. Payload is an AuthStatus. */
  authStatusChanged: 'auth:status-changed',
  reposList: 'repos:list',
  reposRefresh: 'repos:refresh',
  issuesList: 'issues:list',
  issuesDetail: 'issues:detail',
  issuesCreate: 'issues:create',
  issuesUpdate: 'issues:update',
  issuesUpdateFields: 'issues:update-fields',
  issuesSetState: 'issues:set-state',
  issuesRepoOptions: 'issues:repo-options',
  issuesSetTask: 'issues:set-task',
  pullsDetail: 'pulls:detail',
  pullsList: 'pulls:list',
  pullsFiles: 'pulls:files',
  pullsThreads: 'pulls:threads',
  pullsReviewState: 'pulls:review-state',
  pullsReviewComment: 'pulls:review-comment',
  pullsReviewReply: 'pulls:review-reply',
  pullsReviewResolve: 'pulls:review-resolve',
  pullsReviewSubmit: 'pulls:review-submit',
  pullsActions: 'pulls:actions',
  pullsMerge: 'pulls:merge',
  pullsAutoMerge: 'pulls:auto-merge',
  pullsDraft: 'pulls:draft',
  pullsRuns: 'pulls:runs',
  pullsRerun: 'pulls:rerun',
  pullsCreate: 'pulls:create',
  inboxList: 'inbox:list',
  projectsList: 'projects:list',
  projectsDetail: 'projects:detail',
  projectsItems: 'projects:items',
  projectsItemMemberships: 'projects:item-memberships',
  projectsAddItem: 'projects:add-item',
  projectsRemoveItem: 'projects:remove-item',
  projectsSetField: 'projects:set-field',
  pullsBranches: 'pulls:branches',
  markdownPreview: 'markdown:preview',
  commentsCreate: 'comments:create',
  commentsUpdate: 'comments:update',
  commentsDelete: 'comments:delete',
  attachmentsUpload: 'attachments:upload',
  refreshWake: 'refresh:wake',
  refreshGetStatus: 'refresh:get-status',
  /** Main-to-renderer push. Payload is a ConnectionStatus. */
  refreshStatusChanged: 'refresh:status-changed',
  notificationsOpen: 'notifications:open',
  /** Main-to-renderer push. Payload is a NotificationDelivery for in-app toasts. */
  notificationsDelivered: 'notifications:delivered',
  /** Main-to-renderer push. Payload is a NotificationOpenResult from a desktop notification click. */
  notificationsNavigate: 'notifications:navigate',
  diagnosticsGetReport: 'diagnostics:get-report',
  diagnosticsRecord: 'diagnostics:record',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update'
} as const;

export interface PersonalRepo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  defaultBranch: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
  detailsWidth?: number;
}

export interface OrbitSettings {
  pinnedRepoIds: number[];
  customViews: Array<{
    id: string;
    name: string;
    projectId: string;
    layout: 'kanban' | 'gantt' | 'calendar' | 'table';
  }>;
  theme: 'light' | 'dark';
  windowState: WindowState | null;
  /** The user has accepted that uploads to public repos are public as soon as they upload. */
  publicUploadNoticeAcknowledged: boolean;
}

export type SettingsUpdate = Partial<Pick<OrbitSettings, 'pinnedRepoIds' | 'customViews' | 'theme'>> & {
  detailsWidth?: number;
};

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface OpenExternalResult {
  opened: boolean;
}

/** The typed surface the preload exposes as `window.orbit`. */
export interface OrbitApi {
  app: {
    getInfo(): Promise<AppInfo>;
    openExternal(url: string): Promise<OpenExternalResult>;
  };
  auth: {
    getStatus(): Promise<AuthStatus>;
    startSignIn(): Promise<AuthStatus>;
    cancelSignIn(): Promise<AuthStatus>;
    signOut(): Promise<AuthStatus>;
    /** Subscribes to status changes. Returns an unsubscribe function. */
    onStatusChanged(listener: (status: AuthStatus) => void): () => void;
  };
  notifications: {
    /** Marks the thread read and returns the item it leads to. Failure to mark read is reported, not thrown. */
    open(threadId: string): Promise<NotificationOpenResult>;
    /** Subscribes to new notification deliveries. Returns an unsubscribe function. */
    onDelivered(listener: (delivery: NotificationDelivery) => void): () => void;
    /** Subscribes to navigation requested by a desktop notification. Returns an unsubscribe function. */
    onNavigate(listener: (result: NotificationOpenResult) => void): () => void;
  };
  refresh: {
    getStatus(): Promise<ConnectionStatus>;
    /** Immediate retry after a suspected outage. Honours rate limits and sign-out. */
    wake(): Promise<RefreshStart>;
    /** Subscribes to status changes. Returns an unsubscribe function. */
    onStatusChanged(listener: (status: ConnectionStatus) => void): () => void;
  };
  repos: {
    list(): Promise<PersonalRepo[]>;
    /** Asks main to refresh now, subject to cooldowns and rate limits. */
    refresh(): Promise<RefreshStart>;
  };
  issues: {
    list(query: IssueListQuery): Promise<IssueListPage>;
    detail(repoFullName: string, number: number): Promise<IssueDetail>;
    /** Opens a new issue in one of the user's personal repos. */
    create(repoFullName: string, input: IssueContentInput): Promise<IssueSnapshot>;
    /** `base` is the title and body the edit started from. A difference on GitHub comes back as a conflict. */
    update(
      repoFullName: string,
      number: number,
      input: IssueContentInput,
      base: IssueContentInput
    ): Promise<IssueEditResult>;
    /** Replaces labels, assignees, and milestone. Resolves with GitHub's version of the issue. */
    updateFields(repoFullName: string, number: number, fields: IssueFieldsInput): Promise<IssueSummary>;
    setState(
      repoFullName: string,
      number: number,
      state: 'open' | 'closed',
      reason?: IssueCloseReason
    ): Promise<IssueSummary>;
    repoOptions(repoFullName: string): Promise<IssueRepoOptions>;
    /** Ticks one task checkbox, only if the body is still `expectedBody`. */
    setTask(
      repoFullName: string,
      number: number,
      input: { index: number; checked: boolean; expectedBody: string }
    ): Promise<TaskToggleResult>;
  };
  pulls: {
    list(query: PullListQuery): Promise<PullListPage>;
    detail(repoFullName: string, number: number): Promise<PullDetail>;
    /** Changed files with their diffs. */
    files(repoFullName: string, number: number): Promise<PullFilesPage>;
    /** Review threads with resolved and outdated state. */
    threads(repoFullName: string, number: number): Promise<PullReviewThreadsPage>;
    /** The user's pending review and the pull request's head. */
    reviewState(repoFullName: string, number: number): Promise<PullReviewState>;
    /** Saves a comment on a diff line into the pending review. `reviewedHeadSha` is the head the user reviewed. */
    addReviewComment(
      repoFullName: string,
      number: number,
      input: { anchor: ReviewAnchor; body: string; reviewedHeadSha: string }
    ): Promise<ReviewCommentResult>;
    replyToReviewThread(
      repoFullName: string,
      number: number,
      input: { threadId: string; body: string; reviewedHeadSha: string }
    ): Promise<ReviewCommentResult>;
    setReviewThreadResolved(
      repoFullName: string,
      number: number,
      threadId: string,
      resolved: boolean
    ): Promise<boolean>;
    submitReview(
      repoFullName: string,
      number: number,
      input: { event: ReviewEvent; body: string; reviewedHeadSha: string }
    ): Promise<ReviewSubmitResult>;
    /** Merge settings, draft and auto-merge state for the actions panel. */
    actions(repoFullName: string, number: number): Promise<PullActions>;
    /** Merges with a method the repo allows, only if the head is still `expectedHeadSha`. */
    merge(
      repoFullName: string,
      number: number,
      input: { method: MergeMethod; deleteBranch: boolean; expectedHeadSha: string }
    ): Promise<PullMergeResult>;
    setAutoMerge(
      repoFullName: string,
      number: number,
      input: { enabled: boolean; method?: MergeMethod; expectedHeadSha: string }
    ): Promise<PullWriteResult>;
    /** Pinned to the head the user reviewed; a head that has moved comes back as new commits. */
    setDraft(
      repoFullName: string,
      number: number,
      draft: boolean,
      expectedHeadSha: string
    ): Promise<PullWriteResult>;
    /** Workflow runs for the pull request's head commit. */
    runs(repoFullName: string, number: number): Promise<WorkflowRun[]>;
    /** Re-runs a workflow run: all of it, or only its failed jobs. */
    /** Only re-runs a run that still belongs to `expectedHeadSha`; otherwise it comes back as new commits. */
    rerun(
      repoFullName: string,
      runId: number,
      mode: RerunMode,
      expectedHeadSha: string
    ): Promise<PullWriteResult>;
    /** Opens a pull request from a branch in one of the user's personal repos. */
    create(repoFullName: string, input: PullCreateInput): Promise<PullSummary>;
    branches(repoFullName: string): Promise<string[]>;
  };
  inbox: {
    /** One fixed inbox tab across the signed-in account's personal repos. */
    list(query: InboxQuery): Promise<InboxPage>;
  };
  projects: {
    /** Projects the signed-in account owns. */
    list(): Promise<ProjectListPage>;
    /** Custom fields and table and board saved views of one project. */
    detail(projectId: string): Promise<ProjectDetail>;
    /** Items matching a saved view's filter. An empty filter returns every item. */
    items(projectId: string, filter: string): Promise<ProjectItemsPage>;
    /** The projects one issue or pull request is in, and its node id. */
    itemMemberships(repoFullName: string, number: number): Promise<ItemMemberships>;
    /** Adds an issue or pull request from one of the user's personal repos to a project. */
    addItem(projectId: string, repoFullName: string, number: number): Promise<ProjectItem>;
    removeItem(projectId: string, itemId: string): Promise<void>;
    /** Sets or clears one field. Resolves with GitHub's version of the item. */
    setField(projectId: string, itemId: string, change: ProjectFieldChange): Promise<ProjectItemEditResult>;
  };
  markdown: {
    /** Renders Markdown with GitHub's rules for the repo. Main sends the text; HTML comes back sanitized by the renderer. */
    preview(repoFullName: string, text: string): Promise<string>;
  };
  comments: {
    create(repoFullName: string, number: number, body: string): Promise<IssueComment>;
    /** `baseUpdatedAt` is the comment version the edit started from; a newer one comes back as a conflict. */
    update(
      repoFullName: string,
      commentId: number,
      body: string,
      baseUpdatedAt: string
    ): Promise<CommentUpdateResult>;
    delete(repoFullName: string, commentId: number): Promise<void>;
  };
  attachments: {
    /**
     * Uploads a file for a comment or issue body in a personal repo. Main holds the token and makes the request.
     * Resolves 'public-notice' for a public repo until the user acknowledges the upload is public at once.
     */
    upload(
      repoFullName: string,
      file: AttachmentFile,
      options: { acknowledgedPublic: boolean }
    ): Promise<AttachmentUploadResult>;
  };
  diagnostics: {
    /** Records a renderer failure by scope and short code only. Never message text. */
    record(entry: { scope: string; code: string }): Promise<void>;
    /** Redacted, in-memory diagnostics text for the user to copy. Never uploaded. */
    getReport(): Promise<string>;
  };
  settings: {
    get(): Promise<OrbitSettings>;
    update(update: SettingsUpdate): Promise<OrbitSettings>;
  };
}

/** Schemes that may leave the app through the system browser or mail client. */
export const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/**
 * Validates an external URL before it leaves the app. Only absolute http(s) and
 * mailto URLs without embedded credentials are allowed.
 */
export function parseExternalUrl(input: unknown): URL | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
  if (url.username !== '' || url.password !== '') return null;
  return url;
}
