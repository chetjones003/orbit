import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
  moveWrites,
  partitionBars,
  resizeWrites,
  scheduleWrites
} from './schedule-model';

/** Width of one day on the timeline, in pixels. */
export const GANTT_DAY_WIDTH = 28;

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
  const range = ganttRange(
    scheduled.map((entry) => entry.bar),
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
      // A failed save stops the rest, so the bar is never half written.
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
      if (id === itemIterationId(item, iterationField.id)) return;
      setNote(null);
      await onEdit(item, iterationField, { kind: 'iteration', iterationId: id });
      return;
    }
    setNote(null);
    const writes =
      mode === 'move'
        ? moveWrites(bar, days)
        : resizeWrites(bar, mode, addDays(mode === 'start' ? bar.start : bar.end, days));
    await saveWrites(item, writes);
  };

  /** Follows the pointer until it is released, then saves the move or resize as whole days. */
  const begin = (event: ReactPointerEvent, item: ProjectItem, mode: DragMode) => {
    if (pendingIds.has(item.id) || !barOf(item)) return;
    if (mode !== 'move' && source === 'iteration') return;
    event.stopPropagation();
    event.preventDefault();
    cleanupRef.current?.();
    const origin = event.clientX;
    const dayOf = (clientX: number) => Math.round((clientX - origin) / GANTT_DAY_WIDTH);
    const onMove = (moved: PointerEvent) => setPreview({ id: item.id, mode, days: dayOf(moved.clientX) });
    const onUp = (released: PointerEvent) => {
      cleanup();
      setPreview(null);
      void commit(item, mode, dayOf(released.clientX));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cleanupRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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

  const previewFor = (item: ProjectItem): { left: number; width: number } | null => {
    const bar = barOf(item);
    if (!bar || !preview || preview.id !== item.id) return null;
    const next =
      preview.mode === 'move'
        ? moveWrites(bar, preview.days)
        : resizeWrites(
            bar,
            preview.mode,
            addDays(preview.mode === 'start' ? bar.start : bar.end, preview.days)
          );
    const start = next.find((w) => w.role === 'start')?.date ?? bar.start;
    const end = next.find((w) => w.role === 'end')?.date ?? bar.end;
    return { left: daysBetween(range.start, start), width: daysBetween(start, end) + 1 };
  };

  return (
    <div className="gantt-view" aria-label="Timeline">
      {note && (
        <p role="alert" className="project-message">
          {note}
        </p>
      )}
      <section role="region" aria-label="Unscheduled" className="gantt-unscheduled">
        <h4>
          Unscheduled <span className="project-column-count">{unscheduled.length}</span>
        </h4>
        {unscheduled.length === 0 && <p className="project-note">Every item is scheduled.</p>}
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
      </section>

      <div className="gantt-scroll">
        <div className="gantt-grid" style={{ width: days.length * GANTT_DAY_WIDTH }}>
          <div className="gantt-header">
            {days.map((day) => (
              <div
                key={day}
                role="columnheader"
                aria-label={day}
                className="gantt-day"
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
          {scheduled.map(({ item, bar }) => {
            const pending = pendingIds.has(item.id);
            const moved = preview?.id === item.id ? previewFor(item) : null;
            const left = moved?.left ?? daysBetween(range.start, bar.start);
            const width = moved?.width ?? daysBetween(bar.start, bar.end) + 1;
            const kind = openableKind(item);
            return (
              <div key={item.id} className="gantt-row">
                {days.map((day) => (
                  <div
                    key={day}
                    className="gantt-cell"
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
            );
          })}
        </div>
      </div>
    </div>
  );
}

function itemIterationId(item: ProjectItem, fieldId: string): string | null {
  const value = item.fieldValues[fieldId];
  return value?.kind === 'iteration' ? value.iterationId : null;
}
