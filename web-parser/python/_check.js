
const API = 'http://127.0.0.1:19527/api/price-compare';
const STATIC = 'http://127.0.0.1:19527/static';
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
let _overlayDownTarget = null;
document.addEventListener('mousedown', e => { _overlayDownTarget = e.target; }, true);
// 辅助：只有 mousedown 在遮罩上才触发关闭（避免选中文字时误关弹窗）
const _didClickOverlay = (e, overlay) => e.target === overlay && _overlayDownTarget === overlay;

// ── 图片 URL 构建 ──
function buildImageUrl(p, imageIndex) {
  // 优先用专用 API 端点（带索引）
  if (p.id) {
    const idx = (imageIndex != null) ? imageIndex : (p.matched_image_index != null ? p.matched_image_index : 0);
    if (idx > 0) return `${API}/image/${p.id}/${idx}`;
    return `${API}/image/${p.id}`;
  }
  // 兜底：有 matched_image_index 时取对应的远程 URL
  if (p.matched_image_index != null && p.matched_image_index > 0 && p.image_urls && p.image_urls.length >= p.matched_image_index) {
    return p.image_urls[p.matched_image_index - 1];
  }
  return p.main_image_url || '';
}
function imageHtml(p, size) {
  size = size || 48;
  const src = buildImageUrl(p);
  const fallbackUrl = escAttr(p.main_image_url || '');
  const clickSrc = escAttr(src || p.main_image_url || '');

  // 完全无图片时显示占位符（不可点击预览）
  if (!src && !p.main_image_url) {
    return `<div class="img-placeholder" style="width:${size}px;height:${size}px">🖼️</div>`;
  }

  // 用容器包裹，点击事件绑定在容器上 —— 无论 img 是否加载成功都能预览
  const startIdx = (p.matched_image_index != null) ? p.matched_image_index : 0;
  return `<div style="width:${size}px;height:${size}px;cursor:pointer;display:inline-block;vertical-align:top"
      onclick="event.stopPropagation();openImageGallery(${p.id}, ${startIdx})"
      title="点击预览大图（多图可翻页）">
    <img src="${src}" loading="lazy"
      onerror="this.style.display='none';var fb=this.parentElement.querySelector('.img-fallback');if(fb)fb.style.display='flex'"
      style="width:${size}px;height:${size}px;object-fit:cover;border-radius:4px;background:var(--bg-tertiary)">
    <div class="img-placeholder img-fallback" style="width:${size}px;height:${size}px;display:none" title="本地图片加载失败，点此查看远程图片">🖼️</div>
  </div>`;
}

// ── 中英文表头映射 ──
const HEADER_CN = {
  title: '商品标题', platform: '平台', price: '价格', shop_name: '店铺',
  main_image_url: '主图', platform_url: '链接', original_price: '原价',
  stock_info: '库存/销量', shipping: '运费', local_image: '本地图',
  score: '相似度', id: 'ID', status: '状态', source: '来源',
  description: '描述', image_urls: '多图', category: '分类',
};
function cnHeader(key) { return HEADER_CN[key] || key; }
function escAttr(s) { return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;'); }

let uploadedFile = null;
let currentResults = [];

// ── 发送到网页解析器 query 系统 ──
async function sendToParser() {
  if (!currentResults.length) return;
  const sendBtn = $('#btnSendToParser');
  sendBtn.disabled = true;
  sendBtn.textContent = '发送中...';
  try {
    const res = await fetch('http://127.0.0.1:19527/api/query/inject-price-compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: currentResults })
    });
    const d = await res.json();
    if (d.ok) {
      toast(`已发送 ${d.count} 条商品到解析器 · 在解析器中点击「比价数据」加载`);
    } else {
      toast('发送失败');
    }
  } catch (e) {
    toast('发送失败: ' + e.message);
  }
  sendBtn.disabled = false;
  sendBtn.textContent = '📤 发送到解析器';
}
$('#btnSendToParser').addEventListener('click', sendToParser);

// ── 顶栏统计 ──
async function loadStats() {
  try {
    const r = await fetch(`${API}/stats`); const d = await r.json();
    if (!d.ok) return;
    $('#pillTotal .val').textContent = d.product_count?.total || 0;
    $('#pillVector .val').textContent = d.vector_count || 0;
    // 各平台明细
    const pc = d.product_count || {};
    let html = '';
    for (const [k,v] of Object.entries(pc)) {
      if (k === 'total') continue;
      html += `<div>${platformLabel(k)}: <strong>${v}</strong></div>`;
    }
    if (!html) html = '<div>暂无数据</div>';
    const sd = $('#statsDetail'); if (sd) sd.innerHTML = html;
  } catch(e) { console.error('stats:', e); }
}
function platformLabel(k) {
  const m = {taobao:'淘宝', tmall:'天猫', jd:'京东', pdd:'拼多多', '1688':'阿里巴巴'};
  if (!k || k === 'unknown') return '未知';
  return m[k] || k;
}

// ── 占位图 DOM 元素（供 onerror 替换用）──
// 已废弃：imageHtml 现在用容器包裹 + fallback div，不再需要此函数
// function placeholderEl(size) { ... }

// ── 裁剪状态 ──
let cropBlob = null; // 裁剪后的 blob

// ── 图片上传 ──
const zone = $('#uploadZone');
const fileInput = $('#fileInput');
zone.addEventListener('click', () => fileInput.click());
zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
zone.addEventListener('drop', (e) => {
  e.preventDefault(); zone.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('请选择图片文件'); return; }
  uploadedFile = file;
  cropBlob = null;
  // 先绑定 onload 再设 src，避免 blob URL 同步加载时事件已触发
  const url = URL.createObjectURL(file);
  $('#previewOrig').onload = () => { $('#btnCrop').classList.add('visible'); };
  $('#previewOrig').src = url;
  $('#preview').style.display = 'block';
  $('#uploadZone').style.display = 'none';
  $('#btnSearchImage').disabled = false;
  $('#searchStatus').textContent = `已选择: ${file.name}`;
  // 兜底：如果图片已缓存（complete），直接显示按钮
  if ($('#previewOrig').complete) $('#btnCrop').classList.add('visible');

  // 去背景预览（全图）—— 仅在开关打开时请求
  if ($('#chkSearchSkipRembg').checked) {
    await fetchProcessedPreview(file);
  } else {
    $('#previewProcCard').style.display = 'none';
    $('#previewProc').src = '';
  }
}

// 拉取去背景预览
async function fetchProcessedPreview(blob) {
  const procCard = $('#previewProcCard');
  procCard.style.display = '';
  procCard.classList.add('loading');
  $('#previewProc').src = '';
  try {
    const form = new FormData();
    form.append('file', blob, blob.name || 'image.png');
    const resp = await fetch('http://127.0.0.1:19527/api/bg-remove/preview', { method: 'POST', body: form });
    const data = await resp.json();
    if (data.ok) {
      $('#previewProc').src = data.processed;
    } else {
      console.error('bg-remove preview failed:', data.error);
    }
  } catch(e) {
    console.error('bg-remove preview error:', e);
  } finally {
    procCard.classList.remove('loading');
  }
}

// toggle 开关实时控制去背景图显隐
$('#chkSearchSkipRembg').addEventListener('change', () => {
  const on = $('#chkSearchSkipRembg').checked;
  $('#rembgLabelSearch').textContent = on ? '✂️ 背景抠图' : '🖼️ 原始图片';
  if (on) {
    // 打开：显示去背景卡片，如果已上传但还没去背景图则拉取
    if (uploadedFile && !$('#previewProc').getAttribute('src')) {
      fetchProcessedPreview(cropBlob || uploadedFile);
    } else {
      $('#previewProcCard').style.display = '';
    }
  } else {
    $('#previewProcCard').style.display = 'none';
  }
});

// 入库侧 toggle 文字切换
$('#chkSkipRembg').addEventListener('change', () => {
  $('#rembgLabelImport').textContent = $('#chkSkipRembg').checked ? '✂️ 背景抠图' : '🖼️ 原始图片';
});

// ── 裁剪弹窗 ──
const CM = {
  scale: 1, tx: 0, ty: 0,            // 变换状态
  selecting: false,                    // 是否在框选模式
  drawing: false,                      // 正在画框选
  sx: 0, sy: 0, ex: 0, ey: 0,        // 框选坐标（stage 空间）
  panning: false, lastX: 0, lastY: 0, // 拖动平移
};

function openCropModal() {
  bindCropModalEvents();
  const img = $('#previewOrig');
  if (!img.src) { toast('请先上传图片'); return; }
  $('#cropStageImg').src = img.src;
  CM.scale = 1; CM.tx = 0; CM.ty = 0;
  CM.selecting = false; CM.drawing = false;
  resetCropBox();
  applyTransform();
  // 初始适配：让图片填满 stage
  const stage = $('#cropStage');
  setTimeout(() => {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const fit = Math.min(sw / iw, sh / ih, 1);
    CM.scale = fit;
    CM.tx = (sw - iw * fit) / 2;
    CM.ty = (sh - ih * fit) / 2;
    applyTransform();
  }, 50);
  $('#cropModal').classList.add('active');
  updateSelectBtn();
}

function closeCropModal() {
  $('#cropModal').classList.remove('active');
  resetCropBox();
  CM.selecting = false; CM.drawing = false;
}

function applyTransform() {
  $('#cropStageInner').style.transform = `translate(${CM.tx}px,${CM.ty}px) scale(${CM.scale})`;
  $('#cropZoomLabel').textContent = Math.round(CM.scale * 100) + '%';
}

function updateSelectBtn() {
  const btn = $('#cropToggleSelect');
  btn.textContent = CM.selecting ? '✓ 框选中' : '框选';
  btn.classList.toggle('on', CM.selecting);
  const stage = $('#cropStage');
  stage.classList.toggle('selecting', CM.selecting);
}

function resetCropBox() {
  $('#cropStageBox').classList.remove('active');
  $('#cropModalConfirm').disabled = true;
  CM.sx = CM.sy = CM.ex = CM.ey = 0;
}

function updateStageBox() {
  const box = $('#cropStageBox');
  const l = Math.min(CM.sx, CM.ex), t = Math.min(CM.sy, CM.ey);
  const w = Math.abs(CM.ex - CM.sx), h = Math.abs(CM.ey - CM.sy);
  box.style.left = l + 'px';
  box.style.top = t + 'px';
  box.style.width = w + 'px';
  box.style.height = h + 'px';
}

// 按钮
$('#btnCrop').addEventListener('click', openCropModal);

// 侧栏预览图点击 → 画廊弹窗
$('#previewOrig').addEventListener('click', () => { if ($('#previewOrig').src) previewAddedImage(null, $('#previewOrig').src); });
$('#previewProc').addEventListener('click', () => { if ($('#previewProc').src) previewAddedImage(null, $('#previewProc').src); });

// 延迟绑定（crop modal 的 DOM 在 <script> 之后，需懒加载）
let _cropModalBound = false;
function bindCropModalEvents() {
  if (_cropModalBound) return;
  _cropModalBound = true;

  // 缩放（滚轮）
  $('#cropStage').addEventListener('wheel', (e) => {
    e.preventDefault();
    if (CM.drawing) return;
    const rect = $('#cropStage').getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    const newScale = Math.max(0.2, Math.min(10, CM.scale * factor));
    // 以光标为中心缩放
    CM.tx = cx - (cx - CM.tx) * newScale / CM.scale;
    CM.ty = cy - (cy - CM.ty) * newScale / CM.scale;
    CM.scale = newScale;
    applyTransform();
    // 缩放后更新框选（如果有的话）
    if ($('#cropStageBox').classList.contains('active')) updateStageBox();
  });

  // 拖动平移 / 框选
  $('#cropStage').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = $('#cropStage').getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (CM.selecting) {
      // 框选模式
      CM.drawing = true;
      CM.sx = mx; CM.sy = my;
      CM.ex = mx; CM.ey = my;
      $('#cropStageBox').classList.add('active');
      updateStageBox();
    } else {
      // 平移模式
      CM.panning = true;
      CM.lastX = e.clientX;
      CM.lastY = e.clientY;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (CM.panning) {
      CM.tx += e.clientX - CM.lastX;
      CM.ty += e.clientY - CM.lastY;
      CM.lastX = e.clientX;
      CM.lastY = e.clientY;
      applyTransform();
    }
    if (CM.drawing) {
      const rect = $('#cropStage').getBoundingClientRect();
      CM.ex = e.clientX - rect.left;
      CM.ey = e.clientY - rect.top;
      updateStageBox();
    }
  });

  window.addEventListener('mouseup', () => {
    if (CM.drawing) {
      CM.drawing = false;
      const w = Math.abs(CM.ex - CM.sx);
      const h = Math.abs(CM.ey - CM.sy);
      if (w < 10 || h < 10) {
        $('#cropStageBox').classList.remove('active');
      } else {
        $('#cropModalConfirm').disabled = false;
        updateStageBox();
      }
    }
    CM.panning = false;
  });

  $('#cropModalClose').addEventListener('click', closeCropModal);
  $('#cropModalCancel').addEventListener('click', closeCropModal);
  $('#cropToggleSelect').addEventListener('click', () => {
    CM.selecting = !CM.selecting;
    updateSelectBtn();
    if (!CM.selecting) resetCropBox();
  });

  $('#cropResetView').addEventListener('click', () => {
    const img = $('#cropStageImg');
    const sw = $('#cropStage').clientWidth, sh = $('#cropStage').clientHeight;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const fit = Math.min(sw / iw, sh / ih, 1);
    CM.scale = fit;
    CM.tx = (sw - iw * fit) / 2;
    CM.ty = (sh - ih * fit) / 2;
    applyTransform();
    resetCropBox();
  });

  $('#cropModalConfirm').addEventListener('click', async () => {
    const img = $('#cropStageImg');
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const sx = Math.round(Math.max(0, Math.min(CM.sx, CM.ex) - CM.tx) / CM.scale);
    const sy = Math.round(Math.max(0, Math.min(CM.sy, CM.ey) - CM.ty) / CM.scale);
    const sw = Math.round(Math.abs(CM.ex - CM.sx) / CM.scale);
    const sh = Math.round(Math.abs(CM.ey - CM.sy) / CM.scale);
    if (sw < 1 || sh < 1 || sx + sw > iw || sy + sh > ih) {
      toast('裁剪区域超出图片范围'); return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    canvas.toBlob(async (blob) => {
      if (!blob) { toast('裁剪失败'); return; }
      cropBlob = blob;
      closeCropModal();

      $('#previewOrig').src = URL.createObjectURL(blob);
      // 去背景预览 —— 仅在开关打开时请求
      if ($('#chkSearchSkipRembg').checked) {
        await fetchProcessedPreview(blob);
      } else {
        $('#previewProcCard').style.display = 'none';
        $('#previewProc').src = '';
      }
      $('#searchStatus').textContent = '裁剪完成 ✓';
    }, 'image/png');
  });
}

$('#removePreview').addEventListener('click', () => {
  uploadedFile = null;
  cropBlob = null;
  $('#btnCrop').classList.remove('visible');
  $('#previewOrig').src = '';
  $('#previewProc').src = '';
  $('#preview').style.display = 'none';
  $('#uploadZone').style.display = 'block';
  $('#btnSearchImage').disabled = true;
  $('#searchStatus').textContent = '';
});

// ── 搜索 ──
$('#btnSearchImage').addEventListener('click', searchByImage);
$('#btnSearchUrl').addEventListener('click', searchByUrl);
$('#urlInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchByUrl(); });
$('#btnSearchText').addEventListener('click', searchByText);
$('#textSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchByText(); });

async function searchByImage() {
  const fileToSend = cropBlob || uploadedFile;
  if (!fileToSend) return;
  setLoading(true);
  const fd = new FormData(); fd.append('file', fileToSend);
  const platform = $('#selPlatformFilter').value;
  let qs = platform ? `?top_k=20&platform=${encodeURIComponent(platform)}` : '?top_k=20';
  if (!$('#chkSearchSkipRembg').checked) qs += '&skip_rembg=1';
  try {
    const r = await fetch(`${API}/search-by-image${qs}`, { method:'POST', body:fd });
    const d = await r.json();
    if (!d.ok) {
      toast('搜索失败: ' + (d.error || '未知错误'));
      setLoading(false);
      $('#resultInfo').textContent = '以图搜图 · 搜索失败';
      return;
    }
    renderResults(d.results || [], '以图搜图');
  } catch(e) { toast('搜索失败: ' + e.message); setLoading(false); }
}

async function searchByUrl() {
  const url = $('#urlInput').value.trim();
  if (!url) return;
  setLoading(true);
  try {
    const r = await fetch(`${API}/search-by-url?url=${encodeURIComponent(url)}&top_k=20`);
    const d = await r.json();
    if (!d.ok) {
      toast('搜索失败: ' + (d.error || '未知错误'));
      setLoading(false);
      $('#resultInfo').textContent = '链接搜索 · 搜索失败';
      return;
    }
    renderResults(d.results || [], '链接搜索');
  } catch(e) { toast('搜索失败: ' + e.message); setLoading(false); }
}

async function searchByText() {
  const text = $('#textSearchInput').value.trim();
  if (!text) return;
  setLoading(true);
  const platform = $('#selPlatformFilter').value;
  const fd = new FormData();
  fd.append('text', text);
  fd.append('top_k', '20');
  fd.append('min_score', '0.35');
  if (platform) fd.append('platform', platform);
  try {
    const r = await fetch(`${API}/search-by-text`, { method:'POST', body:fd });
    const d = await r.json();
    if (!d.ok) {
      toast('搜索失败: ' + (d.error || '未知错误'));
      setLoading(false);
      $('#resultInfo').textContent = '文字搜索 · 搜索失败';
      return;
    }
    renderResults(d.results || [], '文字搜索');
  } catch(e) { toast('搜索失败: ' + e.message); setLoading(false); }
}

// ── 渲染结果 ──
// 保存原始搜索结果表头（预览可能会覆盖它）
const _resultTheadOrig = document.querySelector('#resultTable thead tr').innerHTML;
function renderResults(results, mode) {
  setLoading(false);
  const tbody = $('#resultBody');
  const info = $('#resultInfo');
  const empty = $('#emptyState');
  const sendBtn = $('#btnSendToParser');

  // 恢复原始表头（预览可能改了它）
  const theadTr = document.querySelector('#resultTable thead tr');
  if (theadTr.innerHTML !== _resultTheadOrig) theadTr.innerHTML = _resultTheadOrig;

  // 缓存原始结果供「发送到解析器」使用
  currentResults = results;
  sendBtn.style.display = results.length ? '' : 'none';

  if (!results.length) {
    tbody.innerHTML = '';
    info.textContent = `${mode} · 无匹配结果`;
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  info.innerHTML = `${mode} · 找到 <strong>${results.length}</strong> 个匹配商品`;

  // 找最低价（优先匹配 SKU 价格）
  let minPrice = Infinity;
  results.forEach(r => {
    const p = r.matched_sku_price != null ? r.matched_sku_price : (r.price || 0);
    if (p > 0 && p < minPrice) minPrice = p;
  });

  tbody.innerHTML = results.map(r => {
    const scorePct = r.score ? (r.score * 100).toFixed(0) : 0;
    const displayPrice = r.matched_sku_price != null ? r.matched_sku_price : (r.price || 0);
    const isBest = minPrice < Infinity && displayPrice === minPrice;
    const cls = isBest ? 'best-price' : '';

    // SKU 规格信息
    let skuText = '-';
    if (r.matched_sku_color || r.matched_sku_size) {
      skuText = [r.matched_sku_color, r.matched_sku_size].filter(Boolean).join(' / ') || '-';
    }

    return `<tr class="${cls}">
      <td class="product-img">${imageHtml(r, 72)}</td>
      <td class="title-cell" title="${esc(r.title)}">${esc(r.title)}</td>
      <td><span class="platform-badge platform-${r.platform}">${platformLabel(r.platform)}</span></td>
      <td class="sku-cell">${skuText}</td>
      <td class="price-cell"><span class="yuan">¥</span>${displayPrice.toFixed(2)}</td>
      <td>${esc(r.shop_name || '-')}</td>
      <td>
        <div class="score-bar">
          <div class="bar-bg"><div class="bar-fill" style="width:${scorePct}%"></div></div>
          <span class="val">${scorePct}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function setLoading(loading) {
  $('#spinner').style.display = loading ? 'inline-block' : 'none';
}

function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ── 启动 ──
loadStats();
setInterval(loadStats, 30000); // 每 30s 刷新统计
loadTemplates();
// 页面加载时初始化列拖拽手柄
initColumnResize(document.getElementById('resultTable'));


// ═══════════════════════════════════════════════
// 批量导入入库
// ═══════════════════════════════════════════════
let importFile = null;

// 打开/关闭批量入库弹窗
$('#btnOpenBatchImport').addEventListener('click', () => {
  $('#batchImportModal').classList.add('show');
});
$('#btnBatchImportClose').addEventListener('click', () => {
  $('#batchImportModal').classList.remove('show');
});
$('#batchImportModal').addEventListener('click', e => {
  if (_didClickOverlay(e, $('#batchImportModal'))) $('#batchImportModal').classList.remove('show');
});

async function loadTemplates() {
  try {
    const r = await fetch(API + '/templates');
    const d = await r.json();
    const sel = $('#selImportTemplate');
    sel.innerHTML = '<option value="">-- 自动识别 --</option>';
    (d.templates || []).forEach(t => {
      sel.innerHTML += `<option value="${t.name}">${t.label || t.name}</option>`;
    });
  } catch (e) { /* ignore */ }
}

$('#btnSelectImportFile').addEventListener('click', () => $('#importFileInput').click());

$('#importFileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  importFile = f;
  $('#importFileName').textContent = f.name + ' (' + (f.size / 1024).toFixed(0) + ' KB)';
  $('#btnClearImportFile').style.display = '';
  $('#btnPreviewImport').disabled = false;
  $('#btnStartImport').disabled = false;
  $('#importStatus').textContent = '';
});

$('#btnClearImportFile').addEventListener('click', () => {
  importFile = null;
  $('#importFileInput').value = '';
  $('#importFileName').textContent = '';
  $('#btnClearImportFile').style.display = 'none';
  $('#btnPreviewImport').disabled = true;
  $('#btnStartImport').disabled = true;
  $('#importStatus').textContent = '';
});

$('#btnPreviewImport').addEventListener('click', async () => {
  if (!importFile) return;
  const form = new FormData();
  form.append('file', importFile);
  form.append('template_name', $('#selImportTemplate').value);
  $('#importStatus').textContent = '预览中...';
  try {
    const r = await fetch(API + '/preview', { method: 'POST', body: form });
    const d = await r.json();
    if (!d.ok) { $('#importStatus').textContent = '预览失败'; return; }
    // 在结果区域显示预览表格
    $('#resultInfo').textContent = `共 ${d.total_rows} 行，预览前 ${d.preview.length} 行` + (d.template ? '（模板: ' + d.template.label + '）' : '（无模板）');
    const body = $('#resultBody');
    if (d.preview.length === 0) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary)">无数据</td></tr>';
      return;
    }
    const keys = Object.keys(d.preview[0]);
    // 字段格式化器：按字段名匹配数据管理面板样式
    const fieldFmt = {
      title:        (v) => `<td class="title-cell" title="${esc(v)}">${esc(v)}</td>`,
      price:        (v) => `<td class="price-cell"><span class="yuan">¥</span>${(Number(v)||0).toFixed(2)}</td>`,
      original_price: (v) => v ? `<td>¥${Number(v).toFixed(2)}</td>` : '<td>-</td>',
      platform:     (v) => v ? `<td><span class="platform-badge platform-${v}">${platformLabel(v)}</span></td>` : '<td>-</td>',
      main_image_url: (v) => v ? `<td class="product-img"><img src="${escAttr(v)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px" onerror="this.style.display='none'" loading="lazy"></td>` : '<td>-</td>',
      platform_url: (v) => v ? `<td><a href="${escAttr(v)}" target="_blank" style="color:var(--accent);font-size:11px">🔗 查看</a></td>` : '<td>-</td>',
      shop_name:    (v) => `<td>${esc(v || '-')}</td>`,
      description:  (v) => v ? `<td>${esc(v.length > 50 ? v.substring(0,50)+'…' : v)}</td>` : '<td>-</td>',
      stock_info:   (v) => `<td>${esc(v || '-')}</td>`,
      shipping:     (v) => `<td>${esc(v || '-')}</td>`,
    };
    const colWidth = {
      title: '', price: 'width:80px', original_price: 'width:80px',
      platform: 'width:80px', main_image_url: 'width:60px',
      platform_url: 'width:100px', shop_name: 'width:100px',
      description: 'width:140px', stock_info: 'width:70px', shipping: 'width:70px',
    };
    // 更新表头
    const thead = document.querySelector('#resultTable thead tr');
    thead.innerHTML = keys.map(k => {
      const w = colWidth[k] ? ` style="${colWidth[k]}"` : '';
      return `<th${w}>${cnHeader(k)}</th>`;
    }).join('');
    body.innerHTML = d.preview.map(row =>
      `<tr>${keys.map(k => {
        const fmt = fieldFmt[k];
        const v = row[k] || '';
        return fmt ? fmt(v) : `<td>${esc(String(v))}</td>`;
      }).join('')}</tr>`
    ).join('');
    // 隐藏发送按钮
    $('#btnSendToParser').style.display = 'none';
    $('#importStatus').textContent = '';
  } catch (e) {
    $('#importStatus').textContent = '预览失败: ' + e.message;
  }
});

$('#btnStartImport').addEventListener('click', async () => {
  if (!importFile) return;
  const form = new FormData();
  form.append('file', importFile);
  form.append('template_name', $('#selImportTemplate').value);
  if (!$('#chkSkipRembg').checked) form.append('skip_rembg', '1');
  $('#btnStartImport').disabled = true;
  $('#btnPreviewImport').disabled = true;
  $('#importProgress').style.display = 'block';
  $('#importProgressBar').style.width = '0%';
  $('#importProgressBar').classList.remove('done');
  $('#importProgressPct').textContent = '0%';
  $('#importCurrentItem').textContent = '';
  $('#importStepBadge').style.display = 'none';
  $('#importStatus').textContent = '正在提交...';
  try {
    // 1. 提交导入 → 获得 job_id
    const submitRes = await fetch(API + '/import', { method: 'POST', body: form });
    const submitData = await submitRes.json();
    if (!submitData.ok) {
      $('#importStatus').textContent = '❌ ' + (submitData.error || '提交失败');
      return;
    }
    const jobId = submitData.job_id;
    const total = submitData.total;

    // 辅助函数：秒数格式化
    const fmtETA = s => { s = Math.round(s); return s <= 0 ? '' : s < 60 ? `${s}秒` : s < 3600 ? `${Math.floor(s/60)}分${s%60}秒` : `${Math.floor(s/3600)}时${Math.round((s%3600)/60)}分`; };

    // 2. 轮询进度
    while (true) {
      await new Promise(r => setTimeout(r, 500));
      const statusRes = await fetch(API + '/import-status/' + jobId);
      const sd = await statusRes.json();
      if (!sd.ok) { $('#importStatus').textContent = '进度查询失败'; return; }

      const p = sd.progress;
      const done = p.done;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      $('#importProgressBar').style.width = pct + '%';
      $('#importProgressPct').textContent = pct + '% (' + done + '/' + total + ')';

      // 当前商品信息
      if (p.current) {
        let stepText = p.step || '';
        // 补充图片级进度
        if (p.img_cur != null && p.img_total != null) {
          stepText = p.step + ' · 图 ' + p.img_cur + '/' + p.img_total;
        }
        const icon = stepText.startsWith('下载') || stepText.startsWith('向量化') ? '🖼' : stepText === '完成' ? '✅' : stepText === '失败' ? '❌' : stepText.startsWith('检查字段') || stepText.startsWith('🔍') ? '🔍' : '⏳';
        $('#importCurrentItem').textContent = icon + ' ' + p.current;
        // 步骤徽章
        const badge = $('#importStepBadge');
        badge.style.display = 'inline-block';
        badge.textContent = stepText;
        badge.className = 'step-badge';
        if (stepText.startsWith('完成')) badge.className += ' ok';
        else if (stepText.startsWith('失败')) badge.className += ' fail';
        else if (stepText.startsWith('检查字段') || stepText.startsWith('🔍')) badge.className += ' skip';
      }

      // 状态文字：耗时 + 预估剩余
      const elapsed = p.elapsed_s || 0;
      const eta = p.eta_s || 0;
      let statusParts = [`已耗时 ${fmtETA(elapsed)}`];
      if (eta > 0) statusParts.push(`预计剩余 ${fmtETA(eta)}`);
      statusParts.push(`${pct}%`);
      $('#importStatus').textContent = statusParts.join(' · ');

      if (sd.status === 'done' || sd.status === 'error') {
        // 3. 完成 → 展示结果
        $('#importProgressBar').style.width = '100%';
        $('#importProgressPct').textContent = '100%';
        $('#importStepBadge').style.display = 'none';
        $('#importCurrentItem').textContent = '';
        // 添加 .done 类停止 shimmer 动画
        $('#importProgressBar').classList.add('done');

        const d = sd.result;
        if (d.ok) {
          let msg = '✅ 完成：' + d.success + ' 条成功，' + d.failed + ' 条失败（共 ' + d.total + ' 条）';
          if (d.failed > 0 && d.failure_detail) {
            const fd = d.failure_detail;
            const parts = [];
            if (fd.missing_title) parts.push(fd.missing_title + ' 条缺标题');
            if (fd.missing_image) parts.push(fd.missing_image + ' 条缺图片链接');
            if (fd.missing_both) parts.push(fd.missing_both + ' 条两者都缺');
            msg += '\n失败原因：' + parts.join('，') + '。';
            if (d.file_columns && d.file_columns.length) {
              msg += '\n文件列名：' + d.file_columns.join(', ');
            }
            msg += '\\n必填字段：title（标题）、main_image_url（图片链接）\\n非必填：description（详情介绍）、price（价格）等';
            if (d.sample) {
              msg += '\n示例：row=' + JSON.stringify(d.sample.row_sample)
                + ' title=' + (d.sample.title || '(空)')
                + ' image_url=' + (d.sample.main_image_url || '(空)');
            }
          }
          $('#importStatus').textContent = msg;
        } else {
          $('#importStatus').textContent = '❌ ' + (d.error || '入库失败');
        }
        if (d.errors && d.errors.length > 0) {
          $('#importStatus').textContent += ' | 错误: ' + d.errors.slice(0, 3).join('; ');
        }
        loadStats();
        break;
      }
    }
  } catch (e) {
    $('#importStatus').textContent = '入库失败: ' + e.message;
  } finally {
    // 在弹窗中保持进度条可见，方便查看结果
    $('#btnStartImport').disabled = false;
    $('#btnPreviewImport').disabled = false;
  }
});

// ── 模板管理弹窗 ──
// 字段定义：key, label, required
const TPL_FIELDS = [
  { key: 'title', label: '商品标题', required: true },
  { key: 'platform', label: '平台', required: false },
  { key: 'price', label: '价格', required: true },
  { key: 'original_price', label: '原价', required: false },
  { key: 'main_image_url', label: '图片链接', required: true },
  { key: 'platform_url', label: '商品链接', required: false },
  { key: 'shop_name', label: '店铺名称', required: false },
  { key: 'description', label: '详情介绍', required: false },
  { key: 'stock_info', label: '库存/销量', required: false },
  { key: 'shipping', label: '运费/物流', required: false },
];

function renderTplFields(mappings) {
  mappings = mappings || {};
  let html = '';
  TPL_FIELDS.forEach(f => {
    html += `<tr>
      <td><span class="field-key">${f.key}</span></td>
      <td><span class="field-label">${f.label}</span></td>
      <td><input type="text" class="tplFieldInput" data-key="${f.key}" value="${escAttr(mappings[f.key] || '')}"
        placeholder="${f.required ? '必需 — 填文件中的列名' : '选填'}"></td>
      <td><span class="badge-required ${f.required ? 'yes' : 'no'}">${f.required ? '必填' : '非必填'}</span></td>
    </tr>`;
  });
  $('#tplFieldBody').innerHTML = html;
}

function escAttr(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let editingTplName = null;

// 打开模板管理
$('#btnManageTemplates').addEventListener('click', () => {
  editingTplName = null;
  $('#tplName').value = '';
  $('#tplLabel').value = '';
  $('#tplPlatform').value = '';
  renderTplFields({});
  $('#templateModal').classList.add('show');
});

$('#btnTemplateCancel').addEventListener('click', () => $('#templateModal').classList.remove('show'));
$('#templateModal').addEventListener('click', e => { if (_didClickOverlay(e, $('#templateModal'))) $('#templateModal').classList.remove('show'); });

$('#btnTemplateSave').addEventListener('click', async () => {
  const name = $('#tplName').value.trim();
  const label = $('#tplLabel').value.trim();
  if (!name) { toast('请输入模板标识'); return; }
  if (!label) { toast('请输入显示名称'); return; }
  const platform = $('#tplPlatform').value;

  const mappings = {};
  let hasRequired = false;
  $$('.tplFieldInput').forEach(input => {
    const val = input.value.trim();
    const key = input.dataset.key;
    if (val) mappings[key] = val;
    // 检查必填字段是否已填写
    const fieldDef = TPL_FIELDS.find(f => f.key === key);
    if (fieldDef && fieldDef.required && val) hasRequired = true;
  });

  if (!hasRequired) { toast('至少填写一个必填字段的列名映射'); return; }

  try {
    const r = await fetch(API + '/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, label, platform, mappings }),
    });
    const d = await r.json();
    if (d.ok) {
      loadTemplates();
      toast('✅ 模板已保存');
      $('#templateModal').classList.remove('show');
    } else toast('保存失败: ' + (d.error || ''));
  } catch (e) { toast('保存失败: ' + e.message); }
});

// ═══════════════════════════════════════════════
// 📋 数据管理 — 增删改查
// ═══════════════════════════════════════════════

// Tab 切换
const tabSearch = $('#tabSearch');
const tabMgmt = $('#tabMgmt');
const searchPanel = $('#searchPanel');
const mgmtPanel = $('#mgmtPanel');

tabSearch.addEventListener('click', () => switchTab('search'));
tabMgmt.addEventListener('click', () => switchTab('mgmt'));

function switchTab(tab) {
  const isMgmt = tab === 'mgmt';
  tabSearch.classList.toggle('active', !isMgmt);
  tabMgmt.classList.toggle('active', isMgmt);
  searchPanel.style.display = isMgmt ? 'none' : '';
  mgmtPanel.classList.toggle('show', isMgmt);
  if (isMgmt) loadMgmtData();
}

// 分页状态
let mgmtPage = 1;
let mgmtTotalPages = 1;
const MGMT_PAGE_SIZE = 25;

// 搜索
$('#btnMgmtSearch').addEventListener('click', () => { mgmtPage = 1; loadMgmtData(); });
$('#mgmtSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { mgmtPage = 1; loadMgmtData(); } });
$('#mgmtPlatform').addEventListener('change', () => { mgmtPage = 1; loadMgmtData(); });

async function loadMgmtData() {
  const q = $('#mgmtSearch').value.trim();
  const platform = $('#mgmtPlatform').value;
  try {
    const r = await fetch(`${API}/products/search?q=${encodeURIComponent(q)}&platform=${platform}&limit=${MGMT_PAGE_SIZE}&page=${mgmtPage}`);
    const d = await r.json();
    if (!d.ok) { $('#mgmtBody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-secondary)">加载失败</td></tr>'; return; }
    mgmtTotalPages = d.total_pages;
    renderMgmtTable(d.products);
    renderPagination();
  } catch (e) {
    $('#mgmtBody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-secondary)">请求失败: ' + esc(e.message) + '</td></tr>';
  }
}

function renderMgmtTable(products) {
  if (!products.length) {
    $('#mgmtBody').innerHTML = '<tr><td colspan="7" style="text-align:center;padding:60px 20px"><div style="font-size:32px;margin-bottom:8px;opacity:0.4">📦</div><div style="color:var(--text-secondary)">暂无数据</div></td></tr>';
    $('#btnBatchDelete').style.display = 'none';
    return;
  }
  $('#mgmtBody').innerHTML = products.map(p => {
    return `<tr onclick="openEditModal(${p.id})" title="点击编辑">
      <td><input type="checkbox" class="mgmt-chk" value="${p.id}"></td>
      <td class="product-img">${imageHtml(p, 36)}</td>
      <td class="title-cell" title="${esc(p.title)}">${esc(p.title)}</td>
      <td><span class="platform-badge platform-${p.platform}">${platformLabel(p.platform)}</span></td>
      <td class="price-cell"><span class="yuan">¥</span>${(p.price||0).toFixed(2)}</td>
      <td>${esc(p.shop_name || '-')}</td>
      <td><div class="action-btns">
        <button class="btn-edit" data-id="${p.id}">编辑</button>
        <button class="btn-del" data-id="${p.id}">删除</button>
      </div></td>
    </tr>`;
  }).join('');

  // 绑定操作事件 (避免重复绑定)
  $$('.mgmt-table .btn-edit').forEach(b => b.addEventListener('click', () => openEditModal(+b.dataset.id)));
  $$('.mgmt-table .btn-del').forEach(b => b.addEventListener('click', () => deleteProduct(+b.dataset.id)));
  $$('.mgmt-chk').forEach(chk => chk.addEventListener('change', updateBatchDeleteBtn));
  $('#chkSelectAll').addEventListener('click', function() {
    $$('.mgmt-chk').forEach(c => c.checked = this.checked);

    updateBatchDeleteBtn();
  });

  $('#chkSelectAll').checked = false;
  updateBatchDeleteBtn();
}

function updateBatchDeleteBtn() {
  const checked = $$('.mgmt-chk:checked');
  const btn = $('#btnBatchDelete');
  btn.style.display = checked.length ? '' : 'none';
  if (checked.length) {
    btn.textContent = '🗑 批量删除 (' + checked.length + ')';
  }
}

// ── 导出数据 ──
let _exportFormats = [
  { value: 'xlsx', label: '📊 Excel (.xlsx)' },
  { value: 'csv',  label: '📄 CSV (.csv)' },
  { value: 'json', label: '📋 JSON (.json)' },
];

$('#btnExport').addEventListener('click', () => showExportPicker());

function showExportPicker() {
  // 关闭已有
  const old = document.querySelector('.export-picker');
  if (old) { old.remove(); return; }
  const btn = $('#btnExport');
  const rect = btn.getBoundingClientRect();
  const picker = document.createElement('div');
  picker.className = 'export-picker';
  picker.style.cssText = `position:fixed;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right}px;z-index:9999;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.4);min-width:190px;padding:4px`;
  picker.innerHTML = _exportFormats.map(f => `<button class="export-opt" data-fmt="${f.value}" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:transparent;color:var(--text-primary);font-size:13px;cursor:pointer;border-radius:6px;font-family:inherit">${f.label}</button>`).join('');
  document.body.appendChild(picker);
  picker.querySelectorAll('.export-opt').forEach(opt => {
    opt.addEventListener('click', async () => {
      picker.remove();
      doExport(opt.dataset.fmt);
    });
    opt.addEventListener('mouseenter', () => opt.style.background = 'var(--bg-tertiary)');
    opt.addEventListener('mouseleave', () => opt.style.background = 'transparent');
  });
  // 点击别处关闭
  setTimeout(() => {
    document.addEventListener('click', function closePicker(e) {
      if (!picker.contains(e.target) && e.target !== btn) {
        picker.remove();
        document.removeEventListener('click', closePicker);
      }
    });
  }, 0);
}

async function doExport(fmt) {
  const q = $('#mgmtSearch').value.trim();
  const platform = $('#mgmtPlatform').value;
  const btn = $('#btnExport');
  btn.textContent = '⏳ 导出中...';
  btn.disabled = true;
  try {
    // 拉取全部匹配数据（上限 5000 条）
    const r = await fetch(`${API}/products/search?q=${encodeURIComponent(q)}&platform=${platform}&limit=5000&page=1`);
    const d = await r.json();
    if (!d.ok || !d.products || !d.products.length) {
      toast('没有可导出的数据');
      btn.textContent = '📥 导出';
      btn.disabled = false;
      return;
    }
    const rows = d.products.map(p => ({
      title: p.title || '',
      platform: p.platform || '',
      price: p.price || 0,
      original_price: p.original_price || '',
      shop_name: p.shop_name || '',
      detail_url: p.detail_url || '',
      main_image_url: p.main_image_url || '',
      image_urls: Array.isArray(p.image_urls) ? p.image_urls.join(',') : (p.image_urls || ''),
      description: p.description || '',
    }));
    const headers = ['title','platform','price','original_price','shop_name','detail_url','main_image_url','image_urls','description'];
    const res = await fetch('/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, format: fmt, headers })
    });
    const ed = await res.json();
    if (!ed.ok) { toast('导出失败: ' + (ed.detail || '未知错误')); btn.textContent = '📥 导出'; btn.disabled = false; return; }
    // 下载
    const b = atob(ed.data);
    const u8 = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
    const mime = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', json: 'application/json' }[fmt] || 'application/octet-stream';
    const blob = new Blob([u8], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ed.filename || `export.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`已导出 ${rows.length} 条数据`);
  } catch (e) {
    toast('导出失败: ' + e.message);
  }
  btn.textContent = '📥 导出';
  btn.disabled = false;
}

function renderPagination() {
  const container = $('#mgmtPagination');
  if (mgmtTotalPages <= 1) { container.innerHTML = ''; return; }
  let html = '';
  const makeBtn = (label, page, disabled) => {
    const d = disabled ? ' disabled' : '';
    const c = page === mgmtPage ? ' current' : '';
    return '<button class="' + c + '"' + d + ' onclick="mgmtPage=' + page + ';loadMgmtData()">' + label + '</button>';
  };
  html += makeBtn('\u00ab', 1, mgmtPage <= 1);
  html += makeBtn('\u2039', mgmtPage - 1, mgmtPage <= 1);
  for (let p = Math.max(1, mgmtPage - 2); p <= Math.min(mgmtTotalPages, mgmtPage + 2); p++) {
    html += makeBtn(p, p, false);
  }
  html += makeBtn('\u203a', mgmtPage + 1, mgmtPage >= mgmtTotalPages);
  html += makeBtn('\u00bb', mgmtTotalPages, mgmtPage >= mgmtTotalPages);
  container.innerHTML = html;
}

// ── 编辑商品 ──
let editingId = null;
async function openEditModal(productId) {
  try {
    const r = await fetch(API + '/products/' + productId);
    const d = await r.json();
    if (!d.ok) { toast('获取商品失败'); return; }
    const p = d.product;
    editingId = p.id;
    editingProduct = p;
    $('#editTitle').value = p.title || '';
    $('#editPlatform').value = p.platform || 'taobao';
    $('#editPrice').value = p.price != null ? p.price : '';
    $('#editOriginalPrice').value = p.original_price != null ? p.original_price : '';
    $('#editShopName').value = p.shop_name || '';
    $('#editStockInfo').value = p.stock_info || '';
    $('#editPlatformUrl').value = p.platform_url || '';
    $('#editShipping').value = p.shipping || '';
    $('#editDescription').value = p.description || '';
    renderEditImageBlocks(p);
    renderSkuTab(p);
    switchEditTab('basic');
    $('#editModal').classList.add('show');
  } catch (e) { toast('获取商品失败: ' + e.message); }
}

function renderEditImageBlocks(p) {
  const container = $('#editImageBlocks');
  const mainUrl = p.main_image_url || '';
  const extraUrls = p.image_urls || [];
  let html = '';
  const allUrls = [mainUrl, ...extraUrls].filter(u => u);
  allUrls.forEach((url, i) => {
    const src = API + "/image/" + p.id + "/" + i;
    const isMain = i === 0;
    html += '<div class="image-block" data-index="' + i + '">'
      + (isMain ? '<span class="img-block-badge">主图</span>' : '')
      + '<button class="img-block-remove" onclick="removeImageBlock(this)" title="删除">✕</button>'
      + '<div class="img-block-preview" onclick="openImageGallery(' + p.id + ', ' + i + ')" title="点击预览">'
      + '<img src="' + escAttr(src) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"'
      + ' style="' + (!isMain && !src.startsWith('http') ? 'display:none' : '') + '">'
      + '<div class="img-placeholder" style="' + (isMain || src.startsWith('http') ? 'display:none' : '') + '">🖼️</div>'
      + '</div>'
      + '<div class="img-block-url" data-url="' + escAttr(encodeURIComponent(url)) + '" title="' + escAttr(url) + '">'
      + escAttr(url.substring(url.lastIndexOf('/') + 1) || url.substring(0, 40)) + '</div>'
      + '</div>';
  });
  container.innerHTML = html;
}

function removeImageBlock(btn) {
  const block = btn.closest('.image-block');
  if (block) block.remove();
}

let editingProduct = null;

function closeEditModal() {
  $('#editModal').classList.remove('show');
  editingId = null;
}

// ── Tab 切换 ──
$$('.modal-tab').forEach(tab => {
  tab.addEventListener('click', () => switchEditTab(tab.dataset.tab));
});
function switchEditTab(name) {
  $$('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $('#tabBasic').style.display = name === 'basic' ? '' : 'none';
  $('#tabSku').style.display = name === 'sku' ? '' : 'none';
}

// ── SKU Tab 渲染 ──
let _editSkus = [];
function renderSkuTab(p) {
  _editSkus = (p.skus || []).map((s, i) => ({
    color: s.color || '',
    size: s.size || '',
    price: s.price != null ? s.price : (p.price || 0),
    images: s.images || (i === 0 ? [0] : []),
  }));
  _renderSkuList();
}

function _renderSkuList() {
  const allImageUrls = [];
  const blocks = $$('#editImageBlocks .image-block');
  blocks.forEach(b => {
    const urlDiv = b.querySelector('.img-block-url');
    const raw = urlDiv ? urlDiv.getAttribute('data-url') : '';
    allImageUrls.push(raw ? decodeURIComponent(raw) : (urlDiv ? urlDiv.getAttribute('title') : ''));
  });

  let html = '';
  _editSkus.forEach((sku, idx) => {
    const imgs = (sku.images || []).map(i => {
      const url = allImageUrls[i] || '';
      const src = url ? (API + '/image/' + editingId + '/' + i) : '';
      return src ? '<img src="' + escAttr(src) + '" onerror="this.style.display=\'none\'">' : '';
    }).join('');
    html += '<div class="sku-row">'
      + '<div class="sku-images">' + (imgs || '🖼️') + '</div>'
      + '<div class="sku-fields">'
      + '<input value="' + escAttr(sku.color) + '" placeholder="颜色" data-sku-idx="' + idx + '" data-sku-field="color" onchange="_updateSkuField(this)">'
      + '<input value="' + escAttr(sku.size) + '" placeholder="尺寸" data-sku-idx="' + idx + '" data-sku-field="size" onchange="_updateSkuField(this)">'
      + '<input class="sku-price" type="number" step="0.01" value="' + (sku.price || 0) + '" data-sku-idx="' + idx + '" data-sku-field="price" onchange="_updateSkuField(this)">'
      + '</div>'
      + '<button class="sku-del" onclick="_deleteSku(' + idx + ')" title="删除">✕</button>'
      + '</div>';
  });
  $('#skuList').innerHTML = html || '<div style="color:var(--text-secondary);font-size:12px;padding:20px;text-align:center">暂无 SKU，点击下方按钮新增</div>';
}

function _updateSkuField(el) {
  const idx = +el.dataset.skuIdx;
  const field = el.dataset.skuField;
  const val = el.type === 'number' ? parseFloat(el.value) || 0 : el.value;
  if (_editSkus[idx]) {
    _editSkus[idx][field] = val;
  }
}

function _deleteSku(idx) {
  _editSkus.splice(idx, 1);
  _renderSkuList();
}

$('#btnAddSku').addEventListener('click', () => {
  _editSkus.push({ color: '', size: '', price: 0, images: [0] });
  _renderSkuList();
});

$('#btnEditCancel').addEventListener('click', closeEditModal);
$('#editModal').addEventListener('click', e => { if (_didClickOverlay(e, $('#editModal'))) closeEditModal(); });

$('#btnEditSave').addEventListener('click', async () => {
  if (!editingId) return;
  const blocks = $$('#editImageBlocks .image-block');
  const imageUrls = [];
  let mainImageUrl = '';
  blocks.forEach((block, i) => {
    const urlDiv = block.querySelector('.img-block-url');
    const raw = urlDiv ? urlDiv.getAttribute('data-url') : '';
    const url = raw ? decodeURIComponent(raw) : (urlDiv ? urlDiv.getAttribute('title') : '');
    if (url) {
      if (i === 0) mainImageUrl = url;
      else imageUrls.push(url);
    }
  });
  const body = {
    title: $('#editTitle').value.trim(),
    platform: $('#editPlatform').value,
    price: parseFloat($('#editPrice').value) || 0,
    original_price: parseFloat($('#editOriginalPrice').value) || null,
    shop_name: $('#editShopName').value.trim(),
    stock_info: $('#editStockInfo').value.trim(),
    main_image_url: mainImageUrl,
    platform_url: $('#editPlatformUrl').value.trim(),
    shipping: $('#editShipping').value.trim(),
    description: $('#editDescription').value.trim(),
    image_urls: imageUrls,
    skus: _editSkus,
  };
  for (const k of Object.keys(body)) { if (body[k] === null) delete body[k]; }
  try {
    const r = await fetch(API + '/products/' + editingId, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.ok) { toast('✅ 已保存'); closeEditModal(); loadMgmtData(); }
    else { toast('❌ ' + (d.error || '保存失败')); }
  } catch (e) { toast('保存失败: ' + e.message); }
});

async function deleteProduct(productId) {
  if (!confirm('确定要删除商品 #' + productId + ' 吗？')) return;
  try {
    const r = await fetch(API + '/products/' + productId, { method: 'DELETE' });
    const d = await r.json();
    if (d.ok) { toast('🗑 已删除'); loadMgmtData(); loadStats(); }
    else { toast('删除失败'); }
  } catch (e) { toast('删除失败: ' + e.message); }
}

$('#btnBatchDelete').addEventListener('click', async () => {
  const checked = $$('.mgmt-chk:checked');
  if (!checked.length) return;
  if (!confirm('确定删除 ' + checked.length + ' 条商品吗？')) return;
  const ids = [...checked].map(c => +c.value);
  try {
    const r = await fetch(API + '/products/batch-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_ids: ids }),
    });
    const d = await r.json();
    if (d.ok) { toast('🗑 已删除 ' + d.deleted + ' 条'); loadMgmtData(); loadStats(); }
    else { toast('删除失败: ' + (d.error || '')); }
  } catch (e) { toast('删除失败: ' + e.message); }
});

$('#btnRepairPlatforms').addEventListener('click', async () => {
  const btn = $('#btnRepairPlatforms');
  const orig = btn.textContent;
  btn.textContent = '⏳ 检测中…';
  btn.disabled = true;
  try {
    const r = await fetch(API + '/products/repair-platforms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json();
    if (d.ok) { toast('🔍 检测完成：共 ' + d.total + ' 条，已修复 ' + d.repaired + ' 条平台'); loadMgmtData(); }
    else { toast('检测失败: ' + (d.error || '')); }
  } catch (e) { toast('检测失败: ' + e.message); }
  btn.textContent = orig;
  btn.disabled = false;
});

// ── 编辑弹窗图片添加（内联输入，不用 prompt）──
let _addImageActive = false;

function showAddImageInput() {
  if (_addImageActive) return;
  _addImageActive = true;
  const btn = $('#btnAddImageBlock');
  btn.style.display = 'none';

  const wrapper = document.createElement('div');
  wrapper.id = '_addImageInputWrap';
  wrapper.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:6px;width:100%';
  wrapper.innerHTML = '<input type="text" id="_addImageUrl" placeholder="粘贴图片 URL，回车确认…"'
    + ' style="flex:1;padding:7px 10px;border-radius:6px;font-size:12px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border);outline:none">'
    + '<button id="_addImageConfirm" style="padding:7px 14px;border-radius:6px;font-size:12px;background:var(--accent);color:#fff;border:none;cursor:pointer;white-space:nowrap">确认</button>'
    + '<button id="_addImageCancel" style="padding:7px 10px;border-radius:6px;font-size:12px;background:var(--bg-tertiary);color:var(--text-secondary);border:none;cursor:pointer">取消</button>';
  btn.parentElement.appendChild(wrapper);

  const input = wrapper.querySelector('#_addImageUrl');
  input.focus();

  const doAdd = () => {
    const url = input.value.trim();
    cancelAddImageInput();
    if (!url) return;
    addImageBlock(url);
  };

  wrapper.querySelector('#_addImageConfirm').addEventListener('click', doAdd);
  wrapper.querySelector('#_addImageCancel').addEventListener('click', () => {
    cancelAddImageInput();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAdd();
    if (e.key === 'Escape') cancelAddImageInput();
  });
}

function cancelAddImageInput() {
  _addImageActive = false;
  const wrap = document.getElementById('_addImageInputWrap');
  if (wrap) wrap.remove();
  const btn = $('#btnAddImageBlock');
  if (btn) btn.style.display = '';
}

async function addImageBlock(cleanUrl) {
  const proxyUrl = API + '/proxy-image?url=' + encodeURIComponent(cleanUrl);

  // 创建带 loading spinner 的方块
  const block = document.createElement('div');
  block.className = 'image-block';
  block.innerHTML = '<button class="img-block-remove" onclick="removeImageBlock(this)" title="删除">✕</button>'
    + '<div class="img-block-preview" onclick="previewAddedImage(this, \'' + escAttr(cleanUrl) + '\')" title="点击预览">'
    + '<div class="img-block-loading"></div>'
    + '<img src="' + proxyUrl + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'"'
    + ' onload="var ld=this.parentElement.querySelector(\'.img-block-loading\');if(ld)ld.style.display=\'none\'"'
    + ' style="width:100%;height:100%;object-fit:cover">'
    + '<div class="img-placeholder" style="display:none">🔗 链接</div>'
    + '</div>'
    + '<div class="img-block-url" data-url="' + escAttr(encodeURIComponent(cleanUrl)) + '" title="' + escAttr(cleanUrl) + '">'
    + escAttr(cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1) || cleanUrl.substring(0, 40)) + '</div>';

  $('#editImageBlocks').appendChild(block);
  block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('#btnAddImageBlock').addEventListener('click', showAddImageInput);

function previewAddedImage(el, url) {
  const img = $('#galleryImg');
  img.src = url;
  img.onerror = function() { this.src = ''; this.style.display = 'none'; toast('⚠️ 该 URL 无法作为图片加载'); };
  galleryImages = [{ url: url, isMain: true }];
  galleryIndex = 0; galleryProductId = null;
  galleryRotation = 0; galleryZoom = 1; galleryPanX = 0; galleryPanY = 0;
  updateGalleryTransform(); updateGalleryCounter(); updateGalleryNav();
  // 侧栏预览无 productId → 隐藏编辑/添加/删除按钮
  $('#btnEditImgUrl').style.display = 'none';
  $('#btnAddImg').style.display = 'none';
  $('#btnDelImg').style.display = 'none';
  $('#imgGalleryOverlay').classList.add('show');
}

// ═══════════════════════════════════════════════
// 图片画廊预览
// ═══════════════════════════════════════════════
let galleryImages = [];
let galleryIndex = 0;
let galleryProductId = null;
let galleryRotation = 0;
let galleryZoom = 1;
let galleryPanX = 0;
let galleryPanY = 0;

async function openImageGallery(productId, startIdx) {
  galleryProductId = productId;
  galleryRotation = 0; galleryZoom = 1; galleryPanX = 0; galleryPanY = 0;
  try {
    const r = await fetch(API + '/products/' + productId + '/images');
    const d = await r.json();
    if (!d.ok) { toast('获取图片失败'); return; }
    galleryImages = d.images || [];
    if (!galleryImages.length) { toast('该商品无图片'); return; }
    galleryIndex = Math.max(0, Math.min(startIdx || 0, galleryImages.length - 1));
    updateGalleryImage(); updateGalleryCounter(); updateGalleryNav(); updateGalleryTransform();
    // 搜索结果画廊有 productId → 显示编辑/添加/删除按钮
    $('#btnEditImgUrl').style.display = '';
    $('#btnAddImg').style.display = '';
    $('#btnDelImg').style.display = '';
    $('#imgGalleryOverlay').classList.add('show');
  } catch (e) { toast('打开画廊失败: ' + e.message); }
}

function updateGalleryImage() {
  const img = $('#galleryImg');
  if (!galleryImages.length || galleryIndex < 0 || galleryIndex >= galleryImages.length) return;
  const item = galleryImages[galleryIndex];
  img.src = API + '/image/' + galleryProductId + '/' + galleryIndex;
  img.style.display = '';
  img.onerror = function() { if (item.url && this.src !== item.url) { this.src = item.url; } else { this.style.display = 'none'; } };
}

function updateGalleryCounter() {
  $('#galleryCounter').textContent = galleryImages.length ? (galleryIndex + 1) + ' / ' + galleryImages.length : '0 / 0';
}

function updateGalleryNav() {
  $('#btnGalleryPrev').disabled = galleryIndex <= 0;
  $('#btnGalleryNext').disabled = galleryIndex >= galleryImages.length - 1;
}

function updateGalleryTransform() {
  const img = $('#galleryImg');
  img.style.transform = 'rotate(' + galleryRotation + 'deg) scale(' + galleryZoom + ') translate(' + galleryPanX + 'px, ' + galleryPanY + 'px)';
  $('#zoomLabel2').textContent = Math.round(galleryZoom * 100) + '%';
}

function closeGallery() {
  $('#imgGalleryOverlay').classList.remove('show');
  galleryImages = []; galleryIndex = 0; galleryProductId = null;
}

$('#btnGalleryClose').addEventListener('click', closeGallery);
$('#imgGalleryOverlay').addEventListener('click', e => { if (_didClickOverlay(e, $('#imgGalleryOverlay'))) closeGallery(); });

$('#btnGalleryPrev').addEventListener('click', () => {
  if (galleryIndex > 0) { galleryIndex--; galleryRotation = 0; galleryZoom = 1; galleryPanX = 0; galleryPanY = 0; updateGalleryImage(); updateGalleryCounter(); updateGalleryNav(); updateGalleryTransform(); }
});
$('#btnGalleryNext').addEventListener('click', () => {
  if (galleryIndex < galleryImages.length - 1) { galleryIndex++; galleryRotation = 0; galleryZoom = 1; galleryPanX = 0; galleryPanY = 0; updateGalleryImage(); updateGalleryCounter(); updateGalleryNav(); updateGalleryTransform(); }
});

document.addEventListener('keydown', e => {
  if (!$('#imgGalleryOverlay').classList.contains('show')) return;
  if (e.key === 'ArrowLeft' && galleryIndex > 0) { galleryIndex--; galleryRotation = 0; galleryZoom = 1; galleryPanX = 0; galleryPanY = 0; updateGalleryImage(); updateGalleryCounter(); updateGalleryNav(); updateGalleryTransform(); e.preventDefault(); }
  if (e.key === 'ArrowRight' && galleryIndex < galleryImages.length - 1) { galleryIndex++; galleryRotation = 0; galleryZoom = 1; galleryPanX = 0; galleryPanY = 0; updateGalleryImage(); updateGalleryCounter(); updateGalleryNav(); updateGalleryTransform(); e.preventDefault(); }
  if (e.key === 'Escape') closeGallery();
});

$('#btnRotateLeft').addEventListener('click', () => { galleryRotation -= 90; updateGalleryTransform(); });
$('#btnRotateRight').addEventListener('click', () => { galleryRotation += 90; updateGalleryTransform(); });
$('#btnZoomIn2').addEventListener('click', () => { galleryZoom = Math.min(5, galleryZoom + 0.25); updateGalleryTransform(); });
$('#btnZoomOut2').addEventListener('click', () => { galleryZoom = Math.max(0.25, galleryZoom - 0.25); updateGalleryTransform(); });
$('#btnZoomReset2').addEventListener('click', () => { galleryZoom = 1; galleryPanX = 0; galleryPanY = 0; updateGalleryTransform(); });

$('#galleryStage').addEventListener('wheel', e => {
  e.preventDefault();
  galleryZoom = Math.max(0.25, Math.min(5, galleryZoom + (e.deltaY < 0 ? 0.1 : -0.1)));
  updateGalleryTransform();
});

let isDragging = false, dragStartX = 0, dragStartY = 0, dragOrigPanX = 0, dragOrigPanY = 0;
$('#galleryStage').addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  isDragging = true; dragStartX = e.clientX; dragStartY = e.clientY;
  dragOrigPanX = galleryPanX; dragOrigPanY = galleryPanY;
  $('#galleryStage').classList.add('grabbing');
});
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  galleryPanX = dragOrigPanX + (e.clientX - dragStartX) / galleryZoom;
  galleryPanY = dragOrigPanY + (e.clientY - dragStartY) / galleryZoom;
  updateGalleryTransform();
});
window.addEventListener('mouseup', () => { isDragging = false; $('#galleryStage').classList.remove('grabbing'); });

// 删除图片
$('#btnDelImg').addEventListener('click', async () => {
  if (!galleryProductId || !galleryImages.length) return;
  if (galleryImages.length <= 1) { toast('至少保留一张图片'); return; }
  if (!confirm('确定删除当前图片？')) return;
  try {
    const r = await fetch(API + '/products/' + galleryProductId + '/images/' + galleryIndex, { method: 'DELETE' });
    const d = await r.json();
    if (d.ok) { toast('🗑 已删除'); openImageGallery(galleryProductId, Math.min(galleryIndex, galleryImages.length - 2)); }
    else { toast('删除失败: ' + (d.error || '')); }
  } catch (e) { toast('删除失败: ' + e.message); }
});

// 添加图片
$('#btnAddImg').addEventListener('click', () => {
  $('#galleryAddPanel').classList.toggle('show');
  $('#galleryEditPanel').classList.remove('show');
  if ($('#galleryAddPanel').classList.contains('show')) $('#galleryAddUrl').focus();
});
$('#btnCancelAdd').addEventListener('click', () => $('#galleryAddPanel').classList.remove('show'));
$('#btnConfirmAdd').addEventListener('click', async () => {
  const url = $('#galleryAddUrl').value.trim();
  if (!url) return;
  const btn = $('#btnConfirmAdd');
  btn.disabled = true;
  btn.textContent = '⏳ 下载中…';
  try {
    const r = await fetch(API + '/products/' + galleryProductId + '/images', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_urls: [url] }),
    });
    const d = await r.json();
    if (d.ok) { toast('✅ 已添加'); $('#galleryAddPanel').classList.remove('show'); $('#galleryAddUrl').value = ''; openImageGallery(galleryProductId, galleryImages.length); }
    else { toast('添加失败: ' + (d.error || '')); }
  } catch (e) { toast('添加失败: ' + e.message); }
  btn.disabled = false;
  btn.textContent = '添加';
});

// 编辑URL
$('#btnEditImgUrl').addEventListener('click', () => {
  if (!galleryImages.length || !galleryProductId) return;
  $('#galleryEditPanel').classList.toggle('show');
  $('#galleryAddPanel').classList.remove('show');
  $('#galleryEditUrl').value = galleryImages[galleryIndex].url || '';
  if ($('#galleryEditPanel').classList.contains('show')) $('#galleryEditUrl').focus();
});
$('#btnCancelEdit').addEventListener('click', () => $('#galleryEditPanel').classList.remove('show'));
$('#btnConfirmEdit').addEventListener('click', async () => {
  const newUrl = $('#galleryEditUrl').value.trim();
  if (!newUrl || !galleryProductId) return;
  const mainImageUrl = galleryIndex === 0 ? newUrl : (galleryImages[0] ? galleryImages[0].url : '');
  const imageUrls = galleryImages.slice(1).map((img, i) => (i + 1) === galleryIndex ? newUrl : img.url);
  try {
    const r = await fetch(API + '/products/' + galleryProductId + '/images', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ main_image_url: mainImageUrl, image_urls: imageUrls }),
    });
    const d = await r.json();
    if (d.ok) { toast('✅ 已更新'); $('#galleryEditPanel').classList.remove('show'); openImageGallery(galleryProductId, galleryIndex); }
    else { toast('更新失败: ' + (d.error || '')); }
  } catch (e) { toast('更新失败: ' + e.message); }
});

// 复制
$('#btnGalleryCopy').addEventListener('click', async () => {
  const img = $('#galleryImg');
  const btn = $('#btnGalleryCopy');
  if (!img.src) return;
  const origText = btn.textContent;
  const origBg = btn.style.background;
  const origColor = btn.style.color;
  const feedback = (text, bg, color) => {
    btn.textContent = text; btn.style.background = bg; btn.style.color = color;
    btn.style.transform = 'scale(0.92)';
    setTimeout(() => { btn.style.transform = ''; }, 120);
    setTimeout(() => {
      btn.textContent = origText; btn.style.background = origBg; btn.style.color = origColor;
    }, 1800);
  };
  try {
    // Canvas 转 Blob，兼容 blob:/data:/远程 等各种 src
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    feedback('✅ 已复制', '#166534', '#bbf7d0');
  } catch (e) {
    try {
      await navigator.clipboard.writeText(img.src);
      feedback('✅ URL已复制', '#166534', '#bbf7d0');
    } catch (e2) { toast('复制失败'); }
  }
});

// ═══════════════════════════════════════════════
// 列拖拽
// ═══════════════════════════════════════════════
function initColumnResize(table) {
  if (!table) return;
  const thead = table.querySelector('thead tr');
  if (!thead) return;
  const ths = thead.querySelectorAll('th');
  const tableWrap = table.closest('.table-wrap') || table.parentElement;

  // 单条引导线，贯穿全高，pointer-events: none 不拦截鼠标
  const line = document.createElement('div');
  line.className = 'col-guide';
  line.style.cssText = 'position:absolute;top:0;width:2px;z-index:3;pointer-events:none;display:none';
  tableWrap.style.position = tableWrap.style.position || 'relative';
  tableWrap.appendChild(line);

  let resizing = false;

  ths.forEach((th, i) => {
    if (i === ths.length - 1) return; // 最后一列不显示

    th.addEventListener('mousemove', e => {
      if (resizing) return;
      const rect = th.getBoundingClientRect();
      const wrapRect = tableWrap.getBoundingClientRect();
      const near = e.clientX - rect.right > -8 && e.clientX - rect.right < 8;
      if (near) {
        document.body.style.cursor = 'col-resize';
        line.style.display = 'block';
        line.style.top = (rect.top - wrapRect.top) + 'px';
        line.style.left = (rect.right - wrapRect.left) + 'px';
        line.style.height = tableWrap.offsetHeight + 'px';
      }
    });

    th.addEventListener('mouseleave', () => {
      if (!resizing) { line.style.display = 'none'; document.body.style.cursor = ''; }
    });

    th.addEventListener('mousedown', e => {
      if (Math.abs(e.clientX - th.getBoundingClientRect().right) > 8) return;
      e.preventDefault();
      resizing = true;
      const startX = e.clientX;
      const startW = th.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = ev => {
        const newW = Math.max(40, startW + (ev.clientX - startX));
        th.style.width = newW + 'px'; th.style.minWidth = newW + 'px';
        const wrapRect = tableWrap.getBoundingClientRect();
        line.style.left = (ev.clientX - wrapRect.left) + 'px';
      };
      const onUp = () => {
        resizing = false;
        line.style.display = 'none';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// ═══════════════════════════════════════════════
// 搜索结果行点击 → 打开商品链接
// ═══════════════════════════════════════════════
(function() {
  const _orig = renderResults;
  renderResults = function(results, mode) {
    _orig(results, mode);
    document.querySelectorAll('#resultTable tbody tr').forEach(row => {
      row.addEventListener('click', function(e) {
        if (e.target.closest('button') || e.target.closest('.product-img') || e.target.closest('input')) return;
        const idx = Array.prototype.indexOf.call(this.parentElement.children, this);
        const r = currentResults[idx];
        if (r && r.platform_url) window.open(r.platform_url, '_blank');
      });
    });
  };
})();

document.addEventListener('click', e => {
  if (e.target.closest('.mgmt-table .action-btns button')) e.stopPropagation();
  if (e.target.closest('.mgmt-table input[type="checkbox"]')) e.stopPropagation();
});

// ═══════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════
loadStats();
setInterval(loadStats, 30000);
loadTemplates();
initColumnResize(document.getElementById('resultTable'));

(function() {
  const _origSwitch = switchTab;
  switchTab = function(tab) {
    _origSwitch(tab);
    if (tab === 'mgmt') setTimeout(() => initColumnResize(document.getElementById('mgmtTable')), 200);
  };
})();
