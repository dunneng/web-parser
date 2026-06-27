/**
 * tab-browser-preload.js
 * Tab 浏览器窗口的 IPC 桥接
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabApi', {
  closeWindow: () => ipcRenderer.invoke('tab-browser:close'),
  onAddTab: (callback) => {
    ipcRenderer.on('tab:add', (event, url) => callback(url));
  },
  removeAddTabListener: () => {
    ipcRenderer.removeAllListeners('tab:add');
  },
  onTheme: (callback) => {
    ipcRenderer.on('tab:theme', (event, theme) => callback(theme));
  },
  removeThemeListener: () => {
    ipcRenderer.removeAllListeners('tab:theme');
  },
  getTheme: () => ipcRenderer.invoke('tab:get-theme')
});
