import type { ConnectionStatus, RefreshStart } from '../../shared/connection';
import { GitHubRequestError } from './github-client';
export type { ConnectionState, ConnectionStatus, RefreshStart } from '../../shared/connection';

export type RefreshOutcome = { pollIntervalMs?: number } | void;

export interface RefreshEngineOptions {
  /** Loads the visible data. Throws GitHubRequestError for classified failures. */
  refresh: () => Promise<RefreshOutcome>;
  now?: () => number;
  intervalMs?: number;
  maxBackoffMs?: number;
  manualCooldownMs?: number;
}

const MINUTE = 60_000;

/**
 * Keeps visible data current while the app runs. Automatic refreshes run every
 * minute, slow down when GitHub asks, back off on transient failures, and wait
 * for a rate-limit reset. Manual refreshes respect the same limits.
 */
export class RefreshEngine {
  private readonly refreshFn: RefreshEngineOptions['refresh'];
  private readonly now: () => number;
  private readonly intervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly manualCooldownMs: number;
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();
  private status: ConnectionStatus = { state: 'idle', lastSuccessAt: null, nextRetryAt: null };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private running = false;
  private consecutiveFailures = 0;
  private lastManualAt: number | null = null;

  constructor(options: RefreshEngineOptions) {
    this.refreshFn = options.refresh;
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? MINUTE;
    this.maxBackoffMs = options.maxBackoffMs ?? 5 * MINUTE;
    this.manualCooldownMs = options.manualCooldownMs ?? 30_000;
  }

  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  onChange(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.begin();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Runs a refresh now unless the limits in force forbid it. Never throws. */
  refreshNow(): Promise<RefreshStart> {
    if (this.inFlight) return Promise.resolve({ started: false, reason: 'in-flight' });
    const now = this.now();
    if (
      this.status.state === 'rate-limited' &&
      this.status.nextRetryAt !== null &&
      now < this.status.nextRetryAt
    ) {
      return Promise.resolve({ started: false, reason: 'rate-limited', retryAt: this.status.nextRetryAt });
    }
    if (this.lastManualAt !== null && now - this.lastManualAt < this.manualCooldownMs) {
      return Promise.resolve({
        started: false,
        reason: 'cooldown',
        retryAt: this.lastManualAt + this.manualCooldownMs
      });
    }
    this.lastManualAt = now;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.begin().then(() => ({ started: true as const }));
  }

  private begin(): Promise<void> {
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    try {
      const outcome = await this.refreshFn();
      this.consecutiveFailures = 0;
      const now = this.now();
      const pollIntervalMs = outcome?.pollIntervalMs ?? 0;
      const delay = Math.max(this.intervalMs, pollIntervalMs);
      this.set({ state: 'fresh', lastSuccessAt: now, nextRetryAt: now + delay });
      this.schedule(delay);
    } catch (error) {
      this.handleFailure(error);
    }
  }

  private handleFailure(error: unknown): void {
    const now = this.now();
    if (error instanceof GitHubRequestError && error.kind === 'rate-limited') {
      const retryAt =
        error.resetAt ??
        (error.retryAfterMs !== undefined ? now + error.retryAfterMs : now + this.intervalMs);
      this.set({ state: 'rate-limited', lastSuccessAt: this.status.lastSuccessAt, nextRetryAt: retryAt });
      this.schedule(retryAt - now);
      return;
    }
    if (error instanceof GitHubRequestError && error.kind === 'transient') {
      this.consecutiveFailures += 1;
      const delay = Math.min(this.intervalMs * 2 ** (this.consecutiveFailures - 1), this.maxBackoffMs);
      this.set({ state: 'offline', lastSuccessAt: this.status.lastSuccessAt, nextRetryAt: now + delay });
      this.schedule(delay);
      return;
    }
    this.set({
      state: 'stale',
      lastSuccessAt: this.status.lastSuccessAt,
      nextRetryAt: now + this.intervalMs
    });
    this.schedule(this.intervalMs);
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (!this.inFlight) this.begin();
      },
      Math.max(0, delayMs)
    );
  }

  private set(next: ConnectionStatus): void {
    this.status = next;
    for (const listener of this.listeners) listener({ ...next });
  }
}
