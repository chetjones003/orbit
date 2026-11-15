import {
  isEligibleUpdate,
  UPDATE_CHECK_INTERVAL_MS,
  type ReleaseFile,
  type UpdateStatus
} from '../../shared/updates';

/** A newer release as GitHub Releases describes it. */
export interface RemoteRelease {
  version: string;
  releaseNotes: string | null;
  files: ReleaseFile[];
}

/** What `prepare` returns: the status to show, plus whatever `apply` needs later. */
export interface PreparedUpdate {
  status: Extract<UpdateStatus, { kind: 'ready' | 'mac-opened' }>;
  /** Applies this update: restart, install, or nothing more (the DMG is already open). Runs only after confirmation. */
  install: () => Promise<void>;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  /** Asks GitHub for the latest stable release. Null when none is newer or reachable. */
  check: () => Promise<RemoteRelease | null>;
  /** Downloads the release for this install. Reports progress via `onProgress` (0-100). */
  prepare: (release: RemoteRelease, onProgress: (percent: number) => void) => Promise<PreparedUpdate>;
  intervalMs?: number;
  now?: () => number;
}

/**
 * Keeps Orbit's installed copy current. Checks on start and on a fixed interval, downloads at most one
 * eligible release at a time, and applies it only when the user confirms. Never offers prereleases or
 * older versions.
 */
export class UpdateService {
  private readonly options: UpdateServiceOptions;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly listeners = new Set<(status: UpdateStatus) => void>();
  private status: UpdateStatus = { kind: 'idle' };
  private prepared: PreparedUpdate | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<UpdateStatus> | null = null;

  constructor(options: UpdateServiceOptions) {
    this.options = options;
    this.intervalMs = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  onChange(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Checks now, then every interval until stop(). */
  start(): void {
    if (this.timer) return;
    void this.checkNow();
    this.timer = setInterval(() => void this.checkNow(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Looks for an update. Never throws; failures become an error status. */
  checkNow(): Promise<UpdateStatus> {
    // Once an update is ready, further checks would only re-download the same release.
    if (this.prepared) return Promise.resolve(this.status);
    // Startup and the interval can overlap; they share one check rather than downloading twice.
    this.inFlight ??= this.runCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runCheck(): Promise<UpdateStatus> {
    this.set({ kind: 'checking' });
    try {
      const release = await this.options.check();
      if (!release || !isEligibleUpdate(release.version, this.options.currentVersion)) {
        this.set({ kind: 'up-to-date', checkedAt: this.now() });
        return this.status;
      }
      this.set({ kind: 'downloading', version: release.version, percent: 0 });
      const prepared = await this.options.prepare(release, (percent) => {
        if (this.status.kind === 'downloading') this.set({ ...this.status, percent });
      });
      this.prepared = prepared;
      this.set(prepared.status);
    } catch {
      // The message stays generic: error text from a network stack can carry URLs or account details.
      this.set({ kind: 'error', message: 'Orbit could not check for or download an update.' });
    }
    return this.status;
  }

  /** Applies the prepared update. Called only after the user has confirmed. */
  async install(): Promise<void> {
    if (!this.prepared) throw new Error('No update is ready to install');
    await this.prepared.install();
  }

  private set(status: UpdateStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
