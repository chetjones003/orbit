import { describe, expect, it } from 'vitest';
import { normalizeCustomViews, parseCustomView, CUSTOM_VIEWS_MAX } from '../../../src/shared/custom-views';

const VALID = {
  id: 'cv-1',
  name: '  Sprint board  ',
  projectId: 'PVT_kwDOAAA1',
  layout: 'kanban',
  advancedFilter: 'is:issue',
  conditions: [{ kind: 'one-of', fieldId: 'FLD_status', valueIds: ['todo', 'done'] }],
  sort: { fieldId: 'FLD_est', direction: 'asc' },
  groupFieldId: null,
  columnFieldId: 'FLD_status',
  swimlaneFieldId: 'FLD_prio',
  ganttSource: 'dates',
  startFieldId: null,
  targetFieldId: null,
  iterationFieldId: null,
  calendarFieldId: null,
  calendarScale: 'month'
};

describe('parseCustomView', () => {
  it('keeps a valid definition and trims its name', () => {
    expect(parseCustomView(VALID)).toEqual({ ...VALID, name: 'Sprint board' });
  });

  it('keeps only definition fields, so item data cannot be stored', () => {
    const parsed = parseCustomView({
      ...VALID,
      items: [{ id: 'PVTI_1', title: 'Secret item body' }],
      fieldValues: { FLD_status: { kind: 'text', text: 'private' } },
      token: 'gho_secret'
    });
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed ?? {}).sort()).toEqual(Object.keys(VALID).sort());
    expect(JSON.stringify(parsed)).not.toContain('Secret item body');
    expect(JSON.stringify(parsed)).not.toContain('gho_secret');
  });

  it('rejects a definition with an unknown layout, an empty name, or a malformed id', () => {
    expect(parseCustomView({ ...VALID, layout: 'board' })).toBeNull();
    expect(parseCustomView({ ...VALID, name: '   ' })).toBeNull();
    expect(parseCustomView({ ...VALID, id: 'has spaces' })).toBeNull();
    expect(parseCustomView({ ...VALID, projectId: '' })).toBeNull();
  });

  it('drops a condition or sort it cannot read, keeping the rest of the definition', () => {
    const parsed = parseCustomView({
      ...VALID,
      conditions: [
        { kind: 'bogus', fieldId: 'FLD_status' },
        { kind: 'no-value', fieldId: 'FLD_prio' }
      ],
      sort: { fieldId: 'FLD_est', direction: 'sideways' }
    });
    expect(parsed?.conditions).toEqual([{ kind: 'no-value', fieldId: 'FLD_prio' }]);
    expect(parsed?.sort).toBeNull();
  });

  it('defaults missing mapping fields to null and missing filters to empty', () => {
    const parsed = parseCustomView({ id: 'cv-2', name: 'Plain', projectId: 'PVT_1', layout: 'table' });
    expect(parsed).toEqual({
      id: 'cv-2',
      name: 'Plain',
      projectId: 'PVT_1',
      layout: 'table',
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
      calendarScale: 'month'
    });
  });

  it('keeps Gantt and Calendar layouts with their schedule fields', () => {
    const gantt = parseCustomView({
      ...VALID,
      layout: 'gantt',
      ganttSource: 'iteration',
      iterationFieldId: 'FLD_sprint',
      startFieldId: 'FLD_start',
      targetFieldId: 'FLD_end'
    });
    expect(gantt).toMatchObject({
      layout: 'gantt',
      ganttSource: 'iteration',
      iterationFieldId: 'FLD_sprint',
      startFieldId: 'FLD_start',
      targetFieldId: 'FLD_end'
    });
    const calendar = parseCustomView({
      ...VALID,
      layout: 'calendar',
      calendarFieldId: 'FLD_due',
      calendarScale: 'week'
    });
    expect(calendar).toMatchObject({ layout: 'calendar', calendarFieldId: 'FLD_due', calendarScale: 'week' });
  });

  it('falls back to date pairs and a month calendar for values it cannot read', () => {
    const parsed = parseCustomView({
      ...VALID,
      layout: 'gantt',
      ganttSource: 'sideways',
      calendarScale: 'year'
    });
    expect(parsed?.ganttSource).toBe('dates');
    expect(parsed?.calendarScale).toBe('month');
  });
});

describe('normalizeCustomViews', () => {
  it('returns an empty list for anything that is not a list', () => {
    expect(normalizeCustomViews(undefined)).toEqual([]);
    expect(normalizeCustomViews({ id: 'cv-1' })).toEqual([]);
  });

  it('drops invalid entries and duplicate ids, and caps the list', () => {
    const many = Array.from({ length: CUSTOM_VIEWS_MAX + 5 }, (_, i) => ({
      ...VALID,
      id: `cv-${i}`
    }));
    const result = normalizeCustomViews([...many, { ...VALID, id: 'cv-0' }, { bad: true }]);
    expect(result).toHaveLength(CUSTOM_VIEWS_MAX);
    expect(new Set(result.map((v) => v.id)).size).toBe(CUSTOM_VIEWS_MAX);
  });
});
