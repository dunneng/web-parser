/**
 * 网页源码解析器 — 预加载脚本
 * 安全暴露 IPC API 给渲染进程
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Cookie
  cookieLoad: (url) => ipcRenderer.invoke('cookie:load', url),
  cookieSave: (url) => ipcRenderer.invoke('cookie:save', url),
  cookieGetAll: () => ipcRenderer.invoke('cookie:get-all'),
  cookieClearAll: () => ipcRenderer.invoke('cookie:clear-all'),

  // Python
  pythonHealth: () => ipcRenderer.invoke('python:health'),
  pythonStart: () => ipcRenderer.invoke('python:start'),
  pythonPort: () => ipcRenderer.invoke('python:port'),

  // Webview source
  getWebviewSource: () => ipcRenderer.invoke('webview:get-source'),

  // File save dialog
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:save', options),
  saveFile: (filePath, data) => ipcRenderer.invoke('file:save', filePath, data),

  // Clipboard (IPC to main process for image save)
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),

  // Webview context menu events
  onWebviewContextMenu: (callback) => {
    ipcRenderer.on('webview:context-menu', (event, params) => callback(params));
  },

  // Image download
  downloadImage: (url) => ipcRenderer.invoke('image:download', url),

  // API proxy request
  apiRequest: (opts) => ipcRenderer.invoke('api:request', opts),

  // API history
  apiHistoryLoad: () => ipcRenderer.invoke('api:history:load'),
  apiHistorySave: (items) => ipcRenderer.invoke('api:history:save', items),
  apiHistoryClear: () => ipcRenderer.invoke('api:history:clear'),
  apiCapturedUrls: () => ipcRenderer.invoke('api:captured-urls'),

  // Menu actions from main menu
  onMenuAction: (callback) => {
    ipcRenderer.on('menu:history', () => callback('history'));
    ipcRenderer.on('menu:save-source', () => callback('save-source'));
    ipcRenderer.on('menu:export-excel', () => callback('export-excel'));
    ipcRenderer.on('menu:clipboard', () => callback('clipboard'));
    ipcRenderer.on('menu:clear-cookie', () => callback('clear-cookie'));
    ipcRenderer.on('menu:toggle-browser', () => callback('toggle-browser'));
    ipcRenderer.on('menu:settings', (_e, section) => callback('settings', section));
    ipcRenderer.on('menu:dom-persist-on', () => callback('dom-persist-on'));
    ipcRenderer.on('menu:dom-persist-off', () => callback('dom-persist-off'));
    ipcRenderer.on('menu:api-listen-on', () => callback('api-listen-on'));
    ipcRenderer.on('menu:api-listen-off', () => callback('api-listen-off'));
    ipcRenderer.on('menu:api-detected', (e, data) => callback('api-detected', data));
  },

  // Webview preload path
  webviewPreloadPath: () => ipcRenderer.invoke('webview:preload-path'),

  // CDP 脚本预注入（在页面脚本运行前注入反爬代码）
  stealthInjectCdp: (webContentsId, script) => ipcRenderer.invoke('stealth:inject-cdp', { webContentsId, script }),

  // Selector persistence
  selectorsSave: (selectors) => ipcRenderer.invoke('selectors:save', selectors),
  selectorsLoad: () => ipcRenderer.invoke('selectors:load'),

  // 反爬/辅助开关
  antidetectToggle: () => ipcRenderer.invoke('antidetect:toggle'),
  domPersistToggle: () => ipcRenderer.invoke('dom-persist:toggle'),
  apiListenToggle: () => ipcRenderer.invoke('api-listen:toggle'),

  // Tab browser
  openPopupTab: (url) => ipcRenderer.invoke('popup:open-tab', url),

  // 获取本地文件路径（Electron 28+ File.path 已移除）
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Settings persistence
  settingsLoad: () => ipcRenderer.invoke('settings:load'),
  settingsSave: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Proxy
  proxySet: (config) => ipcRenderer.invoke('proxy:set', config),
  proxyGet: () => ipcRenderer.invoke('proxy:get'),

  // 应用退出前清理
  onCleanup: (callback) => ipcRenderer.on('app:cleanup', callback),
});
