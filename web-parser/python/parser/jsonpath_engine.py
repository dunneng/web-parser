"""
JSONPath 查询引擎 — 统一引擎
  数据源：HTML（自动提取 JSON 块）或纯 JSON（API 响应）
  语法：  $.key  /  $..key  /  $[*].key  /  key（裸 key 名递归匹配）
"""
import re
import json


def jsonpath_query(raw_input: str, query: str) -> dict:
    """统一入口：自动识别输入类型，对所有 JSON 数据块执行查询"""
    q = query.strip()
    candidates = _collect_json_candidates(raw_input)
    all_results = []

    for c in candidates:
        data = c.get("数据")
        if data is None:
            continue
        hits = _jsonpath_search(data, q)
        for h in hits:
            all_results.append(h)

    # 去重：相同字典只保留一条
    seen, unique = set(), []
    for r in all_results:
        key = json.dumps(r, ensure_ascii=False, sort_keys=True, default=str)
        if key not in seen:
            seen.add(key)
            unique.append(r)
    all_results = unique

    # 包装简单值，确保前端表格可渲染
    wrapped = []
    for r in all_results:
        if isinstance(r, dict):
            wrapped.append(r)
        else:
            wrapped.append({"结果": r})

    return {"query": query, "count": len(wrapped), "results": wrapped}


# ──────── 数据源收集 ────────

def _collect_json_candidates(raw_input: str) -> list[dict]:
    """从输入中收集所有 JSON 数据块（统一：先整体解析，再 HTML 提取）"""
    candidates = []
    s = raw_input.strip()

    # 尝试整体解析（纯 JSON 字符串）
    if s.startswith('{') or s.startswith('['):
        try:
            candidates.append({"数据": json.loads(s), "来源": "API 响应"})
        except Exception:
            pass

    # 从 HTML 中提取 JSON 块（即使上面成功了也继续搜，避免遗漏混合内容）
    candidates.extend(_extract_json_from_html(raw_input))
    return candidates


def _extract_json_from_html(html: str) -> list[dict]:
    """从 HTML 中提取 JSON 数据块"""
    candidates = []

    # <script type="application/ld+json">
    for m in re.finditer(
        r'<script[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html, re.IGNORECASE | re.DOTALL,
    ):
        try:
            candidates.append({"数据": json.loads(m.group(1).strip()), "来源": "ld+json"})
        except Exception:
            pass

    # <script type="application/json">
    for m in re.finditer(
        r'<script[^>]*type\s*=\s*["\']application/json["\'][^>]*>(.*?)</script>',
        html, re.IGNORECASE | re.DOTALL,
    ):
        try:
            candidates.append({"数据": json.loads(m.group(1).strip()), "来源": "application/json"})
        except Exception:
            pass

    # window.__INITIAL_STATE__ = {...}
    for m in re.finditer(
        r'(?:window\.)?__[A-Z_]+__\s*=\s*(\{.*?\});',
        html, re.DOTALL,
    ):
        try:
            candidates.append({"数据": json.loads(m.group(1)), "来源": "内嵌状态JSON"})
        except Exception:
            pass

    # 普通 JSON 对象
    for m in re.finditer(r'\{[^{}]*"(?:\w+)":\s*"[^"]*"[^{}]*\}', html):
        try:
            data = json.loads(m.group())
            if isinstance(data, dict) and len(data) >= 2:
                candidates.append({"数据": data, "来源": "内嵌JSON对象"})
        except Exception:
            pass

    return candidates[:20]


# ──────── JSONPath 求值器（统一语法） ────────

def _jsonpath_search(data, query: str) -> list:
    """对任意 JSON 数据执行 JSONPath 查询，返回匹配值列表"""
    results = []
    _walk(data, query, '$', results)
    return results


def _walk(node, query: str, path: str, results: list):
    """递归遍历 JSON 树，匹配 query

    统一规则（不区分数据来源）：
      query == '$'             → 返回根节点
      query == 'key'           → 递归匹配所有同名 key
      query == '$.a.b'         → 精确路径
      query == '$..key'        → 递归查找 key
      query == '$[*].key'      → 数组通配 + 字段
      query == '$.a[*].b'      → 嵌套数组
    """
    # 路径精确匹配（包括 $[*] 通配符）
    if _path_matches(query, path):
        results.append(node)
        return

    # 裸 key 名：匹配当前 dict 中同名 key
    if _is_bare_key(query) and isinstance(node, dict) and query in node:
        results.append(node[query])
        # 继续递归，因为子孙节点也可能有同名 key

    # $..key 递归查找
    if query.startswith('$..'):
        target = query[3:]
        if isinstance(node, dict):
            for k, v in node.items():
                if k == target:
                    results.append(v)
                _walk(v, query, f'{path}.{k}', results)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                _walk(item, query, f'{path}[{i}]', results)
        return  # $.. 已经处理完，不继续下面的遍历

    # $ 根节点
    if query == '$' and path == '$':
        if isinstance(node, dict):
            for k, v in node.items():
                results.append({k: v})
        elif isinstance(node, list):
            results.extend(node)
        return

    # 继续递归
    if isinstance(node, dict):
        for k, v in node.items():
            _walk(v, query, f'{path}.{k}', results)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            _walk(item, query, f'{path}[{i}]', results)


# ──────── 路径匹配 ────────

def _is_bare_key(query: str) -> bool:
    """query 是不含 $ 的裸 key 名（如 'title'）"""
    return bool(query) and not query.startswith('$') and query.isidentifier()


def _path_matches(query: str, path: str) -> bool:
    """判断 query 是否匹配当前 path，支持 [*] 通配符"""
    if query == path:
        return True
    # 将 query 中的 [*] 替换为 [\d+] 做正则匹配
    # e.g. query=$[*].title, path=$[3].title → match
    if '[*]' not in query:
        return False
    pattern = re.escape(query)
    pattern = pattern.replace(r'\[\*\]', r'\[\d+\]')
    try:
        return bool(re.match(f'^{pattern}$', path))
    except Exception:
        return False
