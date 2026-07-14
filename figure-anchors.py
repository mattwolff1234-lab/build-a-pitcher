"""Compute anchor points for each baked figure = the centroid of each garment region mask,
in figure-% and in stage-% (the figbox occupies ~53% of the stage width, centered, so
stage_x = 23.5 + fig_x*0.53 ; stage_y = fig_y). These feed each game's SLOTS ax/ay.
Run: python figure-anchors.py [figure]   (no arg = all)
"""
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage

FIGBOX = 0.53          # figbox width as fraction of stage
GUT = (1 - FIGBOX) / 2 * 100   # 23.5

def centroids(key, regions):
    out = {}
    for role in regions:
        fn = f'jersey-{key}-{role}.png'
        try:
            a = np.asarray(Image.open(fn).convert('RGBA'))[..., 3]
        except FileNotFoundError:
            continue
        m = a > 40
        # for split regions (two gloves, socks on spread legs) the overall centroid lands in the
        # empty gap between the blobs — anchor on the LARGEST connected blob instead.
        lbl, n = ndimage.label(m)
        if n > 1:
            sizes = ndimage.sum(np.ones_like(lbl, dtype=np.float32), lbl, range(1, n + 1))
            m = lbl == (int(np.argmax(sizes)) + 1)
        ys, xs = np.nonzero(m)
        if len(xs) == 0:
            out[role] = None; continue
        H, W = a.shape
        fx = xs.mean() / W * 100
        fy = ys.mean() / H * 100
        sx = GUT + fx * FIGBOX
        out[role] = { 'fig': [round(fx, 1), round(fy, 1)], 'stage': [round(sx, 1), round(fy, 1)] }
    return out

assets = json.load(open('proto-assets.json'))
keys = [sys.argv[1]] if len(sys.argv) > 1 else list(assets['figures'].keys())
result = {}
for key in keys:
    fig = assets['figures'].get(key)
    if not fig:
        continue
    garments = list(fig['regions'].values())   # e.g. cap, jersey, lsleeve — match mask filenames
    c = centroids(key, garments)
    result[key] = c
    print(f'\n{key}:')
    for g in garments:
        cc = c.get(g)
        if cc:
            print(f"   {g:12} fig={cc['fig']}  stage={cc['stage']}")
