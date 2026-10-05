import { contextBridge, ipcRenderer } from 'electron';
import type { ChessHelperAPI, Snapshot, CaptureCommand } from '../shared/contracts';
const listen = <T>(channel: string, callback: (value: T) => void) => { const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); };
const api: ChessHelperAPI = {
  snapshot: () => ipcRenderer.invoke('chess:snapshot'),
  subscribe: callback => listen<Snapshot>('chess:snapshot', callback),
  onCapture: callback => listen<CaptureCommand>('chess:capture', callback),
  onVisibility: callback => listen<boolean>('chess:visibility', callback),
  sources: token => ipcRenderer.invoke('chess:sources', token),
  selectSource: value => ipcRenderer.invoke('chess:source', value),
  selectBoard: value => ipcRenderer.invoke('chess:selection', value),
  correct: value => ipcRenderer.invoke('chess:correct', value),
  start: value => ipcRenderer.invoke('chess:start', value),
  pause: value => ipcRenderer.invoke('chess:pause', value),
  rescan: value => ipcRenderer.invoke('chess:rescan', value),
  frame: value => ipcRenderer.invoke('chess:frame', value),
  captureError: value => ipcRenderer.invoke('chess:capture-error', value),
  saveSettings: value => ipcRenderer.invoke('chess:settings', value),
  retryExplanation: value => ipcRenderer.invoke('chess:explain', value),
  restartEngine: value => ipcRenderer.invoke('chess:restart-engine', value),
  openWindow: value => ipcRenderer.invoke('chess:open', value),
  hide: () => ipcRenderer.invoke('chess:hide'),
  cursor: () => ipcRenderer.invoke('chess:cursor'),
  hitTest: value => ipcRenderer.invoke('chess:hit-test', value),
  screenPermission: () => ipcRenderer.invoke('chess:permission'),
  openScreenSettings: () => ipcRenderer.invoke('chess:screen-settings'),
};
contextBridge.exposeInMainWorld('chessHelper', Object.freeze(api));
