// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GANTT_DAY_WIDTH,
  GanttView,
  type GanttViewProps
} from '../../../src/renderer/src/projects/GanttView';
import type { ProjectField, ProjectFieldValue, ProjectItem } from '../../../src/shared/projects';

afterEach(cleanup);

const START: ProjectField = { id: 'FLD_start', name: 'Start', kind: 'date' };
const DUE: ProjectField = { id: 'FLD_due', name: 'Due', kind: 'date' };
const SPRINT: ProjectField = {
  id: 'FLD_sprint',
  name: 'Sprint',
  kind: 'iteration',
  iterations: [
    { id: 'it_2', title: 'Sprint 2', startDate: '2026-02-01', duration: 14 },
    { id: 'it_3', title: 'Sprint 3', startDate: '2026-02-15', duration: 14 }
  ]
};
const TODAY = '2026-05-10';

function item(id: string, title: string, values: Record<string, ProjectFieldValue> = {}): ProjectItem {
  return {
    id,
    kind: 'issue',
    contentId: `I_${id}`,
    repoFullName: 'orbit-owner/app',
    number: 7,
    title,
    htmlUrl: 'https://github.com/orbit-owner/app/issues/7',
    state: 'open',
    isDraft: false,
    fieldValues: values
  };
}

const date = (value: string): ProjectFieldValue => ({ kind: 'date', date: value });

function renderGantt(overrides: Partial<GanttViewProps> = {}) {
  const onEdit = vi.fn<GanttViewProps['onEdit']>(async (target) => target);
  const props: GanttViewProps = {
    source: 'dates',
    startField: START,
    targetField: DUE,
    iterationField: null,
    items: [],
    today: TODAY,
    pendingIds: new Set(),
    onEdit,
    onOpen: vi.fn(),
    ...overrides
  };
  render(<GanttView {...props} />);
  return { onEdit };
}

/**
 * Drags a bar (or a handle) by a number of days, as a pointer would. jsdom has no PointerEvent, so the
 * events are MouseEvents carrying the same clientX; the pointer type names are what the component listens for.
 */
function dragBy(target: HTMLElement, days: number) {
  const at = (type: string, x: number) => new MouseEvent(type, { clientX: x, bubbles: true });
  const end = 100 + days * GANTT_DAY_WIDTH;
  target.dispatchEvent(at('pointerdown', 100));
  window.dispatchEvent(at('pointermove', end));
  window.dispatchEvent(at('pointerup', end));
}

function dragChip(chip: HTMLElement) {
  fireEvent.dragStart(chip, { dataTransfer: { setData: () => undefined, getData: () => '' } });
}

function dropOn(target: HTMLElement) {
  fireEvent.dragOver(target);
  fireEvent.drop(target);
}

describe('GanttView, from start and target dates', () => {
  it('draws each scheduled item as a bar labelled with its dates', () => {
    renderGantt({
      items: [item('a', 'Write docs', { FLD_start: date('2026-05-04'), FLD_due: date('2026-05-08') })]
    });
    expect(screen.getByLabelText('Write docs, 2026-05-04 to 2026-05-08')).toBeDefined();
  });

  it('keeps unscheduled items visible in their own list', () => {
    renderGantt({
      items: [
        item('a', 'Write docs', { FLD_start: date('2026-05-04'), FLD_due: date('2026-05-08') }),
        item('b', 'Plan release', { FLD_start: date('2026-05-04') })
      ]
    });
    const unscheduled = screen.getByRole('region', { name: 'Unscheduled' });
    expect(within(unscheduled).getByText('Plan release')).toBeDefined();
    expect(within(unscheduled).queryByText('Write docs')).toBeNull();
  });

  it('moves a bar by whole days, writing the end first when moving later', async () => {
    const { onEdit } = renderGantt({
      items: [item('a', 'Write docs', { FLD_start: date('2026-05-04'), FLD_due: date('2026-05-08') })]
    });
    dragBy(screen.getByLabelText('Write docs, 2026-05-04 to 2026-05-08'), 2);
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(2));
    expect(onEdit.mock.calls.map(([, field, value]) => [field.id, value])).toEqual([
      ['FLD_due', { kind: 'date', date: '2026-05-10' }],
      ['FLD_start', { kind: 'date', date: '2026-05-06' }]
    ]);
  });

  it('uses the timeline scroll position when a drag is released, so the bar lands on the day under the pointer', async () => {
    const { onEdit } = renderGantt({
      items: [item('a', 'Write docs', { FLD_start: date('2026-05-04'), FLD_due: date('2026-05-08') })]
    });
    const bar = screen.getByLabelText('Write docs, 2026-05-04 to 2026-05-08');
    const scroller = bar.closest('.gantt-scroll') as HTMLElement;
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, writable: true, configurable: true });
    const at = (type: string, x: number) => new MouseEvent(type, { clientX: x, bubbles: true });
    bar.dispatchEvent(at('pointerdown', 100));
    // The pointer does not move, but the timeline scrolls two days to the right under it.
    (scroller as unknown as { scrollLeft: number }).scrollLeft = 2 * GANTT_DAY_WIDTH;
    window.dispatchEvent(at('pointerup', 100));
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(2));
    expect(onEdit.mock.calls.map(([, field, value]) => [field.id, value])).toEqual([
      ['FLD_due', { kind: 'date', date: '2026-05-10' }],
      ['FLD_start', { kind: 'date', date: '2026-05-06' }]
    ]);
  });

  it('resizes the end handle and writes the target date', async () => {
    const { onEdit } = renderGantt({
      items: [item('a', 'Write docs', { FLD_start: date('2026-05-04'), FLD_due: date('2026-05-08') })]
    });
    dragBy(screen.getByLabelText('Change end of Write docs'), 1);
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]?.[1].id).toBe('FLD_due');
    expect(onEdit.mock.calls[0]?.[2]).toEqual({ kind: 'date', date: '2026-05-09' });
  });

  it('resizes the start handle but never past the end', async () => {
    const { onEdit } = renderGantt({
      items: [item('a', 'Write docs', { FLD_start: date('2026-05-04'), FLD_due: date('2026-05-08') })]
    });
    dragBy(screen.getByLabelText('Change start of Write docs'), 9);
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]?.[1].id).toBe('FLD_start');
    expect(onEdit.mock.calls[0]?.[2]).toEqual({ kind: 'date', date: '2026-05-08' });
  });

  it('writes nothing when a drag ends where it started', () => {
    const { onEdit } = renderGantt({
      items: [item('a', 'Write docs', { FLD_start: date('2026-05-04'), FLD_due: date('2026-05-08') })]
    });
    dragBy(screen.getByLabelText('Write docs, 2026-05-04 to 2026-05-08'), 0);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('schedules an unscheduled item when it is dropped on a day', async () => {
    const { onEdit } = renderGantt({
      items: [item('b', 'Plan release', { FLD_start: date('2026-05-04') })]
    });
    dragChip(screen.getByText('Plan release'));
    // Nothing is scheduled, so the timeline shows today (2026-05-10) three days either side.
    dropOn(screen.getByRole('columnheader', { name: '2026-05-08' }));
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]?.[1].id).toBe('FLD_due');
    expect(onEdit.mock.calls[0]?.[2]).toEqual({ kind: 'date', date: '2026-05-08' });
  });

  it('stops a multi-field change when the first save fails, so the bar is not half written', async () => {
    const onEdit = vi.fn<GanttViewProps['onEdit']>(async () => null);
    renderGantt({
      onEdit,
      items: [item('a', 'Write docs', { FLD_start: date('2026-05-04'), FLD_due: date('2026-05-08') })]
    });
    dragBy(screen.getByLabelText('Write docs, 2026-05-04 to 2026-05-08'), 2);
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

describe('GanttView, from an iteration', () => {
  const sprintItem = (id: string, title: string, iterationId: string) => {
    const it = SPRINT.iterations.find((i) => i.id === iterationId) as (typeof SPRINT.iterations)[number];
    return item(id, title, {
      FLD_sprint: {
        kind: 'iteration',
        iterationId,
        title: it.title,
        startDate: it.startDate,
        duration: it.duration
      }
    });
  };

  it('draws the iteration as the bar, spanning its days', () => {
    renderGantt({
      source: 'iteration',
      startField: null,
      targetField: null,
      iterationField: SPRINT,
      items: [sprintItem('a', 'Write docs', 'it_2')]
    });
    expect(screen.getByLabelText('Write docs, 2026-02-01 to 2026-02-14')).toBeDefined();
  });

  it('moves an item into the iteration its bar lands in when dragged across an iteration boundary', async () => {
    const { onEdit } = renderGantt({
      source: 'iteration',
      startField: null,
      targetField: null,
      iterationField: SPRINT,
      items: [sprintItem('a', 'Write docs', 'it_2')]
    });
    dragBy(screen.getByLabelText('Write docs, 2026-02-01 to 2026-02-14'), 14);
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]?.[1].id).toBe('FLD_sprint');
    expect(onEdit.mock.calls[0]?.[2]).toEqual({ kind: 'iteration', iterationId: 'it_3' });
  });

  it('reaches every iteration in the field, so an item can be dropped in one the bars do not cover', async () => {
    const { onEdit } = renderGantt({
      source: 'iteration',
      startField: null,
      targetField: null,
      iterationField: SPRINT,
      items: [item('b', 'Plan release')]
    });
    dragChip(screen.getByText('Plan release'));
    // Sprint 3 starts 2026-02-15; no bar reaches it, so only the iteration list can bring it on the timeline.
    dropOn(screen.getByRole('columnheader', { name: '2026-02-15' }));
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]?.[2]).toEqual({ kind: 'iteration', iterationId: 'it_3' });
  });

  it('keeps an iteration bar drawn in its iteration while a short drag stays inside it', async () => {
    renderGantt({
      source: 'iteration',
      startField: null,
      targetField: null,
      iterationField: SPRINT,
      items: [sprintItem('a', 'Write docs', 'it_2')]
    });
    const bar = screen.getByLabelText('Write docs, 2026-02-01 to 2026-02-14');
    const at = (type: string, x: number) => new MouseEvent(type, { clientX: x, bubbles: true });
    bar.dispatchEvent(at('pointerdown', 100));
    window.dispatchEvent(at('pointermove', 100 + 3 * GANTT_DAY_WIDTH));
    // A 3-day drag still drops into Sprint 2, so the bar is drawn at Sprint 2's start (3 days after the timeline's first day),
    // not slid three days along.
    await vi.waitFor(() => expect(bar.style.left).toBe(`${3 * GANTT_DAY_WIDTH}px`));
    window.dispatchEvent(at('pointerup', 100 + 3 * GANTT_DAY_WIDTH));
  });

  it('writes nothing when the bar stays in its iteration, and offers no resize handles', () => {
    const { onEdit } = renderGantt({
      source: 'iteration',
      startField: null,
      targetField: null,
      iterationField: SPRINT,
      items: [sprintItem('a', 'Write docs', 'it_2')]
    });
    dragBy(screen.getByLabelText('Write docs, 2026-02-01 to 2026-02-14'), 3);
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Change end of Write docs')).toBeNull();
    expect(screen.queryByLabelText('Change start of Write docs')).toBeNull();
  });

  it('explains a drop on a day no iteration covers, and writes nothing', () => {
    const { onEdit } = renderGantt({
      source: 'iteration',
      startField: null,
      targetField: null,
      iterationField: SPRINT,
      items: [item('b', 'Plan release')]
    });
    dragChip(screen.getByText('Plan release'));
    dropOn(screen.getByRole('columnheader', { name: TODAY }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('inside an iteration');
  });
});
