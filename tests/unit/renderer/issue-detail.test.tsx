// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueDetailView } from '../../../src/renderer/src/issues/IssueDetail';
import type { IssueDetail, IssueSummary } from '../../../src/shared/issues';
import { projectsStub } from './fakes/projects';

const SUMMARY: IssueSummary = {
  id: 104,
  number: 4,
  title: 'Crash on save',
  state: 'open',
  stateReason: null,
  assignees: [],
  milestone: null,
  authorLogin: 'someone',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  commentCount: 1,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-03T00:00:00Z',
  htmlUrl: 'https://github.com/orbit-owner/app/issues/4'
};

function detail(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    summary: SUMMARY,
    bodyHtml: '<p>Steps to reproduce</p><script>steal()</script>',
    comments: [
      {
        id: 9,
        authorLogin: 'commenter',
        createdAt: '2026-01-04T00:00:00Z',
        updatedAt: '2026-01-04T00:00:00Z',
        htmlUrl: 'https://github.com/orbit-owner/app/issues/4#issuecomment-9',
        bodyHtml: '<p>Same here</p>'
      }
    ],
    commentsPartial: false,
    ...overrides
  };
}

describe('IssueDetailView', () => {
  let api: {
    issues: { detail: ReturnType<typeof vi.fn> };
    app: { openExternal: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    api = {
      projects: projectsStub(),
      issues: {
        detail: vi.fn(async () => detail()),
        links: vi.fn(async () => ({ pulls: [], commits: [], partial: false }))
      },
      app: { openExternal: vi.fn(async () => ({ opened: true })) }
    };
    window.orbit = api as unknown as typeof window.orbit;
  });

  afterEach(() => cleanup());

  it('shows the issue metadata, the sanitized body, and the timeline comments', async () => {
    const { container } = render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={4}
        signedInLogin="orbit-owner"
        onOpenIssue={vi.fn()}
      />
    );

    expect(await screen.findByRole('heading', { name: /Crash on save/ })).toBeInTheDocument();
    expect(screen.getByText(/@someone/)).toBeInTheDocument();
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('Steps to reproduce')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('Same here')).toBeInTheDocument();
    expect(api.issues.detail).toHaveBeenCalledWith('orbit-owner/app', 4);
  });

  it('says only the first 100 comments are shown when more exist', async () => {
    api.issues.detail.mockResolvedValueOnce(detail({ commentsPartial: true }));
    render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={4}
        signedInLogin="orbit-owner"
        onOpenIssue={vi.fn()}
      />
    );

    expect(await screen.findByText(/only the first 100 comments/i)).toBeInTheDocument();
  });

  it('routes an in-app issue link to the onOpenIssue handler instead of the browser', async () => {
    api.issues.detail.mockResolvedValueOnce(
      detail({ bodyHtml: '<p><a href="https://github.com/orbit-owner/app/issues/12">see 12</a></p>' })
    );
    const onOpenIssue = vi.fn();
    render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={4}
        signedInLogin="orbit-owner"
        onOpenIssue={onOpenIssue}
      />
    );

    fireEvent.click(await screen.findByText('see 12'));

    expect(onOpenIssue).toHaveBeenCalledWith('orbit-owner/app', 12, 'issue');
    expect(api.app.openExternal).not.toHaveBeenCalled();
  });

  it('sends other links through the controlled external open', async () => {
    api.issues.detail.mockResolvedValueOnce(
      detail({ bodyHtml: '<p><a href="https://example.com/doc">doc</a></p>' })
    );
    render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={4}
        signedInLogin="orbit-owner"
        onOpenIssue={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByText('doc'));

    expect(api.app.openExternal).toHaveBeenCalledWith('https://example.com/doc');
  });

  it('collapses long bodies behind Show full', async () => {
    const long = `<p>${'word '.repeat(400)}</p>`;
    api.issues.detail.mockResolvedValueOnce(detail({ bodyHtml: long }));
    render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={4}
        signedInLogin="orbit-owner"
        onOpenIssue={vi.fn()}
      />
    );

    const showFull = await screen.findByRole('button', { name: 'Show full' });
    expect(document.querySelector('.issue-body')).toHaveClass('collapsed');
    fireEvent.click(showFull);
    expect(screen.queryByRole('button', { name: 'Show full' })).toBeNull();
    expect(document.querySelector('.issue-body')).not.toHaveClass('collapsed');
  });

  it('shows the error and a View on GitHub link when the issue cannot load', async () => {
    api.issues.detail.mockRejectedValueOnce(new Error('That number is not an issue. It is a pull request.'));
    render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={4}
        signedInLogin="orbit-owner"
        onOpenIssue={vi.fn()}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('not an issue');
  });

  it('opens the issue on GitHub through the controlled external open', async () => {
    render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={4}
        signedInLogin="orbit-owner"
        onOpenIssue={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole('link', { name: /View on GitHub/ }));

    expect(api.app.openExternal).toHaveBeenCalledWith('https://github.com/orbit-owner/app/issues/4');
  });

  it('copies the repo and number as owner/repo#number', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={4}
        signedInLogin="orbit-owner"
        onOpenIssue={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Copy orbit-owner/app#4' }));

    expect(writeText).toHaveBeenCalledWith('orbit-owner/app#4');
    expect(await screen.findByText('Copied')).toBeTruthy();
  });
});

describe('IssueDetailView notice links', () => {
  it('opens a Mermaid "View on GitHub" link on GitHub instead of reopening the issue in Orbit', async () => {
    const openExternal = vi.fn(async () => ({ opened: true }));
    window.orbit = {
      projects: projectsStub(),
      issues: {
        links: vi.fn(async () => ({ pulls: [], commits: [], partial: false })),
        detail: vi.fn(async () => ({
          summary: SUMMARY,
          bodyHtml: '<pre><code class="language-mermaid">graph TD</code></pre>',
          comments: [],
          commentsPartial: false
        }))
      },
      app: { openExternal }
    } as unknown as typeof window.orbit;
    const onOpenIssue = vi.fn();
    render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={4}
        signedInLogin="orbit-owner"
        onOpenIssue={onOpenIssue}
      />
    );

    // The header link has the same name, so pick the Mermaid link by its external-link marker.
    const links = await screen.findAllByRole('link', { name: 'View on GitHub' });
    fireEvent.click(links.find((link) => link.hasAttribute('data-external')) as HTMLElement);

    expect(openExternal).toHaveBeenCalledWith(SUMMARY.htmlUrl);
    expect(onOpenIssue).not.toHaveBeenCalled();
  });
});

describe('IssueDetailView pull requests', () => {
  it('opens an owner pull request link inside Orbit as a pull request', async () => {
    window.orbit = {
      projects: projectsStub(),
      issues: {
        links: vi.fn(async () => ({ pulls: [], commits: [], partial: false })),
        detail: vi.fn(async () => ({
          summary: SUMMARY,
          bodyHtml: '<p><a href="https://github.com/orbit-owner/app/pull/7">PR 7</a></p>',
          comments: [],
          commentsPartial: false
        }))
      },
      pulls: {
        detail: vi.fn(),
        files: vi.fn(async () => ({ files: [], partial: false })),
        threads: vi.fn(async () => ({ threads: [], partial: false })),
        actions: vi.fn(async () => ({
          headSha: 'head-1',
          headRef: 'feature',
          headInRepo: true,
          draft: false,
          merged: false,
          state: 'open',
          allowedMergeMethods: ['merge'],
          allowAutoMerge: false,
          autoMergeMethod: null,
          deleteBranchOnMerge: false
        })),
        runs: vi.fn(async () => [])
      },
      app: { openExternal: vi.fn(async () => ({ opened: true })) }
    } as unknown as typeof window.orbit;
    const onOpenIssue = vi.fn();
    render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={4}
        signedInLogin="orbit-owner"
        onOpenIssue={onOpenIssue}
      />
    );

    fireEvent.click(await screen.findByText('PR 7'));

    expect(onOpenIssue).toHaveBeenCalledWith('orbit-owner/app', 7, 'pull');
    expect(screen.queryByText(/not in Orbit yet/)).toBeNull();
  });

  it('loads a pull request kind from the pulls API', async () => {
    const pullDetail = vi.fn(async () => ({
      summary: { ...SUMMARY, number: 7, title: 'Add the thing' },
      bodyHtml: '<p>Change body</p>',
      comments: [],
      commentsPartial: false
    }));
    const issuesDetail = vi.fn();
    window.orbit = {
      projects: projectsStub(),
      issues: {
        detail: issuesDetail,
        links: vi.fn(async () => ({ pulls: [], commits: [], partial: false }))
      },
      pulls: {
        detail: pullDetail,
        files: vi.fn(async () => ({ files: [], partial: false })),
        threads: vi.fn(async () => ({ threads: [], partial: false })),
        actions: vi.fn(async () => ({
          headSha: 'head-1',
          headRef: 'feature',
          headInRepo: true,
          draft: false,
          merged: false,
          state: 'open',
          allowedMergeMethods: ['merge'],
          allowAutoMerge: false,
          autoMergeMethod: null,
          deleteBranchOnMerge: false
        })),
        runs: vi.fn(async () => [])
      },
      app: { openExternal: vi.fn(async () => ({ opened: true })) }
    } as unknown as typeof window.orbit;
    render(
      <IssueDetailView
        repoFullName="orbit-owner/app"
        number={7}
        signedInLogin="orbit-owner"
        onOpenIssue={vi.fn()}
        kind="pull"
      />
    );

    expect(await screen.findByText('Change body')).toBeInTheDocument();
    expect(pullDetail).toHaveBeenCalledWith('orbit-owner/app', 7);
    expect(issuesDetail).not.toHaveBeenCalled();
  });
});
