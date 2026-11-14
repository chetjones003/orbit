import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type OrbitApi } from '../shared/ipc';

/**
 * The only bridge between the sandboxed renderer and main. Each operation maps
 * to one named IPC channel; nothing else is exposed.
 */
const api: OrbitApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.appGetInfo),
    openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.appOpenExternal, url)
  }
};

contextBridge.exposeInMainWorld('orbit', api);
