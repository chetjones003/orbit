import { describe, expect, it } from 'vitest';
import { describeConnection, writesAllowed, type ConnectionStatus } from '../../../src/shared/connection';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const base = { lastSuccessAt: NOW - 2 * 60_000, nextRetryAt: null } satisfies Partial<ConnectionStatus>;

describe('describeConnection', () => {
  it('stays quiet when data is fresh', () => {
    expect(describeConnection({ state: 'fresh', ...base }, NOW)).toBeNull();
    expect(describeConnection({ state: 'idle', lastSuccessAt: null, nextRetryAt: null }, NOW)).toBeNull();
  });

  it('shows offline with the last successful refresh and the next retry', () => {
    const message = describeConnection({ state: 'offline', ...base, nextRetryAt: NOW + 60_000 }, NOW);
    expect(message).toMatchObject({ tone: 'warning' });
    expect(message?.text).toContain('Offline');
    expect(message?.text).toContain('Last updated 2 min ago');
    expect(message?.text).toContain('Retrying in 1 min');
  });

  it('explains a rate limit and when it lifts', () => {
    const message = describeConnection(
      { state: 'rate-limited', ...base, nextRetryAt: NOW + 10 * 60_000 },
      NOW
    );
    expect(message?.text).toContain('GitHub rate limit');
    expect(message?.text).toContain('Retrying in 10 min');
  });

  it('marks stale data without inventing a retry time', () => {
    const message = describeConnection({ state: 'stale', ...base }, NOW);
    expect(message?.text).toContain('Data may be out of date');
    expect(message?.text).not.toContain('Retrying');
  });
});

describe('writesAllowed', () => {
  it('disables writes while offline or rate-limited, since outcomes cannot be trusted', () => {
    expect(writesAllowed({ state: 'fresh', ...base })).toBe(true);
    expect(writesAllowed({ state: 'stale', ...base })).toBe(true);
    expect(writesAllowed({ state: 'offline', ...base })).toBe(false);
    expect(writesAllowed({ state: 'rate-limited', ...base })).toBe(false);
  });
});
