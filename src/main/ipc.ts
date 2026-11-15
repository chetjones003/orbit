import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IpcChannels, type AppInfo, type OpenExternalResult, type SettingsUpdate } from '../shared/ipc';
import type { AuthStatus } from '../shared/auth';
import type { AttachmentFile, AttachmentUploadResult } from '../shared/attachments';
import { openExternalIfAllowed } from './window';
import { isAppUrl } from './security';
import type { AuthService } from './github/auth-service';
import type { RepoService } from './github/repo-service';
import type { SettingsStore } from './settings';
import type { ConnectionStatus, RefreshStart } from '../shared/connection';
import type { RefreshEngine } from './github/refresh-engine';
import type { Diagnostics } from './diagnostics';
import type { IssueService } from './github/issue-service';
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
  ReviewSubmitResult
} from '../shared/issues';

/** The part of the refresh engine that IPC needs. */
export type RefreshPort = Pick<RefreshEngine, 'refreshNow' | 'wake'> & {
  getStatus(): ConnectionStatus;
  onChange(listener: (status: ConnectionStatus) => void): () => void;
};

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
      >
    > & {
      getPullDetail(repoFullName: string, number: number): Promise<IssueDetail | PullDetail>;
    };
  comments?: Pick<IssueService, 'previewMarkdown' | 'createComment' | 'updateComment' | 'deleteComment'>;
}

/** Rejects calls from anything other than the app's own renderer frames. */
export function assertTrustedSender(event: IpcMainInvokeEvent, devServerOrigin?: string): void {
  const senderUrl = event.senderFrame?.url ?? '';
  if (!isAppUrl(senderUrl, devServerOrigin)) {
    throw new Error('Untrusted IPC sender');
  }
}

export function registerIpcHandlers(options: IpcOptions = {}): void {
  const { devServerOrigin, auth, repos, settings, refresh, diagnostics, issues, comments } = options;

  ipcMain.handle(IpcChannels.appGetInfo, (event): AppInfo => {
    assertTrustedSender(event, devServerOrigin);
    return { name: app.getName(), version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle(IpcChannels.appOpenExternal, (event, url: unknown): OpenExternalResult => {
    assertTrustedSender(event, devServerOrigin);
    return { opened: openExternalIfAllowed(url) };
  });

  if (auth) registerAuthHandlers(auth, devServerOrigin);
  if (refresh) registerRefreshHandlers(refresh, devServerOrigin);
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
