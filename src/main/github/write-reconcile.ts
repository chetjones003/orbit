import { GitHubRequestError } from './github-client';

export type ReconcileResult<T> = { applied: true; value: T } | { applied: false };

export interface RunWriteOptions<T> {
  /** Sends the write once. */
  attempt: () => Promise<T>;
  /**
   * Asks GitHub whether a write with an uncertain outcome already landed, for
   * example by looking for the comment or label it would have created.
   */
  reconcile: () => Promise<ReconcileResult<T>>;
  maxAttempts?: number;
}

/**
 * Runs a GitHub write. When the outcome is uncertain (the request may or may
 * not have reached GitHub), it checks GitHub before retrying so the same edit
 * is never applied twice. Definite rejections are thrown without retry.
 */
export async function runWrite<T>(options: RunWriteOptions<T>): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await options.attempt();
    } catch (error) {
      if (!(error instanceof GitHubRequestError) || error.kind !== 'transient') throw error;
      lastError = error;
      const reconciled = await options.reconcile();
      if (reconciled.applied) return reconciled.value;
    }
  }
  throw lastError;
}
