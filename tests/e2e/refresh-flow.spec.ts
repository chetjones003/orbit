import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { startFakeGitHub, type FakeGitHub } from '../fakes/github';

/**
 * Critical signed-in flow against the unpacked build, with GitHub replaced by the
 * controlled fake server. Nothing touches github.com or real credentials.
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
    }
  ]);
}

test.describe('signed-in refresh flow (unpacked build)', () => {
  test('signs in, lists repos, keeps them visible while offline, and honours the refresh cooldown', async () => {
    const github = await fakeGitHub();
    const profile = mkdtempSync(join(tmpdir(), 'orbit-e2e-'));
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

      // GitHub becomes unreachable. The loaded repos must stay visible.
      await github.close();
      await window.getByRole('button', { name: 'Refresh repositories' }).click();
      await expect(window.getByText(/^Offline\./)).toBeVisible();
      await expect(window.getByRole('button', { name: 'Open orbit-owner/app' })).toBeVisible();
      await expect(window.getByText('Changes are paused until GitHub is reachable again.')).toBeVisible();

      // A second manual refresh inside the cooldown is explained, not silently ignored.
      await window.getByRole('button', { name: 'Refresh repositories' }).click();
      await expect(window.getByText('Refresh is cooling down. Try again in a moment.')).toBeVisible();
    } finally {
      await app.close();
      await github.close().catch(() => undefined);
    }
  });
});
