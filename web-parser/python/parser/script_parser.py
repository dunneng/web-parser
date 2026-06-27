"""
<script> 标签提取 & JSON 解析
"""
import re
import json


def extract_scripts(raw_html: str) -> list[dict]:
    """提取所有 <script> 标签的信息"""
    results = []
    # 匹配完整 script 标签
    pattern = re.compile(
        r'<script\b([^>]*?)>(.*?)</script>',
        re.IGNORECASE | re.DOTALL,
    )
    for idx, m in enumerate(pattern.finditer(raw_html)):
        attrs_str = m.group(1)
        content = m.group(2).strip()

        script_info = {
            "脚本序号": idx,
        }

        # 解析 type 属性
        type_match = re.search(r'type\s*=\s*["\']([^"\']*)["\']', attrs_str, re.IGNORECASE)
        if type_match:
            script_info["脚本类型"] = type_match.group(1)
        else:
            script_info["脚本类型"] = "text/javascript"

        # 解析 src 属性
        src_match = re.search(r'src\s*=\s*["\']([^"\']*)["\']', attrs_str, re.IGNORECASE)
        if src_match:
            script_info["脚本地址"] = src_match.group(1)
        else:
            script_info["脚本地址"] = ""

        # 内容截断
        if content:
            script_info["内容长度"] = len(content)
            script_info["内容"] = content[:50000]  # 限制大小
        else:
            script_info["内容长度"] = 0
            script_info["内容"] = ""

        results.append(script_info)

    return results


def parse_json_from_text(text: str) -> dict | list | None:
    """尝试从文本中提取 JSON 对象或数组"""
    # 去除前后空白和分号
    text = text.strip().rstrip(";").strip()

    # 直接尝试解析
    for func in [lambda s: json.loads(s)]:
        try:
            return func(text)
        except Exception:
            pass

    # 尝试匹配 JSON 对象
    json_objects = []
    brace_depth = 0
    brace_start = -1
    for i, ch in enumerate(text):
        if ch == "{":
            if brace_depth == 0:
                brace_start = i
            brace_depth += 1
        elif ch == "}":
            brace_depth -= 1
            if brace_depth == 0 and brace_start >= 0:
                candidate = text[brace_start:i + 1]
                try:
                    obj = json.loads(candidate)
                    if isinstance(obj, dict) and obj:
                        json_objects.append(obj)
                except Exception:
                    pass
                brace_start = -1

    # 尝试匹配 JSON 数组
    bracket_depth = 0
    bracket_start = -1
    for i, ch in enumerate(text):
        if ch == "[":
            if bracket_depth == 0:
                bracket_start = i
            bracket_depth += 1
        elif ch == "]":
            bracket_depth -= 1
            if bracket_depth == 0 and bracket_start >= 0:
                candidate = text[bracket_start:i + 1]
                try:
                    arr = json.loads(candidate)
                    if isinstance(arr, list) and arr:
                        json_objects.append(arr)
                except Exception:
                    pass
                bracket_start = -1

    if json_objects:
        return json_objects[0] if len(json_objects) == 1 else json_objects
    return None
