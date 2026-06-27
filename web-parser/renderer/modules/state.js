/**
 * 网页解析器 — 全局状态管理模块
 * 集中管理所有共享状态变量，替代散落在 app.js 中的 var/let
 */
window.Parser = window.Parser || {};

window.Parser.state = {
  pythonPort: 19527,
  parseResult: null,
  currentHtml: '',
  queryResults: [],
  pickModeActive: false,
  pickedElements: [],
  isResizing: false,
  pickModeType: 'click', // 'click' | 'drag' | 'nested'
  editorItems: [],        // { elementInfo, selector, matchCount, persisted }
  registeredElements: [], // 从后端获取的已注册元素列表
  _scrollDataCount: 0,
  _apiDataCount: 0,

  // Stealth/辅助
  _antidetectOn: false,
  _domPersistOn: false,
  _apiListenOn: false,
  networkMaxAll: 100,

  // 浏览历史
  browseHistory: [],      // { id, url, title, time }
  historyIdCounter: 0,
  historyPanelVisible: false,
  _savedToolbarHTML: '',

  // Schema
  schemaFields: [],       // [{type:'css'|'xpath', selector:'', name:''}]
  schemaCurrentName: '',
  schemaPreviewData: null,
  schemaMode: 'manual',   // 'manual' | 'chain'
  chainSegments: [],      // [{selector, tag, extractions, subChains}]

  // 配置参数
  globalChildDelim: ' | ',
  globalMultiDelim: ' | ',
  maxTextLen: 2000,
  maxDomDepth: 20,
  maxResults: 1000,
  maxSourcePreview: 2000,
  maxDomChildren: 200,
  maxCellText: 200,
  chainPreviewLimit: 3,
  inlineMergeDelim: '',
  expandChildren: false,
  queryFilters: [],
  queryFilterLogic: 'and',
  splitMaxDepth: 4,

  // 批量抓取
  batchTasks: [],
  batchAllResults: [],
  batchLoadRunning: false,
  batchLoadCancel: false,
  batchLoadPaused: false,
  batchTaskIdCounter: 0,
  batchCurrentTaskId: null,
  batchCurrentMode: 'template',
  batchLocalFiles: [],

  // API 接入
  apiResponse: null,
  apiHistory: [],
  apiLoadedCookie: '',

  // 剪贴板
  clipboardHistory: [],
  CLIPBOARD_MAX: 50,

  // Stealth 脚本
  STEALTH_SCRIPTS: [],    // 由 app.js 初始化
  STEALTH_INJECT_IDS: [],
  _stealthData: null,
};
