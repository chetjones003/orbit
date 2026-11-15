import type { ProjectField, ProjectItem } from '../../../shared/projects';
import { boardColumns, openableKind, type SingleSelectField } from './project-model';
import { ProjectValueLabel } from './ProjectValueLabel';
import { cardRows, useCardDrag } from './card-drag';

export interface ProjectBoardProps {
  field: SingleSelectField;
  items: ProjectItem[];
  /** Other fields shown on each card, in project order. */
  cardFields: ProjectField[];
  pendingIds: ReadonlySet<string>;
  /** `null` clears the grouping field, which is what the "No value" column does. */
  onMove: (item: ProjectItem, optionId: string | null) => void;
  onOpen: (repoFullName: string, number: number, kind: 'issue' | 'pull') => void;
}

/**
 * Columns for one single-select field. Cards move by drag, or by the select on each card. A drag copies the
 * card under the pointer, and the other cards slide aside where it would land.
 */
export function ProjectBoard({ field, items, cardFields, pendingIds, onMove, onOpen }: ProjectBoardProps) {
  const columns = boardColumns(field, items);
  const byId = new Map(items.map((item) => [item.id, item]));

  const moveTo = (itemId: string, optionId: string | null) => {
    const item = byId.get(itemId);
    if (!item || pendingIds.has(item.id)) return;
    const current = item.fieldValues[field.id];
    const currentOption = current?.kind === 'single-select' ? current.optionId : null;
    // Dropping on the column the card is already in is not a change.
    if (currentOption === optionId) return;
    onMove(item, optionId);
  };

  const drag = useCardDrag((target, itemId) => {
    const column = columns.find((candidate) => candidate.key === target.cellKey);
    if (column) moveTo(itemId, column.optionId);
  });

  return (
    <div
      ref={drag.rootRef}
      className="project-board"
      role="list"
      aria-label={`Board grouped by ${field.name}`}
    >
      {columns.map((column) => (
        <section
          key={column.key}
          data-drop-key={column.key}
          className={`project-column ${drag.slotFor(column.key) !== null ? 'drop-target' : ''}`}
          role="listitem"
          aria-label={`${column.label}, ${column.items.length} items`}
        >
          <h3>
            {column.label} <span className="project-column-count">{column.items.length}</span>
          </h3>
          {cardRows(column.items, drag.draggingId, drag.slotFor(column.key), drag.slotHeight, (item) => {
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
                {cardFields
                  .filter((f) => f.id !== field.id && item.fieldValues[f.id] !== undefined)
                  .map((f) => (
                    <p key={f.id} className="project-card-field">
                      {f.name}: <ProjectValueLabel field={f} value={item.fieldValues[f.id]} />
                    </p>
                  ))}
                <label className="project-card-move">
                  <span className="sr-only">Move {item.title}</span>
                  <select
                    aria-label={`${field.name} for ${item.title}`}
                    disabled={pending}
                    value={column.key === 'NONE' ? '' : (column.optionId ?? '')}
                    onChange={(event) => onMove(item, event.target.value === '' ? null : event.target.value)}
                  >
                    <option value="">No value</option>
                    {field.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
