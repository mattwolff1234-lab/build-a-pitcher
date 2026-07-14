"""Bake production jersey assets for one figure from its seg-map.
Outputs (flat, in repo root):
  jersey-<key>-base.png              bg-removed illustrated figure (RGBA)
  jersey-<key>-<region>.png          one white/alpha CSS-mask per garment region
Run:  python bake-figure.py pitcher
Same classifier + cleanup the sandbox uses (hue classify w/ purple<->skin brightness split,
majority filter, grow-into-white), so masks match what you approved in the sandbox.
"""
import sys, json
import numpy as np
from PIL import Image, ImageFilter
try:
    from scipy import ndimage
    HAVE_SCIPY = True
except Exception:
    HAVE_SCIPY = False

def keep_big_components(mask, frac=0.12, floor=40):
    """Keep connected components >= max(floor, frac*largest); kills floating specks."""
    if not HAVE_SCIPY:
        return mask
    lbl, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(np.ones_like(lbl, dtype=np.float32), lbl, range(1, n+1))
    thr = max(floor, sizes.max()*frac)
    good = np.array([0] + [1 if s >= thr else 0 for s in sizes], dtype=bool)
    return good[lbl]

LABELS = ['red','orange','yellow','green','cyan','blue','purple','magenta','_black','_white']
IDX = {l:i for i,l in enumerate(LABELS)}
HUES = {'red':2,'orange':32,'yellow':58,'green':130,'cyan':182,'blue':242,'purple':272,'magenta':302}

def classify_arr(rgb):
    r = rgb[...,0]/255.0; g = rgb[...,1]/255.0; b = rgb[...,2]/255.0
    mx = np.maximum(np.maximum(r,g),b); mn = np.minimum(np.minimum(r,g),b); d = mx-mn
    s = np.where(mx>0, d/np.maximum(mx,1e-9), 0.0); v = mx
    h = np.zeros_like(mx)
    nz = d>1e-9
    rmax = (mx==r)&nz; gmax = (mx==g)&nz&~rmax; bmax = nz&~rmax&~gmax
    h[rmax] = ((g-b)/d)[rmax] % 6
    h[gmax] = ((b-r)/d)[gmax] + 2
    h[bmax] = ((r-g)/d)[bmax] + 4
    h = (h*60) % 360
    lab = np.full(mx.shape, IDX['_black'], dtype=np.uint8)
    # nearest hue
    best = np.zeros(mx.shape, dtype=np.uint8); bestd = np.full(mx.shape, 999.0)
    for k,hv in HUES.items():
        dh = np.abs(h-hv); dh = np.minimum(dh, 360-dh)
        m = dh < bestd; bestd[m] = dh[m]; best[m] = IDX[k]
    lab = best.copy()
    # purple<->skin share ~301 hue: split by brightness (dark=purple region, bright=skin)
    pm = (best==IDX['magenta'])|(best==IDX['purple'])
    lab[pm & (v<0.62)] = IDX['purple']
    lab[pm & (v>=0.62)] = IDX['magenta']
    # low-saturation -> white/black
    lowsat = s < 0.28
    lab[lowsat & (v>0.6)] = IDX['_white']
    lab[lowsat & (v<=0.6)] = IDX['_black']
    return lab

def grow_into_white(lab, regi, iters=2):
    WH = IDX['_white']
    for _ in range(iters):
        nxt = lab.copy()
        for dy in (-1,0,1):
            for dx in (-1,0,1):
                if dx==0 and dy==0: continue
                shifted = np.roll(np.roll(lab, dy, axis=0), dx, axis=1)
                take = (lab==WH) & (nxt==WH) & np.isin(shifted, list(regi))
                nxt[take] = shifted[take]
        lab = nxt
    return lab

def main(key):
    assets = json.load(open('proto-assets.json'))
    fig = assets['figures'][key]
    W = 900
    seg = Image.open(fig['segmap']).convert('RGB')
    H = round(W * seg.height / seg.width)
    seg = seg.resize((W,H), Image.BILINEAR)
    rgb = np.asarray(seg)
    lab = classify_arr(rgb)
    # majority filter via PIL ModeFilter on the label image
    labimg = Image.fromarray(lab, mode='L').filter(ImageFilter.ModeFilter(3))
    lab = np.asarray(labimg).copy()
    regi = {IDX[c] for c in fig['regions'].keys()}
    lab = grow_into_white(lab, regi, 2)
    # per-region masks (feathered alpha)
    for cname, role in fig['regions'].items():
        # hard edges (a soft blur feathered team color onto adjacent skin/ball) + drop floating
        # specks so only the real garment shape remains (kills stray blobs on shoulder/ball/nose).
        keep = keep_big_components(lab==IDX[cname])
        alpha = np.where(keep, 255, 0).astype(np.uint8)
        a = Image.fromarray(alpha, mode='L')
        out = Image.merge('RGBA', (Image.new('L',(W,H),255),)*3 + (a,))
        fn = f'jersey-{key}-{role}.png'
        out.save(fn)
        print('  mask', fn, f'({int((alpha>0).mean()*100)}% cov)')
    # ---- figure silhouette: UNION of two border-flood cutouts so dark shoes AND white socks
    # both survive. Each source is blind to the other's colors:
    #   (a) base cutout  -> bg = border-connected charcoal; keeps bright uniform, skin, WHITE SOCKS
    #                        (but eats near-black shoes that match the dark bg)
    #   (b) segmap cutout-> bg = border-connected WHITE; keeps colored garments + BLACK SHOES/glove
    #                        (but can lose white socks that abut the white seg bg)
    # OR them together and you get the whole player with no see-through holes.
    base = Image.open(fig['base']).convert('RGBA').resize((W,H), Image.BILINEAR)
    bar = np.asarray(base).astype(np.int16)
    corner = bar[0,0,:3]
    dist2 = ((bar[...,:3]-corner)**2).sum(axis=2)
    bgcol = dist2 < 46*46
    def border_flood(binmask):
        lbl, _ = ndimage.label(binmask)
        b = np.unique(np.concatenate([lbl[0,:], lbl[-1,:], lbl[:,0], lbl[:,-1]])); b = b[b != 0]
        return np.isin(lbl, b)
    if HAVE_SCIPY:
        base_fig = ~border_flood(bgcol)
        seg_fig = ~border_flood(lab == IDX['_white'])
        figure = base_fig | seg_fig
        figure = keep_big_components(figure, frac=0.0, floor=300)   # drop stray specks, keep ball/parts
    else:
        figure = ~bgcol
    a = np.where(figure, 255, 0).astype(np.uint8)
    aimg = Image.fromarray(a, mode='L').filter(ImageFilter.GaussianBlur(0.6))
    rgba = base.copy(); rgba.putalpha(aimg)
    bn = f'jersey-{key}-base.png'
    rgba.save(bn)
    print('  base', bn)
    # skin-tone variants: same pose -> reuse the SAME silhouette alpha, swap only the skin RGB
    for tone, src in (fig.get('skins') or {}).items():
        try:
            v = Image.open(src).convert('RGBA').resize((W, H), Image.BILINEAR)
        except FileNotFoundError:
            continue
        v.putalpha(aimg)
        v.save(f'jersey-{key}-{tone}-base.png')
        print(f'  skin  jersey-{key}-{tone}-base.png')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv)>1 else 'pitcher')
