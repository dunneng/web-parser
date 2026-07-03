/**
 * 网页解析器 — 查询引擎模块
 */
window.Parser = window.Parser || {};

(function() {
  'use strict';
  var S = window.Parser.state;
  var U = window.Parser.utils;
  var $ = U.$;
  var $$ = U.$$;
  var normalizeText = U.normalizeText;

  // ──────── 查询执行 ────────
  var _eventsBound = false;
  function bindQueryEvents() {
    if (_eventsBound) return;
    _eventsBound = true;
    document.getElementById("btnQuery").addEventListener('click', executeQuery);
    document.getElementById("queryInput").addEventListener('keydown', e => { if (e.key === 'Enter') executeQuery(); });
    // 查询框剪贴板按钮：多选剪贴板条目，逗号合并填入
    document.getElementById("btnQueryClipboard").addEventListener('click', function() {
      var history = Parser.state.clipboardHistory || [];
      if (history.length === 0) {
        Parser.utils.showToast('剪贴板为空，请先在提取结果中 Ctrl+C 复制选择器');
        return;
      }
      var queryInput = document.getElementById("queryInput");
      _showClipboardMultiPicker(queryInput, '查询表达式');
    });
    document.getElementById("querySearch").addEventListener('input', applyFilters);
    // 工具栏全选 ←→ 表头全选 双向同步
    document.getElementById("queryCheckAll").addEventListener('change', function() {
      var checked = document.getElementById("queryCheckAll").checked;
      var rca = document.getElementById("queryResults").querySelector('.result-check-all');
      if (rca) rca.checked = checked;
      document.getElementById("queryResults").querySelectorAll('.result-checkbox').forEach(function(cb) { cb.checked = checked; });
      updateRowSelection();
    });
    // 全局子节点分隔符变更时自动重新查询并持久化
    document.getElementById("globalChildDelim").addEventListener('change', function() {
      S.globalChildDelim = this.value || '';
      try { localStorage.setItem('global_child_delim', S.globalChildDelim); } catch(e) {}
      executeQuery();
    });
    // 展开子节点变更时自动重新查询并持久化
    var expandCB = document.getElementById("expandChildren");
    try {
      var saved = localStorage.getItem('expand_children');
      S.expandChildren = saved === '1';
      expandCB.checked = S.expandChildren;
    } catch(e) { S.expandChildren = false; }
    expandCB.addEventListener('change', function() {
      S.expandChildren = this.checked;
      try { localStorage.setItem('expand_children', S.expandChildren ? '1' : '0'); } catch(e) {}
      executeQuery();
    });

    // ── 表格页面联动 ──
    var linkageCB = document.getElementById("linkageSwitch");
    if (linkageCB) {
      if (S.linkageEnabled) linkageCB.checked = true;
      linkageCB.addEventListener('change', function() {
        S.linkageEnabled = this.checked;
        if (Parser.saveCurrentSettings) Parser.saveCurrentSettings();
        if (!this.checked) _removeAllLinkHighlights();
      });
    }

    // ── 筛选面板 ──
    var btnToggleFilter = document.getElementById("btnToggleFilter");
    var filterPanel = document.getElementById("filterPanel");
    if (btnToggleFilter && filterPanel) {
      btnToggleFilter.addEventListener('click', function() {
        filterPanel.classList.toggle('hidden');
        if (!filterPanel.classList.contains('hidden')) {
          if (S.queryFilters.length === 0) S.queryFilters.push({ col: '', op: 'contains', val: '' });
          renderFilterPanel();
        }
      });
    }

    // ── 加载比价数据 ──
    var btnLoadPriceCompare = document.getElementById("btnLoadPriceCompare");
    if (btnLoadPriceCompare) {
      btnLoadPriceCompare.addEventListener('click', async function() {
        try {
          // 确保 Python 后端已启动
          if (window.api && window.api.pythonHealth) {
            var health = await window.api.pythonHealth();
            if (health.status !== 'ok' && window.api.pythonStart) {
              setStatus('正在启动后端服务...');
              var result = await window.api.pythonStart();
              if (!result.ok) {
                setStatus('Python 后端启动失败');
                return;
              }
            }
          }
          // 确保端口设置
          if (!S.pythonPort && window.api && window.api.pythonPort) {
            S.pythonPort = await window.api.pythonPort();
          }
          setStatus('正在加载比价数据...');
          var resp = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/query/pull-price-compare');
          var result = await resp.json();
          if (result.ok && result.results && result.results.length > 0) {
                      // 确保面板正确切换
                      if (typeof window.hideAllPanels === 'function') window.hideAllPanels();
                      var queryContainer = document.getElementById("queryContainer");
                      if (queryContainer) {
                        queryContainer.classList.remove('hidden');
                        var toolbar = queryContainer.querySelector('.query-toolbar');
                        if (toolbar) toolbar.style.display = '';
                      }
            // 适配 renderQueryTable 期望的字段名
            S.queryResults = result.results.map(function(r) {
              return {
                '平台': (r.platform || '').toUpperCase(),
                '标题': r.title || '',
                '价格': r.price != null ? '¥' + Number(r.price).toFixed(2) : '-',
                '店铺': r.shop_name || '-',
                '图片': r.main_image_url || r.local_image || '-',
                '相似度': r.score != null ? (r.score * 100).toFixed(0) + '%' : '-',
                'ID': r.id || r.product_id || '',
                '_origIdx': 0
              };
            });
            // 设置第一个组键为「标签」，使 renderQueryTable 按平台分组
            S.queryResults.forEach(function(r) { r['标签'] = r['平台']; });
            renderQueryTable(S.queryResults, null, null);
            setStatus('已加载 ' + result.count + ' 条比价数据 — 可用筛选/导出');
          } else {
            setStatus('暂无比价数据，请先在比价控制台搜索并点击「发送到解析器」');
          }
        } catch (e) {
          setStatus('加载失败: ' + e.message);
        }
      });
    }

    // 设置弹窗
    function openSettingsModal(section) {
      if (document.getElementById("settingsModal")) document.getElementById("settingsModal").classList.remove('hidden');
      var body = $('#settingsBody');
      if (!body) return;
      var divs = body.querySelectorAll(':scope > [data-section]');
      if (section) {
        for (var di = 0; di < divs.length; di++) {
          divs[di].style.display = divs[di].getAttribute('data-section') === section ? '' : 'none';
        }
      } else {
        for (var dj = 0; dj < divs.length; dj++) {
          divs[dj].style.display = '';
        }
      }
    }
    window.openSettingsModal = openSettingsModal;
    if (document.getElementById("btnSettingsModalClose")) document.getElementById("btnSettingsModalClose").addEventListener('click', function() { document.getElementById("settingsModal").classList.add('hidden'); });
    if (document.getElementById("btnSettingsClose")) document.getElementById("btnSettingsClose").addEventListener('click', function() { document.getElementById("settingsModal").classList.add('hidden'); });
    if (document.getElementById("settingsModal")) document.getElementById("settingsModal").addEventListener('mousedown', function(e) { if (e.target === document.getElementById("settingsModal")) document.getElementById("settingsModal").classList.add('hidden'); });
    // ── 设置持久化（替换旧的 localStorage）──
    function saveSetting(key, value) { saveCurrentSettings(); }
    function loadSetting(key, def) { try { var v = localStorage.getItem(key); return v != null ? v : def; } catch(e) { return def; } }
    if (document.getElementById("maxTextLen")) { document.getElementById("maxTextLen").addEventListener('change', function() { S.maxTextLen = parseInt(this.value) || 2000; saveCurrentSettings(); }); }
    if (document.getElementById("maxDomDepth")) { document.getElementById("maxDomDepth").addEventListener('change', function() { S.maxDomDepth = parseInt(this.value) || 20; saveCurrentSettings(); }); }
    if (document.getElementById("maxDomChildren")) { document.getElementById("maxDomChildren").addEventListener('change', function() { S.maxDomChildren = parseInt(this.value) || 200; saveCurrentSettings(); }); }
    if (document.getElementById("maxResults")) { document.getElementById("maxResults").addEventListener('change', function() { S.maxResults = parseInt(this.value) || 1000; saveCurrentSettings(); }); }
    if (document.getElementById("maxSourcePreview")) { document.getElementById("maxSourcePreview").addEventListener('change', function() { S.maxSourcePreview = parseInt(this.value) || 2000; saveCurrentSettings(); }); }
    if (document.getElementById("maxCellText")) { document.getElementById("maxCellText").addEventListener('change', function() { S.maxCellText = parseInt(this.value) || 200; saveCurrentSettings(); }); }
    if (document.getElementById("chainPreviewLimit")) { document.getElementById("chainPreviewLimit").addEventListener('change', function() { S.chainPreviewLimit = parseInt(this.value) || 3; saveCurrentSettings(); }); }
    if (document.getElementById("collectMaxFields")) { document.getElementById("collectMaxFields").addEventListener('change', function() { collector.scroll.maxFields = parseInt(this.value) || 30; saveCurrentSettings(); }); }
    if (document.getElementById("networkMaxAll")) { document.getElementById("networkMaxAll").addEventListener('change', function() { S.networkMaxAll = parseInt(this.value) || 100; saveCurrentSettings(); }); }
    var inlineMergeDelimInput = $('#inlineMergeDelim');
    if (inlineMergeDelimInput) {
      inlineMergeDelimInput.addEventListener('change', function() { S.inlineMergeDelim = this.value; saveCurrentSettings(); });
    }
    var splitMaxDepthInput = $('#splitMaxDepth');
    if (splitMaxDepthInput) {
      splitMaxDepthInput.addEventListener('change', function() { S.splitMaxDepth = parseInt(this.value) || 4; saveCurrentSettings(); });
    }

    // ── 主题切换 ──
    var themeSwitch = document.getElementById('themeToggleSwitch');
    if (themeSwitch) {
      var lbl = themeSwitch.parentElement.previousElementSibling;
      themeSwitch.checked = document.body.classList.contains('theme-light');
      if (lbl) lbl.textContent = themeSwitch.checked ? '亮色主题' : '暗色主题';
      themeSwitch.addEventListener('change', function() {
        if (this.checked) {
          document.body.classList.add('theme-light');
        } else {
          document.body.classList.remove('theme-light');
        }
        if (lbl) lbl.textContent = this.checked ? '亮色主题' : '暗色主题';
        window.saveCurrentSettings();
      });
    }

    // ── 代理配置 ──
    var btnProxyApply = $('#btnProxyApply');
    var btnProxyClear = $('#btnProxyClear');
    var proxyHost = $('#proxyHost');
    var proxyPort = $('#proxyPort');
    var proxyProtocol = $('#proxyProtocol');
    if (btnProxyApply) {
      btnProxyApply.addEventListener('click', async function() {
        var host = proxyHost ? proxyHost.value.trim() : '';
        var port = proxyPort ? parseInt(proxyPort.value) : 0;
        if (!host || !port) { showToast('请填写代理地址和端口'); return; }
        var proto = proxyProtocol ? proxyProtocol.value : 'http';
        var result = await window.api.proxySet({ host: host, port: port, protocol: proto });
        if (result.ok) { showToast('代理已应用: ' + proto + '://' + host + ':' + port); }
        else { showToast('代理设置失败: ' + result.error); }
      });
    }
    if (btnProxyClear) {
      btnProxyClear.addEventListener('click', async function() {
        var result = await window.api.proxySet(null);
        if (result.ok) { showToast('代理已清除'); if (proxyHost) proxyHost.value = ''; if (proxyPort) proxyPort.value = ''; }
      });
    }
    // 加载当前代理状态
    (async function() {
      var p = await window.api.proxyGet();
      if (p && p.host) {
        if (proxyHost) proxyHost.value = p.host;
        if (proxyPort) proxyPort.value = p.port;
        if (proxyProtocol) proxyProtocol.value = p.protocol || 'http';
      }
    })();

    // ── Stealth 脚本设置 ──
    loadStealthConfig();
    renderStealthUI();
    bindStealthEvents();

    // ── 行为模拟设置 ──
    loadBehaveConfig();
    bindBehaveEvents();
  }

  // ── Stealth 脚本：配置管理 ──
  // ── 行为模拟：配置管理 ──
  function loadBehaveConfig() {
    try { var raw = localStorage.getItem('behave_config'); var d = raw ? JSON.parse(raw) : {}; } catch(e) { d = {}; }
    if (typeof d.enable === 'boolean') behave.enable = d.enable;
    eachBehaveProp(function(key, el) {
      if (d[key] !== undefined) behave[key] = Number(d[key]);
      if (el) el.value = behave[key];
    });
  }
  function saveBehaveConfig() {
    var d = { enable: behave.enable };
    eachBehaveProp(function(key) { d[key] = behave[key]; });
    localStorage.setItem('behave_config', JSON.stringify(d));
  }
  function eachBehaveProp(fn) {
    var props = ['jitter','pauseChance','pauseMin','pauseMax','readPause','backChance','hoverChance','hoverMin','hoverMax'];
    var ids = ['behaveJitter','behavePauseChance','behavePauseMin','behavePauseMax','behaveReadPause','behaveBackChance','behaveHoverChance','behaveHoverMin','behaveHoverMax'];
    for (var i = 0; i < props.length; i++) {
      var el = document.getElementById(ids[i]);
      fn(props[i], el);
    }
  }
  function bindBehaveEvents() {
    var enableEl = document.getElementById('behaveEnable');
    if (enableEl) {
      enableEl.addEventListener('change', function() { behave.enable = this.checked; saveBehaveConfig(); });
      enableEl.checked = behave.enable;
    }
    eachBehaveProp(function(key, el) {
      if (!el) return;
      el.addEventListener('change', function() { behave[key] = parseInt(this.value) || 0; saveBehaveConfig(); });
    });
  }
  // 注入行为模拟到 document.getElementById("webview")
  function injectBehaviorScript() {
    if (!behave.enable) return;
    document.getElementById("webview").executeJavaScript(
      '(function(b){' +
      'if(!window.__parser)window.__parser={};' +
      'window.__parser.behavior={};' +
      'var bb=window.__parser.behavior;' +
      'bb.config=b;' +
      // 模拟鼠标移动
      'bb.simulateMouseMove=function(x,y){' +
        'var ev=new MouseEvent("mousemove",{clientX:x,clientY:y,bubbles:true,cancelable:true});' +
        'document.dispatchEvent(ev);' +
      '};' +
      // 模拟鼠标悬停
      'bb.simulateHover=function(el){' +
        'if(!el)return;' +
        'var r=el.getBoundingClientRect();' +
        'var x=r.left+r.width/2;' +
        'var y=r.top+r.height/2;' +
        'el.dispatchEvent(new MouseEvent("mouseenter",{clientX:x,clientY:y,bubbles:true}));' +
        'el.dispatchEvent(new MouseEvent("mouseover",{clientX:x,clientY:y,bubbles:true}));' +
        'bb.simulateMouseMove(x,y);' +
      '};' +
      // 获取随机可见元素
      'bb.getRandomVisibleElement=function(){' +
        'var els=document.querySelectorAll("a,button,img,div,p,span,li");' +
        'var visible=[];' +
        'for(var i=0;i<els.length;i++){' +
          'var r=els[i].getBoundingClientRect();' +
          'if(r.width>0&&r.height>0&&r.top<window.innerHeight&&r.bottom>0)visible.push(els[i]);' +
        '}' +
        'if(visible.length===0)return null;' +
        'return visible[Math.floor(Math.random()*visible.length)];' +
      '};' +
      '})({jitter:' + behave.jitter + ',pauseChance:' + behave.pauseChance + ',pauseMin:' + behave.pauseMin + ',pauseMax:' + behave.pauseMax + ',readPause:' + behave.readPause + ',backChance:' + behave.backChance + ',hoverChance:' + behave.hoverChance + ',hoverMin:' + behave.hoverMin + ',hoverMax:' + behave.hoverMax + '})'
    ).catch(function(){});
  }

  function loadStealthConfig() {
    try {
      var raw = localStorage.getItem('stealth_scripts');
      S._stealthData = raw ? JSON.parse(raw) : {};
    } catch (e) { S._stealthData = {}; }
    if (!S._stealthData.defaultScripts) {
      S._stealthData.defaultScripts = S.STEALTH_SCRIPTS.filter(function(s) { return s.defaultOn; }).map(function(s) { return s.id; });
    }
    if (!S._stealthData.domains) S._stealthData.domains = {};
  }
  function saveStealthConfig() {
    try { localStorage.setItem('stealth_scripts', JSON.stringify(S._stealthData)); } catch (e) {}
  }
  function getStealthScriptsForHost(host) {
    if (!host) return S._stealthData.defaultScripts || [];
    // 精确匹配或父域名匹配
    if (S._stealthData.domains[host]) return S._stealthData.domains[host];
    var parts = host.split('.');
    for (var i = 1; i < parts.length; i++) {
      var parent = parts.slice(i).join('.');
      if (S._stealthData.domains[parent]) return S._stealthData.domains[parent];
    }
    return S._stealthData.defaultScripts || [];
  }

  // ── Stealth 脚本：注入到 document.getElementById("webview") ──
  function injectStealthConfig(host) {
    var scripts = getStealthScriptsForHost(host);
    var injectScripts = scripts.filter(function(id) { return S.STEALTH_INJECT_IDS.indexOf(id) !== -1; });
    var configJSON = JSON.stringify({ scripts: injectScripts, host: host || '' });
    // 1. 注入配置（让 preload 中的基础伪装可读取）
    document.getElementById("webview").executeJavaScript(
      '(function(){window.__parser=window.__parser||{};window.__parser._stealthConfig=' + configJSON + ';})()'
    ).catch(function() {});
    // 2. 注入原型包装脚本（在页面上下文执行，能修改原型链）
    injectStealthPrototypes(injectScripts);
  }

  // ── CDP 预注入（在所有页面脚本之前执行）──
  function setupCdpStealthInjection() {
    try {
      var wcid = document.getElementById("webview").getWebContentsId();
      if (!wcid) return;
      // 注入全部 8 个包装脚本（CDP 脚本不依赖配置，始终生效）
      var allScripts = S.STEALTH_INJECT_IDS.slice();
      var code = buildStealthInjectCode(allScripts);
      if (code) {
        window.api.stealthInjectCdp(wcid, code).then(function(r) {
          if (r && r.ok) console.log('[CDP] stealth 脚本预注入成功, id=' + wcid);
          else console.warn('[CDP] 预注入失败:', r && r.error);
        }).catch(function(e) {
          console.warn('[CDP] 预注入异常:', e.message);
        });
      }
    } catch (e) {
      console.warn('[CDP] setupCdpStealthInjection 异常:', e.message);
    }
  }

  // ── 注入原型包装脚本（在页面 JS 上下文执行）──
  function injectStealthPrototypes(scripts) {
    if (!scripts || scripts.length === 0) return;
    var code = buildStealthInjectCode(scripts);
    if (code) document.getElementById("webview").executeJavaScript(code).catch(function() {});
  }

  function buildStealthInjectCode(scripts) {
    var has = function(id) { return scripts.indexOf(id) !== -1; };
    var parts = [];
    parts.push('(function(){window.__cdp_ok=1;');
    parts.push('var _validB64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";');

    // Canvas
    if (has('canvas')) {
      parts.push(
        'var _ctd=HTMLCanvasElement.prototype.toDataURL;',
        'var _ctb=HTMLCanvasElement.prototype.toBlob;',
        'HTMLCanvasElement.prototype.toDataURL=function(){var r=_ctd.apply(this,arguments);',
        'try{var ci=r.indexOf(",");if(ci>0){var dl=r.length-ci-1;',
        'var p=ci+1+Math.floor(Math.random()*Math.max(1,dl-1));',
        'r=r.substring(0,p)+_validB64[Math.floor(Math.random()*64)]+r.substring(p+1);}}catch(e){}',
        'return r;};',
        'HTMLCanvasElement.prototype.toBlob=function(cb,ty,q){',
        'try{var ctx=this.getContext("2d",{willReadFrequently:true});',
        'if(ctx&&this.width>0&&this.height>0){var x=Math.floor(Math.random()*this.width);',
        'var y=Math.floor(Math.random()*this.height);',
        'var p=ctx.getImageData(x,y,1,1);p.data[0]=(p.data[0]+1)%256;ctx.putImageData(p,x,y);}}catch(e){}',
        'return _ctb.apply(this,arguments);};',
        'if(typeof CanvasRenderingContext2D!=="undefined"){',
        'var _cgi=CanvasRenderingContext2D.prototype.getImageData;',
        'CanvasRenderingContext2D.prototype.getImageData=function(){var d=_cgi.apply(this,arguments);',
        'try{if(d.data.length>0)d.data[0]=(d.data[0]+1)%256;}catch(e){}return d;};}'
      );
    }

    // WebGL
    if (has('webgl')) {
      parts.push(
        'try{',
        'var _wgo={37445:"Google Inc. (Intel)",37446:"ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)",7937:"WebKit WebGL",7938:"WebKit WebGL"};',
        'var _wgg=WebGLRenderingContext.prototype.getParameter;',
        'WebGLRenderingContext.prototype.getParameter=function(p){return _wgo.hasOwnProperty(p)?_wgo[p]:_wgg.call(this,p);};',
        'if(typeof WebGL2RenderingContext!=="undefined")WebGL2RenderingContext.prototype.getParameter=WebGLRenderingContext.prototype.getParameter;',
        '}catch(e){}'
      );
    }

    // WebRTC
    if (has('webrtc')) {
      parts.push(
        'try{',
        'var _drtc=function(){this.createOffer=function(){return Promise.reject(new Error("blocked"));};',
        'this.createAnswer=function(){return Promise.reject(new Error("blocked"));};',
        'this.setLocalDescription=function(){return Promise.resolve();};',
        'this.setRemoteDescription=function(){return Promise.resolve();};',
        'this.addIceCandidate=function(){return Promise.resolve();};',
        'this.close=function(){};this.getStats=function(){return Promise.resolve(new Map());};',
        'this.localDescription=null;this.remoteDescription=null;',
        'this.signalingState="closed";this.iceConnectionState="closed";',
        'this.iceGatheringState="complete";this.connectionState="closed";};',
        'if(window.RTCPeerConnection)window.RTCPeerConnection=_drtc;',
        'if(window.webkitRTCPeerConnection)window.webkitRTCPeerConnection=_drtc;',
        'if(window.mozRTCPeerConnection)window.mozRTCPeerConnection=_drtc;',
        '}catch(e){}'
      );
    }

    // Audio
    if (has('audio')) {
      parts.push(
        'try{',
        'var _OAC=window.AudioContext||window.webkitAudioContext;',
        'if(_OAC&&AudioContext.prototype.createOscillator){',
        'var _oco=AudioContext.prototype.createOscillator;',
        'AudioContext.prototype.createOscillator=function(){var o=_oco.call(this);',
        'var _os=o.start;var _nd=false;',
        'o.start=function(w){if(!_nd){try{o.frequency.value=o.frequency.value*(1+(Math.random()-0.5)*0.00002);}catch(e){}_nd=true;}',
        'return _os.call(this,w);};return o;};}',
        'if(_OAC){',
        'var _ACW=function(){var c=new _OAC();',
        'try{Object.defineProperty(c.destination,"maxChannelCount",{get:function(){return 2;}});}catch(e){}',
        'return c;};_ACW.prototype=_OAC.prototype;',
        'if(window.AudioContext)window.AudioContext=_ACW;',
        'if(window.webkitAudioContext)window.webkitAudioContext=_ACW;}',
        '}catch(e){}'
      );
    }

    // Font
    if (has('font')) {
      parts.push(
        'try{',
        'if(CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype.measureText){',
        'var _cmt=CanvasRenderingContext2D.prototype.measureText;',
        'CanvasRenderingContext2D.prototype.measureText=function(t){',
        'var m=_cmt.call(this,t);var ow=m.width;',
        'Object.defineProperty(m,"width",{get:function(){return ow+(Math.random()-0.5)*1.0;},configurable:true});',
        'return m;};}',
        'if(window.queryLocalFonts)window.queryLocalFonts=function(){return Promise.resolve([',
        '{family:"Arial",fullName:"Arial",postscriptName:"ArialMT",style:"Regular"},',
        '{family:"Times New Roman",fullName:"Times New Roman",postscriptName:"TimesNewRomanPSMT",style:"Regular"},',
        '{family:"Courier New",fullName:"Courier New",postscriptName:"CourierNewPSMT",style:"Regular"},',
        '{family:"Microsoft YaHei",fullName:"Microsoft YaHei",postscriptName:"MicrosoftYaHei",style:"Regular"},',
        '{family:"SimSun",fullName:"SimSun",postscriptName:"SimSun",style:"Regular"}]);};',
        '}catch(e){}'
      );
    }

    // CDP
    if (has('cdp')) {
      parts.push(
        'try{',
        'var _ps=["__webdriver","__driver","__selenium","cdc_","$cdc_","__chrome","webdriver"];',
        'for(var k=0;k<_ps.length;k++){try{Object.defineProperty(window,_ps[k],{get:function(){return undefined;},set:function(){},configurable:true});}catch(e){}}',
        'try{Object.defineProperty(Navigator.prototype,"webdriver",{get:function(){return false;},configurable:true});}catch(e){}',
        '}catch(e){}'
      );
    }

    // Navigator
    if (has('navigator')) {
      parts.push(
        'try{',
        'var _np={platform:"Win32",vendor:"Google Inc.",vendorSub:"",productSub:"20030107",',
        'deviceMemory:8,maxTouchPoints:0,hardwareConcurrency:8,',
        'appVersion:"5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",',
        'userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"};',
        'for(var k in _np){if(!_np.hasOwnProperty(k))continue;try{(function(k,v){',
        'Object.defineProperty(navigator,k,{get:function(){return v;},configurable:true});})(k,_np[k]);}catch(e){}}',
        'Object.defineProperty(screen,"colorDepth",{get:function(){return 24;},configurable:true});',
        'Object.defineProperty(screen,"pixelDepth",{get:function(){return 24;},configurable:true});',
        '}catch(e){}'
      );
    }

    // Permissions
    if (has('permissions')) {
      parts.push(
        'try{',
        'if(navigator.permissions&&navigator.permissions.query){',
        'var _opq=navigator.permissions.query;',
        'navigator.permissions.query=function(d){',
        'if(!d||!d.name)return _opq.call(navigator.permissions,d);',
        'var _fn=["camera","microphone","geolocation","notifications","midi","clipboard-read","clipboard-write"];',
        'if(_fn.indexOf(d.name)!==-1)return Promise.resolve({state:"prompt",onchange:null,addEventListener:function(){},removeEventListener:function(){}});',
        'return _opq.call(navigator.permissions,d);};}',
        '}catch(e){}'
      );
    }

    parts.push('window.__stealthInjected=' + Date.now() + ';');
    parts.push('})();');
    return parts.join('');
  }
  // 检查某个全局开关是否对当前 host 启用
  function isStealthGlobalEnabled(id, host) {
    var scripts = getStealthScriptsForHost(host);
    return scripts.indexOf(id) !== -1;
  }
  // 根据当前域名应用全局 stealth 设置（UA/Cookie）
  async function applyStealthGlobals(host) {
    // UA 随机切换
    var uaOn = isStealthGlobalEnabled('ua', host);
    if (uaOn && !S._antidetectOn) {
      try { S._antidetectOn = await window.api.antidetectToggle(); } catch (e) {}
    } else if (!uaOn && S._antidetectOn) {
      try { S._antidetectOn = await window.api.antidetectToggle(); } catch (e) {}
    }
  }

  // ── Stealth 脚本：设置面板 UI ──
  function renderStealthUI() {
    var defaultContainer = document.getElementById('stealthDefaultScripts');
    if (!defaultContainer) return;
    defaultContainer.innerHTML = '';
    var hasInjected = false, hasGlobal = false;
    S.STEALTH_SCRIPTS.forEach(function(s) {
      if (!s.global) {
        hasInjected = true;
        defaultContainer.appendChild(buildStealthRow(s, S._stealthData.defaultScripts));
      } else {
        if (!hasGlobal) {
          hasGlobal = true;
          var sep = document.createElement('div');
          sep.className = 'stealth-separator';
          sep.textContent = '全局设置';
          defaultContainer.appendChild(sep);
        }
        defaultContainer.appendChild(buildStealthRow(s, S._stealthData.defaultScripts));
      }
    });
    // 渲染域名专属配置
    renderStealthDomains();
  }
  function buildStealthRow(script, activeList) {
    var checked = activeList.indexOf(script.id) !== -1;
    var row = document.createElement('div');
    row.className = 'stealth-row';
    row.innerHTML =
      '<label class="stealth-label" title="' + script.desc + '">'
      + '<span class="stealth-name">' + script.label + '</span>'
      + '<span class="stealth-desc-text">' + script.desc + '</span>'
      + '</label>'
      + '<label class="toggle-switch">'
      + '<input type="checkbox" data-sid="' + script.id + '" ' + (checked ? 'checked' : '') + '>'
      + '<span class="toggle-slider"></span>'
      + '</label>';
    return row;
  }
  function renderStealthDomains() {
    var container = document.getElementById('stealthDomains');
    if (!container) return;
    container.innerHTML = '';
    var domains = Object.keys(S._stealthData.domains || {}).sort();
    domains.forEach(function(domain) {
      var block = document.createElement('div');
      block.className = 'stealth-domain-block';
      var header = document.createElement('div');
      header.className = 'stealth-domain-header';
      header.innerHTML = '<span class="stealth-domain-name">' + domain + '</span>'
        + '<button class="stealth-domain-remove" data-domain="' + domain + '" title="删除此域名配置">×</button>';
      block.appendChild(header);
      var list = document.createElement('div');
      list.className = 'stealth-scripts stealth-domain-scripts';
      var domainScripts = S._stealthData.domains[domain];
      var hasGlobal = false;
      S.STEALTH_SCRIPTS.forEach(function(s) {
        if (s.global && !hasGlobal) {
          hasGlobal = true;
          var sep = document.createElement('div');
          sep.className = 'stealth-separator';
          sep.textContent = '全局设置';
          list.appendChild(sep);
        }
        var row = buildStealthRow(s, domainScripts);
        list.appendChild(row);
      });
      block.appendChild(list);
      container.appendChild(block);
    });
    bindStealthDomainRemove();
    // 重新绑定所有域名脚本的开关事件
    domains.forEach(function(domain) {
      bindStealthDomainScripts(domain);
    });
  }
  function bindStealthEvents() {
    // 默认脚本开关变更
    var defaultContainer = document.getElementById('stealthDefaultScripts');
    if (defaultContainer) {
      defaultContainer.addEventListener('change', function(e) {
        var cb = e.target;
        if (cb.tagName !== 'INPUT' || !cb.dataset.sid) return;
        var sid = cb.dataset.sid;
        var idx = S._stealthData.defaultScripts.indexOf(sid);
        if (cb.checked && idx === -1) S._stealthData.defaultScripts.push(sid);
        if (!cb.checked && idx !== -1) S._stealthData.defaultScripts.splice(idx, 1);
        saveStealthConfig();
      });
    }
    // 添加域名按钮
    var btnAdd = document.getElementById('btnStealthAddDomain');
    var domainInput = document.getElementById('stealthDomainInput');
    if (btnAdd && domainInput) {
      btnAdd.addEventListener('click', function() {
        var domain = domainInput.value.trim().toLowerCase();
        if (!domain) return;
        if (S._stealthData.domains[domain]) { setStatus('域名 ' + domain + ' 已存在'); return; }
        // 新域名默认继承当前默认配置
        S._stealthData.domains[domain] = S._stealthData.defaultScripts.slice();
        saveStealthConfig();
        domainInput.value = '';
        renderStealthDomains();
        setStatus('已添加域名配置: ' + domain);
      });
      domainInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') btnAdd.click();
      });
    }
    // 绑定已有域名区域的脚本开关
    var existingDomains = Object.keys(S._stealthData.domains || {});
    existingDomains.forEach(function(domain) {
      bindStealthDomainScripts(domain);
    });
  }
  function bindStealthDomainScripts(domain) {
    var container = document.getElementById('stealthDomains');
    if (!container) return;
    // 找到对应域名块的脚本容器
    var blocks = container.querySelectorAll('.stealth-domain-block');
    blocks.forEach(function(block) {
      var nameEl = block.querySelector('.stealth-domain-name');
      if (!nameEl || nameEl.textContent !== domain) return;
      var list = block.querySelector('.stealth-domain-scripts');
      if (!list) return;
      // 移除旧的监听器 — 用新创建的 clone 替代
      var newList = list.cloneNode(true);
      list.parentNode.replaceChild(newList, list);
      newList.addEventListener('change', function(e) {
        var cb = e.target;
        if (cb.tagName !== 'INPUT' || !cb.dataset.sid) return;
        var sid = cb.dataset.sid;
        if (!S._stealthData.domains[domain]) return;
        var idx = S._stealthData.domains[domain].indexOf(sid);
        if (cb.checked && idx === -1) S._stealthData.domains[domain].push(sid);
        if (!cb.checked && idx !== -1) S._stealthData.domains[domain].splice(idx, 1);
        saveStealthConfig();
      });
    });
  }
  function bindStealthDomainRemove() {
    var container = document.getElementById('stealthDomains');
    if (!container) return;
    container.querySelectorAll('.stealth-domain-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var domain = btn.dataset.domain;
        if (!domain) return;
        delete S._stealthData.domains[domain];
        saveStealthConfig();
        renderStealthDomains();
        setStatus('已删除域名配置: ' + domain);
      });
    });
  }

  async function executeQuery() {
    const mode = document.getElementById("queryContainer").dataset.mode || 'css';
    const query = document.getElementById("queryInput").value.trim();
    if (!query) return;
    setStatus('正在执行 ' + mode + ' 查询...');
    try {
      const endpointMap = { 'xpath': 'xpath', 'css': 'css', 'regex': 'regex', 'jsonpath': 'jsonpath' };
      const endpoint = endpointMap[mode] || 'css';

      // 收集所有要查询的 HTML 页面（快照 + 当前页）
      var htmlPages = [];
      try {
        var slResp = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/page-snapshots/list');
        if (slResp.ok) {
          var slData = await slResp.json();
          var snaps = slData.snapshots || [];
          for (var si = 0; si < snaps.length; si++) {
            var shResp = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/page-snapshots/' + snaps[si].id + '/html');
            if (shResp.ok) {
              var shData = await shResp.json();
              if (shData.html) htmlPages.push(shData.html);
            }
          }
        }
      } catch(e) {}
      // 无快照时回退到当前页
      if (htmlPages.length === 0) {
        var qhtml = await document.getElementById("webview").executeJavaScript('document.documentElement.outerHTML') || S.currentHtml;
        if (qhtml) htmlPages = [qhtml];
      }

      // 逐页查询并合并
      var allResults = [];
      var totalCount = 0;
      for (var pi = 0; pi < htmlPages.length; pi++) {
        var qbody = { html: htmlPages[pi], query: query };
        if (endpoint === 'xpath' || endpoint === 'css') qbody.child_delim = S.globalChildDelim;
        qbody.expand_children = !!S.expandChildren;
        const resp = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/extract/' + endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(qbody),
        });
        const pageResult = await resp.json();
        if (pageResult.results) {
          allResults = allResults.concat(pageResult.results);
          totalCount += pageResult.count || pageResult.results.length;
        }
      }
      if (allResults.length > 0) {
        S.queryResults = allResults.map(function(row) {
          var clean = {};
          Object.keys(row).forEach(function(k) {
            var v = row[k];
            clean[k] = typeof v === 'string' ? normalizeText(v) : v;
          });
          return clean;
        });
        var linkInfo = (endpoint === 'css' || endpoint === 'xpath') ? { type: endpoint, query: query } : null;
        renderQueryTable(S.queryResults, null, linkInfo);
        setStatus(mode + ' 查询完成 - ' + totalCount + ' 条结果（' + htmlPages.length + ' 页合并）');
      } else {
        document.getElementById("queryResults").innerHTML = '<div class="tree-empty">无匹配结果（已查 ' + htmlPages.length + ' 页）</div>';
        setStatus('查询完成 - 0 条结果');
      }
    } catch (err) {
      document.getElementById("queryResults").innerHTML = '<div class="tree-empty">查询失败: ' + err.message + '</div>';
    }
  }

  // ──────── 列条件筛选 ────────

  var FILTER_OPS = [
    { v: 'contains', label: '包含' },
    { v: 'not_contains', label: '不包含' },
    { v: 'equals', label: '等于' },
    { v: 'not_equals', label: '不等于' },
    { v: 'starts', label: '开头是' },
    { v: 'ends', label: '结尾是' },
    { v: 'regex', label: '正则' },
    { v: 'gt', label: '大于' },
    { v: 'lt', label: '小于' },
    { v: 'empty', label: '为空' },
    { v: 'not_empty', label: '不为空' },
  ];

  function testFilter(val, op, filterVal) {
    var sv = String(val || '');
    var fv = filterVal || '';
    switch (op) {
      case 'contains': return sv.toLowerCase().indexOf(fv.toLowerCase()) >= 0;
      case 'not_contains': return sv.toLowerCase().indexOf(fv.toLowerCase()) < 0;
      case 'equals': return sv === fv;
      case 'not_equals': return sv !== fv;
      case 'starts': return sv.toLowerCase().indexOf(fv.toLowerCase()) === 0;
      case 'ends': return sv.toLowerCase().lastIndexOf(fv.toLowerCase()) === sv.length - fv.length;
      case 'regex': try { return new RegExp(fv, 'i').test(sv); } catch(e) { return false; }
      case 'gt': return parseFloat(sv) > parseFloat(fv);
      case 'lt': return parseFloat(sv) < parseFloat(fv);
      case 'empty': return sv.trim() === '';
      case 'not_empty': return sv.trim() !== '';
      default: return true;
    }
  }

  function applyFilters() {
    // 先从 DOM 同步最新值到 S.queryFilters
    var panel = document.getElementById("filterPanel");
    if (panel) {
      panel.querySelectorAll('.filter-col-sel').forEach(function(el) {
        var fi = parseInt(el.dataset.fi);
        if (S.queryFilters[fi]) S.queryFilters[fi].col = el.value;
      });
      panel.querySelectorAll('.filter-op-sel').forEach(function(el) {
        var fi = parseInt(el.dataset.fi);
        if (S.queryFilters[fi]) S.queryFilters[fi].op = el.value;
      });
      panel.querySelectorAll('.filter-val-input').forEach(function(el) {
        var fi = parseInt(el.dataset.fi);
        if (S.queryFilters[fi]) S.queryFilters[fi].val = el.value;
      });
    }

    var rows = S.queryResults;
    if (!rows || !rows.length) return;
    // 搜索文本
    var q = (document.getElementById("querySearch").value || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(function(row) {
        return Object.values(row).some(function(v) { return String(v).toLowerCase().indexOf(q) >= 0; });
      });
    }
    // 列条件
    var filters = S.queryFilters || [];
    if (filters.length > 0) {
      var logic = S.queryFilterLogic || 'and';
      rows = rows.filter(function(row) {
        if (logic === 'or') {
          return filters.some(function(f) {
            if (!f.col || !f.op) return false;
            return testFilter(row[f.col], f.op, f.val || '');
          });
        } else {
          return filters.every(function(f) {
            if (!f.col || !f.op) return true;
            return testFilter(row[f.col], f.op, f.val || '');
          });
        }
      });
    }
    renderQueryTable(rows, null, S._lastLinkageInfo);
  }

  function getAvailableColumns() {
    var keys = [];
    if (S.queryResults && S.queryResults.length) {
      var seen = {};
      S.queryResults.forEach(function(row) {
        Object.keys(row).forEach(function(k) {
          if (k[0] !== '_' && !seen[k]) { seen[k] = true; keys.push(k); }
        });
      });
    }
    return keys;
  }

  function renderFilterPanel() {
    var panel = document.getElementById("filterPanel");
    if (!panel) return;
    var filters = S.queryFilters || [];
    var cols = getAvailableColumns();
    var html = '';
    var logic = S.queryFilterLogic || 'and';
    for (var i = 0; i < filters.length; i++) {
      if (i > 0) {
        html += '<div class="filter-logic-row">';
        html += '<div class="filter-logic-group">';
        html += '<button class="filter-logic-btn' + (logic === 'and' ? ' active' : '') + '" data-logic="and">且</button>';
        html += '<button class="filter-logic-btn' + (logic === 'or' ? ' active' : '') + '" data-logic="or">或</button>';
        html += '</div>';
        html += '</div>';
      }
      var f = filters[i];
      html += '<div class="filter-row" data-fi="' + i + '">';
      html += '<select class="filter-col-sel" data-fi="' + i + '" data-field="col">';
      html += '<option value="">选择列</option>';
      for (var ci = 0; ci < cols.length; ci++) {
        html += '<option value="' + escapeHtml(cols[ci]) + '"' + (f.col === cols[ci] ? ' selected' : '') + '>' + escapeHtml(cols[ci]) + '</option>';
      }
      html += '</select>';
      html += '<select class="filter-op-sel" data-fi="' + i + '" data-field="op">';
      for (var oi = 0; oi < FILTER_OPS.length; oi++) {
        html += '<option value="' + FILTER_OPS[oi].v + '"' + (f.op === FILTER_OPS[oi].v ? ' selected' : '') + '>' + FILTER_OPS[oi].label + '</option>';
      }
      html += '</select>';
      var hideVal = f.op === 'empty' || f.op === 'not_empty';
      html += '<input class="filter-val-input" data-fi="' + i + '" data-field="val" value="' + escapeHtml(f.val || '') + '" placeholder="值..." style="' + (hideVal ? 'display:none' : '') + '">';
      html += '<button class="filter-btn-remove" data-fi="' + i + '" title="删除">✕</button>';
      html += '</div>';
    }
    html += '<div class="filter-actions">';
    html += '<button class="btn btn-sm btn-filter-act" id="btnAddFilter">+ 条件</button>';
    html += '<span class="filter-actions-spacer"></span>';
    html += '<button class="btn btn-sm btn-filter-act" id="btnClearFilter">清除</button>';
    html += '</div>';
    panel.innerHTML = html;

    panel.querySelectorAll('.filter-col-sel').forEach(function(el) {
      el.addEventListener('change', function() {
        var fi = parseInt(this.dataset.fi);
        if (S.queryFilters[fi]) S.queryFilters[fi].col = this.value;
        applyFilters();
      });
    });
    panel.querySelectorAll('.filter-op-sel').forEach(function(el) {
      el.addEventListener('change', function() {
        var fi = parseInt(this.dataset.fi);
        if (S.queryFilters[fi]) { S.queryFilters[fi].op = this.value; renderFilterPanel(); }
        applyFilters();
      });
    });
    panel.querySelectorAll('.filter-val-input').forEach(function(el) {
      el.addEventListener('input', function() {
        var fi = parseInt(this.dataset.fi);
        if (S.queryFilters[fi]) S.queryFilters[fi].val = this.value;
      });
      el.addEventListener('keydown', function(e) { if (e.key === 'Enter') applyFilters(); });
      el.addEventListener('blur', function() { applyFilters(); });
    });
    panel.querySelectorAll('.filter-btn-remove').forEach(function(el) {
      el.addEventListener('click', function() {
        var fi = parseInt(this.dataset.fi);
        if (S.queryFilters.length <= 1) {
          S.queryFilters[0] = { col: '', op: 'contains', val: '' };
        } else {
          S.queryFilters.splice(fi, 1);
        }
        renderFilterPanel();
        applyFilters();
      });
    });
    panel.querySelectorAll('.filter-logic-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        S.queryFilterLogic = this.dataset.logic;
        renderFilterPanel();
        applyFilters();
      });
    });
    panel.querySelector('#btnAddFilter').addEventListener('click', function() {
      S.queryFilters.push({ col: '', op: 'contains', val: '' });
      renderFilterPanel();
    });
    panel.querySelector('#btnClearFilter').addEventListener('click', function() {
      S.queryFilters = [{ col: '', op: 'contains', val: '' }];
      filterPanel.classList.add('hidden');
      applyFilters();
      renderFilterPanel();
    });
  }

  // ──────── 表格渲染 ────────

  function renderQueryTable(rows, visibleKeys, linkageInfo) {
    if (!rows || rows.length === 0) { document.getElementById("queryResults").innerHTML = '<div class="tree-empty">无结果</div>'; return; }

    // ── 联动：保存 linkageInfo 到 state，供 applyFilters 等后续渲染复用 ──
    S._lastLinkageInfo = linkageInfo || null;

    // ── 联动：CSS/XPath 查询结果打上原始序号（仅首次，后续筛选不覆盖）──
    if (linkageInfo && (linkageInfo.type === 'css' || linkageInfo.type === 'xpath')) {
      var needIdx = true;
      for (var ri = 0; ri < rows.length; ri++) { if (rows[ri]._origIdx != null) { needIdx = false; break; } }
      if (needIdx) rows.forEach(function(r, i) { r._origIdx = i; });
    }

    var allKeys = new Set();
    rows.forEach(function(row) { Object.keys(row).forEach(function(k) { if (k[0] !== '_') allKeys.add(k); }); });
    var keys = Array.from(allKeys);

    // ── 展开子元素：检测 _children 字段，追加子N 列 ──
    var hasChildren = false;
    var maxChildren = 0;
    rows.forEach(function(row) {
      if (row._children && row._children.length) {
        hasChildren = true;
        if (row._children.length > maxChildren) maxChildren = row._children.length;
      }
    });
    var textIdx = keys.indexOf('文本');
    if (hasChildren && maxChildren > 0) {
      for (var ci = 0; ci < maxChildren; ci++) {
        var childKey = '子' + (ci + 1);
        if (textIdx >= 0) {
          keys.splice(textIdx + 1 + ci, 0, childKey);
        } else {
          keys.push(childKey);
        }
      }
    }

    // 默认可见字段：不传则显示全部列
    if (!visibleKeys || visibleKeys.length === 0) {
      visibleKeys = keys.slice();
    } else {
      // 展开子节点：确保子N列可见
      if (hasChildren && maxChildren > 0) {
        for (var ci2 = 0; ci2 < maxChildren; ci2++) {
          var ck2 = '子' + (ci2 + 1);
          if (visibleKeys.indexOf(ck2) === -1) {
            if (textIdx >= 0 && textIdx < visibleKeys.length) {
              visibleKeys.splice(textIdx + 1 + ci2, 0, ck2);
            } else {
              visibleKeys.push(ck2);
            }
          }
        }
      }
    }
    var currentVisibleKeys = visibleKeys.slice();

    // ── 分组：按"标签"列 ──
    var groupKey = keys.indexOf('标签') !== -1 ? '标签' : keys[0];
    // 每次渲染重置折叠状态
    window._collapsedQueryTags = {};
    window._expandedCell = null;
    // 按标签排序（不修改原始数组），确保同一标签的行相邻
    rows = rows.slice().sort(function(a, b) {
      var ta = normalizeText(String(a[groupKey] || '?'));
      var tb = normalizeText(String(b[groupKey] || '?'));
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return 0;
    });
    var tagCounts = {};
    // 用 normalizeText 统一 key，避免不可见字符导致同一标签被拆成多个组
    rows.forEach(function(r) { var t = normalizeText(String(r[groupKey] || '?')); tagCounts[t] = (tagCounts[t] || 0) + 1; });
    var grouped = [], lastTag = null;
    rows.forEach(function(r) {
      var t = normalizeText(String(r[groupKey] || '?'));
      if (t !== lastTag) { grouped.push({ _isTagHeader: true, _tag: t, _count: tagCounts[t] }); lastTag = t; }
      r._qtag = t; // 缓存到行对象
      grouped.push(r);
    });
    var hasGroups = grouped.length > rows.length;

    // 分组工具栏
    var tagBar = '';
    if (hasGroups) {
      tagBar = '<div style="display:flex;align-items:center;gap:6px;padding:2px 0 4px;flex-wrap:wrap">' +
        '<span style="font-size:10px;color:var(--text-dim)">标签分组:</span>' +
        '<button class="btn btn-xs qtag-expand-all" style="font-size:10px;padding:1px 8px">展开全部</button>' +
        '<button class="btn btn-xs qtag-collapse-all" style="font-size:10px;padding:1px 8px">折叠全部</button>' +
        '<span style="font-size:10px;color:var(--text-dim);margin-left:4px">共 ' + Object.keys(tagCounts).length + ' 组 ' + rows.length + ' 行</span>' +
        '</div>';
    }

    var html = tagBar + '<table class="result-table"><thead><tr><th><input type="checkbox" class="result-check-all"></th>';
    keys.forEach(function(k, idx) {
      var hidden = currentVisibleKeys.indexOf(k) === -1 ? ' hidden-col' : '';
      html += '<th data-col="' + idx + '" class="' + hidden + '">' + escapeHtml(k) + '<span class="col-resizer"></span></th>';
    });
    html += '<th class="col-fields-btn"><button class="btn btn-sm" id="btnFields">字段 ▼</button>';
    html += '<div id="columnSelectPanel" class="column-select-panel hidden">';
    keys.forEach(function(k) {
      var checked = currentVisibleKeys.indexOf(k) !== -1 ? ' checked' : '';
      html += '<label><input type="checkbox" class="col-toggle" value="' + escapeHtml(k) + '"' + checked + '> ' + escapeHtml(k) + '</label>';
    });
    html += '</div></th>';
    html += '</tr></thead><tbody>';

    var rowNum = 0;
    var tagCN = { a:'链接', abbr:'缩写', address:'地址', area:'区域', article:'文章', aside:'侧栏', audio:'音频', b:'加粗', blockquote:'引用', br:'换行', button:'按钮', canvas:'画布', caption:'表标题', code:'代码', col:'表格列', datalist:'数据列表', dd:'描述', del:'删除线', details:'详情', dialog:'对话框', div:'区块', dl:'描述列表', dt:'术语', em:'强调', embed:'嵌入', fieldset:'字段集', figcaption:'图标题', figure:'插图', footer:'页脚', form:'表单', h1:'一级标题', h2:'二级标题', h3:'三级标题', h4:'四级标题', h5:'五级标题', h6:'六级标题', header:'页头', hr:'分隔线', i:'斜体', iframe:'内嵌框架', img:'图片', input:'输入框', ins:'插入', label:'标签', legend:'图例', li:'列表项', link:'链接', main:'主体', map:'映射', mark:'标记', meta:'元数据', meter:'度量', nav:'导航', noscript:'无脚本', object:'对象', ol:'有序列表', optgroup:'选项组', option:'选项', output:'输出', p:'段落', picture:'图片组', pre:'预格式', progress:'进度条', q:'短引用', s:'删除线', samp:'样本', script:'脚本', section:'区块', select:'下拉框', small:'小号', source:'媒体源', span:'行内文本', strong:'强调', style:'样式', sub:'下标', summary:'摘要', sup:'上标', svg:'矢量图', table:'表格', tbody:'表体', td:'单元格', template:'模板', textarea:'文本域', tfoot:'表脚', th:'表头', thead:'表头', time:'时间', title:'标题', tr:'表行', track:'字幕', u:'下划线', ul:'无序列表', var:'变量', video:'视频', wbr:'换行点', '?':'未知' };
    var colSpan = keys.length + 2;
    grouped.forEach(function(item) {
      if (item._isTagHeader) {
        var tagLow = item._tag.toLowerCase().replace(/[<>]/g, '');
        var cnName = tagCN[tagLow] || '';
        var collapsed = window._collapsedQueryTags[item._tag] || false;
        var arrow = collapsed ? '\u25b6' : '\u25bc';
        html += '<tr class="query-tag-header" data-qtag="' + normalizeText(item._tag) + '">';
        html += '<td colspan="' + colSpan + '">';
        html += '<span class="query-tag-toggle">' + arrow + '</span> &lt;<span style="color:var(--accent)">' + escapeHtml(item._tag) + '</span>&gt;';
        if (cnName) html += ' <span style="color:var(--text-dim)">' + escapeHtml(cnName) + '</span>';
        html += ' <span style="color:var(--text-dim);font-size:10px">(' + (item._count || 0) + ')</span>';
        html += '</td></tr>';
        return;
      }
      var tag = item._qtag || normalizeText(String(item[groupKey] || '?'));
      var hidden = window._collapsedQueryTags[tag] ? ' hidden-row' : '';
      var rowClass = item._isGroup ? ' query-group-row' + hidden : item._isChild ? ' query-child-row' + hidden : ' query-tag-row' + hidden;
      var oidxAttr = item['_oidx'] != null ? ' data-oidx="' + item['_oidx'] + '"' : '';
      var cidxAttr = item['_cidx'] != null ? ' data-cidx="' + item['_cidx'] + '"' : '';
      // ── 联动：写入选择器/XPath 数据属性 ──
      var linkAttrs = '';
      if (linkageInfo) {
        if (linkageInfo.type === 'items') {
          var cssSel = item['CSS选择器'] || '';
          var xp = item['XPath'] || '';
          if (xp) linkAttrs += ' data-xpath="' + escapeHtml(xp) + '"';
          if (cssSel) linkAttrs += ' data-selector="' + escapeHtml(cssSel) + '"';
        } else if (linkageInfo.type === 'css') {
          var qidx = item._origIdx != null ? item._origIdx : rowNum;
          linkAttrs += ' data-selector="' + escapeHtml(linkageInfo.query) + '" data-query-idx="' + qidx + '"';
        } else if (linkageInfo.type === 'xpath') {
          var qidx = item._origIdx != null ? item._origIdx : rowNum;
          linkAttrs += ' data-xpath="' + escapeHtml(linkageInfo.query) + '" data-query-idx="' + qidx + '"';
        }
      }
      html += '<tr data-row="' + rowNum + '"' + oidxAttr + cidxAttr + linkAttrs + ' class="' + rowClass + '" data-qtag="' + tag + '"><td><input type="checkbox" class="result-checkbox"></td>';
      keys.forEach(function(k, idx) {
        var colHidden = currentVisibleKeys.indexOf(k) === -1 ? ' hidden-col' : '';
        var val;
        if (item._children && /^子\d+$/.test(k)) {
          var childIdx = parseInt(k.substring(1)) - 1;
          val = (item._children[childIdx] !== undefined) ? item._children[childIdx] : '';
        } else {
          val = item[k] !== undefined ? item[k] : '';
        }
        var display = typeof val === 'object' ? JSON.stringify(val) : String(val);
        var isUrl = /^(https?:\/\/)[^\s]+$/i.test(display);
        var basicCols = ['序号','标签','来源','文本/链接','CSS选择器','XPath','匹配数','文本','链接','选择器'];
        var urlData = isUrl ? ' data-url="' + escapeHtml(display) + '"' : '';
        var urlCls = isUrl ? ' cell-url' : '';
        var urlStyle = isUrl ? 'color:var(--accent);text-decoration:underline;cursor:pointer;' : '';
        if (basicCols.indexOf(k) !== -1) {
          html += '<td data-col="' + idx + '" class="' + colHidden + urlCls + '" title="' + escapeHtml(String(val)) + '"' + urlData + ' style="' + urlStyle + '">' + escapeHtml(display) + '</td>';
        } else {
          var cellStyle = isUrl ? urlStyle + 'max-width:300px' : 'max-width:300px';
          html += '<td data-col="' + idx + '" class="' + colHidden + urlCls + '"' + urlData + ' style="' + cellStyle + '"><span class="cell-expand' + urlCls + '" style="' + (isUrl ? urlStyle : '') + '" onclick="this.classList.toggle(\'expanded\')" title="点击展开/收起">' + escapeHtml(display) + '</span></td>';
        }
      });
      html += '<td></td>';
      html += '</tr>';
      rowNum++;
    });
    html += '</tbody></table>';
    document.getElementById("queryResults").innerHTML = html;

    // 绑定 Ctrl+点击跳转链接（委托模式，支持跨单元格）
    document.getElementById("queryResults").addEventListener('click', function(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      var cell = e.target.closest('td'); if (!cell) return;
      var url = cell.dataset.url; if (!url) return;
      e.preventDefault();
      if (window.api && window.api.openPopupTab) {
        window.api.openPopupTab(url);
      } else {
        window.open(url, '_blank');
      }
    });

    // 绑定标签头点击
    document.getElementById("queryResults").querySelectorAll('.query-tag-header').forEach(function(h) {
      h.style.cursor = 'pointer';
      h.addEventListener('click', function() { window._toggleQueryTag(h); });
    });
    // 绑定展开/折叠全部按钮
    var xall = document.getElementById("queryContainer").querySelector('.qtag-expand-all');
    var call = document.getElementById("queryContainer").querySelector('.qtag-collapse-all');
    if (xall) xall.addEventListener('click', window._expandAllQueryTags);
    if (call) call.addEventListener('click', window._collapseAllQueryTags);

    // 清理上次渲染残留的列调整线（两个容器都清理）
    document.getElementById("queryResults").querySelectorAll(".col-resize-line").forEach(function(el) { el.remove(); });
    document.getElementById("queryContainer").querySelectorAll(".col-resize-line").forEach(function(el) { el.remove(); });

    // ── 字段选择器交互 ──
    var btnFields = document.getElementById('btnFields');
    var panel = document.getElementById('columnSelectPanel');
    if (btnFields && panel) {
      btnFields.addEventListener('click', function(e) {
        e.stopPropagation();
        panel.classList.toggle('hidden');
      });
      if (!window._queryDocClick) {
        window._collapseExpandedCell = function() {
          if (window._expandedCell) {
            window._expandedCell.style.whiteSpace = 'nowrap';
            window._expandedCell.style.maxWidth = '200px';
            window._expandedCell.style.overflow = 'hidden';
            window._expandedCell.style.wordBreak = '';
            window._expandedCell = null;
          }
        };
        window._queryDocClick = function(e) {
          var p = document.getElementById("columnSelectPanel"); var b = document.getElementById("btnFields");
          if (p && !p.classList.contains("hidden") && !p.contains(e.target) && e.target !== b) p.classList.add("hidden");
          // 点击表格外部区域 → 折叠已展开的单元格
          if (window._expandedCell && !document.getElementById("queryResults").contains(e.target)) {
            window._collapseExpandedCell();
          }
        };
        document.addEventListener("click", window._queryDocClick);
      }
      panel.querySelectorAll('.col-toggle').forEach(function(cb) {
        cb.addEventListener('change', function() {
          var colIdx = keys.indexOf(cb.value);
          if (colIdx === -1) return;
          var show = cb.checked;
          document.getElementById("queryResults").querySelectorAll('[data-col="' + colIdx + '"]').forEach(function(cell) {
            cell.classList.toggle('hidden-col', !show);
          });
        });
      });
    }

    // 表头全选
    var rca = document.getElementById("queryResults").querySelector('.result-check-all');
    if (rca) {
      rca.addEventListener('change', function() {
        document.getElementById("queryResults").querySelectorAll('.result-checkbox').forEach(function(cb) { cb.checked = rca.checked; });
        syncQueryCheckAll(rca.checked);
        updateRowSelection();
      });
    }
    // 行勾选
    document.getElementById("queryResults").querySelectorAll('.result-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function () {
        var visible = document.getElementById("queryResults").querySelectorAll('.result-checkbox:not(.result-check-all)');
        var checked = document.getElementById("queryResults").querySelectorAll('.result-checkbox:checked:not(.result-check-all)');
        var allBox = document.getElementById("queryResults").querySelector('.result-check-all');
        if (allBox) allBox.checked = visible.length > 0 && checked.length === visible.length;
        syncQueryCheckAll(allBox && allBox.checked);
        updateRowSelection();
      });
    });

    document.getElementById("queryResults").dataset.visibleKeys = JSON.stringify(currentVisibleKeys);
    updateRowSelection();

    if (document.getElementById("queryCheckAll")) {
      document.getElementById("queryCheckAll").style.display = '';
      document.getElementById("queryCheckAll").checked = false;
    }

    // 行右键菜单（仅首次绑定时初始化）
    if (!Parser._tableCtxMenuBound) {
      Parser._tableCtxMenuBound = true;
      var tableEl = document.getElementById("queryResults");
      if (tableEl) {
        tableEl.addEventListener('contextmenu', function(e) {
          var cell = e.target.closest('td');
          if (!cell) return;
          var row = cell.closest('tr');
          if (!row) return;
          e.preventDefault();
          e.stopPropagation();

          var rowIdx = parseInt(row.dataset.row);
          var colIdx = parseInt(cell.dataset.col);
          if (isNaN(rowIdx)) return;

          var oldMenu = document.getElementById('tableContextMenu');
          if (oldMenu) oldMenu.remove();

          var menu = document.createElement('div');
          menu.id = 'tableContextMenu';
          menu.className = 'context-menu';
          menu.style.left = e.clientX + 'px';
          menu.style.top = e.clientY + 'px';
          menu.style.minWidth = '170px';

          function addItem(label, action) {
            var el = document.createElement('div');
            el.className = 'context-menu-item';
            el.textContent = label;
            el.addEventListener('click', function() { menu.remove(); action(); });
            menu.appendChild(el);
          }
          function addSep() {
            var sep = document.createElement('div');
            sep.className = 'context-menu-separator';
            menu.appendChild(sep);
          }

          addItem('\u2611  选中/取消当前行', function() {
            var cb = row.querySelector('.result-checkbox');
            if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
          });
          addItem('\u{1F4CB}  复制当前行', function() {
            if (!S.queryResults || !S.queryResults[rowIdx]) return;
            var data = S.queryResults[rowIdx];
            var keys = Object.keys(data);
            var text = keys.map(function(k) { return k + ': ' + String(data[k] !== undefined ? data[k] : ''); }).join('\n');
            if (typeof addToClipboard === 'function') addToClipboard(text, '表格行');
            if (typeof setStatus === 'function') setStatus('已复制第 ' + (rowIdx + 1) + ' 行');
          });
          if (!isNaN(colIdx)) {
            addItem('\u{1F4CB}  复制单元格值', function() {
              var text = (cell.textContent || '').trim();
              if (typeof addToClipboard === 'function') addToClipboard(text, '单元格');
              if (typeof setStatus === 'function') setStatus('已复制单元格值');
            });
          }
          addSep();
          addItem('\u{1F4CA}  导出为 Excel', function() {
            if (typeof exportToExcel === 'function') exportToExcel();
          });
          addItem('\u{1F4CB}  复制全部选中数据', function() {
            var checked = [];
            document.getElementById("queryResults").querySelectorAll('.result-checkbox:checked').forEach(function(cb) {
              var tr = cb.closest('tr');
              if (tr && !isNaN(parseInt(tr.dataset.row))) {
                checked.push(S.queryResults[parseInt(tr.dataset.row)]);
              }
            });
            if (checked.length === 0) { if (typeof setStatus === 'function') setStatus('没有选中数据'); return; }
            var keys = Object.keys(checked[0]);
            var lines = checked.map(function(r) {
              return keys.map(function(k) { return String(r[k] !== undefined ? r[k] : '').replace(/\t/g, ' ').replace(/\n/g, '\\n'); }).join('\t');
            });
            if (typeof addToClipboard === 'function') addToClipboard(lines.join('\n'), '表格数据');
            if (typeof setStatus === 'function') setStatus('已复制 ' + checked.length + ' 行数据');
          });

          document.body.appendChild(menu);

          var menuRect = menu.getBoundingClientRect();
          if (menuRect.right > window.innerWidth) { menu.style.left = (e.clientX - menuRect.width) + 'px'; }
          if (menuRect.bottom > window.innerHeight) { menu.style.top = (e.clientY - menuRect.height) + 'px'; }

          var closer = function(ev) {
            if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closer); }
          };
          setTimeout(function() { document.addEventListener('click', closer); }, 0);
        });
      }
    }

    // ── 列宽拖拽调整 ──
    // 全高度竖线：hover 时贯穿整列
    // 放到 document.getElementById("queryContainer") 而非 document.getElementById("queryResults")，避免被 overflow-y 裁剪
    var resizeLine = document.createElement('div');
    resizeLine.className = 'col-resize-line';
    resizeLine.style.cssText = 'position:absolute;top:0;width:2px;z-index:3;pointer-events:none;display:none';
    document.getElementById("queryContainer").appendChild(resizeLine);
    if (document.getElementById("queryContainer").style.position !== 'absolute' && document.getElementById("queryContainer").style.position !== 'relative') {
      document.getElementById("queryContainer").style.position = 'relative';
    }

    var _colResizing = false;
    document.getElementById("queryResults").querySelectorAll('.col-resizer').forEach(function(handle) {
      handle.addEventListener('mouseenter', function() {
        if (_colResizing) return;
        var th = handle.parentElement;
        var thRect = th.getBoundingClientRect();
        var containerRect = document.getElementById("queryContainer").getBoundingClientRect();
        resizeLine.style.display = 'block';
        resizeLine.style.top = (thRect.top - containerRect.top) + 'px';
        resizeLine.style.left = (thRect.right - containerRect.left) + 'px';
        resizeLine.style.height = document.getElementById("queryResults").getBoundingClientRect().height + 'px';
      });
      handle.addEventListener('mouseleave', function() {
        if (_colResizing) return;
        resizeLine.style.display = 'none';
      });
      handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        _colResizing = true;
        var th = handle.parentElement;
        var colIdx = th.getAttribute('data-col');
        var startX = e.clientX;
        var startWidth = th.offsetWidth;
        // 拖拽时显示定位线
        var thRect = th.getBoundingClientRect();
        var containerRect = document.getElementById("queryContainer").getBoundingClientRect();
        resizeLine.style.display = 'block';
        resizeLine.style.top = (thRect.top - containerRect.top) + 'px';
        resizeLine.style.left = (thRect.right - containerRect.left) + 'px';
        resizeLine.style.height = document.getElementById("queryResults").getBoundingClientRect().height + 'px';

        function onMouseMove(e2) {
          var dx = e2.clientX - startX;
          var newWidth = Math.max(40, startWidth + dx);
          document.getElementById("queryResults").querySelectorAll('[data-col="' + colIdx + '"]').forEach(function(cell) {
            cell.style.width = newWidth + 'px';
            cell.style.maxWidth = newWidth + 'px';
            cell.style.minWidth = newWidth + 'px';
          });
          resizeLine.style.left = (e2.clientX - containerRect.left) + 'px';
        }
        function onMouseUp() {
          _colResizing = false;
          resizeLine.style.display = 'none';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      });
    });

    // ── 统一交互样式（所有 query 面板通用）──
    setTimeout(function () {
      var headers = document.getElementById("queryResults").querySelectorAll('.result-table thead th');
      var cssCol = -1, xpathCol = -1, tagCol = -1, srcCol = -1, matchCol = -1;
      var linkCols = {};
      headers.forEach(function (th, i) {
        var t = th.textContent.trim();
        if (t === 'CSS选择器' || t === '选择器') cssCol = i;
        if (t === 'XPath') xpathCol = i;
        if (t === '标签') tagCol = i;
        if (t === '来源') srcCol = i;
        if (t === '匹配数') matchCol = i;
        if (/^(链接|href|src|url|来源|父级链接|文本\/链接)$/i.test(t)) linkCols[i] = true;
      });
      function toggleCell(cell, defMax) {
        // 如果点击的是已展开的单元格 → 折叠
        if (cell.style.whiteSpace === 'normal') {
          cell.style.whiteSpace = 'nowrap'; cell.style.maxWidth = (defMax || '200px'); cell.style.overflow = 'hidden'; cell.style.wordBreak = '';
          window._expandedCell = null;
        } else {
          // 先折叠上一个展开的单元格
          window._collapseExpandedCell();
          // 展开当前
          cell.style.whiteSpace = 'normal'; cell.style.maxWidth = (defMax || '200px'); cell.style.overflow = 'visible'; cell.style.wordBreak = 'break-all';
          window._expandedCell = cell;
        }
      }
      document.getElementById("queryResults").querySelectorAll('.result-table tbody tr').forEach(function (tr) {
        // 跳过标签分组标题行（click 由 tr.onclick 处理，不应被 td 拦截）
        if (tr.classList.contains('query-tag-header')) return;
        var tds = tr.querySelectorAll('td');
        if (tagCol >= 0 && tds[tagCol]) { tds[tagCol].style.color = 'var(--accent)'; tds[tagCol].style.fontWeight = '600'; tds[tagCol].style.fontSize = '11px'; if (tr.hasAttribute('data-selector') || tr.hasAttribute('data-xpath')) tds[tagCol].style.cursor = 'pointer'; }
        if (srcCol >= 0 && tds[srcCol]) {
          var sv = (tds[srcCol].textContent || '').trim();
          tds[srcCol].style.fontSize = '10px'; tds[srcCol].style.whiteSpace = 'nowrap';
          if (sv === '框选' || sv.indexOf('框选') === 0 || sv === 'pick') tds[srcCol].style.color = 'var(--green)';
          else if (sv === '识别' || sv === 'auto') tds[srcCol].style.color = 'var(--orange)';
          else if (sv === '合并' || sv === '拆分') tds[srcCol].style.color = '#a78bfa';
          else tds[srcCol].style.color = 'var(--text-dim)';
        }
        if (matchCol >= 0 && tds[matchCol]) {
          var mv = parseInt(tds[matchCol].textContent) || 0;
          tds[matchCol].style.whiteSpace = 'nowrap';
          tds[matchCol].innerHTML = '<span style="font-size:10px;padding:1px 5px;border-radius:3px;white-space:nowrap;' +
            (mv > 0 ? 'background:rgba(74,222,128,0.15);color:var(--green)' : 'background:rgba(248,113,113,0.15);color:var(--red)') +
            '">' + (mv > 0 ? mv + ' 个' : '无匹配') + '</span>';
        }
        tds.forEach(function (td, ci) {
          var txt = (td.textContent || '').trim();
          if (!txt || txt.length < 8) return;
          var isLink = linkCols[ci];
          var isCss = (ci === cssCol);
          var isXp = (ci === xpathCol);
          var defMax = isCss || isXp ? '260px' : isLink ? '220px' : '200px';
          td.style.cssText = 'cursor:pointer;max-width:' + defMax + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
            (isXp ? 'color:var(--text-dim);font-size:9px;font-family:Consolas,"Microsoft YaHei",monospace;' : '');
          td.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();

            // 联动：标签列点击 → 滚动定位到页面元素
            if (S.linkageEnabled && ci === tagCol) {
              var tr = td.closest('tr[data-selector], tr[data-xpath]');
              if (tr) {
                var sel = tr.getAttribute('data-selector') || '';
                var xp = tr.getAttribute('data-xpath') || '';
                var qidx = tr.getAttribute('data-query-idx');
                var idxVal = qidx != null ? parseInt(qidx) : null;

                var scrollCode = '';
                if (xp) {
                  if (idxVal != null) {
                    scrollCode += 'var snap=document.evaluate(' + JSON.stringify(xp) + ',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);var el=snap.snapshotItem(' + idxVal + ');';
                  } else {
                    scrollCode += 'var el=null;try{el=document.evaluate(' + JSON.stringify(xp) + ',document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;}catch(xe){}';
                  }
                } else if (sel) {
                  if (idxVal != null) {
                    scrollCode += 'var els=document.querySelectorAll(' + JSON.stringify(sel) + ');var el=els[' + idxVal + ']||null;';
                  } else {
                    scrollCode += 'var el=null;try{el=document.querySelector(' + JSON.stringify(sel) + ');}catch(qe){}';
                  }
                }
                scrollCode += 'if(el)el.scrollIntoView({behavior:"smooth",block:"center"});';
                if (scrollCode) {
                  document.getElementById("webview").executeJavaScript('(function(){' + scrollCode + '})()').catch(function(){});
                }
                setTimeout(function() {
                  var code = _buildLinkHighlightJS(sel, xp, idxVal, true);
                  if (code) {
                    document.getElementById("webview").executeJavaScript('(function(){' + code + '})()').catch(function(){});
                  }
                }, 600);
              }
              return; // 标签列不触发展开/折叠
            }

            if (e.ctrlKey || e.metaKey) {
              if (isLink) {
                var linkUrl = txt;
                if (/^https?:\/\//i.test(linkUrl)) { window.api.openPopupTab(linkUrl); return; }
                // 相对链接: 基于当前页面 URL 解析
                if (linkUrl && !/^(javascript|mailto|tel|#)/i.test(linkUrl)) {
                  try { var baseUrl = document.getElementById("webview").getURL(); linkUrl = new URL(linkUrl, baseUrl).href; window.api.openPopupTab(linkUrl); return; } catch(e) {}
                }
              }
              if (isCss) { showExtractPanel('css'); document.getElementById("queryInput").value = txt; executeQuery(); return; }
              if (isXp) { showExtractPanel('xpath'); document.getElementById("queryInput").value = txt; executeQuery(); return; }
            }
            toggleCell(td, defMax);
          });
        });
      });
    }, 0);

    // ── 联动事件代理 ──
    _setupLinkageEvents();
  }


  // ──────── 表格页面联动 ────────

  var _linkHlTimer = null;

  function _removeAllLinkHighlights() {
    try {
      document.getElementById("webview").executeJavaScript(
        '(function(){' +
          'var ovs=document.querySelectorAll(".__parser_link_hl,.__parser_link_flash");' +
          'for(var i=0;i<ovs.length;i++){' +
            'var ov=ovs[i];' +
            'if(!ov.parentNode)continue;' +
            'var op=ov.getAttribute("data-ppos");' +
            'if(op!==null&&op!=="")ov.parentNode.style.position=op;' +
            'ov.parentNode.removeChild(ov);' +
          '}' +
        '})()'
      );
    } catch(e) {}
  }

  function _removeLinkHoverHighlights() {
    try {
      document.getElementById("webview").executeJavaScript(
        '(function(){' +
          'var ovs=document.querySelectorAll(".__parser_link_hl");' +
          'for(var i=0;i<ovs.length;i++){' +
            'var ov=ovs[i];' +
            'if(!ov.parentNode)continue;' +
            'var op=ov.getAttribute("data-ppos");' +
            'if(op!==null&&op!=="")ov.parentNode.style.position=op;' +
            'ov.parentNode.removeChild(ov);' +
          '}' +
        '})()'
      );
    } catch(e) {}
  }

  function _buildLinkHighlightJS(sel, xpath, qidx, flashMode) {
    var clsName = flashMode ? '__parser_link_flash' : '__parser_link_hl';
    var border = flashMode ? '3px solid #f59e0b' : '2px dashed #3b82f6';
    var bg = flashMode ? 'rgba(245,158,11,0.18)' : 'rgba(59,130,246,0.08)';

    // 定位元素
    var code = '';
    if (xpath) {
      if (qidx != null) {
        code += 'var snap=document.evaluate(' + JSON.stringify(xpath) + ',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);' +
                'var el=snap.snapshotItem(' + qidx + ');';
      } else {
        code += 'var el=null;try{el=document.evaluate(' + JSON.stringify(xpath) + ',document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;}catch(xe){}';
      }
    } else if (sel) {
      if (qidx != null) {
        code += 'var els=document.querySelectorAll(' + JSON.stringify(sel) + ');' +
                'var el=els[' + qidx + ']||null;';
      } else {
        code += 'var el=null;try{el=document.querySelector(' + JSON.stringify(sel) + ');}catch(qe){}';
      }
    }
    code += 'if(!el)return;';

    // 高亮浮层
    code +=
      'var tag=el.tagName.toUpperCase();' +
      'var isVoid=tag==="IMG"||tag==="INPUT"||tag==="BR"||tag==="HR"||tag==="SOURCE"||tag==="EMBED"||tag==="AREA";' +
      'var ov=document.createElement("div");' +
      'ov.className="' + clsName + '";' +
      'ov.style.cssText="position:absolute;pointer-events:none;z-index:2147483641;border:' + border + ';border-radius:2px;background:' + bg + ';' + (flashMode ? 'transition:opacity 0.4s' : '') + '";' +
      'if(!isVoid){' +
        'var oldPos=el.style.position;ov.setAttribute("data-ppos",oldPos||"");if(!oldPos||oldPos==="static")el.style.position="relative";' +
        'ov.style.width="100%";ov.style.height="100%";ov.style.top="0";ov.style.left="0";' +
        'el.appendChild(ov);' +
      '}else{' +
        'var parent=el.parentElement;if(!parent)return;' +
        'var oldPPos=parent.style.position;ov.setAttribute("data-ppos",oldPPos||"");if(!oldPPos||oldPPos==="static")parent.style.position="relative";' +
        'var er=el.getBoundingClientRect();var pr=parent.getBoundingClientRect();' +
        'ov.style.left=(er.left-pr.left)+"px";ov.style.top=(er.top-pr.top)+"px";ov.style.width=er.width+"px";ov.style.height=er.height+"px";' +
        'parent.appendChild(ov);' +
      '}';

    if (flashMode) {
      code +=
        'setTimeout(function(){' +
          'ov.style.opacity="0";' +
          'setTimeout(function(){' +
            'if(ov.parentNode){var op=ov.getAttribute("data-ppos");if(op!==null&&op!=="")ov.parentNode.style.position=op;ov.parentNode.removeChild(ov);}' +
          '},400);' +
        '},1000);';
    }

    return code;
  }

  function _setupLinkageEvents() {
    var container = document.getElementById("queryResults");
    if (!container || container._linkEventsBound) return;
    container._linkEventsBound = true;

    container.addEventListener('mouseover', function(e) {
      if (!S.linkageEnabled) return;
      var tr = e.target.closest('tr[data-selector], tr[data-xpath]');
      if (!tr) return;

      var sel = tr.getAttribute('data-selector') || '';
      var xpath = tr.getAttribute('data-xpath') || '';
      var qidx = tr.getAttribute('data-query-idx');
      var idxVal = qidx != null ? parseInt(qidx) : null;

      if (_linkHlTimer) clearTimeout(_linkHlTimer);
      _linkHlTimer = setTimeout(function() {
        _removeLinkHoverHighlights();
        var code = _buildLinkHighlightJS(sel, xpath, idxVal, false);
        if (code) {
          document.getElementById("webview").executeJavaScript('(function(){' + code + '})()').catch(function(){});
        }
      }, 50);
    });

    container.addEventListener('mouseout', function(e) {
      var tr = e.target.closest('tr[data-selector], tr[data-xpath]');
      if (!tr) return;
      if (_linkHlTimer) clearTimeout(_linkHlTimer);
      _removeLinkHoverHighlights();
    });

    container.addEventListener('click', function(e) {
      if (!S.linkageEnabled) return;

      // 只响应"标签"列的点击（避免与展开/收起、复制等冲突）
      var td = e.target.closest('td[data-col]');
      if (!td) return;
      var colIdx = td.getAttribute('data-col');
      var th = container.querySelector('thead th[data-col="' + colIdx + '"]');
      if (!th || (th.textContent || '').trim() !== '标签') return;

    });

    // 注入 contextmenu 监听 → 同步存储元素 xpath（供右键菜单"定位到表格行"使用）
    try {
      document.getElementById("webview").executeJavaScript(
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

  // ── 查询表格标签分组展开/折叠 ──
  // ── 查询表格标签分组展开/折叠 ──
  window._toggleQueryTag = function(el) {
    var tag = el.getAttribute("data-qtag");
    var collapsed = !(window._collapsedQueryTags[tag] || false);
    window._collapsedQueryTags[tag] = collapsed;
    var toggle = el.querySelector(".query-tag-toggle");
    if (toggle) toggle.textContent = collapsed ? "\u25b6" : "\u25bc";
    var rows = document.getElementById("queryResults").querySelectorAll("[data-qtag]");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-qtag") === tag && !rows[i].classList.contains("query-tag-header")) {
        rows[i].classList.toggle("hidden-row", collapsed);
      }
    }
  };
  window._expandAllQueryTags = function() {
    window._collapsedQueryTags = {};
    document.getElementById("queryResults").querySelectorAll(".query-tag-toggle").forEach(function(t) { t.textContent = "\u25bc"; });
    document.getElementById("queryResults").querySelectorAll(".query-tag-row.hidden-row, .query-group-row.hidden-row, .query-child-row.hidden-row").forEach(function(r) { r.classList.remove("hidden-row"); });
  };
  window._collapseAllQueryTags = function() {
    var allTags = {};
    document.getElementById("queryResults").querySelectorAll(".query-tag-header").forEach(function(h) {
      allTags[h.getAttribute("data-qtag")] = true;
      var tg = h.querySelector(".query-tag-toggle");
      if (tg) tg.textContent = "\u25b6";
    });
    window._collapsedQueryTags = allTags;
    document.getElementById("queryResults").querySelectorAll(".query-tag-row, .query-group-row, .query-child-row").forEach(function(r) { r.classList.add("hidden-row"); });
  };


  // 同步工具栏全选 → 表头全选
  function syncQueryCheckAll(checked) {
    if (document.getElementById("queryCheckAll")) document.getElementById("queryCheckAll").checked = checked;
  }

  // 根据各行勾选状态自动更新两个全选的状态
  function syncAllCheckState() {
    var allCbs = document.getElementById("queryResults").querySelectorAll('.result-checkbox');
    var allChecked = allCbs.length > 0;
    allCbs.forEach(function(cb) { if (!cb.checked) allChecked = false; });
    var rca = document.getElementById("queryResults").querySelector('.result-check-all');
    if (rca) rca.checked = allChecked;
    if (document.getElementById("queryCheckAll")) document.getElementById("queryCheckAll").checked = allChecked;
  }

  function updateRowSelection() {
    document.getElementById("queryResults").querySelectorAll('.result-table tbody tr').forEach(function(tr) {
      var cb = tr.querySelector('.result-checkbox');
      if (cb) tr.classList.toggle('selected', cb.checked);
    });
  }


  // Module API
  window.Parser.query = {
    bindEvents: bindQueryEvents,
    executeQuery: executeQuery,
    renderTable: renderQueryTable,
    syncCheckAll: syncQueryCheckAll,
    syncAllCheckState: syncAllCheckState,
    updateRowSelection: updateRowSelection,
  };

  // Stealth 功能（从 app.js 迁移至此，供 app.js 调用）
  window.Parser.stealth = {
    setupCdpStealthInjection: setupCdpStealthInjection,
    injectStealthConfig: injectStealthConfig,
    applyStealthGlobals: applyStealthGlobals,
    isStealthGlobalEnabled: isStealthGlobalEnabled,
    injectStealthPrototypes: injectStealthPrototypes,
    getStealthScriptsForHost: getStealthScriptsForHost,
    injectBehaviorScript: injectBehaviorScript,
  };
})();
