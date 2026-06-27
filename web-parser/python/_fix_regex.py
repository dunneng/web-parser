import re

with open('server.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace both broken regex patterns
# Pattern 1: image_urls line split across two physical lines
content = re.sub(
    r"image_urls = \[u\.strip\(\) for u in _re\.split\(r'\[,，;\n\s*\\r\]\+', image_urls_raw\) if u\.strip\(\)\]",
    r"image_urls = [u.strip() for u in _re.split(r'[,，;\n\r]+', image_urls_raw) if u.strip()]",
    content
)

# Pattern 2: parts line split across two physical lines  
content = re.sub(
    r"parts = \[u\.strip\(\) for u in _re2\.split\(r'\[,，;\n\s*\\r\]\+', main_image_url\) if u\.strip\(\)\]",
    r"parts = [u.strip() for u in _re2.split(r'[,，;\n\r]+', main_image_url) if u.strip()]",
    content
)

with open('server.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
