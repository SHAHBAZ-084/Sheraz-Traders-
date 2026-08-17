import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('grainPos', {
  platform: process.platform,
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),
});
