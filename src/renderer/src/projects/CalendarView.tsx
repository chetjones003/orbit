import { useState } from 'react';
import type { CalendarScale } from '../../../shared/custom-views';
import type { ProjectField, ProjectFieldInput, ProjectItem } from '../../../shared/projects';
import { openableKind } from './project-model';
import { calendarWeeks, dayBar, monthLabel, partitionBars, shiftAnchor } from './schedule-model';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface CalendarViewProps {
  /** The date field an item is placed by. Null when the view has none chosen yet. */
  field: ProjectField | null;
  scale: CalendarScale;
  /** The items the view shows, in their view order. */
  items: ProjectItem[];
  /** Today, `YYYY-MM-DD`. The calendar opens on it. */
  today: string;
  pendingIds: ReadonlySet<string>;
  /** Saves one field and resolves to the item as GitHub now has it, or null when the save did not land. */
  onEdit: (
    item: ProjectItem,
    field: ProjectField,
    value: ProjectFieldInput | null
  ) => Promise<ProjectItem | null>;
  onOpen: (repoFullName: string, number: number, kind: 'issue' | 'pull') => void;
}

/**
 * A month or week calendar placing items by a date field. Dragging an item to a day reschedules it, and an
 * item with no date waits in the Unscheduled list until it is dropped on a day.
 */
export function CalendarView({ field, scale, items, today, pendingIds, onEdit, onOpen }: CalendarViewProps) {
  const [anchor, setAnchor] = useState(today);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  if (field === null) {
    return <p className="project-note">Choose a date field to show this calendar.</p>;
  }
  const dateField = field;

  const { scheduled, unscheduled } = partitionBars(items, (item) => dayBar(item, dateField.id));
  const byDay = new Map<string, ProjectItem[]>();
  for (const entry of scheduled) {
    const list = byDay.get(entry.bar.start) ?? [];
    list.push(entry.item);
    byDay.set(entry.bar.start, list);
  }
  const weeks = calendarWeeks(anchor, scale);
  const heading = scale === 'month' ? monthLabel(anchor) : `Week of ${weeks[0]?.[0] ?? anchor}`;
  const anchorMonth = anchor.slice(0, 7);

  const dropOnDay = async (day: string) => {
    setDropTarget(null);
    const id = dragging;
    setDragging(null);
    const item = items.find((i) => i.id === id);
    if (!item || pendingIds.has(item.id)) return;
    if (dayBar(item, dateField.id)?.start === day) return;
    await onEdit(item, dateField, { kind: 'date', date: day });
  };

  const chip = (item: ProjectItem) => {
    const pending = pendingIds.has(item.id);
    const kind = openableKind(item);
    return (
      <article
        key={item.id}
        className={`calendar-chip ${pending ? 'pending' : ''}`}
        draggable={!pending}
        aria-busy={pending || undefined}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', item.id);
          setDragging(item.id);
        }}
        onDragEnd={() => setDragging(null)}
      >
        {kind && item.repoFullName && item.number !== null ? (
          <button
            type="button"
            className="link-button"
            onClick={() => onOpen(item.repoFullName as string, item.number as number, kind)}
          >
            {item.title}
          </button>
        ) : (
          <p>{item.title}</p>
        )}
      </article>
    );
  };

  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <button
          type="button"
          className="secondary-action"
          onClick={() => setAnchor(shiftAnchor(anchor, scale, -1))}
        >
          Previous
        </button>
        <button type="button" className="secondary-action" onClick={() => setAnchor(today)}>
          Today
        </button>
        <button
          type="button"
          className="secondary-action"
          onClick={() => setAnchor(shiftAnchor(anchor, scale, 1))}
        >
          Next
        </button>
        <h4 aria-live="polite">{heading}</h4>
      </div>

      <section role="region" aria-label="Unscheduled" className="calendar-unscheduled">
        <h4>
          Unscheduled <span className="project-column-count">{unscheduled.length}</span>
        </h4>
        {unscheduled.length === 0 && <p className="project-note">Every item has a date.</p>}
        {unscheduled.map(chip)}
      </section>

      <div className="calendar-grid">
        {scale === 'month' && (
          <div className="calendar-weekdays">
            {WEEKDAYS.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        )}
        {weeks.map((week) => (
          <div key={week[0]} className="calendar-week">
            {week.map((day) => {
              const dayItems = byDay.get(day) ?? [];
              const outside = scale === 'month' && day.slice(0, 7) !== anchorMonth;
              return (
                <div
                  key={day}
                  role="gridcell"
                  aria-label={day}
                  className={`calendar-day ${outside ? 'outside' : ''} ${dropTarget === day ? 'drop-target' : ''}`}
                  onDragOver={(event) => {
                    if (!dragging) return;
                    event.preventDefault();
                    setDropTarget(day);
                  }}
                  onDragLeave={() => setDropTarget((current) => (current === day ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    void dropOnDay(day);
                  }}
                >
                  <span className="calendar-day-number">{Number(day.slice(8))}</span>
                  {dayItems.map(chip)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
