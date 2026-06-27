/**
 * 网页源码解析器 — Electron 主进程
 */
const { app, BrowserWindow, ipcMain, session, protocol, net: electronNet } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');

// 移除 Chromium 自动化标记（防止 navigator.webdriver = true 暴露机器人身份）
app.commandLine.appendSwitch('disable-features', 'AutomationControlled');

let mainWindow;
let pythonProcess;
const PYTHON_PORT = 19527;
const COOKIES_DIR = path.join(__dirname, 'python', 'cookies');

// ──────── Python 后端管理 ────────

function isPythonPortInUse() {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(1000);
    sock.connect(PYTHON_PORT, '127.0.0.1', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function startPythonBackend() {
  // 检查是否已有后端实例在运行，避免重复启动导致端口冲突崩溃
  const portInUse = await isPythonPortInUse();
  if (portInUse) {
    console.log('[Python] 端口 ' + PYTHON_PORT + ' 已被占用，复用已有后端');
    return;
  }

  // 打包后 exe 在 resources/python/ 下，开发时在源码目录下
  const exePath = app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'python-backend.exe')
    : path.join(__dirname, 'python', 'python-backend.exe');
  const serverPath = path.join(__dirname, 'python', 'server.py');

  if (fs.existsSync(exePath)) {
    console.log('[Python] 使用打包的 python-backend.exe');
    pythonProcess = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } else {
    console.log('[Python] 使用源码 python server.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    pythonProcess = spawn(pythonCmd, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', LANG: 'zh_CN.UTF-8' },
    });
  }

  // Windows 上强制流使用 UTF-8 解码
  pythonProcess.stdout.setEncoding('utf8');
  pythonProcess.stderr.setEncoding('utf8');

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python] ${(data || '').toString().trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    const msg = (data || '').toString().trim();
    if (msg.includes('Application startup complete') || msg.includes('Uvicorn running')) {
      console.log(`[Python] ${msg}`);
    }
  });

  pythonProcess.on('close', (code) => {
    console.log(`[Python] 进程退出, code=${code}`);
    pythonProcess = null;
  });

  pythonProcess.on('error', (err) => {
    console.error(`[Python] 启动失败:`, err.message);
    pythonProcess = null;
  });
}

function stopPythonBackend() {
  // 清理采集数据
  try {
    const collectedDir = path.join(__dirname, 'python', 'collected');
    if (fs.existsSync(collectedDir)) {
      fs.readdirSync(collectedDir).forEach(f => fs.unlinkSync(path.join(collectedDir, f)));
    }
  } catch (e) {}
  if (pythonProcess) {
    console.log('[Python] 正在关闭...');
    pythonProcess.kill();
    pythonProcess = null;
  }
}

function waitForPython(timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const sock = new net.Socket();
      sock.setTimeout(1000);
      sock.connect(PYTHON_PORT, '127.0.0.1', () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error('Python 后端启动超时'));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

// ──────── Cookie 管理 ────────

function getDomainFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch { return ''; }
}

async function loadCookiesForUrl(url) {
  const domain = getDomainFromUrl(url);
  if (!domain) return;

  // 尝试精确匹配和父域名匹配
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.');
    const file = path.join(COOKIES_DIR, `${d}.json`);
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const cookies = data.cookies || [];
        if (cookies.length > 0) {
          // 过滤过期 cookie
          const now = Date.now() / 1000;
          const valid = cookies.filter(c => !c.expirationDate || c.expirationDate > now);

          for (const c of valid) {
            try {
              const cleanDomain = c.domain.replace(/^\.+/, ''); // 去掉前导点 (Chromium 拒绝 .domain 格式)
              await session.defaultSession.cookies.set({
              url: `https://${cleanDomain}${c.path}`,
              name: c.name,
              value: c.value,
              domain: cleanDomain,
              path: c.path || '/',
              secure: !!c.secure,
              httpOnly: !!c.httpOnly,
              expirationDate: c.expirationDate || 0,
            });
            } catch (e) {
              console.error('[Cookie] 设置失败:', c.domain, c.name, e.message);
            }
          }
          console.log(`[Cookie] 已加载 ${valid.length} 条 → ${d}`);
          return { domain: d, count: valid.length };
        }
      } catch (e) {
        console.error(`[Cookie] 读取失败: ${e.message}`);
      }
    }
  }
  return null;
}

async function saveCookiesForUrl(url) {
  const domain = getDomainFromUrl(url);
  if (!domain) return;

  try {
    const cookies = await session.defaultSession.cookies.get({});
    const relevant = cookies.filter(c => domain.includes(c.domain) || c.domain.includes(domain));

    if (relevant.length > 0) {
      const file = path.join(COOKIES_DIR, `${domain}.json`);
      fs.writeFileSync(file, JSON.stringify({
        cookies: relevant,
        saved_at: new Date().toISOString(),
      }, null, 2), 'utf-8');
      console.log(`[Cookie] 已保存 ${relevant.length} 条 → ${domain}`);
      return { domain, count: relevant.length };
    }
  } catch (e) {
    console.error(`[Cookie] 保存失败: ${e.message}`);
  }
  return null;
}

// ──────── Tab 浏览器窗口 ────────

let tabBrowserWindow = null;

function getOrCreateTabBrowser() {
  if (tabBrowserWindow && !tabBrowserWindow.isDestroyed()) {
    return tabBrowserWindow;
  }
  tabBrowserWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '标签页浏览器',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'tab-browser-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  tabBrowserWindow.loadFile(path.join(__dirname, 'tab-browser.html'));
  tabBrowserWindow.webContents.on('did-finish-load', () => {
    tabBrowserWindow.__loaded = true;
    if (tabBrowserWindow.__pendingURLs) {
      tabBrowserWindow.__pendingURLs.forEach(function (u) {
        tabBrowserWindow.webContents.send('tab:add', u);
      });
      tabBrowserWindow.__pendingURLs = [];
    }
  });
  tabBrowserWindow.on('closed', () => { tabBrowserWindow = null; });
  return tabBrowserWindow;
}

// ──────── 全局 API URL 捕获 ────────

let _apiCapturedUrls = [];
let _apiListenOn = false;

function setupApiUrlCapture() {
  const filter = { urls: ['*://*/*'] };
  try {
    session.defaultSession.webRequest.onCompleted(filter, (details) => {
      if (details.statusCode === 200 && details.url) {
        const url = details.url.toLowerCase();
        // 排除静态资源
        if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|map|html?)(\?|$)/i.test(url)) return;
        // 排除登录/埋点/统计域名
        if (/login|sso|auth|oauth|token|passport|analytics|tracking|beacon|monitor|collect|report|alibaba-inc\.com|umeng|tongji|cnzz|gtag|facebook\.com\/tr|google-analytics|googletagmanager|pixel|callback|redirect/i.test(url)) return;
        // 只保留 API 类请求
        if (/list|items|feed|search|api|json|query|data|page|ajax|get/i.test(url)) {
          _apiCapturedUrls.push({ url: details.url, status: details.statusCode, time: Date.now() });
          // 限制最多 500 条
          if (_apiCapturedUrls.length > 500) _apiCapturedUrls = _apiCapturedUrls.slice(-500);
          // 仍然转发给渲染进程（保持兼容现有 API 监听功能）
          if (_apiListenOn) {
            mainWindow?.webContents.send('menu:api-detected', {
              url: details.url, status: details.statusCode, time: Date.now(),
            });
          }
        }
      }
    });
    console.log('[API捕获] 已启动（始终运行）');
  } catch (e) {
    console.error('[API捕获] 启动失败:', e.message);
  }
}

// ──────── 请求头伪装（补全浏览器标准头，防止被识别为爬虫）────────

function setupRequestHeaders() {
  try {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['*://*/*'] },
      (details, callback) => {
        const headers = details.requestHeaders;

        // Sec-CH-UA: 浏览器品牌标识（普通 Chrome 必带）
        if (!headers['Sec-CH-UA']) {
          headers['Sec-CH-UA'] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
        }
        if (!headers['Sec-CH-UA-Platform']) {
          headers['Sec-CH-UA-Platform'] = '"Windows"';
        }
        if (!headers['Sec-CH-UA-Mobile']) {
          headers['Sec-CH-UA-Mobile'] = '?0';
        }

        // Accept-Language: 语言偏好
        if (!headers['Accept-Language']) {
          headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8';
        }

        // Upgrade-Insecure-Requests: 普通浏览器默认行为
        if (!headers['Upgrade-Insecure-Requests']) {
          headers['Upgrade-Insecure-Requests'] = '1';
        }

        callback({ requestHeaders: headers });
      }
    );
    console.log('[请求头伪装] 已启动');
  } catch (e) {
    console.error('[请求头伪装] 启动失败:', e.message);
  }
}

// ──────── 窗口创建 ────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: '网页源码解析器',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // 启用 webview
    },
  });

  // 在 loadFile 之前挂载控制台捕获
  mainWindow.webContents.on('console-message', function(event, level, message, line, sourceId) {
    // 静默捕获，不输出到主进程避免 EPIPE
  });

  // 捕获渲染进程崩溃（仅在 stdio 可用时输出）
  mainWindow.webContents.on('render-process-gone', function(event, details) {
    try { console.log('[主进程] 渲染进程 gone:', details.reason); } catch(e) {}
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 设置中文菜单
  const { Menu } = require('electron');
  let toolsMenu; // 工具子菜单引用，用于重弹出
  const menuTemplate = [
    {
      label: '文件',
      submenu: [
        { label: '保存源码', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save-source') },
        { label: '导出 Excel', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('menu:export-excel') },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '工具',
      submenu: (toolsMenu = [
        {
          label: '设置',
          submenu: [
            { label: '通用', click: () => mainWindow?.webContents.send('menu:settings', '通用') },
            { label: 'DOM 树', click: () => mainWindow?.webContents.send('menu:settings', 'DOM 树') },
            { label: '合并 / 拆分', click: () => mainWindow?.webContents.send('menu:settings', '合并 / 拆分') },
            { label: '反爬脚本', click: () => mainWindow?.webContents.send('menu:settings', '反爬脚本') },
            { label: '行为模拟', click: () => mainWindow?.webContents.send('menu:settings', '行为模拟') },
          ],
        },
        { type: 'separator' },
        { label: '浏览历史', accelerator: 'CmdOrCtrl+H', click: () => mainWindow?.webContents.send('menu:history') },
        { label: '剪贴板历史', accelerator: 'CmdOrCtrl+B', click: () => mainWindow?.webContents.send('menu:clipboard') },
        { label: '清除 Cookie', click: () => mainWindow?.webContents.send('menu:clear-cookie') },
        { type: 'separator' },
      ]),
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于', click: () => { require('electron').dialog.showMessageBox(mainWindow, { type: 'info', title: '关于', message: '网页源码解析器 v1.0.0' }); } },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));


  // 开发时打开 DevTools
  // mainWindow.webContents.openDevTools();
}

// ──────── IPC 处理 ────────

ipcMain.handle('cookie:load', async (event, url) => {
  return await loadCookiesForUrl(url);
});

ipcMain.handle('cookie:save', async (event, url) => {
  return await saveCookiesForUrl(url);
});

ipcMain.handle('cookie:get-all', async () => {
  try {
    const cookies = await session.defaultSession.cookies.get({});
    return cookies;
  } catch (e) {
    return [];
  }
});

ipcMain.handle('cookie:clear-all', async () => {
  try {
    const cookies = await session.defaultSession.cookies.get({});
    for (const c of cookies) {
      try {
        // 移除域名前导点，避免构造 https://.domain.com 畸形 URL
        const domain = (c.domain || '').replace(/^\./, '');
        let url = (c.secure ? 'https://' : 'http://') + domain + (c.path || '/');
        await session.defaultSession.cookies.remove(url, c.name);
      } catch (e) { }
    }
    console.log(`[Cookie] 已清除 ${cookies.length} 条`);
    return { ok: true, count: cookies.length };
  } catch (e) {
    console.error('[Cookie] 清除失败:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('python:health', async () => {
  try {
    const resp = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/health`);
    return await resp.json();
  } catch {
    return { status: 'offline' };
  }
});

ipcMain.handle('python:port', () => PYTHON_PORT);

// ──────── Webview 源码获取 ────────
// 从渲染进程获取 webview 内的源码（renderer 可直接调用 webview.executeJavaScript）
ipcMain.handle('webview:get-source', async () => {
  try {
    // 获取主窗口中 webview 的 webContents 并执行 JS 取出源码
    const source = await mainWindow.webContents.executeJavaScript(`
      (function() {
        try {
          var wv = document.querySelector('webview');
          if (wv && wv.getWebContentsId) {
            var wcId = wv.getWebContentsId();
            // 通过 IPC 向 webview 的 webContents 请求源码
            return null; // 渲染进程应直接使用 executeJavaScript
          }
          return null;
        } catch(e) { return null; }
      })()
    `);
    return source;
  } catch (e) {
    console.error('[Main] 获取webview源码失败:', e.message);
    return null;
  }
});

// ──────── 文件保存对话框 ────────

ipcMain.handle('dialog:save', async (event, options) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options.title || '保存文件',
    defaultPath: options.defaultPath || 'export.xlsx',
    filters: options.filters || [{ name: '所有文件', extensions: ['*'] }],
  });
  return result;
});

ipcMain.handle('file:save', async (event, filePath, data) => {
  try {
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ──────── 打开本地文件对话框 ────────

ipcMain.handle('dialog:openFiles', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 HTML 文件',
    filters: [
      { name: 'HTML 文件', extensions: ['html', 'htm'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  return result; // { canceled, filePaths }
});

// ──────── 剪贴板 IPC ────────

const { clipboard } = require('electron');

ipcMain.handle('clipboard:write', async (event, text) => {
  clipboard.writeText(text);
  return { ok: true };
});

ipcMain.handle('clipboard:read', async () => {
  return clipboard.readText();
});

// ──────── API 代理请求 ────────

ipcMain.handle('api:request', async (event, { url, method, headers, body, timeout }) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout || 30000);

    const fetchOptions = {
      method: method || 'GET',
      headers: headers || {},
      signal: controller.signal,
    };

    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = body;
    }

    const start = Date.now();
    const resp = await fetch(url, fetchOptions);
    clearTimeout(timer);

    const duration = Date.now() - start;
    const respBody = await resp.text();

    // 提取响应头
    const respHeaders = {};
    resp.headers.forEach((value, key) => {
      respHeaders[key] = value;
    });

    return {
      ok: true,
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
      body: respBody,
      duration,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.name === 'AbortError' ? '请求超时' : e.message,
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      duration: 0,
    };
  }
});

// ──────── API 历史记录 ────────

function getHistoryPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'api_history.json');
}

ipcMain.handle('api:history:load', async () => {
  try {
    const file = getHistoryPath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return data.items || [];
    }
    return [];
  } catch (e) {
    console.error('[API History] 加载失败:', e.message);
    return [];
  }
});

ipcMain.handle('api:history:save', async (event, items) => {
  try {
    const file = getHistoryPath();
    fs.writeFileSync(file, JSON.stringify({ items, updated: new Date().toISOString() }, null, 2), 'utf-8');
    return { ok: true };
  } catch (e) {
    console.error('[API History] 保存失败:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('api:history:clear', async () => {
  try {
    const file = getHistoryPath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 返回已捕获的 API 请求 URL（用于分页采集自动检测）
ipcMain.handle('api:captured-urls', async () => {
  return _apiCapturedUrls.slice();
});

// ── 反爬/辅助开关（原菜单项，现由配置弹窗控制）──

let _antidetectOn = false;
ipcMain.handle('antidetect:toggle', async () => {
  _antidetectOn = !_antidetectOn;
  if (_antidetectOn) {
    const ses = session.defaultSession;
    const uaList = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ];
    ses.setUserAgent(uaList[Math.floor(Math.random() * uaList.length)]);
    ses.setPermissionRequestHandler((wc, p, cb) => cb(true));
  }
  return _antidetectOn;
});

let _domPersistOn = false;
ipcMain.handle('dom-persist:toggle', async () => {
  _domPersistOn = !_domPersistOn;
  if (_domPersistOn) {
    mainWindow?.webContents.send('menu:dom-persist-on');
  } else {
    mainWindow?.webContents.send('menu:dom-persist-off');
  }
  return _domPersistOn;
});

ipcMain.handle('api-listen:toggle', async () => {
  _apiListenOn = !_apiListenOn;
  if (_apiListenOn) {
    _apiCapturedUrls = [];
    mainWindow?.webContents.send('menu:api-listen-on');
  } else {
    mainWindow?.webContents.send('menu:api-listen-off');
  }
  return _apiListenOn;
});

// ──────── 设置持久化 ────────

function getSettingsPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'settings.json');
}

const DEFAULT_SETTINGS = {
  globalChildDelim: ' | ',
  globalMultiDelim: ' | ',
  maxTextLen: 2000,
  maxDomDepth: 20,
  maxResults: 1000,
  maxSourcePreview: 2000,
  maxDomChildren: 200,
  maxCellText: 200,
  chainPreviewLimit: 3,
  inlineMergeDelim: '',
  splitMaxDepth: 4,
  theme: 'dark',
};

ipcMain.handle('settings:load', async () => {
  try {
    const file = getSettingsPath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return { ...DEFAULT_SETTINGS, ...data };
    }
    return { ...DEFAULT_SETTINGS };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
});

ipcMain.handle('settings:save', async (event, settings) => {
  try {
    const file = getSettingsPath();
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
    fs.writeFileSync(file, JSON.stringify({ ...existing, ...settings }, null, 2), 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ──────── 代理配置 ────────

let _proxyConfig = null; // { host, port, protocol, username, password }

ipcMain.handle('proxy:set', async (event, config) => {
  try {
    _proxyConfig = config;
    if (config && config.host && config.port) {
      const proto = config.protocol || 'http';
      const proxyRules = `${proto}://${config.host}:${config.port}`;
      await session.defaultSession.setProxy({
        proxyRules,
        proxyBypassRules: '<local>',
      });
      console.log('[Proxy] 已设置: ' + proxyRules);
    } else {
      await session.defaultSession.setProxy({});
      _proxyConfig = null;
      console.log('[Proxy] 已清除');
    }
    // 保存到 settings
    const settingsPath = getSettingsPath();
    const existing = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) : {};
    existing.proxy = _proxyConfig;
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2), 'utf-8');
    return { ok: true, proxy: _proxyConfig };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('proxy:get', async () => {
  return _proxyConfig || null;
});

// ──────── 图片下载 ────────

ipcMain.handle('image:download', async (event, url) => {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存图片',
      defaultPath: url.split('/').pop() || 'image.png',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (!result.canceled && result.filePath) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
      const buffer = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(result.filePath, buffer);
      return { ok: true, path: result.filePath };
    }
    return { ok: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ──────── 选择器持久化 ────────

function getSelectorsPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'parser_selectors.json');
}

ipcMain.handle('selectors:save', async (event, selectors) => {
  try {
    const file = getSelectorsPath();
    fs.writeFileSync(file, JSON.stringify({ selectors, updated: new Date().toISOString() }, null, 2), 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('selectors:load', async () => {
  try {
    const file = getSelectorsPath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return data.selectors || [];
    }
    return [];
  } catch (e) {
    return [];
  }
});

// ──────── Webview preload 路径 ────────

ipcMain.handle('webview:preload-path', () => {
  return 'file://' + path.join(__dirname, 'webview-preload.js').replace(/\\/g, '/');
});

// ──────── CDP 脚本预注入 ────────
// 使用 Chrome DevTools Protocol 的 addScriptToEvaluateOnNewDocument
// 在每次页面加载、任何页面脚本执行之前注入反爬代码

ipcMain.handle('stealth:inject-cdp', async (event, { webContentsId, script }) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(webContentsId);
    if (!wc) return { ok: false, error: 'webContents not found' };

    // 安全验证：只允许向 webview 的 guest webContents 注入，拒绝主窗口和其他窗口
    if (!wc.hostWebContents) {
      console.error('[CDP] 拒绝注入: webContents ' + webContentsId + ' 不是 webview guest');
      return { ok: false, error: '只能向 webview 内容注入脚本' };
    }
    // 验证请求来源：必须来自主窗口
    if (event.sender !== mainWindow.webContents) {
      console.error('[CDP] 拒绝注入: 请求来源非法');
      return { ok: false, error: '无权限' };
    }

    // 附加调试器（保持连接以持久化注入脚本）
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Page.enable');
    }

    // 注入脚本：在每次新文档创建前执行（早于任何页面脚本）
    await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: script,
    });

    console.log('[CDP] 反爬脚本已预注入, id=' + webContentsId + ' len=' + script.length);

    // 不 detach 调试器，保持脚本持久化
    return { ok: true };
  } catch (e) {
    console.error('[CDP] 注入失败:', e.message);
    return { ok: false, error: e.message };
  }
});

// ──────── Tab 浏览器窗口 ────────

ipcMain.handle('popup:open-tab', async (event, url) => {
  const win = getOrCreateTabBrowser();
  if (win.__loaded) {
    win.webContents.send('tab:add', url);
  } else {
    win.__pendingURLs = win.__pendingURLs || [];
    win.__pendingURLs.push(url);
  }
  win.focus();
  return { ok: true };
});

ipcMain.handle('tab-browser:close', async () => {
  if (tabBrowserWindow && !tabBrowserWindow.isDestroyed()) {
    tabBrowserWindow.close();
    tabBrowserWindow = null;
  }
  return { ok: true };
});

// ──────── 应用生命周期 ────────

// 全局拦截：弹窗 + 右键菜单（包括 webview 内部）
app.on('web-contents-created', (event, contents) => {
  // 拦截所有 window.open
  contents.setWindowOpenHandler(({ url }) => {
    if (url && url !== 'about:blank') {
      const win = getOrCreateTabBrowser();
      if (win.__loaded) {
        win.webContents.send('tab:add', url);
      } else {
        win.__pendingURLs = win.__pendingURLs || [];
        win.__pendingURLs.push(url);
      }
      win.focus();
    }
    return { action: 'deny' };
  });
  // 转发右键菜单到主窗口
  contents.on('context-menu', (e, params) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('webview:context-menu', params);
    }
  });
});

app.whenReady().then(async () => {
  // 注册本地文件协议，支持 webview 加载本地 HTML（含相对资源）
  protocol.handle('local-html', async (request) => {
    try {
      // URL 格式: local-html:///C:/path/to/file.html
      let filePath = decodeURIComponent(request.url.replace('local-html:///', ''));
      // 查询参数剥离
      const qIdx = filePath.indexOf('?');
      if (qIdx !== -1) filePath = filePath.substring(0, qIdx);

      // 路径遍历防护：拒绝包含 .. 的相对路径
      if (filePath.includes('..')) {
        return new Response('Forbidden', { status: 403 });
      }

      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = {
        '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
        '.js': 'application/javascript', '.json': 'application/json',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
        '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
        '.txt': 'text/plain', '.xml': 'application/xml',
      };
      return new Response(data, {
        headers: { 'content-type': mime[ext] || 'application/octet-stream' },
      });
    } catch (e) {
      return new Response('Not found: ' + e.message, { status: 404 });
    }
  });

  // 始终运行 API URL 捕获（用于分页采集自动检测）
  setupApiUrlCapture();

  // 请求头伪装（补全浏览器标准头）
  setupRequestHeaders();

  // 加载持久化代理配置
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.proxy && settings.proxy.host && settings.proxy.port) {
        const proto = settings.proxy.protocol || 'http';
        await session.defaultSession.setProxy({
          proxyRules: `${proto}://${settings.proxy.host}:${settings.proxy.port}`,
          proxyBypassRules: '<local>',
        });
        _proxyConfig = settings.proxy;
        console.log('[Proxy] 已加载持久化代理: ' + proto + '://' + settings.proxy.host + ':' + settings.proxy.port);
      }
    }
  } catch (e) {
    console.error('[Proxy] 加载失败:', e.message);
  }

  // 启动 Python 后端
  await startPythonBackend();

  // 等待 Python 就绪
  try {
    await waitForPython(15000);
    console.log('[Main] Python 后端已就绪');
  } catch (e) {
    console.error('[Main] Python 后端启动失败:', e.message);
    // 即使 Python 没启动，也打开窗口（用户稍后可手动重试）
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopPythonBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopPythonBackend();
  // 关闭项目时删除 API 请求历史
  try { fs.unlinkSync(getHistoryPath()); } catch (e) { /* 文件不存在则忽略 */ }
});
