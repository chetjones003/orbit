import { useState } from 'react';
import type { ProjectField, ProjectItem } from '../../../shared/projects';
import { boardColumns, describeValue, openableKind, type SingleSelectField } from './project-model';

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

/** Columns for one single-select field. Cards move by drag, or by the select on each card. */
export function ProjectBoard({ field, items, cardFields, pendingIds, onMove, onOpen }: ProjectBoardProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const columns = boardColumns(field, items);
  const byId = new Map(items.map((item) => [item.id, item]));

  const drop = (optionId: string | null) => {
    setDropTarget(null);
    const item = dragging ? byId.get(dragging) : undefined;
    setDragging(null);
    if (!item || pendingIds.has(item.id)) return;
    const current = item.fieldValues[field.id];
    const currentOption = current?.kind === 'single-select' ? current.optionId : null;
    // Dropping on the column the card is already in is not a change.
    if (currentOption === optionId) return;
    onMove(item, optionId);
  };

  return (
    <div className="project-board" role="list" aria-label={`Board grouped by ${field.name}`}>
      {columns.map((column) => (
        <section
          key={column.key}
          className={`project-column ${dropTarget === column.key ? 'drop-target' : ''}`}
          role="listitem"
          aria-label={`${column.label}, ${column.items.length} items`}
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            setDropTarget(column.key);
          }}
          onDragLeave={() => setDropTarget((current) => (current === column.key ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            drop(column.optionId);
          }}
        >
          <h3>
            {column.label} <span className="project-column-count">{column.items.length}</span>
          </h3>
          {column.items.map((item) => {
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
                {cardFields
                  .filter((f) => f.id !== field.id && item.fieldValues[f.id] !== undefined)
                  .map((f) => (
                    <p key={f.id} className="project-card-field">
                      {f.name}: {describeValue(item.fieldValues[f.id])}
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
