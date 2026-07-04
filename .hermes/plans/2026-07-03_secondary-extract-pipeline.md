# 二次提取流水线 实现计划

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 从查询结果的链接列逐个打开详情页，用链路方案提取详情数据，追加到原表格。

**Architecture:** 表头右键标记链接列 + 选链路方案 → 串行逐页打开/提取/关闭 → 结果追加为新列。前端全流程控制，后端只复用现有 `/api/extract/chain`。

**Tech Stack:** JS (renderer), Python backend (已有 `chain_extract`)

---

## 核心流程

```
用户表头右键「链接」列 → 标记为提取源列
用户表头右键「🔗 二次提取配置」→ 弹窗选链路方案
用户点击「开始提取」→ 进度条 "3/20"
  每个URL: webview加载 → 等did-finish-load → chain_extract → 追加列
全部完成 → 表格刷新
```

---

## Task 1: 表头右键菜单加「设为链接列」+「二次提取配置」

**Objective:** 查询结果表头右键可以标记链接列，触发二次提取配置弹窗

**Files:**
- Modify: `renderer/modules/query-engine.js` — `renderQueryTable` 中的 thead 右键事件

**Step 1: 在 thead 上监听 contextmenu 事件**

在 `renderQueryTable` 函数中，修改 thead 的 contextmenu 事件处理（约 line 1240 附近已有表格右键），添加表头特有逻辑：

```javascript
// 表头右键
var th = e.target.closest('th');
if (th && th.dataset.colIdx !== undefined) {
  e.preventDefault();
  e.stopPropagation();
  var colIdx = parseInt(th.dataset.colIdx);
  var colName = th.textContent.replace('⠿', '').trim();
  showHeaderContextMenu(e.clientX, e.clientY, colIdx, colName);
  return;
}
```

**Step 2: 实现 `showHeaderContextMenu` 函数**

```javascript
function showHeaderContextMenu(x, y, colIdx, colName) {
  var old = document.getElementById('tableContextMenu');
  if (old) old.remove();
  
  var menu = document.createElement('div');
  menu.id = 'tableContextMenu';
  menu.className = 'context-menu';
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  
  var items = [];
  items.push({ label: '🔗 设为提取链接列', action: function() {
    S._secondaryExtractColIdx = colIdx;
    setStatus('已设置「' + colName + '」为链接列');
  }});
  
  if (S._secondaryExtractColIdx !== undefined) {
    items.push({ label: '⚙️ 二次提取配置...', action: function() {
      showSecondaryExtractDialog();
    }});
  }
  
  // 菜单渲染...
}
```

**Step 3: 初始化 state**

在 `state.js` 中添加：
```javascript
S._secondaryExtractColIdx = undefined;
S._secondaryExtractScheme = null;
S._secondaryExtractRunning = false;
```

---

## Task 2: 二次提取配置弹窗

**Objective:** 弹出弹窗让用户选择链路方案

**Files:**
- Modify: `renderer/app.js` — 新增函数
- Modify: `renderer/style.css` — 弹窗样式

**Step 1: 创建弹窗 HTML**

```javascript
function showSecondaryExtractDialog() {
  var old = document.getElementById('secondaryExtractDialog');
  if (old) old.remove();
  
  var dialog = document.createElement('div');
  dialog.id = 'secondaryExtractDialog';
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal-content" style="max-width:400px">
      <div class="modal-header">
        <span>二次提取配置</span>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <p style="font-size:12px;color:var(--text-dim);margin-bottom:8px">
          将对「${获取链接列名()}」列的每个URL，用选中的链路方案提取详情页数据
        </p>
        <select id="secExtractScheme" style="width:100%;...">
          ${chainSchemes.map(s => `<option>${s.name}</option>`).join('')}
        </select>
        <p style="font-size:11px;color:var(--text-dim);margin-top:8px">
          提取结果将作为新列追加到表格
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sm" id="btnSecExtractCancel">取消</button>
        <button class="btn btn-sm btn-accent" id="btnSecExtractStart">开始提取</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  
  // 事件绑定
  dialog.querySelector('.modal-close').addEventListener('click', function() { dialog.remove(); });
  dialog.querySelector('#btnSecExtractCancel').addEventListener('click', function() { dialog.remove(); });
  dialog.querySelector('#btnSecExtractStart').addEventListener('click', function() {
    var sel = dialog.querySelector('#secExtractScheme').value;
    S._secondaryExtractScheme = chainSchemes.find(function(s) { return s.name === sel; });
    dialog.remove();
    startSecondaryExtract();
  });
}
```

---

## Task 3: 串行提取引擎

**Objective:** 逐页加载URL，执行链路提取，合并结果

**Files:**
- Create: `renderer/modules/secondary-extract.js` — 核心提取逻辑
- Modify: `renderer/index.html` — 引入新模块

**Step 1: 核心提取函数**

```javascript
// modules/secondary-extract.js
window.Parser = window.Parser || {};
(function() {
  var S = window.Parser.state;
  
  async function startSecondaryExtract() {
    if (!S._secondaryExtractColIdx || !S._secondaryExtractScheme || !S.queryResults) return;
    S._secondaryExtractRunning = true;
    
    var scheme = S._secondaryExtractScheme;
    var colIdx = S._secondaryExtractColIdx;
    var results = S.queryResults;
    
    // 收集所有URL
    var headers = Object.keys(results[0]);
    var urlColName = headers[colIdx];
    var urls = results.map(function(r) { return r[urlColName]; }).filter(Boolean);
    
    if (urls.length === 0) { setStatus('链接列为空'); return; }
    
    showSecondaryProgress(0, urls.length);
    
    var extractResults = {}; // {rowIdx: {field: value, ...}}
    
    for (var i = 0; i < urls.length; i++) {
      if (!S._secondaryExtractRunning) break;
      
      showSecondaryProgress(i + 1, urls.length);
      
      try {
        // 加载页面
        document.getElementById('webview').loadURL(urls[i]);
        await waitForPageLoad(10000); // 10秒超时
        
        // 获取HTML
        var html = await document.getElementById('webview').executeJavaScript('document.documentElement.outerHTML');
        
        // 执行链路提取
        var resp = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/extract/chain', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            html: html,
            chain_type: scheme.chainType || 'css',
            deepest_selector: scheme.deepestSelector || '',
            fields: scheme.fields,
            child_delim: scheme.childDelimiter || ''
          })
        });
        var data = await resp.json();
        
        if (data.rows && data.rows.length > 0) {
          extractResults[i] = data.rows[0]; // 取第一行
        }
      } catch(e) {
        console.error('[二次提取] URL ' + i + ': ' + e.message);
      }
    }
    
    // 合并结果
    mergeSecondaryResults(extractResults, extractResults.length > 0 ? Object.keys(extractResults[Object.keys(extractResults)[0]]) : []);
    hideSecondaryProgress();
    S._secondaryExtractRunning = false;
  }
  
  function waitForPageLoad(timeout) {
    return new Promise(function(resolve) {
      var wv = document.getElementById('webview');
      var timer = setTimeout(function() { resolve(); }, timeout);
      var handler = function() {
        clearTimeout(timer);
        wv.removeEventListener('did-finish-load', handler);
        setTimeout(resolve, 1000); // 额外等1秒让JS渲染
      };
      wv.addEventListener('did-finish-load', handler);
    });
  }
  
  function showSecondaryProgress(current, total) {
    var bar = document.getElementById('secondaryProgress');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'secondaryProgress';
      bar.style.cssText = 'position:fixed;bottom:40px;right:20px;z-index:10000;background:var(--bg-card);border:1px solid var(--accent);border-radius:8px;padding:12px 16px;box-shadow:0 4px 20px rgba(0,0,0,0.3);min-width:200px';
      document.body.appendChild(bar);
    }
    bar.innerHTML = '<div style="font-size:12px;margin-bottom:4px">二次提取: ' + current + ' / ' + total + '</div>'
      + '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">'
      + '<div style="height:100%;width:' + (current/total*100) + '%;background:var(--accent);transition:width 0.3s"></div></div>'
      + '<button style="margin-top:4px;font-size:10px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:transparent;color:var(--text-dim);cursor:pointer" onclick="window._stopSecondaryExtract()">停止</button>';
  }
  
  function hideSecondaryProgress() {
    var bar = document.getElementById('secondaryProgress');
    if (bar) bar.remove();
  }
  
  window._stopSecondaryExtract = function() {
    S._secondaryExtractRunning = false;
  };
  
  // 导出
  window.Parser.secondary = { start: startSecondaryExtract };
})();
```

**Step 2: 在 index.html 中引入**

```html
<script src="modules/secondary-extract.js"></script>
```

---

## Task 4: 结果合并到查询表格

**Objective:** 提取结果作为新列追加到原表格

**Files:**
- Modify: `renderer/modules/secondary-extract.js`

```javascript
function mergeSecondaryResults(extractResults, newHeaders) {
  if (newHeaders.length === 0) return;
  
  // 在原数据中添加新列
  S.queryResults.forEach(function(row, i) {
    var ext = extractResults[i] || {};
    newHeaders.forEach(function(h) {
      row['【' + h + '】'] = ext[h] || ''; // 加前缀区分
    });
  });
  
  // 刷新表格
  var linkInfo = S._lastLinkageInfo;
  if (typeof renderQueryTable === 'function') renderQueryTable(S.queryResults, null, linkInfo);
  setStatus('二次提取完成，新增 ' + newHeaders.length + ' 列');
}
```

---

## Task 5: 样式补充

**Objective:** 弹窗和进度条样式

**Files:**
- Modify: `renderer/style.css`

```css
.modal-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0,0,0,0.5); z-index: 9998;
  display: flex; align-items: center; justify-content: center;
}
.modal-content {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 8px; box-shadow: 0 8px 40px rgba(0,0,0,0.3);
  min-width: 300px;
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  font-weight: 600; font-size: 14px;
}
.modal-body { padding: 16px; }
.modal-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 16px; border-top: 1px solid var(--border);
}
.modal-close {
  background: transparent; border: none; font-size: 18px;
  color: var(--text-dim); cursor: pointer;
}
```

---

## 验证步骤

1. 查询结果有链接列 → 表头右键 → 「🔗 设为提取链接列」
2. 表头右键 → 「⚙️ 二次提取配置」→ 选方案 → 「开始提取」
3. 看进度条 "1/10" → "2/10" → ... → 完成
4. 表格出现新列「【价格】」「【销量】」等
5. 点「停止」中断提取

---

## 风险

- **webview 复用**：串行提取期间会占用 webview，用户看不到当前浏览的页面。完成后恢复
- **超时处理**：10秒超时可能不够，大页面需要更久
- **反爬风险**：串行 + 当前 webview 加载，理论上模拟正常浏览，但过快可能触发
