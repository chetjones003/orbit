import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { startFakeGitHub, type FakeGitHub } from '../fakes/github';

/**
 * Notifications against the unpacked build with GitHub replaced by the fake server.
 * The first poll is the quiet startup baseline; a later poll delivers one new mention.
 * Background polling runs every 60 seconds, so this flow waits for the second poll.
 */
const repoRoot = resolve(__dirname, '../..');
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
const mention = {
  id: '42',
  unread: true,
  reason: 'mention',
  updated_at: '2026-01-01T10:00:00Z',
  repository: { full_name: 'orbit-owner/app', owner: { login: 'orbit-owner' } },
  subject: {
    title: 'Fix the thing',
    type: 'Issue',
    url: 'https://api.github.com/repos/orbit-owner/app/issues/12'
  }
};

function fakeGitHub(): Promise<FakeGitHub> {
  let notificationPolls = 0;
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
      path: '/user/repos?type=owner&sort=updated&per_page=100&page=1',
      body: [repo],
      headers: { etag: '"v1"' }
    },
    {
      method: 'GET',
      path: '/notifications?participating=false',
      respond: () => {
        notificationPolls += 1;
        return { status: 200, body: notificationPolls === 1 ? [] : [mention] };
      }
    },
    { method: 'PATCH', path: '/notifications/threads/42', status: 205 }
  ]);
}

test.describe('notifications flow (unpacked build)', () => {
  test('quietly baselines at startup, then toasts a new mention and opens it in the repo view', async () => {
    test.setTimeout(150_000);
    const github = await fakeGitHub();
    const profile = mkdtempSync(join(tmpdir(), 'orbit-e2e-notify-'));
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
      await expect(window.getByRole('button', { name: 'Open orbit-owner/app' })).toBeVisible({
        timeout: 30_000
      });

      // The baseline poll found nothing unread, so no toast appears yet.
      await expect(window.getByText('Fix the thing')).toHaveCount(0);

      // Toasts show only while Orbit is focused, so the window is focused before the next poll.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());

      // The next background poll (about a minute later) delivers the mention as an in-app toast.
      const toast = window.getByRole('button', { name: /Mention: Fix the thing/ });
      await expect(toast).toBeVisible({ timeout: 120_000 });

      await toast.click();

      // Opening marks the thread read on GitHub and navigates to its repo.
      await expect
        .poll(() =>
          github.requests.some((r) => r.method === 'PATCH' && r.path === '/notifications/threads/42')
        )
        .toBe(true);
      await expect(window.getByRole('heading', { name: 'orbit-owner/app', level: 2 })).toBeVisible();
      await expect(toast).toHaveCount(0);
    } finally {
      await app.close();
      await github.close().catch(() => undefined);
    }
  });
});
