import type {
  ProjectField,
  ProjectFieldInput,
  ProjectFieldValue,
  ProjectItem,
  ProjectSavedView
} from '../../../shared/projects';

export type SingleSelectField = Extract<ProjectField, { kind: 'single-select' }>;

/**
 * The single-select field a board groups by: the view's group-by field when it is single-select, else the
 * field named Status, else the first single-select field. Null when the project has none, so no board is possible.
 */
export function groupingField(view: ProjectSavedView, fields: ProjectField[]): SingleSelectField | null {
  const singles = fields.filter((f): f is SingleSelectField => f.kind === 'single-select');
  // A view grouped by another kind of field has no board to show, so it is not regrouped by a different field.
  if (view.groupByFieldId !== null) return singles.find((f) => f.id === view.groupByFieldId) ?? null;
  return singles.find((f) => f.name === 'Status') ?? singles[0] ?? null;
}

export interface BoardColumn {
  /** `NONE` for items without a value in the grouping field. */
  key: string;
  label: string;
  /** The option this column sets, or null for the column that clears the field. */
  optionId: string | null;
  color: string | null;
  items: ProjectItem[];
}

/** One column per option, then a column for items with no value. An item whose option no longer exists is shown without a value. */
export function boardColumns(field: SingleSelectField, items: ProjectItem[]): BoardColumn[] {
  const optionIds = new Set(field.options.map((o) => o.id));
  const columns: BoardColumn[] = field.options.map((option) => ({
    key: option.id,
    label: option.name,
    optionId: option.id,
    color: option.color,
    items: []
  }));
  const none: BoardColumn = { key: 'NONE', label: 'No value', optionId: null, color: null, items: [] };
  for (const item of items) {
    const value = item.fieldValues[field.id];
    const column =
      value?.kind === 'single-select' && optionIds.has(value.optionId)
        ? columns.find((c) => c.optionId === value.optionId)
        : undefined;
    (column ?? none).items.push(item);
  }
  return [...columns, none];
}

/** Human-readable text for a stored field value. */
export function describeValue(value: ProjectFieldValue | undefined): string {
  if (!value) return '';
  switch (value.kind) {
    case 'single-select':
      return value.name;
    case 'iteration':
      return value.title;
    case 'text':
      return value.text;
    case 'number':
      return String(value.number);
    case 'date':
      return value.date;
  }
}

/**
 * The value an item will show while a save is pending. The real value replaces it when GitHub answers, so
 * a failed save falls back to what GitHub actually stored.
 */
export function withFieldValue(
  item: ProjectItem,
  field: ProjectField,
  input: ProjectFieldInput | null
): ProjectItem {
  const fieldValues = { ...item.fieldValues };
  if (input === null) {
    delete fieldValues[field.id];
    return { ...item, fieldValues };
  }
  switch (input.kind) {
    case 'single-select': {
      const option =
        field.kind === 'single-select' ? field.options.find((o) => o.id === input.optionId) : undefined;
      fieldValues[field.id] = { kind: 'single-select', optionId: input.optionId, name: option?.name ?? '' };
      break;
    }
    case 'iteration': {
      const iteration =
        field.kind === 'iteration' ? field.iterations.find((i) => i.id === input.iterationId) : undefined;
      fieldValues[field.id] = {
        kind: 'iteration',
        iterationId: input.iterationId,
        title: iteration?.title ?? '',
        startDate: iteration?.startDate ?? '',
        duration: iteration?.duration ?? 0
      };
      break;
    }
    case 'text':
      fieldValues[field.id] = { kind: 'text', text: input.text };
      break;
    case 'number':
      fieldValues[field.id] = { kind: 'number', number: input.number };
      break;
    case 'date':
      fieldValues[field.id] = { kind: 'date', date: input.date };
      break;
  }
  return { ...item, fieldValues };
}

export interface ItemRef {
  repoFullName: string;
  number: number;
}

/** Reads `owner/repo#12`, or a github.com issue or pull request URL. Returns null for anything else. */
export function parseItemRef(input: string): ItemRef | null {
  const text = input.trim();
  const short = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/.exec(text);
  const url = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(?:issues|pull)\/(\d+)\/?$/.exec(
    text
  );
  const match = short ?? url;
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { repoFullName: match[1] as string, number };
}

/** The kind an item opens as in Orbit's details panel. Drafts have no GitHub page to open. */
export function openableKind(item: ProjectItem): 'issue' | 'pull' | null {
  return item.kind === 'draft' ? null : item.kind;
}
