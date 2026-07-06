/** v2026-06-21 chain-grouping */
/**
 * 网页源码解析器 — 渲染进程
 */
// 编辑器全部展开/折叠（全局函数，HTML onclick 调用）
window._editorExpandAll = function() {
  var ed = document.getElementById('elementEditor');
  if (!ed) return;
  // 展开合并组子行
  var rows = ed.querySelectorAll('.editor-merge-child');
  for (var i = 0; i < rows.length; i++) rows[i].style.display = '';
  var toggles = ed.querySelectorAll('.merge-toggle');
  for (var j = 0; j < toggles.length; j++) toggles[j].textContent = '\u25BE';
  // 展开标签分组
  var tagHeaders = ed.querySelectorAll('.editor-tag-header');
  for (var k = 0; k < tagHeaders.length; k++) {
    var tg = tagHeaders[k].querySelector('.editor-tag-toggle');
    if (tg) tg.textContent = '\u25BC';
    var next = tagHeaders[k].nextElementSibling;
    while (next && !next.classList.contains('editor-tag-header')) {
      next.style.display = '';
      next = next.nextElementSibling;
    }
  }
  // 重置折叠状态，避免下次渲染恢复
  window._collapsedTags = {};
};
window._editorCollapseAll = function() {
  var ed = document.getElementById('elementEditor');
  if (!ed) return;
  // 折叠合并组子行
  var rows = ed.querySelectorAll('.editor-merge-child');
  for (var i = 0; i < rows.length; i++) rows[i].style.display = 'none';
  var toggles = ed.querySelectorAll('.merge-toggle');
  for (var j = 0; j < toggles.length; j++) toggles[j].textContent = '\u25B8';
  // 折叠标签分组
  var allTags = {};
  var tagHeaders = ed.querySelectorAll('.editor-tag-header');
  for (var k = 0; k < tagHeaders.length; k++) {
    var tag = tagHeaders[k].dataset.tag || '';
    var tg = tagHeaders[k].querySelector('.editor-tag-toggle');
    if (tg) tg.textContent = '\u25B6';
    var next = tagHeaders[k].nextElementSibling;
    while (next && !next.classList.contains('editor-tag-header')) {
      next.style.display = 'none';
      next = next.nextElementSibling;
    }
    allTags[tag] = true;
  }
  window._collapsedTags = allTags;
};

(function () {
  'use strict';

  // 关闭窗口时清空全部数据
  window.addEventListener('beforeunload', function() {
    try { localStorage.clear(); } catch(e) {}
  });

  // 导出共享函数到全局作用域，供模块 IIFE 跨作用域调用
  //（函数声明已提升，此时已可访问所有 app.js 内部函数）
  window.setStatus = setStatus;
  window.escapeHtml = escapeHtml;
  window.hideAllPanels = hideAllPanels;
  window.buildTree = buildTree;
  window.toLocalHtmlUrl = toLocalHtmlUrl;
  window.updateApiBodyVisibility = updateApiBodyVisibility;
  window.addApiHeaderRow = addApiHeaderRow;
  window.sendApiRequest = sendApiRequest;
  window.loadCookieForApi = loadCookieForApi;
  window.saveSelectorRules = saveSelectorRules;
  window.registerElements = registerElements;
  window.renderSourceInResults = renderSourceInResults;
  window.renderQueryFromItems = renderQueryFromItems;
  window.showExtractPanel = showExtractPanel;
  window.saveCurrentSettings = saveCurrentSettings;
  window.updatePickedTreeNodes = updatePickedTreeNodes;
  window.showPickedElementsPanel = showPickedElementsPanel;

  // 模块函数导出到 window（来自模块 Parser 命名空间）
  window.renderQueryTable = Parser.query.renderTable;
  window.closeBatchModal = Parser.batch.closeModal;
  window.sleep = Parser.batch.sleep;
  window.updateRowSelection = Parser.query.updateRowSelection;
  window.startPickMode = Parser.extractor.startPickMode;
  window.stopPickMode = Parser.extractor.stopPickMode;

  // 预初始化模块引用的共享对象（模块 load 函数在 var 声明前调用）
  window.behave = {};
  window.collector = {};

  // ── 状态/工具已迁移到 modules/state.js & modules/utils.js ──
  // 通过 Parser.state.xxx / Parser.utils.xxx 访问

  // ──────── Stealth 脚本定义 ────────
  var STEALTH_SCRIPTS = [
    { id: 'canvas', label: 'Canvas 指纹加噪', desc: 'toDataURL/getImageData 加微量噪声', defaultOn: true },
    { id: 'webgl', label: 'WebGL 指纹统一', desc: '统一渲染器和供应商字符串', defaultOn: true },
    { id: 'webrtc', label: 'WebRTC 屏蔽', desc: '禁用 RTCPeerConnection，防内网 IP 泄漏', defaultOn: true },
    { id: 'cdp', label: 'CDP 变量清理', desc: '清理 CDP 调试残留变量', defaultOn: true },
    { id: 'navigator', label: 'Navigator 属性补全', desc: '统一 platform/vendor/deviceMemory 等', defaultOn: true },
    { id: 'audio', label: 'Audio 指纹加噪', desc: 'AudioContext 振荡器频率微调', defaultOn: false },
    { id: 'font', label: '字体枚举限制', desc: '限制 measureText 精度 + 屏蔽 queryLocalFonts', defaultOn: false },
    { id: 'permissions', label: 'Permissions 伪装', desc: 'permissions.query 返回一致结果', defaultOn: false },
    { id: 'ua', label: 'UA 随机切换', desc: '每次加载随机切换 Chrome User-Agent', defaultOn: false, global: true },
    { id: 'autocookie', label: '自动加载 Cookie', desc: '匹配域名自动加载已保存的 Cookie', defaultOn: true, global: true },
  ];
  var STEALTH_INJECT_IDS = ['canvas', 'webgl', 'webrtc', 'audio', 'font', 'cdp', 'navigator', 'permissions'];
  // _stealthData 已迁移到 Parser.state._stealthData
  // 同步到 Parser.state
  Parser.state.STEALTH_SCRIPTS = STEALTH_SCRIPTS;
  Parser.state.STEALTH_INJECT_IDS = STEALTH_INJECT_IDS; // { defaultScripts: [...], domains: { 'taobao.com': [...] } }

  // ──────── DOM 引用 ────────
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const urlInput = $('#urlInput');
  const btnGo = $('#btnGo');
  const btnFetch = $('#btnFetch');
  const btnRefresh = $('#btnRefresh');
  const btnElementPicker = $('#btnElementPicker');
  const btnManagePickedHeader = $('#btnManagePicked');
  const webview = $('#webview');
  const webviewOverlay = $('#webviewOverlay');
  const cookieStatus = $('#cookieStatus');
  const pageInfo = $('#pageInfo');
  const treeContent = $('#treeContent');
  const contentTitle = $('#contentTitle');
  const contentBody = $('#contentBody');
  const contentEmpty = $('#contentEmpty');
  const editorContainer = $('#editorContainer');
  const queryContainer = $('#queryContainer');
  const domTreeContainer = $('#domTreeContainer');
  const jsonViewerContainer = $('#jsonViewerContainer');
  const queryResultsDiv = $('#queryResults');
  const queryInput = $('#queryInput');
  const btnQuery = $('#btnQuery');
  const querySearch = $('#querySearch');
  const queryCheckAll = $('#queryCheckAll');
  const btnExportQuery = $('#btnExportQuery');
  const globalChildDelimInput = $('#globalChildDelim');
  const globalMultiDelimInput = $('#globalMultiDelim');
  const maxTextLenInput = $('#maxTextLen');
  const maxDomDepthInput = $('#maxDomDepth');
  const maxDomChildrenInput = $('#maxDomChildren');
  const maxResultsInput = $('#maxResults');
  const maxSourcePreviewInput = $('#maxSourcePreview');
  const maxCellTextInput = $('#maxCellText');
  const chainPreviewLimitInput = $('#chainPreviewLimit');
  const collectMaxFieldsInput = $('#collectMaxFields');
  const networkMaxAllInput = $('#networkMaxAll');
  const settingsModal = $('#settingsModal');
  const btnSettingsModalClose = $('#btnSettingsModalClose');
  const btnSettingsClose = $('#btnSettingsClose');
  const btnSaveSource = $('#btnSaveSource');
  const statusText = $('#statusText');
  const statusDomain = $('#statusDomain');
  const statusCookie = $('#statusCookie');
  const statusSizeChars = $('#statusSizeChars');
  const statusSizeLines = $('#statusSizeLines');
  const statusTime = $('#statusTime');
  const resizeHandle = $('#resizeHandle');
  const panelLeft = $('#panelLeft');
  const panelRight = $('#panelRight');
  var btnClipboard = $('#btnClipboard');
  const elementPickerBar = $('#elementPickerBar');
  const pickedCount = $('#pickedCount');
  const btnPickAuto = $('#btnPickAuto');
  const btnExportPicked = $('#btnRegisterPicked');
  const btnStopPick = $('#btnStopPick');
  // 批量抓取相关
  const btnBatch = $('#btnBatch');
  const btnBatchLoadAll = $('#btnBatchLoadAll');
  const batchModal = $('#batchModal');
  const btnBatchModalClose = $('#btnBatchModalClose');
  const btnBatchCancel = $('#btnBatchCancel');
  const btnBatchConfirm = $('#btnBatchConfirm');
  const batchTagsPanel = $('#batchTagsPanel');
  const batchTagsResize = $('#batchTagsResize');
  const batchTagsList = $('#batchTagsList');
  const batchTagsCount = $('#batchTagsCount');
  const btnBatchClearDone = $('#btnBatchClearDone');
  const btnBatchContinue = $('#btnBatchContinue');
  // API 接入相关
  const batchModeApi = $('#batchModeApi');
  const batchSharedConfig = $('#batchSharedConfig');
  const apiUrl = $('#apiUrl');
  const apiMethod = $('#apiMethod');
  const apiTimeout = $('#apiTimeout');
  const apiHeadersList = $('#apiHeadersList');
  const btnAddHeader = $('#btnAddHeader');
  const apiBody = $('#apiBody');
  const apiBodyGroup = $('#apiBodyGroup');
  const btnApiSend = $('#btnApiSend');
  const apiUseCookie = $('#apiUseCookie');
  const apiCookieHint = $('#apiCookieHint');
  const btnApiLoadCookie = $('#btnApiLoadCookie');
  // 批量抓取 — 实时预览
  const batchUrlPreview = $('#batchUrlPreview');
  const batchUrlPreviewCount = $('#batchUrlPreviewCount');
  const batchUrlPreviewList = $('#batchUrlPreviewList');
  const batchUrlListPreview = $('#batchUrlListPreview');
  const batchUrlListPreviewCount = $('#batchUrlListPreviewCount');
  const batchUrlListPreviewList = $('#batchUrlListPreviewList');
  // 批量抓取 — 动态等待策略
  const batchDynamicConfig = $('#batchDynamicConfig');
  const batchDynamicStrategy = $('#batchDynamicStrategy');
  const batchDynamicOptsFixed = $('#batchDynamicOptsFixed');
  const batchDynamicOptsIdle = $('#batchDynamicOptsIdle');
  const batchDynamicOptsSelector = $('#batchDynamicOptsSelector');
  const batchDynamicOptsClickNext = $('#batchDynamicOptsClickNext');
  // 批量抓取 — 本地文件
  const batchLocalDrop = $('#batchLocalDrop');
  const btnBatchPickFiles = $('#btnBatchPickFiles');
  const batchLocalFileInput = $('#batchLocalFileInput');
  const batchLocalPreview = $('#batchLocalPreview');
  const batchLocalPreviewCount = $('#batchLocalPreviewCount');
  const batchLocalPreviewList = $('#batchLocalPreviewList');
  const btnBatchLocalClear = $('#btnBatchLocalClear');
  var batchLocalFiles = []; // { name, path }
  // 数据采集相关
  const collectorFloat = $('#paginationFloat');
  const pfGear = $('#pfGear');
  const pfPrev = $('#pfPrev');
  const pfNext = $('#pfNext');
  const pfPage = $('#pfPage');
  const pfCollect = $('#pfCollect');
  const pfCount = $('#pfCount');
  const collectorConfig = $('#paginationConfig');
  const pfConfigClose = $('#pfConfigClose');
  const pfConfigConfirm = $('#pfConfigConfirm');
  const pfApiUrl = $('#pfApiUrl');
  const pfApiUrlList = $('#pfApiUrlList');
  const pfTabScroll = $('#pfTabScroll');
  const pfTabApi = $('#pfTabApi');
  // 表单交互弹框
  const formModal = $('#formModal');
  const formModalTitle = $('#formModalTitle');
  const formModalBody = $('#formModalBody');
  const btnFormModalClose = $('#btnFormModalClose');
  const btnFormModalCancel = $('#btnFormModalCancel');
  const btnFormReset = $('#btnFormReset');
  const btnFormSubmit = $('#btnFormSubmit');

  // 元素提取增强
  const btnPickModeClick = $('#btnPickModeClick');
  const btnPickModeDrag = $('#btnPickModeDrag');
  const btnPickModeNested = $('#btnPickModeNested');
  const pickModeSwitch = document.querySelector('.picker-mode-switch');
  const btnManagePicked = $('#btnManagePicked');
  const elementEditor = $('#elementEditor');
  const elementEditorBody = $('#elementEditorBody');
  const btnEditorRematchAll = $('#btnEditorRematchAll');
  const btnEditorSave = $('#btnEditorSave');
  const btnEditorClose = $('#btnEditorClose');
  const selectorModal = $('#selectorModal');
  const selectorOptions = $('#selectorOptions');
  const btnSelectorCancel = $('#btnSelectorCancel');
  const btnSelectorModalClose = $('#btnSelectorModalClose');
  const nestedModal = $('#nestedModal');
  const nestedOptions = $('#nestedOptions');
  const btnNestedCancel = $('#btnNestedCancel');
  const btnNestedModalClose = $('#btnNestedModalClose');
  // 自定义导出方案弹框
  const schemaModal = $('#schemaModal');
  const schemaName = $('#schemaName');
  const manualSchemeTriggerText = $('#manualSchemeTriggerText');
  const manualSchemeOptions = $('#manualSchemeOptions');
  const schemaFieldsList = $('#schemaFieldsList');


  const schemaPreviewWrap = $('#schemaPreviewWrap');
  const schemaPreviewInfo = $('#schemaPreviewInfo');
  const btnAddField = $('#btnAddField');
  const btnSchemaSave = $('#btnSchemaSave');
  const btnSchemaDelete = $('#btnSchemaDelete');
  const btnSchemaImport = $('#btnSchemaImport');
  const btnSchemaExport = $('#btnSchemaExport');
  const btnSchemaPreview = $('#btnSchemaPreview');
  const btnSchemaCancel = $('#btnSchemaCancel');
  const btnSchemaExportData = $('#btnSchemaExportData');
  const btnSchemaSaveQuery = $('#btnSchemaSaveQuery');
  const btnSchemaModalClose = $('#btnSchemaModalClose');
  const schemaFileInput = $('#schemaFileInput');
  // 链路面板
  const schemaTabManual = $('#schemaTabManual');
  const schemaTabChain = $('#schemaTabChain');
  const schemaManualPanel = $('#schemaManualPanel');
  const schemaChainPanel = $('#schemaChainPanel');
  const schemaChainInput = $('#schemaChainInput');
  const btnParseChain = $('#btnParseChain');
  const btnTraceChain = $('#btnTraceChain');
  const chainStripId = $('#chainStripId');
  const chainStripBare = $('#chainStripBare');
  const chainTraceResult = $('#chainTraceResult');
  const schemaChainLayers = $('#schemaChainLayers');


  // ── 剪贴板/批量/API 状态已迁移到 modules/state.js ──

  function addToClipboard(text, source) {
    if (!text) return;
    text = String(text).substring(0, 10000);
    // 去重复
    Parser.state.clipboardHistory = Parser.state.clipboardHistory.filter(function(item) { return item.text !== text; });
    Parser.state.clipboardHistory.unshift({ text: text, source: source || '未知', time: new Date().toLocaleTimeString() });
    if (Parser.state.clipboardHistory.length > Parser.state.CLIPBOARD_MAX) Parser.state.clipboardHistory.pop();
    // 同步到系统剪贴板
    window.api.writeClipboard(text);
    renderClipboardPanel();
  }

  // ── showToast 已迁移到 modules/utils.js，使用 Parser.utils.showToast ──

  // ──────── Ctrl+C 拦截 ────────
  document.addEventListener('keydown', function(e) {
    if (!e.ctrlKey || e.key !== 'c' || e.key === undefined) return;
    // 跳过输入框内（input/textarea 的 Ctrl+C 正常走系统）
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

    // 先检查普通 DOM 选中
    var domSel = window.getSelection().toString().trim();
    if (domSel) {
      addToClipboard(domSel, 'Ctrl+C');
      Parser.utils.showToast('已加入剪贴板');
      return;
    }

    // 再从 webview 获取选中文本
    try {
      webview.executeJavaScript('window.getSelection().toString()').then(function(sel) {
        if (sel && sel.trim()) {
          addToClipboard(sel.trim(), 'Ctrl+C');
          Parser.utils.showToast('已加入剪贴板');
        }
      }).catch(function() {});
    } catch (_) {}
  });

  // ──────── 已注册元素系统 ────────

  var _registeredElementsCache = null;

  async function registerElements() {
    // 从 webview 读取自动匹配的元素
    var autoMatched = [];
    try {
      var autoRaw = await document.getElementById("webview").executeJavaScript(
        'JSON.stringify(window.__parserAutoMatched || [])'
      );
      autoMatched = JSON.parse(autoRaw || '[]');
    } catch(e) { autoMatched = []; }

    // 收集所有未注册的 Parser.state.editorItems（排除标签头）
    var unregistered = Parser.state.editorItems.filter(function(item) {
      return !item._isTagHeader && !item._registered;
    });
    if (unregistered.length === 0 && autoMatched.length === 0) {
      console.log('[注册诊断] 提前返回: unregistered=' + unregistered.length + ' autoMatched=' + autoMatched.length);
      setStatus('没有需要注册的新元素');
      return;
    }
    console.log('[注册诊断] 即将注册: unregistered=' + unregistered.length + ' autoMatched=' + autoMatched.length);
    var totalCount = unregistered.length + autoMatched.length;
    setStatus('正在注册 ' + totalCount + ' 个元素...');
    if (btnExportPicked) { btnExportPicked.disabled = true; btnExportPicked.textContent = '注册中...'; }

    var payload = [];
    // 获取当前页面 URL
    var pageUrl = '';
    try { pageUrl = await document.getElementById('webview').executeJavaScript('window.location.href') || ''; } catch(e) {}
    for (var i = 0; i < unregistered.length; i++) {
      var item = unregistered[i];
      var ei = item.elementInfo || {};
      // 合并/拆分组：展开子元素逐个注册
      if (item.isGroup && item.children && item.children.length > 0) {
        for (var ci = 0; ci < item.children.length; ci++) {
          var child = item.children[ci];
          var cei = child.elementInfo || {};
          var childDedupKey = (child.selector || '') + '||' + (cei.src || '') + '||' + (cei.href || '') + '||' + Parser.utils.normalizeText(cei.text || '').substring(0, Parser.state.maxCellText);
          payload.push({
            dedupKey: childDedupKey,
            outerHTML: cei.outerHTML || '',
            selector: child.selector || '',
            xpath: child.xpath || '',
            source: child.source || item.source || '',
            tag: cei.tag || '',
            text: cei.text || '',
            className: cei.class || '',
            elementId: cei.id || '',
            href: cei.href || '',
            src: cei.src || '',
            page_url: pageUrl
          });
        }
        continue;
      }
      // 计算去重 key（与 addToEditor 一致，使用 normalizeText）
      var dedupKey = item.selector + '||' + (ei.src || '') + '||' + (ei.href || '') + '||' + Parser.utils.normalizeText(ei.text || '').substring(0, Parser.state.maxCellText);
      payload.push({
        dedupKey: dedupKey,
        outerHTML: ei.outerHTML || '',
        selector: item.selector || ei.css || '',
        xpath: item.xpath || ei.xpath || '',
        source: item.source || '',
        tag: ei.tag || '',
        text: ei.text || '',
        className: String(ei.class || ''),
        elementId: ei.id || '',
        href: ei.href || '',
        src: ei.src || '',
        page_url: pageUrl
      });
    }

    // 处理自动匹配的元素（去重后加入 payload）
    for (var ai = 0; ai < autoMatched.length; ai++) {
      var am = autoMatched[ai];
      var amDedupKey = (am.css || '') + '||' + (am.src || '') + '||' + (am.href || '') + '||' + Parser.utils.normalizeText(am.text || '').substring(0, Parser.state.maxCellText);
      // 跳过 payload 中已有的（含 editorItems 的）
      var dup = false;
      for (var pi = 0; pi < payload.length; pi++) {
        if (payload[pi].dedupKey === amDedupKey) { dup = true; break; }
      }
      if (dup) continue;
      payload.push({
        dedupKey: amDedupKey,
        outerHTML: am.outerHTML || '',
        selector: am.css || '',
        xpath: am.xpath || '',
        source: 'auto',
        tag: am.tag || '',
        text: am.text || '',
        className: String(am.class || ''),
        elementId: String(am.id || ''),
        href: am.href || '',
        src: am.src || '',
        page_url: pageUrl
      });
    }

    try {
      console.log('[注册调试] payload长度=' + payload.length + ' 首条=' + JSON.stringify(payload[0] || {}).substring(0, 200));
      console.log('[注册调试] 完整body长度=' + JSON.stringify({elements:payload}).length);
      var resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/elements/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: payload })
      });
      if (!resp.ok) {
        var errText = '';
        try { errText = await resp.text(); } catch (_) {}
        console.error('[注册调试] HTTP ' + resp.status + ' body: ' + errText.substring(0, 500));
        throw new Error('注册失败: ' + resp.status);
      }
      var result = await resp.json();
      // 标记已注册
      for (var j = 0; j < unregistered.length; j++) {
        unregistered[j]._registered = true;
      }
      _registeredElementsCache = null; // 刷新缓存
      var msg = '注册完成: 新增 ' + (result.registered || []).length + ' 个, 更新 ' + (result.updated || []).length + ' 个';
      if ((result.skipped || []).length > 0) msg += ', 跳过 ' + result.skipped.length + ' 个';
      setStatus(msg);
      // 先展示已注册面板（更重要的反馈），编辑器渲染用 rAF 延迟避免同步阻塞
      fetchRegisteredElements().then(function() { showRegisteredElementsPanel(); });
      requestAnimationFrame(function() {
        Parser.extractor.renderElementEditor();
        updatePickedTreeNodes();
      });
    } catch (e) {
      setStatus('注册失败: ' + e.message);
    } finally {
      if (btnExportPicked) { btnExportPicked.disabled = false; btnExportPicked.textContent = '注册'; }
    }
  }

  function _updateTreeRegisteredCount(count) {
    // 精准更新树中"手动采集"的计数，避免 buildTree 重建整棵树
    var labels = treeContent.querySelectorAll('.node-label');
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].textContent === '手动采集') {
        var countEl = labels[i].parentElement.querySelector('.node-count');
        if (countEl) countEl.textContent = count;
        break;
      }
    }
  }

  async function fetchRegisteredElements() {
    try {
      var resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/elements');
      if (!resp.ok) return;
      var data = await resp.json();
      Parser.state.registeredElements = data.elements || [];
      _registeredElementsCache = Parser.state.registeredElements;
      _updateTreeRegisteredCount(Parser.state.registeredElements.length);
    } catch (e) {}
  }

  async function clearRegisteredElements() {
    try {
      await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/elements', { method: 'DELETE' });
      Parser.state.registeredElements = [];
      _registeredElementsCache = null;
      setStatus('已清空注册表');
      // 取消 Parser.state.editorItems 的注册标记
      Parser.state.editorItems.forEach(function(item) { item._registered = false; });
      Parser.extractor.renderElementEditor();
      _updateTreeRegisteredCount(0);
    } catch (e) {
      setStatus('清空失败: ' + e.message);
    }
  }

  function showRegisteredElementsPanel() {
    hideAllPanels();
    queryContainer.classList.remove('hidden');
    queryContainer.dataset.mode = 'registered-elements';
    contentTitle.textContent = '已注册元素 (' + Parser.state.registeredElements.length + '个)';
    showQueryInputRow();
    if (Parser.state.registeredElements.length === 0) {
      queryResultsDiv.innerHTML = '<div class="tree-empty">没有已注册元素，请先在编辑器中框选元素并点击"注册"</div>';
      return;
    }
    // 已注册元素面板已初始化，直接构建表格
    // 构建表格数据 — 展示所有属性
    var rows = Parser.state.registeredElements.map(function(elem) {
      var p = elem.parsed || {};
      var row = {
        '序号': elem.id,
        '标签': elem.tag || p.tag || '',
        '选择器': elem.selector || '',
        '文本': (elem.text || p.text || '').substring(0, 200),
        '来源': elem.source || '',
      };
      // 展平 parsed 中所有属性
      for (var pk in p) {
        if (p.hasOwnProperty(pk)) {
          var pv = p[pk];
          if (typeof pv === 'object' && pv !== null && !Array.isArray(pv)) {
            // 展平嵌套对象（如 stats）
            for (var sk in pv) {
              if (pv.hasOwnProperty(sk)) row[pk + '_' + sk] = pv[sk];
            }
          } else {
            row[pk] = pv;
          }
        }
      }
      // 展平 elem 自身其他属性（排除已处理的）
      var BASIC = {id:1,tag:1,selector:1,text:1,source:1,parsed:1,dedupKey:1,outerHTML:1,xpath:1,className:1,elementId:1,href:1,src:1};
      for (var ek in elem) {
        if (elem.hasOwnProperty(ek) && !BASIC[ek]) {
          row[ek] = elem[ek];
        }
      }
      return row;
    });

    // 工具栏 — 与其他树面板一致
    var actionsEl = document.getElementById('contentActions');
    if (actionsEl) {
      actionsEl.innerHTML = '';
      actionsEl.style.display = 'flex';
      actionsEl.style.gap = '4px';

      var exportBtn = document.createElement('button');
      exportBtn.className = 'btn btn-sm btn-accent';
      exportBtn.textContent = '导出';
      exportBtn.addEventListener('click', function() { exportQueryResults(); });

      var clearBtn = document.createElement('button');
      clearBtn.className = 'btn btn-sm';
      clearBtn.textContent = '清空';
      clearBtn.style.color = 'var(--text-dim)';
      clearBtn.addEventListener('click', function() {
        if (confirm('确定清空所有已注册元素？')) clearRegisteredElements();
      });

      actionsEl.appendChild(exportBtn);
      actionsEl.appendChild(clearBtn);
    }

    Parser.state.queryResults = rows;
    renderQueryTable(rows);
    setStatus('已注册元素: ' + Parser.state.registeredElements.length + ' 个');
  }

  async function showCollectedDataPanel(source) {
    // 自动激活对应的采集模式
    var tab = source === 'api' ? 'api' : 'scroll';
    if (!collector.active || collector.tab !== tab) {
      activateCollector(tab, 'auto');
    }
    try {
      var resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/collect/data');
      if (!resp.ok) {
        hideAllPanels();
        queryContainer.classList.remove('hidden');
        queryContainer.dataset.mode = 'collected-' + source;
        contentTitle.textContent = (source === 'api' ? 'API采集' : '滚动采集') + ' (0条)';
        showQueryInputRow();
        setStatus('获取采集数据失败');
        return;
      }
      var data = await resp.json();
      var collections = data.collections || [];
      var allRows = [];
      for (var i = 0; i < collections.length; i++) {
        if (collections[i].source !== source) continue;
        try {
          var r2 = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/collect/data?collect_id=' + collections[i].collect_id);
          if (r2.ok) {
            var d2 = await r2.json();
            if (d2.rows && d2.rows.length > 0) {
              allRows = allRows.concat(d2.rows);
            }
          }
        } catch (e) {}
      }
      hideAllPanels();
      queryContainer.classList.remove('hidden');
      queryContainer.dataset.mode = 'collected-' + source;
      contentTitle.textContent = (source === 'api' ? 'API采集' : '滚动采集') + ' (' + allRows.length + '条)';
      showQueryInputRow();
      if (allRows.length === 0) {
        // 后端无数据，用内存中的采集结果兜底
        if (source === 'api' && collector.api.allRows.length > 0) {
          allRows = collector.api.allRows;
        } else if (source === 'scroll' && collector.scroll.allRows && collector.scroll.allRows.length > 0) {
          allRows = collector.scroll.allRows;
        } else {
          queryResultsDiv.innerHTML = '<div class="tree-empty">暂无' + (source === 'api' ? 'API' : '滚动') + '采集数据</div>';
          return;
        }
      }
      Parser.state.queryResults = allRows;
      renderQueryTable(allRows);
      setStatus((source === 'api' ? 'API' : '滚动') + '采集数据: ' + allRows.length + ' 条');
    } catch (e) {
      setStatus('获取采集数据失败: ' + e.message);
    }
  }

  // ──────── 初始化 ────────
  async function init() {
    // 清空上次采集数据
    collector.api.allRows = [];
    collector.api.collectedData = [];
    collector.scroll.allRows = [];
    collector.scroll.collectedData = [];
    Parser.state._apiDataCount = 0;
    Parser.state._scrollDataCount = 0;
    queryContainer.classList.add('hidden');
    try { Parser.state.pythonPort = await window.api.pythonPort(); } catch (e) { }
    // 加载持久化设置
    await loadSettings();
    // 设置 webview preload 路径
    try {
      var pp = await window.api.webviewPreloadPath();
      webview.setAttribute('preload', pp);
    } catch (e) {}
    // 加载 API 历史
    try { Parser.state.apiHistory = await window.api.apiHistoryLoad(); } catch (e) { Parser.state.apiHistory = []; }
    // 从设置中恢复分隔符等（已在 loadSettings 中处理）
    bindToolbarEvents();
    bindWebviewEvents();
    bindWheelPassthrough();
    bindResizeEvents();
    bindTreeEvents();
    Parser.query.bindEvents();
    bindExportEvents();
    Parser.extractor.bindPickerEvents();
    bindClipboardEvents();
    bindContextMenus();
    Parser.batch.bindEvents();
    Parser.extractor.bindEnhancedPickerEvents();
    bindSchemaEvents();
    _bindExportLinksBtn();
    // 规则模式切换
    Parser.state._ruleMode = Parser.state._ruleMode || 'list';
    var btnList = document.getElementById('btnRuleModeList');
    var btnDetail = document.getElementById('btnRuleModeDetail');
    if (btnList && btnDetail) {
      btnList.addEventListener('click', function() {
        btnList.classList.add('active'); btnDetail.classList.remove('active');
        Parser.state._ruleMode = 'list';
        if (Parser.state._listPageUrl) {
          document.getElementById('webview').loadURL(Parser.state._listPageUrl);
          setStatus('已切换到列表模式');
        }
      });
      btnDetail.addEventListener('click', function() {
        btnDetail.classList.add('active'); btnList.classList.remove('active');
        Parser.state._ruleMode = 'detail';
        var batchArea = document.getElementById('batchUrlList');
        var firstUrl = batchArea ? (batchArea.value||'').trim().split('\n')[0] : '';
        if (firstUrl) {
          document.getElementById('webview').loadURL(firstUrl);
          setStatus('已切换到详情模式');
        }
      });
    }
    // 菜单栏动作
    window.api.onMenuAction(function(action, arg) {
      if (action === 'clipboard') showClipboardPicker();
      if (action === 'settings') { if (typeof openSettingsModal === 'function') openSettingsModal(arg); }
      if (action === 'clear-cookie') { window.api.cookieClearAll().then(function(r) { setStatus('已清除 ' + (r && r.count) + ' 条 Cookie'); }); }
      if (action === 'save-source') saveSource();
      if (action === 'export-excel') exportToExcel();
      if (action === 'history') { if (!Parser.state.historyPanelVisible) toggleHistoryPanel(); }
      if (action === 'toggle-browser') {
        if (panelRight.classList.contains('hidden')) {
          panelRight.classList.remove('hidden');
          resizeHandle.classList.remove('hidden');
        } else {
          // 隐藏 webview 时自动退出提取模式
          if (Parser.state.pickModeActive) { stopPickMode(); }
          panelRight.classList.add('hidden');
          resizeHandle.classList.add('hidden');
        }
      }
    });
    // 应用退出前清理 localStorage
    if (window.api.onCleanup) {
      window.api.onCleanup(function() {
        try { localStorage.clear(); } catch (e) {}
      });
    }
    // 剪贴板按钮
    if (btnClipboard) {
      btnClipboard.addEventListener('click', function() {
        showClipboardPicker();
      });
    }
    // 预加载默认树
    buildDefaultTree();
    // CDP 预注入：在所有页面脚本之前植入 stealth 包装
    Parser.stealth.setupCdpStealthInjection();
    setStatus('就绪');
  }

  // ──────── 设置持久化 ────────
  async function loadSettings() {
    try {
      var settings = await window.api.settingsLoad();
      if (settings.globalChildDelim !== undefined) { Parser.state.globalChildDelim = settings.globalChildDelim; globalChildDelimInput.value = settings.globalChildDelim; }
      if (settings.globalMultiDelim !== undefined) { Parser.state.globalMultiDelim = settings.globalMultiDelim; globalMultiDelimInput.value = settings.globalMultiDelim; }
      if (settings.maxTextLen !== undefined) { Parser.state.maxTextLen = settings.maxTextLen; maxTextLenInput.value = settings.maxTextLen; }
      if (settings.maxDomDepth !== undefined) { Parser.state.maxDomDepth = settings.maxDomDepth; maxDomDepthInput.value = settings.maxDomDepth; }
      if (settings.maxDomChildren !== undefined) { Parser.state.maxDomChildren = settings.maxDomChildren; maxDomChildrenInput.value = settings.maxDomChildren; }
      if (settings.maxResults !== undefined) { Parser.state.maxResults = settings.maxResults; maxResultsInput.value = settings.maxResults; }
      if (settings.maxSourcePreview !== undefined) { Parser.state.maxSourcePreview = settings.maxSourcePreview; maxSourcePreviewInput.value = settings.maxSourcePreview; }
      if (settings.maxCellText !== undefined) { Parser.state.maxCellText = settings.maxCellText; maxCellTextInput.value = settings.maxCellText; }
      if (settings.chainPreviewLimit !== undefined) { Parser.state.chainPreviewLimit = settings.chainPreviewLimit; chainPreviewLimitInput.value = settings.chainPreviewLimit; }
      if (settings.inlineMergeDelim !== undefined) { Parser.state.inlineMergeDelim = settings.inlineMergeDelim; }
      if (settings.splitMaxDepth !== undefined) { Parser.state.splitMaxDepth = settings.splitMaxDepth; }
      if (settings.linkageEnabled !== undefined) { Parser.state.linkageEnabled = settings.linkageEnabled; var ls = document.getElementById('linkageSwitch'); if (ls) ls.checked = settings.linkageEnabled; }
      // 主题
      var theme = settings.theme || 'dark';
      document.body.classList.remove('theme-light');
      if (theme === 'light') document.body.classList.add('theme-light');
      var ts = document.getElementById('themeToggleSwitch');
      if (ts) ts.checked = (theme === 'light');
    } catch (e) { /* 首次启动无设置文件 */ }
  }

  async function saveCurrentSettings() {
    try {
      var settings = {
        globalChildDelim: Parser.state.globalChildDelim,
        globalMultiDelim: Parser.state.globalMultiDelim,
        maxTextLen: Parser.state.maxTextLen,
        maxDomDepth: Parser.state.maxDomDepth,
        maxDomChildren: Parser.state.maxDomChildren,
        maxResults: Parser.state.maxResults,
        maxSourcePreview: Parser.state.maxSourcePreview,
        maxCellText: Parser.state.maxCellText,
        chainPreviewLimit: Parser.state.chainPreviewLimit,
        inlineMergeDelim: Parser.state.inlineMergeDelim,
        splitMaxDepth: Parser.state.splitMaxDepth,
        linkageEnabled: !!(document.getElementById('linkageSwitch')?.checked),
        theme: document.body.classList.contains('theme-light') ? 'light' : 'dark',
      };
      await window.api.settingsSave(settings);
    } catch (e) {}
  }

  function toggleTheme() {
    if (document.body.classList.contains('theme-light')) {
      document.body.classList.remove('theme-light');
    } else {
      document.body.classList.add('theme-light');
    }
    saveCurrentSettings();
  }
  Parser.toggleTheme = toggleTheme;
  Parser.saveCurrentSettings = saveCurrentSettings;

  // ──────── 工具栏事件 ────────
  function bindToolbarEvents() {
    btnGo.addEventListener('click', () => {
      let url = urlInput.value.trim();
      if (!url) return;
      if (isLocalPath(url)) {
        url = toLocalHtmlUrl(url);
        urlInput.value = url;
      } else if (!/^https?:\/\//i.test(url) && !/^local-html:\/\//i.test(url)) {
        url = 'https://' + url;
        urlInput.value = url;
      }
      navigateToUrl(url);
    });
    urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnGo.click(); });

    // ── 拖拽本地文件到窗口 ──
    document.addEventListener('dragover', function(e) { e.preventDefault(); e.stopPropagation(); });
    document.addEventListener('drop', function(e) {
      e.preventDefault(); e.stopPropagation();
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || files.length === 0) return;
      var urlVal = urlInput.value.trim();
      if (urlVal) return; // URL 不为空时忽略拖拽
      var htmlFiles = [];
      for (var fi = 0; fi < files.length; fi++) {
        if (/\.html?$/i.test(files[fi].name)) {
          htmlFiles.push({ name: files[fi].name, path: window.api.getPathForFile(files[fi]) });
        }
      }
      if (htmlFiles.length === 0) return;
      if (htmlFiles.length === 1) {
        var localUrl = toLocalHtmlUrl(htmlFiles[0].path);
        urlInput.value = localUrl;
        navigateToUrl(localUrl);
      } else {
        // 多文件：直接生成批量任务，左侧树展示
        var selector = $('#batchSelector').value.trim();
        Parser.state.batchTasks = [];
        Parser.state.batchAllResults = [];
        Parser.state.batchTaskIdCounter = 0;
        htmlFiles.forEach(function(f) {
          var localUrl = toLocalHtmlUrl(f.path);
          Parser.state.batchTasks.push({ id: ++Parser.state.batchTaskIdCounter, url: localUrl, q: f.name, page: '-', selector: selector, selectorType: $('#batchSelectorType').value || 'css', status: 'pending', rowCount: 0, error: null, results: null });
        });
        batchTagsPanel.classList.remove('hidden');
        btnBatchLoadAll.classList.remove('hidden');
        Parser.batch.renderTags();
        Parser.batch.fitPanel();
        setStatus('已添加 ' + Parser.state.batchTasks.length + ' 个本地文件');
        hideAllPanels();
        queryContainer.classList.remove('hidden');
        queryContainer.dataset.mode = 'batch';
        contentTitle.textContent = '本地文件列表';
        queryResultsDiv.innerHTML = '';
        Parser.state.queryResults = [];
      }
    });

    // ── 粘贴时自动 trim 前导/尾部空格 ──
    document.addEventListener('paste', function(e) {
      var target = e.target;
      if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) return;
      if (target.readOnly || target.disabled) return;
      e.preventDefault();
      var pastedText = (e.clipboardData || window.clipboardData).getData('text/plain');
      // 去除前导和尾部空白（包括全角空格 U+3000）
      pastedText = pastedText.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
      var start = target.selectionStart;
      var end = target.selectionEnd;
      var val = target.value;
      target.value = val.substring(0, start) + pastedText + val.substring(end);
      var newPos = start + pastedText.length;
      target.selectionStart = target.selectionEnd = newPos;
      // 触发 input 事件以通知其他监听者
      target.dispatchEvent(new Event('input', { bubbles: true }));
    });

    btnFetch.addEventListener('click', fetchAndParseSource);
    btnRefresh.addEventListener('click', () => { webview.reload(); });

    // 元素提取按钮
    btnElementPicker.addEventListener('click', () => {
      if (Parser.state.pickModeActive) { stopPickMode(); }
      else { startPickMode(); }
    });

    // 快速链接
    $$('.quick-link').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        urlInput.value = url;
        navigateToUrl(url);
      });
    });
  }

  // ──────── URL 导航 ────────
  function navigateToUrl(url) {
    setStatus('正在加载: ' + url);
    urlInput.value = url;
    Parser.state.currentHtml = ''; // 清空缓存，迫使 executeQuery 从 webview 取当前页 HTML
    webviewOverlay.classList.add('hidden');
    btnFetch.classList.remove('hidden');
    btnElementPicker.classList.remove('hidden');
    btnManagePickedHeader.classList.remove('hidden');
    var _rml=document.getElementById('btnRuleModeList'); if(_rml)_rml.classList.remove('hidden');
    var _rmd=document.getElementById('btnRuleModeDetail'); if(_rmd)_rmd.classList.remove('hidden');
    // 预注入 stealth 配置（在 preload 运行前尽可能早）
    var host = extractHost(url);
    Parser.stealth.injectStealthConfig(host);
    Parser.stealth.applyStealthGlobals(host);
    webview.loadURL(url);
    addHistory(url, '');
    if(pageInfo)pageInfo.textContent ='加载中...';
    // 根据 stealth 面板的 autocookie 开关决定是否加载 Cookie
    if (Parser.stealth.isStealthGlobalEnabled('autocookie', host)) {
      window.api.cookieLoad(url).then(r => {
        if (r && r.count > 0) {
          if(cookieStatus)cookieStatus.classList.remove('hidden');
          if(cookieStatus)cookieStatus.textContent ='Cookie ' + r.count;
          statusCookie.textContent = 'Cookie: ' + r.count + '条';
        } else {
          if(cookieStatus) {
            cookieStatus.classList.remove('hidden');
            cookieStatus.textContent = '无Cookie';
            cookieStatus.style.color = 'var(--orange)';
          }
          statusCookie.textContent = 'Cookie: 无(需登录)';
        }
      }).catch(function() {
        statusCookie.textContent = 'Cookie: 加载失败';
      });
    } else {
      statusCookie.textContent = 'Cookie: 已关闭';
    }
  }

  // ──────── Webview 事件 ────────
  // ──────── 鼠标滚轮穿透到 webview ────────
  function bindWheelPassthrough() {
    var container = document.getElementById('webviewContainer');
    if (!container) return;
    container.addEventListener('wheel', function(e) {
      // overlay 盖住时不转发
      if (!webviewOverlay.classList.contains('hidden')) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        webview.sendInputEvent({
          type: 'mouseWheel',
          x: e.offsetX,
          y: e.offsetY,
          deltaX: Math.round(e.deltaX),
          deltaY: Math.round(e.deltaY),
        });
      } catch(ex) {}
    }, { passive: false });
  }

  function bindWebviewEvents() {
    // 转发 webview 控制台日志到渲染进程
    webview.addEventListener('console-message', (e) => {
      if (e.message === '__ctx_close') {
        var m = document.getElementById('webviewContextMenu');
        if (m) m.remove();
        return;
      }
      console.log('[webview]', e.message);
    });
    // 拦截弹窗 → 打开 tab 浏览器（提取模式下拦截跳转）
    webview.addEventListener('new-window', (e) => {
      e.preventDefault();
      if (Parser.state.pickModeActive) return;
      if (e.url && e.url !== 'about:blank') {
        window.api.openPopupTab(e.url);
      }
    });

    webview.addEventListener('did-finish-load', () => {
      const url = webview.getURL();
      console.log('[webview did-finish-load] URL:', url);
      if (url && url !== 'about:blank') {
        urlInput.value = url;
        addHistory(url, '');
      }
      const host = extractHost(url);
      if(pageInfo)pageInfo.textContent =host;
      statusDomain.textContent = host;
      setStatus('加载完成 - 点击"解析"提取数据');
      window.api.cookieSave(url).then(r => {
        if (r && r.count > 0) {
          statusCookie.textContent = 'Cookie: ' + r.count + '条(已保存)';
          if(cookieStatus) { cookieStatus.textContent = 'Cookie ' + r.count; cookieStatus.style.color = ''; }
        }
      }).catch(() => {});
      // 注入 contextmenu 监听（供右键"定位到表格行"使用）
      _ensureCtxInjected();
      // 注入滚动条（用 style 标签，优先级高于 inline setProperty）
      webview.executeJavaScript(
        '(function(){'
        + 'var id="__parser_scroll_style";'
        + 'var old=document.getElementById(id);if(old)old.remove();'
        + 'var s=document.createElement("style");s.id=id;'
        + 's.textContent="html,body{overflow-x:scroll!important;overflow-y:scroll!important}"+'
          + '"html::-webkit-scrollbar{width:10px;height:10px}"+'
          + '"html::-webkit-scrollbar-track{background:#e8e8e8;border-radius:5px}"+'
          + '"html::-webkit-scrollbar-thumb{background:#b0b0b0;border-radius:5px;border:2px solid #e8e8e8}"+'
          + '"html::-webkit-scrollbar-thumb:hover{background:#888}"+'
          + '"html::-webkit-scrollbar-corner{background:#e8e8e8}";'
        + '(document.head||document.documentElement).appendChild(s);'
        // MutationObserver 保活：页面脚本删了我们的 style 就重新注入
        + 'var obs=new MutationObserver(function(){'
          + 'if(!document.getElementById(id)){(document.head||document.documentElement).appendChild(s);}'
        + '});'
        + 'obs.observe(document.head||document.documentElement,{childList:true});'
        + '})()'
      ).catch(function(){});
      // 注入 stealth 配置和原型包装（页面加载完成后注入到页面 JS 上下文）
      var injectHost = extractHost(webview.getURL());
      Parser.stealth.injectStealthConfig(injectHost);
      var injectScripts2 = Parser.stealth.getStealthScriptsForHost(injectHost).filter(function(id) { return Parser.state.STEALTH_INJECT_IDS.indexOf(id) !== -1; });
      Parser.stealth.injectStealthPrototypes(injectScripts2);
    });
    // dom-ready 比 did-finish-load 更早触发（DOM 构建完成时）
    webview.addEventListener('dom-ready', () => {
      var host = extractHost(webview.getURL());
      var scripts3 = Parser.stealth.getStealthScriptsForHost(host).filter(function(id) { return Parser.state.STEALTH_INJECT_IDS.indexOf(id) !== -1; });
      if (scripts3.length > 0) {
        Parser.stealth.injectStealthPrototypes(scripts3);
      }
    });
    webview.addEventListener('did-start-loading', () => {
      if(pageInfo)pageInfo.textContent ='加载中...';
      // 注入 stealth 配置（尽早设置，让 preload 中的 stealth 能读取）
      var host = extractHost(webview.getURL());
      Parser.stealth.injectStealthConfig(host);
      // 尽早注入原型包装（在页面脚本运行前）
      var injectScripts3 = Parser.stealth.getStealthScriptsForHost(host).filter(function(id) { return Parser.state.STEALTH_INJECT_IDS.indexOf(id) !== -1; });
      Parser.stealth.injectStealthPrototypes(injectScripts3);
      Parser.stealth.applyStealthGlobals(host);
    });
    webview.addEventListener('did-fail-load', (e) => {
      if (e.errorCode !== -3) { setStatus('加载失败: ' + e.errorDescription); if(pageInfo)pageInfo.textContent ='加载失败'; }
    });
    webview.addEventListener('page-title-updated', (e) => { document.title = e.title + ' - 网页解析器';
      updateHistoryTitle(e.title);
    });
  }

  // ──────── 浏览历史 ────────
  function addHistory(url, title) {
    if (!url || url === 'about:blank') return;
    // 去重：如果同一个URL已存在（且无新标题），更新位置
    var existing = -1;
    for (var i = 0; i < Parser.state.browseHistory.length; i++) {
      if (Parser.state.browseHistory[i].url === url) { existing = i; break; }
    }
    var now = Date.now();
    var timeStr = formatTime(now);
    // 如果标题为空，尝试从已有记录继承
    if (!title && existing >= 0) title = Parser.state.browseHistory[existing].title;
    if (!title) title = extractHost(url) || url;
    if (existing >= 0) {
      Parser.state.browseHistory[existing].time = now;
      Parser.state.browseHistory[existing].timeStr = timeStr;
      if (title) Parser.state.browseHistory[existing].title = title;
    } else {
      Parser.state.browseHistory.push({ id: ++Parser.state.historyIdCounter, url: url, title: title || url, time: now, timeStr: timeStr });
      if (Parser.state.browseHistory.length > 200) Parser.state.browseHistory.shift();
    }
    if (Parser.state.historyPanelVisible) renderHistoryTable();
  }
  function updateHistoryTitle(title) {
    if (!title || Parser.state.browseHistory.length === 0) return;
    var last = Parser.state.browseHistory[Parser.state.browseHistory.length - 1];
    last.title = title;
    if (Parser.state.historyPanelVisible) renderHistoryTable();
  }
  function formatTime(ts) {
    var d = new Date(ts);
    var h = d.getHours().toString().padStart(2, '0');
    var m = d.getMinutes().toString().padStart(2, '0');
    var s = d.getSeconds().toString().padStart(2, '0');
    return h + ':' + m + ':' + s;
  }
  function toggleHistoryPanel() {
    Parser.state.historyPanelVisible = !Parser.state.historyPanelVisible;
    if (Parser.state.historyPanelVisible) {
      showHistoryInQuery();
    } else {
      hideHistoryFromQuery();
    }
  }
  function showHistoryInQuery() {
    hideAllPanels();
    queryContainer.classList.remove('hidden');
    queryContainer.dataset.mode = 'history';
    // 隐藏查询输入行
    var inputRow = queryContainer.querySelector('.query-input-row');
    if (inputRow) inputRow.style.display = 'none';
    // 保存并替换工具栏
    var toolbar = queryContainer.querySelector('.query-toolbar');
    if (toolbar) {
      if (!Parser.state._savedToolbarHTML) Parser.state._savedToolbarHTML = toolbar.innerHTML;
      toolbar.style.display = 'flex';
    }
    contentTitle.textContent = '浏览历史 (' + Parser.state.browseHistory.length + '条)';
    renderHistoryTable();
  }
  function hideHistoryFromQuery() {
    queryContainer.dataset.mode = '';
    var inputRow = queryContainer.querySelector('.query-input-row');
    if (inputRow) inputRow.style.display = '';
    var toolbar = queryContainer.querySelector('.query-toolbar');
    if (toolbar && Parser.state._savedToolbarHTML) toolbar.innerHTML = Parser.state._savedToolbarHTML;
    contentTitle.textContent = '选择左侧条目查看详情';
    queryResultsDiv.innerHTML = '';
    queryContainer.classList.add('hidden');
  }
  function renderHistoryTable() {
    if (Parser.state.browseHistory.length === 0) {
      queryResultsDiv.innerHTML = '<div class="tree-empty">暂无浏览记录</div>';
      return;
    }
    // 构建工具栏
    var toolbar = queryContainer.querySelector('.query-toolbar');
    if (toolbar) {
      toolbar.innerHTML = ''
        + '<input type="text" id="historySearch" class="tree-search-input" placeholder="搜索过滤 URL..." autocomplete="off" spellcheck="false">'
        + '<label class="checkbox-label"><input type="checkbox" id="historyCheckAll"> 全选</label>'
        + '<button id="btnHistoryBatchParse" class="btn btn-sm btn-accent">批量解析选中</button>'
        + '<button id="btnHistoryClear" class="btn btn-sm" style="background:transparent;border-color:var(--border);color:var(--text-dim);font-size:12px">清空历史</button>';
    }
    // 构建表格
    var html = '<table class="result-table" id="historyTable"><thead><tr>'
      + '<th style="width:30px"><input type="checkbox" id="historyCheckAllTh"></th>'
      + '<th style="width:40px">#</th>'
      + '<th>标题</th>'
      + '<th>URL</th>'
      + '<th style="width:80px">时间</th>'
      + '<th style="width:50px">操作</th>'
      + '</tr></thead><tbody>';
    for (var i = Parser.state.browseHistory.length - 1; i >= 0; i--) {
      var h = Parser.state.browseHistory[i];
      var title = h.title || '未知页面';
      var url = h.url || '';
      var time = h.timeStr || '';
      var idx = Parser.state.browseHistory.length - i;
      html += '<tr class="history-row" data-id="' + h.id + '" data-url="' + escapeAttr(url) + '">'
        + '<td style="text-align:center"><input type="checkbox" class="history-cb" data-id="' + h.id + '"></td>'
        + '<td style="text-align:center;color:var(--text-dim);font-size:11px">' + idx + '</td>'
        + '<td class="history-title-cell" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer">' + escapeHtml(title) + '</td>'
        + '<td class="history-url-cell" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;font-size:11px;color:var(--text-dim)">' + escapeHtml(url) + '</td>'
        + '<td style="font-size:11px;color:var(--text-dim);white-space:nowrap">' + time + '</td>'
        + '<td style="text-align:center"><span class="history-del-btn" style="cursor:pointer;color:var(--text-dim);font-size:14px" title="移除">&times;</span></td>'
        + '</tr>';
    }
    html += '</tbody></table>';
    queryResultsDiv.innerHTML = html;

    // ── 事件绑定 ──
    // 点击行导航
    queryResultsDiv.querySelectorAll('.history-row').forEach(function(row) {
      var url = row.dataset.url;
      row.addEventListener('click', function(e) {
        if (e.target.type === 'checkbox' || e.target.classList.contains('history-del-btn')) return;
        if (url) {
          urlInput.value = url;
          navigateToUrl(url);
        }
      });
    });
    // 删除单个
    queryResultsDiv.querySelectorAll('.history-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var row = this.closest('.history-row');
        var id = parseInt(row.dataset.id, 10);
        Parser.state.browseHistory = Parser.state.browseHistory.filter(function(h) { return h.id !== id; });
        renderHistoryTable();
        contentTitle.textContent = '浏览历史 (' + Parser.state.browseHistory.length + '条)';
      });
    });
    // 全选
    var checkAll = document.getElementById('historyCheckAllTh') || document.getElementById('historyCheckAll');
    if (checkAll) {
      checkAll.addEventListener('change', function() {
        var checked = this.checked;
        queryResultsDiv.querySelectorAll('.history-cb').forEach(function(cb) { cb.checked = checked; });
        var checkAll2 = document.getElementById('historyCheckAll');
        if (checkAll2) checkAll2.checked = checked;
      });
    }
    // 搜索过滤
    var searchInput = document.getElementById('historySearch');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        var q = this.value.toLowerCase();
        queryResultsDiv.querySelectorAll('.history-row').forEach(function(row) {
          var url = (row.dataset.url || '').toLowerCase();
          var title = (row.querySelector('.history-title-cell') || {}).textContent || '';
          row.style.display = url.indexOf(q) !== -1 || title.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
        });
      });
    }
    // 批量解析选中
    var batchBtn = document.getElementById('btnHistoryBatchParse');
    if (batchBtn) {
      batchBtn.addEventListener('click', function() {
        var selected = [];
        queryResultsDiv.querySelectorAll('.history-cb:checked').forEach(function(cb) {
          var id = parseInt(cb.dataset.id, 10);
          for (var j = 0; j < Parser.state.browseHistory.length; j++) {
            if (Parser.state.browseHistory[j].id === id) { selected.push(Parser.state.browseHistory[j].url); break; }
          }
        });
        if (selected.length === 0) { setStatus('请先勾选要解析的 URL'); return; }
        // 加入批量任务
        Parser.state.batchTasks = [];
        Parser.state.batchAllResults = [];
        Parser.state.batchTaskIdCounter = 0;
        selected.forEach(function(url) {
          Parser.state.batchTasks.push({ id: ++Parser.state.batchTaskIdCounter, url: url, q: '', page: '-', selector: '', selectorType: 'css', status: 'pending', rowCount: 0, error: null, results: null });
        });
        batchTagsPanel.classList.remove('hidden');
        btnBatchLoadAll.classList.remove('hidden');
        Parser.batch.renderTags();
        Parser.batch.fitPanel();
        setStatus('已添加 ' + selected.length + ' 个 URL 到批量任务');
        // 关闭历史，切到批量
        Parser.state.historyPanelVisible = false;
        hideHistoryFromQuery();
        hideAllPanels();
        queryContainer.classList.remove('hidden');
        queryContainer.dataset.mode = 'batch';
        contentTitle.textContent = '批量任务列表';
        queryResultsDiv.innerHTML = '<div class="tree-empty">共 ' + selected.length + ' 个 URL，点击"全部加载"开始</div>';
      });
    }
    // 清空历史
    var clearBtn = document.getElementById('btnHistoryClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        Parser.state.browseHistory = [];
        renderHistoryTable();
        contentTitle.textContent = '浏览历史 (0条)';
        setStatus('历史记录已清空');
      });
    }
  }
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ──────── 获取并解析源码 ────────
  async function fetchAndParseSource() {
    const src = webview.getURL();
    if (!src || src === 'about:blank') { setStatus('请先加载一个网页'); return; }
    setStatus('正在获取源码...');
    btnFetch.disabled = true;
    btnFetch.textContent = '解析中...';
    try {
      Parser.state.currentHtml = await webview.executeJavaScript('document.documentElement.outerHTML');
      console.log('[解析] 获取到源码, 长度:', Parser.state.currentHtml ? Parser.state.currentHtml.length : 0);
      if (!Parser.state.currentHtml) throw new Error('获取到的源码为空');
      const chars = Parser.state.currentHtml.length;
      const lines = (Parser.state.currentHtml.match(/\n/g) || []).length + 1;
      const sizeKb = (chars / 1024).toFixed(1);
      statusSizeChars.textContent = '字符: ' + chars.toLocaleString();
      statusSizeLines.textContent = '行: ' + lines.toLocaleString() + ' | 大小: ' + sizeKb + ' KB';
      setStatus('正在解析...');
      const resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/parse/all', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: Parser.state.currentHtml, query: '' }),
      });
      if (!resp.ok) throw new Error('解析失败: ' + resp.status);
      Parser.state.parseResult = await resp.json();
      console.log('[解析] 解析结果:', Object.keys(Parser.state.parseResult));
      buildTree(Parser.state.parseResult);
      // 自动选中第一个树节点（源码）
      const firstRow = treeContent.querySelector('.tree-node-row');
      if (firstRow) { console.log('[解析] 自动选中第一个节点'); firstRow.click(); }
      setStatus('解析完成');
      statusTime.textContent = new Date().toLocaleTimeString();
    } catch (err) {
      console.error('[解析错误]', err.message);
      setStatus('解析失败: ' + err.message);
      treeContent.innerHTML = '<div class="tree-empty">解析失败: ' + err.message + '</div>';
    } finally {
      btnFetch.disabled = false;
      btnFetch.textContent = '解析';
    }
  }

  // ──────── 构建默认树（无数据时显示工具项） ────────
  function buildDefaultTree() {
    treeContent.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'tree-root';
    const g1 = startGroup(root, '页面内容');
    addTreeItem(g1, '源码', 'source', null);
    addTreeItem(g1, '链接', 'element-list', { selector: 'a', label: '链接' });
    addTreeItem(g1, '图片', 'element-list', { selector: 'img', label: '图片' });
    addTreeItem(g1, '表单', 'element-list', { selector: 'form', label: '表单' });
    addTreeItem(g1, '表格', 'element-list', { selector: 'table', label: '表格' });
    addTreeItem(g1, '脚本', 'scripts', null);
    addTreeItem(g1, 'DOM 树', 'dom-tree', null);
    addTreeItem(g1, '节点浏览器', 'node-explorer', null);
    const gPick = startGroup(root, '页面提取', 'picked-group');
    addTreeItem(gPick, '框选', 'picked-pick', null, 0);
    addTreeItem(gPick, '识别', 'picked-auto', null, 0);
    addTreeItem(gPick, '扫描', 'picked-scan', null, 0);
    addTreeItem(gPick, '合并', 'picked-合并', null, 0);
    addTreeItem(gPick, '拆分', 'picked-拆分', null, 0);
    const gApi = startGroup(root, 'API 接入');
    addTreeItem(gApi, '发送 API 请求', 'api-config', null);
    addTreeItem(gApi, '请求历史', 'api-history', null);
    const g2 = startGroup(root, '数据提取');
    addTreeItem(g2, 'XPath 提取', 'extract-xpath', null);
    addTreeItem(g2, 'CSS 选择器', 'extract-css', null);
    addTreeItem(g2, '正则提取', 'extract-regex', null);
    addTreeItem(g2, 'JSONPath 提取', 'extract-jsonpath', null);
    addTreeItem(g2, '链路提取', 'extract-chain', null);
    var regElems2 = _registeredElementsCache || Parser.state.registeredElements;
    const g3d = startGroup(root, '数据采集');
    addTreeItem(g3d, '手动采集', 'registered-elements', null, regElems2 ? regElems2.length : 0);
    addTreeItem(g3d, '滚动采集', 'collected-scroll', null, Parser.state._scrollDataCount || 0);
    addTreeItem(g3d, 'API采集', 'collected-api', null, Parser.state._apiDataCount || 0);
    treeContent.appendChild(root);
    updatePickedTreeNodes();
  }

  // ──────── 构建目录树 ────────
  const treeIcons = {
    '源码': '📄', '链接': '🔗', '图片': '🖼️', '表单': '📝', '表格': '📊',
    '脚本': '📜', 'DOM 树': '🌳', '节点浏览器': '🗂️',
    '发送 API 请求': '📡', '请求历史': '📋', '响应体': '📄', 'JSON 树': '📊', '响应头': '📋', '状态信息': 'ℹ️',
    'XPath 提取': '🔍', 'CSS 选择器': '🎯', '正则提取': '🔤', 'JSONPath 提取': '🗂️', '链路提取': '🔀',
    '已选元素': '📌', '手动采集': '🔖', '滚动采集': '🔄', 'API采集': '📡', '框选': '🖱️', '识别': '🤖', '合并': '<span style="color:#a78bfa">⧉</span>', '拆分': '<span style="color:var(--orange)">↯</span>', '扫描': '🔎',
  };

  function buildTree(data) {
    console.log('[buildTree] 开始构建树, stats=', data.stats);
    treeContent.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'tree-root';

    // ── 组1: 页面内容 ──
    const g1 = startGroup(root, '页面内容');

    // 源码
    if (data.formatted_html) {
      addTreeItem(g1, '源码', 'source', { html: data.formatted_html, stats: data.stats });
    }

    // 元素统计 — 每个可点击展开
    if (data.stats) {
      const s = data.stats;
      const elements = [
        { key: '链接', count: parseCount(s['链接(a)']), selector: 'a' },
        { key: '图片', count: parseCount(s['图片(img)']), selector: 'img' },
        { key: '表单', count: parseCount(s['表单']), selector: 'form' },
        { key: '表格', count: parseCount(s['表格']), selector: 'table' },
      ];
      elements.forEach(el => {
        if (el.count > 0) {
          addTreeItem(g1, el.key, 'element-list', { selector: el.selector, label: el.key }, el.count);
        }
      });
    }

    // 脚本
    if (data.scripts && data.scripts.length > 0) {
      const n = addTreeItem(g1, '脚本', 'scripts', data.scripts, data.scripts.length);
      const children = renderScriptChildren(data.scripts);
      if (children) n.appendChild(children);
    }

    // DOM 树
    if (data.dom_tree) {
      addTreeItem(g1, 'DOM 树', 'dom-tree', data.dom_tree);
      addTreeItem(g1, '节点浏览器', 'node-explorer', data.dom_tree);
    }

    // 页面提取
    const gPick = startGroup(root, '页面提取', 'picked-group');
    addTreeItem(gPick, '框选', 'picked-pick', null, 0);
    addTreeItem(gPick, '识别', 'picked-auto', null, 0);
    addTreeItem(gPick, '扫描', 'picked-scan', null, 0);
    addTreeItem(gPick, '合并', 'picked-合并', null, 0);
    addTreeItem(gPick, '拆分', 'picked-拆分', null, 0);

    // ── 组2: 数据提取 ──
    const g2 = startGroup(root, '数据提取');

    // 提取工具
    addTreeItem(g2, 'XPath 提取', 'extract-xpath', null);
    addTreeItem(g2, 'CSS 选择器', 'extract-css', null);
    addTreeItem(g2, '正则提取', 'extract-regex', null);
    addTreeItem(g2, 'JSONPath 提取', 'extract-jsonpath', null);
    addTreeItem(g2, '链路提取', 'extract-chain', null);

    var regElems3 = _registeredElementsCache || Parser.state.registeredElements;
    var g3 = startGroup(root, '数据采集');
    addTreeItem(g3, '手动采集', 'registered-elements', null, regElems3 ? regElems3.length : 0);
    addTreeItem(g3, '滚动采集', 'collected-scroll', null, Parser.state._scrollDataCount || 0);
    addTreeItem(g3, 'API采集', 'collected-api', null, Parser.state._apiDataCount || 0);

    treeContent.appendChild(root);
    updatePickedTreeNodes();
    console.log('[buildTree] 树构建完成');
  }

  function startGroup(parent, name, extraClass) {
    const header = document.createElement('div');
    header.className = 'tree-group-header' + (extraClass ? ' ' + extraClass : '');
    const icons = { '页面内容': '📄', '页面提取': '📌', '数据提取': '⚙️', 'API 接入': '🌐', 'API 响应': '📨', '数据采集': '📌' };
    header.innerHTML = '<span class="group-toggle">▼</span> ' + (icons[name] || '') + ' ' + name;
    parent.appendChild(header);

    const body = document.createElement('div');
    body.className = 'tree-group-body';
    parent.appendChild(body);

    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
      body.classList.toggle('hidden');
      header.querySelector('.group-toggle').textContent = body.classList.contains('hidden') ? '▶' : '▼';
    });

    return body;
  }

  function parseCount(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
    return 0;
  }

  function addTreeItem(parent, label, type, data, count) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    const row = document.createElement('div');
    row.className = 'tree-node-row';
    const icon = treeIcons[label] || '';
    let html = '<span class="toggle"></span><span class="node-icon">' + icon + '</span><span class="node-label">' + label + '</span>';
    if (count !== undefined && count !== null) {
      html += '<span class="node-count">' + count + '</span>';
    }
    row.innerHTML = html;
    row.dataset.type = type;
    row.addEventListener('click', () => {
      console.log('[tree] 点击:', label, 'type:', type);
      $$('.tree-node-row.active').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      showContent(type, data);
    });
    node.appendChild(row);
    parent.appendChild(node);
    return node;
  }

  function renderScriptChildren(scripts) {
    const div = document.createElement('div');
    div.className = 'tree-children hidden';
    scripts.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'tree-node-row';
      const label = s['脚本地址'] ? '[' + i + '] ' + s['脚本地址'].split('/').pop() : '[' + i + '] 内嵌脚本';
      row.innerHTML = '<span class="toggle" style="visibility:hidden"></span><span class="node-label">' + label + '</span>';
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        $$('.tree-node-row.active').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        showScriptDetail(s);
      });
      div.appendChild(row);
    });
    // 找到父 node 的 toggle
    return div;
  }

  // ──────── 树事件 ────────
  function bindTreeEvents() {
  }

  // ──────── 内容展示路由 ────────
  async function showContent(type, data) {
    console.log('[showContent]', type, data ? Object.keys(data) : null);
    // 采集运行中不响应树节点切换
    if (collector.scroll.running || collector.api.autoRunning) {
      setStatus('采集运行中，请先停止');
      return;
    }
    // 切换树时退出提取模式（来源面板除外）
    if (Parser.state.pickModeActive && type.indexOf('picked-') !== 0) {
      await stopPickMode();
    }
    // 退出节点浏览器时重置布局
    if (queryContainer.dataset.mode === '__node_explorer__' && type !== 'node-explorer') {
      queryResultsDiv.style.display = '';
      queryResultsDiv.style.flexDirection = '';
      queryResultsDiv.style.overflow = '';
    }
    hideAllPanels();
    setStatus('');
    if (type === 'source') {
      showSourcePanel(data);
    } else if (type === 'dom-tree') {
      showDomTreePanel(data);
    } else if (type === 'scripts') {
      showScriptsPanel(data);
    } else if (type === 'element-list') {
      showElementListPanel(data);
    } else if (type === 'extract-chain') {
      openSchemaModal();
      switchSchemaTab('chain');
    } else if (type && type.startsWith('extract-')) {
      showExtractPanel(type.replace('extract-', ''));
    } else if (type === 'api-config') {
      showApiConfig();
    } else if (type === 'api-history') {
      showApiHistory();
    } else if (type === 'api-response') {
      showApiResponse();
    } else if (type === 'api-json-tree') {
      showApiJsonTree();
    } else if (type === 'api-headers') {
      showApiHeaders();
    } else if (type === 'api-status') {
      showApiStatus();
    } else if (type === 'picked-elements' || type === 'picked-pick' || type === 'picked-auto' || type === 'picked-scan' || type === 'picked-合并' || type === 'picked-拆分') {
      console.log('[showContent] calling showPickedElementsPanel, source:', type.replace('picked-', ''));
      showPickedElementsPanel(type === 'picked-elements' ? null : type.replace('picked-', ''));
    } else if (type === 'registered-elements') {
      fetchRegisteredElements().then(function() { showRegisteredElementsPanel(); });
    } else if (type === 'collected-scroll') {
      showCollectedDataPanel('scroll');
    } else if (type === 'collected-api') {
      showCollectedDataPanel('api');
    } else if (type === 'node-explorer') {
      showNodeExplorer(data || cachedDomTree);
    } else {
      console.log('[showContent] 未知 type:', type);
    }
  }

  // 保存/恢复 toolbar 原始 HTML，防止 picked 面板覆盖
  var _savedToolbarHTML = '';

  function hideAllPanels() {
    [editorContainer, queryContainer, domTreeContainer, jsonViewerContainer, contentEmpty].forEach(el => el.classList.add('hidden'));
    var actionsEl = document.getElementById('contentActions');
    if (actionsEl) { actionsEl.innerHTML = ''; actionsEl.style.display = ''; }
    var inputRow = queryContainer.querySelector('.query-input-row');
    if (inputRow) inputRow.style.display = '';
    var toolbar = queryContainer.querySelector('.query-toolbar');
    if (toolbar) {
      toolbar.style.display = '';
      if (Parser.state._savedToolbarHTML) {
        toolbar.innerHTML = Parser.state._savedToolbarHTML;
        Parser.state._savedToolbarHTML = '';
        // 重新绑定 toolbar 事件
        bindQueryToolbarEvents();
      }
    }
  }

  // 恢复 toolbar HTML 后重新绑定事件
  function bindQueryToolbarEvents() {
    var searchEl = document.getElementById('querySearch');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        var q = searchEl.value.trim().toLowerCase();
        renderQueryTable(q ? Parser.state.queryResults.filter(function (row) {
          return Object.values(row).some(function (v) { return String(v).toLowerCase().indexOf(q) >= 0; });
        }) : Parser.state.queryResults);
      });
    }
    var checkAll = document.getElementById('queryCheckAll');
    if (checkAll) {
      checkAll.addEventListener('change', function () {
        var checked = checkAll.checked;
        queryResultsDiv.querySelectorAll('.result-checkbox').forEach(function (cb) { cb.checked = checked; });
        updateRowSelection();
      });
    }
    var exportBtn = document.getElementById('btnExportQuery');
    if (exportBtn) exportBtn.addEventListener('click', exportToExcel);
    var delimEl = document.getElementById('globalChildDelim');
    if (delimEl) {
      delimEl.addEventListener('change', function () {
        Parser.state.globalChildDelim = this.value || '';
        try { localStorage.setItem('global_child_delim', Parser.state.globalChildDelim); } catch (e) { }
        Parser.query.executeQuery();
      });
    }
  }

  function hideAllBut(keep) {
    [editorContainer, queryContainer, domTreeContainer, jsonViewerContainer, contentEmpty].forEach(el => {
      if (el !== keep) el.classList.add('hidden');
    });
    if (keep) keep.classList.remove('hidden');
  }

  // ──────── 源码面板 ────────
  function showSourcePanel(data) {
    setStatus('源码预览');
    contentTitle.textContent = '源码';
    const html = (data && data.html) || '';

    hideAllPanels();
    queryContainer.classList.remove('hidden');
    queryContainer.dataset.mode = '__source__';
    showQueryInputRow();
    queryResultsDiv.innerHTML = '';
    if (!html) {
      queryResultsDiv.innerHTML = '<div class="tree-empty">请先加载并解析页面</div>';
      return;
    }
    renderSourceInResults(html);
  }

  var cachedSourceHtml = '';
  window.cachedSourceHtml = cachedSourceHtml;
  function renderSourceInResults(html) {
    cachedSourceHtml = html;
    window.cachedSourceHtml = html;
    var searchQ = (document.getElementById('querySearch') || {}).value || '';
    var lines = html.split('\n');
    var matched = lines.map(function(line, i) {
      return { text: line, num: i + 1 };
    });
    if (searchQ) {
      matched = matched.filter(function(m) { return m.text.toLowerCase().includes(searchQ.toLowerCase()); });
    }
    var html2 = '<div style="background:var(--bg-tree);padding:8px 0;font-family:Consolas,"Microsoft YaHei",monospace;font-size:13px;line-height:1.55;white-space:pre;overflow:auto;min-height:100%">';
    for (var i = 0; i < matched.length; i++) {
      var m = matched[i];
      var lineStr = highlightLine(m.text, 'html');
      var numStyle = m.num % 5 === 0 ? 'color:var(--accent);font-weight:600' : 'color:#555';
      html2 += '<div><span style="' + numStyle + ';user-select:none;display:inline-block;width:44px;text-align:right;padding-right:12px;font-size:12px">' + m.num + '</span>' + lineStr + '</div>';
    }
    html2 += '</div>';
    queryResultsDiv.innerHTML = html2;
  }

  // ──────── 轻量语法高亮 ────────
  function showHighlightedCode(container, code, lang) {
    // 行号 + 语法着色
    const lines = code.split('\n');
    const highlighted = lines.map((line, i) => {
      const colored = highlightLine(line, lang);
      const lineNum = String(i + 1).padStart(5, ' ');
      // 每隔5行加粗行号
      const numStyle = (i + 1) % 5 === 0 ? 'color:var(--accent);font-weight:600' : 'color:#555';
      return '<span style="' + numStyle + ';user-select:none;display:inline-block;width:44px;text-align:right;padding-right:12px;font-size:12px">' + lineNum + '</span>' + colored;
    }).join('\n');

    container.innerHTML = '<pre style="background:var(--bg-tree);padding:12px 0;margin:0;height:100%;overflow:auto;font-family:Consolas,\'Courier New\',\'Microsoft YaHei\',monospace;font-size:13px;line-height:1.55;white-space:pre;color:var(--text)">' + highlighted + '</pre>';
  }

  function highlightLine(line, lang) {
    if (!line) return '';
    let escaped = escapeHtml(line);

    if (lang === 'html') {
      // 注释 <!-- -->
      escaped = escaped.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span style="color:#6a9955">$1</span>');
      // 标签 &lt;tag ...&gt;
      escaped = escaped.replace(/(&lt;\/?)(\w[\w-]*)([\s\S]*?)(\/?&gt;)/g, function(m, open, tag, attrs, close) {
        var tagColor = '#569cd6';
        var attrColored = attrs.replace(/(\s+)([\w-]+)(\s*=\s*)(&quot;[^&]*&quot;|&#39;[^&#]*&#39;|[^\s&;]+)/g,
          '<span style="color:#9cdcfe">$2</span>$3<span style="color:#ce9178">$4</span>');
        return '<span style="color:#808080">&lt;</span><span style="color:' + tagColor + '">' + tag + '</span>' + attrColored + '<span style="color:#808080">' + close.replace('&gt;', '&gt;').replace('/&gt;', '/&gt;') + '</span>';
      });
      // 处理未匹配到的 &lt; &gt;
      escaped = escaped.replace(/(&lt;)([\/\w])/g, '<span style="color:#808080">&lt;</span>$2');
      escaped = escaped.replace(/(&gt;)/g, '<span style="color:#808080">&gt;</span>');
    } else if (lang === 'js' || lang === 'javascript') {
      // 字符串
      escaped = escaped.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, '<span style="color:#ce9178">$&</span>');
      // 注释 //
      escaped = escaped.replace(/(\/\/.*)/g, '<span style="color:#6a9955">$1</span>');
      // 关键字
      escaped = escaped.replace(/\b(function|var|let|const|if|else|for|while|return|import|export|class|new|this|async|await|try|catch|throw|typeof|instanceof|of|in|from|default|switch|case|break|continue|true|false|null|undefined)\b/g, '<span style="color:#569cd6">$1</span>');
      // 数字
      escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#b5cea8">$1</span>');
    } else if (lang === 'json') {
      // JSON keys
      escaped = escaped.replace(/(&quot;[^&]+&quot;)(\s*:\s*)/g, '<span style="color:#9cdcfe">$1</span>$2');
      // JSON strings
      escaped = escaped.replace(/(&quot;(?:[^\n]*)&quot;)/g, '<span style="color:#ce9178">$1</span>');
      // 数字/布尔/null
      escaped = escaped.replace(/\b(true|false|null)\b/g, '<span style="color:#569cd6">$1</span>');
      escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#b5cea8">$1</span>');
    }

    // 通用：数字
    return escaped;
  }

  function showScriptDetail(script) {
    setStatus('脚本详情');
    contentTitle.textContent = '脚本详情';
    editorContainer.classList.remove('hidden');
    hideAllBut(editorContainer);
    const content = script['内容'] || '';
    showHighlightedCode(editorContainer, content, 'javascript');
  }
  function showQueryInputRow() {
    var inputRow = queryContainer.querySelector('.query-input-row');
    if (inputRow) inputRow.style.display = '';
    var exportBtn = document.getElementById('btnExportQuery');
    var checkAll = document.getElementById('queryCheckAll');
    if (exportBtn) exportBtn.style.display = '';
    if (checkAll) checkAll.style.display = '';
    document.getElementById('querySearch').oninput = null;
  }
  async function showElementListPanel(data) {
    const selector = data.selector;
    const label = data.label;
    console.log('[元素列表]', label, '选择器:', selector);
    contentTitle.textContent = label + ' 列表';
    hideAllPanels();
    queryContainer.classList.remove('hidden');
    showQueryInputRow();
    queryContainer.dataset.mode = 'css';
    queryInput.value = selector;
    queryResultsDiv.innerHTML = '<div class="tree-empty">正在查询...</div>';
    Parser.state.queryResults = [];
    setStatus('正在提取' + label + '...');
    try {
      let html = Parser.state.currentHtml;
      if (!html) {
        try { html = await webview.executeJavaScript('document.documentElement.outerHTML'); }
        catch (e) { throw new Error('无法获取页面源码'); }
      }
      console.log('[元素列表] 发送请求, HTML长度:', html.length);
      const resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/extract/css', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: html, query: selector, child_delim: Parser.state.globalChildDelim }),
      });
      const result = await resp.json();
      console.log('[元素列表] 返回:', result.count, '条');
      if (result.results && result.results.length > 0) {
        Parser.state.queryResults = result.results;
        // 每个节点类型有独立的默认可见字段
        var defaultVisible = null;
        if (selector === 'a') {
          defaultVisible = ['序号', '标签', '文本', '链接', '类名', 'ID', '标题', 'target', 'rel', '父级标签', '父级类名'];
        } else if (selector === 'img') {
          defaultVisible = ['序号', '标签', '文本', '来源', '替代文本', '类名', '宽度', '高度', '标题', '父级标签', '父级类名'];
        } else if (selector === 'form') {
          defaultVisible = ['序号', '标签', '文本', '动作(action)', '方法(method)', '类名', 'ID', '父级标签', '父级类名'];
        } else if (selector === 'table') {
          defaultVisible = ['序号', '标签', '文本', '类名', 'ID', '父级标签', '父级类名'];
        }
        // 给 form 加序号
        if (selector === 'form' && result.results.length > 0) {
          result.results.forEach(function(r, ri) { r['序号'] = ri + 1; });
        }
        renderQueryTable(Parser.state.queryResults, defaultVisible);
        // 表单：行点击弹出交互框
        if (selector === 'form') {
          $$('.result-table tbody tr').forEach(function(tr) {
            tr.addEventListener('click', function(e) {
              if (e.target.tagName === 'INPUT') return;
              var tds = tr.querySelectorAll('td');
              var idx = tds.length > 1 ? parseInt(tds[1].textContent) : NaN;
              if (!isNaN(idx)) openFormModal(idx - 1);
            });
            tr.style.cursor = 'pointer';
          });
        }
        setStatus(label + ': ' + result.count + ' 条结果');
      } else {
        queryResultsDiv.innerHTML = '<div class="tree-empty">没有找到' + label + '</div>';
        setStatus('没有找到' + label);
      }
    } catch (err) {
      console.error('[元素列表错误]', err.message);
      queryResultsDiv.innerHTML = '<div class="tree-empty">查询失败: ' + err.message + '</div>';
      setStatus('查询失败');
    }
  }

  // ──────── 已选元素展示面板 ────────

  // 从 items 渲染 query 面板（不切换面板，纯数据+样式更新）
  async function renderQueryFromItems(items, allSourceLabels) {
    if (items.length === 0) {
      queryResultsDiv.innerHTML = '<div class="tree-empty">暂无已选元素。在浏览区用提取模式选择元素后会自动加入。</div>';
      Parser.state.queryResults = [];
      return;
    }

    // ── 批量获取子节点分隔文本 ──
    var delim = Parser.state.globalChildDelim;
    if (delim) {
      var selSet = {};
      items.forEach(function(item) {
        if (!item.isGroup && item.selector && !item._tagHeader) {
          selSet[item.selector] = true;
        }
      });
      var sels = Object.keys(selSet);
      if (sels.length > 0) {
        try {
          var batchCode = '(function(){var d=' + JSON.stringify(delim) + ';var s=' + JSON.stringify(sels) + ';' +
            'var r={};for(var i=0;i<s.length;i++){try{' +
              'var el=document.querySelector(s[i]);' +
              'if(!el){r[s[i]]=null;continue;}' +
              'if(!d){var t=(el.textContent||"").trim();r[s[i]]={text:t,children:[t]};continue;}' +
              'var parts=[];' +
              'for(var c=el.firstChild;c;c=c.nextSibling){' +
                'if(c.nodeType===3){var ct=c.textContent.trim();if(ct)parts.push(ct);}' +
                'else if(c.nodeType===1){var tc2=(c.textContent||"").trim();if(tc2)parts.push(tc2);}' +
              '}' +
              'r[s[i]]={text:parts.join(d),children:parts};' +
            '}catch(e){r[s[i]]=null;}}' +
            'return JSON.stringify(r);' +
          '})()';
          var raw = await document.getElementById("webview").executeJavaScript(batchCode);
          var childTextMap = JSON.parse(raw || '{}');
          var doExpand = !!Parser.state.expandChildren;
          items.forEach(function(item) {
            if (!item.isGroup && item.selector && !item._tagHeader && childTextMap[item.selector] != null) {
              if (!item.elementInfo) item.elementInfo = {};
              item.elementInfo._childText = Parser.utils.normalizeText(childTextMap[item.selector].text || '');
              if (doExpand) {
                item._children = (childTextMap[item.selector].children || []).map(function(t) { return Parser.utils.normalizeText(t); });
              } else {
                delete item._children;
              }
            }
          });
        } catch(e) { /* ignore */ }
      }
    }

    // 按来源→匹配数排序
    var sorted = items.slice().sort(function (a, b) {
      var order = { pick: 1, auto: 2, '合并': 3, '拆分': 4, scan: 5 };
      var sa = order[a.source] || 5;
      var sb = order[b.source] || 5;
      if (sa !== sb) return sa - sb;
      return (b.matchCount || 0) - (a.matchCount || 0);
    });

    var rows = [];
    sorted.forEach(function (item, idx) {
      var info = item.elementInfo || {};
      var tag = info.tag || '?';
      var text = Parser.utils.normalizeText(info._childText || info.text || '');
      var href = info.href || '';
      var src = info.src || '';
      var display = (tag === 'a' && href) ? href : (tag === 'img' && src) ? src : text;
      if (item.isGroup && item.children) {
        var childTexts = item.children.map(function(c) {
          var ci2 = c.elementInfo || {};
          var ct2 = (ci2.tag || '').toLowerCase();
          var ch2 = ci2.href || '';
          var cs2 = ci2.src || '';
          var txt2 = Parser.utils.normalizeText(ci2.text || '');
          return (ct2 === 'a' && ch2) ? ch2 : (ct2 === 'img' && cs2) ? cs2 : txt2;
        });
        var combined = childTexts.join('');
        var sep = item._mergeSep || '';
        var preview = sep ? childTexts.join(sep) : combined;
        var groupRow = {
          '序号': idx + 1,
          '标签': '[合]',
          '来源': allSourceLabels[item.source || 'scan'] || item.source,
          '文本/链接': preview,
          'CSS选择器': item.selector || '',
          'XPath': item.xpath || (item.children[0] ? item.children[0].xpath || '' : ''),
          '匹配数': item.children.length + '合',
          '_isGroup': true,
          '_children': item.children,
          '_oidx': idx
        };
        for (var ek in info) { if (info.hasOwnProperty(ek) && !(ek in groupRow)) groupRow[ek] = info[ek]; }
        rows.push(groupRow);
        item.children.forEach(function(child, cIdx) {
          var ci = child.elementInfo || {};
          var ctag2 = (ci.tag || '?').toLowerCase();
          var chref2 = ci.href || '';
          var csrc2 = ci.src || '';
          var cdisplay = (ctag2 === 'a' && chref2) ? chref2 : (ctag2 === 'img' && csrc2) ? csrc2 : Parser.utils.normalizeText(ci.text || '');
          var childRow = {
            '序号': '',
            '标签': ' └ <' + (ci.tag || '?') + '>',
            '来源': '  ' + (allSourceLabels[child.source || ''] || ''),
            '文本/链接': cdisplay,
            'CSS选择器': child.selector || '',
            'XPath': child.xpath || '',
            '匹配数': child.matchCount || '-',
            '_isChild': true,
            '_oidx': idx,
            '_cidx': cIdx
          };
          for (var ek in ci) { if (ci.hasOwnProperty(ek) && !(ek in childRow)) childRow[ek] = ci[ek]; }
          rows.push(childRow);
        });
      } else {
        var sourceLabel = allSourceLabels[item.source || 'scan'] || '扫描';
        if (item.source === 'pick' && item.dragSession) {
          sourceLabel = '框选 ' + item.dragSession;
        }
        var normalRow = {
          '序号': idx + 1,
          '标签': '<' + tag + '>',
          '来源': sourceLabel,
          '文本/链接': display,
          'CSS选择器': item.selector || '',
          'XPath': item.xpath || '',
          '匹配数': item.matchCount || 0,
          '_oidx': idx
        };
        for (var ek in info) { if (info.hasOwnProperty(ek) && !(ek in normalRow)) normalRow[ek] = info[ek]; }
        if (item._children) normalRow._children = item._children;
        rows.push(normalRow);
      }
    });

    Parser.state.queryResults = rows;
    renderQueryTable(rows, ['序号', '标签', '来源', '文本/链接', 'CSS选择器', 'XPath', '匹配数',
      'class', 'id', 'href', 'src', 'title', 'target', 'rel', 'alt', 'type', 'name', 'style'], { type: 'items' });

    setTimeout(function () {
      queryResultsDiv.querySelectorAll('.result-table thead th').forEach(function (th) {
        th.style.whiteSpace = 'nowrap';
      });
    }, 0);
  }

  var _lastTreeHighlightSource = window._lastTreeHighlightSource = null;

  async function removeTreeHighlightsFromPage() {
    try {
      await webview.executeJavaScript('(function(){' +
        'var ovs=document.querySelectorAll(".__parser_tree_hl");' +
        'for(var i=0;i<ovs.length;i++){' +
          'var ov=ovs[i];' +
          'if(!ov.parentNode)continue;' +
          'var op=ov.getAttribute("data-ppos");' +
          'if(op!==null&&op!=="")ov.parentNode.style.position=op;' +
          'else if(ov.__origPos!==undefined)ov.parentNode.style.position=ov.__origPos||"";' +
          'else if(ov.__origParentPos!==undefined)ov.parentNode.style.position=ov.__origParentPos||"";' +
          'ov.parentNode.removeChild(ov);' +
        '}' +
      '})()');
    } catch(e) {}
  }

  async function doHighlightBySource(sourceFilter) {
    // 仅提取模式下才高亮，退出提取模式后不再绘制
    if (!Parser.state.pickModeActive) return;
    // 切换：再次点击同一个来源 → 取消高亮
    if (_lastTreeHighlightSource === sourceFilter) {
      _lastTreeHighlightSource = null;
      await removeTreeHighlightsFromPage();
      return;
    }

    var items = sourceFilter
      ? Parser.state.editorItems.filter(function (item) { return !item._isTagHeader && (item.source || 'scan') === sourceFilter; })
      : [];
    if (items.length === 0) return;

    // 先移除旧高亮
    await removeTreeHighlightsFromPage();

    _lastTreeHighlightSource = sourceFilter;

    // 为每项构建 {sel, xpath} 以回退查找
    var targets = items.map(function(it) { return { sel: it.selector, xpath: it.xpath || '' }; });

    // 颜色：框选=绿色, 识别=紫色
    var borderColor = sourceFilter === 'pick' ? '#4ade80' : '#a78bfa';
    var bgColor = sourceFilter === 'pick' ? 'rgba(74,222,128,0.15)' : 'rgba(167,139,250,0.15)';

    try {
      var targetsJson = JSON.stringify(targets);
      await webview.executeJavaScript('(function(targets,borderColor,bgColor){' +
        'for(var i=0;i<targets.length;i++){' +
          'try{' +
            // XPath 优先（全局唯一），CSS 作为后备
            'var el=null;' +
            'if(targets[i].xpath){try{el=document.evaluate(targets[i].xpath,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;}catch(xe){}}' +
            'if(!el&&targets[i].sel){try{el=document.querySelector(targets[i].sel);}catch(qe){}}' +
            'if(!el)continue;' +
            'var ov=document.createElement("div");' +
            'ov.className="__parser_tree_hl";' +
            'var tag=el.tagName.toUpperCase();' +
            'var isVoid=tag==="IMG"||tag==="INPUT"||tag==="BR"||tag==="HR"||tag==="SOURCE"||tag==="EMBED"||tag==="AREA";' +
            'if(!isVoid){' +
              'var oldPos=el.style.position;' +
              'ov.setAttribute("data-ppos",oldPos||"");' +
              'if(!oldPos||oldPos==="static")el.style.position="relative";' +
              'ov.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483639;border:2px solid "+borderColor+";border-radius:2px;box-sizing:border-box;background:"+bgColor;' +
              'el.appendChild(ov);' +
            '}else{' +
              'var parent=el.parentElement;if(!parent)continue;' +
              'var oldPPos=parent.style.position;' +
              'ov.setAttribute("data-ppos",oldPPos||"");' +
              'if(!oldPPos||oldPPos==="static")parent.style.position="relative";' +
              'var er=el.getBoundingClientRect();var pr=parent.getBoundingClientRect();' +
              'ov.style.cssText="position:absolute;left:"+(er.left-pr.left)+"px;top:"+(er.top-pr.top)+"px;width:"+er.width+"px;height:"+er.height+"px;pointer-events:none;z-index:2147483639;border:2px solid "+borderColor+";border-radius:2px;box-sizing:border-box;background:"+bgColor;' +
              'parent.appendChild(ov);' +
            '}' +
          '}catch(e){}' +
        '}' +
      '})(' + targetsJson + ',' + JSON.stringify(borderColor) + ',' + JSON.stringify(bgColor) + ')');
    } catch(e) { console.error('[doHighlightBySource] error:', e); }
  }

  function showPickedElementsPanel(sourceFilter) {
    var items = sourceFilter
      ? Parser.state.editorItems.filter(function (item) { return !item._isTagHeader && (item.source || 'scan') === sourceFilter; })
      : Parser.state.editorItems.filter(function(item) { return !item._isTagHeader; });
    if (sourceFilter && Parser.state.pickModeActive) {
      try { doHighlightBySource(sourceFilter); } catch(e) { console.error('[showPicked] call failed:', e); }
    }

    var allSourceLabels = { pick: '框选', auto: '识别', scan: '扫描', '合并': '合并', '拆分': '拆分' };
    var titleLabel = sourceFilter
      ? (allSourceLabels[sourceFilter] || '页面提取') + ' (' + items.length + ' 项)'
      : '页面提取 (' + items.length + ' 项)';

    contentTitle.textContent = titleLabel;
    hideAllPanels();
    queryContainer.classList.remove('hidden');
    showQueryInputRow();
    var inputRow = queryContainer.querySelector('.query-input-row');
    if (inputRow) inputRow.style.display = '';
    var toolbar = queryContainer.querySelector('.query-toolbar');
    if (toolbar) toolbar.style.display = 'flex';
    queryContainer.dataset.mode = sourceFilter ? '__picked_' + sourceFilter + '__' : '__picked__';

    renderQueryFromItems(items, allSourceLabels);
    setStatus('已选元素: ' + items.length + ' 项');
  }

  // ──────── 已选元素树节点管理 ────────

  function updatePickedTreeNodes() {
    _lastTreeHighlightSource = null;
    var existingHeader = treeContent.querySelector('.tree-group-header.picked-group');
    if (!existingHeader) return; // 页面提取分组不存在时不做任何事，由 buildTree/buildDefaultTree 提供

    var counts = { pick: 0, auto: 0, scan: 0, '合并': 0, '拆分': 0 };
    Parser.state.editorItems.forEach(function (item) {
      if (item._isTagHeader) return;
      counts[item.source || 'scan'] = (counts[item.source || 'scan'] || 0) + 1;
    });

    // 更新已有子节点的数量
    var body = existingHeader.nextElementSibling;
    if (!body || !body.classList.contains('tree-group-body')) return;
    var labels = { pick: '框选', auto: '识别', '合并': '合并', '拆分': '拆分', scan: '扫描' };
    var rows = body.querySelectorAll('.tree-node-row .node-count');
    rows.forEach(function (r) {
      var labelEl = r.parentElement.querySelector('.node-label');
      var label = labelEl ? labelEl.textContent : '';
      for (var src in labels) {
        if (labels[src] === label) { r.textContent = counts[src] || '0'; break; }
      }
    });
  }

  // ──────── 表单交互弹框 ────────

  var formModalFi = 0;
  var _formModalBound = false;

  function bindFormModalEvents() {
    if (_formModalBound) return; _formModalBound = true;
    btnFormModalClose.addEventListener('click', function() { formModal.classList.add('hidden'); });
    btnFormModalCancel.addEventListener('click', function() { formModal.classList.add('hidden'); });
    btnFormReset.addEventListener('click', function() {
      var container = formModalBody.querySelector('.form-fields-container');
      if (!container) return;
      container.querySelectorAll('input, select').forEach(function(inp) {
        if (inp.type === 'checkbox' || inp.type === 'radio') inp.checked = inp.dataset.defaultChecked === 'true';
        else inp.value = inp.dataset.defaultValue || '';
      });
    });
    btnFormSubmit.addEventListener('click', function() { submitFormModal(); });
    formModal.addEventListener('mousedown', function(e) { if (e.target === formModal) formModal.classList.add('hidden'); });
  }

  // ----- form modal functions -----
  async function openFormModal(fi) {
    bindFormModalEvents();
    formModalFi = fi;
    formModalTitle.textContent = '表单 #' + (fi + 1) + ' 交互编辑';
    formModalBody.innerHTML = '<div class="tree-empty">正在提取表单字段...</div>';
    formModal.classList.remove('hidden');
    try {
      var data = await webview.executeJavaScript('(function(fi){' +
        'try{var f=document.forms[fi];if(!f)return JSON.stringify({error:"not found"});' +
        'var fs=[];for(var i=0;i<f.elements.length;i++){' +
        'var el=f.elements[i];try{var oo=null;' +
        'if(el.options&&el.options.length){oo=[];for(var o=0;o<el.options.length;o++){oo.push({t:el.options[o].text,v:el.options[o].value,s:el.options[o].selected});}}' +
        'fs.push({n:el.name||"",t:el.type||(el.tagName||"").toLowerCase(),g:(el.tagName||"").toLowerCase(),v:el.value||"",p:el.placeholder||"",i:el.id||"",c:!!el.checked,d:!!el.disabled,r:!!el.required,o:oo});' +
        '}catch(e){fs.push({n:el.name||"",t:"txt",g:"input",v:"",p:"",i:"",c:0,d:0,r:0,o:null});}' +
        '}return JSON.stringify({a:f.action||"",m:(f.method||"get").toUpperCase(),fs:fs});' +
        '}catch(e){return JSON.stringify({error:e.message});}' +
      '})(' + fi + ')');
      var form = JSON.parse(data || '{}');
      if (form.error) { formModalBody.innerHTML = '<div class="tree-empty">' + escapeHtml(form.error) + '</div>'; return; }
      var html = '<div style="font-size:12px;color:var(--text-dim);margin-bottom:12px">' + escapeHtml(form.m||'GET') + ' ' + escapeHtml(form.a||'') + '</div>';
      html += '<div class="form-fields-container" style="display:flex;flex-direction:column;gap:8px">';
      (form.fs||[]).forEach(function(fd, idx) {
        if (fd.t === 'hidden' || fd.t === 'submit' || fd.t === 'button' || fd.t === 'reset' || fd.t === 'image') return;
        var lb = fd.n || fd.i || '[' + (fd.t||'?') + ']';
        var _id = 'fm_' + idx;
        html += '<div style="display:flex;align-items:center;gap:8px;padding:2px 0">';
        html += '<label for="'+_id+'" style="min-width:110px;font-size:12px;color:var(--text-dim);word-break:break-all;flex-shrink:0">' + escapeHtml(lb) + '</label>';
        if (fd.g === 'select') {
          html += '<select id="'+_id+'" class="form-input form-field-input" data-idx="'+idx+'" style="flex:1;height:30px">';
          (fd.o||[]).forEach(function(o) { html += '<option value="'+escapeHtml(o.v)+'"'+(o.s?' selected':'')+'>'+escapeHtml(o.t)+'</option>'; });
          html += '</select>';
        } else if (fd.t === 'checkbox' || fd.t === 'radio') {
          html += '<input type="'+fd.t+'" id="'+_id+'" class="form-field-input" data-idx="'+idx+'"'+(fd.c?' checked':'')+' data-default-checked="'+(fd.c||false)+'">';
        } else if (fd.t === 'file') {
          html += '<span style="font-size:12px;color:var(--text-dim)">[文件上传,暂不支持]</span>';
        } else {
          html += '<input type="'+(fd.t||'text')+'" id="'+_id+'" class="form-input form-field-input" data-idx="'+idx+'" value="'+escapeHtml(fd.v||'')+'" placeholder="'+escapeHtml(fd.p||'')+'" data-default-value="'+escapeHtml(fd.v||'')+'" style="flex:1;height:30px">';
        }
        if (fd.r) html += '<span style="color:var(--red);font-size:11px">*必填</span>';
        html += '</div>';
      });
      html += '</div>';
      formModalBody.innerHTML = html;
    } catch (e) { formModalBody.innerHTML = '<div class="tree-empty">' + escapeHtml(e.message) + '</div>'; }
  }

  async function submitFormModal() {
    setStatus('正在提交表单...');
    try {
      var vals = [];
      formModalBody.querySelectorAll('.form-field-input').forEach(function(inp) {
        var idx = parseInt(inp.dataset.idx);
        if (isNaN(idx)) return;
        if (inp.type === 'checkbox') vals[idx] = {c:inp.checked};
        else if (inp.type === 'radio') vals[idx] = {c:inp.checked};
        else if (inp.tagName === 'SELECT') vals[idx] = {v:inp.value};
        else vals[idx] = {v:inp.value};
      });
      var vj = JSON.stringify(vals);
      var js = '(function(fi,vj){' +
        'var vs=JSON.parse(vj);var f=document.forms[fi];if(!f)return;' +
        'for(var i=0;i<f.elements.length;i++){if(vs[i]){' +
        'var el=f.elements[i];' +
        'if(el.type==="checkbox"||el.type==="radio")el.checked=!!vs[i].c;' +
        'else if(el.options){for(var o=0;o<el.options.length;o++){if(el.options[o].value===vs[i].v){el.selectedIndex=o;break;}}}' +
        'else el.value=vs[i].v||"";}}' +
        'f.submit();' +
      '})(' + formModalFi + ',' + JSON.stringify(vj) + ')';
      await webview.executeJavaScript(js);
      formModal.classList.add('hidden');
      setStatus('表单已提交，等待加载...');
      await new Promise(function(resolve) {
        var t = setTimeout(function() { resolve(); }, 15000);
        webview.addEventListener('did-finish-load', function onLd() { clearTimeout(t); webview.removeEventListener('did-finish-load', onLd); resolve(); });
      });
      setStatus('表单已提交，点击解析提取数据');
    } catch (e) { setStatus('提交失败: ' + e.message); }
  }

  var cachedDomTree = null;
  var cachedNodeExplorerData = null;  // 节点浏览器缓存
  var _neContextNode = null;          // 节点浏览器右键菜单当前节点
  var _neDetailNode = null;           // 节点浏览器详情面板当前节点
  var _neSearchTimer = null;          // 搜索防抖定时器
  // ──────── DOM 树面板 ────────
  function showDomTreePanel(tree) {
    if (!tree) tree = cachedDomTree || {};
    setStatus('DOM 树');
    contentTitle.textContent = 'DOM 树';
    cachedDomTree = tree;

    hideAllPanels();
    queryContainer.classList.remove('hidden');
    queryContainer.dataset.mode = '__dom__';
    showQueryInputRow();
    queryResultsDiv.innerHTML = '';
    renderDomTreeInResults();
  }

  function renderDomTreeInResults() {
    if (!cachedDomTree) return;
    var searchQ = (document.getElementById('querySearch') || {}).value || '';
    queryResultsDiv.innerHTML = '';
    var rootDiv = document.createElement('div');
    rootDiv.style.fontFamily = 'Consolas,monospace';
    rootDiv.style.fontSize = '13px';
    rootDiv.style.overflow = 'auto';
    rootDiv.style.minHeight = '100%';
    var matched = buildDomTreeFiltered(cachedDomTree, searchQ);
    if (matched) rootDiv.appendChild(matched);
    else rootDiv.innerHTML = '<div class="tree-empty">无匹配节点</div>';
    queryResultsDiv.appendChild(rootDiv);
  }

  function buildDomTreeFiltered(node, filter) {
    var tag = node.tag || '#root';
    var tagMatch = !filter || tag.toLowerCase().includes(filter.toLowerCase());

    var div = document.createElement('div');
    div.style.marginLeft = '16px';
    var header = document.createElement('div');
    header.style.cssText = 'padding:2px 0;cursor:pointer;font-family:Consolas,"Microsoft YaHei",monospace;';
    var label = '<span style="color:#808080">&lt;</span><span style="color:#569cd6">' + tag + '</span>';
    if (node['属性']) {
      Object.entries(node['属性']).forEach(function(attr) {
        label += ' <span style="color:#9cdcfe">' + attr[0] + '</span>=<span style="color:#ce9178">&quot;' + escapeHtml(attr[1]) + '&quot;</span>';
      });
    }
    label += '<span style="color:#808080">&gt;</span>';
    if (node['文本']) {
      label += ' <span style="color:#8888a0">' + escapeHtml(node['文本'].substring(0, 60)) + '</span>';
    }
    if (node['子元素数']) {
      label += ' <span style="color:#8888a0;font-size:11px">(' + node['子元素数'] + ')</span>';
    }
    header.innerHTML = label;

    var childrenDiv = document.createElement('div');
    if (node['子元素']) {
      for (var i = 0; i < node['子元素'].length; i++) {
        var child = node['子元素'][i];
        var childResult = buildDomTreeFiltered(child, filter);
        if (childResult) childrenDiv.appendChild(childResult);
      }
    }

    var hasVisibleChild = childrenDiv.children.length > 0;
    if (!tagMatch && !hasVisibleChild) return null;

    var collapsed = false;
    header.addEventListener('click', function() {
      collapsed = !collapsed;
      childrenDiv.style.display = collapsed ? 'none' : 'block';
    });

    div.appendChild(header);
    div.appendChild(childrenDiv);
    return div;
  }

  function renderDomTree(node) {
    const div = document.createElement('div');
    div.style.marginLeft = '16px';
    const header = document.createElement('div');
    header.style.cssText = 'padding:2px 0;cursor:pointer;font-family:Consolas,"Microsoft YaHei",monospace;';
    const tag = node.tag || '#root';
    let label = '<span style="color:var(--blue)">&lt;' + tag + '</span>';
    if (node['属性']) {
      Object.entries(node['属性']).forEach(([k, v]) => {
        label += ' <span style="color:var(--yellow)">' + k + '</span>=<span style="color:var(--green)">&quot;' + escapeHtml(v) + '&quot;</span>';
      });
    }
    label += '<span style="color:var(--blue)">&gt;</span>';
    if (node['文本']) {
      label += ' <span style="color:var(--text-dim)">' + escapeHtml(node['文本'].substring(0, 60)) + '</span>';
    }
    if (node['子元素数']) {
      label += ' <span style="color:var(--text-dim);font-size:11px">(' + node['子元素数'] + ' 子元素)</span>';
    }
    header.innerHTML = label;
    const childrenDiv = document.createElement('div');
    childrenDiv.style.display = 'block';
    header.addEventListener('click', () => {
      childrenDiv.style.display = childrenDiv.style.display === 'none' ? 'block' : 'none';
    });
    div.appendChild(header);
    if (node['子元素']) {
      node['子元素'].forEach(child => childrenDiv.appendChild(renderDomTree(child)));
    }
    div.appendChild(childrenDiv);
    return div;
  }

  // ──────── 节点浏览器 ────────
  function showNodeExplorer(tree) {
    if (!tree || Object.keys(tree).length === 0) {
      setStatus('节点浏览器');
      contentTitle.textContent = '节点浏览器';
      hideAllPanels();
      queryContainer.classList.remove('hidden');
      queryContainer.dataset.mode = '__node_explorer__';
      var inputRow = queryContainer.querySelector('.query-input-row');
      if (inputRow) inputRow.style.display = 'none';
      var exportBtn = document.getElementById('btnExportQuery');
      var checkAll = document.getElementById('queryCheckAll');
      if (exportBtn) exportBtn.style.display = 'none';
      if (checkAll) checkAll.style.display = 'none';
      var searchEl = document.getElementById('querySearch');
      if (searchEl) searchEl.value = '';
      queryResultsDiv.innerHTML = '<div class="tree-empty" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--text-dim)">请先解析页面获取 DOM 树</div>';
      return;
    }
    setStatus('节点浏览器');
    contentTitle.textContent = '节点浏览器';
    cachedNodeExplorerData = tree;

    hideAllPanels();
    queryContainer.classList.remove('hidden');
    queryContainer.dataset.mode = '__node_explorer__';

    // 隐藏查询输入行，保留工具栏中的搜索框
    var inputRow = queryContainer.querySelector('.query-input-row');
    if (inputRow) inputRow.style.display = 'none';
    var toolbar = queryContainer.querySelector('.query-toolbar');
    if (toolbar) toolbar.style.display = 'flex';
    var exportBtn = document.getElementById('btnExportQuery');
    var checkAll = document.getElementById('queryCheckAll');
    if (exportBtn) exportBtn.style.display = 'none';
    if (checkAll) checkAll.style.display = 'none';

    // 设置搜索输入框
    var searchEl = document.getElementById('querySearch');
    if (searchEl) {
      searchEl.value = '';
      searchEl.oninput = function() {
        clearTimeout(_neSearchTimer);
        _neSearchTimer = setTimeout(function() {
          var q = (searchEl.value || '').trim().toLowerCase();
          renderNodeExplorerTree(cachedNodeExplorerData, q);
        }, 150);
      };
    }

    renderNodeExplorerTree(tree, '');
  }

  function renderNodeExplorerTree(tree, filter) {
    queryResultsDiv.innerHTML = '';
    queryResultsDiv.style.display = 'flex';
    queryResultsDiv.style.flexDirection = 'row';
    queryResultsDiv.style.overflow = 'hidden';
    queryResultsDiv.style.height = '100%';

    // 左：树面板
    var treePanel = document.createElement('div');
    treePanel.className = 'ne-tree-panel';

    // 分割线
    var resizeHandle = document.createElement('div');
    resizeHandle.className = 'ne-resize-handle';

    // 右：详情面板
    var detailPanel = document.createElement('div');
    detailPanel.className = 'ne-detail-panel';
    detailPanel.innerHTML = '<div class="ne-detail-empty">单击节点查看详情</div>';

    // 拖动调整宽度
    var startX = 0, startWidth = 0;
    resizeHandle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      startX = e.clientX;
      startWidth = detailPanel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      resizeHandle.classList.add('dragging');

      function onMove(ev) {
        var dx = startX - ev.clientX;
        var newWidth = Math.max(180, Math.min(600, startWidth + dx));
        detailPanel.style.flex = '0 0 ' + newWidth + 'px';
        detailPanel.style.width = newWidth + 'px';
        detailPanel.style.maxWidth = '600px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        resizeHandle.classList.remove('dragging');
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 双击分割线恢复默认宽度
    resizeHandle.addEventListener('dblclick', function() {
      detailPanel.style.flex = '0 0 300px';
      detailPanel.style.width = '300px';
      detailPanel.style.maxWidth = '420px';
    });

    // 构建树
    var rootEl = buildNodeExplorerNode(tree, filter, 0, !!filter);
    treePanel.appendChild(rootEl);

    // 搜索后滚动到第一个匹配
    if (filter) {
      setTimeout(function() {
        var firstMatch = treePanel.querySelector('.ne-search-match');
        if (firstMatch) {
          firstMatch.scrollIntoView({ block: 'center' });
        } else {
          // 无匹配，显示提示
          var emptyEl = document.createElement('div');
          emptyEl.className = 'ne-tree-empty';
          emptyEl.textContent = '无匹配节点';
          emptyEl.style.cssText = 'text-align:center;padding:20px;color:var(--text-dim);font-size:13px;';
          treePanel.prepend(emptyEl);
        }
      }, 50);
    }

    queryResultsDiv.appendChild(treePanel);
    queryResultsDiv.appendChild(resizeHandle);
    queryResultsDiv.appendChild(detailPanel);
  }

  // 判断节点是否匹配搜索
  function _neNodeMatches(node, filter) {
    if (!filter) return false;
    var tag = (node.tag || '').toLowerCase();
    if (tag.indexOf(filter) >= 0) return true;
    if (node['文本'] && node['文本'].toLowerCase().indexOf(filter) >= 0) return true;
    if (node['属性']) {
      var attrs = node['属性'];
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.toLowerCase().indexOf(filter) >= 0) return true;
        if (attrs[k] && attrs[k].toLowerCase().indexOf(filter) >= 0) return true;
      }
    }
    return false;
  }

  function buildNodeExplorerNode(node, filter, depth, searchMode) {
    var tag = node.tag || '#root';
    var isText = tag === '#text';
    var isComment = tag === '#comment';
    var isRoot = tag === '#root';

    // 搜索模式：判断当前节点和后代是否有匹配
    var selfMatch = searchMode && _neNodeMatches(node, filter);
    var hasDescendantMatch = false;
    if (searchMode && !selfMatch && node['子元素']) {
      hasDescendantMatch = _neHasDescendantMatch(node, filter);
    }

    // 完全无匹配且搜索模式下 → 隐藏整个分支
    if (searchMode && !selfMatch && !hasDescendantMatch) {
      var hiddenDiv = document.createElement('div');
      hiddenDiv.style.display = 'none';
      return hiddenDiv;
    }

    // 节点容器
    var nodeDiv = document.createElement('div');
    nodeDiv.className = 'ne-node-container';

    // 行
    var row = document.createElement('div');
    row.className = 'ne-node-row';
    row.style.paddingLeft = (depth * 16 + 4) + 'px';
    if (searchMode && selfMatch) row.classList.add('ne-search-match');
    if (searchMode && !selfMatch) row.classList.add('ne-dimmed');

    // 箭头
    var hasChildren = node['子元素'] && node['子元素'].length > 0;
    var arrow = document.createElement('span');
    arrow.className = 'ne-arrow';
    if (!hasChildren) {
      arrow.classList.add('empty');
      arrow.textContent = ' ';
    } else {
      // 默认：根节点和第一层展开，其余折叠；搜索时匹配路径展开
      var shouldExpand = depth < 1 || (searchMode && (selfMatch || hasDescendantMatch));
      arrow.textContent = shouldExpand ? '\u25bc' : '\u25b6';
    }

    // 节点图标
    var icon = document.createElement('span');
    icon.className = 'ne-icon';
    if (isText) {
      icon.classList.add('text');
      icon.textContent = 'T';
    } else if (isComment) {
      icon.classList.add('comment');
      icon.textContent = '//';
    } else {
      icon.classList.add('element');
      icon.textContent = '\u25c7';
    }

    // 标签名（#text/#comment 特殊显示）
    var tagLabel = document.createElement('span');
    if (isText) {
      tagLabel.className = 'ne-text-label';
      tagLabel.textContent = '#text';
    } else if (isComment) {
      tagLabel.className = 'ne-comment-label';
      tagLabel.textContent = '#comment';
    } else if (isRoot) {
      tagLabel.className = 'ne-tag';
      tagLabel.textContent = '#root';
    } else {
      tagLabel.className = 'ne-tag';
      var display = node['_display'] || tag;
      // 编码HTML
      display = display.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      tagLabel.innerHTML = display;
    }

    // 文本预览
    if (node['文本'] && !isComment) {
      var preview = document.createElement('span');
      preview.className = 'ne-text-preview';
      var txt = node['文本'].replace(/\s+/g, ' ').substring(0, 60);
      preview.textContent = txt;
      row.appendChild(arrow);
      row.appendChild(icon);
      row.appendChild(tagLabel);
      row.appendChild(preview);
    } else {
      row.appendChild(arrow);
      row.appendChild(icon);
      row.appendChild(tagLabel);
    }

    // 子元素数 + 截断标记
    if (node['子元素数'] || node['_截断']) {
      var count = document.createElement('span');
      count.className = 'ne-child-count';
      var parts = [];
      if (node['子元素数']) parts.push(node['子元素数']);
      if (node['_截断']) parts.push('+ ' + node['_截断'] + ' 未显示');
      count.textContent = '(' + parts.join(', ') + ')';
      row.appendChild(count);
    }

    // 子元素容器
    var childrenDiv = document.createElement('div');
    childrenDiv.className = 'ne-children';
    if (hasChildren) {
      var shouldExpand = depth < 1 || (searchMode && (selfMatch || hasDescendantMatch));
      if (!shouldExpand) childrenDiv.style.display = 'none';
    }

    // 单击 → 显示详情
    row.addEventListener('click', function(e) {
      e.stopPropagation();
      // 高亮选中行
      var treePanel = queryResultsDiv.querySelector('.ne-tree-panel');
      if (treePanel) {
        treePanel.querySelectorAll('.ne-node-row.selected').forEach(function(r) { r.classList.remove('selected'); });
      }
      row.classList.add('selected');
      showNodeDetail(node);
    });

    // 双击 → 高亮
    row.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      highlightNodeInWebview(node);
    });

    // 右键 → 上下文菜单
    row.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      _neContextNode = node;
      var treePanel = queryResultsDiv.querySelector('.ne-tree-panel');
      if (treePanel) {
        treePanel.querySelectorAll('.ne-node-row.selected').forEach(function(r) { r.classList.remove('selected'); });
      }
      row.classList.add('selected');
      showNodeExplorerContextMenu(e.clientX, e.clientY, node);
    });

    // 箭头点击 → 折叠/展开
    if (hasChildren) {
      arrow.addEventListener('click', function(e) {
        e.stopPropagation();
        var hidden = childrenDiv.style.display === 'none';
        childrenDiv.style.display = hidden ? 'block' : 'none';
        arrow.textContent = hidden ? '\u25bc' : '\u25b6';
      });
    }

    nodeDiv.appendChild(row);

    // 递归构建子节点
    if (node['子元素']) {
      for (var i = 0; i < node['子元素'].length; i++) {
        var childEl = buildNodeExplorerNode(node['子元素'][i], filter, depth + 1, searchMode);
        childrenDiv.appendChild(childEl);
      }
    }
    nodeDiv.appendChild(childrenDiv);

    return nodeDiv;
  }

  function _neHasDescendantMatch(node, filter) {
    if (!node['子元素']) return false;
    for (var i = 0; i < node['子元素'].length; i++) {
      var child = node['子元素'][i];
      if (_neNodeMatches(child, filter)) return true;
      if (_neHasDescendantMatch(child, filter)) return true;
    }
    return false;
  }

  // ── 详情面板 ──
  function showNodeDetail(node) {
    var detailPanel = queryResultsDiv.querySelector('.ne-detail-panel');
    if (!detailPanel) return;
    _neDetailNode = node;

    var tag = node.tag || '#root';
    var isText = tag === '#text';
    var isComment = tag === '#comment';
    var isRoot = tag === '#root';
    var isVoid = /^(IMG|INPUT|BR|HR|SOURCE|EMBED|AREA|LINK|META|BASE|COL|EMBED|PARAM|TRACK|WBR)$/i.test(tag);

    var html = '';

    // ── 节点类型 && 标签 ──
    html += '<div class="ne-detail-section">';
    html += '<div class="ne-detail-section-title">节点信息</div>';
    if (isRoot) {
      html += '<div class="ne-detail-tag-wrap"><span class="ne-tag-badge">#root</span> <span class="ne-detail-sub">文档根节点</span></div>';
    } else if (isText) {
      html += '<div class="ne-detail-tag-wrap"><span class="ne-tag-badge ne-badge-text">#text</span> <span class="ne-detail-sub">文本节点</span></div>';
    } else if (isComment) {
      html += '<div class="ne-detail-tag-wrap"><span class="ne-tag-badge ne-badge-comment">#comment</span> <span class="ne-detail-sub">注释节点</span></div>';
    } else {
      html += '<div class="ne-detail-tag-wrap"><span class="ne-tag-badge">' + escapeHtml(tag) + '</span>';
      if (isVoid) html += ' <span class="ne-void-badge">void</span>';
      html += '</div>';
    }
    html += '</div>';

    // ── 属性表格 ──
    if (node['属性'] && Object.keys(node['属性']).length > 0) {
      html += '<div class="ne-detail-section">';
      html += '<div class="ne-detail-section-title">属性 (' + Object.keys(node['属性']).length + ')</div>';
      html += '<table class="ne-detail-attrs-table">';
      var attrs = node['属性'];
      Object.keys(attrs).forEach(function(k) {
        html += '<tr><td class="ne-detail-attr-key">' + escapeHtml(k) + '</td><td class="ne-detail-attr-val">' + escapeHtml(String(attrs[k])) + '</td></tr>';
      });
      html += '</table>';
      html += '</div>';
    }

    // ── 文本内容 ──
    if (node['文本']) {
      html += '<div class="ne-detail-section">';
      html += '<div class="ne-detail-section-title">文本内容</div>';
      html += '<div class="ne-detail-text">' + escapeHtml(node['文本']) + '</div>';
      html += '</div>';
    }

    // ── XPath ──
    if (!isRoot && !isText && !isComment) {
      var xpath = buildXPathFromTree(node, cachedNodeExplorerData);
      if (xpath) {
        html += '<div class="ne-detail-section">';
        html += '<div class="ne-detail-section-title">XPath</div>';
        html += '<div class="ne-detail-path ne-copy-xpath" title="点击复制">' + escapeHtml(xpath) + '</div>';
        html += '</div>';
      }
    }

    // ── CSS 路径 ──
    if (!isRoot && !isText && !isComment) {
      var cssPath = buildCSSPathFromTree(node, cachedNodeExplorerData);
      if (cssPath) {
        html += '<div class="ne-detail-section">';
        html += '<div class="ne-detail-section-title">CSS 路径</div>';
        html += '<div class="ne-detail-path ne-copy-css" title="点击复制">' + escapeHtml(cssPath) + '</div>';
        html += '</div>';
      }
    }

    // ── 子元素列表 ──
    if (node['子元素'] && node['子元素'].length > 0) {
      html += '<div class="ne-detail-section">';
      html += '<div class="ne-detail-section-title">子元素 (' + node['子元素数'] + ')</div>';
      html += '<div class="ne-detail-children-list">';
      // 只列出前 30 个
      var maxShow = Math.min(node['子元素'].length, 30);
      for (var i = 0; i < maxShow; i++) {
        var child = node['子元素'][i];
        var childTag = child.tag || '?';
        if (childTag === '#text') {
          html += '<span class="ne-detail-child-text">#text </span>';
        } else if (childTag === '#comment') {
          html += '<span class="ne-detail-child-comment">#comment </span>';
        } else {
          var childDisplay = child['_display'] || childTag;
          html += '<span class="ne-detail-child-tag" data-child-idx="' + i + '">' + escapeHtml(childDisplay) + '</span> ';
        }
      }
      if (node['子元素'].length > 30) html += '<span class="ne-detail-sub">... 还有 ' + (node['子元素'].length - 30) + ' 个</span>';
      if (node['_截断']) html += '<div class="ne-detail-sub" style="margin-top:4px">另有 ' + node['_截断'] + ' 个子元素被截断</div>';
      html += '</div>';
      html += '</div>';
    }

    // ── 操作按钮 ──
    html += '<div class="ne-detail-section">';
    html += '<div class="ne-detail-section-title">操作</div>';
    html += '<div class="ne-detail-actions">';
    if (!isRoot && !isText && !isComment) {
      html += '<button class="btn btn-sm ne-action-btn" onclick="window._neCopyXPath()">&#x1F4CB; 复制 XPath</button>';
      html += '<button class="btn btn-sm ne-action-btn" onclick="window._neCopyCSS()">&#x1F4CB; 复制 CSS</button>';
      html += '<button class="btn btn-sm ne-action-btn" onclick="window._neHighlight()">&#x1F3AF; 高亮元素</button>';
      html += '<button class="btn btn-sm ne-action-btn" onclick="window._neAddToEditor()">&#x2795; 添加到提取</button>';
    } else if (isText) {
      html += '<button class="btn btn-sm ne-action-btn" onclick="window._neCopyText()">&#x1F4CB; 复制文本</button>';
    }
    html += '</div>';
    html += '</div>';

    detailPanel.innerHTML = html;

    // 绑定子元素点击 → 展开树中对应节点
    detailPanel.querySelectorAll('.ne-detail-child-tag').forEach(function(span) {
      span.addEventListener('click', function() {
        var idx = parseInt(span.dataset.childIdx);
        if (!isNaN(idx) && node['子元素'] && node['子元素'][idx]) {
          var childNode = node['子元素'][idx];
          // 展开到该子节点并高亮
          _neRevealNodeInTree(childNode);
        }
      });
    });

    // 绑定复制路径点击
    var copyXPathEl = detailPanel.querySelector('.ne-copy-xpath');
    if (copyXPathEl) {
      copyXPathEl.addEventListener('click', function() {
        var xp = buildXPathFromTree(node, cachedNodeExplorerData);
        if (xp) { addToClipboard(xp, 'XPath'); setStatus('XPath 已复制'); }
      });
    }
    var copyCSSEl = detailPanel.querySelector('.ne-copy-css');
    if (copyCSSEl) {
      copyCSSEl.addEventListener('click', function() {
        var cp = buildCSSPathFromTree(node, cachedNodeExplorerData);
        if (cp) { addToClipboard(cp, 'CSS 路径'); setStatus('CSS 路径已复制'); }
      });
    }
  }

  // 展开树到指定节点
  function _neRevealNodeInTree(targetNode) {
    var treePanel = queryResultsDiv.querySelector('.ne-tree-panel');
    if (!treePanel) return;
    // 在树中找到并展开该节点的父链
    // 由于树DOM和节点数据没有直接关联，我们通过重建树来定位
    // 简单方案：在详情面板中直接用子节点数据触发详情展示
    if (targetNode) {
      showNodeDetail(targetNode);
      // 同时高亮（如果非文本/注释）
      if (targetNode.tag !== '#text' && targetNode.tag !== '#comment') {
        highlightNodeInWebview(targetNode);
      }
    }
  }

  // ── XPath 生成 ──
  function buildXPathFromTree(target, rootTree) {
    if (!target || !rootTree) return null;
    if (target.tag === '#text' || target.tag === '#comment') return null;

    // 有 ID 属性 → 直接用简短形式
    if (target['属性'] && target['属性'].id) {
      return '//*[@id="' + target['属性'].id + '"]';
    }

    var path = [];
    function walk(node) {
      if (node === target) return true;
      if (!node['子元素']) return false;

      var tagCount = {};
      for (var i = 0; i < node['子元素'].length; i++) {
        var child = node['子元素'][i];
        var t = child.tag;
        if (t === '#text' || t === '#comment') continue;

        tagCount[t] = (tagCount[t] || 0) + 1;
        path.push(t + '[' + tagCount[t] + ']');

        if (walk(child)) return true;
        path.pop();
      }
      return false;
    }

    if (walk(rootTree) && path.length > 0) {
      return '/' + path.join('/');
    }
    // 降级：用 CSS 路径替代
    return buildCSSPathFromTree(target, rootTree);
  }

  // ── CSS 路径生成 ──
  function buildCSSPathFromTree(target, rootTree) {
    if (!target || !rootTree) return null;
    if (target.tag === '#text' || target.tag === '#comment') return null;

    if (target['属性'] && target['属性'].id) {
      return target.tag + '#' + target['属性'].id;
    }

    var path = [];
    function walk(node) {
      if (node === target) return true;
      if (!node['子元素']) return false;

      for (var i = 0; i < node['子元素'].length; i++) {
        var child = node['子元素'][i];
        if (child.tag === '#text' || child.tag === '#comment') continue;

        var css = child.tag;
        // 计算同级元素中相同 tag 的序号
        var sameTagIdx = 0;
        for (var j = 0; j <= i; j++) {
          if (node['子元素'][j].tag === child.tag) sameTagIdx++;
        }
        if (sameTagIdx > 0) {
          // 检查是否有多个相同 tag
          var totalSame = 0;
          for (var k = 0; k < node['子元素'].length; k++) {
            if (node['子元素'][k].tag === child.tag) totalSame++;
          }
          if (totalSame > 1) css += ':nth-of-type(' + sameTagIdx + ')';
        }

        path.push(css);
        if (walk(child)) return true;
        path.pop();
      }
      return false;
    }

    if (walk(rootTree) && path.length > 0) {
      return path.join(' > ');
    }
    return null;
  }

  // ── 生成 outerHTML ──
  function _neGenerateOuterHTML(node) {
    if (!node) return '';
    var tag = node.tag;
    if (tag === '#root') return _neGenerateInnerHTML(node);
    if (tag === '#text') return (node['文本'] || '');
    if (tag === '#comment') return '<!--' + (node['文本'] || '') + '-->';

    var isVoid = /^(IMG|INPUT|BR|HR|SOURCE|EMBED|AREA|LINK|META|BASE|COL|EMBED|PARAM|TRACK|WBR)$/i.test(tag);
    var html = '<' + tag;
    if (node['属性']) {
      var keys = Object.keys(node['属性']);
      for (var i = 0; i < keys.length; i++) {
        html += ' ' + keys[i] + '="' + escapeHtml(String(node['属性'][keys[i]])) + '"';
      }
    }
    if (isVoid) {
      html += ' />';
      return html;
    }
    html += '>';
    if (node['文本']) html += escapeHtml(node['文本']);
    if (node['子元素']) {
      for (var j = 0; j < node['子元素'].length; j++) {
        html += _neGenerateOuterHTML(node['子元素'][j]);
      }
    }
    html += '</' + tag + '>';
    return html;
  }

  function _neGenerateInnerHTML(node) {
    if (!node) return '';
    var html = '';
    if (node['子元素']) {
      for (var i = 0; i < node['子元素'].length; i++) {
        html += _neGenerateOuterHTML(node['子元素'][i]);
      }
    }
    return html;
  }

  // ── 高亮节点 ──
  async function highlightNodeInWebview(node) {
    if (!node) return;
    var tag = node.tag;
    if (tag === '#text' || tag === '#comment' || tag === '#root') {
      setStatus(tag === '#root' ? '根节点无法高亮' : '文本/注释节点无法高亮');
      return;
    }
    var xpath = buildXPathFromTree(node, cachedNodeExplorerData);
    if (!xpath) {
      // 降级：尝试用 CSS 路径
      xpath = null;
      var cssPath = buildCSSPathFromTree(node, cachedNodeExplorerData);
      if (!cssPath) {
        setStatus('无法生成选择器');
        return;
      }
      // 用 CSS 选择器查找
      try {
        await removeNodeExplorerHighlights();
        await webview.executeJavaScript('(function(sel){' +
          'try{var els=document.querySelectorAll(sel);' +
          'if(els.length===0)return;var el=els[0];' +
          'el.scrollIntoView({behavior:"smooth",block:"center"});' +
          'var b=document.createElement("div");' +
          'b.className="__parser_ne_hl";' +
          'var tag=el.tagName.toUpperCase();' +
          'var isVoid=tag==="IMG"||tag==="INPUT"||tag==="BR"||tag==="HR"||tag==="SOURCE"||tag==="EMBED"||tag==="AREA";' +
          'if(!isVoid){' +
            'var oldPos=el.style.position;b.setAttribute("data-ppos",oldPos||"");if(!oldPos||oldPos==="static")el.style.position="relative";' +
            'b.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483642;border:3px solid #f59e0b;border-radius:3px;background:rgba(245,158,11,0.15);transition:opacity 0.4s";' +
            'el.appendChild(b);' +
          '}else{' +
            'var parent=el.parentElement;if(!parent)return;' +
            'var oldPPos=parent.style.position;b.setAttribute("data-ppos",oldPPos||"");if(!oldPPos||oldPPos==="static")parent.style.position="relative";' +
            'var er=el.getBoundingClientRect();var pr=parent.getBoundingClientRect();' +
            'b.style.cssText="position:absolute;left:"+(er.left-pr.left)+"px;top:"+(er.top-pr.top)+"px;width:"+er.width+"px;height:"+er.height+"px;pointer-events:none;z-index:2147483642;border:3px solid #f59e0b;border-radius:3px;background:rgba(245,158,11,0.15);transition:opacity 0.4s";' +
            'parent.appendChild(b);' +
          '}' +
          'setTimeout(function(){b.style.opacity="0";setTimeout(function(){if(b.parentNode){var op=b.getAttribute("data-ppos");if(op!==null&&op!=="")b.parentNode.style.position=op;b.parentNode.removeChild(b);}},400);},3000);' +
          '}catch(e){console.error("[ne_hl]",e);}' +
        '})("' + cssPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")');
        setStatus('已高亮: ' + (node['_display'] || node.tag) + ' (CSS)');
      } catch (e) {
        console.error('[highlightNodeInWebview] CSS fallback error:', e);
        setStatus('高亮失败');
      }
      return;
    }
    try {
      await removeNodeExplorerHighlights();
      await webview.executeJavaScript('(function(xp){' +
        'try{' +
        'var el=document.evaluate(xp,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;' +
        'if(!el)return;' +
        'el.scrollIntoView({behavior:"smooth",block:"center"});' +
        'var b=document.createElement("div");' +
        'b.className="__parser_ne_hl";' +
        'var tag=el.tagName.toUpperCase();' +
        'var isVoid=tag==="IMG"||tag==="INPUT"||tag==="BR"||tag==="HR"||tag==="SOURCE"||tag==="EMBED"||tag==="AREA";' +
        'if(!isVoid){' +
          'var oldPos=el.style.position;b.setAttribute("data-ppos",oldPos||"");if(!oldPos||oldPos==="static")el.style.position="relative";' +
          'b.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483642;border:3px solid #f59e0b;border-radius:3px;background:rgba(245,158,11,0.15);transition:opacity 0.4s";' +
          'el.appendChild(b);' +
        '}else{' +
          'var parent=el.parentElement;if(!parent)return;' +
          'var oldPPos=parent.style.position;b.setAttribute("data-ppos",oldPPos||"");if(!oldPPos||oldPPos==="static")parent.style.position="relative";' +
          'var er=el.getBoundingClientRect();var pr=parent.getBoundingClientRect();' +
          'b.style.cssText="position:absolute;left:"+(er.left-pr.left)+"px;top:"+(er.top-pr.top)+"px;width:"+er.width+"px;height:"+er.height+"px;pointer-events:none;z-index:2147483642;border:3px solid #f59e0b;border-radius:3px;background:rgba(245,158,11,0.15);transition:opacity 0.4s";' +
          'parent.appendChild(b);' +
        '}' +
        'setTimeout(function(){b.style.opacity="0";setTimeout(function(){if(b.parentNode){var op=b.getAttribute("data-ppos");if(op!==null&&op!=="")b.parentNode.style.position=op;b.parentNode.removeChild(b);}},400);},3000);' +
        '}catch(e){console.error("[ne_hl]",e);}' +
      '})(' + JSON.stringify(xpath) + ')');
      setStatus('已高亮: ' + (node['_display'] || node.tag));
    } catch (e) {
      console.error('[highlightNodeInWebview]', e);
      setStatus('高亮失败: ' + e.message);
    }
  }

  async function removeNodeExplorerHighlights() {
    try {
      await webview.executeJavaScript('(function(){' +
        'var ovs=document.querySelectorAll(".__parser_ne_hl");' +
        'for(var i=0;i<ovs.length;i++){' +
          'var ov=ovs[i];' +
          'if(!ov.parentNode)continue;' +
          'var op=ov.getAttribute("data-ppos");' +
          'if(op!==null&&op!=="")ov.parentNode.style.position=op;' +
          'ov.parentNode.removeChild(ov);' +
        '}' +
      '})()');
    } catch (e) { /* ignore */ }
  }

  // ── 节点浏览器右键菜单 ──
  function showNodeExplorerContextMenu(x, y, node) {
    var old = document.getElementById('ctxMenu-nodeExplorer');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.id = 'ctxMenu-nodeExplorer';
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.minWidth = '180px';

    var tag = node.tag;
    var isText = tag === '#text';
    var isComment = tag === '#comment';
    var isRoot = tag === '#root';

    var menuItems = [];

    if (!isRoot && !isText && !isComment) {
      menuItems.push({ label: '\u{1F4CB} 复制 XPath', action: function() {
        var xp = buildXPathFromTree(node, cachedNodeExplorerData);
        if (xp) { addToClipboard(xp, 'XPath'); setStatus('XPath 已复制'); }
        else { setStatus('无法生成 XPath'); }
      }});
      menuItems.push({ label: '\u{1F4CB} 复制 CSS 路径', action: function() {
        var cp = buildCSSPathFromTree(node, cachedNodeExplorerData);
        if (cp) { addToClipboard(cp, 'CSS 路径'); setStatus('CSS 路径已复制'); }
        else { setStatus('无法生成 CSS 路径'); }
      }});
      menuItems.push({ label: '\u{1F4CB} 复制 outerHTML', action: function() {
        var oh = _neGenerateOuterHTML(node);
        addToClipboard(oh, 'outerHTML');
        setStatus('outerHTML 已复制 (' + (oh.length / 1024).toFixed(1) + ' KB)');
      }});
      menuItems.push('-');
      menuItems.push({ label: '\u2795 添加到编辑器', action: function() {
        _neAddToEditor(node);
      }});
      menuItems.push({ label: '\u{1F3AF} 高亮元素', action: function() {
        highlightNodeInWebview(node);
      }});
      menuItems.push('-');
    } else if (isText) {
      menuItems.push({ label: '\u{1F4CB} 复制文本', action: function() {
        if (node['文本']) { addToClipboard(node['文本'], 'text'); setStatus('文本已复制'); }
      }});
      menuItems.push('-');
    }

    menuItems.push({ label: '\u{1F53D} 展开全部', action: function() {
      var treePanel = queryResultsDiv.querySelector('.ne-tree-panel');
      if (treePanel) {
        treePanel.querySelectorAll('.ne-children').forEach(function(c) { c.style.display = 'block'; });
        treePanel.querySelectorAll('.ne-arrow:not(.empty)').forEach(function(a) { a.textContent = '\u25bc'; });
      }
    }});
    menuItems.push({ label: '\u{1F53C} 折叠全部', action: function() {
      var treePanel = queryResultsDiv.querySelector('.ne-tree-panel');
      if (treePanel) {
        treePanel.querySelectorAll('.ne-children').forEach(function(c) { c.style.display = 'none'; });
        treePanel.querySelectorAll('.ne-arrow:not(.empty)').forEach(function(a) { a.textContent = '\u25b6'; });
      }
    }});

    menuItems.forEach(function(item) {
      if (item === '-') {
        var sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        menu.appendChild(sep);
      } else {
        var el = document.createElement('div');
        el.className = 'context-menu-item';
        el.textContent = item.label;
        el.addEventListener('click', function() { menu.remove(); item.action(); });
        menu.appendChild(el);
      }
    });

    document.body.appendChild(menu);
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) menu.style.left = (x - menuRect.width) + 'px';
    if (menuRect.bottom > window.innerHeight) menu.style.top = (y - menuRect.height) + 'px';
  }

  // ── 添加到编辑器 ──
  function _neAddToEditor(node) {
    if (!node || node.tag === '#text' || node.tag === '#comment' || node.tag === '#root') {
      setStatus('无法添加此类节点到编辑器');
      return;
    }
    var xpath = buildXPathFromTree(node, cachedNodeExplorerData);
    var cssPath = buildCSSPathFromTree(node, cachedNodeExplorerData);
    var outerHTML = _neGenerateOuterHTML(node);
    var text = normalizeText((node['文本'] || '').substring(0, 200));
    var className = (node['属性'] && node['属性']['class']) ? ('' + node['属性']['class']) : '';
    var elementId = (node['属性'] && node['属性'].id) ? ('' + node['属性'].id) : '';
    var href = normalizeText((node['属性'] && node['属性'].href) ? ('' + node['属性'].href) : '');
    var src = normalizeText((node['属性'] && node['属性'].src) ? ('' + node['属性'].src) : '');

    // 构建标准的 elementInfo（与 addToEditor 期望的格式一致）
    var info = {
      tag: node.tag,
      xpath: xpath || '',
      _xpath: xpath || '',
      css: cssPath || '',
      outerHTML: outerHTML,
      text: text,
      href: href,
      src: src,
      className: className,
      id: elementId
    };

    if (typeof addToEditor === 'function') {
      addToEditor(info, cssPath || '', 'pick');
      setStatus('已添加 ' + node.tag + ' 到编辑器');
      if (typeof updatePickedTreeNodes === 'function') updatePickedTreeNodes();
    } else {
      // 降级：直接 push
      Parser.state.editorItems.push({
        elementInfo: info,
        selector: cssPath || '',
        xpath: xpath || '',
        matchCount: 1,
        source: 'pick'
      });
      setStatus('已添加 ' + node.tag + ' 到编辑器 (' + Parser.state.editorItems.length + ' 个元素)');
      if (typeof updatePickedTreeNodes === 'function') updatePickedTreeNodes();
    }
  }

  // ── 全局按钮回调 ──
  window._neCopyXPath = function() {
    if (_neDetailNode) {
      var xp = buildXPathFromTree(_neDetailNode, cachedNodeExplorerData);
      if (xp) { addToClipboard(xp, 'XPath'); setStatus('XPath 已复制'); }
    }
  };
  window._neCopyCSS = function() {
    if (_neDetailNode) {
      var cp = buildCSSPathFromTree(_neDetailNode, cachedNodeExplorerData);
      if (cp) { addToClipboard(cp, 'CSS 路径'); setStatus('CSS 路径已复制'); }
    }
  };
  window._neHighlight = function() {
    if (_neDetailNode) highlightNodeInWebview(_neDetailNode);
  };
  window._neAddToEditor = function() {
    if (_neDetailNode) _neAddToEditor(_neDetailNode);
  };
  window._neCopyText = function() {
    if (_neDetailNode && _neDetailNode['文本']) {
      addToClipboard(_neDetailNode['文本'], 'text');
      setStatus('文本已复制');
    }
  };
  function showScriptsPanel(scripts) {
    setStatus('脚本列表: ' + scripts.length + ' 个');
    contentTitle.textContent = '脚本列表 (' + scripts.length + ')';
    contentEmpty.classList.remove('hidden');
    let html = '<div style="overflow-y:auto;height:100%">';
    scripts.forEach((s, i) => {
      const src = s['脚本地址'] || '内嵌脚本';
      const type = s['脚本类型'] || '';
      const len = s['内容长度'] || 0;
      const lenStr = len > 1024 ? (len/1024).toFixed(1) + ' KB' : len + ' B';
      html += '<div class="script-item" data-idx="' + i + '" style="padding:12px;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.1s">'
        + '<div style="font-weight:600;color:var(--accent);word-break:break-all">#' + i + ' ' + escapeHtml(src) + '</div>'
        + '<div style="font-size:12px;color:var(--text-dim);margin-top:4px">类型: ' + escapeHtml(type) + ' | 大小: ' + lenStr + '</div>'
        + '</div>';
    });
    html += '</div>';
    contentEmpty.innerHTML = html;
    contentEmpty.querySelectorAll('.script-item').forEach(item => {
      item.addEventListener('click', () => showScriptDetail(scripts[parseInt(item.dataset.idx)]));
      item.addEventListener('mouseenter', function() { this.style.background = 'var(--bg-hover)'; });
      item.addEventListener('mouseleave', function() { this.style.background = ''; });
    });
  }

  // ──────── 提取面板 ────────
  function showExtractPanel(mode) {
    const titles = { 'xpath': 'XPath 提取', 'css': 'CSS 选择器', 'regex': '正则提取', 'jsonpath': 'JSONPath 提取', 'chain': '链路提取' };
    const placeholders = {
      'xpath': '//div[@class="item"]/a/@href',
      'css': 'div.item a',
      'regex': 'href="([^"]+)"',
      'jsonpath': '$.store.book[*].title',
    };
    contentTitle.textContent = titles[mode] || mode;
    hideAllPanels();
    queryContainer.classList.remove('hidden');
    showQueryInputRow();
    queryContainer.dataset.mode = mode;
    queryInput.placeholder = placeholders[mode] || '输入查询表达式...';
    queryInput.value = '';
    queryResultsDiv.innerHTML = '';
    Parser.state.queryResults = [];
  }
  // ── 查询引擎已迁移到 modules/query-engine.js ──

  // ──────── API 接入功能 ────────

  function showApiConfig() {
    batchModal.classList.remove('hidden');
    // 切换到 API tab
    Parser.state.batchCurrentMode = 'api';
    batchModal.querySelectorAll('.batch-mode-tab').forEach(function(t) { t.classList.remove('active'); });
    var apiTab = batchModal.querySelector('.batch-mode-tab[data-mode="api"]');
    if (apiTab) apiTab.classList.add('active');
    batchModal.querySelector('#batchModeTemplate').classList.add('hidden');
    batchModal.querySelector('#batchModeUrlList').classList.add('hidden');
    batchModeApi.classList.remove('hidden');
    batchSharedConfig.classList.add('hidden');
    btnBatchConfirm.classList.add('hidden');
    btnApiSend.classList.remove('hidden');
    updateApiBodyVisibility();
    // 确保至少有一个空 headers 行并绑定事件
    ensureHeaderRows();
  }

  function showApiHistory() {
    contentTitle.textContent = '请求历史 (' + Parser.state.apiHistory.length + ')';
    hideAllPanels();
    contentEmpty.classList.remove('hidden');
    if (Parser.state.apiHistory.length === 0) {
      contentEmpty.innerHTML = '<div class="tree-empty">暂无请求历史</div>';
      return;
    }
    var html = '<div style="overflow-y:auto;height:100%;width:100%;align-self:stretch;box-sizing:border-box">';
    for (var i = 0; i < Parser.state.apiHistory.length; i++) {
      var h = Parser.state.apiHistory[i];
      var statusColor = h.status >= 200 && h.status < 300 ? 'var(--green)' : (h.status >= 400 ? 'var(--red)' : 'var(--yellow)');
      html += '<div class="api-history-item" data-idx="' + i + '" style="padding:14px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.1s;width:100%">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;width:100%">'
        + '<div style="display:flex;align-items:center;gap:12px">'
        + '<span style="font-size:16px;font-weight:700;color:' + statusColor + '">' + escapeHtml(String(h.status)) + '</span>'
        + '<span style="font-weight:600;color:var(--text)">' + escapeHtml(h.method) + '</span>'
        + '</div>'
        + '<span style="font-size:12px;color:var(--text-dim)">' + escapeHtml(h.time) + '</span>'
        + '</div>'
        + '<div style="font-size:13px;color:var(--text);word-break:break-all;margin-top:8px;width:100%">' + escapeHtml(h.url) + '</div>'
        + '<div style="font-size:11px;color:var(--text-dim);margin-top:6px">耗时: ' + h.duration + 'ms' + ' | 超时: ' + (h.timeout || '-') + 'ms</div>'
        + '</div>';
    }
    html += '</div>';
    contentEmpty.innerHTML = html;

    // 点击历史项 -> 重新载入配置
    contentEmpty.querySelectorAll('.api-history-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var idx = parseInt(item.dataset.idx);
        var h = Parser.state.apiHistory[idx];
        apiUrl.value = h.url || '';
        apiMethod.value = h.method || 'GET';
        apiTimeout.value = h.timeout || 30000;
        // 重建 headers UI
        apiHeadersList.innerHTML = '';
        var headers = h.headers || {};
        Object.keys(headers).forEach(function(k) {
          addApiHeaderRow(k, headers[k]);
        });
        if (Object.keys(headers).length === 0) addApiHeaderRow('', '');
        apiBody.value = h.body || '';
        updateApiBodyVisibility();
        showApiConfig();
        setStatus('已载入历史请求: ' + escapeHtml(h.url));
      });
      item.addEventListener('mouseenter', function() { this.style.background = 'var(--bg-hover)'; });
      item.addEventListener('mouseleave', function() { this.style.background = ''; });
    });
  }

  function showApiResponse() {
    if (!Parser.state.apiResponse || !Parser.state.apiResponse.body) {
      contentTitle.textContent = '响应体';
      contentEmpty.classList.remove('hidden');
      contentEmpty.innerHTML = '<div class="tree-empty">无响应数据</div>';
      return;
    }
    setStatus('响应体');
    contentTitle.textContent = '响应体 (' + (Parser.state.apiResponse.body.length / 1024).toFixed(1) + ' KB)';
    hideAllPanels();
    queryContainer.classList.remove('hidden');
    queryContainer.dataset.mode = '__api_response__';

    // 隐藏查询输入行
    var inputRow = queryContainer.querySelector('.query-input-row');
    if (inputRow) inputRow.style.display = 'none';
    var exportBtn = document.getElementById('btnExportQuery');
    var checkAll = document.getElementById('queryCheckAll');
    if (exportBtn) exportBtn.style.display = 'none';
    if (checkAll) checkAll.style.display = 'none';

    // 搜索过滤
    document.getElementById('querySearch').oninput = function() {
      renderApiResponseBody();
    };

    renderApiResponseBody();
  }

  function renderApiResponseBody() {
    var searchQ = (document.getElementById('querySearch') || {}).value || '';
    var body = Parser.state.apiResponse.body || '';
    var lines = body.split('\n');

    // 判断语言
    var contentType = '';
    if (Parser.state.apiResponse.headers) {
      var ctKey = Object.keys(Parser.state.apiResponse.headers).find(function(k) { return k.toLowerCase() === 'content-type'; });
      if (ctKey) contentType = Parser.state.apiResponse.headers[ctKey] || '';
    }
    var lang = contentType.includes('html') ? 'html' : (contentType.includes('json') ? 'json' : (contentType.includes('javascript') ? 'js' : 'text'));

    var matched = lines.map(function(line, i) {
      return { text: line, num: i + 1 };
    });
    if (searchQ) {
      matched = matched.filter(function(m) { return m.text.toLowerCase().includes(searchQ.toLowerCase()); });
    }
    var html2 = '<div style="background:var(--bg-tree);padding:8px 0;font-family:Consolas,"Microsoft YaHei",monospace;font-size:13px;line-height:1.55;white-space:pre;overflow:auto;min-height:100%">';
    for (var i = 0; i < matched.length; i++) {
      var m = matched[i];
      var lineStr = highlightLine(m.text, lang);
      var numStyle = m.num % 5 === 0 ? 'color:var(--accent);font-weight:600' : 'color:#555';
      html2 += '<div><span style="' + numStyle + ';user-select:none;display:inline-block;width:44px;text-align:right;padding-right:12px;font-size:12px">' + m.num + '</span>' + lineStr + '</div>';
    }
    html2 += '</div>';
    queryResultsDiv.innerHTML = html2;

    // 将响应体作为 Parser.state.currentHtml 以便提取工具使用
    Parser.state.currentHtml = Parser.state.apiResponse.body;
  }

  function showApiJsonTree() {
    if (!Parser.state.apiResponse || !Parser.state.apiResponse.body) {
      contentTitle.textContent = 'JSON 树';
      contentEmpty.classList.remove('hidden');
      contentEmpty.innerHTML = '<div class="tree-empty">无 JSON 数据</div>';
      return;
    }
    try {
      var jsonData = JSON.parse(Parser.state.apiResponse.body);
      setStatus('JSON 树');
      contentTitle.textContent = 'JSON 树';
      hideAllPanels();
      queryContainer.classList.remove('hidden');
      queryContainer.dataset.mode = '__api_json__';
      var inputRow = queryContainer.querySelector('.query-input-row');
      if (inputRow) inputRow.style.display = 'none';
      var exportBtn = document.getElementById('btnExportQuery');
      var checkAll = document.getElementById('queryCheckAll');
      if (exportBtn) exportBtn.style.display = 'none';
      if (checkAll) checkAll.style.display = 'none';
      queryResultsDiv.innerHTML = '';
      var container = document.createElement('div');
      container.style.cssText = 'font-family:Consolas,"Microsoft YaHei",monospace;font-size:13px;overflow:auto;min-height:100%;padding:8px 0';
      container.appendChild(renderJsonNode(jsonData, '', true));
      queryResultsDiv.appendChild(container);
    } catch (e) {
      contentEmpty.classList.remove('hidden');
      contentEmpty.innerHTML = '<div class="tree-empty">JSON 解析失败: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function renderJsonNode(data, key, expanded) {
    var div = document.createElement('div');
    div.style.marginLeft = '4px';

    if (data === null) {
      div.innerHTML = '<span style="color:#9cdcfe">' + escapeHtml(String(key)) + '</span>: <span style="color:#569cd6">null</span>';
      return div;
    }
    if (typeof data !== 'object') {
      var valClass = typeof data === 'number' ? '#b5cea8' : (typeof data === 'boolean' ? '#569cd6' : '#ce9178');
      var display = typeof data === 'string' ? '"' + escapeHtml(data.length > 200 ? data.substring(0, 200) + '...' : data) + '"' : String(data);
      if (key !== '') {
        div.innerHTML = '<span style="color:#9cdcfe">' + escapeHtml(String(key)) + '</span>: <span style="color:' + valClass + '">' + display + '</span>';
      } else {
        div.innerHTML = '<span style="color:' + valClass + '">' + display + '</span>';
      }
      return div;
    }

    var isArray = Array.isArray(data);
    var entries = isArray ? data.map(function(v, i) { return [String(i), v]; }) : Object.entries(data);
    var count = entries.length;

    var header = document.createElement('div');
    header.style.cssText = 'cursor:pointer;padding:2px 0;';
    header.innerHTML = (key !== '' ? '<span style="color:#9cdcfe">' + escapeHtml(String(key)) + '</span>: ' : '')
      + (isArray ? '<span style="color:#888">[' + count + ']</span>' : '<span style="color:#888">{' + count + '}</span>')
      + ' <span style="font-size:11px;color:var(--text-dim)">' + (expanded ? '▼' : '▶') + '</span>';

    var children = document.createElement('div');
    children.style.marginLeft = '20px';
    if (!expanded) children.style.display = 'none';

    for (var i = 0; i < Math.min(entries.length, 200); i++) {
      children.appendChild(renderJsonNode(entries[i][1], entries[i][0], false));
    }
    if (entries.length > 200) {
      var more = document.createElement('div');
      more.style.color = 'var(--text-dim)';
      more.textContent = '... 还有 ' + (entries.length - 200) + ' 项';
      children.appendChild(more);
    }

    header.addEventListener('click', function(e) {
      e.stopPropagation();
      var isHidden = children.style.display === 'none';
      children.style.display = isHidden ? 'block' : 'none';
      header.querySelector('span:last-child').textContent = isHidden ? '▼' : '▶';
    });

    div.appendChild(header);
    div.appendChild(children);
    return div;
  }

  function showApiHeaders() {
    if (!Parser.state.apiResponse || !Parser.state.apiResponse.headers) {
      contentTitle.textContent = '响应头';
      contentEmpty.classList.remove('hidden');
      contentEmpty.innerHTML = '<div class="tree-empty">无响应头数据</div>';
      return;
    }
    contentTitle.textContent = '响应头';
    hideAllPanels();
    queryContainer.classList.remove('hidden');
    queryContainer.dataset.mode = '__api_headers__';
    var inputRow = queryContainer.querySelector('.query-input-row');
    if (inputRow) inputRow.style.display = 'none';
    var exportBtn = document.getElementById('btnExportQuery');
    var checkAll = document.getElementById('queryCheckAll');
    if (exportBtn) exportBtn.style.display = 'none';
    if (checkAll) checkAll.style.display = 'none';

    var entries = Object.entries(Parser.state.apiResponse.headers);
    Parser.state.queryResults = entries.map(function(e) { return { 'Key': e[0], 'Value': e[1] }; });
    renderQueryTable(Parser.state.queryResults);
  }

  function showApiStatus() {
    if (!Parser.state.apiResponse) {
      contentTitle.textContent = '状态信息';
      contentEmpty.classList.remove('hidden');
      contentEmpty.innerHTML = '<div class="tree-empty">无状态信息</div>';
      return;
    }
    contentTitle.textContent = '状态信息';
    hideAllPanels();
    contentEmpty.classList.remove('hidden');
    var statusColor = Parser.state.apiResponse.status >= 200 && Parser.state.apiResponse.status < 300 ? 'var(--green)' : (Parser.state.apiResponse.status >= 400 ? 'var(--red)' : 'var(--yellow)');
    contentEmpty.innerHTML =
      '<div style="display:flex;flex-direction:column;height:100%;gap:12px;padding:16px">'
      + '<div style="font-size:48px;color:' + statusColor + ';font-weight:700">' + Parser.state.apiResponse.status + '</div>'
      + '<div style="font-size:16px;color:var(--text)">' + escapeHtml(Parser.state.apiResponse.statusText || '') + '</div>'
      + '<div style="font-size:13px;color:var(--text-dim)">耗时: ' + Parser.state.apiResponse.duration + ' ms</div>'
      + '<div style="font-size:12px;color:var(--text-dim)">响应大小: ' + (Parser.state.apiResponse.body ? (Parser.state.apiResponse.body.length / 1024).toFixed(1) + ' KB' : '0') + '</div>'
      + '</div>';
  }

  async function sendApiRequest() {
    var url = apiUrl.value.trim();
    if (!url) { setStatus('请输入 API URL'); return; }

    var method = apiMethod.value;
    var timeout = parseInt(apiTimeout.value) || 30000;
    var headers = getApiHeaders();
    // 合并已加载的 Cookie
    if (apiUseCookie.checked && Parser.state.apiLoadedCookie) {
      if (headers['Cookie']) {
        headers['Cookie'] = headers['Cookie'] + '; ' + Parser.state.apiLoadedCookie;
      } else {
        headers['Cookie'] = Parser.state.apiLoadedCookie;
      }
    }
    var body = apiBody.value.trim();

    setStatus('发送 API 请求...');
    btnApiSend.disabled = true;
    btnApiSend.textContent = '发送中...';

    try {
      var result = await window.api.apiRequest({
        url: url, method: method, headers: headers, body: body || undefined, timeout: timeout
      });

      Parser.state.apiResponse = {
        url: url,
        method: method,
        status: result.status || 0,
        statusText: result.statusText || '',
        headers: result.headers || {},
        body: result.body || '',
        duration: result.duration || 0,
        error: result.error || null,
      };

      // 将响应体作为 Parser.state.currentHtml 以便提取工具使用
      Parser.state.currentHtml = result.body || '';

      // 保存到历史
      var historyEntry = {
        url: url,
        method: method,
        headers: headers,
        body: body || '',
        timeout: timeout,
        status: Parser.state.apiResponse.status,
        duration: Parser.state.apiResponse.duration,
        time: new Date().toLocaleString(),
      };
      Parser.state.apiHistory.unshift(historyEntry);
      if (Parser.state.apiHistory.length > 50) Parser.state.apiHistory.pop();
      window.api.apiHistorySave(Parser.state.apiHistory);

      // 构建 API 响应树
      buildApiResponseTree();
      Parser.batch.closeModal();

      if (!result.ok) {
        setStatus('请求失败: ' + (result.error || '未知错误'));
        contentEmpty.classList.remove('hidden');
        contentEmpty.innerHTML = '<div class="tree-empty" style="color:var(--red)">请求失败: ' + escapeHtml(result.error || '未知错误') + '</div>';
        return;
      }

      // 自动选中第一个结果节点
      setTimeout(function() {
        var firstRow = treeContent.querySelector('.tree-node-row');
        // 找到「响应体」节点
        var rows = treeContent.querySelectorAll('.tree-node-row');
        for (var i = 0; i < rows.length; i++) {
          var label = rows[i].querySelector('.node-label');
          if (label && label.textContent.trim() === '响应体') {
            rows[i].click();
            break;
          }
        }
      }, 100);

      setStatus('API 请求完成 - ' + Parser.state.apiResponse.status + ' (' + Parser.state.apiResponse.duration + 'ms)');
    } catch (err) {
      setStatus('请求异常: ' + err.message);
    } finally {
      btnApiSend.disabled = false;
      btnApiSend.textContent = '发送';
    }
  }

  function buildApiResponseTree() {
    treeContent.innerHTML = '';
    var root = document.createElement('div');
    root.className = 'tree-root';

    var gApiEntry = startGroup(root, 'API 接入');
    addTreeItem(gApiEntry, '发送 API 请求', 'api-config', null);
    addTreeItem(gApiEntry, '请求历史', 'api-history', null);

    var gApi = startGroup(root, 'API 响应');
    addTreeItem(gApi, '响应体', 'api-response', null);
    // 尝试判断是否为 JSON
    if (Parser.state.apiResponse.body) {
      try {
        JSON.parse(Parser.state.apiResponse.body);
        addTreeItem(gApi, 'JSON 树', 'api-json-tree', null);
      } catch (e) {}
    }
    addTreeItem(gApi, '响应头', 'api-headers', null);
    addTreeItem(gApi, '状态信息', 'api-status', null);

    var g2 = startGroup(root, '数据提取');
    addTreeItem(g2, 'XPath 提取', 'extract-xpath', null);
    addTreeItem(g2, 'CSS 选择器', 'extract-css', null);
    addTreeItem(g2, '正则提取', 'extract-regex', null);
    addTreeItem(g2, 'JSONPath 提取', 'extract-jsonpath', null);
    addTreeItem(g2, '链路提取', 'extract-chain', null);

    treeContent.appendChild(root);
  }

  // ──────── 请求头编辑器 ────────

  function ensureHeaderRows() {
    // 移除初始的静态行（如果存在），用动态创建的行替换
    var existingRows = apiHeadersList.querySelectorAll('.api-header-row');
    var hasValues = false;
    existingRows.forEach(function(row) {
      var key = row.querySelector('.api-header-key');
      var val = row.querySelector('.api-header-val');
      if (key && key.value.trim()) hasValues = true;
    });
    if (!hasValues && existingRows.length <= 1) {
      // 重新初始化：清空并用 addApiHeaderRow 创建
      apiHeadersList.innerHTML = '';
      addApiHeaderRow('', '');
    } else if (existingRows.length === 0) {
      addApiHeaderRow('', '');
    }
    // 确保所有行的删除按钮有效
    apiHeadersList.querySelectorAll('.api-header-remove').forEach(function(btn) {
      btn.onclick = function() {
        var row = btn.closest('.api-header-row');
        if (apiHeadersList.children.length > 1) {
          row.remove();
        } else {
          row.querySelectorAll('input').forEach(function(inp) { inp.value = ''; });
        }
      };
    });
  }

  function addApiHeaderRow(key, value) {
    var row = document.createElement('div');
    row.className = 'api-header-row';
    row.innerHTML = '<input type="text" class="form-input api-header-key" placeholder="Key" value="' + escapeHtml(key || '') + '" style="flex:1">'
      + '<input type="text" class="form-input api-header-val" placeholder="Value" value="' + escapeHtml(value || '') + '" style="flex:2">'
      + '<button class="btn btn-sm api-header-remove" style="height:28px;padding:0 6px;font-size:12px;color:var(--red);border-color:transparent;background:transparent" title="删除">&times;</button>';
    row.querySelector('.api-header-remove').addEventListener('click', function() {
      if (apiHeadersList.children.length > 1) {
        row.remove();
      } else {
        // 最后一行，清空值
        row.querySelector('.api-header-key').value = '';
        row.querySelector('.api-header-val').value = '';
      }
    });
    apiHeadersList.appendChild(row);
  }

  function getApiHeaders() {
    var headers = {};
    apiHeadersList.querySelectorAll('.api-header-row').forEach(function(row) {
      var key = row.querySelector('.api-header-key').value.trim();
      var val = row.querySelector('.api-header-val').value.trim();
      if (key) headers[key] = val;
    });
    return headers;
  }

  function updateApiBodyVisibility() {
    var method = apiMethod.value;
    apiBodyGroup.style.display = (method === 'POST' || method === 'PUT') ? '' : 'none';
  }

  // ──────── Cookie 加载 ────────

  async function loadCookieForApi() {
    var url = apiUrl.value.trim();
    if (!url) { apiCookieHint.textContent = '请先输入 URL'; apiCookieHint.style.display = ''; return; }
    try {
      var result = await window.api.cookieLoad(url);
      // cookieLoad returns { domain, count } or null, but we need the actual cookies
      // Use cookie:get-all to get all cookies and filter by domain
      var allCookies = await window.api.cookieGetAll();
      var domain = extractHost(url);
      var matched = allCookies.filter(function(c) {
        return c.domain && (domain.includes(c.domain) || c.domain.includes(domain));
      });
      if (matched.length > 0) {
        Parser.state.apiLoadedCookie = matched.map(function(c) { return c.name + '=' + c.value; }).join('; ');
        apiCookieHint.textContent = '已加载 ' + matched.length + ' 条';
        apiCookieHint.style.color = 'var(--green)';
        setStatus('已加载 ' + matched.length + ' 条 Cookie → ' + domain);
      } else {
        Parser.state.apiLoadedCookie = '';
        apiCookieHint.textContent = '未找到已保存的 Cookie';
        apiCookieHint.style.color = 'var(--text-dim)';
      }
      apiCookieHint.style.display = '';
    } catch (e) {
      Parser.state.apiLoadedCookie = '';
      apiCookieHint.textContent = '加载失败: ' + e.message;
      apiCookieHint.style.color = 'var(--red)';
      apiCookieHint.style.display = '';
    }
  }

  // ──────── 导出 ────────

  // ──────── 导出 ────────
  function bindExportEvents() {
    btnExportQuery.addEventListener('click', function() {
      showExportFormatPicker(null, true);
    });
    btnSaveSource.addEventListener('click', saveSource);
  }

  async function exportToExcel() {
    const checked = [];
    $$('.result-checkbox:checked').forEach(cb => {
      const tr = cb.closest('tr');
      if (tr && !isNaN(parseInt(tr.dataset.row))) checked.push(Parser.state.queryResults[parseInt(tr.dataset.row)]);
    });
    const rows = checked;
    if (rows.length === 0) { setStatus('请先勾选要导出的行'); return; }
    setStatus('正在导出 Excel...');
    try {
      // 收集当前表格列顺序
      const ths = document.querySelectorAll('#resultTable thead th');
      const headers = [];
      ths.forEach(function(th) {
        var t = th.textContent.trim();
        if (t && t !== '#' && t !== '来源URL') headers.push(t);
      });
      const resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/export/excel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, format: 'xlsx', headers }),
      });
      const result = await resp.json();
      if (result.ok && result.data) {
        const dr = await window.api.showSaveDialog({ title: '导出 Excel', defaultPath: 'export.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
        if (!dr.canceled && dr.filePath) {
          await window.api.saveFile(dr.filePath, result.data);
          setStatus('已导出到: ' + dr.filePath);
        }
      }
    } catch (err) { setStatus('导出失败: ' + err.message); }
  }

  async function saveSource() {
    try {
      const html = Parser.state.currentHtml || await webview.executeJavaScript('document.documentElement.outerHTML');
      const dr = await window.api.showSaveDialog({ title: '保存源码', defaultPath: 'source.html', filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
      if (!dr.canceled && dr.filePath) {
        const base64 = Parser.utils.toBase64(html);
        await window.api.saveFile(dr.filePath, base64);
        setStatus('已保存到: ' + dr.filePath);
      }
    } catch (err) { setStatus('保存失败: ' + err.message); }
  }
  // ── 元素提取器已迁移到 modules/element-extractor.js ──
  Parser.extractor.bindPickerEvents();
  Parser.extractor.bindEnhancedPickerEvents();

  async function saveSelectorRules() {
    var rules = [];
    var seenSelectors = {};
    Parser.state.editorItems.forEach(function (item) {
      if (item._isTagHeader) return;
      // 排除自动扫描的元素（scanAllElements 扫进来的页面 chrome）
      if (item.source === 'scan') return;
      if (item.isGroup && item.children) {
        item.children.forEach(function(c) {
          if (!c._registered) return;
          var sel = c.selector;
          if (seenSelectors[sel]) return;
          seenSelectors[sel] = true;
          rules.push({
            selector: sel,
            tag: c.elementInfo ? c.elementInfo.tag : '',
            label: c.elementInfo ? c.elementInfo.text : '',
            mode: Parser.state._ruleMode || 'list'
          });
        });
      } else {
        var sel = item.selector;
        if (seenSelectors[sel]) return;
        seenSelectors[sel] = true;
        rules.push({
          selector: sel,
          tag: item.elementInfo ? item.elementInfo.tag : '',
          label: item.elementInfo ? item.elementInfo.text : ''
        });
      }
    });
    if (rules.length === 0) { setStatus('没有选择器可保存'); return; }
    // 追加模式：合并已有规则，按 selector 去重
    var existing = Parser.state.savedSelectorRules || [];
    var existingMap = {};
    existing.forEach(function(r) { existingMap[r.selector] = true; });
    var added = 0;
    rules.forEach(function(r) {
      if (!existingMap[r.selector]) {
        existing.push(r);
        existingMap[r.selector] = true;
        added++;
      }
    });
    Parser.state.savedSelectorRules = existing;
    Parser.state.editorItems.forEach(function (item) { item.persisted = true; });
    setStatus('已保存 ' + existing.length + ' 条规则（新增 ' + added + ' 条）');
    if (typeof updateBatchFloat === 'function') updateBatchFloat();
    Parser.utils.showToast('选择器规则已保存（共 ' + existing.length + ' 条）');
  }

  async function loadSelectorRules() {
    try {
      var rules = await window.api.selectorsLoad();
      return rules || [];
    } catch (e) {
      return [];
    }
  }

  async function autoMatchPersistedSelectors() {
    try {
      var rules = Parser.state.savedSelectorRules;
      if (!rules || rules.length === 0) return;

      // 将持久化规则应用到当前页面
      var currentUrl = webview.getURL();
      if (!currentUrl || currentUrl === 'about:blank') return;

      setStatus('正在自动匹配持久化选择器...');
      Parser.state.editorItems = [];

      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        try {
          var count = await webview.executeJavaScript('(function(sel){try{var els=document.querySelectorAll(sel);return els.length;}catch(e){return -1;}})(' + JSON.stringify(rule.selector) + ')');
          Parser.state.editorItems.push({
            elementInfo: { tag: rule.tag || '', text: rule.label || '', selectors: [{ selector: rule.selector }] },
            selector: rule.selector,
            matchCount: count >= 0 ? count : 0,
            persisted: true,
            source: 'scan'
          });
        } catch (e) {
          // 单个失败不影响其他
        }
      }

      if (Parser.state.editorItems.length > 0) {
        Parser.extractor.renderElementEditor();
        elementEditor.classList.remove('hidden');
        setStatus('已自动匹配 ' + Parser.state.editorItems.length + ' 条持久化选择器');
        Parser.extractor.updatePickedElementsFromEditor();
      }
    } catch (e) {
      console.log('[Persistence] auto-match skipped:', e.message);
    }
  }

  // ──────── 面板拖拽 ────────
  function bindResizeEvents() {
    var onMove, onUp;
    resizeHandle.addEventListener('mousedown', (e) => {
      Parser.state.isResizing = true; resizeHandle.classList.add('active');
      document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
      document.body.style.pointerEvents = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!Parser.state.isResizing) return;
      const rect = document.querySelector('.main-container').getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      if (pct > 30 && pct < 70) {
        panelLeft.style.width = pct + '%';
        panelRight.style.width = (100 - pct) + '%';
      }
    });
    document.addEventListener('mouseup', () => {
      if (!Parser.state.isResizing) return;
      Parser.state.isResizing = false; resizeHandle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.pointerEvents = '';
    });
  }

  // ──────── 工具函数 ────────
  function setStatus(msg) { statusText.textContent = msg; }
  function extractHost(url) { try { return new URL(url).hostname; } catch { return url; } }
  function normalizeText(str) {
    if (!str) return "";
    str = String(str);
    // 1) 将所有 Unicode 空白分隔符（Zs）替换为普通空格
    str = str.replace(/\p{Zs}/gu, " ");
    // 2) 行分隔符 / 段分隔符 → 空格
    str = str.replace(/\p{Zl}/gu, " ");
    str = str.replace(/\p{Zp}/gu, " ");
    // 3) 移除所有不可见格式化字符（Cf 类别）
    //    包括：零宽字符、双向控制符、单词连接符、软连字符、BOM/ZWNBSP、行间注记等
    str = str.replace(/\p{Cf}/gu, "");
    // 4) 移除控制字符（Cc），但保留 \t \n \r \f \v（后续 \s+ 统一压缩）
    str = str.replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g, "");
    // 5) 移除私有区（PUA）和无标准字形的特殊字符（会显示为口）
    str = str.replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\uFFFE\uFFFF]/gu, "");
    // 6) 合并连续空白，去除首尾
    str = str.replace(/\s+/g, " ").trim();
    return str;
  }

  // ── 本地路径检测与 local-html 协议转换 ──
  function isLocalPath(str) {
    return /^[a-zA-Z]:[\/\\]/.test(str) || /^[\/\\][^\/\\]/.test(str) || /^file:\/\//i.test(str);
  }
  function toLocalHtmlUrl(filePath) {
    var normalized = filePath.replace(/\\/g, '/');
    normalized = normalized.replace(/^file:\/\/\/?/i, '');
    if (/^[a-zA-Z]:\//.test(normalized)) normalized = '/' + normalized;
    return 'local-html://' + normalized;
  }

  // ──────── 剪贴板管理 ────────

  function bindClipboardEvents() {
    var clipboardPanel = document.getElementById('clipboardPanel');
    if (!clipboardPanel) return;

    // 双击条目 -> 粘贴到当前活跃输入框
    clipboardPanel.addEventListener('dblclick', function(e) {
      var item = e.target.closest('.clipboard-item');
      if (!item) return;
      var text = item.dataset.text;
      if (text) {
        // 找到当前活跃的输入框
        var activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
          // 在光标处插入文本
          if (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT') {
            var start = activeEl.selectionStart;
            var end = activeEl.selectionEnd;
            var val = activeEl.value;
            activeEl.value = val.substring(0, start) + text + val.substring(end);
            activeEl.selectionStart = activeEl.selectionEnd = start + text.length;
          } else if (activeEl.isContentEditable) {
            document.execCommand('insertText', false, text);
          }
          setStatus('已粘贴到输入框');
        } else {
          // 没有活跃输入框，复制到系统剪贴板
          window.api.writeClipboard(text);
          setStatus('已复制到剪贴板');
        }
        // 关闭面板
        clipboardPanel.classList.add('hidden');
      }
    });

    // 单击条目复制到系统剪贴板
    clipboardPanel.addEventListener('click', function(e) {
      var item = e.target.closest('.clipboard-item');
      if (!item) return;
      var text = item.dataset.text;
      if (text) {
        window.api.writeClipboard(text);
        item.style.background = 'var(--accent)';
        setTimeout(function() { item.style.background = ''; }, 200);
        setStatus('已复制到剪贴板');
      }
    });

    // 清除按钮
    var btnClear = document.getElementById('btnClearClipboard');
    if (btnClear) {
      btnClear.addEventListener('click', function() {
        Parser.state.clipboardHistory = [];
        renderClipboardPanel();
      });
    }

    // 在非输入区域按 Ctrl+V 显示剪贴板历史
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === 'v' && !e.target.closest('input,textarea,[contenteditable]')) {
        showClipboardPicker();
      }
    });
  }

  function showClipboardPicker() {
    var panel = document.getElementById('clipboardPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'clipboardPanel';
      panel.className = 'clipboard-panel';
      panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;padding:0 4px 8px"><span style="font-weight:600;font-size:13px">剪贴板历史</span><button id="btnClearClipboard" style="font-size:12px;padding:2px 8px;background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--text-dim);cursor:pointer">清除</button></div>';
      document.body.appendChild(panel);
      bindClipboardEvents();
    }
    renderClipboardPanel();
    panel.classList.toggle('hidden');
  }

  function renderClipboardPanel() {
    var panel = document.getElementById('clipboardPanel');
    if (!panel) return;
    var list = panel.querySelector('.clipboard-list');
    if (!list) {
      var btnRow = panel.querySelector('div');
      list = document.createElement('div');
      list.className = 'clipboard-list';
      panel.appendChild(list);
    }
    if (Parser.state.clipboardHistory.length === 0) {
      list.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:12px;text-align:center">剪贴板为空</div>';
      return;
    }
    // 检测链路编辑器是否打开
    var chainModalOpen = !!(document.getElementById('schemaModal') && !document.getElementById('schemaModal').classList.contains('hidden') && (Parser.state.chainSegments || []).length > 0);
    if (chainModalOpen) {
      // 链路编辑器开着：在面板顶部加提示
      var hintDiv = panel.querySelector('.clipboard-chain-hint');
      if (!hintDiv) {
        hintDiv = document.createElement('div');
        hintDiv.className = 'clipboard-chain-hint';
        hintDiv.style.cssText = 'font-size:11px;color:var(--accent);padding:2px 4px 6px;display:flex;justify-content:space-between;align-items:center';
        panel.insertBefore(hintDiv, list);
      }
      hintDiv.innerHTML = '<span>💡 点击条目旁的 <b>+子链路</b> 可将选择器追加到子链路输入框</span>';
    } else {
      var hintDivOld = panel.querySelector('.clipboard-chain-hint');
      if (hintDivOld) hintDivOld.remove();
    }
    var html = '';
    for (var i = 0; i < Parser.state.clipboardHistory.length; i++) {
      var item = Parser.state.clipboardHistory[i];
      var preview = item.text.replace(/</g, '&lt;').replace(/>/g, '&gt;').substring(0, 80);
      html += '<div class="clipboard-item" data-text="' + item.text.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '" style="display:flex;align-items:flex-start;gap:4px">';
      html += '<div style="flex:1;min-width:0">';
      html += '<div class="clipboard-item-preview">' + preview + '</div>';
      html += '<div class="clipboard-item-meta">' + item.source + ' · ' + item.time + '</div>';
      html += '</div>';
      if (chainModalOpen) {
        html += '<button class="btn-clipboard-to-subchain" data-idx="' + i + '" title="追加到子链路输入框" style="font-size:10px;padding:1px 6px;height:20px;flex-shrink:0;background:var(--accent);color:#fff;border:none;border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap;margin-top:2px">+子链路</button>';
      }
      html += '</div>';
    }
    list.innerHTML = html;

    // 绑定 "+子链路" 按钮事件
    if (chainModalOpen) {
      list.querySelectorAll('.btn-clipboard-to-subchain').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var idx = parseInt(this.dataset.idx);
          var text = (Parser.state.clipboardHistory[idx].text || '').trim();
          if (!text) return;
          // 找到第一个子链路输入框（或第一个空的）
          var editorBody = document.querySelector('#chainEditorBody');
          if (!editorBody) {
            Parser.utils.showToast('请先打开链路编辑器');
            return;
          }
          var inputs = editorBody.querySelectorAll('.chain-sub-sel-input-editor');
          var targetInput = null;
          // 优先选有焦点的
          for (var j = 0; j < inputs.length; j++) {
            if (inputs[j] === document.activeElement) { targetInput = inputs[j]; break; }
          }
          // 否则选第一个空的
          if (!targetInput) {
            for (var j = 0; j < inputs.length; j++) {
              if (!inputs[j].value.trim()) { targetInput = inputs[j]; break; }
            }
          }
          // 否则选第一个
          if (!targetInput && inputs.length > 0) targetInput = inputs[0];
          if (!targetInput) {
            Parser.utils.showToast('请先在链路编辑器中添加子链路');
            return;
          }
          var cur = targetInput.value.trim();
          if (cur && cur.slice(-1) !== ',') cur += ', ';
          targetInput.value = cur + text;
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          Parser.utils.showToast('已加入子链路');
        });
      });
    }
  }

  // ──────── 左侧树右键菜单 ────────

  function bindContextMenus() {
    // 左侧目录树右键菜单
    treeContent.addEventListener('contextmenu', function(e) {
      // 分组标题右键菜单
      var groupHeader = e.target.closest('.tree-group-header');
      if (groupHeader) {
        e.preventDefault();
        e.stopPropagation();
        var groupName = groupHeader.textContent.trim();
        showGroupContextMenu(e.clientX, e.clientY, groupName, groupHeader);
        return;
      }

      var row = e.target.closest('.tree-node-row');
      if (!row) {
        // 空白区域：显示树全局菜单
        e.preventDefault();
        e.stopPropagation();
        showTreeGlobalContextMenu(e.clientX, e.clientY);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // 先选中被右键的行
      $$('.tree-node-row.active').forEach(function(r) { r.classList.remove('active'); });
      row.classList.add('active');

      var labelEl = row.querySelector('.node-label');
      var label = labelEl ? labelEl.textContent.trim() : '';
      var type = row.dataset.type || '';

      showTreeContextMenu(e.clientX, e.clientY, label, type, row);
    });

    // 点击其他地方关闭右键菜单
    document.addEventListener('click', function(e) {
      ['treeContextMenu', 'ctxMenu-nodeExplorer', 'webviewContextMenu', 'tableContextMenu'].forEach(function(id) {
        var menu = document.getElementById(id);
        if (menu && !menu.contains(e.target)) { menu.remove(); }
      });
    });
  }

  function showTreeGlobalContextMenu(x, y) {
    var old = document.getElementById('treeContextMenu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.id = 'treeContextMenu';
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.minWidth = '150px';

    var items = [
      { label: '🔽 展开全部组', action: function() {
        treeContent.querySelectorAll('.tree-group-body').forEach(function(b) { b.classList.remove('hidden'); });
        treeContent.querySelectorAll('.tree-children.hidden').forEach(function(c) { c.classList.remove('hidden'); });
        treeContent.querySelectorAll('.group-toggle').forEach(function(t) { t.textContent = '▼'; });
        treeContent.querySelectorAll('.toggle').forEach(function(t) {
          var node = t.closest('.tree-node');
          if (node && node.querySelector('.tree-children')) t.textContent = '▼';
        });
      }},
      { label: '🔼 折叠全部组', action: function() {
        treeContent.querySelectorAll('.tree-group-body').forEach(function(b) { b.classList.add('hidden'); });
        treeContent.querySelectorAll('.tree-children').forEach(function(c) { c.classList.add('hidden'); });
        treeContent.querySelectorAll('.group-toggle').forEach(function(t) { t.textContent = '▶'; });
        treeContent.querySelectorAll('.toggle').forEach(function(t) {
          var node = t.closest('.tree-node');
          if (node && node.querySelector('.tree-children')) t.textContent = '▶';
        });
      }}
    ];

    items.forEach(function(item) {
      var el = document.createElement('div');
      el.className = 'context-menu-item';
      el.textContent = item.label;
      el.addEventListener('click', function() { menu.remove(); item.action(); });
      menu.appendChild(el);
    });

    document.body.appendChild(menu);
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) menu.style.left = (x - menuRect.width) + 'px';
    if (menuRect.bottom > window.innerHeight) menu.style.top = (y - menuRect.height) + 'px';
  }

  function showTreeContextMenu(x, y, label, type, row) {
    // 移除旧菜单
    var old = document.getElementById('treeContextMenu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.id = 'treeContextMenu';
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.minWidth = '160px';

    var items = getContextMenuItems(label, type, row);

    items.forEach(function(item) {
      if (item === '-') {
        var sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        menu.appendChild(sep);
      } else {
        var el = document.createElement('div');
        el.className = 'context-menu-item';
        el.textContent = item.label;
        el.addEventListener('click', function() {
          menu.remove();
          item.action(row, label, type);
        });
        menu.appendChild(el);
      }
    });

    document.body.appendChild(menu);

    // 边界检测：避免菜单溢出视口
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
      menu.style.left = (x - menuRect.width) + 'px';
    }
    if (menuRect.bottom > window.innerHeight) {
      menu.style.top = (y - menuRect.height) + 'px';
    }
  }

  // —— 分组标题右键菜单 ——
  function showGroupContextMenu(x, y, groupName, header) {
    var old = document.getElementById('treeContextMenu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.id = 'treeContextMenu';
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.minWidth = '150px';

    var items = [
      { label: '展开组内全部', action: function() {
        var body = header.nextElementSibling;
        if (body) {
          body.classList.remove('hidden');
          body.querySelectorAll('.tree-children.hidden').forEach(function(c) { c.classList.remove('hidden'); });
            body.querySelectorAll('.toggle').forEach(function(t) {
              var node = t.closest('.tree-node');
              if (node && node.querySelector('.tree-children')) t.textContent = '▼';
            });
        }
        header.querySelector('.group-toggle').textContent = '▼';
      }},
      { label: '折叠组内全部', action: function() {
        var body = header.nextElementSibling;
        if (body) {
          body.classList.add('hidden');
          body.querySelectorAll('.tree-children').forEach(function(c) { c.classList.add('hidden'); });
          body.querySelectorAll('.toggle').forEach(function(t) { t.textContent = '▶'; });
        }
        header.querySelector('.group-toggle').textContent = '▶';
      }},
      '-',
      { label: '🔽 展开全部组', action: function() {
        treeContent.querySelectorAll('.tree-group-body').forEach(function(b) { b.classList.remove('hidden'); });
        treeContent.querySelectorAll('.tree-children.hidden').forEach(function(c) { c.classList.remove('hidden'); });
        treeContent.querySelectorAll('.group-toggle').forEach(function(t) { t.textContent = '▼'; });
        treeContent.querySelectorAll('.toggle').forEach(function(t) {
          var node = t.closest('.tree-node');
          if (node && node.querySelector('.tree-children')) t.textContent = '▼';
        });
      }},
      { label: '🔼 折叠全部组', action: function() {
        treeContent.querySelectorAll('.tree-group-body').forEach(function(b) { b.classList.add('hidden'); });
        treeContent.querySelectorAll('.tree-children').forEach(function(c) { c.classList.add('hidden'); });
        treeContent.querySelectorAll('.group-toggle').forEach(function(t) { t.textContent = '▶'; });
        treeContent.querySelectorAll('.toggle').forEach(function(t) {
          var node = t.closest('.tree-node');
          if (node && node.querySelector('.tree-children')) t.textContent = '▶';
        });
      }}
    ];

    items.forEach(function(item) {
      var el = document.createElement('div');
      el.className = 'context-menu-item';
      el.textContent = item.label;
      el.addEventListener('click', function() { menu.remove(); item.action(); });
      menu.appendChild(el);
    });

    document.body.appendChild(menu);

    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) { menu.style.left = (x - menuRect.width) + 'px'; }
    if (menuRect.bottom > window.innerHeight) { menu.style.top = (y - menuRect.height) + 'px'; }
  }

  function getContextMenuItems(label, type, row) {
    var items = [];

    // —— 按节点类型返回对应菜单 ——

    if (type === 'source') {
      items.push({ label: '📄 复制全部源码', action: function() {
        if (Parser.state.currentHtml) {
          addToClipboard(Parser.state.currentHtml, '源码');
          setStatus('已复制源码 (' + (Parser.state.currentHtml.length / 1024).toFixed(1) + ' KB)');
        } else {
          setStatus('请先解析页面');
        }
      }});
    }

    else if (type === 'element-list') {
      items.push({ label: '📊 导出为 Excel', action: function() { exportToExcel(); } });
      items.push({ label: '📋 复制全部数据', action: function() {
        var all = Parser.state.queryResults;
        if (!all || all.length === 0) { setStatus('没有数据可复制'); return; }
        var keys = Object.keys(all[0]);
        var lines = all.map(function(r) {
          return keys.map(function(k) { return String(r[k] !== undefined ? r[k] : '').replace(/\t/g, ' ').replace(/\n/g, '\\n'); }).join('\t');
        });
        addToClipboard(lines.join('\n'), '表格数据');
        setStatus('已复制 ' + all.length + ' 行');
      }});
    }

    else if (type === 'scripts') {
      items.push({ label: '📋 复制脚本列表', action: function() {
        var scripts = Parser.state.currentScripts || Parser.state.parseResult?.scripts || [];
        if (scripts.length === 0) { setStatus('没有脚本数据'); return; }
        var text = scripts.map(function(s, i) { return '[' + i + '] ' + (s['脚本地址'] || '内嵌脚本'); }).join('\n');
        addToClipboard(text, '脚本列表');
        setStatus('已复制 ' + scripts.length + ' 条脚本');
      }});
    }

    else if (type === 'dom-tree') {
      items.push({ label: '🔽 展开所有 DOM 节点', action: function() {
        if (!cachedDomTree) { setStatus('请先解析页面'); return; }
        hideAllPanels();
        queryContainer.classList.remove('hidden');
        queryContainer.dataset.mode = '__dom__';
        var inputRow = queryContainer.querySelector('.query-input-row');
        var exportBtn = document.getElementById('btnExportQuery');
        var checkAll = document.getElementById('queryCheckAll');
        if (inputRow) inputRow.style.display = 'none';
        if (exportBtn) exportBtn.style.display = 'none';
        if (checkAll) checkAll.style.display = 'none';
        contentTitle.textContent = 'DOM 树';
        renderDomTreeInResults();
        setTimeout(function() {
          queryResultsDiv.querySelectorAll('div').forEach(function(d) {
            if (d.style.display === 'none') d.style.display = 'block';
          });
        }, 100);
        setStatus('DOM 树 - 已展开全部节点');
      }});
      items.push({ label: '🔼 折叠所有 DOM 节点', action: function() {
        if (!cachedDomTree) { setStatus('请先解析页面'); return; }
        hideAllPanels();
        queryContainer.classList.remove('hidden');
        queryContainer.dataset.mode = '__dom__';
        var inputRow = queryContainer.querySelector('.query-input-row');
        var exportBtn = document.getElementById('btnExportQuery');
        var checkAll = document.getElementById('queryCheckAll');
        if (inputRow) inputRow.style.display = 'none';
        if (exportBtn) exportBtn.style.display = 'none';
        if (checkAll) checkAll.style.display = 'none';
        contentTitle.textContent = 'DOM 树';
        renderDomTreeInResults();
        setTimeout(function() {
          queryResultsDiv.querySelectorAll('div').forEach(function(d) {
            if (d.style.display !== 'none' && d.getAttribute('style') && d.getAttribute('style').indexOf('margin') >= 0) d.style.display = 'none';
          });
          var firstLevel = queryResultsDiv.querySelectorAll(':scope > div > div[style*="margin"]');
          firstLevel.forEach(function(d) { d.style.display = 'block'; });
        }, 100);
        setStatus('DOM 树 - 已折叠全部节点');
      }});
    }

    else if (type === 'picked-pick' || type === 'picked-auto' || type === 'picked-scan' || type === 'picked-合并' || type === 'picked-拆分') {
      items.push({ label: '📊 导出为 Excel', action: function() { exportToExcel(); } });
      items.push({ label: '📋 复制选中数据', action: function() {
        var checked = [];
        $$('.result-checkbox:checked').forEach(function(cb) {
          var tr = cb.closest('tr');
          if (tr && !isNaN(parseInt(tr.dataset.row))) {
            checked.push(Parser.state.queryResults[parseInt(tr.dataset.row)]);
          }
        });
        if (checked.length === 0) { setStatus('没有选中数据'); return; }
        var keys = Object.keys(checked[0]);
        var lines = checked.map(function(r) {
          return keys.map(function(k) { return String(r[k] !== undefined ? r[k] : '').replace(/\t/g, ' ').replace(/\n/g, '\\n'); }).join('\t');
        });
        addToClipboard(lines.join('\n'), '表格数据');
        setStatus('已复制 ' + checked.length + ' 行数据');
      }});
    }

    else if (type === 'api-config') {
      // 只显示通用项（复制节点名称在末尾追加）
    }

    else if (type === 'api-history') {
      items.push({ label: '🗑 清除历史', action: function() {
        window.api.apiHistoryClear().then(function() {
          Parser.state.apiHistory = [];
          setStatus('请求历史已清除');
        });
      }});
    }

    else if (type === 'api-response' || type === 'api-json-tree' || type === 'api-headers' || type === 'api-status') {
      items.push({ label: '📋 复制数据', action: function() {
        var apir = Parser.state.apiResponse;
        if (!apir) { setStatus('无响应数据'); return; }
        if (type === 'api-response' || type === 'api-json-tree') {
          addToClipboard(apir.body || '', 'API 响应体');
          setStatus('已复制响应体 (' + ((apir.body || '').length / 1024).toFixed(1) + ' KB)');
        } else if (type === 'api-headers') {
          var hdrText = apir.headers ? JSON.stringify(apir.headers, null, 2) : '';
          addToClipboard(hdrText, '响应头');
          setStatus('已复制响应头');
        } else if (type === 'api-status') {
          var stText = '状态码: ' + (apir.status || '') + '\n状态信息: ' + (apir.statusText || '') + '\nURL: ' + (apir.url || '');
          addToClipboard(stText, '状态信息');
          setStatus('已复制状态信息');
        }
      }});
    }

    else if (type === 'extract-xpath' || type === 'extract-css' || type === 'extract-regex' || type === 'extract-jsonpath' || type === 'extract-chain') {
      items.push({ label: '📊 导出为 Excel', action: function() { exportToExcel(); } });
      items.push({ label: '📋 复制查询结果', action: function() {
        var all = Parser.state.queryResults;
        if (!all || all.length === 0) { setStatus('没有查询结果'); return; }
        var keys = Object.keys(all[0]);
        var lines = all.map(function(r) {
          return keys.map(function(k) { return String(r[k] !== undefined ? r[k] : '').replace(/\t/g, ' ').replace(/\n/g, '\\n'); }).join('\t');
        });
        addToClipboard(lines.join('\n'), '提取结果');
        setStatus('已复制 ' + all.length + ' 行');
      }});
      items.push({ label: '📋 复制查询语句', action: function() {
        var q = queryInput.value.trim();
        if (!q) { setStatus('没有查询语句'); return; }
        addToClipboard(q, '查询语句');
        setStatus('已复制查询语句');
      }});
    }

    else if (type === 'registered-elements') {
      items.push({ label: '📊 导出为 Excel', action: function() { exportToExcel(); } });
      items.push({ label: '📋 复制采集数据', action: function() {
        var all = Parser.state.queryResults;
        if (!all || all.length === 0) { setStatus('没有数据'); return; }
        var keys = Object.keys(all[0]);
        var lines = all.map(function(r) {
          return keys.map(function(k) { return String(r[k] !== undefined ? r[k] : '').replace(/\t/g, ' ').replace(/\n/g, '\\n'); }).join('\t');
        });
        addToClipboard(lines.join('\n'), '采集数据');
        setStatus('已复制 ' + all.length + ' 行');
      }});
      items.push({ label: '🗑 清空注册', action: function() {
        clearRegisteredElements();
      }});
    }

    else if (type === 'collected-scroll' || type === 'collected-api') {
      items.push({ label: '📊 导出数据', action: function() { exportToExcel(); } });
      items.push({ label: '🗑 清空采集', action: function() {
        var key = type === 'collected-scroll' ? '_scrollDataCount' : '_apiDataCount';
        Parser.state[key] = 0;
        setStatus('采集数据已清空');
        updatePickedTreeNodes();
      }});
    }

    // —— 通用项（所有节点末尾追加） ——
    if (items.length > 0) items.push('-');
    items.push({ label: '📋 复制节点名称', action: function(row, lbl) {
      addToClipboard(lbl, '树节点');
      setStatus('已复制: ' + lbl);
    }});

    // 展开/折叠（仅当节点可能有子内容时显示）
    var node = row ? row.closest('.tree-node') : null;
    var hasChildren = node && node.querySelector('.tree-children');
    if (hasChildren) {
      items.push('-');
      items.push({ label: '🔽 展开全部子节点', action: function(row) {
        var n = row.closest('.tree-node');
        if (n) {
          n.querySelectorAll('.tree-children.hidden, .tree-group-body.hidden').forEach(function(c) { c.classList.remove('hidden'); });
          n.querySelectorAll('.toggle').forEach(function(t) { t.textContent = '▼'; });
        }
      }});
      items.push({ label: '🔼 折叠全部子节点', action: function(row) {
        var n = row.closest('.tree-node');
        if (n) {
          n.querySelectorAll('.tree-children:not(.hidden), .tree-group-body:not(.hidden)').forEach(function(c) { c.classList.add('hidden'); });
          n.querySelectorAll('.toggle').forEach(function(t) {
            var nd = t.closest('.tree-node');
            if (nd && nd.querySelector('.tree-children')) t.textContent = '▶';
          });
        }
      }});
    }

    return items;
  }

  // ──────── Webview 右键菜单 ────────

  window.api.onWebviewContextMenu(function(params) {
    showWebviewContextMenu(params);
  });

  function fetchElementInfo(x, y, callback) {
    // 在 webview 中注入脚本，获取右键位置元素的详细信息
    var script = '(' + function(x2, y2) {
      var el = document.elementFromPoint(x2, y2);
      if (!el || el === document.documentElement || el === document.body) {
        return JSON.stringify({ tag: '', xpath: '', cssPath: '', outerHTML: '' });
      }
      // XPath
      function getXPath(element) {
        if (element.id) return '//*[@id="' + element.id + '"]';
        var parts = [];
        var current = element;
        while (current && current.nodeType === 1) {
          var tag = current.tagName.toLowerCase();
          var parent = current.parentNode;
          if (parent) {
            var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === current.tagName; });
            if (siblings.length > 1) {
              var idx = siblings.indexOf(current) + 1;
              tag += '[' + idx + ']';
            }
          }
          parts.unshift(tag);
          current = parent;
        }
        return '/' + parts.join('/');
      }
      // CSS 选择器路径
      function getCSSPath(element) {
        var parts = [];
        var current = element;
        while (current && current.nodeType === 1 && current !== document.body) {
          var tag = current.tagName.toLowerCase();
          if (current.id) {
            parts.unshift('#' + current.id);
            break;
          }
          if (current.className && typeof current.className === 'string') {
            var cls = current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
            if (cls.length > 0) {
              tag += '.' + cls.join('.');
            }
          }
          var parent = current.parentNode;
          if (parent) {
            var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === current.tagName; });
            if (siblings.length > 1) {
              var idx = siblings.indexOf(current) + 1;
              tag += ':nth-of-type(' + idx + ')';
            }
          }
          parts.unshift(tag);
          current = parent;
        }
        return parts.join(' > ');
      }
      return JSON.stringify({
        tag: el.tagName.toLowerCase(),
        xpath: getXPath(el),
        cssPath: getCSSPath(el),
        outerHTML: el.outerHTML,
        id: el.id || '',
        className: (typeof el.className === 'string') ? el.className : ''
      });
    } + ')(' + x + ', ' + y + ')';

    try {
      webview.executeJavaScript(script).then(function(json) {
        try {
          var info = JSON.parse(json);
          callback(info);
        } catch(e) { callback({ tag: '', xpath: '', cssPath: '', outerHTML: '' }); }
      }).catch(function() {
        callback({ tag: '', xpath: '', cssPath: '', outerHTML: '' });
      });
    } catch(e) {
      callback({ tag: '', xpath: '', cssPath: '', outerHTML: '' });
    }
  }

  function showWebviewContextMenu(params) {
    var old = document.getElementById('webviewContextMenu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.id = 'webviewContextMenu';
    menu.className = 'context-menu';
    menu.style.left = params.x + 'px';
    menu.style.top = params.y + 'px';
    menu.style.minWidth = '180px';

    // 构建基础菜单（不含元素信息项）
    var items = buildWebviewMenuItems(params, null);

    // 元素项容器（异步填充）
    var elementSection = document.createElement('div');
    elementSection.id = 'webviewCtxElementSection';

    function renderItems(itemList) {
      itemList.forEach(function(item) {
        if (item === '-') {
          var sep = document.createElement('div');
          sep.className = 'context-menu-separator';
          menu.appendChild(sep);
        } else {
          var el = document.createElement('div');
          el.className = 'context-menu-item';
          if (item.disabled) el.classList.add('disabled');
          el.innerHTML = (item.icon || '') + ' ' + item.label;
          el.addEventListener('click', function() {
            menu.remove();
            if (!item.disabled && item.action) item.action();
          });
          menu.appendChild(el);
        }
      });
    }

    renderItems(items);

    // 确保 webview 有 contextmenu 监听（页面刷新后可能丢失）
    _ensureCtxInjected();

    // 联动：定位到当前面板的对应行
    var locItem = createCtxMenuItem('📍 定位到表格行', function() {
      var info = window._parserCtxElement; // 从 webview 取回后存于此
      if (!info || !info.xpath) { setStatus('未获取到元素信息'); return; }
      var found = _locateInPanel(info);
      if (!found) setStatus('未在当前面板中找到对应行');
    });
    menu.appendChild(locItem);

    // 清空旧值，避免第二次右键时误用上次数据
    window._parserCtxElement = null;

    // 立刻从 webview 取回 contextmenu 存储的元素信息（不等用户点击）
    webview.executeJavaScript('window.__parserCtxElement').then(function(info) {
      window._parserCtxElement = info || null;
    }).catch(function() {
      window._parserCtxElement = null;
    });

    menu.appendChild(elementSection);
    document.body.appendChild(menu);

    // 边界检测
    function adjustBounds() {
      var menuRect = menu.getBoundingClientRect();
      if (menuRect.right > window.innerWidth) {
        menu.style.left = (params.x - menuRect.width) + 'px';
      }
      if (menuRect.bottom > window.innerHeight) {
        menu.style.top = (params.y - menuRect.height) + 'px';
      }
    }
    adjustBounds();

    // 点击其他区域关闭
    var closer = function(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closer);
      }
    };
    setTimeout(function() {
      document.addEventListener('click', closer);
    }, 0);

    // webview 内的点击不会冒泡到外层 document，注入一次性监听关闭菜单
    webview.executeJavaScript(
      'document.addEventListener("mousedown",function _cm(){' +
        'document.removeEventListener("mousedown",_cm,true);' +
        'console.log("__ctx_close");' +
      '},true)'
    ).catch(function(){});

    // 异步获取元素信息，动态插入元素解析项
    fetchElementInfo(params.x, params.y, function(elementInfo) {
      window._parserLastCtxElement = elementInfo;
      if (!document.getElementById('webviewContextMenu')) return;
      if (!elementInfo.tag) return; // 无有效元素，不添加

      // 插入分隔线 + 元素项
      var sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      elementSection.appendChild(sep);

      var xpathItem = createCtxMenuItem('🔍 提取 XPath', function() {
        queryInput.value = elementInfo.xpath;
        queryContainer.dataset.mode = 'xpath';
        showQueryInputRow();
        hideAllPanels();
        queryContainer.classList.remove('hidden');
        contentTitle.textContent = 'XPath 提取';
        Parser.query.executeQuery();
      });
      elementSection.appendChild(xpathItem);

      var cssItem = createCtxMenuItem('🎯 提取 CSS 选择器', function() {
        queryInput.value = elementInfo.cssPath;
        queryContainer.dataset.mode = 'css';
        showQueryInputRow();
        hideAllPanels();
        queryContainer.classList.remove('hidden');
        contentTitle.textContent = 'CSS 选择器提取';
        Parser.query.executeQuery();
      });
      elementSection.appendChild(cssItem);

      var sep2 = document.createElement('div');
      sep2.className = 'context-menu-separator';
      elementSection.appendChild(sep2);

      var srcItem = createCtxMenuItem('📄 查看元素源码', function() {
        if (elementInfo.outerHTML) {
          addToClipboard(elementInfo.outerHTML, '元素源码');
          setStatus('已复制元素源码 (' + (elementInfo.outerHTML.length / 1024).toFixed(1) + ' KB)');
        }
      });
      elementSection.appendChild(srcItem);

      adjustBounds();
    });
  }

  // ── 树节点查找辅助 ──

  function _ensureCtxInjected() {
    try {
      webview.executeJavaScript(
        '(function(){' +
          'if(window.__parserCtxInjected)return;' +
          'window.__parserCtxInjected=true;' +
          'function getXPath(el){' +
            'if(el.id)return"//*[@id=\\""+el.id+"\\"]";' +
            'var parts=[];' +
            'while(el&&el!==document.body&&el!==document.documentElement){' +
              'var t=el.tagName.toLowerCase();' +
              'var p=el.parentElement;' +
              'if(p){' +
                'var sibs=Array.from(p.children).filter(function(c){return c.tagName===el.tagName});' +
                'if(sibs.length>1)t+="["+(sibs.indexOf(el)+1)+"]"' +
              '}' +
              'parts.unshift(t);' +
              'el=p' +
            '}' +
            'return"//"+parts.join("/")' +
          '}' +
          'function getCSSPath(el){' +
            'var parts=[];var cur=el;' +
            'while(cur&&cur.nodeType===1&&cur!==document.body){' +
              'var tag=cur.tagName.toLowerCase();' +
              'if(cur.id){parts.unshift("#"+cur.id);break;}' +
              'if(cur.className&&typeof cur.className==="string"){' +
                'var cls=cur.className.trim().split(/\\s+/).filter(Boolean).slice(0,2);' +
                'if(cls.length)tag+="."+cls.join(".")' +
              '}' +
              'var p=cur.parentElement;' +
              'if(p){' +
                'var sibs=Array.from(p.children).filter(function(c){return c.tagName===cur.tagName});' +
                'if(sibs.length>1)tag+=":nth-of-type("+(sibs.indexOf(cur)+1)+")"' +
              '}' +
              'parts.unshift(tag);cur=p' +
            '}' +
            'return parts.join(" > ")' +
          '}' +
          'document.addEventListener("contextmenu",function(e){' +
            'var el=e.target;' +
            'var xpaths=[],csspaths=[];' +
            'while(el&&el!==document.body){' +
              'xpaths.push(getXPath(el));' +
              'csspaths.push(getCSSPath(el));' +
              'el=el.parentElement' +
            '}' +
            'window.__parserCtxElement={xpath:xpaths[0]||"",cssPath:csspaths[0]||"",tag:e.target.tagName.toLowerCase(),ancestorXPaths:xpaths,ancestorCSSPaths:csspaths}' +
          '},true)' +
        '})()'
      ).catch(function(){});
    } catch(e) {}
  }

  function _normalizeXPath(xp) {
    // 去掉开头的 /html 或 /html[1]，统一格式
    return (xp || '').replace(/^\/html(\[\d+\])?\//, '/');
  }

  function _findTreeNodeByElementInfo(elementInfo, tree) {
    if (!elementInfo.xpath) return null;
    var targetNorm = _normalizeXPath(elementInfo.xpath);

    function walk(node) {
      if (node.tag === '#text' || node.tag === '#comment' || node.tag === '#root') {
        // 跳过非元素节点，但继续搜索子节点
        if (node['子元素']) {
          for (var i = 0; i < node['子元素'].length; i++) {
            var found = walk(node['子元素'][i]);
            if (found) return found;
          }
        }
        return null;
      }
      var nodeXp = buildXPathFromTree(node, tree);
      if (nodeXp && _normalizeXPath(nodeXp) === targetNorm) return node;
      if (node['子元素']) {
        for (var i = 0; i < node['子元素'].length; i++) {
          var found = walk(node['子元素'][i]);
          if (found) return found;
        }
      }
      return null;
    }

    return walk(tree);
  }

  function _expandTreeToNode(targetNode, tree) {
    // 构建从根到目标节点的路径
    var path = [];
    function findPath(node) {
      if (node === targetNode) return true;
      if (!node['子元素']) return false;
      for (var i = 0; i < node['子元素'].length; i++) {
        var child = node['子元素'][i];
        if (findPath(child)) { path.unshift(child); return true; }
      }
      return false;
    }
    findPath(tree);
    path.unshift(tree); // 包含根节点

    // 在 DOM 中展开路径并滚动到目标
    var treePanel = document.querySelector('.ne-tree-panel');
    if (!treePanel) return;

    // 收集所有节点行
    var rows = treePanel.querySelectorAll('.ne-node-row');
    var targetRow = null;
    for (var ri = 0; ri < rows.length; ri++) {
      // 找到目标行（通过文本内容匹配标签和深度）
    }

    // 简化方案：计算目标深度，展开所有祖先
    // 展开整个树到目标深度
    var targetDepth = path.length - 1;
    treePanel.querySelectorAll('.ne-arrow').forEach(function(arrow) {
      if (arrow.textContent === '\u25b6') {
        // 只展开到目标深度的祖先
        var row = arrow.parentElement;
        var depth = parseInt(row.style.paddingLeft) / 16 || 0;
        if (depth < targetDepth) {
          arrow.click();
        }
      }
    });

    // 滚动：找到目标节点对应的 DOM 行并滚动
    setTimeout(function() {
      // 尝试通过属性匹配找到目标行
      var targetTag = targetNode.tag;
      var targetId = targetNode['属性'] ? targetNode['属性'].id : '';
      var allRows = treePanel.querySelectorAll('.ne-node-row');
      for (var ri = 0; ri < allRows.length; ri++) {
        var row = allRows[ri];
        var depth = Math.round(parseInt(row.style.paddingLeft) / 16) || 0;
        if (depth === targetDepth) {
          var tagEl = row.querySelector('.ne-tag');
          if (tagEl && tagEl.textContent && tagEl.textContent.indexOf(targetTag) !== -1) {
            if (targetId) {
              // 进一步检查 ID
              var rowText = row.textContent || '';
              if (rowText.indexOf(targetId) !== -1) {
                targetRow = row;
                break;
              }
            } else {
              targetRow = row;
              // 不 break，可能有多层同标签，取最后一个匹配
            }
          }
        }
      }
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetRow.style.transition = 'background-color 0.3s';
        targetRow.style.backgroundColor = 'rgba(59,130,246,0.2)';
        setTimeout(function() { targetRow.style.backgroundColor = ''; }, 1800);
        setTimeout(function() { targetRow.style.transition = ''; }, 2100);
      }
      setStatus(targetRow ? '已在 DOM 树中定位' : '未在 DOM 树中找到对应节点');
    }, 200);
  }

  // 联动定位：根据当前活跃面板查找元素行
  // 在表格行中按 xpath 精确匹配（不用 CSS 选择器，xpath 含 " 会破坏语法）
  function _findRowByXPath(xpath) {
    var rows = document.querySelectorAll('#queryResults tr[data-xpath]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-xpath') === xpath) return rows[i];
    }
    return null;
  }

  function _findRowByCSSPath(cssPath) {
    var rows = document.querySelectorAll('#queryResults tr[data-selector]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-selector') === cssPath) return rows[i];
    }
    return null;
  }

  function _highlightTableRow(tr, label) {
    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tr.style.transition = 'background-color 0.3s';
    tr.style.backgroundColor = 'rgba(59,130,246,0.2)';
    setTimeout(function() { tr.style.backgroundColor = ''; }, 1800);
    setTimeout(function() { tr.style.transition = ''; }, 2100);
    setStatus('已定位到' + (label || '表格行'));
  }

  function _locateInPanel(elementInfo) {
    if (!elementInfo || !elementInfo.xpath) return false;

    // 收集候选 xpath：当前元素 + 所有祖先（解决深层嵌套点击穿透）
    var xpaths = elementInfo.ancestorXPaths || [elementInfo.xpath];

    // 1) 查询结果面板 — xpath 优先，css 兜底，都沿祖先链
    var qc = document.getElementById('queryContainer');
    if (qc && !qc.classList.contains('hidden')) {
      for (var xi = 0; xi < xpaths.length; xi++) {
        var tr = _findRowByXPath(xpaths[xi]);
        if (tr) { _highlightTableRow(tr, '查询结果行'); return true; }
      }
      var csspaths = elementInfo.ancestorCSSPaths || (elementInfo.cssPath ? [elementInfo.cssPath] : []);
      for (var ci = 0; ci < csspaths.length; ci++) {
        var tr = _findRowByCSSPath(csspaths[ci]);
        if (tr) { _highlightTableRow(tr, '查询结果行'); return true; }
      }
    }

    // 2) DOM 树面板
    var tree = document.getElementById('domTreeContainer');
    if (tree && !tree.classList.contains('hidden') && cachedNodeExplorerData) {
      var targetNode = _findTreeNodeByElementInfo(elementInfo, cachedNodeExplorerData);
      if (targetNode) {
        _expandTreeToNode(targetNode, cachedNodeExplorerData);
        return true;
      }
    }

    return false;
  }

  function createCtxMenuItem(label, action) {
    var el = document.createElement('div');
    el.className = 'context-menu-item';
    el.textContent = label;
    el.addEventListener('click', function() {
      var menu = document.getElementById('webviewContextMenu');
      if (menu) menu.remove();
      action();
    });
    return el;
  }

  function buildWebviewMenuItems(params, elementInfo) {
    var items = [];
    var hasSelection = params.selectionText && params.selectionText.trim().length > 0;
    var hasLink = params.linkURL && params.linkURL.trim().length > 0;
    var hasImage = params.hasImageContents || (params.srcURL && params.srcURL.trim().length > 0);
    var srcURL = params.srcURL || '';
    var linkURL = params.linkURL || '';
    var isEditable = params.isEditable || false;
    var hasElement = elementInfo && elementInfo.tag && elementInfo.tag.length > 0;

    // ── 导航 ──
    items.push({ label: '\u2190  返回', action: function() {
      try { webview.goBack(); } catch(e) {}
    }});
    items.push({ label: '\u2192  前进', action: function() {
      try { webview.goForward(); } catch(e) {}
    }});
    items.push({ label: '\u{1F504}  刷新页面', action: function() {
      try { webview.reload(); } catch(e) {}
    }});
    items.push('-');
    items.push({ label: '\u{1F4C4}  查看页面源代码', action: function() {
      webview.executeJavaScript('document.documentElement.outerHTML').then(function(html) {
        // 浮动弹窗，不覆盖查询面板
        var old = document.getElementById('sourceViewModal');
        if (old) old.remove();
        var modal = document.createElement('div');
        modal.id = 'sourceViewModal';
        modal.style.cssText = 'position:fixed;top:40px;left:50%;transform:translateX(-50%);width:90%;max-height:80vh;z-index:99999;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.4);display:flex;flex-direction:column';
        modal.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">'
          + '<span style="font-weight:600;font-size:13px">页面源代码 (' + (html.length / 1024).toFixed(1) + ' KB)</span>'
          + '<div style="display:flex;gap:6px">'
          + '<button class="btn-source-copy" style="font-size:11px;padding:4px 12px;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text);cursor:pointer">📋 复制</button>'
          + '<button class="btn-source-close" style="font-size:11px;padding:4px 12px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer">✕ 关闭</button>'
          + '</div></div>'
          + '<pre style="flex:1;overflow:auto;padding:12px;margin:0;white-space:pre-wrap;word-break:break-all;font-size:11px;line-height:1.5;color:var(--text);background:var(--bg)">' + escapeHtml(html) + '</pre>';
        document.body.appendChild(modal);
        modal.querySelector('.btn-source-close').addEventListener('click', function() { modal.remove(); });
        modal.querySelector('.btn-source-copy').addEventListener('click', function() {
          addToClipboard(html, '页面源代码');
          setStatus('页面源代码已复制');
        });
        // 点击遮罩关闭
        modal.addEventListener('mousedown', function(e) { if (e.target === modal) modal.remove(); });
      }).catch(function() { setStatus('获取源代码失败'); });
    }});

    // ── 选中内容 ──
    if (hasSelection) {
      items.push('-');
      items.push({ label: '\u{1F4CB}  复制选中文本', action: function() {
        addToClipboard(params.selectionText, '页面选中');
        setStatus('已复制选中文本');
      }});
      items.push({ label: '\u{1F50D}  用选中文本搜索', action: function() {
        var sel = params.selectionText.trim();
        if (sel) {
          // 在 webview 内用 Ctrl+F 搜索或跳转到搜索面板
          queryInput.value = sel;
          queryContainer.dataset.mode = 'css';
          showQueryInputRow();
          hideAllPanels();
          queryContainer.classList.remove('hidden');
          contentTitle.textContent = '搜索: ' + sel.substring(0, 40);
          Parser.query.executeQuery();
        }
      }});
    }
    if (!isEditable && !hasSelection) {
      items.push('-');
      items.push({ label: '\u{1F4C4}  全选', action: function() {
        webview.executeJavaScript('document.execCommand("selectAll")');
      }});
    }

    // ── 链接（条件） ──
    if (hasLink) {
      items.push('-');
      items.push({ label: '\u{1F4CB}  复制链接地址', action: function() {
        addToClipboard(linkURL, '链接');
        setStatus('已复制链接地址');
      }});
      items.push({ label: '\u{1F517}  在新窗口打开链接', action: function() {
        window.api.openPopupTab(linkURL);
      }});
    }

    // ── 图片（条件） ──
    if (hasImage) {
      items.push('-');
      items.push({ label: '\u{1F4CB}  复制图片地址', action: function() {
        addToClipboard(srcURL, '图片URL');
        setStatus('已复制图片地址');
      }});
      items.push({ label: '\u{1F4BE}  保存图片...', action: function() {
        window.api.downloadImage(srcURL).then(function(r) {
          if (r && r.ok) {
            setStatus('图片已保存: ' + r.path);
          } else {
            setStatus('保存图片失败');
          }
        });
      }});
    }

    // ── 元素解析（仅在 elementInfo 已就绪时添加） ──
    if (hasElement) {
      items.push('-');
      items.push({ label: '\u{1F50D}  提取 XPath', action: function() {
        queryInput.value = elementInfo.xpath;
        queryContainer.dataset.mode = 'xpath';
        showQueryInputRow();
        hideAllPanels();
        queryContainer.classList.remove('hidden');
        contentTitle.textContent = 'XPath 提取';
        Parser.query.executeQuery();
      }});
      items.push({ label: '\u{1F3AF}  提取 CSS 选择器', action: function() {
        queryInput.value = elementInfo.cssPath;
        queryContainer.dataset.mode = 'css';
        showQueryInputRow();
        hideAllPanels();
        queryContainer.classList.remove('hidden');
        contentTitle.textContent = 'CSS 选择器提取';
        Parser.query.executeQuery();
      }});
      items.push('-');
      items.push({ label: '\u{1F4C4}  查看元素源码', action: function() {
        if (elementInfo.outerHTML) {
          addToClipboard(elementInfo.outerHTML, '元素源码');
          setStatus('已复制元素源码 (' + (elementInfo.outerHTML.length / 1024).toFixed(1) + ' KB)');
        }
      }});
    }

    // ── 采集（条件） ──
    if (typeof collector !== 'undefined' && collector.active) {
      items.push('-');
      items.push({ label: '\u{23F9}  关闭数据采集', action: function() { deactivateCollector(); } });
    }

    // ── 页面工具 ──
    items.push('-');
    items.push({ label: '\u{1F4CB}  复制页面 URL', action: function() {
      var url = webview.getURL();
      addToClipboard(url, '页面URL');
      setStatus('已复制页面 URL');
    }});

    return items;
  }

  // ── 批量抓取已迁移到 modules/batch.js ──

  // ──────── 数据采集 ────────

  async function ingestCollectedToBackend(source, rows) {
    if (!rows || rows.length === 0) return;
    try {
      var url = '';
      try { url = webview.getURL(); } catch (e) {}
      var resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/collect/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source, url: url, rows: rows }),
      });
      if (resp.ok) {
        var data = await resp.json();
        setStatus(source + '采集入库: ' + data.added + ' 新增 / ' + data.total + ' 总计 [' + (data.collect_id || '') + ']');
        if (source === 'scroll') { Parser.state._scrollDataCount = data.total || 0; }
        else { Parser.state._apiDataCount = data.total || 0; }
      }
    } catch (e) {}
  }

  async function registerCollectedToBackend(source, rows, deltaContainer) {
    if (!rows || rows.length === 0) return;
    try {
      var elems = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var html = r._outerHTML || '';
        var text = '';
        // 取 textContent 或第一个文本字段作为 text
        if (r.textContent) text = r.textContent;
        else {
          var keys = Object.keys(r);
          for (var k = 0; k < keys.length; k++) {
            if (keys[k].charAt(0) !== '_' && typeof r[keys[k]] === 'string') {
              text = r[keys[k]]; break;
            }
          }
        }
        var dk = source + '||' + (deltaContainer || '') + '||' + (r.href || '') + '||' + (r.src || '') + '||' + text.substring(0, 100);
        elems.push({
          dedupKey: dk,
          outerHTML: html,
          selector: deltaContainer || '',
          xpath: '',
          source: source,
          tag: '',
          text: text,
          className: String(r.class || r.className || ''),
          elementId: r.id || '',
          href: r.href || '',
          src: r.src || ''
        });
      }
      var resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/elements/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: elems }),
      });
      if (resp.ok) {
        var data = await resp.json();
        setStatus(source + '采集已注册: ' + (data.registered ? data.registered.length : 0) + ' 个元素');
      }
    } catch (e) {}
  }

  // ──────── 行为模拟参数（所有参数可配置）───────
  var behave = window.behave = {
    enable: true,
    jitter: 20,        // 滚动偏差 %
    pauseChance: 30,   // 停顿概率 %
    pauseMin: 200,     // 停顿最短 ms
    pauseMax: 800,     // 停顿最长 ms
    readPause: 1500,   // 底部阅读停顿 ms
    backChance: 10,    // 回滚概率 %
    hoverChance: 20,   // 悬停概率 %
    hoverMin: 300,     // 悬停最短 ms
    hoverMax: 1200,    // 悬停最长 ms
  };

  var collector = window.collector = {
    active: false,
    tab: 'scroll',
    subMode: 'manual',
    scroll: {
      step: 400,
      bounce: 50,
      wait: 2000,
      intervalMin: 500,
      intervalMax: 2000,
      stepDelayMin: 200,
      stepDelayMax: 400,
      bounceDelayMin: 100,
      bounceDelayMax: 200,
      maxSteps: 60,
      unchangedLimit: 3,
      bottomTolerance: 80,
      backTopWait: 500,
      maxFields: 30,
      selector: '',
      selectorType: 'css',
      running: false,
      cancelFlag: false,
    },
    api: {
      url: '',
      pageParam: 'page',
      sizeParam: 'size',
      pageSize: 20,
      startPage: 1,
      currentPage: 1,
      interval: 500,
      method: 'GET',
      useCookie: true,
      extraParams: '',
      timeout: 30000,
      retries: 1,
      paginationType: 'page',
      cursorPath: '',
      cursorParam: 'cursor',
      nextCursor: null,
      dataPath: '',
      collectedData: [],
      allRows: [],
      autoStopFlag: false,
      autoRunning: false,
    },
  };

  function randBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function activateCollector(tab, subMode) {
    webviewOverlay.classList.add('hidden');
    panelRight.style.width = '40%';
    panelLeft.style.width = '';
    btnFetch.classList.remove('hidden');
    btnElementPicker.classList.remove('hidden');
    btnManagePickedHeader.classList.remove('hidden');
    var _rml=document.getElementById('btnRuleModeList'); if(_rml)_rml.classList.remove('hidden');
    var _rmd=document.getElementById('btnRuleModeDetail'); if(_rmd)_rmd.classList.remove('hidden');
    collector.active = true;
    collector.tab = tab;
    collector.subMode = subMode;
    if (Parser.state.pickModeActive) collectorFloat.classList.remove('hidden');
    // 采集模式：显示采集按钮，隐藏批量按钮
    collectorFloat.classList.add('pf-collect-mode');
    collectorFloat.classList.remove('pf-batch-mode');
    pfCollect.classList.toggle('hidden', subMode !== 'auto');
    // 启动采集前重新注入 stealth（确保 SPA 页面 stealth 不过期）
    var host = extractHost(webview.getURL());
    Parser.stealth.injectStealthConfig(host);
    Parser.stealth.applyStealthGlobals(host);
    if (tab === 'scroll') {
      pfPrev.title = '回到顶部';
      pfNext.title = '向下滚动';
      collector.scroll.cancelFlag = false;
      // 注入行为模拟脚本
      Parser.stealth.injectBehaviorScript();
    } else {
      pfPrev.title = '上一页';
      pfNext.title = '下一页';
      collector.api.currentPage = collector.api.startPage;
      pfPage.textContent = collector.api.currentPage;
      tryAutoDetectApiUrl();
    }
    setStatus('数据采集\u00b7' + (tab === 'scroll' ? '滚动' : 'API') + '\u00b7' + (subMode === 'manual' ? '手动' : '自动'));
  }

  function deactivateCollector() {
    collector.active = false;
    collector.scroll.running = false;
    collector.scroll.cancelFlag = true;
    collector.api.autoStopFlag = true;
    collectorFloat.classList.add('hidden');
    collectorConfig.classList.add('hidden');
    setStatus('数据采集已关闭');
  }

  async function scrollOneStep() {
    var step = collector.scroll.step;
    var bounce = collector.scroll.bounce;
    // 行为模拟：随机偏差
    if (behave.enable && behave.jitter > 0) {
      var jit = 1 + (Math.random() - 0.5) * 2 * behave.jitter / 100;
      step = Math.round(step * jit);
    }
    try {
      await webview.executeJavaScript('window.scrollBy({top:' + step + ',behavior:"smooth"})');
    } catch(e) { console.warn('[采集] 滚动失败:', e.message); }
    // 行为模拟：中途随机停顿
    if (behave.enable && Math.random() * 100 < behave.pauseChance) {
      await sleep(randBetween(behave.pauseMin, behave.pauseMax));
    }
    // 行为模拟：随机鼠标悬停
    if (behave.enable && Math.random() * 100 < behave.hoverChance) {
      try {
        await webview.executeJavaScript(
          '(function(){var b=window.__parser&&window.__parser.behavior;' +
          'if(!b)return;var el=b.getRandomVisibleElement();' +
          'if(el){b.simulateHover(el);return "hovered";}return "none";})()'
        );
      } catch(e) {}
      await sleep(randBetween(behave.hoverMin, behave.hoverMax));
    }
    await sleep(randBetween(collector.scroll.stepDelayMin, collector.scroll.stepDelayMax));
    if (bounce > 0) {
      try {
        await webview.executeJavaScript('window.scrollBy({top:-' + bounce + ',behavior:"smooth"})');
      } catch(e) { console.warn('[采集] 回弹失败:', e.message); }
      await sleep(randBetween(collector.scroll.bounceDelayMin, collector.scroll.bounceDelayMax));
    }
    // 行为模拟：随机回滚
    if (behave.enable && Math.random() * 100 < behave.backChance) {
      var backAmt = Math.round(step * (0.1 + Math.random() * 0.2));
      try {
        await webview.executeJavaScript('window.scrollBy({top:-' + backAmt + ',behavior:"smooth"})');
      } catch(e) {}
      await sleep(randBetween(100, 300));
    }
  }

  async function autoScrollLoop() {
    collector.scroll.running = true;
    collector.scroll.cancelFlag = false;
    pfCollect.classList.add('running');
    pfCollect.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>';

    // 增量快照准备：优先用弹窗里手动填的选择器
    var manualSel = (collector.scroll.selector || '').trim();
    var manualSelType = collector.scroll.selectorType || 'css';
    var useManual = manualSel.length > 0;
    var validItems = Parser.state.editorItems.filter(function(item) { return item.selector && !item._tagHeader && !item.isGroup; });
    var useDelta = useManual || validItems.length > 0;
    var deltaContainer = null;
    var deltaFields = null;
    var allDeltaRows = [];
    if (useDelta) {
      if (useManual) {
        deltaContainer = manualSel;
        // 手动选择器模式下，自动收集 textContent + 所有可见属性
        deltaFields = [{ name: 'textContent', type: 'css', attr: 'textContent', selector: manualSel }];
        if (manualSelType === 'css') {
          deltaFields = deltaFields.concat([
            { name: 'href', type: 'css', attr: 'href', selector: manualSel },
            { name: 'src', type: 'css', attr: 'src', selector: manualSel },
            { name: 'class', type: 'css', attr: 'class', selector: manualSel },
          ]);
        }
      } else {
      var firstItem = validItems[0];
      var sel = firstItem.selector || (firstItem.elementInfo ? firstItem.elementInfo.css : '') || '';
      deltaContainer = sel.replace(/#[a-zA-Z][\w-]*/g, '').replace(/:nth-of-type\(\d+\)/g, '').replace(/\s*>\s*/g, ' > ').replace(/^\s*>\s*/, '').trim();
      // 去 #id 后为空（如纯 #id 选择器），用标签名兜底
      // 清理残留的空段（连续的 > 或首尾的 >）
      deltaContainer = deltaContainer.replace(/\s*>\s*>\s*/g, ' > ').replace(/^\s*>\s*/, '').replace(/\s*>\s*$/g, '');
      if (!deltaContainer) {
        var tag = (firstItem.elementInfo && firstItem.elementInfo.tag) || '';
        if (tag) {
          // 尝试用 className 缩小范围
          var cls = (firstItem.elementInfo && firstItem.elementInfo.className) || '';
          cls = (typeof cls === 'string' ? cls : '').trim().split(/\s+/)[0] || '';
          deltaContainer = tag + (cls ? '.' + cls : '');
        } else {
          deltaContainer = '';
        }
      }
      // 构建字段方案：遍历所有已选元素，收集全部属性（30上限）
      var skipKeys = {tag:1,css:1,xpath:1,count:1,selectors:1,boundingRect:1,_page:1};
      var fieldSeen = {};
      deltaFields = [];
      for (var fi = 0; fi < validItems.length; fi++) {
        var el = validItems[fi].elementInfo || {};
        for (var k in el) {
          if (skipKeys[k] || !el.hasOwnProperty(k) || el[k] == null) continue;
          if (!fieldSeen[k] && deltaFields.length < collector.scroll.maxFields) {
            fieldSeen[k] = true;
            var attr = k;
            var name = k;
            if (k === 'text') { name = 'textContent'; attr = 'textContent'; }
            else if (k === 'className') { name = 'class'; attr = 'class'; }
            deltaFields.push({ name: name, type: 'css', attr: attr, selector: validItems[fi].selector });
          }
        }
      }
      deltaFields.sort(function(a,b) { return a.attr === 'textContent' ? -1 : b.attr === 'textContent' ? 1 : 0; });
      } // end else (非手动选择器模式)
      // 确保采集引擎注入 webview（不依赖预加载文件）
      await webview.executeJavaScript('(function(){if(!window.__parser)window.__parser={};if(!window.__parser.collector){window.__parser.collector={_cleanText:function(s){if(!s)return"";s=String(s);s=s.replace(/\\p{Zs}/gu," ");s=s.replace(/\\p{Zl}/gu," ");s=s.replace(/\\p{Zp}/gu," ");s=s.replace(/\\p{Cf}/gu,"");s=s.replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g,"");s=s.replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\uFFFE\uFFFF]/gu,"");s=s.trim();return s},knownKeys:{},init:function(){this.knownKeys={}},extractDelta:function(s,f){var els=document.querySelectorAll(s),r=[],self=this;for(var i=0;i<els.length;i++){var el=els[i],row={},kp=[];for(var j=0;j<f.length;j++){var fd=f[j],v="";if(fd.type==="css"){var a=fd.attr||"textContent";v=a==="textContent"?_cleanText(el.textContent||""):el.getAttribute(a)||""}row[fd.name]=v;kp.push(v)}row._outerHTML=(el.outerHTML||"").substring(0,5000);var key=kp.join("\\x00");if(!self.knownKeys[key]){self.knownKeys[key]=true;r.push(row)}}return r}};window.__parser.collector.init()}})()');

      // 预检：一次性显示所有诊断信息
      var matchCount = 0, trialCount = '?';
      if (deltaContainer) {
        try { matchCount = await webview.executeJavaScript('document.querySelectorAll(' + JSON.stringify(deltaContainer) + ').length') || 0; } catch(e) {}
      }
      if (matchCount > 0 && deltaContainer && deltaFields.length > 0) {
        try {
          // 先检查 __parser 和 collector 是否存在
          var checkCode = 'typeof window.__parser==="object" && typeof window.__parser.collector==="object"';
          var hasCollector = await webview.executeJavaScript(checkCode);
          if (!hasCollector) {
            trialCount = 'no_collector';
          } else {
            var selType = collector.scroll.selectorType || 'css';
            var tCode;
            if (selType === 'xpath' && useManual) {
              tCode = '(function(){var s=' + JSON.stringify(deltaContainer) + ';var xr=document.evaluate(s,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);var r=[];for(var xi=0;xi<xr.snapshotLength;xi++){var el=xr.snapshotItem(xi);r.push({textContent:(el.textContent||"").trim().substring(0,200)})}return r})()';
            } else {
              tCode = '(function(){var f=' + JSON.stringify(deltaFields) + ';var s=' + JSON.stringify(deltaContainer) + ';var r=window.__parser.collector.extractDelta(s,f);window.__parser.collector.init();return r})()';
            }
            trialCount = (await webview.executeJavaScript(tCode) || []).length;
          }
        } catch(e) {
          trialCount = 'err:' + (e.message || '').substring(0, 30);
        }
      }
      if (!deltaContainer || matchCount === 0 || typeof trialCount === 'string') {
        useDelta = false;
        setStatus('增量采集不可用(sel=' + (deltaContainer||'空').substring(0,30) + ' qsa=' + matchCount + ')，回退解析');
      } else {
        setStatus('增量采集就绪: ' + matchCount + ' 元素，' + deltaFields.length + ' 字段');
      }
    } else {
      setStatus('无字段方案，回退解析');
    }
    setStatus('自动滚动中...');
    try {
      for (var i = 0; i < collector.scroll.maxSteps; i++) {
        if (collector.scroll.cancelFlag) break;
        await scrollOneStep();
        if (collector.scroll.cancelFlag) break;
        var interval = randBetween(collector.scroll.intervalMin, collector.scroll.intervalMax);
        await sleep(interval);

        // 增量提取
        if (useDelta && deltaContainer && deltaFields) {
          try {
            var fieldsJson = JSON.stringify(deltaFields);
            var selType = collector.scroll.selectorType || 'css';
            var code;
            if (selType === 'xpath' && useManual) {
              code = '(function(){var s=' + JSON.stringify(deltaContainer) + ';var xr=document.evaluate(s,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);var r=[];for(var xi=0;xi<xr.snapshotLength;xi++){var el=xr.snapshotItem(xi);r.push({textContent:(el.textContent||"").trim().substring(0,200)})}return r})()';
            } else {
              code = '(function(){var f=' + fieldsJson + ';var s=' + JSON.stringify(deltaContainer) + ';return window.__parser.collector.extractDelta(s,f)})()';
            }
            var newRows = await webview.executeJavaScript(code);
            if (newRows && newRows.length > 0) {
              allDeltaRows = allDeltaRows.concat(newRows);
            }
          } catch (e) {}
        }

        try {
          var h = await webview.executeJavaScript('Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)') || 0;
          var scrollY = await webview.executeJavaScript('window.scrollY') || 0;
          var winH = await webview.executeJavaScript('window.innerHeight') || 800;
          if (i % 3 === 0) setStatus('滚动 ' + (i+1) + '/' + collector.scroll.maxSteps + '  已提取 ' + allDeltaRows.length);
          if (scrollY + winH >= h - collector.scroll.bottomTolerance) {
            // 行为模拟：底部阅读停顿
            var bottomWait = collector.scroll.wait + (behave.enable ? behave.readPause : 0);
            await sleep(bottomWait);
            var h2 = await webview.executeJavaScript('Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)') || 0;
            if (h2 === h) break;
          }
        } catch(e2) { setStatus('滚动检测失败: ' + e2.message); break; }
      }
    } catch(err) {
      setStatus('自动滚动出错: ' + err.message);
    }
    await webview.executeJavaScript('window.scrollTo({top:0,behavior:"smooth"})');
    await sleep(collector.scroll.backTopWait);
    collector.scroll.running = false;
    pfCollect.classList.remove('running');
    pfCollect.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

    if (useDelta && allDeltaRows.length > 0) {
      Parser.state.queryResults = allDeltaRows;
      hideAllPanels();
      queryContainer.classList.remove('hidden');
      queryContainer.dataset.mode = 'pagination';
      renderQueryTable(allDeltaRows);
      contentTitle.textContent = '滚动采集 (' + allDeltaRows.length + '项)';
      setStatus('增量采集完成: ' + allDeltaRows.length + ' 条');
      ingestCollectedToBackend('scroll', allDeltaRows);
      registerCollectedToBackend('scroll', allDeltaRows, deltaContainer);
    } else if (useDelta) {
      setStatus('增量采集: 0 条，请重新点选元素或检查选择器');
    } else {
      setStatus('滚动完成，正在解析...');
      scrollExtractCurrentPage();
    }
  }

  async function scrollExtractCurrentPage() {
    try {
      var html = await webview.executeJavaScript('document.documentElement.outerHTML');
      if (!html) { setStatus('滚动提取失败'); return; }
      var resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/parse/all', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: html, query: '' }),
      });
      if (!resp.ok) throw new Error('解析失败');
      var pdata = await resp.json();
      Parser.state.currentHtml = html;
      Parser.state.parseResult = pdata;
      buildTree(Parser.state.parseResult);
      setStatus('滚动提取完成');
    } catch (e) {
      setStatus('提取失败: ' + e.message);
    }
  }

  function handleScrollPrev() {
    _manualDeltaDone = false;
    webview.executeJavaScript('window.scrollTo({top:0,behavior:"smooth"})');
  }

  var _manualDeltaDone = false;
  async function handleScrollNext() {
    try {
      await scrollOneStep();
      await sleep(collector.scroll.wait);
      var h = await webview.executeJavaScript('Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)') || 0;
      var scrollY = await webview.executeJavaScript('window.scrollY') || 0;
      var winH = await webview.executeJavaScript('window.innerHeight') || 800;
      if (scrollY + winH >= h - collector.scroll.bottomTolerance) {
        if (Parser.state.editorItems.length > 0 && !_manualDeltaDone) {
          _manualDeltaDone = true;
          var rows = await extractCurrentDelta();
          if (rows && rows.length > 0) {
            Parser.state.queryResults = rows;
            hideAllPanels();
            queryContainer.classList.remove('hidden');
            queryContainer.dataset.mode = 'pagination';
            renderQueryTable(rows);
            contentTitle.textContent = '滚动采集 (' + rows.length + '项)';
            setStatus('手动滚动采集完成: ' + rows.length + ' 条');
            ingestCollectedToBackend('scroll', rows);
            registerCollectedToBackend('scroll', rows, '');
          }
        } else {
          scrollExtractCurrentPage();
        }
      }
    } catch(e) {
      setStatus('手动滚动出错: ' + e.message);
    }
  }
  async function extractCurrentDelta() {
    var manualSel = (collector.scroll.selector || '').trim();
    var selType = collector.scroll.selectorType || 'css';
    if (manualSel) {
      try {
        if (selType === 'xpath') {
          var xcode = '(function(){var s=' + JSON.stringify(manualSel) + ';var xr=document.evaluate(s,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);var r=[];for(var xi=0;xi<xr.snapshotLength;xi++){var el=xr.snapshotItem(xi);r.push({textContent:(el.textContent||"").trim().substring(0,500)})}return r})()';
          return await webview.executeJavaScript(xcode) || [];
        }
        var fields = [{name:'textContent', type:'css', attr:'textContent'}];
        await webview.executeJavaScript('(function(){if(!window.__parser)window.__parser={};if(!window.__parser.collector){window.__parser.collector={_cleanText:function(s){if(!s)return"";s=String(s);s=s.replace(/\\p{Zs}/gu," ");s=s.replace(/\\p{Zl}/gu," ");s=s.replace(/\\p{Zp}/gu," ");s=s.replace(/\\p{Cf}/gu,"");s=s.replace(/[\\u0000-\\u0008\\u000E-\\u001F\\u007F-\\u009F]/g,"");s=s.replace(/[\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}\\uFFFE\\uFFFF]/gu,"");s=s.trim();return s},knownKeys:{},init:function(){this.knownKeys={}},extractDelta:function(s,f){var els=document.querySelectorAll(s),r=[],self=this;for(var i=0;i<els.length;i++){var el=els[i],row={},kp=[];for(var j=0;j<f.length;j++){var fd=f[j],v="";if(fd.type==="css"){var a=fd.attr||"textContent";v=a==="textContent"?_cleanText(el.textContent||""):el.getAttribute(a)||""}row[fd.name]=v;kp.push(v)}row._outerHTML=(el.outerHTML||"").substring(0,5000);var key=kp.join("\\\\x00");if(!self.knownKeys[key]){self.knownKeys[key]=true;r.push(row)}}return r}};window.__parser.collector.init()}})()');
        var code = '(function(){var f=' + JSON.stringify(fields) + ';var s=' + JSON.stringify(manualSel) + ';return window.__parser.collector.extractDelta(s,f)})()';
        return await webview.executeJavaScript(code) || [];
      } catch(e) { return []; }
    }
    var vi = Parser.state.editorItems.filter(function(it) { return it.selector && !it._tagHeader && !it.isGroup; });
    if (!vi.length) return [];
    var sel = (vi[0].selector || '').replace(/#[a-zA-Z][\w-]*/g, '').replace(/:nth-of-type\(\d+\)/g, '').replace(/\s*>\s*/g,' > ').replace(/^\s*>\s*/, '').trim();
    if (!sel) return [];
    var fi = vi[0].elementInfo || {};
    var tag = (fi.tag || '').toLowerCase();
    var attr = tag === 'img' || fi.src ? 'src' : tag === 'a' || fi.href ? 'href' : 'textContent';
    var fields = [{name:attr, type:'css', attr:attr}];
    try {
      await webview.executeJavaScript('(function(){if(!window.__parser)window.__parser={};if(!window.__parser.collector){window.__parser.collector={_cleanText:function(s){if(!s)return"";s=String(s);s=s.replace(/\\p{Zs}/gu," ");s=s.replace(/\\p{Zl}/gu," ");s=s.replace(/\\p{Zp}/gu," ");s=s.replace(/\\p{Cf}/gu,"");s=s.replace(/[\\u0000-\\u0008\\u000E-\\u001F\\u007F-\\u009F]/g,"");s=s.replace(/[\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}\\uFFFE\\uFFFF]/gu,"");s=s.trim();return s},knownKeys:{},init:function(){this.knownKeys={}},extractDelta:function(s,f){var els=document.querySelectorAll(s),r=[],self=this;for(var i=0;i<els.length;i++){var el=els[i],row={},kp=[];for(var j=0;j<f.length;j++){var fd=f[j],v="";if(fd.type==="css"){var a=fd.attr||"textContent";v=a==="textContent"?_cleanText(el.textContent||""):el.getAttribute(a)||""}row[fd.name]=v;kp.push(v)}row._outerHTML=(el.outerHTML||"").substring(0,5000);var key=kp.join("\\\\x00");if(!self.knownKeys[key]){self.knownKeys[key]=true;r.push(row)}}return r}};window.__parser.collector.init()}})()');
      var code = '(function(){var f=' + JSON.stringify(fields) + ';var s=' + JSON.stringify(sel) + ';return window.__parser.collector.extractDelta(s,f)})()';
      return await webview.executeJavaScript(code) || [];
    } catch(e) { return []; }
  }

  function handleCollectClick() {
    if (collector.tab === 'scroll') {
      if (collector.scroll.running) {
        collector.scroll.cancelFlag = true;
        collector.scroll.running = false;
        pfCollect.classList.remove('running');
        pfCollect.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        setStatus('自动滚动已停止');
      } else {
        autoScrollLoop();
      }
    } else {
      if (collector.api.autoRunning) { stopAutoApi(); }
      else { startAutoApi(); }
    }
  }

  function buildApiUrl(page) {
    var url = collector.api.url;
    if (!url) return '';
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    var pt = collector.api.paginationType;
    if (pt === 'cursor') {
      if (collector.api.nextCursor) {
        url += sep + encodeURIComponent(collector.api.cursorParam) + '=' + encodeURIComponent(collector.api.nextCursor);
      }
    } else if (pt === 'offset') {
      var offset = (page - 1) * collector.api.pageSize;
      url += sep + encodeURIComponent(collector.api.pageParam) + '=' + offset;
      url += '&' + encodeURIComponent(collector.api.sizeParam) + '=' + collector.api.pageSize;
    } else {
      url += sep + encodeURIComponent(collector.api.pageParam) + '=' + page;
      url += '&' + encodeURIComponent(collector.api.sizeParam) + '=' + collector.api.pageSize;
    }
    if (collector.api.extraParams) {
      var extra = collector.api.extraParams.trim();
      if (extra.charAt(0) === '&' || extra.charAt(0) === '?') extra = extra.substring(1);
      url += '&' + extra;
    }
    return url;
  }

  async function fetchApiPage(page) {
    var url = buildApiUrl(page);
    if (!url) throw new Error('请先配置 API 地址');
    var maxRetries = collector.api.retries || 0;
    var lastError = null;
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        var headers = {};
        if (collector.api.useCookie) {
          try {
            var cookies = await window.api.cookieGetAll();
            var domain = '';
            try { domain = new URL(url).hostname; } catch (e) {}
            if (domain) {
              var cookieStr = cookies
                .filter(function(c) { return domain.endsWith(c.domain.replace(/^\./, '')) || c.domain.replace(/^\./, '') === domain; })
                .map(function(c) { return c.name + '=' + c.value; })
                .join('; ');
              if (cookieStr) headers['Cookie'] = cookieStr;
            }
          } catch (e) {}
        }
        var result = await window.api.apiRequest({
          url: url, method: collector.api.method,
          headers: headers, timeout: collector.api.timeout,
        });
        if (!result || !result.ok) throw new Error(result ? result.error : '请求失败');
        return result;
      } catch (e) {
        lastError = e;
        if (attempt < maxRetries) {
          setStatus('第' + (attempt+1) + '次失败，重试中...');
          await sleep(1000 * (attempt + 1));
        }
      }
    }
    throw lastError || new Error('请求失败');
  }

  function findLargestArray(obj, depth, maxDepth) {
    if (depth > (maxDepth || 5)) return null;
    if (Array.isArray(obj)) return obj;
    if (typeof obj !== 'object' || obj === null) return null;
    var keys = Object.keys(obj);
    var best = null;
    for (var i = 0; i < keys.length; i++) {
      var child = obj[keys[i]];
      if (Array.isArray(child) && child.length > 0) {
        if (!best || child.length > best.length) best = child;
      }
      if (typeof child === 'object' && child !== null) {
        var nested = findLargestArray(child, depth + 1, maxDepth);
        if (nested && (!best || nested.length > best.length)) best = nested;
      }
    }
    return best;
  }

  function getValueByPath(obj, path) {
    if (!path) return null;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function extractCursorFromBody(body) {
    if (!collector.api.cursorPath) return null;
    var parsed = null;
    try { parsed = JSON.parse(body); } catch (e) {}
    if (!parsed) return null;
    var val = getValueByPath(parsed, collector.api.cursorPath);
    return val || null;
  }

  function extractRowsFromBody(body, page) {
    var rows = [];
    var parsed = null;
    try { parsed = JSON.parse(body); } catch (e) {}
    if (!parsed) return { rows: rows, isJson: false };
    var list = null;
    // 优先使用手动指定的 dataPath
    if (collector.api.dataPath) {
      list = getValueByPath(parsed, collector.api.dataPath);
      if (list && !Array.isArray(list) && typeof list === 'object') {
        list = findLargestArray(list, 0, 3);
      }
    }
    // 兜底：递归找最大数组
    if (!Array.isArray(list) || list.length === 0) {
      list = findLargestArray(parsed, 0, 5);
    }
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) {
        if (typeof list[i] === 'object' && list[i] !== null) {
          list[i]._page = page;
          rows.push(list[i]);
        } else {
          rows.push({ _page: page, value: list[i] });
        }
      }
    } else if (typeof list === 'object' && list !== null) {
      list._page = page;
      rows.push(list);
    }
    // 提取 cursor（cursor 分页模式）
    var cursor = extractCursorFromBody(body);
    return { rows: rows, isJson: true, nextCursor: cursor };
  }

  function updateApiResultDisplay() {
    pfCount.textContent = collector.api.collectedData.length + '页/' + collector.api.allRows.length + '条';
    pfCount.classList.toggle('has-data', collector.api.allRows.length > 0);
    if (collector.api.allRows.length > 0) {
      hideAllPanels();
      queryContainer.classList.remove('hidden');
      queryContainer.dataset.mode = 'pagination';
      Parser.state.queryResults = collector.api.allRows;
      renderQueryTable(collector.api.allRows);
      contentTitle.textContent = 'API采集 (' + collector.api.allRows.length + '项)';
    }
  }

  async function goToApiPage(page) {
    if (!collector.active || collector.tab !== 'api') return;
    if (page < 1) return;
    collector.api.currentPage = page;
    pfPage.textContent = page;
    pfPrev.classList.add('loading');
    pfNext.classList.add('loading');
    try {
      setStatus('正在请求第 ' + page + ' 页...');
      var data = await fetchApiPage(page);
      collector.api.collectedData.push({
        page: page, url: data.url || buildApiUrl(page),
        status: data.status, body: data.body,
        headers: data.headers, timestamp: Date.now(),
      });
      var result = extractRowsFromBody(data.body, page);
      collector.api.allRows = collector.api.allRows.concat(result.rows);
      updateApiResultDisplay();
      setStatus('第 ' + page + ' 页，' + result.rows.length + ' 条');
      if (result.rows.length > 0) { ingestCollectedToBackend('api', result.rows); registerCollectedToBackend('api', result.rows, ''); }
      return result;
    } catch (e) {
      setStatus('请求失败: ' + e.message);
      return { rows: [], isJson: false };
    } finally {
      pfPrev.classList.remove('loading');
      pfNext.classList.remove('loading');
    }
  }

  function handleApiPrev() { goToApiPage(collector.api.currentPage - 1); }
  function handleApiNext() { goToApiPage(collector.api.currentPage + 1); }

  async function startAutoApi() {
    collector.api.autoRunning = true;
    collector.api.autoStopFlag = false;
    collector.api.nextCursor = null;
    pfCollect.classList.add('running');
    pfCollect.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>';
    setStatus('API自动采集开始...');
    var isCursor = collector.api.paginationType === 'cursor';
    var pageCount = 0;
    while (!collector.api.autoStopFlag) {
      try {
        var data = await fetchApiPage(collector.api.currentPage);
        collector.api.collectedData.push({
          page: collector.api.currentPage, url: data.url || buildApiUrl(collector.api.currentPage),
          status: data.status, body: data.body,
          headers: data.headers, timestamp: Date.now(),
        });
        var result = extractRowsFromBody(data.body, collector.api.currentPage);
        if (isCursor) {
          collector.api.nextCursor = result.nextCursor || null;
        }
        if (result.isJson && result.rows.length === 0) {
          pageCount++;
          var stopMsg = isCursor ? '采集完成：cursor结束' : ('采集完成：第' + collector.api.currentPage + '页空数据');
          setStatus(stopMsg + '，共' + collector.api.collectedData.length + '页');
          break;
        }
        collector.api.allRows = collector.api.allRows.concat(result.rows);
        pfPage.textContent = collector.api.currentPage;
        updateApiResultDisplay();
        setStatus('已采集 ' + collector.api.currentPage + ' 页，共 ' + collector.api.allRows.length + ' 条');
        collector.api.currentPage++;
        if (isCursor && !collector.api.nextCursor) {
          setStatus('采集完成：无下一页cursor，共' + collector.api.collectedData.length + '页');
          break;
        }
        // 行为模拟：API 请求间隔加随机抖动
        if (behave.enable) {
          var jitInterval = collector.api.interval * (1 + (Math.random() - 0.5) * 2 * behave.jitter / 100);
          await sleep(Math.round(jitInterval));
          // 随机停顿（和滚动一样）
          if (Math.random() * 100 < behave.pauseChance) {
            await sleep(randBetween(behave.pauseMin, behave.pauseMax));
          }
        } else {
          await sleep(collector.api.interval);
        }
      } catch (e) {
        setStatus('采集出错(第' + collector.api.currentPage + '页): ' + e.message);
        break;
      }
    }
    collector.api.autoRunning = false;
    pfCollect.classList.remove('running');
    pfCollect.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    if (collector.api.allRows.length > 0) {
      ingestCollectedToBackend('api', collector.api.allRows.slice());
      registerCollectedToBackend('api', collector.api.allRows.slice(), '');
    }
  }

  function stopAutoApi() {
    collector.api.autoStopFlag = true;
    collector.api.autoRunning = false;
    pfCollect.classList.remove('running');
    pfCollect.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    setStatus('API自动采集已停止');
  }

  function handlePrev() {
    if (collector.tab === 'scroll') handleScrollPrev();
    else handleApiPrev();
  }

  function handleNext() {
    if (collector.tab === 'scroll') handleScrollNext();
    else handleApiNext();
  }

  function openCollectorConfig() {
    var tabs = document.querySelectorAll('.pf-tab');
    tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.tab === collector.tab); });
    pfTabScroll.classList.toggle('hidden', collector.tab !== 'scroll');
    pfTabApi.classList.toggle('hidden', collector.tab !== 'api');
    $('#pfScrollStep').value = collector.scroll.step;
    $('#pfScrollBounce').value = collector.scroll.bounce;
    $('#pfScrollWait').value = collector.scroll.wait;
    $('#pfScrollIntervalMin').value = collector.scroll.intervalMin;
    $('#pfScrollIntervalMax').value = collector.scroll.intervalMax;
    $('#pfScrollStepDelayMin').value = collector.scroll.stepDelayMin;
    $('#pfScrollStepDelayMax').value = collector.scroll.stepDelayMax;
    $('#pfScrollBounceDelayMin').value = collector.scroll.bounceDelayMin;
    $('#pfScrollBounceDelayMax').value = collector.scroll.bounceDelayMax;
    $('#pfScrollMaxSteps').value = collector.scroll.maxSteps;
    $('#pfScrollUnchangedLimit').value = collector.scroll.unchangedLimit;
    $('#pfScrollBottomTolerance').value = collector.scroll.bottomTolerance;
    $('#pfScrollBackTopWait').value = collector.scroll.backTopWait;
    $('#pfScrollSelector').value = collector.scroll.selector || '';
    $('#pfScrollSelType').value = collector.scroll.selectorType || 'css';
    $('#pfApiUrl').value = collector.api.url;
    $('#pfPageParam').value = collector.api.pageParam;
    $('#pfPageSize').value = collector.api.pageSize;
    $('#pfSizeParam').value = collector.api.sizeParam;
    $('#pfMethod').value = collector.api.method;
    $('#pfInterval').value = collector.api.interval;
    $('#pfStartPage').value = collector.api.startPage;
    $('#pfExtraParams').value = collector.api.extraParams;
    $('#pfApiTimeout').value = collector.api.timeout;
    $('#pfApiRetries').value = collector.api.retries;
    $('#pfPaginationType').value = collector.api.paginationType;
    $('#pfCursorParam').value = collector.api.cursorParam;
    $('#pfCursorPath').value = collector.api.cursorPath;
    $('#pfApiDataPath').value = collector.api.dataPath;
    $('#pfCursorRow').style.display = collector.api.paginationType === 'cursor' ? 'flex' : 'none';
    $('#pfUseCookie').checked = collector.api.useCookie;
    $('#pfApiListen').checked = Parser.state._apiListenOn;
    collectorConfig.classList.remove('hidden');
    if (collector.tab === 'api') { tryAutoDetectApiUrl(); listNetworkCandidates(); }
  }

  function saveCollectorConfig() {
    var activeTab = document.querySelector('.pf-tab.active');
    collector.tab = activeTab ? activeTab.dataset.tab : 'scroll';
    collector.scroll.step = parseInt($('#pfScrollStep').value) || 400;
    collector.scroll.bounce = parseInt($('#pfScrollBounce').value) || 50;
    collector.scroll.wait = parseInt($('#pfScrollWait').value) || 2000;
    collector.scroll.intervalMin = parseInt($('#pfScrollIntervalMin').value) || 500;
    collector.scroll.intervalMax = parseInt($('#pfScrollIntervalMax').value) || 2000;
    if (collector.scroll.intervalMax < collector.scroll.intervalMin) {
      collector.scroll.intervalMax = collector.scroll.intervalMin;
    }
    collector.scroll.stepDelayMin = parseInt($('#pfScrollStepDelayMin').value) || 200;
    collector.scroll.stepDelayMax = parseInt($('#pfScrollStepDelayMax').value) || 400;
    if (collector.scroll.stepDelayMax < collector.scroll.stepDelayMin) {
      collector.scroll.stepDelayMax = collector.scroll.stepDelayMin;
    }
    collector.scroll.bounceDelayMin = parseInt($('#pfScrollBounceDelayMin').value) || 100;
    collector.scroll.bounceDelayMax = parseInt($('#pfScrollBounceDelayMax').value) || 200;
    if (collector.scroll.bounceDelayMax < collector.scroll.bounceDelayMin) {
      collector.scroll.bounceDelayMax = collector.scroll.bounceDelayMin;
    }
    collector.scroll.maxSteps = parseInt($('#pfScrollMaxSteps').value) || 60;
    collector.scroll.unchangedLimit = parseInt($('#pfScrollUnchangedLimit').value) || 3;
    collector.scroll.bottomTolerance = parseInt($('#pfScrollBottomTolerance').value) || 80;
    collector.scroll.backTopWait = parseInt($('#pfScrollBackTopWait').value) || 500;
    collector.scroll.selector = ($('#pfScrollSelector').value || '').trim();
    collector.scroll.selectorType = $('#pfScrollSelType').value || 'css';
    var listEl = $('#pfApiUrlList');
    var apiVal;
    if (listEl.classList.contains('hidden')) {
      apiVal = $('#pfApiUrl').value.trim();
    } else {
      apiVal = listEl.value;
      if (apiVal === '__custom__') apiVal = $('#pfApiUrl').value.trim();
    }
    collector.api.url = apiVal;
    collector.api.pageParam = $('#pfPageParam').value.trim() || 'page';
    collector.api.pageSize = parseInt($('#pfPageSize').value) || 20;
    collector.api.sizeParam = $('#pfSizeParam').value.trim() || 'size';
    collector.api.method = $('#pfMethod').value;
    collector.api.interval = parseInt($('#pfInterval').value) || 500;
    collector.api.startPage = parseInt($('#pfStartPage').value) || 1;
    collector.api.extraParams = $('#pfExtraParams').value.trim();
    collector.api.useCookie = $('#pfUseCookie').checked;
    collector.api.timeout = parseInt($('#pfApiTimeout').value) || 30000;
    collector.api.retries = parseInt($('#pfApiRetries').value) || 1;
    collector.api.paginationType = $('#pfPaginationType').value || 'page';
    collector.api.cursorParam = $('#pfCursorParam').value.trim() || 'cursor';
    collector.api.cursorPath = $('#pfCursorPath').value.trim();
    collector.api.dataPath = $('#pfApiDataPath').value.trim();
    collector.api.currentPage = collector.api.startPage;
    pfPage.textContent = collector.api.currentPage;
    collector.api.collectedData = [];
    collector.api.allRows = [];
    pfCount.textContent = '0条';
    pfCount.classList.remove('has-data');
    pfPrev.title = collector.tab === 'scroll' ? '回到顶部' : '上一页';
    pfNext.title = collector.tab === 'scroll' ? '向下滚动' : '下一页';
    if ((!!$('#pfApiListen').checked) !== Parser.state._apiListenOn && window.api.apiListenToggle) { window.api.apiListenToggle(); Parser.state._apiListenOn = !Parser.state._apiListenOn; }
    collectorConfig.classList.add('hidden');
    try {
      // 保存时排除运行时字段（cancelFlag/running 等不存在于配置中）
      var scrollCfg = {};
      Object.keys(collector.scroll).forEach(function(k) {
        if (k !== 'cancelFlag' && k !== 'running') scrollCfg[k] = collector.scroll[k];
      });
      localStorage.setItem('collector_config', JSON.stringify({
        tab: collector.tab, scroll: scrollCfg,
        api: { url: collector.api.url, pageParam: collector.api.pageParam,
          pageSize: collector.api.pageSize, sizeParam: collector.api.sizeParam,
          method: collector.api.method, interval: collector.api.interval,
          startPage: collector.api.startPage, extraParams: collector.api.extraParams,
          useCookie: collector.api.useCookie, timeout: collector.api.timeout,
          retries: collector.api.retries, paginationType: collector.api.paginationType,
          cursorPath: collector.api.cursorPath, cursorParam: collector.api.cursorParam,
          dataPath: collector.api.dataPath },
      }));
    } catch (e) {}
    setStatus('配置已保存');
  }

  // Tab 切换事件
  document.querySelectorAll('.pf-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.pf-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      pfTabScroll.classList.toggle('hidden', tab.dataset.tab !== 'scroll');
      pfTabApi.classList.toggle('hidden', tab.dataset.tab !== 'api');
      if (tab.dataset.tab === 'api') { tryAutoDetectApiUrl(); listNetworkCandidates(); }
    });
  });

  // ── API 自动检测 ──

  function tryAutoDetectApiUrl() {
    (async function() {
      try {
        var urls = [];
        var code = '(function(){var e=performance.getEntriesByType("resource"),u=[],s={};for(var i=0;i<e.length;i++){var r=e[i];if(r.initiatorType!=="xmlhttprequest"&&r.initiatorType!=="fetch")continue;var n=r.name;if(!n||s[n])continue;s[n]=true;if(/.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|map)(\\?|$)/i.test(n))continue;u.push(n)}return u})()';
        urls = await webview.executeJavaScript(code);
        if ((!urls || urls.length === 0) && window.api && window.api.apiCapturedUrls) {
          try { var c = await window.api.apiCapturedUrls(); if (c && c.length > 0) urls = c.map(function(r) { return r.url; }); } catch (e) {}
        }
        if (!urls || urls.length === 0) {
          var le = $('#pfApiUrlList');
          if (le) {
            le.innerHTML = '<option value="" disabled selected hidden>-- 选择API地址 --</option>';
            var co = document.createElement('option'); co.value = '__custom__'; co.textContent = '\u270e 手动输入';
            le.appendChild(co);
          }
          return;
        }
        var seen = {}; urls = urls.filter(function(u) { if (seen[u]) return false; seen[u] = true; return true; });
        var pns = ['page','pn','p','offset','pageNo','pageNum','pageIndex','current','start'];
        var scored = urls.map(function(u) {
          var sc = 0, lo = u.toLowerCase();
          if (/\/list\b|\/search\b|\/items\b|\/api\b|\/query\b|_list\b|_search\b/i.test(lo)) sc += 3;
          for (var j = 0; j < pns.length; j++) { if (new RegExp('[?&]'+pns[j]+'=','i').test(lo)) { sc += 5; break; } }
          if (/\.json(\?|$)/i.test(lo)) sc += 2;
          if (/login|sso|auth|oauth|token|passport|analytics|tracking|beacon|monitor|collect|report|alibaba-inc\.com|umeng|tongji|cnzz|gtag|google-analytics|googletagmanager|pixel/i.test(lo)) sc -= 100;
          sc += Math.max(0,(200-u.length)/200);
          return { url: u, score: sc };
        });
        scored.sort(function(a,b) { return b.score - a.score; });
        var cleaned = scored.map(function(s) {
          var c = s.url.replace(/[?&]page=\d+/gi,'').replace(/[?&]pn=\d+/gi,'').replace(/[?&]p=\d+/gi,'')
            .replace(/[?&]offset=\d+/gi,'').replace(/[?&]pageNo=\d+/gi,'').replace(/[?&]pageNum=\d+/gi,'')
            .replace(/[?&]pageIndex=\d+/gi,'').replace(/[?&]current=\d+/gi,'').replace(/[?&]start=\d+/gi,'')
            .replace(/[?&]size=\d+/gi,'').replace(/[?&]limit=\d+/gi,'').replace(/[?&]pageSize=\d+/gi,'')
            .replace(/\?&/,'?').replace(/&&/g,'&').replace(/\?$/,'').replace(/&$/,'');
          return { url: c, score: s.score, original: s.url };
        });
        var cs = {}, uniq = [];
        cleaned.forEach(function(c) { if (cs[c.url]) return; cs[c.url] = true; uniq.push(c); });
        var good = uniq.filter(function(c) { return c.score > 0; });
        var top = good.slice(0, 10);
        var le = $('#pfApiUrlList');
        var pv = le.value; le.innerHTML = '';
        if (top.length > 0) {
          top.forEach(function(c) {
            var o = document.createElement('option'); o.value = c.url;
            var s = c.original.replace(/^https?:\/\//,''); if (s.length > 80) s = s.substring(0,77)+'...';
            o.textContent = s; le.appendChild(o);
          });
          var co = document.createElement('option'); co.value = '__custom__'; co.textContent = '\u270e 手动输入'; le.appendChild(co);
          if (pv && pv !== '__custom__' && le.querySelector('option[value="'+pv.replace(/"/g,'\\"')+'"]')) { le.value = pv; }
          else if (collector.api.url && le.querySelector('option[value="'+collector.api.url.replace(/"/g,'\\"')+'"]')) { le.value = collector.api.url; }
          else { le.value = top[0].url; collector.api.url = top[0].url; $('#pfApiUrl').classList.add('hidden'); }
          setStatus('检测到 ' + top.length + ' 个数据 API');
        } else {
          le.innerHTML = '<option value="" disabled selected hidden>-- 选择API地址 --</option>';
          var co = document.createElement('option'); co.value = '__custom__'; co.textContent = '\u270e 手动输入';
          le.appendChild(co);
          setStatus('未检测到数据API');
        }
      } catch (e) {}
    })();
  }

  // ── 网络拦截候选 ──

  function listNetworkCandidates() {
    (async function() {
      try {
        var code = '(function(){if(window.__parser&&window.__parser.networkInterceptor){return window.__parser.networkInterceptor.intercepted}return[]})()';
        var intercepted = await webview.executeJavaScript(code);
        if (!intercepted || intercepted.length === 0) {
          // 拦截器无数据，用 Performance API 兜底
          var perfCode = '(function(){var e=performance.getEntriesByType("resource"),u=[],s={};for(var i=0;i<e.length;i++){var r=e[i];if(r.initiatorType!=="xmlhttprequest"&&r.initiatorType!=="fetch")continue;var n=r.name;if(!n||s[n])continue;s[n]=true;if(/.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|map)(\\?|$)/i.test(n))continue;u.push({url:n,method:"GET",status:200,preview:"",body:"",bodyType:"json",bodySize:0,duration:r.duration||0})}return u})()';
          try { intercepted = await webview.executeJavaScript(perfCode) || []; } catch(pe) { intercepted = []; }
          if (intercepted.length === 0) {
            setStatus('网络候选：无API请求');
            $('#pfNetworkCandidates').classList.add('hidden');
            return;
          }
        }
        var noiseDomains = /login|sso|auth|oauth|token|passport|analytics|tracking|beacon|monitor|collect|report|pixel|callback|telemetry|rum|rumm|census/i;
        var filtered = intercepted.filter(function(r) {
          if (r.status !== 200) return false;
          if (r.bodyType !== 'json') return false;
          if (noiseDomains.test(r.url)) return false;
          if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|map|html?)(\?|$)/i.test(r.url)) return false;
          return true;
        });
        var pns = ['page','pn','p','offset','pageNo','pageNum','pageIndex','current','start'];
        var scored = filtered.map(function(r) {
          var sc = 0, lo = r.url.toLowerCase();
          if (/\/list\b|\/search\b|\/items\b|\/api\b|\/query\b|_list\b|_search\b/i.test(lo)) sc += 3;
          for (var j = 0; j < pns.length; j++) { if (new RegExp('[?&]'+pns[j]+'=','i').test(lo)) { sc += 5; break; } }
          if (/\.json(\?|$)/i.test(lo)) sc += 2;
          if (noiseDomains.test(lo)) sc -= 100;
          if (r.preview && r.preview.indexOf('Array') >= 0) sc += 4;
          sc += Math.max(0,(200-r.bodySize)/200);
          return { item: r, score: sc };
        });
        scored.sort(function(a,b) { return b.score - a.score; });
        var candidates = scored.filter(function(s) { return s.score > 0; }).slice(0, 10);
        var all = intercepted.slice(0, Parser.state.networkMaxAll);

        var listEl = $('#pfNetworkList');
        listEl.innerHTML = '';
        if (candidates.length > 0) {
          candidates.forEach(function(sc, idx) {
            var r = sc.item;
            var div = document.createElement('div');
            div.className = 'pf-network-item' + (idx === 0 ? ' selected' : '');
            div.dataset.index = idx;
            div.dataset.body = r.body;
            div.dataset.url = r.url;
            var method = r.method.toUpperCase();
            div.innerHTML = '<span class="nw-method ' + method.toLowerCase() + '">' + method + '</span>' +
              '<span class="nw-url" title="' + r.url.replace(/"/g,'&quot;') + '">' + r.url.replace(/^https?:\/\//,'') + '</span>' +
              '<span class="nw-preview">' + r.preview + '</span>';
            div.addEventListener('click', function() {
              listEl.querySelectorAll('.pf-network-item').forEach(function(el) { el.classList.remove('selected'); });
              this.classList.add('selected');
              fillFromCandidate(this.dataset.url, this.dataset.body);
            });
            listEl.appendChild(div);
          });
          fillFromCandidate(candidates[0].item.url, candidates[0].item.body);
        }

        // 候选子标题
        var candHead = document.createElement('div');
        candHead.className = 'pf-network-subhead';
        candHead.textContent = '⭐ 推荐 (' + candidates.length + ')';
        listEl.insertBefore(candHead, listEl.firstChild);

        // 全部请求子标题（默认隐藏）
        var subHead = document.createElement('div');
        subHead.className = 'pf-network-subhead';
        subHead.textContent = '📋 全部 (' + all.length + ')';
        subHead.style.display = 'none';
        listEl.appendChild(subHead);

        all.forEach(function(r) {
          var div = document.createElement('div');
          div.className = 'pf-network-item pf-all-item';
          div.style.display = 'none';
          div.dataset.body = r.body || '';
          div.dataset.url = r.url;
          var method = (r.method || 'GET').toUpperCase();
          var preview = r.preview || r.bodyType || '';
          div.innerHTML = '<span class="nw-method ' + method.toLowerCase() + '">' + method + '</span>' +
            '<span class="nw-url" title="' + (r.url||'').replace(/"/g,'&quot;') + '">' + (r.url||'').replace(/^https?:\/\//,'') + '</span>' +
            '<span class="nw-preview">' + preview + '</span>';
          div.addEventListener('click', function() {
            listEl.querySelectorAll('.pf-network-item').forEach(function(el) { el.classList.remove('selected'); });
            this.classList.add('selected');
            fillFromCandidate(this.dataset.url, this.dataset.body);
          });
          listEl.appendChild(div);
        });

        // 切换按钮
        var toggleBtn = document.createElement('button');
        toggleBtn.className = 'pf-toggle-all-btn';
        toggleBtn.textContent = '展开全部 (' + all.length + ') ▼';
        toggleBtn.style.display = 'none';
        var expanded = false;
        toggleBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          expanded = !expanded;
          subHead.style.display = expanded ? '' : 'none';
          var items = listEl.querySelectorAll('.pf-all-item');
          items.forEach(function(item) { item.style.display = expanded ? '' : 'none'; });
          toggleBtn.textContent = expanded ? '收起 ▲' : ('展开全部 (' + all.length + ') ▼');
        });
        listEl.appendChild(toggleBtn);

        // 如果全部请求比候选多，才显示按钮
        if (all.length > candidates.length) { toggleBtn.style.display = ''; }

        // 隐藏旧的 all details
        $('#pfNetworkAllDetails').style.display = 'none';
        $('#pfNetworkTitle').textContent = 'API获取列表';
        $('#pfNetworkCandidates').classList.remove('hidden');
      } catch (e) { console.error('listNetworkCandidates:', e); }
    })();
  }

  function fillFromCandidate(url, body) {
    if (!url) return;
    var cleaned = url.replace(/[?&](page|pn|p|offset|pageNo|pageNum|pageIndex|current|start)=\d+/gi,'')
      .replace(/[?&](size|limit|pageSize|per_page|perPage)=\d+/gi,'')
      .replace(/\?&/,'?').replace(/&&/g,'&').replace(/\?$/,'').replace(/&$/,'');
    var listEl = $('#pfApiUrlList');
    if (!listEl.classList.contains('hidden')) {
      var opts = listEl.querySelectorAll('option');
      var matched = false;
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === cleaned || opts[i].value === url) {
          listEl.value = opts[i].value;
          matched = true;
          break;
        }
      }
      if (!matched) {
        listEl.classList.add('hidden');
        $('#pfApiUrl').classList.remove('hidden');
        $('#pfApiUrl').value = url;
      }
    } else {
      $('#pfApiUrl').value = url;
    }
    if (body) {
      try {
        var parsed = JSON.parse(body);
        if (parsed) {
          if (url.indexOf('page=') >= 0 || url.indexOf('pn=') >= 0 || url.indexOf('p=') >= 0) {
            $('#pfPaginationType').value = 'page';
          } else if (url.indexOf('offset=') >= 0 || url.indexOf('start=') >= 0) {
            $('#pfPaginationType').value = 'offset';
          }
          var cursorKeys = ['nextCursor','cursor','nextToken','token','next','after','_scroll_id'];
          for (var k = 0; k < cursorKeys.length; k++) {
            if (parsed[cursorKeys[k]] || (parsed.data && parsed.data[cursorKeys[k]])) {
              if (!$('#pfCursorPath').value) {
                var cp = parsed[cursorKeys[k]] ? cursorKeys[k] : 'data.' + cursorKeys[k];
                $('#pfCursorPath').value = cp;
              }
              break;
            }
          }
          $('#pfCursorRow').style.display = $('#pfPaginationType').value === 'cursor' ? 'flex' : 'none';
        }
      } catch (e) {}
    }
  }

  $('#pfNetworkRefresh').addEventListener('click', function() {
    webview.executeJavaScript('if(window.__parser&&window.__parser.networkInterceptor){window.__parser.networkInterceptor.clear()}');
    setTimeout(listNetworkCandidates, 300);
  });

  // ── 事件绑定 ──

  pfPrev.addEventListener('click', handlePrev);
  pfNext.addEventListener('click', handleNext);
  pfGear.addEventListener('click', function() {
    // 批量模式下打开批量弹框，否则打开采集弹框
    var pagFloat = document.getElementById("paginationFloat");
    if (pagFloat && pagFloat.classList.contains('pf-batch-mode')) {
      if (typeof openBatchModal === 'function') openBatchModal();
    } else {
      openCollectorConfig();
    }
  });
  pfConfigClose.addEventListener('click', function() { collectorConfig.classList.add('hidden'); });
  pfConfigConfirm.addEventListener('click', saveCollectorConfig);

  // 弹框内滚轮事件不穿透到 webview
  collectorConfig.addEventListener('wheel', function(e) {
    e.stopPropagation();
    var scrollable = e.target.closest && e.target.closest('.pf-config-body,.modal-body');
    if (!scrollable) e.preventDefault();
  }, { passive: false, capture: true });
  $('#pfPaginationType').addEventListener('change', function() {
    $('#pfCursorRow').style.display = this.value === 'cursor' ? 'flex' : 'none';
  });
  pfCollect.addEventListener('click', handleCollectClick);

  pfPage.addEventListener('dblclick', function() {
    if (!collector.active || collector.tab !== 'api') return;
    var inp = document.createElement('input');
    inp.type = 'number'; inp.value = collector.api.currentPage; inp.min = 1;
    inp.style.cssText = 'width:50px;height:24px;font-size:14px;text-align:center;background:var(--bg-input);color:var(--text);border:1px solid var(--accent);border-radius:4px;font-family:Consolas,"Microsoft YaHei",monospace';
    pfPage.innerHTML = ''; pfPage.appendChild(inp); inp.focus(); inp.select();
    var done = function() { var p = parseInt(inp.value) || collector.api.currentPage; pfPage.textContent = p; if (p !== collector.api.currentPage) goToApiPage(p); };
    inp.addEventListener('blur', done);
    inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') done(); });
  });

  // ── API 下拉/输入框 切换逻辑 ──
  { // 块作用域
    var _pfSel = $('#pfApiUrlList');
    var _pfInp = $('#pfApiUrl');
    if (!_pfSel || !_pfInp) return;

    _pfSel.addEventListener('change', function() {
      if (_pfSel.value === '__custom__') {
        _pfSel.classList.add('hidden');
        _pfInp.value = '';
        _pfInp.classList.remove('hidden');
        _pfInp.focus();
      } else if (_pfSel.value) {
        collector.api.url = _pfSel.value;
        _pfInp.classList.add('hidden');
        _pfSel.classList.remove('hidden');
      }
    });

    function _pfSwitchBack() {
      var v = _pfInp.value.trim();
      if (v) {
        collector.api.url = v;
        _pfSel.innerHTML = '';
        var opt = document.createElement('option'); opt.value = v; opt.textContent = v.replace(/^https?:\/\//,'').substring(0,60);
        _pfSel.appendChild(opt);
        var copt = document.createElement('option'); copt.value = '__custom__'; copt.textContent = '\u270e 手动输入';
        _pfSel.appendChild(copt);
        _pfSel.value = v;
      } else {
        // 空输入：重置选中值，确保"手动输入"可以再次触发 change
        _pfSel.value = '';
      }
      _pfSel.classList.remove('hidden');
      _pfInp.classList.add('hidden');
    }

    _pfInp.addEventListener('blur', _pfSwitchBack);

    // 兜底：全局 click——只要输入框可见，点别处就触发切换
    document.addEventListener('click', function(e) {
      if (_pfInp.classList.contains('hidden')) return;
      if (e.target === _pfInp || _pfInp.contains(e.target)) return;
      _pfSwitchBack();
    });
  }

  (function() {
    try {
      var raw = localStorage.getItem('collector_config');
      if (raw) {
        var cfg = JSON.parse(raw);
        collector.tab = cfg.tab || 'scroll';
        if (cfg.scroll) Object.assign(collector.scroll, cfg.scroll);
        if (cfg.api) Object.assign(collector.api, cfg.api);
      }
    } catch (e) {}
  })();

  // ──────── 自定义导出方案 ────────

  var SCHEMA_STORAGE_PREFIX = 'export_schema:';

  function getSchemaStorageKey(name) {
    return SCHEMA_STORAGE_PREFIX + name;
  }

  /** 获取所有已保存方案名列表 */
  function getSavedSchemaNames() {
    var names = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf(SCHEMA_STORAGE_PREFIX) === 0) {
        names.push(key.substring(SCHEMA_STORAGE_PREFIX.length));
      }
    }
    return names.sort();
  }

  /** 加载一个命名方案 */
  function loadSchemaFromStorage(name) {
    try {
      var raw = localStorage.getItem(getSchemaStorageKey(name));
      if (raw) return JSON.parse(raw);
    } catch (e) { }
    return null;
  }

  /** 保存当前方案到 localStorage */
  function saveSchemaToStorage(name, schema) {
    try {
      localStorage.setItem(getSchemaStorageKey(name), JSON.stringify(schema));
      return true;
    } catch (e) { return false; }
  }

  /** 删除一个命名方案 */
  function deleteSchemaFromStorage(name) {
    localStorage.removeItem(getSchemaStorageKey(name));
  }

  /** 刷新方案下拉列表（自定义多选） */
  function refreshSchemaList() {
    if (!manualSchemeTriggerText || !manualSchemeOptions) return;
    var names = getSavedSchemaNames();
    if (!Parser.state.manualSchemes) Parser.state.manualSchemes = [];
    // 同步：已保存方案名添加到 manualSchemes（保留已有 checked 状态）
    var schemeMap = {};
    Parser.state.manualSchemes.forEach(function(s) { schemeMap[s.name] = s; });
    var newSchemes = names.map(function(n) {
      return schemeMap[n] || { name: n, checked: false };
    });
    Parser.state.manualSchemes = newSchemes;
    if (newSchemes.length === 0) {
      manualSchemeTriggerText.textContent = '暂无方案';
      manualSchemeOptions.innerHTML = '';
      return;
    }
    var checkedNames = newSchemes.filter(function(s) { return s.checked; }).map(function(s) { return s.name; });
    manualSchemeTriggerText.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0">' + (checkedNames.length > 0 ? checkedNames.join(', ') : '选择方案') + '</span>';
    var html = '';
    newSchemes.forEach(function(s, i) {
      html += '<label class="chain-custom-option">';
      html += '<input type="checkbox"' + (s.checked ? ' checked' : '') + ' data-idx="' + i + '">';
      html += '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis" data-idx="' + i + '">' + escapeHtml(s.name) + '</span>';
      html += '<span class="chain-custom-option-del" data-idx="' + i + '" title="删除方案">×</span>';
      html += '</label>';
    });
    manualSchemeOptions.innerHTML = html;
    // checkbox change → 切换勾选
    manualSchemeOptions.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var idx = parseInt(this.dataset.idx);
        if (Parser.state.manualSchemes[idx]) {
          Parser.state.manualSchemes[idx].checked = this.checked;
          refreshSchemaList();
        }
      });
    });
    // 点击方案名 → 加载到编辑器
    manualSchemeOptions.querySelectorAll('span[data-idx]').forEach(function(sp) {
      sp.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(this.dataset.idx);
        var s = Parser.state.manualSchemes[idx];
        if (!s) return;
        var schema = loadSchemaFromStorage(s.name);
        if (schema) {
          applySchemaToUI(schema);
          Parser.state.schemaPreviewData = null;
          Parser.state._editingManualSchemeName = s.name;
          setStatus('已加载方案: ' + s.name);
        }
      });
    });
    // 删除按钮
    manualSchemeOptions.querySelectorAll('.chain-custom-option-del').forEach(function(del) {
      del.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(this.dataset.idx);
        var s = Parser.state.manualSchemes[idx];
        if (!s) return;
        deleteSchemaFromStorage(s.name);
        if (Parser.state._editingManualSchemeName === s.name) Parser.state._editingManualSchemeName = null;
        Parser.state.manualSchemes.splice(idx, 1);
        refreshSchemaList();
        setStatus('已删除: ' + s.name);
      });
    });
  }

  /** 从 UI 构建当前 schema 对象 */
  function buildSchemaFromUI() {
    if (Parser.state.schemaMode === 'chain') {
      return buildChainSchema();
    }
    var fields = [];
    var rows = schemaFieldsList.querySelectorAll('.schema-field-row:not(.schema-field-header-row)');
    rows.forEach(function(row) {
      var typeTab = row.querySelector('.schema-type-tab.active');
      var type = typeTab ? typeTab.dataset.type : 'css';
      var selector = (row.querySelector('.schema-field-input.sel-input') || {}).value || '';
      var attr = (row.querySelector('.schema-field-input.attr-input') || {}).value || '';
      var name = (row.querySelector('.schema-field-input.name-input') || {}).value || '';
      fields.push({ type: type, selector: selector, attr: attr, name: name });
    });
    return {
      name: schemaName.value.trim() || Parser.state.schemaCurrentName || '',
      delimiter: Parser.state.globalMultiDelim,
      childDelimiter: Parser.state.globalChildDelim,
      fields: fields
    };
  }

  /** 将 schema 数据填入 UI */
  function applySchemaToUI(schema) {
    Parser.state.schemaCurrentName = schema.name || '';
    schemaName.value = schema.name || '';


    // 检查是否为链路模式方案
    var isChainMode = schema.mode === 'chain' || (schema.fields && schema.fields.length > 0 && schema.fields[0].type === 'chain');
    if (isChainMode && schema.chainSegments && schema.chainSegments.length > 0) {
      // 恢复链路模式
      Parser.state.schemaMode = 'chain';
      switchSchemaTab('chain');
      // 恢复链路输入和类型按钮
      schemaChainInput.value = schema.deepestSelector || (schema.fields[0] ? schema.fields[0].selector : '') || '';
      var chainType = schema.chainType || 'css';
      var cssBtn = document.getElementById('schemaTypeCss');
      var xpBtn = document.getElementById('schemaTypeXpath');
      if (cssBtn) cssBtn.classList.toggle('active', chainType === 'css');
      if (xpBtn) xpBtn.classList.toggle('active', chainType === 'xpath');
      // 恢复 chainSegments（递归结构自动保留）
      Parser.state.chainSegments = JSON.parse(JSON.stringify(schema.chainSegments));
      // 用 fields 中的 attr/name 回填到对应的节点（去重）
      if (schema.fields) {
        schema.fields.forEach(function(f) {
          if (f.type !== 'chain') return;
          var ext = f.childText
            ? { attr: '$childText', name: f.name || '', childSelectors: f.childSelectors || [], childDelimiter: f.childDelimiter || '' }
            : { attr: f.isText ? '$text' : (f.attr || ''), name: f.name || '' };
          var seg = Parser.state.chainSegments[f.chainIndex];
          if (!seg) return;
          if (f.subChain) {
            var sc = _findSubChainByPath(seg, f.subChain);
            if (sc) {
              if (!sc.extractions) sc.extractions = [];
              var dup = sc.extractions.some(function(e) { return e.attr === ext.attr; });
              if (!dup) sc.extractions.push(ext);
            }
          } else {
            if (!seg.extractions) seg.extractions = [];
            var dup = seg.extractions.some(function(e) { return e.attr === ext.attr; });
            if (!dup) seg.extractions.push(ext);
          }
        });
      }
      Parser.state._selectedChainPath = null;
      _expandedChains = {};
      Parser.state._chainHeaderOrder = null;
      renderChainTree();
    } else {
      // 手动模式
      Parser.state.schemaMode = 'manual';
      switchSchemaTab('manual');
      Parser.state.schemaFields = schema.fields && schema.fields.length > 0
        ? schema.fields.map(function(f) { return { type: f.type || 'css', selector: f.selector || '', attr: f.attr || '', name: f.name || '' }; })
        : [{ type: 'css', selector: '', attr: '', name: '' }];
      renderSchemaFields();
    }
    autoRefreshPreview();
  }

  /** 渲染一条字段行 */
  function renderFieldRow(field, index) {
    var div = document.createElement('div');
    div.className = 'schema-field-row';
    div.dataset.index = index;

    // 类型切换
    var cssActive = field.type === 'css' ? ' active' : '';
    var xpathActive = field.type === 'xpath' ? ' active' : '';
    div.innerHTML =
      '<div class="sf-col-type">' +
        '<div class="schema-type-tabs">' +
          '<button class="schema-type-tab css-tab' + cssActive + '" data-type="css">CSS</button>' +
          '<button class="schema-type-tab xpath-tab' + xpathActive + '" data-type="xpath">XP</button>' +
        '</div>' +
      '</div>' +
      '<div class="sf-col-selector">' +
        '<textarea class="schema-field-input sel-input" rows="1" style="resize:vertical;overflow:hidden">' + escapeHtml(field.selector) + '</textarea>' +
      '</div>' +
      '<div class="sf-col-attr">' +
        '<input class="schema-field-input attr-input" value="' + escapeHtml(field.attr || '') + '" placeholder="src/href">' +
      '</div>' +
      '<div class="sf-col-name">' +
        '<input class="schema-field-input name-input" value="' + escapeHtml(field.name) + '" placeholder="字段名">' +
      '</div>' +
      '<div class="sf-col-count"><span class="schema-field-count-val">-</span></div>' +
      '<div class="sf-col-preview"><button class="btn-field-preview" title="预览属性" style="font-size:12px;padding:0 4px;height:22px;border:none;border-radius:3px;background:transparent;color:var(--accent);cursor:pointer">▶</button></div>' +
      '<div class="sf-col-del"><button class="schema-field-del-btn" title="删除">&times;</button></div>';

    // 类型切换事件
    var tabs = div.querySelectorAll('.schema-type-tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var row = this.closest('.schema-field-row');
        row.querySelectorAll('.schema-type-tab').forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
        var selInput = row.querySelector('.sel-input');
        var newType = this.dataset.type;
        if (newType === 'css') {
          selInput.placeholder = '.class #id tag@attr'; var attrInp = row.querySelector('.attr-input'); if (attrInp && !attrInp.value) autoGuessAttr(selInput, attrInp, row);
        } else {
          selInput.placeholder = '//div[@class="x"]/text()'; var attrInp = row.querySelector('.attr-input'); if (attrInp && !attrInp.value) autoGuessAttr(selInput, attrInp, row);
        }
      });
    });

    // 删除按钮
    div.querySelector('.schema-field-del-btn').addEventListener('click', function() {
      removeSchemaField(index);
    });

    // 选择器输入框失焦时自动刷新预览和匹配数
    var selInput = div.querySelector('.sel-input');
    var nameInput = div.querySelector('.name-input');
    if (selInput) {
      selInput.addEventListener('blur', function() { autoGuessAttr(this, div.querySelector('.attr-input'), div); autoRefreshPreview(); });
      selInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { autoRefreshPreview(); }
      });
    }
    if (nameInput) {
      nameInput.addEventListener('blur', function() { autoRefreshPreview(); });
    }
    var attrInput = div.querySelector('.attr-input');
    if (attrInput) {
      attrInput.addEventListener('blur', function() { autoRefreshPreview(); });
      attrInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { autoRefreshPreview(); }
      });
    }

    return div;
  }

  /** 根据选择器自动猜测要提取的属性 */
  var _ATTR_GUESS = [
    { re: /(?:^|[\s>+~,(])img(?=[\s.#\[:>+~,)])/i, attr: 'src' },
    { re: /(?:^|[\s>+~,(])a(?=[\s.#\[:>+~,)])/i, attr: 'href' },
    { re: /(?:^|[\s>+~,(])link(?=[\s.#\[:>+~,)])/i, attr: 'href' },
    { re: /(?:^|[\s>+~,(])script(?=[\s.#\[:>+~,)])/i, attr: 'src' },
    { re: /(?:^|[\s>+~,(])video(?=[\s.#\[:>+~,)])/i, attr: 'src' },
    { re: /(?:^|[\s>+~,(])audio(?=[\s.#\[:>+~,)])/i, attr: 'src' },
    { re: /(?:^|[\s>+~,(])source(?=[\s.#\[:>+~,)])/i, attr: 'src' },
    { re: /(?:^|[\s>+~,(])iframe(?=[\s.#\[:>+~,)])/i, attr: 'src' },
    { re: /(?:^|[\s>+~,(])embed(?=[\s.#\[:>+~,)])/i, attr: 'src' },
    { re: /(?:^|[\s>+~,(])input(?=[\s.#\[:>+~,)])/i, attr: 'value' },
    { re: /(?:^|[\s>+~,(])form(?=[\s.#\[:>+~,)])/i, attr: 'action' },
    { re: /(?:^|[\s>+~,(])meta(?=[\s.#\[:>+~,)])/i, attr: 'content' },
    { re: /(?:^|[\s>+~,(])time(?=[\s.#\[:>+~,)])/i, attr: 'datetime' },
    { re: /@(\w[\w-]*)/i, attr: '$1' },
  ];
  function autoGuessAttr(selInput, attrInput, rowDiv) {
    if (!attrInput || attrInput.value.trim()) return; // 已有值不覆盖
    var sel = selInput.value.trim();
    if (!sel) return;
    for (var i = 0; i < _ATTR_GUESS.length; i++) {
      var m = sel.match(_ATTR_GUESS[i].re);
      if (m) {
        var attr = _ATTR_GUESS[i].attr;
        if (attr === '$1') attr = m[1];
        attrInput.value = attr;
        return;
      }
    }
  }

  /** 渲染所有字段行 */
  function renderSchemaFields() {
    if (!schemaFieldsList) return;
    schemaFieldsList.innerHTML = '';
    if (!Parser.state.schemaFields || Parser.state.schemaFields.length === 0) {
      Parser.state.schemaFields = [{ type: 'css', selector: '', attr: '', name: '' }];
    }
    Parser.state.schemaFields.forEach(function(field, i) {
      schemaFieldsList.appendChild(renderFieldRow(field, i));
    });
    // 预览按钮点击
    schemaFieldsList.querySelectorAll('.btn-field-preview').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var row = this.closest('.schema-field-row');
        var selInput = row.querySelector('.sel-input');
        if (!selInput) return;
        var sel = selInput.value.trim();
        if (!sel) return;
        var typeEl = row.querySelector('.schema-type-tab.active');
        var isXP = typeEl && typeEl.dataset.type === 'xpath';
        var exist = row.nextElementSibling;
        if (exist && exist.classList.contains('schema-field-preview')) { exist.remove(); return; }
        var preview = document.createElement('div');
        preview.className = 'schema-field-preview chain-preview';
        preview.style.margin = '2px 0 4px 0';
        preview.style.maxHeight = '200px';
        preview.innerHTML = '<div class="tree-empty" style="padding:4px;font-size:11px">加载中...</div>';
        row.parentNode.insertBefore(preview, row.nextSibling);
        var jsCode = isXP
          ? '(function(){try{var snap=document.evaluate(' + JSON.stringify(sel) + ',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);' +
            'var result=[];for(var i=0;i<Math.min(snap.snapshotLength,' + Parser.state.chainPreviewLimit + ');i++){' +
              'var el=snap.snapshotItem(i);if(el.nodeType!==1)continue;var attrs={};' +
              'for(var j=0;j<el.attributes.length;j++)attrs[el.attributes[j].name]=el.attributes[j].value;' +
              'result.push({tag:el.tagName.toLowerCase(),attrs:attrs,text:(el.textContent||"").replace(/\\s+/g," ").trim(),childCount:el.children.length});' +
            '}return result;}catch(e){return[];}})()'
          : '(function(){try{var els=document.querySelectorAll(' + JSON.stringify(sel) + ');' +
            'var result=[];for(var i=0;i<Math.min(els.length,' + Parser.state.chainPreviewLimit + ');i++){' +
              'var el=els[i];var attrs={};' +
              'for(var j=0;j<el.attributes.length;j++)attrs[el.attributes[j].name]=el.attributes[j].value;' +
              'result.push({tag:el.tagName.toLowerCase(),attrs:attrs,text:(el.textContent||"").replace(/\\s+/g," ").trim(),childCount:el.children.length});' +
            '}return result;}catch(e){return[];}})()';
        webview.executeJavaScript(jsCode).then(function(data) {
          preview.innerHTML = renderLayerPreviewHTML(data || []);
        }).catch(function() {
          preview.innerHTML = '<div style="font-size:11px;color:var(--red);padding:4px">加载失败</div>';
        });
      });
    });
  }

  /** 自动刷新预览（输入框失焦时触发） */
  var _autoPreviewTimer = null;
  function autoRefreshPreview() {
    if (_autoPreviewTimer) clearTimeout(_autoPreviewTimer);
    _autoPreviewTimer = setTimeout(function() {
      syncFieldsFromUI();
      var schema = buildSchemaFromUI();
      var fields = schema.fields.filter(function(f) { return f.selector && f.selector.trim(); });
      if (fields.length === 0) {
        schemaPreviewInfo.textContent = '';
        resetFieldCounts();
        return;
      }
      executeExtraction(schema).then(function(result) {
        if (!result || result.error) {
          schemaPreviewInfo.textContent = result ? result.error : '';
          resetFieldCounts();
          return;
        }
        Parser.state.schemaPreviewData = result;
        var rows = result.rows || [];
        var headers = result.headers || [];
        var counts = result.counts || [];
        var totalRows = result.totalRows || 0;
        schemaPreviewInfo.textContent = '共 ' + totalRows + ' 行，' + headers.length + ' 列';
        updateFieldCounts(counts);
        renderModalPreviewTable(result);
      }).catch(function(e) {
        schemaPreviewInfo.textContent = '';
        resetFieldCounts();
      });
    }, 300); // 300ms 防抖
  }

  function resetFieldCounts() {
    var rows = schemaFieldsList.querySelectorAll('.schema-field-row:not(.schema-field-header-row)');
    rows.forEach(function(row) {
      var span = row.querySelector('.schema-field-count-val');
      if (span) span.textContent = '-';
    });
  }

  /** 根据字段名查找树节点路径 */
  function _findFieldNodePath(name) {
    function _search(segments, basePath) {
      for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        var exts = seg.extractions || [];
        for (var j = 0; j < exts.length; j++) {
          if ((exts[j].name || exts[j].attr) === name) {
            return basePath.concat([i]);
          }
        }
        // 递归子链路
        var subs = seg.subChains || [];
        for (var s = 0; s < subs.length; s++) {
          var scSegs = subs[s].chainSegments || [];
          var found = _search(scSegs, basePath.concat([i, s]));
          if (found) return found;
        }
      }
      return null;
    }
    return _search(Parser.state.chainSegments || [], []);
  }

  function renderModalPreviewTable(result, showAll) {
    if (!schemaPreviewWrap) return;
    var rows = result.rows || [];
    var headers = result.headers || [];
    // 过滤内部列
    var allHeaders = headers.filter(function(h) { return h !== '来源URL' && h.charAt(0) !== '_'; });
    var limit = showAll ? rows.length : Math.min(rows.length, 5);
    var html = '<table class="schema-preview-table"><thead><tr><th style="width:30px">#</th>';
    allHeaders.forEach(function(h, hi) {
      html += '<th draggable="true" data-col-idx="' + hi + '" class="draggable-col"><span class="col-grip">⠿</span> ' + escapeHtml(h) + '</th>';
    });
    html += '</tr></thead><tbody>';
    for (var r = 0; r < limit; r++) {
      html += '<tr><td style="color:var(--text-dim);font-size:11px">' + (r + 1) + '</td>';
      allHeaders.forEach(function(h) {
        var val = rows[r][h] || '';
        html += '<td' + (val === '' ? ' class="empty-cell"' : '') + '>' + escapeHtml(val.length > 80 ? val.substring(0, 80) + '...' : val) + '</td>';
      });
      html += '</tr>';
    }
    if (rows.length > limit) {
      html += '<tr><td colspan="' + (allHeaders.length + 1) + '" style="text-align:center;padding:6px"><button onclick="window._showAllPreviewRows()" style="font-size:11px;padding:2px 16px;border:1px solid var(--border);border-radius:3px;background:var(--bg-card);color:var(--accent);cursor:pointer;font-family:inherit">加载全部 ' + rows.length + ' 行</button></td></tr>';
    }
    html += '</tbody></table>';
    schemaPreviewWrap.innerHTML = html;
    // 绑定拖拽排序
    var ths = schemaPreviewWrap.querySelectorAll('.draggable-col');
    var dragSrc = null, dragCols = [];
    ths.forEach(function(th) {
      // Ctrl+点击表头 → 跳转到树中对应节点
      th.addEventListener('click', function(e) {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        var name = this.textContent.replace('⠿', '').trim();
        var path = _findFieldNodePath(name);
        if (path) {
          // 展开路径上所有折叠点
          for (var pi = 1; pi < path.length; pi++) {
            _expandedChains[JSON.stringify(path.slice(0, pi))] = true;
          }
          selectChainTreeNode(path);
        }
      });
      th.addEventListener('dragstart', function(e) {
        dragSrc = this;
        var from = parseInt(this.dataset.colIdx);
        e.dataTransfer.effectAllowed = 'move';
        this.classList.add('dragging');
        // 高亮源列所有单元格
        dragCols = schemaPreviewWrap.querySelectorAll('td:nth-child(' + (from + 2) + '),th:nth-child(' + (from + 2) + ')');
        dragCols.forEach(function(c) { c.classList.add('col-drag-src'); });
      });
      th.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.classList.add('drag-over');
      });
      th.addEventListener('dragleave', function() { this.classList.remove('drag-over'); });
      th.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        dragSrc.classList.remove('dragging');
        dragCols.forEach(function(c) { c.classList.remove('col-drag-src'); });
        if (!dragSrc || dragSrc === this) return;
        var from = parseInt(dragSrc.dataset.colIdx) + 1; // +1 for # column
        var to = parseInt(this.dataset.colIdx) + 1;
        if (from === to) return;
        // 移动表头
        var theadRow = schemaPreviewWrap.querySelector('thead tr');
        var fromTH = theadRow.children[from];
        var toTH = theadRow.children[to];
        if (from < to) {
          theadRow.insertBefore(fromTH, toTH.nextSibling);
        } else {
          theadRow.insertBefore(fromTH, toTH);
        }
        // 移动每行数据单元格
        schemaPreviewWrap.querySelectorAll('tbody tr').forEach(function(tr) {
          var cells = tr.children;
          if (cells.length <= Math.max(from, to)) return;
          var fromTD = cells[from];
          var toTD = cells[to];
          if (from < to) {
            tr.insertBefore(fromTD, toTD.nextSibling);
          } else {
            tr.insertBefore(fromTD, toTD);
          }
        });
        // 重排 headers 数组和数据
        var h = headers.splice(from - 1, 1)[0];
        headers.splice(to - 1, 0, h);
        rows.forEach(function(row) {
          var keys = Object.keys(row);
          var vals = keys.map(function(k) { return row[k]; });
          var v = vals.splice(from - 1, 1)[0];
          vals.splice(to - 1, 0, v);
          keys.forEach(function(k, i) { delete row[k]; });
          keys.forEach(function(k, i) { row[k] = vals[i]; });
        });
        result.headers = headers;
        // 更新 data-col-idx
        schemaPreviewWrap.querySelectorAll('.draggable-col').forEach(function(th2, i) {
          th2.dataset.colIdx = i;
        });
        _syncFieldOrderFromHeaders(headers);
      });
      th.addEventListener('dragend', function() {
        this.classList.remove('dragging');
        dragCols.forEach(function(c) { c.classList.remove('col-drag-src'); });
        ths.forEach(function(t) { t.classList.remove('drag-over'); });
      });
    });
  }
  /** 发送调试日志到后端黑窗 */
  function _debugLog(msg) {
    try {
      fetch('http://127.0.0.1:' + (Parser.state.pythonPort || 19527) + '/api/debug', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({msg: msg})
      }).catch(function(){});
    } catch(e) {}
  }
  window._showAllPreviewRows = function() {
    if (Parser.state.schemaPreviewData) renderModalPreviewTable(Parser.state.schemaPreviewData, true);
  };
  /** 切换多方案合并模式：横向/纵向 */
  window._toggleChainMergeMode = function(vertical) {
    Parser.state._chainMergeMode = vertical ? 'vertical' : 'horizontal';
    _renderMergeModeToggle();
    var checked = (Parser.state.chainSchemes || []).filter(function(s) { return s.checked !== false; });
    if (checked.length >= 2) _fetchChainDataFromDB(checked);
  };
  /** 在预览标题栏渲染合并模式 toggle */
  function _renderMergeModeToggle() {
    var el = document.getElementById('mergeModeToggle');
    if (!el) return;
    var checked = (Parser.state.chainSchemes || []).filter(function(s) { return s.checked !== false; });
    if (checked.length < 2) { el.innerHTML = ''; return; }
    var isH = Parser.state._chainMergeMode !== 'vertical';
    el.innerHTML = '<span style="color:var(--text-dim);font-size:11px;margin:0 4px 0 12px">合并</span>' +
      '<label class="toggle-switch" style="margin:0;vertical-align:middle" title="横向：按链接列匹配合并列；纵向：追加行堆叠">' +
        '<input type="checkbox" id="chainMergeModeToggle"' + (isH ? '' : ' checked') + ' onchange="window._toggleChainMergeMode(this.checked)">' +
        '<span class="toggle-slider"></span>' +
      '</label>' +
      '<span style="color:var(--accent);font-weight:600;font-size:11px;margin-left:4px">' + (isH ? '横向' : '纵向') + '</span>';
  }
  /** 根据预览表头顺序同步重排 schema fields */
  function _syncFieldOrderFromHeaders(headers) {
    if (Parser.state.schemaMode === 'chain') {
      // 保存 header 顺序供 buildChainSchema 使用
      Parser.state._chainHeaderOrder = headers.slice();
      return;
    } else {
      // 手动模式：重排 Parser.state.schemaFields
      var newOrder = [];
      headers.forEach(function(h) {
        for (var i = 0; i < Parser.state.schemaFields.length; i++) {
          var fName = Parser.state.schemaFields[i].name || Parser.state.schemaFields[i].attr || ('字段' + (i + 1));
          if (fName === h && newOrder.indexOf(Parser.state.schemaFields[i]) < 0) {
            newOrder.push(Parser.state.schemaFields[i]);
          }
        }
      });
      // 补回未匹配的
      Parser.state.schemaFields.forEach(function(f) {
        if (newOrder.indexOf(f) < 0) newOrder.push(f);
      });
      Parser.state.schemaFields = newOrder;
      renderSchemaFields();
    }
  }

  /** 从 UI 同步字段数据到 Parser.state.schemaFields 数组 */
  function syncFieldsFromUI() {
    var newFields = [];
    var rows = schemaFieldsList.querySelectorAll('.schema-field-row:not(.schema-field-header-row)');
    rows.forEach(function(row) {
      var typeTab = row.querySelector('.schema-type-tab.active');
      var type = typeTab ? typeTab.dataset.type : 'css';
      var selector = (row.querySelector('.sel-input') || {}).value || '';
      var attr = (row.querySelector('.attr-input') || {}).value || '';
      var name = (row.querySelector('.name-input') || {}).value || '';
      newFields.push({ type: type, selector: selector, attr: attr, name: name });
    });
    Parser.state.schemaFields = newFields;
  }

  /** 添加字段 */
  function addSchemaField() {
    syncFieldsFromUI();
    Parser.state.schemaFields.push({ type: 'css', selector: '', attr: '', name: '' });
    renderSchemaFields();
  }

  /** 删除字段 */
  function removeSchemaField(index) {
    syncFieldsFromUI();
    if (Parser.state.schemaFields.length <= 1) {
      Parser.state.schemaFields = [{ type: 'css', selector: '', attr: '', name: '' }];
    } else {
      Parser.state.schemaFields.splice(index, 1);
    }
    renderSchemaFields();
  }

  /** 在 webview 中执行提取并返回结果（内联引擎，不依赖 preload） */
  async function executeExtraction(schema) {
    var fields = schema.fields.filter(function(f) { return f.selector && f.selector.trim(); });
    if (fields.length === 0) return null;

    var delimiter = Parser.state.globalMultiDelim;
    var childDelimiter = Parser.state.globalChildDelim;
    var fieldsJson = JSON.stringify(fields);

    // 完整内联提取引擎，适配 contextIsolation 环境
    var jsCode =
      '(function(){' +
        'function cleanText(s){' +
          'if(!s)return "";' +
          's=String(s);' +
          's=s.replace(/\\p{Zs}/gu," ");' +
          's=s.replace(/\\p{Zl}/gu," ");' +
          's=s.replace(/\\p{Zp}/gu," ");' +
          's=s.replace(/\\p{Cf}/gu,"");' +
          's=s.replace(/[\\u0000-\\u0008\\u000E-\\u001F\\u007F-\\u009F]/g,"");' +
          's=s.replace(/[\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}\\uFFFE\\uFFFF]/gu,"");' +
          's=s.replace(/\\s+/g," ").trim();' +
          'return s;' +
        '}' +
        'function getChildText(el,childDelim){' +
          'if(!el)return "";' +
          'if(!childDelim)return cleanText(el.textContent);' +
          'var parts=[];' +
          'var child=el.firstChild;' +
          'while(child){' +
            'var t;' +
            'if(child.nodeType===3){t=cleanText(child.textContent);}' +
            'else if(child.nodeType===1){t=cleanText(child.textContent);}' +
            'else{t="";}' +
            'if(t)parts.push(t);' +
            'child=child.nextSibling;' +
          '}' +
          'return parts.join(childDelim);' +
        '}' +
        'var fields=' + fieldsJson + ';' +
        'var delimiter=' + JSON.stringify(delimiter) + ';' +
        'var childDelimiter=' + JSON.stringify(childDelimiter) + ';' +
        'var columns=[];' +
        'var maxLen=0;' +
        'try{' +
          'for(var fi=0;fi<fields.length;fi++){' +
            'var f=fields[fi];' +
            'var values=[];' +
            'if(f.type==="css"){' +
              'var sel=f.selector;' +
              'var attrName=f.attr||null;' +
              // 也支持选择器后缀 @attr 语法（attr 字段为空时作为降级）
              'if(!attrName){var m=sel.match(/@([\\w-]+)$/);if(m){attrName=m[1];sel=sel.substring(0,m.index).trim();}}' +
              'try{' +
                'var els=document.querySelectorAll(sel);' +
                'for(var j=0;j<els.length;j++){' +
                  'var v;' +
                  'if(attrName){' +
                    'v=els[j].getAttribute(attrName);' +
                    'if((v===null||v===undefined)&&(attrName in els[j]))v=els[j][attrName];' +
                    'if(v===null||v===undefined)v="";' +
                  '}else{v=getChildText(els[j],childDelimiter);}' +
                  'values.push(v);' +
                '}' +
              '}catch(e){}' +
            '}else if(f.type==="xpath"){' +
              'try{' +
                'var attrName=f.attr||null;' +
                'var result=document.evaluate(f.selector,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);' +
                'for(var k=0;k<result.snapshotLength;k++){' +
                  'var node=result.snapshotItem(k);' +
                  'var v;' +
                  'if(node.nodeType===2){v=node.value||"";}' +
                  'else if(attrName){' +
                    'v=node.getAttribute?node.getAttribute(attrName):"";' +
                    'if((v===null||v===undefined)&&node[attrName]!==undefined)v=node[attrName];' +
                    'if(v===null||v===undefined)v="";' +
                  '}else{v=getChildText(node,childDelimiter);}' +
                  'values.push(v);' +
                '}' +
              '}catch(e){}' +
            '}else if(f.type==="chain"){' +
              'try{' +
                'var fullSel=f.selector;' +
                'var walkUp=(f.nSegments||1)-1-(f.chainIndex||0);' +
                'var attrName=f.attr||null;' +
                'var isText=f.isText||false;' +
                'var subChain=f.subChain||null;' +
                'var chainType=f.chainType||"css";' +
                'var els=[];' +
                'if(chainType==="xpath"){' +
                  'var snap=document.evaluate(fullSel,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);' +
                  'for(var kx=0;kx<snap.snapshotLength;kx++){var n=snap.snapshotItem(kx);if(n.nodeType===1)els.push(n);}' +
                '}else{' +
                  'try{var qs=document.querySelectorAll(fullSel);for(var kq=0;kq<qs.length;kq++)els.push(qs[kq]);}catch(e){}' +
                '}' +
                'for(var j=0;j<els.length;j++){' +
                  'var target=els[j];' +
                  'for(var up=0;up<walkUp;up++){' +
                    'target=target.parentElement;' +
                    'if(!target)break;' +
                  '}' +
                  // 子链路：从祖先节点内部查找子元素，再 walkUp
                  'if(target&&subChain){' +
                    'try{' +
                      'var subType=subChain.chainType||"css";' +
                      'var subSels=[];' +
                      'if(subType==="xpath"){' +
                        'var ss=document.evaluate(subChain.selector,target,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);' +
                        'for(var sx=0;sx<ss.snapshotLength;sx++){var sn=ss.snapshotItem(sx);if(sn.nodeType===1)subSels.push(sn);}' +
                      '}else{' +
                        'try{var sqs=target.querySelectorAll(subChain.selector);for(var sq=0;sq<sqs.length;sq++)subSels.push(sqs[sq]);}catch(e){}' +
                      '}' +
                      'if(subSels.length>0){' +
                        'var subTarget=subSels[0];' +
                        'var subWalkUp=subChain.chainIndex||0;' +
                        'for(var su=0;su<subWalkUp;su++){' +
                          'subTarget=subTarget.parentElement;' +
                          'if(!subTarget)break;' +
                        '}' +
                        'target=subTarget||target;' +
                      '}' +
                    '}catch(e){}' +
                  '}' +
                  'var v;' +
                  'if(target){' +
                    'if(isText||!attrName){' +
                      'v=getChildText(target,childDelimiter);' +
                    '}else{' +
                      'v=target.getAttribute(attrName);' +
                      'if((v===null||v===undefined)&&(attrName in target))v=target[attrName];' +
                      'if(v===null||v===undefined)v="";' +
                    '}' +
                  '}else{v="";}' +
                  'values.push(v);' +
                '}' +
              '}catch(e){}' +
            '}' +
            'columns.push(values);' +
            'if(values.length>maxLen)maxLen=values.length;' +
          '}' +
          'var rows=[];' +
          'for(var r=0;r<maxLen;r++){' +
            'var row2={};' +
            'for(var c=0;c<fields.length;c++){' +
              'var val=columns[c][r];' +
              'var key2=fields[c].name||("字段"+(c+1));' +
              'row2[key2]=(val!==undefined&&val!==null)?String(val):"";' +
            '}' +
            'rows.push(row2);' +
          '}' +
          'return {rows:rows,counts:columns.map(function(c){return c.length;}),totalRows:maxLen,headers:fields.map(function(f,i){return f.name||("字段"+(i+1));})};' +
        '}catch(e){' +
          'return {error:"提取执行失败: "+e.message};' +
        '}' +
      '})()';

    try {
      var result = await webview.executeJavaScript(jsCode);
      return result;
    } catch (e) {
      return { error: '执行提取失败: ' + e.message };
    }
  }

  /** 预览提取结果 — 关闭弹窗，在界面中间内容区展示 */
  async function previewSchema() {
    syncFieldsFromUI();
    var schema = buildSchemaFromUI();
    var fields = schema.fields.filter(function(f) { return f.selector && f.selector.trim(); });
    if (fields.length === 0) {
      setStatus('请至少填入一个选择器');
      return;
    }

    setStatus('正在提取数据...');
    var result = await executeExtraction(schema);
    if (!result || result.error) {
      alert('提取失败: ' + ((result && result.error) || '未知错误'));
      setStatus('提取失败');
      return;
    }

    Parser.state.schemaPreviewData = result;
    var rows = result.rows || [];
    var headers = result.headers || [];
    var totalRows = result.totalRows || 0;

    // 关闭弹窗
    closeSchemaModal();

    // 在内容区中间展示
    hideAllPanels();
    queryContainer.classList.remove('hidden');
    contentTitle.textContent = '自定义导出预览 (' + (Parser.state.schemaCurrentName || '未命名') + ') — ' + totalRows + ' 行 ' + headers.length + ' 列';
    contentEmpty.classList.add('hidden');

    // 隐藏查询输入行，保留工具栏（全选/搜索/导出勾选）
    var inputRow = queryContainer.querySelector('.query-input-row');
    if (inputRow) inputRow.style.display = 'none';
    var toolbar = queryContainer.querySelector('.query-toolbar');
    if (toolbar) toolbar.style.display = '';

    // 显示导出操作区（在内容标题右侧）
    renderSchemaExportActions(headers);

    // 用 result-table 渲染全部数据（支持勾选导出）
    Parser.state.queryResults = rows;
    renderQueryTable(rows);
    setStatus('提取完成: ' + totalRows + ' 行');
  }

  /** 格式选择弹框 */
  function showExportFormatPicker(headers, isQueryExport) {
    var existing = document.getElementById('exportFormatModal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'exportFormatModal';
    modal.className = 'modal-overlay';
    modal.addEventListener('mousedown', function(e) { if (e.target === modal) modal.remove(); });

    var formats = [
      { v: 'xlsx', label: '📊 Excel (.xlsx)' },
      { v: 'csv', label: '📄 CSV (.csv)' },
      { v: 'json', label: '📋 JSON (.json)' },
      { v: 'html', label: '🌐 HTML (.html)' },
      { v: 'md', label: '📝 Markdown (.md)' },
    ];

    var html = '<div class="modal-box" style="width:320px"><div class="modal-header"><span class="modal-title">选择导出格式</span><button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()">\u00d7</button></div><div class="modal-body" style="display:flex;flex-direction:column;gap:6px;padding:16px">';
    formats.forEach(function(fmt) {
      html += '<button class="btn" style="justify-content:flex-start;padding:10px 14px;font-size:13px" data-fmt="' + fmt.v + '">' + fmt.label + '</button>';
    });
    html += '</div></div>';
    modal.innerHTML = html;
    document.body.appendChild(modal);

    modal.querySelectorAll('[data-fmt]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        modal.remove();
        if (isQueryExport) {
          exportQueryData(this.dataset.fmt);
        } else {
          exportSchemaDataSingle(this.dataset.fmt, headers);
        }
      });
    });
  }

  /** query 面板导出勾选 */
  function exportQueryData(format) {
    var checked = [];
    $$('.result-checkbox:checked').forEach(function(cb) {
      var tr = cb.closest('tr');
      if (tr && !isNaN(parseInt(tr.dataset.row))) checked.push(Parser.state.queryResults[parseInt(tr.dataset.row)]);
    });
    if (checked.length === 0) { setStatus('请先勾选要导出的行'); return; }
    setStatus('正在导出 ' + format + '...');
    fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/export/excel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: checked, format: format }),
    }).then(function(r) { return r.json(); }).then(async function(result) {
      if (result.ok && result.data) {
        var extMap = { xlsx: 'xlsx', csv: 'csv', json: 'json', html: 'html', md: 'md' };
        var ext = extMap[format] || 'xlsx';
        var dr = await window.api.showSaveDialog({ title: '导出', defaultPath: 'export.' + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
        if (!dr.canceled && dr.filePath) {
          await window.api.saveFile(dr.filePath, result.data);
          setStatus('已导出到: ' + dr.filePath);
        }
      }
    }).catch(function(err) { setStatus('导出失败: ' + err.message); });
  }

  /** 在 contentActions 中显示导出格式按钮 */
  function renderSchemaExportActions(headers) {
    var actionsEl = document.getElementById('contentActions');
    if (!actionsEl) return;
    actionsEl.innerHTML = '';
    actionsEl.style.display = 'flex';
    actionsEl.style.gap = '4px';

    var btnExport = document.createElement('button');
    btnExport.className = 'btn btn-sm btn-accent';
    btnExport.textContent = '导出...';
    btnExport.addEventListener('click', function() {
      showExportFormatPicker(headers, false);
    });
    actionsEl.appendChild(btnExport);

    // 返回编辑按钮
    var btnEdit = document.createElement('button');
    btnEdit.className = 'btn btn-sm';
    btnEdit.textContent = '编辑方案';
    btnEdit.addEventListener('click', function() {
      var inputRow = queryContainer.querySelector('.query-input-row');
      if (inputRow) inputRow.style.display = '';
      var toolbar = queryContainer.querySelector('.query-toolbar');
      if (toolbar) toolbar.style.display = '';
      actionsEl.innerHTML = '';
      actionsEl.style.display = '';
      openSchemaModal();
    });
    actionsEl.appendChild(btnEdit);
  }

  /** 单格式导出（用于内容区按钮） */
  async function exportSchemaDataSingle(format, headers) {
    if (!Parser.state.schemaPreviewData || !Parser.state.schemaPreviewData.rows || Parser.state.schemaPreviewData.rows.length === 0) {
      setStatus('没有可导出的数据');
      return;
    }
    var rows = Parser.state.schemaPreviewData.rows;
    var hdrs = headers || Parser.state.schemaPreviewData.headers || [];

    setStatus('正在导出 ' + format + '...');
    try {
      if (format === 'xlsx') {
        await exportAsExcel(rows, hdrs);
      } else if (format === 'csv') {
        await exportAsText(generateCSV(rows, hdrs), 'csv', 'CSV 文件');
      } else if (format === 'json') {
        await exportAsText(generateJSON(rows), 'json', 'JSON 文件');
      } else if (format === 'html') {
        await exportAsText(generateHTMLTable(rows, hdrs), 'html', 'HTML 文件');
      } else if (format === 'md') {
        await exportAsText(generateMarkdown(rows, hdrs), 'md', 'Markdown 文件');
      }
    } catch (e) {
      setStatus(format + ' 导出失败: ' + e.message);
    }
  }

  /** 更新字段行的匹配数显示 */
  function updateFieldCounts(counts) {
    if (!counts) return;
    var rows = schemaFieldsList.querySelectorAll('.schema-field-row:not(.schema-field-header-row)');
    rows.forEach(function(row, i) {
      var span = row.querySelector('.schema-field-count-val');
      if (span && i < counts.length) {
        span.textContent = counts[i];
      }
    });
  }

  /** 生成 CSV 文本 */
  function generateCSV(rows, headers) {
    var lines = [];
    lines.push(headers.map(function(h) { return csvEscape(h); }).join(','));
    rows.forEach(function(row) {
      lines.push(headers.map(function(h) {
        return csvEscape(row[h] !== undefined ? String(row[h]) : '');
      }).join(','));
    });
    return '\uFEFF' + lines.join('\n'); // BOM for Excel UTF-8
  }

  function csvEscape(val) {
    if (val.indexOf(',') >= 0 || val.indexOf('"') >= 0 || val.indexOf('\n') >= 0) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  }

  /** 生成 JSON 文本 */
  function generateJSON(rows) {
    return JSON.stringify(rows, null, 2);
  }

  /** 生成 Markdown 表格 */
  function generateMarkdown(rows, headers) {
    var md = '| ' + headers.map(function(h) { return escapeHtml(h); }).join(' | ') + ' |\n';
    md += '| ' + headers.map(function() { return '---'; }).join(' | ') + ' |\n';
    rows.forEach(function(row) {
      md += '| ' + headers.map(function(h) {
        var v = row[h] !== undefined ? String(row[h]) : '';
        return v.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      }).join(' | ') + ' |\n';
    });
    return md;
  }

  /** 生成 HTML 表格 */
  function generateHTMLTable(rows, headers) {
    var html = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n';
    html += '<title>导出数据</title>\n';
    html += '<style>\n';
    html += 'body{font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;margin:20px;color:#333}\n';
    html += 'table{border-collapse:collapse;width:100%}\n';
    html += 'th{background:#7c5cfc;color:#fff;padding:10px 12px;text-align:left;border:1px solid #6a4de6}\n';
    html += 'td{padding:8px 12px;border:1px solid #ddd}\n';
    html += 'tr:nth-child(even){background:#f7f7f7}\n';
    html += '</style>\n</head>\n<body>\n';
    html += '<table>\n<thead>\n<tr>\n';
    headers.forEach(function(h) {
      html += '<th>' + escapeHtml(h) + '</th>\n';
    });
    html += '</tr>\n</thead>\n<tbody>\n';
    rows.forEach(function(row) {
      html += '<tr>\n';
      headers.forEach(function(h) {
        html += '<td>' + escapeHtml(row[h] !== undefined ? String(row[h]) : '') + '</td>\n';
      });
      html += '</tr>\n';
    });
    html += '</tbody>\n</table>\n</body>\n</html>';
    return html;
  }

  /** 保存并导出：执行提取 → 弹框选格式导出 */
  async function exportSchemaData() {
    syncFieldsFromUI();
    var schema = buildSchemaFromUI();
    var fields = schema.fields.filter(function(f) { return f.selector && f.selector.trim(); });
    if (fields.length === 0) {
      setStatus('请至少填入一个选择器');
      return;
    }

    // 执行提取
    setStatus('正在提取数据...');
    Parser.state.schemaPreviewData = await executeExtraction(schema);

    if (!Parser.state.schemaPreviewData || Parser.state.schemaPreviewData.error) {
      setStatus('提取失败: ' + ((Parser.state.schemaPreviewData && Parser.state.schemaPreviewData.error) || '未知错误'));
      return;
    }

    // 关闭 schema 弹框，弹格式选择
    var m = document.getElementById('schemaModal');
    if (m) m.classList.add('hidden');
    showExportFormatPicker(Parser.state.schemaPreviewData.headers || [], false);
  }

  /** 导出为 Excel (通过 Python 后端) */
  async function exportAsExcel(rows, headers) {
    // 将 row objects 转换为带顺序的数组以便后端处理
    var resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rows, format: 'xlsx', headers: headers })
    });
    var result = await resp.json();
    if (result.ok && result.data) {
      var dr = await window.api.showSaveDialog({
        title: '导出 Excel',
        defaultPath: 'export.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      });
      if (!dr.canceled && dr.filePath) {
        await window.api.saveFile(dr.filePath, result.data);
        setStatus('已导出 Excel: ' + dr.filePath);
      }
    }
  }

  /** 导出为文本文件 */
  async function exportAsText(content, ext, desc) {
    var dr = await window.api.showSaveDialog({
      title: '导出 ' + desc,
      defaultPath: 'export.' + ext,
      filters: [{ name: desc, extensions: [ext] }]
    });
    if (!dr.canceled && dr.filePath) {
      var base64 = Parser.utils.toBase64(content);
      await window.api.saveFile(dr.filePath, base64);
      setStatus('已导出 ' + desc + ': ' + dr.filePath);
    }
  }

  /** 打开自定义导出弹窗 */
  function openSchemaModal() {
    refreshSchemaList();
    if (Parser.state.schemaFields.length === 0) {
      Parser.state.schemaFields = [{ type: 'css', selector: '', attr: '', name: '' }];
    }
    schemaName.value = Parser.state.schemaCurrentName || '';

    // 保留上次预览数据和链路结构（防丢失）
    var hasChainData = Parser.state.chainSegments && Parser.state.chainSegments.length > 0;
    // 备份恢复：当前丢失但从备份可恢复
    if (!hasChainData && Parser.state._chainSegmentsBackup && Parser.state._chainSegmentsBackup.length > 0) {
      Parser.state.chainSegments = JSON.parse(JSON.stringify(Parser.state._chainSegmentsBackup));
      hasChainData = true;
    }
    // 有链路数据但模式不对 → 自动切到链路
    if (hasChainData && Parser.state.schemaMode !== 'chain') {
      Parser.state.schemaMode = 'chain';
      schemaTabManual.classList.toggle('active', false);
      schemaTabChain.classList.toggle('active', true);
      schemaManualPanel.classList.toggle('hidden', true);
      schemaChainPanel.classList.toggle('hidden', false);
    }
    Parser.state.schemaPreviewData = null;
    if (Parser.state.schemaMode === 'chain') {
      Parser.state._selectedChainPath = null;
      _expandedChains = {};
      Parser.state._chainHeaderOrder = null;
      _updateChainModeByCheckCount();  // 恢复面板可见性
      // 有链路数据 → 直接触发预览
      if (hasChainData) {
        setTimeout(function() { autoRefreshChainPreview(); }, 100);
      }
    } else {
      renderSchemaFields();
      autoRefreshPreview();
    }
    schemaModal.classList.remove('hidden');
    // 刷新剪贴板面板（显示子链路提示）
    renderClipboardPanel();
    _refreshExportLinksBtn();
  }

  /** 关闭弹窗 */
  function closeSchemaModal() {
    schemaModal.classList.add('hidden');
    // 刷新剪贴板面板（隐藏子链路提示）
    renderClipboardPanel();
  }

  // ──────── 导出链接到批量 ────────
  function _refreshExportLinksBtn() {
    var row = document.getElementById('schemaSecondaryRow');
    var linkSel = document.getElementById('secLinkCol');
    var schemeSel = document.getElementById('secScheme');
    if (!row || !linkSel || !schemeSel) return;
    // 从快速预览取列名
    var preview = Parser.state.schemaPreviewData;
    var headers = preview && preview.headers ? preview.headers.filter(function(k) { return k !== '来源URL' && k.charAt(0) !== '_'; }) : [];
    if (headers.length === 0) { row.style.display = 'none'; return; }
    row.style.display = 'flex';
    // 填充链接列下拉
    var current = linkSel.value;
    linkSel.innerHTML = '<option value="">链接列</option>';
    headers.forEach(function(k) {
      var isLink = /链接|url|href/i.test(k);
      var sel = (k === current || (!current && isLink)) ? ' selected' : '';
      linkSel.innerHTML += '<option value="' + k + '"' + sel + '>' + k + '</option>';
    });
    // 填充方案下拉
    var currentScheme = schemeSel.value;
    var schemes = Parser.state.chainSchemes || [];
    schemeSel.innerHTML = '<option value="">方案</option>';
    schemes.forEach(function(s) {
      var sel = (s.name === currentScheme) ? ' selected' : '';
      schemeSel.innerHTML += '<option value="' + escapeHtml(s.name) + '"' + sel + '>' + escapeHtml(s.name) + '</option>';
    });
  }

  function _bindExportLinksBtn() {
    var btn = document.getElementById('btnExportLinks');
    if (!btn || btn._bound) return;
    btn._bound = true;
    // 方案下拉切换 → 加载方案到编辑器
    var schemeSel = document.getElementById('secScheme');
    if (schemeSel) {
      schemeSel.addEventListener('change', function() {
        var name = this.value;
        if (!name) return;
        var schemes = Parser.state.chainSchemes || [];
        var idx = schemes.findIndex(function(s) { return s.name === name; });
        if (idx >= 0) {
          chainLoadScheme(idx);
          var linkSel = document.getElementById('secLinkCol');
          if (linkSel) linkSel.value = '';
          setTimeout(function() { 
            autoRefreshChainPreview(); 
            setTimeout(function() { _refreshExportLinksBtn(); }, 500);
          }, 200);
        }
      });
    }
    // 链接列下拉切换 → 重触发合并预览
    var linkSel2 = document.getElementById('secLinkCol');
    if (linkSel2 && !linkSel2._boundChange) {
      linkSel2._boundChange = true;
      linkSel2.addEventListener('change', function() {
        var schemes = Parser.state.chainSchemes || [];
        var checked = schemes.filter(function(s) { return s.checked !== false; });
        if (checked.length >= 2) {
          _fetchChainDataFromDB(checked);
        }
      });
    }
    btn.addEventListener('click', function() {
      var linkCol = document.getElementById('secLinkCol').value;
      if (!linkCol) { setStatus('请选择链接列'); return; }
      // 存储到当前方案，合并时自动使用
      var schemes = Parser.state.chainSchemes || [];
      var checked = schemes.filter(function(s) { return s.checked !== false; });
      if (checked.length === 1 && checked[0].schema) {
        checked[0].schema._exportLinkCol = linkCol;
        saveChainSchemesToStorage();
        _debugLog('[导出] 方案 ' + checked[0].name + ' _exportLinkCol = ' + linkCol);
      }
      var preview = Parser.state.schemaPreviewData;
      if (!preview || !preview.rows || preview.rows.length === 0) { setStatus('快速预览无数据，请先解析链路'); return; }
      var urls = preview.rows.map(function(r) { return (r[linkCol] || '').trim(); }).filter(function(u) { return u && /^https?:\/\//.test(u); });
      if (urls.length === 0) { setStatus('没有有效URL'); return; }
      var batchArea = document.getElementById('batchUrlList');
      if (batchArea) {
        batchArea.value = urls.join('\n');
        var batchPanel = document.getElementById('batchTagsPanel');
        if (batchPanel) batchPanel.classList.remove('hidden');
      }
      setStatus('已导出 ' + urls.length + ' 个链接到批量面板');
    });
  }

  /** Tab 切换 */
  function switchSchemaTab(mode) {
    var prevMode = Parser.state.schemaMode;
    Parser.state.schemaMode = mode;
    schemaTabManual.classList.toggle('active', mode === 'manual');
    schemaTabChain.classList.toggle('active', mode === 'chain');
    schemaManualPanel.classList.toggle('hidden', mode !== 'manual');
    schemaChainPanel.classList.toggle('hidden', mode !== 'chain');
    // 切到链路 tab 时刷新方案列表
    if (mode === 'chain') { refreshChainSchemeSelect(); _updateChainModeByCheckCount(); }
    // 只在模式切换时清除预览（同模式保留上次数据）
    if (prevMode !== mode) {
      Parser.state.schemaPreviewData = null;
      if (schemaPreviewWrap) schemaPreviewWrap.innerHTML = '<div class="tree-empty">输入选择器后自动预览</div>';
      if (schemaPreviewInfo) schemaPreviewInfo.textContent = '';
    }
  }

  /** 链路方案管理 */
  if (!Parser.state.chainSchemes) Parser.state.chainSchemes = [];
  Parser.state._editingChainSchemeIdx = null;  // 当前编辑的方案索引，null=新建模式
  Parser.state._chainMergeMode = 'horizontal';  // 多方案合并模式: horizontal 或 vertical

  function _chainSchemesKey() { return 'chainSchemes'; }

  function loadChainSchemesFromStorage() {
    // 纯内存，不从 localStorage 加载
    if (!Parser.state.chainSchemes) Parser.state.chainSchemes = [];
  }

  function saveChainSchemesToStorage() {
    // 纯内存，不写 localStorage
  }

  function refreshChainSchemeSelect() {
    var triggerText = document.getElementById('chainSchemeTriggerText');
    var optsEl = document.getElementById('chainSchemeOptions');
    var schemes = Parser.state.chainSchemes || [];
    if (!triggerText || !optsEl) return;
    if (schemes.length === 0) {
      triggerText.textContent = '暂无方案';
      optsEl.innerHTML = '';
      return;
    }
    var checkedNames = schemes.filter(function(s) { return s.checked !== false; }).map(function(s) { return s.name; });
    triggerText.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0">' + (checkedNames.length > 0 ? checkedNames.join(', ') : '选择方案') + '</span>';

    var html = '';
    schemes.forEach(function(s, i) {
      html += '<label class="chain-custom-option">';
      html += '<input type="checkbox"' + (s.checked !== false ? ' checked' : '') + ' data-idx="' + i + '">';
      html += '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(s.name) + '</span>';
      html += '<span class="chain-custom-option-del" data-idx="' + i + '" title="删除方案">×</span>';
      html += '</label>';
    });
    optsEl.innerHTML = html;
    optsEl.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var idx = parseInt(this.dataset.idx);
        if (Parser.state.chainSchemes[idx]) {
          Parser.state.chainSchemes[idx].checked = this.checked;
          saveChainSchemesToStorage();
          refreshChainSchemeSelect();
          _updateChainModeByCheckCount();
        }
      });
    });
    // 初始检查模式
    _updateChainModeByCheckCount();
    optsEl.querySelectorAll('.chain-custom-option-del').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        var idx = parseInt(this.dataset.idx);
        Parser.state.chainSchemes.splice(idx, 1);
        if (Parser.state._editingChainSchemeIdx === idx) Parser.state._editingChainSchemeIdx = null;
        saveChainSchemesToStorage();
        refreshChainSchemeSelect();
      });
    });
  }

  function _updateChainModeByCheckCount() {
    var schemes = Parser.state.chainSchemes || [];
    var checked = schemes.filter(function(s) { return s.checked !== false; });
    var treePanel = document.getElementById('chainTreePanel');
    var editorPanel = document.getElementById('chainEditorPanel');
    var divider = document.getElementById('chainSplitDivider');
    var configRow = document.querySelector('#schemaChainPanel .schema-chain-config');
    var traceResult = document.getElementById('chainTraceResult');

    if (checked.length >= 2) {
      // 保存当前编辑器修改到方案，再进入合并视图
      var prevIdx2 = Parser.state._editingChainSchemeIdx;
      if (prevIdx2 != null && prevIdx2 >= 0 && prevIdx2 < schemes.length && Parser.state.chainSegments && Parser.state.chainSegments.length) {
        var syncSchema2 = buildChainSchema();
        schemes[prevIdx2].schema = syncSchema2;
      }
      if (treePanel) treePanel.style.display = 'none';
      if (editorPanel) editorPanel.style.display = 'none';
      if (divider) divider.style.display = 'none';
      if (configRow) configRow.style.display = 'none';
      if (traceResult) traceResult.classList.add('hidden');
      _resetTraceStripCheckboxes();
      var nameInput = document.getElementById('chainSchemaName');
      if (nameInput) nameInput.value = '';
      Parser.state._editingChainSchemeIdx = null;
      _fetchChainDataFromDB(checked);
    } else if (checked.length === 1) {
      if (treePanel) treePanel.style.display = '';
      if (editorPanel) editorPanel.style.display = '';
      if (divider) divider.style.display = '';
      if (configRow) configRow.style.display = '';
      // 加载前先把当前编辑器的修改同步回来源方案
      var prevIdx = Parser.state._editingChainSchemeIdx;
      if (prevIdx != null && prevIdx >= 0 && prevIdx < schemes.length && Parser.state.chainSegments && Parser.state.chainSegments.length) {
        var syncSchema = buildChainSchema();
        schemes[prevIdx].schema = syncSchema;
      }
      chainLoadScheme(schemes.indexOf(checked[0]));
      // 方案有链路数据才从库查（否则等实时提取）
      var scheme = checked[0].schema;
      if (scheme && scheme.chainSegments && scheme.chainSegments.length) {
        _fetchChainDataFromDB(checked);
      }
    } else {
      // 没有选择方案 → 有上次编辑的链路就保留，否则清空
      var hasChain = Parser.state.chainSegments && Parser.state.chainSegments.length > 0;
      if (hasChain) {
        if (treePanel) treePanel.style.display = '';
        if (editorPanel) editorPanel.style.display = '';
        if (divider) divider.style.display = '';
        if (configRow) configRow.style.display = '';
        if (traceResult) traceResult.classList.add('hidden');
        Parser.state._editingChainSchemeIdx = null;
        _rebuildChainInputWithLimits();  // 全层还原选择器+伪类
        renderChainTree();  // 重新渲染树
      } else {
        if (treePanel) treePanel.style.display = 'none';
        if (editorPanel) editorPanel.style.display = 'none';
        if (divider) divider.style.display = 'none';
        if (configRow) configRow.style.display = 'none';
        if (traceResult) traceResult.classList.add('hidden');
        Parser.state._editingChainSchemeIdx = null;
        if (schemaPreviewWrap) schemaPreviewWrap.innerHTML = '<div class=\"tree-empty\">请选择或新建方案</div>';
        if (schemaPreviewInfo) schemaPreviewInfo.textContent = '';
      }
    }
    _renderMergeModeToggle();
  }

  var _chainFetchAbort = null;  // 防止快速切换竞态
  var _chainInputTimer = null;  // 链路输入框去抖（chainLoadScheme 也需要访问）

  /** 发送日志到 Python 黑窗 */
  function _log(msg) {
    fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg: msg })
    }).catch(function(){});
  }

  /** 重置溯源面板的过滤复选框 */
  function _resetTraceStripCheckboxes() {
    var idCb = document.getElementById('chainStripIdTrace');
    if (idCb) idCb.checked = false;
    var bareCb = document.getElementById('chainStripBareTrace');
    if (bareCb) bareCb.checked = false;
    var randomCb = document.getElementById('chainStripRandomTrace');
    if (randomCb) randomCb.checked = true;
  }

  /** 从方案列表提取数据: ci=0→webview, ci>=1→快照。返回 allResults，支持 signal 取消 */
  async function _extractFromSchemas(checked, signal) {
    var wv = document.getElementById('webview');
    // 获取页面快照列表
    var pageSnapshots = [];
    try {
      var slResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/page-snapshots/list', signal ? { signal: signal } : {});
      if (slResp.ok) {
        var slData = await slResp.json();
        pageSnapshots = slData.snapshots || [];
      }
    } catch(e) {}

    // 快照 HTML 缓存（避免重复拉取）
    if (!Parser.state._snapHtmlCache) Parser.state._snapHtmlCache = {};
    var snapCache = Parser.state._snapHtmlCache;

    var allResults = [];
    for (var ci = 0; ci < checked.length; ci++) {
      var cs = checked[ci];
      var schema = cs.schema;
      if (!schema || !schema.fields || schema.fields.length === 0) continue;
      var fields = schema.fields.filter(function(f) { return f.isText || f.childText || (f.attr && f.attr.trim()); });
      if (fields.length === 0) continue;

      var result;
      // 有快照就走快照，没快照才走 webview
      var useSnapshots = pageSnapshots.length > 0;
      if (useSnapshots) {
        result = { rows: [], headers: [], totalRows: 0 };
        var ssTotal = pageSnapshots.length, ssLoaded = 0, ssMatched = 0;
        for (var si = 0; si < pageSnapshots.length; si++) {
          var snap = pageSnapshots[si];
          try {
            if (!snapCache[snap.id]) {
              var hResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/page-snapshots/' + snap.id + '/html', signal ? { signal: signal } : {});
              if (hResp.ok) {
                var hData = await hResp.json();
                if (hData.html) snapCache[snap.id] = hData.html;
              }
            }
            var snapHtml = snapCache[snap.id];
            if (!snapHtml) continue;
            ssLoaded++;
            var fetchOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ html: snapHtml, chain_type: schema.chainType || 'css', deepest_selector: schema.deepestSelector || '', fields: fields, child_delim: schema.childDelimiter || '' }) };
            if (signal) fetchOpts.signal = signal;
            var apiResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/extract/chain', fetchOpts);
            var pageResult = await apiResp.json();
            if (pageResult && !pageResult.error && pageResult.rows) {
              var srcUrlCol = (document.getElementById('secLinkCol') && document.getElementById('secLinkCol').value) || '来源URL';
              pageResult.rows.forEach(function(r) { r["来源URL"] = snap.url || ''; });
              // 用注册元素补充字段
              try {
                var elResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/elements');
                if (elResp.ok) {
                  var elData = await elResp.json();
                  var elems = (elData.elements || []).filter(function(e) {
                    return e.page_url === snap.url;
                  });
                  for (var ei2 = 0; ei2 < elems.length; ei2++) {
                    var elem = elems[ei2];
                    var cssResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/extract/css', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ html: snapHtml, query: elem.selector })
                    });
                    var cssData = await cssResp.json();
                    var vals = (cssData.results || []).map(function(r2) { return r2.text || ''; });
                    var colName = elem.text || elem.selector;
                    if (pageResult.headers.indexOf(colName) < 0) pageResult.headers.push(colName);
                    for (var ri = 0; ri < pageResult.rows.length; ri++) {
                      pageResult.rows[ri][colName] = (ri < vals.length ? vals[ri] : '');
                    }
                  }
                }
              } catch(e) {}
              result.rows = result.rows.concat(pageResult.rows);
              result.totalRows += pageResult.totalRows || pageResult.rows.length;
              if (!result.headers.length && pageResult.headers.length) result.headers = pageResult.headers;
              ssMatched++;
            }
          } catch(e) { if (e.name === 'AbortError') throw e; }
        }
        result._diag = { snapTotal: ssTotal, snapLoaded: ssLoaded, snapMatched: ssMatched };
      } else {
        // 从当前 webview 提取
        var html = await wv.executeJavaScript('document.documentElement.outerHTML');
        if (!html) continue;
        var fetchOpts2 = { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: html, chain_type: schema.chainType || 'css', deepest_selector: schema.deepestSelector || '', fields: fields, child_delim: schema.childDelimiter || '' }) };
        if (signal) fetchOpts2.signal = signal;
        result = await (await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/extract/chain', fetchOpts2)).json();
      }
      if (result && !result.error && result.rows && result.rows.length > 0) {
        allResults.push(result);
      }
    }
    return allResults;
  }

  /** 多方案实时合并预览：勾选 ≥2 方案时触发 */
  async function _fetchChainMergeLive(checked) {
    var previewWrap = document.getElementById('schemaPreviewWrap');
    var previewInfo = document.getElementById('schemaPreviewInfo');
    if (!previewWrap) return;
    if (_chainFetchAbort) { _chainFetchAbort.abort(); _chainFetchAbort = null; }
    if (_chainPreviewTimer) { clearTimeout(_chainPreviewTimer); _chainPreviewTimer = null; }
    previewWrap.innerHTML = '<div class="tree-empty">实时提取中...</div>';
    _chainFetchAbort = new AbortController();
    try {
      var allResults = await _extractFromSchemas(checked, _chainFetchAbort.signal);
      _chainFetchAbort = null;

      if (allResults.length === 0) {
        previewWrap.innerHTML = '<div class="tree-empty">无匹配数据</div>';
        if (previewInfo) previewInfo.textContent = '';
        return;
      }

      // 合并（与"保存并查询"同逻辑）
      var allHeaders = [];
      allResults.forEach(function(r) { (r.headers || []).forEach(function(h) { if (allHeaders.indexOf(h) < 0) allHeaders.push(h); }); });
      var mergedRows = [];
      if (allResults.length >= 2) {
        var baseRows = allResults[0].rows || [];
        for (var bi = 1; bi < allResults.length; bi++) {
          var prevHeaders = allResults[bi - 1].headers || [];
          var nextRows = allResults[bi].rows || [];
          var nextHeaders = allResults[bi].headers || [];
          var _findLinkCol = function(hds) {
            for (var i = 0; i < hds.length; i++) { if (/链接|^link$|_link$|链接地址/i.test(hds[i])) return hds[i]; }
            for (var j = 0; j < hds.length; j++) { if (/url|href/i.test(hds[j])) return hds[j]; }
            return '';
          };
          var linkCol = (bi === 1 && document.getElementById('secLinkCol') && document.getElementById('secLinkCol').value) || '';
          if (!linkCol) { linkCol = _findLinkCol(prevHeaders); }
          var nextLinkCol = linkCol;
          if (linkCol && nextHeaders.indexOf(linkCol) < 0) { nextLinkCol = _findLinkCol(nextHeaders); }
          if (!linkCol || !nextLinkCol) {
            for (var ri = 0; ri < nextRows.length; ri++) {
              var row2 = {};
              allHeaders.forEach(function(h) { row2[h] = nextRows[ri][h] !== undefined ? nextRows[ri][h] : ''; });
              baseRows.push(row2);
            }
            continue;
          }
          var idx = {};
          nextRows.forEach(function(nr) { var k = nr[nextLinkCol]; if (k) idx[k] = nr; });
          var prefix = (checked[bi] && checked[bi].name) ? checked[bi].name : ('方案' + (bi + 1));
          nextHeaders.forEach(function(h) {
            if (h !== nextLinkCol && allHeaders.indexOf('【' + prefix + '-' + h + '】') < 0) allHeaders.push('【' + prefix + '-' + h + '】');
          });
          baseRows.forEach(function(br) {
            var key = br[linkCol];
            var match = key ? idx[key] : null;
            nextHeaders.forEach(function(h) {
              if (h !== nextLinkCol) br['【' + prefix + '-' + h + '】'] = match ? (match[h] || '') : '';
            });
          });
        }
        mergedRows = baseRows;
      } else {
        allResults.forEach(function(r) {
          (r.rows || []).forEach(function(srcRow) {
            var row = {};
            allHeaders.forEach(function(h) { row[h] = srcRow[h] !== undefined ? srcRow[h] : ''; });
            mergedRows.push(row);
          });
        });
      }

      var data = { rows: mergedRows, headers: allHeaders, totalRows: mergedRows.length };
      Parser.state.schemaPreviewData = data;
      renderModalPreviewTable(data);
      _refreshExportLinksBtn();
      if (previewInfo) previewInfo.textContent = '共 ' + data.totalRows + ' 行，' + allHeaders.length + ' 列' + (checked.length > 1 ? '（实时合并）' : '');
    } catch (e) {
      if (_chainFetchAbort && _chainFetchAbort.signal.aborted) return;
      _chainFetchAbort = null;
      previewWrap.innerHTML = '<div class="tree-empty">提取失败: ' + (e.message || '') + '</div>';
    }
  }

  async function _fetchChainDataFromDB(checked) {
    var previewWrap = document.getElementById('schemaPreviewWrap');
    var previewInfo = document.getElementById('schemaPreviewInfo');
    if (!previewWrap) return;
    if (_chainFetchAbort) { _chainFetchAbort.abort(); _chainFetchAbort = null; }
    if (_chainPreviewTimer) { clearTimeout(_chainPreviewTimer); _chainPreviewTimer = null; }
    previewWrap.innerHTML = '<div class="tree-empty">从库加载中...</div>';

    var isVertical = Parser.state._chainMergeMode === 'vertical' && checked.length >= 2;
    var data;

    if (isVertical) {
      // 纵向合并：逐个方案取数据，追加行，取并集列
      var allRows = [], allHeaders = [];
      for (var ci = 0; ci < checked.length; ci++) {
        var singleUrl = 'http://127.0.0.1:' + Parser.state.pythonPort + '/api/chain-data/query?schemes=' + encodeURIComponent(checked[ci].name) + '&_=' + Date.now();
        try {
          var sr = await fetch(singleUrl, { signal: _chainFetchAbort ? _chainFetchAbort.signal : undefined });
          var sd = await sr.json();
          if (sd.rows && sd.rows.length > 0) {
            var sHeaders = sd.headers || [];
            sd.rows.forEach(function(row) {
              var newRow = {};
              sHeaders.forEach(function(h) { newRow[h] = row[h] || ''; });
              allRows.push(newRow);
            });
            sHeaders.forEach(function(h) {
              if (allHeaders.indexOf(h) < 0) allHeaders.push(h);
            });
          }
        } catch(e) { if (e.name === 'AbortError') throw e; }
      }
      data = { rows: allRows, headers: allHeaders, totalRows: allRows.length };
    } else {
      var names = checked.map(function(s) { return encodeURIComponent(s.name); }).join(',');
      var linkCols = checked.map(function(s) { return (s.schema && s.schema._exportLinkCol) || ''; });
      var linkCol = (document.getElementById('secLinkCol') && document.getElementById('secLinkCol').value) || '';
      var url = 'http://127.0.0.1:' + Parser.state.pythonPort + '/api/chain-data/query?schemes=' + names
        + (linkCols.some(function(c){return c;}) ? '&link_cols=' + encodeURIComponent(linkCols.join(',')) : '')
        + (linkCol ? '&link_col=' + encodeURIComponent(linkCol) : '') + '&_=' + Date.now();
      _chainFetchAbort = new AbortController();
      try {
        var resp = await fetch(url, { signal: _chainFetchAbort.signal });
        _chainFetchAbort = null;
        data = await resp.json();
      } catch (e) {
        if (e.name === 'AbortError') return;
        previewWrap.innerHTML = '<div class="tree-empty">加载失败: ' + e.message + '</div>';
        return;
      }
    }

    if (!data.rows || data.rows.length === 0) {
      previewWrap.innerHTML = '<div class="tree-empty">该方案暂无数据</div>';
      if (previewInfo) previewInfo.textContent = '';
      return;
    }
    Parser.state.schemaPreviewData = data;
    renderModalPreviewTable(data);
    _refreshExportLinksBtn();
    var modeLabel = isVertical ? '（纵向）' : (checked.length > 1 ? '（合并）' : '');
    if (previewInfo) previewInfo.textContent = '共 ' + data.totalRows + ' 行，' + (data.headers || []).length + ' 列' + modeLabel;
  }

  // 下拉开关
  function _toggleChainDropdown() {
    var optsEl = document.getElementById('chainSchemeOptions');
    if (!optsEl) return;
    optsEl.classList.toggle('hidden');
  }
  // 点击外部关闭
  document.addEventListener('click', function(e) {
    var dd = document.getElementById('chainSchemeDropdown');
    if (!dd) return;
    if (!dd.contains(e.target)) {
      var optsEl = document.getElementById('chainSchemeOptions');
      if (optsEl) optsEl.classList.add('hidden');
    }
  });

  function chainSaveCurrent() {
    var nameInput = document.getElementById('chainSchemaName');
    var name = (nameInput ? nameInput.value.trim() : '');
    if (!name) { setStatus('请输入方案名称'); return; }
    var idx = Parser.state._editingChainSchemeIdx;
    if (idx != null && idx >= 0 && idx < Parser.state.chainSchemes.length) {
      var oldName = Parser.state.chainSchemes[idx].name;
      if (oldName !== name) {
        // 同步重命名数据库里的数据
        fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/chain-data/rename?old=' + encodeURIComponent(oldName) + '&new=' + encodeURIComponent(name))
          .then(function(r) { return r.json(); }).then(function(d) { if (d.ok) console.log('DB重命名成功'); }).catch(function(){});
      }
      Parser.state.chainSchemes[idx].name = name;
      saveChainSchemesToStorage();
      refreshChainSchemeSelect();
      setStatus(oldName !== name ? '已重命名: ' + oldName + ' → ' + name : '名称未变');
    } else {
      setStatus('请先从下拉选择一个方案再改名');
    }
  }

  function chainLoadScheme(idx) {
    var schemes = Parser.state.chainSchemes;
    if (idx < 0 || idx >= schemes.length) return;
    Parser.state._editingChainSchemeIdx = idx;
    var s = schemes[idx];
    // 强制更新选择器和链路
    var schemeDeepest = (s.schema && s.schema.deepestSelector) || '';
    var schemeChainSegs = (s.schema && s.schema.chainSegments && s.schema.chainSegments.length) ? s.schema.chainSegments : null;
    // 中断待决的 input 去抖，防止加载方案时覆盖用户刚输入的内容
    if (_chainInputTimer) { clearTimeout(_chainInputTimer); _chainInputTimer = null; }
    // 方案有链路数据就用方案的，否则保留当前内存里的
    if (schemeChainSegs) {
      schemaChainInput.value = schemeDeepest;
      Parser.state.chainSegments = JSON.parse(JSON.stringify(schemeChainSegs));
    } else if (Parser.state.chainSegments && Parser.state.chainSegments.length) {
      // 保留当前链路：从最后一段还原选择器到文本框
      var lastSeg = Parser.state.chainSegments[Parser.state.chainSegments.length - 1];
      schemaChainInput.value = (lastSeg && lastSeg.selector) || '';
    }
    // 注：else 分支删掉了，不再清空输入框——保留用户正在编辑的内容
    console.log('[chainLoadScheme] idx=' + idx + ' name=' + s.name + ' deepestSelector=' + ((s.schema && s.schema.deepestSelector) || '(空)') + ' fields=' + ((s.schema && s.schema.fields) ? s.schema.fields.length : 0));
    var beforeLen = 0;
    if (Parser.state.chainSegments[0] && Parser.state.chainSegments[0].extractions) beforeLen = Parser.state.chainSegments[0].extractions.length;
    console.log('[chainLoadScheme] 深拷贝后 extractions.length=' + beforeLen);
    Parser.state._selectedChainPath = null;
    _expandedChains = {};
    // 用 fields 回填 extractions（去重：避免加载同一方案多次后翻倍）
    if (s.schema && s.schema.fields) {
      s.schema.fields.forEach(function(f) {
        if (f.type !== 'chain') return;
        var ext = { attr: f.isText ? '$text' : (f.attr || ''), name: f.name || '' };
        var seg = Parser.state.chainSegments[f.chainIndex];
        if (!seg) return;
        if (f.subChain) {
          var sc = _findSubChainByPath(seg, f.subChain);
          if (sc) {
            if (!sc.extractions) sc.extractions = [];
            var dup = sc.extractions.some(function(e) { return e.attr === ext.attr; });
            if (!dup) sc.extractions.push(ext);
          }
        } else {
          if (!seg.extractions) seg.extractions = [];
          var dup = seg.extractions.some(function(e) { return e.attr === ext.attr; });
          if (!dup) seg.extractions.push(ext);
        }
      });
    }
    var afterLen = (Parser.state.chainSegments[0] && Parser.state.chainSegments[0].extractions) ? Parser.state.chainSegments[0].extractions.length : 0;
    console.log('[chainLoadScheme] 去重后 extractions.length=' + afterLen);
    // 更新选择器类型按钮
    var chainType = (s.schema && s.schema.chainType) || 'css';
    var cssBtn = document.getElementById('schemaTypeCss');
    var xpBtn = document.getElementById('schemaTypeXpath');
    if (cssBtn) cssBtn.classList.toggle('active', chainType === 'css');
    if (xpBtn) xpBtn.classList.toggle('active', chainType === 'xpath');
    // 渲染
    renderChainTree();
    // 自动选中第一个节点显示提取属性
    if (Parser.state.chainSegments.length > 0) {
      selectChainTreeNode([0]);
    }
    autoRefreshChainPreview();
    Parser.state._chainSegmentsBackup = JSON.parse(JSON.stringify(Parser.state.chainSegments));  // 备份
    var nameInput = document.getElementById('chainSchemaName');
    if (nameInput) nameInput.value = s.name;
  }

  function chainDeleteScheme() {
    var idx = Parser.state._editingChainSchemeIdx;
    if (idx == null || idx < 0 || idx >= Parser.state.chainSchemes.length) {
      setStatus('请先从下拉加载要删除的方案');
      return;
    }
    var name = Parser.state.chainSchemes[idx].name;
    Parser.state.chainSchemes.splice(idx, 1);
    Parser.state._editingChainSchemeIdx = null;
    saveChainSchemesToStorage();
    refreshChainSchemeSelect();
    setStatus('已删除: ' + name);
  }

  /** 获取当前链路类型（从激活的 CSS/XPath 按钮读取） */
  function getChainType() {
    var cssBtn = document.getElementById('schemaTypeCss');
    if (cssBtn && cssBtn.classList.contains('active')) return 'css';
    return 'xpath';
  }

  /** 对 trace 生成的链路应用过滤选项 */
  /** 主面板过滤选项（不 fallback 到溯源面板） */
  function getStripCheckboxes() {
    return { id: document.getElementById('chainStripId'), bare: document.getElementById('chainStripBare') };
  }
  /** 溯源面板过滤选项 */
  function getTraceStripCheckboxes() {
    return { id: document.getElementById('chainStripIdTrace'), bare: document.getElementById('chainStripBareTrace'), random: document.getElementById('chainStripRandomTrace') };
  }
  function applyTraceFilters(chain, type) {
    var cbs = getTraceStripCheckboxes();
    var stripId = cbs.id;
    var stripBare = cbs.bare;
    if (type === 'xpath') {
      if (stripId && stripId.checked) chain = chain.replace(/\[@id\s*=\s*["'][^"']*["']\]/g, '');
      if (stripId && stripId.checked) {
        chain = chain.replace(/\[\d+\]$/, '').replace(/\[last\(\)\]$/, '');
        (Parser.state.chainSegments || []).forEach(function(s) { s.matchLimit = 0; });
      }
      if (stripBare && stripBare.checked) {
        var parts = chain.replace(/^\/\//, '').split('/').filter(Boolean);
        parts = parts.filter(function(s) { return s.indexOf('[') >= 0; });
        chain = '//' + parts.join('/');
      }
    } else {
      if (stripId && stripId.checked) chain = chain.replace(/#[a-zA-Z][\w-]*/g, '');
      if (stripId && stripId.checked) {
        chain = chain.replace(/:(nth-of-type|nth-child|first-of-type|last-of-type|only-of-type|first-child|last-child|only-child)(\(\d+\))?/gi, '');
        (Parser.state.chainSegments || []).forEach(function(s) { s.matchLimit = 0; });
      }
      if (stripBare && stripBare.checked) {
        var parts = chain.split('>').map(function(s) { return s.trim(); }).filter(Boolean);
        parts = parts.filter(function(s) { return s.indexOf('.') >= 0; });
        chain = parts.join(' > ');
      }
      if (cbs.random && cbs.random.checked) {
        chain = chain.split('>').map(function(s) { return s.trim(); }).map(function(s) {
          return s.replace(/\.[a-zA-Z_][\w-]*/g, function(m) {
            // 保留有意义的类名，过滤 _ 开头(CSS Modules)和 sc- 开头(styled-components)
            return /^\._|^\.sc-/.test(m) ? '' : m;
          });
        }).join(' > ');
      }
    }
    return chain.replace(/\s+/g, ' ').trim();
  }

  /** 异步加载溯源每层的元素数和文本预览 */
  async function loadTraceOverviews(selectors, type) {
    var isXP = type === 'xpath';
    var jsCode = '(function(){var results=[];' +
      'var sels=' + JSON.stringify(selectors) + ';' +
      'for(var i=0;i<sels.length;i++){try{' +
        (isXP
          ? 'var snap=document.evaluate(sels[i],document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);' +
            'var cnt=snap.snapshotLength;var previews=[];' +
            'for(var k=0;k<Math.min(cnt,3);k++){var n=snap.snapshotItem(k);if(n.nodeType===1){previews.push({' +
              'txt:(n.textContent||"").replace(/\\s+/g," ").trim().substring(0,60),' +
              'src:n.tagName==="IMG"?n.getAttribute("src")||"":"",' +
              'href:n.tagName==="A"?n.getAttribute("href")||"":"",' +
              'tag:n.tagName.toLowerCase()' +
            '});}}'
          : 'var els=document.querySelectorAll(sels[i]);' +
            'var cnt=els.length;var previews=[];' +
            'for(var k=0;k<Math.min(cnt,3);k++){var n=els[k];previews.push({' +
              'txt:(n.textContent||"").replace(/\\s+/g," ").trim().substring(0,60),' +
              'src:n.tagName==="IMG"?n.getAttribute("src")||"":"",' +
              'href:n.tagName==="A"?n.getAttribute("href")||"":"",' +
              'tag:n.tagName.toLowerCase()' +
            '});}'
        ) +
        'results.push({cnt:cnt,previews:previews});' +
      '}catch(e){results.push({cnt:0,previews:[]});}}' +
      'return results;})()';
    try {
      var data = await webview.executeJavaScript(jsCode);
      if (!data) return;
      data.forEach(function(d, i) {
        var el = document.getElementById('traceOv' + i);
        if (!el) return;
        if (d.previews && d.previews.length) {
          el.innerHTML = d.previews.map(function(p) {
            var parts = [];
            if (p.txt) parts.push('<span title="' + escapeHtml(p.txt) + '">' + escapeHtml(p.txt) + '</span>');
            if (p.src) parts.push('<span style="color:#f59e0b">img:</span> <span title="' + escapeHtml(p.src) + '">' + escapeHtml(p.src) + '</span>');
            if (p.href) parts.push('<span style="color:#60a5fa">link:</span> <span title="' + escapeHtml(p.href) + '">' + escapeHtml(p.href) + '</span>');
            return parts.join(' | ');
          }).join(' · ');
        } else {
          el.textContent = '';
        }
      });
    } catch (e) {}
  }

  /** 更新 trace 概览文本 */
  function updateTraceOverview() {
    var el = document.getElementById('traceOverview');
    if (!el || !window._traceFullChain) return;
    el.textContent = applyTraceFilters(window._traceFullChain, window._traceType || 'css');
  }
  window.updateTraceOverview = updateTraceOverview;

  /** 溯源：从最深选择器沿DOM树向上生成完整链路 */
  async function traceChain() {
    var sel = schemaChainInput.value.trim();
    if (!sel) return;
    var type = getChainType();
    // 溯源不需要位置伪类，去掉以免匹配失败
    var querySel = sel.replace(/:nth-(child|of-type|last-child|last-of-type|first-child)\s*\([^)]*\)/gi, '');
    querySel = querySel.replace(/:(first|last)-(child|of-type)/gi, '');
    chainTraceResult.classList.remove('hidden');
    chainTraceResult.innerHTML = '<div style="padding:6px 12px;font-size:12px;color:var(--text-dim)">溯源中...</div>';

    var jsCode;
    if (type === 'xpath') {
      jsCode = '(function(){try{var it=document.evaluate(' + JSON.stringify(querySel) +
        ',document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;' +
        'if(!it)return null;var r=[];var el=it;var maxLevels=10;' +
        'while(el&&el!==document.body&&el!==document.documentElement&&r.length<maxLevels){' +
          'var info={t:el.tagName?el.tagName.toLowerCase():"",c:"",i:""};' +
          'if(el.className&&typeof el.className==="string")info.c=el.className.trim().split(/\\s+/)[0]||"";' +
          'if(el.id)info.i=el.id;' +
          'r.push(info);el=el.parentElement;}' +
        'return r;}catch(e){return null;}})()';
    } else {
      jsCode = '(function(){try{var el=document.querySelector(' + JSON.stringify(querySel) +
        ');if(!el)return null;var r=[];var maxLevels=10;' +
        'while(el&&el!==document.body&&el!==document.documentElement&&r.length<maxLevels){' +
          'var info={t:el.tagName?el.tagName.toLowerCase():"",c:"",i:""};' +
          'if(el.className&&typeof el.className==="string")info.c=el.className.trim().split(/\\s+/)[0]||"";' +
          'if(el.id)info.i=el.id;' +
          'r.push(info);el=el.parentElement;}' +
        'return r;}catch(e){return null;}})()';
    }

    try {
      var ancestors = await webview.executeJavaScript(jsCode);
      if (!ancestors || !ancestors.length) {
        // webview 当前页未找到 → 尝试从快照 HTML 中溯源
        var snapAncestors = null;
        try {
          var saResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/page-snapshots/list');
          if (saResp.ok) {
            var saData = await saResp.json();
            var saSnaps = saData.snapshots || [];
            for (var sai = 0; sai < saSnaps.length && !snapAncestors; sai++) {
              var shResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/page-snapshots/' + saSnaps[sai].id + '/html');
              if (!shResp.ok) continue;
              var shData = await shResp.json();
              if (!shData.html) continue;
              var trResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/extract/trace', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html: shData.html, chain_type: type, deepest_selector: querySel })
              });
              var trData = await trResp.json();
              if (trData.ancestors && trData.ancestors.length > 0) {
                snapAncestors = trData.ancestors;
              }
            }
          }
        } catch(e) {}
        if (!snapAncestors) {
          chainTraceResult.innerHTML = '<div style="padding:6px 12px;font-size:12px;color:var(--red)">未找到匹配元素</div>';
          return;
        }
        ancestors = snapAncestors;
      }

      var parts = ancestors.slice().reverse().map(function(info) {
        if (type === 'xpath') {
          var s = info.t;
          if (info.c) s += '[contains(@class,"' + info.c.replace(/"/g,'&quot;') + '")]';
          if (info.i) s += '[@id="' + info.i.replace(/"/g,'&quot;') + '"]';
          return s;
        } else {
          var s = info.t;
          if (info.c) s += '.' + info.c;
          if (info.i) s += '#' + info.i;
          return s;
        }
      });
      var fullChain = type === 'xpath' ? '//' + parts.join('/') : parts.join(' > ');
      fullChain = fullChain.replace(/:nth-(child|of-type|last-child|first-child)\s*\([^)]*\)/gi, '');
      fullChain = fullChain.replace(/:(first|last)-(child|of-type)/gi, '');
      window._traceFullChain = fullChain;
      window._traceType = type;
      var filteredChain = applyTraceFilters(fullChain, type);

      // 构建每层的渐进选择器: parts 已经是外→内
      var traceSelectors = [];
      for (var ti = 0; ti < parts.length; ti++) {
        var ps = parts.slice(0, ti + 1);
        traceSelectors.push(type === 'xpath' ? '//' + ps.join('/') : ps.join(' > '));
      }
      var html = '<div style="padding:4px 12px 8px">';
      html += '<div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--accent)">溯源结果（向上 ' + ancestors.length + ' 层）</div>';
      ancestors.slice().reverse().forEach(function(info, idx) {
        var tagLabel = '<' + info.t + '>';
        var clsLabel = info.c ? (type==='xpath'?'[contains(@class,"'+info.c+'")]':'.'+info.c) : '';
        var idLabel = info.i ? (type==='xpath'?'[@id="'+info.i+'"]':'#'+info.i) : '';
        var selPart = escapeHtml(clsLabel+idLabel) || escapeHtml(tagLabel);
        html += '<div style="font-size:11px;padding:2px 0;display:flex;align-items:baseline;gap:6px">L'+(idx+1)+' <span style="color:var(--accent);flex-shrink:0">'+escapeHtml(tagLabel)+'</span> <span style="font-family:Consolas,"Microsoft YaHei",monospace;flex-shrink:0;width:180px;color:#a78bfa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" onclick="this.style.whiteSpace=this.style.whiteSpace==\'normal\'?\'nowrap\':\'normal\'" title="点击展开/收起">'+selPart+'</span> <span class="trace-overview-inline" id="traceOv' + idx + '" style="font-size:10px;color:#94a3b8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" onclick="this.style.whiteSpace=this.style.whiteSpace==\'normal\'?\'nowrap\':\'normal\'" title="点击展开/收起">...</span></div>';
      });
      html += '<div id="traceOverview" style="margin-top:6px;font-family:Consolas,"Microsoft YaHei",monospace;font-size:11px;color:var(--text-bright);word-break:break-all;background:var(--bg-card);padding:4px 8px;border-radius:3px">' + escapeHtml(filteredChain) + '</div>';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-top:6px">';
      html += '<button id="btnApplyTrace" class="btn btn-sm btn-accent" style="height:26px">确认生成</button>';
      html += '<label class="checkbox-label"><input type="checkbox" id="chainStripIdTrace" onchange="updateTraceOverview();parseChainFromTrace()"> 过滤ID</label>';
      html += '<label class="checkbox-label"><input type="checkbox" id="chainStripBareTrace" onchange="updateTraceOverview();parseChainFromTrace()"> 过滤裸标签</label>';
      html += '<label class="checkbox-label"><input type="checkbox" id="chainStripRandomTrace" checked onchange="updateTraceOverview();parseChainFromTrace()"> 过滤随机类名</label>';
      html += '</div></div>';
      chainTraceResult.innerHTML = html;

      document.getElementById('btnApplyTrace').addEventListener('click', function() {
        schemaChainInput.value = applyTraceFilters(window._traceFullChain, window._traceType || 'css');
        chainTraceResult.classList.add('hidden');
        // 溯源结果替换编辑器 → 不再属于任何已加载方案
        Parser.state._editingChainSchemeIdx = null;
        parseChain();
      });
      window.parseChainFromTrace = function() { parseChain(); };
      // 异步查询每层概览
      loadTraceOverviews(traceSelectors, type);
    } catch(e) {
      chainTraceResult.innerHTML = '<div style="padding:6px 12px;font-size:12px;color:var(--red)">溯源失败: ' + escapeHtml(String(e)) + '</div>';
    }
  }

  /** 给选择器追加匹配限制 */
  function _applyMatchLimit(sel, ml) {
    if (!ml || ml === 0) return sel;
    sel = sel.replace(/:(nth-of-type|nth-child|first-of-type|last-of-type|only-of-type|first-child|last-child|only-child)(\(\d+\))?/gi, '');
    sel = sel.replace(/\[\d+\]$/, '');
    if (ml === 1) return sel + ':nth-of-type(1)';
    if (ml === 2) return sel + ':nth-of-type(2)';
    if (ml === 3) return sel + ':nth-of-type(3)';
    if (ml === -1) return sel + ':last-of-type';
    return sel + ':nth-of-type(' + ml + ')';
  }

  function _rebuildChainInputWithLimits() {
    var type = getChainType();
    var segs = Parser.state.chainSegments || [];
    var parts = [];
    var sep = type === 'xpath' ? '/' : ' > ';
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var sel = s.selector || '';
      var lastPart = sel;
      if (type === 'xpath') {
        var pp = sel.replace(/^\/\//, '').split('/');
        lastPart = pp[pp.length - 1] || lastPart;
      } else if (sel.indexOf(' > ') > -1) {
        var pp = sel.split(' > ');
        lastPart = pp[pp.length - 1].trim();
      }
      // 追加匹配限制伪类（先清除已有的）
      lastPart = lastPart.replace(/:(nth-of-type|nth-child|first-of-type|last-of-type|only-of-type|first-child|last-child|only-child)(\(\d+\))?/gi, '');
      lastPart = lastPart.replace(/\[\d+\]$/, '');  // 也清 XPath 位置谓词
      var ml = s.matchLimit || 0;
      if (type === 'xpath') {
        // XPath 用位置谓词
        if (ml === 1) lastPart += '[1]';
        else if (ml === 2) lastPart += '[2]';
        else if (ml === 3) lastPart += '[3]';
        else if (ml === -1) lastPart += '[last()]';
        else if (ml > 3) lastPart += '[' + ml + ']';
      } else {
        if (ml === 1) lastPart += ':nth-of-type(1)';
        else if (ml === 2) lastPart += ':nth-of-type(2)';
        else if (ml === 3) lastPart += ':nth-of-type(3)';
        else if (ml === -1) lastPart += ':last-of-type';
        else if (ml > 3) lastPart += ':nth-of-type(' + ml + ')';
      }
      parts.push(lastPart);
    }
    schemaChainInput.value = (type === 'xpath' ? '//' : '') + parts.join(sep);
  }

  /** 解析链路 */
  function parseChain() {
    _debugLog('[parseChain] 输入: ' + schemaChainInput.value.trim().substring(0, 100));
    var type = getChainType();
    var chain = schemaChainInput.value.trim();
    if (!chain) return;
    // 去掉 nth-of-type 等索引伪类——但保留最深段（最后一段）的伪类
    var separator = type === 'css' ? '>' : '/';
    // 含逗号的复合选择器：不拆分，整个作为 deepestSelector
    var hasComma = type === 'css' && chain.indexOf(',') >= 0;
    if (hasComma) {
      // 复合选择器：作为单段链路，最深选择器即全量
      chain = chain.replace(/\s+/g, ' ').trim();
      // 应用去ID/去裸标签
      var cbs2 = getStripCheckboxes();
      if (cbs2.id && cbs2.id.checked) chain = chain.replace(/#[a-zA-Z][\w-]*/g, '');
      if (cbs2.bare && cbs2.bare.checked) {
        var cp2 = chain.split(',').map(function(p) {
          var sp = p.split('>').map(function(s) { return s.trim(); }).filter(function(s) { return s.indexOf('.') >= 0; });
          return sp.join(' > ');
        }).filter(Boolean);
        chain = cp2.join(', ');
      }
      if (schemaChainInput.value.trim() !== chain) {
        schemaChainInput.value = chain;
      }
      var oldSegs2 = Parser.state.chainSegments || [];
      Parser.state.chainSegments = [{
        selector: chain,
        cumulative: chain,
        tag: '',
        level: 0,
        isDeepest: true,
        extractions: (oldSegs2.length === 1 ? oldSegs2[0].extractions : []) || [],
        subChains: (oldSegs2.length === 1 ? oldSegs2[0].subChains : []) || [],
        matchLimit: (oldSegs2.length === 1 ? oldSegs2[0].matchLimit : 0) || 0,
      }];
      renderChainTree();
      autoRefreshChainPreview();
      return;
    }
    var parts = chain.split(separator).map(function(s) { return s.trim(); }).filter(Boolean);
    if (type === 'xpath' && parts.length > 0 && parts[0] === '/') {
      parts = parts.slice(1);
    }
    if (parts.length > 1) {
      // 只从父级段删伪类，最深段保留
      for (var pi = 0; pi < parts.length - 1; pi++) {
        parts[pi] = parts[pi].replace(/:nth-(child|of-type|last-child|last-of-type|first-child)\s*\([^)]*\)/gi, '');
        parts[pi] = parts[pi].replace(/:(first|last)-(child|of-type)/gi, '');
      }
    }
    chain = parts.join(type === 'css' ? ' > ' : (type === 'xpath' ? '/' : ' > '));
    // 应用过滤选项
    var cbs = getStripCheckboxes();
    var stripId = cbs.id;
    var stripBare = cbs.bare;
    if (type === 'xpath') {
      if (stripId && stripId.checked) chain = chain.replace(/\[@id\s*=\s*["'][^"']*["']\]/g, '');
      if (stripId && stripId.checked) {
        chain = chain.replace(/\[\d+\]$/, '').replace(/\[last\(\)\]$/, '');
        (Parser.state.chainSegments || []).forEach(function(s) { s.matchLimit = 0; });
      }
      if (stripBare && stripBare.checked) {
        var parts = chain.replace(/^\/\//, '').split('/').filter(Boolean);
        parts = parts.filter(function(s) { return s.indexOf('[') >= 0; });
        chain = '//' + parts.join('/');
      }
    } else {
      if (stripId && stripId.checked) chain = chain.replace(/#[a-zA-Z][\w-]*/g, '');
      if (stripId && stripId.checked) {
        chain = chain.replace(/:(nth-of-type|nth-child|first-of-type|last-of-type|only-of-type|first-child|last-child|only-child)(\(\d+\))?/gi, '');
        (Parser.state.chainSegments || []).forEach(function(s) { s.matchLimit = 0; });
      }
      if (stripBare && stripBare.checked) {
        var cp = chain.split('>').map(function(s) { return s.trim(); }).filter(Boolean);
        cp = cp.filter(function(s) { return s.indexOf('.') >= 0; });
        chain = cp.join(' > ');
      }
    }
    chain = chain.replace(/\s+/g, ' ').trim();
    // 回写过滤后的链路到输入框
    if (schemaChainInput.value.trim() !== chain) {
      schemaChainInput.value = chain;
    }
    // 重新分割（过滤后可能变了）
    parts = chain.split(separator).map(function(s) { return s.trim(); }).filter(Boolean);
    if (type === 'xpath' && parts.length > 0 && parts[0] === '/') {
      parts = parts.slice(1);
    }
    // 构建渐进式选择器：每段从开头到当前位置的完整路径
    // 保留旧的 matchLimit
    var oldSegs = Parser.state.chainSegments || [];
    Parser.state.chainSegments = [];
    for (var i = 0; i < parts.length; i++) {
      var ps = parts.slice(0, i + 1);
      var sel = type === 'xpath' ? '//' + ps.join('/') : ps.join(' > ');
      var lastPart = parts[i].trim();
      var tagMatch = lastPart.match(/^[.#]?([a-zA-Z][a-zA-Z0-9]*)/);
      var tag = tagMatch ? tagMatch[1].toLowerCase() : (lastPart[0] === '.' ? 'div' : (lastPart[0] === '#' ? 'div' : ''));
      var oldMl = (oldSegs[i] && oldSegs[i].matchLimit) ? oldSegs[i].matchLimit : 0;
      Parser.state.chainSegments.push({ selector: sel, tag: tag, extractions: [], matchLimit: oldMl });
    }
    Parser.state._selectedChainPath = null;
    _expandedChains = {};
    Parser.state._chainHeaderOrder = null;
    Parser.state.schemaPreviewData = null;  // 清除旧预览，强制重新提取
    // 从勾选方案恢复提取属性（仅当 deepestSelector 匹配时）
    var checkedSchemes = (Parser.state.chainSchemes || []).filter(function(s) { return s.checked !== false; });
    if (checkedSchemes.length === 1 && checkedSchemes[0].schema && checkedSchemes[0].schema.fields) {
      var sch = checkedSchemes[0].schema;
      var schDeepest = sch.deepestSelector || '';
      var curDeepest = (Parser.state.chainSegments.length > 0 && Parser.state.chainSegments[Parser.state.chainSegments.length - 1]) ? Parser.state.chainSegments[Parser.state.chainSegments.length - 1].selector : '';
      if (schDeepest === curDeepest) {
        sch.fields.forEach(function(f) {
          if (f.type !== 'chain') return;
          var ext = f.childText
            ? { attr: '$childText', name: f.name || '', childSelectors: f.childSelectors || [], childDelimiter: f.childDelimiter || '' }
            : { attr: f.isText ? '$text' : (f.attr || ''), name: f.name || '' };
          var seg = Parser.state.chainSegments[f.chainIndex];
          if (!seg) return;
          if (!seg.extractions) seg.extractions = [];
          var dup = seg.extractions.some(function(e) { return e.attr === ext.attr; });
          if (!dup) seg.extractions.push(ext);
        });
      }
    }
    // 保留旧的 subChains 和 extractions（仅当链路结构未变时）
    var oldDeepest = (oldSegs.length > 0 && oldSegs[oldSegs.length - 1]) ? oldSegs[oldSegs.length - 1].selector : '';
    var newDeepest = (Parser.state.chainSegments.length > 0 && Parser.state.chainSegments[Parser.state.chainSegments.length - 1]) ? Parser.state.chainSegments[Parser.state.chainSegments.length - 1].selector : '';
    var sameStructure = oldSegs.length === Parser.state.chainSegments.length && oldDeepest === newDeepest;
    for (var i = 0; i < Parser.state.chainSegments.length; i++) {
      var old = oldSegs[i];
      if (!old) continue;
      if (sameStructure && old.subChains && old.subChains.length) {
        Parser.state.chainSegments[i].subChains = old.subChains;
      }
      // 合并旧 extractions（attr+name 去重，仅当链路结构未变）
      if (sameStructure) {
        var newExts = Parser.state.chainSegments[i].extractions || [];
        (old.extractions || []).forEach(function(oe) {
          if (!oe.attr || !oe.attr.trim()) return;
          if (!newExts.some(function(ne) { return ne.attr === oe.attr && ne.name === oe.name; })) {
            newExts.push(oe);
          }
        });
        Parser.state.chainSegments[i].extractions = newExts;
      }
    }
    Parser.state._chainSegmentsBackup = JSON.parse(JSON.stringify(Parser.state.chainSegments));  // 备份
    renderChainTree();
    // 把各层的 matchLimit 伪类加回输入框（parseChain 会洗掉父级）
    _rebuildChainInputWithLimits();
  }

  /** 猜测该层的推荐属性 */
  function guessChainAttrs(tag) {
    var options = [
      { value: '', label: '选择属性' },
      { value: '$text', label: '文本' },
      { value: '$childText', label: '子元素文本' },
    ];
    if (tag === 'a') {
      options.push({ value: 'href', label: 'href' });
    } else if (tag === 'img') {
      options.push({ value: 'src', label: 'src' });
      options.push({ value: 'alt', label: 'alt' });
    }
    // 通用常见属性
    options.push({ value: 'class', label: 'class' });
    options.push({ value: 'id', label: 'id' });
    options.push({ value: 'title', label: 'title' });
    // 自定义
    options.push({ value: '__custom__', label: '自定义…' });
    return options;
  }

  /** 渲染子链路区域 HTML（不包含外层 .chain-sub-section） */
  function renderSubChainHTML(idx) {
    var subs = (Parser.state.chainSegments[idx] && Parser.state.chainSegments[idx].subChains) || [];
    var html = '';
    subs.forEach(function(sc, sci) {
      // 兼容旧数据
      if (!sc.chainSegments) sc.chainSegments = [];
      sc.chainSegments.forEach(function(ss) {
        if (!ss.extractions) { ss.extractions = ss.attr ? [{attr:ss.attr,name:ss.name||''}] : []; delete ss.attr; delete ss.name; }
      });
      var scType = sc.chainType || 'css';
      var cssActive = scType === 'css' ? ' active' : '';
      var xpActive = scType === 'xpath' ? ' active' : '';
      html += '<div class="chain-sub-section-item" data-sub-idx="' + sci + '">';
      // 配置行
      html += '<div class="chain-sub-input-row">';
      html += '<span style="font-size:11px;color:var(--accent)">Sub' + (sci + 1) + '</span>';
      html += '<button class="schema-subtype-btn' + cssActive + '" data-sub-type="css" data-idx="' + idx + '" data-sub-idx="' + sci + '">CSS</button>';
      html += '<button class="schema-subtype-btn' + xpActive + '" data-sub-type="xpath" data-idx="' + idx + '" data-sub-idx="' + sci + '">XP</button>';
      html += '<input class="chain-sub-sel-input form-input" data-idx="' + idx + '" data-sub-idx="' + sci + '" value="' + escapeHtml(sc.selector || '') + '" placeholder="相对选择器，如 div.price" style="flex:1;height:26px;font-family:Consolas,"Microsoft YaHei",monospace;font-size:12px">';
      var isParsed = sc.chainSegments && sc.chainSegments.length > 0;
      html += '<button class="btn btn-sm chain-sub-parse-btn ' + (isParsed ? 'chain-sub-parsed' : 'btn-accent') + '" data-idx="' + idx + '" data-sub-idx="' + sci + '" style="height:26px">' + (isParsed ? '✓' : '解析') + '</button>';
      html += '<button class="btn-sub-chain-remove" data-idx="' + idx + '" data-sub-idx="' + sci + '" title="删除此子链路" style="font-size:12px;padding:0 6px;height:26px;border:none;background:transparent;color:var(--text-dim);cursor:pointer">✕</button>';
      html += '</div>';
      // 子层列表
      html += '<div class="chain-sub-segments">';
      if (sc.chainSegments && sc.chainSegments.length > 0) {
        sc.chainSegments.forEach(function(subSeg, si) {
          var subTag = subSeg.tag ? '<' + subSeg.tag + '>' : '?';
          var subAttrs = guessChainAttrs(subSeg.tag);
          html += '<div class="chain-sub-layer">';
          html += '<div class="chain-sub-layer-header" data-sidx="' + si + '" data-sub-idx="' + sci + '" style="cursor:pointer">';
          html += '<span class="sub-level-idx">S' + (si + 1) + '</span>';
          html += '<span class="sub-level-sel" title="' + escapeHtml(subSeg.selector) + '">' + escapeHtml(subSeg.selector) + '</span>';
          html += '<span class="sub-level-tag">' + escapeHtml(subTag) + '</span>';
          html += '</div>';
          html += '<div class="chain-sub-extract">';
          var subExts = subSeg.extractions || [];
          subExts.forEach(function(subEx, sei) {
            var subAttrHtml = '<select class="chain-sub-attr-select" data-pidx="' + idx + '" data-sidx="' + si + '" data-sub-idx="' + sci + '" data-extr-idx="' + sei + '" style="font-size:11px;height:24px;width:95px;flex-shrink:0">';
            subAttrs.forEach(function(opt) {
              var sel = (subEx.attr === opt.value) ? ' selected' : '';
              subAttrHtml += '<option value="' + opt.value + '"' + sel + ' title="' + escapeHtml(opt.label) + '">' + opt.label + '</option>';
            });
            subAttrHtml += '</select>';
            html += '<div class="chain-attr-row">';
            html += '<span style="font-size:11px;color:var(--text-dim);width:40px">提取:</span>';
            html += subAttrHtml;
            html += '<input class="chain-sub-name-input" data-pidx="' + idx + '" data-sidx="' + si + '" data-sub-idx="' + sci + '" data-extr-idx="' + sei + '" value="' + escapeHtml(subEx.name || '') + '" placeholder="字段名" style="flex:1;height:24px;font-size:12px;min-width:70px">';
            html += '<button class="btn-extr-remove btn-sub-extr-remove" data-pidx="' + idx + '" data-sidx="' + si + '" data-sub-idx="' + sci + '" data-extr-idx="' + sei + '" title="移除" style="font-size:9px;padding:0 4px;height:22px;border:none;background:transparent;color:var(--text-dim);cursor:pointer">✕</button>';
            html += '</div>';
          });
          html += '<button class="btn-extr-add btn-sub-extr-add" data-pidx="' + idx + '" data-sidx="' + si + '" data-sub-idx="' + sci + '" style="font-size:11px;padding:1px 6px;margin-top:2px">+ 添加属性</button>';
          html += '</div></div>';
        });
      } else {
        html += '<div class="tree-empty" style="padding:4px 0;font-size:11px">输入子链路选择器后点击"解析"</div>';
      }
      html += '</div></div>';
    });
    // 添加按钮
    html += '<button class="btn-sub-chain-add" data-idx="' + idx + '" style="font-size:11px;padding:2px 10px;margin-top:4px;border:1px dashed var(--border);border-radius:3px;background:transparent;color:var(--text-dim);cursor:pointer;font-family:inherit">+ 添加子链路</button>';
    return html;
  }

  /** 从 webview 获取层的前几个匹配元素的属性 */
  async function fetchLayerPreview(idx) {
    var seg = Parser.state.chainSegments[idx];
    if (!seg || !seg.selector) return [];
    var isXPath = seg.selector.indexOf('//') === 0;
    try {
      var jsCode;
      if (isXPath) {
        jsCode = '(function(){' +
          'var sel=' + JSON.stringify(seg.selector) + ';' +
          'try{var snapshot=document.evaluate(sel,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);}catch(e){return [];}' +
          'var els=[];' +
          'for(var k=0;k<snapshot.snapshotLength;k++){els.push(snapshot.snapshotItem(k));}' +
          'var result=[];' +
          'for(var i=0;i<Math.min(els.length,' + Parser.state.chainPreviewLimit + ');i++){' +
            'var el=els[i];' +
            'var attrs={};' +
            'if(el.nodeType===2){attrs.value=el.value||"";result.push({tag:"#attr",attrs:attrs,text:"",childCount:0});continue;}' +
            'for(var j=0;j<el.attributes.length;j++){var a=el.attributes[j];attrs[a.name]=a.value;}' +
            'var text=(el.textContent||"").replace(/\\s+/g," ").trim();' +
            'result.push({tag:el.tagName?el.tagName.toLowerCase():"",attrs:attrs,text:text,childCount:el.children?el.children.length:0});' +
          '}' +
          'return result;' +
        '})()';
      } else {
        jsCode = '(function(){' +
          'var sel=' + JSON.stringify(seg.selector) + ';' +
          'try{var els=document.querySelectorAll(sel);}catch(e){return [];}' +
          'var result=[];' +
          'for(var i=0;i<Math.min(els.length,' + Parser.state.chainPreviewLimit + ');i++){' +
            'var el=els[i];' +
            'var attrs={};' +
            'for(var j=0;j<el.attributes.length;j++){var a=el.attributes[j];attrs[a.name]=a.value;}' +
            'var text=(el.textContent||"").replace(/\\s+/g," ").trim();' +
            'result.push({tag:el.tagName.toLowerCase(),attrs:attrs,text:text,childCount:el.children.length});' +
          '}' +
          'return result;' +
        '})()';
      }
      var data = await webview.executeJavaScript(jsCode);
      return data || [];
    } catch (e) {
      return [];
    }
  }

  /** 查询某层第 N 个匹配元素的子元素 */
  async function fetchChildElements(layerIdx, elIdx) {
    var seg = Parser.state.chainSegments[layerIdx];
    if (!seg || !seg.selector) return [];
    var isXPath = seg.selector.indexOf('//') === 0;
    try {
      var jsCode;
      if (isXPath) {
        jsCode = '(function(){try{var snap=document.evaluate(' + JSON.stringify(seg.selector) + ',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);' +
          'var n=snap.snapshotItem(' + elIdx + ');if(!n||n.nodeType!==1)return[];' +
          'var children=[];for(var i=0;i<Math.min(n.children.length,20);i++){' +
            'var c=n.children[i];children.push({tag:c.tagName.toLowerCase(),id:c.id,cls:c.className,text:(c.textContent||"").replace(/\\s+/g," ").trim().substring(0,80),childCount:c.children.length});' +
          '}return children;' +
        '}catch(e){return[];}})()';
      } else {
        jsCode = '(function(){try{var els=document.querySelectorAll(' + JSON.stringify(seg.selector) + ');' +
          'var n=els[' + elIdx + '];if(!n)return[];' +
          'var children=[];for(var i=0;i<Math.min(n.children.length,20);i++){' +
            'var c=n.children[i];children.push({tag:c.tagName.toLowerCase(),id:c.id,cls:c.className,text:(c.textContent||"").replace(/\\s+/g," ").trim().substring(0,80),childCount:c.children.length});' +
          '}return children;' +
        '}catch(e){return[];}})()';
      }
      var data = await webview.executeJavaScript(jsCode);
      return data || [];
    } catch (e) { return []; }
  }

  /** 渲染子元素列表 */
  function renderChildListHTML(data, layerIdx, elIdx) {
    if (!data || !data.length) {
      return '<div style="font-size:10px;color:var(--text-dim);padding:2px 0">无子元素</div>';
    }
    var html = '<div class="child-list-inner" style="margin-top:2px;padding-left:12px;border-left:1px solid var(--border)">';
    html += '<div style="font-size:10px;color:var(--text-dim);margin-bottom:2px">子元素 (' + data.length + '个) · 点击选中</div>';
    // 子元素保持原始 DOM 顺序，不排序
    data.forEach(function(c, ci) {
      var sel = c.tag;
      var firstCls = (c.cls || '').trim().split(/\s+/)[0];
      if (firstCls && firstCls !== '.' && /^[a-zA-Z_][\w-]*$/.test(firstCls)) sel += '.' + firstCls;
      if (c.id) sel += '#' + c.id;
      html += '<div class="chain-preview-el child-item child-selectable" style="margin-bottom:2px;cursor:pointer;font-size:10px;padding:2px 4px;border:1px solid transparent;border-radius:2px;transition:all 0.15s" data-sel="' + escapeHtml(sel) + '" data-ci="' + ci + '">';
      html += '<span class="child-check" style="display:inline-block;width:12px;height:12px;border:1px solid var(--border);border-radius:2px;margin-right:4px;vertical-align:middle;font-size:8px;text-align:center;line-height:12px"></span>';
      html += '<span style="color:var(--accent)">&lt;' + escapeHtml(c.tag) + '&gt;</span>';
      if (c.cls) html += '<span style="color:#a78bfa">.' + escapeHtml(c.cls.split(' ')[0]) + '</span>';
      if (c.id) html += '<span style="color:#f59e0b">#' + escapeHtml(c.id) + '</span>';
      if (c.text) html += ' <span style="color:var(--text-dim)">' + escapeHtml(c.text.substring(0,30)) + '</span>';
      html += '</div>';
    });
    // 操作栏（初始隐藏）
    html += '<div class="child-action-bar" style="display:none;margin-top:6px;padding:6px 8px;border:1px solid var(--accent);border-radius:3px;align-items:center;gap:6px">';
    html += '<input class="child-action-name" placeholder="字段名" style="flex:1;height:26px;font-size:12px;border:1px solid var(--border);border-radius:2px;background:var(--bg);color:var(--text);padding:0 8px">';
    html += '<input class="child-action-delim" placeholder="分隔符" value="" style="width:50px;height:26px;font-size:11px;border:1px solid var(--border);border-radius:2px;background:var(--bg);color:var(--text);padding:0 4px;flex-shrink:0">';
    html += '<button class="child-action-dig" style="flex-shrink:0;font-size:11px;padding:2px 10px;margin-left:auto;background:transparent;color:var(--accent);border:1px solid var(--accent);border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap">添加子链路</button>';
    html += '<button class="child-action-merge" style="flex-shrink:0;font-size:11px;padding:2px 10px;background:var(--accent);color:#fff;border:none;border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap">合并提取</button>';
    html += '</div>';
    html += '</div>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  /** 将属性预览数据渲染为 HTML */
  function renderLayerPreviewHTML(data) {
    if (!data || !data.length) {
      return '<div style="padding:4px 8px;font-size:11px;color:var(--text-dim)">无匹配元素</div>';
    }
    // 子元素多的排前面，避免遗漏（保留原始索引用于定位）
    var sorted = data.map(function(el, i) { el._origIdx = i; return el; })
      .sort(function(a, b) { return (b.childCount || 0) - (a.childCount || 0); });
    var html = '';
    sorted.forEach(function(el, ei) {
      html += '<div class="chain-preview-el">';
      html += '<span class="chain-preview-el-tag">&lt;' + escapeHtml(el.tag) + '&gt; <span style="font-weight:400;font-size:10px;color:var(--text-dim)">#' + (ei + 1) + ' &middot; ' + el.childCount + ' 子元素</span> <button class="btn-preview-children" data-el-idx="' + (el._origIdx != null ? el._origIdx : ei) + '" style="font-size:9px;padding:0 4px;height:16px;border:1px solid var(--border);border-radius:2px;background:transparent;color:var(--text-dim);cursor:pointer">▶</button></span>';
      // 文本内容
      if (el.text) {
        html += '<div class="chain-preview-attr">';
        html += '<span class="cpa-name">text</span><span class="cpa-arrow">→</span>';
        html += '<span class="cpa-value" onclick="this.classList.toggle(\'expanded\')" title="点击展开/收起">' + escapeHtml(el.text) + '</span>';
        html += '</div>';
      }
      // 属性列表
      var attrKeys = Object.keys(el.attrs);
      if (attrKeys.length === 0 && !el.text) {
        html += '<div style="font-size:10px;color:var(--text-dim);padding-left:8px">（无关键属性）</div>';
      }
      attrKeys.forEach(function(key) {
        var val = el.attrs[key];
        html += '<div class="chain-preview-attr">';
        html += '<span class="cpa-name">' + escapeHtml(key) + '</span><span class="cpa-arrow">→</span>';
        html += '<span class="cpa-value" onclick="this.classList.toggle(\'expanded\')" title="点击展开/收起">' + escapeHtml(val || '') + '</span>';
        html += '</div>';
      });
      html += '</div>';
    });
    return html;
  }

  /** 将下拉框的"自定义…"选项改为原地输入框 */
  function handleCustomAttr(selectEl, onCommit) {
    var prevValue = selectEl._prevValue || '';
    // 创建输入框替换下拉框
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'chain-attr-input';
    input.placeholder = '输入属性名…';
    input.style.cssText = 'width:' + (selectEl.offsetWidth || 90) + 'px;height:' + (selectEl.offsetHeight || 24) + 'px;font-size:11px;padding:0 4px;border:1px solid var(--accent);border-radius:3px;background:var(--bg-card);color:var(--text);font-family:Consolas,"Microsoft YaHei",monospace';
    selectEl.style.display = 'none';
    selectEl.parentNode.insertBefore(input, selectEl.nextSibling);
    input.focus();
    input.select();

    function commit(val) {
      val = (val || '').trim();
      if (val) {
        // 添加新选项并选中
        var opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        opt.selected = true;
        selectEl.insertBefore(opt, selectEl.lastChild);
        selectEl.value = val;
        selectEl._prevValue = val;
      } else {
        // 恢复之前的值
        selectEl.value = prevValue;
        selectEl._prevValue = prevValue;
      }
      selectEl.style.display = '';
      if (input.parentNode) input.parentNode.removeChild(input);
      onCommit(val || prevValue);
    }

    input.addEventListener('blur', function() {
      setTimeout(function() { commit(input.value); }, 100);
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { commit(input.value); }
      if (e.key === 'Escape') { commit(prevValue); }
    });
  }

  /** 清除链路悬停高亮 */
  async function clearChainHighlights() {
    try {
      await webview.executeJavaScript(
        '(function(){' +
          'var ovs=document.querySelectorAll(".__parser_chain_hl");' +
          'for(var i=0;i<ovs.length;i++){' +
            'var ov=ovs[i];var el=ov.__hostEl;' +
            'if(el){' +
              'if(ov.__origPos!==undefined)el.style.position=ov.__origPos;' +
              'if(ov.__origParentPos!==undefined&&el.parentElement)el.parentElement.style.position=ov.__origParentPos;' +
            '}' +
            'if(ov.parentNode)ov.parentNode.removeChild(ov);' +
          '}' +
        '})()'
      );
    } catch (e) {}
  }

  /** 悬停链图层时高亮 webview 中匹配元素 */
  async function highlightChainLayer(idx) {
    var seg = Parser.state.chainSegments[idx];
    if (!seg || !seg.selector) return;
    await clearChainHighlights();
    var isXPath = seg.selector.indexOf('//') === 0;
    try {
      var jsCode;
      if (isXPath) {
        jsCode = '(function(){' +
          'try{var snap=document.evaluate(' + JSON.stringify(seg.selector) + ',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);' +
          'for(var k=0;k<Math.min(snap.snapshotLength,50);k++){' +
            'var el=snap.snapshotItem(k);if(el.nodeType!==1)continue;' +
            'hlSingle(el);' +
          '}}catch(e){}' +
          'function hlSingle(el){' +
            'var ov=document.createElement("div");ov.className="__parser_chain_hl";' +
            'var tag=el.tagName.toUpperCase();' +
            'var isVoid=tag==="IMG"||tag==="INPUT"||tag==="BR"||tag==="HR"||tag==="SOURCE"||tag==="EMBED"||tag==="AREA";' +
            'if(!isVoid){' +
              'var oldPos=el.style.position;ov.__origPos=oldPos||"";' +
              'if(!oldPos||oldPos==="static")el.style.position="relative";' +
              'ov.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483630;border:2px solid #a78bfa;border-radius:2px;box-sizing:border-box;background:rgba(167,139,250,0.08)";' +
              'el.appendChild(ov);ov.__hostEl=el;' +
            '}else{' +
              'var parent=el.parentElement;if(!parent)return;' +
              'var oldPPos=parent.style.position;ov.__origParentPos=oldPPos||"";' +
              'if(!oldPPos||oldPPos==="static")parent.style.position="relative";' +
              'var er=el.getBoundingClientRect();var pr=parent.getBoundingClientRect();' +
              'ov.style.cssText="position:absolute;left:"+(er.left-pr.left)+"px;top:"+(er.top-pr.top)+"px;width:"+er.width+"px;height:"+er.height+"px;pointer-events:none;z-index:2147483630;border:2px solid #a78bfa;border-radius:2px;box-sizing:border-box;background:rgba(167,139,250,0.08)";' +
              'parent.appendChild(ov);ov.__hostEl=parent;' +
            '}' +
          '}' +
        '})()';
      } else {
        jsCode = '(function(){' +
          'try{var els=document.querySelectorAll(' + JSON.stringify(seg.selector) + ');' +
          'for(var k=0;k<Math.min(els.length,50);k++){hlSingle(els[k]);}' +
          '}catch(e){}' +
          'function hlSingle(el){' +
            'var ov=document.createElement("div");ov.className="__parser_chain_hl";' +
            'var tag=el.tagName.toUpperCase();' +
            'var isVoid=tag==="IMG"||tag==="INPUT"||tag==="BR"||tag==="HR"||tag==="SOURCE"||tag==="EMBED"||tag==="AREA";' +
            'if(!isVoid){' +
              'var oldPos=el.style.position;ov.__origPos=oldPos||"";' +
              'if(!oldPos||oldPos==="static")el.style.position="relative";' +
              'ov.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483630;border:2px solid #a78bfa;border-radius:2px;box-sizing:border-box;background:rgba(167,139,250,0.08)";' +
              'el.appendChild(ov);ov.__hostEl=el;' +
            '}else{' +
              'var parent=el.parentElement;if(!parent)return;' +
              'var oldPPos=parent.style.position;ov.__origParentPos=oldPPos||"";' +
              'if(!oldPPos||oldPPos==="static")parent.style.position="relative";' +
              'var er=el.getBoundingClientRect();var pr=parent.getBoundingClientRect();' +
              'ov.style.cssText="position:absolute;left:"+(er.left-pr.left)+"px;top:"+(er.top-pr.top)+"px;width:"+er.width+"px;height:"+er.height+"px;pointer-events:none;z-index:2147483630;border:2px solid #a78bfa;border-radius:2px;box-sizing:border-box;background:rgba(167,139,250,0.08)";' +
              'parent.appendChild(ov);ov.__hostEl=parent;' +
            '}' +
          '}' +
        '})()';
      }
      await webview.executeJavaScript(jsCode);
    } catch (e) {}
  }

  /** 渲染某层的提取属性行 */
  function renderExtractRows(idx) {
    var seg = Parser.state.chainSegments[idx];
    var exts = (seg && seg.extractions) ? seg.extractions : [];
    var attrOpts = guessChainAttrs(seg ? seg.tag : '');
    var html = '';
    exts.forEach(function(ex, ei) {
      html += '<div class="chain-attr-row" data-layer-idx="' + idx + '" data-extr="' + ei + '">';
      html += '<select class="chain-attr-select" data-idx="' + ei + '" data-layer-idx="' + idx + '">';
      attrOpts.forEach(function(opt) {
        var sel = (ex.attr === opt.value) ? ' selected' : '';
        html += '<option value="' + opt.value + '"' + sel + ' title="' + escapeHtml(opt.label) + '">' + opt.label + '</option>';
      });
      html += '</select>';
      html += '<input class="chain-extr-name-input" data-layer-idx="' + idx + '" data-extr="' + ei + '" value="' + escapeHtml(ex.name || '') + '" placeholder="字段名">';
      html += '<button class="btn-extr-remove" data-layer-idx="' + idx + '" data-extr="' + ei + '" title="移除">✕</button>';
      html += '</div>';
    });
    // 添加按钮（最后一行）
    html += '<button class="btn-extr-add" data-layer-idx="' + idx + '" style="font-size:11px;padding:1px 6px;margin-top:2px">+ 添加属性</button>';
    return html;
  }

  /* ================================================================
   *  链路树 —— 递归渲染（左面板）
   * ================================================================ */

  /** 通过路径获取节点数据 */
  function getChainNode(path) {
    // path: [0] = main seg 0; [0, 0, 1] = main seg 0 → subChain 0 → subSeg 1
    if (!path || !path.length) return null;
    var seg = Parser.state.chainSegments[path[0]];
    if (!seg) return null;
    for (var i = 1; i < path.length; i += 2) {
      var subIdx = path[i], subSegIdx = path[i + 1];
      var sc = (seg.subChains || [])[subIdx];
      if (!sc) return null;
      seg = (sc.chainSegments || [])[subSegIdx];
      if (!seg) return null;
    }
    return seg;
  }

  /** 通过嵌套 subChain 对象找到对应节点（用于 schema 加载回填） */
  function _findSubChainByPath(seg, subChainObj) {
    var sc = (seg.subChains || []).find(function(s) {
      return s.selector === subChainObj.selector && (s.chainType || 'css') === (subChainObj.chainType || 'css');
    });
    if (!sc || !sc.chainSegments) return null;
    var subSeg = sc.chainSegments[subChainObj.chainIndex];
    if (!subSeg) return null;
    if (subChainObj.subChain) {
      return _findSubChainByPath(subSeg, subChainObj.subChain);
    }
    return subSeg;
  }

  /** 递归渲染子树 */
  function _renderChainSubTree(path, depth, container) {
    var node = getChainNode(path);
    if (!node) return;
    // 兼容旧数据
    if (!node.extractions) {
      node.extractions = [];
      if (node.attr || node.name) { node.extractions.push({ attr: node.attr || '', name: node.name || '' }); delete node.attr; delete node.name; }
    }
    if (node.subChain && !node.subChains) { node.subChains = [node.subChain]; delete node.subChain; }
    if (!node.subChains) node.subChains = [];

    var isSelected = _chainsEqual(path, Parser.state._selectedChainPath);
    var hasChildren = node.subChains.length > 0;
    var isExpanded = hasChildren && (_isChainExpanded(path));

    // 行容器
    var row = document.createElement('div');
    row.className = 'chain-tree-node' + (isSelected ? ' selected' : '');
    row.dataset.path = JSON.stringify(path);
    row.addEventListener('click', function(e) {
      if (e.target.classList.contains('chain-tree-toggle')) return;
      selectChainTreeNode(path);
    });

    // 缩进: depth * 16px
    var indent = document.createElement('span');
    indent.className = 'chain-tree-node-indent';
    indent.style.width = (depth * 14) + 'px';
    row.appendChild(indent);

    // 层级色点
    var dot = document.createElement('span');
    var hasExtr = node.extractions && node.extractions.some(function(ex) { return ex.attr && ex.attr.trim(); });
    dot.className = 'chain-tree-depth-dot depth-' + Math.min(depth, 5) + (hasExtr ? ' has-extr' : '');
    dot.title = '层级 ' + (depth + 1);
    row.appendChild(dot);

    // 折叠/展开 toggle
    var toggle = document.createElement('span');
    toggle.className = 'chain-tree-toggle' + (hasChildren ? '' : ' leaf');
    toggle.textContent = hasChildren ? (isExpanded ? '▼' : '▶') : '';
    if (hasChildren) {
      toggle.addEventListener('click', function(ev) {
        ev.stopPropagation();
        _toggleChainExpand(path);
        renderChainTree();
      });
    }
    row.appendChild(toggle);

    // 选择器 —— 只显示最后一段（层级色块在缩进体现）
    var sel = document.createElement('span');
    sel.className = 'chain-tree-sel';
    var fullSel = node.selector || '';
    // 从累积选择器提取最后一段
    var lastPart = fullSel;
    if (lastPart.indexOf(' > ') > -1) {
      var pp = lastPart.split(' > ');
      lastPart = pp[pp.length - 1].trim();
    } else if (lastPart.indexOf('/') === 0) {
      var xp = lastPart.split('/');
      lastPart = xp[xp.length - 1] || lastPart;
    }
    sel.title = fullSel;
    sel.textContent = lastPart || '(无)';
    row.appendChild(sel);

    // 标签
    var tag = document.createElement('span');
    tag.className = 'chain-tree-tag';
    tag.textContent = node.tag ? '<' + node.tag + '>' : '?';
    row.appendChild(tag);

    // 匹配数
    var count = document.createElement('span');
    count.className = 'chain-tree-count chain-count-val';
    count.dataset.path = JSON.stringify(path);
    count.textContent = '-';
    row.appendChild(count);

    // 提取摘要标签
    var etags = document.createElement('span');
    etags.className = 'chain-tree-extracts';
    var exts = node.extractions || [];
    exts.forEach(function(ex) {
      if (!ex.attr || !ex.attr.trim()) return;
      var t = document.createElement('span');
      t.className = 'chain-tree-extract-tag';
      t.title = (ex.name || ex.attr);
      t.textContent = ex.name || ex.attr;
      etags.appendChild(t);
    });
    row.appendChild(etags);

    container.appendChild(row);

    // 递归渲染展开的子节点
    if (isExpanded && hasChildren) {
      node.subChains.forEach(function(sc, sci) {
        var scType = sc.chainType || 'css';
        // 子链路标题行
        var subRow = document.createElement('div');
        subRow.className = 'chain-tree-node';
        subRow.style.paddingLeft = ((depth + 1) * 14 + 4) + 'px';
        subRow.style.fontSize = '11px';
        subRow.style.color = 'var(--accent)';
        subRow.style.fontStyle = 'italic';
        subRow.style.borderBottom = 'none';
        subRow.textContent = (scType === 'xpath' ? '//' : '') + (sc.selector || '(空)');
        var subPath = path.concat([sci, 'header']);
        subRow.dataset.path = JSON.stringify(subPath);
        subRow.addEventListener('click', function() { selectChainTreeNode(subPath); });
        container.appendChild(subRow);

        // 子链路的段 (chainSegments)
        (sc.chainSegments || []).forEach(function(ss, ssi) {
          _renderChainSubTree(path.concat([sci, ssi]), depth + 2, container);
        });
      });
    }
  }

  /** 主树渲染入口 */
  function renderChainTree() {
    if (!schemaChainLayers) return;
    schemaChainLayers.innerHTML = '';
    if (!Parser.state.chainSegments || !Parser.state.chainSegments.length) {
      schemaChainLayers.innerHTML = '<div class="tree-empty">输入链路后点击"解析"</div>';
      return;
    }
    // 兼容旧数据 + 递归去重
    function _cleanSeg(seg) {
      if (!seg.extractions) { seg.extractions = []; if (seg.attr || seg.name) { seg.extractions.push({ attr: seg.attr || '', name: seg.name || '' }); delete seg.attr; delete seg.name; } }
      if (seg.subChain && !seg.subChains) { seg.subChains = [seg.subChain]; delete seg.subChain; }
      if (!seg.subChains) seg.subChains = [];
      // 去重：同名优先保留 $childText
      seg.extractions = seg.extractions.filter(function(e, i, arr) {
        var sameName = arr.filter(function(x) { return x.name === e.name && x !== e; });
        if (sameName.length === 0) return true;
        // 有重名：$childText 优先，删掉 $text
        return !sameName.some(function(x) { return x.attr === '$childText'; });
      });
      // 递归清理子链路
      (seg.subChains || []).forEach(function(sc) {
        (sc.chainSegments || []).forEach(_cleanSeg);
      });
    }
    Parser.state.chainSegments.forEach(_cleanSeg);
    Parser.state.chainSegments.forEach(function(seg, i) {
      _renderChainSubTree([i], 0, schemaChainLayers);
    });
    autoRefreshChainPreview();
  }

  /** 选中树节点 → 渲染编辑器 */
  function selectChainTreeNode(path) {
    Parser.state._selectedChainPath = path;
    renderChainTree();
    renderChainEditor(path);
  }

  function _chainsEqual(a, b) {
    if (!a || !b) return a === b;
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
    return true;
  }

  var _expandedChains = {};
  function _isChainExpanded(path) {
    var key = JSON.stringify(path);
    if (!(key in _expandedChains)) _expandedChains[key] = true; // 默认展开
    return _expandedChains[key];
  }
  function _toggleChainExpand(path) {
    var key = JSON.stringify(path);
    _expandedChains[key] = !_isChainExpanded(path);
  }

  /** 构建节点的完整选择器（用于属性预览） */
  function getFullNodeSelector(path) {
    if (!path || !path.length) return '';
    var mainSeg = Parser.state.chainSegments[path[0]];
    if (!mainSeg || !mainSeg.selector) return '';

    // 主线层直接用存储的累积选择器
    if (path.length === 1) return mainSeg.selector;

    // 子链路节点：从主线层开始逐段拼接
    var isXPath = mainSeg.selector.indexOf('//') === 0;
    var sep = isXPath ? '/' : ' > ';

    var parts = isXPath
      ? mainSeg.selector.replace(/^\/\//, '').split('/').filter(Boolean)
      : mainSeg.selector.split('>').map(function(s) { return s.trim(); }).filter(Boolean);

    var seg = mainSeg;
    for (var i = 1; i < path.length; i += 2) {
      var subIdx = path[i], subSegIdx = path[i + 1];
      var sc = (seg.subChains || [])[subIdx];
      if (!sc) break;
      var subSeg = (sc.chainSegments || [])[subSegIdx];
      if (!subSeg || !subSeg.selector) break;
      parts.push(subSeg.selector);
      seg = subSeg;
    }
    return isXPath ? '//' + parts.join('/') : parts.join(' > ');
  }

  /** 返回 sub-chain 节点的相对选择器（不含主链路前缀） */
  function getRelativeSelector(path) {
    // path 形如 [7, 0, 0] 表示 mainSeg 7 下 subChain 0 的 segment 0
    if (path.length <= 1) return '';
    var mainSeg = Parser.state.chainSegments[path[0]];
    if (!mainSeg) return '';
    var seg = mainSeg;
    var lastPart = '';
    for (var i = 1; i < path.length; i += 2) {
      var subIdx = path[i], subSegIdx = path[i + 1];
      var sc = (seg.subChains || [])[subIdx];
      if (!sc) break;
      var subSeg = (sc.chainSegments || [])[subSegIdx];
      if (!subSeg || !subSeg.selector) break;
      lastPart = subSeg.selector;
      seg = subSeg;
    }
    return lastPart;
  }

  /** 查询节点的属性预览
   *  fullSelector: null 时，parentSelector 为 JSON 数组 [rootSel, subSel1, subSel2, ...]
   *  此时用递归上下文查询：root → sub1 → sub2 → ...，最后一层的结果返回
   */
  async function fetchNodePreview(fullSelector, parentSelector) {
    var selChain = null;
    // 检测是否传入选择器链（JSON 数组字符串）
    if (parentSelector && typeof parentSelector === 'string' && parentSelector.charAt(0) === '[') {
      try { selChain = JSON.parse(parentSelector); } catch (e) { selChain = null; }
    }
    if (!fullSelector && selChain && selChain.length >= 2) {
      // 选择器链：层层递归 querySelectorAll
      // chain[0] 是主链路可靠选择器，chain[1...] 是各层子链路的相对选择器
      var jsCode = '(function(){' +
        'var chain=' + JSON.stringify(selChain) + ';' +
        'var limit=' + Parser.state.chainPreviewLimit + ';' +
        'function queryInParents(roots, relSel){' +
          'var found=[];' +
          'for(var i=0;i<Math.min(roots.length,20);i++){' +
            'try{' +
              'var children=roots[i].querySelectorAll(relSel);' +
              'for(var j=0;j<Math.min(children.length,limit);j++){found.push(children[j]);}' +
            '}catch(e){}' +
          '}' +
          'return found;' +
        '}' +
        'try{var cur=document.querySelectorAll(chain[0]);}catch(e){return [];}' +
        'var arr=Array.prototype.slice.call(cur);' +
        'for(var k=1;k<chain.length;k++){arr=queryInParents(arr,chain[k]);if(arr.length===0)break;}' +
        'var result=[];' +
        'for(var i=0;i<Math.min(arr.length,limit);i++){' +
          'var el=arr[i];' +
          'var attrs={};' +
          'for(var j=0;j<el.attributes.length;j++){var a=el.attributes[j];attrs[a.name]=a.value;}' +
          'var text=(el.textContent||"").replace(/\\\\s+/g," ").trim();' +
          'result.push({tag:el.tagName.toLowerCase(),attrs:attrs,text:text,childCount:el.children.length});' +
        '}' +
        'return result;' +
      '})()';
      try {
        var data = await webview.executeJavaScript(jsCode);
        return data || [];
      } catch (e) { return []; }
    }
    var isXPath = (fullSelector || '').indexOf('//') === 0;
    try {
      var jsCode;
      if (isXPath) {
        jsCode = '(function(){' +
          'var sel=' + JSON.stringify(fullSelector) + ';' +
          'try{var snapshot=document.evaluate(sel,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);}catch(e){return [];}' +
          'var els=[];' +
          'for(var k=0;k<snapshot.snapshotLength;k++){els.push(snapshot.snapshotItem(k));}' +
          'var result=[];' +
          'for(var i=0;i<Math.min(els.length,' + Parser.state.chainPreviewLimit + ');i++){' +
            'var el=els[i];' +
            'if(el.nodeType!==1)continue;' +
            'var attrs={};' +
            'for(var j=0;j<el.attributes.length;j++){var a=el.attributes[j];attrs[a.name]=a.value;}' +
            'var text=(el.textContent||"").replace(/\\\\s+/g," ").trim();' +
            'result.push({tag:el.tagName.toLowerCase(),attrs:attrs,text:text,childCount:el.children.length});' +
          '}' +
          'return result;' +
        '})()';
      } else {
        jsCode = '(function(){' +
          'var sel=' + JSON.stringify(fullSelector) + ';' +
          'try{var els=document.querySelectorAll(sel);}catch(e){return [];}' +
          'var result=[];' +
          'for(var i=0;i<Math.min(els.length,' + Parser.state.chainPreviewLimit + ');i++){' +
            'var el=els[i];' +
            'var attrs={};' +
            'for(var j=0;j<el.attributes.length;j++){var a=el.attributes[j];attrs[a.name]=a.value;}' +
            'var text=(el.textContent||"").replace(/\\\\s+/g," ").trim();' +
            'result.push({tag:el.tagName.toLowerCase(),attrs:attrs,text:text,childCount:el.children.length});' +
          '}' +
          'return result;' +
        '})()';
      }
      var data = await webview.executeJavaScript(jsCode);
      return data || [];
    } catch (e) { return []; }
  }

  /* ================================================================
   *  节点编辑器（右面板）
   * ================================================================ */

  /** 重新绑定提取属性区域事件（动态增删后调用，适配路径系统） */
  function bindChainExtractEvents(section, path) {
    if (!section) return;
    section.querySelectorAll('.chain-attr-select').forEach(function(sel) {
      sel._prevValue = sel.value || '';
      sel.addEventListener('change', function() {
        var extrIdx = parseInt(this.dataset.idx);
        var node = getChainNode(path);
        if (!node || !node.extractions || !node.extractions[extrIdx]) return;
        var ext = node.extractions[extrIdx];
        if (this.value === '__custom__') {
          handleCustomAttr(this, function(val) {
            ext.attr = val;
            autoRefreshChainPreview();
            renderChainTree();
          });
        } else {
          this._prevValue = this.value;
          ext.attr = this.value;
          autoRefreshChainPreview();
          renderChainTree();
        }
      });
    });
    section.querySelectorAll('.chain-extr-name-input').forEach(function(inp) {
      inp.addEventListener('blur', function() {
        var extrIdx = parseInt(this.dataset.extr);
        var node = getChainNode(path);
        if (node && node.extractions && node.extractions[extrIdx]) {
          node.extractions[extrIdx].name = this.value.trim();
          autoRefreshChainPreview();
          renderChainTree();
        }
      });
    });
    section.querySelectorAll('.btn-extr-add').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var node = getChainNode(path);
        if (!node) return;
        if (!node.extractions) node.extractions = [];
        node.extractions.push({ attr: '', name: '' });
        renderChainEditor(path);
        renderChainTree();
        autoRefreshChainPreview();
      });
    });
    section.querySelectorAll('.btn-extr-remove').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var extrIdx = parseInt(this.dataset.extr);
        var node = getChainNode(path);
        if (node && node.extractions) node.extractions.splice(extrIdx, 1);
        renderChainEditor(path);
        renderChainTree();
        autoRefreshChainPreview();
      });
    });
    // 匹配限制下拉
    var matchLimit = section.querySelector('#chainMatchLimit');
    var customInput = section.querySelector('#chainMatchCustom');
    if (matchLimit) {
      matchLimit.addEventListener('change', function(e) {
        e.stopPropagation();
        var v = parseInt(this.value);
        if (v === -2) {
          // 自定义 → 显示输入框
          if (customInput) {
            customInput.style.display = '';
            customInput.value = (node.matchLimit > 3 ? node.matchLimit : '');
            customInput.focus();
          }
          return;
        }
        if (customInput) customInput.style.display = 'none';
        var node = getChainNode(path);
        if (node) {
          node.matchLimit = (v > 0 ? v : (v === -1 ? -1 : 0));
          _rebuildChainInputWithLimits();
          parseChain();
          selectChainTreeNode(path);
        }
      });
    }
    if (customInput) {
      customInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var n = parseInt(this.value);
          if (n && n > 0) {
            var node = getChainNode(path);
            if (node) {
              node.matchLimit = n;
              _rebuildChainInputWithLimits();
              parseChain();
              selectChainTreeNode(path);
            }
          }
        }
        if (e.key === 'Escape') { this.style.display = 'none'; matchLimit.value = '0'; }
      });
      customInput.addEventListener('blur', function() {
        // 鼠标离开也确认
        var n = parseInt(this.value);
        if (n && n > 0) {
          var node = getChainNode(path);
          if (node) {
            node.matchLimit = n;
            _rebuildChainInputWithLimits();
            parseChain();
            selectChainTreeNode(path);
          }
        }
      });
    }
  }

  /** 渲染节点编辑器（右面板） */
  function renderChainEditor(path) {
    var titleEl = document.getElementById('chainEditorTitle');
    var bodyEl = document.getElementById('chainEditorBody');
    if (!titleEl || !bodyEl) return;

    var node = getChainNode(path);
    if (!node) {
      titleEl.textContent = '← 点击左侧节点编辑';
      bodyEl.innerHTML = '<div class="tree-empty">选择一个节点开始配置提取属性</div>';
      return;
    }

    // 面包屑 → 构建可复制的 CSS 选择器（含匹配限制）
    var cssParts = [];
    var seg = Parser.state.chainSegments[path[0]];
    if (seg) {
      var mainSel = seg.selector || '';
      var mainParts = mainSel.indexOf(' > ') > -1 ? mainSel.split(' > ') : [mainSel];
      var lp = mainParts[mainParts.length - 1].trim();
      lp = _applyMatchLimit(lp, seg.matchLimit || 0);
      cssParts.push(lp);
    }
    for (var i = 1; i < path.length; i += 2) {
      var subIdx = path[i];
      if (!seg || !seg.subChains || !seg.subChains[subIdx]) break;
      var sc = seg.subChains[subIdx];
      var sl = sc.selector || '';
      seg = (sc.chainSegments || [])[path[i + 1]];
      if (seg) {
        sl = _applyMatchLimit(sl, seg.matchLimit || 0);
      }
      cssParts.push(sl);
    }
    var fullCss = cssParts.filter(Boolean).join(' > ');
    titleEl.innerHTML =
      '<span class="chain-editor-path-css" title="点击复制" data-css="' + escapeHtml(fullCss) + '">' +
        escapeHtml(fullCss) +
      '</span>' +
      '<button class="chain-editor-copy-btn" title="复制 CSS 选择器" style="margin-left:6px;font-size:11px;padding:1px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-card);color:var(--accent);cursor:pointer">📋</button>';

    // 复制按钮事件
    setTimeout(function() {
      var copyBtn = titleEl.querySelector('.chain-editor-copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          var css = fullCss;
          navigator.clipboard.writeText(css).then(function() {
            copyBtn.textContent = '✓';
            setTimeout(function() { copyBtn.textContent = '📋'; }, 1500);
          }).catch(function() {
            // fallback
            var ta = document.createElement('textarea');
            ta.value = css; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
            copyBtn.textContent = '✓';
            setTimeout(function() { copyBtn.textContent = '📋'; }, 1500);
          });
        });
      }
      var cssEl = titleEl.querySelector('.chain-editor-path-css');
      if (cssEl) {
        cssEl.addEventListener('click', function() {
          navigator.clipboard.writeText(fullCss).catch(function(){});
        });
      }
    }, 0);

    var html = '';

    // 选择器信息 + 预览
    html += '<div style="margin-bottom:8px;font-size:12px;color:var(--text-dim)">';
    html += '<span style="font-family:Consolas,monospace;color:var(--accent)">' + escapeHtml(_applyMatchLimit(node.selector || '', node.matchLimit || 0)) + '</span>';
    if (node.tag) html += ' <span style="font-family:Consolas,monospace;font-size:11px">' + escapeHtml('<' + node.tag + '>') + '</span>';
    html += '</div>';

    // 属性预览区域
    html += '<div id="chainNodePreview" style="margin-bottom:12px;max-height:200px;overflow-y:auto;background:rgba(0,0,0,0.08);border-radius:3px;padding:6px 8px;font-size:11px">';
    html += '<div style="color:var(--text-dim);font-size:10px">加载属性中...</div>';
    html += '</div>';

    // 提取属性区域
    html += '<div class="chain-extract-section" style="padding-left:0">';
    html += '<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;font-weight:600">提取属性</div>';
    // 匹配限制
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">';
    html += '<span style="font-size:10px;color:var(--text-dim)">限定匹配:</span>';
    var ml = node.matchLimit || 0;
    html += '<select id="chainMatchLimit" class="chain-tree-match-limit" style="font-size:11px;height:26px;width:100px;flex-shrink:0">';
    html += '<option value="0"' + (ml===0?' selected':'') + '>全部</option>';
    html += '<option value="1"' + (ml===1?' selected':'') + '>:nth-of-type(1)</option>';
    html += '<option value="2"' + (ml===2?' selected':'') + '>:nth-of-type(2)</option>';
    html += '<option value="3"' + (ml===3?' selected':'') + '>:nth-of-type(3)</option>';
    html += '<option value="-1"' + (ml===-1?' selected':'') + '>:last-of-type</option>';
    html += (ml > 3 ? '<option value="' + ml + '" selected>:nth-of-type(' + ml + ')</option>' : '');
    html += '<option value="-2">自定义…</option>';
    html += '</select>';
    html += '<input type="number" id="chainMatchCustom" placeholder="N" min="1" style="display:none;width:40px;height:22px;font-size:10px;border:1px solid var(--border);border-radius:2px;background:var(--bg-input);color:var(--text);text-align:center">';
    html += '</div>';
    var exts = node.extractions || [];
    exts.forEach(function(ex, ei) {
      var opts = guessChainAttrs(node.tag);
      var attrSelectHtml = '<select class="chain-attr-select" data-idx="' + ei + '" style="font-size:11px;height:26px;width:100px;flex-shrink:0">';
      opts.forEach(function(opt) {
        var sel = (ex.attr === opt.value || (!ex.attr && opt.value === '')) ? ' selected' : '';
        attrSelectHtml += '<option value="' + opt.value + '"' + sel + '>' + opt.label + '</option>';
      });
      // 如果当前值不在预设中，显示自定义
      if (ex.attr && ex.attr !== '$text' && !opts.some(function(o) { return o.value === ex.attr; })) {
        attrSelectHtml += '<option value="' + ex.attr + '" selected>' + ex.attr + '</option>';
      }
      attrSelectHtml += '</select>';
      html += '<div class="chain-attr-row">';
      html += '<span style="font-size:11px;color:var(--text-dim);width:40px;flex-shrink:0">提取:</span>';
      html += attrSelectHtml;
      html += '<input class="chain-extr-name-input" data-extr="' + ei + '" value="' + escapeHtml(ex.name || '') + '" placeholder="字段名">';
      html += '<button class="btn-extr-remove" data-extr="' + ei + '" title="移除" style="font-size:11px;padding:0 6px;height:24px;border:none;background:transparent;color:var(--text-dim);cursor:pointer">✕</button>';
      html += '</div>';
      // $childText 类型：显示子元素选择器和分隔符
      if (ex.attr === '$childText') {
        html += '<div class="chain-childtext-info" style="margin-left:40px;margin-bottom:6px;font-size:10px;color:var(--text-dim);display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
        html += '<span>子元素:</span>';
        html += '<code class="copy-sel" title="点击复制 | ' + escapeHtml((ex.childSelectors || []).join(', ')) + '" style="font-family:Consolas,monospace;color:var(--accent);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" onclick="event.stopPropagation();var t=this.textContent;navigator.clipboard.writeText(t).catch(function(){var ta=document.createElement(\'textarea\');ta.value=t;ta.style.cssText=\'position:fixed;opacity:0\';document.body.appendChild(ta);ta.select();document.execCommand(\'copy\');document.body.removeChild(ta)});var o=this.textContent;this.textContent=\'\\u2713 已复制\';var s=this;setTimeout(function(){s.textContent=o},1200)">' + escapeHtml((ex.childSelectors || []).join(', ') || '(无)') + '</code>';
        html += '<span>分隔符:</span><code style="font-size:10px;background:var(--bg-tertiary);padding:0 4px;border-radius:2px">' + escapeHtml(ex.childDelimiter || '(空)') + '</code>';
        html += '</div>';
      }
    });
    html += '<button class="btn-extr-add" style="font-size:11px;padding:2px 10px;margin-top:4px;border:1px dashed var(--border);border-radius:3px;background:transparent;color:var(--text-dim);cursor:pointer;font-family:inherit">+ 添加属性</button>';
    html += '</div>';

    // 子链路管理
    html += '<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html += '<span style="font-size:11px;color:var(--text-dim);font-weight:600">子链路</span>';
    html += '<button class="btn-add-subchain-editor" style="font-size:11px;padding:2px 10px;border:1px dashed var(--accent);border-radius:3px;background:transparent;color:var(--accent);cursor:pointer;font-family:inherit">+ 添加子链路</button>';
    html += '</div>';
    var subChains = node.subChains || [];
    if (subChains.length > 0) {
      subChains.forEach(function(sc, sci) {
        var scType = sc.chainType || 'css';
        html += '<div class="chain-sub-item-editor" style="display:flex;align-items:center;gap:4px;margin-bottom:6px;padding:6px 8px;background:var(--bg-card);border-radius:3px;border:1px solid var(--border)">';
        html += '<span style="font-size:10px;color:var(--accent);flex-shrink:0">Sub' + (sci + 1) + '</span>';
        html += '<button class="schema-subtype-btn' + (scType === 'css' ? ' active' : '') + '" data-sub-type-edit="css" data-sidx="' + sci + '" style="height:22px;font-size:10px;padding:0 8px">CSS</button>';
        html += '<button class="schema-subtype-btn' + (scType === 'xpath' ? ' active' : '') + '" data-sub-type-edit="xpath" data-sidx="' + sci + '" style="height:22px;font-size:10px;padding:0 8px">XP</button>';
        html += '<input class="chain-sub-sel-input-editor" data-sidx="' + sci + '" value="' + escapeHtml(sc.selector || '') + '" placeholder="相对选择器" style="flex:1;height:24px;font-size:11px;font-family:Consolas,monospace;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--text);padding:0 4px;min-width:80px">';
        html += '<button class="btn-subchain-clipboard" data-sidx="' + sci + '" title="从剪贴板选择选择器（多选=逗号合并）" style="font-size:12px;padding:0 4px;height:22px;border:1px solid var(--border);border-radius:3px;background:var(--bg-card);color:var(--text-dim);cursor:pointer;font-family:inherit;flex-shrink:0">📋</button>';
        var isScParsed = sc.chainSegments && sc.chainSegments.length > 0;
        html += '<button class="btn-parse-subchain-editor" data-sidx="' + sci + '" style="font-size:10px;padding:1px 8px;height:22px;cursor:pointer;'
          + (isScParsed ? 'background:#22c55e;color:#fff;' : 'background:var(--accent);color:#fff;')
          + 'border:none;border-radius:3px;font-family:inherit">' + (isScParsed ? '✓' : '解析') + '</button>';
        html += '<button class="btn-remove-subchain-editor" data-sidx="' + sci + '" style="font-size:12px;padding:0 4px;height:22px;border:none;background:transparent;color:var(--text-dim);cursor:pointer">✕</button>';
        html += '</div>';
      });
    } else {
      html += '<div style="font-size:11px;color:var(--text-dim);padding:4px 0">暂无子链路，点击上方按钮添加</div>';
    }
    html += '</div>';

    bodyEl.innerHTML = html;

    // 绑定事件
    bindChainExtractEvents(bodyEl, path);

    // 子链路类型切换
    bodyEl.querySelectorAll('.schema-subtype-btn[data-sub-type-edit]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var subType = this.dataset.subTypeEdit;
        var sci = parseInt(this.dataset.sidx);
        var sc = (node.subChains || [])[sci];
        if (sc) { sc.chainType = subType; renderChainEditor(path); }
      });
    });
    // 子链路选择器输入 Enter / 内容变更
    bodyEl.querySelectorAll('.chain-sub-sel-input-editor').forEach(function(inp) {
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { var sci = parseInt(this.dataset.sidx); parseSubChainInEditor(path, sci); }
      });
      inp.addEventListener('input', function() {
        var sci = parseInt(this.dataset.sidx);
        var sc = (node.subChains || [])[sci];
        if (sc) { sc.chainSegments = []; renderChainEditor(path); }
      });
    });
    // 解析子链路
    bodyEl.querySelectorAll('.btn-parse-subchain-editor').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sci = parseInt(this.dataset.sidx);
        parseSubChainInEditor(path, sci);
      });
    });
    // 删除子链路
    bodyEl.querySelectorAll('.btn-remove-subchain-editor').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sci = parseInt(this.dataset.sidx);
        if (node.subChains) { node.subChains.splice(sci, 1); }
        renderChainTree();
        renderChainEditor(path);
        autoRefreshChainPreview();
      });
    });
    // 子链路剪贴板选择
    bodyEl.querySelectorAll('.btn-subchain-clipboard').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sci = parseInt(this.dataset.sidx);
        var inp = bodyEl.querySelector('.chain-sub-sel-input-editor[data-sidx="' + sci + '"]');
        _showSubChainClipboardPicker(sci, inp);
      });
    });
    // 添加子链路
    var addBtn = bodyEl.querySelector('.btn-add-subchain-editor');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        if (!node.subChains) node.subChains = [];
        node.subChains.push({ selector: '', chainType: getChainType(), chainSegments: [] });
        renderChainEditor(path);
        renderChainTree();
      });
    }

    // 异步加载属性预览
    // 子链路节点：递归找到主链路祖先，用选择器链层层查询，避免简单拼接失败
    var fullSel = getFullNodeSelector(path);
    var parentSel = null;
    if (path.length > 1 && path.length % 2 === 1) {
      // 向上追溯到主链路祖先 + 收集中途的子链路选择器
      var selChain = [];
      var curP = path;
      while (curP.length > 1) {
        selChain.unshift(getRelativeSelector(curP));  // 当前层的相对选择器
        curP = curP.slice(0, curP.length - 2);        // 上移
      }
      if (curP.length === 1 && path[0] === curP[0]) {
        // curP 是主链路节点，其 fullSel 可靠；chain 是从主链路往下各层的相对选择器
        var rootSel = getFullNodeSelector(curP);
        selChain.unshift(rootSel);
        fullSel = null; // 不用 fullSel，改用 chain 内最后一段
        parentSel = JSON.stringify(selChain);
      }
    }
    if (fullSel || parentSel) {
      var isXP = (fullSel || '').indexOf('//') === 0;
      fetchNodePreview(fullSel, parentSel).then(function(data) {
        var previewEl = document.getElementById('chainNodePreview');
        if (!previewEl) return;
        previewEl.innerHTML = renderLayerPreviewHTML(data);
        // 绑定子元素浏览按钮
        previewEl.querySelectorAll('.btn-preview-children').forEach(function(btn) {
          btn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var elIdx = parseInt(this.dataset.elIdx);
            var childList = this.parentElement.querySelector('.child-list');
            if (childList) { childList.remove(); this.textContent = '▶'; return; }
            this.textContent = '▼';
            var listDiv = document.createElement('div');
            listDiv.className = 'child-list';
            listDiv.innerHTML = '<div style="font-size:10px;color:var(--text-dim);padding:2px 0">加载中...</div>';
            this.parentElement.appendChild(listDiv);
            var childJS;
            if (parentSel && typeof parentSel === 'string' && parentSel.charAt(0) === '[') {
              // 选择器链：用同一套递归查询定位到指定索引的元素再取子元素
              childJS = '(function(){' +
                'var chain=' + parentSel + ';' +
                'var limit=' + Parser.state.chainPreviewLimit + ';' +
                'var idx=' + elIdx + ';' +
                'function queryInParents(roots, relSel){' +
                  'var found=[];' +
                  'for(var i=0;i<Math.min(roots.length,20);i++){' +
                    'try{' +
                      'var children=roots[i].querySelectorAll(relSel);' +
                      'for(var j=0;j<Math.min(children.length,limit);j++){found.push(children[j]);}' +
                    '}catch(e){}' +
                  '}' +
                  'return found;' +
                '}' +
                'try{var cur=document.querySelectorAll(chain[0]);}catch(e){return[];}' +
                'var arr=Array.prototype.slice.call(cur);' +
                'for(var k=1;k<chain.length;k++){arr=queryInParents(arr,chain[k]);if(arr.length===0)break;}' +
                'var n=arr[idx];if(!n||n.nodeType!==1)return[];' +
                'var children=[];' +
                'for(var i=0;i<Math.min(n.children.length,20);i++){' +
                  'var c=n.children[i];children.push({tag:c.tagName.toLowerCase(),id:c.id,cls:c.className,text:(c.textContent||"").replace(/\\\\s+/g," ").trim().substring(0,80),childCount:c.children.length});' +
                '}' +
                'return children;' +
              '})()';
            } else {
              childJS = isXP
              ? '(function(){try{var snap=document.evaluate(' + JSON.stringify(fullSel) + ',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);' +
                'var n=snap.snapshotItem(' + elIdx + ');if(!n||n.nodeType!==1)return[];' +
                'var children=[];for(var i=0;i<Math.min(n.children.length,20);i++){' +
                  'var c=n.children[i];children.push({tag:c.tagName.toLowerCase(),id:c.id,cls:c.className,text:(c.textContent||"").replace(/\\\\s+/g," ").trim().substring(0,80),childCount:c.children.length});' +
                '}return children;' +
              '}catch(e){return[];}})()'
              : '(function(){try{var els=document.querySelectorAll(' + JSON.stringify(fullSel) + ');' +
                'var n=els[' + elIdx + '];if(!n)return[];' +
                'var children=[];for(var i=0;i<Math.min(n.children.length,20);i++){' +
                  'var c=n.children[i];children.push({tag:c.tagName.toLowerCase(),id:c.id,cls:c.className,text:(c.textContent||"").replace(/\\\\s+/g," ").trim().substring(0,80),childCount:c.children.length});' +
                '}return children;' +
              '}catch(e){return[];}})()';
            }
            webview.executeJavaScript(childJS).then(function(children) {
              listDiv.innerHTML = renderChildListHTML(children || [], 0, elIdx);
              var actionBar = listDiv.querySelector('.child-action-bar');
              var _selected = [];
              var _clickSeq = {};
              var _nextSeq = 0;
              function _reorderSel() {
                _selected.sort(function(a, b) { return (_clickSeq[a] || 999) - (_clickSeq[b] || 999); });
              }
              function updateActionBar() {
                var count = _selected.length;
                if (actionBar) {
                  actionBar.style.display = count > 0 ? 'flex' : 'none';
                }
              }
              listDiv.querySelectorAll('.child-selectable').forEach(function(item) {
                item.addEventListener('click', function(ev2) {
                  // Ctrl/Meta+点击 → 挖深提取（添加单条子链路）
                  if (ev2.ctrlKey || ev2.metaKey) {
                    ev2.stopPropagation();
                    var sel = this.dataset.sel;
                    if (!sel) return;
                    if (!node.subChains) node.subChains = [];
                    node.subChains.push({ selector: sel, chainType: 'css', chainSegments: [] });
                    renderChainTree();
                    renderChainEditor(path);
                    autoRefreshChainPreview();
                    return;
                  }
                  // 普通点击 → 切换选中（数组记录点击顺序）
                  ev2.stopPropagation();
                  var ci = this.dataset.ci;
                  var idx = _selected.indexOf(ci);
                  if (idx >= 0) { _selected.splice(idx, 1); } else {
                    if (!(ci in _clickSeq)) { _clickSeq[ci] = ++_nextSeq; }
                    _selected.push(ci);
                    _reorderSel();
                  }
                  var chk = this.querySelector('.child-check');
                  if (idx < 0) {
                    this.style.borderColor = 'var(--accent)';
                    this.style.background = 'rgba(88,166,255,0.08)';
                    if (chk) { chk.style.borderColor = 'var(--accent)'; chk.style.background = 'var(--accent)'; chk.textContent = '✓'; chk.style.color = '#fff'; }
                  } else {
                    this.style.borderColor = 'transparent';
                    this.style.background = '';
                    if (chk) { chk.style.borderColor = 'var(--border)'; chk.style.background = ''; chk.textContent = ''; }
                  }
                  updateActionBar();
                });
              });
              // 合并提取
              var mergeBtn = listDiv.querySelector('.child-action-merge');
              if (mergeBtn) mergeBtn.addEventListener('click', function(ev2) {
                ev2.stopPropagation();
                var sels = _selected;
                if (!sels.length) return;
                var fieldName = (actionBar.querySelector('.child-action-name').value || '').trim();
                var delim = (actionBar.querySelector('.child-action-delim').value || '');
                if (!fieldName) { actionBar.querySelector('.child-action-name').style.borderColor = 'var(--red)'; return; }
                if (!node.extractions) node.extractions = [];
                var childSels = sels.map(function(k) {
                  var baseSel = listDiv.querySelector('.child-selectable[data-ci="' + k + '"]').dataset.sel;
                  return baseSel + ':nth-child(' + (parseInt(k) + 1) + ')';
                });
                node.extractions.push({ attr: '$childText', name: fieldName, childSelectors: childSels, childDelimiter: delim });
                renderChainTree();
                renderChainEditor(path);
                autoRefreshChainPreview();
              });
              // 添加子链路（多选）
              var digBtn = listDiv.querySelector('.child-action-dig');
              if (digBtn) {
                digBtn.addEventListener('click', function(ev2) {
                  ev2.stopPropagation();
                  var sels = _selected;
                  if (!sels.length) return;
                  if (!node.subChains) node.subChains = [];
                  sels.forEach(function(k) {
                    var el = listDiv.querySelector('.child-selectable[data-ci="' + k + '"]');
                    if (!el) return;
                    var sel = el.dataset.sel + ':nth-child(' + (parseInt(k) + 1) + ')';
                    var parts = sel.split('>').map(function(s) { return s.trim(); }).filter(Boolean);
                    if (parts.length === 0) return;
                    var sc = { selector: sel, chainType: 'css', chainSegments: [] };
                    for (var pi = 0; pi < parts.length; pi++) {
                      var tagMatch = parts[pi].match(/^[.#]?([a-zA-Z][a-zA-Z0-9]*)/);
                      sc.chainSegments.push({ selector: parts[pi], tag: tagMatch ? tagMatch[1].toLowerCase() : '', extractions: [] });
                    }
                    node.subChains.push(sc);
                  });
                  var parentKey = JSON.stringify(path);
                  _expandedChains[parentKey] = true;
                  renderChainTree();
                  renderChainEditor(path);
                  autoRefreshChainPreview();
                });
              }
            }).catch(function() {
              listDiv.innerHTML = '<div style="font-size:10px;color:var(--red)">加载失败</div>';
            });
          });
        });
      }).catch(function() {
        var previewEl = document.getElementById('chainNodePreview');
        if (previewEl) previewEl.innerHTML = '<div style="color:var(--text-dim);font-size:10px">预览加载失败</div>';
      });
    }
  }

  /** 通用剪贴板多选弹窗：勾选条目 → 逗号合并填入目标输入框 */
  function _showClipboardMultiPicker(targetInput, label, anchorBtn) {
    var history = Parser.state.clipboardHistory || [];
    if (history.length === 0) {
      Parser.utils.showToast('剪贴板为空，请先在提取结果中 Ctrl+C 复制选择器');
      return;
    }
    // 移除旧弹窗
    var old = document.querySelector('.clipboard-multi-popup');
    if (old) old.remove();

    var popup = document.createElement('div');
    popup.className = 'clipboard-multi-popup';
    popup.style.cssText = 'position:fixed;z-index:99999;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.3);max-width:480px;max-height:360px;overflow-y:auto;padding:8px;';

    var labelText = label || '选择器';
    var html = '<div style="font-size:12px;color:var(--text-dim);padding:4px 8px;margin-bottom:4px;border-bottom:1px solid var(--border)">📋 勾选条目加入「' + labelText + '」（多选将用逗号合并）</div>';

    history.forEach(function(item, i) {
      var sel = (item.text || '').trim();
      if (!sel) return;
      var preview = sel.length > 70 ? sel.substring(0, 70) + '...' : sel;
      html += '<label class="clipboard-check-item" data-idx="' + i + '" style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;font-size:11px;font-family:Consolas,monospace">';
      html += '<input type="checkbox" class="cb-check" style="margin:0;flex-shrink:0">';
      html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(preview) + '</span>';
      html += '<span style="font-size:10px;color:var(--text-dim);flex-shrink:0">' + escapeHtml(item.source || '') + '</span>';
      html += '</label>';
    });

    html += '<div style="display:flex;gap:6px;padding:8px 0 0;border-top:1px solid var(--border);margin-top:4px">';
    html += '<button class="btn-popup-cancel" style="flex:1;font-size:11px;padding:4px 12px;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text-dim);cursor:pointer;font-family:inherit">取消</button>';
    html += '<button class="btn-popup-fill" style="flex:1;font-size:11px;padding:4px 12px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:inherit">填入选择器</button>';
    html += '</div>';

    popup.innerHTML = html;
    document.body.appendChild(popup);

    // 定位弹窗
    if (anchorBtn) {
      var rect = anchorBtn.getBoundingClientRect();
      popup.style.left = Math.min(rect.left, window.innerWidth - 500) + 'px';
      popup.style.top = Math.min(rect.bottom + 4, window.innerHeight - 380) + 'px';
    } else {
      popup.style.left = '50%'; popup.style.top = '50%';
      popup.style.transform = 'translate(-50%,-50%)';
    }

    // 点击外部关闭
    var _closePop = function(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', _closePop, true);
      }
    };
    setTimeout(function() { document.addEventListener('click', _closePop, true); }, 50);

    // 取消按钮
    popup.querySelector('.btn-popup-cancel').addEventListener('click', function() {
      popup.remove();
      document.removeEventListener('click', _closePop, true);
    });

    // 填入按钮
    popup.querySelector('.btn-popup-fill').addEventListener('click', function() {
      var checked = popup.querySelectorAll('.cb-check:checked');
      if (checked.length === 0) {
        Parser.utils.showToast('请至少勾选一个条目');
        return;
      }
      var selected = [];
      checked.forEach(function(cb) {
        var idx = parseInt(cb.closest('.clipboard-check-item').dataset.idx);
        selected.push((history[idx].text || '').trim());
      });
      var merged = selected.join(', ');
      // 如果输入框已有内容，追加逗号
      var cur = targetInput.value.trim();
      if (cur && cur.slice(-1) !== ',') cur += ', ';
      targetInput.value = cur + merged;
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      popup.remove();
      document.removeEventListener('click', _closePop, true);
      Parser.utils.showToast('已填入 ' + selected.length + ' 个选择器');
    });

    // 悬停效果
    popup.querySelectorAll('.clipboard-check-item').forEach(function(label) {
      label.addEventListener('mouseenter', function() { this.style.background = 'var(--bg-hover)'; });
      label.addEventListener('mouseleave', function() { this.style.background = ''; });
    });
  }

  /** 子链路剪贴板多选弹窗（_showClipboardMultiPicker 的包装） */
  function _showSubChainClipboardPicker(sci, targetInput) {
    var btn = targetInput.parentElement.querySelector('.btn-subchain-clipboard');
    _showClipboardMultiPicker(targetInput, '子链路', btn);
  }

  /** 从编辑器解析子链路选择器 */
  function parseSubChainInEditor(path, sci) {
    var node = getChainNode(path);
    if (!node || !node.subChains) return;
    var sc = node.subChains[sci];
    if (!sc) return;
    var inp = document.querySelector('.chain-sub-sel-input-editor[data-sidx="' + sci + '"]');
    if (!inp) return;
    var sel = inp.value.trim();
    if (!sel) { _flashSubChainHint(path, '请输入选择器'); return; }
    // 获取类型
    var cssBtn = document.querySelector('.schema-subtype-btn[data-sub-type-edit="css"][data-sidx="' + sci + '"]');
    var subType = (cssBtn && cssBtn.classList.contains('active')) ? 'css' : 'xpath';
    sc.selector = sel;
    sc.chainType = subType;
    // 解析子链路选择器为段
    sc.chainSegments = [];
    var separator = subType === 'xpath' ? '/' : '>';
    var parts = sel.split(separator).map(function(s) { return s.trim(); }).filter(Boolean);
    if (subType === 'xpath' && parts.length > 0) {
      if (parts[0].startsWith('.//')) parts[0] = parts[0].substring(3);
      else if (parts[0] === '.') parts.shift();
    }
    if (parts.length === 0) { _flashSubChainHint(path, '选择器无法解析：' + sel); return; }
    for (var i = 0; i < parts.length; i++) {
      var tagMatch = parts[i].match(/^[.#]?([a-zA-Z][a-zA-Z0-9]*)/);
      var tag = tagMatch ? tagMatch[1].toLowerCase() : '';
      sc.chainSegments.push({ selector: parts[i], tag: tag, extractions: [] });
    }
    // 自动展开父节点，确保新子链路在树中可见
    var parentKey = JSON.stringify(path);
    _expandedChains[parentKey] = true;
    renderChainTree();
    renderChainEditor(path);
    autoRefreshChainPreview();
    // 闪烁提示已解析
    _flashSubChainHint(path, '已解析 ' + parts.length + ' 段');
  }

  /** 在树中闪烁提示信息（短暂高亮） */
  function _flashSubChainHint(path, msg) {
    // 遍历找到对应节点行
    var targetPath = JSON.stringify(path);
    var treeNode = null;
    var nodes = schemaChainLayers.querySelectorAll('.chain-tree-node');
    for (var n = 0; n < nodes.length; n++) {
      if (nodes[n].dataset.path === targetPath) { treeNode = nodes[n]; break; }
    }
    if (!treeNode) return;
    var hint = document.createElement('span');
    hint.textContent = msg;
    hint.style.cssText = 'font-size:10px;color:' + (msg.indexOf('已解析') >= 0 ? 'var(--green)' : 'var(--orange)') + ';margin-left:6px;opacity:1;transition:opacity 0.3s 1.5s';
    treeNode.appendChild(hint);
    setTimeout(function() { hint.style.opacity = '0'; }, 100);
    setTimeout(function() { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 2000);
  }

  function getSubChain(pIdx, subIdx) {
    var subs = Parser.state.chainSegments[pIdx] && Parser.state.chainSegments[pIdx].subChains;
    return (subs && subs[subIdx]) || null;
  }

  /** 绑定子链路区域内的动态事件（重新渲染后调用） */
  function bindSubChainEvents(subSec) {
    if (!subSec) return;
    var pIdx = parseInt(subSec.dataset.parentIdx);
    function scIdx(el) { return parseInt(el.dataset.subIdx) || 0; }
    function seg(pIdx, subIdx) { var s = getSubChain(pIdx, subIdx); return s ? s.chainSegments : null; }

    subSec.querySelectorAll('.chain-sub-attr-select').forEach(function(sel) {
      sel._prevValue = sel.value || '';
      sel.addEventListener('change', function() {
        var sIdx = parseInt(this.dataset.sidx);
        var eIdx = parseInt(this.dataset.extrIdx) || 0;
        var sg = seg(pIdx, scIdx(this));
        if (!sg || !sg[sIdx]) return;
        var sExts = sg[sIdx].extractions || [];
        if (!sExts[eIdx]) return;
        if (this.value === '__custom__') {
          handleCustomAttr(this, function(val) { sExts[eIdx].attr = val; autoRefreshChainPreview(); });
        } else {
          this._prevValue = this.value; sExts[eIdx].attr = this.value; autoRefreshChainPreview();
        }
      });
    });
    subSec.querySelectorAll('.chain-sub-name-input').forEach(function(inp) {
      inp.addEventListener('blur', function() {
        var sIdx = parseInt(this.dataset.sidx), eIdx = parseInt(this.dataset.extrIdx) || 0;
        var sg = seg(pIdx, scIdx(this)); if (!sg || !sg[sIdx]) return;
        var sExts = sg[sIdx].extractions || [];
        if (sExts[eIdx]) { sExts[eIdx].name = this.value.trim(); autoRefreshChainPreview(); }
      });
    });
    subSec.querySelectorAll('.btn-sub-extr-add').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var sIdx = parseInt(this.dataset.sidx), sc = getSubChain(pIdx, scIdx(this));
        if (!sc || !sc.chainSegments[sIdx]) return;
        var sExts = sc.chainSegments[sIdx].extractions || [];
        sExts.push({ attr: '', name: '' });
        sc.chainSegments[sIdx].extractions = sExts;
        autoRefreshChainPreview();
        reSub(pIdx);
      });
    });
    subSec.querySelectorAll('.btn-sub-extr-remove').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var sIdx = parseInt(this.dataset.sidx), eIdx = parseInt(this.dataset.extrIdx) || 0, sc = getSubChain(pIdx, scIdx(this));
        if (!sc || !sc.chainSegments[sIdx]) return;
        var sExts = sc.chainSegments[sIdx].extractions || [];
        sExts.splice(eIdx, 1); sc.chainSegments[sIdx].extractions = sExts;
        autoRefreshChainPreview(); reSub(pIdx);
      });
    });
    subSec.querySelectorAll('.schema-subtype-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var subType = this.dataset.subType, idx = parseInt(this.dataset.idx), sc = getSubChain(idx, scIdx(this));
        if (!sc) { Parser.state.chainSegments[idx].subChains.push({ selector: '', chainType: subType, chainSegments: [] }); reSub(idx); return; }
        sc.chainType = subType;
        // 更新 active
        var wrap = this.closest('.chain-sub-section-item');
        if (wrap) { wrap.querySelectorAll('.schema-subtype-btn').forEach(function(b){b.classList.remove('active')}); this.classList.add('active'); }
      });
    });
    subSec.querySelectorAll('.chain-sub-parse-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(this.dataset.idx), subIdx = scIdx(this), sc = getSubChain(idx, subIdx);
        var wrap = this.closest('.chain-sub-section-item');
        if (!wrap) return;
        var inp = wrap.querySelector('.chain-sub-sel-input');
        if (!inp) return;
        var sel = inp.value.trim(); if (!sel) return;
        var cssBtn = wrap.querySelector('.schema-subtype-btn[data-sub-type="css"]');
        var subType = (cssBtn && cssBtn.classList.contains('active')) ? 'css' : 'xpath';
        if (!sc) { Parser.state.chainSegments[idx].subChains.push({ selector: sel, chainType: subType, chainSegments: [] }); sc = Parser.state.chainSegments[idx].subChains[Parser.state.chainSegments[idx].subChains.length-1]; }
        else { sc.selector = sel; sc.chainType = subType; }
        parseSubChainSegments(idx, sel, subType, subIdx);
        reSub(idx);
        autoRefreshChainPreview();
      });
    });
    subSec.querySelectorAll('.chain-sub-sel-input').forEach(function(inp) {
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { var w = inp.closest('.chain-sub-section-item'); if (w) { var b = w.querySelector('.chain-sub-parse-btn'); if (b) b.click(); } }
      });
    });
    // 添加子链路
    subSec.querySelectorAll('.btn-sub-chain-add').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(this.dataset.idx);
        if (!Parser.state.chainSegments[idx].subChains) Parser.state.chainSegments[idx].subChains = [];
        Parser.state.chainSegments[idx].subChains.push({ selector: '', chainType: 'css', chainSegments: [] });
        reSub(idx);
      });
    });
    // 删除子链路
    subSec.querySelectorAll('.btn-sub-chain-remove').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(this.dataset.idx), subIdx = scIdx(this);
        if (!Parser.state.chainSegments[idx].subChains) return;
        Parser.state.chainSegments[idx].subChains.splice(subIdx, 1);
        reSub(idx); autoRefreshChainPreview();
      });
    });
    // 点子链路层头切换属性预览
    subSec.querySelectorAll('.chain-sub-layer-header').forEach(function(header) {
      header.addEventListener('click', function(e) {
        e.stopPropagation();
        var sIdx = parseInt(this.dataset.sidx);
        var sc = getSubChain(pIdx, scIdx(this));
        if (!sc || !sc.chainSegments[sIdx]) return;
        var subSeg = sc.chainSegments[sIdx];
        var layerDiv = this.closest('.chain-sub-layer');
        var existPreview = layerDiv.querySelector('.chain-preview');
        if (existPreview) { existPreview.remove(); return; }
        var preview = document.createElement('div');
        preview.className = 'chain-preview';
        preview.style.marginLeft = '16px'; preview.style.maxHeight = '200px';
        preview.innerHTML = '<div class="tree-empty" style="padding:4px 0;font-size:11px">加载中...</div>';
        layerDiv.appendChild(preview);
        var parentSel = Parser.state.chainSegments[pIdx].selector;
        var isParentXP = parentSel.indexOf('//') === 0;
        var fullSel = isParentXP ? subSeg.selector.replace(/^\./, '') : parentSel + ' ' + subSeg.selector;
        fetchSubLayerPreview(fullSel).then(function(d) { preview.innerHTML = renderLayerPreviewHTML(d); })
          .catch(function() { preview.innerHTML = '<div style="font-size:11px;color:var(--red);padding:4px">加载失败</div>'; });
      });
    });

    function reSub(idx) {
      var wrap2 = document.querySelector('#schemaChainLayers .schema-chain-layer-wrap:nth-child(' + (idx+1) + ')');
      if (wrap2) { var s2 = wrap2.querySelector('.chain-sub-section'); if (s2) { s2.innerHTML = renderSubChainHTML(idx); bindSubChainEvents(s2); } }
    }
  }

  /** 子链路层属性预览 */
  async function fetchSubLayerPreview(selector) {
    var isXPath = selector.indexOf('//') === 0 || selector.indexOf('.//') === 0;
    try {
      var jsCode;
      if (isXPath) {
        var xpathSel = selector.replace(/^\./, '');
        jsCode = '(function(){try{var snap=document.evaluate(' + JSON.stringify(xpathSel) + ',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);' +
          'var result=[];' +
          'for(var i=0;i<Math.min(snap.snapshotLength,' + Parser.state.chainPreviewLimit + ');i++){' +
            'var el=snap.snapshotItem(i);if(el.nodeType!==1)continue;var attrs={};' +
            'for(var j=0;j<el.attributes.length;j++){var a=el.attributes[j];attrs[a.name]=a.value;}' +
            'var text=(el.textContent||"").replace(/\\s+/g," ").trim();' +
            'result.push({tag:el.tagName.toLowerCase(),attrs:attrs,text:text,childCount:el.children.length});' +
          '}' +
          'return result;' +
        '}catch(e){return[];}})()';
      } else {
        jsCode = '(function(){try{var els=document.querySelectorAll(' + JSON.stringify(selector) + ');' +
          'var result=[];' +
          'for(var i=0;i<Math.min(els.length,' + Parser.state.chainPreviewLimit + ');i++){' +
            'var el=els[i];var attrs={};' +
            'for(var j=0;j<el.attributes.length;j++){var a=el.attributes[j];attrs[a.name]=a.value;}' +
            'var text=(el.textContent||"").replace(/\\s+/g," ").trim();' +
            'result.push({tag:el.tagName.toLowerCase(),attrs:attrs,text:text,childCount:el.children.length});' +
          '}' +
          'return result;' +
        '}catch(e){return[];}})()';
      }
      var data = await webview.executeJavaScript(jsCode);
      return data || [];
    } catch (e) { return []; }
  }

  /** 解析子链路选择器，拆分为渐进式子层 */
  function parseSubChainSegments(idx, sel, subType) {
    var separator = subType === 'css' ? '>' : '/';
    sel = sel.replace(/:nth-(child|of-type|last-child|last-of-type|first-child)\s*\([^)]*\)/gi, '');
    sel = sel.replace(/:(first|last)-(child|of-type)/gi, '');
    sel = sel.replace(/\s+/g, ' ').trim();
    var parts = sel.split(separator).map(function(s) { return s.trim(); }).filter(Boolean);
    if (subType === 'xpath' && parts.length > 0 && parts[0] === '/') {
      parts = parts.slice(1);
    }
    var subSegments = [];
    for (var i = 0; i < parts.length; i++) {
      var ps = parts.slice(0, i + 1);
      var progressiveSel = subType === 'xpath' ? '.' + ps.join('/') : ps.join(' > ');
      // CSS 相对选择器不需要 . 前缀
      if (subType === 'css') progressiveSel = ps.join(' > ');
      var lastPart = parts[i].trim();
      var tagMatch = lastPart.match(/^[.#]?([a-zA-Z][a-zA-Z0-9]*)/);
      var tag = tagMatch ? tagMatch[1].toLowerCase() : (lastPart[0] === '.' ? 'div' : (lastPart[0] === '#' ? 'div' : ''));
      subSegments.push({ selector: progressiveSel, tag: tag, attr: '', name: '' });
    }
    if (!Parser.state.chainSegments[idx].subChains) Parser.state.chainSegments[idx].subChains = [];
    var subIdx = arguments[3] || 0;
    Parser.state.chainSegments[idx].subChains[subIdx] = {
      selector: sel,
      chainType: subType,
      chainSegments: subSegments
    };
  }

  var _chainPreviewTimer = null;

  /** 自动刷新链路预览 */
  function autoRefreshChainPreview() {
    if (_chainPreviewTimer) { clearTimeout(_chainPreviewTimer); _chainPreviewTimer = null; }
    // 没有编辑任何方案且没有链路数据时不刷预览
    var hasChainData = Parser.state.chainSegments && Parser.state.chainSegments.length > 0;
    if (Parser.state._editingChainSchemeIdx == null && !hasChainData && (!Parser.state.chainSchemes || !Parser.state.chainSchemes.length || !Parser.state.chainSchemes.some(function(s) { return s.checked; }))) {
      if (schemaPreviewWrap) schemaPreviewWrap.innerHTML = '<div class="tree-empty">请选择或新建方案</div>';
      if (schemaPreviewInfo) schemaPreviewInfo.textContent = '';
      resetChainCounts();
      return;
    }
    _chainPreviewTimer = setTimeout(async function() {
      var schema = buildChainSchema();
      var fields = schema.fields.filter(function(f) { return f.isText || f.childText || (f.attr && f.attr.trim()); });
      if (fields.length === 0) {
        // 无字段时做快速计数，确认选择器是否匹配元素
        var quickCount = 0;
        try {
          var qwv = document.getElementById('webview');
          if (qwv) {
            var qSnaps = [];
            try {
              var qSlResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/page-snapshots/list');
              if (qSlResp.ok) qSnaps = (await qSlResp.json()).snapshots || [];
            } catch(e) {}
            var qHtmls = [];
            if (qSnaps.length > 0) {
              for (var qsi = 0; qsi < qSnaps.length; qsi++) {
                try {
                  var qShResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/page-snapshots/' + qSnaps[qsi].id + '/html');
                  if (qShResp.ok) { var d2 = await qShResp.json(); if (d2.html) qHtmls.push(d2.html); }
                } catch(e) {}
              }
            } else {
              var qHtml = await qwv.executeJavaScript('document.documentElement.outerHTML');
              if (qHtml) qHtmls.push(qHtml);
            }
            for (var qhi = 0; qhi < qHtmls.length; qhi++) {
              var qResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/extract/css', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html: qHtmls[qhi], query: schema.deepestSelector || '' })
              });
              var qData = await qResp.json();
              quickCount += qData.count || 0;
            }
          }
        } catch(e) {}
        var countMsg = quickCount > 0
          ? '共 ' + quickCount + ' 个匹配' + (qHtmls && qHtmls.length > 1 ? '（' + qHtmls.length + '页）' : '') + '，请配置提取属性'
          : '未找到匹配元素，请检查选择器';
        schemaPreviewInfo.textContent = countMsg;
        resetChainCounts();
        if (schemaPreviewWrap) schemaPreviewWrap.innerHTML = '<div class="tree-empty">' + countMsg + '</div>';
        return;
      }
      // 调 Python 后端提取（有快照走快照，否则走当前 webview）
      try {
        var wv = document.getElementById('webview');
        if (!wv) { resetChainCounts(); return; }
        // 检查快照
        var snapList = [];
        try {
          var slResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/page-snapshots/list');
          if (slResp.ok) {
            var slData = await slResp.json();
            snapList = slData.snapshots || [];
          }
        } catch(e) {}
        var result;
        if (snapList.length > 0) {
          // 有快照 → 逐页提取并合并
          var mergedRows = [], mergedHeaders = [], mergedCounts = [];
          var snapTotal = snapList.length, snapLoaded = 0, snapMatched = 0;
          for (var si = 0; si < snapList.length; si++) {
            var snap = snapList[si];
            try {
              var shResp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/page-snapshots/' + snap.id + '/html');
              if (!shResp.ok) continue;
              var shData = await shResp.json();
              var snapHtml = shData.html;
              if (!snapHtml) continue;
              snapLoaded++;
              var resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/extract/chain', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  html: snapHtml, chain_type: schema.chainType || 'css', deepest_selector: schema.deepestSelector || '',
                  fields: schema.fields, child_delim: schema.childDelimiter || ''
                })
              });
              var pageResult = await resp.json();
              if (pageResult && !pageResult.error && pageResult.rows) {
                var srcUrlCol = (document.getElementById('secLinkCol') && document.getElementById('secLinkCol').value) || '来源URL';
                pageResult.rows.forEach(function(r) { r["来源URL"] = snap.url || ''; });
                // 不推入 headers
                // 用注册元素补充字段
                try {
                  var elResp2 = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/elements');
                  if (elResp2.ok) {
                    var elData2 = await elResp2.json();
                    var elems2 = (elData2.elements || []).filter(function(e) { return e.page_url === snap.url; });
                    for (var ej = 0; ej < elems2.length; ej++) {
                      var elem2 = elems2[ej];
                      var cr2 = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/extract/css', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ html: snapHtml, query: elem2.selector })
                      });
                      var cd2 = await cr2.json();
                      var vals2 = (cd2.results || []).map(function(r2) { return r2.text || ''; });
                      var cn2 = elem2.text || elem2.selector;
                      if (mergedHeaders.indexOf(cn2) < 0) mergedHeaders.push(cn2);
                      for (var mk = 0; mk < pageResult.rows.length; mk++) {
                        pageResult.rows[mk][cn2] = (mk < vals2.length ? vals2[mk] : '');
                      }
                    }
                  }
                } catch(e) {}
                mergedRows = mergedRows.concat(pageResult.rows);
                if (!mergedHeaders.length && pageResult.headers) mergedHeaders = pageResult.headers;
                if (pageResult.counts) mergedCounts = pageResult.counts;
                snapMatched++;
              }
            } catch(e) {}
          }
          result = { rows: mergedRows, headers: mergedHeaders, counts: mergedCounts, totalRows: mergedRows.length,
            _diag: { snapTotal: snapTotal, snapLoaded: snapLoaded, snapMatched: snapMatched } };
        } else {
          // 无快照 → 只取当前页
          var html = await wv.executeJavaScript('document.documentElement.outerHTML');
          if (!html) { resetChainCounts(); return; }
          var resp = await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/extract/chain', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              html: html, chain_type: schema.chainType || 'css', deepest_selector: schema.deepestSelector || '',
              fields: schema.fields, child_delim: schema.childDelimiter || ''
            })
          });
          result = await resp.json();
          if (result && !result.error && result.rows) {
            result.totalRows = result.rows.length;
          }
        }
        if (!result || result.error) {
          schemaPreviewInfo.textContent = result ? result.error : '';
          resetChainCounts();
          return;
        }
        Parser.state.schemaPreviewData = result;
        _refreshExportLinksBtn();
        var totalRows = result.totalRows || 0;
        var headers = result.headers || [];
        var counts = result.counts || [];
        var diag = result._diag;
        var diagStr = diag ? '（快照' + diag.snapTotal + '页，加载' + diag.snapLoaded + '页，命中' + diag.snapMatched + '页）' : '';
        schemaPreviewInfo.textContent = '共 ' + totalRows + ' 行，' + headers.length + ' 列' + diagStr;
        updateChainCounts(counts);
        renderModalPreviewTable(result);
      } catch(e) {
        schemaPreviewInfo.textContent = '';
        resetChainCounts();
      }
    }, 300);
  }

  function resetChainCounts() {
    var spans = schemaChainLayers.querySelectorAll('.chain-count-val');
    spans.forEach(function(s) { s.textContent = '-'; });
  }

  function updateChainCounts(counts) {
    // counts is an array from backend; we map them to tree nodes by path
    // For now, just show counts on main chain segments
    var spans = schemaChainLayers.querySelectorAll('.chain-count-val');
    for (var i = 0; i < spans.length && i < counts.length; i++) {
      spans[i].textContent = counts[i] || '0';
    }
  }

  /** 从链路面板构建 schema */
  function buildChainSchema() {
    var delimiter = Parser.state.globalMultiDelim;
    var childDelim = Parser.state.globalChildDelim;
    var nSegments = Parser.state.chainSegments.length;
    var chainType = getChainType();
    var deepestSelector = schemaChainInput.value.trim();
    var fields = [];

    /** 递归收集字段 */
    function _collectFields(seg, mainChainIndex, subChainPath) {
      // mainChainIndex: 始终是主线层的 chainIndex（用于 walkUp 定位）
      // subChainPath: 嵌套的 subChain 对象链，null 表示在主线层
      (seg.extractions || []).forEach(function(ex) {
        if (!ex.attr || !ex.attr.trim()) return;
        var isText = ex.attr === '$text';
        var isChildText = ex.attr === '$childText';
        var fieldName = ex.name || (isText ? '文本' : (isChildText ? '子元素文本' : ex.attr)) || ('字段' + (mainChainIndex + 1));
        var f = {
          type: 'chain',
          selector: deepestSelector,
          chainType: chainType,
          chainIndex: mainChainIndex,
          nSegments: nSegments,
          attr: isText ? '' : (isChildText ? '' : ex.attr),
          isText: isText || isChildText,
          name: fieldName,
        };
        if (isChildText) {
          f.childText = true;
          f.childSelectors = ex.childSelectors || [];
          f.childDelimiter = ex.childDelimiter || '';
        }
        if (subChainPath) f.subChain = subChainPath;
        fields.push(f);
      });

      // 递归处理子链路
      (seg.subChains || []).forEach(function(sc) {
        if (!sc.chainSegments) return;
        sc.chainSegments.forEach(function(subSeg, si) {
          // 构建当前层的 subChain 路径
          var currentSub = {
            selector: sc.selector,
            chainType: sc.chainType || 'css',
            chainIndex: si,
          };
          // 嵌套：如果有上级 subChainPath，嵌套进去
          var nested = subChainPath ? _deepCopySubChain(subChainPath, currentSub) : currentSub;
          _collectFields(subSeg, mainChainIndex, nested);
        });
      });
    }

    function _deepCopySubChain(existing, append) {
      // 深拷贝 subChain 链，在叶子节点附加 append
      var copy = { selector: existing.selector, chainType: existing.chainType, chainIndex: existing.chainIndex };
      if (existing.subChain) {
        copy.subChain = _deepCopySubChain(existing.subChain, append);
      } else {
        copy.subChain = append;
      }
      return copy;
    }

    Parser.state.chainSegments.forEach(function(seg, i) {
      _collectFields(seg, i, null);
    });

    // 去重默认名称
    var nameCount = {};
    fields.forEach(function(f) {
      var base = f.name;
      if (nameCount[base] == null) { nameCount[base] = 1; return; }
      var n;
      do { n = base + (++nameCount[base]); } while (nameCount[n] != null);
      f.name = n;
      nameCount[n] = 1;
    });

    // 如果有保存的列顺序（预览拖拽产生），按它排列 fields
    if (Parser.state._chainHeaderOrder && Parser.state._chainHeaderOrder.length) {
      var orderMap = {};
      Parser.state._chainHeaderOrder.forEach(function(h, i) { orderMap[h] = i; });
      fields.sort(function(a, b) {
        var ai = orderMap[a.name], bi = orderMap[b.name];
        if (ai !== undefined && bi !== undefined) return ai - bi;
        if (ai !== undefined) return -1;
        if (bi !== undefined) return 1;
        return 0;
      });
    }

    var name = schemaName.value.trim() || Parser.state.schemaCurrentName || '';
    _debugLog('[buildChainSchema] ' + deepestSelector.substring(0, 60) + ' → ' + fields.length + '字段: ' + JSON.stringify(fields.map(function(f){return f.name})));
    return {
      name: name,
      mode: 'chain',
      delimiter: delimiter,
      childDelimiter: childDelim,
      chainType: chainType,
      deepestSelector: deepestSelector,
      chainSegments: JSON.parse(JSON.stringify(Parser.state.chainSegments)),
      fields: fields,
    };
  }

  /** 保存当前方案 */
  function handleSaveSchema() {
    syncFieldsFromUI();
    var name = schemaName.value.trim();
    if (!name) {
      setStatus('请输入方案名称');
      return;
    }
    var schema = buildSchemaFromUI();
    schema.name = name;
    // 保存时清理空字段
    schema.fields = schema.fields.filter(function(f) { return f.selector && f.selector.trim(); });
    if (schema.fields.length === 0) {
      setStatus('请至少填入一个选择器');
      return;
    }
    if (saveSchemaToStorage(name, schema)) {
      Parser.state.schemaCurrentName = name;
      refreshSchemaList();
      setStatus('方案已保存: ' + name);
      Parser.utils.showToast('方案已保存: ' + name);
    } else {
      setStatus('保存失败');
    }
  }

  /** 删除当前方案 */
  function handleDeleteSchema() {
    var name = schemaName.value.trim() || Parser.state.schemaCurrentName;
    if (!name) {
      setStatus('请先输入或加载一个方案名称');
      return;
    }
    deleteSchemaFromStorage(name);
    if (Parser.state.schemaCurrentName === name) Parser.state.schemaCurrentName = '';
    schemaName.value = '';
    refreshSchemaList();
    setStatus('方案已删除: ' + name);
  }

  /** 切换手动方案下拉 */
  function _toggleManualDropdown() {
    if (manualSchemeOptions) manualSchemeOptions.classList.toggle('hidden');
  }

  /** 导出方案为 JSON 文件 */
  async function handleExportSchemaFile() {
    syncFieldsFromUI();
    var schema = buildSchemaFromUI();
    var name = schemaName.value.trim() || 'untitled';
    schema.name = name;
    var json = JSON.stringify({ export_schema: schema, exported_at: new Date().toISOString() }, null, 2);
    var base64 = Parser.utils.toBase64(json);
    var dr = await window.api.showSaveDialog({
      title: '导出方案',
      defaultPath: name + '.export-schema.json',
      filters: [{ name: '方案文件', extensions: ['json'] }]
    });
    if (!dr.canceled && dr.filePath) {
      await window.api.saveFile(dr.filePath, base64);
      setStatus('方案已导出: ' + dr.filePath);
    }
  }

  /** 导入方案 JSON 文件 */
  function handleImportSchemaFile() {
    schemaFileInput.click();
  }

  function handleSchemaFileSelected(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var data = JSON.parse(ev.target.result);
        var schema = data.export_schema || data;
        if (!schema.fields || !Array.isArray(schema.fields)) {
          setStatus('无效的方案文件格式');
          return;
        }
        applySchemaToUI(schema);
        Parser.state.schemaPreviewData = null;
        setStatus('方案已导入: ' + (schema.name || '未命名'));
      } catch (err) {
        setStatus('方案文件解析失败: ' + err.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
    schemaFileInput.value = '';
  }

  /** 绑定所有 schema 弹窗事件 */
  function bindSchemaEvents() {
    btnSchemaModalClose.addEventListener('click', closeSchemaModal);
    btnSchemaCancel.addEventListener('click', closeSchemaModal);
    // 保存并查询 — 始终走保存配置+实时提取+存库完整流程
    if (btnSchemaSaveQuery) {
      btnSchemaSaveQuery.addEventListener('click', async function() {
        try {
        var checked = (Parser.state.chainSchemes || []).filter(function(s) { return s.checked !== false; });
        syncFieldsFromUI();
        var schema = buildSchemaFromUI();
        var name = schemaName.value.trim();
        if (!name) {
          if (schema.mode === 'chain' && schema.deepestSelector) {
            name = schema.deepestSelector.substring(0, 30);
          } else {
            name = '方案 ' + new Date().toLocaleTimeString();
          }
        }
        schema.name = name;
        if (Parser.state.schemaMode === 'chain') {
          var cn2 = document.getElementById('chainSchemaName');
          var chainName = cn2 ? cn2.value.trim() : '';
          var idx = Parser.state._editingChainSchemeIdx;
          if (idx != null && idx >= 0 && idx < Parser.state.chainSchemes.length) {
            // 正在编辑已有方案
            if (!chainName) chainName = name;
            var oldName = Parser.state.chainSchemes[idx].name;
            if (chainName === oldName) {
              // 同名 → 更新配置（不分组）
              Parser.state.chainSchemes[idx].schema = schema;
              saveChainSchemesToStorage();
              refreshChainSchemeSelect();
              setStatus('已更新: ' + chainName);
            } else {
              // 异名 → 新建独立方案（分组），原方案不改
              var dupC = Parser.state.chainSchemes.findIndex(function(s) { return s.name === chainName; });
              if (dupC >= 0) {
                Parser.state.chainSchemes[dupC].schema = schema;
                Parser.state.chainSchemes[dupC].checked = true;
                saveChainSchemesToStorage();
                refreshChainSchemeSelect();
                setStatus('已更新: ' + chainName + '（同名方案覆盖）');
              } else {
                Parser.state.chainSchemes.push({ name: chainName, schema: schema, checked: true });
                saveChainSchemesToStorage();
                refreshChainSchemeSelect();
                setStatus('已新建方案: ' + chainName + '（' + oldName + ' 保持不变）');
              }
            }
          } else if (chainName) {
            // 没在编辑但输入了名字 → 查重后新建或更新
            var dupN = Parser.state.chainSchemes.findIndex(function(s) { return s.name === chainName; });
            if (dupN >= 0) {
              Parser.state.chainSchemes[dupN].schema = schema;
              Parser.state.chainSchemes[dupN].checked = true;
              saveChainSchemesToStorage();
              refreshChainSchemeSelect();
              setStatus('已更新: ' + chainName);
            } else {
              Parser.state.chainSchemes.push({ name: chainName, schema: schema, checked: true });
              saveChainSchemesToStorage();
              refreshChainSchemeSelect();
              setStatus('已新建方案: ' + chainName);
            }
          }
          // 没在编辑也没输入名字 → 不保存，直接用当前 schema 查询
        } else {
          if (!Parser.state.schemaCurrentName) {
            if (loadSchemaFromStorage(name)) {
              setStatus('方案名「' + name + '」已存在，请换一个名字');
              return;
            }
          }
          if (Parser.state.schemaCurrentName && Parser.state.schemaCurrentName !== name) {
            if (loadSchemaFromStorage(name)) {
              setStatus('方案名「' + name + '」已存在，请换一个名字');
              return;
            }
            deleteSchemaFromStorage(Parser.state.schemaCurrentName);
          }
          saveSchemaToStorage(name, schema);
          refreshSchemaList();
          Parser.state.schemaCurrentName = name;
          setStatus('已保存: ' + name);
        }
        var cn = document.getElementById('chainSchemaName');
        if (cn) cn.value = '';
        if (schemaName) schemaName.value = '';

        // ── 查询 ──
        // 链路模式：提取刚保存/勾选的链路方案；手动模式：只提取当前手动 schema
        var checked;
        if (Parser.state.schemaMode === 'chain') {
          var savedName = chainName;
          if (savedName) {
            var savedScheme = Parser.state.chainSchemes.find(function(s) { return s.name === savedName; });
            checked = savedScheme ? [savedScheme] : [{ name: savedName, schema: schema }];
          } else {
            checked = (Parser.state.chainSchemes || []).filter(function(s) { return s.checked !== false; });
            if (checked.length === 0) {
              checked = [{ name: name, schema: schema }];
            }
          }
        } else {
          // 手动模式：有勾选方案 → 合并提取；无勾选 → 用当前编辑器 schema
          var manualChecked = (Parser.state.manualSchemes || []).filter(function(s) { return s.checked; });
          if (manualChecked.length > 0) {
            checked = manualChecked.map(function(s) {
              var sch = loadSchemaFromStorage(s.name);
              return sch ? { name: s.name, schema: sch } : null;
            }).filter(Boolean);
          } else {
            checked = [{ name: name, schema: schema }];
          }
        }
        setStatus('开始提取 ' + checked.length + ' 个方案...');
        // 清除快照缓存，确保提取最新数据
        Parser.state._snapHtmlCache = {};
        var allResults;
        try {
          allResults = await _extractFromSchemas(checked);
        } catch (e) {
          setStatus('提取失败: ' + (e.message || ''));
          return;
        }
        var wv = document.getElementById('webview');
        // 防御：从 rows 中补全 headers（防止字段名丢失导致表头不完整）
        for (var ai = 0; ai < allResults.length; ai++) {
          var ar = allResults[ai];
          if (ar.rows && ar.rows.length > 0) {
            var rowKeys = Object.keys(ar.rows[0]);
            for (var ki = 0; ki < rowKeys.length; ki++) {
              if (ar.headers.indexOf(rowKeys[ki]) < 0) ar.headers.push(rowKeys[ki]);
            }
          }
        }
        // 保存到 DB（始终覆盖）
        for (var si = 0; si < allResults.length && si < checked.length; si++) {
          try {
            await fetch('http://127.0.0.1:' + Parser.state.pythonPort + '/api/chain-data/save', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scheme_name: checked[si].name, rows: allResults[si].rows, headers: allResults[si].headers })
            });
          } catch (e) { setStatus('存库失败: ' + checked[si].name); }
        }
        if (allResults.length === 0) {
          setStatus('已保存，当前页面无匹配数据');
          var m2 = document.getElementById('schemaModal');
          if (m2) m2.classList.add('hidden');
          Parser.state.chainSchemes.forEach(function(s) { s.checked = false; });
          Parser.state._editingChainSchemeIdx = null;
          saveChainSchemesToStorage();
          return;
        }
        // 合并走 DB 缓存（保证列表用存好的数据，不受实时提取影响）
        var isVert = Parser.state._chainMergeMode === 'vertical' && checked.length >= 2;
        var mergedRows = [], allHeaders = [];
        if (isVert) {
          // 纵向合并：逐个方案读DB，追加行，取并集列
          for (var vi = 0; vi < checked.length; vi++) {
            var vUrl = 'http://127.0.0.1:' + Parser.state.pythonPort + '/api/chain-data/query?schemes=' + encodeURIComponent(checked[vi].name);
            var vResp = await fetch(vUrl);
            var vData = await vResp.json();
            if (vData.rows && vData.rows.length > 0) {
              var vHeaders = vData.headers || [];
              vData.rows.forEach(function(r) {
                var nr = {};
                vHeaders.forEach(function(h) { nr[h] = r[h] || ''; });
                mergedRows.push(nr);
              });
              vHeaders.forEach(function(h) {
                if (allHeaders.indexOf(h) < 0) allHeaders.push(h);
              });
            }
          }
        } else {
          // 使用各方案导出时的 _exportLinkCol；兜底取 footer 下拉值
          var linkCols = checked.map(function(s) { return (s.schema && s.schema._exportLinkCol) || ''; });
          var linkCol = (document.getElementById('secLinkCol') && document.getElementById('secLinkCol').value) || '';
          _debugLog('[保存并查询] footer下拉=' + linkCol + ' linkCols=' + linkCols.join(',') + ' schemes=' + checked.map(function(s){return s.name}).join(','));
          var names = checked.map(function(s) { return encodeURIComponent(s.name); }).join(',');
          var qUrl = 'http://127.0.0.1:' + Parser.state.pythonPort + '/api/chain-data/query?schemes=' + names
            + (linkCols.some(function(c){return c;}) ? '&link_cols=' + encodeURIComponent(linkCols.join(',')) : '')
            + (linkCol ? '&link_col=' + encodeURIComponent(linkCol) : '');
          var dbResp = await fetch(qUrl);
          var dbData = await dbResp.json();
          mergedRows = dbData.rows || [];
            allHeaders = dbData.headers || [];
            // 过滤内部列
            allHeaders = allHeaders.filter(function(h) { return h !== '来源URL' && h.charAt(0) !== '_'; });
            mergedRows = mergedRows.map(function(r) {
              var clean = {};
              allHeaders.forEach(function(h) { clean[h] = r[h] || ''; });
              return clean;
            });
        }
        hideAllPanels();
        queryContainer.classList.remove('hidden');
        queryContainer.dataset.mode = 'schema-extract';
        contentTitle.textContent = '链路提取 (' + mergedRows.length + '行)';
        showQueryInputRow();
        Parser.state.queryResults = mergedRows;
        renderQueryTable(mergedRows);
        var m = document.getElementById('schemaModal');
        if (m) m.classList.add('hidden');
        Parser.state.chainSchemes.forEach(function(s) { s.checked = false; });
        Parser.state._editingChainSchemeIdx = null;
        saveChainSchemesToStorage();
        setStatus('已完成: ' + mergedRows.length + ' 行, ' + allHeaders.length + ' 列');
        } catch (e) {
          setStatus('出错: ' + (e.message || ''));
        }
      });
    }
    // 全屏切换
    var btnFullscreen = document.getElementById('btnSchemaFullscreen');
    if (btnFullscreen) {
      btnFullscreen.addEventListener('click', function() {
        var box = document.getElementById('schemaModalBox');
        if (!box) return;
        box.classList.toggle('fullscreen');
        this.textContent = box.classList.contains('fullscreen') ? '🗗' : '⛶';
        this.title = box.classList.contains('fullscreen') ? '还原' : '全屏';
        // 全屏切换时调整树面板宽度
            var treePanel = document.querySelector('.chain-tree-panel');
            if (treePanel) {
              treePanel.style.width = box.classList.contains('fullscreen') ? '320px' : '280px';
            }
          });
        }
        // 分栏拖拽
        var divider = document.getElementById('chainSplitDivider');
        var treePanel2 = document.getElementById('chainTreePanel');
        if (divider && treePanel2) {
          var dragStartX, dragStartW;
          divider.addEventListener('mousedown', function(e) {
            e.preventDefault();
            dragStartX = e.clientX;
            dragStartW = treePanel2.offsetWidth;
            divider.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          });
          document.addEventListener('mousemove', function(e) {
            if (!divider.classList.contains('dragging')) return;
            var dx = e.clientX - dragStartX;
            var newW = Math.max(160, Math.min(600, dragStartW + dx));
            treePanel2.style.width = newW + 'px';
          });
          document.addEventListener('mouseup', function() {
            if (!divider.classList.contains('dragging')) return;
            divider.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
          });
        }
        // 点击遮罩关闭（mousedown+鼠标松开都在遮罩上才关闭，防止拖选文字误关）
    var schemaModalDownTarget = null;
    schemaModal.addEventListener('mousedown', function(e) {
      schemaModalDownTarget = e.target;
    });
    schemaModal.addEventListener('mouseup', function(e) {
      if (e.target === schemaModal && schemaModalDownTarget === schemaModal) {
        closeSchemaModal();
      }
      schemaModalDownTarget = null;
    });

    // Tab 切换
    schemaTabManual.addEventListener('click', function() { switchSchemaTab('manual'); });
    schemaTabChain.addEventListener('click', function() { switchSchemaTab('chain'); });

    // 链路方案按钮
    var btnNew = document.getElementById('btnChainSchemaNew');
    var btnSave = document.getElementById('btnChainSchemaSave');
    var btnDel = document.getElementById('btnChainSchemaDel');
    var btnImport = document.getElementById('btnChainSchemaImport');
    var btnExport = document.getElementById('btnChainSchemaExport');
    var fileInput = document.getElementById('chainSchemaFileInput');
    if (btnNew) btnNew.addEventListener('click', function() {
      // 填名称 → 存为方案 → 下拉出现 → 清空
      var nameInput3 = document.getElementById('chainSchemaName');
      var name = nameInput3 ? nameInput3.value.trim() : '';
      if (name) {
        // 先保存当前编辑器内容到上一个方案
        if (Parser.state._editingChainSchemeIdx != null && schemaChainInput.value.trim()) {
          syncFieldsFromUI();
          var prevSchema = buildSchemaFromUI();
          var prevIdx = Parser.state._editingChainSchemeIdx;
          if (prevIdx >= 0 && prevIdx < Parser.state.chainSchemes.length) {
            Parser.state.chainSchemes[prevIdx].schema = prevSchema;
            saveChainSchemesToStorage();
          }
        }
        // 检查重名
        var dup = Parser.state.chainSchemes.findIndex(function(s) { return s.name === name; });
        if (dup >= 0) {
          Parser.state._editingChainSchemeIdx = dup;
        } else {
          Parser.state.chainSchemes.push({ name: name, schema: { mode: 'chain', deepestSelector: '', chainSegments: [], fields: [] }, checked: true });
          Parser.state._editingChainSchemeIdx = Parser.state.chainSchemes.length - 1;
          saveChainSchemesToStorage();
          refreshChainSchemeSelect();
        }
      }
      schemaChainInput.value = '';
      Parser.state.chainSegments = [];
      Parser.state._selectedChainPath = null;
      _expandedChains = {};
      _resetTraceStripCheckboxes();
      if (nameInput3) nameInput3.value = name || '';  // 保留名称，不清空
      renderChainTree();
      var body = document.getElementById('chainEditorBody');
      if (body) body.innerHTML = '<div class="tree-empty">选择一个节点开始配置提取属性</div>';
      var title = document.getElementById('chainEditorTitle');
      if (title) title.textContent = '← 点击左侧节点编辑';
      // 显示全部面板（新建模式）
      var treePanel = document.getElementById('chainTreePanel');
      var editorPanel = document.getElementById('chainEditorPanel');
      var divider = document.getElementById('chainSplitDivider');
      var configRow = document.querySelector('#schemaChainPanel .schema-chain-config');
      if (treePanel) treePanel.style.display = '';
      if (editorPanel) editorPanel.style.display = '';
      if (divider) divider.style.display = '';
      if (configRow) configRow.style.display = '';
      // 清空预览
      Parser.state.schemaPreviewData = null;
      if (schemaPreviewWrap) schemaPreviewWrap.innerHTML = '<div class="tree-empty">输入选择器后自动预览</div>';
      if (schemaPreviewInfo) schemaPreviewInfo.textContent = '';
      autoRefreshChainPreview();
    });
    if (btnSave) btnSave.addEventListener('click', chainSaveCurrent);
    if (btnDel) btnDel.addEventListener('click', function() {
      // 删除：优先删下拉勾选的，否则删当前编辑的
      var checked = (Parser.state.chainSchemes || []).filter(function(s) { return s.checked; });
      if (checked.length > 0) {
        checked.forEach(function(s) {
          var idx = Parser.state.chainSchemes.indexOf(s);
          if (idx >= 0) Parser.state.chainSchemes.splice(idx, 1);
        });
        Parser.state._editingChainSchemeIdx = null;
        saveChainSchemesToStorage();
        refreshChainSchemeSelect();
        _updateChainModeByCheckCount();
        setStatus('已删除 ' + checked.length + ' 个方案');
      } else {
        setStatus('没有勾选的方案可删除');
      }
    });
    var trigger = document.getElementById('chainSchemeTrigger');
    if (trigger) trigger.addEventListener('click', _toggleChainDropdown);
    if (btnExport) btnExport.addEventListener('click', function() {
      var json = JSON.stringify({ chain_schemes: Parser.state.chainSchemes }, null, 2);
      var base64 = Parser.utils.toBase64(json);
      window.api.showSaveDialog({
        title: '导出链路方案',
        defaultPath: 'chain-schemes.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      }).then(function(dr) {
        if (!dr.canceled && dr.filePath) {
          window.api.saveFile(dr.filePath, base64);
          setStatus('方案已导出');
        }
      });
    });
    if (btnImport && fileInput) {
      btnImport.addEventListener('click', function() { fileInput.click(); });
      fileInput.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          try {
            var data = JSON.parse(ev.target.result);
            var schemes = data.chain_schemes || [];
            if (!Array.isArray(schemes)) { setStatus('无效的方案文件'); return; }
            Parser.state.chainSchemes = schemes;
            saveChainSchemesToStorage();
            refreshChainSchemeSelect();
            setStatus('已导入 ' + schemes.length + ' 个方案');
          } catch (err) { setStatus('解析失败: ' + err.message); }
        };
        reader.readAsText(file);
        this.value = '';
      });
    }

    // 初始化方案列表（纯内存）
    loadChainSchemesFromStorage();
    refreshChainSchemeSelect();

    // 链路类型切换（CSS / XPath 按钮）
    var btnTypeCss = document.getElementById('schemaTypeCss');
    var btnTypeXpath = document.getElementById('schemaTypeXpath');
    if (btnTypeCss) {
      btnTypeCss.addEventListener('click', function () {
        btnTypeCss.classList.add('active');
        if (btnTypeXpath) btnTypeXpath.classList.remove('active');
        parseChain();
      });
    }
    if (btnTypeXpath) {
      btnTypeXpath.addEventListener('click', function () {
        btnTypeXpath.classList.add('active');
        if (btnTypeCss) btnTypeCss.classList.remove('active');
        parseChain();
      });
    }

    // 链路解析
    btnParseChain.addEventListener('click', parseChain);
    btnTraceChain.addEventListener('click', traceChain);
    // 输入变化 300ms 自动解析（粘贴、修改无需按回车）
    schemaChainInput.addEventListener('input', function() {
      if (_chainInputTimer) clearTimeout(_chainInputTimer);
      _chainInputTimer = setTimeout(function() {
        _chainInputTimer = null;
        parseChain();
      }, 300);
    });
    schemaChainInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); parseChain(); }
    });
    if (chainStripId) chainStripId.addEventListener('change', parseChain);
    if (chainStripBare) chainStripBare.addEventListener('change', parseChain);

    btnAddField.addEventListener('click', addSchemaField);
    // 手动面板「新建」按钮
    var btnSchemaNew = document.getElementById('btnSchemaNew');
    if (btnSchemaNew) {
      btnSchemaNew.addEventListener('click', function() {
        // 填名称 → 存为方案 → 下拉出现 → 清空
        var name = schemaName.value.trim();
        if (name) {
          syncFieldsFromUI();
          var schema = buildSchemaFromUI();
          schema.name = name;
          saveSchemaToStorage(name, schema);
          refreshSchemaList();
          // 记住，后续「保存方案」更新它
          Parser.state.schemaCurrentName = name;
        }
        Parser.state.schemaFields = [{ type: 'css', selector: '', attr: '', name: '' }];
        // 保留名称
        renderSchemaFields();
        Parser.state.schemaPreviewData = null;
        if (schemaPreviewWrap) schemaPreviewWrap.innerHTML = '<div class="tree-empty">输入选择器后自动预览</div>';
        if (schemaPreviewInfo) schemaPreviewInfo.textContent = '';
        autoRefreshPreview();
      });
    }
    // 「预览提取」「保存方案」「替换查询」「追加到查询」已移至 bindSchemaEvents

    btnSchemaSave.addEventListener('click', handleSaveSchema);
    // 手动下拉：点击触发器开/关，点击外部关闭
    var manualTrigger = document.getElementById('manualSchemeTrigger');
    if (manualTrigger) {
      manualTrigger.addEventListener('click', function(e) { e.stopPropagation(); _toggleManualDropdown(); });
    }
    document.addEventListener('click', function(e) {
      var dd = document.getElementById('manualSchemeDropdown');
      if (dd && !dd.contains(e.target) && manualSchemeOptions) manualSchemeOptions.classList.add('hidden');
    });
    btnSchemaImport.addEventListener('click', handleImportSchemaFile);
    btnSchemaExport.addEventListener('click', handleExportSchemaFile);
    schemaFileInput.addEventListener('change', handleSchemaFileSelected);

    // 初始化字段列表
    renderSchemaFields();

    // 暴露剪贴板多选给其他模块使用
    window._showClipboardMultiPicker = _showClipboardMultiPicker;
    window._addToClipboard = addToClipboard;
  }

  init();
})();
