'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('halka', {
  // overlay
  bootstrap: () => ipcRenderer.invoke('halka:bootstrap'),
  run: (action, payload) => ipcRenderer.invoke('halka:run', action, payload),
  item: (op, id) => ipcRenderer.invoke('halka:item', op, id),
  hidden: () => ipcRenderer.send('halka:hidden'),
  onOpen: listen('halka:open'),
  onFiles: listen('halka:files'),
  onHistory: listen('halka:history'),
  onDismiss: listen('halka:dismiss'),
  onResult: listen('halka:result'),
  onSettings: listen('halka:settings'),
  // toast
  onToast: listen('toast:show'),
  onToastHide: listen('toast:hide'),
  toastAction: (action) => ipcRenderer.send('toast:action', action),
  toastHidden: () => ipcRenderer.send('toast:hidden'),
  // settings window
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  recording: (on) => ipcRenderer.invoke('settings:recording', on),
  clearHistory: () => ipcRenderer.invoke('settings:clear-history'),
  openData: () => ipcRenderer.invoke('settings:open-data'),
  onSection: listen('settings:section'),
  closeWindow: () => ipcRenderer.send('window:close'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  // conversion worker
  onWorkerCall: listen('worker:call'),
  workerResult: (result) => ipcRenderer.send('worker:result', result)
});
