import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { startFakeGitHub, type FakeGitHub } from '../fakes/github';
import { buildInboxSearchQuery } from '../../src/main/github/inbox-service';

/**
 * The inbox against the unpacked build, with GitHub replaced by the controlled fake.
 * Covers a populated tab, opening an item in the details panel, and a rate-limited tab
 * that must show an error rather than an empty list.
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

function searchPath(tab: 'my-open-prs' | 'assigned', page = 1): string {
  const query = buildInboxSearchQuery(tab, 'orbit-owner');
  return `/search/issues?${new URLSearchParams({
    q: query,
    sort: 'updated',
    order: 'desc',
    per_page: '30',
    page: String(page)
  }).toString()}`;
}

function fakeGitHub(): Promise<FakeGitHub> {
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
    {
      method: 'GET',
      path: searchPath('my-open-prs'),
      body: {
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            id: 901,
            number: 42,
            title: 'Fixture pull for the inbox',
            state: 'open',
            user: { login: 'orbit-owner' },
            labels: [{ name: 'inbox', color: '0075ca' }],
            comments: 3,
            updated_at: '2026-03-01T10:00:00Z',
            html_url: 'https://github.com/orbit-owner/app/pull/42',
            repository_url: 'https://api.github.com/repos/orbit-owner/app',
            draft: false,
            pull_request: { url: 'https://api.github.com/repos/orbit-owner/app/pulls/42' }
          }
        ]
      }
    },
    {
      method: 'GET',
      path: searchPath('assigned'),
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' },
      body: { message: 'API rate limit exceeded' }
    }
  ]);
}

test.describe('inbox flow (unpacked build)', () => {
  test('lists a tab, opens an item in the details panel, and labels a rate-limited tab as an error', async () => {
    const github = await fakeGitHub();
    const profile = mkdtempSync(join(tmpdir(), 'orbit-e2e-inbox-'));
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

      await window.getByRole('button', { name: 'Inbox' }).click();
      const row = window.getByRole('button', { name: /Fixture pull for the inbox/ });
      await expect(row).toBeVisible();
      await expect(row).toContainText('orbit-owner/app#42');
      await expect(row).toContainText('Pull request');

      await row.click();
      // Inbox rows open in the side panel by default, like any other pick.
      await expect(window.locator('.item-side-slot .item-side-panel')).toBeVisible();

      await window.getByRole('tab', { name: 'Assigned to me' }).click();
      const inbox = window.getByRole('region', { name: 'Inbox' });
      await expect(inbox.getByRole('alert')).toContainText('rate limit');
      await expect(inbox.getByText('Nothing needs your attention in this tab.')).toHaveCount(0);

      await window.screenshot({ path: join(profile, 'inbox.png') });
      console.log(`INBOX_SCREENSHOT=${join(profile, 'inbox.png')}`);
    } finally {
      await app.close();
      await github.close();
    }
  });
});
