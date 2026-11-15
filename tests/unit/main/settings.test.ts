import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../../../src/main/settings';
import type { CustomViewDefinition } from '../../../src/shared/custom-views';

const CUSTOM_VIEW: CustomViewDefinition = {
  id: 'view-1',
  name: 'Sprint board',
  projectId: 'PVT_1',
  layout: 'kanban',
  advancedFilter: '',
  conditions: [],
  sort: null,
  groupFieldId: null,
  columnFieldId: 'FLD_status',
  swimlaneFieldId: null,
  ganttSource: 'dates',
  startFieldId: null,
  targetFieldId: null,
  iterationFieldId: null,
  calendarFieldId: null,
  calendarScale: 'month'
};

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
    expect(await store.load()).toMatchObject({
      colorScheme: 'dark',
      palette: 'orbit',
      windowState: null,
      pinnedRepoIds: []
    });
    const update = {
      pinnedRepoIds: [12, 12, -4],
      colorScheme: 'light' as const,
      palette: 'ocean' as const,
      detailsWidth: 900,
      customViews: [CUSTOM_VIEW],
      githubRepos: [{ id: 99, fullName: 'owner/secret-repo' }]
    };
    await store.update(update);
    await store.saveWindowState({ x: 20, y: 30, width: 1200, height: 800, maximized: false });
    expect(await store.load()).toMatchObject({
      pinnedRepoIds: [12],
      colorScheme: 'light',
      palette: 'ocean',
      customViews: [CUSTOM_VIEW],
      windowState: { x: 20, y: 30, width: 1200, height: 800, maximized: false, detailsWidth: 900 }
    });
    const file = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(file).sort()).toEqual([
      'colorScheme',
      'customThemes',
      'customViews',
      'motion',
      'openItemsIn',
      'palette',
      'pinnedRepoIds',
      'publicUploadNoticeAcknowledged',
      'windowState'
    ]);
  });

  it('reads a saved light or dark theme from before the colour scheme setting', async () => {
    const { store, dir } = await makeStore();
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ theme: 'light' }));
    expect(await store.load()).toMatchObject({ colorScheme: 'light', palette: 'orbit' });
    await store.update({ palette: 'unknown' as never, colorScheme: 'system' });
    expect(await store.load()).toMatchObject({ colorScheme: 'system', palette: 'orbit' });
  });

  it('opens items in the side panel unless full screen is chosen', async () => {
    const { store } = await makeStore();
    expect((await store.load()).openItemsIn).toBe('side');
    await store.update({ openItemsIn: 'full' });
    expect((await store.load()).openItemsIn).toBe('full');
    await store.update({ openItemsIn: 'sideways' as never });
    expect((await store.load()).openItemsIn).toBe('side');
  });

  it('animates the side panels by default, and follows Windows only when that is chosen', async () => {
    const { store } = await makeStore();
    expect((await store.load()).motion).toBe('always');
    await store.update({ motion: 'system' });
    expect((await store.load()).motion).toBe('system');
    await store.update({ motion: 'sometimes' as never });
    expect((await store.load()).motion).toBe('always');
  });

  it('ignores invalid settings and clamps the details width', async () => {
    const { store } = await makeStore();
    await store.update({ detailsWidth: 100 });
    expect((await store.load()).windowState?.detailsWidth).toBe(260);
    await store.update({ detailsWidth: 9000 });
    expect((await store.load()).windowState?.detailsWidth).toBe(4000);
  });
});

describe('SettingsStore custom view definitions', () => {
  it('stores definitions only, never item data or GitHub responses', async () => {
    const { store, dir } = await makeStore();
    const leaky = {
      ...CUSTOM_VIEW,
      items: [{ id: 'PVTI_1', title: 'Private item' }],
      fieldValues: { FLD_status: { kind: 'text', text: 'private value' } }
    };
    await store.update({ customViews: [leaky as unknown as CustomViewDefinition] });
    const raw = await readFile(join(dir, 'settings.json'), 'utf8');
    expect(raw).not.toContain('Private item');
    expect(raw).not.toContain('private value');
    expect(await store.load()).toMatchObject({ customViews: [CUSTOM_VIEW] });
  });

  it('drops stored entries that are not valid definitions', async () => {
    const { store, dir } = await makeStore();
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({ customViews: [CUSTOM_VIEW, { id: 'old', layout: 'gantt' }] }),
      'utf8'
    );
    expect((await store.load()).customViews).toEqual([CUSTOM_VIEW]);
  });

  it('changing views keeps the other preferences', async () => {
    const { store } = await makeStore();
    await store.update({ pinnedRepoIds: [7] });
    await store.update({ customViews: [CUSTOM_VIEW] });
    expect(await store.load()).toMatchObject({ pinnedRepoIds: [7], customViews: [CUSTOM_VIEW] });
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
