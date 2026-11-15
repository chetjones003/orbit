import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../../../src/main/settings';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeStore(): Promise<{ store: SettingsStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-settings-'));
  dirs.push(dir);
  return { store: new SettingsStore(dir), dir };
}

describe('SettingsStore', () => {
  it('loads defaults and persists only supported preferences', async () => {
    const { store, dir } = await makeStore();
    expect(await store.load()).toMatchObject({ theme: 'dark', windowState: null, pinnedRepoIds: [] });
    const update = {
      pinnedRepoIds: [12, 12, -4],
      theme: 'light' as const,
      detailsWidth: 900,
      customViews: [{ id: 'view-1', name: 'Roadmap', projectId: 'PVT_1', layout: 'gantt' as const }],
      githubRepos: [{ id: 99, fullName: 'owner/secret-repo' }]
    };
    await store.update(update);
    await store.saveWindowState({ x: 20, y: 30, width: 1200, height: 800, maximized: false });
    expect(await store.load()).toMatchObject({
      pinnedRepoIds: [12],
      theme: 'light',
      customViews: [{ id: 'view-1', name: 'Roadmap', projectId: 'PVT_1', layout: 'gantt' }],
      windowState: { x: 20, y: 30, width: 1200, height: 800, maximized: false, detailsWidth: 600 }
    });
    const file = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(file).sort()).toEqual([
      'customViews',
      'pinnedRepoIds',
      'publicUploadNoticeAcknowledged',
      'theme',
      'windowState'
    ]);
  });

  it('ignores invalid settings and clamps the details width', async () => {
    const { store } = await makeStore();
    await store.update({ detailsWidth: 100 });
    expect((await store.load()).windowState?.detailsWidth).toBe(260);
  });
});

describe('SettingsStore public-upload notice', () => {
  it('starts unacknowledged and keeps the acknowledgement across restarts', async () => {
    const { store, dir } = await makeStore();
    expect((await store.load()).publicUploadNoticeAcknowledged).toBe(false);

    await store.acknowledgePublicUploadNotice();

    expect((await new SettingsStore(dir).load()).publicUploadNoticeAcknowledged).toBe(true);
  });
});

describe('SettingsStore notice acknowledgement is not client-updatable', () => {
  it('ignores the acknowledgement in a general settings update', async () => {
    const { store } = await makeStore();

    await store.update({ publicUploadNoticeAcknowledged: true } as Parameters<SettingsStore['update']>[0]);

    expect((await store.load()).publicUploadNoticeAcknowledged).toBe(false);
  });
});
