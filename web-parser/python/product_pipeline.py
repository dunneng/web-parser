"""
商品入库管道 — 图片下载 → 去背景 → 多图 mean pooling → 双库存储
"""
import logging
import json
import time
import re
from pathlib import Path
from io import BytesIO
import requests
from PIL import Image

import db
import vector_store
import embedding

logger = logging.getLogger(__name__)

THIS_DIR = Path(__file__).parent
IMAGES_DIR = THIS_DIR / "data" / "images"
REQUEST_TIMEOUT = 15

PLATFORM_MAP = {
    "taobao": "taobao", "淘宝": "taobao",
    "tmall": "tmall", "天猫": "tmall",
    "jd": "jd", "京东": "jd",
    "pdd": "pdd", "pinduoduo": "pdd", "拼多多": "pdd",
    "1688": "1688", "alibaba": "1688", "阿里巴巴": "1688",
}


def _normalize_platform(raw: str) -> str:
    for k, v in PLATFORM_MAP.items():
        if k in raw.lower():
            return v
    return raw.lower()


def _download_image(url: str) -> bytes | None:
    """下载图片，返回字节流"""
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT,
                           headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        logger.warning(f"[pipeline] 下载失败 {url[:60]}... : {e}")
        return None


def _save_image(data: bytes, platform: str, product_id: int, idx: int = 0) -> str:
    """保存图片到本地，返回绝对路径。idx=0 为主图 → {pid}.jpg，idx>=1 为附图 → {pid}_{idx}.jpg"""
    dir_path = IMAGES_DIR / platform
    dir_path.mkdir(parents=True, exist_ok=True)
    if idx == 0:
        file_path = dir_path / f"{product_id}.jpg"
    else:
        file_path = dir_path / f"{product_id}_{idx}.jpg"
    with open(file_path, "wb") as f:
        f.write(data)
    return str(file_path)


# ── 初始化 ──

def init_pipeline():
    """启动时调用：初始化向量库集合"""
    dim = embedding.get_dim()
    vector_store.init_collection(dim)
    logger.info(f"[pipeline] 管道就绪, 向量维度={dim}")


# ── 入库（多图 mean pooling）──

def ingest_product(
    platform: str,
    url: str,
    title: str = "",
    price: float = 0,
    shop_name: str = "",
    main_image_url: str = "",
    attrs: dict = None,
    stock_info: str = "",
    shipping: str = "",
    description: str = "",
    image_urls: list = None,
    progress_callback = None,  # callback(current, total, step_str)
):
    """
    入库一个商品：
    1. 写 SQLite
    2. 下载主图 + 所有附图
    3. 每张图：rembg 去背景 → CLIP 向量化
    4. 多图 mean pooling → 单一商品级向量 → 写入 Qdrant（一个商品一个向量）
    返回 product_id
    """
    platform = _normalize_platform(platform)
    start = time.time()

    # 自动拆分：如果 main_image_url 包含逗号分隔的多张图 → 第一张=主图，其余追加到 image_urls
    if main_image_url and ("," in main_image_url or "，" in main_image_url):
        import re as _re
        parts = [u.strip() for u in _re.split(r'[,，;\n\r]+', main_image_url) if u.strip()]
        main_image_url = parts[0]
        image_urls = list(image_urls or [])
        seen = set(image_urls)
        for u in parts[1:]:
            if u not in seen:
                image_urls.append(u)
                seen.add(u)
        logger.info(f"[pipeline] 自动拆分主图: {len(parts)} 张 → 主图 + {len(image_urls)} 附图")

    # 1. 先写 SQLite（无 local_image）
    pid = db.upsert_product(
        platform=platform,
        platform_url=url,
        title=title,
        price=price,
        shop_name=shop_name,
        main_image_url=main_image_url,
        attrs=attrs,
        stock_info=stock_info,
        shipping=shipping,
        description=description,
        image_urls=image_urls,
    )
    logger.info(f"[pipeline] SQLite 写入 product_id={pid}")

    # 2. 收集所有图片 URL
    all_image_urls = []
    if main_image_url:
        all_image_urls.append(main_image_url)
    if image_urls:
        seen = {main_image_url} if main_image_url else set()
        for u in image_urls:
            if u and u not in seen:
                all_image_urls.append(u)
                seen.add(u)

    if not all_image_urls:
        logger.warning(f"[pipeline] 无图片 URL，跳过向量化 pid={pid}")
        return pid

    # 3. 下载所有图片 → 各图独立去背景+向量化 → 写入 Qdrant（每张图一个 point）
    total_imgs = len(all_image_urls)
    success_count = 0
    download_count = 0
    first_local_path = ""
    for idx, img_url in enumerate(all_image_urls):
        # 进度回调：下载中
        if progress_callback:
            progress_callback(idx, total_imgs, f"下载 {idx+1}/{total_imgs}")

        img_data = _download_image(img_url)
        if not img_data:
            logger.warning(f"[pipeline] 图片下载失败 idx={idx} url={img_url[:60]}...")
            continue
        download_count += 1

        # 保存本地（图片存原始版，不去背景，保留原始信息）
        local_path = _save_image(img_data, platform, pid, idx)
        if not first_local_path:
            first_local_path = local_path

        # 进度回调：向量化中
        if progress_callback:
            progress_callback(idx, total_imgs, f"向量化 {idx+1}/{total_imgs}")

        # 去背景 → CLIP 向量化 → 写入 Qdrant（每张图独立 point，image_index 对应原 URL 位置）
        try:
            vec = embedding.image_bytes_to_vector(img_data, skip_rembg=skip_rembg)
            if vec:
                vector_store.upsert_vector(pid, vec, image_index=idx, platform=platform)
                success_count += 1
        except Exception as e:
            logger.warning(f"[pipeline] 单图向量化失败 idx={idx}: {e}")

    if success_count == 0:
        logger.warning(f"[pipeline] 所有图片向量化失败 pid={pid}")
    elif download_count == 0:
        logger.warning(f"[pipeline] 所有图片下载失败 pid={pid}")

    # 4. 回写 local_image（主图路径）
    if first_local_path:
        db.update_local_image(pid, first_local_path)

    elapsed = time.time() - start
    logger.info(f"[pipeline] 入库完成 product_id={pid} 图片={download_count}/{len(all_image_urls)} 向量={success_count} ({elapsed:.1f}s)")
    return pid


# ── 批量入库 ──

def ingest_products(products: list[dict]) -> list[int]:
    """批量入库"""
    ids = []
    for p in products:
        pid = ingest_product(
            platform=p.get("platform", ""),
            url=p.get("url", ""),
            title=p.get("title", ""),
            price=p.get("price", 0),
            shop_name=p.get("shop_name", ""),
            main_image_url=p.get("main_image_url", ""),
            attrs=p.get("attrs"),
            stock_info=p.get("stock_info", ""),
            shipping=p.get("shipping", ""),
            image_urls=p.get("image_urls"),
        )
        ids.append(pid)
    return ids


# ── 查询辅助 ──

def _resolve_matched_sku(p: dict):
    """根据 matched_image_index 从 skus JSON 反查匹配到的 SKU 信息"""
    skus = p.get("skus") or []
    img_idx = p.get("matched_image_index", 0)
    if not skus:
        p["matched_sku_color"] = ""
        p["matched_sku_size"] = ""
        p["matched_sku_price"] = None
        return
    for sku in skus:
        images = sku.get("images") or []
        if img_idx in images or (img_idx == 0 and 0 in images):
            p["matched_sku_color"] = sku.get("color", "")
            p["matched_sku_size"] = sku.get("size", "")
            p["matched_sku_price"] = sku.get("price")
            return
    # 未匹配到 SKU：用第一个 SKU 兜底
    first = skus[0]
    p["matched_sku_color"] = first.get("color", "")
    p["matched_sku_size"] = first.get("size", "")
    p["matched_sku_price"] = first.get("price")


def _do_search(vec, recall_limit, min_score, platform):
    """执行 Qdrant 检索，包装以统一调用"""
    return vector_store.search_similar(
        vec, limit=recall_limit, score_threshold=min_score, platform=platform
    )


# ── 查询（查询图自动去背景）──

def search_by_image(image_data: bytes = None, image_path: str = None,
                    skip_rembg: bool = False,
                    top_k: int = 20, min_score: float = 0.65,
                    platform: str = None) -> list[dict]:
    """
    以图搜图：查询图自动去背景 → 向量化 → Qdrant 检索
    返回格式: [{"id","platform","title","price","shop_name","score",...}, ...]

    支持多 SKU：商品主向量 + SKU 独立向量都参与检索，按 product_id 归组取最高分
    
    裁剪回退：如果去背景后的向量搜不到结果（裁剪图可能被 rembg 误删产品内容），
              自动换用原始图（不去背景）再搜一次。
    """
    # 1. 查询图：去背景 → 向量化
    if image_data:
        vec = embedding.image_bytes_to_vector(image_data, skip_rembg=skip_rembg)
    elif image_path:
        vec = embedding.image_path_to_vector(image_path, skip_rembg=skip_rembg)
    else:
        return []

    # 2. Qdrant 检索（多召回一些，应对 SKU 向量 + 商品向量的混合匹配）
    recall_limit = top_k * 2
    hits = _do_search(vec, recall_limit, min_score, platform)

    # 3. 裁剪回退：去背景搜不到 → 不去背景再试
    if not hits:
        logger.info("[search_by_image] rembg 搜索无结果，尝试关闭去背景回退搜索...")
        if image_data:
            vec = embedding.image_bytes_to_vector(image_data, skip_rembg=True)
        elif image_path:
            vec = embedding.image_path_to_vector(image_path, skip_rembg=True)
        hits = _do_search(vec, recall_limit, min_score, platform)
        if hits:
            logger.info(f"[search_by_image] 回退搜索命中 {len(hits)} 条（不去背景）")
        else:
            logger.info("[search_by_image] 回退搜索也无结果")

    if not hits:
        return []

    # 4. 按 product_id 归组去重（同一商品无论主向量还是 SKU 向量命中，只保留最高分）
    best_per_product = {}
    for h in hits:
        pid = h["product_id"]
        if pid not in best_per_product or h["score"] > best_per_product[pid]["score"]:
            best_per_product[pid] = h

    # 5. 按分数排序，取 top_k
    sorted_hits = sorted(best_per_product.values(), key=lambda x: x["score"], reverse=True)[:top_k]

    # 6. SQLite 查详情
    product_ids = [h["product_id"] for h in sorted_hits]
    products = {p["id"]: p for p in db.get_products_by_ids(product_ids)}

    # 6b. 从 products.skus JSON 中反查 matched_image_index 属于哪个 SKU
    for p in products.values():
        _resolve_matched_sku(p)

    # 7. 组装结果
    results = []
    for h in sorted_hits:
        p = products.get(h["product_id"])
        if not p:
            continue
        p["score"] = h["score"]
        p["matched_image_index"] = h["image_index"]
        results.append(p)

    return results


def search_by_text(text: str, top_k: int = 20, min_score: float = 0.55,
                    skip_rembg: bool = False,
                   platform: str = None) -> list[dict]:
    """
    中文文字搜图：自然语言描述 → 文本向量化 → Qdrant 检索
    利用 Chinese-CLIP 共享的图文语义空间，支持「红色熊猫冰箱贴」「故宫文创」等中文描述搜索。

    min_score 默认 0.55（低于图片搜图的 0.65，因跨模态匹配分数天然偏低）
    """
    vec = embedding.text_to_vector(text)

    recall_limit = top_k * 2
    hits = _do_search(vec, recall_limit, min_score, platform)

    if not hits:
        return []

    # 按 product_id 归组去重
    best_per_product = {}
    for h in hits:
        pid = h["product_id"]
        if pid not in best_per_product or h["score"] > best_per_product[pid]["score"]:
            best_per_product[pid] = h

    # 按分数排序，取 top_k
    sorted_hits = sorted(best_per_product.values(), key=lambda x: x["score"], reverse=True)[:top_k]

    # SQLite 查详情
    product_ids = [h["product_id"] for h in sorted_hits]
    products = {p["id"]: p for p in db.get_products_by_ids(product_ids)}

    for p in products.values():
        _resolve_matched_sku(p)

    results = []
    for h in sorted_hits:
        p = products.get(h["product_id"])
        if not p:
            continue
        p["score"] = h["score"]
        p["matched_image_index"] = h["image_index"]
        results.append(p)

    return results


def search_by_url(url: str, top_k: int = 20) -> list[dict]:
    """
    从 URL 对应的商品图片出发，找同款
    先查 URL 对应商品的 main_image_url，下载后以图搜图
    """
    import sqlite3
    conn = sqlite3.connect(str(db.DB_PATH))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM products WHERE platform_url=? AND status='active'", (url,)
    ).fetchone()
    conn.close()

    if row:
        p = db._product_row_to_dict(row)
        if p.get("local_image") and Path(p["local_image"]).exists():
            results = search_by_image(image_path=p["local_image"], top_k=top_k)
        elif p.get("main_image_url"):
            img_data = _download_image(p["main_image_url"])
            results = search_by_image(image_data=img_data, top_k=top_k) if img_data else []
        else:
            results = []
    else:
        img_data = _download_image(url)
        results = search_by_image(image_data=img_data, top_k=top_k) if img_data else []

    return results


# ── SKU 入库（每个 SKU 独立向量，不去做 mean pooling）──

def ingest_skus(product_id: int, skus: list[dict], platform: str = "") -> list[int]:
    """
    批量入库 SKU：
    每个 SKU 下载专属图片 → 去背景 → 向量化 → 写入 SQLite + Qdrant
    SKU 向量独立存储（point_id = f"sku_{sku_id}"），查询时与商品主向量一起参与召回
    skus 格式：[{"sku_name","color","size","spec","sku_image_url","price","stock"}, ...]
    返回 sku_id 列表
    """
    sku_ids = []
    for sku in skus:
        sku_img_url = sku.get("sku_image_url", "")
        sku_id = db.upsert_sku(
            sku_id=None, product_id=product_id,
            sku_name=sku.get("sku_name", ""),
            color=sku.get("color", ""),
            size=sku.get("size", ""),
            spec=sku.get("spec", ""),
            sku_image_url=sku_img_url,
            price=sku.get("price", 0),
            stock=sku.get("stock", ""),
        )
        # 下载 SKU 专属图片 → 去背景 → 向量化（embedding 内部已集成预处理）
        if sku_img_url:
            img_data = _download_image(sku_img_url)
            if img_data:
                sku_dir = IMAGES_DIR / platform / "skus"
                sku_dir.mkdir(parents=True, exist_ok=True)
                local_path = str(sku_dir / f"{sku_id}.jpg")
                with open(local_path, "wb") as f:
                    f.write(img_data)
                db.update_sku_local_image(sku_id, local_path)
                try:
                    vec = embedding.image_bytes_to_vector(img_data, skip_rembg=skip_rembg)
                    vector_store.upsert_sku_vector(
                        sku_id, product_id, vec,
                        color=sku.get("color", ""),
                        size=sku.get("size", "")
                    )
                except Exception as e:
                    logger.error(f"[pipeline] SKU 向量失败 sku_id={sku_id}: {e}")
        sku_ids.append(sku_id)

    logger.info(f"[pipeline] SKU 入库完成 product_id={product_id} sku_count={len(sku_ids)}")
    return sku_ids


# ── 统计 ──

def get_stats() -> dict:
    """获取库状态摘要"""
    product_stats = db.get_product_stats()
    vector_count = vector_store.get_count()
    return {
        "product_count": product_stats,
        "vector_count": vector_count,
        "images_dir": str(IMAGES_DIR),
        "qdrant_dir": str(vector_store.QDRANT_DIR),
    }


# ── 编辑后重建向量 ──

def rebuild_product_vectors(product_id: int, skip_rembg: bool = False) -> dict:
    """
    编辑商品后重建该商品的所有向量：
    1. 删除旧向量（所有 image_index 的 point）
    2. 重新下载所有图片 → 去背景 → 各图独立向量化
    返回 {"ok": bool, "count": int, "error": str}
    """
    p = db.get_product_by_id(product_id)
    if not p:
        return {"ok": False, "count": 0, "error": "商品不存在"}

    platform = _normalize_platform(p.get("platform", "unknown"))

    # 收集所有图片 URL
    all_image_urls = []
    main_url = p.get("main_image_url", "")
    if main_url:
        all_image_urls.append(main_url)
    extra_urls = p.get("image_urls") or []
    for u in extra_urls:
        if u and u not in all_image_urls:
            all_image_urls.append(u)

    if not all_image_urls:
        return {"ok": False, "count": 0, "error": "无图片 URL"}

    # 删除旧向量（collection 不存在时跳过）
    try:
        vector_store.delete_product_vectors(product_id)
    except (ValueError, RuntimeError):
        pass

    # 本地加载 + 向量化（优先本地文件，避免重新下载被 CDN 拦截）
    success = 0
    for idx, img_url in enumerate(all_image_urls):
        img_data = None
        # 尝试从本地文件加载
        dir_path = IMAGES_DIR / platform
        if idx == 0:
            local = dir_path / f"{product_id}.jpg"
        else:
            local = dir_path / f"{product_id}_{idx}.jpg"
        if local.exists():
            with open(str(local), "rb") as f:
                img_data = f.read()
        # 兜底：远程下载
        if not img_data:
            img_data = _download_image(img_url)
        if not img_data:
            continue
        # 保存本地
        _save_image(img_data, platform, product_id, idx)
        try:
            vec = embedding.image_bytes_to_vector(img_data, skip_rembg=skip_rembg)
            if vec:
                vector_store.upsert_vector(product_id, vec, image_index=idx, platform=platform)
                success += 1
        except Exception as e:
            logger.warning(f"[pipeline] rebuild 向量化失败 idx={idx}: {e}")

    return {"ok": success > 0, "count": success}
