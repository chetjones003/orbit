import { describe, expect, it } from 'vitest';
import {
  boardColumns,
  groupingField,
  parseItemRef,
  withFieldValue,
  describeValue,
  openableKind,
  type SingleSelectField
} from '../../../src/renderer/src/projects/project-model';
import type { ProjectField, ProjectItem, ProjectSavedView } from '../../../src/shared/projects';

const STATUS: SingleSelectField = {
  id: 'FLD_status',
  name: 'Status',
  kind: 'single-select',
  options: [
    { id: 'todo', name: 'Todo', color: 'GRAY' },
    { id: 'done', name: 'Done', color: 'GREEN' }
  ]
};
const PRIORITY: SingleSelectField = {
  id: 'FLD_prio',
  name: 'Priority',
  kind: 'single-select',
  options: [{ id: 'p0', name: 'P0', color: 'RED' }]
};
const SPRINT: ProjectField = {
  id: 'FLD_sprint',
  name: 'Sprint',
  kind: 'iteration',
  iterations: [{ id: 'it_1', title: 'Sprint 1', startDate: '2026-01-05', duration: 14 }]
};
const ESTIMATE: ProjectField = { id: 'FLD_est', name: 'Estimate', kind: 'number' };

function view(overrides: Partial<ProjectSavedView> = {}): ProjectSavedView {
  return {
    id: 'V',
    number: 1,
    name: 'Board',
    layout: 'board',
    filter: '',
    groupByFieldId: null,
    ...overrides
  };
}

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

describe('groupingField', () => {
  it('prefers the view’s group-by field, then Status, then the first single-select field', () => {
    expect(groupingField(view({ groupByFieldId: 'FLD_prio' }), [STATUS, PRIORITY])?.id).toBe('FLD_prio');
    expect(groupingField(view(), [PRIORITY, STATUS])?.id).toBe('FLD_status');
    expect(groupingField(view(), [PRIORITY])?.id).toBe('FLD_prio');
  });

  it('is null when the project has no single-select field', () => {
    expect(groupingField(view(), [SPRINT, ESTIMATE])).toBeNull();
  });
});

describe('boardColumns', () => {
  it('puts each item under its option, and items with no usable value under No value', () => {
    const columns = boardColumns(STATUS, [
      item('a', { FLD_status: { kind: 'single-select', optionId: 'done', name: 'Done' } }),
      item('b'),
      item('c', { FLD_status: { kind: 'single-select', optionId: 'deleted-option', name: 'Gone' } })
    ]);
    expect(columns.map((c) => [c.label, c.items.map((i) => i.id)])).toEqual([
      ['Todo', []],
      ['Done', ['a']],
      ['No value', ['b', 'c']]
    ]);
    expect(columns[2]?.optionId).toBeNull();
  });
});

describe('withFieldValue', () => {
  it('shows a single-select pick with the option name, before GitHub answers', () => {
    const next = withFieldValue(item('a'), STATUS, { kind: 'single-select', optionId: 'done' });
    expect(next.fieldValues['FLD_status']).toEqual({ kind: 'single-select', optionId: 'done', name: 'Done' });
  });

  it('shows an iteration pick with its title and dates', () => {
    const next = withFieldValue(item('a'), SPRINT, { kind: 'iteration', iterationId: 'it_1' });
    expect(next.fieldValues['FLD_sprint']).toEqual({
      kind: 'iteration',
      iterationId: 'it_1',
      title: 'Sprint 1',
      startDate: '2026-01-05',
      duration: 14
    });
  });

  it('removes the value on a clear and leaves the original item untouched', () => {
    const original = item('a', { FLD_est: { kind: 'number', number: 5 } });
    const cleared = withFieldValue(original, ESTIMATE, null);
    expect(cleared.fieldValues).toEqual({});
    expect(original.fieldValues).toEqual({ FLD_est: { kind: 'number', number: 5 } });
  });
});

describe('describeValue', () => {
  it('turns each stored value into text', () => {
    expect(describeValue(undefined)).toBe('');
    expect(describeValue({ kind: 'number', number: 3 })).toBe('3');
    expect(describeValue({ kind: 'date', date: '2026-02-01' })).toBe('2026-02-01');
    expect(
      describeValue({ kind: 'iteration', iterationId: 'i', title: 'Sprint 1', startDate: '', duration: 1 })
    ).toBe('Sprint 1');
  });
});

describe('parseItemRef', () => {
  it('reads owner/repo#number and a GitHub issue or pull request link', () => {
    expect(parseItemRef('orbit-owner/app#12')).toEqual({ repoFullName: 'orbit-owner/app', number: 12 });
    expect(parseItemRef('  orbit-owner/app#12 ')).toEqual({ repoFullName: 'orbit-owner/app', number: 12 });
    expect(parseItemRef('https://github.com/orbit-owner/app/pull/7')).toEqual({
      repoFullName: 'orbit-owner/app',
      number: 7
    });
    expect(parseItemRef('https://github.com/orbit-owner/app/issues/7/')).toEqual({
      repoFullName: 'orbit-owner/app',
      number: 7
    });
  });

  it('refuses anything else', () => {
    expect(parseItemRef('app#12')).toBeNull();
    expect(parseItemRef('orbit-owner/app#0')).toBeNull();
    expect(parseItemRef('orbit-owner/app#x')).toBeNull();
    expect(parseItemRef('http://github.com/orbit-owner/app/issues/1')).toBeNull();
    expect(parseItemRef('https://example.com/orbit-owner/app/issues/1')).toBeNull();
  });
});

describe('openableKind', () => {
  it('opens issues and pull requests, but not drafts', () => {
    expect(openableKind(item('a'))).toBe('issue');
    expect(openableKind({ ...item('b'), kind: 'draft', repoFullName: null, number: null })).toBeNull();
  });
});
