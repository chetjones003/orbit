// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueList } from '../../../src/renderer/src/issues/IssueList';
import type { IssueListPage, IssueSummary } from '../../../src/shared/issues';

function issue(number: number): IssueSummary {
  return {
    id: 100 + number,
    number,
    title: `Issue title ${number}`,
    state: 'open',
    stateReason: null,
    authorLogin: 'someone',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    commentCount: 1,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
    htmlUrl: `https://github.com/orbit-owner/app/issues/${number}`
  };
}

function page(overrides: Partial<IssueListPage> = {}): IssueListPage {
  return { items: [issue(4)], page: 1, hasNextPage: false, partial: false, ...overrides };
}

describe('IssueList', () => {
  let list: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    list = vi.fn(async () => page());
    window.orbit = { issues: { list } } as unknown as typeof window.orbit;
  });

  afterEach(() => cleanup());

  it('loads open issues for the repo and lists each one', async () => {
    render(<IssueList repoFullName="orbit-owner/app" selectedNumber={null} onOpenIssue={vi.fn()} />);

    expect(await screen.findByText(/Issue title 4/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ repoFullName: 'orbit-owner/app', state: 'open', page: 1 });
  });

  it('sends the state, label, and author filters when applied', async () => {
    render(<IssueList repoFullName="orbit-owner/app" selectedNumber={null} onOpenIssue={vi.fn()} />);
    await screen.findByText(/Issue title 4/);

    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'closed' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'bug' } });
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'someone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        repoFullName: 'orbit-owner/app',
        state: 'closed',
        label: 'bug',
        author: 'someone',
        page: 1
      })
    );
  });

  it('pages forward only when GitHub reports another page, and back again', async () => {
    list.mockResolvedValueOnce(page({ hasNextPage: true }));
    list.mockResolvedValueOnce(page({ page: 2, items: [issue(40)] }));
    render(<IssueList repoFullName="orbit-owner/app" selectedNumber={null} onOpenIssue={vi.fn()} />);
    await screen.findByText(/Issue title 4/);

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText(/Issue title 40/)).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })));
  });

  it('flags a partial page as incomplete and never as the full list', async () => {
    list.mockResolvedValueOnce(page({ partial: true }));
    render(<IssueList repoFullName="orbit-owner/app" selectedNumber={null} onOpenIssue={vi.fn()} />);

    expect(await screen.findByText(/some issues could not be shown/i)).toBeInTheDocument();
    expect(screen.queryByText(/all issues/i)).toBeNull();
  });

  it('shows an error with retry when the list cannot load', async () => {
    list.mockRejectedValueOnce(new Error('GitHub could not be reached.'));
    render(<IssueList repoFullName="orbit-owner/app" selectedNumber={null} onOpenIssue={vi.fn()} />);

    expect(await screen.findByText('GitHub could not be reached.')).toBeInTheDocument();
    list.mockResolvedValueOnce(page());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Issue title 4/)).toBeInTheDocument();
  });

  it('opens an issue when its row is chosen', async () => {
    const onOpenIssue = vi.fn();
    render(<IssueList repoFullName="orbit-owner/app" selectedNumber={null} onOpenIssue={onOpenIssue} />);

    fireEvent.click(await screen.findByRole('button', { name: /Issue title 4/ }));

    expect(onOpenIssue).toHaveBeenCalledWith(4);
  });
});
