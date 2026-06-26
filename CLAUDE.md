# Pitching Lab

> Repo/Vercel project are still named `build-a-pitcher` internally (renaming risks breaking the
> link/deploys). **Player-facing brand is "Pitching Lab."**

## What this is
A browser game: spin a horizontal slot-machine reel of MLB pitchers, land on a random one, and
assign their rating to one of 9 body-mapped attribute slots on a pitcher figure. Fill all 9 →
weighted OVR → name your pitcher, pick a team, and **simulate their full career** → post to a
global/daily leaderboard.

- **Live:** https://pitchinglab.pitchergami.com (also `build-a-pitcher.vercel.app`)
- **Repo:** github.com/mattwolff1234-lab/build-a-pitcher (push to `main` → Vercel auto-deploys)

## NOT part of PitcherGami
Separate project from PitcherGami (~/pitcher-scorigami) and Perfect Season. Shared audience
(baseball fans), can cross-link, but separate codebase/db/deploy. Lives as a subdomain of
pitchergami.com purely for the "family of games" cross-promo; nothing is shared at runtime.

---

## Current state (shipped)

### Core loop
1. **Spin** the reel → it eases to a stop on a weighted-random pitcher (motion blur scales with
   reel speed; retro ticker SFX pitches down as it slows; cinematic reveal: light sweep + card pop).
2. **Land** → a card shows the pitcher; eligible body parts glow with a `+rating` preview.
3. **Assign** by tapping a body part → headshot flies into the slot, the body region washes in that
   player's team jersey color, OVR gauge counts up.
4. Repeat for all 9 slots → **finish** screen → name + pick team + **Simulate Career** → leaderboard.

### Power-ups (1 each per run)
- **Re-spin** — discard and spin again.
- **Boost** — upgrade the landed pitcher to their "Prime" (special-edition) version, then assign.
- **Snag** — take the pitcher one card to the **left or right** of where you landed.
- These stack on one slot (e.g. snag a neighbor, then boost that neighbor).

### The 9 slots (body-mapped on the figure)
| Slot | Source field | Body part | Notes |
|---|---|---|---|
| Velocity | `pitch_velocity` | Bicep | |
| Break | `pitch_movement` | Wrist | |
| Strikeout | `k_per_bf` | Forearm | |
| Ground Ball | `hr_per_bf` | Ball (hand) | "keep ball in park" (HR suppression) |
| Command | `pitch_control` | Shoulder (throwing) | walk avoidance / location |
| Clutch | `pitching_clutch` | Head | |
| Defense | `fielding_ability` | Glove | |
| Frame | **height** (`heightIn`) | Body/torso | shows the height string (e.g. `6'4"`), taller = higher rating via `heightToRating` |
| Stamina | `stamina` | Legs | |

> Note: **Control/BB** (`bb_per_bf`) is the only old slot still removed — its field stays in
> `pitchers.json` but is unused (Command/`pitch_control` covers walk skill).

### Weighted OVR
`weightedOvr` = weighted avg of the 9 slot values: **1.2×** Strikeout, Ground Ball & Command (the
three true outcomes — K, HR, BB), **1.1×** Velocity/Break/Stamina/Clutch, **1.0×** Defense/Frame.
So slot placement is strategic.

### Tiers (border + glow colors)
Grey ≤64 · Bronze 65–74 · Silver 75–79 · Gold 80–84 · Diamond 85+ · **Legend = purple** (retired greats).

### The figure (2.5D, NOT real 3D)
Flat transparent silhouette `pitcher-figure.png` split into 9 feathered body-region masks
(`seg-<slotKey>.png`, softmax membership so colors blend, no hard seams). Each assigned region is
tinted to the player's team jersey color + `jersey-fabric.png` texture (overlay blend) + one global
soft-light `.shade`. Cursor-driven perspective tilt. **Per-body-part team jerseys require these flat
recolorable masks — that's why it's 2.5D, not a rigged 3D model.** Regenerate masks with the PIL
snippet in git history if anchors change (anchors live in the `SLOTS` array `ax/ay`).

### Look & feel
Broadcast/sports-HUD: Oswald (display/numbers) + Inter, animated stadium background (drifting
light blobs, scrolling perspective grid, scanlines), beveled HUD panels with cyan corner brackets,
OVR gauge ring + 9-pip draft tracker. All motion via **GSAP (CDN)**.

### Sound
Synthesized with the Web Audio API (no asset files): retro ticker, tier chimes (gold / diamond /
legend glory fanfare), Prime upgrade sweep, assign blip, whoosh, completion flourish. 🔊 mute toggle
in the header. Audio unlocks on first click (autoplay policy).

### Leaderboard
Reachable anytime from the ☰ menu (and auto-opens after you submit). **Global (all-time)** +
**Today** tabs, **top 200**, top-3 medal coloring. After submitting, your entry is **pinned at the
top with your exact rank even if you're outside the top 200**.

---

## Data source & pipeline
Attribute ratings (1–99) from the MLB The Show API: `mlb26.theshow.com/apis/items.json`
(+ mlb25/24/23/22/21 for historical). Free, no auth, JSON. **Bump the current-season source to the
new `mlbNN` host each spring** when the next game ships (both `fetch-data.js` and `fetch-batters.js`).

- **`node fetch-data.js`** bakes `pitchers.json`:
  - Pool = **`series === "Live"` only** (real-world-accurate; special editions are inflated).
  - **SP + CP only** (relief pitchers `display_position === 'RP'` are dropped; legends exempt).
  - 2026 (current) = all tiers; 2025–2021 = **gold+ (OVR ≥ 80) historical** versions, tagged with year.
  - **Prime** map = highest-OVR special-edition card per player (Boost power-up). Don't say "MLB The
    Show" in the UI — call them "Prime."
  - **Legends** = retired greats (special card, no current Live card, OVR ≥ 85). Excluded by NAME if
    they have any prospect/showcase card (`PROSPECT_SERIES`, incl. Spring Breakout) — so hyped
    prospects like Konnor Griffin land in the Live pool (boostable), not as purple legends.
  - **Headshots** = MLB official (`midfield.mlbstatic.com/.../spots/180`) via name→MLBAM-id mapping
    (accent-stripped + people-search fallback). `node fetch-wiki-headshots.js` fills remaining ones
    from Wikipedia **with identity verification** (last name + first/nickname + "is a pitcher").
    ~21 deep prospects have no photo → neutral silhouette.
  - Frame needs `height`/`heightIn` (parsed from the API `height` string).

Re-run both scripts after any data refresh (the wiki script patches `img` fields onto `pitchers.json`,
so run it **after** `fetch-data.js`).

## Tech stack (actual)
- **Single static `index.html`**, no build step, no framework. GSAP via CDN. Data baked in
  `pitchers.json`; figure/segment/fabric PNGs are assets.
- **Leaderboard:** `api/score.js` — a **Vercel serverless function** (CommonJS; `package.json` has no
  `type:module` so the CJS build scripts keep working) → **Neon Postgres** via the Vercel↔Neon
  integration. Table `scores(id, name, ovr, build jsonb, created_at)` auto-creates on first request.
  Connection string is read prefix-agnostically (`DATABASE_URL`/`POSTGRES_URL`/`STORAGE_*`/ scan).
  - `GET /api/score?scope=global|daily&limit=200&me=<id>` → top-N rows + `me:{rank,name,ovr}` (the
    submitter's place in that scope, even if outside the top N). `POST /api/score {name, ovr, build}`
    → `{id, globalRank}`. `build` jsonb stores `{slots, career}`.
  - Global = by ovr; Daily = `created_at >= date_trunc('day', now())` (UTC).
- **Deploy:** Vercel (static + functions). Push to `main` auto-deploys. Neon env vars are
  **Sensitive** (can't be pulled to CLI). Domain `pitchinglab.pitchergami.com` (Vercel-managed DNS).

### Known caveat — anti-cheat
Scores are submitted from the browser; the server only clamps `ovr` 1–99 and name length, so the OVR
is currently trust-the-client. Harden later by recomputing OVR server-side from the submitted `build`
(re-implement `WEIGHTS` + `heightToRating` in `api/score.js`).

---

## Career simulation (shipped)

After the draft: **name the pitcher, pick a team, and "Simulate Career"** → a season-by-season
playthrough → verdict + a shareable career card. All in `index.html` (pure JS). The sim is
**deterministic — seeded from the build** (slot values + player names), so the same pitcher always
produces the same career (fair/shareable; not currently re-rollable).

### Engine — `simulateCareer(filled, finalOvr)`
Loops age 23 → retirement. Per-season rate stats come from the slot ratings (all tuned — change the
constants in `simulateCareer`, then sanity-check by extracting the inline `<script>` and running it
under Node):
- **K/9** ← Strikeout (dominant): `-0.5 + strikeout*0.145 + small velo/break`. ~97 rating ≈ **1.5 K/IP**
  (≈13.5 K/9).
- **BB/9** ← Command inverted. **HR/9** ← Ground Ball inverted. **BABIP** ← Defense/Break/Ground Ball.
- **Innings/year AND career length** ← **Stamina** (primary, + Frame). Low stamina → bullpen role,
  fewer innings, shorter career. So **a huge career K total requires high Strikeout AND high Stamina**
  (a K-specialist with no stamina tops out ~900 career K).
- **ERA** from a FIP core (`(13·HR + 3·BB − 2·K)/IP + 2.56`) adjusted by Clutch (strand) + BABIP.
- **WAR** ≈ (4.10−ERA)·(IP/200)·… **Wins** ← ERA + IP + random team-quality. **Rings/playoffs** ← Clutch.

### Balance (tuned — re-verify if you touch any formula)
- **Cy Young** = rare, competitive *probability* (you must beat the whole league): 90 OVR ≈ 1.3
  career Cy, 93+ get a real shot at multiples (capped sane via `cyElite`), 80 ≈ 0.
- **Hall of Fame** (`hallOfFame`): `hofScore` (WAR + hardware + milestones) ≥ 80, or career WAR ≥ 80.
  ~85 OVR ≈ 70% HOF, 80 ≈ 0–5%, below ~78 ≈ never.
- **Career K** realistic (career K/9 ~6.7–9; only durable elite builds approach the 3,000-K club).
  The strikeout/Cy/K-milestone thresholds are anchored to these K levels — **bump them together** if
  K scaling changes.

### Verdict tiers — `careerTier(t, ovr)`
🏆 **Hall of Fame** (earned in the sim; shows a vote-% + "first ballot" line) · **Hall of Pretty Good**
(OVR 80–85) · **Hall of Mid** (72–79) · **Hall of Not Good** (≤71).

### Playthrough UX (in the done panel)
- **Team pick** (all 30; `TEAM_NAMES`) tints the season rows + the card.
- **Headlines feed** beside the log (`seasonHeadlines`): debut, Cy Young, no-hitters/perfect games,
  World Series, league titles, injuries, milestone crossings, retirement.
- **Live ticker** — K / Wins / WAR climb each season; flash + headline on milestone crossings
  (1,000–5,000 K, 100/200/300 W).
- **HOF vote reveal**, **trophy case** (Cy / rings / All-Stars / no-nos / titles), and a **shareable
  career card** (`buildCard` — team-colored, full career line, verdict; built to screenshot).
- Season rows are labeled by **calendar year starting '26**; badges (CY / ★ / ERA Leader / K Title /
  NO-NO / PG / 💍) sit on their own line so the stat line never truncates. Log + headlines stack on
  phones (≤720px).

### Still open / ideas
- Leaderboard still ranks by **draft OVR**, not career → could add a career-score board (and a
  server-side re-sim would also close the anti-cheat hole). Optional **re-sim** toggle. Trades / free
  agency across teams. Player comp ("most similar to …"). Auto nickname from the build.

---

## Batting Lab (sibling game — LIVE)
Same game as Pitching Lab, translated to **hitters**. Single file `build-a-batter.html` (clone of
`index.html`). **Deployed** alongside the pitcher game (same Vercel project): live at
`pitchinglab.pitchergami.com/build-a-batter.html`, linked from the pitcher header via the
`#buildTab` "🛠️ Build a Batter" button (`index.html`).

- **Data:** `node fetch-batters.js` (clone of `fetch-data.js`, `is_hitter===true`) → `batters.json`
  (`{pool, prime, legends}`). `contact`/`power` = L/R averages and **can exceed 99** (Judge 108/114);
  this is intentional — ratings are NOT clamped (slotNumeric/slotDisplay pass raw values, like the
  pitcher game), so over-99 cards get the full OVR + slower-aging benefit.
- **Prime/Boost:** highest-OVR special card per player, **plus** synthesized Primes (+6) for MVP /
  Silver Slugger / Hank Aaron winners who lacked one (`fetch-batters.js` pulls the MLB awards API).
  Boost keeps the higher of Live-vs-Prime per stat, so it can never downgrade a rating.
- **Verdict:** Compiler bonus — counting-stat milestones (HR/H/RBI clubs) nudge the OVR-based verdict
  tier up, with a "🧮 Hall of Compilers" tier for absurd counting lines (`careerTier`/`milestoneBonus`).
- **7 slots** (down from 9 — no Fielding/Arm/Durability): Vision=`plate_vision` (Eyes),
  Power=`power` (Bat), Contact=`contact` (Hands), Speed=`speed` (Feet), Clutch=`batting_clutch`
  (Helmet), Discipline=`plate_discipline` (Head), Frame=**height** (Body, `heightToRating`).
- **Figure:** `batter-figure.png` + 7 `bat-seg-<key>.png` masks (PIL softmax, anchors in `SLOTS` ax/ay).
- **WEIGHTS:** 1.2× Contact/Power, 1.1× Discipline/Vision/Clutch, 1.0× Speed/Frame.
- **Sim** (`simulateCareer`, seed `|bat-career-v1`): OPS/FIP-style hitting model. Career length & PA
  ← **Frame** (replaced durability); defense (`defRuns`)/Gold Glove ← **Speed** (replaced Fielding/Arm).
  HOF via `hofScore` or `slamDunk`. Tuned: 99≈GOAT, 90≈100%, 85≈72%, 80≈23%, ≤77≈0%.
- **Leaderboard:** shared `api/score.js`, separated by `game` column (`pitcher`|`batter`, default
  `pitcher`, backward-compatible). **Live** — batter scores post to the same Neon DB / serverless
  function as the pitcher board.
