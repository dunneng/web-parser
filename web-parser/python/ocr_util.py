"""
ocr_util.py
共享的 OCR 工具模块，供 server.py 和 product_pipeline.py 使用。
"""
import logging
import os
import tempfile
import base64

logger = logging.getLogger(__name__)

_ocr = None
_ocr_lock = None


def get_reader():
    """懒加载 easyocr Reader（线程安全，单例）"""
    global _ocr, _ocr_lock
    if _ocr_lock is None:
        import threading
        _ocr_lock = threading.Lock()
    if _ocr is None:
        with _ocr_lock:
            if _ocr is None:
                import easyocr
                logger.warning("[OCR] 正在加载 easyocr 模型（首次约需 30s，后续秒级）...")
                _ocr = easyocr.Reader(['ch_sim', 'en'], gpu=False)
                logger.warning("[OCR] easyocr 模型加载完成")
    return _ocr


def decode_base64(image_base64: str) -> dict:
    """
    从 base64 图片识别文字。
    返回 {"text": "完整文字", "best": "最佳行", "confidence": 0.95}
    """
    try:
        b64 = image_base64
        if ',' in b64:
            b64 = b64.split(',', 1)[1]
        image_bytes = base64.b64decode(b64)

        return _decode_bytes(image_bytes)
    except ImportError:
        return {"ok": False, "error": "easyocr 未安装，请运行: pip install easyocr"}
    except Exception as e:
        logger.warning(f"[OCR] 识别失败: {e}")
        return {"ok": False, "error": str(e)}


def decode_bytes(image_bytes: bytes) -> dict:
    """从图片字节流识别文字"""
    try:
        return _decode_bytes(image_bytes)
    except ImportError:
        return {"ok": False, "error": "easyocr 未安装"}
    except Exception as e:
        logger.warning(f"[OCR] 识别失败: {e}")
        return {"ok": False, "error": str(e)}


def _decode_bytes(image_bytes: bytes) -> dict:
    """内部：字节流 → OCR 结果"""
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
        tmp.write(image_bytes)
        temp_path = tmp.name

    try:
        reader = get_reader()
        results = reader.readtext(temp_path)
    finally:
        try:
            os.remove(temp_path)
        except Exception:
            pass

    if results:
        best = max(results, key=lambda r: r[2])
        text = best[1]
        confidence = best[2]
        all_text = ' '.join(r[1] for r in results if r[1].strip())
        return {"ok": True, "text": all_text, "best": text, "confidence": confidence}
    else:
        return {"ok": True, "text": "", "best": "", "confidence": 0}
