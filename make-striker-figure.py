# Builds striker-figure.png from the source silhouette (_striker-source.png): black -> opaque alpha,
# fill the outlined soccer ball into a solid circle (its white patches would otherwise punch holes),
# autocrop, scale + center. Prints the stage aspect for build-a-striker.html's .stage CSS.
# Re-run make-striker-masks.py after.
import numpy as np
from PIL import Image, ImageDraw

src = Image.open('_striker-source.png').convert('RGBA')
W0, H0 = src.size
alpha = src.convert('L').point(lambda v: 255 if v < 110 else 0)

# --- solidify the ball: find dark pixels in the lower-right window (right of the striking boot),
# then stamp a filled circle over their bounding box.
A = np.array(alpha)
win = np.zeros_like(A, dtype=bool)
win[int(H0*0.60):int(H0*0.90), int(W0*0.82):] = True
ys, xs = np.where((A > 0) & win)
if len(xs):
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cx, cy = (x0+x1)/2, (y0+y1)/2
    r = max(x1-x0, y1-y0)/2 + 3
    d = ImageDraw.Draw(alpha)
    d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=255)
    print(f'ball solidified at ({cx:.0f},{cy:.0f}) r={r:.0f}')

solid = Image.new('RGBA', src.size, (235, 240, 248, 255)); solid.putalpha(alpha)
fig = solid.crop(alpha.getbbox())

W = 1086; PAD = round(W * 0.04)
scaledW = W - 2 * PAD
scaledH = round(scaledW * fig.size[1] / fig.size[0])
fig = fig.resize((scaledW, scaledH), Image.LANCZOS)
H = scaledH + 2 * PAD
canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
canvas.alpha_composite(fig, (PAD, PAD))
canvas.save('striker-figure.png')

prev = Image.new('RGBA', (W, H), (16, 22, 33, 255)); prev.alpha_composite(canvas)
dr = ImageDraw.Draw(prev)
for p in range(0, 101, 10):
    x, y = int(W * p / 100), int(H * p / 100)
    dr.line([(x, 0), (x, H)], fill=(80, 120, 160, 120)); dr.line([(0, y), (W, y)], fill=(80, 120, 160, 120))
    dr.text((x + 2, 2), str(p), fill=(150, 200, 240, 255)); dr.text((2, y + 2), str(p), fill=(150, 200, 240, 255))
prev.convert('RGB').save('_striker_grid.png')
print('striker-figure.png ' + str(canvas.size) + '  STAGE_ASPECT ' + str(W) + '/' + str(H))
