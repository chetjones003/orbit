import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AuthStatus } from '../../shared/auth';
import type { AttachmentFile } from '../../shared/attachments';
import type { ConnectionStatus, RefreshStart } from '../../shared/connection';
import type { InboxQuery } from '../../shared/inbox';
import type {
  IssueListQuery,
  IssueContentInput,
  IssueFieldsInput,
  ReviewAnchor,
  PullListQuery,
  PullCreateInput,
  MergeMethod,
  RerunMode,
  ReviewEvent,
  IssueCloseReason
} from '../../shared/issues';
import type { NotificationDelivery, NotificationOpenResult } from '../../shared/notifications';
import type { ProjectFieldChange } from '../../shared/projects';
import type { SearchRequest } from '../../shared/search';
import { normalizeCustomThemes, type ThemeImportRef, type ThemeSearchRequest } from '../../shared/themes';
import type { UpdateStatus } from '../../shared/updates';
import type {
  AppInfo,
  OpenExternalResult,
  OrbitApi,
  OrbitSettings,
  SettingsUpdate,
  ShellAction,
  ShellState
} from '../../shared/ipc';

/**
 * Tauri replacement for the Electron preload. It exposes the same `window.orbit` surface, so the renderer does not
 * change. Each method calls the Rust command of the same job. Subscriptions listen to the backend's events.
 */
/**
 * Tauri rejects with the backend's message as a plain string. The renderer reads messages from Error objects, so
 * the string is wrapped here, and the message the user sees is the one GitHub or Orbit gave.
 */
function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(command, args).catch((cause: unknown) => {
    throw cause instanceof Error
      ? cause
      : new Error(typeof cause === 'string' ? cause : 'Something went wrong.');
  });
}

const ported = {
  app: {
    getInfo: () => invoke<AppInfo>('app_get_info'),
    openExternal: (url: string) => invoke<OpenExternalResult>('app_open_external', { url })
  },
  shell: {
    control: (action: ShellAction) => invoke<void>('shell_control', { action }),
    getState: () => invoke<ShellState>('shell_get_state'),
    onStateChanged: (listener: (state: ShellState) => void) =>
      subscribe<ShellState>('shell:state-changed', listener)
  },
  auth: {
    getStatus: () => invoke<AuthStatus>('auth_get_status'),
    startSignIn: () => invoke<AuthStatus>('auth_start_sign_in'),
    cancelSignIn: () => invoke<AuthStatus>('auth_cancel_sign_in'),
    signOut: () => invoke<AuthStatus>('auth_sign_out'),
    onStatusChanged: (listener: (status: AuthStatus) => void) =>
      subscribe<AuthStatus>('auth:status-changed', listener)
  },
  settings: {
    get: () => invoke<OrbitSettings>('settings_get').then(withThemes),
    update: (update: SettingsUpdate) => invoke<OrbitSettings>('settings_update', { update }).then(withThemes)
  },
  notifications: {
    open: (threadId: string) => invoke<NotificationOpenResult>('notifications_open', { threadId }),
    onDelivered: (listener: (delivery: NotificationDelivery) => void) =>
      subscribe<NotificationDelivery>('notifications:delivered', listener),
    onNavigate: (listener: (result: NotificationOpenResult) => void) =>
      subscribe<NotificationOpenResult>('notifications:navigate', listener)
  },
  themes: {
    search: (request: ThemeSearchRequest) => invoke('themes_search', { request }),
    import: (reference: ThemeImportRef) => invoke('themes_import', { reference })
  },
  updates: {
    getStatus: () => invoke<UpdateStatus>('updates_get_status'),
    check: () => invoke<UpdateStatus>('updates_check'),
    download: () => invoke<UpdateStatus>('updates_download'),
    install: () => invoke<void>('updates_install'),
    onStatusChanged: (listener: (status: UpdateStatus) => void) =>
      subscribe<UpdateStatus>('updates:status-changed', listener)
  },
  refresh: {
    getStatus: () => invoke<ConnectionStatus>('refresh_get_status'),
    wake: () => invoke<RefreshStart>('refresh_wake'),
    onStatusChanged: (listener: (status: ConnectionStatus) => void) =>
      subscribe<ConnectionStatus>('refresh:status-changed', listener)
  },
  repos: {
    list: () => invoke('repos_list'),
    refresh: () => invoke<RefreshStart>('repos_refresh')
  },
  issues: {
    list: (query: IssueListQuery) => invoke('issues_list', { query }),
    detail: (repoFullName: string, number: number) => invoke('issues_detail', { repoFullName, number }),
    links: (repoFullName: string, number: number) => invoke('issues_links', { repoFullName, number }),
    create: (repoFullName: string, input: IssueContentInput) =>
      invoke('issues_create', { repoFullName, input }),
    update: (repoFullName: string, number: number, input: IssueContentInput, base: IssueContentInput) =>
      invoke('issues_update', { repoFullName, number, input, base }),
    updateFields: (repoFullName: string, number: number, fields: IssueFieldsInput) =>
      invoke('issues_update_fields', { repoFullName, number, fields }),
    setState: (repoFullName: string, number: number, state: 'open' | 'closed', reason?: IssueCloseReason) =>
      invoke('issues_set_state', { repoFullName, number, state, reason: reason ?? null }),
    repoOptions: (repoFullName: string) => invoke('issues_repo_options', { repoFullName }),
    setTask: (
      repoFullName: string,
      number: number,
      input: { index: number; checked: boolean; expectedBody: string }
    ) => invoke('issues_set_task', { repoFullName, number, input })
  },
  actions: {
    jobs: (repoFullName: string, runId: number) => invoke('actions_jobs', { repoFullName, runId }),
    jobLogs: (repoFullName: string, jobId: number) =>
      invoke<string>('actions_job_logs', { repoFullName, jobId }),
    workflowGraph: (repoFullName: string, runId: number) =>
      invoke('actions_workflow_graph', { repoFullName, runId }),
    cancelRun: (repoFullName: string, runId: number) => invoke('actions_cancel_run', { repoFullName, runId })
  },
  pulls: {
    list: (query: PullListQuery) => invoke('pulls_list', { query }),
    detail: (repoFullName: string, number: number) => invoke('pulls_detail', { repoFullName, number }),
    files: (repoFullName: string, number: number) => invoke('pulls_files', { repoFullName, number }),
    threads: (repoFullName: string, number: number) => invoke('pulls_threads', { repoFullName, number }),
    reviewState: (repoFullName: string, number: number) =>
      invoke('pulls_review_state', { repoFullName, number }),
    addReviewComment: (
      repoFullName: string,
      number: number,
      input: { anchor: ReviewAnchor; body: string; reviewedHeadSha: string }
    ) => invoke('pulls_review_comment', { repoFullName, number, input }),
    replyToReviewThread: (
      repoFullName: string,
      number: number,
      input: { threadId: string; body: string; reviewedHeadSha: string }
    ) => invoke('pulls_review_reply', { repoFullName, number, input }),
    setReviewThreadResolved: (repoFullName: string, number: number, threadId: string, resolved: boolean) =>
      invoke('pulls_review_resolve', { repoFullName, number, threadId, resolved }),
    submitReview: (
      repoFullName: string,
      number: number,
      input: { event: ReviewEvent; body: string; reviewedHeadSha: string }
    ) => invoke('pulls_review_submit', { repoFullName, number, input }),
    actions: (repoFullName: string, number: number) => invoke('pulls_actions', { repoFullName, number }),
    merge: (
      repoFullName: string,
      number: number,
      input: { method: MergeMethod; deleteBranch: boolean; expectedHeadSha: string }
    ) => invoke('pulls_merge', { repoFullName, number, input }),
    setAutoMerge: (
      repoFullName: string,
      number: number,
      input: { enabled: boolean; method?: MergeMethod; expectedHeadSha: string }
    ) => invoke('pulls_auto_merge', { repoFullName, number, input }),
    setDraft: (repoFullName: string, number: number, draft: boolean, expectedHeadSha: string) =>
      invoke('pulls_draft', { repoFullName, number, draft, expectedHeadSha }),
    runs: (repoFullName: string, number: number) => invoke('pulls_runs', { repoFullName, number }),
    rerun: (repoFullName: string, runId: number, mode: RerunMode, expectedHeadSha: string) =>
      invoke('pulls_rerun', { repoFullName, runId, mode, expectedHeadSha }),
    create: (repoFullName: string, input: PullCreateInput) => invoke('pulls_create', { repoFullName, input }),
    branches: (repoFullName: string) => invoke<string[]>('pulls_branches', { repoFullName })
  },
  inbox: {
    list: (query: InboxQuery) => invoke('inbox_list', { query })
  },
  search: {
    query: (request: SearchRequest) => invoke('search_query', { request })
  },
  projects: {
    list: () => invoke('projects_list'),
    detail: (projectId: string) => invoke('projects_detail', { projectId }),
    items: (projectId: string, filter: string) => invoke('projects_items', { projectId, filter }),
    itemMemberships: (repoFullName: string, number: number) =>
      invoke('projects_item_memberships', { repoFullName, number }),
    addItem: (projectId: string, repoFullName: string, number: number) =>
      invoke('projects_add_item', { projectId, repoFullName, number }),
    removeItem: (projectId: string, itemId: string) => invoke('projects_remove_item', { projectId, itemId }),
    moveItem: (projectId: string, itemId: string, afterId: string | null) =>
      invoke('projects_move_item', { projectId, itemId, afterId }),
    setField: (projectId: string, itemId: string, change: ProjectFieldChange) =>
      invoke('projects_set_field', { projectId, itemId, change })
  },
  markdown: {
    preview: (repoFullName: string, text: string) =>
      invoke<string>('markdown_preview', { repoFullName, text })
  },
  comments: {
    create: (repoFullName: string, number: number, body: string) =>
      invoke('comments_create', { repoFullName, number, body }),
    update: (repoFullName: string, commentId: number, body: string, baseUpdatedAt: string) =>
      invoke('comments_update', { repoFullName, commentId, body, baseUpdatedAt }),
    delete: (repoFullName: string, commentId: number) =>
      invoke<void>('comments_delete', { repoFullName, commentId })
  },
  attachments: {
    upload: (repoFullName: string, file: AttachmentFile, options: { acknowledgedPublic: boolean }) =>
      // Tauri sends plain JSON, so the bytes travel as an array of numbers.
      invoke('attachments_upload', {
        repoFullName,
        file: { name: file.name, bytes: Array.from(file.bytes) },
        options
      })
  },
  diagnostics: {
    record: (entry: { scope: string; code: string }) => invoke<void>('diagnostics_record', { entry }),
    getReport: () => invoke<string>('diagnostics_get_report')
  }
};

/** Subscribes to a backend event. Returns the unsubscribe function synchronously, as the renderer expects. */
function subscribe<T>(event: string, listener: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | undefined;
  let cancelled = false;
  void listen<T>(event, (e) => listener(e.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

function notPorted(group: string): unknown {
  return new Proxy(
    {},
    {
      get: (_target, method) => {
        const name = typeof method === 'string' ? method : String(method);
        if (name.startsWith('on')) return () => () => undefined;
        return () => Promise.reject(new Error(`${group}.${name} is not available`));
      }
    }
  );
}

export function installTauriBridge(): void {
  const api = new Proxy(ported as Record<string, unknown>, {
    get: (target, group) => {
      if (typeof group !== 'string') return undefined;
      return group in target ? target[group] : notPorted(group);
    }
  });
  window.orbit = api as unknown as OrbitApi;
}

/** Custom themes come back as stored. Older ones, and any damaged entry, are brought to the current shape here. */
function withThemes(settings: OrbitSettings): OrbitSettings {
  return { ...settings, customThemes: normalizeCustomThemes(settings.customThemes) };
}
