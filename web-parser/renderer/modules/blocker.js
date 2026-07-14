/**
 * blocker.js — 资源拦截器
 * 加速模式下拦截图片/CSS/字体/媒体等请求，减少带宽和风控检测面。
 *
 * 用法：
 *   Blocker.block(Blocker.ALL)        // 拦截除主框架外全部
 *   Blocker.block(Blocker.STATICS)    // 只拦截静态资源
 *   Blocker.block(Blocker.IKSOFT)     // ikSoft 模式：只放行白名单域名
 *   Blocker.block(Blocker.NONE)       // 解除所有拦截
 *   Blocker.setWhitelist(['*.alicdn.com', '*.taobao.com'])  // 设置白名单
 */

var Blocker = (function () {
  'use strict';

  // ──────── 拦截级别（位掩码）────────
  var IMAGE   = 1;        // 图片 (png/jpg/gif/svg/webp/ico)
  var STYLE   = 2;        // 样式 (css/less/scss)
  var FONT    = 4;        // 字体 (woff2/ttf/eot/otf)
  var MEDIA   = 8;        // 媒体 (mp4/mp3/webm/ogg)
  var SCRIPT  = 16;       // 脚本 (js) — 仅加速模式使用
  var XHR     = 32;       // AJAX — 仅加速模式使用
  var OTHER   = 64;       // websocket/manifest 等
  var IKSOFT  = 128;      // ikSoft 模式：白名单放行，其余全拦

  var STATICS = IMAGE | STYLE | FONT;               // 静态资源
  var ALL     = IMAGE | STYLE | FONT | MEDIA | SCRIPT | XHR | OTHER;  // 除主框架外全部
  var NONE    = 0;

  // ──────── 白名单模式 ────────
  var _isIksoftMode = false;
  var _whitelist = [];
  var _allowApi = true;  // IKSOFT 模式下是否放行 XHR/Fetch

  /** 将通配符模式转为正则 */
  function _patternToRegex(pattern) {
    var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    escaped = escaped.replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$', 'i');
  }

  /** 检查 URL 是否在白名单中 */
  function _isWhitelisted(url) {
    url = (url || '').toLowerCase();
    // 总是放行主框架和子框架
    if (url === '' || url === 'about:blank') return true;
    for (var i = 0; i < _whitelist.length; i++) {
      if (_whitelist[i].test(url)) return true;
    }
    return false;
  }

  // ──────── 资源类型映射 ────────
  function _classifyUrl(url, resourceType) {
    url = (url || '').toLowerCase();

    // ikSoft 模式下：只要不在白名单就拦截
    if (_isIksoftMode) {
      if (resourceType === 'mainFrame' || resourceType === 'subFrame') return 0;
      if (_allowApi && (resourceType === 'xhr' || resourceType === 'fetch')) return 0;
      return _isWhitelisted(url) ? 0 : ALL;
    }

    // Electron 的 onBeforeRequest 提供 resourceType 参数
    switch (resourceType) {
      case 'image':       return IMAGE;
      case 'stylesheet':  return STYLE;
      case 'font':        return FONT;
      case 'media':       return MEDIA;
      case 'script':      return SCRIPT;
      case 'xhr':
      case 'fetch':       return XHR;
      case 'mainFrame':
      case 'subFrame':    return 0;  // 永远不拦截页面本身
      default:            break;
    }

    // 兜底：按 URL 后缀判断
    if (/\.(png|jpe?g|gif|svg|webp|ico|bmp)(\?|$)/i.test(url)) return IMAGE;
    if (/\.(css|less|scss)(\?|$)/i.test(url)) return STYLE;
    if (/\.(woff2?|ttf|eot|otf)(\?|$)/i.test(url)) return FONT;
    if (/\.(mp[34]|webm|ogg|avi|mov|flv)(\?|$)/i.test(url)) return MEDIA;

    return 0;
  }

  // ──────── 主进程 IPC 控制 ────────
  function _sendToMain(level, whitelist) {
    try {
      if (window.api && window.api.blockerSet) {
        window.api.blockerSet({
          level: level,
          whitelist: whitelist || _whitelist.map(function(r) { return r.source; }),
          allowApi: _allowApi
        });
      }
    } catch (e) {
      console.warn('[Blocker] IPC 发送失败:', e.message);
    }
  }

  // ──────── 公开 API ────────
  return {
    NONE:    NONE,
    IMAGE:   IMAGE,
    STYLE:   STYLE,
    FONT:    FONT,
    MEDIA:   MEDIA,
    SCRIPT:  SCRIPT,
    XHR:     XHR,
    OTHER:   OTHER,
    IKSOFT:  IKSOFT,
    STATICS: STATICS,
    ALL:     ALL,

    /** 设置拦截级别 */
    block: function (level) {
      _isIksoftMode = (level === IKSOFT);
      _sendToMain(level);
      var names = [];
      if (level === NONE) names.push('无');
      if (level === IKSOFT) names.push('ikSoft 白名单模式');
      if (level & IMAGE)  names.push('图片');
      if (level & STYLE)  names.push('样式');
      if (level & FONT)   names.push('字体');
      if (level & MEDIA)  names.push('媒体');
      if (level & SCRIPT) names.push('脚本');
      if (level & XHR)    names.push('XHR');
      console.log('[Blocker] 拦截: ' + (names.length ? names.join(',') : '无'));
    },

    /** 清除拦截 */
    clear: function () {
      this.block(NONE);
    },

    /** 设置白名单（ikSoft 模式专用）
     *  @param {string[]} patterns - 通配符模式，如 ['*.alicdn.com', '*.taobao.com']
     *  @param {boolean} allowApi - 是否放行 XHR/Fetch 请求（默认 true）
     */
    setWhitelist: function (patterns, allowApi) {
      _whitelist = (patterns || []).map(_patternToRegex);
      if (typeof allowApi === 'boolean') _allowApi = allowApi;
      _isIksoftMode = true;
      _sendToMain(IKSOFT, patterns);
      console.log('[Blocker] 白名单: ' + (patterns || []).join(', ') + ' | API放行: ' + _allowApi);
    },

    /** 检查 URL 是否在白名单中 */
    isWhitelisted: _isWhitelisted,

    /** 资源分类（供主进程使用） */
    classifyUrl: _classifyUrl,
  };
})();

// 导出到全局
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Blocker;
}
if (typeof window !== 'undefined') {
  window.Blocker = Blocker;
}
