"""
数据库持久化层 — SQLite
替代内存字典，应用重启后数据不丢失
"""
import sqlite3
import json
import os
import time
from pathlib import Path
from contextlib import contextmanager
import logging

logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent / "data"
DB_DIR.mkdir(exist_ok=True)
DB_PATH = DB_DIR / "parser.db"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """初始化数据库表结构"""
    conn = get_connection()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS elements (
                id          TEXT PRIMARY KEY,
                dedup_key   TEXT UNIQUE,
                html        TEXT,
                selector    TEXT,
                xpath       TEXT,
                source      TEXT,
                tag         TEXT,
                text_content TEXT,
                class_name  TEXT,
                element_id  TEXT,
                href        TEXT,
                src         TEXT,
                page_url    TEXT DEFAULT '',
                clean_selector TEXT DEFAULT '',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_elements_dedup ON elements(dedup_key);
            CREATE TABLE IF NOT EXISTS element_batches (
                page_url    TEXT NOT NULL,
                data_json   TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                snapshot_id INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_element_batches_snap ON element_batches(snapshot_id);

            CREATE TABLE IF NOT EXISTS chain_schemes (
                name        TEXT PRIMARY KEY,
                data_json   TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS collected (
                collect_id  TEXT NOT NULL,
                row_index   INTEGER NOT NULL,
                data_json   TEXT NOT NULL,
                source      TEXT DEFAULT '',
                url         TEXT DEFAULT '',
                created_at  TEXT NOT NULL,
                PRIMARY KEY (collect_id, row_index)
            );
            CREATE INDEX IF NOT EXISTS idx_collected_id ON collected(collect_id);

            CREATE TABLE IF NOT EXISTS collections_meta (
                collect_id  TEXT PRIMARY KEY,
                source      TEXT DEFAULT '',
                url         TEXT DEFAULT '',
                row_count   INTEGER DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS schemas (
                name        TEXT PRIMARY KEY,
                fields_json TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key         TEXT PRIMARY KEY,
                value_json  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            -- ============================================
            -- 跨平台比价：商品表
            -- ============================================
            CREATE TABLE IF NOT EXISTS products (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                platform      TEXT    NOT NULL,           -- taobao / jd / pdd / 1688 / tmall
                platform_url  TEXT    NOT NULL,           -- 商品原始链接
                title         TEXT    DEFAULT '',         -- 商品标题
                price         REAL    DEFAULT 0,          -- 到手价
                original_price REAL   DEFAULT 0,          -- 标价
                shop_name     TEXT    DEFAULT '',         -- 店铺名
                main_image_url TEXT   DEFAULT '',         -- 原始主图 URL
                local_image   TEXT    DEFAULT '',         -- 本地保存的图片路径
                attrs_json    TEXT    DEFAULT '{}',       -- 属性 JSON (品牌/型号/规格)
                stock_info    TEXT    DEFAULT '',         -- 库存/销量信息
                shipping      TEXT    DEFAULT '',         -- 运费/物流
                description   TEXT    DEFAULT '',         -- 商品详情介绍（文字）
                image_urls    TEXT    DEFAULT '[]',       -- 所有图片 URL 列表 JSON
                skus          TEXT    DEFAULT '[]',       -- SKU 列表 JSON: [{color,size,price,images:[idx]}]
                status        TEXT    DEFAULT 'active',   -- active | deleted
                created_at    TEXT    NOT NULL,
                updated_at    TEXT    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_products_platform ON products(platform);
            CREATE INDEX IF NOT EXISTS idx_products_title ON products(title);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_products_url
                ON products(platform, platform_url);

            -- 多 SKU 子表（颜色、尺码、规格变体）
            CREATE TABLE IF NOT EXISTS product_skus (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id    INTEGER NOT NULL,
                sku_name      TEXT    DEFAULT '',         -- 显示名（如 "黑色 S码"）
                color         TEXT    DEFAULT '',         -- 颜色
                size          TEXT    DEFAULT '',         -- 尺码
                spec          TEXT    DEFAULT '',         -- 其他规格
                sku_image_url TEXT    DEFAULT '',         -- SKU 专属图片 URL
                local_image   TEXT    DEFAULT '',         -- 本地已下载图片
                price         REAL    DEFAULT 0,
                stock         TEXT    DEFAULT '',
                status        TEXT    DEFAULT 'active',
                created_at    TEXT    NOT NULL,
                updated_at    TEXT    NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products(id)
            );
            CREATE INDEX IF NOT EXISTS idx_skus_product ON product_skus(product_id);
            CREATE INDEX IF NOT EXISTS idx_skus_color ON product_skus(color);
            CREATE INDEX IF NOT EXISTS idx_skus_size ON product_skus(size);
        """)
        conn.commit()
        # 迁移：旧表无 snapshot_id 列，重建
        try:
            cur = conn.execute("PRAGMA table_info(element_batches)")
            cols = [c[1] for c in cur.fetchall()]
            if 'snapshot_id' not in cols:
                conn.execute("DROP TABLE IF EXISTS element_batches")
                conn.execute("CREATE TABLE IF NOT EXISTS element_batches (page_url TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, snapshot_id INTEGER NOT NULL DEFAULT 0)")
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_element_batches_snap ON element_batches(snapshot_id)")
        except Exception:
            pass


        # 迁移：为旧数据库添加 description 列
        try:
            conn.execute("ALTER TABLE products ADD COLUMN description TEXT DEFAULT ''")
            logger.info("✓ 迁移: products 表已添加 description 列")
        except sqlite3.OperationalError:
            pass  # 列已存在

        # 迁移：添加 chain_data 表
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS chain_data (scheme_name TEXT PRIMARY KEY, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
        except Exception:
            pass

        # 迁移：添加 page_snapshots 表（翻页批量提取）
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS page_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT DEFAULT '', html TEXT NOT NULL, created_at TEXT NOT NULL)")
        except Exception:
            pass

        # 迁移：elements 表添加 page_url 列
        try:
            conn.execute("ALTER TABLE elements ADD COLUMN page_url TEXT DEFAULT ''")
        except Exception:
            pass

        # 迁移：elements 表添加 clean_selector 列
        try:
            conn.execute("ALTER TABLE elements ADD COLUMN clean_selector TEXT DEFAULT ''")
        except Exception:
            pass

        # 迁移：elements 表添加 snapshot_id 列（关联 page_snapshots）
        try:
            conn.execute("ALTER TABLE elements ADD COLUMN snapshot_id INTEGER DEFAULT 0")
        except Exception:
            pass

        logger.info(f"数据库已初始化: {DB_PATH}")
    finally:
        conn.close()


# 已注册元素 CRUD

def register_elements(elements: list[dict]) -> dict:
    registered = []
    updated = []
    skipped = []

    with get_db() as db:
        now = _now_iso()
        # 1. 批量查询已存在的 dedup_key（一次 SQL）
        dks = [e.get("dedupKey", "") for e in elements if e.get("dedupKey", "")]
        placeholders = ','.join(['?'] * len(dks)) if dks else 'NULL'
        existing_map = {}
        if dks:
            rows = db.execute(
                f"SELECT id, dedup_key FROM elements WHERE dedup_key IN ({placeholders})",
                dks
            ).fetchall()
            existing_map = {r["dedup_key"]: r["id"] for r in rows}

        # 2. 分类：新增 vs 更新（批次内去重防 UNIQUE 冲突）
        new_rows = []
        update_rows = []
        seen_in_batch = set()  # 批次内去重
        for elem in elements:
            dk = elem.get("dedupKey", "")
            if not dk:
                skipped.append({"reason": "empty dedupKey", "selector": elem.get("selector", "")})
                continue
            if dk in seen_in_batch:
                skipped.append({"reason": "batch duplicate", "dedupKey": dk[:80]})
                continue
            seen_in_batch.add(dk)
            eid = existing_map.get(dk)
            if eid:
                update_rows.append((elem.get("outerHTML",""), elem.get("selector",""), elem.get("xpath",""),
                    elem.get("source",""), elem.get("tag",""), elem.get("text",""),
                    elem.get("className",""), elem.get("elementId",""),
                    elem.get("href",""), elem.get("src",""), elem.get("page_url",""),
                    elem.get("clean_selector",""), elem.get("snapshot_id", 0), now, eid))
                updated.append(eid)
            else:
                eid = f"elem_{int(time.time()*1000)}_{len(registered)+len(updated)}"
                new_rows.append((eid, dk, elem.get("outerHTML",""), elem.get("selector",""),
                    elem.get("xpath",""), elem.get("source",""), elem.get("tag",""),
                    elem.get("text",""), elem.get("className",""), elem.get("elementId",""),
                    elem.get("href",""), elem.get("src",""), elem.get("page_url",""),
                    elem.get("clean_selector",""), elem.get("snapshot_id", 0), now, now))
                registered.append(eid)

        # 3. 批量 UPDATE（一次 SQL）
        if update_rows:
            db.executemany("""
                UPDATE elements SET html=?, selector=?, xpath=?, source=?, tag=?,
                    text_content=?, class_name=?, element_id=?, href=?, src=?, page_url=?, clean_selector=?, snapshot_id=?, updated_at=?
                WHERE id=?
            """, update_rows)

        # 4. 批量 INSERT（一次 SQL）
        if new_rows:
            db.executemany("""
                INSERT INTO elements (id, dedup_key, html, selector, xpath, source,
                    tag, text_content, class_name, element_id, href, src, page_url, clean_selector, snapshot_id, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, new_rows)

        total = db.execute("SELECT COUNT(*) as cnt FROM elements").fetchone()["cnt"]

    return {"ok": True, "registered": registered, "updated": updated, "skipped": skipped, "total": total}


def list_elements() -> list[dict]:
    with get_db() as db:
        rows = db.execute("""
            SELECT * FROM elements ORDER BY updated_at DESC
        """).fetchall()
    return [{
        "id": r["id"], "dedupKey": r["dedup_key"], "html": r["html"],
        "selector": r["selector"], "xpath": r["xpath"], "source": r["source"],
        "tag": r["tag"], "text": r["text_content"], "className": r["class_name"],
        "elementId": r["element_id"], "href": r["href"], "src": r["src"],
        "page_url": r["page_url"] or "",
        "clean_selector": r["clean_selector"] or "",
        "snapshot_id": r["snapshot_id"] or 0,
        "registered_at": r["created_at"], "updated_at": r["updated_at"],
    } for r in rows]


def upsert_element_batch(page_url: str, snapshot_id: int, data: dict) -> dict:
    import json as _json
    data_json = _json.dumps(data, ensure_ascii=False)
    now = _now_iso()
    with get_db() as db:
        db.execute("INSERT INTO element_batches (page_url, data_json, created_at, updated_at, snapshot_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(snapshot_id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at", (page_url, data_json, now, now, snapshot_id))
        return {"ok": True}


def get_element_batch(snapshot_id: int) -> dict | None:
    import json as _json
    with get_db() as db:
        row = db.execute("SELECT data_json FROM element_batches WHERE snapshot_id = ?", (snapshot_id,)).fetchone()
        if row:
            return _json.loads(row["data_json"])
        return None



def clear_elements(element_ids: list[str] | None = None) -> dict:
    with get_db() as db:
        if element_ids:
            for eid in element_ids:
                db.execute("DELETE FROM elements WHERE id = ?", (eid,))
            remaining = db.execute("SELECT COUNT(*) as cnt FROM elements").fetchone()["cnt"]
            return {"ok": True, "deleted": len(element_ids), "remaining": remaining}
        else:
            db.execute("DELETE FROM elements")
            return {"ok": True, "deleted": "all", "remaining": 0}


# 采集数据 CRUD

def ingest_collected(collect_id: str, source: str, url: str, rows: list[dict]) -> dict:
    if not rows:
        return {"ok": True, "total": 0, "added": 0, "collect_id": collect_id}
    now = _now_iso()
    with get_db() as db:
        existing_hashes = set()
        for er in db.execute("SELECT data_json FROM collected WHERE collect_id=?", (collect_id,)).fetchall():
            try:
                existing_hashes.add(er["data_json"].split("::HASH::")[0] if "::HASH::" in er["data_json"] else er["data_json"])
            except: pass
        max_idx_row = db.execute("SELECT MAX(row_index) FROM collected WHERE collect_id=?", (collect_id,)).fetchone()
        max_idx = (max_idx_row[0] or -1)
        added = 0
        for row in rows:
            norm = json.dumps(row, ensure_ascii=False, sort_keys=True)
            if norm not in existing_hashes:
                max_idx += 1
                db.execute("INSERT OR IGNORE INTO collected VALUES (?,?,?,?,?,?)",
                           (collect_id, max_idx, norm + "::HASH::" + str(hash(norm) & 0xFFFFFFFF), source, url, now))
                existing_hashes.add(norm)
                added += 1
        total = db.execute("SELECT COUNT(*) FROM collected WHERE collect_id=?", (collect_id,)).fetchone()[0]
        meta_exists = db.execute("SELECT 1 FROM collections_meta WHERE collect_id=?", (collect_id,)).fetchone()
        if meta_exists:
            db.execute("UPDATE collections_meta SET source=?,url=?,row_count=?,updated_at=? WHERE collect_id=?",
                       (source, url, total, now, collect_id))
        else:
            db.execute("INSERT INTO collections_meta VALUES (?,?,?,?,?,?)",
                       (collect_id, source, url, total, now, now))
    logger.info(f"[collect] {collect_id} total={total} added={added}")
    return {"ok": True, "total": total, "added": added, "collect_id": collect_id, "source": source}


def load_collected(collect_id: str) -> list[dict]:
    with get_db() as db:
        rows = db.execute("SELECT data_json FROM collected WHERE collect_id=? ORDER BY row_index", (collect_id,)).fetchall()
    result = []
    for r in rows:
        data = r["data_json"].split("::HASH::")[0] if "::HASH::" in r["data_json"] else r["data_json"]
        try: result.append(json.loads(data))
        except: result.append({"raw": data})
    return result


def load_collected_meta(collect_id: str) -> dict:
    with get_db() as db:
        row = db.execute("SELECT * FROM collections_meta WHERE collect_id=?", (collect_id,)).fetchone()
        return {"source": row["source"], "url": row["url"], "row_count": row["row_count"]} if row else {}


def list_collections() -> list[dict]:
    with get_db() as db:
        rows = db.execute("SELECT * FROM collections_meta ORDER BY updated_at DESC").fetchall()
    return [{"collect_id": r["collect_id"], "source": r["source"], "url": r["url"],
             "row_count": r["row_count"], "size": r["row_count"], "mtime": r["updated_at"]} for r in rows]


def clean_collected(collect_id: str, rules: list[dict]) -> dict:
    rows = load_collected(collect_id)
    if not rows: return {"ok": True, "rows": [], "total": 0}
    import re as _re
    cleaned = list(rows)
    for rule in rules:
        rtype, field = rule.get("type",""), rule.get("field","")
        if rtype == "trim":
            for r in cleaned:
                if field in r and isinstance(r[field], str): r[field] = r[field].strip()
        elif rtype == "strip_empty":
            cleaned = [r for r in cleaned if r.get(field,"") != ""]
        elif rtype == "dedup":
            seen, deduped = set(), []
            for r in cleaned:
                key = json.dumps(r, ensure_ascii=False, sort_keys=True)
                if key not in seen: seen.add(key); deduped.append(r)
            cleaned = deduped
        elif rtype == "regex":
            pat = rule.get("pattern","")
            if field and pat:
                for r in cleaned:
                    if field in r and isinstance(r[field], str):
                        m = _re.search(pat, r[field]); r[field] = m.group(0) if m else ""
    save_collected(collect_id, cleaned, load_collected_meta(collect_id))
    return {"ok": True, "rows": cleaned, "total": len(cleaned)}


def save_collected(collect_id: str, rows: list[dict], meta: dict = None):
    with get_db() as db:
        db.execute("DELETE FROM collected WHERE collect_id=?", (collect_id,))
        now = _now_iso()
        src = meta.get("source","") if meta else ""
        url = meta.get("url","") if meta else ""
        for i, row in enumerate(rows):
            db.execute("INSERT INTO collected VALUES (?,?,?,?,?,?)",
                       (collect_id, i, json.dumps(row, ensure_ascii=False, sort_keys=True), src, url, now))
        db.execute("INSERT OR REPLACE INTO collections_meta VALUES (?,?,?,?,?,?)",
                   (collect_id, src, url, len(rows), now, now))


def delete_collected(collect_id: str = "") -> dict:
    with get_db() as db:
        if collect_id:
            db.execute("DELETE FROM collected WHERE collect_id=?", (collect_id,))
            db.execute("DELETE FROM collections_meta WHERE collect_id=?", (collect_id,))
            return {"ok": True, "deleted": collect_id}
        db.execute("DELETE FROM collected")
        db.execute("DELETE FROM collections_meta")
    return {"ok": True, "deleted": "all"}


# 导出方案

def save_schema(name: str, fields: list[dict]) -> dict:
    now = _now_iso()
    with get_db() as db:
        db.execute("INSERT OR REPLACE INTO schemas VALUES (?,?,?,?)",
                   (name, json.dumps(fields, ensure_ascii=False), now, now))
    return {"ok": True, "name": name}


def list_schemas() -> list[dict]:
    with get_db() as db:
        rows = db.execute("SELECT * FROM schemas ORDER BY updated_at DESC").fetchall()
    return [{"name": r["name"], "fields": json.loads(r["fields_json"]),
             "created_at": r["created_at"], "updated_at": r["updated_at"]} for r in rows]


def delete_schema(name: str) -> dict:
    with get_db() as db:
        db.execute("DELETE FROM schemas WHERE name=?", (name,))
    return {"ok": True, "deleted": name}


# 设置

def save_setting(key: str, value) -> dict:
    with get_db() as db:
        db.execute("INSERT OR REPLACE INTO settings VALUES (?,?,?)",
                   (key, json.dumps(value, ensure_ascii=False), _now_iso()))
    return {"ok": True}


def load_setting(key: str, default=None):
    with get_db() as db:
        row = db.execute("SELECT value_json FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(row["value_json"]) if row else default


def save_all_settings(settings: dict) -> dict:
    now = _now_iso()
    with get_db() as db:
        for k, v in settings.items():
            db.execute("INSERT OR REPLACE INTO settings VALUES (?,?,?)",
                       (k, json.dumps(v, ensure_ascii=False), now))
    return {"ok": True}


def load_all_settings() -> dict:
    with get_db() as db:
        rows = db.execute("SELECT key, value_json FROM settings").fetchall()
    result = {}
    for r in rows:
        try: result[r["key"]] = json.loads(r["value_json"])
        except: result[r["key"]] = r["value_json"]
    return result


# ── 跨平台比价：商品 CRUD ──

def upsert_product(platform: str, platform_url: str, title: str = "",
                   price: float = 0, original_price: float = 0,
                   shop_name: str = "", main_image_url: str = "",
                   local_image: str = "", attrs: dict = None,
                   stock_info: str = "", shipping: str = "",
                   description: str = "",
                   image_urls: list = None) -> int:
    """插入或更新商品，返回 product_id"""
    now = _now_iso()
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM products WHERE platform=? AND platform_url=?",
            (platform, platform_url)
        ).fetchone()
        if existing:
            pid = existing["id"]
            db.execute("""
                UPDATE products SET title=?, price=?, original_price=?,
                    shop_name=?, main_image_url=?, local_image=?,
                    attrs_json=?, stock_info=?, shipping=?,
                    description=?, image_urls=?, updated_at=?
                WHERE id=?
            """, (
                title, price, original_price, shop_name, main_image_url,
                local_image, json.dumps(attrs or {}, ensure_ascii=False),
                stock_info, shipping, description,
                json.dumps(image_urls or [], ensure_ascii=False), now, pid
            ))
        else:
            cur = db.execute("""
                INSERT INTO products (platform, platform_url, title, price,
                    original_price, shop_name, main_image_url, local_image,
                    attrs_json, stock_info, shipping, description, image_urls,
                    created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                platform, platform_url, title, price, original_price,
                shop_name, main_image_url, local_image,
                json.dumps(attrs or {}, ensure_ascii=False),
                stock_info, shipping, description,
                json.dumps(image_urls or [], ensure_ascii=False), now, now
            ))
            pid = cur.lastrowid
    return pid


def update_local_image(product_id: int, local_image: str):
    """只更新 local_image 字段，不覆盖其他数据"""
    with get_db() as db:
        db.execute(
            "UPDATE products SET local_image=?, updated_at=? WHERE id=?",
            (local_image, _now_iso(), product_id)
        )


def get_products_by_ids(product_ids: list[int]) -> list[dict]:
    """根据 ID 列表批量查询商品"""
    if not product_ids:
        return []
    placeholders = ",".join("?" * len(product_ids))
    with get_db() as db:
        rows = db.execute(
            f"SELECT * FROM products WHERE id IN ({placeholders}) AND status='active'",
            product_ids
        ).fetchall()
    return [_product_row_to_dict(r) for r in rows]


def get_all_products(platform: str = None, limit: int = 100) -> list[dict]:
    """列出商品（可按平台筛选）"""
    with get_db() as db:
        if platform:
            rows = db.execute(
                "SELECT * FROM products WHERE platform=? AND status='active' "
                "ORDER BY updated_at DESC LIMIT ?", (platform, limit)
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM products WHERE status='active' "
                "ORDER BY updated_at DESC LIMIT ?", (limit,)
            ).fetchall()
    return [_product_row_to_dict(r) for r in rows]


def get_product_count() -> int:
    with get_db() as db:
        row = db.execute(
            "SELECT COUNT(*) as cnt FROM products WHERE status='active'"
        ).fetchone()
    return row["cnt"]


def get_product_stats() -> dict:
    """各平台商品数量统计"""
    with get_db() as db:
        rows = db.execute(
            "SELECT platform, COUNT(*) as cnt FROM products "
            "WHERE status='active' GROUP BY platform ORDER BY cnt DESC"
        ).fetchall()
    stats = {r["platform"]: r["cnt"] for r in rows}
    stats["total"] = sum(stats.values())
    return stats


def _product_row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "platform": row["platform"],
        "platform_url": row["platform_url"],
        "title": row["title"],
        "price": row["price"],
        "original_price": row["original_price"],
        "shop_name": row["shop_name"],
        "main_image_url": row["main_image_url"],
        "local_image": row["local_image"],
        "attrs": json.loads(row["attrs_json"]) if row["attrs_json"] else {},
        "stock_info": row["stock_info"],
        "shipping": row["shipping"],
        "description": row["description"] if "description" in row.keys() else "",
        "image_urls": json.loads(row["image_urls"]) if row["image_urls"] else [],
        "skus": json.loads(row["skus"]) if row["skus"] else [],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ═══════════════════════════════════════════════
# 商品 CRUD（增删改查）
# ═══════════════════════════════════════════════

def get_product_by_id(product_id: int) -> dict | None:
    """查询单条商品"""
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM products WHERE id=? AND status='active'",
            (product_id,)
        ).fetchone()
    return _product_row_to_dict(row) if row else None


_FIELD_ALIASES = {
    "title": "title", "price": "price", "original_price": "original_price",
    "shop_name": "shop_name", "main_image_url": "main_image_url",
    "local_image": "local_image", "stock_info": "stock_info",
    "shipping": "shipping", "platform": "platform",
    "platform_url": "platform_url", "attrs": "attrs_json",
    "image_urls": "image_urls", "description": "description",
    "skus": "skus",
}


def update_product(product_id: int, **fields) -> bool:
    """更新商品字段（自动忽略未知字段，attrs 和 image_urls 自动序列化）"""
    set_parts = []
    values = []
    for key, value in fields.items():
        db_col = _FIELD_ALIASES.get(key)
        if not db_col:
            continue
        if db_col == "attrs_json":
            value = json.dumps(value, ensure_ascii=False) if isinstance(value, dict) else value
        elif db_col == "image_urls":
            value = json.dumps(value, ensure_ascii=False) if isinstance(value, list) else value
        elif db_col == "skus":
            value = json.dumps(value, ensure_ascii=False) if isinstance(value, list) else value
        set_parts.append(f"{db_col}=?")
        values.append(value)
    if not set_parts:
        return False
    set_parts.append("updated_at=?")
    values.append(_now_iso())
    values.append(product_id)
    with get_db() as db:
        db.execute(f"UPDATE products SET {', '.join(set_parts)} WHERE id=?", values)
    return True


def delete_product(product_id: int) -> bool:
    """软删除商品（status → 'deleted'），同时删除向量"""
    with get_db() as db:
        row = db.execute("SELECT id FROM products WHERE id=? AND status='active'", (product_id,)).fetchone()
        if not row:
            return False
        db.execute(
            "UPDATE products SET status='deleted', updated_at=? WHERE id=?",
            (_now_iso(), product_id)
        )
    # 删除 Qdrant 向量
    try:
        from vector_store import delete_product_vectors
        delete_product_vectors(product_id)
    except Exception as e:
        logger.warning(f"删除向量失败 (product_id={product_id}): {e}")
    return True


def batch_delete_products(product_ids: list[int]) -> int:
    """批量软删除"""
    if not product_ids:
        return 0
    placeholders = ",".join("?" * len(product_ids))
    now = _now_iso()
    with get_db() as db:
        cur = db.execute(
            f"UPDATE products SET status='deleted', updated_at=? WHERE id IN ({placeholders}) AND status='active'",
            [now] + product_ids
        )
        deleted = cur.rowcount
    # 批量删向量
    for pid in product_ids:
        try:
            from vector_store import delete_product_vectors
            delete_product_vectors(pid)
        except Exception:
            pass
    return deleted


def search_products(query: str = "", platform: str = None,
                    limit: int = 50, offset: int = 0) -> list[dict]:
    """搜索商品（关键词 + 平台筛选 + 分页）"""
    conditions = ["status='active'"]
    params = []
    if query:
        conditions.append("(title LIKE ? OR shop_name LIKE ?)")
        like_q = f"%{query}%"
        params.extend([like_q, like_q])
    if platform:
        conditions.append("platform=?")
        params.append(platform)
    where = " AND ".join(conditions)
    params.extend([limit, offset])
    with get_db() as db:
        rows = db.execute(
            f"SELECT * FROM products WHERE {where} "
            f"ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            params
        ).fetchall()
    return [_product_row_to_dict(r) for r in rows]


def count_search_results(query: str = "", platform: str = None) -> int:
    """搜索结果总数"""
    conditions = ["status='active'"]
    params = []
    if query:
        conditions.append("(title LIKE ? OR shop_name LIKE ?)")
        like_q = f"%{query}%"
        params.extend([like_q, like_q])
    if platform:
        conditions.append("platform=?")
        params.append(platform)
    where = " AND ".join(conditions)
    with get_db() as db:
        row = db.execute(
            f"SELECT COUNT(*) as cnt FROM products WHERE {where}", params
        ).fetchone()
    return row["cnt"]


# ═══════════════════════════════════════════
# 多 SKU：product_skus 表 CRUD
# ═══════════════════════════════════════════

def upsert_sku(sku_id: int | None, product_id: int, sku_name: str,
               color: str = "", size: str = "", spec: str = "",
               sku_image_url: str = "", price: float = 0, stock: str = "") -> int:
    """写入/更新一条 SKU，返回 sku_id"""
    now = _now_iso()
    with get_db() as db:
        if sku_id:
            db.execute("""UPDATE product_skus SET sku_name=?,color=?,size=?,spec=?,
                sku_image_url=?,price=?,stock=?,updated_at=? WHERE id=? AND product_id=?""",
                (sku_name, color, size, spec, sku_image_url, price, stock, now, sku_id, product_id))
            return sku_id
        else:
            cur = db.execute("""INSERT INTO product_skus
                (product_id,sku_name,color,size,spec,sku_image_url,price,stock,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (product_id, sku_name, color, size, spec, sku_image_url, price, stock, now, now))
            return cur.lastrowid


def get_skus_by_product(product_id: int) -> list[dict]:
    """获取某商品的所有 SKU"""
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM product_skus WHERE product_id=? AND status='active' ORDER BY id",
            (product_id,)
        ).fetchall()
    return [_sku_row_to_dict(r) for r in rows]


def update_sku_local_image(sku_id: int, local_image: str):
    """回写 SKU 的本地图片路径"""
    with get_db() as db:
        db.execute(
            "UPDATE product_skus SET local_image=?, updated_at=? WHERE id=?",
            (local_image, _now_iso(), sku_id)
        )


def _sku_row_to_dict(r) -> dict:
    return {
        "id": r["id"], "product_id": r["product_id"], "sku_name": r["sku_name"],
        "color": r["color"], "size": r["size"], "spec": r["spec"],
        "sku_image_url": r["sku_image_url"], "local_image": r["local_image"],
        "price": r["price"], "stock": r["stock"], "status": r["status"],
        "created_at": r["created_at"], "updated_at": r["updated_at"],
    }


# ═══════════════════════════════════════════
#  链路方案数据持久化
# ═══════════════════════════════════════════

def save_chain_data(scheme_name: str, rows: list[dict], headers: list[str]) -> dict:
    """保存/覆盖某个方案的全部数据"""
    now = _now_iso()
    data_json = json.dumps({"rows": rows, "headers": headers}, ensure_ascii=False)
    with get_db() as db:
        existing = db.execute("SELECT scheme_name FROM chain_data WHERE scheme_name=?", (scheme_name,)).fetchone()
        if existing:
            db.execute("UPDATE chain_data SET data_json=?, updated_at=? WHERE scheme_name=?",
                       (data_json, now, scheme_name))
        else:
            db.execute("INSERT INTO chain_data (scheme_name, data_json, created_at, updated_at) VALUES (?,?,?,?)",
                       (scheme_name, data_json, now, now))
    return {"ok": True, "scheme_name": scheme_name, "rows": len(rows)}



# ── 方案存储 ──

def save_scheme(name: str, data: dict) -> dict:
    """保存/更新方案"""
    import json as _json
    now = _now_iso()
    data_json = _json.dumps(data, ensure_ascii=False)
    with get_db() as db:
        db.execute(
            "INSERT INTO chain_schemes (name, data_json, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at",
            (name, data_json, now, now),
        )
    return {"ok": True}

def load_scheme(name: str) -> dict | None:
    """加载方案"""
    import json as _json
    with get_db() as db:
        r = db.execute("SELECT data_json FROM chain_schemes WHERE name=?", (name,)).fetchone()
        if r:
            return _json.loads(r["data_json"])
    return None

def delete_scheme(name: str) -> dict:
    """删除方案"""
    with get_db() as db:
        db.execute("DELETE FROM chain_schemes WHERE name=?", (name,))
    return {"ok": True}

def list_schemes() -> list[dict]:
    """列出所有方案名"""
    with get_db() as db:
        rows = db.execute("SELECT name FROM chain_schemes ORDER BY updated_at DESC").fetchall()
    return [r["name"] for r in rows]

def get_chain_data(scheme_names: list[str], link_col: str = "", link_cols: list[str] = None) -> dict:
    """查询一个或多个方案的数据。
    有 link_col/link_cols 时：以该列为索引，横向匹配合并（详情列加前缀）
    link_cols: 每个方案使用的链接列名，按方案顺序；空字符串=自动检测
    """
    all_rows = []
    all_headers = []
    scheme_results = []  # [(name, rows, headers), ...]

    with get_db() as db:
        for name in scheme_names:
            row = db.execute("SELECT data_json FROM chain_data WHERE scheme_name=?", (name,)).fetchone()
            if not row:
                continue
            data = json.loads(row["data_json"])
            rows = data.get("rows", [])
            headers = data.get("headers", [])
            scheme_results.append((name, rows, headers))

    if not scheme_results:
        return {"rows": [], "headers": [], "totalRows": 0}

    import re as _re2

    def _find_link_col(headers: list[str]) -> str:
        """从 headers 中找到链接列：优先匹配 链接/link，其次 url/href"""
        for h in headers:
            if _re2.search(r'链接|^link$|_link$|链接地址', h, _re2.IGNORECASE):
                return h
        for h in headers:
            if _re2.search(r'url|href', h, _re2.IGNORECASE):
                return h
        return ""

    if len(scheme_results) == 1:
        name, rows, headers = scheme_results[0]
        return {"rows": rows, "headers": headers, "totalRows": len(rows)}

    if len(scheme_results) >= 2:
        # ── 逐级横向合并：每步从上一个方案的 headers 中自动检测链接列 ──
        base_name, base_rows, base_headers = scheme_results[0]
        all_headers = list(base_headers)
        merged_rows = [{k: v for k, v in r.items()} for r in base_rows]  # 深拷贝

        for bi in range(1, len(scheme_results)):
            next_name, next_rows, next_headers = scheme_results[bi]
            prev_headers = scheme_results[bi - 1][2]
            # 逐级检测：优先用 per-scheme link_cols，兜底用全局 link_col，再自动检测
            step_col = (link_cols[bi-1] if link_cols and bi-1 < len(link_cols) and link_cols[bi-1] else (link_col if bi == 1 else ''))
            step_link = step_col if step_col else _find_link_col(prev_headers)
            # next 方案：优先用自己指定的 link_cols[i]，兜底来源URL，再自动检测
            next_col = (link_cols[bi] if link_cols and bi < len(link_cols) and link_cols[bi] else (link_col if link_col in next_headers else ''))
            next_link = next_col if next_col else ('来源URL' if '来源URL' in next_headers else _find_link_col(next_headers))
            if not step_link or not next_link:
                # 无共同链接列 → 竖向拼接
                for r in next_rows:
                    row = {}
                    for h in all_headers:
                        row[h] = r.get(h, "")
                    merged_rows.append(row)
                continue
            idx = {}
            for nr in next_rows:
                k = nr.get(next_link, "")
                if k:
                    idx[k] = nr
            # 同名列加序号避免覆盖（如"书名"→"书名_2"）
            name_map = {}  # 原始列名 → 去重后的列名
            for h in next_headers:
                if h == next_link:
                    continue
                target = h
                n = 2
                while target in all_headers or target in name_map.values():
                    target = h + '_' + str(n)
                    n += 1
                name_map[h] = target
                all_headers.append(target)
            for br in merged_rows:
                key = br.get(step_link, "")
                match = idx.get(key) if key else None
                for h in next_headers:
                    if h != next_link:
                        br[name_map[h]] = match[h] if (match and h in match) else ""
        return {"rows": merged_rows, "headers": all_headers, "totalRows": len(merged_rows)}

    # ── 垂直拼接（只有一个方案）──
    for name, rows, headers in scheme_results:
        for h in headers:
            if h not in all_headers:
                all_headers.append(h)
        for r in rows:
            merged = {}
            for h in all_headers:
                merged[h] = r.get(h, "")
            all_rows.append(merged)
    return {"rows": all_rows, "headers": all_headers, "totalRows": len(all_rows)}


def merge_schemes_vertical(scheme_names: list[str]) -> dict:
    """纵向合并：多个方案行直接追加，列取并集"""
    import json as _json
    all_rows = []
    all_headers = []

    with get_db() as db:
        for name in scheme_names:
            r = db.execute(
                "SELECT data_json FROM chain_data WHERE scheme_name=?",
                (name,),
            ).fetchone()
            if not r:
                continue
            d = _json.loads(r["data_json"])
            headers = d.get("headers", [])
            rows = d.get("rows", [])
            for row in rows:
                nr = {}
                for h in headers:
                    nr[h] = row.get(h, "")
                all_rows.append(nr)
            for h in headers:
                if h not in all_headers:
                    all_headers.append(h)

    return {"rows": all_rows, "headers": all_headers, "totalRows": len(all_rows)}


def delete_chain_data(scheme_name: str) -> dict:
    """删除某个方案的数据"""
    with get_db() as db:
        db.execute("DELETE FROM chain_data WHERE scheme_name=?", (scheme_name,))
    return {"ok": True, "scheme_name": scheme_name}


def update_chain_row(scheme_name: str, row_index: int, data: dict) -> dict:
    """更新某个方案的某一行数据"""
    with get_db() as db:
        row = db.execute("SELECT data_json FROM chain_data WHERE scheme_name=?", (scheme_name,)).fetchone()
        if not row:
            return {"ok": False, "error": "方案不存在"}
        stored = json.loads(row["data_json"])
        rows = stored.get("rows", [])
        if row_index < 0 or row_index >= len(rows):
            return {"ok": False, "error": "行索引越界"}
        rows[row_index] = data
        new_json = json.dumps({"rows": rows, "headers": stored.get("headers", [])}, ensure_ascii=False)
        now = _now_iso()
        db.execute("UPDATE chain_data SET data_json=?, updated_at=? WHERE scheme_name=?",
                   (new_json, now, scheme_name))
    return {"ok": True, "scheme_name": scheme_name, "row_index": row_index}


def rename_chain_data(old_name: str, new_name: str) -> dict:
    """重命名方案，同步更新数据库"""
    with get_db() as db:
        existing = db.execute("SELECT scheme_name FROM chain_data WHERE scheme_name=?", (old_name,)).fetchone()
        if not existing:
            return {"ok": False, "error": "旧名称不存在"}
        if old_name == new_name:
            return {"ok": True, "message": "名称未变"}
        # 如果新名称已存在，先删掉再覆盖
        db.execute("DELETE FROM chain_data WHERE scheme_name=?", (new_name,))
        db.execute("UPDATE chain_data SET scheme_name=?, updated_at=? WHERE scheme_name=?",
                   (new_name, _now_iso(), old_name))
    return {"ok": True, "old": old_name, "new": new_name}


def list_chain_schemes_with_data() -> list[str]:
    """列出所有有数据的方案名称"""
    with get_db() as db:
        rows = db.execute("SELECT scheme_name FROM chain_data ORDER BY updated_at DESC").fetchall()
        return [r["scheme_name"] for r in rows]


# ═══════════════════════════════════════════
# 页面快照：翻页注册时暂存每页 HTML，供链路批量提取
# ═══════════════════════════════════════════

def save_page_snapshot(url: str, html: str) -> dict:
    """保存 HTML 快照，URL+内容哈希双重去重"""
    import hashlib
    content_hash = hashlib.sha256(html.encode('utf-8', errors='replace')).hexdigest()
    now = _now_iso()
    with get_db() as db:
        # 同URL但不同内容 → 删除旧记录
        existing = db.execute("SELECT id, html FROM page_snapshots WHERE url=?", (url,)).fetchone()
        if existing:
            old_hash = hashlib.sha256(existing["html"].encode('utf-8', errors='replace')).hexdigest()
            if old_hash == content_hash:
                # 完全一致，跳过
                total = db.execute("SELECT COUNT(*) as cnt FROM page_snapshots").fetchone()["cnt"]
                return {"ok": True, "total_snapshots": total, "skipped": True}
            # 内容变了，更新
            db.execute("UPDATE page_snapshots SET html=?, created_at=? WHERE id=?",
                       (html, now, existing["id"]))
        else:
            db.execute(
                "INSERT INTO page_snapshots (url, html, created_at) VALUES (?,?,?)",
                (url, html, now)
            )
        total = db.execute("SELECT COUNT(*) as cnt FROM page_snapshots").fetchone()["cnt"]
    return {"ok": True, "total_snapshots": total}


def list_page_snapshots() -> list[dict]:
    """列出所有页面快照（不含 HTML）"""
    with get_db() as db:
        rows = db.execute(
            "SELECT id, url, created_at FROM page_snapshots ORDER BY id"
        ).fetchall()
    return [{"id": r["id"], "url": r["url"], "created_at": r["created_at"]} for r in rows]


def get_page_snapshot_html(snapshot_id: int) -> str | None:
    """获取单个快照的 HTML"""
    with get_db() as db:
        row = db.execute(
            "SELECT html FROM page_snapshots WHERE id=?", (snapshot_id,)
        ).fetchone()
    return row["html"] if row else None


def clear_page_snapshots() -> dict:
    """清空所有页面快照"""
    with get_db() as db:
        db.execute("DELETE FROM page_snapshots")
        return {"ok": True, "cleared": True}


# ── 共存合并 ──

def merge_rows(chain_rows: list[dict], chain_headers: list[str],
               batch_rows: list[dict], batch_headers: list[str]) -> dict:
    """共存合并：两源等权拼接去重。
    非空率最高的列做 key，同 key 行合并（有值不动，空洞补另一源）。
    """
    if not chain_rows and not batch_rows:
        return {"rows": [], "headers": [], "totalRows": 0}

    # 只输出链列（链列为空时用批量列）
    all_headers = list(chain_headers) if chain_headers else list(batch_headers)

    # 补全列（双源都补）
    for row in chain_rows:
        for h in all_headers:
            if h not in row:
                row[h] = ""
    for row in batch_rows:
        for h in all_headers:
            if h not in row:
                row[h] = ""

    # 找 key 列：链列中非空率最高的（排除来源URL和_开头）
    key_col = None
    data_cols = [h for h in all_headers if h != "来源URL" and not h.startswith("_")]
    if data_cols:
        best = -1
        for h in data_cols:
            filled = sum(1 for r in chain_rows + batch_rows if r.get(h))
            if filled > best:
                best = filled
                key_col = h
    if not key_col:
        key_col = "来源URL" if "来源URL" in all_headers else None

    # 同 key 合并
    merged = {}
    order = []

    for row in chain_rows + batch_rows:
        row_key = (row.get(key_col) or "").strip() if key_col else ""
        if not row_key:
            # 无 key 的行直接追加
            order.append(("__new__", len(order)))
            merged[("__new__", len(order) - 1)] = dict(row)
            continue

        if row_key in merged:
            existing = merged[row_key]
            for h in all_headers:
                if not existing.get(h) and row.get(h):
                    existing[h] = row[h]
        else:
            merged[row_key] = dict(row)
            order.append(row_key)

    rows = [merged[k] for k in order]
    return {"rows": rows, "headers": all_headers, "totalRows": len(rows)}


def _supplement_elements(chain_rows: list[dict], chain_headers: list[str],
                         snapshot_id: int, batch_headers: list[str] = None,
                         conn=None) -> tuple[list[dict], list[str], int]:
    """用注册元素的选择器对快照 HTML 做 CSS 提取，作为独立数据源加入链数据。
    只补充 element_batches 中已有的元素（batch_headers 白名单），避免泛滥。
    注册元素的值无条件写入，不判断链路是否已有值——二者平级，冲突由后续 merge 阶段处理。
    返回 (rows, headers, supplemented_field_count)
    """
    if not snapshot_id or not chain_rows:
        return chain_rows, chain_headers, 0

    own_conn = conn is None
    if own_conn:
        conn = get_connection()
    try:
        # 取快照 HTML
        html_row = conn.execute(
            "SELECT html FROM page_snapshots WHERE id=?", (snapshot_id,)
        ).fetchone()
        if not html_row or not html_row["html"]:
            return chain_rows, chain_headers, 0
        snap_html = html_row["html"]

        # 只取 batch 中已有的元素（白名单过滤）
        if batch_headers:
            placeholders = ",".join(["?"] * len(batch_headers))
            elems = conn.execute(
                f"SELECT clean_selector, text_content, selector FROM elements "
                f"WHERE clean_selector IN ({placeholders})",
                batch_headers,
            ).fetchall()
        else:
            # 无白名单 → 跳过补充（不泛滥）
            return chain_rows, chain_headers, 0
        if not elems:
            return chain_rows, chain_headers, 0

        from lxml import html as lxml_html
        try:
            doc = lxml_html.fromstring(snap_html.encode("utf-8", errors="replace"))
        except Exception:
            return chain_rows, chain_headers, 0

        supplemented = 0
        import re as _re
        _col_counter = {}  # 同名列加序号
        for elem in elems:
            sel = elem["clean_selector"]
            # 从选择器末段推导列名（不用 text_content — 那是数据值不是列名）
            segs = sel.split(">")
            raw_name = segs[-1].strip() if segs else sel.strip()
            # 清理伪类(:nth-of-type) 和 属性选择器([id=xxx])
            raw_name = _re.sub(r':[^(]+(\([^)]*\))?', '', raw_name)
            raw_name = _re.sub(r'\[[^\]]*\]', '', raw_name)
            raw_name = raw_name.strip() or sel.strip()
            # 处理重复列名: 加序号后缀 (如 a, a_2, a_3)
            if raw_name in _col_counter:
                _col_counter[raw_name] += 1
                col_name = f"{raw_name}_{_col_counter[raw_name]}"
            else:
                _col_counter[raw_name] = 1
                col_name = raw_name

            try:
                els = doc.cssselect(sel)
            except Exception:
                continue
            vals = []
            for el in els:
                txt = (el.text_content() or "").strip()
                vals.append(txt[:500])

            if not vals:
                continue

            # 补列头
            if col_name not in chain_headers:
                chain_headers.append(col_name)

            # 按索引逐行写入，无条件覆盖（冲突由后续 merge 处理）
            for i in range(min(len(chain_rows), len(vals))):
                chain_rows[i][col_name] = vals[i]

            supplemented += 1

        return chain_rows, chain_headers, supplemented
    finally:
        if own_conn:
            conn.close()


def merge_chain_and_batch(scheme_name: str, snapshot_id: int = 0) -> dict:
    """从库读取 chain_data + element_batches，元素补充 → merge_rows 合并"""
    import json as _json

    chain_rows, chain_headers = [], []
    batch_rows, batch_headers = [], []

    with get_db() as db:
        r = db.execute(
            "SELECT data_json FROM chain_data WHERE scheme_name=?",
            (scheme_name,),
        ).fetchone()
        if r:
            d = _json.loads(r["data_json"])
            chain_rows = d.get("rows", [])
            chain_headers = d.get("headers", [])

        if snapshot_id:
            r2 = db.execute(
                "SELECT data_json FROM element_batches WHERE snapshot_id=?",
                (snapshot_id,),
            ).fetchone()
            if r2:
                d2 = _json.loads(r2["data_json"])
                batch_rows = d2.get("rows", [])
                batch_headers = d2.get("headers", [])

            # ── 元素补充：用注册元素对快照 HTML 补充链数据空洞 ──
            chain_rows, chain_headers, sup_count = _supplement_elements(
                chain_rows, chain_headers, snapshot_id, batch_headers=batch_headers, conn=db
            )
            if sup_count:
                logger.info(f"[元素补充] {sup_count} 个字段已补到链数据 (snapshot={snapshot_id})")

    return merge_rows(chain_rows, chain_headers, batch_rows, batch_headers)
