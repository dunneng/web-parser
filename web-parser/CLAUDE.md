# 网页解析器

## 框选/高亮浮层规范

所有高亮覆盖层**插入为目标元素的子节点**，不依赖滚动偏移计算：

### 普通元素（非 void）
```javascript
var oldPos = el.style.position;
if (!oldPos || oldPos === 'static') el.style.position = 'relative';
var ov = document.createElement('div');
ov.setAttribute('data-ppos', oldPos || '');
ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:...';
el.appendChild(ov);
```

### void 元素（img/input/br/hr/source/embed/area）
```javascript
var parent = el.parentElement;
var oldPPos = parent.style.position;
if (!oldPPos || oldPPos === 'static') parent.style.position = 'relative';
var er = el.getBoundingClientRect();
var pr = parent.getBoundingClientRect();
ov.style.cssText = 'position:absolute;left:'+(er.left-pr.left)+'px;top:'+(er.top-pr.top)+'px;width:'+er.width+'px;height:'+er.height+'px;...';
parent.appendChild(ov);
```

### 清理时恢复 position
```javascript
var op = ov.getAttribute('data-ppos');
if (op !== null) ov.parentNode.style.position = op;
ov.parentNode.removeChild(ov);
```

**原理**：`scrollX`/`scrollY` 在嵌套滚动容器中无法正确捕获真实偏移量。浮层作为元素子节点天然跟随元素移动，完全不需要计算滚动偏移。

## 去重逻辑

`addToEditor` 是唯一入口，去重 key = `selector + src + href + text`。所有合并/拆分/子项移出都走 `addToEditor`，不直接 `editorItems.splice`。

## 已注册元素系统

picker 栏的"注册"按钮调用 `registerElements()` → POST `/api/elements/register`。后端 `_registry`（内存字典）按 `dedupKey` 去重。注册后数据可用于链路提取等后端操作。切换网页不清空，需手动清。

## 识别同类

- 取 pick 元素的 CSS 路径 → 去 `#id` + `:nth-of-type()` → `querySelectorAll` 匹配
- 标本优先加入结果，高亮用浮层覆盖（position:absolute）
- 来源升级：pick/auto 可覆盖任意不同来源的已有条目
