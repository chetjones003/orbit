import type { ProjectField, ProjectFieldInput, ProjectItem } from '../../../shared/projects';
import { openableKind } from './project-model';
import { ProjectCardLabels } from './ProjectCardLabels';
import type { ItemGroup } from './custom-view-model';
import { cardRows, useCardDrag } from './card-drag';
import { hovercardProps } from '../hovercard/hovercard-model';

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
  /** Every item the view shows, in GitHub's manual order when the view is unsorted. */
  order: ProjectItem[];
  /** True when the view has no sort, so dropping a card on a card reorders it on GitHub. */
  manualOrder: boolean;
  /** Places an item after another item in the manual order, or at the top when `afterId` is null. */
  onReorder: (item: ProjectItem, afterId: string | null) => Promise<unknown>;
  onOpen: (repoFullName: string, number: number, kind: 'issue' | 'pull') => void;
}

/** The one row used when there are no swimlanes. */
const NO_LANE: ItemGroup = { key: 'ALL', label: '', target: null, items: [] };

interface Cell {
  lane: ItemGroup;
  column: ItemGroup;
  items: ProjectItem[];
}

/**
 * Columns from one field and optional swimlanes from another. Dropping a card writes the field values
 * back to GitHub, so a card that moves between columns or lanes changes what GitHub stores. A card dropped
 * in its own cell of an unsorted view moves to its new slot, which GitHub stores as its manual order.
 */
export function KanbanView({
  columnField,
  swimlaneField,
  groups,
  laneGroups,
  pendingIds,
  onEdit,
  manualOrder,
  onReorder,
  onOpen
}: KanbanViewProps) {
  const lanes: ItemGroup[] = laneGroups ?? [NO_LANE];
  const itemsById = new Map<string, ProjectItem>();
  for (const group of [...groups, ...lanes]) for (const item of group.items) itemsById.set(item.id, item);
  const columnOf = groupOfItem(groups);
  const laneOf = laneGroups ? groupOfItem(laneGroups) : null;

  const cells = new Map<string, Cell>();
  for (const lane of lanes) {
    for (const column of groups) {
      const items = column.items.filter((item) => !laneGroups || lane.items.includes(item));
      cells.set(cellKey(lane, column), { lane, column, items });
    }
  }

  const drop = async (cell: Cell, item: ProjectItem) => {
    let current: ProjectItem = item;
    if (columnOf.get(item.id) !== cell.column.key) {
      const saved = await onEdit(current, columnField, cell.column.target);
      if (!saved) return;
      current = saved;
    }
    if (swimlaneField && laneOf && laneOf.get(item.id) !== cell.lane.key) {
      await onEdit(current, swimlaneField, cell.lane.target);
    }
  };

  const drag = useCardDrag((target, itemId, origin) => {
    const cell = cells.get(target.cellKey);
    const item = itemsById.get(itemId);
    if (!cell || !item || pendingIds.has(item.id)) return;
    if (target.cellKey === origin.cellKey) {
      // Same cell: a sorted view has no manual order to change, and a drop where the card already is changes nothing.
      if (!manualOrder || target.index === origin.index) return;
      const others = cell.items.filter((candidate) => candidate.id !== item.id);
      const above = target.index > 0 ? others[target.index - 1] : undefined;
      void onReorder(item, above?.id ?? null);
      return;
    }
    void drop(cell, item);
  });

  const cell = (lane: ItemGroup, column: ItemGroup) => {
    const key = cellKey(lane, column);
    const entry = cells.get(key);
    const cellItems = entry?.items ?? [];
    return (
      <section
        key={key}
        role="listitem"
        data-drop-key={key}
        className={`project-column ${drag.slotFor(key) !== null ? 'drop-target' : ''}`}
        aria-label={`${column.label}, ${cellItems.length} items`}
      >
        <h3>
          {column.label} <span className="project-column-count">{cellItems.length}</span>
        </h3>
        {cardRows(cellItems, drag.draggingId, drag.slotFor(key), drag.slotHeight, (item) => {
          const pending = pendingIds.has(item.id);
          const kind = openableKind(item);
          return (
            <article
              key={item.id}
              data-card-id={item.id}
              className={`project-card ${pending ? 'pending' : ''}`}
              aria-busy={pending || undefined}
              {...drag.cardHandlers(item.id, !pending)}
            >
              <p className="project-card-title">
                {kind && item.repoFullName && item.number !== null ? (
                  <button
                    type="button"
                    className="link-button"
                    {...hovercardProps(item.repoFullName, item.number, kind)}
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
              <ProjectCardLabels item={item} />
            </article>
          );
        })}
      </section>
    );
  };

  return (
    <div
      ref={drag.rootRef}
      className="project-board kanban"
      aria-label={`Kanban grouped by ${columnField.name}`}
    >
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
          {groups.map((column) => cell(NO_LANE, column))}
        </div>
      )}
    </div>
  );
}

function cellKey(lane: ItemGroup, column: ItemGroup): string {
  return `${lane.key}|${column.key}`;
}

function groupOfItem(groups: ItemGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) for (const item of group.items) map.set(item.id, group.key);
  return map;
}
