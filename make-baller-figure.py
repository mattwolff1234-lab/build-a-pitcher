# Builds baller-figure.png from the source silhouette (_baller-source.png): black -> opaque alpha,
# autocrop, scale + center onto a frame matching the figure's own (wide) aspect so it fills the stage.
# Prints the stage aspect to set in build-a-baller.html's .stage CSS. Re-run make-baller-masks.py after.
from PIL import Image, ImageDraw

src = Image.open('_baller-source.png').convert('RGBA')
alpha = src.convert('L').point(lambda v: 255 if v < 110 else 0)
solid = Image.new('RGBA', src.size, (235, 240, 248, 255)); solid.putalpha(alpha)
fig = solid.crop(alpha.getbbox())

W = 1086; PAD = round(W * 0.04)
scaledW = W - 2 * PAD
scaledH = round(scaledW * fig.size[1] / fig.size[0])
fig = fig.resize((scaledW, scaledH), Image.LANCZOS)
H = scaledH + 2 * PAD
canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
canvas.alpha_composite(fig, (PAD, PAD))
canvas.save('baller-figure.png')

prev = Image.new('RGBA', (W, H), (16, 22, 33, 255)); prev.alpha_composite(canvas)
dr = ImageDraw.Draw(prev)
for p in range(0, 101, 10):
    x, y = int(W * p / 100), int(H * p / 100)
    dr.line([(x, 0), (x, H)], fill=(80, 120, 160, 120)); dr.line([(0, y), (W, y)], fill=(80, 120, 160, 120))
    dr.text((x + 2, 2), str(p), fill=(150, 200, 240, 255)); dr.text((2, y + 2), str(p), fill=(150, 200, 240, 255))
prev.convert('RGB').save('_baller_grid.png')
print('baller-figure.png ' + str(canvas.size) + '  STAGE_ASPECT ' + str(W) + '/' + str(H))
