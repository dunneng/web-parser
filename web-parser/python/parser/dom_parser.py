"""
DOM 树构建器
返回嵌套的 JSON 树结构，UI 可直接渲染
"""
from lxml import html, etree


def _truncate(text: str, max_len: int) -> str:
    """截断文本，超过长度时加 ..."""
    if len(text) > max_len:
        return text[:max_len] + "..."
    return text


def build_dom_tree(raw_html: str, max_depth: int = 20, max_text_len: int = 2000, max_children: int = 200) -> dict:
    """构建 DOM 树为 JSON 结构"""
    try:
        parser = html.HTMLParser(remove_blank_text=False, remove_comments=False)
        doc = html.document_fromstring(raw_html, parser=parser)
        return _node_to_dict(doc, depth=0, max_depth=max_depth, max_text_len=max_text_len, max_children=max_children)
    except Exception as e:
        return {"error": str(e), "tag": "#error", "text": str(e)}


def _node_to_dict(node, depth: int, max_depth: int, max_text_len: int, max_children: int = 200) -> dict | None:
    """递归构建节点"""
    if depth > max_depth:
        return None

    # 处理文本节点
    if isinstance(node, (str, etree._ElementUnicodeResult)):
        text = str(node).strip()
        if text:
            return {"tag": "#text", "text": _truncate(text, max_text_len)}
        return None

    # 处理注释
    if node.tag is etree.Comment:
        text = node.text.strip() if node.text else ""
        if text:
            return {"tag": "#comment", "text": _truncate(text, min(max_text_len, 500))}
        return None

    if node.tag is etree.PI:
        return None

    tag = str(node.tag)

    # 属性
    attrs = {}
    attr_max = min(max_text_len, 1000)
    for k, v in node.attrib.items():
        attrs[k] = _truncate(v, attr_max) if v else ""

    # 构建节点
    result = {"tag": tag}
    if attrs:
        result["属性"] = attrs

    # 构建简短的显示标识
    display = tag
    if "id" in attrs:
        display += f"#{attrs['id']}"
    if "class" in attrs:
        classes = attrs["class"].split()[:3]
        display += "." + ".".join(classes)
    result["_display"] = display

    # 文本内容 (直接文本)
    if node.text and node.text.strip():
        result["文本"] = _truncate(node.text.strip(), max_text_len)

    # 子节点
    children = []
    total = 0
    if depth < max_depth:
        for child in node:
            total += 1
            if len(children) < max_children:
                child_dict = _node_to_dict(child, depth + 1, max_depth, max_text_len, max_children)
                if child_dict:
                    children.append(child_dict)

    if children:
        result["子元素"] = children
        result["子元素数"] = len(children)
        if total > max_children:
            result["_截断"] = total - max_children

    return result


def dom_to_flat_list(raw_html: str, max_text_len: int = 2000) -> list[dict]:
    """将 DOM 展平为列表（用于表格导出）"""
    try:
        parser = html.HTMLParser(remove_blank_text=True)
        doc = html.document_fromstring(raw_html, parser=parser)
        items = []
        _flatten(doc, items, 0, max_text_len)
        return items
    except Exception as e:
        return [{"error": str(e)}]


def _flatten(node, items: list, depth: int, max_text_len: int):
    """递归展平节点"""
    from lxml import etree
    if depth > 30:
        return
    if isinstance(node, (str, etree._ElementUnicodeResult)):
        return
    if node.tag in (etree.Comment, etree.PI):
        return

    info = {
        "标签": str(node.tag),
        "类名": node.attrib.get("class", ""),
        "ID": node.attrib.get("id", ""),
        "文本": _truncate((node.text or "").strip(), max_text_len),
        "深度": depth,
    }
    # 特定标签的快捷字段
    tag_lower = str(node.tag).lower()
    if tag_lower == "a":
        info["链接"] = node.attrib.get("href", "")
    elif tag_lower == "img":
        info["来源"] = node.attrib.get("src", "")
    elif tag_lower in ("script",):
        info["来源"] = node.attrib.get("src", "")

    items.append(info)

    for child in node:
        _flatten(child, items, depth + 1, max_text_len)
