import { GitHubRequestError } from './github-client';

export type ReconcileResult<T> = { applied: true; value: T } | { applied: false };

/** Thrown before any request is sent while writes are paused. Nothing reaches GitHub. */
export class WriteBlockedError extends Error {
  constructor() {
    super('Changes are paused until GitHub is reachable again.');
    this.name = 'WriteBlockedError';
  }
}

export interface RunWriteOptions<T> {
  /** Sends the write once. */
  attempt: () => Promise<T>;
  /**
   * Asks GitHub whether a write with an uncertain outcome already landed, for
   * example by looking for the comment or label it would have created.
   */
  reconcile: () => Promise<ReconcileResult<T>>;
  maxAttempts?: number;
  /** False while GitHub is unreachable or rate limiting; the write is then refused outright. */
  canWrite?: () => boolean;
  /** Runs once the write is known to have landed, so the visible data can be refreshed. */
  onSettled?: () => void;
}

/**
 * Runs a GitHub write. When the outcome is uncertain (the request may or may
 * not have reached GitHub), it checks GitHub before retrying so the same edit
 * is never applied twice. Definite rejections are thrown without retry.
 */
export async function runWrite<T>(options: RunWriteOptions<T>): Promise<T> {
  if (options.canWrite && !options.canWrite()) throw new WriteBlockedError();
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await options.attempt();
      options.onSettled?.();
      return value;
    } catch (error) {
      if (!(error instanceof GitHubRequestError) || error.kind !== 'transient') throw error;
      lastError = error;
      const reconciled = await options.reconcile();
      if (reconciled.applied) {
        options.onSettled?.();
        return reconciled.value;
      }
    }
  }
  throw lastError;
}
