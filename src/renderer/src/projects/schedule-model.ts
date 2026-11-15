import type { CalendarScale } from '../../../shared/custom-views';
import type { IterationOption, ProjectItem } from '../../../shared/projects';

/**
 * Date math for the Gantt and Calendar custom views. Days are `YYYY-MM-DD` strings and every calculation
 * runs in UTC, so a time zone never moves an item to a different day.
 */

/** An inclusive span of days. */
export interface DayBar {
  start: string;
  end: string;
}

/** One date to write back: the start or the end of a bar. */
export interface DateWrite {
  role: 'start' | 'end';
  date: string;
}

export interface PartitionedItems<T> {
  scheduled: Array<{ item: ProjectItem; bar: T }>;
  unscheduled: ProjectItem[];
}

const DAY_MS = 86_400_000;
const PAD_DAYS = 3;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export function addDays(day: string, days: number): string {
  return isoOf(utcOf(day) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / DAY_MS);
}

/** Today's date from the local calendar, so a late evening in one zone is not tomorrow in UTC. */
export function todayIso(now: Date = new Date()): string {
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return isoOf(local);
}

/** The span of a start and target date pair. Null when either date is missing or the target is before the start. */
export function dateBar(item: ProjectItem, startFieldId: string, targetFieldId: string): DayBar | null {
  const start = dateValue(item, startFieldId);
  const end = dateValue(item, targetFieldId);
  if (start === null || end === null || end < start) return null;
  return { start, end };
}

/** An item's iteration, as the days it runs: its start date through its last day. */
export function iterationBar(item: ProjectItem, iterationFieldId: string): DayBar | null {
  const value = item.fieldValues[iterationFieldId];
  if (value?.kind !== 'iteration') return null;
  return { start: value.startDate, end: addDays(value.startDate, value.duration - 1) };
}

/** A single-date field as a one-day span, for the Calendar. */
export function dayBar(item: ProjectItem, dateFieldId: string): DayBar | null {
  const day = dateValue(item, dateFieldId);
  return day === null ? null : { start: day, end: day };
}

/** Splits items into those with a bar, in their order, and those without one. */
export function partitionBars<T>(
  items: ProjectItem[],
  barOf: (item: ProjectItem) => T | null
): PartitionedItems<T> {
  const scheduled: Array<{ item: ProjectItem; bar: T }> = [];
  const unscheduled: ProjectItem[] = [];
  for (const item of items) {
    const bar = barOf(item);
    if (bar === null) unscheduled.push(item);
    else scheduled.push({ item, bar });
  }
  return { scheduled, unscheduled };
}

/** The days a Gantt shows: every bar and today, with a few days of padding on each side. */
export function ganttRange(bars: DayBar[], today: string): DayBar {
  let start = today;
  let end = today;
  for (const bar of bars) {
    if (bar.start < start) start = bar.start;
    if (bar.end > end) end = bar.end;
  }
  return { start: addDays(start, -PAD_DAYS), end: addDays(end, PAD_DAYS) };
}

/** Writes that move a whole bar by some days. Both ends move, so both are written; the order keeps the bar valid while it is saved. */
export function moveWrites(bar: DayBar, days: number): DateWrite[] {
  if (days === 0) return [];
  const start = { role: 'start' as const, date: addDays(bar.start, days) };
  const end = { role: 'end' as const, date: addDays(bar.end, days) };
  return days > 0 ? [end, start] : [start, end];
}

/** Writes that move one edge of a bar. The edge is clamped so the bar never turns inside out. */
export function resizeWrites(bar: DayBar, edge: 'start' | 'end', day: string): DateWrite[] {
  if (edge === 'start') {
    const date = day > bar.end ? bar.end : day;
    return date === bar.start ? [] : [{ role: 'start', date }];
  }
  const date = day < bar.start ? bar.start : day;
  return date === bar.end ? [] : [{ role: 'end', date }];
}

/**
 * Writes that schedule an unscheduled item on a dropped day. An existing date is kept; a missing one is filled
 * so the bar is valid. An item whose target is before its start becomes a one-day bar at its start.
 */
export function scheduleWrites(
  item: ProjectItem,
  day: string,
  startFieldId: string,
  targetFieldId: string
): DateWrite[] {
  const start = dateValue(item, startFieldId);
  const end = dateValue(item, targetFieldId);
  let newStart: string;
  let newEnd: string;
  if (start !== null && end !== null) {
    // Both dates but out of order: the item is unscheduled, so the drop makes it a one-day bar on the dropped day.
    newStart = day;
    newEnd = day;
  } else if (start !== null) {
    // A day before the start cannot end the bar, so the bar becomes one day, on the dropped day.
    newStart = day < start ? day : start;
    newEnd = day;
  } else if (end !== null) {
    // A day after the target cannot start the bar, so the bar becomes one day, on the dropped day.
    newStart = day;
    newEnd = day > end ? day : end;
  } else {
    newStart = day;
    newEnd = day;
  }
  const writes: DateWrite[] = [];
  if (newStart !== start) writes.push({ role: 'start', date: newStart });
  if (newEnd !== end) writes.push({ role: 'end', date: newEnd });
  return writes;
}

/** The iteration an item holds in an iteration field, or null. */
export function iterationIdOf(item: ProjectItem, fieldId: string): string | null {
  const value = item.fieldValues[fieldId];
  return value?.kind === 'iteration' ? value.iterationId : null;
}

/** The iteration a day falls in, or null when no iteration covers it. */
export function iterationForDay(day: string, iterations: IterationOption[]): string | null {
  const found = iterations.find((i) => day >= i.startDate && day < addDays(i.startDate, i.duration));
  return found?.id ?? null;
}

/** The rows of a Calendar: Monday-to-Sunday weeks covering the anchor's month, or the anchor's one week. */
export function calendarWeeks(anchor: string, scale: CalendarScale): string[][] {
  const { year, month } = partsOf(anchor);
  const first = scale === 'month' ? Date.UTC(year, month, 1) : utcOf(anchor);
  const last = scale === 'month' ? Date.UTC(year, month + 1, 0) : utcOf(anchor);
  const start = first - mondayOffset(first) * DAY_MS;
  const end = last + (6 - mondayOffset(last)) * DAY_MS;
  const weeks: string[][] = [];
  for (let weekStart = start; weekStart <= end; weekStart += 7 * DAY_MS) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) week.push(isoOf(weekStart + i * DAY_MS));
    weeks.push(week);
  }
  return weeks;
}

/** Moves a calendar by one month or one week, from the anchor day. A month keeps the day, or the month's last day. */
export function shiftAnchor(anchor: string, scale: CalendarScale, direction: 1 | -1): string {
  if (scale === 'week') return addDays(anchor, 7 * direction);
  const { year, month, day } = partsOf(anchor);
  const firstOfTarget = Date.UTC(year, month + direction, 1);
  const shiftedDay = Math.min(day, daysInMonth(firstOfTarget));
  return isoOf(firstOfTarget + (shiftedDay - 1) * DAY_MS);
}

export function monthLabel(anchor: string): string {
  const { year, month } = partsOf(anchor);
  return `${MONTH_NAMES[month] ?? ''} ${year}`;
}

function dateValue(item: ProjectItem, fieldId: string): string | null {
  const value = item.fieldValues[fieldId];
  return value?.kind === 'date' ? value.date : null;
}

/** Days from Monday to the given day: 0 for Monday, 6 for Sunday. */
function mondayOffset(time: number): number {
  return (new Date(time).getUTCDay() + 6) % 7;
}

function daysInMonth(time: number): number {
  const date = new Date(time);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function partsOf(day: string): { year: number; month: number; day: number } {
  const date = new Date(utcOf(day));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
}

function utcOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, date);
}

function isoOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}
