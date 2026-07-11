# Builds cfb-qb-figure.png / cfb-rb-figure.png / cfb-wr-figure.png from the AI-generated source
# silhouettes (_cfb-<pos>-source.jpg): black -> opaque alpha, autocrop, scale + center.
# The sources have thin WHITE seam lines (facemask, sleeve/knee stripes) that fully sever limbs,
# so connectivity is judged on a morphologically CLOSED copy (bridges ~18px gaps) and the final
# alpha keeps the original threshold ink inside the main closed blob — seams stay as cutout detail.
# RB only: the source has a ground-shadow ellipse fused to the back cleat — hard cut below row 1042.
# Prints each stage aspect for college.html's per-position .stage CSS. Re-run make-cfb-masks.py after.
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

for pos in ['qb', 'rb', 'wr']:
    src = Image.open(f'_cfb-{pos}-source.jpg').convert('RGBA')
    ink = np.array(src.convert('L').point(lambda v: 255 if v < 110 else 0)) > 0
    if pos == 'rb':   # ground-shadow ellipse fused to the back cleat (cleat sole = x 120-185)
        ink[1041:, :] = False
        ink[1025:1041, :120] = False; ink[1025:1041, 186:] = False

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
    canvas.save(f'cfb-{pos}-figure.png')

    prev = Image.new('RGBA', (W, H), (16, 22, 33, 255)); prev.alpha_composite(canvas)
    dr = ImageDraw.Draw(prev)
    for p in range(0, 101, 10):
        x, y = int(W * p / 100), int(H * p / 100)
        dr.line([(x, 0), (x, H)], fill=(80, 120, 160, 120)); dr.line([(0, y), (W, y)], fill=(80, 120, 160, 120))
        dr.text((x + 2, 2), str(p), fill=(150, 200, 240, 255)); dr.text((2, y + 2), str(p), fill=(150, 200, 240, 255))
    prev.convert('RGB').save(f'_cfb_{pos}_grid.png')
    print(f'cfb-{pos}-figure.png {canvas.size}  STAGE_ASPECT {W}/{H}')
