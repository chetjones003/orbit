import type { AuthStatus } from './auth';
import type { AttachmentFile, AttachmentUploadResult } from './attachments';
import type { ConnectionStatus, RefreshStart } from './connection';
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
  TaskToggleResult
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
  markdownPreview: 'markdown:preview',
  commentsCreate: 'comments:create',
  commentsUpdate: 'comments:update',
  commentsDelete: 'comments:delete',
  attachmentsUpload: 'attachments:upload',
  refreshWake: 'refresh:wake',
  refreshGetStatus: 'refresh:get-status',
  /** Main-to-renderer push. Payload is a ConnectionStatus. */
  refreshStatusChanged: 'refresh:status-changed',
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

export type SettingsUpdate = Partial<
  Pick<OrbitSettings, 'pinnedRepoIds' | 'customViews' | 'theme' | 'publicUploadNoticeAcknowledged'>
> & {
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
    detail(repoFullName: string, number: number): Promise<IssueDetail>;
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
