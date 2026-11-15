import { useState } from 'react';
import type { ProjectField, ProjectFieldInput, ProjectItem } from '../../../shared/projects';
import { openableKind } from './project-model';
import type { ItemGroup } from './custom-view-model';

export interface KanbanViewProps {
  /** The field whose values are the columns. */
  columnField: ProjectField;
  /** The field whose values are the swimlanes, or null for none. */
  swimlaneField: ProjectField | null;
  /** Columns, in order, from `groupItems` over the column field. Includes the No value column. */
  groups: ItemGroup[];
  /** Swimlanes, in order, from `groupItems` over the swimlane field. Null when there are none. */
  laneGroups: ItemGroup[] | null;
  pendingIds: ReadonlySet<string>;
  /**
   * Saves one field value and resolves to the item as GitHub now has it, or null when the save did not
   * land. A drop that changes two fields waits for the first before it starts the second.
   */
  onEdit: (
    item: ProjectItem,
    field: ProjectField,
    value: ProjectFieldInput | null
  ) => Promise<ProjectItem | null>;
  onOpen: (repoFullName: string, number: number, kind: 'issue' | 'pull') => void;
}

const ALL_LANE = 'ALL';

/**
 * Columns from one field and optional swimlanes from another. Dropping a card writes the field values
 * back to GitHub, so a card that moves between columns or lanes changes what GitHub stores.
 */
export function KanbanView({
  columnField,
  swimlaneField,
  groups,
  laneGroups,
  pendingIds,
  onEdit,
  onOpen
}: KanbanViewProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const lanes: ItemGroup[] = laneGroups ?? [{ key: ALL_LANE, label: '', target: null, items: [] }];
  const itemsById = new Map<string, ProjectItem>();
  for (const group of [...groups, ...lanes]) for (const item of group.items) itemsById.set(item.id, item);
  const columnOf = groupOfItem(groups);
  const laneOf = laneGroups ? groupOfItem(laneGroups) : null;

  const drop = async (column: ItemGroup, lane: ItemGroup) => {
    setDropTarget(null);
    const id = dragging;
    setDragging(null);
    const item = id ? itemsById.get(id) : undefined;
    if (!item || pendingIds.has(item.id)) return;
    let current: ProjectItem = item;
    if (columnOf.get(item.id) !== column.key) {
      const saved = await onEdit(current, columnField, column.target);
      if (!saved) return;
      current = saved;
    }
    if (swimlaneField && laneOf && laneOf.get(item.id) !== lane.key) {
      await onEdit(current, swimlaneField, lane.target);
    }
  };

  const cell = (lane: ItemGroup, column: ItemGroup) => {
    const key = `${lane.key}|${column.key}`;
    const cellItems = column.items.filter((item) => !laneGroups || lane.items.includes(item));
    return (
      <section
        key={key}
        role="listitem"
        className={`project-column ${dropTarget === key ? 'drop-target' : ''}`}
        aria-label={`${column.label}, ${cellItems.length} items`}
        onDragOver={(event) => {
          if (!dragging) return;
          event.preventDefault();
          setDropTarget(key);
        }}
        onDragLeave={() => setDropTarget((current) => (current === key ? null : current))}
        onDrop={(event) => {
          event.preventDefault();
          void drop(column, lane);
        }}
      >
        <h3>
          {column.label} <span className="project-column-count">{cellItems.length}</span>
        </h3>
        {cellItems.map((item) => {
          const pending = pendingIds.has(item.id);
          const kind = openableKind(item);
          return (
            <article
              key={item.id}
              className={`project-card ${pending ? 'pending' : ''}`}
              draggable={!pending}
              aria-busy={pending || undefined}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', item.id);
                setDragging(item.id);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <p className="project-card-title">
                {kind && item.repoFullName && item.number !== null ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onOpen(item.repoFullName as string, item.number as number, kind)}
                  >
                    {item.title}
                  </button>
                ) : (
                  item.title
                )}
              </p>
              {item.repoFullName && (
                <p className="project-card-ref">
                  {item.repoFullName}#{item.number}
                </p>
              )}
            </article>
          );
        })}
      </section>
    );
  };

  return (
    <div className="project-board kanban" aria-label={`Board grouped by ${columnField.name}`}>
      {laneGroups ? (
        lanes.map((lane) => (
          <div key={lane.key} role="region" aria-label={`${lane.label} swimlane`} className="kanban-lane">
            <h4 className="kanban-lane-label">{lane.label}</h4>
            <div className="kanban-lane-columns" role="list">
              {groups.map((column) => cell(lane, column))}
            </div>
          </div>
        ))
      ) : (
        <div className="kanban-lane-columns" role="list">
          {groups.map((column) => cell(lanes[0] as ItemGroup, column))}
        </div>
      )}
    </div>
  );
}

function groupOfItem(groups: ItemGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) for (const item of group.items) map.set(item.id, group.key);
  return map;
}
