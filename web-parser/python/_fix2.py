with open('server.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Line 1515 (index 1514): ends with literal newline inside raw string
# Fix: join with next line content
base = lines[1514].rstrip('\n\r')
# The raw string was: r'[,，;\n\r]+' but got split
# Reconstruct: base ends with 'r'[,，;' and literal \n
lines[1514] = base + '\\n\\r]+\', image_urls_raw) if u.strip()]\n'
lines[1515] = ''  # remove broken continuation

# Line 1521 (index 1520): same issue  
base2 = lines[1520].rstrip('\n\r')
lines[1520] = base2 + '\\n\\r]+\', main_image_url) if u.strip()]\n'
lines[1521] = ''

lines = [l for l in lines if l != '']

with open('server.py', 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('done')
