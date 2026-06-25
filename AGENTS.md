# Pitching Lab

> Repo/Vercel project are still named `build-a-pitcher` internally (renaming risks breaking the
> link/deploys). **Player-facing brand is "Pitching Lab."**

## What this is
A browser game: spin a horizontal slot-machine reel of MLB pitchers, land on a random one, and
assign their rating to one of 9 body-mapped attribute slots on a pitcher figure. Fill all 9 →
weighted OVR → name your pitcher → post to a global/daily leaderboard. (Career simulation is the
next phase — see below.)

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
4. Repeat for all 8 slots → **finish** screen (name + leaderboard).

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
Flat transparent silhouette `pitcher-figure.png` split into 8 feathered body-region masks
(`seg-<slotKey>.png`, softmax membership so colors blend, no hard seams). Each assigned region is
tinted to the player's team jersey color + `jersey-fabric.png` texture (overlay blend) + one global
soft-light `.shade`. Cursor-driven perspective tilt. **Per-body-part team jerseys require these flat
recolorable masks — that's why it's 2.5D, not a rigged 3D model.** Regenerate masks with the PIL
snippet in git history if anchors change (anchors live in the `SLOTS` array `ax/ay`).

### Look & feel
Broadcast/sports-HUD: Oswald (display/numbers) + Inter, animated stadium background (drifting
light blobs, scrolling perspective grid, scanlines), beveled HUD panels with cyan corner brackets,
OVR gauge ring + 8-pip draft tracker. All motion via **GSAP (CDN)**.

### Sound
Synthesized with the Web Audio API (no asset files): retro ticker, tier chimes (gold / diamond /
legend glory fanfare), Prime upgrade sweep, assign blip, whoosh, completion flourish. 🔊 mute toggle
in the header. Audio unlocks on first click (autoplay policy).

### Leaderboard
Finish a run → name your pitcher → `POST /api/score`. **Global (all-time)** + **Today** tabs.
Top-3 medal coloring, your row highlighted.

---

## Data source & pipeline
Attribute ratings (1–99) from the MLB The Show API: `mlb25.theshow.com/apis/items.json`
(+ mlb24/23/22/21 for historical). Free, no auth, JSON.

- **`node fetch-data.js`** bakes `pitchers.json`:
  - Pool = **`series === "Live"` only** (real-world-accurate; special editions are inflated).
  - **SP + CP only** (relief pitchers `display_position === 'RP'` are dropped; legends exempt).
  - 2025 = all tiers; 2024–2021 = **gold+ (OVR ≥ 80) historical** versions, tagged with their year.
  - **Prime** map = highest-OVR special-edition card per player (Boost power-up). Don't say "MLB The
    Show" in the UI — call them "Prime."
  - **Legends** = retired greats (special card, no current Live card, OVR ≥ 85; prospect series
    excluded). 1% spin odds, shown purple.
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
  - `GET /api/score?scope=global|daily&limit=50` · `POST /api/score {name, ovr, build}`
  - Global = by ovr; Daily = `created_at >= date_trunc('day', now())` (UTC).
- **Deploy:** Vercel (static + functions). Push to `main` auto-deploys. Neon env vars are
  **Sensitive** (can't be pulled to CLI). Domain `pitchinglab.pitchergami.com` (Vercel-managed DNS).

### Known caveat — anti-cheat
Scores are submitted from the browser; the server only clamps `ovr` 1–99 and name length, so the OVR
is currently trust-the-client. Harden later by recomputing OVR server-side from the submitted `build`
(re-implement `WEIGHTS` + `heightToRating` in `api/score.js`).

---

## Phase 2 — Career simulation (planned)

Goal: after the draft, the Frankenstein pitcher plays out a **full simulated career** (multiple
seasons with an age curve), ending in a **Hall of Fame verdict (yes/no)** plus the awards,
milestones, and playoff runs along the way. A single season is just one tick of the career loop.
Keep it single-file, pure JS, in a `sim.js`-style module.

### 1. Ratings → rate stats (per season)
Map the 9 slot values (0–99) to peripheral rates, then derive results:
- **K/9** ← Strikeout (primary) + small bonus from Velocity/Break. (~Strikeout 50 → 8 K/9.)
- **BB/9** ← **Command** (`pitch_control`), inverted. (Command 99 → ~1.3 BB/9; 40 → ~4.5.) The
  re-added Command slot is exactly this input — no more "walks gap."
- **HR/9** ← inverse of Ground Ball. (GB 99 → ~0.6 HR/9; GB 30 → ~1.7.)
- **BABIP / weak contact** ← Defense + Break + Ground Ball (lower = fewer hits on balls in play).
- **IP per start & season IP** ← Stamina (primary) + Frame/durability. (Stamina 99 → ~6.7 IP/start,
  ~200 IP; low → fewer innings, more relief usage.) Frame/Stamina also drive **injury risk**.
- **Strand rate / situational** ← Clutch (drives the ERA-vs-FIP gap; runners-on performance).

### 2. Simulate a season (one career tick)
Prefer **game-by-game** (e.g. ~32 starts for an SP, more appearances for a CP) sampling outcomes
from the rates with per-game variance → a believable stat line **plus highlight games**
(complete-game shutout, double-digit-K games, no-hitter/perfect-game rolls for high-K + low-hit
profiles). Aggregate: IP, K, BB, HR, H, ERA, WHIP, FIP, W–L, SO title, etc.
- **ERA from a FIP-style core** (`(13·HR + 3·BB − 2·K)/IP + C`) then adjust by Clutch (strand) and
  Defense (BABIP).
- **Wins** = function of ERA + IP + a random "team context" factor (the pitcher doesn't control run
  support), so W–L carries luck like real baseball.
- **Seed the RNG from the build** so a given pitcher → a deterministic career (fair + shareable),
  with an optional "re-sim." (Decide: deterministic vs re-rollable.)

### 3. The career loop (primary)
- **Age curve:** start ~age 23; ratings ramp to a peak (~27–29) then decline; career length depends
  on Frame/Stamina + injury rolls. Loop seasons until retirement.
- **Per season:** awards (Cy Young via ERA/K/WAR thresholds, All-Star, ERA/strikeout titles),
  milestones (200-K season, sub-2.00 ERA, 20 wins, no-hitter / perfect game, immaculate inning),
  and a **playoff run** if the team makes it (weighted by Clutch; possible ring + postseason line).
- **Career totals:** cumulative IP/K/W/ERA/WAR, award counts, rings.
- **🏆 Hall of Fame verdict (yes/no):** a JAWS/WAR-style threshold on career totals + hardware
  (e.g. career WAR + Cy Youngs + milestones → a HOF score vs a cutoff). This is the payoff screen.

### 4. Presentation & integration
- Broadcast-style flow (reuse the HUD): season-by-season summary cards → a **career capstone /
  plaque** screen with the HOF yes/no, career line, awards shelf, and highlight reel. Then
  "Build Another."
- **Leaderboard tie-in (decision):** rank by draft OVR (current) vs a **career score** (WAR /
  Cy-points / HOF score). Likely add the career result into the `build` jsonb + a new board scope.
  A server-side sim would also close the anti-cheat hole.
