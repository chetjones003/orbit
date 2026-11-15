// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemProjects } from '../../../src/renderer/src/projects/ItemProjects';
import type { ItemMemberships, ProjectDetail, ProjectItem } from '../../../src/shared/projects';

const ROADMAP = {
  id: 'PVT_1',
  number: 2,
  title: 'Roadmap',
  url: 'https://github.com/users/orbit-owner/projects/2',
  closed: false
};
const SHIPPING = { ...ROADMAP, id: 'PVT_2', number: 3, title: 'Shipping' };

const STATUS = {
  id: 'FLD_status',
  name: 'Status',
  kind: 'single-select' as const,
  options: [
    { id: 'todo', name: 'Todo', color: 'GRAY' },
    { id: 'done', name: 'Done', color: 'GREEN' }
  ]
};

function detail(project: typeof ROADMAP): ProjectDetail {
  return { project, fields: [STATUS], views: [] };
}

function item(id: string, status?: string): ProjectItem {
  return {
    id,
    kind: 'issue',
    contentId: 'I_12',
    repoFullName: 'orbit-owner/app',
    number: 12,
    title: 'Fix crash',
    htmlUrl: 'https://github.com/orbit-owner/app/issues/12',
    state: 'open',
    isDraft: false,
    fieldValues: status
      ? { FLD_status: { kind: 'single-select', optionId: status, name: status === 'done' ? 'Done' : 'Todo' } }
      : {}
  };
}

describe('ItemProjects', () => {
  let memberships: ItemMemberships;
  let api: {
    projects: Record<
      'list' | 'detail' | 'itemMemberships' | 'setField' | 'addItem' | 'removeItem',
      ReturnType<typeof vi.fn>
    >;
  };

  beforeEach(() => {
    memberships = {
      contentId: 'I_12',
      partial: false,
      memberships: [{ project: ROADMAP, item: item('PVTI_1', 'todo') }]
    };
    api = {
      projects: {
        itemMemberships: vi.fn(async () => memberships),
        detail: vi.fn(async (id: string) => detail(id === 'PVT_2' ? SHIPPING : ROADMAP)),
        list: vi.fn(async () => ({ projects: [ROADMAP, SHIPPING], partial: false })),
        setField: vi.fn(),
        addItem: vi.fn(),
        removeItem: vi.fn()
      }
    };
    window.orbit = api as unknown as typeof window.orbit;
  });

  afterEach(() => cleanup());

  it('shows each project the item is in, with its fields', async () => {
    render(<ItemProjects repoFullName="orbit-owner/app" number={12} />);
    expect(await screen.findByText('Roadmap')).toBeInTheDocument();
    expect(api.projects.itemMemberships).toHaveBeenCalledWith('orbit-owner/app', 12);
    expect(screen.getByLabelText('Status for orbit-owner/app#12 in Roadmap')).toHaveValue('todo');
  });

  it('edits a project field from the sidebar, in the project the item belongs to', async () => {
    render(<ItemProjects repoFullName="orbit-owner/app" number={12} />);
    const select = await screen.findByLabelText('Status for orbit-owner/app#12 in Roadmap');
    api.projects.setField.mockResolvedValue({ kind: 'saved', item: item('PVTI_1', 'done') });
    fireEvent.change(select, { target: { value: 'done' } });
    await waitFor(() =>
      expect(api.projects.setField).toHaveBeenCalledWith('PVT_1', 'PVTI_1', {
        fieldId: 'FLD_status',
        value: { kind: 'single-select', optionId: 'done' }
      })
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Status for orbit-owner/app#12 in Roadmap')).toHaveValue('done')
    );
  });

  it('removes the item from one project and keeps the others', async () => {
    memberships.memberships.push({ project: SHIPPING, item: item('PVTI_2') });
    render(<ItemProjects repoFullName="orbit-owner/app" number={12} />);
    await screen.findByText('Shipping');
    api.projects.removeItem.mockResolvedValue(undefined);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from project' })[0]!);
    await waitFor(() => expect(api.projects.removeItem).toHaveBeenCalledWith('PVT_1', 'PVTI_1'));
    // Roadmap is offered again in the add list, so only its membership heading is checked.
    await waitFor(() => expect(screen.queryAllByText('Roadmap', { selector: 'strong' })).toHaveLength(0));
    expect(screen.getByText('Shipping')).toBeInTheDocument();
  });

  it('adds the item to a project it is not in yet', async () => {
    render(<ItemProjects repoFullName="orbit-owner/app" number={12} />);
    await screen.findByText('Roadmap');
    // Only projects the item is not in are offered.
    const choose = await screen.findByLabelText('Add to project');
    expect(choose).toHaveTextContent('Shipping');
    expect(choose).not.toHaveTextContent('Roadmap');
    fireEvent.change(choose, { target: { value: 'PVT_2' } });
    api.projects.addItem.mockResolvedValue(item('PVTI_2'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.projects.addItem).toHaveBeenCalledWith('PVT_2', 'orbit-owner/app', 12));
  });

  it('says so when the item is in no project', async () => {
    memberships.memberships = [];
    render(<ItemProjects repoFullName="orbit-owner/app" number={12} />);
    expect(await screen.findByText('Not in any of your projects.')).toBeInTheDocument();
  });

  it('shows a load failure instead of an empty section', async () => {
    api.projects.itemMemberships.mockRejectedValue(new Error('Sign in to GitHub to load projects.'));
    render(<ItemProjects repoFullName="orbit-owner/app" number={12} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in to GitHub to load projects.');
  });
});
