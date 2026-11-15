import { useState } from 'react';
import type { CustomViewDefinition } from '../../../shared/custom-views';
import { Modal } from '../chrome/Modal';
import type { ProjectField, ProjectFieldInput, ProjectItem } from '../../../shared/projects';
import { Icon } from '../icons';
import { CalendarView } from './CalendarView';
import { CustomViewEditor } from './CustomViewEditor';
import { GanttView } from './GanttView';
import { KanbanView } from './KanbanView';
import { ProjectFilterBar } from './ProjectFilterBar';
import { ProjectTable } from './ProjectTable';
import {
  findMappingRepairs,
  groupItems,
  isDateField,
  isGroupableField,
  isIterationField,
  viewItems
} from './custom-view-model';
import { todayIso } from './schedule-model';

export interface CustomViewPanelProps {
  view: CustomViewDefinition;
  fields: ProjectField[];
  /** The items GitHub returned for the view's advanced filter, already narrowed by the keyword filter. */
  items: ProjectItem[];
  /** The keyword the user typed into the view's filter bar. */
  keyword: string;
  onKeywordChange: (keyword: string) => void;
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
  /** Opens the settings dialog as soon as the view is shown. A view that was just created uses this. */
  openSettingsFirst?: boolean;
  /** Called when the settings dialog closes, so a just-created view opens its settings only once. */
  onSettingsClosed?: () => void;
  /** Today, `YYYY-MM-DD`. Defaults to the local date; the Gantt and Calendar open on it. */
  today?: string;
}

/**
 * One custom view on screen: its filter bar, its settings in a dialog, then its Kanban board, table, Gantt,
 * or calendar. A mapped field that no longer exists or fits is not used; the settings say what to repair.
 */
export function CustomViewPanel({
  view,
  fields,
  items,
  keyword,
  onKeywordChange,
  pendingIds,
  onChange,
  onDelete,
  onEdit,
  onReorder,
  onRemove,
  onOpen,
  openSettingsFirst = false,
  onSettingsClosed,
  today = todayIso()
}: CustomViewPanelProps) {
  const shown = viewItems(items, view, fields);
  const column = usable(fields, view.columnFieldId, isGroupableField);
  const swimlane = usable(fields, view.swimlaneFieldId, isGroupableField);
  const group = usable(fields, view.groupFieldId, isGroupableField);
  const startField = usable(fields, view.startFieldId, isDateField);
  const targetField = usable(fields, view.targetFieldId, isDateField);
  const iterationField = usable(fields, view.iterationFieldId, isIterationField);
  const calendarField = usable(fields, view.calendarFieldId, isDateField);
  const needsColumn = view.layout === 'kanban' && !column;
  // A broken reference is named above the view, with a way to repair it.
  const repairs = findMappingRepairs(view, fields);
  const [settingsOpen, setSettingsOpen] = useState(openSettingsFirst);
  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => {
    setSettingsOpen(false);
    onSettingsClosed?.();
  };

  return (
    <div className="custom-view-panel">
      <ProjectFilterBar keyword={keyword} onKeywordChange={onKeywordChange} count={shown.length}>
        <button type="button" className="secondary-action" onClick={openSettings}>
          View settings
        </button>
      </ProjectFilterBar>
      {repairs.length > 0 && (
        <p className="cve-note cve-alert">
          Some settings need repair before this view can show everything.{' '}
          <button type="button" className="secondary-action" onClick={openSettings}>
            Open settings
          </button>
        </p>
      )}
      {needsColumn && (
        <div className="project-empty">
          <span className="project-empty-icon" aria-hidden="true">
            <Icon name="projects" size={22} />
          </span>
          <h3>Choose a column field</h3>
          <p>Each value of the field becomes a column, and each item moves into the column of its value.</p>
          <button type="button" className="primary-action" onClick={openSettings}>
            Open settings
          </button>
        </div>
      )}
      {settingsOpen && (
        <Modal title="View settings" subtitle={view.name} onClose={closeSettings}>
          <CustomViewEditor
            key={view.id}
            view={view}
            fields={fields}
            onChange={onChange}
            onDelete={onDelete}
          />
        </Modal>
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

/** Pressing a header sorts ascending, then descending on the second press, and then clears the sort. */
function nextSort(view: CustomViewDefinition, fieldId: string): CustomViewDefinition['sort'] {
  if (view.sort?.fieldId !== fieldId) return { fieldId, direction: 'asc' };
  if (view.sort.direction === 'asc') return { fieldId, direction: 'desc' };
  return null;
}
