import { isRateLimitedAt, type ConnectionStatus, type RefreshStart } from '../../shared/connection';
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
  /** False while signed out; a manual refresh then never reaches GitHub. */
  canRefresh?: () => boolean;
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
  private readonly canRefresh: () => boolean;
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();
  private status: ConnectionStatus = { state: 'idle', lastSuccessAt: null, nextRetryAt: null };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private running = false;
  /** Bumped by stop() so results from a refresh started before stop are discarded. */
  private generation = 0;
  private consecutiveFailures = 0;
  private lastManualAt: number | null = null;

  constructor(options: RefreshEngineOptions) {
    this.refreshFn = options.refresh;
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? MINUTE;
    this.maxBackoffMs = options.maxBackoffMs ?? 5 * MINUTE;
    this.manualCooldownMs = options.manualCooldownMs ?? 30_000;
    this.canRefresh = options.canRefresh ?? (() => true);
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
    if (!this.inFlight) void this.begin();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Runs a refresh now unless the limits in force forbid it. Never throws. */
  refreshNow(): Promise<RefreshStart> {
    if (!this.canRefresh()) return Promise.resolve({ started: false, reason: 'signed-out' });
    if (this.inFlight) return Promise.resolve({ started: false, reason: 'in-flight' });
    const now = this.now();
    if (isRateLimitedAt(this.status, now) && this.status.nextRetryAt !== null) {
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

  /**
   * Retries now after a suspected outage (system resume, network back). Ignores
   * backoff and the manual cooldown, but still honours rate limits, in-flight
   * refreshes, and sign-out, so it cannot be used to hammer GitHub.
   */
  wake(): Promise<RefreshStart> {
    if (!this.canRefresh()) return Promise.resolve({ started: false, reason: 'signed-out' });
    if (this.inFlight) return Promise.resolve({ started: false, reason: 'in-flight' });
    const now = this.now();
    if (isRateLimitedAt(this.status, now) && this.status.nextRetryAt !== null) {
      return Promise.resolve({ started: false, reason: 'rate-limited', retryAt: this.status.nextRetryAt });
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.begin().then(() => ({ started: true as const }));
  }

  private begin(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    const generation = this.generation;
    let outcome: RefreshOutcome;
    try {
      outcome = await this.refreshFn();
    } catch (error) {
      if (generation === this.generation) this.handleFailure(error);
      return;
    }
    // A refresh that finishes after stop() must not overwrite the signed-out state.
    if (generation !== this.generation) return;
    this.consecutiveFailures = 0;
    const now = this.now();
    const delay = Math.max(this.intervalMs, outcome?.pollIntervalMs ?? 0);
    this.setState('fresh', now + delay, now);
    this.schedule(delay);
  }

  private handleFailure(error: unknown): void {
    const now = this.now();
    if (error instanceof GitHubRequestError && error.kind === 'rate-limited') {
      const reset =
        error.resetAt ??
        (error.retryAfterMs !== undefined ? now + error.retryAfterMs : now + this.intervalMs);
      // A reset time in the past must not produce a zero-delay retry loop.
      const retryAt = Math.max(reset, now + this.intervalMs);
      this.setState('rate-limited', retryAt);
      this.schedule(retryAt - now);
      return;
    }
    if (error instanceof GitHubRequestError && error.kind === 'transient') {
      this.consecutiveFailures += 1;
      const delay = Math.min(this.intervalMs * 2 ** (this.consecutiveFailures - 1), this.maxBackoffMs);
      this.setState('offline', now + delay);
      this.schedule(delay);
      return;
    }
    this.setState('stale', now + this.intervalMs);
    this.schedule(this.intervalMs);
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.begin();
      },
      Math.max(0, delayMs)
    );
  }

  /** Keeps lastSuccessAt across failures; a successful refresh passes its own time. */
  private setState(state: ConnectionStatus['state'], nextRetryAt: number, successAt?: number): void {
    const lastSuccessAt = successAt ?? this.status.lastSuccessAt;
    this.status = { state, lastSuccessAt, nextRetryAt };
    for (const listener of this.listeners) listener({ ...this.status });
  }
}
