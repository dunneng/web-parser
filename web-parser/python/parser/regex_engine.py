"""
正则提取引擎
"""
import re


# 正则匹配的输入大小上限，防止灾难性回溯导致服务卡死
_MAX_REGEX_INPUT = 5 * 1024 * 1024  # 5 MB


def regex_search(raw_html: str, pattern: str, max_results: int = 200) -> dict:
    """执行正则搜索"""
    try:
        # 限制输入大小，防止 ReDoS 灾难性回溯
        if len(raw_html) > _MAX_REGEX_INPUT:
            raw_html = raw_html[:_MAX_REGEX_INPUT]
        # 限制正则长度，防止极端复杂模式
        if len(pattern) > 10000:
            return {"query": pattern, "count": 0, "results": [], "error": "正则表达式过长（上限 10000 字符）"}

        compiled = re.compile(pattern, re.IGNORECASE | re.DOTALL)
        matches = compiled.finditer(raw_html)

        results = []
        for idx, m in enumerate(matches):
            if idx >= max_results:
                break
            item = {}
            # 命名分组
            if m.groupdict():
                for k, v in m.groupdict().items():
                    item[k] = str(v)[:500]
            # 数字分组
            else:
                for gi in range(len(m.groups()) + 1):
                    try:
                        val = m.group(gi)
                        if val:
                            if gi == 0:
                                key = "完整匹配"
                            else:
                                key = f"分组{gi}"
                            item[key] = val[:500]
                    except IndexError:
                        pass
            if item:
                results.append(item)

        return {"query": pattern, "count": len(results), "results": results}
    except re.error as e:
        return {"query": pattern, "count": 0, "results": [], "error": f"正则表达式错误: {e}"}
