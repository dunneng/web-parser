"""
CSS 选择器查询引擎
"""
import re
from lxml import html


def _truncate(text: str, max_len: int) -> str:
    """截断文本，超过长度时加 ..."""
    if len(text) > max_len:
        return text[:max_len] + "..."
    return text


def get_direct_text(el, max_text_len: int = 5000) -> str:
    """只取元素下直接文本节点（跳过子元素内的文本）。
    
    lxml 文本模型：
      el.text  → 开始标签后、第一个子元素前的文本
      child.tail → 子元素闭合标签后、下一个兄弟前的文本
    
    例如 <div>直接A<span>子</span>直接B<span>子2</span>直接C</div>
      → "直接A 直接B 直接C"
    """
    parts = []
    if el.text and el.text.strip():
        parts.append(el.text.strip())
    for child in el.iterchildren():
        if child.tail and child.tail.strip():
            parts.append(child.tail.strip())
    text = ' '.join(parts)
    return _truncate(text, max_text_len)


def get_child_text(el, child_delim: str = "", max_text_len: int = 2000) -> str:
    """提取子节点文本，用分隔符连接（空字符串则用 text_content 全拼接）"""
    if not child_delim:
        text = (el.text_content() or "").strip()
        return _truncate(text, max_text_len)
    parts = []
    if el.text and el.text.strip():
        parts.append(el.text.strip())
    for child in el.iterchildren():
        t = (child.text_content() or "").strip()
        if t:
            parts.append(t)
        if child.tail and child.tail.strip():
            parts.append(child.tail.strip())
    text = child_delim.join(parts)
    return _truncate(text, max_text_len)


def get_child_texts(el, child_delim: str = "", max_text_len: int = 2000):
    """提取子节点文本，返回 (拼接文本, 子文本列表)"""
    if not child_delim:
        text = (el.text_content() or "").strip()
        return _truncate(text, max_text_len), []
    parts = []
    if el.text and el.text.strip():
        parts.append(el.text.strip())
    for child in el.iterchildren():
        t = (child.text_content() or "").strip()
        if t:
            parts.append(t)
        if child.tail and child.tail.strip():
            parts.append(child.tail.strip())
    text = child_delim.join(parts)
    return _truncate(text, max_text_len), [p for p in parts if p]


# 常用属性中文别名
_COMMON_ATTRS = {
    "href": "链接", "src": "来源", "class": "类名", "id": "ID",
    "title": "标题", "alt": "替代文本", "type": "类型", "name": "名称",
    "value": "值", "target": "目标", "rel": "关系", "placeholder": "占位符",
    "style": "样式", "role": "角色", "aria-label": "ARIA标签",
    "action": "动作", "method": "方法",
}
# lxml.cssselect 不支持的伪类，查询前洗掉
_UNSUPPORTED_PSEUDO_RE = re.compile(
    r':(nth-of-type|nth-last-of-type|first-of-type|last-of-type|only-of-type)\(\d+\)'
)


def css_query(raw_html: str, selector: str, child_delim: str = "",
              max_text_len: int = 2000, max_results: int = 1000,
              expand_children: bool = False) -> dict:
    """执行 CSS 选择器查询"""
    try:
        # 清洗 lxml 不支持的伪类（保留选择器其余部分）
        clean_sel = _UNSUPPORTED_PSEUDO_RE.sub('', selector)
        doc = html.document_fromstring(raw_html)
        elements = doc.cssselect(clean_sel)

        # 限制结果数
        elements = elements[:max_results]

        results = []
        for el in elements:
            if expand_children:
                text, child_texts = get_child_texts(el, child_delim, max_text_len)
            else:
                text = get_child_text(el, '', max_text_len)  # 文本不拆分隔符
            info = {
                "标签": str(el.tag),
                "文本": text,
            }
            if expand_children and child_texts:
                info["_children"] = child_texts
            # 遍历所有属性，有中文别名则用别名，否则保留原名
            for k, v in (el.attrib or {}).items():
                cn = _COMMON_ATTRS.get(k)
                if cn:
                    info[cn] = v
                else:
                    info[k] = v

            # 父级关键属性平铺为独立列
            parent = el.getparent()
            if parent is not None:
                p_attrib = dict(parent.attrib) if parent.attrib else {}
                info["父级标签"] = str(parent.tag)
                if "class" in p_attrib:
                    info["父级类名"] = p_attrib["class"]
                if "id" in p_attrib:
                    info["父级ID"] = p_attrib["id"]
                if "href" in p_attrib:
                    info["父级链接"] = p_attrib["href"]

            results.append(info)

        total = len(doc.cssselect(clean_sel))
        return {"query": selector, "count": len(results), "total": total, "results": results}
    except Exception as e:
        return {"query": selector, "count": 0, "results": [], "error": str(e)}
