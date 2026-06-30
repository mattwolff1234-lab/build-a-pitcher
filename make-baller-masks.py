# Cuts the 9 body-region masks (hoop-seg-<slot>.png) out of baller-figure.png via nearest-anchor
# (Voronoi) assignment + Gaussian feathering. Anchors are PERCENT of the figure frame (_baller_grid.png).
# New body-map: clutch->head, frame->chest, defense->shoulders/arms, rebounding->core,
# 3-Pointer->ball hand, playmaking->off hand, dribble->forearms, finishing->thighs, speed->legs/feet.
import numpy as np
from PIL import Image, ImageFilter

fig = Image.open('baller-figure.png').convert('RGBA')
W, H = fig.size
A = np.array(fig.split()[-1])
body = A > 20

anchors = [
    (58, 9, 'clutch'), (58, 15, 'clutch'),                                  # head (mental)
    (54, 28, 'frame'), (54, 35, 'frame'),                                   # chest / body frame
    (41, 22, 'defense'), (69, 24, 'defense'), (34, 30, 'defense'), (76, 31, 'defense'),  # shoulders + upper arms
    (53, 45, 'rebounding'), (53, 52, 'rebounding'),                         # core / shorts
    (15, 50, 'threept'), (23, 45, 'threept'),                               # ball / shooting hand (lower-left)
    (85, 56, 'playmaking'), (84, 49, 'playmaking'),                         # off / passing hand (lower-right)
    (26, 40, 'dribble'), (81, 45, 'dribble'),                              # forearms
    (38, 60, 'finishing'), (65, 62, 'finishing'),                         # thighs
    (20, 75, 'speed'), (13, 87, 'speed'), (79, 75, 'speed'), (87, 87, 'speed'),  # shins + feet
]
SLOTS = ['threept', 'finishing', 'dribble', 'playmaking', 'defense', 'rebounding', 'speed', 'clutch', 'frame']

ax = np.array([a[0] / 100 * W for a in anchors])
ay = np.array([a[1] / 100 * H for a in anchors])
ys, xs = np.mgrid[0:H, 0:W]
best = np.full((H, W), 1e18); lab = np.full((H, W), -1, dtype=int)
for i in range(len(anchors)):
    d = (xs - ax[i]) ** 2 + (ys - ay[i]) ** 2
    m = d < best; best[m] = d[m]; lab[m] = i

PALETTE = {'threept': (255,90,90), 'finishing': (255,170,60), 'dribble': (255,230,70),
           'playmaking': (120,230,120), 'defense': (90,200,255), 'rebounding': (150,140,255),
           'speed': (240,120,220), 'clutch': (255,255,255), 'frame': (120,255,210)}
preview = Image.new('RGBA', (W, H), (16, 22, 33, 255))

for slot in SLOTS:
    idxs = [i for i, a in enumerate(anchors) if a[2] == slot]
    mask = (np.isin(lab, idxs) & body).astype('uint8') * 255
    blurred = np.array(Image.fromarray(mask, 'L').filter(ImageFilter.GaussianBlur(12)))
    clipped = np.minimum(blurred, A).astype('uint8')
    out = Image.new('RGBA', (W, H), PALETTE[slot] + (0,))
    out.putalpha(Image.fromarray(clipped, 'L'))
    out.save(f'hoop-seg-{slot}.png')
    preview.alpha_composite(out)

preview.convert('RGB').save('_baller_regions.png')
print('wrote 9 hoop-seg-*.png + _baller_regions.png')
