# Usage: python prev.py file.pdf [dpi] [pages e.g. 1,3] [prefix]  -> <prefix>-<n>.png
import pymupdf, sys
d = pymupdf.open(sys.argv[1])
pre = sys.argv[4] if len(sys.argv) > 4 else 'prev'
print('pages', d.page_count)
for i, p in enumerate(d):
    if len(sys.argv) > 3 and sys.argv[3] != 'all' and str(i + 1) not in sys.argv[3].split(','): continue
    p.get_pixmap(dpi=int(sys.argv[2]) if len(sys.argv) > 2 else 70).save(f'{pre}-{i+1}.png')
