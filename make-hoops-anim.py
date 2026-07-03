# Process raw ChatGPT basketball silhouettes (black-on-white) into transparent,
# team-tintable silhouette PNGs for the Hoops 1v1 animation.
#  - white background -> transparent (alpha ramp from luminance)
#  - RGB forced to black so the shape works as a CSS mask OR renders directly
#  - player/hoop kept on their shared 1086x1448 canvas (downscaled 50%) so every
#    pose shares the same scale + ground anchor (no per-pose crop = no jitter)
#  - ball autocropped + squared
# Output: hoops-anim/<posename>.png
import os
from PIL import Image

SRC = 'hoops-art'
OUT = 'hoops-anim'
os.makedirs(OUT, exist_ok=True)

# raw filename -> clean pose name (from the visual catalog)
NAMES = {
    '46bcf089-44c8-4fd8-98e7-81ad178cdff1.png': 'hoop',
    'ChatGPT Image Jun 30, 2026, 11_46_26 PM (1).png': 'drive1',
    'ChatGPT Image Jun 30, 2026, 11_46_26 PM (2).png': 'dribble1',
    'ChatGPT Image Jun 30, 2026, 11_46_27 PM (3).png': 'lowdribble1',
    'ChatGPT Image Jun 30, 2026, 11_46_27 PM (4).png': 'drive2',
    'ChatGPT Image Jun 30, 2026, 11_46_27 PM (5).png': 'drive3',
    'ChatGPT Image Jun 30, 2026, 11_46_27 PM (6).png': 'lowdribble2',
    'ChatGPT Image Jun 30, 2026, 11_46_28 PM (10).png': 'def1',
    'ChatGPT Image Jun 30, 2026, 11_46_28 PM (7).png': 'def2',
    'ChatGPT Image Jun 30, 2026, 11_46_28 PM (8).png': 'idle1',
    'ChatGPT Image Jun 30, 2026, 11_46_28 PM (9).png': 'def3',
    'ChatGPT Image Jun 30, 2026, 11_46_39 PM (1).png': 'dribble2',
    'ChatGPT Image Jun 30, 2026, 11_46_39 PM (2).png': 'drive4',
    'ChatGPT Image Jun 30, 2026, 11_46_40 PM (3).png': 'shoot1',
    'ChatGPT Image Jun 30, 2026, 11_46_40 PM (4).png': 'shoot2',
    'ChatGPT Image Jun 30, 2026, 11_46_40 PM (5).png': 'shoot3',
    'ChatGPT Image Jun 30, 2026, 11_46_40 PM (6).png': 'three1',
    'ChatGPT Image Jun 30, 2026, 11_46_41 PM (7).png': 'pass1',
    'ChatGPT Image Jun 30, 2026, 11_46_41 PM (8).png': 'pass2',
    'ChatGPT Image Jun 30, 2026, 11_46_46 PM (1).png': 'dribble3',
    'ChatGPT Image Jun 30, 2026, 11_46_47 PM (2).png': 'sprint1',
    'ChatGPT Image Jun 30, 2026, 11_46_47 PM (3).png': 'cross1',
    'ChatGPT Image Jun 30, 2026, 11_46_47 PM (4).png': 'cross2',
    'ChatGPT Image Jun 30, 2026, 11_46_47 PM (5).png': 'dunk1',
    'ChatGPT Image Jun 30, 2026, 11_48_47 PM.png': 'ball',
}

LO, HI = 45, 225  # luminance ramp: <=LO fully opaque, >=HI fully transparent

def to_silhouette(im):
    im = im.convert('RGB')
    px = im.load()
    w, h = im.size
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    op = out.load()
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
            op[x, y] = (0, 0, 0, a)
    return out

def autocrop(im, pad=6):
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l-pad); t = max(0, t-pad)
    r = min(im.size[0], r+pad); b = min(im.size[1], b+pad)
    return im.crop((l, t, r, b))

for raw, name in NAMES.items():
    p = os.path.join(SRC, raw)
    if not os.path.exists(p):
        print('MISSING', raw); continue
    sil = to_silhouette(Image.open(p))
    if name == 'ball':
        sil = autocrop(sil)
        s = 240
        sil = sil.resize((s, s), Image.LANCZOS)
    else:
        # keep shared canvas, downscale 50% -> 543x724
        sil = sil.resize((sil.size[0]//2, sil.size[1]//2), Image.LANCZOS)
    dst = os.path.join(OUT, name + '.png')
    sil.save(dst)
    print(f'{name:14s} {sil.size} <- {raw[:32]}')

print('done ->', OUT)
