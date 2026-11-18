/**
 * Projects (v2) shapes shared by main, preload, and renderer. No Node or DOM APIs.
 * Only projects the signed-in account owns are in scope. Orbit reads the GitHub saved views that
 * use the table or board layout; roadmap views and custom Orbit views are outside this module.
 */

import type { IssueLabel } from './issues';

export interface ProjectSummary {
  /** GitHub node id. */
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
}

/** The saved-view layouts Orbit shows. Roadmap views are not listed. */
export type ProjectViewLayout = 'table' | 'board';

export interface ProjectSavedView {
  id: string;
  number: number;
  name: string;
  layout: ProjectViewLayout;
  /** The view's filter string, applied as-is through GitHub's `items(query:)`. Empty when unfiltered. */
  filter: string;
  /** The view's group-by field, which the board uses for its columns. */
  groupByFieldId: string | null;
}

export interface SingleSelectOption {
  id: string;
  name: string;
  /** GitHub's colour name, such as `GREEN`. Null when GitHub sends none. */
  color: string | null;
}

export interface IterationOption {
  id: string;
  title: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  duration: number;
}

interface ProjectFieldBase {
  id: string;
  name: string;
}

/** A custom Project field that Orbit can read and edit. Built-in fields such as Title or Labels are not listed. */
export type ProjectField =
  | (ProjectFieldBase & { kind: 'single-select'; options: SingleSelectOption[] })
  | (ProjectFieldBase & { kind: 'iteration'; iterations: IterationOption[] })
  | (ProjectFieldBase & { kind: 'text' | 'number' | 'date' });

export type ProjectFieldKind = ProjectField['kind'];

/** A field value on an item, as GitHub stores it. Keyed by field id in `ProjectItem.fieldValues`. */
export type ProjectFieldValue =
  | { kind: 'single-select'; optionId: string; name: string }
  | { kind: 'iteration'; iterationId: string; title: string; startDate: string; duration: number }
  | { kind: 'text'; text: string }
  | { kind: 'number'; number: number }
  | { kind: 'date'; date: string };

/** A value to write. Input never carries names or dates from GitHub; those come back on read. */
export type ProjectFieldInput =
  | { kind: 'single-select'; optionId: string }
  | { kind: 'iteration'; iterationId: string }
  | { kind: 'text'; text: string }
  | { kind: 'number'; number: number }
  | { kind: 'date'; date: string };

/** Sets a field to a value, or clears it when `value` is null. */
export interface ProjectFieldChange {
  fieldId: string;
  value: ProjectFieldInput | null;
}

export type ProjectItemKind = 'issue' | 'pull' | 'draft';

export interface ProjectItem {
  /** The project item's GitHub node id. Edits and removals are keyed by it. */
  id: string;
  kind: ProjectItemKind;
  /** The issue or pull request's node id. Null for draft items. */
  contentId: string | null;
  /** `owner/name`, or null for a draft. */
  repoFullName: string | null;
  number: number | null;
  title: string;
  htmlUrl: string | null;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  /** The issue or pull request's labels. Empty for drafts. */
  labels: IssueLabel[];
  /** Field values keyed by field id. A field with no value is absent. */
  fieldValues: Record<string, ProjectFieldValue>;
}

export interface ProjectDetail {
  project: ProjectSummary;
  /** Custom fields Orbit can read and edit. */
  fields: ProjectField[];
  /** Table and board saved views, in GitHub's order. */
  views: ProjectSavedView[];
}

export interface ProjectListPage {
  projects: ProjectSummary[];
  /** True when GitHub has more projects than Orbit loaded. */
  partial: boolean;
}

export interface ProjectItemsPage {
  items: ProjectItem[];
  /** True when the project has more matching items than Orbit loaded, or some items could not be shown. */
  partial: boolean;
}

/** An issue or pull request's place in one project. */
export interface ProjectMembership {
  project: ProjectSummary;
  item: ProjectItem;
}

export interface ItemMemberships {
  /** The issue or pull request's node id, needed to add it to a project. */
  contentId: string;
  memberships: ProjectMembership[];
  /** True when the item is in more projects than Orbit shows. */
  partial: boolean;
}

/**
 * The result of a field edit. `failed` always carries GitHub's version of the item when it can be read,
 * so the view can show what actually saved.
 */
export type ProjectItemEditResult =
  | { kind: 'saved'; item: ProjectItem }
  | { kind: 'failed'; item: ProjectItem | null; message: string }
  | { kind: 'busy' };

/** Page sizes and limits. GitHub's GraphQL cost grows with the product of these. */
export const PROJECT_ITEMS_PAGE_SIZE = 50;
export const PROJECT_ITEMS_PAGE_LIMIT = 10;
export const PROJECT_FIELD_VALUES_PER_ITEM = 50;
export const PROJECT_TEXT_MAX_CHARS = 2048;

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const NODE_ID_PATTERN = /^[A-Za-z0-9_=-]{1,200}$/;

/** Node ids GitHub returns are opaque strings; this only rules out empty and oversized values. */
export function isProjectNodeId(value: unknown): value is string {
  return typeof value === 'string' && NODE_ID_PATTERN.test(value);
}

/**
 * Checks a field change from the renderer. Returns the change, or null when it is malformed.
 * Main calls this before any request; a null is a refused call, not a GitHub error.
 */
export function parseProjectFieldChange(input: unknown): ProjectFieldChange | null {
  if (!input || typeof input !== 'object') return null;
  const change = input as { fieldId?: unknown; value?: unknown };
  if (!isProjectNodeId(change.fieldId)) return null;
  if (change.value === null) return { fieldId: change.fieldId, value: null };
  const value = parseProjectFieldInput(change.value);
  return value ? { fieldId: change.fieldId, value } : null;
}

export function parseProjectFieldInput(input: unknown): ProjectFieldInput | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  switch (value['kind']) {
    case 'single-select':
      return isProjectNodeId(value['optionId'])
        ? { kind: 'single-select', optionId: value['optionId'] }
        : null;
    case 'iteration':
      return isProjectNodeId(value['iterationId'])
        ? { kind: 'iteration', iterationId: value['iterationId'] }
        : null;
    case 'text':
      return typeof value['text'] === 'string' && value['text'].length <= PROJECT_TEXT_MAX_CHARS
        ? { kind: 'text', text: value['text'] }
        : null;
    case 'number':
      return typeof value['number'] === 'number' && Number.isFinite(value['number'])
        ? { kind: 'number', number: value['number'] }
        : null;
    case 'date':
      return typeof value['date'] === 'string' && DATE_PATTERN.test(value['date'])
        ? { kind: 'date', date: value['date'] }
        : null;
    default:
      return null;
  }
}

/** Whether a stored value already equals the value a write would set. Used to confirm a write that may have landed. */
export function projectValueMatches(
  current: ProjectFieldValue | undefined,
  input: ProjectFieldInput | null
): boolean {
  if (input === null) return current === undefined;
  if (!current || current.kind !== input.kind) return false;
  switch (input.kind) {
    case 'single-select':
      return current.kind === 'single-select' && current.optionId === input.optionId;
    case 'iteration':
      return current.kind === 'iteration' && current.iterationId === input.iterationId;
    case 'text':
      return current.kind === 'text' && current.text === input.text;
    case 'number':
      return current.kind === 'number' && current.number === input.number;
    case 'date':
      return current.kind === 'date' && current.date === input.date;
  }
}
