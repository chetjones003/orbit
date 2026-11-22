import type { PullCheck } from '../../../shared/issues';

/**
 * How ready a pull request is to merge, as the merge button shows it.
 * - `ready`: GitHub says it is clean, every check passed, and no review thread is unresolved.
 * - `caution`: GitHub allows the merge, but something optional is not done (checks pending or failing,
 *   unresolved threads, branch behind, mergeability still being computed).
 * - `blocked`: GitHub will refuse the merge (conflicts, a required check or review, a draft).
 */
export type MergeTone = 'ready' | 'caution' | 'blocked';

export interface MergeReadiness {
  tone: MergeTone;
  /** Why it is not `ready`, in the order a reader should fix them. Empty when ready. */
  reasons: string[];
}

export interface MergeReadinessInput {
  draft: boolean;
  mergeable: boolean | null;
  mergeableState: string;
  checks: PullCheck[];
  /** Unresolved review threads, or null while they load. */
  unresolvedThreads: number | null;
  /** Merge methods the repo allows; none means nothing can merge. */
  allowedMethods: number;
}

const PASSED = new Set(['success', 'neutral', 'skipped']);

export function mergeReadiness(input: MergeReadinessInput): MergeReadiness {
  const blocked: string[] = [];
  if (input.draft) blocked.push('Draft pull request');
  if (input.mergeable === false || input.mergeableState === 'dirty') blocked.push('Has merge conflicts');
  else if (input.mergeableState === 'blocked') blocked.push('Blocked by a required check or review');
  if (input.allowedMethods === 0) blocked.push('No merge method is allowed');
  if (blocked.length > 0) return { tone: 'blocked', reasons: blocked };

  const caution: string[] = [];
  const failing = input.checks.filter(
    (check) => check.status === 'completed' && !PASSED.has(check.conclusion ?? '')
  );
  const pending = input.checks.filter((check) => check.status !== 'completed');
  if (failing.length > 0) caution.push(`${failing.length} ${plural(failing.length, 'check')} failing`);
  if (pending.length > 0) caution.push(`${pending.length} ${plural(pending.length, 'check')} running`);
  if (input.unresolvedThreads === null) caution.push('Loading review threads');
  else if (input.unresolvedThreads > 0)
    caution.push(`${input.unresolvedThreads} unresolved ${plural(input.unresolvedThreads, 'thread')}`);
  if (input.mergeable === null || input.mergeableState === 'unknown') caution.push('Checking mergeability');
  else if (input.mergeableState === 'behind') caution.push('Branch is behind its base');
  else if (input.mergeableState !== 'clean' && input.mergeableState !== 'has_hooks' && caution.length === 0)
    caution.push(`GitHub reports the merge as ${input.mergeableState}`);

  return caution.length > 0 ? { tone: 'caution', reasons: caution } : { tone: 'ready', reasons: [] };
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
