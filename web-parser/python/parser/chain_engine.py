"""
链路提取引擎
从 HTML 中用 lxml 执行 walkUp 链路提取，用于解决虚拟列表 DOM 不完整的问题
"""
import logging
logger = logging.getLogger(__name__)
from lxml import html, etree
from .css_engine import get_child_text, get_direct_text, _truncate


def _walk_sub_chain(el, sub_chain: dict):
    """递归走进子链路树，返回最终目标元素（1:1 取首个匹配）"""
    if not sub_chain or el is None:
        return el

    sub_sel = sub_chain.get('selector', '')
    sub_type = sub_chain.get('chainType', 'css')
    sub_idx = sub_chain.get('chainIndex', 0)

    if not sub_sel:
        return el

    try:
        if sub_type == 'xpath':
            if not sub_sel.startswith('/'):
                sub_sel = '.' + sub_sel
            sub_els = el.xpath(sub_sel)
        else:
            sub_els = el.cssselect(sub_sel)

        if not sub_els:
            return None

        target = sub_els[0]  # 1:1，取第一个
        for _ in range(sub_idx):
            target = target.getparent()
            if target is None:
                return None
    except Exception:
        return el

    # 递归继续往里走
    nested = sub_chain.get('subChain')
    if nested:
        return _walk_sub_chain(target, nested)
    return target


def trace_chain_backend(raw_html: str, chain_type: str, selector: str) -> dict:
    """从 HTML 中用 lxml 做 DOM 溯源，返回祖先链 [{t,c,i},...]（从根到最深）"""
    try:
        doc = html.document_fromstring(raw_html)
    except Exception:
        return {"ancestors": [], "error": "HTML parse fail"}

    try:
        if chain_type == 'xpath':
            els = doc.xpath(selector)
        else:
            els = doc.cssselect(selector)
            if not els:
                from lxml.cssselect import CSSSelector
                try:
                    els = doc.xpath(CSSSelector(selector).path)
                except Exception:
                    pass
    except Exception as e:
        return {"ancestors": [], "error": str(e)}

    if not els:
        return {"ancestors": [], "html_len": len(raw_html)}

    el = els[0]
    ancestors = []
    # 走到 body/html 或最多 10 层
    while el is not None and el.tag is not etree.Comment and len(ancestors) < 10:
        tag = (el.tag or '').lower()
        if tag in ('html', 'body'):
            break
        cls = (el.get('class') or '').strip()
        first_cls = cls.split()[0] if cls else ''
        el_id = (el.get('id') or '').strip()
        ancestors.append({"t": tag, "c": first_cls, "i": el_id})
        el = el.getparent()

    # 返回 deepest→root 顺序（与前端 webview.executeJavaScript 一致），前端会 slice().reverse() 转回 root→deepest
    return {"ancestors": ancestors}

def chain_extract(raw_html: str, chain_type: str, deepest_selector: str,
                  fields: list[dict], child_delim: str = "") -> dict:
    """执行链路提取，返回 {rows, counts, totalRows, headers}"""
    try:
        doc = html.document_fromstring(raw_html)
    except Exception:
        return {'rows': [], 'counts': [], 'totalRows': 0, 'headers': [], '_debug': {'target_count': 0, 'selector': deepest_selector, 'error': 'HTML parse fail'}}

    # 查询最深元素 - 尝试 cssselect，失败则转 XPath
    targets = []
    try:
        if chain_type == 'xpath':
            targets = doc.xpath(deepest_selector)
        else:
            targets = doc.cssselect(deepest_selector)
            logger.info(f"[链路] cssselect('{deepest_selector[:80]}') → {len(targets)} 个目标")
            if not targets:
                # cssselect 返回空，尝试用转译的 XPath
                from lxml.cssselect import CSSSelector
                try:
                    xpath = CSSSelector(deepest_selector).path
                    targets = doc.xpath(xpath)
                except Exception:
                    pass
    except Exception as e:
        return {
            'rows': [], 'counts': [], 'totalRows': 0, 'headers': [],
            '_debug': {'target_count': 0, 'selector': deepest_selector, 'error': str(e)},
        }

    if not targets:
        return {
            'rows': [], 'counts': [], 'totalRows': 0, 'headers': [],
            '_debug': {'target_count': 0, 'selector': deepest_selector, 'html_len': len(raw_html)},
        }

    # 由 field 推算总段数
    n_segments = 1
    for f in fields:
        ns = f.get('nSegments')
        if ns:
            n_segments = ns
            break
    columns = []
    max_len = 0

    for f in fields:
        chain_index = f.get('chainIndex', 0)
        attr_name = f.get('attr', None)
        is_text = f.get('isText', False)
        sub_chain = f.get('subChain', None)
        name = f.get('name', '')
        walk_up = n_segments - 1 - chain_index

        values = []
        for el in targets:
            target = el
            # walkUp: 从最深元素往上走到目标层级
            for _ in range(walk_up):
                target = target.getparent()
                if target is None:
                    break

            if target is None:
                values.append('')
                continue

            # sub-chain (递归支持无限嵌套)
            if sub_chain:
                walked = _walk_sub_chain(target, sub_chain)
                if walked is None:
                    values.append('')
                    continue
                target = walked

            # 提取值
            if f.get('childText') and f.get('childSelectors'):
                # $childText: 从当前元素中查询子元素，拼接文本
                parts = []
                seen = set()
                for cs in f.get('childSelectors', []):
                    try:
                        if cs.startswith('/') or cs.startswith('./'):
                            child_els = target.xpath(cs)
                        else:
                            # :scope 限定在当前 target 内，避免 nth-child 跨元素计数
                            child_els = target.cssselect(':scope ' + cs)
                        for ce in child_els:
                            kid = hash(ce)
                            if kid in seen:
                                continue
                            seen.add(kid)
                            parts.append((ce.text_content() or '').strip())
                    except Exception:
                        pass
                v = (f.get('childDelimiter', '') or '').join(parts)
            elif is_text or not attr_name:
                v = get_child_text(target, '', 5000)
            else:
                v = (target.get(attr_name) or '')
            values.append(v)

        columns.append(values)
        non_empty = sum(1 for v in values if v and str(v).strip())
        logger.info(f"[链路] 字段 '{name}' (chainIndex={chain_index}, walkUp={walk_up}) → {non_empty}/{len(values)} 条非空")
        if len(values) > max_len:
            max_len = len(values)

    # 组装 rows
    rows = []
    for r in range(max_len):
        row = {}
        for c, f in enumerate(fields):
            val = columns[c][r] if r < len(columns[c]) else ''
            key = f.get('name') or ('字段' + str(c + 1))
            row[key] = str(val) if val else ''
        rows.append(row)

    headers = [f.get('name') or ('字段' + str(i + 1)) for i, f in enumerate(fields)]
    counts = [len(c) for c in columns]

    return {
        'rows': rows,
        'counts': counts,
        'totalRows': max_len,
        'headers': headers,
        '_debug': {
            'target_count': len(targets),
            'selector': deepest_selector,
            'chain_type': chain_type,
        },
    }
