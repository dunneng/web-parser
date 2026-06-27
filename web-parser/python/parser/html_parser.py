"""
HTML 格式化器
"""
from lxml import html as lxml_html, etree


def format_html(raw_html: str) -> str:
    """格式化 HTML 源码，美化缩进"""
    try:
        doc = lxml_html.fromstring(raw_html)
        return etree.tostring(doc, pretty_print=True, encoding="unicode")
    except Exception:
        # 用 lxml html parser 再试
        try:
            parser = lxml_html.HTMLParser(remove_blank_text=True)
            doc = lxml_html.document_fromstring(raw_html, parser=parser)
            return etree.tostring(doc, pretty_print=True, encoding="unicode")
        except Exception:
            return raw_html


def get_source_stats(raw_html: str) -> dict:
    """统计源码信息"""
    import re
    size = len(raw_html)
    lines = raw_html.count("\n") + 1

    scripts = len(re.findall(r"<script[\s>]", raw_html, re.IGNORECASE))
    links = len(re.findall(r"<a[\s>]", raw_html, re.IGNORECASE))
    images = len(re.findall(r"<img[\s>]", raw_html, re.IGNORECASE))
    forms = len(re.findall(r"<form[\s>]", raw_html, re.IGNORECASE))
    tables = len(re.findall(r"<table[\s>]", raw_html, re.IGNORECASE))

    return {
        "大小": f"{size / 1024:.1f} KB",
        "行数": lines,
        "script标签": scripts,
        "链接(a)": links,
        "图片(img)": images,
        "表单": forms,
        "表格": tables,
        "字符数": size,
    }
