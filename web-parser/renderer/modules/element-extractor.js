/**
 * 网页解析器 — 元素提取器模块
 */
window.Parser = window.Parser || {};

(function() {
  'use strict';
  var S = window.Parser.state;
  var U = window.Parser.utils;
  var $ = U.$;
  var $$ = U.$$;
  var safeStr = U.safeStr;
  var normalizeText = U.normalizeText;
  var _editorDedupMap = null;   // addToEditor O(1) 去重 Map（key→editorItems index）
  var _editorDelegatedBound = false;  // 事件委托只绑定一次

  // ──────── 元素选择器 ────────
  function bindPickerEvents() {
    var btnStop = document.getElementById("btnStopPick");
    if (btnStop) btnStop.addEventListener('click', stopPickMode);
    document.getElementById("btnPickAuto").addEventListener('click', autoPickSimilar);
    var btnReg = document.getElementById("btnRegisterPicked");
    if (btnReg) btnReg.addEventListener('click', registerElements);
  }

  // 第一页自动存快照（仅当还没存过任何快照时）
  async function _saveEntrySnapshotIfFirst() {
    try {
      var listResp = await fetch('http://127.0.0.1:' + (window.Parser.state.pythonPort || 19527) + '/api/page-snapshots/list');
      if (!listResp.ok) return;
      var listData = await listResp.json();
      if ((listData.snapshots || []).length > 0) return; // 已有快照，不存
      var wv = document.getElementById('webview');
      if (!wv) return;
      var html = await wv.executeJavaScript('document.documentElement.outerHTML');
      if (html && html.length > 100) {
        await fetch('http://127.0.0.1:' + (window.Parser.state.pythonPort || 19527) + '/api/page-snapshots/save', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({url: wv.getURL(), html: html})
        });
        console.log('[快照] 首页自动保存');
      }
    } catch(e) {}
  }

  var _startPickLock = false;  // 防止重复注入

  // 自动注册：防抖 600ms，避免频繁调后端
  var _autoRegTimer = null;
  function _scheduleAutoRegister() {
    if (_autoRegTimer) clearTimeout(_autoRegTimer);
    _autoRegTimer = setTimeout(function() {
      _autoRegTimer = null;
      if (typeof window.registerElements === 'function') {
        window.registerElements().catch(function(e) { console.error('[autoReg] fail:', e); });
      }
    }, 600);
  }
  async function startPickMode() {
    if (_startPickLock) { console.log('[startPickMode] locked, skip'); return; }
    _startPickLock = true;
    // 保存当前页面URL（列表页URL，供切回列表模式使用）
    if (window.Parser && window.Parser.state && !window.Parser.state._listPageUrl) {
      var wv = document.getElementById('webview');
      if (wv) window.Parser.state._listPageUrl = wv.getURL();
    }
    // 清理旧的轮询定时器（防止刷新/重注时重复创建）
    if (window._pickerPollTimer) { clearInterval(window._pickerPollTimer); window._pickerPollTimer = null; }
    stopBoxClickPoll();
    // 每次进入提取模式都清空编辑器，避免旧数据残留
    S.editorItems = [];
    S.pickedElements = [];
    _editorDedupMap = null;
    // 重置快照会话计数（每次进提取允许多次自动注册，但只存第一份快照）
    window.__snapshotsThisSession = 0;
    // 如果还没存过快照，保存当前页（第一页自动存）
    _saveEntrySnapshotIfFirst().catch(function(){});

    // 预加载已保存规则（按当前模式过滤）
    var allSavedRules = (window.Parser && window.Parser.state && window.Parser.state.savedSelectorRules) || [];
    var currentMode = (window.Parser && window.Parser.state && window.Parser.state._ruleMode) || 'list';
    var savedRules = allSavedRules.filter(function(r) {
      return !r.mode || r.mode === currentMode; // 旧规则无 mode 字段全部保留
    });
    var rulesJson = JSON.stringify(savedRules);

    // 轮询：读取队列中的新选中元素
    var _pollTimer = setInterval(async function() {
      if (!S.pickModeActive) { clearInterval(_pollTimer); return; }
      try {
        var queueData = await document.getElementById("webview").executeJavaScript('(function(){'
          + 'var q=window.__parserQueue||[];'
          + 'var n=window.__parserPicked?window.__parserPicked.length:0;'
          + 'return JSON.stringify({n:n,q:q.length>0?q.splice(0,q.length):[]});'
          + '})()');
        var data = JSON.parse(queueData || '{}');
        document.getElementById("pickedCount").textContent = '已选: ' + (data.n || 0) + ' 项';
        if ((data.q || []).length > 0) setStatus('队列收到 ' + data.q.length + ' 条');

        // 处理新选中的元素
        if (data.q && data.q.length > 0) {
          setStatus('扫描到 ' + data.q.length + ' 个元素...');
          var _anyDeferred = false;
          data.q.forEach(function(info) {
            if (info.type === 'nested_click') {
              showNestedPicker(info.elements, info.x, info.y);
            } else if (info.type === 'scan') {
              addToEditor(info, info.css || '', 'scan');
              _anyDeferred = true;
            } else if (info.type === 'auto') {
              addToEditor(info, info.css || '', 'auto');
              _anyDeferred = true;
            } else if (info.type === 'drag_done') {
              updatePickedElementsFromEditor();
              updatePickedTreeNodes();
              showPickedElementsPanel();
              var sessionLabel = info.session ? ' [第' + info.session + '次框选]' : '';
              setStatus('框选: 已添加 ' + (info.count || 0) + ' 个元素' + sessionLabel
                + ' (起点:' + Math.round(info.startX||0) + ',' + Math.round(info.startY||0)
                + ' → 终点:' + Math.round(info.endX||0) + ',' + Math.round(info.endY||0) + ')');
            } else if (info.type === 'drag_sub') {
              var removed = info.removed || [];
              for (var ri = 0; ri < removed.length; ri++) {
                var r = removed[ri];
                for (var ei = S.editorItems.length - 1; ei >= 0; ei--) {
                  var item = S.editorItems[ei];
                  if (item.selector === r.css && item.elementInfo &&
                      item.elementInfo.tag === r.tag &&
                      item.elementInfo.text === r.text) {
                    S.editorItems.splice(ei, 1);
                    break;
                  }
                }
              }
              updatePickedElementsFromEditor();
              updatePickedTreeNodes();
              showPickedElementsPanel();
              setStatus('框选: 已移除 ' + (info.count || 0) + ' 个元素');
            } else if (info.type === 'pick') {
              var isDrag = info.subtype === 'drag';
              addToEditor(info, info.css || '', 'pick', isDrag ? (info.dragSession || 0) : undefined);
              _anyDeferred = true;
            } else {
              addToEditor(info, info.css || '', 'pick');
              _anyDeferred = true;
            }
          });
          if (_anyDeferred) {
            if (_editorRenderTimer) { clearTimeout(_editorRenderTimer); _editorRenderTimer = null; }
            updatePickedElementsFromEditor();
            renderElementEditor();
            updatePickedTreeNodes();
            syncQueryPanelIfPicked();
          }
        }
      } catch(e) {}
    }, 500);
    window._pickerPollTimer = _pollTimer;

    try {
      var mode = S.pickModeType;
      // 注入核心选择脚本
      var pickScript = '(function(mode){'
        + 'if(window.__parser&&window.__parser.dragSelector)window.__parser.dragSelector.disable();'
        + 'if(window.__parserPickerActive){window.__parserPickerActive=false;'
          // 两次注入：先清理旧的事件处理器
          + 'if(window.__parser_onDragDown)document.removeEventListener("mousedown",window.__parser_onDragDown,true);'
          + 'if(window.__parser_onDragMove)document.removeEventListener("mousemove",window.__parser_onDragMove,true);'
          + 'if(window.__parser_onDragUp)document.removeEventListener("mouseup",window.__parser_onDragUp);'
          + 'if(window.__parser_onClickPick)document.removeEventListener("click",window.__parser_onClickPick,true);'
          + 'if(window.__parser_onCtxMenu)document.removeEventListener("contextmenu",window.__parser_onCtxMenu,true);'
          + 'clearPreview();'
        + '}'
        + 'window.__parserPickerActive=true;'
        + 'window.__parserPicked=[];window.__parserPickedEls=[];'
        + 'window.__parserQueue=[];window.__parserPickMode=mode;'
        + 'window.__parserDragSession=0;'
        + 'window.__parserInjectVer=(window.__parserInjectVer||0)+1;'  // 注入版本号

        // CSS路径生成
        + 'function genCSS(el,d){'
          + 'if(!el||el===document.body||el===document.documentElement)return "";'
          + 'if(el.id)return "#"+CSS.escape(el.id);'
          + 'd=d||5;var p=[];var c=el;'
          + 'while(c&&c!==document.body&&c!==document.documentElement&&p.length<d){'
            + 'var t=c.tagName.toLowerCase();'
            + 'if(c.id){p.unshift("#"+CSS.escape(c.id));break;}'
            + 'var cl=(typeof c.className==="string"?c.className:"").trim().split(/\\s+/).filter(Boolean).slice(0,2);'
            + 'if(cl.length)t+="."+cl.map(function(x){return CSS.escape(x)}).join(".");'
            + 'var pa=c.parentElement;'
            + 'if(pa){var sibs=Array.from(pa.children).filter(function(x){return x.tagName===c.tagName});'
              + 'if(sibs.length>1){t+=":nth-of-type("+(sibs.indexOf(c)+1)+")";}}'
            + 'p.unshift(t);c=pa;'
          + '}'
          + 'return p.join(" > ");'
        + '}'

        // 自适应选择器生成
        + 'function genSelectors(el){'
          + 'var ss=[];var t=el.tagName.toLowerCase();'
          + 'ss.push({selector:t,label:"仅标签"});'
          + 'if(el.id)ss.push({selector:"#"+CSS.escape(el.id),label:"#id"});'
          + 'var cls=(typeof el.className==="string"?el.className:"").trim().split(/\\s+/).filter(Boolean);'
          + 'if(cls.length===1){'
            + 'ss.push({selector:t+"."+CSS.escape(cls[0]),label:"tag.class"});'
            + 'ss.push({selector:"."+CSS.escape(cls[0]),label:".class"});'
          + '}'
          + 'if(cls.length>=2){'
            + 'var j=cls.slice(0,2).map(function(c){return CSS.escape(c)}).join(".");'
            + 'ss.push({selector:t+"."+j,label:"tag.classes"});'
          + '}'
          + 'var pp=genCSS(el,2);'
          + 'if(pp&&!ss.some(function(s){return s.selector===pp}))ss.push({selector:pp,label:"父>子"});'
          + 'var fp=genCSS(el,0);'
          + 'if(fp&&fp!==pp&&!ss.some(function(s){return s.selector===fp}))ss.push({selector:fp,label:"全路径"});'
          + 'return ss;'
        + '}'

        // 统计匹配数
        + 'function countMatches(sel){try{return document.querySelectorAll(sel).length;}catch(e){return 0;}}'

        // 画框
        + 'function drawBox(el,color){'
          + 'var re=el.getBoundingClientRect();'
          + 'if(re.width===0&&re.height===0)return null;'
          + 'var voidTags={img:1,image:1,input:1,br:1,hr:1,source:1,embed:1,area:1,col:1,wbr:1,track:1};'
          + 'var isVoid=voidTags[el.tagName.toLowerCase()]||false;'
          // void 元素：使用 fixed 定位 + scroll 监听，支持超视口大图
          + 'if(isVoid){'
            + 'var cl=color||"#4ade80";'
            + 'if(re.width>0&&re.height>0){'
              + 'var over=document.createElement("div");'
              + 'over.setAttribute("data-parser-box","1");'
              + 'over.className="__parser_void_overlay";'
              + 'over.__parserImgEl=el;'
              + 'over.style.cssText="position:fixed;pointer-events:none;z-index:2147483643;'
                + 'left:"+re.left+"px;top:"+re.top+"px;'
                + 'width:"+re.width+"px;height:"+re.height+"px;'
                + 'border:3px solid "+cl+";border-radius:2px;box-sizing:border-box;'
                + 'background:"+(cl==="#4ade80"?"rgba(74,222,128,0.10)":"rgba(167,139,250,0.15)")+";";'
              + 'document.body.appendChild(over);'
              + 'if(!window.__parserImgOverlays)window.__parserImgOverlays=[];'
              + 'window.__parserImgOverlays.push(over);'
              + 'if(!window.__parserScrollBound){'
                + 'window.__parserScrollBound=true;'
                + 'var _tick=false;'
                + 'window.addEventListener("scroll",function(){'
                  + 'if(_tick)return;_tick=true;'
                  + 'requestAnimationFrame(function(){'
                    + '_tick=false;'
                    + 'var ovs=window.__parserImgOverlays;'
                    + 'if(!ovs)return;'
                    + 'for(var i=0;i<ovs.length;i++){'
                      + 'var o=ovs[i];if(!o||!o.__parserImgEl)continue;'
                      + 'var nr=o.__parserImgEl.getBoundingClientRect();'
                      + 'o.style.left=nr.left+"px";o.style.top=nr.top+"px";'
                      + 'o.style.width=nr.width+"px";o.style.height=nr.height+"px";'
                    + '}'
                  + '});'
                + '},{passive:true});'
              + '}'
              + 'return over;'
            + '}'
            // 回退：outline + box-shadow
            + 'var _oc=el.style.outlineColor,_os=el.style.outlineStyle,_ow=el.style.outlineWidth;'
            + 'var _oo=el.style.outlineOffset,_bs=el.style.boxShadow;'
            + 'el.style.setProperty("outline-color",cl,"important");'
            + 'el.style.setProperty("outline-style","solid","important");'
            + 'el.style.setProperty("outline-width","4px","important");'
            + 'el.style.setProperty("outline-offset","1px","important");'
            + 'el.style.setProperty("box-shadow","0 0 0 6px "+cl+",0 0 0 12px "+cl+"33","important");'
            + 'return {__isOutline:true,__targetEl:el,_oc:_oc,_os:_os,_ow:_ow,_oo:_oo,_bs:_bs};'
          + '}'
          + 'var origPos=el.style.position;'
          + 'if(!origPos||origPos==="static")el.style.position="relative";'
          + 'var b=document.createElement("div");'
          + 'b.setAttribute("data-parser-box","1");'
          + 'b.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483643;border:2px solid "+(color||"#4ade80")+";border-radius:2px;box-sizing:border-box;background:"+(color==="#4ade80"?"rgba(74,222,128,0.08)":"rgba(124,92,252,0.06)")+";";'
          + 'el.appendChild(b);'
          + 'b.__origPos=origPos;'
          + 'return b;'
        + '}'

        // 移除高亮框（兼容 void 元素的 outline 模式）
        + 'function clearBox(box){'
        + 'window.__parser_clearBox=clearBox;'
          + 'if(!box)return;'
          + 'if(box.__parserImgEl&&window.__parserImgOverlays){'
            + 'var _io=window.__parserImgOverlays.indexOf(box);'
            + 'if(_io>=0)window.__parserImgOverlays.splice(_io,1);'
          + '}'
          + 'if(box.__isOutline){'
            + 'var t=box.__targetEl;'
            + 'if(t){'
              + 't.style.removeProperty("outline-color");'
              + 't.style.removeProperty("outline-style");'
              + 't.style.removeProperty("outline-width");'
              + 't.style.removeProperty("outline-offset");'
              + 't.style.removeProperty("box-shadow");'
              + 'if(box._oc)t.style.outlineColor=box._oc;'
              + 'if(box._os)t.style.outlineStyle=box._os;'
              + 'if(box._ow)t.style.outlineWidth=box._ow;'
              + 'if(box._oo)t.style.outlineOffset=box._oo;'
              + 'if(box._bs)t.style.boxShadow=box._bs;'
            + '}'
          + '}else if(box.parentNode){'
            + 'if(box.__origParentPos!==undefined){box.parentNode.style.position=box.__origParentPos||"";}'
            + 'else if(box.__origPos!==undefined){box.parentNode.style.position=box.__origPos||"";}'
            + 'box.parentNode.removeChild(box);'
          + '}'
        + '}'

        // 将元素加入队列
        + 'function enqueue(item){if(!window.__parserQueue)window.__parserQueue=[];window.__parserQueue.push(item);}'

        // 获取某点下所有嵌套元素 (mask 有 pointer-events:none，无需操作)
        + 'function elAtPoint(x,y){'
          + 'var els=[];var el=document.elementFromPoint(x,y);'
          + 'while(el&&el!==document.body&&el!==document.documentElement){'
            + 'els.push({el:el,tag:el.tagName.toLowerCase(),'
              + 'id:el.id||"",'
              + 'cls:(typeof el.className==="string"?el.className:"").substring(0,50),'
              + 'text:(el.textContent||"").trim().substring(0,500),'
              + 'cssPath:genCSS(el,5),' // 每个层级的唯一 CSS 路径
            + '});'
            + 'el=el.parentElement;'
          + '}'
          + 'return els;'
        + '}'

        // 处理元素选中（可重复调用：不重复绘制、不重复入数组，但始终入列）
        + 'function pickElement(el,cssPath,cssCount,subtype,noDraw,dragSession,color){'
          + 'var isNew=!el.__parserPicked;'
          + 'el.__parserPicked=true;'
          + 'if(!noDraw){'
            + 'if(!el.__parserBox){'
              + 'el.__parserBox=drawBox(el,color||"#4ade80");'
            + '}'
            + 'if(!window.__parserBoxes)window.__parserBoxes=[];'
            + 'if(isNew)window.__parserBoxes.push(el.__parserBox);'
          + '}else{el.__parserBox=null;}'
          + 'if(!window.__parserPickedEls)window.__parserPickedEls=[];'
          + 'if(isNew)window.__parserPickedEls.push(el);'
          + 'var ss=genSelectors(el);'
          + 'if(isNew)window.__parserPicked.push({'
            + 'tag:el.tagName.toLowerCase(),'
            + 'css:cssPath,'
            + 'xpath:getXPath(el),'
            + 'count:cssCount,'
            + 'text:(el.textContent||"").trim().substring(0,2000),'
            + 'class:el.className||"",'
            + 'id:el.id||"",'
            + 'href:el.href||"",'
            + 'src:el.src||"",'
            + 'outerHTML:(el.outerHTML||"").substring(0,50000)'
          + '});'
          // 始终入列，确保每次框选 session 都能通知主面板
          + 'enqueue({'
            + 'tag:el.tagName.toLowerCase(),'
            + 'css:cssPath,'
            + 'xpath:getXPath(el),'
            + 'count:cssCount,'
            + 'text:(el.textContent||"").trim().substring(0,2000),'
            + 'class:el.className||"",'
            + 'id:el.id||"",'
            + 'href:el.href||"",'
            + 'src:el.src||"",'
            + 'outerHTML:(el.outerHTML||"").substring(0,50000),'
            + 'selectors:ss,'
            + 'type:"pick",'
            + 'subtype:subtype||"",'
            + 'dragSession:dragSession||0'
          + '});'
        + '}'
        + 'window.__parserPickEl=pickElement;'  // 暴露到全局

        // XPath（永远唯一）
        + 'function getXPath(el){'
          + 'if(el.id)return "//*[@id=\\""+el.id+"\\"]";'
          + 'var parts=[];'
          + 'while(el&&el!==document.body&&el!==document.documentElement){'
            + 'var t=el.tagName.toLowerCase();'
            + 'var p=el.parentElement;'
            + 'if(p){'
              + 'var sibs=Array.from(p.children).filter(function(c){return c.tagName===el.tagName;});'
              + 'if(sibs.length>1){t+="["+(sibs.indexOf(el)+1)+"]";}'
            + '}'
            + 'parts.unshift(t);'
            + 'el=p;'
          + '}'
          + 'return "//"+parts.join("/");'
        + '}'

        // CSS 路径（备份版 getCSSPath，不限层级，始终加 nth-of-type）
        + 'function uniqueSelector(el){'
          + 'var parts=[];var cur=el;'
          + 'while(cur&&cur.nodeType===1&&cur!==document.body){'
            + 'var tag=cur.tagName.toLowerCase();'
            + 'if(cur.id){parts.unshift("#"+CSS.escape(cur.id));break;}'
            + 'if(cur.className&&typeof cur.className==="string"){'
              + 'var cls=cur.className.trim().split(/\\s+/).filter(Boolean).slice(0,2);'
              + 'if(cls.length>0){tag+="."+cls.map(function(c){return CSS.escape(c)}).join(".");}'
            + '}'
            + 'var parent=cur.parentElement;'
            + 'if(parent){'
              + 'var sibs=Array.from(parent.children).filter(function(c){return c.tagName===cur.tagName;});'
              + 'if(sibs.length>1){var idx=sibs.indexOf(cur)+1;tag+=":nth-of-type("+idx+")";}'
            + '}'
            + 'parts.unshift(tag);cur=parent;'
          + '}'
          + 'return parts.join(" > ");'
        + '}'

        // 扫描页面所有元素，填充到队列供管理已选列表使用
        + 'function scanAllElements(){'
          + 'var all=document.querySelectorAll("body *");'
          + 'var scanResult=[];'
          + 'for(var i=0;i<all.length;i++){'
            + 'var el=all[i];'
            + 'if(el===document.body||el===document.documentElement)continue;'
            + 'var tag=el.tagName.toLowerCase();'
            // 跳过不可见标签
            + 'if(tag==="script"||tag==="style"||tag==="meta"||tag==="link"||tag==="noscript"||tag==="br"||tag==="hr")continue;'
            + 'if(el.hasAttribute&&el.hasAttribute("data-parser-box"))continue;'
            + 'if(el.className&&typeof el.className==="string"&&el.className.indexOf("__parser")===0)continue;'
            // 跳过没有辨识度的空壳元素（无 class 无 id 无文本的纯布局 div/span）
            + 'var cls=(typeof el.className==="string"?el.className:"").trim();'
            + 'var txt=(el.textContent||"").trim();'
            + 'var hasContent=cls.length>0||el.id||txt.length>20||el.tagName==="A"||isImageTag(el)||el.tagName==="INPUT"||el.tagName==="BUTTON"||el.tagName==="SELECT"||el.tagName==="TEXTAREA"||el.tagName==="VIDEO";'
            + 'if(!hasContent)continue;'
            + 'var r=el.getBoundingClientRect();'
            // 跳过不可见元素
            + 'if(r.width<5&&r.height<5)continue;'
            + 'if(r.bottom<0||r.top>window.innerHeight)continue;'
            + 'var cssPath=genCSS(el,0);'  // 用框选同款函数，0=最大5层
            + 'var xpath=getXPath(el);'
            + 'var cnt=countMatches(cssPath);'
            + 'var ss=genSelectors(el);'
            + 'scanResult.push({'
              + 'tag:tag,'
              + 'css:cssPath,'
              + 'xpath:xpath,'
              + 'count:cnt,'
              + 'text:(el.textContent||"").trim().substring(0,500),'
              + 'class:el.className||"",'
              + 'id:el.id||"",'
              + 'href:el.href||el.src||"",'
              + 'src:el.src||"",'
              + 'outerHTML:(el.outerHTML||"").substring(0,50000),'
              + 'selectors:ss,'
              + 'type:"scan"'
            + '});'
          + '}'
          + 'if(!window.__parserQueue)window.__parserQueue=[];'
          // 扫描结果追加到队列
          + 'for(var i=0;i<scanResult.length;i++){window.__parserQueue.push(scanResult[i]);}'
        + '}'
        // 延迟执行扫描，等页面稳定
        + 'setTimeout(scanAllElements,200);'

        // 创建遮罩 (pointer-events:none → 鼠标事件穿透到 document 捕获)
        + 'var mask=document.createElement("div");mask.id="__parser_mask";'
        + 'mask.style.cssText="position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483640;pointer-events:none;cursor:crosshair;background:transparent;";'
        + 'document.documentElement.appendChild(mask);'
        + 'document.body.style.cursor="crosshair";'

        // 拖拽框选状态 (所有模式都可拖拽)
        + 'var dragStartX=0,dragStartY=0,dragBox=null,isDragging=false,wasDragging=false;'
        + 'var previewEls=[];' // 实时预览高亮元素
        + 'var previewRAF=null;' // rAF 节流

        // 计算矩形重叠面积
        + 'function overlapArea(l1,t1,r1,b1,rect){'
          + 'var ol=Math.max(l1,rect.left),ot=Math.max(t1,rect.top);'
          + 'var or2=Math.min(r1,rect.right),ob2=Math.min(b1,rect.bottom);'
          + 'return Math.max(0,or2-ol)*Math.max(0,ob2-ot);'
        + '}'

        // 清除实时预览
        + 'function clearPreview(){'
          + 'for(var i=0;i<previewEls.length;i++){'
            + 'var el=previewEls[i];var box=el.__parserPrevBox;'
            + 'if(box&&box.parentNode){'
              + 'if(box.__origParentPos!==undefined)box.parentNode.style.position=box.__origParentPos||"";'
              + 'else if(box.__origPos!==undefined)box.parentNode.style.position=box.__origPos||"";'
              + 'else{var dpp=box.getAttribute("data-ppos");if(dpp!==null)box.parentNode.style.position=dpp;}'
              + 'box.parentNode.removeChild(box);'
            + '}'
            + 'el.__parserPrevBox=null;'
          + '}'
          + 'previewEls=[];'
        + '}'

        // 实时预览框内元素
        + 'function updatePreview(l,t,r,b){'
          + 'clearPreview();'
          + 'var all=document.querySelectorAll("body *");'
          + 'for(var i=0;i<all.length;i++){'
            + 'var el=all[i];'
            + 'if(el===document.body||el===document.documentElement)continue;'
            + 'if(el.hasAttribute&&el.hasAttribute("data-parser-box"))continue;'
            + 'if(el.className&&typeof el.className==="string"&&el.className.indexOf("__parser")===0)continue;'
            + 'var re=el.getBoundingClientRect();'
            + 'if(re.width<10&&re.height<10)continue;'
            + 'if(re.width===0||re.height===0)continue;'
            // 中心点判断
            + 'var cx=re.left+re.width/2,cy=re.top+re.height/2;'
            + 'if(cx>=l&&cx<=r&&cy>=t&&cy<=b){'
              + 'var prevBox=document.createElement("div");'
              + 'prevBox.setAttribute("data-parser-box","1");'
              + 'var tag=el.tagName.toUpperCase();'
              + 'var isVoid=tag==="IMG"||tag==="INPUT"||tag==="BR"||tag==="HR"||tag==="SOURCE"||tag==="EMBED"||tag==="AREA";'
              + 'if(!isVoid){'
                + 'var oldPos=el.style.position;prevBox.setAttribute("data-ppos",oldPos||"");if(!oldPos||oldPos==="static")el.style.position="relative";'
                + 'prevBox.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483642;outline:2px solid rgba(74,222,128,0.3);box-sizing:border-box;";'
                + 'el.appendChild(prevBox);'
              + '}else{'
                + 'var parent=el.parentElement;if(!parent){el.__parserPrevBox=null;return;}'
                + 'var oldPPos=parent.style.position;prevBox.setAttribute("data-ppos",oldPPos||"");if(!oldPPos||oldPPos==="static")parent.style.position="relative";'
                + 'var er=el.getBoundingClientRect();var pr=parent.getBoundingClientRect();'
                + 'prevBox.style.cssText="position:absolute;left:"+(er.left-pr.left)+"px;top:"+(er.top-pr.top)+"px;width:"+er.width+"px;height:"+er.height+"px;pointer-events:none;z-index:2147483642;outline:2px solid rgba(74,222,128,0.3);box-sizing:border-box;";'
                + 'parent.appendChild(prevBox);'
              + '}'
              + 'el.__parserPrevBox=prevBox;'
              + 'previewEls.push(el);'
            + '}'
          + '}'
        + '}'

        // 图片标签判断（含 SVG image / picture）
        + 'function isImageTag(el){var t=el.tagName;return t==="IMG"||t==="image"||t==="PICTURE";}'

        // 共享：收集并过滤矩形区域内的元素（isSub=减选模式用宽松判断）
        + 'function collectInRect(l,t,r,b,isSub){'
          + 'var all=document.querySelectorAll("body *");'
          + 'var candidates=[];'
          + 'for(var i=0;i<all.length;i++){'
            + 'var el=all[i];'
            + 'if(el===document.body||el===document.documentElement)continue;'
            + 'if(el.hasAttribute&&el.hasAttribute("data-parser-box"))continue;'
            + 'if(el.className&&typeof el.className==="string"&&el.className.indexOf("__parser")===0)continue;'
            + 'var re=el.getBoundingClientRect();'
            + 'if(re.width===0||re.height===0)continue;'
            + 'var isImg=isImageTag(el);'
            + 'if(!isImg&&re.width<10&&re.height<10)continue;'
            + 'if(isImg){'
              + 'if(isSub){var cx2=re.left+re.width/2,cy2=re.top+re.height/2;if(cx2>=l&&cx2<=r&&cy2>=t&&cy2<=b)candidates.push(el);}'
              + 'else{if(re.left>=l&&re.left+re.width<=r&&re.top>=t&&re.top+re.height<=b)candidates.push(el);}'
            + '}else{'
              + 'var cx=re.left+re.width/2,cy=re.top+re.height/2;'
              + 'if(cx>=l&&cx<=r&&cy>=t&&cy<=b){candidates.push(el);}'
            + '}'
          + '}'
          // 父子过滤（图片始终保留）
          + 'var final=[];'
          + 'for(var i=0;i<candidates.length;i++){'
            + 'var el=candidates[i];'
            + 'var isChild=false;'
            + 'for(var j=0;j<candidates.length;j++){'
              + 'if(i===j)continue;'
              + 'if(candidates[j].contains(el)){isChild=true;break;}'
            + '}'
            + 'if(!isChild||isImageTag(el))final.push(el);'
          + '}'
          // 非图片元素：含选中图片 → 跳过；与选中图片重叠 → 跳过
          + 'for(var i=final.length-1;i>=0;i--){'
            + 'var el=final[i];if(isImageTag(el))continue;'
            + 'var _skip=false;'
            + 'for(var j=0;j<final.length;j++){'
              + 'if(i===j||!_skip&&!isImageTag(final[j]))continue;'
              + 'var _other=final[j];'
              // 父子包含
              + 'if(isImageTag(_other)&&el.contains(_other)){_skip=true;break;}'
              // 视觉重叠（兄弟/近邻元素）>30%面积重叠就跳过
              + 'if(isImageTag(_other)){'
                + 'var r1=el.getBoundingClientRect(),r2=_other.getBoundingClientRect();'
                + 'var ox=Math.max(0,Math.min(r1.right,r2.right)-Math.max(r1.left,r2.left));'
                + 'var oy=Math.max(0,Math.min(r1.bottom,r2.bottom)-Math.max(r1.top,r2.top));'
                + 'var oa=ox*oy,a1=r1.width*r1.height,a2=r2.width*r2.height;'
                + 'if(oa>0.3*Math.min(a1,a2)){_skip=true;break;}'
              + '}'
            + '}'
            + 'if(_skip)final.splice(i,1);'
          + '}'
          + 'return final;'
        + '}'

        // mousedown → 记录起点 (document 捕获阶段)
        + 'var onDragDown=function(e){'
          + 'if(e.button!==0)return;'
          + 'e.preventDefault();e.stopPropagation();'
          + 'dragStartX=e.clientX;dragStartY=e.clientY;'
          + 'isDragging=false;wasDragging=false;window.__parserScrollAcc=0;'
          + 'dragBox=document.createElement("div");dragBox.id="__parser_drag";'
          + 'dragBox.style.cssText="position:fixed;pointer-events:none;z-index:2147483643;'
            + 'border:2px solid #4ade80;border-radius:2px;'
            + 'box-shadow:0 0 0 4px rgba(74,222,128,0.15);'
            + 'background:rgba(74,222,128,0.12);display:none";'
          + 'document.documentElement.appendChild(dragBox);'
        + '};'
        + 'document.addEventListener("mousedown",onDragDown,true);window.__parser_onDragDown=onDragDown;'

        // mousemove → 画选区矩形 + 实时预览 (document 捕获，rAF 节流)
        + 'var onDragMove=function(e){'
          + 'if(!dragBox)return;'
          + 'e.preventDefault();e.stopPropagation();'
          // 边缘自动滚动
          + 'var _ed=60,_sy=0;'
          + 'if(e.clientY<_ed)_sy=-(_ed-e.clientY)/2;'
          + 'else if(e.clientY>window.innerHeight-_ed)_sy=(e.clientY-(window.innerHeight-_ed))/2;'
          + 'if(_sy!==0){'
            + 'if(typeof window.__parserScrollAcc==="undefined")window.__parserScrollAcc=0;'
            + 'window.__parserScrollAcc+=_sy;'
            + 'window.scrollBy(0,Math.round(_sy));'
          + '}'
          + 'var _sa=window.__parserScrollAcc||0;'
          + 'var _adjY=dragStartY-_sa;'
          + 'var dx=Math.abs(e.clientX-dragStartX),dy=Math.abs(e.clientY-_adjY);'
          + 'if(dx>3||dy>3){isDragging=true;'
            + 'dragBox.style.display="";'
            + 'dragBox.style.left=Math.min(dragStartX,e.clientX)+"px";'
            + 'dragBox.style.top=Math.min(_adjY,e.clientY)+"px";'
            + 'dragBox.style.width=Math.abs(e.clientX-dragStartX)+"px";'
            + 'dragBox.style.height=Math.abs(e.clientY-_adjY)+"px";'
            + 'var add=e.shiftKey?true:e.altKey?false:e.clientX>=dragStartX;'
            + 'dragBox.style.borderColor=add?"#4ade80":"#f87171";'
            + 'dragBox.style.background=add?"rgba(74,222,128,0.12)":"rgba(248,113,113,0.12)";'
            + 'dragBox.style.boxShadow=add?"0 0 0 4px rgba(74,222,128,0.15)":"0 0 0 4px rgba(248,113,113,0.15)";'
          + '}'
        + '};'
        + 'document.addEventListener("mousemove",onDragMove,true);window.__parser_onDragMove=onDragMove;'

        // mouseup → 计算框内元素并确认选中
        + 'var onDragUp=function(e){'
          + 'if(dragBox){dragBox.remove();dragBox=null;}'
          + 'if(isDragging){'
            + 'isDragging=false;wasDragging=true;clearPreview();'
            // Shift=加选，Alt=减选，无修饰=左→右加右→左减
            + 'var isAdd=e.shiftKey?true:e.altKey?false:e.clientX>=dragStartX;'
            + 'var _sa2=window.__parserScrollAcc||0;var _adjY2=dragStartY-_sa2;'
            + 'var l=Math.min(dragStartX,e.clientX),t=Math.min(_adjY2,e.clientY);'
            + 'var r=Math.max(dragStartX,e.clientX),b=Math.max(_adjY2,e.clientY);'
            + 'window.__parserScrollAcc=0;'

            // 第一步+第二步：收集并过滤框内元素
            + 'var final=collectInRect(l,t,r,b,!isAdd);'

            // 第三步：对每个最终元素执行选中/取消
            + 'if(isAdd){'
              // 递增框选次数，记录本次框选信息
              + 'window.__parserDragSession=(window.__parserDragSession||0)+1;'
              + 'var curSession=window.__parserDragSession;'
              + 'var sessionStartX=dragStartX;'
              + 'var sessionStartY=dragStartY;'
              + 'var sessionEndX=e.clientX;'
              + 'var sessionEndY=e.clientY;'
              + 'for(var i=0;i<final.length;i++){'
                + 'var el=final[i];'
                + 'var cssPath=genCSS(el,2);'
                + 'var cnt=countMatches(cssPath);'
                + 'var boxColor=isImageTag(el)?"#a78bfa":"#4ade80";'
                + 'pickElement(el,cssPath,cnt,"drag",false,curSession,boxColor);'
              + '}'
              + 'if(final.length>0){'
                + 'enqueue({type:"drag_done",count:final.length,session:curSession,'
                  + 'startX:sessionStartX,startY:sessionStartY,'
                  + 'endX:sessionEndX,endY:sessionEndY});'
              + '}'
            + '}else{'
              // 减选模式：同时检查 final 元素及其所有被选中的子孙
              + 'var _toCheck=[];'
              + 'for(var _ti=0;_ti<final.length;_ti++){_toCheck.push(final[_ti]);'
                + 'var _d=final[_ti].querySelectorAll("*");'
                + 'for(var _di=0;_di<_d.length;_di++){if(_d[_di].__parserPicked)_toCheck.push(_d[_di]);}'
              + '}'
              + 'var removedSelectors=[];'
              + 'for(var i=0;i<_toCheck.length;i++){'
                + 'var el=_toCheck[i];'
                + 'if(!el.__parserPicked)continue;'
                + 'el.__parserPicked=false;'
                + 'var idx=window.__parserPickedEls.indexOf(el);'
                + 'if(idx>=0){'
                  + 'var removed=window.__parserPicked[idx];'
                  + 'window.__parserPickedEls.splice(idx,1);'
                  + 'window.__parserPicked.splice(idx,1);'
                  + 'removedSelectors.push({tag:removed.tag,css:removed.css,text:removed.text});'
                + '}'
                + 'clearBox(el.__parserBox);'
                + 'el.__parserBox=null;'
              + '}'
              + 'if(removedSelectors.length>0){'
                + 'enqueue({type:"drag_sub",removed:removedSelectors,count:removedSelectors.length});'
              + '}'
            + '}'
          + '}'
        + '};'
        + 'document.addEventListener("mouseup",onDragUp);window.__parser_onDragUp=onDragUp;'

        // 点击处理 — document 捕获阶段 (遮罩 pointer-events:none，无需切换)
        + 'var onClickPick=function(e){'
          + 'e.preventDefault();e.stopPropagation();'
          + 'if(wasDragging){wasDragging=false;return;}'
          + 'var el=document.elementFromPoint(e.clientX,e.clientY);'
          + 'if(!el||el===document.body||el===document.documentElement)return;'

          // Ctrl/Cmd+点击 → 查找点击位置下的图片（穿透 a / div / 覆盖层）
          + 'if(e.ctrlKey||e.metaKey){'
            // 第一层：点击元素本身是 img
            + 'var imgEl=isImageTag(el)?el:null;'
            // 第二层：点击的是包裹元素（如 <a>），查子元素
            + 'if(!imgEl)imgEl=el.querySelector("img, image");'
            // 第三层：点击的是覆盖层，用 elementsFromPoint 穿透
            + 'if(!imgEl){'
              + 'var pts=document.elementsFromPoint(e.clientX,e.clientY);'
              + 'for(var k=0;k<pts.length;k++){'
                + 'if(isImageTag(pts[k])){imgEl=pts[k];break;}'
              + '}'
            + '}'
            + 'if(imgEl){'
              + 'var imgRe=imgEl.getBoundingClientRect();'
              + 'var final=collectInRect(imgRe.left,imgRe.top,imgRe.left+imgRe.width,imgRe.top+imgRe.height,false);'
              // 确保被点击的图片始终在内
              + 'if(final.indexOf(imgEl)<0)final.push(imgEl);'
              + 'if(final.length>0){'
                + 'window.__parserDragSession=(window.__parserDragSession||0)+1;'
                + 'var curSession=window.__parserDragSession;'
                + 'for(var i=0;i<final.length;i++){'
                  + 'var fe=final[i];'
                  + 'var cssPath=genCSS(fe,2);'
                  + 'var cnt=countMatches(cssPath);'
                  + 'var boxColor=isImageTag(fe)?"#a78bfa":"#4ade80";'
                  + 'pickElement(fe,cssPath,cnt,"drag",false,curSession,boxColor);'
                + '}'
                + 'enqueue({type:"drag_done",count:final.length,session:curSession,'
                  + 'startX:imgRe.left,startY:imgRe.top,endX:imgRe.left+imgRe.width,endY:imgRe.top+imgRe.height});'
              + '}'
              + 'return;'
            + '}'
          + '}'

          // 已选 → 取消（含子孙中被选中的元素）
          + 'var _cancelEls=[el];'
          + 'var _desc=el.querySelectorAll("*");'
          + 'for(var _di=0;_di<_desc.length;_di++){if(_desc[_di].__parserPicked)_cancelEls.push(_desc[_di]);}'
          + 'var _removed=false;'
          + 'for(var _ci=0;_ci<_cancelEls.length;_ci++){'
            + 'var _ce=_cancelEls[_ci];'
            + 'if(!_ce.__parserPicked)continue;'
            + '_ce.__parserPicked=false;'
            + 'var idx=window.__parserPickedEls.indexOf(_ce);'
            + 'if(idx>=0){window.__parserPickedEls.splice(idx,1);window.__parserPicked.splice(idx,1);_removed=true;}'
            + 'clearBox(_ce.__parserBox);'
            + '_ce.__parserBox=null;'
          + '}'
          + 'if(_removed)return;'

          // 根据模式处理
          + 'if(mode==="nested"){'
            + 'var els=elAtPoint(e.clientX,e.clientY);'
            + 'if(els.length<=1){'
              + 'var cssPath=genCSS(el,2);'
              + 'var cnt=countMatches(cssPath);'
              + 'pickElement(el,cssPath,cnt);'
            + '}else{'
              + 'enqueue({type:"nested_click",elements:els,x:e.clientX,y:e.clientY});'
            + '}'
          + '}else{'
            + 'var cssPath=genCSS(el,2);'
            + 'var cnt=countMatches(cssPath);'
            + 'pickElement(el,cssPath,cnt);'
          + '}'
        + '};'
        + 'document.addEventListener("click",onClickPick,true);window.__parser_onClickPick=onClickPick;'

        // 右键退出 (document 捕获) — 完全清理
        + 'var onCtxMenu=function(e){'
          + 'e.preventDefault();e.stopPropagation();'
          + 'clearPreview();'
          + 'window.__parserPickerActive=false;'
          + 'document.removeEventListener("mousedown",onDragDown,true);'
          + 'document.removeEventListener("mousemove",onDragMove,true);'
          + 'document.removeEventListener("mouseup",onDragUp,true);'
          + 'document.removeEventListener("click",onClickPick,true);'
          + 'document.removeEventListener("contextmenu",onCtxMenu,true);'
          // 1. 恢复 picked 元素的 position 并清除标记
          + 'var pels=window.__parserPickedEls||[];'
          + 'for(var i=0;i<pels.length;i++){'
            + 'var el=pels[i];if(!el)continue;'
            + 'el.__parserPicked=false;'
            + 'if(el.__parserBox){clearBox(el.__parserBox);el.__parserBox=null;}'
          + '}'
          // 2. 删除所有浮层 DOM
          + 'var boxes=document.querySelectorAll("[data-parser-box]");'
          + 'for(var j=0;j<boxes.length;j++){'
            + 'var b=boxes[j];'
            + 'if(b.parentNode){'
              + 'if(b.__origParentPos!==undefined)b.parentNode.style.position=b.__origParentPos||"";'
              + 'else if(b.__origPos!==undefined)b.parentNode.style.position=b.__origPos||"";'
              + 'else{var dpp=b.getAttribute("data-ppos");if(dpp!==null)b.parentNode.style.position=dpp;}'
              + 'b.parentNode.removeChild(b);'
            + '}'
          + '}'
          // 3. 删除遮罩和拖拽框
          + 'if(mask&&mask.parentNode)mask.remove();'
          + 'if(dragBox){dragBox.remove();dragBox=null;}'
          // 4. 重置
          + 'window.__parserBoxes=[];window.__parserPickedEls=[];window.__parserPicked=[];'
          + 'document.body.style.cursor="";'
        + '};'
        + 'document.addEventListener("contextmenu",onCtxMenu,true);window.__parser_onCtxMenu=onCtxMenu;'
        // 不自动恢复高亮，由树节点点击按来源触发
        + 'window.__parser_drawBox=drawBox;'
        + 'window.__parser_clearBox=clearBox;'
      + '})("' + mode + '")';

      await document.getElementById("webview").executeJavaScript(pickScript);
      var ok = await document.getElementById("webview").executeJavaScript('!!document.getElementById("__parser_mask")');
      if (ok) {
        S.pickModeActive = true;
        // 注入成功后才更新 UI
        document.getElementById("elementPickerBar").classList.remove('hidden'); updatePickedCount();
        document.getElementById("btnElementPicker").textContent = '退出提取';
        document.getElementById("btnElementPicker").classList.add('btn-accent');
        document.getElementById("btnPickModeClick").classList.remove('hidden');
        document.getElementById("btnPickModeDrag").classList.remove('hidden');
        document.getElementById("btnPickModeNested").classList.remove('hidden');
        document.getElementById("btnPickAuto").classList.remove('hidden');
        var btnStop = document.getElementById("btnStopPick");
        if (btnStop) {
          btnStop.textContent = '退出';
          btnStop.style.background = '';
          btnStop.style.borderColor = '';
          btnStop.style.color = '';
          btnStop.onclick = stopPickMode;
        }
        setPickMode(S.pickModeType || 'click');
        setStatus('提取已激活(' + {click:'点选',drag:'框选',nested:'穿透'}[mode] + ')');
        // 显示批量浮窗
        var bf = document.getElementById("paginationFloat");
        if (bf) { bf.classList.remove('hidden'); }
        if (typeof updateBatchFloat === 'function') updateBatchFloat();
        // 自动匹配已保存的选择器规则
        autoApplySavedRules();
      } else {
        S.pickModeActive = false;
        document.getElementById("elementPickerBar").classList.add('hidden');
        document.getElementById("btnElementPicker").textContent = '元素提取';
        document.getElementById("btnElementPicker").classList.remove('btn-accent');
        setStatus('注入失败');
      }
    } catch (e) {
      console.error('注入失败:', e);
      S.pickModeActive = false;
      document.getElementById("elementPickerBar").classList.add('hidden');
      document.getElementById("btnElementPicker").textContent = '元素提取';
      document.getElementById("btnElementPicker").classList.remove('btn-accent');
      setStatus('注入失败: ' + e.message);
    }
    _startPickLock = false;
  }

  async function stopPickMode() {
    console.log('[stopPickMode] called');
    if (!S.pickModeActive) { console.log('[stopPickMode] already inactive'); return; }
    // 先停掉轮询，防止轮询在清理期间继续调 executeJavaScript
    if (window._pickerPollTimer) { clearInterval(window._pickerPollTimer); window._pickerPollTimer = null; }
    stopBoxClickPoll();

    // 分段清理，每段独立 try-catch，一段失败不影响其他段
    // 外层也 try-catch，防止 webview 不可用时整个调用抛异常
    var exitMsg = '已退出提取模式';
    try {
      var cleanupResult = await document.getElementById("webview").executeJavaScript('(function(){'
        + 'var r={errors:[]};'
        + 'function _ok(fn,label){try{fn()}catch(e){r.errors.push(label+":"+e.message)}}'

        // 1. 关闭激活标记
        + '_ok(function(){window.__parserPickerActive=false;},"flag");'

        // 2. 移除事件监听
        + '_ok(function(){'
          + 'if(window.__parser_onDragDown)document.removeEventListener("mousedown",window.__parser_onDragDown,true);'
          + 'if(window.__parser_onDragMove)document.removeEventListener("mousemove",window.__parser_onDragMove,true);'
          + 'if(window.__parser_onDragUp)document.removeEventListener("mouseup",window.__parser_onDragUp);'
          + 'if(window.__parser_onClickPick)document.removeEventListener("click",window.__parser_onClickPick,true);'
          + 'if(window.__parser_onCtxMenu)document.removeEventListener("contextmenu",window.__parser_onCtxMenu,true);'
        + '},"events");'

        // 3. 恢复光标
        + '_ok(function(){document.body.style.cursor="";},"cursor");'

        // 4. 清理 pickedEls 数组中的元素框
        + '_ok(function(){'
          + 'r.pickedEls=(window.__parserPickedEls||[]).length;'
          + 'r.boxes=(window.__parserBoxes||[]).length;'
          + 'r.picked=(window.__parserPicked||[]).length;'
          + 'r.restored=0;r.outline=0;'
          + 'var pels=window.__parserPickedEls||[];'
          + 'for(var i=0;i<pels.length;i++){'
            + 'var el=pels[i];if(!el)continue;'
            + 'el.__parserPicked=false;'
            + 'var box=el.__parserBox;'
            + 'if(box){'
              + 'if(box.__isOutline){'
                + 'var t=box.__targetEl;'
                + 'if(t){'
                  + 't.style.removeProperty("outline-color");t.style.removeProperty("outline-style");'
                  + 't.style.removeProperty("outline-width");t.style.removeProperty("outline-offset");t.style.removeProperty("box-shadow");'
                  + 'if(box._oc)t.style.outlineColor=box._oc;if(box._os)t.style.outlineStyle=box._os;'
                  + 'if(box._ow)t.style.outlineWidth=box._ow;if(box._oo)t.style.outlineOffset=box._oo;if(box._bs)t.style.boxShadow=box._bs;'
                + '}'
                + 'r.outline++;'
              + '}else if(box.parentNode){'
                + 'if(box.__origParentPos!==undefined)box.parentNode.style.position=box.__origParentPos||"";'
                + 'else if(box.__origPos!==undefined)box.parentNode.style.position=box.__origPos||"";'
                + 'box.parentNode.removeChild(box);'
                + 'r.restored++;'
              + '}'
            + '}'
            + 'el.__parserBox=null;'
          + '}'
        + '},"pickedEls");'

        // 5. 清理残留的 DOM 框（data-parser-box）
        + '_ok(function(){'
          + 'r.domFound=0;r.domRemoved=0;r.domNoParent=0;'
          + 'var domBoxes=document.querySelectorAll("[data-parser-box]");'
          + 'r.domFound=domBoxes.length;'
          + 'for(var j=0;j<domBoxes.length;j++){'
            + 'var b=domBoxes[j];if(!b)continue;'
            + 'if(b.parentNode){'
              + 'if(b.__origParentPos!==undefined)b.parentNode.style.position=b.__origParentPos||"";'
              + 'else if(b.__origPos!==undefined)b.parentNode.style.position=b.__origPos||"";'
              + 'else{var dpp=b.getAttribute("data-ppos");if(dpp!==null)b.parentNode.style.position=dpp;}'
              + 'b.parentNode.removeChild(b);'
              + 'r.domRemoved++;'
            + '}else{r.domNoParent++;}'
          + '}'
        + '},"domBoxes");'

        // 6. 清理树高亮
        + '_ok(function(){'
          + 'var treeHls=document.querySelectorAll(".__parser_tree_hl");'
          + 'for(var k=0;k<treeHls.length;k++){'
            + 'var hl=treeHls[k];if(!hl)continue;'
            + 'if(hl.parentNode){'
              + 'var op=hl.getAttribute("data-ppos");'
              + 'if(op!==null&&op!=="")hl.parentNode.style.position=op;'
              + 'hl.parentNode.removeChild(hl);'
            + '}'
          + '}'
        + '},"treeHls");'

        // 7. 清理遮罩和拖拽框
        + '_ok(function(){'
          + 'var mask=document.getElementById("__parser_mask");'
          + 'if(mask&&mask.parentNode)mask.parentNode.removeChild(mask);'
          + 'var db=document.getElementById("__parser_drag");'
          + 'if(db&&db.parentNode)db.parentNode.removeChild(db);'
        + '},"mask");'

        // 8. 清理 auto 标记
        + '_ok(function(){'
          + 'var autoBoxes=document.querySelectorAll(".__parser_auto_mark");'
          + 'for(var ab=0;ab<autoBoxes.length;ab++){'
            + 'var b=autoBoxes[ab];if(!b)continue;'
            + 'if(b.__parserAutoEl){b.__parserAutoEl=null;}'
            + 'var dpp=b.getAttribute("data-ppos");'
            + 'if(dpp!==null&&b.parentNode)b.parentNode.style.position=dpp;'
            + 'if(b.parentNode)b.parentNode.removeChild(b);'
          + '}'
        + '},"autoBoxes");'

        // 9. 清理 data-parser-auto 属性
        + '_ok(function(){'
          + 'var autoEls=document.querySelectorAll("[data-parser-auto]");'
          + 'for(var ai=0;ai<autoEls.length;ai++){'
            + 'var ae=autoEls[ai];if(!ae)continue;'
            + 'ae.removeAttribute("data-parser-auto");'
            + 'ae.__parserAutoMarked=false;'
          + '}'
        + '},"autoAttrs");'

        // 10. 重置全局变量
        + '_ok(function(){'
          + 'window.__parserImgOverlays=[];window.__parserScrollBound=false;'
          + 'window.__parserBoxes=[];window.__parserPickedEls=[];'
          + 'window.__parserPicked=[];window.__parserQueue=[];'
          + 'window.__parserAutoMatched=[];window.__parserAutoBoxes=[];'
          + 'window.__parserAutoScrollBound=false;'
        + '},"globals");'

        // 11. 统计残留
        + '_ok(function(){'
          + 'r.remaining=document.querySelectorAll("[data-parser-box]").length;'
        + '},"remaining");'

        + 'return JSON.stringify(r);'
      + '})()');

      var cr = JSON.parse(cleanupResult || '{}');
      if (cr.errors && cr.errors.length > 0) {
        console.warn('[cleanup] partial errors:', cr.errors);
        exitMsg = '已退出(部分清理失败: ' + cr.errors.length + '处)';
      } else {
        console.log('[cleanup] all clean:', cr);
      }
    } catch (e) {
      console.error('[cleanup] executeJavaScript failed:', e.message);
      exitMsg = '已退出(webview清理不可用)';
    }

    // 退出前 flush 未决的自动注册
    if (_autoRegTimer) { clearTimeout(_autoRegTimer); _autoRegTimer = null; }
    if (typeof window.registerElements === 'function') {
      try { await window.registerElements(); } catch(e) {}
    }

    // 无论如何都退出本地状态 — 避免 UI 状态和实际状态不一致的死循环
    S.pickModeActive = false;
    window._lastTreeHighlightSource = null;
    document.getElementById("btnElementPicker").textContent = '元素提取';
    document.getElementById("btnElementPicker").classList.remove('btn-accent');
    document.getElementById("elementPickerBar").classList.add('hidden');
    document.getElementById("elementEditor").classList.add('hidden');
    $('#statusEditor').textContent = '';
    document.getElementById("webviewContainer").style.maxHeight = '';
    // 退出提取时隐藏浮窗（批量/采集跑着时不藏）
    if (!window.Parser.state.batchLoadRunning && !(window.collector && window.collector.active)) {
      var bf = document.getElementById("paginationFloat");
      if (bf) bf.classList.add('hidden');
    }
    setStatus(exitMsg);
    // 退出提取时保存当前页快照（手动翻页后触发，5秒冷却防重复）
    try {
      var wv2 = document.getElementById('webview');
      if (wv2 && S.pickModeActive === false) {
        var now2 = Date.now();
        var last2 = window.__lastSnapshotTime || 0;
        if (now2 - last2 < 3000) {
          console.log('[快照] 退出冷却中，跳过（距上次' + (now2 - last2) + 'ms）');
        } else {
          var snapUrl = ''; try { snapUrl = wv2.getURL(); } catch(_) {}
          var snapHtml = await wv2.executeJavaScript('document.documentElement.outerHTML');
          if (snapHtml && snapHtml.length > 100) {
            await fetch('http://127.0.0.1:' + (window.Parser.state.pythonPort || 19527) + '/api/page-snapshots/save', {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({url: snapUrl, html: snapHtml})
            });
            window.__lastSnapshotTime = now2;
            console.log('[快照] 退出时保存: ' + snapUrl);
          }
        }
      }
    } catch(e) { console.warn('[快照] 退出保存失败:', e.message); }
  }


  // 自动匹配已保存的选择器规则到当前页面（仅画虚线框，不更新编辑器）
  async function autoApplySavedRules() {
    try {
      var allRules = (window.Parser && window.Parser.state && window.Parser.state.savedSelectorRules) || [];
      var currentMode = (window.Parser && window.Parser.state && window.Parser.state._ruleMode) || 'list';
      var rules = allRules.filter(function(r) { return !r.mode || r.mode === currentMode; });
      if (!rules || rules.length === 0) return;
      var webview = document.getElementById("webview");
      var currentUrl = webview.getURL();
      if (!currentUrl || currentUrl === 'about:blank') return;

      var rulesJson = JSON.stringify(rules);
      // 注入滚动探底 + 逐屏匹配的 async 脚本（解决虚拟滚动只渲染视口元素的问题）
      var script = '(async function(rules){' +
        'window.__parserAutoMatched=[];' +
        'window.__parserAutoBoxes=[];' +
        'var _seen={};' +
        'function _dk(el,sel){' +
        'var t=(el.textContent||"").trim().substring(0,200);' +
        'var s=String(typeof el.src==="string"?el.src:(el.getAttribute?(el.getAttribute("src")||""):""));' +
        'var h=String(typeof el.href==="string"?el.href:(el.getAttribute?(el.getAttribute("href")||""):""));' +
        'return sel+"||"+s+"||"+h+"||"+t;' +
        '}' +
        'function _mark(el){' +
        'if(el.__parserAutoMarked)return;' +
        'el.__parserAutoMarked=true;' +
        'el.setAttribute("data-parser-auto","1");' +
        'var re=el.getBoundingClientRect();' +
        'if(re.width===0&&re.height===0)return;' +
        'var tag=(el.tagName||"").toUpperCase();' +
        'var isVoid=tag==="IMG"||tag==="INPUT"||tag==="BR"||tag==="HR"||tag==="SOURCE"||tag==="EMBED"||tag==="AREA";' +
        'var box=document.createElement("div");' +
        'box.className="__parser_auto_mark";' +
        'if(isVoid){' +
          'var parent=el.parentElement;if(!parent)return;' +
          'var oldPPos=parent.style.position;' +
          'box.setAttribute("data-ppos",oldPPos||"");' +
          'if(!oldPPos||oldPPos==="static")parent.style.position="relative";' +
          'var pr=parent.getBoundingClientRect();' +
          'box.style.cssText="position:absolute;pointer-events:none;z-index:2147483636;left:"+(re.left-pr.left)+"px;top:"+(re.top-pr.top)+"px;width:"+re.width+"px;height:"+re.height+"px;border:3px dashed #22c55e;border-radius:2px;box-sizing:border-box;background:rgba(34,197,94,0.08)";' +
          'parent.appendChild(box);' +
        '}else{' +
          'var oldPos=el.style.position;' +
          'box.setAttribute("data-ppos",oldPos||"");' +
          'if(!oldPos||oldPos==="static")el.style.position="relative";' +
          'box.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483636;border:3px dashed #22c55e;border-radius:2px;box-sizing:border-box;background:rgba(34,197,94,0.08)";' +
          'el.appendChild(box);' +
        '}' +
        '}' +
        'function _matchOnce(){' +
        'var found=0;' +
        'for(var i=0;i<rules.length;i++){' +
        'var r=rules[i];' +
        'try{' +
        'var els=document.querySelectorAll(r.selector);' +
        'if(els.length===0){' +
        'var stripped=r.selector.replace(/^#[\\w-]+\\s*>\\s*/,"");' +
        'if(stripped!==r.selector){try{els=document.querySelectorAll(stripped)}catch(e2){}if(els.length>0)r.selector=stripped;}' +
        '}' +
        'if(els.length===0){' +
        'var sel2=r.selector.replace(/--[a-zA-Z0-9_]{5,}(?=[ >\\.]|$)/g,"");' +
        'if(sel2!==r.selector){try{els=document.querySelectorAll(sel2)}catch(e3){}if(els.length>0)r.selector=sel2;}' +
        '}' +
        'for(var j=0;j<els.length;j++){' +
        'var el=els[j];' +
        'var dk=_dk(el,r.selector);' +
        'if(_seen[dk])continue;' +
        '_seen[dk]=true;' +
        '_mark(el);' +
        'found++;' +
        'window.__parserAutoMatched.push({' +
        '"tag":(el.tagName||"").toLowerCase(),' +
        '"css":r.selector,' +
        '"text":(el.textContent||"").trim().substring(0,500),' +
        '"class":String(typeof el.className==="string"?el.className:""),' +
        '"id":String(el.id||""),' +
        '"href":String(typeof el.href==="string"?el.href:(el.getAttribute?(el.getAttribute("href")||""):"")),' +
        '"src":String(typeof el.src==="string"?el.src:(el.getAttribute?(el.getAttribute("src")||""):"")),' +
        '"outerHTML":(el.outerHTML||"").substring(0,5000),' +
        '"xpath":""' +
        '});' +
        '}' +
        '}catch(e){}' +
        '}' +
        'return found;' +
        '}' +
        // 滚动探底循环（A+B：静默滚动 + 遮罩掩盖）
        'var totalFound=0;' +
        'var maxSteps=40;' +
        'var noNewCount=0;' +
        // 保存原始位置
        'var origScrollX=window.scrollX||window.pageXOffset||0;' +
        'var origScrollY=window.scrollY||window.pageYOffset||0;' +
        // 遮罩层
        'var mask=document.createElement("div");' +
        'mask.id="__parser_scan_mask";' +
        'mask.style.cssText="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483645;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;pointer-events:none";' +
        'mask.innerHTML="<div style=\\"background:rgba(0,0,0,0.8);color:#fff;padding:16px 32px;border-radius:8px;font-size:16px;font-family:sans-serif\\">🔍 正在扫描页面元素...</div>";' +
        'document.body.appendChild(mask);' +
        // 禁用平滑滚动
        'var origScrollBehavior=document.documentElement.style.scrollBehavior;' +
        'document.documentElement.style.scrollBehavior="auto";' +
        'var pageH=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight||0);' +
        'for(var step=0;step<maxSteps;step++){' +
          'var found=_matchOnce();' +
          'totalFound+=found;' +
          'if(found===0){noNewCount++;}else{noNewCount=0;}' +
          'if(noNewCount>=3)break;' +
          'var before=window.scrollY||window.pageYOffset||0;' +
          'var maxScroll=(document.documentElement.scrollHeight||pageH)-window.innerHeight;' +
          'if(before>=maxScroll-5)break;' +
          'window.scrollBy(0,Math.floor(window.innerHeight*0.75));' +
          'var after=window.scrollY||window.pageYOffset||0;' +
          'if(after<=before)break;' +
          'await new Promise(function(resolve){setTimeout(resolve,350);});' +
          'pageH=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight||pageH);' +
        '}' +
        // 恢复滚动位置和样式
        'window.scrollTo(origScrollX,origScrollY);' +
        'document.documentElement.style.scrollBehavior=origScrollBehavior;' +
        // 移除遮罩
        'if(mask.parentNode)mask.parentNode.removeChild(mask);' +
        'return totalFound;' +
      '})(' + rulesJson + ')';

      var scrolledFound = await webview.executeJavaScript(script);
      var finalCount = 0;
      try { finalCount = await webview.executeJavaScript('(window.__parserAutoMatched||[]).length'); } catch(e) {}
      console.log('[自动匹配诊断] scrolledFound=' + scrolledFound + ' finalCount=' + finalCount + ' rulesLen=' + rules.length);
      if (finalCount > 0) { setStatus('已自动匹配 ' + finalCount + ' 个规则元素（滚屏探底完成）'); _scheduleAutoRegister(); }
    } catch(e) {}
  }

  // 点击编辑列表条目 → 页面定位该元素并临时高亮（支持虚拟滚动探底）
  async function highlightElementOnPage(selector, tag, xpath) {
    try {
      await document.getElementById("webview").executeJavaScript('(async function(sel,t,xp){'
        + 'try{'
        // 画高亮框
        + 'function _hl(el){'
          + 'var b=document.createElement("div");'
          + 'b.setAttribute("data-parser-box","1");'
          + 'b.className="__parser_temp_hl";'
          + 'var tg=el.tagName.toUpperCase();'
          + 'var isVoid=tg==="IMG"||tg==="INPUT"||tg==="BR"||tg==="HR"||tg==="SOURCE"||tg==="EMBED"||tg==="AREA";'
          + 'if(!isVoid){'
            + 'var oldPos=el.style.position;b.setAttribute("data-ppos",oldPos||"");if(!oldPos||oldPos==="static")el.style.position="relative";'
            + 'b.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483642;border:3px solid #7c5cfc;border-radius:3px;background:rgba(124,92,252,0.15);transition:opacity 0.3s";'
            + 'el.appendChild(b);'
          + '}else{'
            + 'var parent=el.parentElement;if(!parent)return;'
            + 'var oldPPos=parent.style.position;b.setAttribute("data-ppos",oldPPos||"");if(!oldPPos||oldPPos==="static")parent.style.position="relative";'
            + 'var er=el.getBoundingClientRect();var pr=parent.getBoundingClientRect();'
            + 'b.style.cssText="position:absolute;left:"+(er.left-pr.left)+"px;top:"+(er.top-pr.top)+"px;width:"+er.width+"px;height:"+er.height+"px;pointer-events:none;z-index:2147483642;border:3px solid #7c5cfc;border-radius:3px;background:rgba(124,92,252,0.15);transition:opacity 0.3s";'
            + 'parent.appendChild(b);'
          + '}'
          + 'setTimeout(function(){b.style.opacity="0";setTimeout(function(){if(b.parentNode){var op=b.getAttribute("data-ppos");if(op!==null)b.parentNode.style.position=op;b.parentNode.removeChild(b);}},300);},1500);'
        + '}'
        // 查找元素
        + 'function _find(){'
          + 'var el=document.querySelector(sel);'
          + 'if(!el&&xp){try{el=document.evaluate(xp,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;}catch(e){}}'
          + 'return el;'
        + '}'
        + 'var el=_find();'
        // 虚拟滚动探底：找不到就逐屏滚
        + 'if(!el){'
          + 'document.documentElement.style.scrollBehavior="auto";'
          + 'var origY=window.scrollY||0;'
          + 'for(var step=0;step<30&&!el;step++){'
            + 'var before=window.scrollY||0;'
            + 'var maxScroll=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight||0)-window.innerHeight;'
            + 'if(before>=maxScroll-5)break;'
            + 'window.scrollBy(0,Math.floor(window.innerHeight*0.7));'
            + 'var after=window.scrollY||0;'
            + 'if(after<=before)break;'
            + 'await new Promise(function(r){setTimeout(r,300);});'
            + 'el=_find();'
          + '}'
          + 'if(!el){window.scrollTo(0,origY);return;}'
        + '}'
        + 'el.scrollIntoView({behavior:"smooth",block:"center"});'
        + '_hl(el);'
        + '}catch(e){}'
        + '})(' + JSON.stringify(selector) + ',' + JSON.stringify(tag) + ')');
    } catch (e) {}
  }

  // 清理箱点击轮询
  function stopBoxClickPoll() {
    if (window._boxClickPollTimer) {
      clearInterval(window._boxClickPollTimer);
      window._boxClickPollTimer = null;
    }
  }

  async function autoPickSimilar() {
    if (!S.pickModeActive) return;

    // 搜集样本来源：手动选取 + 保存规则自动匹配（绿虚线框）
    var raw = '';
    try {
      raw = await document.getElementById("webview").executeJavaScript(
        'JSON.stringify({picked:window.__parserPicked||[],auto:window.__parserAutoMatched||[]})'
      );
    } catch(e) {}
    var samples = JSON.parse(raw || '{}');
    var picked = samples.picked || [];
    var autoMatched = samples.auto || [];

    // 收集所有样本选择器（去重）
    var sampleCssList = [];
    var seenCss = {};
    picked.forEach(function(p) {
      if (p.css && !seenCss[p.css]) { seenCss[p.css] = true; sampleCssList.push(p.css); }
    });
    // 绿框样本：用 autoMatched 元素自己的 CSS（从已保存规则来），也尝试从元素生成选择器
    var autoSelectors = [];
    var seenAuto = {};
    autoMatched.forEach(function(a) {
      if (a.css && !seenAuto[a.css]) {
        seenAuto[a.css] = true;
        autoSelectors.push(a.css);
        if (!seenCss[a.css]) { seenCss[a.css] = true; sampleCssList.push(a.css); }
      }
    });

    if (sampleCssList.length === 0) {
      setStatus('请先在页面中点击选取元素，或加载保存规则以自动匹配');
      return;
    }

    // 生成"干净"选择器（去 #id 和 :nth-of-type）
    var cleanList = [];
    var seenClean = {};
    sampleCssList.forEach(function(css) {
      var clean = css.replace(/#[a-zA-Z][\w-]*/g, '').replace(/:nth-of-type\(\d+\)/g, '').replace(/\s*>\s*/g, ' > ').replace(/^\s*>\s*/, '').trim();
      if (clean && !seenClean[clean]) { seenClean[clean] = true; cleanList.push({clean: clean, original: css}); }
    });

    // 追加到现有查询（跨页累积），去重
    var queryInput = document.getElementById("queryInput");
    var existing = queryInput.value.trim();
    var allSelectors = existing ? existing.split(/,\s*/).filter(Boolean) : [];
    var existingSet = {};
    allSelectors.forEach(function(s) { existingSet[s.trim()] = true; });
    cleanList.forEach(function(c) {
      if (!existingSet[c.clean]) {
        existingSet[c.clean] = true;
        allSelectors.push(c.clean);
      }
    });
    var merged = allSelectors.join(', ');
    queryInput.value = merged;
    // 同时加入剪贴板（容错：writeClipboard 可能不可用）
    if (merged) {
      try { window._addToClipboard(merged, '自动识别'); } catch(e) {}
    }

    var matchedItems = [];
    try {
      var matchJson = await document.getElementById("webview").executeJavaScript('(async function(samples){' +
        // 注入高亮动画样式（一次性）
        'var _hlStyle=document.getElementById("__parser_hl_anim");if(!_hlStyle){_hlStyle=document.createElement("style");_hlStyle.id="__parser_hl_anim";_hlStyle.textContent="@keyframes __parser_hl_pulse{0%,100%{opacity:0.85;transform:scale(1)}50%{opacity:1;transform:scale(1.02)}}";document.head.appendChild(_hlStyle);}' +
        // 清理旧高亮浮层
        'var oldOv=document.querySelectorAll(".__parser_auto_overlay");for(var oo=0;oo<oldOv.length;oo++){var ov=oldOv[oo];if(ov.parentNode){var op=ov.getAttribute("data-ppos");if(op!==null)ov.parentNode.style.position=op;ov.parentNode.removeChild(ov);}}' +
        // highlightEl
        'var _hlCount=0;function highlightEl(el,isTemplate){var ov=document.createElement("div");ov.className="__parser_auto_overlay";ov.setAttribute("data-parser-box","1");var tag=el.tagName.toUpperCase();var isVoid=tag==="IMG"||tag==="INPUT"||tag==="BR"||tag==="HR"||tag==="SOURCE"||tag==="EMBED"||tag==="AREA";var re=el.getBoundingClientRect();if(re.width===0&&re.height===0)return;' +
        'var borderColor=isTemplate?"#f59e0b":"#a78bfa";var bgColor=isTemplate?"rgba(245,158,11,0.22)":"rgba(167,139,250,0.18)";' +
        'if(isVoid){' +
          // void 元素：浮层插入父节点，用 absolute 相对定位，不随滚动/鼠标偏移
          'var parent=el.parentElement;if(!parent){_hlCount++;return;}' +
          'var oldPPos=parent.style.position;ov.setAttribute("data-ppos",oldPPos||"");' +
          'if(!oldPPos||oldPPos==="static")parent.style.position="relative";' +
          'var pr=parent.getBoundingClientRect();' +
          'ov.style.cssText="position:absolute;pointer-events:none;z-index:2147483640;left:"+(re.left-pr.left)+"px;top:"+(re.top-pr.top)+"px;width:"+re.width+"px;height:"+re.height+"px;border:4px solid "+borderColor+";border-radius:4px;box-sizing:border-box;background:"+bgColor+";box-shadow:0 0 12px rgba(167,139,250,0.3),0 0 24px rgba(167,139,250,0.15);animation:__parser_hl_pulse 1s ease-in-out";' +
          'parent.appendChild(ov);' +
          'el.__parserBox=ov;' +
        '}else{var oldPos=el.style.position;ov.setAttribute("data-ppos",oldPos||"");if(!oldPos||oldPos==="static")el.style.position="relative";ov.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483640;border:4px solid "+borderColor+";border-radius:4px;box-sizing:border-box;background:"+bgColor+";box-shadow:0 0 12px rgba(167,139,250,0.3),0 0 24px rgba(167,139,250,0.15);animation:__parser_hl_pulse 1s ease-in-out";el.appendChild(ov);el.__parserBox=ov}_hlCount++;}' +
        // extractInfo
        'function extractInfo(el){var cssPath="",xpath="";try{var cur=el;var parts2=[];var xpParts=[];for(var d=0;d<5&&cur&&cur!==document.body&&cur!==document.documentElement;d++){var t2=cur.tagName.toLowerCase();if(cur.id){parts2.unshift("#"+cur.id);xpParts.unshift("*[@id=\\""+cur.id+"\\"]");break}var cls3=(typeof cur.className==="string"?cur.className:"").trim().split(/\\s+/).filter(Boolean).slice(0,2);if(cls3.length)t2+="."+cls3.join(".");var pa=cur.parentElement;if(pa){var sibs=Array.from(pa.children).filter(function(x){return x.tagName===cur.tagName});if(sibs.length>1){var idx2=sibs.indexOf(cur)+1;t2+=":nth-of-type("+idx2+")"}var xpTag=t2.replace(/:.*/,"");if(sibs.length>1)xpTag+="["+idx2+"]";xpParts.unshift(xpTag)}else{xpParts.unshift(t2.replace(/:.*/,""))}parts2.unshift(t2);cur=pa}cssPath=parts2.join(" > ");if(xpParts.length)xpath="//"+xpParts.join("/")}catch(ex){}var cnt=0;try{cnt=document.querySelectorAll(cssPath).length}catch(e){}var info={tag:el.tagName.toLowerCase(),css:cssPath||"",xpath:xpath,count:cnt,text:(el.textContent||"").trim().substring(0,500)};var attrs=el.attributes;for(var ai=0;ai<attrs.length;ai++){var a=attrs[ai];if(a.name&&a.value!==undefined)info[a.name]=a.value||"";}return info;}' +
                // 核心：遍历样本、找标本、查同类、去重（滚屏探底版）
        // 保存原始滚动位置
        'var origSX=window.scrollX||window.pageXOffset||0;' +
        'var origSY=window.scrollY||window.pageYOffset||0;' +
        // 遮罩
        'var mask=document.createElement("div");mask.id="__parser_scan_mask";' +
        'mask.style.cssText="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483645;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;pointer-events:none";' +
        'mask.innerHTML="<div style=\\"background:rgba(0,0,0,0.8);color:#fff;padding:16px 32px;border-radius:8px;font-size:16px;font-family:sans-serif\\">🔍 正在识别同类元素...</div>";' +
        'document.body.appendChild(mask);' +
        'var origScrollBehavior=document.documentElement.style.scrollBehavior;' +
        'document.documentElement.style.scrollBehavior="auto";' +
        'var result=[];' +
        'var resultKeys={};' +
        // 先找标本（不和滚屏一起，标本用 original 选择器精确定位）
        'for(var si2=0;si2<samples.length;si2++){' +
          'var s2=samples[si2];' +
          'var tEl=null;try{tEl=document.querySelector(s2.original)}catch(e){}' +
          'if(tEl){' +
            'highlightEl(tEl,true);' +
            'var info2=extractInfo(tEl);' +
            'var dk=(info2.css||"")+"||"+(info2.src||"")+"||"+(info2.href||"")+info2.text.substring(0,80);' +
            'if(!resultKeys[dk]){resultKeys[dk]=true;result.push(info2);}' +
          '}' +
        '}' +
        // 滚屏匹配同类（用干净选择器）
        'var pageH=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight||0);' +
        'var noNewCount=0;' +
        'for(var step=0;step<40;step++){' +
          'var foundThisStep=0;' +
          'for(var si=0;si<samples.length;si++){' +
            'var s=samples[si];' +
            'var els=[];try{els=document.querySelectorAll(s.clean)}catch(e){}' +
            'for(var i=0;i<els.length;i++){var el=els[i];' +
              'var inf=extractInfo(el);' +
              'var dk2=(inf.css||"")+"||"+(inf.src||"")+"||"+(inf.href||"")+inf.text.substring(0,80);' +
              'if(!resultKeys[dk2]){resultKeys[dk2]=true;' +
                'highlightEl(el,false);' +
                'result.push(inf);' +
                'foundThisStep++;' +
              '}' +
            '}' +
          '}' +
          'if(foundThisStep===0){noNewCount++;}else{noNewCount=0;}' +
          'if(noNewCount>=3)break;' +
          'var before=window.scrollY||window.pageYOffset||0;' +
          'var maxScroll=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight||pageH)-window.innerHeight;' +
          'if(before>=maxScroll-5)break;' +
          'window.scrollBy(0,Math.floor(window.innerHeight*0.75));' +
          'var after=window.scrollY||window.pageYOffset||0;' +
          'if(after<=before)break;' +
          'await new Promise(function(resolve){setTimeout(resolve,350);});' +
          'pageH=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight||pageH);' +
        '}' +
        // 恢复
        'window.scrollTo(origSX,origSY);' +
        'document.documentElement.style.scrollBehavior=origScrollBehavior;' +
        'if(mask.parentNode)mask.parentNode.removeChild(mask);' +
        'return JSON.stringify({total:result.length,items:result,highlighted:_hlCount,samples:samples.length});' +
      '})(' + JSON.stringify(cleanList) + ')');
      var matchData = JSON.parse(matchJson || '{}');
      matchedItems = matchData.items || [];
      console.log('[autoPick] matched=' + matchedItems.length + ' highlighted=' + (matchData.highlighted||0) + ' samples=' + (matchData.samples||0));
    } catch(e) {
      console.error('[autoPick] error:', e.message || e, String(e));
      // 也发到后端终端
      try { fetch('http://127.0.0.1:' + (window.Parser.state.pythonPort||19527) + '/api/page-snapshots/save', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:'debug://autoPick/error', html:'[autoPick error] '+(e.message||String(e))}) }).catch(function(){}) } catch(_) {}
      setStatus('识别失败: ' + (e.message || String(e)).substring(0, 60));
      return;
    }
    if (matchedItems.length === 0) { setStatus('未找到同类元素'); return; }
    var autoAdded = 0;
    matchedItems.forEach(function(info) {
      addToEditor(info, info.css || '', 'auto');
      autoAdded++;
    });
    if (_editorRenderTimer) { clearTimeout(_editorRenderTimer); _editorRenderTimer = null; }
    updatePickedElementsFromEditor();
    renderElementEditor();
    updatePickedTreeNodes();
    showPickedElementsPanel('auto');
    var srcLabel = autoSelectors.length > 0 ? ('手动' + picked.length + '+绿框' + autoSelectors.length + '规则') : ('手动' + picked.length);
    setStatus('识别完成：' + srcLabel + ' → 匹配 ' + autoAdded + ' 个同类元素');
  }

  async function exportPicked() {
    updatePickedElementsFromEditor();
    if (S.pickedElements.length === 0) { setStatus('没有已选元素'); return; }
    S.queryResults = S.pickedElements;
    await exportToExcel();
  }

  function updatePickedCount() { document.getElementById("pickedCount").textContent = '已选: ' + S.pickedElements.length + ' 项'; }

  // ──────── 增强的元素提取事件绑定 ────────
  function bindEnhancedPickerEvents() {
    // 1. 模式切换：点选/框选/穿透
    document.getElementById("btnPickModeClick").addEventListener('click', function () { setPickMode('click'); });
    document.getElementById("btnPickModeDrag").addEventListener('click', function () { setPickMode('drag'); });
    document.getElementById("btnPickModeNested").addEventListener('click', function () { setPickMode('nested'); });

    // 2. 管理已选按钮 — 同时展开编辑器和中间面板
    document.getElementById("btnManagePicked").addEventListener('click', function () {
      document.getElementById("elementEditor").classList.remove('hidden');
      // 首次打开时给一个合理高度（约 5 行）
      if (!document.getElementById("elementEditor").style.height || document.getElementById("elementEditor").style.height === '0px') {
        document.getElementById("elementEditor").style.height = Math.min(window.innerHeight * 0.8, 360) + 'px';
        document.getElementById("elementEditor").style.maxHeight = 'none';
      }
      document.getElementById("elementEditor").offsetHeight; // 强制布局
      updatePickedTreeNodes();
      renderElementEditor();
      showPickedElementsPanel(null);
    });

    // 3. 编辑器按钮
    document.getElementById("btnEditorClose").addEventListener('click', function () { document.getElementById("elementEditor").classList.add('hidden'); $('#statusEditor').textContent = ''; document.getElementById("webviewContainer").style.maxHeight = ''; });
    var btnEditorSave = document.getElementById("btnEditorSave");
    if (btnEditorSave) btnEditorSave.addEventListener('click', saveSelectorRules);
    var btnBarSave = document.getElementById("btnBarSaveRules");
    if (btnBarSave) btnBarSave.addEventListener('click', saveSelectorRules);
    document.getElementById("btnEditorRematchAll").addEventListener('click', rematchAllSelectors);
    // 注册已改为自动触发，保留编辑器里的注册按钮供手动补漏

    // 批量提取配置已移到弹框里，此处只初始化默认值
    S.batchExtractMode = S.batchExtractMode || 'rules';

    // 3. 编辑器拖拽调整高度
    var editorResize = $('#editorResize');
    var editorResizeStart = 0, editorResizeStartH = 0;
    editorResize.addEventListener('mousedown', function (e) {
      e.preventDefault();
      editorResize.classList.add('active');
      editorResizeStart = e.clientY;
      editorResizeStartH = document.getElementById("elementEditor").offsetHeight;
      document.getElementById("elementEditor").style.flex = 'none';
      // 拖拽期间禁用 body 滚动，避免滚动条和拖拽打架
      var body = document.getElementById("elementEditorBody");
      body.style.overflowY = 'hidden';
      document.addEventListener('mousemove', onEditorResize);
      document.addEventListener('mouseup', onEditorResizeEnd);
      function onEditorResizeEnd() {
        body.style.overflowY = '';  // 清除 inline，恢复 CSS 默认
        editorResize.classList.remove('active');
        document.removeEventListener('mousemove', onEditorResize);
        document.removeEventListener('mouseup', onEditorResizeEnd);
      }
    });
    function onEditorResize(e) {
      var delta = editorResizeStart - e.clientY;
      var newH = Math.max(60, Math.min(window.innerHeight * 0.8, editorResizeStartH + delta));
      document.getElementById("elementEditor").style.height = newH + 'px';
      document.getElementById("elementEditor").style.maxHeight = 'none';
    }
    // 4. 选择器弹框
    document.getElementById("btnSelectorCancel").addEventListener('click', function () { document.getElementById("selectorModal").classList.add('hidden'); });
    document.getElementById("btnSelectorModalClose").addEventListener('click', function () { document.getElementById("selectorModal").classList.add('hidden'); });

    // 5. 层级穿透弹框
    document.getElementById("btnNestedCancel").addEventListener('click', function () { document.getElementById("nestedModal").classList.add('hidden'); });
    document.getElementById("btnNestedModalClose").addEventListener('click', function () { document.getElementById("nestedModal").classList.add('hidden'); });

    // 6. 点击模态框外部关闭
    document.getElementById("selectorModal").addEventListener('mousedown', function (e) {
      if (e.target === document.getElementById("selectorModal")) document.getElementById("selectorModal").classList.add('hidden');
    });
    document.getElementById("nestedModal").addEventListener('mousedown', function (e) {
      if (e.target === document.getElementById("nestedModal")) document.getElementById("nestedModal").classList.add('hidden');
    });

    // 6b. 合并/拆分统一弹框
    var pickerModal = $('#pickerModal');
    var btnPickerClose = $('#btnPickerClose');
    var btnPickerCancel = $('#btnPickerCancel');
    var btnPickerConfirm = $('#btnPickerConfirm');
    // 按钮事件已通过 HTML onclick 绑定到 window._xxx
    if (pickerModal) pickerModal.addEventListener('mousedown', function (e) {
      if (e.target === pickerModal) hidePicker();
    });

    // 7. 页面加载完成 → 清理旧选择状态 / 提取模式下重新注入
    document.getElementById("webview").addEventListener('did-finish-load', function () {
      if (S.pickModeActive) {
        // 提取模式中刷新/跳转 → 清空旧页编辑器数据，重新注入选择脚本
        console.log('[翻页重注] 页面加载完成，pickModeActive=true，重新注入');
        S.editorItems = [];
        _startPickLock = false;  // 释放锁，允许在新页面重新注入
        startPickMode().catch(function(e) { console.error('重注失败:', e); });
      } else {
        S.editorItems = [];
        document.getElementById("elementEditor").classList.add('hidden');
        $('#statusEditor').textContent = '';
        stopBoxClickPoll();
      }
    });

    // 8. document.getElementById("webview") 内选择事件监听（通过轮询）

  }

  function setPickMode(mode) {
    S.pickModeType = mode;
    [document.getElementById("btnPickModeClick"), document.getElementById("btnPickModeDrag"), document.getElementById("btnPickModeNested")].forEach(function (b) { b.classList.remove('active'); });
    var btn = { click: document.getElementById("btnPickModeClick"), drag: document.getElementById("btnPickModeDrag"), nested: document.getElementById("btnPickModeNested") }[mode];
    if (btn) btn.classList.add('active');
    setStatus('模式: ' + { click: '点选', drag: '框选', nested: '穿透' }[mode]);
  }

  // ──────── 自适应选择器弹框 ────────
  function showAdaptiveSelectors(elementInfo, callback) {
    if (!elementInfo || !elementInfo.selectors) return;
    var selectors = elementInfo.selectors;

    // 构建元素信息表格（与 query 表格样式一致）
    var infoFields = [];
    var fieldDefs = [
      { key: '标签', val: '<' + (elementInfo.tag || '?') + '>' },
      { key: '文本/链接', val: elementInfo.text || '' },
      { key: 'XPath', val: elementInfo.xpath || '' },
      { key: 'CSS选择器', val: elementInfo.css || selectors[0].selector || '' },
      { key: '类名', val: elementInfo.class || elementInfo.className || '' },
      { key: 'ID', val: elementInfo.id || '' },
      { key: '链接', val: elementInfo.href || '' },
      { key: '来源', val: elementInfo.src || '' },
      { key: '标题', val: elementInfo.title || '' },
    ];
    fieldDefs.forEach(function(f) { if (f.val) infoFields.push(f); });
    // 额外属性
    var BASIC_KEYS = ['tag','text','xpath','css','class','className','id','href','src','title','selectors'];
    for (var ek in elementInfo) {
      if (elementInfo.hasOwnProperty(ek) && elementInfo[ek] && BASIC_KEYS.indexOf(ek) === -1) {
        infoFields.push({ key: ek, val: String(elementInfo[ek]) });
      }
    }

    var titleHtml = '<table class="result-table" style="margin-bottom:8px"><tbody>';
    infoFields.forEach(function(f) {
      var isLong = f.val.length > 30;
      var valHtml = isLong
        ? '<span class="cell-expand" onclick="this.classList.toggle(\'expanded\')" title="点击展开/收起">' + escapeHtml(f.val) + '</span>'
        : escapeHtml(f.val);
      titleHtml += '<tr><td style="width:70px;font-weight:600;color:var(--accent);padding:3px 8px;white-space:nowrap;font-size:11px;border-bottom:1px solid var(--border)">' + escapeHtml(f.key) + '</td>' +
        '<td style="padding:3px 8px;max-width:400px;border-bottom:1px solid var(--border);font-size:11px">' + valHtml + '</td></tr>';
    });
    titleHtml += '</tbody></table>';

    // 构建选择器列表
    document.getElementById("selectorOptions").innerHTML = titleHtml + '<div id="__selector_list">' +
      selectors.map(function (opt, idx) {
        return '<div class="selector-option" data-idx="' + idx + '" data-sel="' + escapeHtml(opt.selector) + '" style="cursor:pointer;flex-wrap:wrap">' +
          '<div style="display:flex;align-items:center;gap:10px;width:100%">' +
            '<span class="selector-option-preview">' + escapeHtml(opt.selector) + '</span>' +
            '<span class="selector-option-label">' + escapeHtml(opt.label || '') + '</span>' +
            '<span class="selector-option-count" id="__sel_count_' + idx + '">查询中...</span>' +
          '</div>' +
          '<div class="selector-option-matches" id="__sel_matches_' + idx + '" style="margin-top:4px;font-size:11px;color:var(--text-dim);display:none;width:100%"></div>' +
          '</div>';
      }).join('') + '</div>';

    // 点击选中
    document.getElementById("selectorOptions").querySelectorAll('.selector-option').forEach(function (optEl) {
      optEl.addEventListener('click', function () {
        var sel = optEl.dataset.sel;
        document.getElementById("selectorOptions").querySelectorAll('.selector-option').forEach(function (o) { o.classList.remove('selected'); });
        optEl.classList.add('selected');
        if (callback) callback(sel);
        document.getElementById("selectorModal").classList.add('hidden');
      });
    });

    document.getElementById("selectorModal").classList.remove('hidden');

    // 异步查匹配数
    selectors.forEach(function (opt, idx) {
      document.getElementById("webview").executeJavaScript('(function(sel){'
        + 'try{var els=document.querySelectorAll(sel);'
        + 'var samples=[];'
        + 'for(var i=0;i<Math.min(els.length,3);i++){'
          + 'samples.push({t:els[i].tagName.toLowerCase(),'
            + 'txt:(els[i].textContent||"").trim().substring(0,50)});'
        + '}'
        + 'return JSON.stringify({cnt:els.length,smpl:samples});'
        + '}catch(e){return JSON.stringify({cnt:0,smpl:[]});}'
        + '})(' + JSON.stringify(opt.selector) + ')')
      .then(function (raw) {
        var data = JSON.parse(raw || '{}');
        var cntEl = document.getElementById('__sel_count_' + idx);
        var matchEl = document.getElementById('__sel_matches_' + idx);
        if (cntEl) cntEl.textContent = data.cnt + ' 匹配';
        if (matchEl && data.smpl && data.smpl.length > 0) {
          matchEl.style.display = '';
          matchEl.innerHTML = data.smpl.map(function (s) {
            return '<span style="color:var(--text-dim)">&lt;<span style="color:var(--accent)">' + escapeHtml(s.t) + '</span>&gt;</span> ' + escapeHtml(s.txt);
          }).join('<br>');
        }
      })
      .catch(function () {
        var cntEl = document.getElementById('__sel_count_' + idx);
        if (cntEl) cntEl.textContent = '查询失败';
      });
    });
  }

  // ──────── 层级穿透弹框 ────────
  function showNestedPicker(elements, x, y) {
    if (!elements || elements.length <= 1) return;
    document.getElementById("nestedOptions").innerHTML = '';

    elements.forEach(function (elInfo, idx) {
      var optEl = document.createElement('div');
      optEl.className = 'selector-option';

      var tagHtml = '<span style="color:var(--accent);font-weight:600">&lt;' + escapeHtml(elInfo.tag) + '&gt;</span>';
      var extra = '';
      if (elInfo.id) extra += ' id="' + escapeHtml(elInfo.id.substring(0, 30)) + '"';
      if (elInfo.cls) extra += ' class="' + escapeHtml(elInfo.cls.substring(0, 40)) + '"';

      // 优先使用注入脚本中已生成的 cssPath
      var cssPath = elInfo.cssPath || elInfo.tag;
      if (!elInfo.cssPath) {
        if (elInfo.id) cssPath = '#' + elInfo.id;
        else if (elInfo.cls) {
          var firstCls = elInfo.cls.split(' ')[0];
          if (firstCls) cssPath = elInfo.tag + '.' + firstCls;
        }
      }

      optEl.innerHTML =
        '<span class="selector-option-preview">' + tagHtml + '<span style="color:var(--text-dim);font-size:11px">' + escapeHtml(extra) + '</span></span>' +
        '<span class="selector-option-label" style="padding:1px 6px;font-size:10px">层级 ' + idx + '</span>' +
        '<span class="selector-option-meta" title="' + escapeHtml(elInfo.text || '') + '" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml((elInfo.text || '').substring(0, 30)) + '</span>';

      optEl.addEventListener('click', function () {
        // 使用 CSS 路径精确定位元素（mask 有 pointer-events:none，无需处理）
        document.getElementById("webview").executeJavaScript('(function(cssPath){'
          + 'var el=document.querySelector(cssPath);'
          + 'if(!el||el===document.body||el===document.documentElement)return;'
          + 'if(el.__parserPicked)return;'
          + 'var fn=new Function("return window.__parserPickEl")();'
          + 'if(typeof fn==="function"){fn(el,cssPath);}'
          + 'else{'
            + 'el.__parserPicked=true;'
            + 'if(!el.style.position||el.style.position==="static")el.style.position="relative";'
            + 'var b=document.createElement("div");'
            + 'b.setAttribute("data-parser-box","1");'
            + 'b.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483643;border:2px solid #4ade80;border-radius:2px;box-sizing:border-box;background:rgba(74,222,128,0.08)";'
            + 'el.appendChild(b);'
            + 'if(!window.__parserBoxes)window.__parserBoxes=[];'
            + 'window.__parserBoxes.push(b);'
            + 'el.__parserBox=b;'
            + 'if(!window.__parserPickedEls)window.__parserPickedEls=[];'
            + 'window.__parserPickedEls.push(el);'
            + 'var cnt;try{cnt=document.querySelectorAll(cssPath).length;}catch(e){cnt=0;}'
            + 'var info={tag:el.tagName.toLowerCase(),css:cssPath,count:cnt,text:(el.textContent||"").trim().substring(0,2000)};var attrs=el.attributes;for(var ai=0;ai<attrs.length;ai++){var a=attrs[ai];if(a.name&&a.value!==undefined)info[a.name]=a.value||"";}window.__parserPicked.push(info);'
          + '}'
        + '})(' + JSON.stringify(cssPath) + ')');

        // 加入编辑器
        addToEditor({
          tag: elInfo.tag, css: cssPath, count: 1,
          text: elInfo.text || '', class: elInfo.cls || '',
          id: elInfo.id || '', href: '', src: '',
          selectors: [{ selector: cssPath, label: '选中' }]
        }, cssPath);

        document.getElementById("nestedModal").classList.add('hidden');
      });
      document.getElementById("nestedOptions").appendChild(optEl);
    });

    document.getElementById("nestedModal").classList.remove('hidden');
  }

  // ──────── 合并/拆分统一弹框 ────────
  var pickerMode = '';       // 'merge' | 'split'
  var pickerSourceIdx = -1;
  var pickerChildren = [];   // 当前 tab 候选 [{tag,text,css,isInline,checked,isCurrent}]
  var pickerInlineIndices = []; // 内联 tab 对应的 children 下标
  var pickerCurrentTab = 'inline';
  var _pickerSameContainer = []; // 同容器数据（切换到内联时恢复）
  var _pickerAllItems = [];      // 全部已选元素（用于"全部"tab）
  var _pickerManualItems = [];   // 手动输入的元素（用于"手动"tab）

  function hidePicker() {
    $('#pickerModal').classList.add('hidden');
    pickerMode = '';
    pickerSourceIdx = -1;
    pickerChildren = [];
    pickerInlineIndices = [];
    pickerCurrentTab = 'inline';
    _pickerSameContainer = [];
    _pickerAllItems = [];
    _pickerManualItems = [];
  }
  window._hidePicker = hidePicker;

  function renderPickerList() {
    var listEl = $('#pickerList');
    if (!listEl) return;
    // 手动 tab：输入界面
    if (pickerCurrentTab === 'manual') {
      var manualHl = '<div style="margin-bottom:8px">' +
        '<div style="display:flex;gap:6px;margin-bottom:6px">' +
          '<input id="manualSelectorInput" type="text" placeholder="输入 CSS 选择器或 XPath…" onkeydown="if(event.key===\'Enter\')window._manualAddFromInput()" style="flex:1;height:28px;padding:0 8px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:Consolas,monospace">' +
          '<button class="btn btn-sm btn-accent" style="flex-shrink:0" onclick="window._manualAddFromInput()">添加</button>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-dim)">已添加 ' + pickerChildren.length + ' 个元素</div>' +
      '</div>';
      if (pickerChildren.length > 0) {
        manualHl += '<div style="max-height:200px;overflow-y:auto">';
        for (var mi = 0; mi < pickerChildren.length; mi++) {
          var mch = pickerChildren[mi];
          manualHl += '<label class="selector-option" style="display:flex;align-items:center;gap:10px;cursor:pointer">' +
            '<input type="checkbox" class="picker-cb" data-mi="' + mi + '"' + (mch.checked ? ' checked' : '') + '>' +
            '<span style="flex:1;font-size:12px">' + escapeHtml(mch.tag) + ' ' + escapeHtml((mch.text || '').substring(0, 40)) + '</span>' +
            '<span style="font-size:10px;color:var(--text-dim)">' + escapeHtml((mch.css || '').substring(0, 50)) + '</span>' +
            '<button class="btn btn-xs" style="color:var(--red);background:transparent;border:none;cursor:pointer;font-size:11px" title="移除" onclick="window._manualRemoveItem(' + mi + ')">×</button>' +
            '</label>';
        }
        manualHl += '</div>';
      }
      listEl.innerHTML = manualHl;
      setTimeout(function () {
        listEl.querySelectorAll('.picker-cb').forEach(function (cb) {
          cb.addEventListener('change', function() {
            var mi = parseInt(cb.dataset.mi);
            if (pickerChildren[mi]) pickerChildren[mi].checked = cb.checked;
            updatePickerPreview();
          })
        });
      }, 30);
      return;
    }
    // 内联/全部 tab：复选框列表
    var indices = pickerCurrentTab === 'inline' ? pickerInlineIndices : pickerChildren.map(function(_, i) { return i; });
    var hl = '';
    for (var j = 0; j < indices.length; j++) {
      var i = indices[j];
      var ch = pickerChildren[i];
      hl += '<label class="selector-option" style="display:flex;align-items:center;gap:10px;cursor:pointer">' +
        '<input type="checkbox" class="picker-cb" data-mi="' + i + '"' + (ch.checked ? ' checked' : '') + (ch.isCurrent ? ' disabled' : '') + '>' +
        '<span style="flex:1;font-size:12px">' + escapeHtml(ch.tag) + ' ' + escapeHtml(ch.text.substring(0, 40)) + '</span>' +
        '<span style="font-size:10px;color:var(--text-dim)">' + escapeHtml(ch.css.substring(0, 50)) + '</span>' +
        (ch.isCurrent ? '<span style="font-size:10px;color:var(--accent)">当前</span>' : '') +
        '</label>';
    }
    listEl.innerHTML = hl;
    setTimeout(function () {
      listEl.querySelectorAll('.picker-cb').forEach(function (cb) {
        cb.addEventListener('change', function() {
            var mi = parseInt(cb.dataset.mi);
            if (pickerChildren[mi]) pickerChildren[mi].checked = cb.checked;
            updatePickerPreview();
          })
      });
    }, 30);
  }

  // 手动 tab：添加选择器查询结果
  async function _pickerManualAdd(sel) {
    sel = (sel || '').trim();
    if (!sel) return;
    setStatus('正在查询: ' + sel);
    try {
      var isXpath = sel.indexOf('/') === 0;
      var raw = await document.getElementById("webview").executeJavaScript('(function(s,xp){' +
        'try{var els=xp?document.evaluate(s,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null):document.querySelectorAll(s);' +
        'var res=[];var n=xp?els.snapshotLength:els.length;' +
        'for(var i=0;i<Math.min(n,50);i++){' +
          'var e=xp?els.snapshotItem(i):els[i];' +
          'var t=e.tagName.toLowerCase();' +
          'var txt=(e.textContent||"").trim().substring(0,200);' +
          'if(!txt)continue;' +
          'res.push({tag:t,text:txt,css:xp?s:s,isInline:false,checked:true});' +
        '}return JSON.stringify(res);' +
        '}catch(e){return JSON.stringify({err:e.message});}' +
      '})(' + JSON.stringify(sel) + ',' + (isXpath ? 'true' : 'false') + ')');
      var parsed = JSON.parse(raw || '{}');
      if (parsed.err) { setStatus('查询失败: ' + parsed.err); return; }
      var list = Array.isArray(parsed) ? parsed : [];
      if (list.length === 0) { setStatus('未匹配到元素'); return; }
      for (var i = 0; i < list.length; i++) {
        _pickerManualItems.push(list[i]);
      }
      pickerChildren = _pickerManualItems;
      renderPickerList();
      updatePickerPreview();
      setStatus('已添加 ' + list.length + ' 个元素');
    } catch (e) { console.error('手动添加失败:', e); setStatus('添加失败'); }
  }
  window._pickerManualAdd = _pickerManualAdd;
  // 供 HTML onclick 调用
  window._manualAddFromInput = function () {
    var inp = document.getElementById('manualSelectorInput');
    if (inp && inp.value.trim()) {
      _pickerManualAdd(inp.value);
      inp.value = '';
    }
  };
  window._manualRemoveItem = function (mi) {
    _pickerManualItems.splice(mi, 1);
    pickerChildren = _pickerManualItems;
    renderPickerList();
    updatePickerPreview();
  };

  var _pickerPreviewFullText = '';
  function updatePickerPreview() {
    var texts = [];
    var allCbs = document.querySelectorAll('.picker-cb:checked');
    for (var i = 0; i < pickerChildren.length; i++) {
      for (var c = 0; c < allCbs.length; c++) {
        if (parseInt(allCbs[c].dataset.mi) === i) {
          texts.push(pickerChildren[i].text);
          break;
        }
      }
    }
    _pickerPreviewFullText = S.inlineMergeDelim ? texts.join(S.inlineMergeDelim) : texts.join('');
    var previewEl = document.querySelector('.picker-preview-text');
    if (previewEl) {
      previewEl.textContent = _pickerPreviewFullText;
      previewEl.style.cursor = _pickerPreviewFullText.length > 50 ? 'pointer' : '';
      previewEl.title = _pickerPreviewFullText.length > 50 ? '点击展开/截断' : '';
      previewEl.onclick = function() {
        if (previewEl.style.whiteSpace === 'nowrap') {
          previewEl.style.whiteSpace = 'normal';
          previewEl.style.overflow = '';
          previewEl.style.textOverflow = '';
          previewEl.title = '点击展开/截断';
        } else {
          previewEl.style.whiteSpace = 'nowrap';
          previewEl.style.overflow = 'hidden';
          previewEl.style.textOverflow = 'ellipsis';
          previewEl.title = _pickerPreviewFullText;
        }
      };
    }
  }

  function switchPickerTab(tab) {
    pickerCurrentTab = tab;
    // 确保所有 tab 按钮可见（防止异常隐藏）
    var tabsContainer = document.querySelector('.picker-tabs');
    if (tabsContainer) {
      tabsContainer.style.display = '';
      tabsContainer.querySelectorAll('.picker-tab').forEach(function(btn) {
        btn.style.display = '';
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
    }
    // 切换数据源
    if (tab === 'inline') {
      pickerChildren = _pickerSameContainer;
    } else if (tab === 'all') {
      pickerChildren = _pickerAllItems;
    } else if (tab === 'manual') {
      pickerChildren = _pickerManualItems;
      // 合并模式下，将源元素预填充到手动列表（含 isCurrent 标记）
      if (pickerMode === 'merge' && pickerSourceIdx >= 0) {
        var s = S.editorItems[pickerSourceIdx];
        if (s && !s._isTagHeader && !s.isGroup) {
          var alreadyThere = false;
          for (var sm = 0; sm < _pickerManualItems.length; sm++) {
            if (_pickerManualItems[sm].css === s.selector) { alreadyThere = true; break; }
          }
          if (!alreadyThere) {
            _pickerManualItems.unshift({
              tag: (s.elementInfo ? s.elementInfo.tag : '') || '?',
              text: (s.elementInfo ? s.elementInfo.text : '') || '',
              css: s.selector, isInline: false, checked: true, isCurrent: true
            });
          }
        }
      }
    }
    // 复位确认按钮
    if (tab !== 'inline' || pickerChildren.length >= 2) {
      var confirmBtn = $('#btnPickerConfirm');
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.title = ''; confirmBtn.style.opacity = ''; }
    }
    // 更新提示信息
    var infoEl = $('#pickerInfo');
    if (infoEl) {
      if (tab === 'inline') {
        infoEl.style.display = _pickerSameContainer.length > 0 ? 'block' : 'none';
      } else if (tab === 'all') {
        infoEl.style.display = 'block';
        infoEl.textContent = '全部已选元素 (' + _pickerAllItems.length + ' 个)';
      } else if (tab === 'manual') {
        infoEl.style.display = 'block';
        infoEl.textContent = '手动输入选择器添加元素';
      }
    }
    renderPickerList();
    if (tab !== 'manual') updatePickerPreview();
    // 重置批量条（已在 renderPickerList 的 setTimeout 中更新）
  }
  window._switchPickerTab = switchPickerTab;

  async function showPicker(idx, mode) {
    var item = S.editorItems[idx];
    if (!item) return;
    if (mode === 'merge' && item.isGroup) return;
    pickerMode = mode;
    pickerSourceIdx = idx;
    pickerChildren = [];
    pickerInlineIndices = [];
    pickerCurrentTab = 'inline';
    _pickerSameContainer = [];
    _pickerAllItems = [];
    _pickerManualItems = [];

    var info = item.elementInfo || {};
    var currentEl = $('#pickerCurrent');
    var fullText = info.text || '';
    currentEl.textContent = fullText.substring(0, 30);
    currentEl.title = fullText.length > 30 ? ('点击展开/截断\n' + fullText) : fullText;
    currentEl.style.cursor = fullText.length > 30 ? 'pointer' : '';
    currentEl.onclick = function() {
      if (currentEl.textContent.length < fullText.length) {
        currentEl.textContent = fullText;
      } else {
        currentEl.textContent = fullText.substring(0, 30);
      }
    };
    var infoEl = $('#pickerInfo');
    if (infoEl) infoEl.style.display = 'none';

    var confirmBtn = $('#btnPickerConfirm');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.title = ''; confirmBtn.style.opacity = ''; }
    if (mode === 'merge') {
      $('#pickerModalTitle').textContent = '选择要合并的元素';
      $('#pickerHint').textContent = '勾选要合并到一起的元素：';
      $('#btnPickerConfirm').textContent = '确认合并';
      // 预填充"全部"tab：所有非组 S.editorItems
      for (var ei = 0; ei < S.editorItems.length; ei++) {
        var eit = S.editorItems[ei];
        if (eit._isTagHeader || eit.isGroup) continue;
        var einf = eit.elementInfo || {};
        _pickerAllItems.push({
          tag: einf.tag || '?', text: einf.text || '', css: eit.selector || '',
          isInline: false, checked: eit.selector === item.selector,
          isCurrent: eit.selector === item.selector
        });
      }
      await showPickerMerge(item);
    } else {
      $('#pickerModalTitle').textContent = '选择要拆分的元素';
      $('#pickerHint').textContent = '勾选要拆分为子元素组的条目：';
      $('#btnPickerConfirm').textContent = '确认拆分';
      // 预填充"全部"tab：所有非组 S.editorItems
      for (var ei = 0; ei < S.editorItems.length; ei++) {
        var eit = S.editorItems[ei];
        if (eit._isTagHeader || eit.isGroup) continue;
        var einf = eit.elementInfo || {};
        _pickerAllItems.push({
          tag: einf.tag || '?', text: einf.text || '', css: eit.selector || '',
          isInline: false, checked: eit.selector === item.selector, isCurrent: eit.selector === item.selector
        });
      }
      // 获取点击元素的子元素作为"同容器" tab
      await showPickerSplit(item);
      // 如果没有同容器数据，回退到"全部" tab
      if (pickerChildren.length === 0 && _pickerAllItems.length > 0) {
        var infoEl = $('#pickerInfo');
        if (infoEl) { infoEl.style.display = 'block'; infoEl.innerHTML = '<span style="color:var(--text-dim)">该元素无可拆分子元素</span> <span style="color:var(--text-dim);font-size:11px">（可切换到"全部"tab 批量拆分其他元素）</span>'; }
      }
      pickerCurrentTab = pickerChildren.length > 0 ? 'inline' : 'all';
      renderPickerList();
      updatePickerPreview();
      _syncPickerTabUI();
      $('#pickerModal').classList.remove('hidden');
    }
  }

  async function showPickerMerge(item) {
    setStatus('正在查找同容器元素...');
    var allSels = [];
    for (var ei = 0; ei < S.editorItems.length; ei++) {
      if (!S.editorItems[ei]._isTagHeader && !S.editorItems[ei].isGroup && S.editorItems[ei].selector) {
        allSels.push(S.editorItems[ei].selector);
      }
    }
    if (allSels.length < 2) { setStatus('需要至少2个已选元素才能合并'); return; }
    try {
      var raw = await document.getElementById("webview").executeJavaScript('(function(sel,sels){'
        + 'var el=document.querySelector(sel);if(!el)return JSON.stringify({err:\"选择器未匹配到元素\"});'
        + 'var pickedMap=new Map();'
        + 'for(var i=0;i<sels.length;i++){'
          + 'try{var e=document.querySelector(sels[i]);if(e)pickedMap.set(e,sels[i]);}catch(ex){}'
        + '}'
        + 'if(pickedMap.size<2)return JSON.stringify({err:\"选择器匹配到的元素不足2个\"});'
        + 'var cur=el;var container=null;'
        + 'while(cur&&cur!==document.body&&cur!==document.documentElement){'
          + 'var cnt=0;pickedMap.forEach(function(_,pe){if(cur.contains(pe))cnt++;});'
          + 'if(cnt>=2){container=cur;break;}'
          + 'cur=cur.parentElement;'
        + '}'
        + 'if(!container)return JSON.stringify({err:\"未找到同容器已选元素（共\"+pickedMap.size+\"个已选）\"});'
        + 'var ctag=container.tagName.toLowerCase();'
        + 'var cid=container.id||\"\";'
        + 'var ccls=(typeof container.className===\"string\"?container.className.trim().split(/\s+/).slice(0,2).join(\".\"):\"\");'
        + 'var clabel=cid?ctag+\"#\"+cid:(ccls?ctag+\".\"+ccls:ctag);'
        + 'var directChildren=Array.from(container.children);'
        + 'var seen=new Set();var siblings=[];'
        + 'for(var i=0;i<directChildren.length;i++){'
          + 'var dc=directChildren[i];'
          + 'var target=null,targetSel=\"\";'
          + 'if(pickedMap.has(dc)){target=dc;targetSel=pickedMap.get(dc);}'
          + 'else{pickedMap.forEach(function(sel,pe){if(!target&&dc.contains(pe)){target=pe;targetSel=sel;}});}'
          + 'if(!target)continue;'
          + 'var key=targetSel;if(seen.has(key))continue;seen.add(key);'
          + 'var tag=target.tagName.toLowerCase();'
          + 'var txt=(target.textContent||\"\").trim().substring(0,200);'
          + 'var display=window.getComputedStyle(target).display;'
          + 'var isInline=display.indexOf(\"inline\")>=0||[\"SPAN\",\"A\",\"EM\",\"STRONG\",\"B\",\"I\",\"U\",\"SMALL\",\"SUB\",\"SUP\",\"CODE\",\"LABEL\"].indexOf(target.tagName)>=0;'
          + 'siblings.push({tag:tag,text:txt,css:targetSel,isInline:isInline,domIdx:i});'
        + '}'
        + 'if(siblings.length<2)return JSON.stringify({err:\"该容器下已选元素不足2个\"});'
        + 'var runs=[];var curRun=[];'
        + 'for(var i=0;i<siblings.length;i++){'
          + 'var s=siblings[i];var st=s.text.length;'
          + 'var canAdd=s.isInline&&st<25;'
          + 'if(curRun.length===0){if(canAdd)curRun.push(i);}'
          + 'else{var last=siblings[curRun[curRun.length-1]];'
            + 'if(canAdd&&s.domIdx===last.domIdx+1)curRun.push(i);'
            + 'else{if(curRun.length>1)runs.push(curRun.slice());curRun=canAdd?[i]:[];}'
          + '}'
        + '}'
        + 'if(curRun.length>1)runs.push(curRun.slice());'
        + 'return JSON.stringify({clabel:clabel,siblings:siblings,runs:runs});'
      + '})(' + JSON.stringify(item.selector) + ',' + JSON.stringify(allSels) + ')');
      var data = JSON.parse(raw || '{}');
      if (data.err) {
        // 同容器查找失败 → 内联tab空，用户可手动切到"全部"或"手动"
        pickerChildren = [];
        _pickerSameContainer = [];
        pickerInlineIndices = [];
        var infoEl = $('#pickerInfo');
        if (infoEl) { infoEl.style.display = 'block'; infoEl.innerHTML = '<span style="color:var(--orange)">' + escapeHtml(data.err) + '</span> <span style="color:var(--text-dim);font-size:11px">（可切换到"全部"或"手动"tab选择元素）</span>'; }
        renderPickerList();
        updatePickerPreview();
        $('#pickerModal').classList.remove('hidden');
        return;
      }

      var autoChecked = new Set();
      (data.runs || []).forEach(function(run) { run.forEach(function(i) { autoChecked.add(i); }); });

      pickerChildren = data.siblings.map(function(sib, si) {
        return { tag: sib.tag, text: sib.text, css: sib.css, isInline: sib.isInline || false,
          checked: autoChecked.has(si) || sib.css === item.selector, isCurrent: sib.css === item.selector };
      });
      // 保存同容器数据，切换到内联时恢复
      _pickerSameContainer = pickerChildren.slice();
      pickerInlineIndices = pickerChildren.map(function(_, i) { return i; });

      var infoEl = $('#pickerInfo');
      if (infoEl) {
        infoEl.style.display = 'block';
        infoEl.innerHTML = '容器: <span style="color:var(--text-bright)">&lt;' + escapeHtml(data.clabel) + '&gt;</span> (' + data.siblings.length + ' 个已选元素)';
      }

      renderPickerList();
      updatePickerPreview();
      _syncPickerTabUI();
      $('#pickerModal').classList.remove('hidden');
    } catch (e) { console.error('合并检测失败:', e); setStatus('合并检测失败'); }
  }

  function _syncPickerTabUI() {
    var tabsContainer = document.querySelector('.picker-tabs');
    if (tabsContainer) {
      tabsContainer.style.display = '';
      tabsContainer.querySelectorAll('.picker-tab').forEach(function(btn) {
        btn.style.display = '';
        btn.classList.toggle('active', btn.dataset.tab === pickerCurrentTab);
      });
    }
  }

  async function showPickerSplit(item) {
    setStatus('正在获取子元素...');
    var selector = item.selector;
    if (!selector) { setStatus('该元素没有选择器'); return; }
    try {
      var raw = await document.getElementById("webview").executeJavaScript('(function(sel){'
        + 'try{'
        + 'function getXPath(el){'
          + 'if(el.id)return"//*[@id=\\""+el.id+"\\"]";'
          + 'var parts=[];var cur=el;'
          + 'while(cur&&cur!==document.body&&cur!==document.documentElement){'
            + 'var t=cur.tagName.toLowerCase();var p=cur.parentElement;'
            + 'if(p){var sibs=Array.from(p.children).filter(function(x){return x.tagName===cur.tagName});'
              + 'if(sibs.length>1)t+="["+(sibs.indexOf(cur)+1)+"]";}'
            + 'parts.unshift(t);cur=p;'
          + '}return"//"+parts.join("/");'
        + '}'
        + 'var el=document.querySelector(sel);if(!el)return JSON.stringify({err:"未找到元素"});'
        + 'var result=[];var domSeq=0;'
        + 'var IT={SPAN:1,A:1,EM:1,STRONG:1,B:1,I:1,U:1,SMALL:1,SUB:1,SUP:1,CODE:1,LABEL:1};'
        + 'function buildCss(c){'
          + 'var tag=c.tagName.toLowerCase();var css=tag;'
          + 'if(c.id){css="#"+CSS.escape(c.id);}'
          + 'else if(c.className&&typeof c.className==="string"){'
            + 'var cls=c.className.trim().split(/\\s+/).filter(Boolean).slice(0,2);'
            + 'if(cls.length)css=tag+"."+cls.map(function(x){return CSS.escape(x)}).join(".");'
          + '}'
          + 'var pa=c.parentElement;'
          + 'if(pa){var sibs=Array.from(pa.children).filter(function(x){return x.tagName===c.tagName});'
            + 'if(sibs.length>1)css+=":nth-of-type("+(sibs.indexOf(c)+1)+")";}'
          + 'return css;'
        + '}'
        + 'function pushLeaf(c){'
          + 'var tag=c.tagName.toLowerCase();'
          + 'var txt="";'
          + 'if(tag==="img"){txt=c.alt||c.src||"";}'
          + 'else{txt=(c.textContent||"").trim();}'
          + 'if(!txt)return;txt=txt.substring(0,200);'
          + 'var css=buildCss(c);'
          + 'var display=window.getComputedStyle(c).display;'
          + 'var isInline=display.indexOf("inline")>=0||IT[tag]===1;'
          + 'result.push({tag:tag,text:txt,css:css,xpath:getXPath(c),isInline:isInline,domIdx:domSeq++});'
        + '}'
        + 'function collectLeaves(parent,depth){'
          + 'if(depth>' + S.splitMaxDepth + ')return;'
          + 'var kids=Array.from(parent.children);'
          + 'for(var i=0;i<kids.length;i++){'
            + 'var c=kids[i];var r=c.getBoundingClientRect();if(r.width<5&&r.height<5)continue;'
            + 'if(c.children.length===0){pushLeaf(c);}'
            + 'else{collectLeaves(c,depth+1);}'
          + '}'
        + '}'
        + 'collectLeaves(el,0);'
        + 'return JSON.stringify(result);'
        + '}catch(e){return JSON.stringify({err:e.message});}'
      + '})(' + JSON.stringify(selector) + ')');
      var parsed = JSON.parse(raw || '{}');
      if (parsed.err) { setStatus(parsed.err); return; }
      var list = Array.isArray(parsed) ? parsed : [];
      if (list.length === 0) { setStatus('该元素没有可拆分的子元素'); return; }

      // Detect inline runs among children
      var runs = [], curRun = [];
      for (var ri = 0; ri < list.length; ri++) {
        var s = list[ri];
        var canAdd = s.isInline && s.text.length < 25;
        if (curRun.length === 0) { if (canAdd) curRun.push(ri); }
        else {
          var last2 = list[curRun[curRun.length - 1]];
          if (canAdd && s.domIdx === last2.domIdx + 1) { curRun.push(ri); }
          else { if (curRun.length > 1) runs.push(curRun.slice()); curRun = canAdd ? [ri] : []; }
        }
      }
      if (curRun.length > 1) runs.push(curRun.slice());
      var autoChecked = new Set();
      runs.forEach(function(run) { run.forEach(function(i) { autoChecked.add(i); }); });

      pickerChildren = list.map(function(ch, si) {
        return { tag: ch.tag, text: ch.text, css: ch.css, xpath: ch.xpath || '', isInline: ch.isInline || false,
          checked: autoChecked.has(si), isCurrent: false };
      });
      _pickerSameContainer = pickerChildren.slice();
      pickerInlineIndices = pickerChildren.map(function(_, i) { return i; });
      var infoEl = $('#pickerInfo');
      if (infoEl) {
        infoEl.style.display = 'block';
        var tagLabel = item.elementInfo ? '<' + (item.elementInfo.tag || '?') + '>' : '当前元素';
        infoEl.innerHTML = '元素: <span style="color:var(--text-bright)">' + escapeHtml(tagLabel) + '</span> (' + list.length + ' 个子元素)';
      }



    } catch (e) { console.error('拆分检测失败:', e); setStatus('拆分检测失败'); }
  }

  function doPickerConfirm() {
    console.log('[picker] confirm clicked, mode=', pickerMode, 'sourceIdx=', pickerSourceIdx, 'children=', pickerChildren.length);
    if (pickerMode === 'merge') doPickerMerge();
    else if (pickerMode === 'split') doPickerSplit();
  }
  window._doPickerConfirm = doPickerConfirm;

  function doPickerMerge() {
    console.log('[picker] doPickerMerge start');
    if (pickerSourceIdx < 0) return;
    var checkedMi = [];
    document.querySelectorAll('.picker-cb:checked').forEach(function(cb) {
      if (!cb.disabled) checkedMi.push(parseInt(cb.dataset.mi));
    });
    console.log('[picker] checkedMi=', checkedMi.length, checkedMi);
    if (checkedMi.length === 0) { setStatus('请至少勾选一个元素'); return; }

    var allMi = [].concat(checkedMi);
    for (var mi = 0; mi < pickerChildren.length; mi++) {
      if (pickerChildren[mi].isCurrent && allMi.indexOf(mi) < 0) allMi.push(mi);
    }
    // 始终包含源元素（点合并的那个），即使当前 tab 列表中不存在
    var srcItem = S.editorItems[pickerSourceIdx];
    if (srcItem && !srcItem._isTagHeader && !srcItem.isGroup && allMi.indexOf(-1) < 0) {
      allMi.push(-1); // 负值标记：源元素，不从 pickerChildren 取
    }
    if (allMi.length < 2) { setStatus('至少需要2个元素才能合并'); return; }

    var childrenData = [], mergedTextParts = [], toRemoveIdxs = [];
    allMi.forEach(function(mi) {
      // -1 表示源元素
      if (mi === -1) {
        var s = S.editorItems[pickerSourceIdx];
        childrenData.push({
          elementInfo: s.elementInfo, selector: s.selector,
          matchCount: s.matchCount, source: s.source, xpath: s.xpath || ''
        });
        mergedTextParts.push((s.elementInfo ? s.elementInfo.text : '') || '');
        toRemoveIdxs.push(pickerSourceIdx);
        return;
      }
      var ch = pickerChildren[mi];
      if (!ch) return;
      var found = false;
      // 先尝试从 S.editorItems 匹配
      for (var ei = 0; ei < S.editorItems.length; ei++) {
        if (!S.editorItems[ei].isGroup && !S.editorItems[ei]._isTagHeader && S.editorItems[ei].selector === ch.css && toRemoveIdxs.indexOf(ei) < 0) {
          childrenData.push({
            elementInfo: S.editorItems[ei].elementInfo, selector: S.editorItems[ei].selector,
            matchCount: S.editorItems[ei].matchCount, source: S.editorItems[ei].source, xpath: S.editorItems[ei].xpath
          });
          mergedTextParts.push(ch.text);
          toRemoveIdxs.push(ei);
          found = true;
          break;
        }
      }
      // 手动 tab：元素可能不在 S.editorItems 中，直接构造
      if (!found) {
        childrenData.push({
          elementInfo: { tag: ch.tag || 'span', text: ch.text || '', class: '', id: '', href: '', src: '', selectors: [{ selector: ch.css, label: '手动' }] },
          selector: ch.css, matchCount: 1, source: '合并', xpath: ''
        });
        mergedTextParts.push(ch.text);
      }
    });
    var mergedText = S.inlineMergeDelim ? mergedTextParts.join(S.inlineMergeDelim) : mergedTextParts.join('');
    if (childrenData.length < 2) { setStatus('至少需要2个元素才能合并'); return; }
    toRemoveIdxs.sort(function(a, b) { return b - a; });

    var groupItem = {
      isGroup: true, children: childrenData,
      elementInfo: { tag: childrenData[0].elementInfo ? childrenData[0].elementInfo.tag : 'span', text: mergedText, class: '', id: '', href: '', src: '' },
      selector: childrenData[0].selector, matchCount: childrenData.length, source: '合并',
      xpath: childrenData[0].xpath || '', _mergeSep: S.inlineMergeDelim
    };
    // 如果有 S.editorItems 中的元素，先移除，在合适位置插入组
    if (toRemoveIdxs.length > 0) {
      var insertAt = Math.min.apply(null, toRemoveIdxs);
      for (var r = 0; r < toRemoveIdxs.length; r++) { S.editorItems.splice(toRemoveIdxs[r], 1); }
      S.editorItems.splice(insertAt, 0, groupItem);
    } else {
      // 全是手动输入的元素，直接添加到列表末尾
      S.editorItems.push(groupItem);
    }

    hidePicker();
    updatePickedElementsFromEditor(); updatePickedTreeNodes();
    renderElementEditor(); syncQueryPanelIfPicked();
    setStatus('已合并 ' + childrenData.length + ' 个元素');
  }

  async function doPickerSplit() {
    var checked = [];
    document.querySelectorAll('.picker-cb:checked').forEach(function(cb) {
      var mi = parseInt(cb.dataset.mi);
      if (pickerChildren[mi]) checked.push(pickerChildren[mi]);
    });
    if (checked.length === 0) { setStatus('请至少勾选一个元素'); return; }
    // 同容器 tab：直接使用 showPickerSplit 已收集的子元素数据建组
    if (pickerCurrentTab === 'inline' && pickerSourceIdx >= 0 && pickerChildren.length > 0) {
      if (checked.length < 2) { setStatus('至少需要勾选2个子元素才能拆分'); return; }
      var srcItem = S.editorItems[pickerSourceIdx];
      if (!srcItem || srcItem._isTagHeader || srcItem.isGroup) { setStatus('当前元素不可拆分'); return; }
      var childrenData = [], texts = [];
      for (var k = 0; k < checked.length; k++) {
        var ch2 = checked[k];
        childrenData.push({
          elementInfo: { tag: ch2.tag, text: ch2.text, class: '', id: '', href: '', src: '', selectors: [{ selector: ch2.css, label: '子元素' }] },
          selector: ch2.css, xpath: ch2.xpath || '', matchCount: 1, source: '拆分'
        });
        texts.push(ch2.text);
      }
      var mergedText = S.inlineMergeDelim ? texts.join(S.inlineMergeDelim) : texts.join('');
      S.editorItems[pickerSourceIdx] = {
        isGroup: true, children: childrenData,
        elementInfo: srcItem.elementInfo ? { tag: srcItem.elementInfo.tag, text: mergedText, class: srcItem.elementInfo.class || '', id: srcItem.elementInfo.id || '', href: srcItem.elementInfo.href || '', src: srcItem.elementInfo.src || '' } : { tag: '?', text: mergedText, class: '', id: '', href: '', src: '' },
        selector: srcItem.selector, xpath: srcItem.xpath || '', matchCount: childrenData.length,
        source: '拆分', _mergeSep: S.inlineMergeDelim
      };
      hidePicker();
      updatePickedElementsFromEditor(); updatePickedTreeNodes();
      renderElementEditor(); syncQueryPanelIfPicked();
      setStatus('已拆分 ' + childrenData.length + ' 个子元素');
      return;
    }
    setStatus('正在拆分 ' + checked.length + ' 个元素...');
    var done = 0;
    for (var k = 0; k < checked.length; k++) {
      var ch = checked[k];
      if (!ch || !ch.css) continue;
      var ei = -1;
      for (var i = 0; i < S.editorItems.length; i++) {
        if (!S.editorItems[i]._isTagHeader && !S.editorItems[i].isGroup && S.editorItems[i].selector === ch.css) { ei = i; break; }
      }
      if (ei < 0) continue;
      var item = S.editorItems[ei];
      try {
        var raw = await document.getElementById("webview").executeJavaScript('(function(sel){' +
          'try{var el=document.querySelector(sel);if(!el)return JSON.stringify({err:"未找到"});' +
          'var result=[];var domSeq=0;' +
          'var IT={SPAN:1,A:1,EM:1,STRONG:1,B:1,I:1,U:1,SMALL:1,SUB:1,SUP:1,CODE:1,LABEL:1};' +
          'function buildCss(c){' +
            'var tag=c.tagName.toLowerCase();var css=tag;' +
            'if(c.id){css="#"+CSS.escape(c.id);}' +
            'else if(c.className&&typeof c.className==="string"){' +
              'var cls=c.className.trim().split(/\\\\s+/).filter(Boolean).slice(0,2);' +
              'if(cls.length)css=tag+"."+cls.map(function(x){return CSS.escape(x)}).join(".");' +
            '}' +
            'var pa=c.parentElement;' +
            'if(pa){var sibs=Array.from(pa.children).filter(function(x){return x.tagName===c.tagName});' +
              'if(sibs.length>1)css+=":nth-of-type("+(sibs.indexOf(c)+1)+")";}' +
            'return css;' +
          '}' +
          'function pushLeaf(c){' +
            'var tag=c.tagName.toLowerCase();var txt="";' +
            'if(tag==="img"){txt=c.alt||c.src||"";}' +
            'else{txt=(c.textContent||"").trim();}' +
            'if(!txt)return;txt=txt.substring(0,200);' +
            'var css=buildCss(c);' +
            'var display=window.getComputedStyle(c).display;' +
            'var isInline=display.indexOf("inline")>=0||IT[tag]===1;' +
            'result.push({tag:tag,text:txt,css:css,isInline:isInline,domIdx:domSeq++});' +
          '}' +
          'function collectLeaves(parent,depth){' +
            'if(depth>' + S.splitMaxDepth + ')return;' +
            'var kids=Array.from(parent.children);' +
            'for(var i=0;i<kids.length;i++){' +
              'var c=kids[i];var r=c.getBoundingClientRect();if(r.width<5&&r.height<5)continue;' +
              'if(c.children.length===0){pushLeaf(c);}' +
              'else{collectLeaves(c,depth+1);}' +
            '}' +
          '}' +
          'collectLeaves(el,0);' +
          'return JSON.stringify(result);' +
          '}catch(e){return JSON.stringify({err:e.message});}' +
        '})(' + JSON.stringify(item.selector) + ')');
        var parsed = JSON.parse(raw || '{}');
        if (parsed.err) continue;
        var kids = Array.isArray(parsed) ? parsed : [];
        if (kids.length < 2) continue;
        var runs = [], curRun = [];
        for (var ri = 0; ri < kids.length; ri++) {
          var s = kids[ri];
          var canAdd = s.isInline && s.text.length < 25;
          if (curRun.length === 0) { if (canAdd) curRun.push(ri); }
          else {
            var last2 = kids[curRun[curRun.length - 1]];
            if (canAdd && s.domIdx === last2.domIdx + 1) { curRun.push(ri); }
            else { if (curRun.length > 1) runs.push(curRun.slice()); curRun = canAdd ? [ri] : []; }
          }
        }
        if (curRun.length > 1) runs.push(curRun.slice());
        var autoSet = new Set();
        runs.forEach(function(run) { run.forEach(function(i) { autoSet.add(i); }); });
        var checkedKids = [], texts = [];
        kids.forEach(function(kid, ki) {
          if (autoSet.has(ki)) {
            checkedKids.push({
              elementInfo: { tag: kid.tag, text: kid.text, class: '', id: '', href: '', src: '', selectors: [{ selector: kid.css, label: '子元素' }] },
              selector: kid.css, xpath: '', matchCount: 1, source: '拆分'
            });
            texts.push(kid.text);
          }
        });
        if (checkedKids.length < 2) continue;
        var mergedText = S.inlineMergeDelim ? texts.join(S.inlineMergeDelim) : texts.join('');
        S.editorItems[ei] = {
          isGroup: true, children: checkedKids,
          elementInfo: item.elementInfo ? { tag: item.elementInfo.tag, text: mergedText, class: item.elementInfo.class || '', id: item.elementInfo.id || '', href: item.elementInfo.href || '', src: item.elementInfo.src || '' } : { tag: '?', text: mergedText, class: '', id: '', href: '', src: '' },
          selector: item.selector, xpath: item.xpath || '', matchCount: checkedKids.length,
          source: '拆分', _mergeSep: S.inlineMergeDelim
        };
        done++;
      } catch (e) { console.error('拆分子元素失败:', e); }
    }
    hidePicker();
    updatePickedElementsFromEditor(); updatePickedTreeNodes();
    renderElementEditor(); syncQueryPanelIfPicked();
    setStatus('已拆分 ' + done + ' 个元素');
  }
  // ── 合并组重匹配 ──
  async function rematchMergeGroup(midx) {
    var item = S.editorItems[midx];
    if (!item || !item.children) return;
    var total = 0;
    for (var ci = 0; ci < item.children.length; ci++) {
      var sel = item.children[ci].selector;
      if (!sel) continue;
      try {
        var cnt = await document.getElementById("webview").executeJavaScript('(function(s){try{return document.querySelectorAll(s).length}catch(e){return 0}})(' + JSON.stringify(sel) + ')');
        item.children[ci].matchCount = parseInt(cnt) || 0;
        total += parseInt(cnt) || 0;
      } catch(e) {}
    }
    item.matchCount = total;
    renderElementEditor();
    syncQueryPanelIfPicked();
    setStatus('重匹配完成，共 ' + total + ' 个匹配');
  }

  async function rematchSingleChild(midx, cidx) {
    var item = S.editorItems[midx];
    if (!item || !item.children || !item.children[cidx]) return;
    var sel = item.children[cidx].selector;
    if (!sel) return;
    try {
      var cnt = await document.getElementById("webview").executeJavaScript('(function(s){try{return document.querySelectorAll(s).length}catch(e){return 0}})(' + JSON.stringify(sel) + ')');
      item.children[cidx].matchCount = parseInt(cnt) || 0;
      var total = 0;
      item.children.forEach(function(c) { total += c.matchCount || 0; });
      item.matchCount = total;
      renderElementEditor();
      syncQueryPanelIfPicked();
    } catch(e) {}
  }

  // ── 子项移出合并组 ──
  function removeChildFromGroup(midx, cidx) {
    var item = S.editorItems[midx];
    if (!item || !item.children || !item.children[cidx]) return;
    var removed = item.children.splice(cidx, 1)[0];
    // 插入为独立元素（在组后面）
    addToEditor(removed.elementInfo, removed.selector, '拆分');
    // 如果组只剩1个子项，自动拆组
    if (item.children.length <= 1) {
      splitGroup(midx);
    } else {
      item.matchCount = item.children.length;
      updatePickedElementsFromEditor();
      updatePickedTreeNodes();
      renderElementEditor();
      syncQueryPanelIfPicked();
    }
    setStatus('已移出 1 个子元素');
  }

  // ──────── 拆分组 ────────
  function splitGroup(idx) {
    var item = S.editorItems[idx];
    if (!item || !item.isGroup) return;
    // 用子项替换合并组
    var children = item.children || [];
    var insertItems = children.map(function(child) {
      return {
        elementInfo: child.elementInfo,
        selector: child.selector,
        matchCount: child.matchCount || 1,
        source: '拆分',
        xpath: child.xpath || '',
        isGroup: false
      };
    });
    S.editorItems.splice(idx, 1); // 移除合并组
    for (var i = 0; i < insertItems.length; i++) {
      addToEditor(insertItems[i].elementInfo, insertItems[i].selector, '拆分');
    }
    updatePickedElementsFromEditor();
    updatePickedTreeNodes();
    renderElementEditor();
    syncQueryPanelIfPicked();
    setStatus('已拆分，恢复 ' + insertItems.length + ' 个独立元素');
  }

  function renderElementEditor() {
    _editorDedupMap = null; // 清空旧索引（重渲染后会重新排序，旧 Map 失效）
    if (S.editorItems.length === 0) {
      document.getElementById("elementEditorBody").innerHTML = '<div class="tree-empty">暂无已选元素。在浏览区用提取模式选择元素后会自动加入。</div>';
      return;
    }
    // 记住当前折叠状态
    window._collapsedTags = window._collapsedTags || {};
    // 清除上次渲染插入的标签头（避免残留）
    S.editorItems = S.editorItems.filter(function(it) { return !it._isTagHeader; });
    // 标签名中英文映射
    var tagNameCN = { a:'链接', abbr:'缩写', address:'地址', area:'区域', article:'文章', aside:'侧栏',
      audio:'音频', b:'加粗', blockquote:'引用', br:'换行', button:'按钮', canvas:'画布', caption:'表标题',
      code:'代码', col:'表格列', datalist:'数据列表', dd:'描述', del:'删除线', details:'详情', dialog:'对话框',
      div:'区块', dl:'描述列表', dt:'术语', em:'强调', embed:'嵌入', fieldset:'字段集', figcaption:'图标题',
      figure:'插图', footer:'页脚', form:'表单', h1:'一级标题', h2:'二级标题', h3:'三级标题', h4:'四级标题',
      h5:'五级标题', h6:'六级标题', header:'页头', hr:'分隔线', i:'斜体', iframe:'内嵌框架', img:'图片',
      input:'输入框', ins:'插入', label:'标签', legend:'图例', li:'列表项', link:'链接', main:'主体',
      map:'映射', mark:'标记', meta:'元数据', meter:'度量', nav:'导航', noscript:'无脚本', object:'对象',
      ol:'有序列表', optgroup:'选项组', option:'选项', output:'输出', p:'段落', picture:'图片组', pre:'预格式',
      progress:'进度条', q:'短引用', s:'删除线', samp:'样本', script:'脚本', section:'区块', select:'下拉框',
      small:'小号', source:'媒体源', span:'行内文本', strong:'强调', style:'样式', sub:'下标', summary:'摘要',
      sup:'上标', svg:'矢量图', table:'表格', tbody:'表体', td:'单元格', template:'模板', textarea:'文本域',
      tfoot:'表脚', th:'表头', thead:'表头', time:'时间', title:'标题', tr:'表行', track:'字幕', u:'下划线',
      ul:'无序列表', var:'变量', video:'视频', wbr:'换行点', '[合并组]':'合并组', '?':'未知' };
    // 排序：先按标签分组（合并组按显示标签），组内按来源→匹配数降序
    function itemTag(item) {
      if (item.isGroup) return '[合并组]';
      return ((item.elementInfo || {}).tag || '?').toUpperCase();
    }
    var sourceOrder = { pick: 1, auto: 2, '合并': 3, '拆分': 4, scan: 5 };
    S.editorItems.sort(function (a, b) {
      var ta = itemTag(a), tb = itemTag(b);
      if (ta !== tb) return ta.localeCompare(tb);
      var sa = sourceOrder[a.source || 'scan'] || 5;
      var sb = sourceOrder[b.source || 'scan'] || 5;
      if (sa !== sb) return sa - sb;
      return (b.matchCount || 0) - (a.matchCount || 0);
    });
    // 统计每组数量
    var tagCounts = {};
    S.editorItems.forEach(function (item) {
      var tg = itemTag(item);
      tagCounts[tg] = (tagCounts[tg] || 0) + 1;
    });
    // 插入标签分组头
    var grouped = [], lastTag = '', isFirst = true;
    S.editorItems.forEach(function (item) {
      var tag = itemTag(item);
      if (tag !== lastTag) {
        var count = tagCounts[tag] || 0;
        grouped.push({ _isTagHeader: true, _tag: tag, _count: count, _closePrev: !isFirst });
        isFirst = false; lastTag = tag;
      }
      grouped.push(item);
    });
    S.editorItems = grouped;
    var sourceLabels = { scan: '扫描', pick: '框选', auto: '识别', '合并': '合并', '拆分': '拆分' };
    var sourceColors = { scan: 'var(--text-dim)', pick: 'var(--green)', auto: 'var(--orange)', '合并': '#a78bfa', '拆分': 'var(--orange)' };

    // 统计各来源数量（跳过标签头）
    var counts = { scan: 0, pick: 0, auto: 0, '合并': 0, '拆分': 0 };
    S.editorItems.forEach(function (item) {
      if (item._isTagHeader) return;
      var s = item.source || 'scan';
      counts[s] = (counts[s] || 0) + 1;
    });
    var realCount = S.editorItems.filter(function(it) { return !it._isTagHeader; }).length;
    var summary = '共 ' + realCount + ' 个元素';
    if (counts.pick > 0) summary += ' | <span style="color:var(--green)">框选 ' + counts.pick + '</span>';
    if (counts.auto > 0) summary += ' | <span style="color:var(--orange)">识别 ' + counts.auto + '</span>';
    if (counts['合并'] > 0) summary += ' | <span style="color:#a78bfa">合并 ' + counts['合并'] + '</span>';
    if (counts['拆分'] > 0) summary += ' | <span style="color:var(--orange)">拆分 ' + counts['拆分'] + '</span>';
    if (counts.scan > 0) summary += ' | <span style="color:var(--text-dim)">扫描 ' + counts.scan + '</span>';
    var headerEl = document.getElementById("elementEditor").querySelector('.element-editor-title');
    if (headerEl) headerEl.innerHTML = '已选元素管理';
    var plainSummary = summary.replace(/<[^>]+>/g, '');
    var statusEditor = $('#statusEditor');
    if (statusEditor) statusEditor.textContent = plainSummary;

    var html = '<table class="result-table"><thead><tr style="height:24px;line-height:1;white-space:nowrap">' +
      '<th style="width:28px">#</th><th style="width:56px">标签</th><th style="width:44px">来源</th>' +
      '<th>文本/链接</th><th>CSS选择器</th><th style="width:56px">匹配</th><th style="width:48px">操作</th>' +
      '</tr></thead><tbody>';

    var rowNum = 0;
    S.editorItems.forEach(function (item, idx) {
      try {
        if (item._isTagHeader) {
          var gid2 = 'tag_group_' + item._tag.replace(/[^a-z0-9]/gi, '_');
          html += '<tr class="editor-tag-header" data-gid="' + gid2 + '" data-tag="' + escapeHtml(item._tag) + '" style="cursor:pointer">';
          html += '<td colspan="7" style="padding:6px 12px;font-size:11px;font-weight:600;color:var(--accent);background:var(--bg);border-top:1px solid var(--border);border-bottom:1px solid var(--border)">';
          var cnName = tagNameCN[item._tag.toLowerCase()] || '';
          var collapsed = window._collapsedTags[item._tag] || false;
          var arrow = collapsed ? '▶' : '▼';
          html += '<span class="editor-tag-toggle">' + arrow + '</span> &lt;<span style="color:var(--accent)">' + escapeHtml(item._tag) + '</span>&gt;';
          if (cnName) html += ' <span style="color:var(--text-dim)">' + escapeHtml(cnName) + '</span>';
          html += ' <span style="color:var(--text-dim);font-size:10px">(' + (item._count || 0) + ')</span>';
          html += '</td></tr>';
          return;
        }
        rowNum++;
        var info = item.elementInfo || {};
        var tag = safeStr(info.tag) || '?';
        var text = safeStr(info.text);
        var href = safeStr(info.href);
        var src = safeStr(info.src);
        var selector = safeStr(item.selector);
        var count = (item.matchCount != null && !isNaN(item.matchCount)) ? item.matchCount : '?';
        var statusClass = item.matchCount > 0 ? 'ok' : 'fail';
        var statusText = item.matchCount > 0 ? item.matchCount + ' 个' : '无匹配';
        var source = item.source || 'scan';
        var srcLabel = sourceLabels[source] || source;
        var srcColor = sourceColors[source] || 'var(--text-dim)';

        var display = (tag === 'a' && href) ? href : (tag === 'img' && src) ? src : text;
        var title = text + (href ? '\n' + href : '') + (src && src !== href ? '\n' + src : '');

        if (item.isGroup) {
          // ── 合并组行 ──
          var children = item.children || [];
          var childDisplays = children.map(function(c){
            var ci2 = c.elementInfo || {};
            var ct2 = (ci2.tag || '').toLowerCase();
            var ch2 = ci2.href || '';
            var cs2 = ci2.src || '';
            var txt2 = normalizeText(ci2.text || '');
            return (ct2 === 'a' && ch2) ? ch2 : (ct2 === 'img' && cs2) ? cs2 : txt2;
          });
          var combinedText = childDisplays.join(item._mergeSep || S.inlineMergeDelim || '');
          var groupTitle = combinedText;
          var groupId = 'merge_group_' + idx;
          html += '<tr data-idx="' + idx + '" class="editor-merge-row" data-gid="' + groupId + '" style="cursor:pointer;background:rgba(167,139,250,0.06)">';
          html += '<td style="color:var(--text-dim);font-size:10px;text-align:center">' + rowNum + '</td>';
          html += '<td style="color:#a78bfa;font-weight:600;font-size:11px">[合]</td>';
          html += '<td style="font-size:10px;color:#a78bfa;text-align:center">' + srcLabel + '</td>';
          html += '<td style="max-width:280px"><div title="' + escapeHtml(groupTitle) + '" style="font-size:12px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--text-bright);font-weight:500">' + escapeHtml(combinedText) + '</div></td>';
          html += '<td style="max-width:300px"><input class="editor-selector-input" value="' + escapeHtml(selector) + '" data-idx="' + idx + '" style="width:100%;height:22px;padding:0 4px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:Consolas,"Microsoft YaHei",monospace;outline:none">' +
            (item.xpath ? '<div style="font-size:9px;color:var(--text-dim);font-family:Consolas,"Microsoft YaHei",monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">' + escapeHtml(safeStr(item.xpath, 120)) + '</div>' : '') +
            '</td>';
          html += '<td style="text-align:center;white-space:nowrap"><span style="font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(167,139,250,0.15);color:#a78bfa">' + children.length + ' 合</span></td>';
          html += '<td style="text-align:center;white-space:nowrap">' +
            '<button class="editor-item-btn copy-sel" data-idx="' + idx + '" title="复制 CSS 到剪贴板">📋</button>' +
            '<button class="editor-item-btn rematch-merge" data-idx="' + idx + '" title="重匹配">↻</button>' +
            '<button class="editor-item-btn merge-toggle" data-idx="' + idx + '" data-gid="' + groupId + '" title="展开/收起">▸</button>' +
            '<button class="editor-item-btn merge-split" data-idx="' + idx + '" title="拆分">⇱</button>' +
            '<button class="editor-item-btn delete" data-idx="' + idx + '" title="删除组">×</button>' +
            '</td>';
          html += '</tr>';

          // 子项行（初始隐藏）
          for (var ci = 0; ci < children.length; ci++) {
            var child = children[ci];
            var cinfo = child.elementInfo || {};
            var ctag = safeStr(cinfo.tag) || '?';
            var ctext = safeStr(cinfo.text);
            var chref = safeStr(cinfo.href);
            var csrc = safeStr(cinfo.src);
            var cdisplay = (ctag === 'a' && chref) ? chref : (ctag === 'img' && csrc) ? csrc : ctext;
            html += '<tr class="editor-merge-child" data-parent="' + groupId + '" data-merge-idx="' + idx + '" data-child-idx="' + ci + '" style="display:none;background:rgba(167,139,250,0.03)">';
            html += '<td draggable="true" class="merge-child-drag-handle" style="cursor:grab">⋮⋮</td>';
            html += '<td style="color:var(--text-dim);font-size:10px;padding-left:8px">└ <span style="color:var(--accent)">&lt;' + escapeHtml(ctag) + '&gt;</span></td>';
            html += '<td style="font-size:9px;color:var(--text-dim);text-align:center">' + (sourceLabels[child.source] || '') + '</td>';
            html += '<td style="max-width:280px"><div style="font-size:10px;line-height:1.35;color:var(--text-dim)">' + escapeHtml(cdisplay) + '</div></td>';
            html += '<td style="max-width:300px"><input class="editor-child-selector-input" value="' + escapeHtml(child.selector) + '" data-merge-idx="' + idx + '" data-child-idx="' + ci + '" style="width:100%;height:18px;padding:0 4px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;font-family:Consolas,"Microsoft YaHei",monospace;outline:none">' +
              (child.xpath ? '<div style="font-size:8px;color:var(--text-dim);font-family:Consolas,"Microsoft YaHei",monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">' + escapeHtml(safeStr(child.xpath, 100)) + '</div>' : '') +
              '</td>';
            html += '<td style="text-align:center"><span style="font-size:9px;color:var(--text-dim)">-</span></td>';
            html += '<td style="text-align:center;white-space:nowrap">' +
              '<button class="editor-item-btn rematch-child" data-merge-idx="' + idx + '" data-child-idx="' + ci + '" title="重匹配" style="font-size:9px;padding:0 3px">↻</button>' +
              '<button class="editor-item-btn merge-pick-child" data-merge-idx="' + idx + '" data-child-idx="' + ci + '" title="合并" style="font-size:9px;padding:0 3px">+</button>' +
              '<button class="editor-item-btn split-elem" data-idx="' + idx + '" title="拆分" style="font-size:9px;padding:0 3px">↯</button>' +
              '<button class="editor-item-btn delete-child" data-merge-idx="' + idx + '" data-child-idx="' + ci + '" title="移出组">×</button>' +
              '</td>';
            html += '</tr>';
          }

        } else {
          // ── 普通行 ──
          html += '<tr data-idx="' + idx + '" data-selector="' + escapeHtml(selector) + '" data-tag="' + escapeHtml(tag) + '" data-xpath="' + escapeHtml(item.xpath || '') + '" style="cursor:pointer">';
          html += '<td style="color:var(--text-dim);font-size:10px;text-align:center">' + rowNum + '</td>';
          html += '<td style="color:var(--accent);font-weight:600;font-size:11px">&lt;' + escapeHtml(tag) + '&gt;' + (item._registered ? ' <span style="color:var(--green);font-size:9px" title="已注册到后端">&#10003;</span>' : '') + '</td>';
          html += '<td style="font-size:10px;color:' + srcColor + ';text-align:center">' + srcLabel + '</td>';
          html += '<td style="max-width:280px"><div title="' + escapeHtml(title) + '" style="font-size:11px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escapeHtml(display) + '</div></td>';
          html += '<td style="max-width:300px"><input class="editor-selector-input" value="' + escapeHtml(selector) + '" data-idx="' + idx + '" style="width:100%;height:22px;padding:0 4px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:Consolas,"Microsoft YaHei",monospace;outline:none">' +
            (item.xpath ? '<div style="font-size:9px;color:var(--text-dim);font-family:Consolas,"Microsoft YaHei",monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">' + escapeHtml(safeStr(item.xpath, 120)) + '</div>' : '') +
            '</td>';
          html += '<td style="text-align:center;white-space:nowrap"><span style="font-size:10px;padding:1px 5px;border-radius:3px;white-space:nowrap;' + (item.matchCount > 0 ? 'background:rgba(74,222,128,0.15);color:var(--green)' : 'background:rgba(248,113,113,0.15);color:var(--red)') + '">' + statusText + '</span></td>';
          html += '<td style="text-align:center;white-space:nowrap">' +
            '<button class="editor-item-btn copy-sel" data-idx="' + idx + '" title="复制 CSS 到剪贴板">📋</button>' +
            '<button class="editor-item-btn rematch" data-idx="' + idx + '" title="重匹配">↻</button>' +
            '<button class="editor-item-btn merge-pick" data-idx="' + idx + '" title="合并">+</button>' +
            '<button class="editor-item-btn split-elem" data-idx="' + idx + '" title="拆分为子元素">↯</button>' +
            '<button class="editor-item-btn delete" data-idx="' + idx + '" title="删除">×</button>' +
            '</td>';
          html += '</tr>';

        }
      } catch(e) {
        console.error('[Editor] 行' + idx + '渲染失败:', e.message, item);
      }
    });
    html += '</tbody></table>';
    document.getElementById("elementEditorBody").innerHTML = html;
    // 应用已保存的折叠状态
    document.getElementById("elementEditorBody").querySelectorAll('.editor-tag-header').forEach(function (hdr) {
      var tag = hdr.dataset.tag || '';
      if (window._collapsedTags[tag]) {
        var next = hdr.nextElementSibling;
        while (next && !next.classList.contains('editor-tag-header')) {
          next.style.display = 'none';
          next = next.nextElementSibling;
        }
      }
    });
    // 预期行数 = 标签头行 + 数据行 + 合并组子行/预览行 + 拆分展开行
    var expectedRows = 0;
    S.editorItems.forEach(function(item) {
      expectedRows++;
      if (item._isTagHeader) return;
      if (item.isGroup) expectedRows += (item.children || []).length + 1;
    });
    var renderedRows = document.getElementById("elementEditorBody").querySelectorAll('tbody tr').length;
    if (renderedRows !== expectedRows) {
      var msg = '⚠ 渲染' + renderedRows + '行 ≠ 预期' + expectedRows + '行';
      console.warn('[Editor] ' + msg);
    }

    // ── 事件委托（单次绑定，全局复用，不再逐行 addEventListener）──
    _bindEditorDelegated();
  }

  var _editorDelegatedBound = false;
  function _bindEditorDelegated() {
    if (_editorDelegatedBound) return;
    _editorDelegatedBound = true;
    var body = document.getElementById("elementEditorBody");
    // 拖拽状态（委托 handler 访问）
    var _dragChildIdx = -1, _dragMergeIdx = -1;

    // ── click 委托（覆盖 12 类按钮 + 行点击）──
    body.addEventListener('click', function(e) {
      var hdr = e.target.closest('.editor-tag-header');
      if (hdr) {
        var tag = hdr.dataset.tag || '';
        var toggle = hdr.querySelector('.editor-tag-toggle');
        var next = hdr.nextElementSibling;
        var wasExpanded = toggle && toggle.textContent === '▼';
        window._collapsedTags[tag] = wasExpanded;
        while (next && !next.classList.contains('editor-tag-header')) {
          next.style.display = wasExpanded ? 'none' : '';
          next = next.nextElementSibling;
        }
        if (toggle) toggle.textContent = wasExpanded ? '▶' : '▼';
        return;
      }
      var mergeBtn = e.target.closest('.merge-pick');
      if (mergeBtn) { e.stopPropagation ? e.stopPropagation() : (e.cancelBubble=true); showPicker(parseInt(mergeBtn.dataset.idx), 'merge'); return; }
      var mpcBtn = e.target.closest('.merge-pick-child');
      if (mpcBtn) { e.stopPropagation ? e.stopPropagation() : (e.cancelBubble=true);
        var midx = parseInt(mpcBtn.dataset.mergeIdx), cidx = parseInt(mpcBtn.dataset.childIdx);
        var group = S.editorItems[midx];
        if (group && group.isGroup && group.children && group.children[cidx]) {
          var childSel = group.children[cidx].selector;
          removeChildFromGroup(midx, cidx);
          var newIdx = -1;
          for (var ei = S.editorItems.length - 1; ei >= 0; ei--) {
            if (!S.editorItems[ei]._isTagHeader && !S.editorItems[ei].isGroup && S.editorItems[ei].selector === childSel) { newIdx = ei; break; }
          }
          if (newIdx >= 0) showPicker(newIdx, 'merge'); else setStatus('无法定位移出的元素');
        }
        return;
      }
      var splitBtn = e.target.closest('.split-elem');
      if (splitBtn) { e.stopPropagation ? e.stopPropagation() : (e.cancelBubble=true); showPicker(parseInt(splitBtn.dataset.idx), 'split'); return; }
      var rmBtn = e.target.closest('.rematch-merge');
      if (rmBtn) { e.stopPropagation ? e.stopPropagation() : (e.cancelBubble=true); rematchMergeGroup(parseInt(rmBtn.dataset.idx)); return; }
      var rcBtn = e.target.closest('.rematch-child');
      if (rcBtn) { e.stopPropagation ? e.stopPropagation() : (e.cancelBubble=true); rematchSingleChild(parseInt(rcBtn.dataset.mergeIdx), parseInt(rcBtn.dataset.childIdx)); return; }
      var dcBtn = e.target.closest('.delete-child');
      if (dcBtn) { e.stopPropagation ? e.stopPropagation() : (e.cancelBubble=true); removeChildFromGroup(parseInt(dcBtn.dataset.mergeIdx), parseInt(dcBtn.dataset.childIdx)); return; }
      var mtBtn = e.target.closest('.merge-toggle');
      if (mtBtn) { e.stopPropagation ? e.stopPropagation() : (e.cancelBubble=true);
        var gid = mtBtn.dataset.gid;
        var children = body.querySelectorAll('[data-parent="' + gid + '"]');
        var isHidden = children.length > 0 && children[0].style.display === 'none';
        children.forEach(function(row) { row.style.display = isHidden ? '' : 'none'; });
        mtBtn.textContent = isHidden ? '▾' : '▸';
        return;
      }
      var msBtn = e.target.closest('.merge-split');
      if (msBtn) { e.stopPropagation ? e.stopPropagation() : (e.cancelBubble=true); splitGroup(parseInt(msBtn.dataset.idx)); return; }
      var rBtn = e.target.closest('.rematch');
      if (rBtn) { rematchSingleSelector(parseInt(rBtn.dataset.idx)); return; }
      var copyBtn = e.target.closest('.copy-sel');
      if (copyBtn) {
        e.stopPropagation ? e.stopPropagation() : (e.cancelBubble=true);
        var cidx = parseInt(copyBtn.dataset.idx);
        var citem = S.editorItems[cidx];
        if (citem && citem.selector) {
          try { window._addToClipboard(citem.selector, '元素提取'); } catch(e) {}
          Parser.utils.showToast('已加入剪贴板: ' + citem.selector.substring(0, 50));
        }
        return;
      }
      var delBtn = e.target.closest('.delete');
      if (delBtn) { var didx = parseInt(delBtn.dataset.idx); S.editorItems.splice(didx, 1); updatePickedElementsFromEditor(); updatePickedTreeNodes(); renderElementEditor(); return; }
      var rowEl = e.target.closest('tr[data-idx]');
      if (rowEl && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
        var idx = parseInt(rowEl.dataset.idx);
        var item = S.editorItems[idx];
        if (item && item.elementInfo) {
          var info = item.elementInfo;
          if (!info.selectors || info.selectors.length === 0) info.selectors = [{ selector: item.selector, label: '当前使用' }];
          if (!info.xpath) info.xpath = item.xpath || '';
          showAdaptiveSelectors(info, function(sel) { item.selector = sel; renderElementEditor(); updatePickedElementsFromEditor(); });
        }
      }
    });

    // ── change 委托（选择器输入框编辑）──
    body.addEventListener('change', function(e) {
      var inp = e.target.closest('.editor-selector-input');
      if (inp) { var idx = parseInt(inp.dataset.idx); if (S.editorItems[idx]) { S.editorItems[idx].selector = inp.value; rematchSingleSelector(idx); } return; }
      var cinp = e.target.closest('.editor-child-selector-input');
      if (cinp) {
        var midx = parseInt(cinp.dataset.mergeIdx), cidx = parseInt(cinp.dataset.childIdx);
        var item = S.editorItems[midx];
        if (item && item.children && item.children[cidx]) {
          item.children[cidx].selector = cinp.value;
          document.getElementById("webview").executeJavaScript('(function(sel){try{return document.querySelectorAll(sel).length}catch(e){return 0}})(' + JSON.stringify(cinp.value) + ')').then(function(cnt) {
            if (item.children[cidx]) item.children[cidx].matchCount = parseInt(cnt) || 0;
            var sum = 0; item.children.forEach(function(c) { sum += c.matchCount || 0; });
            item.matchCount = sum; renderElementEditor();
          }).catch(function() {});
        }
      }
    });

    // ── 拖拽委托 ──
    body.addEventListener('dragstart', function(e) {
      var td = e.target.closest('.merge-child-drag-handle[draggable]');
      if (td) { var row = td.parentElement; _dragChildIdx = parseInt(row.dataset.childIdx); _dragMergeIdx = parseInt(row.dataset.mergeIdx); row.style.opacity = '0.5'; e.dataTransfer.effectAllowed = 'move'; }
    });
    body.addEventListener('dragend', function(e) {
      var td = e.target.closest('.merge-child-drag-handle[draggable]');
      if (td) td.parentElement.style.opacity = '';
      _dragChildIdx = -1; _dragMergeIdx = -1;
    });
    body.addEventListener('dragover', function(e) {
      var row = e.target.closest('.editor-merge-child');
      if (row) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.style.borderTop = '2px solid #a78bfa'; }
    });
    body.addEventListener('dragleave', function(e) {
      var row = e.target.closest('.editor-merge-child');
      if (row) row.style.borderTop = '';
    });
    body.addEventListener('drop', function(e) {
      var row = e.target.closest('.editor-merge-child');
      if (!row) return;
      e.preventDefault(); row.style.borderTop = '';
      var dstIdx = parseInt(row.dataset.childIdx), dstMergeIdx = parseInt(row.dataset.mergeIdx);
      if (_dragMergeIdx === dstMergeIdx && _dragChildIdx >= 0 && dstIdx >= 0 && _dragChildIdx !== dstIdx) {
        var item = S.editorItems[dstMergeIdx];
        if (item && item.children) {
          var moved = item.children.splice(_dragChildIdx, 1)[0]; item.children.splice(dstIdx, 0, moved);
          updatePickedElementsFromEditor(); updatePickedTreeNodes(); renderElementEditor();
          var curMode = document.getElementById("queryContainer").dataset.mode || '';
          if (curMode.indexOf('__picked') === 0) {
            var filter = curMode === '__picked__' ? null : curMode.replace('__picked_', '').replace('__', '');
            showPickedElementsPanel(filter);
          }
        }
      }
    });

    // ── hover 高亮委托 ──
    body.addEventListener('mouseenter', function(e) {
      var rowEl = e.target.closest('tr[data-idx]');
      if (!rowEl) return;
      var idx = parseInt(rowEl.dataset.idx), item = S.editorItems[idx];
      if (!item || !item.selector) return;
      document.getElementById("webview").executeJavaScript('(function(sel){'
        + 'try{var els=document.querySelectorAll(sel);'
        + 'var oldBoxes=document.querySelectorAll(".__parser_hover_box");'
        + 'for(var o=0;o<oldBoxes.length;o++){var ob=oldBoxes[o];if(ob.parentNode){var op=ob.getAttribute("data-ppos");if(op!==null)ob.parentNode.style.position=op;ob.parentNode.removeChild(ob);}}'
        + 'for(var i=0;i<els.length;i++){var el=els[i];var r=el.getBoundingClientRect();if(r.width===0&&r.height===0)continue;'
        + 'var b=document.createElement("div");b.setAttribute("data-parser-box","1");b.className="__parser_hover_box";'
        + 'var tag=el.tagName.toUpperCase();var isVoid=tag==="IMG"||tag==="INPUT"||tag==="BR"||tag==="HR"||tag==="SOURCE"||tag==="EMBED"||tag==="AREA";'
        + 'if(!isVoid){var oldPos=el.style.position;b.setAttribute("data-ppos",oldPos||"");if(!oldPos||oldPos==="static")el.style.position="relative";'
        + 'b.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483642;border:2px solid #f59e0b;border-radius:2px;background:rgba(245,158,11,0.12)";el.appendChild(b);}'
        + 'else{var parent=el.parentElement;if(!parent)continue;var oldPPos=parent.style.position;b.setAttribute("data-ppos",oldPPos||"");if(!oldPPos||oldPPos==="static")parent.style.position="relative";'
        + 'var er=el.getBoundingClientRect();var pr=parent.getBoundingClientRect();'
        + 'b.style.cssText="position:absolute;left:"+(er.left-pr.left)+"px;top:"+(er.top-pr.top)+"px;width:"+er.width+"px;height:"+er.height+"px;pointer-events:none;z-index:2147483642;border:2px solid #f59e0b;border-radius:2px;background:rgba(245,158,11,0.12)";parent.appendChild(b);}'
        + '}}catch(e){}})(' + JSON.stringify(item.selector) + ')');
    }, true);
    body.addEventListener('mouseleave', function(e) {
      var rowEl = e.target.closest('tr[data-idx]');
      if (!rowEl) return;
      document.getElementById("webview").executeJavaScript('(function(){var obs=document.querySelectorAll(".__parser_hover_box");'
        + 'for(var k=0;k<obs.length;k++){var ob=obs[k];if(ob.parentNode){var op=ob.getAttribute("data-ppos");if(op!==null)ob.parentNode.style.position=op;ob.parentNode.removeChild(ob);}}})()');
    }, true);
    body.addEventListener('mouseover', function(e) {
      var td = e.target.closest('tr[data-idx] td:nth-child(5)');
      if (td) td.style.cursor = 'pointer';
    });
  }

  function addToEditor(elementInfo, selector, source, dragSession) {
    if (!selector && elementInfo && elementInfo.selectors && elementInfo.selectors.length > 0) {
      selector = elementInfo.selectors[0].selector;
    }
    if (!selector) selector = elementInfo.css || (elementInfo.tag || 'div');
    source = source || 'scan';

    // 扫描来源：过滤无文本、无链接、无图片的空壳元素
    if (source === 'scan') {
      var txt = normalizeText(elementInfo.text || '');
      var hasHref = !!(elementInfo.href || elementInfo.src);
      if (!txt && !hasHref) return;
    }

    // 去重 key：selector + src + href + text（用 normalizeText 清洗后截断）
    var dedupKey = selector + '||' + (elementInfo.src||'') + '||' + (elementInfo.href||'') + '||' + normalizeText(elementInfo.text||'').substring(0,S.maxCellText);
    // O(1) Map 查找（替代原来的 O(n) 遍历）— key → editorItems index
    _editorDedupMap = _editorDedupMap || {};
    var existsIdx = _editorDedupMap[dedupKey];
    if (existsIdx !== undefined && S.editorItems[existsIdx]) {
      // 升级来源：pick/auto 可覆盖已有条目
      if ((source === 'pick' || source === 'auto') && S.editorItems[existsIdx].source !== source) {
        S.editorItems[existsIdx].source = source;
        S.editorItems[existsIdx].matchCount = (elementInfo.count != null && !isNaN(elementInfo.count)) ? elementInfo.count : 0;
        S.editorItems[existsIdx].dragSession = dragSession || 0;
        scheduleEditorRender();
        return;
      }
      // 同来源或非框选 → 去重跳过
      if (!dragSession) return;
      // 框选来源 → 同 session 去重，不同 session 允许重复
      if (S.editorItems[existsIdx].dragSession === dragSession) return;
      // 不同 session → fall through 允许添加
    }

    var count = (elementInfo.count != null && !isNaN(elementInfo.count)) ? elementInfo.count : 0;

    elementInfo.text = normalizeText(elementInfo.text || "");
    elementInfo.href = normalizeText(elementInfo.href || "");
    elementInfo.src = normalizeText(elementInfo.src || "");

    _editorDedupMap[dedupKey] = S.editorItems.length;  // 记住新位置
    S.editorItems.push({
      elementInfo: elementInfo,
      selector: selector,
      xpath: elementInfo.xpath || elementInfo._xpath || '',
      matchCount: count,
      persisted: false,
      source: source,
      dragSession: dragSession || 0
    });

    scheduleEditorRender();
    // pick/auto 来源自动注册到后端
    if (source === 'pick' || source === 'auto') {
      _scheduleAutoRegister();
    }
    // pick 来源自动填入批量弹框选择器行（首行填满则追加新行）
    if (source === 'pick' && selector) {
      var allSels = document.querySelectorAll('.batch-dlg-selector');
      // 去重：已有相同选择器则跳过
      var dup = false;
      for (var si = 0; si < allSels.length; si++) {
        if (allSels[si].value.trim() === selector) { dup = true; break; }
        if (allSels[si].dataset._manualEdit === '1') continue;
        if (!allSels[si].value.trim()) { allSels[si].value = selector; dup = true; break; }
      }
      if (!dup) {
        var rows = document.getElementById("batchSelectorRows");
        if (rows) {
          var row = document.createElement('div');
          row.className = 'batch-selector-row';
          row.style.cssText = 'display:flex;align-items:center;gap:4px';
          var inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'form-input batch-dlg-selector';
          inp.style.cssText = 'flex:1;height:28px;padding:0 8px;font-size:12px';
          inp.value = selector;
          var btn = document.createElement('button');
          btn.className = 'btn btn-sm batch-sel-remove';
          btn.style.cssText = 'height:24px;padding:0 6px;font-size:12px;color:var(--red);border-color:transparent;background:transparent';
          btn.title = '删除';
          btn.textContent = '×';
          btn.addEventListener('click', function() { row.remove(); });
          row.appendChild(inp);
          row.appendChild(btn);
          rows.appendChild(row);
        }
      }
    }
  }

  var _editorRenderTimer = null;
  function scheduleEditorRender() {
    if (_editorRenderTimer) clearTimeout(_editorRenderTimer);
    _editorRenderTimer = setTimeout(function () {
      _editorRenderTimer = null;
      updatePickedElementsFromEditor();
      renderElementEditor();
      updatePickedTreeNodes();
      syncQueryPanelIfPicked();
    }, 50);
  }

  function syncQueryPanelIfPicked() {
    var mode = document.getElementById("queryContainer").dataset.mode;
    if (!mode || mode.indexOf('__picked') !== 0) return;
    var sourceFilter = null;
    if (mode !== '__picked__') {
      var m = mode.match(/^__picked_(.+?)__$/);
      sourceFilter = m ? m[1] : null;
    }
    var items = sourceFilter
      ? S.editorItems.filter(function (item) { return !item._isTagHeader && (item.source || 'scan') === sourceFilter; })
      : S.editorItems.filter(function(item) { return !item._isTagHeader; });
    var labels = { pick: '框选', auto: '识别', scan: '扫描', '合并': '合并', '拆分': '拆分' };
    renderQueryFromItems(items, labels);
  }

  function rematchSingleSelector(idx) {
    var item = S.editorItems[idx];
    if (!item || !item.selector) return;
    var selector = item.selector;

    setStatus('正在重新匹配: ' + selector);
    // 在 document.getElementById("webview") 中执行匹配
    document.getElementById("webview").executeJavaScript('(function(sel){try{var els=document.querySelectorAll(sel);return els.length;}catch(e){return -1;}})(' + JSON.stringify(selector) + ')')
      .then(function (count) {
        item.matchCount = count >= 0 ? count : 0;
        // 同时更新 document.getElementById("webview") 中的高亮框
        if (count > 0) {
          document.getElementById("webview").executeJavaScript('(function(sel,c){' +
            'var P=window.__parser;if(!P||!P.previewer)return;' +
            'P.previewer.highlight(sel,"#7c5cfc");' +
            'setTimeout(function(){P.previewer.clear();},1500);' +
            '})(' + JSON.stringify(selector) + ',' + count + ')');
        }
        renderElementEditor();
        syncQueryPanelIfPicked();
        setStatus(count > 0 ? '匹配成功: ' + count + ' 个元素' : '未匹配到元素');
      })
      .catch(function () {
        item.matchCount = 0;
        renderElementEditor();
        syncQueryPanelIfPicked();
        setStatus('匹配失败');
      });
  }

  function rematchAllSelectors() {
    if (S.editorItems.length === 0) return;
    setStatus('正在重新匹配所有选择器...');
    var pending = S.editorItems.length;
    var done = 0;
    S.editorItems.forEach(function (item, idx) {
      if (!item.selector) { pending--; return; }
      document.getElementById("webview").executeJavaScript('(function(sel){try{var els=document.querySelectorAll(sel);return els.length;}catch(e){return -1;}})(' + JSON.stringify(item.selector) + ')')
        .then(function (count) {
          item.matchCount = count >= 0 ? count : 0;
          done++;
          if (done >= pending) {
            renderElementEditor();
            syncQueryPanelIfPicked();
            setStatus('全部重匹配完成');
          }
        })
        .catch(function () {
          item.matchCount = 0;
          done++;
          if (done >= pending) { renderElementEditor(); syncQueryPanelIfPicked(); }
        });
    });
    // 超时保护
    setTimeout(function () {
      renderElementEditor();
      syncQueryPanelIfPicked();
    }, 5000);
  }

  function updatePickedElementsFromEditor() {
    // 从 S.editorItems 同步到 S.pickedElements 供导出
    S.pickedElements = [];
    S.editorItems.forEach(function (item) {
      if (item._isTagHeader) return;
      if (item.isGroup && item.children) {
        // 合并组：输出合并文本 + 子项明细
        var info = item.elementInfo || {};
        var childTexts = item.children.map(function(c){ return normalizeText(c.elementInfo ? c.elementInfo.text || '' : ''); });
        S.pickedElements.push({
          tag: info.tag || '',
          css: item.selector || '',
          count: item.children.length,
          text: childTexts.join(item._mergeSep || S.inlineMergeDelim || ''),
          class: info.class || '',
          id: info.id || '',
          href: info.href || '',
          src: info.src || '',
          isGroup: true,
          children: item.children.map(function(c) {
            var ci = c.elementInfo || {};
            return {
              tag: ci.tag || '',
              css: c.selector || '',
              text: normalizeText(ci.text || ''),
              class: ci.class || '',
              id: ci.id || '',
              href: ci.href || '',
              src: ci.src || ''
            };
          })
        });
      } else {
        var info = item.elementInfo || {};
        S.pickedElements.push({
          tag: info.tag || '',
          css: item.selector || '',
          count: item.matchCount || 0,
          text: info.text || '',
          class: info.class || '',
          id: info.id || '',
          href: info.href || '',
          src: info.src || ''
        });
      }
    });
    updatePickedCount();
  }


  // Module API
  window.Parser.extractor = {
    bindPickerEvents: bindPickerEvents,
    bindEnhancedPickerEvents: bindEnhancedPickerEvents,
    setPickMode: setPickMode,
    startPickMode: startPickMode,
    stopPickMode: stopPickMode,
    addToEditor: addToEditor,
    renderElementEditor: renderElementEditor,
    rematchAllSelectors: rematchAllSelectors,
    rematchSingleSelector: rematchSingleSelector,
    updatePickedElementsFromEditor: updatePickedElementsFromEditor,
    splitGroup: splitGroup,
    doPickerConfirm: doPickerConfirm,
    doPickerMerge: doPickerMerge,
    removeChildFromGroup: removeChildFromGroup,
  };
})();
