import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { startFakeGitHub, type FakeGitHub } from '../fakes/github';

/**
 * Projects against the unpacked build, with GitHub replaced by the controlled fake. Covers opening a
 * board saved view and moving a card to another Status column, which must reach GitHub.
 */
const repoRoot = resolve(__dirname, '../..');
const REPOS_PATH = '/user/repos?type=owner&sort=updated&per_page=100&page=1';
const repo = {
  id: 1,
  name: 'app',
  full_name: 'orbit-owner/app',
  description: 'Fixture repository',
  private: false,
  fork: false,
  archived: false,
  default_branch: 'main',
  updated_at: '2026-01-01T00:00:00Z',
  html_url: 'https://github.com/orbit-owner/app',
  owner: { login: 'orbit-owner' }
};

const PROJECT = {
  id: 'PVT_1',
  number: 2,
  title: 'Roadmap',
  url: 'https://github.com/users/orbit-owner/projects/2',
  closed: false
};
const STATUS_FIELD = {
  __typename: 'ProjectV2SingleSelectField',
  id: 'FLD_status',
  name: 'Status',
  dataType: 'SINGLE_SELECT',
  options: [
    { id: 'todo', name: 'Todo', color: 'GRAY' },
    { id: 'done', name: 'Done', color: 'GREEN' }
  ]
};

/** A GitHub project whose one item is stored in `state`, so a write changes what the next read returns. */
function projectsFake(state: { status: 'todo' | 'done' }): Parameters<typeof startFakeGitHub>[0] {
  const item = () => ({
    id: 'PVTI_1',
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
          optionId: state.status,
          name: state.status === 'done' ? 'Done' : 'Todo',
          field: { id: 'FLD_status' }
        }
      ]
    }
  });
  return [
    {
      method: 'POST',
      path: '/graphql',
      respond: ({ body }) => {
        const { query, variables } = JSON.parse(body) as { query: string; variables: Record<string, unknown> };
        if (query.includes('viewer {')) {
          return { body: { data: { viewer: { projectsV2: { totalCount: 1, nodes: [PROJECT] } } } } };
        }
        if (query.includes('views(first')) {
          return {
            body: {
              data: {
                node: {
                  ...PROJECT,
                  fields: { nodes: [STATUS_FIELD] },
                  views: {
                    nodes: [
                      {
                        id: 'V_1',
                        number: 1,
                        name: 'Backlog',
                        layout: 'BOARD_LAYOUT',
                        filter: '',
                        groupByFields: { nodes: [{ id: 'FLD_status', name: 'Status', dataType: 'SINGLE_SELECT' }] }
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
                node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [item()] } }
              }
            }
          };
        }
        if (query.includes('updateProjectV2ItemFieldValue(')) {
          const optionId = (variables['value'] as { singleSelectOptionId: string }).singleSelectOptionId;
          state.status = optionId === 'done' ? 'done' : 'todo';
          return { body: { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_1' } } } } };
        }
        if (query.includes('... on ProjectV2Item')) return { body: { data: { node: item() } } };
        return { body: { data: {} } };
      }
    }
  ];
}

function fakeGitHub(state: { status: 'todo' | 'done' }): Promise<FakeGitHub> {
  return startFakeGitHub([
    {
      method: 'POST',
      path: '/login/device/code',
      body: {
        device_code: 'device-1',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 1
      }
    },
    {
      method: 'POST',
      path: '/login/oauth/access_token',
      body: {
        access_token: 'gho_fixture',
        refresh_token: 'ghr_fixture',
        expires_in: 28800,
        refresh_token_expires_in: 15811200
      }
    },
    { method: 'GET', path: '/user', body: { login: 'orbit-owner' } },
    {
      method: 'GET',
      path: REPOS_PATH,
      respond: (req) =>
        req.headers['if-none-match'] === '"v1"'
          ? { status: 304 }
          : { status: 200, body: [repo], headers: { etag: '"v1"' } }
    },
    ...projectsFake(state)
  ]);
}

test.describe('projects flow (unpacked build)', () => {
  test('moves a card to another Status column on a board and saves it to GitHub', async () => {
    const state: { status: 'todo' | 'done' } = { status: 'todo' };
    const github = await fakeGitHub(state);
    const profile = mkdtempSync(join(tmpdir(), 'orbit-e2e-projects-'));
    const { ELECTRON_RUN_AS_NODE: _ignored, ...inherited } = process.env;
    const app = await electron.launch({
      args: ['.'],
      cwd: repoRoot,
      env: { ...inherited, ORBIT_USER_DATA: profile, ORBIT_GITHUB_URL: github.url }
    });
    try {
      const window = await app.firstWindow();
      await expect(window.locator('html')).toHaveAttribute('data-orbit-ready', 'true');

      await window.getByRole('button', { name: 'Sign in with GitHub' }).click();
      await expect(window.getByText('ABCD-1234')).toBeVisible();
      await expect(window.getByRole('button', { name: 'Open orbit-owner/app' })).toBeVisible({
        timeout: 30_000
      });

      await window.getByRole('button', { name: 'Projects' }).click();
      await window.getByRole('button', { name: 'Roadmap' }).click();
      await window.getByRole('tab', { name: /Backlog/ }).click();

      const todo = window.getByRole('listitem', { name: /^Todo,/ });
      const done = window.getByRole('listitem', { name: /^Done,/ });
      const card = todo.locator('article').filter({ hasText: 'Fix crash' });
      await expect(card).toBeVisible();

      await card.dragTo(done);
      await expect(done.locator('article').filter({ hasText: 'Fix crash' })).toBeVisible();
      await expect.poll(() => state.status, { timeout: 15_000 }).toBe('done');
      await expect(window.getByRole('alert')).toHaveCount(0);

      await window.screenshot({ path: join(profile, 'projects.png') });
      console.log(`PROJECTS_SCREENSHOT=${join(profile, 'projects.png')}`);
    } finally {
      await app.close();
      await github.close();
    }
  });
});
