import { describe, expect, it } from 'vitest';
import { linksFromTimeline, toLinkedCommit } from '../../../src/main/github/issue-links';

const SHA_A = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
const SHA_B = 'b1c2d3e4f5a6b7c8d9e0b1c2d3e4f5a6b7c8d9e0';

function pullSource(number: number, overrides: Record<string, unknown> = {}) {
  return {
    type: 'issue',
    issue: {
      number,
      title: `Pull ${number}`,
      state: 'open',
      html_url: `https://github.com/orbit-owner/app/pull/${number}`,
      user: { login: 'someone' },
      pull_request: { url: `https://api.github.test/repos/orbit-owner/app/pulls/${number}` },
      ...overrides
    }
  };
}

describe('linksFromTimeline', () => {
  it('reads cross-referenced and connected pull requests of this repository, newest first', () => {
    const links = linksFromTimeline(
      [
        { event: 'cross-referenced', source: pullSource(12) },
        { event: 'connected', source: pullSource(30) },
        { event: 'labeled' }
      ],
      'orbit-owner',
      'app'
    );
    expect(links.pulls.map((pull) => pull.number)).toEqual([30, 12]);
    expect(links.pulls[0]).toEqual({
      number: 30,
      title: 'Pull 30',
      state: 'open',
      merged: false,
      htmlUrl: 'https://github.com/orbit-owner/app/pull/30',
      authorLogin: 'someone'
    });
  });

  it('leaves out issues, pull requests from other repositories, and malformed sources', () => {
    const links = linksFromTimeline(
      [
        { event: 'cross-referenced', source: pullSource(1, { pull_request: undefined }) },
        {
          event: 'cross-referenced',
          source: pullSource(2, { html_url: 'https://github.com/someone-else/app/pull/2' })
        },
        { event: 'connected', source: { type: 'commit' } },
        { event: 'connected', source: null },
        null
      ],
      'orbit-owner',
      'app'
    );
    expect(links.pulls).toEqual([]);
  });

  it('uses the latest state of a pull request, and reports a merged one as merged', () => {
    const links = linksFromTimeline(
      [
        { event: 'cross-referenced', source: pullSource(7) },
        {
          event: 'connected',
          source: pullSource(7, {
            state: 'closed',
            pull_request: { merged_at: '2026-02-01T00:00:00Z' }
          })
        }
      ],
      'orbit-owner',
      'app'
    );
    expect(links.pulls).toHaveLength(1);
    expect(links.pulls[0]).toMatchObject({ state: 'closed', merged: true });
  });

  it('collects commits from referenced and closed events, oldest first, without repeats', () => {
    const links = linksFromTimeline(
      [
        { event: 'referenced', commit_id: SHA_A },
        { event: 'closed', commit_id: SHA_B },
        { event: 'referenced', commit_id: SHA_A },
        { event: 'closed', commit_id: null },
        { event: 'referenced', commit_id: 'not-a-sha' }
      ],
      'orbit-owner',
      'app'
    );
    expect(links.commitShas).toEqual([SHA_A, SHA_B]);
  });
});

describe('toLinkedCommit', () => {
  it('keeps the first line of the message and the author', () => {
    expect(
      toLinkedCommit({
        sha: SHA_A,
        html_url: `https://github.com/orbit-owner/app/commit/${SHA_A}`,
        commit: {
          message: 'Fix the thing (#12)\n\nLonger body that is not shown.',
          author: { name: 'Chet Jones', date: '2026-03-04T10:00:00Z' }
        },
        author: { login: 'chetjones003' }
      })
    ).toEqual({
      sha: SHA_A,
      message: 'Fix the thing (#12)',
      authorLogin: 'chetjones003',
      authorName: 'Chet Jones',
      committedAt: '2026-03-04T10:00:00Z',
      htmlUrl: `https://github.com/orbit-owner/app/commit/${SHA_A}`
    });
  });

  it('shows a commit whose author has no GitHub account by name', () => {
    expect(
      toLinkedCommit({
        sha: SHA_A,
        html_url: 'https://github.com/orbit-owner/app/commit/x',
        commit: { message: 'Old commit', author: { name: 'Someone', date: '2025-01-01T00:00:00Z' } },
        author: null
      })
    ).toMatchObject({ authorLogin: null, authorName: 'Someone' });
  });

  it('drops a response that is missing the sha, the link, or the message', () => {
    expect(toLinkedCommit({ sha: SHA_A, html_url: 'x' })).toBeNull();
    expect(toLinkedCommit(null)).toBeNull();
  });
});
