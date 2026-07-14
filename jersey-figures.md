# Illustrated Jersey Figures — process + point map

The pitcher game (`pitcher.html`) now uses illustrated per-team jersey figures instead of the old
flat tinted silhouette. This doc packages the repeatable process and maps the points for every other
figure so the rollout is mechanical.

## The pipeline (repeatable)

1. **Bake assets** — `python bake-figure.py <figure>` reads `proto-assets.json` and writes, in repo root:
   - `jersey-<figure>-base.png` — the illustrated figure, background removed.
   - `jersey-<figure>-<garment>.png` — one CSS-mask per garment region.
   Cutout = UNION of two border-flood fills (base charcoal-bg ∪ segmap white-bg) so **dark shoes AND
   white socks both survive** (a plain color key ate the shoes / punched holes in the nose — see git).
   Masks are hard-edged (no blur — blur bled team color onto skin) + speck-filtered (drop floating
   islands). All bases come out **900×1205**.

2. **Anchor points** — `python figure-anchors.py [figure]` prints each garment region's mask centroid
   in figure-% and **stage-%**. The stage-% value is the node anchor (`ax`,`ay`) for the slot mapped to
   that region. Validated: computed pitcher anchors match the hand-tuned ones Matt approved (±1%).

3. **Graft into the game page** (all identical since every base is 900×1205):
   - CSS: `.stage{ aspect-ratio:7/5 }`, add
     `#figbox{ position:absolute; top:0; bottom:0; left:50%; transform:translateX(-50%); height:100%; aspect-ratio:900/1205; }`,
     `.stage #figure{ position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }`,
     `.seg{ …; mix-blend-mode:multiply; }`, `#capLogo{ position:absolute; height:auto; z-index:5; display:none; }`.
     Drop the old `.figure` mask rule + `.shade`.
   - HTML: wrap `<img id="figure">` + `<div id="segments">` + `<img id="capLogo">` in `<div id="figbox">`.
   - JS: `FIG_REGIONS` (garment list), `REGION_SLOT` (garment→slot key), `SLOT_REGION` (reverse),
     `buildSegments()` sets the base src + one `.seg` per region (masked by `jersey-<fig>-<region>.png`)
     + positions the cap logo, `updateFigure()` paints each region `teamColor(slot's team)` and sets the
     cap-logo src from `TEAM_IDS[capSlot team]`. Assign fade uses `segEls[SLOT_REGION[slotKey]]`.
   - `SLOTS`: set each slot's `ax`,`ay` to the stage-% anchor (region centroid for mapped slots;
     estimate near the body part for the 2-4 unmapped slots). Keep boxes in the gutters (`lx`≈11 left /
     ≈89 right, spread `ly`).

4. **Verify** — assign a few teams, confirm regions color + cap logo swaps, scroll the whole figure,
   nudge any anchor that misses (e.g. pitcher Stamina moved off the leg-gap onto the thigh).

Card-thumbnail figures (`FIG_CONFIG`, HOF gallery) stay on the old masks — separate, untouched.

## Region → slot mappings  (⚠️ PROPOSED — review before wiring)

Philosophy (same as the pitcher call Matt approved): **headwear → the mental/IQ slot + team logo,
jersey → Frame, sleeves → arm skills, pants/shorts/socks → leg skills, gloves → hands skills.**
Games with few garments show fewer team colors; leftover slots keep their node but color no region
(exactly like pitcher Break/Strikeout). "logo" = that region wears the team cap/helmet insignia.

### pitcher (SHIPPED)
cap←Clutch·logo · jersey←Frame · lsleeve←Velocity · rsleeve←Command · lpant←Stamina · rpant←Ground Ball · glove←Defense. no-region: Break, Strikeout.

### batter — helmet,jersey,lsleeve,rsleeve,lpant,rpant,gloves
helmet←Clutch·logo · jersey←Frame · gloves←Contact · lsleeve←Power · rsleeve←Vision · lpant←Speed · rpant←Defense. no-region: Discipline.

### basketball — jersey,lshort,rshort,shoes  (no headwear → no logo)
jersey←Frame · lshort←Finishing · rshort←Rebounding · shoes←Speed. no-region: 3-Pointer, Dribble, Playmaking, Defense, Clutch. *(only 4 team zones — tank+shorts+shoes is all there is)*

### striker — jersey,lsleeve,rsleeve,shorts,socks  (no logo)
jersey←Frame · lsleeve←Passing · rsleeve←Physical · shorts←Shot Power · socks←Pace. no-region: Finishing, Dribbling, Heading, Clutch.

### keeper — jersey,gloves,shorts,socks  (no logo)
jersey←Frame · gloves←Handling · shorts←Command · socks←Agility. no-region: Diving, Reflexes, Distribution, Positioning, Clutch.

### hockey — helmet,jersey,lsleeve,rsleeve,pants,socks,gloves
helmet←Hockey IQ·logo · jersey←Frame · lsleeve←Shot Power · rsleeve←Physicality · pants←Motor · socks←Defense · gloves←Playmaking. no-region: Sniping, Clutch.

### footballqb — helmet,jersey,lsleeve,rsleeve,lpant,rpant
helmet←Football IQ·logo · jersey←Frame · lsleeve←Arm Power · rsleeve←Deep Ball · lpant←Wheels · rpant←On the Run. no-region: Short Accuracy, Mid Accuracy.

### footballrb — helmet,jersey,lsleeve,rsleeve,lpant,rpant,gloves
helmet←Vision·logo · jersey←Frame · gloves←Catching · lsleeve←Power · rsleeve←Break Tackle · lpant←Speed · rpant←Burst. no-region: Ball Security, Elusiveness.

### footballwr — helmet,jersey,lsleeve,rsleeve,lpant,rpant,gloves
helmet←Routes·logo · jersey←Frame · gloves←Hands · lsleeve←Release · rsleeve←Spectacular · lpant←Speed · rpant←Agility. no-region: In Traffic, Leaping.

### hockeygoalie — mask,jersey,lpad,rpad,blocker,trapper  (no game page yet — baked + mapped for future)

## Anchor points (stage-%, from region centroids — paste into each game's SLOTS ax/ay)

    batter     helmet(47.9,13.6) jersey(50.3,40.3) gloves(38.2,26.2) lsleeve(40.5,33.5) rsleeve(53.4,28.3) lpant(43.7,61.0) rpant(57.1,58.3)
    basketball jersey(50.1,33.2) lshort(46.4,55.7) rshort(53.6,56.0) shoes(57.4,89.1)
    striker    jersey(50.8,34.3) lsleeve(43.4,28.9) rsleeve(58.1,28.9) shorts(50.2,54.4) socks(43.4,69.3)
    keeper     jersey(50.7,35.4) gloves(29.9,44.0) shorts(51.2,55.9) socks(64.6,76.1)
    hockey     helmet(51.9,13.5) jersey(53.0,34.6) lsleeve(44.7,41.1) rsleeve(63.1,30.3) pants(58.9,57.3) socks(63.6,70.9) gloves(49.5,58.2)
    footballqb helmet(49.1,15.4) jersey(49.8,34.0) lsleeve(40.8,29.0) rsleeve(58.0,26.7) lpant(42.2,63.8) rpant(58.7,62.2)
    footballrb helmet(51.9,17.5) jersey(52.4,33.4) gloves(59.4,44.1) lsleeve(42.4,29.3) rsleeve(62.3,28.4) lpant(45.3,59.7) rpant(55.8,64.1)
    footballwr helmet(52.4,16.4) jersey(51.4,34.5) gloves(36.7,54.8) lsleeve(42.5,28.5) rsleeve(61.2,28.9) lpant(44.7,58.9) rpant(58.2,59.2)

Note: split regions (two gloves / socks on spread legs) anchor on the LARGEST blob, so the pin
lands on one glove/leg instead of the empty gap between them (figure-anchors.py handles this).

Cap-logo placements already dialed in (drag tool) live in `proto-assets.json` `logo` for
pitcher/batter/hockey/hockeygoalie/footballqb/footballwr/footballrb.
