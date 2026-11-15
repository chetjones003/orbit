// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsView } from '../../../src/renderer/src/projects/ProjectsView';
import type { CustomViewDefinition } from '../../../src/shared/custom-views';
import type { ProjectDetail, ProjectItem } from '../../../src/shared/projects';

const PROJECT = {
  id: 'PVT_1',
  number: 2,
  title: 'Roadmap',
  url: 'https://github.com/users/orbit-owner/projects/2',
  closed: false
};
const STATUS = {
  id: 'FLD_status',
  name: 'Status',
  kind: 'single-select' as const,
  options: [
    { id: 'todo', name: 'Todo', color: 'GRAY' },
    { id: 'done', name: 'Done', color: 'GREEN' }
  ]
};
const ESTIMATE = { id: 'FLD_est', name: 'Estimate', kind: 'number' as const };

function detail(): ProjectDetail {
  return {
    project: PROJECT,
    fields: [STATUS, ESTIMATE],
    views: [{ id: 'V_board', number: 1, name: 'Backlog', layout: 'board', filter: '', groupByFieldId: null }]
  };
}

function item(id: string, title: string, status: string | null, estimate?: number): ProjectItem {
  const fieldValues: ProjectItem['fieldValues'] = {};
  if (status) fieldValues['FLD_status'] = { kind: 'single-select', optionId: status, name: status };
  if (estimate !== undefined) fieldValues['FLD_est'] = { kind: 'number', number: estimate };
  return {
    id,
    kind: 'issue',
    contentId: `I_${id}`,
    repoFullName: 'orbit-owner/app',
    number: Number(id.replace(/\D/g, '')) || 1,
    title,
    htmlUrl: `https://github.com/orbit-owner/app/issues/${id}`,
    state: 'open',
    isDraft: false,
    fieldValues
  };
}

function saved(overrides: Partial<CustomViewDefinition> = {}): CustomViewDefinition {
  return {
    id: 'cv-1',
    name: 'Sprint board',
    projectId: 'PVT_1',
    layout: 'kanban',
    advancedFilter: 'is:issue',
    conditions: [],
    sort: null,
    groupFieldId: null,
    columnFieldId: 'FLD_status',
    swimlaneFieldId: null,
    ...overrides
  };
}

describe('ProjectsView custom views', () => {
  let items: ProjectItem[];
  let stored: CustomViewDefinition[];
  let api: {
    projects: Record<string, ReturnType<typeof vi.fn>>;
    settings: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    app: { openExternal: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    items = [item('issue-1', 'Fix crash', 'todo', 3), item('issue-2', 'Write docs', 'done')];
    stored = [saved()];
    api = {
      projects: {
        list: vi.fn(async () => ({ projects: [PROJECT], partial: false })),
        detail: vi.fn(async () => detail()),
        items: vi.fn(async () => ({ items, partial: false })),
        setField: vi.fn(),
        addItem: vi.fn(),
        removeItem: vi.fn()
      },
      settings: {
        get: vi.fn(async () => ({ customViews: stored })),
        update: vi.fn(async (update: { customViews: CustomViewDefinition[] }) => {
          stored = update.customViews;
          return { customViews: stored };
        })
      },
      app: { openExternal: vi.fn(async () => ({ opened: true })) }
    };
    window.orbit = api as unknown as typeof window.orbit;
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function openProject() {
    render(<ProjectsView onOpenItem={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    await screen.findByRole('tab', { name: /Backlog/ });
  }

  it('lists the custom views of the project and loads items with the view’s advanced filter', async () => {
    await openProject();
    fireEvent.click(await screen.findByRole('tab', { name: /Sprint board/ }));
    await waitFor(() => expect(api.projects.items).toHaveBeenLastCalledWith('PVT_1', 'is:issue'));
  });

  it('shows a Kanban with a column per option and a No value column', async () => {
    items = [item('issue-1', 'Fix crash', 'todo'), item('issue-3', 'Unsorted', null)];
    await openProject();
    fireEvent.click(await screen.findByRole('tab', { name: /Sprint board/ }));
    const todo = await screen.findByRole('listitem', { name: /^Todo,/ });
    expect(within(todo).getByText('Fix crash')).toBeInTheDocument();
    expect(
      within(screen.getByRole('listitem', { name: /^No value,/ })).getByText('Unsorted')
    ).toBeInTheDocument();
  });

  it('writes a dropped card’s new column back to GitHub and shows the saved column', async () => {
    await openProject();
    fireEvent.click(await screen.findByRole('tab', { name: /Sprint board/ }));
    const todo = await screen.findByRole('listitem', { name: /^Todo,/ });
    const card = within(todo).getByText('Fix crash');
    const saved: ProjectItem = {
      ...items[0]!,
      fieldValues: { FLD_status: { kind: 'single-select', optionId: 'done', name: 'Done' } }
    };
    api.projects.setField.mockResolvedValue({ kind: 'saved', item: saved });
    fireEvent.dragStart(card, { dataTransfer: { setData: () => undefined, getData: () => '' } });
    fireEvent.dragOver(screen.getByRole('listitem', { name: /^Done,/ }));
    fireEvent.drop(screen.getByRole('listitem', { name: /^Done,/ }));
    await waitFor(() =>
      expect(api.projects.setField).toHaveBeenCalledWith('PVT_1', 'issue-1', {
        fieldId: 'FLD_status',
        value: { kind: 'single-select', optionId: 'done' }
      })
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('listitem', { name: /^Done,/ })).getByText('Fix crash')
      ).toBeInTheDocument()
    );
  });

  it('creates a view and saves its definition straight away, without any item data', async () => {
    stored = [];
    await openProject();
    fireEvent.click(screen.getByRole('button', { name: 'New custom view' }));
    await waitFor(() => expect(api.settings.update).toHaveBeenCalled());
    const [payload] = api.settings.update.mock.calls[0] as [{ customViews: CustomViewDefinition[] }];
    expect(payload.customViews).toEqual([
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        projectId: 'PVT_1',
        layout: 'kanban',
        columnFieldId: null
      })
    ]);
    expect(JSON.stringify(payload)).not.toContain('Fix crash');
  });

  it('autosaves a renamed view', async () => {
    await openProject();
    fireEvent.click(await screen.findByRole('tab', { name: /Sprint board/ }));
    fireEvent.change(await screen.findByLabelText('View name'), { target: { value: 'Triage' } });
    await waitFor(() =>
      expect(api.settings.update).toHaveBeenLastCalledWith({
        customViews: [expect.objectContaining({ id: 'cv-1', name: 'Triage' })]
      })
    );
  });

  it('groups a table view’s rows by its group field and saves a sort from the header', async () => {
    stored = [
      saved({
        id: 'cv-table',
        name: 'By status',
        layout: 'table',
        columnFieldId: null,
        groupFieldId: 'FLD_status'
      })
    ];
    await openProject();
    fireEvent.click(await screen.findByRole('tab', { name: /By status/ }));
    expect(await screen.findByRole('rowgroup', { name: 'Todo, 1 item' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Estimate' }));
    await waitFor(() =>
      expect(api.settings.update).toHaveBeenLastCalledWith({
        customViews: [
          expect.objectContaining({ id: 'cv-table', sort: { fieldId: 'FLD_est', direction: 'asc' } })
        ]
      })
    );
  });
});
