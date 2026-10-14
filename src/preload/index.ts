import { contextBridge, ipcRenderer } from 'electron';
import type { DownloadState, GameNestAPI } from '../shared/types';

const api: GameNestAPI = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  catalog: (query, page, refresh) => ipcRenderer.invoke('catalog:list', query, page, refresh),
  detail: (url) => ipcRenderer.invoke('catalog:detail', url),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseFolder: () => ipcRenderer.invoke('settings:folder'),
  startDownload: (url, index) => ipcRenderer.invoke('downloads:start', url, index),
  addMagnet: (uri) => ipcRenderer.invoke('downloads:magnet', uri),
  importTorrent: () => ipcRenderer.invoke('downloads:import'),
  pauseDownload: (id, paused) => ipcRenderer.invoke('downloads:pause', id, paused),
  removeDownload: (id) => ipcRenderer.invoke('downloads:remove', id),
  files: (id) => ipcRenderer.invoke('downloads:files', id),
  selectFiles: (id, indexes) => ipcRenderer.invoke('downloads:select-files', id, indexes),
  openFolder: (id) => ipcRenderer.invoke('downloads:folder', id),
  toggleFavorite: (game) => ipcRenderer.invoke('favorites:toggle', game),
  testConnection: () => ipcRenderer.invoke('network:test'),
  onDownloads: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DownloadState) => listener(state);
    ipcRenderer.on('downloads:changed', handler);
    return () => ipcRenderer.removeListener('downloads:changed', handler);
  },
};
contextBridge.exposeInMainWorld('gamenest', api);
