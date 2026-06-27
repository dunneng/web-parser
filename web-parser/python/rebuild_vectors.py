"""Rebuild vectors for all existing products in the DB."""
import sys, os, time, sqlite3
from pathlib import Path

os.chdir(Path(__file__).parent)
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
sys.path.insert(0, str(Path(__file__).parent))

import db, vector_store, embedding

DB_PATH = Path("data/parser.db")

conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT id, title, main_image_url, local_image, platform FROM products WHERE status='active'"
).fetchall()
conn.close()

print(f"Found {len(rows)} products to rebuild vectors for")

dim = embedding.get_dim()
vector_store.init_collection(dim)

success = 0
failed = 0
start = time.time()

for i, r in enumerate(rows):
    pid = r["id"]
    platform = r["platform"] or ""
    local_img = r["local_image"]
    
    if not local_img or not Path(local_img).exists():
        print(f"  [{i+1}/{len(rows)}] #{pid} {r['title'][:30]}... SKIP: no local image")
        failed += 1
        continue
    
    try:
        vec = embedding.image_path_to_vector(local_img)
        vector_store.upsert_vector(pid, vec, image_index=0, platform=platform)
        elapsed = time.time() - start
        print(f"  [{i+1}/{len(rows)}] #{pid} {r['title'][:30]}... OK ({elapsed:.1f}s)")
        success += 1
    except Exception as e:
        print(f"  [{i+1}/{len(rows)}] #{pid} {r['title'][:30]}... FAIL: {type(e).__name__}: {e}")
        failed += 1

total = time.time() - start
print(f"\nDone: {success} success, {failed} failed in {total:.1f}s")
print(f"Vector count now: {vector_store.get_count()}")
