"""
图像嵌入模块 — Chinese-CLIP (cn_clip) 封装 + 去背景预处理
使用 CPU 运行，单张图片 ~0.5s（去背景）+ ~0.5s（CLIP）
"""
import os
# 国内网络使用 HF 镜像（cn_clip 底层 huggingface_hub 会读取此变量）
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

import logging
from pathlib import Path
from io import BytesIO
import numpy as np
from PIL import Image

# 可选依赖：cn-clip / torch / rembg
try:
    import torch
    import cn_clip.clip as clip
    from rembg import remove
    _DEPS_AVAILABLE = True
except ImportError:
    torch = None
    clip = None
    remove = None
    _DEPS_AVAILABLE = False

logger = logging.getLogger(__name__)

# ── 模型配置 ──
# Chinese-CLIP ViT-B-16：阿里达摩院基于中文图文对训练
# 图像编码器 ViT-B/16 (patch=16, dim=512), 文本编码器 RoBERTa-wwm-ext-base-chinese
MODEL_NAME = "ViT-B-16"
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

_device = None
_model = None
_preprocess = None
_vector_dim = 512


def _ensure_model():
    """懒加载：首次调用才加载模型到内存"""
    global _model, _preprocess, _device, _vector_dim
    if _model is not None:
        return
    if not _DEPS_AVAILABLE:
        raise RuntimeError("向量模型不可用：请 pip install torch cn-clip rembg")
    _device = torch.device("cpu")
    logger.info(f"[embedding] 加载 Chinese-CLIP {MODEL_NAME} 到 {_device} ...")
    _model, _preprocess = clip.load_from_name(
        MODEL_NAME,
        device=_device,
        download_root=MODEL_DIR,
    )
    _model = _model.to(_device).eval()
    _vector_dim = _model.visual.output_dim
    logger.info(f"[embedding] 模型就绪，向量维度={_vector_dim}")


# ═══════════════════════════════════════════
# 去背景预处理
# ═══════════════════════════════════════════

def preprocess_image(image: Image.Image) -> Image.Image:
    """
    去背景 → 转 RGB 白底
    rembg (U-2-Net) 自动抠图，输出 RGBA；
    贴到纯白背景上，统一转为 RGB
    """
    if not _DEPS_AVAILABLE:
        return image.convert("RGB")  # 无 rembg 时跳过抠图
    output = remove(image)  # RGBA
    # alpha 通道做 mask，贴到白底
    bg = Image.new("RGB", output.size, (255, 255, 255))
    if output.mode == "RGBA":
        bg.paste(output, mask=output.split()[3])
    else:
        bg.paste(output)
    return bg


def preprocess_bytes(data: bytes) -> Image.Image:
    """字节流 → 去背景 → RGB 白底 PIL Image"""
    img = Image.open(BytesIO(data))
    if img.mode != "RGB":
        img = img.convert("RGB")
    return preprocess_image(img)


def preprocess_path(path: str | Path) -> Image.Image:
    """本地图片文件 → 去背景 → RGB 白底 PIL Image"""
    img = Image.open(path).convert("RGB")
    return preprocess_image(img)


# ═══════════════════════════════════════════
# 向量化（均已集成去背景预处理）
# ═══════════════════════════════════════════

def image_to_vector(image: Image.Image, skip_rembg: bool = False) -> list[float]:
    """单张 PIL 图片 → 去背景 → 归一化向量 (list of float)
    
    skip_rembg=True: 跳过去背景，直接 CLIP 编码（适用于裁剪后的查询图）
    """
    _ensure_model()
    if skip_rembg:
        processed = image
    else:
        processed = preprocess_image(image)
    img_tensor = _preprocess(processed).unsqueeze(0).to(_device)
    with torch.no_grad():
        vec = _model.encode_image(img_tensor)
        vec = vec / vec.norm(dim=-1, keepdim=True)
    return vec.squeeze(0).tolist()


def image_path_to_vector(path: str | Path, skip_rembg: bool = False) -> list[float]:
    """本地图片文件 → 去背景 → 向量"""
    img = Image.open(path).convert("RGB")
    return image_to_vector(img, skip_rembg=skip_rembg)


def image_bytes_to_vector(data: bytes, skip_rembg: bool = False) -> list[float]:
    """图片字节流 → 去背景 → 向量"""
    img = Image.open(BytesIO(data)).convert("RGB")
    return image_to_vector(img, skip_rembg=skip_rembg)


# ═══════════════════════════════════════════
# 多图融合向量
# ═══════════════════════════════════════════

def images_to_merged_vector(images: list[Image.Image]) -> list[float] | None:
    """
    多张 PIL 图片 → 各自去背景 + 向量化 → mean pooling → 单一商品级向量
    如果列表为空或全部失败，返回 None
    """
    if not images:
        return None
    _ensure_model()
    vecs = []
    for img in images:
        try:
            processed = preprocess_image(img)
            img_tensor = _preprocess(processed).unsqueeze(0).to(_device)
            with torch.no_grad():
                vec = _model.encode_image(img_tensor)
                vec = vec / vec.norm(dim=-1, keepdim=True)
            vecs.append(vec.squeeze(0).cpu().numpy())
        except Exception as e:
            logger.warning(f"[embedding] 单图向量化失败，跳过: {e}")
    if not vecs:
        return None
    # mean pooling
    merged = np.mean(vecs, axis=0)
    # 重新归一化
    merged = merged / (np.linalg.norm(merged) + 1e-10)
    return merged.tolist()


def image_bytes_list_to_merged_vector(data_list: list[bytes]) -> list[float] | None:
    """多个图片字节流 → 去背景 → mean pooling 向量"""
    imgs = []
    for d in data_list:
        try:
            imgs.append(Image.open(BytesIO(d)).convert("RGB"))
        except Exception:
            continue
    return images_to_merged_vector(imgs)


# ═══════════════════════════════════════════
# 文本向量化（中文语义搜图）
# ═══════════════════════════════════════════

def text_to_vector(text: str) -> list[float]:
    """中文文本 → 归一化向量 (list of float)
    
    利用 Chinese-CLIP 的文本编码器（RoBERTa-wwm-ext-base-chinese），
    将中文描述映射到与图像共享的 512 维语义空间，
    实现用「红色冰箱贴」「熊猫纪念品」等自然语言直接搜图。
    """
    _ensure_model()
    text_tensor = clip.tokenize([text]).to(_device)
    with torch.no_grad():
        vec = _model.encode_text(text_tensor)
        vec = vec / vec.norm(dim=-1, keepdim=True)
    return vec.squeeze(0).tolist()


# ═══════════════════════════════════════════
# 查询辅助
# ═══════════════════════════════════════════

def get_dim() -> int:
    """返回向量维度（ViT-B-16 固定 512，不触发模型加载）"""
    return _vector_dim  # 512，懒加载前即为正确值
