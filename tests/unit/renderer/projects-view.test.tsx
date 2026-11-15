// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsView } from '../../../src/renderer/src/projects/ProjectsView';
import type { ProjectDetail, ProjectItem, ProjectItemEditResult } from '../../../src/shared/projects';

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
    views: [
      {
        id: 'V_board',
        number: 1,
        name: 'Backlog',
        layout: 'board',
        filter: '',
        groupByFieldId: 'FLD_status'
      },
      {
        id: 'V_table',
        number: 2,
        name: 'Mine',
        layout: 'table',
        filter: 'assignee:@me',
        groupByFieldId: null
      }
    ]
  };
}

function item(id: string, title: string, status: string | null, estimate?: number): ProjectItem {
  const fieldValues: ProjectItem['fieldValues'] = {};
  if (status)
    fieldValues['FLD_status'] = {
      kind: 'single-select',
      optionId: status,
      name: status === 'done' ? 'Done' : 'Todo'
    };
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

describe('ProjectsView', () => {
  let api: {
    projects: Record<
      'list' | 'detail' | 'items' | 'setField' | 'addItem' | 'removeItem',
      ReturnType<typeof vi.fn>
    >;
    app: { openExternal: ReturnType<typeof vi.fn> };
  };
  let items: ProjectItem[];
  const onOpenItem = vi.fn();

  beforeEach(() => {
    items = [item('issue-1', 'Fix crash', 'todo', 3), item('issue-2', 'Write docs', 'done')];
    api = {
      projects: {
        list: vi.fn(async () => ({ projects: [PROJECT], partial: false })),
        detail: vi.fn(async () => detail()),
        items: vi.fn(async () => ({ items, partial: false })),
        setField: vi.fn(),
        addItem: vi.fn(),
        removeItem: vi.fn()
      },
      app: { openExternal: vi.fn(async () => ({ opened: true })) }
    };
    window.orbit = api as unknown as typeof window.orbit;
    onOpenItem.mockClear();
  });

  afterEach(() => cleanup());

  async function openProject(view = 'Backlog') {
    render(<ProjectsView onOpenItem={onOpenItem} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Roadmap' }));
    fireEvent.click(await screen.findByRole('tab', { name: new RegExp(`^${view}`) }));
  }

  it('shows the saved views and applies the selected view’s filter through GitHub', async () => {
    await openProject('Mine');
    await waitFor(() => expect(api.projects.items).toHaveBeenLastCalledWith('PVT_1', 'assignee:@me'));
    expect(screen.getByRole('tab', { name: /Backlog/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Mine/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('edits a field in the table and shows GitHub’s version of the item once it answers', async () => {
    await openProject('Mine');
    const select = await screen.findByLabelText('Status for Fix crash');
    const saved: ProjectItem = {
      ...items[0]!,
      fieldValues: { FLD_status: { kind: 'single-select', optionId: 'done', name: 'Done' } }
    };
    api.projects.setField.mockResolvedValue({ kind: 'saved', item: saved } satisfies ProjectItemEditResult);
    fireEvent.change(select, { target: { value: 'done' } });
    await waitFor(() =>
      expect(api.projects.setField).toHaveBeenCalledWith('PVT_1', 'issue-1', {
        fieldId: 'FLD_status',
        value: { kind: 'single-select', optionId: 'done' }
      })
    );
    await waitFor(() => expect(screen.getByLabelText('Status for Fix crash')).toHaveValue('done'));
  });

  it('saves a number on blur, not on each keystroke, and clears it on request', async () => {
    await openProject('Mine');
    const input = await screen.findByLabelText('Estimate for Fix crash');
    api.projects.setField.mockResolvedValue({
      kind: 'saved',
      item: items[0]
    } satisfies ProjectItemEditResult);
    fireEvent.change(input, { target: { value: '5' } });
    expect(api.projects.setField).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() =>
      expect(api.projects.setField).toHaveBeenCalledWith('PVT_1', 'issue-1', {
        fieldId: 'FLD_est',
        value: { kind: 'number', number: 5 }
      })
    );
    api.projects.setField.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Estimate for Fix crash' }));
    await waitFor(() =>
      expect(api.projects.setField).toHaveBeenCalledWith('PVT_1', 'issue-1', {
        fieldId: 'FLD_est',
        value: null
      })
    );
  });

  it('shows a failed save and the item as GitHub stores it', async () => {
    await openProject('Mine');
    const select = await screen.findByLabelText('Status for Fix crash');
    api.projects.setField.mockResolvedValue({
      kind: 'failed',
      item: items[0],
      message: 'GitHub refused the project request.'
    } satisfies ProjectItemEditResult);
    fireEvent.change(select, { target: { value: 'done' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub refused the project request.');
    // GitHub still has Todo, so the select goes back to it.
    await waitFor(() => expect(screen.getByLabelText('Status for Fix crash')).toHaveValue('todo'));
  });

  it('moves a card to another column by drag, and does nothing when dropped in its own column', async () => {
    await openProject('Backlog');
    const card = (await screen.findByText('Fix crash')).closest('article') as HTMLElement;
    const done = screen.getByRole('listitem', { name: /^Done, / });
    const todo = screen.getByRole('listitem', { name: /^Todo, / });
    api.projects.setField.mockResolvedValue({
      kind: 'saved',
      item: items[0]
    } satisfies ProjectItemEditResult);

    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragOver(todo, { dataTransfer: { dropEffect: 'move' } });
    fireEvent.drop(todo, { dataTransfer: { getData: vi.fn() } });
    expect(api.projects.setField).not.toHaveBeenCalled();

    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragOver(done, { dataTransfer: { dropEffect: 'move' } });
    fireEvent.drop(done, { dataTransfer: { getData: vi.fn() } });
    await waitFor(() =>
      expect(api.projects.setField).toHaveBeenCalledWith('PVT_1', 'issue-1', {
        fieldId: 'FLD_status',
        value: { kind: 'single-select', optionId: 'done' }
      })
    );
  });

  it('refuses a second change to an item while its first is saving', async () => {
    await openProject('Mine');
    const select = await screen.findByLabelText('Status for Fix crash');
    let finish: (value: ProjectItemEditResult) => void = () => undefined;
    api.projects.setField.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    fireEvent.change(select, { target: { value: 'done' } });
    await waitFor(() => expect(screen.getByLabelText('Status for Fix crash')).toBeDisabled());
    expect(screen.getByLabelText('Estimate for Fix crash')).toBeDisabled();
    finish({ kind: 'saved', item: items[0]! });
    await waitFor(() => expect(screen.getByLabelText('Status for Fix crash')).not.toBeDisabled());
  });

  it('adds an item from owner/repo#number and removes one from the project', async () => {
    await openProject('Mine');
    await screen.findByText('Write docs');
    const added = item('issue-9', 'New thing', null);
    api.projects.addItem.mockResolvedValue(added);
    // The view is filtered, so Orbit reloads from GitHub, which is what returns the new item.
    api.projects.items.mockResolvedValue({ items: [...items, added], partial: false });
    fireEvent.change(screen.getByLabelText('Add an item'), { target: { value: 'orbit-owner/app#9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to project' }));
    await waitFor(() => expect(api.projects.addItem).toHaveBeenCalledWith('PVT_1', 'orbit-owner/app', 9));
    expect(await screen.findByText('New thing')).toBeInTheDocument();

    api.projects.removeItem.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Write docs from project' }));
    await waitFor(() => expect(api.projects.removeItem).toHaveBeenCalledWith('PVT_1', 'issue-2'));
    await waitFor(() => expect(screen.queryByText('Write docs')).not.toBeInTheDocument());
  });

  it('asks for an item reference it can read, without calling GitHub', async () => {
    await openProject('Mine');
    fireEvent.change(screen.getByLabelText('Add an item'), { target: { value: 'not a reference' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('owner/repo#12');
    expect(api.projects.addItem).not.toHaveBeenCalled();
  });

  it('opens an item in Orbit’s details panel from its title', async () => {
    await openProject('Mine');
    fireEvent.click(await screen.findByRole('button', { name: 'Fix crash' }));
    expect(onOpenItem).toHaveBeenCalledWith('orbit-owner/app', 1, 'issue');
  });

  it('explains a board with no field to group by and lists its items instead', async () => {
    api.projects.detail.mockResolvedValue({
      ...detail(),
      fields: [ESTIMATE],
      views: [{ id: 'V_board', number: 1, name: 'Plain', layout: 'board', filter: '', groupByFieldId: null }]
    });
    await openProject('Plain');
    expect(await screen.findByText(/no single-select field to group by/)).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Fix crash')).toBeInTheDocument();
  });

  it('reloads the items instead of dropping a row when GitHub cannot be read back', async () => {
    await openProject('Mine');
    const select = await screen.findByLabelText('Status for Fix crash');
    const callsBefore = api.projects.items.mock.calls.length;
    api.projects.setField.mockResolvedValue({
      kind: 'failed',
      item: null,
      message: 'GitHub refused the project request.'
    } satisfies ProjectItemEditResult);
    fireEvent.change(select, { target: { value: 'done' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub refused');
    await waitFor(() => expect(api.projects.items.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(screen.getByText('Fix crash')).toBeInTheDocument();
  });
});
