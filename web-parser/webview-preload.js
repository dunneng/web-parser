/**
 * webview-preload.js
 * 注入到 webview 中的脚本，提供增强的元素提取功能
 *
 * 功能：
 * 1. 拖拽框选（矩形区域选择多个元素）
 * 2. 同类预览（hover 条目时闪烁同类元素）
 * 3. 层级穿透（嵌套元素选择器）
 * 4. 自适应选择器（生成不同粒度 CSS 选择器）
 * 5. 滚动跟随优化 (IntersectionObserver)
 */

(function () {
  'use strict';

  // ====== 浏览器指纹伪装（在网页 JS 执行前覆盖检测点） ======
  (function stealth() {
    // 读取配置（由 renderer 通过 executeJavaScript 在 did-start-loading 时注入）
    // 若配置尚未到达，isEnabled 默认返回 true（最大限度防护）
    var _cfg = null;
    function _getCfg() {
      if (_cfg) return _cfg;
      try { _cfg = (window.__parser && window.__parser._stealthConfig) || {}; } catch (e) { _cfg = {}; }
      return _cfg;
    }
    function isEnabled(name) {
      var c = _getCfg();
      if (!c || !c.scripts) return true; // 配置未到达，默认开启
      return c.scripts.indexOf(name) !== -1;
    }
    function _log(name, msg) {
      if (isEnabled(name)) {
        try { console.debug('[stealth] ' + name + ': ' + (msg || '已启用')); } catch (e) {}
      }
    }

    // ════════════════════════════════
    //  基础伪装（始终启用，不在开关列表）
    // ════════════════════════════════

    // 1. 移除 webdriver 标记
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: function () { return false; },
        configurable: true
      });
    } catch (e) {}

    // 2. 伪造 window.chrome 对象
    if (!window.chrome) {
      window.chrome = { app: {}, csi: function () {}, loadTimes: function () {}, runtime: {} };
    } else {
      if (!window.chrome.app) window.chrome.app = {};
      if (!window.chrome.csi) window.chrome.csi = function () {};
      if (!window.chrome.loadTimes) window.chrome.loadTimes = function () {};
      if (!window.chrome.runtime) window.chrome.runtime = {};
    }

    // 3. 语言设置
    if (!navigator.languages || navigator.languages.length === 0) {
      try {
        Object.defineProperty(navigator, 'languages', {
          get: function () { return ['zh-CN', 'zh', 'en']; },
          configurable: true
        });
      } catch (e) {}
    }

    // 4. 伪造 plugins / mimeTypes
    var pluginsAreEmpty = false;
    try { pluginsAreEmpty = !navigator.plugins || navigator.plugins.length === 0; } catch (e) { pluginsAreEmpty = true; }
    if (pluginsAreEmpty) {
      try {
        var fakePluginsArr = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1, _mimes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }] },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1, _mimes: [{ type: 'application/x-google-chrome-print-preview-pdf', suffixes: 'pdf', description: 'Portable Document Format' }] },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2, _mimes: [{ type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' }, { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' }] }
        ];
        fakePluginsArr.item = function (i) { return this[i] || null; };
        fakePluginsArr.namedItem = function (name) { for (var i = 0; i < this.length; i++) { if (this[i].name === name) return this[i]; } return null; };
        fakePluginsArr.refresh = function () {};
        for (var pi = 0; pi < fakePluginsArr.length; pi++) {
          var p = fakePluginsArr[pi];
          p.item = function (i) { return this._mimes[i] || null; };
          p.namedItem = function (name) { for (var j = 0; j < this._mimes.length; j++) { if (this._mimes[j].type === name) return this._mimes[j]; } return null; };
        }
        var fakeMimesArr = [];
        for (var i = 0; i < fakePluginsArr.length; i++) {
          for (var j = 0; j < fakePluginsArr[i]._mimes.length; j++) {
            var mt = fakePluginsArr[i]._mimes[j];
            mt.enabledPlugin = fakePluginsArr[i];
            fakeMimesArr.push(mt);
          }
        }
        fakeMimesArr.item = function (i) { return this[i] || null; };
        fakeMimesArr.namedItem = function (name) { for (var i = 0; i < this.length; i++) { if (this[i].type === name) return this[i]; } return null; };
        Object.defineProperty(navigator, 'plugins', { get: function () { return fakePluginsArr; }, configurable: true });
        Object.defineProperty(navigator, 'mimeTypes', { get: function () { return fakeMimesArr; }, configurable: true });
      } catch (e) {}
    }

    // 5. hardwareConcurrency
    try {
      if (!navigator.hardwareConcurrency || navigator.hardwareConcurrency < 2) {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: function () { return 4; }, configurable: true });
      }
    } catch (e) {}

    // ════════════════════════════════
    //  高级伪装 —— 通过 CDP Page.addScriptToEvaluateOnNewDocument 注入
    //  见 main.js stealth:inject-cdp 和 app.js setupCdpStealthInjection
    // ════════════════════════════════

  })();

  // ──────── 全局命名空间 ────────
  window.__parser = window.__parser || {};
  var P = window.__parser;

  // ──────── 工具函数 ────────

  /** 生成元素从目标到根的唯一 CSS 路径 */
  function generateCSSPath(el, depth) {
    if (!el || el === document.body || el === document.documentElement) return '';
    if (el.id) return '#' + CSS.escape(el.id);

    depth = depth || 0;
    var maxDepth = 5;
    var parts = [];
    var current = el;

    while (current && current !== document.body && current !== document.documentElement && parts.length < (depth > 0 ? depth : maxDepth)) {
      var tag = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
      var clsStr = (typeof current.className === 'string') ? current.className : (current.className && current.className.baseVal || '');
      if (clsStr) {
        var cls = clsStr.trim().split(/\s+/).filter(function (c) { return c; }).slice(0, 2);
        if (cls.length > 0) {
          tag += '.' + cls.map(function (c) { return CSS.escape(c); }).join('.');
        }
      }
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function (c) { return c.tagName === current.tagName; });
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

  /** 生成多个不同粒度的选择器 */
  function generateAdaptiveSelectors(el) {
    if (!el) return [];
    var selectors = [];

    // 1. 仅标签
    var tag = el.tagName.toLowerCase();
    selectors.push({ selector: tag, label: '标签 ' + tag, specificity: 1 });

    // 2. 标签 + ID
    if (el.id) {
      selectors.push({ selector: '#' + CSS.escape(el.id), label: '#' + el.id, specificity: 100 });
    }

    // 3. 标签 + 类
    var elClsStr = (typeof el.className === 'string') ? el.className : (el.className && el.className.baseVal || '');
    if (elClsStr) {
      var cls = elClsStr.trim().split(/\s+/).filter(function (c) { return c; });
      if (cls.length === 1) {
        selectors.push({ selector: tag + '.' + CSS.escape(cls[0]), label: tag + '.' + cls[0], specificity: 10 });
        selectors.push({ selector: '.' + CSS.escape(cls[0]), label: '.' + cls[0], specificity: 10 });
      } else if (cls.length >= 2) {
        var joined = cls.slice(0, 2).map(function (c) { return CSS.escape(c); }).join('.');
        selectors.push({ selector: tag + '.' + joined, label: tag + '.' + joined, specificity: 20 });
        selectors.push({ selector: '.' + joined, label: '.' + joined, specificity: 20 });
      }
    }

    // 4. 父 > 子 路径（短路径）
    var parentPath = generateCSSPath(el, 2);
    if (parentPath && !selectors.some(function (s) { return s.selector === parentPath; })) {
      selectors.push({ selector: parentPath, label: parentPath, specificity: 50 });
    }

    // 5. 完整路径
    var fullPath = generateCSSPath(el, 0);
    if (fullPath && fullPath !== parentPath && !selectors.some(function (s) { return s.selector === fullPath; })) {
      selectors.push({ selector: fullPath, label: fullPath, specificity: 80 });
    }

    return selectors;
  }

  /** 获取一个点下的所有元素（从最上层到最下层） */
  function getElementsAtPoint(x, y) {
    var els = [];
    // 先临时隐藏 picker mask 才能穿透
    var mask = document.getElementById('__parser_mask');
    if (mask) mask.style.display = 'none';

    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body && el !== document.documentElement) {
      els.push(el);
      el = el.parentElement;
    }

    if (mask) mask.style.display = '';
    return els;
  }

  /** 计算两个矩形是否相交 */
  function rectsIntersect(r1, r2) {
    return !(r2.left > r1.right || r2.right < r1.left || r2.top > r1.bottom || r2.bottom < r1.top);
  }

  /** 获取选区内的所有元素 */
  function getElementsInRect(x1, y1, x2, y2) {
    var left = Math.min(x1, x2);
    var top = Math.min(y1, y2);
    var right = Math.max(x1, x2);
    var bottom = Math.max(y1, y2);
    var selRect = { left: left, top: top, right: right, bottom: bottom };

    var all = document.querySelectorAll('body *');
    var result = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var r = el.getBoundingClientRect();
      // 过滤不可见元素
      if (r.width === 0 || r.height === 0) continue;
      // 过滤 body/html
      if (el === document.body || el === document.documentElement) continue;
      // 过滤 parser 自身 UI
      if (el.id && (el.id.indexOf('__parser') === 0 || el.id.indexOf('parser_') === 0)) continue;

      if (rectsIntersect(selRect, { left: r.left, top: r.top, right: r.right, bottom: r.bottom })) {
        result.push(el);
      }
    }
    return result;
  }

  // ──────── 拖拽选择器 ────────

  P.dragSelector = {
    active: false,
    startX: 0,
    startY: 0,
    dragBox: null,
    isDragging: false,
    selectedElements: [],

    init: function () {
      var self = this;
      document.addEventListener('mousedown', function (e) {
        if (!self.active) return;
        var mask = document.getElementById('__parser_mask');
        if (!mask || !mask.contains(e.target)) return;

        // 左键拖拽
        if (e.button !== 0) return;
        self.startX = e.clientX;
        self.startY = e.clientY;
        self.isDragging = false;
        self.selectedElements = [];

        // 创建拖拽框
        self.dragBox = document.createElement('div');
        self.dragBox.id = '__parser_drag_box';
        self.dragBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:1px dashed #4ade80;background:rgba(74,222,128,0.08);display:none;';
        document.documentElement.appendChild(self.dragBox);
      });

      document.addEventListener('mousemove', function (e) {
        if (!self.active || !self.dragBox) return;
        var dx = Math.abs(e.clientX - self.startX);
        var dy = Math.abs(e.clientY - self.startY);
        if (dx > 5 || dy > 5) {
          self.isDragging = true;
          self.dragBox.style.display = '';
          self.dragBox.style.left = Math.min(self.startX, e.clientX) + 'px';
          self.dragBox.style.top = Math.min(self.startY, e.clientY) + 'px';
          self.dragBox.style.width = Math.abs(e.clientX - self.startX) + 'px';
          self.dragBox.style.height = Math.abs(e.clientY - self.startY) + 'px';
        }
      });

      document.addEventListener('mouseup', function (e) {
        if (!self.active || !self.dragBox) return;
        self.dragBox.remove();
        self.dragBox = null;

        if (self.isDragging) {
          self.isDragging = false;
          var els = getElementsInRect(self.startX, self.startY, e.clientX, e.clientY);
          self.selectedElements = els;
          // 通过 CustomEvent 通知
          window.dispatchEvent(new CustomEvent('parser:drag-select', {
            detail: { elements: els, count: els.length }
          }));
        }
      });
    },

    enable: function () { this.active = true; },
    disable: function () {
      this.active = false;
      if (this.dragBox) { this.dragBox.remove(); this.dragBox = null; }
      this.isDragging = false;
    }
  };

  // ──────── 同类预览高亮 ────────

  P.previewer = {
    highlightBoxes: [],
    timer: null,

    /** 高亮所有匹配选择器的元素 */
    highlight: function (selector, color) {
      this.clear();
      color = color || '#f59e0b';
      try {
        var els = document.querySelectorAll(selector);
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          var r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          var box = document.createElement('div');
          box.className = '__parser_preview_box';
          box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;border:2px solid ' + color + ';border-radius:2px;box-sizing:border-box;background:rgba(245,158,11,0.08);left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;transition:opacity 0.15s;';
          document.documentElement.appendChild(box);
          this.highlightBoxes.push(box);

          // 脉冲动画
          box.animate([
            { boxShadow: '0 0 0 0 ' + color },
            { boxShadow: '0 0 0 6px rgba(245,158,11,0)' }
          ], { duration: 600, iterations: 2 });
        }
      } catch (e) { }
    },

    /** 清除高亮 */
    clear: function () {
      for (var i = 0; i < this.highlightBoxes.length; i++) {
        if (this.highlightBoxes[i].parentNode) {
          this.highlightBoxes[i].parentNode.removeChild(this.highlightBoxes[i]);
        }
      }
      this.highlightBoxes = [];
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }
  };

  // ──────── 滚动跟随 (IntersectionObserver) ────────

  P.scrollWatcher = {
    observer: null,
    watchedSelectors: [],
    watchedBoxes: new Map(), // selector -> [box elements]
    updateTimer: null,

    init: function () {
      var self = this;
      this.observer = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          // 触发位置更新
          self.scheduleUpdate();
        }
      }, { threshold: [0, 0.1, 0.2, 0.5, 0.8, 1.0] });
    },

    /** 开始观察一个选择器 */
    watch: function (selector) {
      if (!this.observer) this.init();
      if (this.watchedSelectors.indexOf(selector) >= 0) return;
      this.watchedSelectors.push(selector);
      this.updateBoxes();
    },

    /** 停止观察一个选择器 */
    unwatch: function (selector) {
      var idx = this.watchedSelectors.indexOf(selector);
      if (idx >= 0) {
        this.watchedSelectors.splice(idx, 1);
        this.removeBoxes(selector);
      }
    },

    /** 停止所有观察 */
    unwatchAll: function () {
      var self = this;
      this.watchedSelectors.forEach(function (sel) { self.removeBoxes(sel); });
      this.watchedSelectors = [];
    },

    /** 移除某个选择器的框 */
    removeBoxes: function (selector) {
      var boxes = this.watchedBoxes.get(selector) || [];
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].el && boxes[i].el.parentNode) boxes[i].el.parentNode.removeChild(boxes[i].el);
      }
      this.watchedBoxes.delete(selector);
    },

    /** 调度更新（防抖） */
    scheduleUpdate: function () {
      var self = this;
      if (this.updateTimer) clearTimeout(this.updateTimer);
      this.updateTimer = setTimeout(function () { self.updateBoxes(); }, 100);
    },

    /** 更新所有观察选择器的框位置 */
    updateBoxes: function () {
      var self = this;
      this.watchedSelectors.forEach(function (selector) {
        // 移除旧框
        self.removeBoxes(selector);

        try {
          var els = document.querySelectorAll(selector);
          var boxes = [];
          for (var i = 0; i < els.length; i++) {
            var el = els[i];
            // 观察元素可见性
            self.observer.observe(el);

            var r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;

            var box = document.createElement('div');
            box.className = '__parser_scroll_box';
            box.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483644;border:2px solid #7c5cfc;border-radius:2px;box-sizing:border-box;background:rgba(124,92,252,0.05);';
            box.dataset.selector = selector;
            self.positionBox(box, el);
            document.documentElement.appendChild(box);
            boxes.push({ el: box, target: el });
          }
          self.watchedBoxes.set(selector, boxes);
        } catch (e) { }
      });
    },

    /** 定位吸附框到元素 */
    positionBox: function (box, el) {
      var r = el.getBoundingClientRect();
      box.style.left = (r.left + window.scrollX) + 'px';
      box.style.top = (r.top + window.scrollY) + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
    }
  };

  // ──────── 初始化 ────────

  // 页面加载完成后初始化拖拽选择器
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      P.dragSelector.init();
      P.scrollWatcher.init();
    });
  } else {
    P.dragSelector.init();
    P.scrollWatcher.init();
  }

  // 页面滚动时更新框位置
  var scrollUpdateTimer = null;
  document.addEventListener('scroll', function () {
    if (scrollUpdateTimer) clearTimeout(scrollUpdateTimer);
    scrollUpdateTimer = setTimeout(function () {
      // 更新所有 scrollWatcher 的框
      if (P.scrollWatcher) P.scrollWatcher.scheduleUpdate();

      // 更新 picker 的选中框
      var boxes = document.querySelectorAll('.__parser_scroll_box, [class*="__parser_"]');
      // 重新定位所有的 __parser 框
      var allBoxes = document.querySelectorAll('[id^="__parser"]');
      for (var i = 0; i < allBoxes.length; i++) {
        var box = allBoxes[i];
        if (box.dataset && box.dataset.target) continue; // 这些由 scrollWatcher 管理
      }
    }, 50);
  });

  // ──────── 注册 API ────────

  P.utils = {
    generateCSSPath: generateCSSPath,
    generateAdaptiveSelectors: generateAdaptiveSelectors,
    getElementsAtPoint: getElementsAtPoint,
    getElementsInRect: getElementsInRect
  };

  // ──────── 自定义导出提取引擎 ────────

  /**
   * 根据字段定义方案提取页面数据（zip 对齐）
   * @param {Array}  fields    [{name, type:'css'|'xpath', selector}]
   * @param {String} delimiter 多值连接分隔符
   * @returns {{rows:Array, counts:Array, totalRows:Number, headers:Array}}
   */
  P.extractBySchema = function(fields, delimiter) {
    delimiter = delimiter || ' | ';
    var columns = [];
    var maxLen = 0;

    for (var fi = 0; fi < fields.length; fi++) {
      var f = fields[fi];
      var values = [];

      if (f.type === 'css') {
        var sel = f.selector;
        var attrName = null;
        // 检查 @attr 后缀 (如 img@src, a@href)
        var m = sel.match(/@([\w-]+)$/);
        if (m) {
          attrName = m[1];
          sel = sel.substring(0, m.index).trim();
        }
        try {
          var els = document.querySelectorAll(sel);
          for (var j = 0; j < els.length; j++) {
            var v;
            if (attrName) {
              v = els[j].getAttribute(attrName);
              // fallback 到 DOM 属性
              if ((v === null || v === undefined) && (attrName in els[j])) {
                v = els[j][attrName];
              }
              if (v === null || v === undefined) v = '';
            } else {
              v = (els[j].textContent || '').trim();
            }
            values.push(String(v));
          }
        } catch(e) {
          // 选择器无效，整列为空
        }
      } else if (f.type === 'xpath') {
        try {
          var result = document.evaluate(
            f.selector, document, null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
          );
          for (var k = 0; k < result.snapshotLength; k++) {
            var node = result.snapshotItem(k);
            var v;
            if (node.nodeType === Node.ATTRIBUTE_NODE || node.nodeType === 2) {
              v = node.value || '';
            } else {
              v = (node.textContent || '').trim();
            }
            values.push(String(v));
          }
        } catch(e) {
          // XPath 无效，整列为空
        }
      }

      columns.push(values);
      if (values.length > maxLen) maxLen = values.length;
    }

    // Zip 对齐：按索引配对，缺项填空
    var rows = [];
    for (var r = 0; r < maxLen; r++) {
      var row = {};
      for (var c = 0; c < fields.length; c++) {
        var val = columns[c][r];
        // 同一字段内多个匹配结果用分隔符连接
        row[fields[c].name] = (val !== undefined && val !== null) ? String(val) : '';
      }
      rows.push(row);
    }

    return {
      rows: rows,
      counts: columns.map(function(c) { return c.length; }),
      totalRows: maxLen,
      headers: fields.map(function(f) { return f.name; })
    };
  };

  // ──────── 增量采集 ────────

  // 清洗文本：移除不可见字符，统一空白（与 renderer normalizeText 一致）
  function _cleanText(str) {
    if (!str) return '';
    str = String(str);
    str = str.replace(/\p{Zs}/gu, ' ');
    str = str.replace(/\p{Zl}/gu, ' ');
    str = str.replace(/\p{Zp}/gu, ' ');
    str = str.replace(/\p{Cf}/gu, '');
    str = str.replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g, '');
    str = str.replace(/[\uE000-\uF8FF\uFFF0-\uFFFD]/g, '');
    str = str.replace(/\s+/g, ' ').trim();
    return str;
  }

  P.collector = {
    knownKeys: {},

    init: function() {
      this.knownKeys = {};
    },

    extractDelta: function(selector, fields) {
      var els = document.querySelectorAll(selector);
      var results = [];
      var self = this;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var row = {};
        var keyParts = [];
        for (var f = 0; f < fields.length; f++) {
          var field = fields[f];
          var val = '';
          if (field.type === 'css') {
            var attr = field.attr || 'textContent';
            if (attr === 'textContent') val = _cleanText(el.textContent || '');
            else val = el.getAttribute(attr) || '';
          } else if (field.type === 'xpath') {
            val = '';
          }
          row[field.name] = val;
          keyParts.push(val);
        }
        var key = keyParts.join('\x00');
        if (!self.knownKeys[key]) {
          self.knownKeys[key] = true;
          results.push(row);
        }
      }
      return results;
    }
  };

  // ──────── 网络拦截 ────────

  P.networkInterceptor = {
    intercepted: [],
    _hooked: false,

    hook: function() {
      if (this._hooked) return;
      this._hooked = true;
      var self = this;

      // Hook fetch
      var _fetch = window.fetch;
      window.fetch = function(url, options) {
        var start = Date.now();
        return _fetch.apply(this, arguments).then(function(resp) {
          var reqUrl = typeof url === 'string' ? url : (url.url || '');
          // 安全克隆：若响应体已消费则跳过拦截，不破坏页面自身的 fetch 调用
          try {
            var cloned = resp.clone();
            cloned.text().then(function(body) {
              self._record(reqUrl, options && options.method || 'GET', resp.status, body, Date.now() - start);
            }).catch(function() {});
          } catch (e) {
            // clone 失败（响应体已消费），跳过此次拦截
          }
          return resp;
        });
      };

      // Hook XMLHttpRequest
      var XHR = window.XMLHttpRequest;
      var _open = XHR.prototype.open;
      var _send = XHR.prototype.send;
      XHR.prototype.open = function(method, url) {
        this.__parser_method = method;
        this.__parser_url = url;
        this.__parser_start = Date.now();
        return _open.apply(this, arguments);
      };
      XHR.prototype.send = function() {
        var xhr = this;
        xhr.addEventListener('readystatechange', function() {
          if (xhr.readyState === 4) {
            var duration = Date.now() - (xhr.__parser_start || Date.now());
            self._record(xhr.__parser_url, xhr.__parser_method, xhr.status, xhr.responseText, duration);
          }
        });
        return _send.apply(this, arguments);
      };
    },

    _record: function(url, method, status, body, duration) {
      if (!url || !body) return;
      if (this.intercepted.length >= 500) this.intercepted = this.intercepted.slice(-300);
      var isJson = false;
      var parsed = null;
      try { parsed = JSON.parse(body); isJson = true; } catch (e) {}
      var bodyType = isJson ? 'json' : 'text';
      var bodySize = body.length;
      var preview = '';
      if (isJson && parsed) {
        var arr = P.networkInterceptor._findArray(parsed);
        preview = arr ? 'Array[' + arr.length + ']' : 'Object';
      } else {
        preview = body.substring(0, 80);
      }
      this.intercepted.push({
        url: url, method: method, status: status,
        bodyType: bodyType, bodySize: bodySize, duration: duration,
        preview: preview, body: body, time: Date.now()
      });
    },

    _findArray: function(obj) {
      if (Array.isArray(obj)) return obj;
      if (typeof obj !== 'object' || obj === null) return null;
      var hop = Object.prototype.hasOwnProperty;
      for (var k in obj) {
        if (!hop.call(obj, k)) continue;
        var v = obj[k];
        if (Array.isArray(v) && v.length > 0) return v;
        if (typeof v === 'object') {
          var r = this._findArray(v);
          if (r) return r;
        }
      }
      return null;
    },

    clear: function() { this.intercepted = []; }
  };

  // 自动 hook
  P.networkInterceptor.hook();
  console.log('[Parser] webview-preload loaded');

})();
