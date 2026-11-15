// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomViewEditor } from '../../../src/renderer/src/projects/CustomViewEditor';
import type { CustomViewDefinition } from '../../../src/shared/custom-views';
import type { ProjectField } from '../../../src/shared/projects';

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
const PRIORITY: ProjectField = {
  id: 'FLD_prio',
  name: 'Priority',
  kind: 'single-select',
  options: [{ id: 'p0', name: 'P0', color: 'RED' }]
};
const SPRINT: ProjectField = {
  id: 'FLD_sprint',
  name: 'Sprint',
  kind: 'iteration',
  iterations: [{ id: 'it_1', title: 'Sprint 1', startDate: '2026-01-05', duration: 14 }]
};
const FIELDS = [PRIORITY, STATUS, SPRINT];

function kanban(overrides: Partial<CustomViewDefinition> = {}): CustomViewDefinition {
  return {
    id: 'cv-1',
    name: 'Sprint board',
    projectId: 'PVT_1',
    layout: 'kanban',
    advancedFilter: '',
    conditions: [],
    sort: null,
    groupFieldId: null,
    columnFieldId: 'FLD_status',
    swimlaneFieldId: null,
    ...overrides
  };
}

describe('CustomViewEditor', () => {
  it('reports a changed name straight away, so the change autosaves', () => {
    const onChange = vi.fn();
    render(<CustomViewEditor view={kanban()} fields={FIELDS} onChange={onChange} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Triage' } });
    expect(onChange).toHaveBeenCalledWith(kanban({ name: 'Triage' }));
  });

  it('does not save a blank name, so the view keeps its last saved name', () => {
    const onChange = vi.fn();
    render(<CustomViewEditor view={kanban()} fields={FIELDS} onChange={onChange} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('View name'), { target: { value: '   ' } });
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText('View name') as HTMLInputElement).value).toBe('   ');
  });

  it('adds a text filter when the project has no single-select or iteration field', () => {
    const onChange = vi.fn();
    const NOTES: ProjectField = { id: 'FLD_notes', name: 'Notes', kind: 'text' };
    render(
      <CustomViewEditor
        view={kanban({ columnFieldId: null })}
        fields={[NOTES]}
        onChange={onChange}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(onChange).toHaveBeenCalledWith(
      kanban({ columnFieldId: null, conditions: [{ kind: 'contains', fieldId: 'FLD_notes', text: '' }] })
    );
  });

  it('switches between Kanban and Table and keeps the mapping', () => {
    const onChange = vi.fn();
    render(<CustomViewEditor view={kanban()} fields={FIELDS} onChange={onChange} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Layout'), { target: { value: 'table' } });
    expect(onChange).toHaveBeenCalledWith(kanban({ layout: 'table' }));
  });

  it('shows a suggested column field and applies it only when the user accepts', () => {
    const onChange = vi.fn();
    render(
      <CustomViewEditor
        view={kanban({ columnFieldId: null })}
        fields={FIELDS}
        onChange={onChange}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/Suggested column field: Status/)).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use suggestion' }));
    expect(onChange).toHaveBeenCalledWith(kanban({ columnFieldId: 'FLD_status' }));
  });

  it('asks for a repair when a mapped field was deleted, and changes only the field the user picks', () => {
    const onChange = vi.fn();
    render(
      <CustomViewEditor
        view={kanban({ columnFieldId: 'FLD_gone' })}
        fields={FIELDS}
        onChange={onChange}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByRole('alert').textContent).toContain('Column field was removed from this project');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Repair column field'), { target: { value: 'FLD_prio' } });
    expect(onChange).toHaveBeenCalledWith(kanban({ columnFieldId: 'FLD_prio' }));
  });

  it('reports the advanced filter as typed, for GitHub to apply', () => {
    const onChange = vi.fn();
    render(<CustomViewEditor view={kanban()} fields={FIELDS} onChange={onChange} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Advanced filter'), { target: { value: 'is:issue' } });
    expect(onChange).toHaveBeenCalledWith(kanban({ advancedFilter: 'is:issue' }));
  });

  it('adds a visual filter on the first single-select field, with no value chosen yet', () => {
    const onChange = vi.fn();
    render(<CustomViewEditor view={kanban()} fields={FIELDS} onChange={onChange} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(onChange).toHaveBeenCalledWith(
      kanban({ conditions: [{ kind: 'one-of', fieldId: 'FLD_prio', valueIds: [] }] })
    );
  });

  it('ticks options on a visual filter, and will not untick the last one', () => {
    const onChange = vi.fn();
    render(
      <CustomViewEditor
        view={kanban({ conditions: [{ kind: 'one-of', fieldId: 'FLD_status', valueIds: ['todo'] }] })}
        fields={FIELDS}
        onChange={onChange}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText('Done'));
    expect(onChange).toHaveBeenCalledWith(
      kanban({ conditions: [{ kind: 'one-of', fieldId: 'FLD_status', valueIds: ['todo', 'done'] }] })
    );
    expect((screen.getByLabelText('Todo') as HTMLInputElement).disabled).toBe(true);
  });

  it('asks for a second press before deleting the view', () => {
    const onDelete = vi.fn();
    render(<CustomViewEditor view={kanban()} fields={FIELDS} onChange={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete view' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('asks for Columns and Swimlanes on Kanban views, and Group by on Table views', () => {
    const { unmount } = render(
      <CustomViewEditor view={kanban()} fields={FIELDS} onChange={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByLabelText('Columns')).toBeDefined();
    expect(screen.getByLabelText('Swimlanes')).toBeDefined();
    expect(screen.queryByLabelText('Group by')).toBeNull();
    unmount();
    render(
      <CustomViewEditor
        view={kanban({ layout: 'table', columnFieldId: null })}
        fields={FIELDS}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Group by')).toBeDefined();
    expect(within(screen.getByLabelText('Group by')).getByRole('option', { name: 'Priority' })).toBeDefined();
  });
});
