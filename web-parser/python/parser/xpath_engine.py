"""
XPath 查询引擎
"""
from lxml import html
from .css_engine import get_child_text, get_child_texts, _truncate, _COMMON_ATTRS


def xpath_query(raw_html: str, query: str, child_delim: str = "",
                max_text_len: int = 2000, max_results: int = 1000,
                expand_children: bool = False) -> dict:
    """执行 XPath 查询"""
    try:
        doc = html.document_fromstring(raw_html)
        elements = doc.xpath(query)

        # 限制结果数
        elements = elements[:max_results]

        results = []
        for el in elements:
            if isinstance(el, str):
                results.append({"类型": "文本", "匹配": _truncate(el, max_text_len)})
            elif hasattr(el, "tag"):
                if expand_children:
                    text, child_texts = get_child_texts(el, child_delim, max_text_len)
                else:
                    text = get_child_text(el, child_delim, max_text_len)
                info = {
                    "标签": str(el.tag),
                    "文本": text,
                    "类型": "元素",
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
            else:
                results.append({"类型": "其他", "匹配": _truncate(str(el), min(max_text_len, 500))})

        total = len(doc.xpath(query))
        return {"query": query, "count": len(results), "total": total, "results": results}
    except Exception as e:
        return {"query": query, "count": 0, "results": [], "error": str(e)}
