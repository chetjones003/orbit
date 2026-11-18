import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { Icon } from '../icons';
import type { GanttSource } from '../../../shared/custom-views';
import type { IterationOption, ProjectField, ProjectFieldInput, ProjectItem } from '../../../shared/projects';
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
import { hovercardProps } from '../hovercard/hovercard-model';

/** Width of one day on the timeline at the default (Month) zoom, in pixels. */
export const GANTT_DAY_WIDTH = 28;

/** Width of the item column that stays in view while the timeline scrolls. */
export const GANTT_LABEL_WIDTH = 300;

/** How much time fits on screen: a few weeks with every day named, a month or two, or a quarter. */
export type GanttZoom = 'week' | 'month' | 'quarter';

const ZOOMS: Array<{ id: GanttZoom; label: string; dayWidth: number }> = [
  { id: 'week', label: 'Week', dayWidth: 52 },
  { id: 'month', label: 'Month', dayWidth: GANTT_DAY_WIDTH },
  { id: 'quarter', label: 'Quarter', dayWidth: 11 }
];

/**
 * Whether a title fits inside a bar of this width. A title that would be cut goes beside the bar instead, so every
 * title is read in full. The width per character is a close estimate for the 12px interface font.
 */
function titleFits(title: string, width: number): boolean {
  return width >= title.length * 6.6 + 24;
}

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
 * A timeline of items as bars, one row per item, in start order, with items that have no dates listed under
 * them. Dates-source bars can be moved and resized by pointer or keyboard; iteration-source bars can only be
 * moved between iterations, because GitHub fixes an iteration's length. An item without dates is scheduled by
 * clicking a day in its row or by dragging it onto the timeline.
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
  const [zoom, setZoom] = useState<GanttZoom>('month');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ id: string; day: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [viewport, setViewport] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The day to bring into view after the next render: today on first draw, the centred day after a zoom. */
  const focusRef = useRef<{ day: string; at: number } | null>({ day: today, at: 1 / 3 });
  useEffect(() => () => cleanupRef.current?.(), []);

  const dayWidth = ZOOMS.find((z) => z.id === zoom)?.dayWidth ?? GANTT_DAY_WIDTH;
  const iterations = iterationField?.kind === 'iteration' ? iterationField.iterations : [];
  const datesReady = source === 'dates' && startField !== null && targetField !== null;
  const iterationReady = source === 'iteration' && iterationField?.kind === 'iteration';

  const barOf = (item: ProjectItem): DayBar | null => {
    if (source === 'iteration') return iterationReady ? iterationBar(item, iterationField.id) : null;
    return datesReady ? dateBar(item, startField.id, targetField.id) : null;
  };

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
  // The timeline runs on past the last bar so it always fills the window, however far out it is zoomed.
  const fillDays = Math.ceil(Math.max(0, viewport - GANTT_LABEL_WIDTH) / dayWidth);
  const totalDays = Math.max(daysBetween(range.start, range.end) + 1, fillDays);
  const days = Array.from({ length: totalDays }, (_, i) => addDays(range.start, i));
  const trackWidth = days.length * dayWidth;
  const xOf = (day: string) => daysBetween(range.start, day) * dayWidth;

  // The window's width decides how far the timeline runs.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    const measure = () => setViewport(scroller.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [datesReady, iterationReady]);

  // Brings the wanted day into view once the timeline is drawn at its new size.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const focus = focusRef.current;
    if (!scroller || !focus || viewport === 0) return;
    focusRef.current = null;
    const visible = scroller.clientWidth - GANTT_LABEL_WIDTH;
    scroller.scrollLeft = Math.max(0, xOf(focus.day) - visible * focus.at);
  });

  if (!datesReady && !iterationReady) {
    return (
      <p className="project-note">
        {source === 'iteration'
          ? 'Choose an iteration field to draw this timeline.'
          : 'Choose a start field and a target field to draw this timeline.'}
      </p>
    );
  }

  /** The day in the middle of what is on screen, so a zoom keeps it there. */
  const centreDay = (): string => {
    const scroller = scrollRef.current;
    if (!scroller || scroller.clientWidth === 0) return today;
    const centre = scroller.scrollLeft + (scroller.clientWidth - GANTT_LABEL_WIDTH) / 2;
    return addDays(range.start, Math.floor(centre / dayWidth));
  };

  const changeZoom = (next: GanttZoom) => {
    if (next === zoom) return;
    focusRef.current = { day: centreDay(), at: 1 / 2 };
    setZoom(next);
  };

  const goToToday = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const visible = scroller.clientWidth - GANTT_LABEL_WIDTH;
    scroller.scrollTo({ left: Math.max(0, xOf(today) - visible / 3), behavior: 'smooth' });
  };

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
      Math.round((clientX - origin + (scroller?.scrollLeft ?? 0) - scrollOrigin) / dayWidth);
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

  /** Arrow keys move a focused bar a day at a time (an iteration at a time); with Shift they move its end. */
  const onBarKey = (event: ReactKeyboardEvent, item: ProjectItem, bar: DayBar) => {
    const kind = openableKind(item);
    if (event.key === 'Enter' && kind && item.repoFullName && item.number !== null) {
      event.preventDefault();
      onOpen(item.repoFullName, item.number, kind);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (pendingIds.has(item.id)) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    if (source === 'iteration') {
      void commit(item, 'move', step * (daysBetween(bar.start, bar.end) + 1));
      return;
    }
    void commit(item, event.shiftKey ? 'end' : 'move', step);
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

  /** The day under the pointer in a row's track. */
  const dayAt = (event: ReactMouseEvent | ReactDragEvent): string | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - rect.left) / dayWidth);
    return index >= 0 && index < days.length ? (days[index] ?? null) : null;
  };

  const dropTarget = {
    onDragOver: (event: ReactDragEvent) => {
      if (dragging) event.preventDefault();
    },
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const day = dayAt(event);
      if (day) dropOnDay(day);
      else setDragging(null);
    }
  };

  /** Where a bar is drawn while it is dragged. An iteration bar shows the iteration a drop would land in. */
  const previewFor = (item: ProjectItem): DayBar | null => {
    const bar = barOf(item);
    if (!bar || !preview || preview.id !== item.id) return null;
    if (source === 'iteration') {
      const id = iterationForDay(addDays(bar.start, preview.days), iterations);
      const target = iterations.find((i) => i.id === id);
      return target ? { start: target.startDate, end: addDays(target.startDate, target.duration - 1) } : null;
    }
    const next = barWrites(bar, preview.mode, preview.days);
    return {
      start: next.find((w) => w.role === 'start')?.date ?? bar.start,
      end: next.find((w) => w.role === 'end')?.date ?? bar.end
    };
  };

  /** What clicking a day in an unscheduled row would draw: that day, or the iteration around it. */
  const ghostBar = (day: string): DayBar | null => {
    if (source !== 'iteration') return { start: day, end: day };
    const target = iterations.find((i) => i.id === iterationForDay(day, iterations));
    return target ? { start: target.startDate, end: addDays(target.startDate, target.duration - 1) } : null;
  };

  const ordered = [...scheduled].sort((a, b) =>
    a.bar.start !== b.bar.start ? (a.bar.start < b.bar.start ? -1 : 1) : a.bar.end < b.bar.end ? -1 : 1
  );
  const showRepo = new Set(items.map((i) => i.repoFullName).filter(Boolean)).size > 1;
  const todayIndex = days.indexOf(today);
  const weekStartOffset = days.findIndex((day) => weekday(day) === 1);
  const trackStyle = {
    width: trackWidth,
    '--gantt-day': `${dayWidth}px`,
    '--gantt-week-offset': `${Math.max(0, weekStartOffset) * dayWidth}px`
  } as CSSProperties;

  return (
    <div className={`gantt-view zoom-${zoom}`} aria-label="Gantt">
      <div className="gantt-toolbar">
        <div className="gantt-zoom" role="group" aria-label="Zoom">
          {ZOOMS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={zoom === option.id}
              onClick={() => changeZoom(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="gantt-today-button" onClick={goToToday}>
          <Icon name="calendar" size={13} />
          Today
        </button>
        <span className="gantt-hint">
          {source === 'dates'
            ? 'Drag a bar to move it, drag its edges to change dates, double-click to open.'
            : 'Drag a bar into another iteration to move it, double-click to open.'}
        </span>
      </div>
      {note && (
        <p role="alert" className="cve-note cve-alert">
          {note}
        </p>
      )}

      <div className="gantt-scroll" ref={scrollRef}>
        <div className="gantt-grid" style={{ width: GANTT_LABEL_WIDTH + trackWidth }}>
          {/* Weekend and today shading, drawn once behind every row. */}
          <div
            className="gantt-columns"
            aria-hidden="true"
            style={{ left: GANTT_LABEL_WIDTH, width: trackWidth }}
          >
            {zoom !== 'quarter' &&
              days.map((day, index) =>
                isWeekend(day) ? (
                  <span
                    key={day}
                    className="gantt-weekend"
                    style={{ left: index * dayWidth, width: dayWidth }}
                  />
                ) : null
              )}
            {todayIndex >= 0 && (
              <span className="gantt-today-line" style={{ left: (todayIndex + 0.5) * dayWidth }} />
            )}
          </div>

          <div className="gantt-header">
            <div className="gantt-label gantt-corner">
              <span>Items</span>
              <span className="gantt-count">{items.length}</span>
            </div>
            <div className="gantt-track-head" style={trackStyle}>
              <div className="gantt-months">
                {monthSpans(days).map((span) => (
                  <div
                    key={span.key}
                    className="gantt-month"
                    style={{ left: span.start * dayWidth, width: span.length * dayWidth }}
                  >
                    <span>{zoom === 'quarter' ? span.short : span.label}</span>
                  </div>
                ))}
              </div>
              {source === 'iteration' && (
                <div className="gantt-iterations">
                  {iterations.map((iteration) => (
                    <div
                      key={iteration.id}
                      className={`gantt-iteration ${isCurrent(iteration, today) ? 'current' : ''}`}
                      style={{ left: xOf(iteration.startDate), width: iteration.duration * dayWidth }}
                      title={`${iteration.title}: ${rangeLabel(iteration.startDate, addDays(iteration.startDate, iteration.duration - 1))}`}
                    >
                      <span>{iteration.title}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="gantt-days">
                {days.map((day) => (
                  <div
                    key={day}
                    role="columnheader"
                    aria-label={day}
                    className={`gantt-day ${dayClass(day, today)}`}
                    style={{ width: dayWidth }}
                    onDragOver={(event) => {
                      if (dragging) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropOnDay(day);
                    }}
                  >
                    <DayHeading day={day} zoom={zoom} />
                  </div>
                ))}
              </div>
              {todayIndex >= 0 && (
                <span className="gantt-today-flag" style={{ left: (todayIndex + 0.5) * dayWidth }}>
                  Today
                </span>
              )}
            </div>
          </div>

          {ordered.length === 0 && (
            <div className="gantt-row gantt-empty-row">
              <div className="gantt-label">
                <span className="gantt-empty">Nothing is on the timeline yet.</span>
              </div>
              <div className="gantt-track" style={trackStyle} {...dropTarget} />
            </div>
          )}

          {ordered.map(({ item, bar }) => {
            const pending = pendingIds.has(item.id);
            const moved = preview?.id === item.id ? previewFor(item) : null;
            const shown = moved ?? bar;
            const left = xOf(shown.start);
            const width = (daysBetween(shown.start, shown.end) + 1) * dayWidth;
            const inside = titleFits(item.title, width);
            const kind = openableKind(item);
            const open = () => {
              if (kind && item.repoFullName && item.number !== null)
                onOpen(item.repoFullName, item.number, kind);
            };
            return (
              <div key={item.id} className={`gantt-row ${preview?.id === item.id ? 'dragging' : ''}`}>
                <ItemLabel item={item} showRepo={showRepo} onOpen={kind ? open : undefined} />
                <div className="gantt-track" style={trackStyle} {...dropTarget}>
                  <div
                    className={`gantt-bar ${barTone(item)} ${pending ? 'pending' : ''} ${inside ? '' : 'narrow'}`}
                    aria-label={`${item.title}, ${bar.start} to ${bar.end}`}
                    aria-busy={pending || undefined}
                    tabIndex={0}
                    title={`${item.title}\n${rangeLabel(bar.start, bar.end)} · ${dayCount(bar)}`}
                    style={{ left, width: width - 3 }}
                    onPointerDown={(event) => begin(event, item, 'move')}
                    onKeyDown={(event) => onBarKey(event, item, bar)}
                    onDoubleClick={open}
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
                    {moved && (
                      <span className="gantt-drag-dates" aria-live="polite">
                        {rangeLabel(moved.start, moved.end)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {unscheduled.length > 0 && (
            <section role="region" aria-label="Unscheduled" className="gantt-unscheduled">
              <div className="gantt-row gantt-section-row">
                <div className="gantt-label gantt-section-label">
                  <span>No dates</span>
                  <span className="gantt-count">{unscheduled.length}</span>
                </div>
                <div className="gantt-section-hint" style={{ width: trackWidth }}>
                  <span>Click a day in a row, or drag the item onto the timeline, to schedule it.</span>
                </div>
              </div>
              {unscheduled.map((item) => {
                const pending = pendingIds.has(item.id);
                const kind = openableKind(item);
                const hovered = ghost?.id === item.id ? ghostBar(ghost.day) : null;
                return (
                  <div key={item.id} className="gantt-row unscheduled">
                    <ItemLabel
                      item={item}
                      showRepo={showRepo}
                      draggable={!pending}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', item.id);
                        setDragging(item.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onOpen={
                        kind && item.repoFullName && item.number !== null
                          ? () => onOpen(item.repoFullName as string, item.number as number, kind)
                          : undefined
                      }
                    />
                    <div
                      className={`gantt-track gantt-place ${pending ? 'pending' : ''}`}
                      style={trackStyle}
                      aria-hidden="true"
                      {...dropTarget}
                      onMouseMove={(event) => {
                        const day = dayAt(event);
                        if (day && (ghost?.id !== item.id || ghost.day !== day))
                          setGhost({ id: item.id, day });
                      }}
                      onMouseLeave={() => setGhost(null)}
                      onClick={(event) => {
                        const day = dayAt(event);
                        setGhost(null);
                        if (day) void scheduleOn(item, day);
                      }}
                    >
                      {hovered && !pending && (
                        <span
                          className="gantt-ghost"
                          style={{
                            left: xOf(hovered.start),
                            width: (daysBetween(hovered.start, hovered.end) + 1) * dayWidth - 3
                          }}
                        >
                          <span className="gantt-drag-dates">
                            {hovered.start === hovered.end
                              ? shortDate(hovered.start)
                              : rangeLabel(hovered.start, hovered.end)}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

interface ItemLabelProps {
  item: ProjectItem;
  /** Name the repository beside the number, for a project that spans more than one. */
  showRepo: boolean;
  onOpen?: () => void;
  draggable?: boolean;
  onDragStart?: (event: ReactDragEvent) => void;
  onDragEnd?: () => void;
}

/** The pinned item cell: state icon, title (a link to the item when it has one) and its number. */
function ItemLabel({ item, showRepo, onOpen, draggable, onDragStart, onDragEnd }: ItemLabelProps) {
  const repo = item.repoFullName ? (item.repoFullName.split('/')[1] ?? item.repoFullName) : null;
  const ref = repo && item.number !== null ? `${showRepo ? `${repo} ` : ''}#${item.number}` : 'Draft';
  const where = item.repoFullName && item.number !== null ? `\n${item.repoFullName}#${item.number}` : '';
  return (
    <div
      className={`gantt-label gantt-item-label ${draggable !== undefined ? 'draggable' : ''}`}
      title={`${item.title}${where}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span className={`gantt-state ${item.kind} ${item.state}`} aria-hidden="true">
        <Icon
          name={item.kind === 'pull' ? (item.state === 'merged' ? 'merge' : 'pull') : 'issue'}
          size={14}
        />
      </span>
      {onOpen ? (
        <button
          type="button"
          className="gantt-label-title"
          {...hovercardProps(item.repoFullName, item.number, item.kind)}
          onClick={onOpen}
        >
          {item.title}
        </button>
      ) : (
        <span className="gantt-label-title">{item.title}</span>
      )}
      <span className="gantt-label-ref">{ref}</span>
    </div>
  );
}

/** A day's column heading: the weekday and date when there is room, only Mondays at a quarter's zoom. */
function DayHeading({ day, zoom }: { day: string; zoom: GanttZoom }) {
  const date = Number(day.slice(8));
  if (zoom === 'quarter') return weekday(day) === 1 ? <span className="gantt-day-num">{date}</span> : null;
  const name = WEEKDAYS[weekday(day)] ?? '';
  return (
    <>
      <span className="gantt-day-name">{zoom === 'week' ? name : name.slice(0, 1)}</span>
      <span className="gantt-day-num">{date}</span>
    </>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Bars are coloured by where the item stands: open work in the theme's action colour, finished work quiet. */
function barTone(item: ProjectItem): string {
  if (item.kind === 'draft') return 'tone-draft';
  return item.state === 'open' ? 'tone-open' : 'tone-done';
}

function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

function isWeekend(day: string): boolean {
  const value = weekday(day);
  return value === 0 || value === 6;
}

function isCurrent(iteration: IterationOption, today: string): boolean {
  return today >= iteration.startDate && today < addDays(iteration.startDate, iteration.duration);
}

/** For example "Nov 19". */
function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

/** For example "Nov 14 – Nov 19". */
function rangeLabel(start: string, end: string): string {
  return start === end ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`;
}

function dayCount(bar: DayBar): string {
  const count = daysBetween(bar.start, bar.end) + 1;
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

/** Weekend days and today get their own heading style. */
function dayClass(day: string, today: string): string {
  return [isWeekend(day) ? 'weekend' : '', weekday(day) === 1 ? 'monday' : '', day === today ? 'today' : '']
    .filter(Boolean)
    .join(' ');
}

/** Runs of consecutive days in one month, so the header can label each month once. */
function monthSpans(
  days: string[]
): Array<{ key: string; label: string; short: string; start: number; length: number }> {
  const spans: Array<{ key: string; label: string; short: string; start: number; length: number }> = [];
  days.forEach((day, index) => {
    const key = day.slice(0, 7);
    const last = spans[spans.length - 1];
    if (last && last.key === key) {
      last.length += 1;
      return;
    }
    const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
    const first = new Date(Date.UTC(year, month - 1, 1));
    const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const short = first.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    spans.push({ key, label, short, start: index, length: 1 });
  });
  return spans;
}

/** The writes a drag of some days makes to a dates bar: a move shifts both ends, a resize moves one end. */
function barWrites(bar: DayBar, mode: DragMode, days: number): DateWrite[] {
  if (mode === 'move') return moveWrites(bar, days);
  return resizeWrites(bar, mode, addDays(mode === 'start' ? bar.start : bar.end, days));
}
