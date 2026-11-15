// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackedRepoGroups } from '../../../src/renderer/src/issues/TrackedRepoGroups';
import type { PersonalRepo } from '../../../src/shared/ipc';
import type { IssueSummary } from '../../../src/shared/issues';

function repo(name: string): PersonalRepo {
  return {
    id: name.length,
    name,
    fullName: `chetjones003/${name}`,
    description: null,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    defaultBranch: 'main',
    updatedAt: '2026-01-01',
    htmlUrl: `https://github.com/chetjones003/${name}`
  };
}

function issue(number: number, title: string): IssueSummary {
  return {
    id: number,
    number,
    title,
    state: 'open',
    stateReason: null,
    authorLogin: 'chetjones003',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [],
    milestone: null,
    commentCount: 2,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
    htmlUrl: 'https://github.com'
  };
}

describe('TrackedRepoGroups', () => {
  afterEach(() => {
    cleanup();
    delete (window as { orbit?: unknown }).orbit;
  });

  it('loads each tracked repo on its own and lists its items under that repo', async () => {
    const list = vi.fn(async ({ repoFullName }: { repoFullName: string }) => ({
      items: repoFullName.endsWith('atlas') ? [issue(1, 'Atlas first')] : [issue(7, 'Notes first')],
      page: 1,
      hasNextPage: false,
      partial: false
    }));
    window.orbit = { issues: { list } } as unknown as typeof window.orbit;

    render(
      <TrackedRepoGroups
        kind="issue"
        repos={[repo('atlas'), repo('notes')]}
        state="open"
        selected={null}
        onOpen={vi.fn()}
        onScope={vi.fn()}
      />
    );

    const atlas = await screen.findByRole('region', { name: 'chetjones003/atlas' });
    expect(await within(atlas).findByText(/Atlas first/)).toBeInTheDocument();
    const notes = screen.getByRole('region', { name: 'chetjones003/notes' });
    expect(await within(notes).findByText(/Notes first/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ repoFullName: 'chetjones003/atlas', state: 'open', page: 1 });
    expect(list).toHaveBeenCalledWith({ repoFullName: 'chetjones003/notes', state: 'open', page: 1 });
  });

  it('opens an item with its repo, and opens a repo on its own list', async () => {
    window.orbit = {
      issues: {
        list: vi.fn(async () => ({
          items: [issue(3, 'Pick me')],
          page: 1,
          hasNextPage: false,
          partial: false
        }))
      }
    } as unknown as typeof window.orbit;
    const onOpen = vi.fn();
    const onScope = vi.fn();
    const atlas = repo('atlas');

    render(
      <TrackedRepoGroups
        kind="issue"
        repos={[atlas]}
        state="open"
        selected={null}
        onOpen={onOpen}
        onScope={onScope}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /Pick me/ }));
    expect(onOpen).toHaveBeenCalledWith('chetjones003/atlas', 3, 'issue');

    fireEvent.click(screen.getByRole('button', { name: 'chetjones003/atlas' }));
    await waitFor(() => expect(onScope).toHaveBeenCalledWith(atlas));
  });

  it('shows a failure for one repo without hiding the others', async () => {
    window.orbit = {
      pulls: {
        list: vi.fn(async ({ repoFullName }: { repoFullName: string }) => {
          if (repoFullName.endsWith('broken')) throw new Error('GitHub is unreachable.');
          return { items: [], page: 1, hasNextPage: false, partial: false };
        })
      }
    } as unknown as typeof window.orbit;

    render(
      <TrackedRepoGroups
        kind="pull"
        repos={[repo('broken'), repo('fine')]}
        state="open"
        selected={null}
        onOpen={vi.fn()}
        onScope={vi.fn()}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub is unreachable.');
    expect(await screen.findByText('No open pull requests in this repository.')).toBeInTheDocument();
  });
});
