import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  IpcChannels,
  isShellAction,
  type AppInfo,
  type OpenExternalResult,
  type SettingsUpdate,
  type ShellState
} from '../shared/ipc';
import { runShellAction, shellStateOf } from './shell-actions';
import type { AuthStatus } from '../shared/auth';
import type { AttachmentFile, AttachmentUploadResult } from '../shared/attachments';
import type { WorkflowGraphJob, WorkflowJob } from '../shared/issues';
import { openExternalIfAllowed } from './window';
import { debugMediaOrigin } from './github/endpoints';
import { isAppUrl } from './security';
import type { AuthService } from './github/auth-service';
import type { RepoService } from './github/repo-service';
import type { SettingsStore } from './settings';
import type { ConnectionStatus, RefreshStart } from '../shared/connection';
import type { RefreshEngine } from './github/refresh-engine';
import type { UpdateStatus } from '../shared/updates';
import type {
  ThemeImportDraft,
  ThemeImportRef,
  ThemeSearchRequest,
  ThemeSearchResult
} from '../shared/themes';
import type { NotificationCenter } from './notification-center';
import type { NotificationOpenResult } from '../shared/notifications';
import type { Diagnostics } from './diagnostics';
import type { IssueService } from './github/issue-service';
import type { InboxService } from './github/inbox-service';
import type { SearchService } from './github/search-service';
import type { SearchPage, SearchRequest } from '../shared/search';
import type { InboxPage, InboxQuery } from '../shared/inbox';
import type { ProjectsService } from './github/projects-service';
import {
  parseProjectFieldChange,
  type ItemMemberships,
  type ProjectDetail,
  type ProjectItem,
  type ProjectItemEditResult,
  type ProjectItemsPage,
  type ProjectListPage
} from '../shared/projects';
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
  MergeMethod,
  PullActions,
  PullCreateInput,
  PullMergeResult,
  PullSummary,
  PullWriteResult,
  RerunMode,
  WorkflowRun,
  ReviewAnchor,
  ReviewCommentResult,
  ReviewEvent,
  ReviewSubmitResult
} from '../shared/issues';

/** The part of the refresh engine that IPC needs. */
export type RefreshPort = Pick<RefreshEngine, 'refreshNow' | 'wake'> & {
  getStatus(): ConnectionStatus;
  onChange(listener: (status: ConnectionStatus) => void): () => void;
};

/** The part of the update service that IPC needs. */
export type UpdatePort = {
  getStatus(): UpdateStatus;
  checkNow(): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  install(): Promise<void>;
  onChange(listener: (status: UpdateStatus) => void): () => void;
};

/** The part of the theme catalogue that IPC needs. */
export type ThemesPort = {
  search(request: ThemeSearchRequest): Promise<ThemeSearchResult[]>;
  import(ref: ThemeImportRef): Promise<ThemeImportDraft>;
};

/** The part of the notification center that IPC needs. */
export type NotificationsPort = Pick<NotificationCenter, 'open'>;

/** The part of the auth service that IPC needs. Tests can supply a plain object. */
export type AuthPort = Pick<
  AuthService,
  'getStatus' | 'startSignIn' | 'cancelSignIn' | 'signOut' | 'onStatusChange'
>;

export interface IpcOptions {
  devServerOrigin?: string;
  auth?: AuthPort;
  repos?: Pick<RepoService, 'current'>;
  settings?: SettingsStore;
  refresh?: RefreshPort;
  updates?: UpdatePort;
  themes?: ThemesPort;
  notifications?: NotificationsPort;
  diagnostics?: Pick<Diagnostics, 'report' | 'record'>;
  issues?: Omit<
    Pick<
      IssueService,
      | 'listIssues'
      | 'getIssueDetail'
      | 'getPullDetail'
      | 'createIssue'
      | 'updateIssue'
      | 'updateIssueFields'
      | 'setIssueState'
      | 'getRepoOptions'
      | 'setTaskItem'
      | 'uploadAttachment'
    >,
    'getPullDetail'
  > &
    Partial<
      Pick<
        IssueService,
        | 'listPulls'
        | 'getPullFiles'
        | 'getPullReviewThreads'
        | 'getPullReviewState'
        | 'addReviewComment'
        | 'replyToReviewThread'
        | 'setReviewThreadResolved'
        | 'submitReview'
        | 'getPullActions'
        | 'mergePull'
        | 'setPullAutoMerge'
        | 'setPullDraft'
        | 'getPullWorkflowRuns'
        | 'rerunPullWorkflow'
        | 'getRunJobs'
        | 'getJobLogs'
        | 'cancelRun'
        | 'getWorkflowGraph'
        | 'createPull'
        | 'listBranches'
      >
    > & {
      getPullDetail(repoFullName: string, number: number): Promise<IssueDetail | PullDetail>;
    };
  comments?: Pick<IssueService, 'previewMarkdown' | 'createComment' | 'updateComment' | 'deleteComment'>;
  inbox?: Pick<InboxService, 'list'>;
  search?: Pick<SearchService, 'search'>;
  projects?: Pick<
    ProjectsService,
    | 'listProjects'
    | 'getProject'
    | 'listItems'
    | 'getItemMemberships'
    | 'addItem'
    | 'removeItem'
    | 'moveItem'
    | 'setFieldValue'
  >;
}

/** Rejects calls from anything other than the app's own renderer frames. */
export function assertTrustedSender(event: IpcMainInvokeEvent, devServerOrigin?: string): void {
  const senderUrl = event.senderFrame?.url ?? '';
  if (!isAppUrl(senderUrl, devServerOrigin)) {
    throw new Error('Untrusted IPC sender');
  }
}

export function registerIpcHandlers(options: IpcOptions = {}): void {
  const {
    devServerOrigin,
    auth,
    repos,
    settings,
    refresh,
    updates,
    themes,
    notifications,
    diagnostics,
    issues,
    comments,
    inbox,
    search,
    projects
  } = options;

  ipcMain.handle(IpcChannels.appGetInfo, (event): AppInfo => {
    assertTrustedSender(event, devServerOrigin);
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      debugMediaOrigin: debugMediaOrigin(process.env['ORBIT_GITHUB_URL'])
    };
  });

  ipcMain.handle(IpcChannels.appOpenExternal, (event, url: unknown): OpenExternalResult => {
    assertTrustedSender(event, devServerOrigin);
    return { opened: openExternalIfAllowed(url) };
  });

  ipcMain.handle(IpcChannels.shellGetState, (event): ShellState => {
    assertTrustedSender(event, devServerOrigin);
    return shellStateOf(BrowserWindow.fromWebContents(event.sender));
  });
  ipcMain.handle(IpcChannels.shellControl, (event, action: unknown): void => {
    assertTrustedSender(event, devServerOrigin);
    if (!isShellAction(action)) throw new Error('Unknown window command');
    runShellAction(event.sender, BrowserWindow.fromWebContents(event.sender), action);
  });

  if (auth) registerAuthHandlers(auth, devServerOrigin);
  if (refresh) registerRefreshHandlers(refresh, devServerOrigin);
  if (updates) registerUpdateHandlers(updates, devServerOrigin);
  if (themes) registerThemeHandlers(themes, devServerOrigin);
  if (notifications) {
    ipcMain.handle(
      IpcChannels.notificationsOpen,
      (event, threadId: unknown): Promise<NotificationOpenResult> => {
        assertTrustedSender(event, devServerOrigin);
        return notifications.open(parseThreadId(threadId));
      }
    );
  }
  if (diagnostics) {
    ipcMain.handle(IpcChannels.diagnosticsRecord, (event, entry: unknown): void => {
      assertTrustedSender(event, devServerOrigin);
      const { scope, code } = parseRendererDiagnostic(entry);
      void diagnostics.record({ level: 'warn', scope, code, message: '' });
    });
    ipcMain.handle(IpcChannels.diagnosticsGetReport, (event): string => {
      assertTrustedSender(event, devServerOrigin);
      return diagnostics.report();
    });
  }
  if (inbox) {
    ipcMain.handle(IpcChannels.inboxList, (event, query: InboxQuery): Promise<InboxPage> => {
      assertTrustedSender(event, devServerOrigin);
      return inbox.list(query);
    });
  }
  if (search) {
    ipcMain.handle(IpcChannels.searchQuery, (event, request: SearchRequest): Promise<SearchPage> => {
      assertTrustedSender(event, devServerOrigin);
      return search.search(request);
    });
  }
  if (projects) registerProjectHandlers(projects, devServerOrigin);
  if (repos) {
    ipcMain.handle(IpcChannels.reposList, async (event) => {
      assertTrustedSender(event, devServerOrigin);
      return repos.current();
    });
  }
  if (issues) {
    ipcMain.handle(IpcChannels.pullsList, (event, query: PullListQuery): Promise<PullListPage> => {
      assertTrustedSender(event, devServerOrigin);
      if (!issues.listPulls) throw new Error('Pull request lists are unavailable.');
      return issues.listPulls(query);
    });
    ipcMain.handle(IpcChannels.issuesList, (event, query: IssueListQuery): Promise<IssueListPage> => {
      assertTrustedSender(event, devServerOrigin);
      return issues.listIssues(query);
    });
    ipcMain.handle(
      IpcChannels.issuesDetail,
      (event, repoFullName: string, number: number): Promise<IssueDetail> => {
        assertTrustedSender(event, devServerOrigin);
        return issues.getIssueDetail(repoFullName, number);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsDetail,
      (event, repoFullName: string, number: number): Promise<PullDetail> => {
        assertTrustedSender(event, devServerOrigin);
        return issues.getPullDetail(repoFullName, number) as Promise<PullDetail>;
      }
    );
    ipcMain.handle(
      IpcChannels.pullsFiles,
      (event, repoFullName: string, number: number): Promise<PullFilesPage> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.getPullFiles) throw new Error('Pull request diffs are unavailable.');
        return issues.getPullFiles(repoFullName, number);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsThreads,
      (event, repoFullName: string, number: number): Promise<PullReviewThreadsPage> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.getPullReviewThreads) throw new Error('Review threads are unavailable.');
        return issues.getPullReviewThreads(repoFullName, number);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsReviewState,
      (event, repoFullName: string, number: number): Promise<PullReviewState> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.getPullReviewState) throw new Error('Pending reviews are unavailable.');
        return issues.getPullReviewState(repoFullName, number);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsReviewComment,
      (
        event,
        repoFullName: string,
        number: number,
        input: { anchor: ReviewAnchor; body: string; reviewedHeadSha: string }
      ): Promise<ReviewCommentResult> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.addReviewComment) throw new Error('Pending reviews are unavailable.');
        return issues.addReviewComment(repoFullName, number, input);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsReviewReply,
      (
        event,
        repoFullName: string,
        number: number,
        input: { threadId: string; body: string; reviewedHeadSha: string }
      ): Promise<ReviewCommentResult> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.replyToReviewThread) throw new Error('Pending reviews are unavailable.');
        return issues.replyToReviewThread(repoFullName, number, input);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsReviewResolve,
      (
        event,
        repoFullName: string,
        number: number,
        threadId: string,
        resolved: boolean
      ): Promise<boolean> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.setReviewThreadResolved) throw new Error('Review threads are unavailable.');
        return issues.setReviewThreadResolved(repoFullName, number, threadId, resolved === true);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsReviewSubmit,
      (
        event,
        repoFullName: string,
        number: number,
        input: { event: ReviewEvent; body: string; reviewedHeadSha: string }
      ): Promise<ReviewSubmitResult> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.submitReview) throw new Error('Review submission is unavailable.');
        return issues.submitReview(repoFullName, number, input);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsActions,
      (event, repoFullName: string, number: number): Promise<PullActions> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.getPullActions) throw new Error('Pull request actions are unavailable.');
        return issues.getPullActions(repoFullName, number);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsMerge,
      (
        event,
        repoFullName: string,
        number: number,
        input: { method: MergeMethod; deleteBranch: boolean; expectedHeadSha: string }
      ): Promise<PullMergeResult> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.mergePull) throw new Error('Merging is unavailable.');
        return issues.mergePull(repoFullName, number, input);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsAutoMerge,
      (
        event,
        repoFullName: string,
        number: number,
        input: { enabled: boolean; method?: MergeMethod; expectedHeadSha: string }
      ): Promise<PullWriteResult> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.setPullAutoMerge) throw new Error('Auto-merge is unavailable.');
        return issues.setPullAutoMerge(repoFullName, number, input);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsDraft,
      (
        event,
        repoFullName: string,
        number: number,
        draft: boolean,
        expectedHeadSha: string
      ): Promise<PullWriteResult> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.setPullDraft) throw new Error('Draft changes are unavailable.');
        return issues.setPullDraft(repoFullName, number, draft === true, expectedHeadSha);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsRuns,
      (event, repoFullName: string, number: number): Promise<WorkflowRun[]> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.getPullWorkflowRuns) throw new Error('Workflow runs are unavailable.');
        return issues.getPullWorkflowRuns(repoFullName, number);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsRerun,
      (
        event,
        repoFullName: string,
        runId: number,
        mode: RerunMode,
        expectedHeadSha: string
      ): Promise<PullWriteResult> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.rerunPullWorkflow) throw new Error('Re-running workflows is unavailable.');
        return issues.rerunPullWorkflow(repoFullName, runId, mode, expectedHeadSha);
      }
    );
    ipcMain.handle(
      IpcChannels.actionsJobs,
      (event, repoFullName: string, runId: number): Promise<WorkflowJob[]> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.getRunJobs) throw new Error('Workflow jobs are unavailable.');
        return issues.getRunJobs(repoFullName, runId);
      }
    );
    ipcMain.handle(
      IpcChannels.actionsJobLogs,
      (event, repoFullName: string, jobId: number): Promise<string> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.getJobLogs) throw new Error('Job logs are unavailable.');
        return issues.getJobLogs(repoFullName, jobId);
      }
    );
    ipcMain.handle(
      IpcChannels.actionsWorkflowGraph,
      (event, repoFullName: string, runId: number): Promise<WorkflowGraphJob[]> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.getWorkflowGraph) return Promise.resolve([]);
        return issues.getWorkflowGraph(repoFullName, runId);
      }
    );
    ipcMain.handle(
      IpcChannels.actionsCancelRun,
      (event, repoFullName: string, runId: number): Promise<PullWriteResult> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.cancelRun) throw new Error('Cancelling runs is unavailable.');
        return issues.cancelRun(repoFullName, runId);
      }
    );
    ipcMain.handle(
      IpcChannels.pullsCreate,
      (event, repoFullName: string, input: PullCreateInput): Promise<PullSummary> => {
        assertTrustedSender(event, devServerOrigin);
        if (!issues.createPull) throw new Error('Creating pull requests is unavailable.');
        return issues.createPull(repoFullName, input);
      }
    );
    ipcMain.handle(IpcChannels.pullsBranches, (event, repoFullName: string): Promise<string[]> => {
      assertTrustedSender(event, devServerOrigin);
      if (!issues.listBranches) throw new Error('Branches are unavailable.');
      return issues.listBranches(repoFullName);
    });
    ipcMain.handle(
      IpcChannels.issuesCreate,
      (event, repoFullName: string, input: IssueContentInput): Promise<IssueSnapshot> => {
        assertTrustedSender(event, devServerOrigin);
        return issues.createIssue(repoFullName, input);
      }
    );
    ipcMain.handle(
      IpcChannels.issuesUpdate,
      (
        event,
        repoFullName: string,
        number: number,
        input: IssueContentInput,
        base: IssueContentInput
      ): Promise<IssueEditResult> => {
        assertTrustedSender(event, devServerOrigin);
        return issues.updateIssue(repoFullName, number, input, base);
      }
    );
    ipcMain.handle(
      IpcChannels.issuesUpdateFields,
      (event, repoFullName: string, number: number, fields: IssueFieldsInput): Promise<IssueSummary> => {
        assertTrustedSender(event, devServerOrigin);
        return issues.updateIssueFields(repoFullName, number, fields);
      }
    );
    ipcMain.handle(
      IpcChannels.issuesSetState,
      (
        event,
        repoFullName: string,
        number: number,
        state: 'open' | 'closed',
        reason?: IssueCloseReason
      ): Promise<IssueSummary> => {
        assertTrustedSender(event, devServerOrigin);
        return issues.setIssueState(repoFullName, number, state, reason);
      }
    );
    ipcMain.handle(
      IpcChannels.issuesRepoOptions,
      (event, repoFullName: string): Promise<IssueRepoOptions> => {
        assertTrustedSender(event, devServerOrigin);
        return issues.getRepoOptions(repoFullName);
      }
    );
    ipcMain.handle(
      IpcChannels.issuesSetTask,
      (
        event,
        repoFullName: string,
        number: number,
        input: { index: number; checked: boolean; expectedBody: string }
      ): Promise<TaskToggleResult> => {
        assertTrustedSender(event, devServerOrigin);
        return issues.setTaskItem(repoFullName, number, input);
      }
    );
    ipcMain.handle(
      IpcChannels.attachmentsUpload,
      (
        event,
        repoFullName: string,
        file: unknown,
        options: { acknowledgedPublic: boolean }
      ): Promise<AttachmentUploadResult> => {
        assertTrustedSender(event, devServerOrigin);
        const parsed = parseAttachmentFile(file);
        return issues.uploadAttachment(repoFullName, parsed, {
          acknowledgedPublic: options?.acknowledgedPublic === true
        });
      }
    );
  }
  if (comments) {
    ipcMain.handle(
      IpcChannels.markdownPreview,
      (event, repoFullName: string, text: string): Promise<string> => {
        assertTrustedSender(event, devServerOrigin);
        return comments.previewMarkdown(repoFullName, text);
      }
    );
    ipcMain.handle(
      IpcChannels.commentsCreate,
      (event, repoFullName: string, number: number, body: string): Promise<IssueComment> => {
        assertTrustedSender(event, devServerOrigin);
        return comments.createComment(repoFullName, number, body);
      }
    );
    ipcMain.handle(
      IpcChannels.commentsUpdate,
      (
        event,
        repoFullName: string,
        commentId: number,
        body: string,
        baseUpdatedAt: string
      ): Promise<CommentUpdateResult> => {
        assertTrustedSender(event, devServerOrigin);
        return comments.updateComment(repoFullName, commentId, body, baseUpdatedAt);
      }
    );
    ipcMain.handle(
      IpcChannels.commentsDelete,
      (event, repoFullName: string, commentId: number): Promise<void> => {
        assertTrustedSender(event, devServerOrigin);
        return comments.deleteComment(repoFullName, commentId);
      }
    );
  }
  if (settings) {
    ipcMain.handle(IpcChannels.settingsGet, async (event) => {
      assertTrustedSender(event, devServerOrigin);
      return settings.load();
    });
    ipcMain.handle(IpcChannels.settingsUpdate, async (event, update: SettingsUpdate) => {
      assertTrustedSender(event, devServerOrigin);
      return settings.update(update);
    });
  }
}

/**
 * Auth calls are synchronous up to the service call, so an untrusted sender is
 * rejected before the service sees anything.
 */
function registerAuthHandlers(auth: AuthPort, devServerOrigin?: string): void {
  ipcMain.handle(IpcChannels.authGetStatus, (event): AuthStatus => {
    assertTrustedSender(event, devServerOrigin);
    return auth.getStatus();
  });
  ipcMain.handle(IpcChannels.authStartSignIn, (event): Promise<AuthStatus> => {
    assertTrustedSender(event, devServerOrigin);
    return auth.startSignIn();
  });
  ipcMain.handle(IpcChannels.authCancelSignIn, (event): AuthStatus => {
    assertTrustedSender(event, devServerOrigin);
    return auth.cancelSignIn();
  });
  ipcMain.handle(IpcChannels.authSignOut, (event): Promise<AuthStatus> => {
    assertTrustedSender(event, devServerOrigin);
    return auth.signOut();
  });

  auth.onStatusChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.authStatusChanged, status);
    }
  });
}

/** Thread ids come from GitHub and are short numeric strings. Anything else is rejected before it reaches GitHub. */
export function parseThreadId(input: unknown): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > 64) {
    throw new Error('Invalid notification thread.');
  }
  return input;
}

/** Sends a push to every open window. Used for notification deliveries and navigation. */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

/** Theme catalogue: search and import from Open VSX. The renderer passes only names, which are checked first. */
function registerThemeHandlers(themes: ThemesPort, devServerOrigin?: string): void {
  ipcMain.handle(IpcChannels.themesSearch, (event, request: unknown): Promise<ThemeSearchResult[]> => {
    assertTrustedSender(event, devServerOrigin);
    const record =
      typeof request === 'object' && request !== null ? (request as Record<string, unknown>) : {};
    return themes.search({
      query: typeof record['query'] === 'string' ? record['query'] : '',
      sort: record['sort'] === 'timestamp' ? 'timestamp' : 'downloadCount'
    });
  });
  ipcMain.handle(IpcChannels.themesImport, (event, ref: unknown): Promise<ThemeImportDraft> => {
    assertTrustedSender(event, devServerOrigin);
    const record = typeof ref === 'object' && ref !== null ? (ref as Record<string, unknown>) : {};
    return themes.import({
      namespace: typeof record['namespace'] === 'string' ? record['namespace'] : '',
      name: typeof record['name'] === 'string' ? record['name'] : ''
    });
  });
}

function registerUpdateHandlers(updates: UpdatePort, devServerOrigin?: string): void {
  ipcMain.handle(IpcChannels.updatesGetStatus, (event): UpdateStatus => {
    assertTrustedSender(event, devServerOrigin);
    return updates.getStatus();
  });
  ipcMain.handle(IpcChannels.updatesCheck, (event): Promise<UpdateStatus> => {
    assertTrustedSender(event, devServerOrigin);
    return updates.checkNow();
  });
  // Installing happens only on an explicit renderer request, after the user confirmed a restart.
  ipcMain.handle(IpcChannels.updatesDownload, (event): Promise<UpdateStatus> => {
    assertTrustedSender(event, devServerOrigin);
    return updates.download();
  });
  ipcMain.handle(IpcChannels.updatesInstall, (event): Promise<void> => {
    assertTrustedSender(event, devServerOrigin);
    return updates.install();
  });
  updates.onChange((status) => broadcast(IpcChannels.updatesStatusChanged, status));
}

function registerRefreshHandlers(refresh: RefreshPort, devServerOrigin?: string): void {
  ipcMain.handle(IpcChannels.refreshGetStatus, (event): ConnectionStatus => {
    assertTrustedSender(event, devServerOrigin);
    return refresh.getStatus();
  });
  ipcMain.handle(IpcChannels.refreshWake, (event): Promise<RefreshStart> => {
    assertTrustedSender(event, devServerOrigin);
    return refresh.wake();
  });
  ipcMain.handle(IpcChannels.reposRefresh, (event): Promise<RefreshStart> => {
    assertTrustedSender(event, devServerOrigin);
    return refresh.refreshNow();
  });
  refresh.onChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.refreshStatusChanged, status);
    }
  });
}

/**
 * A file from the renderer must be a name and raw bytes. The service checks the type and size; this only
 * stops malformed payloads from reaching it.
 */
export function parseAttachmentFile(input: unknown): AttachmentFile {
  const file = input as { name?: unknown; bytes?: unknown } | null;
  if (typeof file?.name !== 'string' || file.name.length > 255 || !(file.bytes instanceof Uint8Array)) {
    throw new Error('Choose a file to attach.');
  }
  return { name: file.name, bytes: file.bytes };
}

const CODE_PATTERN = /^[a-z][a-z-]{0,39}$/;

/**
 * Renderer-reported diagnostics carry only a scope and a short code. Anything
 * else (free text, tokens, GitHub content) is rejected before it reaches the log.
 */
export function parseRendererDiagnostic(input: unknown): { scope: string; code: string } {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid diagnostic');
  const { scope, code } = input as { scope?: unknown; code?: unknown };
  if (typeof scope !== 'string' || typeof code !== 'string') throw new Error('Invalid diagnostic');
  if (!CODE_PATTERN.test(scope) || !CODE_PATTERN.test(code)) throw new Error('Invalid diagnostic');
  return { scope, code };
}

/** Project handlers. Field changes are checked here, before the service sees them. */
function registerProjectHandlers(
  projects: NonNullable<IpcOptions['projects']>,
  devServerOrigin?: string
): void {
  ipcMain.handle(IpcChannels.projectsList, (event): Promise<ProjectListPage> => {
    assertTrustedSender(event, devServerOrigin);
    return projects.listProjects();
  });
  ipcMain.handle(IpcChannels.projectsDetail, (event, projectId: unknown): Promise<ProjectDetail> => {
    assertTrustedSender(event, devServerOrigin);
    return projects.getProject(String(projectId));
  });
  ipcMain.handle(
    IpcChannels.projectsItems,
    (event, projectId: unknown, filter: unknown): Promise<ProjectItemsPage> => {
      assertTrustedSender(event, devServerOrigin);
      if (typeof filter !== 'string') return Promise.reject(new Error('That filter is not valid.'));
      return projects.listItems(String(projectId), filter);
    }
  );
  ipcMain.handle(
    IpcChannels.projectsItemMemberships,
    (event, repoFullName: unknown, number: unknown): Promise<ItemMemberships> => {
      assertTrustedSender(event, devServerOrigin);
      return projects.getItemMemberships(String(repoFullName), Number(number));
    }
  );
  ipcMain.handle(
    IpcChannels.projectsAddItem,
    (event, projectId: unknown, repoFullName: unknown, number: unknown): Promise<ProjectItem> => {
      assertTrustedSender(event, devServerOrigin);
      return projects.addItem(String(projectId), String(repoFullName), Number(number));
    }
  );
  ipcMain.handle(
    IpcChannels.projectsRemoveItem,
    (event, projectId: unknown, itemId: unknown): Promise<void> => {
      assertTrustedSender(event, devServerOrigin);
      return projects.removeItem(String(projectId), String(itemId));
    }
  );
  ipcMain.handle(
    IpcChannels.projectsMoveItem,
    (event, projectId: unknown, itemId: unknown, afterId: unknown): Promise<void> => {
      assertTrustedSender(event, devServerOrigin);
      const after = afterId === null ? null : String(afterId);
      return projects.moveItem(String(projectId), String(itemId), after);
    }
  );
  ipcMain.handle(
    IpcChannels.projectsSetField,
    (event, projectId: unknown, itemId: unknown, change: unknown): Promise<ProjectItemEditResult> => {
      assertTrustedSender(event, devServerOrigin);
      const parsed = parseProjectFieldChange(change);
      if (!parsed) return Promise.reject(new Error('That field change is not valid.'));
      return projects.setFieldValue(String(projectId), String(itemId), parsed);
    }
  );
}
