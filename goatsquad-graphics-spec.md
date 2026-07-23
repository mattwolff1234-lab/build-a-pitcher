# GOAT Squad — Graphics Upgrade Spec (map v2 + shop page)

Art direction (applies to everything): dark broadcast-HUD world — near-black navy `#05070f`,
panel navy `#0b1220`, cyan `#19c6ff` + orange `#ff7a18` accents, gold `#ffce3a` for money,
legend purple `#a366ff`. Painted-neon "arcade poster" style, crisp rim lighting, NO text baked
into images (the game renders text). Every asset is a PNG with transparency unless noted.
Generation prompts for every asset live in `goatsquad-art-prompts.md` — generate, drop files in
`/squad-art/`, then wire per the notes below.

## 1. Map v2 — "the road trip poster"

Goal: the map reads like a world in a real game, not dots on a grid.

- **Backdrop image per act**: base act = a stylized night-USA road map (city glows, highways);
  overtime act = Earth-from-orbit with routes arcing over the planet (the space theme + flags
  shipped 2026-07-24 — the backdrop image replaces the CSS gradient).
  Wire: `.mapBox { background:url(/squad-art/map-usa.png) center/cover }`, `#scrMap.ot .mapBox`
  swaps to `map-earth.png`. One per sport is NOT needed — sport-neutral backdrops + sport accent.
- **City nodes**: replace the plain circles with a "venue puck" frame image (`node-frame.png`,
  rendered under the team crest via ::before or a wrapping div) — states: normal, current
  (orange glow ring), beaten (gold, add `node-beaten-ribbon.png` check overlay), elite (hazard
  chevrons), shop (market-stall puck), finale (crown throne puck, larger).
- **The traveler**: replace ✈️/🚀 emoji with sprite images (`travel-bus.png` base act — a team
  bus reads "road trip" better than a plane at this scale — and `travel-rocket.png` overtime).
  Wire: `#plane` becomes an `<img>`; GSAP tweens unchanged.
- **Route lines**: keep SVG (crisp + cheap), restyle: beaten road = solid gold with subtle
  glow filter, live choice = animated dash offset (CSS `stroke-dashoffset` animation, gated by
  prefers-reduced-motion), future = faint. No image needed.
- Keep: clamp sizing, decluttered line logic, fork↔node hover linkage, scroll cue.

## 2. Shop v2 — its own page ("the pro shop")

Goal: a real game-shop screen: a shelf you browse, not a list you read.

- **New screen `#scrShop`** (a real `section.scr`, replacing the inline `#shopBox` render at
  shop stops; `renderStopCard`'s shop branch navigates `show('scrShop')`, FLY ON returns).
- **Layout**: full-bleed shop interior backdrop (`shop-interior.png` per sport — a neon
  team-store / dugout store / locker-room shop). Items sit ON SHELVES: a 3-per-row grid where
  each item = its art (`item-<id>.png`, ~256px) on a shelf strip (`shop-shelf.png` tiling under
  each row). Tap an item → detail card slides up (name, plain-words description, ONE-USE tag,
  price button) — the buy flow and all `buyItem()` logic unchanged.
- **Shopkeeper**: a sport-coded mascot goat (`shopkeep-<sport>.png`, ~1/3 screen height, right
  side, desktop only) with a speech bubble cycling the interest hint + flavor lines.
- **Cap space**: gold coin stack art (`coin-stack.png`) beside the live cash counter, top bar.
- **Relic wheel / FA wheel** stay as reels but get card-back art (`relic-cardback.png`).
- Phone: shelf grid 2-per-row, shopkeeper hidden, detail card = bottom sheet.
- Determinism: zero engine change — presentation swap only; item ids/prices/effects untouched.

## 3. Everything-else de-emoji (wire-up notes)

- Relics (20/sport), shop items, modifiers, manager cards, banners: each gets a 128px icon;
  engine renders `it.img || it.icon` (one-line fallback change per render site) — so art can
  land incrementally, emoji stays as fallback.
- Boss intro: full-bleed splash per FICTIONAL team (Neon City Flight, The Pantheon, Midnight
  Nine, Diamond Pantheon) shown behind `.bossBar` on entry; real teams keep crests/flags.
- Launch cinematic: swap the 🚀 emoji for `travel-rocket.png` + `earth-horizon.png` backdrop.

Rollout: generate art → drop in `/squad-art/` → wire map v2 (small CSS/JS) → build `#scrShop`
(one session) → de-emoji pass (mechanical). Ads: layout changes on monetized routes → tell
Louis again after shipping.
