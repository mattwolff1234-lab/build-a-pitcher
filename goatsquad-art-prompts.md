# GOAT Squad — ChatGPT image prompts for every asset

Paste the STYLE BLOCK first in every request, then the asset prompt. Ask for PNG,
transparent background unless the prompt says "full-bleed". Generate at 1024px+, we downscale.

**STYLE BLOCK (prepend to every prompt):**
> Stylized dark sports-arcade game art. Near-black navy background world (#05070f), neon cyan
> (#19c6ff) and burnt orange (#ff7a18) accent lighting, gold (#ffce3a) for anything money or
> victory, purple (#a366ff) for mythic things. Painted, slightly gritty poster style with crisp
> rim light — NOT flat vector, NOT photoreal, no visible brand logos, ABSOLUTELY NO TEXT OR
> LETTERS in the image. Transparent background unless told otherwise.

## Maps & travel
- **map-usa.png** (full-bleed 1600×1000): A stylized night map of the continental USA seen from
  high above, glowing city clusters connected by faint highway light-trails, dark navy ocean,
  subtle grid-paper texture, room for UI markers on top — low contrast, nothing brighter than
  the city glows.
- **map-earth.png** (full-bleed 1600×1000): Earth from low orbit at night, city lights on the
  dark side, thin cyan orbital route arcs circling the planet, star field behind, deep-space
  vignette at the edges — calm, low contrast, a game map backdrop not a hero image.
- **travel-bus.png**: A chunky stylized team tour bus seen from a 3/4 top-down angle, dark navy
  body with cyan underglow and orange stripe, headlights on, slight motion feel — mascot-free.
- **travel-rocket.png**: A compact retro-futuristic rocket, navy hull with orange flame trail
  and cyan window glow, angled 45° upward in flight.
- **node-frame.png**: A circular arena "puck" seen slightly from above — a ring of stadium
  lights around a dark disc, cyan rim glow, empty center for a crest to sit in.
- **node-beaten-ribbon.png**: A small gold laurel-and-check ribbon overlay for a beaten venue.
- **node-elite-frame.png**: The same circular puck but with orange-black hazard chevrons around
  the ring and a hotter glow.
- **node-shop.png**: A tiny neon market stall / merch stand on a circular puck, gold awning glow.
- **node-finale.png**: A larger circular puck with a gold crown floating above a dark throne-like
  arena, god-rays, purple-gold glow.

## Shop
- **shop-interior.png ×3** (full-bleed 1600×1000, one per sport): A moody neon pro-shop interior
  — dark shelves along the walls, a glass counter, hanging jerseys with no logos, sport gear
  (basketballs / baseball bats and gloves / footballs and helmets) as set dressing, cyan-orange
  shelf lighting, empty shelf space center-frame for UI items.
- **shop-shelf.png** (wide strip, tileable): A dark wooden-and-steel shop shelf strip lit from
  above by a thin cyan light bar, subtle scratches, seen straight-on.
- **shopkeep-nba.png / -mlb.png / -nfl.png**: A confident cartoon goat shopkeeper in an apron,
  leaning on a counter — holding a basketball / wearing a backwards baseball cap with a bat on
  the shoulder / wearing a whistle with a football under one arm. Warm gold key light, friendly
  smirk, waist-up.
- **coin-stack.png**: A short stack of thick gold coins with a soft gold glow, one coin leaning.
- **relic-cardback.png**: A trading-card back — dark navy with a purple arcane goat-skull motif
  and thin gold filigree border, gem in the center.

## Shop items (128–256px icons, one prompt each)
- **item-insurance.png**: A glowing cyan life-preserver ring wrapped around a small hourglass.
- **item-camp.png**: A gold dumbbell with an upward arrow of orange energy.
- **item-prime.png**: A golden star bursting out of an open trading-card sleeve.
- **item-fa.png**: A spinning prize wheel with a silhouetted player card on the pointer.
- **item-relicwheel.png**: A purple prize wheel with gem-studded slots, arcane glow.
- **item-token2.png**: A brass "second chance" token with two arrows chasing each other.
- **item-carousel.png**: A clipboard with a whistle on a lanyard, swapping-arrows motif.
- **item-home.png**: A house-shaped arena deed scroll with a gold wax seal.
- **item-draft.png**: A rookie card sprouting like a plant from a gym bag, green shoot of light.

## Relics (128px icons — generate per name, purple-gold treatment)
One prompt template: "A small mystical sports relic icon: **{X}**, purple aura, gold accents,
floating with tiny sparks." Generate {X} for each relic in the three configs, e.g.: a piggy bank
made of arena concrete (Piggy Bank) · a bronze goat hoof on a chain (Prove It) · a golden egg
with hairline cracks glowing (The Egg) · a bandwagon wheel with flames (Bandwagon) · a tiny
scale weighing a coin against a basketball (Deep Pockets) · a two-faced theater mask, one calm
one furious (Mood Swings) · a mirror shard reflecting a different jersey (Copycat) · a folded
poaching net with a whistle (Poacher) · a rental keycard with a champion ring attached (Ring
Chaser). (Full list: `relics` arrays in goatsquad-*.json — one image per `id`, named
`relic-<id>.png`.)

## Modifiers, cards, banners
- **mod-scorched.png**: A no-symbol over a ghostly purple jersey, embers.
- **mod-benchmob.png**: Six raised fists in team warmups, one holding a towel, orange rim light.
- **mod-headstart.png**: A gift box cracked open with purple relic light escaping.
- **mod-ironfive.png / mod-ironeleven.png**: A padlock fused onto a lineup card, iron texture.
- **mod-underdogs.png**: A small scrappy dog in an oversized jersey, determined, cyan rim light.
- **mgr-card-elite.png / -good.png / -basic.png / -bad.png**: A coach's laminated play-card at
  four rarities — holo gold / silver / plain navy / coffee-stained and torn.
- **banner-1..5.png**: A hanging championship rafter banner, dark navy with gold trim, blank
  center, progressively more ornate per level (5 = jeweled + purple flames).

## Boss splashes (full-bleed 1200×800, fictional teams only)
- **boss-neon.png**: A blacklight basketball court at midnight, five silhouetted players with
  neon-tube outlines standing in fog, ultraviolet palette.
- **boss-pantheon.png**: Colossal marble statues of basketball players in god poses inside a
  storm-lit temple arena, purple lightning, gold dust.
- **boss-midnight9.png**: Nine baseball silhouettes in a moonlit cornfield diamond, fireflies,
  eerie calm.
- **boss-diamondpantheon.png**: A baseball cathedral of crystal, giant gem-cut players on
  pedestals, prismatic light.

## Misc HUD
- **launch-earth.png** (full-bleed): Earth's horizon from orbit at night, sunrise sliver, for
  the overtime launch cinematic backdrop.
- **cash-float.png**: A crisp gold dollar-chip with motion streaks (replaces the +$ float).
- **pity-legend-glow.png**: A purple card-shaped aura burst for legend landings.
- **trophy-champion.png / trophy-immortal.png**: A gold goat-horned championship trophy · the
  same trophy recast in starfield glass with purple nebula inside.
