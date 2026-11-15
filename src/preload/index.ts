import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type OrbitApi } from '../shared/ipc';
import type { AuthStatus } from '../shared/auth';
import type { ConnectionStatus } from '../shared/connection';

/**
 * The only bridge between the sandboxed renderer and main. Each operation maps
 * to one named IPC channel; nothing else is exposed.
 */
const api: OrbitApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.appGetInfo),
    openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.appOpenExternal, url)
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
