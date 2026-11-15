// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PullDiffView } from '../../../src/renderer/src/issues/PullDiff';
import type { PullFile, PullReviewThread } from '../../../src/shared/issues';

function file(overrides: Partial<PullFile> = {}): PullFile {
  return {
    filename: 'src/a.ts',
    previousFilename: null,
    status: 'modified',
    additions: 1,
    deletions: 1,
    patch: '@@ -1,2 +1,2 @@\n-old line\n+new line\n same',
    noPatchReason: null,
    ...overrides
  };
}

function thread(overrides: Partial<PullReviewThread> = {}): PullReviewThread {
  return {
    id: 'T1',
    path: 'src/a.ts',
    line: 2,
    originalLine: 2,
    isResolved: false,
    isOutdated: false,
    diffHunk: '@@ -1,2 +1,2 @@',
    comments: [
      {
        id: 501,
        authorLogin: 'reviewer',
        createdAt: '2026-01-04T00:00:00Z',
        htmlUrl: 'https://github.com/orbit-owner/app/pull/7#r501',
        body: 'Rename this',
        bodyHtml: '<p>Rename this</p>'
      }
    ],
    commentsPartial: false,
    ...overrides
  };
}

function mockPull(files: PullFile[], threads: PullReviewThread[] = [], partial = false) {
  window.orbit = {
    pulls: {
      files: vi.fn(async () => ({ files, partial })),
      threads: vi.fn(async () => ({ threads, partial: false }))
    },
    app: { openExternal: vi.fn(async () => ({ opened: true })) }
  } as unknown as typeof window.orbit;
}

describe('PullDiffView', () => {
  beforeEach(() => {
    mockPull([]);
  });
  afterEach(() => {
    cleanup();
  });

  it('lists each changed file in a navigator and shows the selected file as a unified diff', async () => {
    mockPull([file(), file({ filename: 'src/b.ts', additions: 3, deletions: 0 })]);
    render(<PullDiffView repoFullName="orbit-owner/app" number={7} onLink={vi.fn()} />);

    const navigator = await screen.findByRole('navigation', { name: 'File navigator' });
    expect(navigator.textContent).toContain('src/a.ts');
    expect(navigator.textContent).toContain('src/b.ts');
    expect(await screen.findByText('new line')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Split view' })).toBeNull();
  });

  it('shows a split toggle only in the expanded view', async () => {
    mockPull([file()]);
    render(<PullDiffView repoFullName="orbit-owner/app" number={7} variant="expanded" onLink={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Split view' }));
    expect(screen.getByRole('button', { name: 'Unified view' })).toBeTruthy();
  });

  it('explains a renamed file and offers the GitHub diff when the patch is too large to return', async () => {
    mockPull([
      file({ filename: 'src/new.ts', status: 'renamed', previousFilename: 'src/old.ts' }),
      file({ filename: 'huge.json', patch: null, noPatchReason: 'too-large', additions: 5000, deletions: 0 })
    ]);
    render(<PullDiffView repoFullName="orbit-owner/app" number={7} onLink={vi.fn()} />);

    expect(await screen.findByText('Renamed from src/old.ts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /huge\.json/ }));
    expect(screen.getByText('This diff is too large to show here. View it on GitHub.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /View the diff on GitHub/ })).toBeTruthy();
  });

  it('does not parse a large patch until the reader loads it', async () => {
    const lines = Array.from({ length: 450 }, (_, i) => `+row ${i}`).join('\n');
    mockPull([file({ patch: `@@ -0,0 +1,450 @@\n${lines}`, additions: 450, deletions: 0 })]);
    render(<PullDiffView repoFullName="orbit-owner/app" number={7} onLink={vi.fn()} />);

    const load = await screen.findByRole('button', { name: /Load diff \(451 lines\)/ });
    expect(screen.queryByText('row 0')).toBeNull();
    fireEvent.click(load);
    expect(await screen.findByText('row 0')).toBeTruthy();
  });

  it('pins a current thread under its diff line and labels an outdated one with its original context', async () => {
    mockPull(
      [file()],
      [
        thread({ id: 'T1', line: 2 }),
        thread({
          id: 'T2',
          line: null,
          originalLine: 5,
          isOutdated: true,
          diffHunk: '@@ -5 +5 @@ original hunk',
          comments: [
            {
              id: 600,
              authorLogin: 'reviewer',
              createdAt: '2026-01-06T00:00:00Z',
              htmlUrl: 'https://github.com/orbit-owner/app/pull/7#r600',
              body: 'Old note',
              bodyHtml: '<p>Old note</p>'
            }
          ]
        })
      ]
    );
    render(<PullDiffView repoFullName="orbit-owner/app" number={7} onLink={vi.fn()} />);

    const regions = await screen.findAllByRole('region', { name: 'Review thread on src/a.ts' });
    expect(regions).toHaveLength(2);
    const heading = screen.getByText('Other threads on this file');
    const current = regions.find((region) => !region.textContent?.includes('Outdated'));
    const outdated = regions.find((region) => region.textContent?.includes('Outdated'));
    // The current thread is pinned inside the diff, above the heading; the outdated one falls below it.
    expect(
      current && heading.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_PRECEDING
    ).toBeTruthy();
    expect(
      outdated && heading.compareDocumentPosition(outdated) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText('Outdated')).toBeTruthy();
    expect(screen.getByText(/original hunk/)).toBeTruthy();
  });
});

describe('PullDiffView partial notices', () => {
  afterEach(() => {
    cleanup();
  });

  it('says review threads may be missing even when the selected file has none', async () => {
    window.orbit = {
      pulls: {
        files: vi.fn(async () => ({ files: [file()], partial: false })),
        threads: vi.fn(async () => ({ threads: [], partial: true }))
      },
      app: { openExternal: vi.fn(async () => ({ opened: true })) }
    } as unknown as typeof window.orbit;
    render(<PullDiffView repoFullName="orbit-owner/app" number={7} onLink={vi.fn()} />);

    expect(await screen.findByText('Some review threads may not be shown.')).toBeTruthy();
  });
});
