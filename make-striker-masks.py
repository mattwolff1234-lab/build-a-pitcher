# Cuts the 9 body-region masks (soc-seg-<slot>.png) out of striker-figure.png via nearest-anchor
# (Voronoi) assignment + Gaussian feathering. Anchors are PERCENT of the figure frame (_striker_grid.png).
# Body-map: heading->head, clutch->heart/chest, physical->core, frame->hips/shorts,
# passing->extended (vision) arm, dribbling->near arm, power->striking thigh,
# finishing->striking shin+boot+ball, pace->trailing leg.
import numpy as np
from PIL import Image, ImageFilter

fig = Image.open('striker-figure.png').convert('RGBA')
W, H = fig.size
A = np.array(fig.split()[-1])
body = A > 20

anchors = [
    (52, 8, 'heading'), (56, 14, 'heading'),                       # head
    (49, 28, 'clutch'), (56, 30, 'clutch'),                        # heart / upper chest
    (49, 41, 'physical'), (56, 44, 'physical'),                    # core / engine
    (47, 54, 'frame'), (55, 56, 'frame'),                          # hips / shorts
    (40, 21, 'passing'), (30, 24, 'passing'), (13, 24, 'passing'), # extended vision arm
    (63, 33, 'dribbling'), (70, 48, 'dribbling'),                  # near arm (balance/control)
    (61, 58, 'power'), (66, 65, 'power'),                          # striking thigh
    (74, 79, 'finishing'), (80, 91, 'finishing'), (89, 87, 'finishing'),  # shin + boot + ball
    (37, 66, 'pace'), (23, 68, 'pace'), (11, 59, 'pace'),          # trailing leg
]
SLOTS = ['finishing', 'pace', 'power', 'dribbling', 'passing', 'heading', 'physical', 'clutch', 'frame']

ax = np.array([a[0] / 100 * W for a in anchors])
ay = np.array([a[1] / 100 * H for a in anchors])
ys, xs = np.mgrid[0:H, 0:W]
best = np.full((H, W), 1e18); lab = np.full((H, W), -1, dtype=int)
for i in range(len(anchors)):
    d = (xs - ax[i]) ** 2 + (ys - ay[i]) ** 2
    m = d < best; best[m] = d[m]; lab[m] = i

PALETTE = {'finishing': (255,90,90), 'pace': (255,170,60), 'power': (255,230,70),
           'dribbling': (120,230,120), 'passing': (90,200,255), 'heading': (150,140,255),
           'physical': (240,120,220), 'clutch': (255,255,255), 'frame': (120,255,210)}
preview = Image.new('RGBA', (W, H), (16, 22, 33, 255))

for slot in SLOTS:
    idxs = [i for i, a in enumerate(anchors) if a[2] == slot]
    mask = (np.isin(lab, idxs) & body).astype('uint8') * 255
    blurred = np.array(Image.fromarray(mask, 'L').filter(ImageFilter.GaussianBlur(12)))
    clipped = np.minimum(blurred, A).astype('uint8')
    out = Image.new('RGBA', (W, H), PALETTE[slot] + (0,))
    out.putalpha(Image.fromarray(clipped, 'L'))
    out.save(f'soc-seg-{slot}.png')
    preview.alpha_composite(out)

preview.convert('RGB').save('_striker_regions.png')
print('wrote 9 soc-seg-*.png + _striker_regions.png')
