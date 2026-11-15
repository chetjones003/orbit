import { describe, expect, it } from 'vitest';
import {
  applyConditions,
  findMappingRepairs,
  groupItems,
  sortItems,
  suggestMapping,
  viewItems
} from '../../../src/renderer/src/projects/custom-view-model';
import type { CustomViewDefinition } from '../../../src/shared/custom-views';
import type { ProjectField, ProjectItem } from '../../../src/shared/projects';

const STATUS: ProjectField = {
  id: 'FLD_status',
  name: 'Status',
  kind: 'single-select',
  options: [
    { id: 'todo', name: 'Todo', color: 'GRAY' },
    { id: 'doing', name: 'Doing', color: 'YELLOW' },
    { id: 'done', name: 'Done', color: 'GREEN' }
  ]
};
const PRIORITY: ProjectField = {
  id: 'FLD_prio',
  name: 'Priority',
  kind: 'single-select',
  options: [
    { id: 'p0', name: 'P0', color: 'RED' },
    { id: 'p1', name: 'P1', color: 'BLUE' }
  ]
};
const SPRINT: ProjectField = {
  id: 'FLD_sprint',
  name: 'Sprint',
  kind: 'iteration',
  iterations: [
    { id: 'it_2', title: 'Sprint 2', startDate: '2026-02-01', duration: 14 },
    { id: 'it_3', title: 'Sprint 3', startDate: '2026-02-15', duration: 14 }
  ]
};
const ESTIMATE: ProjectField = { id: 'FLD_est', name: 'Estimate', kind: 'number' };
const NOTES: ProjectField = { id: 'FLD_notes', name: 'Notes', kind: 'text' };
const DUE: ProjectField = { id: 'FLD_due', name: 'Due', kind: 'date' };
const START: ProjectField = { id: 'FLD_start', name: 'Start', kind: 'date' };
const FIELDS = [PRIORITY, STATUS, SPRINT, ESTIMATE, NOTES, DUE, START];

function item(id: string, fieldValues: ProjectItem['fieldValues'] = {}): ProjectItem {
  return {
    id,
    kind: 'issue',
    contentId: `I_${id}`,
    repoFullName: 'orbit-owner/app',
    number: 1,
    title: `Item ${id}`,
    htmlUrl: 'https://github.com/orbit-owner/app/issues/1',
    state: 'open',
    isDraft: false,
    fieldValues
  };
}

const status = (optionId: string) => ({ kind: 'single-select' as const, optionId, name: optionId });
const estimate = (number: number) => ({ kind: 'number' as const, number });

function definition(overrides: Partial<CustomViewDefinition> = {}): CustomViewDefinition {
  return {
    id: 'cv-1',
    name: 'Board',
    projectId: 'PVT_1',
    layout: 'kanban',
    advancedFilter: '',
    conditions: [],
    sort: null,
    groupFieldId: null,
    columnFieldId: null,
    swimlaneFieldId: null,
    ganttSource: 'dates',
    startFieldId: null,
    targetFieldId: null,
    iterationFieldId: null,
    calendarFieldId: null,
    calendarScale: 'month',
    ...overrides
  };
}

describe('suggestMapping', () => {
  it('suggests the Status field, then the first single-select, then the first iteration', () => {
    expect(suggestMapping([PRIORITY, STATUS, SPRINT])).toBe('FLD_status');
    expect(suggestMapping([PRIORITY, SPRINT])).toBe('FLD_prio');
    expect(suggestMapping([SPRINT, ESTIMATE])).toBe('FLD_sprint');
  });

  it('suggests nothing when no field can make columns', () => {
    expect(suggestMapping([ESTIMATE, NOTES])).toBeNull();
  });
});

describe('findMappingRepairs', () => {
  it('reports a mapped field that was deleted from the project', () => {
    const repairs = findMappingRepairs(definition({ columnFieldId: 'FLD_gone' }), FIELDS);
    expect(repairs).toEqual([{ slot: 'columnFieldId', fieldId: 'FLD_gone', reason: 'missing' }]);
  });

  it('reports a mapped field that is no longer a kind the view can use', () => {
    const repairs = findMappingRepairs(definition({ columnFieldId: 'FLD_est' }), FIELDS);
    expect(repairs).toEqual([{ slot: 'columnFieldId', fieldId: 'FLD_est', reason: 'wrong-kind' }]);
  });

  it('checks the swimlane, group, sort, and condition fields too', () => {
    const repairs = findMappingRepairs(
      definition({
        swimlaneFieldId: 'FLD_gone',
        groupFieldId: 'FLD_notes',
        sort: { fieldId: 'FLD_missing', direction: 'asc' },
        conditions: [{ kind: 'no-value', fieldId: 'FLD_also_missing' }]
      }),
      FIELDS
    );
    expect(repairs.map((r) => [r.slot, r.reason])).toEqual([
      ['swimlaneFieldId', 'missing'],
      ['groupFieldId', 'wrong-kind'],
      ['sort', 'missing'],
      ['condition', 'missing']
    ]);
  });

  it('reports nothing for a mapping that still matches', () => {
    expect(findMappingRepairs(definition({ columnFieldId: 'FLD_status' }), FIELDS)).toEqual([]);
  });

  it('checks the schedule fields a Gantt by dates uses: each must be a date field', () => {
    const repairs = findMappingRepairs(
      definition({
        layout: 'gantt',
        ganttSource: 'dates',
        startFieldId: 'FLD_status',
        targetFieldId: 'FLD_gone',
        iterationFieldId: 'FLD_sprint'
      }),
      FIELDS
    );
    expect(repairs.map((r) => [r.slot, r.reason])).toEqual([
      ['startFieldId', 'wrong-kind'],
      ['targetFieldId', 'missing']
    ]);
  });

  it('checks the iteration field a Gantt by iteration uses, and the dates it does not use are ignored', () => {
    const repairs = findMappingRepairs(
      definition({
        layout: 'gantt',
        ganttSource: 'iteration',
        iterationFieldId: 'FLD_due',
        startFieldId: 'FLD_gone'
      }),
      FIELDS
    );
    expect(repairs.map((r) => [r.slot, r.reason])).toEqual([['iterationFieldId', 'wrong-kind']]);
  });

  it('checks the calendar date field only on a Calendar view', () => {
    expect(
      findMappingRepairs(definition({ layout: 'calendar', calendarFieldId: 'FLD_status' }), FIELDS).map(
        (r) => [r.slot, r.reason]
      )
    ).toEqual([['calendarFieldId', 'wrong-kind']]);
    expect(findMappingRepairs(definition({ layout: 'kanban', calendarFieldId: 'FLD_gone' }), FIELDS)).toEqual(
      []
    );
  });
});

describe('applyConditions', () => {
  const todo = item('todo', { FLD_status: status('todo') });
  const done = item('done', { FLD_status: status('done') });
  const none = item('none', {});
  const noteText = item('notes', { FLD_notes: { kind: 'text', text: 'Needs REVIEW soon' } });

  it('keeps items whose single-select value is one of the chosen options', () => {
    const kept = applyConditions(
      [todo, done, none],
      [{ kind: 'one-of', fieldId: 'FLD_status', valueIds: ['todo', 'doing'] }],
      FIELDS
    );
    expect(kept.map((i) => i.id)).toEqual(['todo']);
  });

  it('keeps only items with no value for a no-value condition', () => {
    expect(
      applyConditions([todo, none], [{ kind: 'no-value', fieldId: 'FLD_status' }], FIELDS).map((i) => i.id)
    ).toEqual(['none']);
  });

  it('matches text case-insensitively', () => {
    expect(
      applyConditions(
        [noteText, todo],
        [{ kind: 'contains', fieldId: 'FLD_notes', text: 'review' }],
        FIELDS
      ).map((i) => i.id)
    ).toEqual(['notes']);
  });

  it('ignores a condition that is not finished yet, such as one with no value chosen', () => {
    const items = [todo, done, none];
    expect(
      applyConditions(items, [{ kind: 'one-of', fieldId: 'FLD_status', valueIds: [] }], FIELDS)
    ).toHaveLength(3);
    expect(
      applyConditions(items, [{ kind: 'contains', fieldId: 'FLD_notes', text: '' }], FIELDS)
    ).toHaveLength(3);
  });

  it('requires every condition to match', () => {
    const kept = applyConditions(
      [todo, done],
      [
        { kind: 'one-of', fieldId: 'FLD_status', valueIds: ['todo', 'done'] },
        { kind: 'contains', fieldId: 'FLD_notes', text: 'x' }
      ],
      FIELDS
    );
    expect(kept).toEqual([]);
  });
});

describe('sortItems', () => {
  const a = item('a', { FLD_est: estimate(5) });
  const b = item('b', { FLD_est: estimate(2) });
  const c = item('c', {});
  const d = item('d', { FLD_est: estimate(9) });

  it('sorts numbers ascending with missing values last', () => {
    expect(sortItems([a, c, b, d], ESTIMATE, 'asc').map((i) => i.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('sorts numbers descending and still keeps missing values last', () => {
    expect(sortItems([a, c, b, d], ESTIMATE, 'desc').map((i) => i.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('sorts single-select values by their order in the field', () => {
    const items = [
      item('done', { FLD_status: status('done') }),
      item('todo', { FLD_status: status('todo') }),
      item('doing', { FLD_status: status('doing') })
    ];
    expect(sortItems(items, STATUS, 'asc').map((i) => i.id)).toEqual(['todo', 'doing', 'done']);
  });

  it('keeps the existing order for items with equal values', () => {
    const first = item('first', { FLD_est: estimate(3) });
    const second = item('second', { FLD_est: estimate(3) });
    expect(sortItems([second, first], ESTIMATE, 'asc').map((i) => i.id)).toEqual(['second', 'first']);
  });
});

describe('groupItems', () => {
  it('makes one group per option in field order, then a No value group', () => {
    const groups = groupItems(
      [
        item('done', { FLD_status: status('done') }),
        item('none', {}),
        item('todo', { FLD_status: status('todo') })
      ],
      STATUS
    );
    expect(groups?.map((g) => [g.key, g.label, g.items.map((i) => i.id)])).toEqual([
      ['todo', 'Todo', ['todo']],
      ['doing', 'Doing', []],
      ['done', 'Done', ['done']],
      ['NONE', 'No value', ['none']]
    ]);
  });

  it('keeps an item whose option was deleted in the No value group', () => {
    const groups = groupItems([item('gone', { FLD_status: status('removed') })], STATUS);
    expect(groups?.find((g) => g.key === 'NONE')?.items.map((i) => i.id)).toEqual(['gone']);
  });

  it('gives each group the write that puts an item in it, and clears for No value', () => {
    const groups = groupItems([], STATUS);
    expect(groups?.find((g) => g.key === 'doing')?.target).toEqual({
      kind: 'single-select',
      optionId: 'doing'
    });
    expect(groups?.find((g) => g.key === 'NONE')?.target).toBeNull();
  });

  it('adds a group for an iteration an item is in, even when it is no longer listed', () => {
    const completed = item('old', {
      FLD_sprint: {
        kind: 'iteration',
        iterationId: 'it_1',
        title: 'Sprint 1',
        startDate: '2026-01-18',
        duration: 14
      }
    });
    const groups = groupItems([completed], SPRINT);
    expect(groups?.map((g) => [g.key, g.label])).toEqual([
      ['it_1', 'Sprint 1'],
      ['it_2', 'Sprint 2'],
      ['it_3', 'Sprint 3'],
      ['NONE', 'No value']
    ]);
    expect(groups?.[0]?.items.map((i) => i.id)).toEqual(['old']);
  });

  it('returns null for a field that cannot group', () => {
    expect(groupItems([], ESTIMATE)).toBeNull();
  });
});

describe('viewItems', () => {
  it('keeps GitHub order when the view is unsorted', () => {
    const items = [item('z', { FLD_est: estimate(1) }), item('a', { FLD_est: estimate(9) })];
    expect(viewItems(items, definition(), FIELDS).map((i) => i.id)).toEqual(['z', 'a']);
  });

  it('filters and then sorts when the view has a sort', () => {
    const items = [
      item('big', { FLD_est: estimate(8), FLD_status: status('todo') }),
      item('small', { FLD_est: estimate(1), FLD_status: status('todo') }),
      item('other', { FLD_est: estimate(0), FLD_status: status('done') })
    ];
    const result = viewItems(
      items,
      definition({
        conditions: [{ kind: 'one-of', fieldId: 'FLD_status', valueIds: ['todo'] }],
        sort: { fieldId: 'FLD_est', direction: 'asc' }
      }),
      FIELDS
    );
    expect(result.map((i) => i.id)).toEqual(['small', 'big']);
  });
});
