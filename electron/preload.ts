import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('grainPos', {
  platform: process.platform,
});
