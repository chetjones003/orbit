import type { AuthStatus } from './auth';

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
  authStatusChanged: 'auth:status-changed'
} as const;

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
