export type ConnectionState = 'idle' | 'fresh' | 'stale' | 'offline' | 'rate-limited';

/**
 * What the renderer shows in the status banner. Contains no GitHub content,
 * only timing and state, so it is safe to send over IPC and to log.
 */
export interface ConnectionStatus {
  state: ConnectionState;
  /** Epoch ms of the last successful refresh, kept while data is stale or offline. */
  lastSuccessAt: number | null;
  /** Epoch ms of the next automatic attempt, when known. */
  nextRetryAt: number | null;
}

export interface BannerMessage {
  tone: 'warning' | 'info';
  text: string;
}

/** Writes are disabled when GitHub cannot be reached or is rate limiting, because outcomes are uncertain. */
export function writesAllowed(status: ConnectionStatus): boolean {
  return status.state !== 'offline' && status.state !== 'rate-limited';
}

/** Banner copy for a connection state. Returns null when nothing needs saying. */
export function describeConnection(status: ConnectionStatus, now: number): BannerMessage | null {
  if (status.state === 'fresh' || status.state === 'idle') return null;
  const updated =
    status.lastSuccessAt === null
      ? 'Not updated yet'
      : `Last updated ${minutesAgo(now - status.lastSuccessAt)}`;
  const retry = status.nextRetryAt === null ? '' : ` Retrying in ${minutesUntil(status.nextRetryAt - now)}.`;
  switch (status.state) {
    case 'offline':
      return { tone: 'warning', text: `Offline. ${updated}.${retry} Changes are paused.` };
    case 'rate-limited':
      return { tone: 'warning', text: `GitHub rate limit reached. ${updated}.${retry} Changes are paused.` };
    case 'stale':
      return { tone: 'info', text: `Data may be out of date. ${updated}.` };
  }
}

function minutesAgo(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return minutes === 0 ? 'just now' : `${minutes} min ago`;
}

function minutesUntil(ms: number): string {
  return `${Math.max(1, Math.ceil(ms / 60_000))} min`;
}

/** Result of asking for a refresh. `started: false` says why it did not run. */
export type RefreshStart =
  | { started: true }
  | { started: false; reason: 'in-flight' | 'cooldown' | 'rate-limited' | 'signed-out'; retryAt?: number };

/** True while GitHub has asked Orbit to wait. Used by both the engine and the renderer, so they agree. */
export function isRateLimitedAt(status: ConnectionStatus, now: number): boolean {
  return status.state === 'rate-limited' && status.nextRetryAt !== null && now < status.nextRetryAt;
}
