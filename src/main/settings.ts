import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OrbitSettings, SettingsUpdate, WindowState } from '../shared/ipc';

const DEFAULTS: OrbitSettings = {
  pinnedRepoIds: [],
  customViews: [],
  theme: 'dark',
  windowState: null,
  publicUploadNoticeAcknowledged: false
};

/** Stores only user preferences. GitHub responses and credentials never belong here. */
export class SettingsStore {
  private readonly path: string;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(userDataPath: string) {
    this.path = join(userDataPath, 'settings.json');
  }

  async load(): Promise<OrbitSettings> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
    } catch (error) {
      if (isMissing(error)) return { ...DEFAULTS };
      return { ...DEFAULTS };
    }
    return normalizeSettings(parsed);
  }

  async update(update: SettingsUpdate): Promise<OrbitSettings> {
    return this.enqueue(async () => {
      const current = await this.load();
      const { detailsWidth, ...preferenceUpdate } = update;
      const candidate: OrbitSettings = {
        pinnedRepoIds: preferenceUpdate.pinnedRepoIds ?? current.pinnedRepoIds,
        customViews: preferenceUpdate.customViews ?? current.customViews,
        theme: preferenceUpdate.theme ?? current.theme,
        windowState: current.windowState,
        publicUploadNoticeAcknowledged:
          preferenceUpdate.publicUploadNoticeAcknowledged ?? current.publicUploadNoticeAcknowledged
      };
      if (typeof detailsWidth === 'number') {
        candidate.windowState = {
          ...(current.windowState ?? { width: 1100, height: 720, maximized: false }),
          detailsWidth
        };
      }
      const next = normalizeSettings(candidate);
      await this.save(next);
      return next;
    });
  }

  async saveWindowState(windowState: WindowState): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.load();
      await this.save(
        normalizeSettings({
          ...current,
          windowState: {
            ...windowState,
            detailsWidth: current.windowState?.detailsWidth
          }
        })
      );
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(operation);
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  private async save(settings: OrbitSettings): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.path);
  }
}

function normalizeSettings(value: unknown): OrbitSettings {
  if (!isRecord(value)) return { ...DEFAULTS };
  const windowState = isWindowState(value['windowState']) ? normalizeWindowState(value['windowState']) : null;
  const customViews = Array.isArray(value['customViews'])
    ? value['customViews']
        .filter(isCustomView)
        .map(({ id, name, projectId, layout }) => ({ id, name, projectId, layout }))
    : [];
  return {
    pinnedRepoIds: Array.isArray(value['pinnedRepoIds'])
      ? [...new Set(value['pinnedRepoIds'].filter((id): id is number => Number.isSafeInteger(id) && id > 0))]
      : [],
    customViews,
    theme: value['theme'] === 'light' ? 'light' : 'dark',
    windowState,
    publicUploadNoticeAcknowledged: value['publicUploadNoticeAcknowledged'] === true
  };
}

function normalizeWindowState(state: WindowState): WindowState {
  return {
    ...(state.x === undefined ? {} : { x: state.x }),
    ...(state.y === undefined ? {} : { y: state.y }),
    width: state.width,
    height: state.height,
    maximized: state.maximized,
    ...(typeof state.detailsWidth === 'number'
      ? { detailsWidth: Math.min(600, Math.max(260, Math.round(state.detailsWidth))) }
      : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWindowState(value: unknown): value is WindowState {
  if (!isRecord(value)) return false;
  return (
    Number.isFinite(value['width']) &&
    Number.isFinite(value['height']) &&
    (value['detailsWidth'] === undefined ||
      (typeof value['detailsWidth'] === 'number' && Number.isFinite(value['detailsWidth']))) &&
    (value['x'] === undefined || Number.isFinite(value['x'])) &&
    (value['y'] === undefined || Number.isFinite(value['y'])) &&
    typeof value['maximized'] === 'boolean'
  );
}

function isCustomView(value: unknown): value is OrbitSettings['customViews'][number] {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    (value['layout'] === 'kanban' ||
      value['layout'] === 'gantt' ||
      value['layout'] === 'calendar' ||
      value['layout'] === 'table')
  );
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}
