import type { CustomViewDefinition } from '../../../shared/custom-views';
import type { ProjectField, ProjectFieldInput, ProjectItem } from '../../../shared/projects';
import { CalendarView } from './CalendarView';
import { CustomViewEditor } from './CustomViewEditor';
import { GanttView } from './GanttView';
import { KanbanView } from './KanbanView';
import { ProjectTable } from './ProjectTable';
import { findMappingRepairs, groupItems, viewItems } from './custom-view-model';
import { todayIso } from './schedule-model';

export interface CustomViewPanelProps {
  view: CustomViewDefinition;
  fields: ProjectField[];
  /** The items GitHub returned for the view's advanced filter. Visual filters and sorting run on these. */
  items: ProjectItem[];
  pendingIds: ReadonlySet<string>;
  onChange: (next: CustomViewDefinition) => void;
  onDelete: () => void;
  onEdit: (
    item: ProjectItem,
    field: ProjectField,
    value: ProjectFieldInput | null
  ) => Promise<ProjectItem | null>;
  onReorder: (item: ProjectItem, afterId: string | null) => Promise<unknown>;
  onRemove: (item: ProjectItem) => void;
  onOpen: (repoFullName: string, number: number, kind: 'issue' | 'pull') => void;
  /** Today, `YYYY-MM-DD`. Defaults to the local date; the Gantt and Calendar open on it. */
  today?: string;
}

/**
 * One custom view on screen: its settings, then its Kanban board or table. A mapped field that no longer
 * exists or fits is not used; the settings open and say what to repair.
 */
export function CustomViewPanel({
  view,
  fields,
  items,
  pendingIds,
  onChange,
  onDelete,
  onEdit,
  onReorder,
  onRemove,
  onOpen,
  today = todayIso()
}: CustomViewPanelProps) {
  const shown = viewItems(items, view, fields);
  const column = usable(fields, view.columnFieldId, isGroupable);
  const swimlane = usable(fields, view.swimlaneFieldId, isGroupable);
  const group = usable(fields, view.groupFieldId, isGroupable);
  const startField = usable(fields, view.startFieldId, isDate);
  const targetField = usable(fields, view.targetFieldId, isDate);
  const iterationField = usable(fields, view.iterationFieldId, isIteration);
  const calendarField = usable(fields, view.calendarFieldId, isDate);
  const needsColumn = view.layout === 'kanban' && !column;
  // A broken reference opens the settings, so the repair it needs is visible.
  const repairs = findMappingRepairs(view, fields);

  return (
    <div className="custom-view-panel">
      <details className="custom-view-settings" open={needsColumn || repairs.length > 0}>
        <summary>View settings</summary>
        <CustomViewEditor key={view.id} view={view} fields={fields} onChange={onChange} onDelete={onDelete} />
      </details>
      {needsColumn && (
        <p className="project-note">
          Choose a column field to show this Kanban. Each of its values becomes a column.
        </p>
      )}
      {view.layout === 'kanban' && column && (
        <KanbanView
          columnField={column}
          swimlaneField={swimlane}
          groups={groupItems(shown, column) ?? []}
          laneGroups={swimlane ? groupItems(shown, swimlane) : null}
          pendingIds={pendingIds}
          onEdit={onEdit}
          order={shown}
          manualOrder={view.sort === null}
          onReorder={onReorder}
          onOpen={onOpen}
        />
      )}
      {view.layout === 'gantt' && (
        <GanttView
          source={view.ganttSource}
          startField={startField}
          targetField={targetField}
          iterationField={iterationField}
          items={shown}
          today={today}
          pendingIds={pendingIds}
          onEdit={onEdit}
          onOpen={onOpen}
        />
      )}
      {view.layout === 'calendar' && (
        <CalendarView
          field={calendarField}
          scale={view.calendarScale}
          items={shown}
          today={today}
          pendingIds={pendingIds}
          onEdit={onEdit}
          onOpen={onOpen}
        />
      )}
      {view.layout === 'table' && (
        <ProjectTable
          fields={fields}
          items={shown}
          groups={group ? (groupItems(shown, group) ?? undefined) : undefined}
          sort={view.sort}
          onSort={(fieldId) => onChange({ ...view, sort: nextSort(view, fieldId) })}
          pendingIds={pendingIds}
          onEdit={(item, field, value) => void onEdit(item, field, value)}
          onRemove={onRemove}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}

/** The field a mapping points at, when it still exists and can take that role. */
function usable(
  fields: ProjectField[],
  fieldId: string | null,
  accept: (field: ProjectField) => boolean
): ProjectField | null {
  if (fieldId === null) return null;
  const field = fields.find((f) => f.id === fieldId);
  return field && accept(field) ? field : null;
}

const isGroupable = (field: ProjectField) => field.kind === 'single-select' || field.kind === 'iteration';
const isDate = (field: ProjectField) => field.kind === 'date';
const isIteration = (field: ProjectField) => field.kind === 'iteration';

/** Pressing a header sorts ascending, then descending on the second press, and then clears the sort. */
function nextSort(view: CustomViewDefinition, fieldId: string): CustomViewDefinition['sort'] {
  if (view.sort?.fieldId !== fieldId) return { fieldId, direction: 'asc' };
  if (view.sort.direction === 'asc') return { fieldId, direction: 'desc' };
  return null;
}
