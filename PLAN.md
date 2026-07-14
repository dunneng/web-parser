# 网页解析器 — ikSoft 反爬技术移植方案

## 保持不变的
- CSS 选择器：用户手动输入
- 翻页逻辑：`renderer/modules/batch.js` 手动设置
- 存储：`python/db.py` SQLite

## 要改的 6 项

### 1. CDP 网络拦截（核心）
**文件**: `preload.js` 或新建 `renderer/modules/cdp-interceptor.js`

利用 Electron 的 `webContents.debugger` 拦截网络响应：
```js
// 对目标 webview 开启 CDP
webview.webContents.debugger.attach('1.3');
webview.webContents.debugger.sendCommand('Network.enable');

// 监听所有响应
webview.webContents.debugger.on('message', (event, method, params) => {
  if (method === 'Network.responseReceived') {
    // 记录 requestId → URL 映射
  }
  if (method === 'Network.loadingFinished') {
    // 获取完整响应体
    debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
      .then(body => {
        // 自动解析 JSON → 存入采集结果
        try {
          const json = JSON.parse(body.body);
          onJsonResponse(params.requestId, json);
        } catch(e) {}
      });
  }
});
```

- 列表页：拦截搜索 API 返回的产品列表 JSON
- 详情页：拦截产品详情接口返回的完整数据

### 2. 独立窗口采集
**文件**: `renderer/modules/batch.js`

当前走 iframe → 改成 `BrowserWindow` 独立窗口：
- 当前：`<webview src="url">`
- 改成：`new BrowserWindow({ webPreferences: { preload: 'cdp-preload.js' } })`
- 独立窗口 = 独立 session，Cookie 隔离，不被父页面检测
- 采集完关闭窗口，释放内存

### 3. DOM 注入
**文件**: `webview-preload.js` 或新建 `renderer/modules/dom-injector.js`

注入自定义按钮到目标页面：
- 列表页：每行产品前加"采集"按钮
- 详情页：浮动工具条（采集/跳过/下一个）
- CSS 隔离避免被目标页面检测

### 4. 请求节流
**文件**: `renderer/modules/batch.js`

在翻页采集循环中加入间隔：
- UI 新增输入框 `#jiange_time`（默认 2000ms）
- 每次请求后 `await sleep(jiange_time)`
- 支持随机抖动（±20%）模拟人类行为

### 6. 鉴权令牌
**文件**: `preload.js` + `python/server.py`

ikSoft 模式：`CPU_ID` + `t_auth` 双层验证，防止未授权客户端调用后端 API。

简化到网页解析器：
- **启动时**：`preload.js` 生成随机令牌（`session_token`），存入 Electron session
- **每次 API 调用**：前端 `fetch` 自动带 `X-Auth-Token` 头
- **Python 后端**：`server.py` 添加中间件校验令牌
- **首次启动**：令牌为空时后端返回 401，前端自动生成并注册
- **防重放**：令牌 + 时间戳 + HMAC 签名

```python
# server.py
@app.middleware("http")
async def auth_middleware(request, call_next):
    token = request.headers.get("X-Auth-Token", "")
    if not validate_token(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)
```

```js
// preload.js
const crypto = require('crypto');
let sessionToken = crypto.randomBytes(32).toString('hex');

// 拦截所有 fetch，自动注入 token
const origFetch = window.fetch;
window.fetch = function(url, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers['X-Auth-Token'] = sessionToken;
  return origFetch(url, opts);
};
```
### 5. 资源过滤
**文件**: `webview-preload.js`

拦截不必要请求，加速页面加载：
- 屏蔽：图片（非产品图）、字体、分析脚本
- 保留：HTML、JS、XHR/Fetch、产品图片
- 通过 `webContents.session.webRequest.onBeforeRequest` 实现

## 执行顺序
1. 资源过滤 (5) → 先让页面加载更快
2. 请求节流 (4) → 加间隔防封
3. DOM 注入 (3) → UI 辅助
4. CDP 拦截 (1) → 核心数据获取
5. 独立窗口 (2) → 最终隔离方案
6. 鉴权 (6) → API 安全

## 文件改动清单
| 文件 | 改动 |
|------|------|
| `webview-preload.js` | +资源过滤 +DOM注入 |
| `renderer/modules/batch.js` | +请求节流 +独立窗口 |
| `preload.js` | +CDP拦截器 +鉴权令牌 |
| `renderer/index.html` | +节流输入框 |
| `renderer/app.js` | +CDP拦截器开关 |
| `python/server.py` | +令牌校验中间件 |
