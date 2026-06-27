/**
 * tab-browser.js
 * Tab 浏览器窗口的 tab 管理逻辑
 */
(function () {
  'use strict';

  // ──────── 状态 ────────
  var tabs = [];
  var activeTabId = null;
  var tabCounter = 0;

  // ──────── DOM ────────
  var tbUrlInput = document.getElementById('tbUrlInput');
  var tbTabbar = document.getElementById('tbTabbar');
  var tbWebviews = document.getElementById('tbWebviews');
  var btnBack = document.getElementById('btnBack');
  var btnForward = document.getElementById('btnForward');
  var btnNewTab = document.getElementById('btnNewTab');

  // ──────── Tab 操作 ────────

  function addTab(url) {
    if (!url) url = 'about:blank';
    url = String(url);

    var id = 'tab_' + (++tabCounter);
    var tab = { id: id, url: url, title: url, loading: true };

    // 创建 tab 标签
    var tabEl = document.createElement('div');
    tabEl.className = 'tb-tab active';
    tabEl.dataset.id = id;
    tabEl.innerHTML =
      '<span class="tb-tab-loading"></span>' +
      '<span class="tb-tab-title">' + escapeHtml(url) + '</span>' +
      '<span class="tb-tab-close" data-id="' + id + '">&times;</span>';
    tbTabbar.appendChild(tabEl);

    // 创建 webview
    var wv = document.createElement('webview');
    wv.src = url;
    wv.className = 'active';
    wv.setAttribute('allowpopups', '');
    tbWebviews.appendChild(wv);
    tab.webview = wv;
    tab.tabEl = tabEl;

    // 事件
    wv.addEventListener('did-finish-load', function () {
      tab.loading = false;
      tab.url = wv.getURL();
      tab.title = wv.getTitle() || tab.url;
      updateTabLabel(tab);
      if (tab.id === activeTabId) tbUrlInput.value = tab.url;
      var loadingEl = tabEl.querySelector('.tb-tab-loading');
      if (loadingEl) loadingEl.style.display = 'none';
      // 注入当前主题
      var isLight = document.body.classList.contains('theme-light');
      try { wv.executeJavaScript('document.documentElement.classList.toggle("theme-light",' + isLight + ');'); } catch(e) {}
    });
    wv.addEventListener('page-title-updated', function (e) {
      tab.title = e.title || tab.url;
      updateTabLabel(tab);
    });
    wv.addEventListener('did-start-loading', function () {
      tab.loading = true;
      var loadingEl = tabEl.querySelector('.tb-tab-loading');
      if (loadingEl) loadingEl.style.display = '';
    });
    // 嵌套弹窗拦截
    wv.addEventListener('new-window', function (e) {
      e.preventDefault();
      if (e.url && e.url !== 'about:blank') addTab(e.url);
    });

    // 推入数组、切换
    tabs.push(tab);
    switchTab(id);

    // 点击 tab 切换
    tabEl.addEventListener('click', function (e) {
      if (e.target.classList.contains('tb-tab-close')) return;
      switchTab(id);
    });
    // 关闭按钮
    tabEl.querySelector('.tb-tab-close').addEventListener('click', function (e) {
      e.stopPropagation();
      closeTab(id);
    });
  }

  function switchTab(id) {
    var old = tabs.find(function (t) { return t.id === activeTabId; });
    var next = tabs.find(function (t) { return t.id === id; });
    if (!next) return;

    if (old && old.webview) old.webview.classList.remove('active');
    if (old && old.tabEl) old.tabEl.classList.remove('active');

    next.webview.classList.add('active');
    next.tabEl.classList.add('active');
    tbUrlInput.value = next.url;
    activeTabId = id;
  }

  function closeTab(id) {
    var idx = tabs.findIndex(function (t) { return t.id === id; });
    if (idx < 0) return;
    var tab = tabs[idx];

    // 移除 webview
    if (tab.webview && tab.webview.parentNode) tab.webview.parentNode.removeChild(tab.webview);
    // 移除 tab 标签
    if (tab.tabEl && tab.tabEl.parentNode) tab.tabEl.parentNode.removeChild(tab.tabEl);

    tabs.splice(idx, 1);

    // 切换或关闭窗口
    if (tabs.length === 0) {
      activeTabId = null;
      if (window.tabApi) window.tabApi.closeWindow();
    } else if (activeTabId === id) {
      var nextIdx = Math.min(idx, tabs.length - 1);
      switchTab(tabs[nextIdx].id);
    }
  }

  function updateTabLabel(tab) {
    if (!tab.tabEl) return;
    var titleEl = tab.tabEl.querySelector('.tb-tab-title');
    if (titleEl) titleEl.textContent = tab.title || tab.url;
    tab.tabEl.title = tab.title || tab.url;
  }

  // ──────── 工具栏事件 ────────

  function getActiveTab() {
    return tabs.find(function (t) { return t.id === activeTabId; });
  }

  btnBack.addEventListener('click', function () {
    var tab = getActiveTab();
    if (tab && tab.webview && tab.webview.canGoBack()) tab.webview.goBack();
  });
  btnForward.addEventListener('click', function () {
    var tab = getActiveTab();
    if (tab && tab.webview && tab.webview.canGoForward()) tab.webview.goForward();
  });
  btnNewTab.addEventListener('click', function () {
    addTab('about:blank');
    tbUrlInput.focus();
  });
  tbUrlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var tab = getActiveTab();
      if (!tab) return;
      var url = tbUrlInput.value.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url) && !/^about:/i.test(url) && !/^file:/i.test(url)) {
        url = 'https://' + url;
      }
      tab.url = url;
      tab.loading = true;
      tab.webview.loadURL(url);
      var loadingEl = tab.tabEl.querySelector('.tb-tab-loading');
      if (loadingEl) loadingEl.style.display = '';
      tbUrlInput.value = url;
    }
  });

  // ── 粘贴时自动 trim 前导/尾部空格 ──
  document.addEventListener('paste', function(e) {
    var target = e.target;
    if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) return;
    if (target.readOnly || target.disabled) return;
    e.preventDefault();
    var pastedText = (e.clipboardData || window.clipboardData).getData('text/plain');
    pastedText = pastedText.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
    var start = target.selectionStart;
    var end = target.selectionEnd;
    var val = target.value;
    target.value = val.substring(0, start) + pastedText + val.substring(end);
    var newPos = start + pastedText.length;
    target.selectionStart = target.selectionEnd = newPos;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // ──────── IPC 监听 ────────

  if (window.tabApi && window.tabApi.onAddTab) {
    window.tabApi.onAddTab(function (url) {
      addTab(url);
    });
  }

  // 主题同步
  function applyTheme(theme) {
    document.body.classList.toggle('theme-light', theme === 'light');
    // 转发给所有 webview
    tabs.forEach(function(t) {
      if (t.webview) {
        try {
          t.webview.executeJavaScript(
            'document.documentElement.classList.toggle("theme-light", ' + (theme === 'light') + ');'
          );
        } catch(e) {}
      }
    });
  }
  if (window.tabApi && window.tabApi.onTheme) {
    window.tabApi.onTheme(applyTheme);
  }
  if (window.tabApi && window.tabApi.getTheme) {
    window.tabApi.getTheme().then(applyTheme);
  }

  // ──────── 工具 ────────

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

})();
