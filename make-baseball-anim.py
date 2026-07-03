# Process raw baseball silhouettes (black-on-white) into transparent, team-tintable
# pose masks for the versus.html at-bat, mirroring make-hoops-anim.py.
#  - white background -> transparent (alpha ramp from luminance), RGB forced black
#  - 'release' keeps ONLY the largest connected component (the raw art has a loose
#    ball baked in at the fingertips; the CSS ball would double it)
#  - 'bb-ball' is filled WHITE with the seams left transparent, so on the dark
#    diamond it reads as a white ball with dark seams
# Output: baseball-anim/<posename>.png  (543x724, ball 240x240)
import os
from collections import deque
from PIL import Image

SRC = 'baseball-art'
OUT = 'baseball-anim'
os.makedirs(OUT, exist_ok=True)

NAMES = {
    'ChatGPT Image Jul 3, 2026, 05_13_57 PM (1).png': 'windup',
    'ChatGPT Image Jul 3, 2026, 05_13_57 PM (2).png': 'followthrough',
    'ChatGPT Image Jul 3, 2026, 05_13_58 PM (3).png': 'stance1',
    'ChatGPT Image Jul 3, 2026, 05_13_58 PM (4).png': 'stance2',
    'ChatGPT Image Jul 3, 2026, 05_13_59 PM (5).png': 'load',
    'ChatGPT Image Jul 3, 2026, 05_13_59 PM (6).png': 'release',
    'ChatGPT Image Jul 3, 2026, 05_13_59 PM (7).png': 'swingfollow',
    'ChatGPT Image Jul 3, 2026, 05_14_00 PM (8).png': 'contact',
    'ChatGPT Image Jul 3, 2026, 05_16_19 PM.png': 'bb-ball',
}

LO, HI = 45, 225  # luminance ramp: <=LO fully opaque, >=HI fully transparent

def to_silhouette(im, white=False):
    im = im.convert('RGB')
    px = im.load()
    w, h = im.size
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    op = out.load()
    fill = (255, 255, 255) if white else (0, 0, 0)
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            lum = (299*r + 587*g + 114*b) // 1000
            if lum >= HI:
                a = 0
            elif lum <= LO:
                a = 255
            else:
                a = int(255 * (HI - lum) / (HI - LO))
            op[x, y] = (*fill, a)
    return out

def largest_component_only(im, thresh=128):
    """Zero out every opaque blob except the biggest (drops the loose baked-in ball)."""
    w, h = im.size
    px = im.load()
    seen = [[False]*w for _ in range(h)]
    comps = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or px[sx, sy][3] < thresh:
                continue
            q = deque([(sx, sy)]); seen[sy][sx] = True; comp = []
            while q:
                x, y = q.popleft(); comp.append((x, y))
                for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny][3] >= thresh:
                        seen[ny][nx] = True; q.append((nx, ny))
            comps.append(comp)
    if len(comps) <= 1:
        return im
    comps.sort(key=len, reverse=True)
    for comp in comps[1:]:
        for x, y in comp:
            px[x, y] = (0, 0, 0, 0)
    print(f'  release: kept {len(comps[0])}px blob, erased {len(comps)-1} stray blob(s)')
    return im

def autocrop(im, pad=6):
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    return im.crop((max(0,l-pad), max(0,t-pad), min(im.size[0],r+pad), min(im.size[1],b+pad)))

for raw, name in NAMES.items():
    p = os.path.join(SRC, raw)
    if not os.path.exists(p):
        print('MISSING', raw); continue
    if name == 'bb-ball':
        sil = to_silhouette(Image.open(p), white=True)
        sil = autocrop(sil)
        sil = sil.resize((240, 240), Image.LANCZOS)
    else:
        sil = to_silhouette(Image.open(p))
        sil = sil.resize((sil.size[0]//2, sil.size[1]//2), Image.LANCZOS)  # 543x724 shared canvas
        if name == 'release':
            sil = largest_component_only(sil)
    sil.save(os.path.join(OUT, name + '.png'))
    print(f'{name:14s} {sil.size} <- {raw[:40]}')
print('done ->', OUT)
