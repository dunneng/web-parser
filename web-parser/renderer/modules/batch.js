/**
 * 网页解析器 — 批量抓取模块
 */
window.Parser = window.Parser || {};

(function() {
  'use strict';
  var S = window.Parser.state;
  var U = window.Parser.utils;
  var $ = U.$;
  var $$ = U.$$;

  // ═══════════════════════════════════════════════
  // 批量抓取功能
  // ═══════════════════════════════════════════════

  // ═══════════════════════════════════════════════
  // 请求节流（ikSoft 模式：间隔 + 随机抖动 ±20%）
  // ═══════════════════════════════════════════════

  /** 获取节流间隔（ms），带 ±20% 随机抖动 */
  function getJitteredInterval() {
    var el = document.getElementById('batchInterval');
    if (!el) return 500;
    var base = parseInt(el.value) || 500;
    if (base <= 0) return 0;
    var jitter = base * 0.2;
    var min = Math.max(100, base - jitter);
    var max = base + jitter;
    return Math.floor(min + Math.random() * (max - min));
  }

  /** 节流等待（带抖动），替代直接 sleep */
  function jiangeSleep() {
    return sleep(getJitteredInterval());
  }

  var _batchEventsBound = false;
  function bindBatchEvents() {
    if (_batchEventsBound) return;
    _batchEventsBound = true;
    document.getElementById("btnBatch").addEventListener('click', openBatchModal);
    // 跨平台比价入口 — 使用 Electron 内置标签页浏览器
    var btnPriceCompare = document.getElementById("btnPriceCompare");
    if (btnPriceCompare) {
      btnPriceCompare.addEventListener('click', async function() {
        // 确保 Python 后端已启动
        if (window.api && window.api.pythonHealth) {
          var health = await window.api.pythonHealth();
          if (health.status !== 'ok' && window.api.pythonStart) {
            btnPriceCompare.disabled = true;
            btnPriceCompare.textContent = '⏳ 启动中...';
            var result = await window.api.pythonStart();
            if (!result.ok) {
              alert('Python 后端启动失败: ' + (result.error || '超时'));
              btnPriceCompare.disabled = false;
              btnPriceCompare.textContent = '💰 比价';
              return;
            }
            btnPriceCompare.disabled = false;
            btnPriceCompare.textContent = '💰 比价';
          }
        }
        var url = 'http://127.0.0.1:19527/price-compare';
        if (window.api && window.api.openPopupTab) {
          window.api.openPopupTab(url);
        } else {
          window.open(url, '_blank');
        }
      });
    }
    document.getElementById("btnBatchModalClose").addEventListener('click', closeBatchModal);
    document.getElementById("btnBatchCancel").addEventListener('click', closeBatchModal);
    document.getElementById("batchModal").addEventListener('mousedown', function(e) {
      if (e.target === document.getElementById("batchModal")) closeBatchModal();
    });
    // 模式切换
    document.getElementById("batchModal").querySelectorAll('.batch-mode-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        S.batchCurrentMode = tab.dataset.mode;
        document.getElementById("batchModal").querySelectorAll('.batch-mode-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        document.getElementById("batchModal").querySelector('#batchModeTemplate').classList.toggle('hidden', S.batchCurrentMode !== 'template');
        document.getElementById("batchModal").querySelector('#batchModeUrlList').classList.toggle('hidden', S.batchCurrentMode !== 'urllist');
        document.getElementById("batchModal").querySelector('#batchModeLocalFiles').classList.toggle('hidden', S.batchCurrentMode !== 'localfiles');
        document.getElementById("batchModeApi").classList.toggle('hidden', S.batchCurrentMode !== 'api');
        document.getElementById("batchSharedConfig").classList.toggle('hidden', S.batchCurrentMode === 'api');
        document.getElementById("btnBatchConfirm").classList.toggle('hidden', S.batchCurrentMode === 'api');
        document.getElementById("btnApiSend").classList.toggle('hidden', S.batchCurrentMode !== 'api');
        if (S.batchCurrentMode === 'api') updateApiBodyVisibility();
        if (S.batchCurrentMode !== 'api') updateBatchPreview();
      });
    });
    // URL 文件导入
    var btnImportUrlFile = $('#btnImportUrlFile');
    var batchUrlFileInput = $('#batchUrlFileInput');
    if (btnImportUrlFile) {
      btnImportUrlFile.addEventListener('click', function() { batchUrlFileInput.click(); });
      batchUrlFileInput.addEventListener('change', function() {
        var file = batchUrlFileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(e) {
          var lines = e.target.result.split(/[\r\n]+/).filter(Boolean);
          var el = $('#batchUrlList');
          el.value = lines.join('\n');
          el.style.height = 'auto';
          el.style.height = el.scrollHeight + 'px';
          setStatus('已导入 ' + lines.length + ' 行');
        };
        reader.readAsText(file);
        batchUrlFileInput.value = '';
      });
    }
    document.getElementById("btnBatchConfirm").addEventListener('click', function() {
      var raw = (document.getElementById('batchUrlList').value || '').trim();
      var firstUrl = raw ? normalizeUrl(raw.split('\n')[0].trim()) : '';
      if (!raw) { setStatus('URL列表为空'); return; }
      // 仅加载首链，不创建任务
      if (firstUrl) document.getElementById('webview').loadURL(firstUrl);
      closeBatchModal();
      document.getElementById('btnBatchConfirm').classList.add('hidden');
      document.getElementById('btnBatchLoadAll').classList.remove('hidden');
      document.getElementById('btnGo').classList.add('hidden');
      setStatus('已加载首链，请点「元素提取」框选元素');
    });
    document.getElementById("btnBatchLoadAll").addEventListener('click', batchLoadAll);
    document.getElementById("btnBatchClearDone").addEventListener('click', batchClearDone);
    document.getElementById("btnBatchContinue").addEventListener('click', batchContinue);

    // ── 批量提取模式切换（弹框内） ──
    document.querySelectorAll('input[name="batchExtractModeDlg"]').forEach(function(el) {
      el.addEventListener('change', function() {
        if (window.Parser && window.Parser.state) {
          window.Parser.state.batchExtractMode = this.value;
        }
        var rows = document.getElementById("batchSelectorRows");
        if (rows) rows.style.display = (this.value === 'selector') ? '' : 'none';
      });
    });

    // 添加选择器行
    document.getElementById("btnBatchAddSelector").addEventListener('click', function() {
      var row = document.createElement('div');
      row.className = 'batch-selector-row';
      row.style.cssText = 'display:flex;align-items:center;gap:4px';
      row.innerHTML = '<input type="text" class="form-input batch-dlg-selector" placeholder="CSS选择器" style="flex:1;height:28px;padding:0 8px;font-size:12px"><button class="btn btn-sm batch-sel-remove" style="height:24px;padding:0 6px;font-size:12px;color:var(--red);border-color:transparent;background:transparent" title="删除">×</button>';
      row.querySelector('.batch-sel-remove').addEventListener('click', function() { row.remove(); });
      document.getElementById("batchSelectorRows").appendChild(row);
    });

    // 初始删除按钮 + 手动编辑标记
    document.querySelectorAll('.batch-sel-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var row = this.closest('.batch-selector-row');
        if (row) row.remove();
      });
    });
    document.querySelectorAll('.batch-dlg-selector').forEach(function(inp) {
      inp.addEventListener('input', function() { this.dataset._manualEdit = '1'; });
    });

    // ── 浮窗拖动（任意位置按住即拖，移超3px才拖，否则算点击）─
    (function() {
      var pf = document.getElementById("paginationFloat");
      if (!pf) return;
      var dragging = false, moved = false, startY = 0, startTop = 0;
      pf.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        dragging = true; moved = false;
        startY = e.clientY;
        startTop = pf.offsetTop;
        var panel = pf.parentElement;
        pf._dragMax = panel ? panel.offsetHeight - pf.offsetHeight : 9999;
        pf.classList.add('dragging');
        document.body.style.userSelect = 'none';
      });
      var _raf = 0, _lastY = 0;
      window.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        if (!moved && Math.abs(e.clientY - startY) < 3) return;
        moved = true;
        e.preventDefault();
        _lastY = e.clientY;
        if (_raf) return;
        _raf = requestAnimationFrame(function() {
          _raf = 0;
          var newTop = startTop + _lastY - startY;
          newTop = Math.max(0, Math.min(newTop, pf._dragMax || 9999));
          pf.style.top = newTop + 'px';
          pf.style.transform = 'none';
        });
      });
      window.addEventListener('mouseup', function() {
        dragging = false;
        pf.classList.remove('dragging');
        document.body.style.userSelect = '';
      });
    })();

    // ── 批量浮窗按钮 ──
    // pfGear 点击由 app.js 统一处理，根据模式打开不同的弹框
    document.getElementById("pfPrev").addEventListener('click', function() {
      if (!S.batchTasks.length || !S.batchLoadRunning) return;
      var cur = S.batchTasks.findIndex(function(t) { return t.id === S.batchCurrentTaskId; });
      if (cur > 0) {
        var prev = S.batchTasks[cur - 1];
        if (prev.url) {
          S.batchCurrentTaskId = null;
          document.getElementById("webview").loadURL(prev.url);
          updateBatchFloat();
        }
      }
    });
    document.getElementById("pfNext").addEventListener('click', function() {
      if (!S.batchTasks.length || !S.batchLoadRunning) return;
      var cur = S.batchTasks.findIndex(function(t) { return t.id === S.batchCurrentTaskId; });
      if (cur >= 0 && cur < S.batchTasks.length - 1) {
        var next = S.batchTasks[cur + 1];
        if (next.url) {
          S.batchCurrentTaskId = null;
          document.getElementById("webview").loadURL(next.url);
          updateBatchFloat();
        }
      }
    });
    document.getElementById("pfPause").addEventListener('click', function() {
      if (S.batchLoadPaused) {
        S.batchLoadPaused = false;
        document.getElementById("pfPause").innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>';
        document.getElementById("pfPause").title = '暂停';
        setStatus('已继续');
        return;
      }
      S.batchLoadPaused = true;
      document.getElementById("pfPause").innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      document.getElementById("pfPause").title = '继续';
      setStatus('已暂停');
    });
    document.getElementById("pfStop").addEventListener('click', function() {
      S.batchLoadCancel = true;
      setStatus('已停止');
      document.getElementById("paginationFloat").classList.add('hidden');
    });

    // ── 本地文件事件 ──
    if (document.getElementById("btnBatchPickFiles") && document.getElementById("batchLocalFileInput")) {
      document.getElementById("btnBatchPickFiles").addEventListener('click', function() { document.getElementById("batchLocalFileInput").click(); });
      document.getElementById("batchLocalFileInput").addEventListener('change', function() {
        var files = document.getElementById("batchLocalFileInput").files;
        if (!files || files.length === 0) return;
        for (var i = 0; i < files.length; i++) {
          if (/\.html?$/i.test(files[i].name)) {
            S.batchLocalFiles.push({ name: files[i].name, path: window.api.getPathForFile(files[i]) });
          }
        }
        document.getElementById("batchLocalFileInput").value = '';
        renderLocalFilePreview();
      });
    }
    // 拖拽到弹框内的投放区
    if (document.getElementById("batchLocalDrop")) {
      document.getElementById("batchLocalDrop").addEventListener('dragover', function(e) { e.preventDefault(); document.getElementById("batchLocalDrop").classList.add('drag-over'); });
      document.getElementById("batchLocalDrop").addEventListener('dragleave', function() { document.getElementById("batchLocalDrop").classList.remove('drag-over'); });
      document.getElementById("batchLocalDrop").addEventListener('drop', function(e) {
        e.preventDefault();
        document.getElementById("batchLocalDrop").classList.remove('drag-over');
        var files = e.dataTransfer && e.dataTransfer.files;
        if (!files || files.length === 0) return;
        for (var i = 0; i < files.length; i++) {
          if (/\.html?$/i.test(files[i].name)) {
            S.batchLocalFiles.push({ name: files[i].name, path: window.api.getPathForFile(files[i]) });
          }
        }
        renderLocalFilePreview();
      });
    }
    if (document.getElementById("btnBatchLocalClear")) {
      document.getElementById("btnBatchLocalClear").addEventListener('click', function() {
        S.batchLocalFiles = [];
        renderLocalFilePreview();
      });
    }

    // ── API 接入事件 ──
    document.getElementById("btnApiSend").addEventListener('click', sendApiRequest);
    document.getElementById("btnAddHeader").addEventListener('click', function() { addApiHeaderRow('', ''); });
    document.getElementById("apiMethod").addEventListener('change', updateApiBodyVisibility);
    document.getElementById("btnApiLoadCookie").addEventListener('click', loadCookieForApi);

    // ── 静态/动态网页 + 等待策略切换 ──
    $$('input[name="batchPageType"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        var isDynamic = document.querySelector('input[name="batchPageType"]:checked').value === 'dynamic';
        document.getElementById("batchDynamicConfig").style.display = isDynamic ? 'flex' : 'none';
        if (isDynamic) updateDynamicOptsVisibility();
      });
    });
    document.getElementById("batchDynamicStrategy").addEventListener('change', updateDynamicOptsVisibility);

    // ── URL 预览实时更新（去抖 300ms） ──
    var previewDebounceTimer = null;
    function schedulePreviewUpdate() {
      if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
      previewDebounceTimer = setTimeout(updateBatchPreview, 300);
    }
    var previewInputs = [
      $('#batchUrlTemplate'), $('#batchQueries'),
      $('#batchPageStart'), $('#batchPageEnd'),
      $('#batchUrlList'), $('#batchUrlListPageStart'), $('#batchUrlListPageEnd')
    ];
    previewInputs.forEach(function(el) {
      if (el) el.addEventListener('input', schedulePreviewUpdate);
    });
    $$('input[name="batchTagMode"]').forEach(function(radio) {
      radio.addEventListener('change', schedulePreviewUpdate);
    });
    // 首次打开弹框时也更新预览
    updateBatchPreview();

    // ── 拖拽 & 自适应 ──
    bindBatchTagsResize();
  }

  window.openBatchModal = openBatchModal;
  function openBatchModal() {
    document.getElementById("batchModal").classList.remove('hidden');
    // 有URL时显示按钮
    var raw = (document.getElementById('batchUrlList').value || '').trim();
    if (raw) {
      document.getElementById('btnBatchConfirm').classList.remove('hidden');
    }
    var ta = $('#batchUrlTemplate');
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
    updateBatchPreview();
    if (S.batchLocalFiles.length > 0) renderLocalFilePreview();
    // 同步弹框提取模式
    var rules = (window.Parser && window.Parser.state && window.Parser.state.savedSelectorRules) || [];
    document.getElementById("batchDlgRulesHint").textContent = rules.length > 0 ? ('（已保存 ' + rules.length + ' 条）') : '（无规则，请先在提取模式保存）';
    var mode = (window.Parser && window.Parser.state && window.Parser.state.batchExtractMode) || 'rules';
    var radio = document.querySelector('input[name="batchExtractModeDlg"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    // 选择器模式时显示多行，规则模式时隐藏
    var rows = document.getElementById("batchSelectorRows");
    if (rows) rows.style.display = (mode === 'selector') ? '' : 'none';
  }

  function closeBatchModal() {
    document.getElementById("batchModal").classList.add('hidden');
  }

  // ── 动态等待策略 — 显示/隐藏对应参数组 ──
  function updateDynamicOptsVisibility() {
    var strategy = document.getElementById("batchDynamicStrategy").value;
    document.getElementById("batchDynamicOptsFixed").style.display = (strategy === 'fixed') ? 'flex' : 'none';
    document.getElementById("batchDynamicOptsIdle").style.display = (strategy === 'networkIdle') ? 'flex' : 'none';
    document.getElementById("batchDynamicOptsSelector").style.display = (strategy === 'waitSelector') ? 'flex' : 'none';
    document.getElementById("batchDynamicOptsClickNext").style.display = (strategy === 'clickNext' || strategy === 'manual') ? 'flex' : 'none';
    var selectorRow = $('#batchClickNextSelectorRow');
    if (selectorRow) selectorRow.style.display = (strategy === 'manual') ? 'none' : 'flex';
  }

  // ── 实时 URL 预览 ──
  function updateBatchPreview() {
    // 本地文件模式 — 用独立预览
    if (S.batchCurrentMode === 'localfiles') { renderLocalFilePreview(); return; }
    // 模板模式预览
    if (S.batchCurrentMode === 'template') {
      var urlTemplate = normalizeUrl($('#batchUrlTemplate').value.trim());
      var queriesRaw = $('#batchQueries').value.trim();
      var ps = parseInt($('#batchPageStart').value) || 1;
      var pe = parseInt($('#batchPageEnd').value) || 1;
      var tagModeEl = document.querySelector('input[name="batchTagMode"]:checked');
      var tagMode = tagModeEl ? tagModeEl.value : 'cartesian';

      if (!urlTemplate) {
        document.getElementById("batchUrlPreviewCount").textContent = '请输入 URL 模板';
        document.getElementById("batchUrlPreviewList").innerHTML = '';
        return;
      }
      var queries = queriesRaw ? queriesRaw.split(/[\n,]+/).map(function(s) { return s.trim(); }).filter(Boolean) : [''];
      var pageCount = Math.max(pe - ps + 1, 0);

      var total, samples = [];
      if (tagMode === 'cartesian') {
        total = queries.length * pageCount;
        var count = 0;
        for (var qi = 0; qi < queries.length && count < 5; qi++) {
          for (var pi = ps; pi <= pe && count < 5; pi++) {
            var u = urlTemplate.replace(/\{q\}/g, encodeURIComponent(queries[qi])).replace(/\{page\}/g, pi);
            samples.push({ label: queries[qi] + ' p' + pi, url: u, q: queries[qi], page: pi });
            count++;
          }
        }
        document.getElementById("batchUrlPreviewCount").textContent = '共 ' + total + ' 个URL（' + queries.length + '关键词 × ' + pageCount + '页 = 笛卡尔积）';
      } else {
        total = Math.min(queries.length, pageCount);
        for (var i = 0; i < total && i < 5; i++) {
          var q = queries[i] || '';
          var p = ps + i;
          var u = urlTemplate.replace(/\{q\}/g, encodeURIComponent(q)).replace(/\{page\}/g, p);
          samples.push({ label: q + ' p' + p, url: u, q: q, page: p });
        }
        document.getElementById("batchUrlPreviewCount").textContent = '共 ' + total + ' 个URL（一一对应）';
      }
      renderPreviewList(document.getElementById("batchUrlPreviewList"), samples, total);
      return;
    }

    // URL 列表模式预览
    if (S.batchCurrentMode === 'urllist') {
      var raw = $('#batchUrlList').value.trim();
      var lines = raw.split(/[\n]+/).map(function(s) { return s.trim(); }).filter(Boolean);
      var ps = parseInt($('#batchUrlListPageStart').value) || 1;
      var pe = parseInt($('#batchUrlListPageEnd').value) || 1;

      if (lines.length === 0) {
        document.getElementById("batchUrlListPreviewCount").textContent = '请输入 URL';
        document.getElementById("batchUrlListPreviewList").innerHTML = '';
        return;
      }
      var total = 0;
      var samples = [];
      for (var li = 0; li < lines.length && samples.length < 5; li++) {
        var line = normalizeUrl(lines[li]);
        if (/\{page\}/.test(line)) {
          total += Math.max(pe - ps + 1, 0);
          var pc = Math.max(pe - ps + 1, 0);
          for (var pi = ps; pi <= pe && samples.length < 5; pi++) {
            samples.push({ label: '行' + (li + 1) + ' p' + pi, url: line.replace(/\{page\}/g, pi), q: '行' + (li + 1), page: pi });
          }
        } else {
          total += 1;
          samples.push({ label: '行' + (li + 1), url: line, q: '行' + (li + 1), page: null });
        }
      }
      document.getElementById("batchUrlListPreviewCount").textContent = '共 ' + total + ' 个URL（含分页展开）';
      renderPreviewList(document.getElementById("batchUrlListPreviewList"), samples, total);
    }
  }

  function renderPreviewList(container, samples, total) {
    var html = '';
    samples.forEach(function(s) {
      var labelHtml;
      if (s.q != null && s.page != null) {
        labelHtml = '<span class="preview-label"><span class="hl-q">' + escapeHtml(String(s.q)) + '</span> <span class="hl-p">p' + escapeHtml(String(s.page)) + '</span></span>';
      } else if (s.q != null) {
        labelHtml = '<span class="preview-label"><span class="hl-q">' + escapeHtml(String(s.q)) + '</span></span>';
      } else {
        labelHtml = '<span class="preview-label">' + escapeHtml(s.label) + '</span>';
      }
      var urlHtml = escapeHtml(s.url);
      // 高亮 URL 中的页码参数
      if (s.page != null) {
        urlHtml = urlHtml.replace(/([?&;]page=)(\d+)/gi, '$1<span class="hl-p">$2</span>');
      }
      html += '<div class="batch-url-preview-item">' + labelHtml + urlHtml + '</div>';
    });
    if (total > 5) {
      html += '<div class="batch-url-preview-more">...还有 ' + (total - 5) + ' 个</div>';
    }
    container.innerHTML = html;
  }

  // ── 本地文件预览 ──

  function renderLocalFilePreview() {
    if (S.batchLocalFiles.length === 0) {
      document.getElementById("batchLocalPreview").style.display = 'none';
      document.getElementById("batchLocalDrop").style.display = '';
      return;
    }
    document.getElementById("batchLocalDrop").style.display = 'none';
    document.getElementById("batchLocalPreview").style.display = '';
    document.getElementById("batchLocalPreviewCount").textContent = '共 ' + S.batchLocalFiles.length + ' 个文件';
    var html = '';
    S.batchLocalFiles.forEach(function(f, idx) {
      html += '<div class="batch-local-file-item">'
        + '<span class="file-name">' + escapeHtml(f.name) + '</span>'
        + '<span class="file-path">' + escapeHtml(f.path) + '</span>'
        + '<span class="file-remove" data-idx="' + idx + '">&times;</span>'
        + '</div>';
    });
    document.getElementById("batchLocalPreviewList").innerHTML = html;
    // 删除按钮
    document.getElementById("batchLocalPreviewList").querySelectorAll('.file-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(this.dataset.idx);
        if (!isNaN(idx)) { S.batchLocalFiles.splice(idx, 1); renderLocalFilePreview(); }
      });
    });
  }

  // ── 动态网页等待策略 ──

  function waitForNetworkIdle(idleMs, maxWait) {
    return new Promise(function(resolve) {
      var start = Date.now();
      var check = function() {
        if (Date.now() - start >= maxWait) return resolve();
        try {
          document.getElementById("webview").executeJavaScript('(function(){var e=window.__parser&&window.__parser.networkInterceptor&&window.__parser.networkInterceptor.intercepted;if(!e||!e.length)return!0;return Date.now()-e[e.length-1].time>' + idleMs + ';})()').then(function(r) {
            if (r) resolve();
            else setTimeout(check, 500);
          }).catch(function() { resolve(); });
        } catch(e) { resolve(); }
      };
      check();
    });
  }

  function waitForSelector(selector, maxWait) {
    return new Promise(function(resolve) {
      var start = Date.now();
      var check = function() {
        if (Date.now() - start >= maxWait) return resolve();
        try {
          document.getElementById("webview").executeJavaScript('(function(){return!!document.querySelector(\'' + selector.replace(/'/g, "\\'") + '\');})()').then(function(r) {
            if (r) resolve();
            else setTimeout(check, 500);
          }).catch(function() { resolve(); });
        } catch(e) { resolve(); }
      };
      check();
    });
  }

  // 智能构造分页 URL：支持 {page} 占位符，也自动检测硬编码的 page=N 等参数
  function buildPageUrl(template, query, page) {
    var url = template.replace(/\{q\}/g, encodeURIComponent(query));
    if (/\{page\}/.test(template)) {
      // 显式占位符 → 直接替换
      var result = url.replace(/\{page\}/g, page);
      console.log('[buildPageUrl] {page}模式', 'template:', template, 'page:', page, '→', result);
      return result;
    }
    // 自动检测常见分页参数并替换值
    var patterns = [
      /([?&]page)=\d+/i,         // page=1
      /([?&]p)=\d+(?=&|$)/i,     // p=1（避免匹配 path 等）
      /([?&]pn)=\d+/i,           // pn=1
      /([?&]pageNum)=\d+/i,      // pageNum=1
      /([?&]pg)=\d+/i,           // pg=1
      /([?&]currentPage)=\d+/i,  // currentPage=1
    ];
    var patternNames = ['page', 'p', 'pn', 'pageNum', 'pg', 'currentPage'];
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(url)) {
        var result = url.replace(patterns[i], '$1=' + page);
        console.log('[buildPageUrl] 自动检测 ' + patternNames[i] + ' 模式', 'template:', template, 'page:', page, 'url:', url, '→', result);
        return result;
      }
    }
    // 没检测到任何分页参数 → 原样返回（用户可能用路径分页，需手动用 {page}）
    console.warn('[buildPageUrl] ⚠ 未检测到分页参数!', 'template:', template, 'page:', page, '→ 原样返回:', url);
    return url;
  }

  function confirmBatchConfig() {
    // 从弹框读取提取配置
    var modeEl = document.querySelector('input[name="batchExtractModeDlg"]:checked');
    var extractMode = modeEl ? modeEl.value : 'rules';
    // 收集所有非空选择器
    var sels = [];
    document.querySelectorAll('.batch-dlg-selector').forEach(function(inp) {
      var v = inp.value.trim();
      if (v) sels.push(v);
    });
    var extractSelector = sels.join(', ');
    var selectorType = 'css';

    var chainSchema = null;
    if (extractMode === 'chain') {
      if (!window.Parser || typeof window.Parser.buildChainSchema !== 'function') {
        alert('请先在 schema 面板的"链路"标签页中配置 deepest_selector 和提取字段');
        return;
      }
      chainSchema = window.Parser.buildChainSchema();
      if (!chainSchema || !chainSchema.fields || chainSchema.fields.length === 0) {
        alert('链路模式未配置字段，请在 schema 面板 → 链路标签页 → 配置字段后重试');
        return;
      }
    }

    var newTasks = [];

    if (S.batchCurrentMode === 'localfiles') {
      if (S.batchLocalFiles.length === 0) { alert('请先添加 HTML 文件'); return; }
      S.batchLocalFiles.forEach(function(f) {
        var localUrl = toLocalHtmlUrl(f.path);
        newTasks.push({ url: localUrl, q: f.name, page: '-' });
      });
    } else if (S.batchCurrentMode === 'urllist') {
      var raw = $('#batchUrlList').value.trim();
      var lines = raw.split(/[\n]+/).map(function(s) { return s.trim(); }).filter(Boolean);
      var ps = parseInt($('#batchUrlListPageStart').value) || 1;
      var pe = parseInt($('#batchUrlListPageEnd').value) || 1;
      lines.forEach(function(line) {
        var normalizedLine = normalizeUrl(line);
        if (/\{page\}/.test(line)) {
          for (var p = ps; p <= pe; p++) {
            newTasks.push({ url: normalizedLine.replace(/\{page\}/g, p), q: line, page: p });
          }
        } else if (/[?&](?:page|pn|pageNum|pg|currentPage)=\d+/i.test(line) || /[?&]p=\d+(?=&|$)/i.test(line)) {
          // 硬编码了分页参数 → 自动展开
          for (var p = ps; p <= pe; p++) {
            newTasks.push({ url: buildPageUrl(normalizedLine, '', p), q: line, page: p });
          }
        } else {
          newTasks.push({ url: normalizedLine, q: line, page: '-' });
        }
      });
    } else {
      var urlTemplate = normalizeUrl($('#batchUrlTemplate').value.trim());
      var queriesRaw = $('#batchQueries').value.trim();
      var ps = parseInt($('#batchPageStart').value) || 1;
      var pe = parseInt($('#batchPageEnd').value) || 1;
      var tagModeEl = document.querySelector('input[name="batchTagMode"]:checked');
      var tagMode = tagModeEl ? tagModeEl.value : 'cartesian';
      var isClickNext = document.getElementById("batchDynamicStrategy").value === 'clickNext';

      if (!urlTemplate) { setStatus('请输入 URL 模板'); return; }
      var queries = queriesRaw ? queriesRaw.split(/[\n,]+/).map(function(s) { return s.trim(); }).filter(Boolean) : [''];
      if (isClickNext) {
        // 翻页按钮点击模式：每个搜索词只生成 1 个任务
        for (var qi = 0; qi < queries.length; qi++) {
          newTasks.push({ url: buildPageUrl(urlTemplate, queries[qi], ps), q: queries[qi], page: 'clickNext' });
        }
      } else if (document.getElementById("batchDynamicStrategy").value === 'manual') {
        // 手动翻页模式：每个搜索词只生成 1 个任务，用户手动点翻页
        for (var qi = 0; qi < queries.length; qi++) {
          newTasks.push({ url: buildPageUrl(urlTemplate, queries[qi], ps), q: queries[qi], page: 'manual' });
        }
      } else if (tagMode === 'cartesian') {
        for (var qi = 0; qi < queries.length; qi++) {
          for (var pi = ps; pi <= pe; pi++) {
            newTasks.push({ url: buildPageUrl(urlTemplate, queries[qi], pi), q: queries[qi], page: pi });
          }
        }
      } else {
        for (var i = 0; i < Math.max(queries.length, pe - ps + 1); i++) {
          var q = queries[i] || queries[queries.length - 1] || '';
          var p = ps + i;
          if (p > pe) break;
          newTasks.push({ url: buildPageUrl(urlTemplate, q, p), q: q, page: p });
        }
      }
    }

    if (newTasks.length === 0) { setStatus('没有生成任何任务'); return; }
    closeBatchModal();

    // 读取 clickNext 参数（只读一次，避免 DOM 状态变化）
    var _isClickNext = document.getElementById("batchDynamicStrategy").value === 'clickNext';
    var _isManual = document.getElementById("batchDynamicStrategy").value === 'manual';
    var _cnSelector = _isClickNext ? ($('#batchClickNextSelector').value || '').trim() : '';
    var _cnInterval = (_isClickNext || _isManual) ? (parseInt($('#batchClickNextInterval').value) || 2000) : 0;
    var _cnPreWait = _isClickNext ? (parseInt($('#batchClickNextPreWait').value) || 500) : 0;
    var _cnMaxPages = (_isClickNext || _isManual) ? (parseInt($('#batchPageEnd').value) || 1) : 0;

    S.batchTasks = [];
    S.batchAllResults = [];
    S.batchTaskIdCounter = 0;
    newTasks.forEach(function(t) {
      S.batchTasks.push({ id: ++S.batchTaskIdCounter, url: t.url, q: t.q, page: t.page, extractMode: extractMode, extractSelector: extractSelector, selector: extractSelector, selectorType: selectorType, status: 'pending', rowCount: 0, error: null, results: null,
        clickNextSelector: _cnSelector, clickNextInterval: _cnInterval, clickNextPreWait: _cnPreWait, clickNextMaxPages: _cnMaxPages, chainSchema: chainSchema });
    });

    document.getElementById("batchTagsPanel").classList.remove('hidden');
    document.getElementById("btnBatchLoadAll").classList.remove('hidden');
    renderBatchTags();
    fitBatchPanelToTree();
    setStatus('已生成 ' + S.batchTasks.length + ' 个抓取任务');

    hideAllPanels();
    document.getElementById("queryContainer").classList.remove('hidden');
    document.getElementById("queryContainer").dataset.mode = 'batch';
    document.getElementById("contentTitle").textContent = '批量抓取结果';
    document.getElementById("queryResults").innerHTML = '';
    S.queryResults = [];
  }

  function renderBatchTags() {
    document.getElementById("batchTagsList").innerHTML = '';
    S.batchTasks.forEach(function(t) {
      var el = document.createElement('div');
      el.className = 'batch-tag ' + t.status;
      if (t.id === S.batchCurrentTaskId) el.classList.add('active');
      el.innerHTML = '<span class="batch-tag-dot"></span>'
        + '<span class="batch-tag-label" title="' + escapeHtml(t.url) + '">' + escapeHtml(t.q || t.url.split('/').pop() || '?') + (t.page === 'clickNext' || t.page === 'manual' ? '' : t.page !== '-' ? ' p' + t.page : '') + '</span>'
        + (t.status === 'done' ? '<span class="batch-tag-count">' + t.rowCount + '</span>' : '')
        + '<span class="batch-tag-close">&times;</span>';
      el.querySelector('.batch-tag-close').addEventListener('click', function(e2) {
        e2.stopPropagation();
        removeBatchTag(t.id);
      });
      el.addEventListener('click', function() {
        // 高亮当前标签（任何状态都响应点击）
        $$('.batch-tag.active').forEach(function(tag) { tag.classList.remove('active'); });
        el.classList.add('active');
        // 预览区加载该任务 URL（任何状态都需要手动查验）
        console.log('[标签点击] q:', t.q, 'page:', t.page, 'status:', t.status, 'url:', t.url);
        if (isValidUrl(t.url)) {
          var wv = document.getElementById("webview");
          var currentUrl = wv.getURL();
          console.log('[标签点击] 当前webview URL:', currentUrl, '→ 目标URL:', t.url, '是否相同:', currentUrl === t.url);
          if (currentUrl !== t.url) {
            console.log('[标签点击] 🔄 loadURL:', t.url);
            wv.loadURL(t.url);
            // 兜底：1000ms 后检查是否真正跳转，未跳转则用 src 赋值强制导航
            (function(expectedUrl) {
              setTimeout(function() {
                var afterUrl = document.getElementById("webview").getURL();
                console.log('[标签点击] 导航后验证 URL:', afterUrl, '期望:', expectedUrl);
                if (afterUrl !== expectedUrl && afterUrl !== 'about:blank') {
                  console.warn('[标签点击] ⚠ 导航未生效，用 src 赋值重试:', expectedUrl);
                  document.getElementById("webview").src = expectedUrl;
                }
              }, 1000);
            })(t.url);
          } else {
            console.log('[标签点击] ⏭ URL相同，跳过loadURL');
          }
        } else {
          console.warn('[标签点击] ❌ 无效URL:', t.url);
        }
        // done + verify 标签：展示已有数据
        if (t.results && t.results.length) {
          S.queryResults = t.results;
          renderQueryTable(t.results);
          document.getElementById("contentTitle").textContent = '结果: ' + (t.q || t.url) + (t.page && t.page !== '-' && t.page !== 'clickNext' && t.page !== 'manual' ? ' p' + t.page : '') + ' (' + t.rowCount + '项)';
          // 树
          if (t.parseData) { S.parseResult = t.parseData; window.buildTree(S.parseData); }
        } else {
          // 无结果：不显示标题
        }
      });
      document.getElementById("batchTagsList").appendChild(el);
    });
    var pending = S.batchTasks.filter(function(t) { return t.status === 'pending'; }).length;
    var verify = S.batchTasks.filter(function(t) { return t.status === 'verify'; }).length;
    var loading = S.batchTasks.filter(function(t) { return t.status === 'loading'; }).length;
    var done = S.batchTasks.filter(function(t) { return t.status === 'done'; }).length;
    var error = S.batchTasks.filter(function(t) { return t.status === 'error'; }).length;
    var parts = [];
    var icoWrap = 'display:inline-flex;align-items:center;gap:2px';
    if (done) parts.push('<span style="color:var(--green);' + icoWrap + '" title="' + done + '条已完成"><span style="font-size:18px;line-height:1">●</span>' + done + '</span>');
    if (loading) parts.push('<span style="color:var(--accent);' + icoWrap + '" title="' + loading + '条进行中"><span style="font-size:13px;line-height:1">◐</span>' + loading + '</span>');
    if (pending) parts.push('<span style="color:#888;' + icoWrap + '" title="' + pending + '条等待"><span style="font-size:13px;line-height:1">○</span>' + pending + '</span>');
    if (verify) parts.push('<span style="color:#f59e0b;' + icoWrap + '" title="' + verify + '条需验证"><span style="font-size:13px;line-height:1">⚠</span>' + verify + '</span>');
    if (error) parts.push('<span style="color:var(--red);' + icoWrap + '" title="' + error + '条失败"><span style="font-size:13px;line-height:1">✕</span>' + error + '</span>');
    document.getElementById("batchTagsCount").innerHTML = parts.join(' ') || '0个';
    // 显示/隐藏继续按钮
    var hasVerify = S.batchTasks.some(function(t) { return t.status === 'verify'; });
    document.getElementById("btnBatchContinue").classList.toggle('hidden', !hasVerify);
    // 更新合并导出按钮
    updateMergeExportBtn();
    fitBatchPanelToTree();
  }

  function removeBatchTag(id) {
    S.batchTasks = S.batchTasks.filter(function(t) { return t.id !== id; });
    if (S.batchTasks.length === 0) {
      document.getElementById("batchTagsPanel").classList.add('hidden');
      document.getElementById("btnBatchLoadAll").classList.add('hidden');
      S.batchAllResults = [];
    }
    renderBatchTags();
  }

  // 规则模式提取：注入 webview 做精确+相似双重匹配
  async function extractByRules() {
    var rules = (window.Parser && window.Parser.state && window.Parser.state.savedSelectorRules) || [];
    if (rules.length === 0) return [];
    var rulesJson = JSON.stringify(rules);
    var result = await document.getElementById("webview").executeJavaScript(
      '(function(rules){' +
        'var results=[];' +
        'var _seen={};' +
        'function _dk(el,sel){' +
          'var t=(el.textContent||"").trim().substring(0,200);' +
          'var s=String(el.src||el.getAttribute?el.getAttribute("src")||"":"");' +
          'var h=String(el.href||el.getAttribute?el.getAttribute("href")||"":"");' +
          'return (sel||"")+"||"+s+"||"+h+"||"+t;' +
        '}' +
        'function _extract(el,sel,source){' +
          'var info={};' +
          'info._source=source;' +
          'info._selector=sel;' +
          'info.tag=(el.tagName||"").toLowerCase();' +
          'info.text=(el.textContent||"").trim().substring(0,500);' +
          'info.href=String(el.href||el.getAttribute?el.getAttribute("href")||"":"");' +
          'info.src=String(el.src||el.getAttribute?el.getAttribute("src")||"":"");' +
          'info["class"]=String(typeof el.className==="string"?el.className:"");' +
          'info.id=String(el.id||"");' +
          'var attrs=el.attributes;' +
          'for(var ai=0;attrs&&ai<attrs.length;ai++){' +
            'var a=attrs[ai];' +
            'if(a.name&&a.value!==undefined&&a.name!=="class"&&a.name!=="id"&&a.name!=="style"&&a.name!=="href"&&a.name!=="src"){' +
              'info["@"+a.name]=a.value||"";' +
            '}' +
          '}' +
          'return info;' +
        '}' +
        'for(var ri=0;ri<rules.length;ri++){' +
          'var rule=rules[ri];' +
          'try{' +
            'var exactEls=document.querySelectorAll(rule.selector);' +
            'for(var ei=0;ei<exactEls.length;ei++){' +
              'var el=exactEls[ei];' +
              'var dk=_dk(el,rule.selector);' +
              'if(_seen[dk])continue;' +
              '_seen[dk]=true;' +
              'results.push(_extract(el,rule.selector,"精确"));' +
            '}' +
          '}catch(e){}' +
          'var cleanSel=rule.selector.replace(/#[\\w-]+/g,"").replace(/:nth-of-type\\(\\d+\\)/g,"").replace(/\\s*>\\s*/g," > ").replace(/^\\s*>\\s*/,"").trim();' +
          'if(cleanSel&&cleanSel!==rule.selector){' +
            'try{' +
              'var similarEls=document.querySelectorAll(cleanSel);' +
              'for(var si=0;si<similarEls.length;si++){' +
                'var el2=similarEls[si];' +
                'var dk2=_dk(el2,cleanSel);' +
                'if(_seen[dk2])continue;' +
                '_seen[dk2]=true;' +
                'results.push(_extract(el2,cleanSel,"相似"));' +
              '}' +
            '}catch(e){}' +
          '}' +
        '}' +
        'return JSON.stringify(results);' +
      '})(' + rulesJson + ')'
    );
    return JSON.parse(result || '[]');
  }

  // 链路模式提取：调 Python 后端
  async function extractByChain(chainSchema) {
    if (!chainSchema || !chainSchema.fields || chainSchema.fields.length === 0) return [];
    var html = S.currentHtml;
    if (!html) {
      html = await document.getElementById("webview").executeJavaScript('document.documentElement.outerHTML');
      if (!html) return [];
    }
    var resp = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/extract/chain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: html,
        chain_type: chainSchema.chainType || 'css',
        deepest_selector: chainSchema.deepestSelector || '',
        fields: chainSchema.fields,
        child_delim: chainSchema.childDelimiter || ''
      })
    });
    var result = await resp.json();
    if (!result || result.error) return [];
    return result.rows || [];
  }

  window.updateBatchFloat = updateBatchFloat;
  function updateBatchFloat() {
    var el = document.getElementById("paginationFloat");
    if (!el) return;
    
// 批量模式：显示批量控件，隐藏采集控件
    var isBatch = (S.batchTasks && S.batchTasks.length > 0) || (S.batchLoadRunning);
    el.classList.toggle('pf-batch-mode', isBatch);
    el.classList.toggle('pf-collect-mode', !isBatch);
    var total = S.batchTasks.length;
    if (total === 0) {
      // 没有批量任务：显示提取模式和规则数
      var mode = (window.Parser && window.Parser.state && window.Parser.state.batchExtractMode) || 'rules';
      var rules = (window.Parser && window.Parser.state && window.Parser.state.savedSelectorRules) || [];
      document.getElementById("pfPage").textContent = mode === 'rules' ? ('规则×' + rules.length) : '选择器';
      document.getElementById("pfCount").textContent = '';
      return;
    }
    var done = S.batchTasks.filter(function(t) { return t.status === 'done'; }).length;
    var fail = S.batchTasks.filter(function(t) { return t.status === 'error'; }).length;
    var currentIdx = -1;
    if (S.batchCurrentTaskId) {
      for (var j = 0; j < S.batchTasks.length; j++) {
        if (S.batchTasks[j].id === S.batchCurrentTaskId) { currentIdx = j; break; }
      }
    }
    var pageText = (currentIdx >= 0 ? (currentIdx + 1) : (done + fail)) + '/' + total;
    document.getElementById("pfPage").textContent = pageText;
    document.getElementById("pfCount").textContent = S.batchAllResults.length + '条';
  }


  /** 独立窗口模式：创建隐藏 BrowserWindow + CDP 拦截 JSON API 响应 */
  async function loadUrlInWindow(url) {
    try {
      console.log('[batch] 独立窗口开始采集:', url);
      var result = await window.api.collectionOpen({ url: url, timeout: 20000 });
      if (!result || !result.ok) {
        console.log('[batch] 独立窗口失败，降级到 webview:', (result && result.error) || 'unknown');
        document.getElementById("webview").loadURL(url);
        await new Promise(function(r) {
          document.getElementById("webview").addEventListener('did-finish-load', function h() {
            document.getElementById("webview").removeEventListener('did-finish-load', h);
            setTimeout(r, 1000);
          });
        });
        return;
      }
      // 将 CDP 捕获的 JSON 数据存入采集结果
      var captured = result.captured || [];
      console.log('[batch] 独立窗口捕获 ' + captured.length + ' 个 JSON 响应');
      if (captured.length > 0) {
        S._capturedJsonData = S._capturedJsonData || [];
        for (var ci = 0; ci < captured.length; ci++) {
          S._capturedJsonData.push(captured[ci]);
        }
      }
    } catch(e) {
      console.log('[batch] 独立窗口异常，降级到 webview:', e.message);
      document.getElementById("webview").loadURL(url);
      await sleep(3000);
    }
  }

  /** 根据模式加载 URL（独立窗口优先，带 CDP API 拦截） */
  function loadTaskUrl(url) {
    if (S.batchIndependentWindows && window.api && window.api.collectionOpen) {
      return loadUrlInWindow(url);
    }
    // 默认：webview 加载
    return new Promise(function(resolve) {
      var loaded = false;
      var timeout = setTimeout(function() { if (!loaded) resolve(); }, 15000);
      function onLoad() {
        if (loaded) return;
        loaded = true;
        clearTimeout(timeout);
        document.getElementById("webview").removeEventListener('did-finish-load', onLoad);
        setTimeout(resolve, 600);
      }
      document.getElementById("webview").addEventListener('did-finish-load', onLoad);
      document.getElementById("webview").loadURL(url);
    });
  }

  async function batchLoadAll() {
    if (S.batchLoadRunning) { S.batchLoadCancel = true; return; }
    // 任务列表为空 → 从URL列表创建
    if (!S.batchTasks || S.batchTasks.length === 0) {
      var raw = (document.getElementById('batchUrlList').value || '').trim();
      if (!raw) { setStatus('URL列表为空'); return; }
      var lines = raw.split(/[\n]+/).map(function(s) { return s.trim(); }).filter(Boolean);
      S.batchTasks = []; S.batchAllResults = []; S.batchTaskIdCounter = 0;
      lines.forEach(function(line) {
        S.batchTasks.push({ id: ++S.batchTaskIdCounter, url: normalizeUrl(line), q: line, page: '-', status: 'pending', rowCount: 0 });
      });
      document.getElementById('batchTagsPanel').classList.remove('hidden');
      renderBatchTags();
    }
    S.batchLoadRunning = true;
    document.getElementById('btnGo').classList.add('hidden');
    S.batchLoadCancel = false;
    S.batchLoadPaused = false;
    // 显示浮窗
    document.getElementById("paginationFloat").classList.remove('hidden');
    updateBatchFloat();
    // 重试配置
    var MAX_RETRIES = S.batchTasks.length > 50 ? 1 : 3;  // 大批量减少重试
    var RETRY_DELAY = 2000;

    // 开启资源拦截（拦截图片/样式/字体，加速批量加载）
    try { Blocker.block(Blocker.STATICS); } catch(e) {}

    // 自动打码辅助函数
    async function tryAutoSolveCaptcha(t, reason) {
      t.status = 'verify'; t.error = reason;
      try {
        if (window.CaptchaSolver && window.CaptchaSolver.enabled) {
          setStatus('🤖 尝试自动打码...');
          var solveResult = await window.CaptchaSolver.autoSolve();
          if (solveResult.solved) {
            setStatus('✅ 自动打码成功 (' + solveResult.type + ')，继续采集');
            t.status = 'done';
            // 等待页面响应
            await sleep(3000);
            return true;
          }
          console.log('[batch] 自动打码失败:', solveResult.error);
        }
      } catch(e) {
        console.log('[batch] 自动打码异常:', e.message);
      }
      return false;
    }

    // 确保预览区可见
    document.getElementById("webviewOverlay").classList.add('hidden');
    document.getElementById("panelRight").style.width = '40%';
    document.getElementById("panelLeft").style.width = '';
    document.getElementById("btnFetch").classList.remove('hidden');
    document.getElementById("btnElementPicker").classList.remove('hidden');
    document.getElementById("btnBatchLoadAll").textContent = '停止';
    document.getElementById("btnBatchLoadAll").style.background = 'var(--red)';
    document.getElementById("btnBatchLoadAll").style.borderColor = 'var(--red)';
    document.getElementById("btnBatchLoadAll").style.color = '#fff';

    for (var i = 0; i < S.batchTasks.length; i++) {
      while (S.batchLoadPaused && !S.batchLoadCancel) { await sleep(200); }
      if (S.batchLoadCancel) break;
      var t = S.batchTasks[i];
      if (t.status === 'done') continue;
      if (t.status === 'verify' || t.status === 'blocked' || t.status === 'redirected') {
        S.batchLoadPaused = true;
        break;
      }
      S.batchCurrentTaskId = t.id;
      t.status = 'loading';
      renderBatchTags();
      updateBatchFloat();
      setStatus('[' + (i + 1) + '/' + S.batchTasks.length + '] ' + (t.q || t.url));
      try {
        if (t.page === 'clickNext') {
          // ── 翻页按钮点击模式 ──
          var nextSel = t.clickNextSelector;
          var clickInterval = t.clickNextInterval || 2000;
          var preWait = t.clickNextPreWait || 500;
          var maxPages = t.clickNextMaxPages || 10;
          var cnPage = 0;
          var allResults = [];
          var wasFirstLoad = false;

          while (cnPage < maxPages) {
            if (S.batchLoadCancel) break;
            cnPage++;
            if (cnPage === 1) {
              // 首页：正常 loadURL
              var loaded = false;
              var loadPromise = new Promise(function(resolve) {
                var timeout = setTimeout(function() { if (!loaded) resolve(); }, 15000);
                function onLoad() {
                  if (loaded) return;
                  loaded = true;
                  clearTimeout(timeout);
                  document.getElementById("webview").removeEventListener('did-finish-load', onLoad);
                  setTimeout(resolve, 600);
                }
                document.getElementById("webview").addEventListener('did-finish-load', onLoad);
              });
              if (!isValidUrl(t.url)) { t.status = 'error'; t.error = '无效 URL: ' + t.url; break; }
              document.getElementById("webview").loadURL(t.url);
              await loadPromise;
              wasFirstLoad = true;
            } else {
              // 后续页：多层翻页点击
              if (preWait > 0) await sleep(preWait);
              setStatus('clickNext 第 ' + cnPage + '/' + maxPages + ' 页 — 点击翻页中...');
              var cnResult = await smartClickNext(nextSel, clickInterval);
              if (!cnResult || !cnResult.clicked) {
                // 二次尝试（给网络延迟一次机会）
                setStatus('翻页未响应，等待后重试...');
                await sleep(clickInterval * 2);
                cnResult = await smartClickNext(nextSel, clickInterval);
                if (!cnResult || !cnResult.clicked) {
                  setStatus('翻页终止 — 按钮失效或已到末页');
                  break;
                }
              }
              setStatus('clickNext 第 ' + cnPage + '/' + maxPages + ' 页 [' + (cnResult.strategy||'?') + ']');
              await sleep(clickInterval);
            }

            // 动态网页等待策略
            var isDynamic = (document.querySelector('input[name="batchPageType"]:checked') || {}).value === 'dynamic';
            if (isDynamic) {
              var strategy = document.getElementById("batchDynamicStrategy").value;
              if (strategy === 'networkIdle') {
                var idleMs = parseInt($('#batchDynamicIdleMs').value) || 2000;
                var maxIdleSec = parseInt($('#batchDynamicMaxWait').value) || 30;
                await waitForNetworkIdle(idleMs, maxIdleSec * 1000);
              } else if (strategy === 'waitSelector') {
                var waitSel = ($('#batchDynamicSelector').value || '').trim();
                var selMaxSec = parseInt($('#batchDynamicSelectorMaxWait').value) || 30;
                if (waitSel) await waitForSelector(waitSel, selMaxSec * 1000);
              } else if (strategy !== 'clickNext') {
                var extraWait = parseInt($('#batchWaitMs').value) || 3000;
                await sleep(extraWait);
              }
            } else {
              await jiangeSleep();
            }

            // ── stealth 重注入：SPA 异步渲染完成后强制再包装原型 ──
            try {
              var reUrl = document.getElementById("webview").getURL();
              var reHost = (reUrl && reUrl !== 'about:blank')
                ? reUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
              if (reHost && window.Parser && window.Parser.stealth) {
                window.Parser.stealth.injectStealthConfig(reHost);
                var reScripts = window.Parser.stealth.getStealthScriptsForHost(reHost);
                reScripts = reScripts.filter(function(id) { return S.STEALTH_INJECT_IDS.indexOf(id) !== -1; });
                if (reScripts.length) window.Parser.stealth.injectStealthPrototypes(reScripts);
              }
            } catch(e) {}

            // 抓取当前页 HTML
            S.currentHtml = await document.getElementById("webview").executeJavaScript('document.documentElement.outerHTML');
            if (!S.currentHtml) continue;

            // 获取当前页面真实 URL（翻页后 URL 可能变化）
            var cnCurrentUrl = await document.getElementById("webview").executeJavaScript('window.location.href');
            cnCurrentUrl = cnCurrentUrl || t.url;

            // 解析
            var respAll = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/parse/all', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ html: S.currentHtml }),
            });
            if (!respAll.ok) throw new Error('解析失败: ' + respAll.status);
            var pdata = await respAll.json();
            t.parseData = pdata;

            // 提取
            var _sel = t.selector || t.extractSelector || '';
            var _selType = t.selectorType || 'css';
            var pageResults;
            if (t.extractMode === 'chain') {
              pageResults = await extractByChain(t.chainSchema);
              if (pageResults.length === 0) pageResults = [{ '提示': '链路未匹配到数据' }];
            } else if (t.extractMode === 'rules') {
              pageResults = await extractByRules();
              if (pageResults.length === 0) {
                pageResults = [{ '页面标题': (S.currentHtml.match(/<title>(.*?)<\/title>/i) || [])[1] || '', '字符数': S.currentHtml.length, '脚本数': (pdata.scripts || []).length }];
              }
            } else if (_sel) {
              var extractPath = _selType === 'xpath' ? '/api/extract/xpath' : '/api/extract/css';
              var extractLabel = _selType === 'xpath' ? 'XPath' : 'CSS';
              var respExt = await fetch('http://127.0.0.1:' + S.pythonPort + extractPath, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html: S.currentHtml, query: _sel, child_delim: S.globalChildDelim }),
              });
              if (!respExt.ok) throw new Error(extractLabel + '提取失败: ' + respExt.status);
              var cdata = await respExt.json();
              pageResults = cdata.results || [];
            } else {
              pageResults = [{ '页面标题': (S.currentHtml.match(/<title>(.*?)<\/title>/i) || [])[1] || '', '字符数': S.currentHtml.length, '脚本数': (pdata.scripts || []).length }];
            }
            // 标签结果带上页码
            var tagged = pageResults.map(function(r) {
              r._batchQ = t.q;
              r._batchPage = cnPage;
              r._batchUrl = cnCurrentUrl;
              return r;
            });
            allResults = allResults.concat(tagged);
            S.batchAllResults = S.batchAllResults.concat(tagged);
            S.queryResults = (S.queryResults || []).concat(tagged);
            t.results = allResults;
            t.rowCount = allResults.length;
            // 为当前页追加独立标签（使用当前真实 URL）
            S.batchTasks.push({
              id: ++S.batchTaskIdCounter, url: cnCurrentUrl, q: t.q, page: cnPage,
              selector: t.selector, status: 'done', rowCount: pageResults.length, error: null,
              results: pageResults, parseData: pdata
            });
            renderQueryTable(S.queryResults);
            renderBatchTags();
          }
          if (!S.batchLoadCancel && t.status === 'loading') { t.status = 'done'; updateBatchFloat(); }
        } else if (t.page === 'manual') {
          // ── 手动翻页模式：用户手动点翻页，系统检测 URL 变化自动抓取 ──
          var mnMaxPages = t.clickNextMaxPages || 99;
          var mnPage = 0;
          var mnAllResults = [];
          var mnLastUrl = '';

          // 首页：正常加载
          var mnLoaded = false;
          var mnLoadPromise = new Promise(function(resolve) {
            var timeout = setTimeout(function() { if (!mnLoaded) resolve(); }, 15000);
            function onLoad() {
              if (mnLoaded) return;
              mnLoaded = true;
              clearTimeout(timeout);
              document.getElementById("webview").removeEventListener('did-finish-load', onLoad);
              setTimeout(resolve, 600);
            }
            document.getElementById("webview").addEventListener('did-finish-load', onLoad);
          });
          if (!isValidUrl(t.url)) { t.status = 'error'; t.error = '无效 URL: ' + t.url; break; }
          document.getElementById("webview").loadURL(t.url);
          await mnLoadPromise;
          await jiangeSleep();

          while (mnPage < mnMaxPages) {
            if (S.batchLoadCancel) break;
            mnPage++;

            // 获取当前页面真实 URL（手动翻页后 URL 变化，记录下来供后续标签点击回显）
            var mnCurrentUrl = await document.getElementById("webview").executeJavaScript('window.location.href');
            mnCurrentUrl = mnCurrentUrl || t.url;

            // 抓取当前页
            S.currentHtml = await document.getElementById("webview").executeJavaScript('document.documentElement.outerHTML');
            if (S.currentHtml) {
              var mnResp = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/parse/all', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html: S.currentHtml }),
              });
              if (!mnResp.ok) throw new Error('解析失败: ' + mnResp.status);
              var mnPdata = await mnResp.json();
              t.parseData = mnPdata;

              var mnPageResults;
              if (t.extractMode === 'chain') {
                mnPageResults = await extractByChain(t.chainSchema);
                if (mnPageResults.length === 0) mnPageResults = [{ '提示': '链路未匹配到数据' }];
              } else if (t.extractMode === 'rules') {
                mnPageResults = await extractByRules();
                if (mnPageResults.length === 0) {
                  mnPageResults = [{ '页面标题': (S.currentHtml.match(/<title>(.*?)<\/title>/i) || [])[1] || '', '字符数': S.currentHtml.length, '脚本数': (mnPdata.scripts || []).length }];
                }
              } else if (t.selector) {
                var mnCss = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/extract/css', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ html: S.currentHtml, query: t.selector, child_delim: S.globalChildDelim }),
                });
                if (!mnCss.ok) throw new Error('CSS提取失败: ' + mnCss.status);
                var mnCdata = await mnCss.json();
                mnPageResults = mnCdata.results || [];
              } else {
                mnPageResults = [{ '页面标题': (S.currentHtml.match(/<title>(.*?)<\/title>/i) || [])[1] || '', '字符数': S.currentHtml.length, '脚本数': (mnPdata.scripts || []).length }];
              }
              var mnTagged = mnPageResults.map(function(r) {
                r._batchQ = t.q;
                r._batchPage = mnPage;
                r._batchUrl = mnCurrentUrl;
                return r;
              });
              mnAllResults = mnAllResults.concat(mnTagged);
              S.batchAllResults = S.batchAllResults.concat(mnTagged);
              S.queryResults = (S.queryResults || []).concat(mnTagged);
              t.results = mnAllResults;
              t.rowCount = mnAllResults.length;
              // 为当前页追加独立标签（使用当前真实 URL，非原始 URL）
              S.batchTasks.push({
                id: ++S.batchTaskIdCounter, url: mnCurrentUrl, q: t.q, page: mnPage,
                selector: t.selector, status: 'done', rowCount: mnPageResults.length, error: null,
                results: mnPageResults, parseData: mnPdata
              });
              renderQueryTable(S.queryResults);
              renderBatchTags();
              setStatus('第' + mnPage + '页已抓取，请在页面手动翻页...');
            }

            // 等待用户手动翻页（window.location.href 捕获 pushState 变化）
            mnLastUrl = await document.getElementById("webview").executeJavaScript('window.location.href');
            var mnNavDetected = false;
            while (!S.batchLoadCancel && !mnNavDetected) {
              await sleep(800);
              try {
                var curUrl = await document.getElementById("webview").executeJavaScript('window.location.href');
                if (curUrl && curUrl !== mnLastUrl && curUrl !== 'about:blank') {
                  mnNavDetected = true;
                  // 用"点击后等"配置作为翻页后等待时间
                  await sleep(t.clickNextInterval || 3000);
                }
              } catch(e) { /* ignore */ }
            }
            if (S.batchLoadCancel) break;
          }
          if (!S.batchLoadCancel && t.status === 'loading') { t.status = 'done'; updateBatchFloat(); }
        } else {
        // 等待页面真正加载完成
        var loaded = false;
        var loadPromise = new Promise(function(resolve) {
          var timeout = setTimeout(function() { if (!loaded) resolve(); }, 15000);
          function onLoad() {
            if (loaded) return;
            loaded = true;
            clearTimeout(timeout);
            document.getElementById("webview").removeEventListener('did-finish-load', onLoad);
            setTimeout(resolve, 600); // 等渲染刷新
          }
          document.getElementById("webview").addEventListener('did-finish-load', onLoad);
        });
        if (!isValidUrl(t.url)) { t.status = 'error'; t.error = '无效 URL: ' + t.url; break; }
        document.getElementById("webview").loadURL(t.url);
        await loadPromise;
        // 基础间隔
        await jiangeSleep();
        // 动态网页额外等待 JS 渲染
        var isDynamic = (document.querySelector('input[name="batchPageType"]:checked') || {}).value === 'dynamic';
        if (isDynamic) {
          var strategy = document.getElementById("batchDynamicStrategy").value;
          if (strategy === 'networkIdle') {
            var idleMs = parseInt($('#batchDynamicIdleMs').value) || 2000;
            var maxIdleSec = parseInt($('#batchDynamicMaxWait').value) || 30;
            await waitForNetworkIdle(idleMs, maxIdleSec * 1000);
          } else if (strategy === 'waitSelector') {
            var waitSel = ($('#batchDynamicSelector').value || '').trim();
            var selMaxSec = parseInt($('#batchDynamicSelectorMaxWait').value) || 30;
            if (waitSel) await waitForSelector(waitSel, selMaxSec * 1000);
          } else {
            var extraWait = parseInt($('#batchWaitMs').value) || 3000;
            await sleep(extraWait);
          }
        }
        // ── 验证 webview 是否真正跳到了目标 URL ──
        var realUrl = document.getElementById("webview").getURL();
        console.log('[batchLoadAll] 静态分页 验证URL q:', t.q, 'page:', t.page, '期望:', t.url, '实际:', realUrl);
        if (realUrl && realUrl !== 'about:blank' && realUrl !== t.url) {
          // 检查是否被重定向到验证/拦截页
          if (/punish|deny|challenge|captcha|verify|sec_verify|blocked|login\.(taobao|tmall|aliyun)|passport/i.test(realUrl)) {
            var urlDetect = buildDetection('captcha', 'URL 重定向到验证页: ' + realUrl);
            var urlSolved = await tryAutoSolveCaptcha(t, urlDetect.reason);
            if (urlSolved) continue;
            S.batchLoadPaused = true;
            document.getElementById("webviewOverlay").classList.add('hidden');
            renderBatchTags();
            startRecoveryMonitor(t, urlDetect);
            break;
          }
          // webview 没导航到目标 URL，可能是被重定向/缓存——再显式跳一次
          console.warn('[batchLoadAll] ⚠ URL不匹配，重新loadURL:', t.url);
          document.getElementById("webview").loadURL(t.url);
          await new Promise(function(resolve) {
            var retryTimeout = setTimeout(function() { resolve(); }, 10000);
            function onRetryLoad() {
              clearTimeout(retryTimeout);
              document.getElementById("webview").removeEventListener('did-finish-load', onRetryLoad);
              setTimeout(resolve, 600);
            }
            document.getElementById("webview").addEventListener('did-finish-load', onRetryLoad);
          });
          realUrl = document.getElementById("webview").getURL();
          console.log('[batchLoadAll] 重试后 URL:', realUrl);
        }
        // ── stealth 重注入：SPA 异步渲染完成后强制再包装原型 ──
        try {
          var reUrl2 = document.getElementById("webview").getURL();
          var reHost2 = (reUrl2 && reUrl2 !== 'about:blank')
            ? reUrl2.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
          if (reHost2 && window.Parser && window.Parser.stealth) {
            window.Parser.stealth.injectStealthConfig(reHost2);
            var reScripts2 = window.Parser.stealth.getStealthScriptsForHost(reHost2);
            reScripts2 = reScripts2.filter(function(id) { return S.STEALTH_INJECT_IDS.indexOf(id) !== -1; });
            if (reScripts2.length) window.Parser.stealth.injectStealthPrototypes(reScripts2);
          }
        } catch(e) {}
        S.currentHtml = await document.getElementById("webview").executeJavaScript('document.documentElement.outerHTML');
        // 保存为页面快照（供链路提取使用）
        try {
          await fetch('http://127.0.0.1:' + S.pythonPort + '/api/page-snapshots/save', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({url: t.url, html: S.currentHtml})
          });
        } catch(e) {}
        // ── 多级状态检测（所有模式都做，含URL列表模式）──
        var isUrlListMode = !t.extractMode && !t.selector && !t.chainSchema;
        if (S.currentHtml) {
          if (!/^local-html:\/\//i.test(t.url)) {
            // 步骤 1: 页面指纹检测 → 结构化诊断
            var detection = null;
            try {
              var fpRisk = await detectPageFingerprint();
              if (fpRisk && fpRisk.level === 'captcha') {
                detection = buildDetection('captcha', fpRisk.reason);
              }
            } catch(_) {}
            // 步骤 2: 关键词检测（兜底）
            if (!detection) {
              var risk = detectRiskSignals(S.currentHtml, 0, (cnCurrentUrl||t.url), t.url);
              if (risk.level !== 'safe') {
                detection = buildDetection(risk.level, risk.reason);
              }
            }
            // ── 处理检测结果：自动修复 → 浮动通知 → 恢复监控 ──
            if (detection && !t._skipDetection) {
              t.status = 'verify'; t.error = detection.reason;
              // 尝试自动打码
              if (detection.level === 'captcha') {
                var solved = await tryAutoSolveCaptcha(t, detection.reason);
                if (solved) { t.status = 'done'; continue; }
              }
              // 执行前置检查（如 Cookie 注入）
              var preChecked = false;
              if (detection.recovery && detection.recovery.preCheck) {
                preChecked = await detection.recovery.preCheck(t);
                if (preChecked) {
                  // preCheck 已触发重新加载，等待加载完毕
                  setStatus('正在注入 Cookie 并重新加载...');
                  await new Promise(function(resolve) {
                    var wv = document.getElementById('webview');
                    function onLoad() { wv.removeEventListener('did-finish-load', onLoad); setTimeout(resolve, 1500); }
                    wv.addEventListener('did-finish-load', onLoad);
                    setTimeout(function() { wv.removeEventListener('did-finish-load', onLoad); resolve(); }, 15000);
                  });
                  // 重新检查是否恢复
                  var reUrl = document.getElementById('webview').getURL();
                  if (reUrl && !/login|passport|captcha|verify/i.test(reUrl)) {
                    setStatus('OK，Cookie 注入成功，继续采集 [' + (t.q || t.url) + ']');
                    S.currentHtml = await document.getElementById('webview').executeJavaScript('document.documentElement.outerHTML');
                    detection = null;
                  } else {
                    setStatus('Cookie 注入无效，仍需手动登录 [' + (t.q || t.url) + ']');
                    detection.recovery.preCheck = null;
                  }
                }
              }
              // 仍未解决 → 暂停 + 浮动通知 + 恢复监控
              if (detection) {
                S.batchLoadPaused = true;
                t.status = detection.level === 'blocked' ? 'blocked' :
                           detection.level === 'redirected' ? 'redirected' : 'verify';
                document.getElementById("webviewOverlay").classList.add('hidden');
                renderBatchTags();
                startRecoveryMonitor(t, detection);
                break;
              }
            }
            // 可疑但非阻断 → 计数等待
            if (detection && detection.level === 'suspicious' && !t._skipDetection) {
              t._susCount = (t._susCount || 0) + 1;
              if (t._susCount >= 3) {
                S.batchLoadPaused = true;
                renderBatchTags();
                startRecoveryMonitor(t, buildDetection('suspicious', '连续访问受限 (3/3)'));
                break;
              }
              setStatus('⚠️ ' + detection.reason + ' (第' + t._susCount + '次)，递增等待...');
              await sleep(t._susCount * 5000);
            }
          }
          // URL列表模式：检测通过后直接标记完成，跳过提取
          if (isUrlListMode && !detection) {
            t.status = 'done';
            t.rowCount = 1;
            t.results = [{ '页面': t.url, '字符数': (S.currentHtml || '').length }];
            setStatus('[' + (i+1) + '/' + S.batchTasks.length + '] 快照已存');
            renderBatchTags();
            updateBatchFloat();
            continue;
          }
          // 非 URL 列表模式 + 无检测 → 走到提取代码；URL 列表模式已在上方处理
          if (isUrlListMode) {
            // 兜底：URL 列表模式到此说明 detection 为 null，标记完成
            t.status = 'done';
            t.rowCount = 1;
            t.results = [{ '页面': t.url, '字符数': (S.currentHtml || '').length }];
            setStatus('[' + (i+1) + '/' + S.batchTasks.length + '] 快照已存');
            renderBatchTags();
            updateBatchFloat();
            continue;
          }
          // 有提取器 → 继续走到下方提取代码
          // 始终全量解析，存树数据到任务
          var respAll = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/parse/all', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: S.currentHtml }),
          });
          if (!respAll.ok) throw new Error('解析失败: ' + respAll.status);
          var pdata = await respAll.json();
          t.parseData = pdata;

          var selector = t.selector || t.extractSelector || '';
          if (t.extractMode === 'chain') {
            t.results = await extractByChain(t.chainSchema);
            if (t.results.length === 0) t.results = [{ '提示': '链路未匹配到数据' }];
          } else if (t.extractMode === 'rules') {
            t.results = await extractByRules();
            if (t.results.length === 0) {
              t.results = [{ '页面标题': (S.currentHtml.match(/<title>(.*?)<\/title>/i) || [])[1] || '', '字符数': S.currentHtml.length, '脚本数': (pdata.scripts || []).length }];
            }
          } else if (selector) {
            // 选择器模式 → 调后端 CSS 提取
            var respCss = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/extract/css', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ html: S.currentHtml, query: selector, child_delim: S.globalChildDelim }),
            });
            if (!respCss.ok) throw new Error('CSS提取失败: ' + respCss.status);
            var cdata = await respCss.json();
            t.results = cdata.results || [];
          } else {
            t.results = [{ '页面标题': (S.currentHtml.match(/<title>(.*?)<\/title>/i) || [])[1] || '', '字符数': S.currentHtml.length, '脚本数': (pdata.scripts || []).length }];
          }
          t.rowCount = t.results.length;
          t.status = 'done';
          t._skipDetection = false;  // 清除标记，下次运行时正常检测
          setStatus('[' + (i + 1) + '/' + S.batchTasks.length + '] 完成 → ' + t.rowCount + '条结果');
          updateBatchFloat();
          var tagged = t.results.map(function(r) {
            r._batchQ = t.q;
            r._batchPage = t.page;
            r._batchUrl = t.url;
            return r;
          });
          S.batchAllResults = S.batchAllResults.concat(tagged);
          S.queryResults = (S.queryResults || []).concat(tagged);
          renderQueryTable(S.queryResults);
        }
        } // end else (non-clickNext)
      } catch (e) {
        // 重试逻辑：区分错误类型，仅网络/超时可重试
        var errMsg = e.message || String(e);
        var isNetErr = /fetch|network|timeout|ECONN|ENOTFOUND|ERR_/i.test(errMsg);
        var isParseErr = /解析|CSS提取|XPath|提取失败/i.test(errMsg);
        if (!t._retries) t._retries = 0;
        t._retries++;
        if (t._retries <= MAX_RETRIES && !S.batchLoadCancel && (isNetErr || isParseErr)) {
          t.status = 'retrying';
          t.error = '重试 ' + t._retries + '/' + MAX_RETRIES + ' [' + (isNetErr?'网络':'解析') + ']: ' + errMsg;
          renderBatchTags();
          await sleep(RETRY_DELAY * Math.min(t._retries, 3));
          t.status = 'loading';
          i--; // 回退，重新执行当前任务
          continue;
        }
        t.status = 'error';
        t.error = errMsg;
        updateBatchFloat();
      }
      renderBatchTags();
      if (t.status === 'done' && i === S.batchTasks.length - 1) {
        // 最后一个任务完成后，树切换到对应页面
        if (t.parseData) { S.parseResult = t.parseData; buildTree(S.parseResult); }
        S.queryResults = S.batchAllResults;
        renderQueryTable(S.batchAllResults);
        document.getElementById("contentTitle").textContent = '批量结果 (' + S.batchAllResults.length + '项)';
      }
    }
    S.batchCurrentTaskId = null;
    // 停止时把进行中的任务恢复
    if (S.batchLoadCancel) {
      S.batchTasks.forEach(function(t) { if (t.status === 'loading') t.status = 'pending'; });
      setStatus('批量抓取已停止');
    }
    S.batchLoadRunning = false;
    document.getElementById('btnGo').classList.remove('hidden');
    document.getElementById("btnBatchLoadAll").textContent = '全部加载';
    document.getElementById("btnBatchLoadAll").style.background = '';
    document.getElementById("btnBatchLoadAll").style.borderColor = '';
    document.getElementById("btnBatchLoadAll").style.color = '';
    // 关闭资源拦截
    try { Blocker.clear(); } catch(e) {}
    renderBatchTags();
    updateBatchFloat();
    if (S.batchLoadCancel) {
      setTimeout(function() { document.getElementById("paginationFloat").classList.add('hidden'); }, 2000);
    } else if (!S.batchLoadPaused) {
      setStatus('批量抓取完成');
      document.getElementById("pfPage").textContent = S.batchTasks.filter(function(t){return t.status==='done';}).length + '/' + S.batchTasks.length + ' ✓';
      setTimeout(function() { document.getElementById("paginationFloat").classList.add('hidden'); }, 3000);
    }
  }

  function batchContinue() {
    // 恢复暂停的批量加载
    S.batchLoadPaused = false;
    var pfPause = document.getElementById("pfPause");
    if (pfPause) {
      pfPause.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>';
      pfPause.title = '暂停';
    }
    document.getElementById("paginationFloat").classList.remove('hidden');
    updateBatchFloat();
    // 把 verify/blocked/redirected 重新置为 pending，标记跳过检测（用户已手动验证）
    S.batchTasks.forEach(function(t) {
      if (t.status === 'verify' || t.status === 'blocked' || t.status === 'redirected') {
        t.status = 'pending';
        t._skipDetection = true;  // 用户已手动验证，跳过本轮检测
      }
    });
    renderBatchTags();
    batchLoadAll();
  }

  function batchClearDone() {
    S.batchTasks = S.batchTasks.filter(function(t) { return t.status !== 'done'; });
    if (S.batchTasks.length === 0) {
      document.getElementById("batchTagsPanel").classList.add('hidden');
      document.getElementById("btnBatchLoadAll").classList.add('hidden');
      S.batchAllResults = [];
    }
    renderBatchTags();
  }

  // ── 笛卡尔积标签面板拖拽 & 自适应 ──

  function bindBatchTagsResize() {
    var resizeStartY, resizeStartH, resizeMinH;

    // 最后一个可见行在 treePanel 中的 bottom 偏移
    function getTreeLastBottom() {
      var treePanel = document.getElementById("batchTagsPanel").parentElement;
      var panelTop = treePanel.getBoundingClientRect().top;
      var rows = document.getElementById("treeContent").querySelectorAll(".tree-node-row, .tree-group-header");
      var maxB = 0;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        // 跳过被折叠祖先包裹的行
        var p = r.parentElement;
        var hidden = false;
        while (p && p !== document.getElementById("treeContent")) {
          if (p.classList.contains("hidden") && (p.classList.contains("tree-children") || p.classList.contains("tree-group-body"))) { hidden = true; break; }
          p = p.parentElement;
        }
        if (hidden) continue;
        var rect = r.getBoundingClientRect();
        if (rect.height === 0) continue;
        var b = rect.bottom - panelTop;
        if (b > maxB) maxB = b;
      }
      return Math.max(maxB, 40);
    }

    // 自动贴合：折叠=面板放大，展开=面板缩小
    function autoFit() {
      if (document.getElementById("batchTagsPanel").classList.contains("hidden")) return;
      var treePanel = document.getElementById("batchTagsPanel").parentElement;
      var h = treePanel.clientHeight - getTreeLastBottom() - 6;
      if (h < 0) h = 0;
      document.getElementById("batchTagsPanel").style.height = h + "px";
    }

    // 拖拽
    document.getElementById("batchTagsResize").addEventListener("mousedown", function(e) {
      e.preventDefault();
      resizeStartY = e.clientY;
      resizeStartH = document.getElementById("batchTagsPanel").offsetHeight;
      resizeMinH = 0;
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeUp);
    });

    function onResizeMove(e) {
      var delta = resizeStartY - e.clientY;
      var newH = resizeStartH + delta;
      if (newH < resizeMinH) newH = resizeMinH;
      var maxH = document.getElementById("batchTagsPanel").parentElement.clientHeight - getTreeLastBottom() - 6;
      if (newH > maxH) newH = maxH;
      document.getElementById("batchTagsPanel").style.height = newH + "px";
    }

    function onResizeUp() {
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", onResizeUp);
    }

    // 树内容变化自动贴合（展开/折叠节点）
    var fitPending = false;
    function scheduleFit() {
      if (fitPending) return;
      fitPending = true;
      requestAnimationFrame(function() { fitPending = false; autoFit(); });
    }
    var observer = new MutationObserver(scheduleFit);
    observer.observe(document.getElementById("treeContent"), { attributes: true, subtree: true, attributeFilter: ["style", "class"], childList: true });

    window.fitBatchPanelToTree = autoFit;
  }

  function fitBatchPanelToTree() {
    if (window.fitBatchPanelToTree) window.fitBatchPanelToTree();
  }

  // ── 多层翻页点击：React/SPA 友好 ──
  // ── SPA 内容指纹：捕获页面内容快照，用于检测 URL 不变的翻页 ──
  var SPA_FP_JS = '(function(){' +
    '  var t=document.title||"";' +
    '  var m=document.querySelector("main,#app,#root,[role=main],.content,.main-content");' +
    '  var txt=m?m.innerText.substring(0,800):document.body.innerText.substring(0,800);' +
    '  var prev=document.querySelector("[aria-label*=\\u4E0A\\u4E00\\u9875],[aria-label*=prev i],[class*=prev] button,button[class*=prev]");' +
    '  var pd=prev?prev.disabled:-1;' +
    '  var curPg=document.querySelector("em,.current,.active,.page-item.active,.ant-pagination-item-active");' +
    '  var cp=curPg?curPg.textContent.trim():"";' +
    '  var items=document.querySelectorAll("[class*=item],[class*=product],[class*=goods],[class*=card],li[data-id]").length;' +
    '  return t.substring(0,60)+"|"+txt.substring(0,200)+"|"+pd+"|"+cp+"|"+items;' +
    '})();'

  function smartClickNext(selector, interval) {
    var wv = document.getElementById("webview");
    // 先抓取点击前的 URL + 内容指纹
    return wv.executeJavaScript('window.location.href').then(function(oldUrl) {
      return wv.executeJavaScript(SPA_FP_JS).then(function(preFp) {
        // 策略 1：完整指针事件序列（适配 React 合成事件）
        return wv.executeJavaScript(
          '(function(sel){' +
          '  var el=document.querySelector(sel);' +
          '  if(!el){return {s:0,e:"not-found"};}' +
          '  var r=el.getBoundingClientRect();' +
          '  if(r.width===0||r.height===0){return {s:0,e:"invisible"};}' +
          '  window.__parser.scrollIntoViewSmart(el);' +
          '  var x=r.left+r.width/2, y=r.top+r.height/2;' +
          '  var o={bubbles:true,cancelable:true,view:window,clientX:x,clientY:y};' +
          '  if(typeof PointerEvent!=="undefined"){' +
          '    el.dispatchEvent(new PointerEvent("pointerdown",o));' +
          '    el.dispatchEvent(new PointerEvent("pointerup",o));' +
          '  }' +
          '  el.dispatchEvent(new MouseEvent("mousedown",o));' +
          '  el.dispatchEvent(new MouseEvent("mouseup",o));' +
          '  el.dispatchEvent(new MouseEvent("click",o));' +
          '  return {s:1,strategy:"pointer-events",tag:el.tagName};' +
          '})(' + JSON.stringify(selector) + ')'
        ).then(function(r1) {
          if (!r1 || r1.s !== 1) return _clickFallback(selector, oldUrl, preFp);
          return sleep(interval).then(function() {
            return _checkPageChange(selector, oldUrl, preFp, 'pointer-events');
          });
        });
        function _clickFallback(selector, oldUrl, preFp) {
          // 策略 2：原生 click + 通用分页选择器扫描
          return wv.executeJavaScript(
            '(function(sel){' +
            '  // 2a: 原生 click（对非 React 站点有效）' +
            '  var el=document.querySelector(sel);' +
            '  if(el&&!el.disabled&&!el.classList.contains("disabled")){' +
            '    el.click(); return {s:2,strategy:"native-click"};' +
            '  }' +
            '  // 2b: 扫描通用分页选择器' +
            '  var fbs=[' +
            '   "[aria-label*=\\u4E0B\\u4E00\\u9875]","[aria-label*=next i]","[rel=next]",' +
            '   "a.next",".next",".pagination-next",".ant-pagination-next",".btn-next",' +
            '   "li.next a",".paginate_button.next","[class*=next i] a"' +
            '  ];' +
            '  for(var i=0;i<fbs.length;i++){' +
            '    var fb=document.querySelector(fbs[i]);' +
            '    if(fb&&!fb.disabled&&!fb.classList.contains("disabled")){' +
            '      fb.click(); return {s:2,strategy:"fallback:"+fbs[i]};' +
            '    }' +
            '  }' +
            '  // 2c: 检测无限滚动（无按钮的情况）' +
            '  var oldH=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);' +
            '  window.__parser.scrollBySmart(0, oldH, document.body, 3, 50);' +
            '  return {s:3,oldH:oldH};' +
            '})(' + JSON.stringify(selector) + ')'
          ).then(function(r2) {
            if (!r2) return {clicked:false, url:oldUrl};
            if (r2.s === 3) {
              // 无限滚动：等待内容加载
              return sleep(Math.max(interval, 2000)).then(function() {
                return wv.executeJavaScript('Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)').then(function(newH) {
                  if (newH > r2.oldH + 200) {
                    return {clicked:true, strategy:'infinite-scroll', url:oldUrl};
                  }
                  return {clicked:false, url:oldUrl};
                });
              });
            }
            // fallback 点击后：URL 或内容变化检测
            return sleep(interval).then(function() {
              return _checkPageChange(selector, oldUrl, preFp, r2.strategy||'fallback');
            });
          });
        }
        // ── 统一页面变化检测：URL 变了 OR 内容指纹变了 → 翻页成功 ──
        function _checkPageChange(sel, oldUrl, preFp, strategy) {
          return wv.executeJavaScript('window.location.href').then(function(newUrl) {
            if (newUrl !== oldUrl) return {clicked:true, strategy:strategy, url:newUrl};
            // URL 没变 — 检查 SPA 内容指纹
            return wv.executeJavaScript(SPA_FP_JS).then(function(postFp) {
              if (postFp !== preFp) {
                return {clicked:true, strategy:strategy+'-spa', url:newUrl, fpChanged:true};
              }
              return {clicked:false, url:newUrl};
            });
          });
        }
      });
    });
  }

  // ── 页面指纹检测（注入 JS 检查 DOM 结构，不依赖关键词）──
  async function detectPageFingerprint() {
    try {
      var wv = document.getElementById('webview');
      if (!wv) return null;
      var fp = await wv.executeJavaScript('(function(){' +
        'var result = {level:"safe", reason:""};' +
        // 1. 检查 iframe 指向已知验证平台
        'var iframes = document.querySelectorAll("iframe");' +
        'for (var i = 0; i < iframes.length; i++) {' +
          'var src = (iframes[i].src || "").toLowerCase();' +
          'if (/recaptcha|hcaptcha|challenge-platform|arkoselabs|funcaptcha|geetest|verify\\.aliyuncs/.test(src)) {' +
            'result.level = "captcha"; result.reason = "验证iframe: " + src.substring(0, 80);' +
            'return JSON.stringify(result);' +
          '}' +
        '}' +
        // 2. Cloudflare Challenge 特征
        'if (document.getElementById("challenge-stage") || document.getElementById("cf-challenge") ||' +
            'document.querySelector("div.cf-browser-verify, div.cf-challenge, div[class*=\\"cf-turnstile\\"]")) {' +
          'result.level = "captcha"; result.reason = "Cloudflare Challenge";' +
          'return JSON.stringify(result);' +
        '}' +
        // 3. 页面标题检查
        'var t = (document.title || "").toLowerCase();' +
        'if (/just a moment|安全检查|验证|verify you are|attention required|security check|blocked/i.test(t)) {' +
          'result.level = "captcha"; result.reason = "标题: " + document.title.substring(0, 60);' +
          'return JSON.stringify(result);' +
        '}' +
        // 4. 极限短 body（JS Challenge 特征：只有 script + noscript）
        'var body = document.body;' +
        'if (body) {' +
          'var html = body.innerHTML.trim();' +
          'var textLen = (body.innerText || "").trim().length;' +
          'if (html.length < 3000 && textLen < 100) {' +
            'var hasScript = body.querySelectorAll("script").length > 0;' +
            'var hasNoscript = body.querySelectorAll("noscript").length > 0;' +
            'var hasMeta = body.querySelectorAll("meta[http-equiv=\\"refresh\\"]").length > 0;' +
            'if (hasScript && (hasNoscript || hasMeta)) {' +
              'result.level = "captcha"; result.reason = "JS Challenge (body<3KB, no text)";' +
              'return JSON.stringify(result);' +
            '}' +
          '}' +
        '}' +
        // 5. 通用验证容器选择器（辅助判断，不单独触发——需配合短页面）
        'var captchaEls = document.querySelectorAll("[class*=\\"captcha\\"], [id*=\\"captcha\\"], ' +
          '[class*=\\"verify\\"], [id*=\\"verify\\"], [class*=\\"antibot\\"], #secverify");' +
        'if (captchaEls.length >= 2) {' +
          'result.level = "captcha"; result.reason = "验证容器: " + captchaEls.length + "个";' +
          'return JSON.stringify(result);' +
        '}' +
        // 6. body 文本关键词检测（兜底 — 检查当前页面文本，不依赖旧 outerHTML）
        'var bodyText = (document.body ? document.body.innerText || "" : "").toLowerCase();' +
        'var captchaKw = ["验证码","captcha","slider","滑块","verify","人机验证","点击完成验证",' +
          '"请完成安全验证","请稍后重试","访问太过频繁","sec_verify","_af_",' +
          '"geetest","ali_verify","nc_login","umidToken","x5sec",' +
          '"__pwv","验证滑动","请按住滑块","安全检测","环境异常","帐号存在异常"];' +
        'for (var k = 0; k < captchaKw.length; k++) {' +
          'if (bodyText.indexOf(captchaKw[k]) !== -1) {' +
            'result.level = "captcha"; result.reason = "页面文本: " + captchaKw[k];' +
            'return JSON.stringify(result);' +
          '}' +
        '}' +
        'return JSON.stringify(result);' +
      '})()');
      var parsed = JSON.parse(fp || '{}');
      if (parsed.level && parsed.level !== 'safe') return parsed;
      return null;
    } catch(e) { return null; }
  }

  // ── 扩展状态检测（替换原 detectCaptcha）──
  function detectRiskSignals(html, statusCode, url, taskUrl) {
    var lower = (html || '').toLowerCase();
    var len = (html || '').length;
    // HTTP 层
    if (statusCode === 403) return {level:'blocked', reason:'HTTP 403 Forbidden', action:'skip'};
    if (statusCode === 429) return {level:'blocked', reason:'HTTP 429 限流', action:'pause_and_retry'};
    if (statusCode === 503) return {level:'blocked', reason:'HTTP 503', action:'pause_and_retry'};
    if (statusCode>=400 && statusCode<500) return {level:'blocked', reason:'HTTP '+statusCode, action:'skip'};
    if (len>0 && len<200) return {level:'suspicious', reason:'内容过短('+len+'字符)', action:'retry'};
    // 剥离 <script> / <style> / <noscript> / 注释 / HTML标签，只留文本
    var cleanLower = lower.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ');  // 移除所有 HTML 标签
    // 验证码关键词
    var captchaKw=['验证码','captcha','slider','滑块','verify','人机验证','点击完成验证',
      '请完成安全验证','请稍后重试','访问太过频繁','sec_verify','_af_',
      'geetest','ali_verify','nc_login','umidToken','x5sec',
      '__pwv','验证滑动','请按住滑块','安全检测','环境异常','帐号存在异常'];
    for (var i=0;i<captchaKw.length;i++) {
      if (cleanLower.indexOf(captchaKw[i])!==-1) return {level:'captcha', reason:'检测到验证:'+captchaKw[i], action:'pause'};
    }
    // 跳转登录
    var loginKw=['login','登录','signin','请先登录','account/login','passport'];
    var urlLow=(url||'').toLowerCase();
    var taskLow=(taskUrl||'').toLowerCase();
    for (var j=0;j<loginKw.length;j++) {
      if (urlLow.indexOf(loginKw[j])!==-1 && taskLow.indexOf(loginKw[j])===-1) {
        return {level:'redirected', reason:'重定向到登录:'+url, action:'pause'};
      }
    }
    // 访问限制标记
    if (lower.indexOf('_s_n_c')!==-1||lower.indexOf('uac-rsk')!==-1) {
      return {level:'suspicious', reason:'访问限制标记', action:'retry_with_delay'};
    }
    return {level:'safe', reason:'', action:'continue'};
  }

  // ═══════════════════════════════════════════════
  //  结构化检测 + 自动恢复监控 + 浮动通知
  // ═══════════════════════════════════════════════

  // 每个检测点的恢复策略定义
  var RECOVERY_STRATEGIES = {
    CF_CHALLENGE: {
      type: 'poll_dom',
      target: '#challenge-stage, #cf-challenge, .cf-browser-verify, [class*="cf-turnstile"]',
      check: 'absent',
      timeout: 15000,
      pollInterval: 1000,
      instruction: '等待 Cloudflare 安全检查自动通过（通常 5 秒）'
    },
    TAOBAO_LOGIN: {
      type: 'poll_url',
      check: 'url_back',
      timeout: 120000,
      pollInterval: 3000,
      instruction: '请扫码登录淘宝账号',
      preCheck: async function(t) {
        try {
          if (window.api && window.api.cookieLoad) {
            var r = await window.api.cookieLoad(t.url);
            if (r && r.count > 0) {
              console.log('[batch] Cookie预检: 已加载 ' + r.count + ' 条，重新加载页面');
              document.getElementById('webview').loadURL(t.url);
              return true;
            }
          }
        } catch(e) { console.log('[batch] Cookie预检异常:', e.message); }
        return false;
      }
    },
    SLIDER_CAPTCHA: {
      type: 'poll_dom',
      target: '.geetest_panel, .nc_wrapper, #nc_1_n1z, [id*="captcha"], [class*="captcha"]',
      check: 'absent',
      timeout: 60000,
      pollInterval: 2000,
      instruction: '请拖动滑块完成验证'
    },
    FREQUENT_LIMIT: {
      type: 'wait_fixed',
      waitMs: 30000,
      instruction: '访问太频繁，自动降速等待 30 秒后重试'
    },
    HTTP_BLOCKED: {
      type: 'manual',
      instruction: 'IP 可能被拉黑，建议切换代理/网络后点击继续'
    },
    GENERIC_VERIFY: {
      type: 'poll_dom',
      target: '[class*="verify"], [id*="verify"], [class*="antibot"]',
      check: 'absent',
      timeout: 60000,
      pollInterval: 2000,
      instruction: '页面触发了验证，请完成验证后自动继续'
    }
  };

  // 从检测结果生成结构化诊断：{code, reason, instruction, level, recovery}
  function buildDetection(category, reason) {
    var d = { level: category, reason: reason, instruction: '', recovery: null, code: '' };
    var rLower = (reason || '').toLowerCase();
    if (/cloudflare|cf-challenge|cf-browser|turnstile|just a moment/i.test(rLower)) {
      d.code = 'CF_CHALLENGE';
      d.instruction = RECOVERY_STRATEGIES.CF_CHALLENGE.instruction;
      d.recovery = Object.assign({}, RECOVERY_STRATEGIES.CF_CHALLENGE);
    } else if (/login\.(taobao|tmall|aliyun)|passport/i.test(rLower)) {
      d.code = 'TAOBAO_LOGIN';
      d.instruction = RECOVERY_STRATEGIES.TAOBAO_LOGIN.instruction;
      d.recovery = Object.assign({}, RECOVERY_STRATEGIES.TAOBAO_LOGIN);
    } else if (/滑块|slider|geetest|nc_login|验证滑动/i.test(rLower)) {
      d.code = 'SLIDER_CAPTCHA';
      d.instruction = RECOVERY_STRATEGIES.SLIDER_CAPTCHA.instruction;
      d.recovery = Object.assign({}, RECOVERY_STRATEGIES.SLIDER_CAPTCHA);
    } else if (/频繁|太过频繁|限流|429|访问限制标记/i.test(rLower)) {
      d.code = 'FREQUENT_LIMIT';
      d.instruction = RECOVERY_STRATEGIES.FREQUENT_LIMIT.instruction;
      d.recovery = Object.assign({}, RECOVERY_STRATEGIES.FREQUENT_LIMIT);
    } else if (/403|blocked|被拦截/i.test(rLower)) {
      d.code = 'HTTP_BLOCKED';
      d.level = 'blocked';
      d.instruction = RECOVERY_STRATEGIES.HTTP_BLOCKED.instruction;
      d.recovery = Object.assign({}, RECOVERY_STRATEGIES.HTTP_BLOCKED);
    } else {
      d.code = 'GENERIC_VERIFY';
      d.instruction = RECOVERY_STRATEGIES.GENERIC_VERIFY.instruction;
      d.recovery = Object.assign({}, RECOVERY_STRATEGIES.GENERIC_VERIFY);
    }
    return d;
  }

  // ── 恢复监控：轮询 webview 直到验证解除 ──
  var _recoveryTimer = null;
  var _recoveryTargetUrl = null;

  function startRecoveryMonitor(t, detection) {
    stopRecoveryMonitor();
    if (!detection.recovery || detection.recovery.type === 'manual') {
      showBatchNotify(detection);
      return;
    }
    var recovery = detection.recovery;
    _recoveryTargetUrl = t.url;
    showBatchNotify(detection);
    var startTime = Date.now();

    function poll() {
      if (Date.now() - startTime > recovery.timeout) {
        stopRecoveryMonitor();
        updateBatchNotify({ instruction: '验证超时 (已等待 ' + Math.round(recovery.timeout/1000) + 's)，请手动点击继续', timeout: true });
        return;
      }
      var wv = document.getElementById('webview');
      if (!wv) { _recoveryTimer = setTimeout(poll, recovery.pollInterval || 2000); return; }

      switch (recovery.type) {
        case 'poll_dom':
        case 'poll_url':
          // 统一用 API 验证：获取当前页面 HTML，POST 到 Python 后端分析
          try {
            wv.executeJavaScript('document.documentElement.outerHTML').then(async function(html) {
              if (!html || html.length < 100) return;  // 页面尚未加载
              var currentUrl = wv.getURL();
              var resp = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/verify/page', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                  html: html,
                  url: currentUrl || '',
                  task_url: _recoveryTargetUrl || t.url || '',
                  chain_schema: t.chainSchema || null
                })
              });
              var v = await resp.json();
              console.log('[batch] API 验证:', v.status, '置信度:', v.confidence,
                '卡片:', v.checks.product_cards.value,
                '标题:', v.checks.title.value,
                '关键词:', v.checks.captcha_keywords.hits,
                '登录:', v.checks.login_redirect.passed ? '否' : '是',
                'iframe:', v.checks.verify_iframes.hits);
              if (v.status === 'normal' && v.confidence >= 0.7) {
                handleRecovery(t);
              } else if (v.status === 'uncertain' && v.confidence >= 0.5) {
                // 大概率正常但不够确定，降低轮询间隔继续等
                recovery.pollInterval = Math.min((recovery.pollInterval || 2000) * 2, 8000);
                updateBatchNotify({
                  countdown: Math.ceil((recovery.timeout - (Date.now() - startTime)) / 1000),
                  instruction: 'API 验证: ' + v.reason + ' (置信度 ' + Math.round(v.confidence*100) + '%)'
                });
              } else {
                updateBatchNotify({
                  countdown: Math.ceil((recovery.timeout - (Date.now() - startTime)) / 1000),
                  instruction: 'API 验证: ' + v.reason
                });
              }
            }).catch(function(e) {
              console.log('[batch] API 验证异常:', e.message);
            });
          } catch(e) {}
          break;

        case 'wait_fixed':
          if (Date.now() - startTime >= recovery.waitMs) {
            handleRecovery(t);
            return;
          }
          updateBatchNotify({ countdown: Math.ceil((recovery.waitMs - (Date.now() - startTime)) / 1000) });
          break;
      }
      _recoveryTimer = setTimeout(poll, recovery.pollInterval || 2000);
    }
    _recoveryTimer = setTimeout(poll, 1000);
  }

  function handleRecovery(t) {
    stopRecoveryMonitor();
    hideBatchNotify();
    setStatus('✓ 验证通过，自动继续采集 [' + (t.q || t.url) + ']');
    t.status = 'pending';
    t._susCount = 0;
    delete t._susCount;
    S.batchLoadPaused = false;
    document.getElementById('paginationFloat').classList.remove('hidden');
    updateBatchFloat();
    renderBatchTags();
    batchLoadAll();
  }

  function stopRecoveryMonitor() {
    if (_recoveryTimer) { clearTimeout(_recoveryTimer); _recoveryTimer = null; }
    _recoveryTargetUrl = null;
  }

  // ── 浮动通知条（不阻塞 webview，底部居中）──
  function showBatchNotify(detection) {
    var banner = document.getElementById('batchNotifyBanner');
    var level = detection.level || 'captcha';
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'batchNotifyBanner';
      banner.className = 'batch-notify-banner';
      banner.style.cssText = 'display:none';
      banner.innerHTML = '<span class="bn-icon"></span><span class="bn-text"></span>' +
        '<span class="bn-countdown"></span>' +
        '<button class="bn-continue hidden">继续</button>';
      document.body.appendChild(banner);
      banner.querySelector('.bn-continue').addEventListener('click', function() {
        hideBatchNotify();
        stopRecoveryMonitor();
        S.batchLoadPaused = false;
        document.getElementById('paginationFloat').classList.remove('hidden');
        updateBatchFloat();
        setStatus('▶ 手动继续批量采集');
        batchLoadAll();
      });
    }
    // 颜色
    var bg = level === 'blocked' ? 'var(--red)' :
             level === 'redirected' ? 'var(--orange)' : 'var(--accent)';
    banner.style.background = bg;
    banner.style.display = 'flex';
    banner.querySelector('.bn-icon').textContent =
      level === 'blocked' ? '🚫' : level === 'redirected' ? '🔐' : '⚠️';
    banner.querySelector('.bn-text').textContent =
      (detection.reason || '') + '  →  ' + (detection.instruction || '');
    banner.querySelector('.bn-countdown').textContent = '';
    banner.querySelector('.bn-continue').classList.add('hidden');
  }

  function updateBatchNotify(info) {
    var banner = document.getElementById('batchNotifyBanner');
    if (!banner || banner.style.display === 'none') return;
    if (info.instruction) banner.querySelector('.bn-text').textContent = info.instruction;
    if (info.countdown !== undefined && info.countdown > 0)
      banner.querySelector('.bn-countdown').textContent = info.countdown + 's';
    if (info.timeout) banner.querySelector('.bn-continue').classList.remove('hidden');
  }

  function hideBatchNotify() {
    var banner = document.getElementById('batchNotifyBanner');
    if (banner) { banner.style.display = 'none'; }
  }


  // 向后兼容：原 detectCaptcha 返回 boolean
  function detectCaptcha(html) {
    var r = detectRiskSignals(html, 0, '', '');
    return r.level !== 'safe';
  }

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  // URL 规范化：自动补齐 https:// 协议头
  function normalizeUrl(u) {
    if (!u || typeof u !== 'string') return u;
    u = u.trim();
    if (!u) return u;
    if (/^https?:\/\//i.test(u) || u.startsWith('local-html://')) return u;
    // 协议相对URL：//example.com/path → https://example.com/path
    if (u.startsWith('//')) return 'https:' + u;
    return 'https://' + u;
  }

  // 校验 URL 是否合法，防止非 URL 文本（如状态消息）被误传入 loadURL
  function isValidUrl(u) {
    return u && typeof u === 'string'
      && (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('local-html://'));
  }

  function updateMergeExportBtn() {
    var existing = document.getElementById('btnMergeExport');
    if (S.batchAllResults.length > 0 && S.batchTasks.some(function(t) { return t.status === 'done'; })) {
      if (!existing) {
        var btn = document.createElement('button');
        btn.id = 'btnMergeExport';
        btn.className = 'btn btn-sm btn-merge-export';
        btn.textContent = '合并导出(' + S.batchAllResults.length + ')';
        btn.addEventListener('click', batchMergeExport);
        var ref = document.getElementById("btnSaveSource");
        if (ref && ref.parentNode) ref.parentNode.insertBefore(btn, ref);
      } else {
        existing.textContent = '合并导出(' + S.batchAllResults.length + ')';
      }
    } else if (existing) {
      existing.remove();
    }
  }

  async function batchMergeExport() {
    if (S.batchAllResults.length === 0) { setStatus('没有可导出的数据'); return; }
    try {
      var result = await window.api.showSaveDialog({
        title: '导出批量结果',
        defaultPath: 'batch_merge.xlsx',
        filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) return;
      var resp = await fetch('http://127.0.0.1:' + S.pythonPort + '/api/export/excel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: S.batchAllResults, source: 'batch_merge' }),
      });
      if (resp.ok) {
        var buf = await resp.arrayBuffer();
        // Convert ArrayBuffer to base64 for IPC
        var base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
        await window.api.saveFile(result.filePath, base64);
        setStatus('已导出 ' + S.batchAllResults.length + ' 条到: ' + result.filePath);
      } else {
        setStatus('导出失败: ' + resp.status);
      }
    } catch (e) {
      setStatus('导出失败: ' + e.message);
    }
  }

  // ikSoft 工具栏：加载下一个待处理任务
  function loadNextTask() {
    if (!S.batchTasks || S.batchTasks.length === 0) return;
    if (S.batchCurrentTaskId) {
      var cur = S.batchTasks.find(function(t) { return t.id === S.batchCurrentTaskId; });
      if (cur && cur.status !== 'done') { cur.status = 'done'; renderBatchTags(); }
    }
    var next = S.batchTasks.find(function(t) { return t.status === 'pending'; });
    if (next) {
      S.batchCurrentTaskId = next.id;
      next.status = 'loading';
      renderBatchTags();
      updateBatchFloat();
      document.getElementById('webview').loadURL(next.url);
      setStatus('→ ' + (next.q || next.url));
    } else {
      setStatus('没有更多待采集任务');
    }
  }

  // ikSoft 工具栏：取消批量加载
  function cancelBatchLoad() {
    S.batchLoadCancel = true;
    S.batchLoadRunning = false;
    var btn = document.getElementById('btnBatchLoadAll');
    if (btn) {
      btn.textContent = '全部加载';
      btn.style.background = 'var(--orange)';
      btn.style.borderColor = 'var(--orange)';
      btn.style.color = '#000';
    }
  }



  // Module API
  window.Parser.batch = {
    bindEvents: bindBatchEvents,
    openModal: openBatchModal,
    closeModal: closeBatchModal,
    confirmConfig: confirmBatchConfig,
    batchContinue: batchContinue,
    batchClearDone: batchClearDone,
    batchLoadAll: batchLoadAll,
    updatePreview: updateBatchPreview,
    fitPanel: fitBatchPanelToTree,
    renderTags: renderBatchTags,
    detectCaptcha: detectCaptcha,
    detectRiskSignals: detectRiskSignals,
    detectPageFingerprint: detectPageFingerprint,
    smartClickNext: smartClickNext,
    sleep: sleep,
    // ikSoft 工具栏接口
    loadNext: loadNextTask,
    cancelLoad: cancelBatchLoad,
    updateMergeExportBtn: updateMergeExportBtn,
  };
})();
