import { contextBridge, ipcRenderer } from 'electron';
import { createPreloadBridge } from './bridge.ts';

const api = createPreloadBridge((channel, payload) => ipcRenderer.invoke(channel, payload));

contextBridge.exposeInMainWorld('electronAPI', api);
