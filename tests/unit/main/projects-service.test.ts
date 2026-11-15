import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { ProjectsService } from '../../../src/main/github/projects-service';
import { GitHubClient } from '../../../src/main/github/github-client';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 7, login: 'orbit-owner', persistent: true };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Answer = unknown | Response;
interface Sent {
  query: string;
  variables: Record<string, unknown>;
}

/**
 * A fake GitHub GraphQL endpoint. `answer` receives each request and returns the `data` object, or a
 * Response to send as-is. Every request is recorded so tests can check variables and request counts.
 */
function fakeGitHub(answer: (query: string, variables: Record<string, unknown>) => Answer) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (!url.endsWith('/graphql')) return json({}, 404);
    const body = JSON.parse(String(init.body)) as Sent;
    sent.push({ query: body.query, variables: body.variables });
    const result = answer(body.query, body.variables);
    return result instanceof Response ? result : json({ data: result });
  });
  const writes = (name: string) => sent.filter((s) => s.query.includes(`${name}(`));
  return { fetch, sent, writes };
}

function service(
  gh: ReturnType<typeof fakeGitHub>,
  options: { canWrite?: () => boolean; status?: unknown } = {}
): ProjectsService {
  const auth = {
    getStatus: () => options.status ?? SIGNED_IN,
    getAccessToken: async () => 'token'
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  const client = new GitHubClient({
    apiBaseUrl: 'https://api.test',
    fetch: gh.fetch as unknown as typeof fetch
  });
  return new ProjectsService({ auth, apiBaseUrl: 'https://api.test', client, canWrite: options.canWrite });
}

const PROJECT_ID = 'PVT_1';
const ITEM_ID = 'PVTI_1';
const STATUS = {
  __typename: 'ProjectV2SingleSelectField',
  id: 'FLD_status',
  name: 'Status',
  dataType: 'SINGLE_SELECT',
  options: [
    { id: 'opt_todo', name: 'Todo', color: 'GRAY' },
    { id: 'opt_done', name: 'Done', color: 'GREEN' }
  ]
};
const ESTIMATE = { __typename: 'ProjectV2Field', id: 'FLD_est', name: 'Estimate', dataType: 'NUMBER' };
const SPRINT = {
  __typename: 'ProjectV2IterationField',
  id: 'FLD_sprint',
  name: 'Sprint',
  dataType: 'ITERATION',
  configuration: { iterations: [{ id: 'it_1', title: 'Sprint 1', startDate: '2026-01-05', duration: 14 }] }
};
const TITLE = { __typename: 'ProjectV2Field', id: 'FLD_title', name: 'Title', dataType: 'TITLE' };
const MULTI = {
  __typename: 'ProjectV2MultiSelectField',
  id: 'FLD_multi',
  name: 'Tags',
  dataType: 'MULTI_SELECT'
};

function issueItem(status = 'opt_todo', overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    type: 'ISSUE',
    content: {
      __typename: 'Issue',
      id: 'I_12',
      number: 12,
      title: 'Fix crash',
      url: 'https://github.com/orbit-owner/app/issues/12',
      state: 'OPEN',
      repository: { nameWithOwner: 'orbit-owner/app' }
    },
    fieldValues: {
      nodes: [
        {
          __typename: 'ProjectV2ItemFieldSingleSelectValue',
          optionId: status,
          name: status === 'opt_done' ? 'Done' : 'Todo',
          field: { id: 'FLD_status' }
        },
        { __typename: 'ProjectV2ItemFieldNumberValue', number: 3, field: { id: 'FLD_est' } },
        { __typename: 'ProjectV2ItemFieldTextValue', text: 'Fix crash', field: { id: 'FLD_title' } },
        {
          __typename: 'ProjectV2ItemFieldIterationValue',
          iterationId: 'it_1',
          title: 'Sprint 1',
          startDate: '2026-01-05',
          duration: 14,
          field: { id: 'FLD_sprint' }
        }
      ]
    },
    ...overrides
  };
}

/** The query that GitHub would answer for a single item read. */
const isItemRead = (q: string) => q.includes('... on ProjectV2Item');

describe('ProjectsService reads', () => {
  it('lists the owner’s projects with their open state', async () => {
    const gh = fakeGitHub((q) =>
      q.includes('viewer {')
        ? {
            viewer: {
              projectsV2: {
                totalCount: 2,
                nodes: [
                  {
                    id: PROJECT_ID,
                    number: 2,
                    title: 'Roadmap',
                    url: 'https://github.com/users/o/projects/2',
                    closed: false
                  },
                  {
                    id: 'PVT_2',
                    number: 1,
                    title: 'Old',
                    url: 'https://github.com/users/o/projects/1',
                    closed: true
                  }
                ]
              }
            }
          }
        : {}
    );
    await expect(service(gh).listProjects()).resolves.toEqual({
      partial: false,
      projects: [
        {
          id: PROJECT_ID,
          number: 2,
          title: 'Roadmap',
          url: 'https://github.com/users/o/projects/2',
          closed: false
        },
        { id: 'PVT_2', number: 1, title: 'Old', url: 'https://github.com/users/o/projects/1', closed: true }
      ]
    });
  });

  it('reads custom fields and keeps only table and board saved views', async () => {
    const gh = fakeGitHub((q) =>
      q.includes('views(first')
        ? {
            node: {
              id: PROJECT_ID,
              number: 2,
              title: 'Roadmap',
              url: 'https://github.com/users/o/projects/2',
              closed: false,
              fields: { nodes: [TITLE, STATUS, ESTIMATE, SPRINT, MULTI] },
              views: {
                nodes: [
                  {
                    id: 'V_1',
                    number: 1,
                    name: 'Backlog',
                    layout: 'BOARD_LAYOUT',
                    filter: '',
                    groupByFields: { nodes: [{ id: 'FLD_status' }] }
                  },
                  {
                    id: 'V_2',
                    number: 2,
                    name: 'Mine',
                    layout: 'TABLE_LAYOUT',
                    filter: 'assignee:@me',
                    groupByFields: { nodes: [] }
                  },
                  {
                    id: 'V_3',
                    number: 3,
                    name: 'Plan',
                    layout: 'ROADMAP_LAYOUT',
                    filter: null,
                    groupByFields: { nodes: [] }
                  },
                  {
                    id: 'V_4',
                    number: 4,
                    name: 'Null filter',
                    layout: 'BOARD_LAYOUT',
                    filter: null,
                    groupByFields: { nodes: [] }
                  }
                ]
              }
            }
          }
        : {}
    );
    const detail = await service(gh).getProject(PROJECT_ID);
    // Built-in (TITLE) and multi-select fields are not offered for editing.
    expect(detail.fields).toEqual([
      {
        id: 'FLD_status',
        name: 'Status',
        kind: 'single-select',
        options: [
          { id: 'opt_todo', name: 'Todo', color: 'GRAY' },
          { id: 'opt_done', name: 'Done', color: 'GREEN' }
        ]
      },
      { id: 'FLD_est', name: 'Estimate', kind: 'number' },
      {
        id: 'FLD_sprint',
        name: 'Sprint',
        kind: 'iteration',
        iterations: [{ id: 'it_1', title: 'Sprint 1', startDate: '2026-01-05', duration: 14 }]
      }
    ]);
    expect(detail.views).toEqual([
      { id: 'V_1', number: 1, name: 'Backlog', layout: 'board', filter: '', groupByFieldId: 'FLD_status' },
      { id: 'V_2', number: 2, name: 'Mine', layout: 'table', filter: 'assignee:@me', groupByFieldId: null },
      { id: 'V_4', number: 4, name: 'Null filter', layout: 'board', filter: '', groupByFieldId: null }
    ]);
  });

  it('applies a saved view’s filter through items(query:) and maps every item kind', async () => {
    const gh = fakeGitHub((q, vars) => {
      if (!q.includes('items(first:')) return {};
      expect(vars['query']).toBe('assignee:@me');
      return {
        node: {
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              issueItem(),
              {
                id: 'PVTI_2',
                type: 'PULL_REQUEST',
                content: {
                  __typename: 'PullRequest',
                  id: 'PR_3',
                  number: 3,
                  title: 'Add projects',
                  url: 'https://github.com/orbit-owner/app/pull/3',
                  state: 'MERGED',
                  isDraft: false,
                  repository: { nameWithOwner: 'orbit-owner/app' }
                },
                fieldValues: { nodes: [] }
              },
              {
                id: 'PVTI_3',
                type: 'DRAFT_ISSUE',
                content: { __typename: 'DraftIssue', id: 'DI_1', title: 'Think about it' },
                fieldValues: { nodes: [] }
              },
              { id: 'PVTI_4', type: 'REDACTED', content: null, fieldValues: { nodes: [] } }
            ]
          }
        }
      };
    });
    const page = await service(gh).listItems(PROJECT_ID, 'assignee:@me');
    expect(page.partial).toBe(true);
    expect(page.items.map((i) => [i.kind, i.id, i.state])).toEqual([
      ['issue', ITEM_ID, 'open'],
      ['pull', 'PVTI_2', 'merged'],
      ['draft', 'PVTI_3', 'open']
    ]);
    expect(page.items[0]).toEqual({
      id: ITEM_ID,
      kind: 'issue',
      contentId: 'I_12',
      repoFullName: 'orbit-owner/app',
      number: 12,
      title: 'Fix crash',
      htmlUrl: 'https://github.com/orbit-owner/app/issues/12',
      state: 'open',
      isDraft: false,
      fieldValues: {
        FLD_status: { kind: 'single-select', optionId: 'opt_todo', name: 'Todo' },
        FLD_est: { kind: 'number', number: 3 },
        FLD_title: { kind: 'text', text: 'Fix crash' },
        FLD_sprint: {
          kind: 'iteration',
          iterationId: 'it_1',
          title: 'Sprint 1',
          startDate: '2026-01-05',
          duration: 14
        }
      }
    });
  });

  it('follows item pages until GitHub reports the last one', async () => {
    const cursors: unknown[] = [];
    const gh = fakeGitHub((q, vars) => {
      if (!q.includes('items(first:')) return {};
      cursors.push(vars['cursor']);
      const first = vars['cursor'] === null;
      return {
        node: {
          items: {
            pageInfo: { hasNextPage: first, endCursor: first ? 'C1' : null },
            nodes: [issueItem(undefined, { id: first ? 'PVTI_A' : 'PVTI_B' })]
          }
        }
      };
    });
    const page = await service(gh).listItems(PROJECT_ID, '');
    expect(cursors).toEqual([null, 'C1']);
    expect(page.items.map((i) => i.id)).toEqual(['PVTI_A', 'PVTI_B']);
    expect(page.partial).toBe(false);
    // An empty filter is sent as null, which GitHub reads as no filter.
    expect(gh.sent[0]?.variables['query']).toBeNull();
  });

  it('reports an issue’s project memberships and its node id', async () => {
    const gh = fakeGitHub((q) =>
      q.includes('projectItems(first')
        ? {
            repository: {
              issueOrPullRequest: {
                __typename: 'Issue',
                id: 'I_12',
                projectItems: {
                  totalCount: 1,
                  nodes: [
                    {
                      ...issueItem(),
                      project: {
                        id: PROJECT_ID,
                        number: 2,
                        title: 'Roadmap',
                        url: 'https://github.com/users/o/projects/2',
                        closed: false
                      }
                    }
                  ]
                }
              }
            }
          }
        : {}
    );
    const found = await service(gh).getItemMemberships('orbit-owner/app', 12);
    expect(found.contentId).toBe('I_12');
    expect(found.partial).toBe(false);
    expect(found.memberships).toHaveLength(1);
    expect(found.memberships[0]?.project.title).toBe('Roadmap');
    expect(found.memberships[0]?.item.id).toBe(ITEM_ID);
  });

  it('refuses a signed-out caller before sending a request', async () => {
    const gh = fakeGitHub(() => ({}));
    await expect(service(gh, { status: { kind: 'signed-out' } }).listProjects()).rejects.toThrow(
      'Sign in to GitHub to load projects.'
    );
    expect(gh.sent).toHaveLength(0);
  });

  it('turns a GraphQL error into a refusal', async () => {
    const gh = fakeGitHub(
      () => new Response(JSON.stringify({ errors: [{ message: 'nope' }] }), { status: 200 })
    );
    await expect(service(gh).listProjects()).rejects.toThrow('GitHub refused the project request.');
  });

  it('rejects malformed ids and repos before any request', async () => {
    const gh = fakeGitHub(() => ({}));
    const svc = service(gh);
    await expect(svc.getProject('')).rejects.toThrow('not valid');
    await expect(svc.getProject('bad id')).rejects.toThrow('not valid');
    await expect(svc.getItemMemberships('no-slash', 1)).rejects.toThrow('owner/name');
    await expect(svc.getItemMemberships('orbit-owner/app', 0)).rejects.toThrow('issue number');
    expect(gh.sent).toHaveLength(0);
  });
});

describe('ProjectsService writes', () => {
  it('adds an issue from a personal repo and returns the new item', async () => {
    const gh = fakeGitHub((q) => {
      if (q.includes('... on Issue { id }'))
        return { repository: { issueOrPullRequest: { __typename: 'Issue', id: 'I_12' } } };
      if (q.includes('addProjectV2ItemById(')) return { addProjectV2ItemById: { item: { id: ITEM_ID } } };
      if (isItemRead(q)) return { node: issueItem() };
      return {};
    });
    const item = await service(gh).addItem(PROJECT_ID, 'orbit-owner/app', 12);
    expect(item.id).toBe(ITEM_ID);
    expect(gh.writes('addProjectV2ItemById')[0]?.variables).toEqual({
      projectId: PROJECT_ID,
      contentId: 'I_12'
    });
  });

  it('refuses to add an item from another owner’s repo', async () => {
    const gh = fakeGitHub(() => ({}));
    await expect(service(gh).addItem(PROJECT_ID, 'someone-else/app', 12)).rejects.toThrow(
      'Only personal repos'
    );
    expect(gh.sent).toHaveLength(0);
  });

  it('does not add an item twice when the first attempt’s outcome is unknown', async () => {
    let addAttempts = 0;
    const gh = fakeGitHub((q) => {
      if (q.includes('... on Issue { id }'))
        return { repository: { issueOrPullRequest: { __typename: 'Issue', id: 'I_12' } } };
      if (q.includes('addProjectV2ItemById(')) {
        addAttempts++;
        return new Response('{}', { status: 502 });
      }
      if (q.includes('projectItems(first')) {
        // GitHub did add the item before the connection failed.
        return {
          repository: {
            issueOrPullRequest: {
              __typename: 'Issue',
              id: 'I_12',
              projectItems: {
                totalCount: 1,
                nodes: [
                  {
                    ...issueItem(),
                    project: { id: PROJECT_ID, number: 2, title: 'R', url: 'u', closed: false }
                  }
                ]
              }
            }
          }
        };
      }
      if (isItemRead(q)) return { node: issueItem() };
      return {};
    });
    const item = await service(gh).addItem(PROJECT_ID, 'orbit-owner/app', 12);
    expect(addAttempts).toBe(1);
    expect(item.id).toBe(ITEM_ID);
  });

  it('removes an item from its project', async () => {
    const gh = fakeGitHub((q) =>
      q.includes('deleteProjectV2Item(') ? { deleteProjectV2Item: { deletedItemId: ITEM_ID } } : {}
    );
    await service(gh).removeItem(PROJECT_ID, ITEM_ID);
    expect(gh.writes('deleteProjectV2Item')[0]?.variables).toEqual({
      projectId: PROJECT_ID,
      itemId: ITEM_ID
    });
  });

  it('saves a single-select change and returns GitHub’s version of the item', async () => {
    const gh = fakeGitHub((q) => {
      if (q.includes('updateProjectV2ItemFieldValue('))
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: ITEM_ID } } };
      if (isItemRead(q)) return { node: issueItem('opt_done') };
      return {};
    });
    const result = await service(gh).setFieldValue(PROJECT_ID, ITEM_ID, {
      fieldId: 'FLD_status',
      value: { kind: 'single-select', optionId: 'opt_done' }
    });
    expect(gh.writes('updateProjectV2ItemFieldValue')[0]?.variables).toEqual({
      projectId: PROJECT_ID,
      itemId: ITEM_ID,
      fieldId: 'FLD_status',
      value: { singleSelectOptionId: 'opt_done' }
    });
    expect(result.kind).toBe('saved');
    if (result.kind === 'saved')
      expect(result.item.fieldValues['FLD_status']).toEqual({
        kind: 'single-select',
        optionId: 'opt_done',
        name: 'Done'
      });
  });

  it('sends each field type in its own GitHub input shape', async () => {
    const inputs: Array<[unknown, Record<string, unknown>]> = [
      [{ kind: 'iteration', iterationId: 'it_1' }, { iterationId: 'it_1' }],
      [{ kind: 'text', text: 'hello' }, { text: 'hello' }],
      [{ kind: 'number', number: 5 }, { number: 5 }],
      [{ kind: 'date', date: '2026-02-01' }, { date: '2026-02-01' }]
    ];
    for (const [value, expected] of inputs) {
      const gh = fakeGitHub((q) => {
        if (q.includes('updateProjectV2ItemFieldValue('))
          return { updateProjectV2ItemFieldValue: { projectV2Item: { id: ITEM_ID } } };
        if (isItemRead(q)) return { node: issueItem() };
        return {};
      });
      await service(gh).setFieldValue(PROJECT_ID, ITEM_ID, { fieldId: 'FLD', value: value as never });
      expect(gh.writes('updateProjectV2ItemFieldValue')[0]?.variables['value']).toEqual(expected);
    }
  });

  it('clears a field when the value is null', async () => {
    const gh = fakeGitHub((q) => {
      if (q.includes('clearProjectV2ItemFieldValue('))
        return { clearProjectV2ItemFieldValue: { projectV2Item: { id: ITEM_ID } } };
      if (isItemRead(q)) return { node: issueItem() };
      return {};
    });
    await service(gh).setFieldValue(PROJECT_ID, ITEM_ID, { fieldId: 'FLD_est', value: null });
    expect(gh.writes('clearProjectV2ItemFieldValue')[0]?.variables).toEqual({
      projectId: PROJECT_ID,
      itemId: ITEM_ID,
      fieldId: 'FLD_est'
    });
    expect(gh.writes('updateProjectV2ItemFieldValue')).toHaveLength(0);
  });

  it('reports a refused save with GitHub’s version of the item', async () => {
    const gh = fakeGitHub((q) => {
      if (q.includes('updateProjectV2ItemFieldValue('))
        return new Response(JSON.stringify({ errors: [{ message: 'x' }] }), { status: 200 });
      if (isItemRead(q)) return { node: issueItem('opt_todo') };
      return {};
    });
    const result = await service(gh).setFieldValue(PROJECT_ID, ITEM_ID, {
      fieldId: 'FLD_status',
      value: { kind: 'single-select', optionId: 'opt_done' }
    });
    expect(result).toEqual({
      kind: 'failed',
      message: 'GitHub refused the project request.',
      item: expect.objectContaining({
        id: ITEM_ID,
        fieldValues: expect.objectContaining({
          FLD_status: { kind: 'single-select', optionId: 'opt_todo', name: 'Todo' }
        })
      })
    });
  });

  it('does not write a second copy when a transient save outcome is confirmed on GitHub', async () => {
    let writes = 0;
    const gh = fakeGitHub((q) => {
      if (q.includes('updateProjectV2ItemFieldValue(')) {
        writes++;
        return new Response('{}', { status: 503 });
      }
      // The save landed before the connection failed.
      if (isItemRead(q)) return { node: issueItem('opt_done') };
      return {};
    });
    const result = await service(gh).setFieldValue(PROJECT_ID, ITEM_ID, {
      fieldId: 'FLD_status',
      value: { kind: 'single-select', optionId: 'opt_done' }
    });
    expect(writes).toBe(1);
    expect(result.kind).toBe('saved');
  });

  it('allows one pending edit per item and reports the second as busy', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gh = fakeGitHub((q) => {
      if (q.includes('updateProjectV2ItemFieldValue('))
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: ITEM_ID } } };
      if (isItemRead(q)) return { node: issueItem() };
      return {};
    });
    const originalFetch = gh.fetch;
    const gated = vi.fn(async (url: string, init: RequestInit) => {
      if (String(init.body).includes('updateProjectV2ItemFieldValue(')) await gate;
      return originalFetch(url, init);
    });
    const svc = service({ ...gh, fetch: gated } as unknown as ReturnType<typeof fakeGitHub>);
    const first = svc.setFieldValue(PROJECT_ID, ITEM_ID, {
      fieldId: 'FLD_status',
      value: { kind: 'single-select', optionId: 'opt_done' }
    });
    await vi.waitFor(() => expect(gated).toHaveBeenCalled());
    const second = await svc.setFieldValue(PROJECT_ID, ITEM_ID, { fieldId: 'FLD_est', value: null });
    expect(second).toEqual({ kind: 'busy' });
    release?.();
    expect((await first).kind).toBe('saved');
  });

  it('refuses a write while GitHub is unreachable, without sending it', async () => {
    const gh = fakeGitHub((q) => (isItemRead(q) ? { node: issueItem() } : {}));
    const result = await service(gh, { canWrite: () => false }).setFieldValue(PROJECT_ID, ITEM_ID, {
      fieldId: 'FLD_est',
      value: null
    });
    expect(result).toEqual({
      kind: 'failed',
      item: expect.objectContaining({ id: ITEM_ID }),
      message: 'Changes are paused until GitHub is reachable again.'
    });
    expect(gh.writes('clearProjectV2ItemFieldValue')).toHaveLength(0);
  });

  it('reports a save as saved when only the read-back after the write fails', async () => {
    let reads = 0;
    const gh = fakeGitHub((q) => {
      if (q.includes('updateProjectV2ItemFieldValue('))
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: ITEM_ID } } };
      if (isItemRead(q)) {
        reads++;
        // The first read after the write fails; the next one succeeds and shows the saved value.
        if (reads === 1) return new Response('{}', { status: 502 });
        return { node: issueItem('opt_done') };
      }
      return {};
    });
    const result = await service(gh).setFieldValue(PROJECT_ID, ITEM_ID, {
      fieldId: 'FLD_status',
      value: { kind: 'single-select', optionId: 'opt_done' }
    });
    expect(gh.writes('updateProjectV2ItemFieldValue')).toHaveLength(1);
    expect(result.kind).toBe('saved');
  });
});
