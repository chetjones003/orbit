import { afterEach, describe, expect, it } from 'vitest';
import { startFakeGitHub, type FakeGitHub } from '../fakes/github';
import { GitHubClient } from '../../src/main/github/github-client';
import { ProjectsService } from '../../src/main/github/projects-service';
import type { AuthService } from '../../src/main/github/auth-service';

/**
 * Real HTTP against a controlled GitHub stand-in. Every Projects call is a POST to /graphql, so the fake
 * answers by reading the query text. Routine runs never touch real GitHub or credentials.
 */
const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 3, login: 'orbit-owner', persistent: true };
const PROJECT = 'PVT_1';
const ITEM = 'PVTI_1';

let fake: FakeGitHub | undefined;

afterEach(async () => {
  await fake?.close().catch(() => undefined);
  fake = undefined;
});

function serviceFor(url: string): ProjectsService {
  const auth = {
    getStatus: () => SIGNED_IN,
    getAccessToken: async () => 'token'
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  return new ProjectsService({
    auth,
    apiBaseUrl: url,
    client: new GitHubClient({ apiBaseUrl: url })
  });
}

function item(optionId: string) {
  return {
    id: ITEM,
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
          optionId,
          name: optionId === 'done' ? 'Done' : 'Todo',
          field: { id: 'FLD_status' }
        }
      ]
    }
  };
}

/** Answers GraphQL by the operation it contains. `status` is the value GitHub holds right now. */
function graphqlRoute(options: {
  status: 'todo' | 'done';
  refuseWrites?: boolean;
  rateLimitWrites?: boolean;
}) {
  return {
    method: 'POST',
    path: '/graphql',
    respond: ({ body }: { body: string }) => {
      const { query } = JSON.parse(body) as { query: string };
      if (query.includes('viewer {')) {
        return {
          body: {
            data: {
              viewer: {
                projectsV2: {
                  totalCount: 1,
                  nodes: [
                    {
                      id: PROJECT,
                      number: 2,
                      title: 'Roadmap',
                      url: 'https://github.com/users/o/projects/2',
                      closed: false
                    }
                  ]
                }
              }
            }
          }
        };
      }
      if (query.includes('items(first:')) {
        return {
          body: {
            data: {
              node: {
                items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [item(options.status)] }
              }
            }
          }
        };
      }
      if (/(updateProjectV2ItemFieldValue|clearProjectV2ItemFieldValue)\(/.test(query)) {
        if (options.rateLimitWrites) {
          return {
            status: 403,
            headers: {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60)
            },
            body: { message: 'API rate limit exceeded' }
          };
        }
        if (options.refuseWrites) return { body: { errors: [{ message: 'Could not resolve to a node' }] } };
        return { body: { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: ITEM } } } } };
      }
      if (query.includes('... on ProjectV2Item')) {
        return { body: { data: { node: item(options.status) } } };
      }
      return { body: { data: {} } };
    }
  };
}

describe('projects over HTTP', () => {
  it('lists projects and applies a saved view’s filter through the GraphQL request', async () => {
    fake = await startFakeGitHub([graphqlRoute({ status: 'todo' })]);
    const service = serviceFor(fake.url);
    await expect(service.listProjects()).resolves.toEqual({
      partial: false,
      projects: [
        {
          id: PROJECT,
          number: 2,
          title: 'Roadmap',
          url: 'https://github.com/users/o/projects/2',
          closed: false
        }
      ]
    });
    const page = await service.listItems(PROJECT, 'assignee:@me');
    expect(page.items[0]).toMatchObject({ id: ITEM, title: 'Fix crash', kind: 'issue' });
    const sent = fake.received.find((r) => r.body.includes('items(first:'));
    expect(JSON.parse(sent?.body ?? '{}').variables.query).toBe('assignee:@me');
    expect(fake.received.every((r) => r.method === 'POST' && r.path === '/graphql')).toBe(true);
  });

  it('saves a single-select change and returns GitHub’s stored value', async () => {
    fake = await startFakeGitHub([graphqlRoute({ status: 'done' })]);
    const result = await serviceFor(fake.url).setFieldValue(PROJECT, ITEM, {
      fieldId: 'FLD_status',
      value: { kind: 'single-select', optionId: 'done' }
    });
    expect(result).toMatchObject({
      kind: 'saved',
      item: { id: ITEM, fieldValues: { FLD_status: { optionId: 'done', name: 'Done' } } }
    });
  });

  it('reports a refused save with the value GitHub still holds', async () => {
    fake = await startFakeGitHub([graphqlRoute({ status: 'todo', refuseWrites: true })]);
    const result = await serviceFor(fake.url).setFieldValue(PROJECT, ITEM, {
      fieldId: 'FLD_status',
      value: { kind: 'single-select', optionId: 'done' }
    });
    expect(result).toMatchObject({
      kind: 'failed',
      message: 'GitHub refused the project request.',
      item: { id: ITEM, fieldValues: { FLD_status: { optionId: 'todo' } } }
    });
  });

  it('reports a rate-limited save and reads back what GitHub stores', async () => {
    fake = await startFakeGitHub([graphqlRoute({ status: 'todo', rateLimitWrites: true })]);
    const result = await serviceFor(fake.url).setFieldValue(PROJECT, ITEM, {
      fieldId: 'FLD_status',
      value: null
    });
    expect(result).toMatchObject({
      kind: 'failed',
      message: 'GitHub rate limit reached.',
      item: { id: ITEM, fieldValues: { FLD_status: { optionId: 'todo' } } }
    });
  });
});
