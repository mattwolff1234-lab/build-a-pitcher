# Builds hockey-figure.png from the AI-generated source silhouette (_hockey-source.jpg):
# black -> opaque alpha, autocrop, scale + center. Same recipe as make-cfb-figures.py (thin white
# seam lines sever limbs, so connectivity is judged on a morphologically CLOSED copy and the final
# alpha keeps original ink inside the main closed blob — seams stay as cutout detail). The puck +
# stick blade hang off the main blob via the stick shaft; closing bridges them in.
# Prints the stage aspect for hockey.html's .stage CSS. Re-run make-hockey-masks.py after.
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

src = Image.open('_hockey-source.jpg').convert('RGBA')
ink = np.array(src.convert('L').point(lambda v: 255 if v < 110 else 0)) > 0

closed = ndimage.binary_closing(ink, structure=np.ones((9, 9)), iterations=2)
lab, n = ndimage.label(closed)
if n > 1:
    sizes = ndimage.sum(closed, lab, range(1, n + 1))
    closed = lab == (np.argmax(sizes) + 1)
keep = ink & closed
alpha = Image.fromarray((keep * 255).astype('uint8'), 'L')

solid = Image.new('RGBA', src.size, (235, 240, 248, 255)); solid.putalpha(alpha)
fig = solid.crop(alpha.getbbox())

W = 1086; PAD = round(W * 0.04)
scaledW = W - 2 * PAD
scaledH = round(scaledW * fig.size[1] / fig.size[0])
fig = fig.resize((scaledW, scaledH), Image.LANCZOS)
H = scaledH + 2 * PAD
canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
canvas.alpha_composite(fig, (PAD, PAD))
canvas.save('hockey-figure.png')

prev = Image.new('RGBA', (W, H), (16, 22, 33, 255)); prev.alpha_composite(canvas)
dr = ImageDraw.Draw(prev)
for p in range(0, 101, 10):
    x, y = int(W * p / 100), int(H * p / 100)
    dr.line([(x, 0), (x, H)], fill=(80, 120, 160, 120)); dr.line([(0, y), (W, y)], fill=(80, 120, 160, 120))
    dr.text((x + 2, 2), str(p), fill=(150, 200, 240, 255)); dr.text((2, y + 2), str(p), fill=(150, 200, 240, 255))
prev.convert('RGB').save('_hockey_grid.png')
print(f'hockey-figure.png {canvas.size}  STAGE_ASPECT {W}/{H}')
