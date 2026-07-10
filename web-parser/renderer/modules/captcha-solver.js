/**
 * captcha-solver.js — 自动打码模块
 * 对接 capsolver.com API，自动识别并提交验证码。
 *
 * 使用前需在设置面板填入 API Key。
 * 支持类型：reCAPTCHA v2 / hCaptcha / ImageToText
 */

var CaptchaSolver = (function () {
  'use strict';

  var _apiKey = '';
  var _enabled = false;
  var _maxRetries = 2;
  var _pollInterval = 3000;  // 轮询间隔 ms
  var _maxPollTime = 120000; // 最大等待 2 分钟

  /** 从 localStorage 读取配置 */
  function loadConfig() {
    try {
      var cfg = JSON.parse(localStorage.getItem('captchaSolverConfig') || '{}');
      _apiKey = cfg.apiKey || '';
      _enabled = !!cfg.enabled && !!_apiKey;
      _maxRetries = cfg.maxRetries || 2;
    } catch (e) {
      _enabled = false;
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem('captchaSolverConfig', JSON.stringify(cfg));
    loadConfig();
  }

  loadConfig();

  // ──────── Capsolver API ────────

  var API_BASE = 'https://api.capsolver.com';

  /** 创建任务 */
  async function _createTask(task) {
    var resp = await fetch(API_BASE + '/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: _apiKey,
        task: task,
      }),
    });
    var data = await resp.json();
    if (data.errorId !== 0) {
      throw new Error('capsolver 创建任务失败: ' + (data.errorDescription || data.errorCode));
    }
    return data.taskId;
  }

  /** 轮询获取结果 */
  async function _getResult(taskId) {
    var start = Date.now();
    while (Date.now() - start < _maxPollTime) {
      var resp = await fetch(API_BASE + '/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: _apiKey, taskId: taskId }),
      });
      var data = await resp.json();
      if (data.errorId !== 0) {
        throw new Error('capsolver 查询失败: ' + (data.errorDescription || data.errorCode));
      }
      if (data.status === 'ready') {
        return data.solution;
      }
      await new Promise(function (r) { setTimeout(r, _pollInterval); });
    }
    throw new Error('capsolver 超时 (' + (_maxPollTime / 1000) + 's)');
  }

  // ──────── 公开 API ────────

  return {
    /** 是否启用 */
    get enabled() { loadConfig(); return _enabled; },

    /** 加载配置 */
    loadConfig: loadConfig,
    saveConfig: saveConfig,

    /** 获取当前配置 */
    getConfig: function () {
      loadConfig();
      return { apiKey: _apiKey, enabled: _enabled, maxRetries: _maxRetries };
    },

    /**
     * 解决 reCAPTCHA v2
     * @param {string} siteKey - reCAPTCHA sitekey
     * @param {string} pageUrl - 页面 URL
     * @returns {string} g-recaptcha-response token
     */
    solveRecaptchaV2: async function (siteKey, pageUrl) {
      if (!_enabled) throw new Error('自动打码未启用');
      var taskId = await _createTask({
        type: 'ReCaptchaV2TaskProxyLess',
        websiteURL: pageUrl,
        websiteKey: siteKey,
      });
      var solution = await _getResult(taskId);
      return solution.gRecaptchaResponse;
    },

    /**
     * 解决 hCaptcha
     */
    solveHcaptcha: async function (siteKey, pageUrl) {
      if (!_enabled) throw new Error('自动打码未启用');
      var taskId = await _createTask({
        type: 'HCaptchaTaskProxyLess',
        websiteURL: pageUrl,
        websiteKey: siteKey,
      });
      var solution = await _getResult(taskId);
      return solution.gRecaptchaResponse;
    },

    /**
     * 解决图片验证码（ImageToText）
     * @param {string} base64Image - 验证码图片 base64
     * @returns {string} 识别结果文本
     */
    solveImageCaptcha: async function (base64Image) {
      if (!_enabled) throw new Error('自动打码未启用');
      var taskId = await _createTask({
        type: 'ImageToTextTask',
        body: base64Image.replace(/^data:image\/\w+;base64,/, ''),
      });
      var solution = await _getResult(taskId);
      return solution.text;
    },

    /**
     * 自动检测并解决页面上的验证码
     * 在 webview 中执行，返回 {solved, type, token}
     */
    autoSolve: async function (retryCount) {
      retryCount = retryCount || 0;
      if (!_enabled || retryCount >= _maxRetries) {
        return { solved: false, error: '打码未启用或已达最大重试' };
      }

      try {
        var wv = document.getElementById('webview');
        if (!wv) return { solved: false, error: 'webview 不存在' };

        // 在 webview 中检测验证码类型并提取 sitekey
        var detectResult = await wv.executeJavaScript(
          '(function() {' +
          '  // reCAPTCHA' +
          '  var rc = document.querySelector(\'.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"], iframe[src*="google.com/recaptcha"]\');' +
          '  if (rc) {' +
          '    var siteKey = rc.getAttribute(\'data-sitekey\') || \'\';' +
          '    if (!siteKey) { var m = (rc.src || \'\').match(/[?&]k=([^&]+)/); if (m) siteKey = m[1]; }' +
          '    if (siteKey) return JSON.stringify({type:"recaptcha_v2", siteKey:siteKey, url:location.href});' +
          '  }' +
          '  // hCaptcha' +
          '  var hc = document.querySelector(\'.h-captcha, iframe[src*="hcaptcha"], iframe[src*="hcaptcha.com"]\');' +
          '  if (hc) {' +
          '    var hk = hc.getAttribute(\'data-sitekey\') || \'\';' +
          '    if (!hk) { var hm = (hc.src || \'\').match(/[?&]sitekey=([^&]+)/); if (hm) hk = hm[1]; }' +
          '    if (hk) return JSON.stringify({type:"hcaptcha", siteKey:hk, url:location.href});' +
          '  }' +
          '  // 图片验证码' +
          '  var imgs = document.querySelectorAll(\'img[src*="captcha"], img[src*="verify"], img[id*="captcha"], img[class*="captcha"]\');' +
          '  if (imgs.length) return JSON.stringify({type:"image_captcha"});' +
          '  return JSON.stringify({type:"unknown"});' +
          '})()'
        );

        var info = JSON.parse(detectResult);

        if (info.type === 'recaptcha_v2' || info.type === 'hcaptcha') {
          console.log('[CaptchaSolver] 检测到 ' + info.type + ', siteKey=' + info.siteKey);
          var token;
          if (info.type === 'hcaptcha') {
            token = await this.solveHcaptcha(info.siteKey, info.url);
          } else {
            token = await this.solveRecaptchaV2(info.siteKey, info.url);
          }
          // 注入 token 到页面并提交
          await wv.executeJavaScript(
            'document.getElementById("g-recaptcha-response") && (document.getElementById("g-recaptcha-response").innerHTML="' + token + '");' +
            'var f = document.querySelector("form"); if (f) f.submit();' +
            'var cb = window.___grecaptcha_cfg; if (cb && cb.clients) { for (var k in cb.clients) { for (var kk in cb.clients[k]) { var c = cb.clients[k][kk]; if (c.callback) c.callback("' + token + '"); } } }'
          );
          return { solved: true, type: info.type, token: token };
        }

        if (info.type === 'image_captcha') {
          // 截图发给 capsolver
          var imgData = await wv.executeJavaScript(
            '(function() {' +
            '  var c = document.createElement("canvas");' +
            '  var imgs = document.querySelectorAll(\'img[src*="captcha"], img[src*="verify"]\');' +
            '  if (!imgs.length) return "";' +
            '  var img = imgs[0];' +
            '  c.width = img.naturalWidth; c.height = img.naturalHeight;' +
            '  c.getContext("2d").drawImage(img, 0, 0);' +
            '  return c.toDataURL("image/png");' +
            '})()'
          );
          if (!imgData) return { solved: false, error: '找不到验证码图片' };

          var text = await this.solveImageCaptcha(imgData);
          console.log('[CaptchaSolver] 图片验证码识别: ' + text);

          // 填入输入框并提交
          await wv.executeJavaScript(
            '(function() {' +
            '  var inp = document.querySelector(\'input[name*="captcha"], input[name*="verify"], input[id*="captcha"], input[class*="captcha"]\');' +
            '  if (!inp) inp = document.querySelector(\'input[type="text"]:not([name*="search"]):not([name*="query"])\');' +
            '  if (inp) { inp.value = "' + text.replace(/"/g, '\\"') + '"; inp.dispatchEvent(new Event("input",{bubbles:true})); }' +
            '  var btn = document.querySelector(\'button[type="submit"], input[type="submit"]\');' +
            '  if (btn) btn.click();' +
            '})()'
          );
          return { solved: true, type: 'image_captcha', text: text };
        }

        return { solved: false, error: '未识别的验证码类型', type: info.type };

      } catch (e) {
        console.error('[CaptchaSolver] 错误:', e.message);
        return { solved: false, error: e.message };
      }
    },
  };
})();

if (typeof window !== 'undefined') {
  window.CaptchaSolver = CaptchaSolver;
}
