import { describe, expect, it } from 'vitest';
import {
  addDays,
  calendarWeeks,
  dateBar,
  daysBetween,
  dayBar,
  ganttRange,
  iterationBar,
  iterationForDay,
  monthLabel,
  moveWrites,
  partitionBars,
  resizeWrites,
  scheduleWrites,
  shiftAnchor,
  todayIso
} from '../../../src/renderer/src/projects/schedule-model';
import type { ProjectItem, ProjectFieldValue } from '../../../src/shared/projects';

function item(id: string, values: Record<string, ProjectFieldValue> = {}): ProjectItem {
  return {
    id,
    kind: 'issue',
    contentId: `I_${id}`,
    repoFullName: 'orbit-owner/app',
    number: 7,
    title: id,
    htmlUrl: null,
    state: 'open',
    isDraft: false,
    fieldValues: values
  };
}

const date = (value: string): ProjectFieldValue => ({ kind: 'date', date: value });
const bar = (start: string, end: string) => ({ start, end });

describe('day arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('counts whole days from one date to another', () => {
    expect(daysBetween('2026-03-01', '2026-03-04')).toBe(3);
    expect(daysBetween('2026-03-04', '2026-03-01')).toBe(-3);
  });

  it('reads today from local calendar parts, not UTC', () => {
    expect(todayIso(new Date(2026, 10, 15, 23, 30))).toBe('2026-11-15');
  });
});

describe('date-pair bars', () => {
  it('spans from the start date to the target date, both included', () => {
    expect(dateBar(item('a', { s: date('2026-05-04'), t: date('2026-05-08') }), 's', 't')).toEqual(
      bar('2026-05-04', '2026-05-08')
    );
  });

  it('is not scheduled when a date is missing or the target is before the start', () => {
    expect(dateBar(item('a', { s: date('2026-05-04') }), 's', 't')).toBeNull();
    expect(dateBar(item('a', { t: date('2026-05-08') }), 's', 't')).toBeNull();
    expect(dateBar(item('a', { s: date('2026-05-09'), t: date('2026-05-08') }), 's', 't')).toBeNull();
  });

  it('ignores a value of the wrong kind in the start or target field', () => {
    expect(
      dateBar(item('a', { s: { kind: 'text', text: 'soon' }, t: date('2026-05-08') }), 's', 't')
    ).toBeNull();
  });
});

describe('iteration bars', () => {
  it('spans the iteration: its start date for its duration in days', () => {
    const value: ProjectFieldValue = {
      kind: 'iteration',
      iterationId: 'i1',
      title: 'Sprint 1',
      startDate: '2026-05-04',
      duration: 14
    };
    expect(iterationBar(item('a', { f: value }), 'f')).toEqual(bar('2026-05-04', '2026-05-17'));
  });

  it('is not scheduled without an iteration value', () => {
    expect(iterationBar(item('a'), 'f')).toBeNull();
  });
});

describe('day bars', () => {
  it('places an item with a date on that single day', () => {
    expect(dayBar(item('a', { c: date('2026-05-04') }), 'c')).toEqual(bar('2026-05-04', '2026-05-04'));
    expect(dayBar(item('a'), 'c')).toBeNull();
  });
});

describe('partitionBars', () => {
  it('keeps scheduled items with their bars and lists the rest as unscheduled, both in order', () => {
    const a = item('a', { s: date('2026-05-04'), t: date('2026-05-08') });
    const b = item('b', { s: date('2026-05-04') });
    const c = item('c', { s: date('2026-06-01'), t: date('2026-06-02') });
    const result = partitionBars([a, b, c], (i) => dateBar(i, 's', 't'));
    expect(result.scheduled.map((entry) => entry.item.id)).toEqual(['a', 'c']);
    expect(result.scheduled[0]?.bar).toEqual(bar('2026-05-04', '2026-05-08'));
    expect(result.unscheduled.map((i) => i.id)).toEqual(['b']);
  });
});

describe('ganttRange', () => {
  it('covers every bar and today, padded by three days on each side', () => {
    expect(ganttRange([bar('2026-05-04', '2026-05-08')], '2026-05-20')).toEqual(
      bar('2026-05-01', '2026-05-23')
    );
  });

  it('still shows today when nothing is scheduled', () => {
    expect(ganttRange([], '2026-05-20')).toEqual(bar('2026-05-17', '2026-05-23'));
  });
});

describe('moveWrites', () => {
  it('shifts both ends by the same days, writing the end first when moving later', () => {
    expect(moveWrites(bar('2026-05-04', '2026-05-08'), 2)).toEqual([
      { role: 'end', date: '2026-05-10' },
      { role: 'start', date: '2026-05-06' }
    ]);
  });

  it('writes the start first when moving earlier', () => {
    expect(moveWrites(bar('2026-05-04', '2026-05-08'), -1)).toEqual([
      { role: 'start', date: '2026-05-03' },
      { role: 'end', date: '2026-05-07' }
    ]);
  });

  it('writes nothing for a move of zero days', () => {
    expect(moveWrites(bar('2026-05-04', '2026-05-08'), 0)).toEqual([]);
  });
});

describe('resizeWrites', () => {
  it('moves only the start, clamped so it never passes the end', () => {
    expect(resizeWrites(bar('2026-05-04', '2026-05-08'), 'start', '2026-05-02')).toEqual([
      { role: 'start', date: '2026-05-02' }
    ]);
    expect(resizeWrites(bar('2026-05-04', '2026-05-08'), 'start', '2026-05-10')).toEqual([
      { role: 'start', date: '2026-05-08' }
    ]);
  });

  it('moves only the end, clamped so it never falls before the start', () => {
    expect(resizeWrites(bar('2026-05-04', '2026-05-08'), 'end', '2026-05-12')).toEqual([
      { role: 'end', date: '2026-05-12' }
    ]);
    expect(resizeWrites(bar('2026-05-04', '2026-05-08'), 'end', '2026-05-01')).toEqual([
      { role: 'end', date: '2026-05-04' }
    ]);
  });

  it('writes nothing when the edge stays where it is', () => {
    expect(resizeWrites(bar('2026-05-04', '2026-05-08'), 'start', '2026-05-04')).toEqual([]);
    expect(resizeWrites(bar('2026-05-04', '2026-05-08'), 'end', '2026-05-08')).toEqual([]);
  });
});

describe('scheduleWrites', () => {
  it('sets a one-day bar when neither date exists', () => {
    expect(scheduleWrites(item('a'), '2026-05-04', 's', 't')).toEqual([
      { role: 'start', date: '2026-05-04' },
      { role: 'end', date: '2026-05-04' }
    ]);
  });

  it('keeps an existing start and ends the bar on the dropped day, never before the start', () => {
    const a = item('a', { s: date('2026-05-04') });
    expect(scheduleWrites(a, '2026-05-07', 's', 't')).toEqual([{ role: 'end', date: '2026-05-07' }]);
    expect(scheduleWrites(a, '2026-05-01', 's', 't')).toEqual([{ role: 'end', date: '2026-05-04' }]);
  });

  it('keeps an existing target and starts the bar on the dropped day, never after the target', () => {
    const a = item('a', { t: date('2026-05-08') });
    expect(scheduleWrites(a, '2026-05-06', 's', 't')).toEqual([{ role: 'start', date: '2026-05-06' }]);
    expect(scheduleWrites(a, '2026-05-10', 's', 't')).toEqual([{ role: 'start', date: '2026-05-08' }]);
  });

  it('fixes an item whose target is before its start by making it a one-day bar at the start', () => {
    const a = item('a', { s: date('2026-05-09'), t: date('2026-05-08') });
    expect(scheduleWrites(a, '2026-05-20', 's', 't')).toEqual([{ role: 'end', date: '2026-05-09' }]);
  });
});

describe('iterationForDay', () => {
  const iterations = [
    { id: 'i1', title: 'Sprint 1', startDate: '2026-05-04', duration: 14 },
    { id: 'i2', title: 'Sprint 2', startDate: '2026-05-18', duration: 14 }
  ];

  it('finds the iteration that contains the day, with its last day included', () => {
    expect(iterationForDay('2026-05-04', iterations)).toBe('i1');
    expect(iterationForDay('2026-05-17', iterations)).toBe('i1');
    expect(iterationForDay('2026-05-18', iterations)).toBe('i2');
  });

  it('returns null for a day outside every iteration', () => {
    expect(iterationForDay('2026-06-01', iterations)).toBeNull();
    expect(iterationForDay('2026-05-03', iterations)).toBeNull();
  });
});

describe('calendar grid', () => {
  it('covers the month in whole Monday-to-Sunday weeks', () => {
    // November 2026 starts on a Sunday, so its first week begins on Monday 26 October.
    const weeks = calendarWeeks('2026-11-15', 'month');
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.[0]).toBe('2026-10-26');
    expect(weeks[5]?.[6]).toBe('2026-12-06');
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it('shows only the Monday-to-Sunday week that holds the anchor day', () => {
    expect(calendarWeeks('2026-11-15', 'week')).toEqual([
      ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']
    ]);
  });

  it('moves the anchor by a month, keeping the day but not past the month end', () => {
    expect(shiftAnchor('2026-11-15', 'month', 1)).toBe('2026-12-15');
    expect(shiftAnchor('2026-01-31', 'month', 1)).toBe('2026-02-28');
  });

  it('moves the anchor by a week', () => {
    expect(shiftAnchor('2026-11-15', 'week', -1)).toBe('2026-11-08');
  });

  it('names the month the anchor is in', () => {
    expect(monthLabel('2026-11-15')).toBe('November 2026');
  });
});
