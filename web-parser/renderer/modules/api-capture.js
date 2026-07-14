/**
 * api-capture.js — CDP 拦截 + API 模式
 * 自动捕获 XHR/Fetch JSON 响应，跳过 DOM 直接解析
 *
 * 用法：
 *   ApiCapture.start()       // 开始拦截
 *   ApiCapture.stop()        // 停止
 *   ApiCapture.setFilter(urlPattern)  // 只拦截匹配的 URL
 *   ApiCapture.onCapture(fn) // 监听新数据
 */
var ApiCapture = (function () {
  'use strict';

  var _running = false;
  var _captured = [];          // [{ url, body, time, parsed }]
  var _filter = null;         // RegExp or null
  var _listeners = [];
  var MAX_CAPTURED = 200;

  function _tryParseJSON(str) {
    try { return JSON.parse(str); } catch (e) { return null; }
  }

  function _onCdpResponse(data) {
    if (!_running) return;
    if (_filter && !_filter.test(data.url)) return;

    var parsed = _tryParseJSON(data.body);
    if (!parsed) return;

    var entry = {
      url: data.url,
      body: data.body,
      parsed: parsed,
      time: Date.now(),
      size: data.body ? data.body.length : 0
    };

    _captured.unshift(entry);
    if (_captured.length > MAX_CAPTURED) _captured.pop();

    // 通知监听者
    _listeners.forEach(function (fn) {
      try { fn(entry); } catch (e) {}
    });
  }

  return {
    get captured() { return _captured; },

    /** 开始 CDP 拦截 */
    start: async function (webContentsId) {
      if (_running) return;
      _running = true;

      // 订阅 CDP 事件
      if (window.api && window.api.onCdpResponse) {
        window.api.onCdpResponse(_onCdpResponse);
      }

      // 启动 CDP
      if (window.api && window.api.cdpStart) {
        var result = await window.api.cdpStart(webContentsId);
        console.log('[ApiCapture] CDP start:', result);
      }
    },

    /** 停止 */
    stop: function () {
      _running = false;
    },

    /** 设置 URL 过滤器（正则字符串） */
    setFilter: function (pattern) {
      try {
        _filter = pattern ? new RegExp(pattern) : null;
      } catch (e) {
        console.warn('[ApiCapture] 非法正则:', pattern);
        _filter = null;
      }
    },

    /** 清空已捕获数据 */
    clear: function () {
      _captured.length = 0;
    },

    /** 监听新数据 */
    onCapture: function (fn) {
      _listeners.push(fn);
    },

    /** 移除监听 */
    offCapture: function (fn) {
      var idx = _listeners.indexOf(fn);
      if (idx !== -1) _listeners.splice(idx, 1);
    },

    /** 在捕获数据上执行 JSONPath 查询 */
    query: function (path) {
      var results = [];
      _captured.forEach(function (entry) {
        try {
          var val = _jsonpathGet(entry.parsed, path);
          if (val !== undefined) results.push(val);
        } catch (e) {}
      });
      return results;
    },

    /** 导出为表格数据 */
    toTable: function (paths) {
      // paths: [{ key: '标题', path: '$.title' }, { key: '价格', path: '$.price' }]
      var rows = [];
      _captured.forEach(function (entry) {
        var row = {};
        paths.forEach(function (p) {
          try {
            row[p.key] = _jsonpathGet(entry.parsed, p.path) || '';
          } catch (e) {
            row[p.key] = '';
          }
        });
        if (Object.values(row).some(function(v) { return v !== ''; })) {
          rows.push(row);
        }
      });
      return rows;
    }
  };

  // ── 简单 JSONPath 实现 ──
  function _jsonpathGet(obj, path) {
    if (!obj || !path) return undefined;
    // 去掉开头的 $.
    var parts = path.replace(/^\$\.?/, '').split('.');
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
      if (current == null) return undefined;
      var part = parts[i];
      // 处理数组索引 [0]
      var arrMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrMatch) {
        current = current[arrMatch[1]];
        if (Array.isArray(current)) current = current[parseInt(arrMatch[2])];
      } else {
        current = current[part];
      }
    }
    return current;
  }

})();

if (typeof window !== 'undefined') {
  window.ApiCapture = ApiCapture;
}
