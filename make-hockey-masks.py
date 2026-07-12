# Cuts the 9 body-region masks (hockey-seg-<slot>.png) out of hockey-figure.png via
# nearest-anchor (Voronoi) assignment + Gaussian feathering. Anchors are PERCENT of the figure
# frame (see _hockey_grid.png). Body-map (hockey-literal):
#   iq=helmet (reading the ice), physical=shoulders (the check), clutch=chest (heart),
#   playmaking=gloves/hands (the dish), shotpower=shooting arm, sniping=stick blade + puck,
#   frame=core/hips, motor=thighs + stride leg (ice time is legs), defense=shin pads + skates
#   (shot blocks + edges).
import numpy as np
from PIL import Image, ImageFilter

ANCHORS = [
    (39, 8, 'iq'), (43, 13, 'iq'),
    (62, 9, 'physical'), (71, 13, 'physical'), (56, 13, 'physical'),
    (52, 24, 'clutch'), (57, 30, 'clutch'),
    (75, 28, 'playmaking'), (44, 56, 'playmaking'), (48, 59, 'playmaking'),
    (37, 32, 'shotpower'), (40, 42, 'shotpower'), (43, 50, 'shotpower'),
    (57, 40, 'frame'), (63, 47, 'frame'),
    (62, 57, 'motor'), (70, 64, 'motor'), (78, 70, 'motor'),
    (59, 77, 'defense'), (61, 86, 'defense'), (87, 77, 'defense'), (93, 82, 'defense'),
    (28, 74, 'sniping'), (18, 81, 'sniping'), (9, 84, 'sniping'), (12, 87, 'sniping'),
]
SLOTS = ['iq', 'physical', 'clutch', 'playmaking', 'shotpower', 'frame', 'motor', 'defense', 'sniping']
PALETTE = [(255,90,90),(255,170,60),(255,230,70),(120,230,120),(90,200,255),(150,140,255),(240,120,220),(255,255,255),(120,255,210)]

fig = Image.open('hockey-figure.png').convert('RGBA')
W, H = fig.size
A = np.array(fig.split()[-1])
body = A > 20

ax = np.array([a[0] / 100 * W for a in ANCHORS])
ay = np.array([a[1] / 100 * H for a in ANCHORS])
ys, xs = np.mgrid[0:H, 0:W]
best = np.full((H, W), 1e18); lab = np.full((H, W), -1, dtype=int)
for i in range(len(ANCHORS)):
    d = (xs - ax[i]) ** 2 + (ys - ay[i]) ** 2
    m = d < best; best[m] = d[m]; lab[m] = i

preview = Image.new('RGBA', (W, H), (16, 22, 33, 255))
for si, slot in enumerate(SLOTS):
    idxs = [i for i, a in enumerate(ANCHORS) if a[2] == slot]
    mask = (np.isin(lab, idxs) & body).astype('uint8') * 255
    blurred = np.array(Image.fromarray(mask, 'L').filter(ImageFilter.GaussianBlur(12)))
    clipped = np.minimum(blurred, A).astype('uint8')
    out = Image.new('RGBA', (W, H), PALETTE[si] + (0,))
    out.putalpha(Image.fromarray(clipped, 'L'))
    out.save(f'hockey-seg-{slot}.png')
    preview.alpha_composite(out)
preview.convert('RGB').save('_hockey_regions.png')
print('wrote 9 hockey-seg-*.png + _hockey_regions.png')
