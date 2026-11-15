// Saved custom views for the fake projects, so every layout is on screen when the fake app starts: Kanban,
// table, Gantt, and calendar over each project. They are Orbit's own definitions (stored in settings), seeded
// into the fake profile by launch.mjs when they are not there yet. Field ids match data.mjs.

const BASE_VIEW = {
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
};

/** The definitions for one fake project, with ids that stay the same across launches. */
function viewsFor(projectNumber, slug) {
  const projectId = `PVT_${projectNumber}`;
  const id = (layout) => `demo-${slug}-${layout}`;
  return [
    {
      ...BASE_VIEW,
      id: id('kanban'),
      name: 'Demo: Kanban',
      projectId,
      layout: 'kanban',
      columnFieldId: 'PVTSSF_status',
      swimlaneFieldId: 'PVTSSF_priority',
      sort: { fieldId: 'PVTF_estimate', direction: 'desc' }
    },
    {
      ...BASE_VIEW,
      id: id('table'),
      name: 'Demo: Table',
      projectId,
      layout: 'table',
      groupFieldId: 'PVTSSF_status',
      sort: { fieldId: 'PVTF_estimate', direction: 'asc' }
    },
    {
      ...BASE_VIEW,
      id: id('gantt'),
      name: 'Demo: Gantt',
      projectId,
      layout: 'gantt',
      ganttSource: 'dates',
      startFieldId: 'PVTF_start',
      targetFieldId: 'PVTF_target'
    },
    {
      ...BASE_VIEW,
      id: id('calendar'),
      name: 'Demo: Calendar',
      projectId,
      layout: 'calendar',
      calendarFieldId: 'PVTF_target',
      calendarScale: 'month'
    }
  ];
}

/** Every demo view, for both fake projects. */
export const DEMO_CUSTOM_VIEWS = [...viewsFor(1, 'atlas'), ...viewsFor(2, 'notes')];
