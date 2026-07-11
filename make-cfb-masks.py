# Cuts the 9 body-region masks per position (cfb-<pos>-seg-<slot>.png) out of the three
# cfb-<pos>-figure.png files via nearest-anchor (Voronoi) assignment + Gaussian feathering.
# Anchors are PERCENT of each figure frame (see _cfb_<pos>_grid.png).
# Body-maps (football-literal):
#   QB: iq=helmet, armPower=throwing bicep, shortAcc=throwing hand+ball, deepAcc=off arm
#       (pointing downfield), poise=chest, midAcc=core (rotation), frame=hips,
#       onRun=planted front leg, wheels=back leg.
#   RB: vision=helmet, power=stiff arm, hands=hand cradling the ball, ballSec=ball against the
#       pads (high and tight), breakTk=chest/pads, frame=core, elusive=hips (the juke),
#       burst=front drive leg, speed=back stride leg.
#   WR: routes=helmet (savvy), hands=ball+gloves, spectac=forearms (full extension),
#       release=upper arms/shoulders, traffic=chest, frame=core, leap=hips (spring),
#       agility=lead leg, speed=trail leg.
import numpy as np
from PIL import Image, ImageFilter

ANCHORS = {
    'qb': [
        (53, 10, 'iq'), (56, 15, 'iq'),
        (30, 26, 'armPower'), (24, 28, 'armPower'),
        (16, 16, 'shortAcc'), (12, 12, 'shortAcc'), (19, 13, 'shortAcc'),
        (74, 28, 'deepAcc'), (82, 31, 'deepAcc'), (90, 32, 'deepAcc'),
        (48, 30, 'poise'), (55, 32, 'poise'),
        (50, 44, 'midAcc'), (56, 46, 'midAcc'),
        (50, 54, 'frame'), (57, 55, 'frame'),
        (67, 63, 'onRun'), (75, 73, 'onRun'), (80, 86, 'onRun'),
        (40, 64, 'wheels'), (30, 74, 'wheels'), (18, 86, 'wheels'),
    ],
    'rb': [
        (53, 8, 'vision'), (57, 14, 'vision'),
        (72, 24, 'power'), (82, 22, 'power'), (92, 20, 'power'),
        (41, 34, 'hands'), (46, 36, 'hands'),
        (38, 29, 'ballSec'), (44, 30, 'ballSec'),
        (48, 22, 'breakTk'), (38, 20, 'breakTk'), (55, 27, 'breakTk'),
        (48, 42, 'frame'), (53, 40, 'frame'),
        (46, 49, 'elusive'), (53, 47, 'elusive'),
        (63, 50, 'burst'), (67, 57, 'burst'), (66, 70, 'burst'),
        (42, 56, 'speed'), (34, 64, 'speed'), (22, 76, 'speed'), (11, 87, 'speed'),
    ],
    'wr': [
        (42, 15, 'routes'), (45, 20, 'routes'),
        (70, 8, 'hands'), (63, 9, 'hands'), (74, 13, 'hands'),
        (62, 19, 'spectac'), (67, 15, 'spectac'), (57, 24, 'spectac'),
        (49, 28, 'release'), (54, 23, 'release'),
        (44, 33, 'traffic'), (48, 36, 'traffic'),
        (45, 43, 'frame'), (49, 45, 'frame'),
        (43, 51, 'leap'), (50, 52, 'leap'),
        (58, 56, 'agility'), (66, 63, 'agility'), (74, 72, 'agility'), (85, 79, 'agility'),
        (37, 61, 'speed'), (29, 71, 'speed'), (17, 81, 'speed'), (8, 88, 'speed'),
    ],
}
SLOTS = {
    'qb': ['iq', 'armPower', 'shortAcc', 'deepAcc', 'poise', 'midAcc', 'frame', 'onRun', 'wheels'],
    'rb': ['vision', 'power', 'hands', 'ballSec', 'breakTk', 'frame', 'elusive', 'burst', 'speed'],
    'wr': ['routes', 'hands', 'spectac', 'release', 'traffic', 'frame', 'leap', 'agility', 'speed'],
}
PALETTE = [(255,90,90),(255,170,60),(255,230,70),(120,230,120),(90,200,255),(150,140,255),(240,120,220),(255,255,255),(120,255,210)]

for pos in ['qb', 'rb', 'wr']:
    fig = Image.open(f'cfb-{pos}-figure.png').convert('RGBA')
    W, H = fig.size
    A = np.array(fig.split()[-1])
    body = A > 20
    anchors = ANCHORS[pos]

    ax = np.array([a[0] / 100 * W for a in anchors])
    ay = np.array([a[1] / 100 * H for a in anchors])
    ys, xs = np.mgrid[0:H, 0:W]
    best = np.full((H, W), 1e18); lab = np.full((H, W), -1, dtype=int)
    for i in range(len(anchors)):
        d = (xs - ax[i]) ** 2 + (ys - ay[i]) ** 2
        m = d < best; best[m] = d[m]; lab[m] = i

    preview = Image.new('RGBA', (W, H), (16, 22, 33, 255))
    for si, slot in enumerate(SLOTS[pos]):
        idxs = [i for i, a in enumerate(anchors) if a[2] == slot]
        mask = (np.isin(lab, idxs) & body).astype('uint8') * 255
        blurred = np.array(Image.fromarray(mask, 'L').filter(ImageFilter.GaussianBlur(12)))
        clipped = np.minimum(blurred, A).astype('uint8')
        out = Image.new('RGBA', (W, H), PALETTE[si] + (0,))
        out.putalpha(Image.fromarray(clipped, 'L'))
        out.save(f'cfb-{pos}-seg-{slot}.png')
        preview.alpha_composite(out)
    preview.convert('RGB').save(f'_cfb_{pos}_regions.png')
    print(f'{pos}: wrote 9 cfb-{pos}-seg-*.png + _cfb_{pos}_regions.png')
