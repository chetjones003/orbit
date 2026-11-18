// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarView, type CalendarViewProps } from '../../../src/renderer/src/projects/CalendarView';
import type { ProjectField, ProjectFieldValue, ProjectItem } from '../../../src/shared/projects';

afterEach(cleanup);

const DUE: ProjectField = { id: 'FLD_due', name: 'Due', kind: 'date' };
const TODAY = '2026-11-15';

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

function renderCalendar(overrides: Partial<CalendarViewProps> = {}) {
  const onEdit = vi.fn<CalendarViewProps['onEdit']>(async (target) => target);
  render(
    <CalendarView
      field={DUE}
      scale="month"
      items={[]}
      today={TODAY}
      pendingIds={new Set()}
      onEdit={onEdit}
      onOpen={vi.fn()}
      {...overrides}
    />
  );
  return { onEdit };
}

function day(iso: string): HTMLElement {
  return screen.getByRole('gridcell', { name: iso });
}

function dragChip(chip: HTMLElement) {
  fireEvent.dragStart(chip, { dataTransfer: { setData: () => undefined, getData: () => '' } });
}

function dropOn(target: HTMLElement) {
  fireEvent.dragOver(target);
  fireEvent.drop(target);
}

describe('CalendarView, month', () => {
  it('shows the month and its weeks, with the days either side of the month too', () => {
    renderCalendar();
    expect(screen.getByText('November 2026')).toBeDefined();
    // The first Monday shown is 26 October, before the month starts on Sunday 1 November.
    expect(day('2026-10-26')).toBeDefined();
    expect(day('2026-12-06')).toBeDefined();
  });

  it('places each item on its date', () => {
    renderCalendar({
      items: [item('a', 'Ship it', { FLD_due: date('2026-11-18') })]
    });
    expect(within(day('2026-11-18')).getByText('Ship it')).toBeDefined();
  });

  it('keeps items with no date visible in an Unscheduled list, and leaves them off the grid', () => {
    renderCalendar({
      items: [
        item('a', 'Ship it', { FLD_due: date('2026-11-18') }),
        item('b', 'Plan release'),
        item('c', 'Wrong kind', { FLD_due: { kind: 'text', text: 'soon' } })
      ]
    });
    const unscheduled = screen.getByRole('region', { name: 'Unscheduled' });
    expect(within(unscheduled).getByText('Plan release')).toBeDefined();
    expect(within(unscheduled).getByText('Wrong kind')).toBeDefined();
    expect(within(unscheduled).queryByText('Ship it')).toBeNull();
  });

  it('moves an item to another day when it is dropped there, writing the new date', async () => {
    const { onEdit } = renderCalendar({
      items: [item('a', 'Ship it', { FLD_due: date('2026-11-18') })]
    });
    dragChip(within(day('2026-11-18')).getByText('Ship it'));
    dropOn(day('2026-11-23'));
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]?.[1]).toBe(DUE);
    expect(onEdit.mock.calls[0]?.[2]).toEqual({ kind: 'date', date: '2026-11-23' });
  });

  it('writes nothing when an item is dropped on its own day', () => {
    const { onEdit } = renderCalendar({
      items: [item('a', 'Ship it', { FLD_due: date('2026-11-18') })]
    });
    dragChip(within(day('2026-11-18')).getByText('Ship it'));
    dropOn(day('2026-11-18'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('schedules an unscheduled item when it is dropped on a day', async () => {
    const { onEdit } = renderCalendar({ items: [item('b', 'Plan release')] });
    dragChip(screen.getByText('Plan release'));
    dropOn(day('2026-11-20'));
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]?.[2]).toEqual({ kind: 'date', date: '2026-11-20' });
  });

  it('does not let a pending item be dragged', () => {
    renderCalendar({
      items: [item('a', 'Ship it', { FLD_due: date('2026-11-18') })],
      pendingIds: new Set(['a'])
    });
    expect(
      within(day('2026-11-18')).getByText('Ship it').closest('[draggable]')?.getAttribute('draggable')
    ).toBe('false');
  });

  it('moves between months with the navigation, and back to today', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('December 2026')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('November 2026')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('October 2026')).toBeDefined();
  });
});

describe('CalendarView, week', () => {
  it('shows only the Monday-to-Sunday week that holds today', () => {
    renderCalendar({ scale: 'week' });
    expect(screen.getByText('Nov 9 – 15, 2026')).toBeDefined();
    expect(screen.getAllByRole('gridcell')).toHaveLength(7);
    expect(day('2026-11-09')).toBeDefined();
    expect(day('2026-11-15')).toBeDefined();
  });

  it('moves a week at a time', () => {
    renderCalendar({ scale: 'week' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Nov 16 – 22, 2026')).toBeDefined();
  });
});

describe('CalendarView, without a date field', () => {
  it('asks for a date field instead of showing a calendar', () => {
    renderCalendar({ field: null });
    expect(screen.getByText('Choose a date field to show this calendar.')).toBeDefined();
    expect(screen.queryByRole('gridcell')).toBeNull();
  });
});
