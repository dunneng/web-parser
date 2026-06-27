# 🕸️ 网页解析器 (WebParser)

> 可视化网页数据提取工具 — 所见即所得，像浏览网页一样提取数据。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-42%2B-47848f?logo=electron)](https://www.electronjs.org/)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776ab?logo=python)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688?logo=fastapi)](https://fastapi.tiangolo.com/)

---

## 📖 简介

**网页解析器** 是一款基于 Electron + FastAPI 的桌面端网页数据提取工具。内置浏览器让你像正常上网一样浏览目标页面，然后通过 CSS 选择器、XPath、正则表达式等方式**可视化框选**需要的数据，一键导出 Excel/CSV。

专治各类现代前端渲染的网页（如主流电商平台），支持 AJAX 翻页、虚拟列表 DOM 不完整等复杂场景。

---

## ✨ 核心功能

### 🔍 多引擎查询
| 引擎 | 说明 |
|------|------|
| **CSS 选择器** | 支持 `:nth-of-type`、逗号多选、属性选择器 |
| **XPath** | 完整 XPath 1.0 支持 |
| **正则表达式** | 从源码文本中提取 |
| **JSONPath** | 解析页面内嵌 JSON 数据 |
| **链路提取** | 🆕 核心特色 — 解决虚拟列表 DOM 不完整问题 |

### ⛓️ 链路提取（Chain Extract）
针对现代网页"渲染时 DOM 不完整"的痛点。指定多个嵌套选择器组成链路，逐层穿透提取目标数据。支持：
- 逗号分隔的平行子链路（如 `img.a, img.b`）
- 递归子链路（无限嵌套）
- Walk-up 索引（在 DOM 树中向上回溯）
- 300ms 防抖自动解析

### 📦 批量抓取
- 标签式任务管理，批量采集多页面数据
- 支持 AJAX 翻页自动快照
- 多页 HTML 合并提取
- 进度实时可见

### 🖼️ 商品入库 & 向量搜索
- 自动下载商品图片
- CN-CLIP 向量化（中文图文匹配）
- Qdrant 向量数据库存储
- 以图搜图 / 以文搜图

### 💰 跨平台比价
- 支持主流电商平台
- 一键比价搜索
- 价格对比结果一目了然

### 📊 导出
- Excel (.xlsx) 导出
- CSV 导出
- 支持勾选导出、全量导出

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────┐
│               Electron 主进程                │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │  BrowserView │  │  Python 后端管理      │  │
│  │  (内置浏览器)  │  │  (spawn FastAPI)     │  │
│  └─────────────┘  └──────────────────────┘  │
├─────────────────────────────────────────────┤
│           渲染进程 (Renderer)                 │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │  tab-browser │  │  解析结果面板          │  │
│  │  (多标签浏览)  │  │  (目录树/查询/导出)    │  │
│  └─────────────┘  └──────────────────────┘  │
├─────────────────────────────────────────────┤
│         Python FastAPI 后端 (19527)          │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌───────────┐  │
│  │ HTML  │ │ DOM  │ │CSS/  │ │ 链路提取  │  │
│  │ 解析  │ │ 解析  │ │XPath │ │ (Chain)  │  │
│  └──────┘ └──────┘ └──────┘ └───────────┘  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌───────────┐  │
│  │Regex │ │JSON  │ │SQLite│ │Qdrant向量 │  │
│  │引擎  │ │Path  │ │持久化│ │+ CN-CLIP │  │
│  └──────┘ └──────┘ └──────┘ └───────────┘  │
└─────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 环境要求
- **Node.js** >= 18
- **Python** >= 3.11
- **Git** (用于克隆项目)

### 安装

```bash
# 1. 克隆项目
git clone git@github.com:dunneng/web-parser.git
cd web-parser

# 2. 安装前端依赖
cd web-parser
npm install

# 3. 安装 Python 依赖
cd python
pip install -r requirements.txt

# 4. 启动
npx electron .
```

> 💡 Windows 用户也可以直接运行 `清除进程.bat` 一键重启

### Python 依赖

```
fastapi
uvicorn
lxml
cssselect
openpyxl
pillow
requests
qdrant-client
torch
torchvision
cn-clip
rembg
```

---

## 📁 项目结构

```
web-parser/
├── main.js                 # Electron 主进程
├── preload.js              # 预加载脚本
├── webview-preload.js      # WebView 注入脚本
├── tab-browser.*           # 多标签浏览器组件
├── renderer/
│   ├── index.html          # 主界面
│   ├── app.js              # 主逻辑
│   ├── style.css           # 样式
│   └── modules/
│       ├── batch.js        # 批量抓取
│       ├── query-engine.js # 查询引擎
│       ├── element-extractor.js # 元素提取
│       ├── state.js        # 状态管理
│       └── utils.js        # 工具函数
├── python/
│   ├── server.py           # FastAPI 服务端
│   ├── db.py               # SQLite 持久化层
│   ├── embedding.py        # CN-CLIP 向量化
│   ├── vector_store.py     # Qdrant 向量存储
│   ├── product_pipeline.py # 商品入库管道
│   ├── server.py           # FastAPI 服务端
│   └── parser/
│       ├── html_parser.py  # HTML 格式化
│       ├── dom_parser.py   # DOM 树构建
│       ├── css_engine.py   # CSS 选择器引擎
│       ├── xpath_engine.py # XPath 引擎
│       ├── regex_engine.py # 正则引擎
│       ├── jsonpath_engine.py # JSONPath 引擎
│       ├── chain_engine.py # 链路提取引擎
│       └── script_parser.py # 脚本解析
└── assets/
    ├── wechat-donate.png   # 微信赞赏码
    └── alipay-donate.jpg   # 支付宝收款码
```

---

## 🎯 为什么选择网页解析器？

| 对比维度 | 传统爬虫 | 网页解析器 |
|---------|---------|-----------|
| 学习成本 | 需学 Python + Scrapy | 会浏览网页即可 |
| 兼容复杂页面 | 手动处理 Cookie/Headers | 内置真实浏览器，天然支持 |
| 动态页面 | 需分析 XHR/API | 浏览器渲染，天然支持 |
| DOM 不完整 | 需逆向工程 | 链路提取一步到位 |
| 批量采集 | 写脚本 | 标签式任务，点击即采 |
| 数据导出 | 代码输出 | 一键 Excel/CSV |

---

## 🤝 贡献

欢迎提 Issue 和 PR！这是一个从实际需求中诞生的工具，你的每一条建议都可能让它变得更好。

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/amazing`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing`)
5. 创建 Pull Request

---

## ⚠️ 免责声明

本工具仅供**学习研究**使用。使用者应：

- 遵守目标网站的 `robots.txt` 协议和服务条款
- 不得用于非法爬取、侵犯他人隐私或商业侵权
- 遵守《网络安全法》等相关法律法规

作者不对使用者的任何不当使用承担法律责任。

---

## 💖 支持项目

如果这个工具帮到了你，欢迎请作者喝杯咖啡 ☕

<div align="center">
  <table>
    <tr>
      <td align="center"><b>微信赞赏</b></td>
      <td align="center"><b>支付宝</b></td>
    </tr>
    <tr>
      <td><img src="web-parser/assets/wechat-donate.png" width="200" alt="微信赞赏"></td>
      <td><img src="web-parser/assets/alipay-donate.jpg" width="200" alt="支付宝"></td>
    </tr>
  </table>
</div>

> ⭐ 顺手点个 Star，让更多朋友看到这个项目！

---

## 📜 开源协议

[MIT License](LICENSE) © 2026 dunneng

---

## 🙏 致谢

本项目离不开以下开源项目的支持：

- [Electron](https://www.electronjs.org/) — 跨平台桌面应用框架
- [FastAPI](https://fastapi.tiangolo.com/) — 高性能 Python Web 框架
- [lxml](https://lxml.de/) — HTML/XML 解析引擎
- [Qdrant](https://qdrant.tech/) — 向量数据库
- [CN-CLIP](https://github.com/OFA-Sys/Chinese-CLIP) — 中文图文匹配模型
- [openpyxl](https://openpyxl.readthedocs.io/) — Excel 读写

---

**Made with ❤️ by [dunneng](https://github.com/dunneng)**
