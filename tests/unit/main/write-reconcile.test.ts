import { describe, expect, it, vi } from 'vitest';
import { GitHubRequestError } from '../../../src/main/github/github-client';
import { runWrite } from '../../../src/main/github/write-reconcile';

const uncertain = () => new GitHubRequestError('transient', 'GitHub could not be reached.');

describe('runWrite', () => {
  it('returns the result without reconciling when the write succeeds', async () => {
    const reconcile = vi.fn();
    await expect(runWrite({ attempt: async () => 'created', reconcile })).resolves.toBe('created');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('accepts the server-side result when an uncertain write already landed', async () => {
    const attempt = vi.fn().mockRejectedValue(uncertain());
    const reconcile = vi.fn(async () => ({ applied: true as const, value: 'found-existing' }));

    await expect(runWrite({ attempt, reconcile })).resolves.toBe('found-existing');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('retries an uncertain write only after reconciling shows it did not land', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(uncertain()).mockResolvedValueOnce('sent');
    const reconcile = vi.fn(async () => ({ applied: false as const }));

    await expect(runWrite({ attempt, reconcile })).resolves.toBe('sent');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('does not reconcile or retry definite rejections', async () => {
    const rejected = new GitHubRequestError('http', 'GitHub returned 422.', { status: 422 });
    const attempt = vi.fn().mockRejectedValue(rejected);
    const reconcile = vi.fn();

    await expect(runWrite({ attempt, reconcile })).rejects.toBe(rejected);
    expect(reconcile).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('gives up with the last error after the attempts are exhausted', async () => {
    const error = uncertain();
    const attempt = vi.fn().mockRejectedValue(error);
    const reconcile = vi.fn(async () => ({ applied: false as const }));

    await expect(runWrite({ attempt, reconcile, maxAttempts: 2 })).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});

describe('runWrite gate and settle hook', () => {
  it('refuses to send while writes are paused, so nothing reaches GitHub', async () => {
    const attempt = vi.fn(async () => 'sent');
    await expect(runWrite({ attempt, reconcile: vi.fn(), canWrite: () => false })).rejects.toMatchObject({
      name: 'WriteBlockedError'
    });
    expect(attempt).not.toHaveBeenCalled();
  });

  it('calls onSettled after a successful write so data can be refreshed', async () => {
    const onSettled = vi.fn();
    await runWrite({ attempt: async () => 'ok', reconcile: vi.fn(), onSettled });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('calls onSettled when reconciliation shows the write landed', async () => {
    const onSettled = vi.fn();
    await runWrite({
      attempt: async () => {
        throw new GitHubRequestError('transient', 'unreachable');
      },
      reconcile: async () => ({ applied: true, value: 'found' }),
      onSettled
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('does not call onSettled when the write fails outright', async () => {
    const onSettled = vi.fn();
    await expect(
      runWrite({
        attempt: async () => {
          throw new GitHubRequestError('http', 'rejected', { status: 422 });
        },
        reconcile: vi.fn(),
        onSettled
      })
    ).rejects.toThrow('rejected');
    expect(onSettled).not.toHaveBeenCalled();
  });
});
