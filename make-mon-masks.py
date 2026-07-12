# Cuts the 7 body-region masks (mon-seg-<slot>.png) out of mon-figure.png via nearest-anchor
# (Voronoi) assignment + Gaussian feathering. Anchors are PERCENT of the figure frame
# (see _mon_grid.png). Body-map (monster-literal):
#   spatk=head/horns (the mind), spdef=neck frill + back spikes (the shield), attack=claws/arms,
#   defense=chest plates (armor), hp=belly (the life pool), speed=legs/feet,
#   frame=tail + flame (the bulk).
import numpy as np
from PIL import Image, ImageFilter

ANCHORS = [
    (60, 15, 'spatk'), (66, 22, 'spatk'), (50, 9, 'spatk'), (70, 8, 'spatk'),
    (44, 25, 'spdef'), (42, 35, 'spdef'), (40, 45, 'spdef'),
    (28, 26, 'attack'), (31, 32, 'attack'), (35, 42, 'attack'), (88, 32, 'attack'), (92, 40, 'attack'), (85, 48, 'attack'),
    (57, 42, 'defense'), (66, 44, 'defense'),
    (60, 60, 'hp'), (66, 68, 'hp'),
    (44, 84, 'speed'), (50, 91, 'speed'), (63, 78, 'speed'), (38, 82, 'speed'), (34, 89, 'speed'),
    (22, 76, 'frame'), (14, 68, 'frame'), (11, 55, 'frame'),
]
SLOTS = ['spatk', 'spdef', 'attack', 'defense', 'hp', 'speed', 'frame']
PALETTE = [(255,90,90),(255,170,60),(255,230,70),(120,230,120),(90,200,255),(150,140,255),(240,120,220)]

fig = Image.open('mon-figure.png').convert('RGBA')
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
    out.save(f'mon-seg-{slot}.png')
    preview.alpha_composite(out)
preview.convert('RGB').save('_mon_regions.png')
print('wrote 7 mon-seg-*.png + _mon_regions.png')
