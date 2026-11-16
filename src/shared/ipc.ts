import type { AuthStatus } from './auth';
import type { AttachmentFile, AttachmentUploadResult } from './attachments';
import type { ConnectionStatus, RefreshStart } from './connection';
import type { InboxPage, InboxQuery } from './inbox';
import type { WorkflowGraphJob, WorkflowJob } from './issues';
import type {
  ColorScheme,
  CustomTheme,
  PaletteId,
  ThemeImportDraft,
  ThemeImportRef,
  ThemeSearchRequest,
  ThemeSearchResult
} from './themes';
import type {
  ItemMemberships,
  ProjectDetail,
  ProjectFieldChange,
  ProjectItem,
  ProjectItemEditResult,
  ProjectItemsPage,
  ProjectListPage
} from './projects';
import type { CustomViewDefinition } from './custom-views';
import type { NotificationDelivery, NotificationOpenResult } from './notifications';
import type { UpdateStatus } from './updates';
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
  shellControl: 'shell:control',
  shellGetState: 'shell:get-state',
  /** Main-to-renderer push. Payload is a ShellState. */
  shellStateChanged: 'shell:state-changed',
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
  actionsJobs: 'actions:jobs',
  actionsJobLogs: 'actions:job-logs',
  actionsCancelRun: 'actions:cancel-run',
  actionsWorkflowGraph: 'actions:workflow-graph',
  pullsCreate: 'pulls:create',
  inboxList: 'inbox:list',
  projectsList: 'projects:list',
  projectsDetail: 'projects:detail',
  projectsItems: 'projects:items',
  projectsItemMemberships: 'projects:item-memberships',
  projectsAddItem: 'projects:add-item',
  projectsRemoveItem: 'projects:remove-item',
  projectsMoveItem: 'projects:move-item',
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
  updatesGetStatus: 'updates:get-status',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  updatesDownload: 'updates:download',
  themesSearch: 'themes:search',
  themesImport: 'themes:import',
  /** Main-to-renderer push. Payload is an UpdateStatus. */
  updatesStatusChanged: 'updates:status-changed',
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
  /** Definitions of Orbit's custom views. Never item data. */
  customViews: CustomViewDefinition[];
  colorScheme: ColorScheme;
  /** The named palette: each has a light and a dark variant. */
  palette: PaletteId;
  /** Themes the person made. Only colours and names, never item data. */
  customThemes: CustomTheme[];
  /** Where an issue or pull request opens when it is picked from a list. */
  openItemsIn: OpenItemsIn;
  /** Whether the side panels animate when Windows has animations off. */
  motion: MotionSetting;
  interfaceFont: InterfaceFont;
  interfaceFontSize: InterfaceFontSize;
  monospaceFont: MonospaceFont;
  monospaceFontSize: MonospaceFontSize;
  wordWrap: boolean;
  windowState: WindowState | null;
  /** The user has accepted that uploads to public repos are public as soon as they upload. */
  publicUploadNoticeAcknowledged: boolean;
}

/** The two places an issue or pull request can open. */
export type OpenItemsIn = 'full' | 'side';

/**
 * 'always' (the default) animates the panels whatever Windows says. 'system' follows Windows: when animations are off
 * there, panels fade instead of sliding.
 */
export type MotionSetting = 'system' | 'always';

export type InterfaceFont = 'inter' | 'system' | 'segoe' | 'arial';
export type InterfaceFontSize = 12 | 13 | 14 | 15 | 16 | 18;
export type MonospaceFont = 'cascadia' | 'consolas' | 'courier' | 'code-new-roman';
export type MonospaceFontSize = 11 | 12 | 13 | 14 | 15;

export type SettingsUpdate = Partial<
  Pick<
    OrbitSettings,
    | 'pinnedRepoIds'
    | 'customViews'
    | 'colorScheme'
    | 'palette'
    | 'customThemes'
    | 'openItemsIn'
    | 'motion'
    | 'interfaceFont'
    | 'interfaceFontSize'
    | 'monospaceFont'
    | 'monospaceFontSize'
    | 'wordWrap'
  >
> & {
  detailsWidth?: number;
};

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  /** The fake GitHub's origin while debugging against it; media from it is shown. Absent otherwise. */
  debugMediaOrigin?: string | null;
}

export interface OpenExternalResult {
  opened: boolean;
}

/** Window and editing commands the custom title bar may run. Anything else is refused by main. */
export const SHELL_ACTIONS = [
  'minimize',
  'toggle-maximize',
  'close',
  'toggle-fullscreen',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'select-all',
  'quit'
] as const;
export type ShellAction = (typeof SHELL_ACTIONS)[number];

export function isShellAction(value: unknown): value is ShellAction {
  return typeof value === 'string' && (SHELL_ACTIONS as readonly string[]).includes(value);
}

export interface ShellState {
  maximized: boolean;
  fullscreen: boolean;
}

/** The typed surface the preload exposes as `window.orbit`. */
export interface OrbitApi {
  app: {
    getInfo(): Promise<AppInfo>;
    openExternal(url: string): Promise<OpenExternalResult>;
  };
  shell: {
    /** Runs a window or editing command on the window that asked. Unknown commands are refused. */
    control(action: ShellAction): Promise<void>;
    getState(): Promise<ShellState>;
    /** Subscribes to maximize and full-screen changes. Returns an unsubscribe function. */
    onStateChanged(listener: (state: ShellState) => void): () => void;
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
  themes: {
    /** Searches Open VSX for colour themes. Never rejects on an empty query; failures reject with a message. */
    search(request: ThemeSearchRequest): Promise<ThemeSearchResult[]>;
    /** Reads the colours of one Open VSX theme. Nothing from the package is run. */
    import(ref: ThemeImportRef): Promise<ThemeImportDraft>;
  };
  updates: {
    getStatus(): Promise<UpdateStatus>;
    /** Checks GitHub now. Never rejects; failures come back as an error status. */
    check(): Promise<UpdateStatus>;
    /** Downloads the release a check offered. Only call after the user asked for it. */
    download(): Promise<UpdateStatus>;
    /** Restarts into or opens the prepared update. Only call after the user confirmed. */
    install(): Promise<void>;
    /** Subscribes to status changes. Returns an unsubscribe function. */
    onStatusChanged(listener: (status: UpdateStatus) => void): () => void;
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
  actions: {
    /** Jobs of one workflow run, with status and timing. */
    jobs(repoFullName: string, runId: number): Promise<WorkflowJob[]>;
    /** The plain-text log of one job. */
    jobLogs(repoFullName: string, jobId: number): Promise<string>;
    /** The workflow file's jobs and their needs, read at the run's commit. Empty when it cannot be read. */
    workflowGraph(repoFullName: string, runId: number): Promise<WorkflowGraphJob[]>;
    /** Cancels a workflow run that is queued or running. */
    cancelRun(repoFullName: string, runId: number): Promise<PullWriteResult>;
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
    /** Places an item after another item in the project's manual order, or at the top when `afterId` is null. */
    moveItem(projectId: string, itemId: string, afterId: string | null): Promise<void>;
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
