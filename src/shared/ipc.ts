import type { AuthStatus } from './auth';
import type { ConnectionStatus, RefreshStart } from './connection';

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

/**
 * Validates an external URL before it leaves the app. Only absolute https
 * URLs without embedded credentials are allowed.
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
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url;
}
