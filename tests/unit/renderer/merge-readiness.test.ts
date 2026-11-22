import { describe, expect, it } from 'vitest';
import { mergeReadiness, type MergeReadinessInput } from '../../../src/renderer/src/issues/merge-readiness';

function input(overrides: Partial<MergeReadinessInput> = {}): MergeReadinessInput {
  return {
    draft: false,
    mergeable: true,
    mergeableState: 'clean',
    checks: [{ name: 'CI', status: 'completed', conclusion: 'success', detailsUrl: null }],
    unresolvedThreads: 0,
    allowedMethods: 2,
    ...overrides
  };
}

describe('mergeReadiness', () => {
  it('is ready when GitHub says clean, every check passed, and no thread is open', () => {
    expect(mergeReadiness(input())).toEqual({ tone: 'ready', reasons: [] });
  });

  it('counts skipped and neutral checks as passed', () => {
    const checks = [
      { name: 'a', status: 'completed', conclusion: 'skipped', detailsUrl: null },
      { name: 'b', status: 'completed', conclusion: 'neutral', detailsUrl: null }
    ];
    expect(mergeReadiness(input({ checks })).tone).toBe('ready');
  });

  it('is a caution when a check fails or runs, a thread is open, or the branch is behind', () => {
    const failing = mergeReadiness(
      input({
        mergeableState: 'unstable',
        checks: [
          { name: 'a', status: 'completed', conclusion: 'failure', detailsUrl: null },
          { name: 'b', status: 'in_progress', conclusion: null, detailsUrl: null }
        ],
        unresolvedThreads: 2
      })
    );
    expect(failing).toEqual({
      tone: 'caution',
      reasons: ['1 check failing', '1 check running', '2 unresolved threads']
    });
    expect(mergeReadiness(input({ mergeableState: 'behind' })).reasons).toEqual([
      'Branch is behind its base'
    ]);
    expect(mergeReadiness(input({ mergeable: null, mergeableState: 'unknown' })).tone).toBe('caution');
  });

  it('is blocked by conflicts, a required check or review, a draft, or no allowed method', () => {
    expect(mergeReadiness(input({ mergeable: false, mergeableState: 'dirty' })).tone).toBe('blocked');
    expect(mergeReadiness(input({ mergeableState: 'blocked' })).reasons).toEqual([
      'Blocked by a required check or review'
    ]);
    expect(mergeReadiness(input({ draft: true })).tone).toBe('blocked');
    expect(mergeReadiness(input({ allowedMethods: 0 })).tone).toBe('blocked');
  });
});
