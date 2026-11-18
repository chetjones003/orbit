import { useEffect, useState } from 'react';
import type { CalendarScale } from '../../../shared/custom-views';
import type { ProjectField, ProjectFieldInput, ProjectItem } from '../../../shared/projects';
import { Icon } from '../icons';
import { openableKind } from './project-model';
import { calendarWeeks, dayBar, monthLabel, partitionBars, shiftAnchor } from './schedule-model';
import { hovercardProps } from '../hovercard/hovercard-model';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** How many items a month cell lists before the rest fold into "+N more". */
export const CALENDAR_DAY_LIMIT = 3;

export interface CalendarViewProps {
  /** The date field an item is placed by. Null when the view has none chosen yet. */
  field: ProjectField | null;
  /** The view's saved scale. The toolbar can switch it for this visit without changing the view. */
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
 * A month or week calendar placing items by a date field, laid out like a desktop calendar: the period and its
 * navigation on top, a full-height grid with today marked, and items without a date in a rail beside it.
 * Dragging an item to a day reschedules it; a day with more items than fit folds the rest into "+N more".
 */
export function CalendarView({ field, scale, items, today, pendingIds, onEdit, onOpen }: CalendarViewProps) {
  const [anchor, setAnchor] = useState(today);
  const [scaleChoice, setScaleChoice] = useState<CalendarScale | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const shownScale = scaleChoice ?? scale;

  // An open "+N more" list closes on Escape or a press anywhere outside it.
  useEffect(() => {
    if (expanded === null) return undefined;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof MouseEvent && (event.target as Element | null)?.closest('.cal-day.expanded'))
        return;
      setExpanded(null);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('mousedown', close);
    };
  }, [expanded]);

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
  const weeks = calendarWeeks(anchor, shownScale);
  const heading = shownScale === 'month' ? monthLabel(anchor) : weekLabel(weeks[0] ?? [anchor]);
  const anchorMonth = anchor.slice(0, 7);
  const showsToday = weeks.some((week) => week.includes(today));
  const inPeriod = scheduled.filter(({ bar }) =>
    shownScale === 'month' ? bar.start.slice(0, 7) === anchorMonth : weeks[0]?.includes(bar.start)
  ).length;

  const dropOnDay = async (day: string) => {
    setDropTarget(null);
    const id = dragging;
    setDragging(null);
    const item = items.find((i) => i.id === id);
    if (!item || pendingIds.has(item.id)) return;
    if (dayBar(item, dateField.id)?.start === day) return;
    await onEdit(item, dateField, { kind: 'date', date: day });
  };

  const event = (item: ProjectItem, place: 'day' | 'undated') => {
    const pending = pendingIds.has(item.id);
    const kind = openableKind(item);
    const ref = item.repoFullName && item.number !== null ? `${item.repoFullName}#${item.number}` : 'Draft';
    return (
      <article
        key={item.id}
        className={`cal-event ${place} ${tone(item)} ${pending ? 'pending' : ''} ${dragging === item.id ? 'dragging' : ''}`}
        draggable={!pending}
        aria-busy={pending || undefined}
        title={`${item.title}\n${ref}`}
        onDragStart={(drag) => {
          drag.dataTransfer.setData('text/plain', item.id);
          drag.dataTransfer.effectAllowed = 'move';
          setDragging(item.id);
          setExpanded(null);
        }}
        onDragEnd={() => {
          setDragging(null);
          setDropTarget(null);
        }}
      >
        <span className={`cal-event-icon ${item.kind} ${item.state}`} aria-hidden="true">
          <Icon
            name={item.kind === 'pull' ? (item.state === 'merged' ? 'merge' : 'pull') : 'issue'}
            size={12}
          />
        </span>
        <span className="cal-event-text">
          {kind && item.repoFullName && item.number !== null ? (
            <button
              type="button"
              className="cal-event-title"
              {...hovercardProps(item.repoFullName, item.number, item.kind)}
              onClick={() => onOpen(item.repoFullName as string, item.number as number, kind)}
            >
              {item.title}
            </button>
          ) : (
            <span className="cal-event-title">{item.title}</span>
          )}
          {(place === 'undated' || shownScale === 'week') && <span className="cal-event-ref">{ref}</span>}
        </span>
      </article>
    );
  };

  return (
    <div className={`cal-view scale-${shownScale}`}>
      <div className="cal-toolbar">
        <h4 aria-live="polite">{heading}</h4>
        <div className="cal-nav">
          <button
            type="button"
            className="cal-today"
            disabled={showsToday && (shownScale === 'week' || anchorMonth === today.slice(0, 7))}
            onClick={() => setAnchor(today)}
          >
            Today
          </button>
          <button
            type="button"
            className="cal-step"
            aria-label="Previous"
            title={shownScale === 'month' ? 'Previous month' : 'Previous week'}
            onClick={() => setAnchor(shiftAnchor(anchor, shownScale, -1))}
          >
            <Icon name="chevronLeft" size={15} />
          </button>
          <button
            type="button"
            className="cal-step"
            aria-label="Next"
            title={shownScale === 'month' ? 'Next month' : 'Next week'}
            onClick={() => setAnchor(shiftAnchor(anchor, shownScale, 1))}
          >
            <Icon name="chevronRight" size={15} />
          </button>
        </div>
        <span className="cal-summary">
          {inPeriod} {inPeriod === 1 ? 'item' : 'items'} this {shownScale}
        </span>
        <div className="cal-scale" role="group" aria-label="Show">
          {(['month', 'week'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={shownScale === option}
              onClick={() => setScaleChoice(option)}
            >
              {option === 'month' ? 'Month' : 'Week'}
            </button>
          ))}
        </div>
      </div>

      <div className="cal-body">
        <div className="cal-grid" role="grid" aria-label={heading}>
          <div className="cal-weekdays" role="row">
            {WEEKDAYS.map((name, index) => (
              <span key={name} role="columnheader" className={index >= 5 ? 'weekend' : ''} aria-label={name}>
                {shownScale === 'week' ? (
                  <WeekHeading name={name} day={weeks[0]?.[index]} today={today} />
                ) : (
                  name
                )}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className="cal-week" role="row">
              {week.map((day, index) => {
                const dayItems = byDay.get(day) ?? [];
                const outside = shownScale === 'month' && day.slice(0, 7) !== anchorMonth;
                const open = expanded === day;
                const limit = shownScale === 'month' && !open ? CALENDAR_DAY_LIMIT : Infinity;
                // When items overflow, the last visible line is given to "+N more".
                const visible = dayItems.length > limit ? dayItems.slice(0, limit - 1) : dayItems;
                const hidden = dayItems.length - visible.length;
                const classes = [
                  'cal-day',
                  outside ? 'outside' : '',
                  index >= 5 ? 'weekend' : '',
                  day === today ? 'today' : '',
                  day < today ? 'past' : '',
                  dropTarget === day ? 'drop-target' : '',
                  open ? 'expanded' : ''
                ];
                return (
                  <div
                    key={day}
                    role="gridcell"
                    aria-label={day}
                    className={classes.filter(Boolean).join(' ')}
                    onDragOver={(drag) => {
                      if (!dragging) return;
                      drag.preventDefault();
                      if (dropTarget !== day) setDropTarget(day);
                    }}
                    onDragLeave={(drag) => {
                      if (drag.currentTarget.contains(drag.relatedTarget as Node | null)) return;
                      setDropTarget((current) => (current === day ? null : current));
                    }}
                    onDrop={(drag) => {
                      drag.preventDefault();
                      void dropOnDay(day);
                    }}
                  >
                    {shownScale === 'month' && (
                      <span className="cal-day-head">
                        <span className="cal-day-number" aria-current={day === today ? 'date' : undefined}>
                          {dayNumberLabel(day)}
                        </span>
                      </span>
                    )}
                    <div className="cal-day-events">
                      {visible.map((item) => event(item, 'day'))}
                      {hidden > 0 && (
                        <button type="button" className="cal-more" onClick={() => setExpanded(day)}>
                          {hidden} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <aside role="region" aria-label="Unscheduled" className="cal-rail">
          <div className="cal-rail-head">
            <h4>No date</h4>
            <span className="cal-count">{unscheduled.length}</span>
          </div>
          {unscheduled.length === 0 ? (
            <p className="cal-rail-empty">Every item has a date.</p>
          ) : (
            <>
              <p className="cal-rail-hint">Drag an item onto a day to schedule it.</p>
              <div className="cal-rail-list">{unscheduled.map((item) => event(item, 'undated'))}</div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/** A week column's heading: the weekday over a large date, today's filled. */
function WeekHeading({ name, day, today }: { name: string; day: string | undefined; today: string }) {
  return (
    <>
      <span className="cal-week-name">{name}</span>
      <span className="cal-day-number" aria-current={day === today ? 'date' : undefined}>
        {day ? Number(day.slice(8)) : ''}
      </span>
    </>
  );
}

/** The first of a month names the month: "Nov 1". */
function dayNumberLabel(day: string): string {
  const date = Number(day.slice(8));
  return date === 1 ? `${shortMonth(day)} 1` : String(date);
}

/** For example "Nov 9 – 15, 2026", or "Nov 30 – Dec 6, 2026" across a month. */
function weekLabel(week: string[]): string {
  const first = week[0] ?? '';
  const last = week[week.length - 1] ?? first;
  const year = last.slice(0, 4);
  const end =
    first.slice(0, 7) === last.slice(0, 7)
      ? Number(last.slice(8))
      : `${shortMonth(last)} ${Number(last.slice(8))}`;
  const startYear = first.slice(0, 4) !== year ? `, ${first.slice(0, 4)}` : '';
  return `${shortMonth(first)} ${Number(first.slice(8))}${startYear} – ${end}, ${year}`;
}

function shortMonth(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

/** Items are coloured by where they stand: open work in the action colour, finished work quiet. */
function tone(item: ProjectItem): string {
  if (item.kind === 'draft') return 'tone-draft';
  return item.state === 'open' ? 'tone-open' : 'tone-done';
}
