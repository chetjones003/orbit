import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../icons';
import type { GanttSource } from '../../../shared/custom-views';
import type { ProjectField, ProjectFieldInput, ProjectItem } from '../../../shared/projects';
import { openableKind } from './project-model';
import {
  addDays,
  dateBar,
  daysBetween,
  type DayBar,
  type DateWrite,
  ganttRange,
  iterationBar,
  iterationForDay,
  iterationIdOf,
  moveWrites,
  partitionBars,
  resizeWrites,
  scheduleWrites
} from './schedule-model';

/** Width of one day on the timeline, in pixels. */
export const GANTT_DAY_WIDTH = 28;

/** Width of the item column that stays in view while the timeline scrolls. */
export const GANTT_LABEL_WIDTH = 240;

export interface GanttViewProps {
  source: GanttSource;
  /** Dates source: where a bar starts. */
  startField: ProjectField | null;
  /** Dates source: where a bar ends. */
  targetField: ProjectField | null;
  /** Iteration source: the field whose iteration a bar spans. */
  iterationField: ProjectField | null;
  /** The items the view shows, in their view order. */
  items: ProjectItem[];
  /** Today, `YYYY-MM-DD`. The timeline always shows it. */
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

type DragMode = 'move' | 'start' | 'end';

interface Preview {
  id: string;
  mode: DragMode;
  days: number;
}

/**
 * A timeline of items as bars, with unscheduled items listed beside it. Dates-source bars can be moved and
 * resized; iteration-source bars can only be moved between iterations, because GitHub fixes an iteration's
 * length. A chip dropped on a day is scheduled to that day.
 */
export function GanttView({
  source,
  startField,
  targetField,
  iterationField,
  items,
  today,
  pendingIds,
  onEdit,
  onOpen
}: GanttViewProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const iterations = iterationField?.kind === 'iteration' ? iterationField.iterations : [];
  const datesReady = source === 'dates' && startField !== null && targetField !== null;
  const iterationReady = source === 'iteration' && iterationField?.kind === 'iteration';

  const barOf = (item: ProjectItem): DayBar | null => {
    if (source === 'iteration') return iterationReady ? iterationBar(item, iterationField.id) : null;
    return datesReady ? dateBar(item, startField.id, targetField.id) : null;
  };

  if (!datesReady && !iterationReady) {
    return (
      <p className="project-note">
        {source === 'iteration'
          ? 'Choose an iteration field to draw this timeline.'
          : 'Choose a start field and a target field to draw this timeline.'}
      </p>
    );
  }

  const { scheduled, unscheduled } = partitionBars(items, barOf);
  // Every iteration in the field is in range, so an item can be dropped in one that no bar reaches.
  const range = ganttRange(
    [
      ...scheduled.map((entry) => entry.bar),
      ...(source === 'iteration'
        ? iterations.map((i) => ({ start: i.startDate, end: addDays(i.startDate, i.duration - 1) }))
        : [])
    ],
    today
  );
  const days = Array.from({ length: daysBetween(range.start, range.end) + 1 }, (_, i) =>
    addDays(range.start, i)
  );

  const saveWrites = async (item: ProjectItem, writes: DateWrite[]) => {
    if (!datesReady) return;
    let current = item;
    for (const write of writes) {
      const field = write.role === 'start' ? startField : targetField;
      const saved = await onEdit(current, field, { kind: 'date', date: write.date });
      // A failed save stops the rest, so a failed first write leaves the bar as it was.
      if (!saved) return;
      current = saved;
    }
  };

  const commit = async (item: ProjectItem, mode: DragMode, days: number) => {
    const bar = barOf(item);
    if (days === 0 || !bar) return;
    if (source === 'iteration' && iterationField) {
      const id = iterationForDay(addDays(bar.start, days), iterations);
      if (id === null) {
        setNote('Drop it inside an iteration to move it there.');
        return;
      }
      if (id === iterationIdOf(item, iterationField.id)) return;
      setNote(null);
      await onEdit(item, iterationField, { kind: 'iteration', iterationId: id });
      return;
    }
    setNote(null);
    await saveWrites(item, barWrites(bar, mode, days));
  };

  /** Follows the pointer until it is released, then saves the move or resize as whole days. */
  const begin = (event: ReactPointerEvent, item: ProjectItem, mode: DragMode) => {
    if (pendingIds.has(item.id) || !barOf(item)) return;
    if (mode !== 'move' && source === 'iteration') return;
    event.stopPropagation();
    event.preventDefault();
    cleanupRef.current?.();
    const origin = event.clientX;
    // A bar moves with the timeline's content, so scrolling counts toward the drag as well as the pointer.
    const scroller = (event.currentTarget as HTMLElement).closest<HTMLElement>('.gantt-scroll');
    const scrollOrigin = scroller?.scrollLeft ?? 0;
    let lastX = origin;
    const dayOf = (clientX: number) =>
      Math.round((clientX - origin + (scroller?.scrollLeft ?? 0) - scrollOrigin) / GANTT_DAY_WIDTH);
    const onMove = (moved: PointerEvent) => {
      lastX = moved.clientX;
      setPreview({ id: item.id, mode, days: dayOf(lastX) });
    };
    const onScroll = () => setPreview({ id: item.id, mode, days: dayOf(lastX) });
    const onUp = (released: PointerEvent) => {
      cleanup();
      setPreview(null);
      void commit(item, mode, dayOf(released.clientX));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      scroller?.removeEventListener('scroll', onScroll);
      cleanupRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    scroller?.addEventListener('scroll', onScroll);
    cleanupRef.current = cleanup;
  };

  const scheduleOn = async (item: ProjectItem, day: string) => {
    if (pendingIds.has(item.id)) return;
    if (source === 'iteration' && iterationField) {
      const id = iterationForDay(day, iterations);
      if (id === null) {
        setNote('Drop it inside an iteration to schedule it there.');
        return;
      }
      setNote(null);
      await onEdit(item, iterationField, { kind: 'iteration', iterationId: id });
      return;
    }
    if (!datesReady) return;
    setNote(null);
    await saveWrites(item, scheduleWrites(item, day, startField.id, targetField.id));
  };

  const dropOnDay = (day: string) => {
    const item = items.find((i) => i.id === dragging);
    setDragging(null);
    if (item) void scheduleOn(item, day);
  };

  /** Where a bar is drawn while it is dragged. An iteration bar shows the iteration a drop would land in. */
  const previewFor = (item: ProjectItem): { left: number; width: number } | null => {
    const bar = barOf(item);
    if (!bar || !preview || preview.id !== item.id) return null;
    if (source === 'iteration') {
      const id = iterationForDay(addDays(bar.start, preview.days), iterations);
      const target = iterations.find((i) => i.id === id);
      return target ? { left: daysBetween(range.start, target.startDate), width: target.duration } : null;
    }
    const next = barWrites(bar, preview.mode, preview.days);
    const start = next.find((w) => w.role === 'start')?.date ?? bar.start;
    const end = next.find((w) => w.role === 'end')?.date ?? bar.end;
    return { left: daysBetween(range.start, start), width: daysBetween(start, end) + 1 };
  };

  return (
    <div className="gantt-view" aria-label="Gantt">
      {note && (
        <p role="alert" className="cve-note cve-alert">
          {note}
        </p>
      )}
      <section role="region" aria-label="Unscheduled" className="gantt-unscheduled">
        <div className="gantt-unscheduled-head">
          <h4>Unscheduled</h4>
          <span className="gantt-count">{unscheduled.length}</span>
          <span className="gantt-hint">Drag an item onto a day to schedule it.</span>
        </div>
        {unscheduled.length === 0 && <p className="gantt-empty">Every item is on the timeline.</p>}
        <div className="gantt-chips">
          {unscheduled.map((item) => (
            <article
              key={item.id}
              className="gantt-chip"
              draggable={!pendingIds.has(item.id)}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', item.id);
                setDragging(item.id);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <p>{item.title}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="gantt-scroll">
        <div className="gantt-grid" style={{ width: GANTT_LABEL_WIDTH + days.length * GANTT_DAY_WIDTH }}>
          {days.indexOf(today) >= 0 && (
            <div
              className="gantt-today-line"
              aria-hidden="true"
              style={{ left: GANTT_LABEL_WIDTH + (days.indexOf(today) + 0.5) * GANTT_DAY_WIDTH }}
            />
          )}
          <div className="gantt-header">
            <div className="gantt-label gantt-corner">Item</div>
            <div className="gantt-track-head" style={{ width: days.length * GANTT_DAY_WIDTH }}>
              {monthSpans(days).map((span) => (
                <div
                  key={span.key}
                  className="gantt-month"
                  style={{ left: span.start * GANTT_DAY_WIDTH, width: span.length * GANTT_DAY_WIDTH }}
                >
                  {span.label}
                </div>
              ))}
              <div className="gantt-days">
                {days.map((day) => (
                  <div
                    key={day}
                    role="columnheader"
                    aria-label={day}
                    className={`gantt-day ${dayClass(day, today)}`}
                    style={{ width: GANTT_DAY_WIDTH }}
                    onDragOver={(event) => {
                      if (dragging) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropOnDay(day);
                    }}
                  >
                    {Number(day.slice(8))}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {groupByStart(scheduled).map((group) => (
            <Fragment key={group.start}>
              <div className="gantt-group-row">
                <div className="gantt-label gantt-group-label">
                  <strong>{dateLabel(group.start)}</strong>
                  <span className="gantt-count">{group.entries.length}</span>
                </div>
                <div className="gantt-track" style={{ width: days.length * GANTT_DAY_WIDTH }}>
                  <div
                    className="gantt-range-pill"
                    style={{
                      left: daysBetween(range.start, group.rangeStart) * GANTT_DAY_WIDTH,
                      width: (daysBetween(group.rangeStart, group.rangeEnd) + 1) * GANTT_DAY_WIDTH - 2
                    }}
                  >
                    {rangeLabel(group.rangeStart, group.rangeEnd)}
                  </div>
                </div>
              </div>
              {group.entries.map(({ item, bar }) => {
                const pending = pendingIds.has(item.id);
                const moved = preview?.id === item.id ? previewFor(item) : null;
                const left = moved?.left ?? daysBetween(range.start, bar.start);
                const width = moved?.width ?? daysBetween(bar.start, bar.end) + 1;
                const kind = openableKind(item);
                return (
                  <div key={item.id} className="gantt-row">
                    <div className="gantt-label" title={item.title}>
                      <span className="gantt-label-line">
                        <Icon name={item.kind === 'pull' ? 'pull' : 'issue'} size={14} />
                        <span className="gantt-label-title">{item.title}</span>
                      </span>
                      {item.repoFullName && item.number !== null && (
                        <span className="gantt-label-ref">
                          {item.repoFullName}#{item.number}
                        </span>
                      )}
                    </div>
                    <div className="gantt-track" style={{ width: days.length * GANTT_DAY_WIDTH }}>
                      {days.map((day) => (
                        <div
                          key={day}
                          className={`gantt-cell ${dayClass(day, today)}`}
                          style={{ width: GANTT_DAY_WIDTH }}
                          onDragOver={(event) => {
                            if (dragging) event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            dropOnDay(day);
                          }}
                        />
                      ))}
                      <div
                        className={`gantt-bar ${pending ? 'pending' : ''}`}
                        aria-label={`${item.title}, ${bar.start} to ${bar.end}`}
                        aria-busy={pending || undefined}
                        style={{ left: left * GANTT_DAY_WIDTH, width: width * GANTT_DAY_WIDTH - 2 }}
                        onPointerDown={(event) => begin(event, item, 'move')}
                        onDoubleClick={() => {
                          if (kind && item.repoFullName && item.number !== null)
                            onOpen(item.repoFullName, item.number, kind);
                        }}
                      >
                        {source === 'dates' && (
                          <>
                            <span
                              className="gantt-handle start"
                              aria-label={`Change start of ${item.title}`}
                              onPointerDown={(event) => begin(event, item, 'start')}
                            />
                            <span
                              className="gantt-handle end"
                              aria-label={`Change end of ${item.title}`}
                              onPointerDown={(event) => begin(event, item, 'end')}
                            />
                          </>
                        )}
                        <span className="gantt-bar-title">{item.title}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Scheduled rows grouped by the day their bar starts, in date order, with the span their bars cover. */
function groupByStart<T extends { bar: DayBar }>(
  entries: T[]
): Array<{ start: string; rangeStart: string; rangeEnd: string; entries: T[] }> {
  const groups = new Map<string, { start: string; rangeStart: string; rangeEnd: string; entries: T[] }>();
  const ordered = [...entries].sort((a, b) =>
    a.bar.start < b.bar.start ? -1 : a.bar.start > b.bar.start ? 1 : 0
  );
  for (const entry of ordered) {
    const group = groups.get(entry.bar.start);
    if (group) {
      group.entries.push(entry);
      if (entry.bar.end > group.rangeEnd) group.rangeEnd = entry.bar.end;
    } else {
      groups.set(entry.bar.start, {
        start: entry.bar.start,
        rangeStart: entry.bar.start,
        rangeEnd: entry.bar.end,
        entries: [entry]
      });
    }
  }
  return [...groups.values()];
}

/** For example "Nov 19, 2026". */
function dateLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

/** For example "Sat, Nov 14 - Thu, Nov 19". */
function rangeLabel(start: string, end: string): string {
  const short = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    });
  return `${short(start)} - ${short(end)}`;
}

/** Days that fall on a weekend or today get their own shading. */
function dayClass(day: string, today: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const weekend = weekday === 0 || weekday === 6 ? 'weekend' : '';
  return [weekend, day === today ? 'today' : ''].filter(Boolean).join(' ');
}

/** Runs of consecutive days in one month, so the header can label each month once. */
function monthSpans(days: string[]): Array<{ key: string; label: string; start: number; length: number }> {
  const spans: Array<{ key: string; label: string; start: number; length: number }> = [];
  days.forEach((day, index) => {
    const key = day.slice(0, 7);
    const last = spans[spans.length - 1];
    if (last && last.key === key) {
      last.length += 1;
      return;
    }
    const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
    const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    });
    spans.push({ key, label, start: index, length: 1 });
  });
  return spans;
}

/** The writes a drag of some days makes to a dates bar: a move shifts both ends, a resize moves one end. */
function barWrites(bar: DayBar, mode: DragMode, days: number): DateWrite[] {
  if (mode === 'move') return moveWrites(bar, days);
  return resizeWrites(bar, mode, addDays(mode === 'start' ? bar.start : bar.end, days));
}
