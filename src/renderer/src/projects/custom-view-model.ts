import type { CustomViewCondition, CustomViewDefinition } from '../../../shared/custom-views';
import type {
  ProjectField,
  ProjectFieldInput,
  ProjectFieldValue,
  ProjectItem
} from '../../../shared/projects';

/** Fields a Kanban column, swimlane, or table group can use: each value is one group. */
type GroupableField = Extract<ProjectField, { kind: 'single-select' | 'iteration' }>;

export interface ItemGroup {
  /** `NONE` for items without a value in the field. */
  key: string;
  label: string;
  /** The write that puts an item into this group. Null for No value, which clears the field. */
  target: ProjectFieldInput | null;
  items: ProjectItem[];
}

export type MappingSlot = 'columnFieldId' | 'swimlaneFieldId' | 'groupFieldId' | 'sort' | 'condition';

export interface MappingRepair {
  slot: MappingSlot;
  fieldId: string;
  /** `missing`: the field was deleted. `wrong-kind`: it is now a kind this use cannot take. */
  reason: 'missing' | 'wrong-kind';
}

/**
 * The field a new Kanban view should suggest for its columns: Status when the project has it, else the
 * first single-select, else the first iteration. Null when none exists, so no Kanban can be made.
 */
export function suggestMapping(fields: ProjectField[]): string | null {
  const singles = fields.filter((f) => f.kind === 'single-select');
  const status = singles.find((f) => f.name === 'Status');
  const iteration = fields.find((f) => f.kind === 'iteration');
  return (status ?? singles[0] ?? iteration)?.id ?? null;
}

/**
 * Mapped fields that no longer fit the view. Each one needs an explicit repair from the user; nothing is
 * changed silently.
 */
export function findMappingRepairs(view: CustomViewDefinition, fields: ProjectField[]): MappingRepair[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const repairs: MappingRepair[] = [];
  const check = (slot: MappingSlot, fieldId: string | null, accept: (field: ProjectField) => boolean) => {
    if (fieldId === null) return;
    const field = byId.get(fieldId);
    if (!field) repairs.push({ slot, fieldId, reason: 'missing' });
    else if (!accept(field)) repairs.push({ slot, fieldId, reason: 'wrong-kind' });
  };
  const groupable = (f: ProjectField) => f.kind === 'single-select' || f.kind === 'iteration';
  check('columnFieldId', view.columnFieldId, groupable);
  check('swimlaneFieldId', view.swimlaneFieldId, groupable);
  check('groupFieldId', view.groupFieldId, groupable);
  if (view.sort) check('sort', view.sort.fieldId, () => true);
  for (const condition of view.conditions) {
    const accept = conditionAccepts(condition);
    check('condition', condition.fieldId, accept);
  }
  return repairs;
}

function conditionAccepts(condition: CustomViewCondition): (field: ProjectField) => boolean {
  switch (condition.kind) {
    case 'one-of':
      return (f) => f.kind === 'single-select' || f.kind === 'iteration';
    case 'contains':
      return (f) => f.kind === 'text';
    case 'no-value':
      return () => true;
  }
}

/** Items that match every visual condition. The advanced filter already ran on GitHub. */
export function applyConditions(
  items: ProjectItem[],
  conditions: CustomViewCondition[],
  fields: ProjectField[]
): ProjectItem[] {
  // A condition with no value chosen yet is a draft, so it filters nothing.
  const active = conditions.filter(isFinished);
  if (active.length === 0) return items;
  const byId = new Map(fields.map((f) => [f.id, f]));
  return items.filter((item) => active.every((c) => matches(item, c, byId.get(c.fieldId))));
}

function isFinished(condition: CustomViewCondition): boolean {
  if (condition.kind === 'one-of') return condition.valueIds.length > 0;
  if (condition.kind === 'contains') return condition.text.trim() !== '';
  return true;
}

function matches(
  item: ProjectItem,
  condition: CustomViewCondition,
  field: ProjectField | undefined
): boolean {
  const value = item.fieldValues[condition.fieldId];
  switch (condition.kind) {
    case 'no-value':
      return value === undefined;
    case 'one-of':
      return (
        value !== undefined &&
        valueIdOf(value) !== null &&
        condition.valueIds.includes(valueIdOf(value) as string)
      );
    case 'contains': {
      if (!value || value.kind !== 'text' || !field || field.kind !== 'text') return false;
      return value.text.toLowerCase().includes(condition.text.toLowerCase());
    }
  }
}

/** The option or iteration id an item holds in a grouping field, or null. */
function valueIdOf(value: ProjectFieldValue): string | null {
  if (value.kind === 'single-select') return value.optionId;
  if (value.kind === 'iteration') return value.iterationId;
  return null;
}

/**
 * Sorts by one field. Items without a value go last in both directions. Equal values keep the order they
 * came in. Single-selects sort by their order in the field, iterations by their start date.
 */
export function sortItems(
  items: ProjectItem[],
  field: ProjectField,
  direction: 'asc' | 'desc'
): ProjectItem[] {
  const rank = sortKey(field);
  const sign = direction === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => {
    const a = rank(left.fieldValues[field.id]);
    const b = rank(right.fieldValues[field.id]);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -sign : a > b ? sign : 0;
  });
}

function sortKey(field: ProjectField): (value: ProjectFieldValue | undefined) => number | string | null {
  switch (field.kind) {
    case 'single-select': {
      const order = new Map(field.options.map((o, index) => [o.id, index]));
      return (value) =>
        value?.kind === 'single-select' && order.has(value.optionId)
          ? (order.get(value.optionId) as number)
          : null;
    }
    case 'iteration':
      return (value) => (value?.kind === 'iteration' ? `${value.startDate}|${value.title}` : null);
    case 'number':
      return (value) => (value?.kind === 'number' ? value.number : null);
    case 'text':
      return (value) => (value?.kind === 'text' ? value.text.toLowerCase() : null);
    case 'date':
      return (value) => (value?.kind === 'date' ? value.date : null);
  }
}

/**
 * Groups items by a single-select or iteration field: one group per option or iteration in field order,
 * then No value. An iteration an item is in that the field no longer lists still gets a group. Null when the
 * field cannot group.
 */
export function groupItems(items: ProjectItem[], field: ProjectField): ItemGroup[] | null {
  if (field.kind !== 'single-select' && field.kind !== 'iteration') return null;
  const groupable: GroupableField = field;
  const groups = groupDefinitions(groupable, items).map((def) => ({ ...def, items: [] as ProjectItem[] }));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const none = byKey.get('NONE') as ItemGroup;
  for (const item of items) {
    const value = item.fieldValues[groupable.id];
    const key = value ? valueIdOf(value) : null;
    const group = key !== null ? byKey.get(key) : undefined;
    (group ?? none).items.push(item);
  }
  return groups;
}

/** A group before its items are placed. Iteration groups carry a start date only so they can be ordered. */
type GroupDefinition = Omit<ItemGroup, 'items'> & { startDate?: string };

function groupDefinitions(field: GroupableField, items: ProjectItem[]): Array<Omit<ItemGroup, 'items'>> {
  if (field.kind === 'single-select') {
    return [
      ...field.options.map((o) => ({
        key: o.id,
        label: o.name,
        target: { kind: 'single-select' as const, optionId: o.id }
      })),
      { key: 'NONE', label: 'No value', target: null }
    ];
  }
  const groups: GroupDefinition[] = field.iterations.map((i) => ({
    key: i.id,
    label: i.title,
    target: { kind: 'iteration' as const, iterationId: i.id },
    startDate: i.startDate
  }));
  // An iteration that an item is in but the field no longer lists still gets a group, so the item is not hidden.
  const listed = new Set(groups.map((g) => g.key));
  const unlisted = new Map<string, { title: string; startDate: string }>();
  for (const item of items) {
    const value = item.fieldValues[field.id];
    if (value?.kind === 'iteration' && !listed.has(value.iterationId)) {
      unlisted.set(value.iterationId, { title: value.title, startDate: value.startDate });
    }
  }
  for (const [id, found] of unlisted) {
    groups.push({
      key: id,
      label: found.title,
      target: { kind: 'iteration', iterationId: id },
      startDate: found.startDate
    });
  }
  groups.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
  return [
    ...groups.map(({ startDate: _startDate, ...group }) => group),
    { key: 'NONE', label: 'No value', target: null }
  ];
}

/**
 * The items a custom view shows: its visual conditions, then its sort. With no sort, items keep GitHub's
 * manual order, which is shared with the project itself.
 */
export function viewItems(
  items: ProjectItem[],
  view: CustomViewDefinition,
  fields: ProjectField[]
): ProjectItem[] {
  const filtered = applyConditions(items, view.conditions, fields);
  if (!view.sort) return filtered;
  const field = fields.find((f) => f.id === view.sort?.fieldId);
  return field ? sortItems(filtered, field, view.sort.direction) : filtered;
}
