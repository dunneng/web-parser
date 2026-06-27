/**
 * 网页解析器 — 工具函数模块
 * toBase64, showToast, addToClipboard 等通用工具
 */
window.Parser = window.Parser || {};

window.Parser.utils = {
  /** 安全 Base64 编码（支持中文） */
  toBase64: function(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  },

  /** Toast 提示 */
  _toastTimer: null,
  showToast: function(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    el.classList.remove('hidden');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function() {
      el.classList.remove('show');
      setTimeout(function() { el.classList.add('hidden'); }, 250);
    }, 1500);
  },

  /** 文本规范化（清理不可见字符和 Unicode 格式化字符） */
  normalizeText: function(s) {
    if (!s) return '';
    s = String(s);
    // 将所有 Unicode 空白分隔符（Zs）替换为普通空格
    s = s.replace(/\p{Zs}/gu, ' ');
    // 行分隔符 / 段分隔符 → 空格
    s = s.replace(/\p{Zl}/gu, ' ');
    s = s.replace(/\p{Zp}/gu, ' ');
    // 移除所有不可见格式化字符（Cf 类别）：零宽字符、双向控制符、软连字符、BOM 等
    s = s.replace(/\p{Cf}/gu, '');
    // 移除控制字符（Cc），保留 \t \n \r \f \v
    s = s.replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g, '');
    // 移除私有区（PUA）和无标准字形的特殊字符
    s = s.replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\uFFFE\uFFFF]/gu, '');
    // 合并连续空白，去除首尾
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  },

  /** quick DOM selector */
  $: function(s) { return document.querySelector(s); },
  $$: function(s) { return document.querySelectorAll(s); },

  /** 安全字符串：null→''，去 NaN/null/undefined 字面，可选截断 */
  safeStr: function(v, n) {
    var s = (v != null ? String(v) : '');
    s = s.replace(/NaN/g, '');
    if (s === 'null' || s === 'undefined') s = '';
    return n && s.length > n ? s.substring(0, n) + '...' : s;
  },
};
