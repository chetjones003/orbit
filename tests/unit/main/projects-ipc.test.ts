import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../../src/shared/ipc';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
}));

vi.mock('electron', () => ({
  app: { getName: () => 'Orbit', getVersion: () => '0.1.0' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, fn);
    }
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  protocol: {}
}));

import { registerIpcHandlers } from '../../../src/main/ipc';

const trusted = { senderFrame: { url: 'orbit://app/index.html' } };
const untrusted = { senderFrame: { url: 'https://evil.example/' } };

function invoke(channel: string, event: unknown, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, ...args);
}

function projectsService() {
  return {
    listProjects: vi.fn(async () => ({ projects: [], partial: false })),
    getProject: vi.fn(async () => ({ project: {}, fields: [], views: [] })),
    listItems: vi.fn(async () => ({ items: [], partial: false })),
    getItemMemberships: vi.fn(async () => ({ contentId: 'I_1', memberships: [], partial: false })),
    addItem: vi.fn(async () => ({ id: 'PVTI_1' })),
    removeItem: vi.fn(async () => undefined),
    setFieldValue: vi.fn(async () => ({ kind: 'busy' as const }))
  };
}

describe('project IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
  });

  it('forwards reads and edits from trusted renderers', async () => {
    const projects = projectsService();
    registerIpcHandlers({ projects: projects as never });

    await invoke(IpcChannels.projectsList, trusted);
    expect(projects.listProjects).toHaveBeenCalled();

    await invoke(IpcChannels.projectsItems, trusted, 'PVT_1', 'assignee:@me');
    expect(projects.listItems).toHaveBeenCalledWith('PVT_1', 'assignee:@me');

    await invoke(IpcChannels.projectsItemMemberships, trusted, 'orbit-owner/app', 12);
    expect(projects.getItemMemberships).toHaveBeenCalledWith('orbit-owner/app', 12);

    await invoke(IpcChannels.projectsAddItem, trusted, 'PVT_1', 'orbit-owner/app', 12);
    expect(projects.addItem).toHaveBeenCalledWith('PVT_1', 'orbit-owner/app', 12);

    await invoke(IpcChannels.projectsRemoveItem, trusted, 'PVT_1', 'PVTI_1');
    expect(projects.removeItem).toHaveBeenCalledWith('PVT_1', 'PVTI_1');
  });

  it('passes a well-formed field change through unchanged', async () => {
    const projects = projectsService();
    registerIpcHandlers({ projects: projects as never });
    const change = { fieldId: 'FLD_status', value: { kind: 'single-select', optionId: 'done' } };
    await expect(invoke(IpcChannels.projectsSetField, trusted, 'PVT_1', 'PVTI_1', change)).resolves.toEqual({
      kind: 'busy'
    });
    expect(projects.setFieldValue).toHaveBeenCalledWith('PVT_1', 'PVTI_1', change);
  });

  it('refuses a malformed field change before the service sees it', async () => {
    const projects = projectsService();
    registerIpcHandlers({ projects: projects as never });
    await expect(
      invoke(IpcChannels.projectsSetField, trusted, 'PVT_1', 'PVTI_1', {
        fieldId: 'FLD',
        value: { kind: 'number', number: 'x' }
      })
    ).rejects.toThrow('That field change is not valid.');
    expect(projects.setFieldValue).not.toHaveBeenCalled();
  });

  it('rejects project calls from an untrusted sender', async () => {
    const projects = projectsService();
    registerIpcHandlers({ projects: projects as never });
    expect(() => invoke(IpcChannels.projectsList, untrusted)).toThrow('Untrusted IPC sender');
    expect(projects.listProjects).not.toHaveBeenCalled();
  });

  it('refuses a filter that is not text instead of listing every item', async () => {
    const projects = projectsService();
    registerIpcHandlers({ projects: projects as never });
    await expect(invoke(IpcChannels.projectsItems, trusted, 'PVT_1', { not: 'text' })).rejects.toThrow(
      'That filter is not valid.'
    );
    expect(projects.listItems).not.toHaveBeenCalled();
  });
});
