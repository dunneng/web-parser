# -*- mode: python ; coding: utf-8 -*-
import os, glob as _glob
_site_packages = r'C:\Users\15534\AppData\Roaming\Python\Python314\site-packages'

a = Analysis(
    ['server.py'], pathex=[], binaries=[],
    datas=[
        ('parser', 'parser'), ('data', 'data'),
        ('db.py', '.'), ('product_pipeline.py', '.'), ('embedding.py', '.'), ('vector_store.py', '.'),
        ('price_compare_ui.html', '.'),
        (os.path.join(_site_packages, 'cn_clip', 'clip', 'vocab.txt'), 'cn_clip/clip'),
        (os.path.join(_site_packages, 'cn_clip', 'clip', 'model_configs'), 'cn_clip/clip/model_configs'),
        (os.path.join(_site_packages, 'open_clip', 'bpe_simple_vocab_16e6.txt.gz'), 'open_clip'),
        (os.path.join(_site_packages, 'open_clip', 'model_configs'), 'open_clip/model_configs'),
        (os.path.join(_site_packages, 'pymatting-1.1.15.dist-info'), 'pymatting-1.1.15.dist-info'),
        (os.path.join(_site_packages, 'rembg-2.0.76.dist-info'), 'rembg-2.0.76.dist-info'),
        (os.path.join(_site_packages, 'onnxruntime-1.27.0.dist-info'), 'onnxruntime-1.27.0.dist-info'),
    ],
    hiddenimports=['open_clip', 'cn_clip', 'qdrant_client'],
    hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False, optimize=0,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='python-backend', debug=False, strip=False, upx=True, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=True, name='python-backend')
