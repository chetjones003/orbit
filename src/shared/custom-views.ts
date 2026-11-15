import { isProjectNodeId } from './projects';

/**
 * Orbit's own custom views of one Project. Only the definition is stored locally (in settings), never the
 * items or their values. Shared by main, which stores it, and the renderer, which edits it. No Node or DOM APIs.
 */

export type CustomViewLayout = 'kanban' | 'table' | 'gantt' | 'calendar';

/** Gantt bars come from a start and target date pair, or from an iteration field. */
export type GanttSource = 'dates' | 'iteration';

/** The span a calendar shows: one month of weeks, or one week. */
export type CalendarScale = 'month' | 'week';

/** Visual filter conditions. They run on the items GitHub returns, after the advanced filter. */
export type CustomViewCondition =
  | { kind: 'one-of'; fieldId: string; valueIds: string[] }
  | { kind: 'no-value'; fieldId: string }
  | { kind: 'contains'; fieldId: string; text: string };

export interface CustomViewSort {
  fieldId: string;
  direction: 'asc' | 'desc';
}

export interface CustomViewDefinition {
  id: string;
  name: string;
  /** The Project the view shows. */
  projectId: string;
  layout: CustomViewLayout;
  /** GitHub's project filter syntax, sent to GitHub as-is. Empty when unset. */
  advancedFilter: string;
  conditions: CustomViewCondition[];
  /** Null keeps GitHub's manual order. */
  sort: CustomViewSort | null;
  /** Table only: the field rows are grouped by. */
  groupFieldId: string | null;
  /** Kanban only: the field whose values are the columns. */
  columnFieldId: string | null;
  /** Kanban only: the field whose values are the swimlanes. Null for no swimlanes. */
  swimlaneFieldId: string | null;
  /** Gantt only: `dates` reads the start and target fields, `iteration` reads the iteration field. */
  ganttSource: GanttSource;
  /** Gantt, dates source: the date field where a bar starts. */
  startFieldId: string | null;
  /** Gantt, dates source: the date field where a bar ends. */
  targetFieldId: string | null;
  /** Gantt, iteration source: the iteration field a bar spans. */
  iterationFieldId: string | null;
  /** Calendar only: the date field an item is placed by. */
  calendarFieldId: string | null;
  /** Calendar only: whether it shows a month or a single week. */
  calendarScale: CalendarScale;
}

export const CUSTOM_VIEWS_MAX = 100;
export const CUSTOM_VIEW_NAME_MAX = 80;
export const CUSTOM_VIEW_FILTER_MAX = 1000;
export const CUSTOM_VIEW_CONDITIONS_MAX = 20;
const CUSTOM_VIEW_TEXT_MAX = 200;
const CUSTOM_VIEW_LAYOUTS: readonly string[] = ['kanban', 'table', 'gantt', 'calendar'];

function isLayout(value: unknown): value is CustomViewLayout {
  return typeof value === 'string' && CUSTOM_VIEW_LAYOUTS.includes(value);
}
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Reads one definition from untrusted input. Returns null when the required parts are not valid. */
export function parseCustomView(value: unknown): CustomViewDefinition | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const name = typeof value['name'] === 'string' ? value['name'].trim() : '';
  const projectId = value['projectId'];
  const layout = value['layout'];
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  if (name === '' || name.length > CUSTOM_VIEW_NAME_MAX) return null;
  if (!isProjectNodeId(projectId)) return null;
  if (!isLayout(layout)) return null;
  const advancedFilter =
    typeof value['advancedFilter'] === 'string' && value['advancedFilter'].length <= CUSTOM_VIEW_FILTER_MAX
      ? value['advancedFilter']
      : '';
  const conditions = Array.isArray(value['conditions'])
    ? value['conditions']
        .map(parseCondition)
        .filter((c): c is CustomViewCondition => c !== null)
        .slice(0, CUSTOM_VIEW_CONDITIONS_MAX)
    : [];
  return {
    id,
    name,
    projectId,
    layout,
    advancedFilter,
    conditions,
    sort: parseSort(value['sort']),
    groupFieldId: optionalNodeId(value['groupFieldId']),
    columnFieldId: optionalNodeId(value['columnFieldId']),
    swimlaneFieldId: optionalNodeId(value['swimlaneFieldId']),
    ganttSource: value['ganttSource'] === 'iteration' ? 'iteration' : 'dates',
    startFieldId: optionalNodeId(value['startFieldId']),
    targetFieldId: optionalNodeId(value['targetFieldId']),
    iterationFieldId: optionalNodeId(value['iterationFieldId']),
    calendarFieldId: optionalNodeId(value['calendarFieldId']),
    calendarScale: value['calendarScale'] === 'week' ? 'week' : 'month'
  };
}

/** Reads a stored list. Invalid entries and duplicate ids are dropped, and the list is capped. */
export function normalizeCustomViews(value: unknown): CustomViewDefinition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const views: CustomViewDefinition[] = [];
  for (const entry of value) {
    const view = parseCustomView(entry);
    if (!view || seen.has(view.id)) continue;
    seen.add(view.id);
    views.push(view);
    if (views.length === CUSTOM_VIEWS_MAX) break;
  }
  return views;
}

function parseCondition(value: unknown): CustomViewCondition | null {
  if (!isRecord(value) || !isProjectNodeId(value['fieldId'])) return null;
  const fieldId = value['fieldId'];
  switch (value['kind']) {
    case 'one-of': {
      const valueIds = Array.isArray(value['valueIds']) ? value['valueIds'].filter(isProjectNodeId) : [];
      return { kind: 'one-of', fieldId, valueIds };
    }
    case 'no-value':
      return { kind: 'no-value', fieldId };
    case 'contains':
      return typeof value['text'] === 'string' && value['text'].length <= CUSTOM_VIEW_TEXT_MAX
        ? { kind: 'contains', fieldId, text: value['text'].trim() }
        : null;
    default:
      return null;
  }
}

function parseSort(value: unknown): CustomViewSort | null {
  if (!isRecord(value) || !isProjectNodeId(value['fieldId'])) return null;
  if (value['direction'] !== 'asc' && value['direction'] !== 'desc') return null;
  return { fieldId: value['fieldId'], direction: value['direction'] };
}

function optionalNodeId(value: unknown): string | null {
  return isProjectNodeId(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
