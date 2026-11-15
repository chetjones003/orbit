// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CustomViewPanel,
  type CustomViewPanelProps
} from '../../../src/renderer/src/projects/CustomViewPanel';
import type { CustomViewDefinition } from '../../../src/shared/custom-views';
import type { ProjectField, ProjectFieldValue, ProjectItem } from '../../../src/shared/projects';

afterEach(cleanup);

const START: ProjectField = { id: 'FLD_start', name: 'Start', kind: 'date' };
const DUE: ProjectField = { id: 'FLD_due', name: 'Due', kind: 'date' };
const SPRINT: ProjectField = {
  id: 'FLD_sprint',
  name: 'Sprint',
  kind: 'iteration',
  iterations: [{ id: 'it_2', title: 'Sprint 2', startDate: '2026-11-09', duration: 14 }]
};
const FIELDS = [START, DUE, SPRINT];
const TODAY = '2026-11-15';

function view(overrides: Partial<CustomViewDefinition>): CustomViewDefinition {
  return {
    id: 'cv-1',
    name: 'Plan',
    projectId: 'PVT_1',
    layout: 'gantt',
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

function item(id: string, title: string, values: Record<string, ProjectFieldValue> = {}): ProjectItem {
  return {
    id,
    kind: 'issue',
    contentId: `I_${id}`,
    repoFullName: 'orbit-owner/app',
    number: 7,
    title,
    htmlUrl: null,
    state: 'open',
    isDraft: false,
    fieldValues: values
  };
}

const date = (value: string): ProjectFieldValue => ({ kind: 'date', date: value });

function renderPanel(overrides: Partial<CustomViewPanelProps>) {
  const props: CustomViewPanelProps = {
    view: view({}),
    fields: FIELDS,
    items: [],
    pendingIds: new Set(),
    onChange: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(async (target) => target),
    onReorder: vi.fn(async () => undefined),
    onRemove: vi.fn(),
    onOpen: vi.fn(),
    today: TODAY,
    ...overrides
  };
  render(<CustomViewPanel {...props} />);
}

describe('CustomViewPanel, Gantt', () => {
  it('draws a Gantt of the items from its start and target fields', () => {
    renderPanel({
      view: view({ startFieldId: 'FLD_start', targetFieldId: 'FLD_due' }),
      items: [item('a', 'Ship it', { FLD_start: date('2026-11-10'), FLD_due: date('2026-11-12') })]
    });
    expect(screen.getByRole('region', { name: 'Unscheduled' })).toBeDefined();
    expect(screen.getByLabelText('Ship it, 2026-11-10 to 2026-11-12')).toBeDefined();
  });

  it('draws a Gantt from an iteration field', () => {
    renderPanel({
      view: view({ ganttSource: 'iteration', iterationFieldId: 'FLD_sprint' }),
      items: [
        item('a', 'Ship it', {
          FLD_sprint: {
            kind: 'iteration',
            iterationId: 'it_2',
            title: 'Sprint 2',
            startDate: '2026-11-09',
            duration: 14
          }
        })
      ]
    });
    expect(screen.getByLabelText('Ship it, 2026-11-09 to 2026-11-22')).toBeDefined();
  });

  it('asks for its fields when none is set, and the settings open to say so', () => {
    renderPanel({ view: view({ startFieldId: 'FLD_gone' }) });
    expect(screen.getByText('Choose a start field and a target field to draw this timeline.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    expect(screen.getByText('Start field was removed from this project.', { exact: false })).toBeDefined();
  });
});

describe('CustomViewPanel, Calendar', () => {
  it('shows the items on their dates in the view’s scale', () => {
    renderPanel({
      view: view({ layout: 'calendar', calendarFieldId: 'FLD_due', calendarScale: 'week' }),
      items: [item('a', 'Ship it', { FLD_due: date('2026-11-12') })]
    });
    expect(screen.getByText('Week of 2026-11-09')).toBeDefined();
    expect(within(screen.getByRole('gridcell', { name: '2026-11-12' })).getByText('Ship it')).toBeDefined();
  });

  it('keeps items with no date in the Unscheduled list', () => {
    renderPanel({
      view: view({ layout: 'calendar', calendarFieldId: 'FLD_due' }),
      items: [item('b', 'Plan release')]
    });
    expect(
      within(screen.getByRole('region', { name: 'Unscheduled' })).getByText('Plan release')
    ).toBeDefined();
  });
});
