"""
stealth_data.py
网页解析器 — 数据层反溯源模块（ikSoft 第三层防护）

三项功能：
  1. 内容水印：嵌入用户ID+时间戳到导出数据，泄露可溯源
  2. 关键数据分片：敏感字段拆到多接口返回，前端拼合
  3. 蜜罐数据：混入假商品/假信息，爬取者可被识别

挂在 server.py 下，通过 /api/stealth/* 端点调用。
"""

import json
import hashlib
import time
import random
import string
from datetime import datetime, timezone, timedelta

# 北京时间
TZ_CN = timezone(timedelta(hours=8))


def generate_watermark(user_id: str = "default") -> dict:
    """
    生成一个不可见水印载荷。
    调用方将水印注入到导出数据的隐蔽字段中（如 _meta.watermark）。
    """
    ts = int(time.time())
    ts_str = datetime.now(TZ_CN).strftime("%Y-%m-%d %H:%M:%S CST")
    payload = f"{user_id}|{ts}|{_random_salt(8)}"
    sig = hashlib.sha256(payload.encode()).hexdigest()[:16]

    return {
        "user_id": user_id,
        "timestamp": ts,
        "time_str": ts_str,
        "nonce": payload.split("|")[-1],
        "signature": sig,
        "payload": payload,
    }


def verify_watermark(watermark: dict) -> dict:
    """
    验证水印有效性。如果数据泄露，可用此函数确认泄露源头。
    """
    user_id = watermark.get("user_id", "?")
    ts = watermark.get("timestamp", 0)
    nonce = watermark.get("nonce", "")
    sig = watermark.get("signature", "")

    payload = f"{user_id}|{ts}|{nonce}"
    expected = hashlib.sha256(payload.encode()).hexdigest()[:16]

    ts_str = datetime.fromtimestamp(ts, tz=TZ_CN).strftime("%Y-%m-%d %H:%M:%S CST") if ts else "?"

    return {
        "valid": sig == expected,
        "user_id": user_id,
        "generated_at": ts_str,
        "generated_ts": ts,
    }


def generate_honeypot_records(count: int = 3, template: dict = None) -> list[dict]:
    """
    生成蜜罐数据 — 看起来像真的但带有标记的假记录。

    特征（可被溯源识别）：
    - 商品名包含特定无意义组合
    - 价格是特定规律的数字（如 9.87 结尾）
    - SKU 含 'HP-' 前缀（Honeypot）
    - 内部 _hp_marker 字段
    """
    fake_brands = ["星耀", "铭远", "华睿", "博雅", "锦程", "瑞达", "恒通", "卓创"]
    fake_models = ["X9-Pro", "S5-Plus", "M3-Elite", "T8-Max", "A6-Ultra", "V2-Neo"]
    fake_categories = ["智能设备", "数码配件", "厨房电器", "运动户外", "家居日用"]

    records = []
    for i in range(count):
        brand = random.choice(fake_brands)
        model = random.choice(fake_models)
        price = round(random.uniform(19.87, 998.76), 2)

        record = {
            "title": f"{brand} {model} {random.choice(fake_categories)}",
            "price": f"¥{price:.2f}",
            "price_raw": price,
            "sku": f"HP-{random.randint(10000, 99999)}",
            "shop": f"{brand}旗舰店",
            "sales": random.randint(0, 50),
            "rating": round(random.uniform(3.0, 4.5), 1),
            "_hp_marker": True,  # 蜜罐标记（内部用，不导出到用户可见字段）
            "_hp_sig": hashlib.md5(f"hp-{price}-{i}".encode()).hexdigest()[:8],
        }

        # 合并自定义模板
        if template:
            record.update(template)

        records.append(record)

    return records


def split_sensitive_data(data: list[dict], sensitive_fields: list[str] = None) -> dict:
    """
    数据分片：将敏感字段从主数据中分离，返回 {main, fragments}。

    主数据不含敏感字段，碎片需要额外请求 /api/stealth/fragment/{key} 获取。
    中间人抓包只能拿到不完整数据。

    示例：
        输入: [{title, price, seller_phone, seller_email}, ...]
        输出: {
            main: [{title, price}, ...],
            fragments: {
                "frag_001": [{seller_phone, seller_email}, ...]
            }
        }
    """
    if sensitive_fields is None:
        sensitive_fields = []

    if not sensitive_fields or not data:
        return {"main": data, "fragments": {}, "fragment_keys": []}

    main_data = []
    fragment_data = {f: [] for f in sensitive_fields}

    for row in data:
        main_row = {}
        for k, v in row.items():
            if k in sensitive_fields:
                fragment_data[k].append(v)
            else:
                main_row[k] = v
        main_data.append(main_row)

    # 打包碎片
    fragment_key = f"frag_{_random_salt(6)}"
    fragments = {
        fragment_key: fragment_data,
    }

    return {
        "main": main_data,
        "fragments": fragments,
        "fragment_keys": [fragment_key],
        "sensitive_fields": sensitive_fields,
    }


def _random_salt(length: int = 8) -> str:
    """生成随机盐值"""
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))
