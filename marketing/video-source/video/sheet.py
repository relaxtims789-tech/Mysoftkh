# Contact sheet of preview stills: python sheet.py out.jpg cols img1 img2 ...
import sys, cv2, numpy as np
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
imgs = [cv2.imread(f) for f in files]
h, w = imgs[0].shape[:2]
tw = 960 // cols * 2 if w > h else 600
th = int(h * tw / w)
tiles = [cv2.resize(i, (tw, th), interpolation=cv2.INTER_AREA) for i in imgs]
while len(tiles) % cols: tiles.append(np.zeros_like(tiles[0]))
rows = [np.hstack(tiles[r:r + cols]) for r in range(0, len(tiles), cols)]
cv2.imwrite(out, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 82])
