// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { dragCard, dropOn, installDragLayout } from './pointer-drag';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KanbanView } from '../../../src/renderer/src/projects/KanbanView';
import { ProjectTable } from '../../../src/renderer/src/projects/ProjectTable';
import { groupItems } from '../../../src/renderer/src/projects/custom-view-model';
import type { ProjectField, ProjectItem } from '../../../src/shared/projects';

afterEach(cleanup);

const STATUS: ProjectField = {
  id: 'FLD_status',
  name: 'Status',
  kind: 'single-select',
  options: [
    { id: 'todo', name: 'Todo', color: 'GRAY' },
    { id: 'done', name: 'Done', color: 'GREEN' }
  ]
};
const LANE: ProjectField = {
  id: 'FLD_prio',
  name: 'Priority',
  kind: 'single-select',
  options: [
    { id: 'p0', name: 'P0', color: 'RED' },
    { id: 'p1', name: 'P1', color: 'BLUE' }
  ]
};
const ESTIMATE: ProjectField = { id: 'FLD_est', name: 'Estimate', kind: 'number' };
const FIELDS = [STATUS, LANE, ESTIMATE];

function item(id: string, title: string, values: ProjectItem['fieldValues'] = {}): ProjectItem {
  return {
    id,
    kind: 'issue',
    contentId: `I_${id}`,
    repoFullName: 'orbit-owner/app',
    number: 7,
    title,
    htmlUrl: 'https://github.com/orbit-owner/app/issues/7',
    state: 'open',
    isDraft: false,
    fieldValues: values
  };
}

const at = (optionId: string, name: string) => ({ kind: 'single-select' as const, optionId, name });

function column(label: string): HTMLElement {
  return screen.getByRole('listitem', { name: new RegExp(`^${label},`) });
}

describe('KanbanView', () => {
  installDragLayout();

  it('places each item in its column and shows a No value column', () => {
    const items = [
      item('a', 'Write docs', { FLD_status: at('todo', 'Todo') }),
      item('b', 'Ship it', { FLD_status: at('done', 'Done') }),
      item('c', 'Unsorted')
    ];
    render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={null}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={null}
        pendingIds={new Set()}
        onEdit={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    expect(within(column('Todo')).getByText('Write docs')).toBeDefined();
    expect(within(column('Done')).getByText('Ship it')).toBeDefined();
    expect(within(column('No value')).getByText('Unsorted')).toBeDefined();
  });

  it('writes the column field back when a card is dropped in another column', async () => {
    const onEdit = vi.fn(async (changed: ProjectItem) => changed);
    const items = [item('a', 'Write docs', { FLD_status: at('todo', 'Todo') })];
    render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={null}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={null}
        pendingIds={new Set()}
        onEdit={onEdit}
        onOpen={vi.fn()}
      />
    );
    dragCard(screen.getByText('Write docs'));
    dropOn(column('Done'));
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit).toHaveBeenCalledWith(items[0], STATUS, { kind: 'single-select', optionId: 'done' });
  });

  it('clears the column field when a card is dropped in No value', async () => {
    const onEdit = vi.fn(async (changed: ProjectItem) => changed);
    const items = [item('a', 'Write docs', { FLD_status: at('todo', 'Todo') })];
    render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={null}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={null}
        pendingIds={new Set()}
        onEdit={onEdit}
        onOpen={vi.fn()}
      />
    );
    dragCard(screen.getByText('Write docs'));
    dropOn(column('No value'));
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit).toHaveBeenCalledWith(items[0], STATUS, null);
  });

  it('does nothing when a card is dropped in the column it is already in', () => {
    const onEdit = vi.fn();
    const items = [item('a', 'Write docs', { FLD_status: at('todo', 'Todo') })];
    render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={null}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={null}
        pendingIds={new Set()}
        onEdit={onEdit}
        onOpen={vi.fn()}
      />
    );
    dragCard(screen.getByText('Write docs'));
    dropOn(column('Todo'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('will not move a card that has a save pending', () => {
    const onEdit = vi.fn();
    const items = [item('a', 'Write docs', { FLD_status: at('todo', 'Todo') })];
    render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={null}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={null}
        pendingIds={new Set(['a'])}
        onEdit={onEdit}
        onOpen={vi.fn()}
      />
    );
    dragCard(screen.getByText('Write docs'));
    dropOn(column('Done'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('moves a card after the card above it in an unsorted column, through GitHub’s manual order', async () => {
    const onReorder = vi.fn(async () => true);
    const items = [
      item('a', 'First', { FLD_status: at('todo', 'Todo') }),
      item('b', 'Second', { FLD_status: at('todo', 'Todo') }),
      item('c', 'Third', { FLD_status: at('todo', 'Todo') })
    ];
    render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={null}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={null}
        order={items}
        manualOrder
        pendingIds={new Set()}
        onEdit={vi.fn()}
        onReorder={onReorder}
        onOpen={vi.fn()}
      />
    );
    dragCard(screen.getByText('Third'));
    dropOn(screen.getByText('Second'), 120);
    await vi.waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1));
    expect(onReorder).toHaveBeenCalledWith(items[2], 'a');
  });

  it('moves a card to the top when it is dropped on the first card', async () => {
    const onReorder = vi.fn(async () => true);
    const items = [
      item('a', 'First', { FLD_status: at('todo', 'Todo') }),
      item('b', 'Second', { FLD_status: at('todo', 'Todo') })
    ];
    render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={null}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={null}
        order={items}
        manualOrder
        pendingIds={new Set()}
        onEdit={vi.fn()}
        onReorder={onReorder}
        onOpen={vi.fn()}
      />
    );
    dragCard(screen.getByText('Second'));
    dropOn(screen.getByText('First'));
    await vi.waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1));
    expect(onReorder).toHaveBeenCalledWith(items[1], null);
  });

  it('copies the dragged card under the pointer and leaves a slot where it would land', () => {
    const items = [
      item('a', 'First', { FLD_status: at('todo', 'Todo') }),
      item('b', 'Second', { FLD_status: at('todo', 'Todo') }),
      item('c', 'Third', { FLD_status: at('todo', 'Todo') })
    ];
    const { container } = render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={null}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={null}
        order={items}
        manualOrder
        pendingIds={new Set()}
        onEdit={vi.fn()}
        onReorder={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    dragCard(screen.getByText('First'));
    fireEvent.pointerMove(screen.getByText('Third'), { pointerId: 1, clientX: 0, clientY: 120 });

    const ghost = document.querySelector('.card-drag-ghost');
    expect(ghost).toHaveTextContent('First');
    // Without the dragged card, Second is above the pointer and Third below it, so the slot goes between them.
    const slot = container.querySelector('.card-drop-slot');
    expect(slot?.previousElementSibling).toHaveTextContent('Second');
    expect(slot?.nextElementSibling).toHaveTextContent('Third');

    fireEvent.pointerUp(screen.getByText('Third'), { pointerId: 1, clientX: 0, clientY: 120 });
    expect(document.querySelector('.card-drag-ghost')).toBeNull();
    expect(container.querySelector('.card-drop-slot')).toBeNull();
  });

  it('does not reorder a sorted view when a card is dropped on another card', () => {
    const onReorder = vi.fn();
    const items = [
      item('a', 'First', { FLD_status: at('todo', 'Todo') }),
      item('b', 'Second', { FLD_status: at('todo', 'Todo') })
    ];
    render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={null}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={null}
        order={items}
        manualOrder={false}
        pendingIds={new Set()}
        onEdit={vi.fn()}
        onReorder={onReorder}
        onOpen={vi.fn()}
      />
    );
    dragCard(screen.getByText('Second'));
    dropOn(screen.getByText('First'));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('writes the swimlane field after the column when a card changes both', async () => {
    const onEdit = vi.fn(async (changed: ProjectItem) => changed);
    const items = [item('a', 'Write docs', { FLD_status: at('todo', 'Todo'), FLD_prio: at('p0', 'P0') })];
    render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={LANE}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={groupItems(items, LANE) ?? []}
        pendingIds={new Set()}
        onEdit={onEdit}
        onOpen={vi.fn()}
      />
    );
    const lane = screen.getByRole('region', { name: 'P1 swimlane' });
    dragCard(screen.getByText('Write docs'));
    dropOn(within(lane).getByRole('listitem', { name: /^Done,/ }));
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(2));
    expect(onEdit.mock.calls[0]?.[1]).toBe(STATUS);
    expect(onEdit.mock.calls[1]?.[1]).toBe(LANE);
    expect(onEdit.mock.calls[1]?.[2]).toEqual({ kind: 'single-select', optionId: 'p1' });
  });

  it('stops after a failed write, so the second field is not changed on top of it', async () => {
    const onEdit = vi.fn(async () => null);
    const items = [item('a', 'Write docs', { FLD_status: at('todo', 'Todo'), FLD_prio: at('p0', 'P0') })];
    render(
      <KanbanView
        columnField={STATUS}
        swimlaneField={LANE}
        groups={groupItems(items, STATUS) ?? []}
        laneGroups={groupItems(items, LANE) ?? []}
        pendingIds={new Set()}
        onEdit={onEdit}
        onOpen={vi.fn()}
      />
    );
    dragCard(screen.getByText('Write docs'));
    const lane = screen.getByRole('region', { name: 'P1 swimlane' });
    dropOn(within(lane).getByRole('listitem', { name: /^Done,/ }));
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

describe('CustomViewPanel repairs', () => {
  it('opens the settings when a grouping field was removed, so the repair is visible', async () => {
    const { CustomViewPanel } = await import('../../../src/renderer/src/projects/CustomViewPanel');
    const items = [item('a', 'Write docs', { FLD_status: at('todo', 'Todo') })];
    render(
      <CustomViewPanel
        view={{
          id: 'cv-table',
          name: 'Table',
          projectId: 'PVT_1',
          layout: 'table',
          advancedFilter: '',
          conditions: [],
          sort: null,
          groupFieldId: 'FLD_gone',
          columnFieldId: null,
          swimlaneFieldId: null
        }}
        fields={FIELDS}
        items={items}
        pendingIds={new Set()}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    expect(screen.getByRole('dialog', { name: 'View settings' })).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain('Group field was removed from this project');
  });
});

describe('ProjectTable grouping and sorting', () => {
  const items = [
    item('a', 'Write docs', { FLD_status: at('todo', 'Todo'), FLD_est: { kind: 'number', number: 5 } }),
    item('b', 'Ship it', { FLD_status: at('done', 'Done') })
  ];

  it('shows a row group heading for each group, including No value', () => {
    render(
      <ProjectTable
        fields={FIELDS}
        items={items}
        groups={groupItems(items, STATUS) ?? undefined}
        pendingIds={new Set()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    expect(screen.getByRole('rowgroup', { name: 'Todo, 1 item' })).toBeDefined();
    expect(screen.getByRole('rowgroup', { name: 'No value, 0 items' })).toBeDefined();
  });

  it('calls onSort with the field when a column header is pressed', () => {
    const onSort = vi.fn();
    render(
      <ProjectTable
        fields={FIELDS}
        items={items}
        sort={null}
        onSort={onSort}
        pendingIds={new Set()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Estimate' }));
    expect(onSort).toHaveBeenCalledWith('FLD_est');
  });
});
