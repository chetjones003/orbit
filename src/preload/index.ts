import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type OrbitApi, type ShellAction, type ShellState } from '../shared/ipc';
import type { AuthStatus } from '../shared/auth';
import type { ConnectionStatus } from '../shared/connection';
import type { NotificationDelivery, NotificationOpenResult } from '../shared/notifications';
import type { UpdateStatus } from '../shared/updates';

/**
 * The only bridge between the sandboxed renderer and main. Each operation maps
 * to one named IPC channel; nothing else is exposed.
 */
const api: OrbitApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.appGetInfo),
    openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.appOpenExternal, url)
  },
  shell: {
    control: (action: ShellAction) => ipcRenderer.invoke(IpcChannels.shellControl, action),
    getState: () => ipcRenderer.invoke(IpcChannels.shellGetState),
    onStateChanged: (listener: (state: ShellState) => void) => {
      const handler = (_event: IpcRendererEvent, state: ShellState): void => listener(state);
      ipcRenderer.on(IpcChannels.shellStateChanged, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.shellStateChanged, handler);
      };
    }
  },
  auth: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.authGetStatus),
    startSignIn: () => ipcRenderer.invoke(IpcChannels.authStartSignIn),
    cancelSignIn: () => ipcRenderer.invoke(IpcChannels.authCancelSignIn),
    signOut: () => ipcRenderer.invoke(IpcChannels.authSignOut),
    onStatusChanged: (listener: (status: AuthStatus) => void) => {
      // Strip the Electron event object so the renderer only sees the status.
      const handler = (_event: IpcRendererEvent, status: AuthStatus): void => listener(status);
      ipcRenderer.on(IpcChannels.authStatusChanged, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.authStatusChanged, handler);
      };
    }
  },
  notifications: {
    open: (threadId: string) => ipcRenderer.invoke(IpcChannels.notificationsOpen, threadId),
    onDelivered: (listener: (delivery: NotificationDelivery) => void) => {
      const handler = (_event: IpcRendererEvent, delivery: NotificationDelivery): void => listener(delivery);
      ipcRenderer.on(IpcChannels.notificationsDelivered, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.notificationsDelivered, handler);
      };
    },
    onNavigate: (listener: (result: NotificationOpenResult) => void) => {
      const handler = (_event: IpcRendererEvent, result: NotificationOpenResult): void => listener(result);
      ipcRenderer.on(IpcChannels.notificationsNavigate, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.notificationsNavigate, handler);
      };
    }
  },
  updates: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.updatesGetStatus),
    check: () => ipcRenderer.invoke(IpcChannels.updatesCheck),
    install: () => ipcRenderer.invoke(IpcChannels.updatesInstall),
    onStatusChanged: (listener: (status: UpdateStatus) => void) => {
      const handler = (_event: IpcRendererEvent, status: UpdateStatus): void => listener(status);
      ipcRenderer.on(IpcChannels.updatesStatusChanged, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.updatesStatusChanged, handler);
      };
    }
  },
  refresh: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.refreshGetStatus),
    wake: () => ipcRenderer.invoke(IpcChannels.refreshWake),
    onStatusChanged: (listener: (status: ConnectionStatus) => void) => {
      const handler = (_event: IpcRendererEvent, status: ConnectionStatus): void => listener(status);
      ipcRenderer.on(IpcChannels.refreshStatusChanged, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.refreshStatusChanged, handler);
      };
    }
  },
  repos: {
    list: () => ipcRenderer.invoke(IpcChannels.reposList),
    refresh: () => ipcRenderer.invoke(IpcChannels.reposRefresh)
  },
  issues: {
    list: (query) => ipcRenderer.invoke(IpcChannels.issuesList, query),
    detail: (repoFullName: string, number: number) =>
      ipcRenderer.invoke(IpcChannels.issuesDetail, repoFullName, number),
    create: (repoFullName: string, input) =>
      ipcRenderer.invoke(IpcChannels.issuesCreate, repoFullName, input),
    update: (repoFullName: string, number: number, input, base) =>
      ipcRenderer.invoke(IpcChannels.issuesUpdate, repoFullName, number, input, base),
    updateFields: (repoFullName: string, number: number, fields) =>
      ipcRenderer.invoke(IpcChannels.issuesUpdateFields, repoFullName, number, fields),
    setState: (repoFullName: string, number: number, state, reason) =>
      ipcRenderer.invoke(IpcChannels.issuesSetState, repoFullName, number, state, reason),
    repoOptions: (repoFullName: string) => ipcRenderer.invoke(IpcChannels.issuesRepoOptions, repoFullName),
    setTask: (repoFullName: string, number: number, input) =>
      ipcRenderer.invoke(IpcChannels.issuesSetTask, repoFullName, number, input)
  },
  actions: {
    jobs: (repoFullName: string, runId: number) =>
      ipcRenderer.invoke(IpcChannels.actionsJobs, repoFullName, runId),
    jobLogs: (repoFullName: string, jobId: number) =>
      ipcRenderer.invoke(IpcChannels.actionsJobLogs, repoFullName, jobId),
    workflowGraph: (repoFullName: string, runId: number) =>
      ipcRenderer.invoke(IpcChannels.actionsWorkflowGraph, repoFullName, runId),
    cancelRun: (repoFullName: string, runId: number) =>
      ipcRenderer.invoke(IpcChannels.actionsCancelRun, repoFullName, runId)
  },
  pulls: {
    list: (query) => ipcRenderer.invoke(IpcChannels.pullsList, query),
    detail: (repoFullName: string, number: number) =>
      ipcRenderer.invoke(IpcChannels.pullsDetail, repoFullName, number),
    files: (repoFullName: string, number: number) =>
      ipcRenderer.invoke(IpcChannels.pullsFiles, repoFullName, number),
    threads: (repoFullName: string, number: number) =>
      ipcRenderer.invoke(IpcChannels.pullsThreads, repoFullName, number),
    reviewState: (repoFullName: string, number: number) =>
      ipcRenderer.invoke(IpcChannels.pullsReviewState, repoFullName, number),
    addReviewComment: (repoFullName: string, number: number, input) =>
      ipcRenderer.invoke(IpcChannels.pullsReviewComment, repoFullName, number, input),
    replyToReviewThread: (repoFullName: string, number: number, input) =>
      ipcRenderer.invoke(IpcChannels.pullsReviewReply, repoFullName, number, input),
    setReviewThreadResolved: (repoFullName: string, number: number, threadId: string, resolved: boolean) =>
      ipcRenderer.invoke(IpcChannels.pullsReviewResolve, repoFullName, number, threadId, resolved),
    submitReview: (repoFullName: string, number: number, input) =>
      ipcRenderer.invoke(IpcChannels.pullsReviewSubmit, repoFullName, number, input),
    actions: (repoFullName: string, number: number) =>
      ipcRenderer.invoke(IpcChannels.pullsActions, repoFullName, number),
    merge: (repoFullName: string, number: number, input) =>
      ipcRenderer.invoke(IpcChannels.pullsMerge, repoFullName, number, input),
    setAutoMerge: (repoFullName: string, number: number, input) =>
      ipcRenderer.invoke(IpcChannels.pullsAutoMerge, repoFullName, number, input),
    setDraft: (repoFullName: string, number: number, draft: boolean, expectedHeadSha: string) =>
      ipcRenderer.invoke(IpcChannels.pullsDraft, repoFullName, number, draft, expectedHeadSha),
    runs: (repoFullName: string, number: number) =>
      ipcRenderer.invoke(IpcChannels.pullsRuns, repoFullName, number),
    rerun: (repoFullName: string, runId: number, mode, expectedHeadSha: string) =>
      ipcRenderer.invoke(IpcChannels.pullsRerun, repoFullName, runId, mode, expectedHeadSha),
    create: (repoFullName: string, input) => ipcRenderer.invoke(IpcChannels.pullsCreate, repoFullName, input),
    branches: (repoFullName: string) => ipcRenderer.invoke(IpcChannels.pullsBranches, repoFullName)
  },
  inbox: {
    list: (query) => ipcRenderer.invoke(IpcChannels.inboxList, query)
  },
  projects: {
    list: () => ipcRenderer.invoke(IpcChannels.projectsList),
    detail: (projectId: string) => ipcRenderer.invoke(IpcChannels.projectsDetail, projectId),
    items: (projectId: string, filter: string) =>
      ipcRenderer.invoke(IpcChannels.projectsItems, projectId, filter),
    itemMemberships: (repoFullName: string, number: number) =>
      ipcRenderer.invoke(IpcChannels.projectsItemMemberships, repoFullName, number),
    addItem: (projectId: string, repoFullName: string, number: number) =>
      ipcRenderer.invoke(IpcChannels.projectsAddItem, projectId, repoFullName, number),
    removeItem: (projectId: string, itemId: string) =>
      ipcRenderer.invoke(IpcChannels.projectsRemoveItem, projectId, itemId),
    moveItem: (projectId: string, itemId: string, afterId: string | null) =>
      ipcRenderer.invoke(IpcChannels.projectsMoveItem, projectId, itemId, afterId),
    setField: (projectId: string, itemId: string, change) =>
      ipcRenderer.invoke(IpcChannels.projectsSetField, projectId, itemId, change)
  },
  markdown: {
    preview: (repoFullName: string, text: string) =>
      ipcRenderer.invoke(IpcChannels.markdownPreview, repoFullName, text)
  },
  comments: {
    create: (repoFullName: string, number: number, body: string) =>
      ipcRenderer.invoke(IpcChannels.commentsCreate, repoFullName, number, body),
    update: (repoFullName: string, commentId: number, body: string, baseUpdatedAt: string) =>
      ipcRenderer.invoke(IpcChannels.commentsUpdate, repoFullName, commentId, body, baseUpdatedAt),
    delete: (repoFullName: string, commentId: number) =>
      ipcRenderer.invoke(IpcChannels.commentsDelete, repoFullName, commentId)
  },
  attachments: {
    upload: (repoFullName: string, file, options) =>
      ipcRenderer.invoke(IpcChannels.attachmentsUpload, repoFullName, file, options)
  },
  diagnostics: {
    getReport: () => ipcRenderer.invoke(IpcChannels.diagnosticsGetReport),
    record: (entry) => ipcRenderer.invoke(IpcChannels.diagnosticsRecord, entry)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    update: (update) => ipcRenderer.invoke(IpcChannels.settingsUpdate, update)
  }
};

contextBridge.exposeInMainWorld('orbit', api);
