import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubRequestError } from '../../../src/main/github/github-client';
import { RefreshEngine } from '../../../src/main/github/refresh-engine';

const MINUTE = 60_000;

describe('RefreshEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes visible data on start and every 60 seconds, reporting fresh', async () => {
    const refresh = vi.fn(async () => undefined);
    const engine = new RefreshEngine({ refresh });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.getStatus()).toMatchObject({ state: 'fresh', lastSuccessAt: Date.now() });

    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(refresh).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it('honours a longer X-Poll-Interval returned by a refresh', async () => {
    const refresh = vi.fn(async () => ({ pollIntervalMs: 5 * MINUTE }));
    const engine = new RefreshEngine({ refresh });

    engine.start();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it('goes offline on transient failures and backs off exponentially up to five minutes', async () => {
    const refresh = vi.fn(async () => {
      throw new GitHubRequestError('transient', 'GitHub could not be reached.');
    });
    const engine = new RefreshEngine({ refresh });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getStatus()).toMatchObject({ state: 'offline', nextRetryAt: Date.now() + MINUTE });
    // Retry delays after each consecutive failure: 1, 2, 4, then 5 minutes (capped).
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(5);
    expect(engine.getStatus().nextRetryAt).toBe(Date.now() + 5 * MINUTE);
    engine.stop();
  });

  it('waits for the rate-limit reset before retrying and reports rate-limited', async () => {
    const resetAt = Date.now() + 10 * MINUTE;
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new GitHubRequestError('rate-limited', 'limit', { status: 403, resetAt }))
      .mockResolvedValue(undefined);
    const engine = new RefreshEngine({ refresh });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getStatus()).toMatchObject({ state: 'rate-limited', nextRetryAt: resetAt });

    await vi.advanceTimersByTimeAsync(9 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(engine.getStatus().state).toBe('fresh');
    engine.stop();
  });

  it('keeps the last successful refresh time visible after a later failure', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new GitHubRequestError('http', 'boom', { status: 500 }));
    const engine = new RefreshEngine({ refresh });
    const successAt = Date.now();

    engine.start();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(engine.getStatus()).toMatchObject({ state: 'stale', lastSuccessAt: successAt });
    engine.stop();
  });

  it('runs a manual refresh and then enforces the cooldown', async () => {
    const refresh = vi.fn(async () => undefined);
    const engine = new RefreshEngine({ refresh, manualCooldownMs: 15_000 });

    await expect(engine.refreshNow()).resolves.toEqual({ started: true });
    await expect(engine.refreshNow()).resolves.toMatchObject({ started: false, reason: 'cooldown' });
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(engine.refreshNow()).resolves.toEqual({ started: true });
    engine.stop();
  });

  it('refuses a manual refresh while a rate limit is in force', async () => {
    const resetAt = Date.now() + 10 * MINUTE;
    const refresh = vi
      .fn()
      .mockRejectedValue(new GitHubRequestError('rate-limited', 'limit', { status: 429, resetAt }));
    const engine = new RefreshEngine({ refresh });

    await engine.refreshNow();
    await expect(engine.refreshNow()).resolves.toMatchObject({ started: false, reason: 'rate-limited' });
    expect(refresh).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('never runs two refreshes at once', async () => {
    let release: () => void = () => undefined;
    const refresh = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const engine = new RefreshEngine({ refresh });

    const first = engine.refreshNow();
    await expect(engine.refreshNow()).resolves.toMatchObject({ started: false, reason: 'in-flight' });
    release();
    await expect(first).resolves.toEqual({ started: true });
    engine.stop();
  });

  it('notifies listeners of each status change and stops on request', async () => {
    const refresh = vi.fn(async () => undefined);
    const engine = new RefreshEngine({ refresh });
    const listener = vi.fn();
    engine.onChange(listener);

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'fresh' }));

    engine.stop();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('RefreshEngine lifecycle and limits', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never schedules a retry earlier than the normal interval, even if the reset time has passed', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(
        new GitHubRequestError('rate-limited', 'limit', { status: 429, resetAt: Date.now() - 1000 })
      )
      .mockResolvedValue(undefined);
    const engine = new RefreshEngine({ refresh });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getStatus().nextRetryAt).toBe(Date.now() + MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('discards a refresh that finishes after stop, so signed-out state is not overwritten', async () => {
    let release: () => void = () => undefined;
    const refresh = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const engine = new RefreshEngine({ refresh });

    engine.start();
    engine.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getStatus()).toMatchObject({ state: 'idle', lastSuccessAt: null });
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not start a second refresh when started while one is already in flight', async () => {
    let release: () => void = () => undefined;
    const refresh = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const engine = new RefreshEngine({ refresh });

    void engine.refreshNow();
    engine.start();
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    engine.stop();
  });
});

describe('RefreshEngine sign-in guard', () => {
  it('refuses a manual refresh while signed out and never calls GitHub', async () => {
    const refresh = vi.fn(async () => undefined);
    const engine = new RefreshEngine({ refresh, canRefresh: () => false });

    await expect(engine.refreshNow()).resolves.toEqual({ started: false, reason: 'signed-out' });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('RefreshEngine wake', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries at once after an outage, without waiting out the backoff', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new GitHubRequestError('transient', 'unreachable'))
      .mockResolvedValue(undefined);
    const engine = new RefreshEngine({ refresh });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getStatus().state).toBe('offline');

    await expect(engine.wake()).resolves.toEqual({ started: true });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(engine.getStatus().state).toBe('fresh');
    engine.stop();
  });

  it('still respects a rate limit that is in force', async () => {
    const resetAt = Date.now() + 10 * MINUTE;
    const refresh = vi
      .fn()
      .mockRejectedValue(new GitHubRequestError('rate-limited', 'limit', { status: 403, resetAt }));
    const engine = new RefreshEngine({ refresh });

    await engine.refreshNow();
    await expect(engine.wake()).resolves.toMatchObject({ started: false, reason: 'rate-limited' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not overlap a refresh that is already running', async () => {
    let release: () => void = () => undefined;
    const refresh = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const engine = new RefreshEngine({ refresh });

    void engine.refreshNow();
    await expect(engine.wake()).resolves.toMatchObject({ started: false, reason: 'in-flight' });
    release();
  });

  it('does nothing while signed out', async () => {
    const refresh = vi.fn(async () => undefined);
    const engine = new RefreshEngine({ refresh, canRefresh: () => false });

    await expect(engine.wake()).resolves.toEqual({ started: false, reason: 'signed-out' });
    expect(refresh).not.toHaveBeenCalled();
  });
});
