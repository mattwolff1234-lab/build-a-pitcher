# Bakes the soccer 1v1 shootout poses into soccer-anim/*.png (transparent, used as CSS masks and
# tinted per player, like baseball-anim/ and hoops-anim/).
#
# Pipeline (v2 — the v1 erode/regrow + line-stripping carved stripes through the bodies):
#   1. threshold dark
#   2. OPEN (erode+dilate) to kill thin junk: net grid, ground line, ball outline, speed lines
#   3. detect goal-frame bars = pixels on LONG axis-aligned runs that are NOT protected; protection
#      = dilated "locally solid" regions, so a whole arm/leg is protected by its thick center and
#      never carved (v1's mistake was testing thinness per-pixel, which shaved limb edges)
#   4. body = largest connected component after the frame is cut
#   5. CLOSE + slight blur for smooth edges
import os
from collections import deque
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

os.makedirs('soccer-anim', exist_ok=True)

def largest_component(mask):
    """mask: bool ndarray -> bool ndarray of its largest 4-connected component."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best = None; best_n = 0
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            if mask[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True
                pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for ny, nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx))
                if len(pts) > best_n:
                    best_n = len(pts); best = pts
    out = np.zeros_like(mask, dtype=bool)
    if best:
        ys, xs = zip(*best)
        out[list(ys), list(xs)] = True
    return out

def _windowed(D, half, axis):
    """True where D is true for every pixel within +-half along axis (centered run)."""
    R = D.copy()
    for k in range(1, half + 1):
        R &= np.roll(D, k, axis) & np.roll(D, -k, axis)
    return R

def to_img(B):
    return Image.fromarray((B * 255).astype('uint8'), 'L')

def to_arr(im):
    return np.array(im) > 0

def extract(cell, run_half=45, solid_half=7, protect_grow=31, frame_grow=11,
            open_win=5, close_win=9):
    dark = to_arr(cell.point(lambda v: 255 if v < 110 else 0))

    # 2. opening: net / ground line / ball outline / speed lines die, body + goal frame survive
    opened = to_arr(to_img(dark).filter(ImageFilter.MinFilter(open_win))
                                .filter(ImageFilter.MaxFilter(open_win)))

    # 3. goal frame: long straight runs, minus dilated protection around anything locally solid
    Vlong = _windowed(opened, run_half, 0)
    Hlong = _windowed(opened, run_half, 1)
    Hsolid = _windowed(opened, solid_half, 1)   # solid across ~15px horizontally (body, not posts)
    Vsolid = _windowed(opened, solid_half, 0)
    protectH = to_arr(to_img(Hsolid).filter(ImageFilter.MaxFilter(protect_grow)))
    protectV = to_arr(to_img(Vsolid).filter(ImageFilter.MaxFilter(protect_grow)))
    frame = (Vlong & ~protectH) | (Hlong & ~protectV)
    frame = to_arr(to_img(frame).filter(ImageFilter.MaxFilter(frame_grow)))

    base = opened & ~frame
    body = largest_component(base)
    if not body.any():
        return None

    # 5. close (seal nicks, smooth outline) + soft edge
    alpha = to_img(body).filter(ImageFilter.MaxFilter(close_win)).filter(ImageFilter.MinFilter(close_win))
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.0))
    bbox = alpha.getbbox()
    if not bbox:
        return None
    alpha = alpha.crop(bbox)
    out = Image.new('RGBA', alpha.size, (10, 14, 20, 255))
    out.putalpha(alpha)
    return out

# ---- keeper sheet (3x3, cells contain goal + net + sometimes the ball) ----------------------
NAMES = [
    ['ready',    'divehigh', 'catchhigh'],
    ['savelow',  'catchover','set'],
    ['stride',   'readylow', 'divelow'],
]
sheet = Image.open('_keeper-poses.png').convert('L')
W, H = sheet.size
cw, ch = W // 3, H // 3
KP_SKIP = {'set', 'stride'}   # unused by the shootout and the sheet versions have post stubs
for r in range(3):
    for c in range(3):
        if NAMES[r][c] in KP_SKIP: continue
        cell = sheet.crop((c*cw, r*ch, (c+1)*cw, (r+1)*ch))
        out = extract(cell)
        if out is None:
            print('EMPTY CELL', r, c); continue
        out.save(f'soccer-anim/kp-{NAMES[r][c]}.png')
        print(f'kp-{NAMES[r][c]}.png', out.size)

# ---- striker sheet (5x2, clean bodies + a separate ball) ------------------------------------
ST_NAMES = [
    ['run', 'kickbig', 'shot', 'leap', 'celebrate'],
    ['dribble', 'bicycle', 'sprint', 'strike', 'flick'],
]
ssheet = Image.open('_striker-poses.png').convert('L')
SW, SH = ssheet.size
scw, sch = SW // 5, SH // 2
ST_FLIP = {'run', 'sprint'}   # sheet art faces LEFT; the shootout striker runs RIGHT at the ball
for r in range(2):
    for c in range(5):
        cell = ssheet.crop((c*scw, r*sch, (c+1)*scw, (r+1)*sch))
        out = extract(cell)
        if out is None:
            print('EMPTY STRIKER CELL', r, c); continue
        if ST_NAMES[r][c] in ST_FLIP:
            out = out.transpose(Image.FLIP_LEFT_RIGHT)
        out.save(f'soccer-anim/st-{ST_NAMES[r][c]}.png')
        print(f'st-{ST_NAMES[r][c]}.png', out.size)

# ---- striker kick pose: the game figure's source art MINUS the ball -------------------------
src = Image.open('_striker-source.png').convert('L')
W0, H0 = src.size
dark = np.array(src.point(lambda v: 255 if v < 110 else 0))
win = np.zeros_like(dark, dtype=bool)
win[int(H0*0.60):int(H0*0.90), int(W0*0.82):] = True
ys, xs = np.where((dark > 0) & win)
alpha = Image.fromarray(dark.astype('uint8'), 'L')
if len(xs):
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cx, cy = (x0+x1)/2, (y0+y1)/2
    rr = max(x1-x0, y1-y0)/2 + 6
    d = ImageDraw.Draw(alpha)
    d.ellipse([cx-rr, cy-rr, cx+rr, cy+rr], fill=0)   # ERASE the ball — the sprite ball flies separately
alpha = alpha.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
alpha = alpha.filter(ImageFilter.GaussianBlur(1.0))
bbox = alpha.getbbox()
alpha = alpha.crop(bbox)
out = Image.new('RGBA', alpha.size, (10, 14, 20, 255))
out.putalpha(alpha)
out.save('soccer-anim/st-kick.png')
print('st-kick.png', out.size)

# ---- hi-res single-pose art (_pose-src/src-N.png, 1086x1448) — overrides the sheet cells ----
# 0 header · 1 diving header · 2 bicycle-back · 3 bicycle-high · 4 overhead volley · 5 run+ball
# 6 big kick · 7 volley kick · 8 high finish · 9 run stride
# 10 keeper ready · 11 low scoop · 12 full dive · 13 leaping catch · 14 kneeling gather
SINGLES = {
    'st-shot':      ('src-6.png',  {}),
    'st-volley':    ('src-7.png',  {}),
    'st-shothigh':  ('src-8.png',  {}),
    'st-header':    ('src-0.png',  {}),
    'st-bicycle':   ('src-3.png',  {}),
    'kp-ready':     ('src-10.png', {}),
    'kp-readylow':  ('src-10.png', {}),
    # grounded poses: modest growth (the body touches the goal line — long growth leaks whiskers)
    'kp-savelow':   ('src-11.png', {'grow_steps': 80, 'close_win': 17}),
    'kp-divelow':   ('src-14.png', {}),
    # airborne poses: outstretched thin arms need deep growth to reach the gloves; nothing to leak into
    'kp-divehigh':  ('src-12.png', {'grow_steps': 150}),
    'kp-catchhigh': ('src-13.png', {'grow_steps': 150}),
}
def dilate3(B):
    return B | np.roll(B,1,0) | np.roll(B,-1,0) | np.roll(B,1,1) | np.roll(B,-1,1)

def fill_small_holes(body, max_hole=2500):
    """Fill enclosed background pockets smaller than max_hole px (BFS the background from the
    border; unreached background regions are holes)."""
    h, w = body.shape
    bg = ~body
    reach = np.zeros_like(bg, dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h-1):
            if bg[y, x] and not reach[y, x]: reach[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w-1):
            if bg[y, x] and not reach[y, x]: reach[y, x] = True; q.append((y, x))
    while q:
        cy, cx = q.popleft()
        for ny, nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
            if 0 <= ny < h and 0 <= nx < w and bg[ny, nx] and not reach[ny, nx]:
                reach[ny, nx] = True; q.append((ny, nx))
    holes = bg & ~reach
    # fill only small pockets
    seen = np.zeros_like(holes, dtype=bool)
    out = body.copy()
    for y in range(h):
        for x in range(w):
            if holes[y, x] and not seen[y, x]:
                q2 = deque([(y, x)]); seen[y, x] = True
                pts = [(y, x)]
                while q2:
                    cy, cx = q2.popleft()
                    for ny, nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                        if 0 <= ny < h and 0 <= nx < w and holes[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q2.append((ny, nx)); pts.append((ny, nx))
                if len(pts) <= max_hole:
                    ys, xs2 = zip(*pts)
                    out[list(ys), list(xs2)] = True
    return out

def extract_body(cell, open_win=9, core_win=9, core_iters=4, min_core=2000, grow_steps=45,
                 close_win=13):
    """Hi-res single-pose extraction. Frame bars / net / ground line are all thinner than ~33px,
    so only the body survives a deep erosion ('cores'). Geodesic regrowth from the cores inside
    the opened mask recovers hands/feet but can only leak a few px along touching frame lines."""
    dark = to_arr(cell.point(lambda v: 255 if v < 110 else 0))
    op = to_img(dark).filter(ImageFilter.MinFilter(open_win)).filter(ImageFilter.MaxFilter(open_win))
    opened = to_arr(op)

    core_img = to_img(opened)
    for _ in range(core_iters):
        core_img = core_img.filter(ImageFilter.MinFilter(core_win))
    core = to_arr(core_img)
    # seeds = every core blob of real size (drops ball-pentagon specks); no largest-only here so
    # gloves/boots with their own cores still count
    h, w = core.shape
    seen = np.zeros_like(core, dtype=bool)
    seeds = np.zeros_like(core, dtype=bool)
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            if core[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True
                pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for ny, nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                        if 0 <= ny < h and 0 <= nx < w and core[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx))
                if len(pts) >= min_core:
                    ys, xs2 = zip(*pts)
                    seeds[list(ys), list(xs2)] = True
    if not seeds.any():
        return None

    body = seeds
    for _ in range(grow_steps):
        body = dilate3(body) & opened
    body = largest_component(body)
    body = fill_small_holes(body, max_hole=2500)   # ball-overlap pockets; leg gaps stay open

    alpha = to_img(body).filter(ImageFilter.MaxFilter(close_win)).filter(ImageFilter.MinFilter(close_win))
    # the close can seal a thin channel and trap a new pocket — fill once more
    alpha = to_img(fill_small_holes(to_arr(alpha), max_hole=2500))
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.2))
    bbox = alpha.getbbox()
    if not bbox:
        return None
    alpha = alpha.crop(bbox)
    out = Image.new('RGBA', alpha.size, (10, 14, 20, 255))
    out.putalpha(alpha)
    return out

for out_name, (src_name, kw) in SINGLES.items():
    cell = Image.open(f'_pose-src/{src_name}').convert('L')
    out = extract_body(cell, **kw)
    if out is None:
        print('EMPTY SINGLE', out_name); continue
    out.save(f'soccer-anim/{out_name}.png')
    print(f'{out_name}.png (single)', out.size)

# ---- white-on-dark contact sheet for eyeballing ---------------------------------------------
tiles = sorted(os.listdir('soccer-anim'))
th = 170
cols = 5
rows = (len(tiles) + cols - 1) // cols
sheet_out = Image.new('RGB', (cols*(th+10)+10, rows*(th+26)+10), (12, 16, 24))
d = ImageDraw.Draw(sheet_out)
for i, t in enumerate(tiles):
    im = Image.open('soccer-anim/' + t)
    a = im.split()[-1]
    cellv = Image.new('RGB', im.size, (12, 16, 24))
    cellv.paste(Image.new('RGB', im.size, (240, 240, 240)), (0, 0), a)
    cellv.thumbnail((th, th))
    x = 10 + (i % cols) * (th + 10); y = 10 + (i // cols) * (th + 26)
    sheet_out.paste(cellv, (x, y))
    d.text((x, y + th + 3), t.replace('.png', ''), fill=(150, 160, 175))
sheet_out.save('_soccer_anim_preview.png')
print('wrote _soccer_anim_preview.png')
