"""
Qdrant 本地向量库 — 嵌入式模式（无需 Docker）
数据持久化到本地目录，进程内运行
"""
import logging
import os
import shutil
import time
from pathlib import Path
import warnings
warnings.filterwarnings("ignore", message="Payload indexes have no effect")

# 可选依赖：qdrant-client
try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
    )
    _QDRANT_AVAILABLE = True
except ImportError:
    QdrantClient = None
    Distance = VectorParams = PointStruct = Filter = FieldCondition = MatchValue = None
    _QDRANT_AVAILABLE = False

logger = logging.getLogger(__name__)

# ── 配置 ──
THIS_DIR = Path(__file__).parent
QDRANT_DIR = THIS_DIR / "data" / "qdrant_storage"
COLLECTION_NAME = "product_images"

_client: QdrantClient | None = None


def get_client() -> QdrantClient:
    """获取 Qdrant 客户端（本地持久化模式）"""
    global _client
    if not _QDRANT_AVAILABLE:
        raise RuntimeError("向量库不可用：请 pip install qdrant-client")
    if _client is None:
        QDRANT_DIR.mkdir(parents=True, exist_ok=True)
        for attempt in range(5):
            try:
                _client = QdrantClient(path=str(QDRANT_DIR))
                break
            except (RuntimeError, PermissionError) as e:
                if "already accessed" in str(e) or isinstance(e, PermissionError):
                    logger.warning(f"[qdrant] 锁冲突 (尝试 {attempt+1})，清理重建...")
                    time.sleep(1.5)
                    # 直接清目录（向量可通过 rebuild API 重建）
                    shutil.rmtree(str(QDRANT_DIR), ignore_errors=True)
                    time.sleep(0.5)
                    QDRANT_DIR.mkdir(parents=True, exist_ok=True)
                else:
                    raise
        else:
            raise RuntimeError(f"Qdrant 初始化失败，已重试 5 次: {QDRANT_DIR}")
        logger.info(f"[qdrant] 本地向量库: {QDRANT_DIR}")
    return _client


def init_collection(vector_dim: int = 512):
    """创建集合（如已存在则跳过），确保 payload 索引"""
    client = get_client()
    collections = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME in collections:
        logger.info(f"[qdrant] 集合 '{COLLECTION_NAME}' 已存在")
    else:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=vector_dim,
                distance=Distance.COSINE
            )
        )
        logger.info(f"[qdrant] 创建集合 '{COLLECTION_NAME}' (dim={vector_dim})")

    # 确保 platform / product_id 有索引（用于过滤）
    _ensure_payload_index("platform", "keyword")
    _ensure_payload_index("product_id", "integer")


def _ensure_payload_index(field: str, schema: str):
    """确保 payload 字段有索引（幂等）"""
    from qdrant_client.models import PayloadSchemaType
    client = get_client()
    schema_type = {"keyword": PayloadSchemaType.KEYWORD, "integer": PayloadSchemaType.INTEGER}[schema]
    try:
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name=field,
            field_schema=schema_type,
            wait=True,
        )
        logger.info(f"[qdrant] 已创建 payload 索引: {field} ({schema})")
    except Exception:
        pass  # 已存在则跳过


def upsert_vector(product_id: int, vector: list[float], image_index: int = 0, platform: str = ""):
    """写入 / 更新一条向量（point_id 用 uuid5 生成，payload 存 product_id 和 image_index）"""
    import uuid as _uuid
    client = get_client()
    point_uuid = str(_uuid.uuid5(_uuid.NAMESPACE_DNS, f"product_{product_id}_img_{image_index}"))
    payload = {"product_id": product_id, "image_index": image_index}
    if platform:
        payload["platform"] = platform
    client.upsert(
        collection_name=COLLECTION_NAME,
        points=[PointStruct(
            id=point_uuid,
            vector=vector,
            payload=payload
        )]
    )


def search_similar(
    vector: list[float],
    limit: int = 100,
    score_threshold: float = 0.75,
    platform: str = None,
) -> list[dict]:
    """
    向量检索，返回相似商品列表（支持按平台过滤）
    返回格式: [{"point_id": str, "product_id": int, "score": float, "image_index": int}, ...]
    """
    client = get_client()
    query_filter = None
    if platform:
        from qdrant_client.models import FieldCondition, MatchValue
        query_filter = Filter(
            must=[FieldCondition(key="platform", match=MatchValue(value=platform))]
        )
    results = client.query_points(
        collection_name=COLLECTION_NAME,
        query=vector,
        limit=limit,
        score_threshold=score_threshold,
        query_filter=query_filter,
        with_payload=True,
    )
    hits = []
    for r in results.points:
        pid = None
        sku_id = None
        img_idx = 0
        color = ""
        size = ""
        if r.payload and "product_id" in r.payload:
            pid = int(r.payload["product_id"])
            img_idx = int(r.payload.get("image_index", 0))
            sku_id = int(r.payload["sku_id"]) if r.payload.get("sku_id") is not None else None
            color = r.payload.get("color", "")
            size = r.payload.get("size", "")
        else:
            # 兼容旧数据：point_id 是纯 int
            try:
                pid = int(r.id)
            except (ValueError, TypeError):
                continue
        if pid is not None:
            hits.append({
                "point_id": str(r.id), "product_id": pid,
                "score": r.score, "image_index": img_idx,
                "sku_id": sku_id, "color": color, "size": size,
            })
    return hits


def delete_product_vectors(product_id: int):
    """删除某个商品的所有向量（按 payload.product_id 过滤）"""
    client = get_client()
    client.delete(
        collection_name=COLLECTION_NAME,
        points_selector=Filter(
            must=[FieldCondition(key="product_id", match=MatchValue(value=product_id))]
        )
    )


def delete_vector(point_id: str):
    """删除单条向量（按 point_id）"""
    client = get_client()
    client.delete(
        collection_name=COLLECTION_NAME,
        points_selector=[point_id]
    )


# ═══════════════════════════════════════════
# SKU 向量（point_id = f"sku_{sku_id}"）
# ═══════════════════════════════════════════

def upsert_sku_vector(sku_id: int, product_id: int, vector: list[float],
                      color: str = "", size: str = ""):
    """写入一个 SKU 向量（point_id 用 uuid5 生成）"""
    import uuid as _uuid
    client = get_client()
    point_uuid = str(_uuid.uuid5(_uuid.NAMESPACE_DNS, f"sku_{sku_id}"))
    payload = {"sku_id": sku_id, "product_id": product_id}
    if color:
        payload["color"] = color
    if size:
        payload["size"] = size
    client.upsert(
        collection_name=COLLECTION_NAME,
        points=[PointStruct(id=point_uuid, vector=vector, payload=payload)]
    )


def delete_sku_vectors(product_id: int):
    """删除某个商品的所有 SKU 向量"""
    client = get_client()
    client.delete(
        collection_name=COLLECTION_NAME,
        points_selector=Filter(
            must=[FieldCondition(key="product_id", match=MatchValue(value=product_id))]
        )
    )
    # 注意：delete_product_vectors 也会删 SKU 向量（因为 payload 都有 product_id）
    # 这里显式保留一个专门函数，语义更清晰


def get_count() -> int:
    """返回向量总数"""
    client = get_client()
    info = client.get_collection(COLLECTION_NAME)
    return info.points_count
