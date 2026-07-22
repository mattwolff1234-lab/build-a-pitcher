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
- **Ads:** Playwire (Ramp) — **read `ads.md` before touching page `<head>`s, layout, or
  `vercel.json`** (per-page ad-tag contract, dynamic ads.txt redirect, verification steps).

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
three true outcomes — K, HR, BB), **1.1×** Velocity/Break/Stamina/Clutch. **Defense & Frame use a
value-scaled weight** (`slotWeight`): they ramp **0.4× → 1.3×** as the rating climbs (Defense over
raw 73→85, Frame over 78→92) — a mediocre glove/height barely counts, an elite one is rewarded well.
So slot placement is strategic. (`build-check.js` `pitcherSoloOvr` mirrors this exact formula
server-side for anti-cheat.)

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
- **Real-world greats (`real-legends.js`)**: on career-stat sorts (never OVR), the top ~5–10
  real record holders (Bonds 762 HR, Nolan Ryan 5,714 K, Gretzky 2,857 P, …) are woven in by
  stat value as **legend-purple ★ rows** with a league chip (MLB/NBA/NHL/NCAA). Client-side
  only — Global scope + "Best" direction only, non-clickable, and they never consume a rank
  (user ranks/`me` pin match the server exactly). One shared drop-in on all 8 leaderboard
  pages (identical merge block in each `loadLeaderboard`); no entries for `mon` (fictional)
  or sim-only stats. Active players' totals are static snapshots — nudge them occasionally.

---

## Data source & pipeline
Attribute ratings (1–99) from the MLB The Show API: `mlb25.theshow.com/apis/items.json`
(primary) + `mlb26.theshow.com` (supplement: 2026 card replaces 2025 only if OVR is strictly
higher) + mlb24/23/22/21 gold+ historical. **When 2026 ratings mature mid-season and surpass 2025,
flip the primary to `mlb26` in both `fetch-data.js` and `fetch-batters.js`.**

- **`node fetch-data.js`** bakes `pitchers.json`:
  - Pool = **`series === "Live"` only** (real-world-accurate; special editions are inflated).
  - **SP + CP only** (relief pitchers `display_position === 'RP'` are dropped; legends exempt).
  - 2026 (current) = all tiers; 2025–2021 = **gold+ (OVR ≥ 80) historical** versions, tagged with year.
  - **Prime** map = highest-OVR special-edition card per player (Boost power-up). Don't say "MLB The
    Show" in the UI — call them "Prime." **Known cosmetic caveat:** ~26 SP/CP-pool players have their
    highest special card at `pos:"RP"`, so Boosting them shows an RP Prime even though the pool itself
    is SP/CP-only. Accepted as-is (still the correct player + legit stats; `reelPrimes()` filters by
    OVR/name, not position). Filter RP in `reelPrimes()`/`fetch-data.js` if this ever needs tightening.
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

### Accounts + personal Hall of Fame (shipped)
**Sign in with Google** → save your created players to a personal, sortable **Hall of Fame**.
- **`api/account.js`** (Vercel serverless + same Neon DB). Tables `users(google_sub PK, email, name,
  picture, session_token)` and `saves(id, google_sub, game, name, ovr, build jsonb, created_at)`,
  auto-created. Browser gets a Google ID token (GSI), server verifies it via Google's `tokeninfo`
  endpoint (checks `aud === GOOGLE_CLIENT_ID`), then issues our own `session_token` stored on the
  device. Actions: `login` / `save` / `delete` (POST) and `?action=list` (GET). One account spans
  both games; saves tagged by `game`.
- **Frontend** (both `index.html` + `build-a-batter.html`, near-identical): GSI script in head,
  account chip + "Sign in with Google" in the ☰ menu, "💾 Save to my Hall of Fame" button on the
  career-card screen, and a **🏛️ My Hall of Fame** menu tab — a GSAP-staggered, scrollable gallery
  of saved career cards with sort tabs (Overall/WAR/Earnings/HOF/Newest). Per-game constant:
  `HOF_GAME` (`'pitcher'` vs `'batter'`).
- **Setup:** `GOOGLE_CLIENT_ID` is a placeholder (`REPLACE_WITH_…`) in 3 spots — both HTML files and
  `api/account.js` (or set env `GOOGLE_CLIENT_ID` for the server). Until it's a real OAuth Web client
  id (from console.cloud.google.com, with our domains as Authorized JS origins), `googleConfigured()`
  is false and the UI shows a "sign-in coming soon" hint instead of a broken button. The client id is
  public; the only secret-ish piece is the per-device session token.

### Player XP + Levels (shipped)
Cross-game progression that rewards *playing*, not just first-time achievements.
- **`xp.js`** — shared drop-in module (like `achievements.js`), loaded `defer` **after** it on every
  game + versus page (and `index.html` for display). Exposes `window.XP`. Self-contained (injects its
  own CSS). Persists to localStorage **`pl_xp`** `{xp}` (version-wiped via `pl_xp_ver`), syncs to the
  Google account (source of truth), and auto-wraps `Ach.unlock` so **every achievement also grants XP**
  (normal 40, challenge 120).
- **Curve:** XP to reach level `L` = `25·(L-1)·(L+2)` (L→L+1 costs 100, 150, 200, 250…). `RANKS` give a
  flavor title per band (Rookie Ball → Prospect → … → Immortal). No hard cap.
- **Earning** (`XP.award(amount, reason)`): finishing a build (`20 + max(0, ovr−60)`), simulating a
  career (`40 + 150 HOF + max(0, ovr−70) + 12·rings`, capped), a 1v1 result (win 55 / loss 18), and
  every achievement unlock. Awards inside one build **batch** (320ms) into a single animated run.
- **Gain animation — Pokémon-style (`.xp-hud`):** a bar slides up from the bottom and **fills** from
  where it last sat to the new total. `segments(from,to)` splits the gain at each level boundary, so a
  big award **fills → flashes/dings/level-number bumps + spark burst (`levelUp`) → wraps to empty →
  refills**, repeating for **every** level crossed in one go (0, 1, or many). `lastShownXp` tracks what
  the bar last rendered (so a cross-device restore or `{silent:true}` award never animates), and an
  `animBusy` guard queues XP that arrives mid-animation. All GSAP; degrades to an instant set if absent.
- **UI:** `XP.mount()` fills any `[data-xp-bar]` slot with the resting level chip + progress bar —
  dropped into each game's ☰ menu (under the account chip) and the versus **Stats** screen.
  `[data-xp-level]` slots get just the number.
- **Server:** `users.xp bigint` (auto-`ALTER`) + **`xpSync`** action in `api/account.js`. XP is
  **monotonic** — the account keeps `max(local, stored)`, so it follows the email across devices and
  can never drop. Same `reset`/`claim` semantics as `achSync` (guest XP is adopted only into an account
  with none yet). Sign-out zeroes the local copy (`XP.signOut()`).
- Same **trust-the-client** caveat as the leaderboard/Elo — XP is reported from the browser.

### 🔥 Last Night's Studs (shipped)
Daily real-MLB hot players — the "open the app the morning after" retention hook. Baseball only
(no NBA box-score source; hoops untouched).
- **`api/hot.js`** — `GET /api/hot` → `{ ok, gameDate, players:[{mlbamId, name, team, pos,
  type:'pitcher'|'batter', line, boost}] }`. Computes once per **US-Eastern day** on the first
  request (no cron): statsapi schedule → one boxscore per Final game → stud scoring (pitchers =
  Game-Score-ish, qualify ≥68; batters = HR-heavy points, qualify ≥20 or 2 HR / 4 H / 3 SB auto).
  Top 4 pitchers + 6 batters; **`boost` = 5–10** scaled by how big the night was. Cached in Neon
  `hot_players(serve_date PK, payload jsonb)`; statsapi failure → serves the most recent stored
  day; off-days/All-Star break walk back up to 5 days; a day with games still live (late
  west-coast) is skipped. Tune the scoring locally with **`node api/hot.js`** (prints the list,
  no DB needed).
- **`hotboard.js`** — drop-in module (landing + both baseball games, like xp.js): `window.Hot`
  (`ready`/`list()`/`get(mlbamId)`/`open()`), the bulletin-board overlay, auto-opens **once per
  local day** (`pl_hot_seen`), skipped when a `#hash` deep link is present. Fails silent — no
  list, no change. Landing page also has a "🔥 Last Night's Studs" banner (`hotCta`) + games have
  a ☰ `miHot` item.
- **In-game** (pitcher.html + build-a-batter.html, identical pattern): `HOT` map by `mlbamId`,
  `hotVersion(p)` = copy with **+boost on every rated attribute and ovr** (never height/Frame;
  intentionally uncapped past 99, same precedent as Judge's 108 power), `HOT_ODDS = 0.10`
  direct-landing roll in `randPitcher`/`randHitter`, and any normal land on a hot player swaps to
  the hot card — a stud is *always* boosted today. 🔥 tag on reel cards, 🔥 badge + "Last night:
  <real line>" on the landed panel. The Boost power-up stacks on top of the hot card (never
  downgrades).
- **Guardrails:** **free play only** — `dailyMode` short-circuits all hot logic so the seeded
  same-for-everyone Daily Challenge stream is byte-identical with or without a hot list
  (verified). Versus 1v1 untouched (its balance is separately tuned). Hot builds can post higher
  OVRs to the global leaderboard — accepted trade-off, revisit with the anti-cheat hardening.

### Name filter (slurs/profanity in user-chosen names — shipped)
**`namefilter.js`** — ONE shared blocklist module for browser (`window.NameFilter`, loaded
without `defer` on every page so inline scripts can use it) AND server
(`require('../namefilter.js')` in `api/score.js` + `api/account.js`). Evasion-resistant matching:
accents stripped, leetspeak mapped (`n1gg3r`), separators dropped (`n i g g e r`), repeated
letters collapsed (`Nigggggger`), l→i lookalikes. Hard slurs match as substrings; ambiguous terms
word-boundary only (so Nigeria/raccoon/therapist/Hancock/Scunthorpe stay legal). API:
`isClean(name)` / `bad(name)` / `clean(name, fallback)`.
- **Server = enforcement** (client checks are just friendlier UX): `POST /api/score` +
  `challengeSubmit` reject bad names (400 with a clear error); `action=names` (the franchise
  FA/rival feed — how one player's slur name used to reach everyone else's franchise) drops
  them; leaderboard GETs censor legacy rows to "Anonymous". `api/account.js` gates `save` +
  `clubCreate` (reject), guest names, handles (`handleClaim`/`handleCheck`/`handleFrom`), club
  roster snapshots, and pvp `oppName`/`winnerName` (neutral fallback).
- **Client**: build games gate `nameInput` at draft/career/submit (`nameGate()`); franchise gates
  team + club names AND retro-scrubs saved rosters/rivals/logs on every load (`scrubSaves()` —
  fixes saves polluted before the filter shipped) + filters the cached FA pool (`scrubPool`);
  versus pages gate the guest handle; social.js gates handle claiming. Also bundled into the iOS
  app (`ios-app/build-www.js` SCRIPTS list).
- **Legacy DB cleanup**: token-gated `nameScrub` action (dry-run by default; `apply:1` writes)
  purges bad names already stored in users/saves/scores/daily_scores/clubs/pvp tables:
  `curl -X POST .../api/account -H "content-type: application/json" -d '{"action":"nameScrub","token":"<STATS_TOKEN>","apply":1}'`
- It's a blocklist — extend `HARD`/`WORD` in `namefilter.js` as new evasions show up (both
  browser and server pick the change up automatically since it's one file). Franchise clone
  pages regenerate from `franchise.html` via `gen-franchise-clones.js` as usual.

### Anti-cheat (hardened 2026-07-12 — the old "trust-the-client OVR" caveat is CLOSED)
**`build-check.js`** (root, required by `api/score.js` AND `api/account.js` — the JSONs it
requires are bundled into both lambdas): three validation layers on every submitted build —
slot caps (`SLOT_MAX`), weighted-OVR recompute ±3 (`OVR_W` for batter/baller/soccer/cfb/hockey/mon;
**pitcher solo submits recompute via `pitcherSoloOvr`** — value-scaled Defense/Frame ramps — and MUST
carry the full 9-slot build; a missing pitcher build is now rejected, not passed through), and **card
truth**: every verifiable slot must name a REAL player from the game's own data files and stay ≤ that
player's best version (live/prime/legend/era) + power-up headroom (`CARD_ALLOW`: baseball 15 = hot 10 +
boost 5; others 5). Client pool and validator ship from the same commit, so they can't drift. Frame
slots are height-derived → cap-only. **HOF saves (`api/account.js` `save`) run the same `checkBuild`.**
Versus builds pass `{versus:true}` (skips card-layer for the curved slots: pitcher Defense,
all keeper KP_LIFT values); `versusPitcherOvr` replicates the dynamic-weight versus pitcher OVR
exactly. Harness: 225 sampled prod builds pass (6 rejects = pre-2026-07-09 keeper submissions
whose players a data refresh removed — impossible for new submissions).
**Ranked 1v1 is server-settled:** versus pages POST `pvpLock {matchId, game, role, build}` at
build-finish (validated, OVR + server-read Elo stored in `pvp_builds`, first lock wins, 2-day
sweep); `pvpResult`/hoops/soccer handlers override the reported winner with `lockedTruth` when
BOTH locks exist (exact OVR ties keep the client's seeded-coin verdict — it sits mid-RNG-stream).
Old/no-lock matches fall through to the legacy trust path (deprecation window); coins only ever
pay on locked-truth wins. Still trust-the-client: XP/SXP/cosmetics/consumables (accepted).

---

## 🪙 Goat Coins (currency + store + Stripe — built 2026-07-12, needs Stripe env to sell packs)
Server-authoritative wallet, **signed-in only**. `users.coins` + `users.entitlements jsonb` +
append-only `coin_ledger` whose UNIQUE `ref` is the idempotency key for every movement
(`stripe:<sessionId>` · `daily:<date>:<game>:<sub>` · `pvpwin:<matchId>:<sub>` ·
`discord:<sub>` · `track:<season>:<lane>:<i>:<sub>` · `spend:<sku>:…`).
- **`catalog.js`** — dual-env (namefilter pattern): coin PACKS (usd cents), SKUS (pass_s2 ·
  3 avatar cosmetics · scout/resim bundles · no_ads_30; franchise perks COMMENTED OUT until
  the franchise pages read them), EARN amounts, TRACK_COINS season coin-tiers. Server prices
  are the only truth; everything marked `// TUNE`.
- **api/account.js**: `wallet` · `coinSpend` (pre-checks one-time SKUs, race-safe conditional
  debit, applies effect: pass/entitlement/tokens/noads/cosmetic-unlock/item-count) ·
  `trackClaimCoins` (validates synced sxp + pass for premium lane, per-tier ledger dedupe) ·
  `discordClaim` (one-time large reward; honor-system v1 — Discord OAuth verify is roadmap).
  Earning: daily grant inside score.js `challengeSubmit` (first valid run/day/game, accounts
  only), 1v1 grant via `pvpWinCoins` in all three result handlers (locked-truth wins only,
  daily cap). Responses carry `coins:{granted, coins}` for client animation.
- **Stripe (no SDK — raw REST + crypto HMAC)**: `api/buy.js` creates Checkout Sessions
  (metadata carries player_key+pack, path-only returnTo); **`api/stripe-webhook.js` is the
  ONLY place purchases credit** (signature verified by hand, 5-min tolerance, amount must
  match the pack, ledger-idempotent — 6-check mock-DB harness in session scratchpad).
  **Setup needed before selling**: Stripe account for Wolff Labs LLC → `STRIPE_SECRET_KEY` +
  webhook endpoint `/api/stripe-webhook` (checkout.session.completed) → `STRIPE_WEBHOOK_SECRET`
  in Vercel (Sensitive). Test mode works end-to-end without the LLC bank account.
- **`store.js`** — drop-in module (loads AFTER catalog.js) on hub + 5 game pages + 3 versus
  pages: `[data-coin-chip]` balance chips, ☰ `#miStore` item, tabbed overlay (Shop / Get
  Coins / Earn incl. the Discord claim), `?purchase=success` bounce polls the wallet until the
  webhook lands. **Capacitor check hides Get Coins in the iOS app** (Apple IAP rule); both new
  files are in ios-app/build-www.js SCRIPTS.
- **Season 2 "Dog Days"** defined in season-track.js (beats the 08-15 deadline) WITH the first
  **premium lane**: `SEASONS[2].premium` cosmetics auto-unlock only while `entitlements.pass[2]`
  (read from the pl_wallet cache; render retro-unlocks after a mid-season pass purchase), coin
  tiers render from TRACK_COINS with server-side Claim buttons. New frames st-frame-ember/frost.
- **No-ads**: every ad page's static ramp.js tag is now a conditional loader — skips Playwire
  while `entitlements.no_ads_until` is in the future (rest of the ads.md 3-piece contract
  untouched; franchise clones patched via franchise.html so a regen keeps it).
- Deferred: franchise perk SKUs (engine determinism — needs its own pass), Discord OAuth
  verification, Apple IAP, refund/ToS page + Stripe Tax before LIVE mode.

## 2026-07-21 — Battle pass open · Pro cosmetics · /ranks page (supersedes stale bits above)
- **Coin economy OPEN**: `store.js` `PRO_ONLY` is gone — Shop always sells coin items; real-money
  packs gated by **`SELL_PACKS = true`** (web only, hidden in-app). **`pass_cur`** SKU (1500 🪙,
  `season:'current'`) resolved server-side in `coinSpend` via the shared season clock; blocked
  while Pro is active ("Included ⭐").
- **Named the "GOAT Pass"** (was Battle Pass — blanket-renamed across track/store/catalog/terms/
  webhook email/menus). **Homepage banner** (`#goatPassBanner` in index.html, between the Pro
  banner and resume card): season name, days left, live SXP progress bar, gold 🪙 price CTA (or
  "Open →" when owned) → opens the track panel. **Jerseys ride the pass**: jr_pinstripe (1800) +
  jr_gold (4000) on S1, jr_blackout (1400) + jr_chrome (4900) on S2 — type 'jersey' in COSMETICS,
  Equip button calls `Jerseys.equip()` (pl_jersey); pass unlocks write the same
  `pl_track.unlocked` the store SKUs use, so `Jerseys.owns()` works from either source (jerseys
  stay buyable in the store as the no-grind shortcut).
- **PAID-ONLY GOAT PASS (Matt's call, same day)**: the free lane is GONE — each season is ONE
  merged track in `SEASONS[n].tiers` where EVERY tier (cosmetics AND coin payouts) needs the pass
  or Pro. SXP accrues for everyone; non-owners see the full track as a 🔒 locked teaser with an
  Unlock header; buying mid-season retro-drops everything earned (`sweepUnlocks` now no-ops
  without `hasPass`). Items unlocked before the switch stay owned/equipable (`cosRow` checks
  `unlocked` before the lock). Server: `trackClaimCoins` requires pass/Pro for BOTH lanes now;
  catalog `TRACK_COINS[1]` keeps its free/premium split (existing claim-ledger refs stay stable),
  S2+ = single `premium` lane, ~1450 🪙 back on the 1500 pass. ☰ menu item renamed "🎟️ Battle
  Pass" on all 9 pages.
- **Name Effects (`fx` cosmetic type)** in season-track.js: glow/particle styles on player names
  (`SeasonTrack.applyFx/fxClass/equippedFx`, CSS `st-fx-*`). S2 premium lane grew to 8 tiers
  (fx_neon_pulse · fx_ember · frame_prism). **Pro exclusives (`pro:true` — active while
  `pro_until`, lapse = auto-unequip)**: fx_gold_aura "Midas Glow" + trail_gold "Golden Reel
  Trail"; a "⭐ GoatLab Pro exclusives" section renders at the bottom of the track panel.
  `trackSync` equipped whitelist now includes 'fx'.
- **Cosmetics travel**: score POST accepts `style:{av,fx}` (id-shape whitelisted) → stored as
  `build.style`, projected in every GET row; game pages submit it and render avatar chip + fx on
  lb popup rows. 1v1: `fx` rides presence/build/forfeit messages next to `avatar` (all 3 source
  versus pages + regenerated versus-cfb).
- **`/ranks` full page** (`ranks.html`, in dev-server + vercel.json + ios build-www): two-dial
  sport/game nav, scopes All-time/Today/Daily-Challenge, sort dropdown, 👑 champion spotlight
  (today's leader + **yesterday's locked champion** via new `scope=yesterday`), board-size banner
  (new `total` in GET), expandable rows rendering `build.slots` chips, ⚔️ 1v1 Elo ladder tab
  (`pvpLeaderboard`). Switcher Ranks tab + hub tiles + game ☰ miLb now point here; the in-game
  popup stays for post-submit (pinned rank + "Full rankings ↗" link). Games persist
  `pl_lastEntry_<game>` so /ranks pins "(you)". Rows tap-expand to a FULL attribute breakdown
  (slot · player · value, tier-colored). **Playwire intentionally NOT on /ranks** — unmapped
  units covered the phone layout; Louis must map units for the route before re-adding the tag
  (see ads.md).
- **Pro polish**: richer perks list + `checkoutDesc` in catalog (shown on Stripe Checkout);
  webhook sends a **Resend welcome email** on first subscribe (`pro_welcomed` dedupe, no-op until
  `RESEND_API_KEY` env — setup steps in GO-LIVE.md).

## SEO metadata pass (2026-07-21)
Search-tuned `<title>` + `meta description` + `rel=canonical` on all 20 routed pages, plus
`sitemap.xml` (20 URLs) + a Sitemap line in robots.txt. Language chosen from SERP research
(career simulator · player builder · create a player · GM game · free browser · daily) and
GA4 priorities (batting > pitching > hoops > home; organic = 36% of sessions). **Canonicals
point at `goat-lab.app`** — both domains serve identical content, so this starts consolidating
authority onto the brand domain (reversible: swap the canonical hrefs + sitemap host).
og:title/og:description are kept in sync. gen-versus-cfb.js carries the meta through regens
(title/desc soft transforms + the `/versus-hoops` blanket count is now 5). New pages: copy the
head pattern + add a sitemap line. GSC: both domains verified 2026-07-21; submit sitemap.xml.

**Crawlable on-page copy (same pass):** a `<footer class="pg-about">` injected before `</body>`
on 14 listed pages — About prose + 4 FAQs + internal links to every sibling game, plus
`application/ld+json` (VideoGame + FAQPage schema, the latter can earn FAQ rich results). It
exists because the good how-to-play copy lives in a HIDDEN overlay, which Google discounts;
this puts real prose in the visible flow. Word counts roughly +300/page (home 268→576).
Placement is in-flow BELOW everything so gameplay is untouched and ads.md holds (no fixed
elements; `padding-bottom: calc(var(--gnav-h) + var(--pl-adh) + 24px)` clears the bottom nav +
anchor ad). **Monster Lab is deliberately EXCLUDED** from both this and sitemap.xml — it's
de-listed from the hub, and its IP posture means no franchise keywords anywhere. Copy rules:
accurate, useful to a human, never names the ratings source (house rule: "Prime"), no keyword
stuffing (Google's helpful-content system penalizes filler). New game → add an entry.

## Shareable result block (2026-07-22)
`ShareCard.resultText()/tierRow()/copyText()` in share-card.js + a 📋 Copy result button on
every build game's Daily Results panel (`#dResCopy`, wired beside `#dResSim`; `window.__lastDaily`
stashes ovr/rank/total in renderDailyResults).

Output — the Wordle-grid analogue: one square per slot, coloured by that card's TIER, in slot
order (⬛grey 🟫bronze ⬜silver 🟨gold 🟦diamond 🟪legend):

    🐐 GoatLab Daily · Pitcher · Jul 22
    🟪🟦🟦🟨⬜🟫⬛🟨🟫
    96 OVR · #12 of 847 · 🔥 14

Spoiler-safe (never names a player), and braggable in a way Wordle's grey squares are not.

**The block carries NO URL, deliberately — do not "fix" this.** Wordle's creator removed the
link because "it feels spammy… they were sharing for themselves"; the 🐐 GoatLab signature line
is the googleable hook instead. Same reason `shareBuild()`'s X-intent lost its bare
`&url=goat-lab.app`. The career card's `/p/<id>` permalink is KEPT — that points at the artifact
being shared, not the front door. Sourced from the deep-research run of 2026-07-22 (which also
refuted the popular "Immaculate Grid went viral from one r/baseball post" story — the inflection
actually followed a large baseball Twitter account).

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
- **Hall of Fame** (`hallOfFame`): `hofScore` (WAR·0.82 + K/W/ERA-title milestones + hardware) **≥ 112**,
  OR a `slamDunk` résumé (WAR ≥ 64, or 3+ Cy Youngs, or 4,000 K + 50 WAR, or 3,000 K + 2 rings + 46 WAR).
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

### Player comp (shipped 2026-07-19 — pitcher + batter pages)
`playerComp()` in both `pitcher.html` and `build-a-batter.html`: the real player (pool + legends)
whose slot profile sits closest to the finished build — weighted RMS distance over the game's own
SLOTS/WEIGHTS via `slotNumeric`, mapped to a 40–99 "match" score (`clamp(99 − dist·2.2, 40, 99)`,
calibrated so a typical build reads ~75–85% and a single-player clone 99%). Shown on the done panel
(`#doneComp` — headshot chip + "Player comp: NAME · nn% match", legend names purple) right under the
OVR/archetype, on the career card (`cc-comp` line, own card only — shared-link cards omit it), and as
the batter share-card subtitle (pitcher subtitle stays the archetype). `state.comp` set in `finish()`,
cleared in `reset()`. Client-only, nothing posted to the server. Sibling games (hoops/striker/keeper/
hockey/mon/cfb) don't have it yet — the function is generic over SLOTS/WEIGHTS, so porting is a
copy-paste per page.

### Keyboard spin (shipped 2026-07-19 — pitcher + batter pages)
**Space = Spin** on desktop: document-level keydown in init that clicks `#spinBtn` (so it respects
disabled state). Skipped while an `.overlay.show` is open, while any control has focus
(`button/input/textarea/select/a/[tabindex]` — leaderboard rows + slot nodes handle Space
themselves), and on key repeat.

### Still open / ideas
- Leaderboard still ranks by **draft OVR**, not career → could add a career-score board (and a
  server-side re-sim would also close the anti-cheat hole). Optional **re-sim** toggle. Trades / free
  agency across teams. Auto nickname from the build (archetypes partly cover this).
  Port player comp + Space-to-spin to the sibling build games.

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
- **HR top-end (2026-07-10 retune of a retune):** over-99-power builds get HALF their headroom as
  the seasonal power cap + a small `superPow` slope/variance term; hrRate cap 0.078. Maxed
  (power-114) build = ~670 avg / ~734 max career HR, best seasons ~48 max — **~10% over the
  classic 614/647, on purpose; do NOT re-inflate** (the first cut hit 748/918 avg/max career +
  78-HR seasons and got rolled back). ≤99-power builds are byte-identical to the classic sim.
  Verify any change with a Node harness that extracts `simulateCareer` from the HTML (see the git
  history of this fix). `api/score.js` also strips impossible careers on submit (`CAREER_MAX` —
  keep in sync with verified sim maxima; re-based 2026-07-11 for hot-boosted builds under the
  soft-capped sims: batter hr>850/h>4250/rbi>3600/r>2300/sb>730, pitcher k>7500/ip>4650/wins>390;
  pitcher k raised 7100→7500 2026-07-21 per player request)
  and has a token-gated `redactCareers` admin action (STATS_TOKEN) that stripped careers from the
  inflated window (criterion: Power slot > 99 + created_at ≥ 2026-07-10T05:37Z).
- **Over-99 soft-cap (2026-07-11, both sims):** the 🔥 hot boost stacks past 99 (card display is
  intentionally uncapped), but the SIMS soft-cap over-99 inputs. Pitcher `simulateCareer` routes
  every raw build-value read through `soft()` (keeps 40% of over-99 headroom — less than the
  batter's half because K rate × innings × career length compound): maxed all-109 = +14% avg /
  +10% max career K over all-99. Batter audit found hits/SB/runs/RBI already contained by the
  seasonal 99-clamps (+3.5%/+9%/+5%/+15% for a maxed hot build — in band, untouched); only
  `mvpElite` needed the soft-cap (raw over-99 OVR, same class as pitcher `cyElite`). ≤99 builds
  byte-identical in both games (harness-verified, 900 careers × 300 random builds each).
- **Leaderboard:** shared `api/score.js`, separated by `game` column (`pitcher`|`batter`, default
  `pitcher`, backward-compatible). **Live** — batter scores post to the same Neon DB / serverless
  function as the pitcher board.

---

## ⚠️ File structure (updated — older notes above are stale)
The repo is **NOT** a single `index.html` anymore. Current layout (routes in `vercel.json` rewrites):
- **`index.html`** = the **landing/router page** (hero, "Build a Pitcher/Batter" cards, Hard-Mode
  toggle, drifting "careers" bg, and a **top-right ☰ hamburger** with Google sign-in + nav). It is
  NOT the game.
- **`pitcher.html`** = the pitcher game, served at **`/pitching`**.
- **`build-a-batter.html`** = the batter game, served at **`/batting`**.
- **`versus.html`** = the **1v1 Face Off** mode, served at **`/versus`** (see below).
- **`college.html`** = College Football Lab (see section below), served at **`/college`** (+ `/cfb`).
- Hamburger items that are game-specific deep-link into the pitcher game via hash:
  `/pitching#hof`, `/pitching#leaderboard`, `/pitching#how` → `pitcher.html` opens that panel on load.

---

## College Football Lab (LIVE, v1) — `college.html` at `/college`, game key `cfb`
**Three positions in ONE page** (QB / RB / WR) — a position-select screen sets `POSITIONS[key]`
(slots/weights/figure/masks/stage aspect) into the `SLOTS`/`WEIGHTS`/`DATA` globals, then the
normal draft loop runs. Cloned from `build-a-baller.html` (build script pattern in git history).

- **Data:** `node fetch-cfb.js` (`--fresh` re-downloads) → `cfb.json` `{positions:{qb,rb,wr:
  {pool,prime}}, legends:{qb,rb,wr}, teams}`. Source = **CFB Labs' public GraphQL endpoint**
  (`cfblabs.com/.netlify/functions/cfb27-players`, full EA CFB27 default rosters — EA's own
  drop-api for CFB27 was empty at launch; filters endpoint gave the 41 crest PNGs saved in
  `cfb-filters-raw.json`). QBs are stored as `"QB (Right)"/"QB (Left)"`, RBs as `"HB"`. Pools
  (v2, per Matt): **Power-4 schools + ND only, floor 64, top 300 per position** (293 QB / 300
  RB / 300 WR — tune `POOL_FLOOR`/`POOL_CAP`/`P4_TEAMS`), synthesized Primes (+6/slot, ovr+5),
  12 hand-authored college icons per position (rated on their COLLEGE careers — Tebow 97).
  **Headshots + logos from ESPN** (`cfb-espn-raw.json`, deleted → re-downloads): rosters matched
  by mascot displayName, players by name with transfer-aware fallbacks (EA carries spring-2026
  portal moves ESPN lags — Lagway is a Bear; a globally-unique name match follows the face, not
  the school). ~48-65% of the pool, 70-90% of the top 30, get real faces; everyone else shows
  the school crest (`headshot()` → player img → crest → silhouette).
- **Slots (9 per position, 3× 1.2 / 3× 1.1 / 3× 1.0):** QB Short/Mid/Deep Accuracy premium; RB
  Speed/Break Tackle/Vision; WR Hands/Speed/Routes. RB's catch slot is labeled **"Catching"**
  (not "Hands") so the flat server `OVR_W.cfb` map has no cross-position weight collisions.
- **Figures:** 3 AI-generated silhouettes (`_cfb-<pos>-source.jpg`, committed) →
  `make-cfb-figures.py` (morphological-close before largest-component: thin white seams sever
  limbs; RB ground-shadow hard cut) → `make-cfb-masks.py` (Voronoi+feather, anchors in file).
  Stage aspects: QB 1086/1445 · RB 1086/1308 · WR 1086/1338 (set inline by `selectPosition`).
- **Career sim** (deterministic, seed `|cfb-career-<pos>-v1`): **Signing Day** ceremony (star
  rating + hat-grab reveal at the **build's modal school**, ties seeded), 3–5 seasons (≥88 OVR
  declares after junior year, <72 grinds 5), per-position stat lines, Heisman (QB-favored,
  ~0.5/career at 95) / natty / All-American, **NIL money** (= earnings), College-HOF legacy
  score, **NFL Draft projection** verdict line ("Going pro in something other than sports" at
  the bottom). Tiers: 🐐 College GOAT (2 Heismans, or H+natty at 98+) · 🏆 College Legend ·
  🏈 Hall of Stat-Stuffers · Campus Hero · Solid Saturday Starter · Hall of Walk-Ons.
  **Decision events (always on):** same halt-and-resume engine as the other games — separate
  `|cfb-decisions-v1` stream plans events with a FIXED draw count, picks consumed positionally,
  risk rolls pre-drawn (same picks → same career; don't break this). Pool = campus life (party,
  frat, roommate, midterms, mascot heist, spring break, the DM) + career (NIL bag, five-star
  position battle, rivalry mic, transfer portal → school actually changes mid-career, injury
  sit-or-play, junior-year declare-or-return where ⏩-skip defaults preserve classic lengths).
  `CFB_EVENTS` fx pills must mirror `applyChoice`.
  **CFP bracket (no flat title roll):** playoff seasons run a real 12-team bracket - seed from
  wins+prestige (1-4 = bye), per-game win prob from prestige/warScore/seed, opponents weighted
  to blue bloods, per-game player stat lines that count toward totals and feed headlines
  ("💔 CFP Semifinal: ..."). Natty ONLY by sweeping the run; losing the final = 🥈 runner-up
  (badge, trophy, +5 legacy; cfpWins +1.5 each). Tuned to match the old flat rates
  (95 OVR ≈ 1.4 natties/career, 85 ≈ 0.2) - re-verify with the harness if touched.
  Re-verify with a Node harness that extracts the sim from the HTML (see git history).
- **Server:** `'cfb'` in both `gameOf` whitelists; `api/score.js` has SLOT_MAX/OVR_W/LEGEND_CAP/
  CAREER_MAX (yds 17000 / td 170) + sort keys `yds/td/heisman/natty`. Leaderboard + Google
  sign-in + personal HOF fully live (`HOF_GAME='cfb'`, build payload carries `pos`).
- **Daily Challenge (LIVE):** the position ROTATES by date (3-day QB→RB→WR cycle,
  `dailyPosKey()`), so everyone worldwide builds the same position from the same seeded cards.
  `startDailyChallenge` forces `selectPosition(dailyPosKey())` before seeding. Shared cross-game
  streak; posts as game `cfb`; `/college#daily` + `#streak` deep links; hub + switcher route to it.
- **🏈 Go Pro / NFL continuation (LIVE):** optional second act — `goProBtn` on the verdict
  screen → Draft Night ceremony (same GSAP skeleton; UDFA variant: "the phone never rang") →
  `simulateNflCareer` (seed `|cfb-nfl-<pos>-v1`, deterministic). Draft stock = college resume +
  combine swing; a wide **destiny roll** makes ~10% of arcs true busts (proPeak craters) and
  late picks/UDFAs get chip-on-shoulder upside (💎 DRAFT STEAL when they reach Canton; UDFA
  without upside = 🎽 Cut in August, 0 seasons). Pro seasons append to the same career log
  (Y1/Y2 rows, NFL logos via a.espncdn.com, MVP/All-Pro/SB badges), ticker keeps accumulating,
  card gets an NFL strip (draft line, pro totals, trophies, verdict). Tuned: 95-OVR QB ≈
  1.1 MVP + 1.0 SB/career, HOF 89% (RB 23% / WR 54% — position-realistic), careers QB≈14yr /
  RB≈8 / WR≈10, earnings soft-capped $620M. College OVR/leaderboard untouched — NFL is legacy
  flavor; HOF saves carry a slim `nfl` block. Verdicts: 🐐 NFL GOAT · 🏆 Pro Football Hall of
  Fame · ⭐ Franchise Legend · Solid Pro · 🚨 First-Round Bust · Journeyman · 🎽 Cut in August.
- **v1 scope cuts (still open):** no ads (Playwire block stripped — read `ads.md` before
  re-adding), no achievements/xp/collection/quests/season-track/social/switcher modules on the
  page (no-op seams kept), no versus/franchise. Hub shows those as 🔒 coming soon.

---

## Hockey — "Rink Lab" (built 2026-07-12, NOT yet pushed) — `hockey.html` at `/hockey`, game key `hockey`
Cloned from `build-a-baller.html` via anchored transform (CFB recipe; transform scripts were
session-scratch, not committed). **9 slots**, single position ("Skater" — goalies excluded like
RPs in the pitcher game).
- **Data:** `node fetch-hockey.js` → `hockey.json` `{pool, prime, legends}`. Source = the **open
  official NHL stats API** (`api.nhle.com/stats/rest` summary+realtime+bios, season constant
  `SEASON` in the script — bump to 20262027 mid-next-season). There is NO public ratings DB (EA's
  drop-api 204s on every slug incl. Madden), so ratings are **derived from real stats**: 8
  attribute composites (goals+sh% → Sniping, assists → Playmaking, shots → Shot Power, hits+weight
  → Physicality, blocks/+- → Defense, takeaway-giveaway → Hockey IQ, GWG+OTG → Clutch, TOI →
  Motor), each rank-percentiled through `curve()` onto 40-99. **Card OVR = production composite**
  (points + TOI + defensive value) through piecewise anchors tuned to sibling tier spreads
  (median 73, ~14% diamond) — NOT the avg of attributes (that caps stars at 84). Pool = 693
  skaters (25+ GP). 36 hand-authored retired **legends** (era-lore ratings, ids resolved via
  `search.d3.nhle.com` → real mugs). Primes synthesized +6/slot. Headshots:
  `assets.nhle.com/mugs/nhl/latest/<id>.png`.
- **Slots/weights:** 1.2× Sniping/Playmaking/Defense · 1.1× Motor/Clutch/IQ · 1.0× Shot
  Power/Physicality/Frame. Frame = height, `58+(in-73)*4.5` (6'9" Chara ≈ 94). Body map:
  stick blade=Sniping, hands=Playmaking, shooting arm=Shot Power, shoulders=Physicality,
  shin pads=Defense, helmet=IQ, legs=Motor, chest=Clutch, core=Frame.
- **Figure:** AI-generated silhouette `_hockey-source.jpg` (committed) → `make-hockey-figure.py`
  → `make-hockey-masks.py` (anchors in file). Stage aspect **1086/1063**.
- **Career sim** (seed `|hockey-career-v1`, decision events = same engine, `|decisions-v1`
  stream): ages 19→~40s, G/A/P seasons, Hart/Art Ross/Rocket/Selke/Calder/Conn Smythe/First
  All-Star Team, Stanley Cups (💍 stays the rings emoji in badges/sorts), 895-goal +
  2,858-point record-chase ticker milestones, NHL-scale salaries. **Tuned** (Node harness:
  extract inline script, slice sim fns — see git history of this commit): 99 OVR = 100% HOF /
  2.7 Harts / 778 avg career G / max 67-goal season; 90 = 100% HOF; 85 = 67%; 80 = 17%; ≤77 ≈ 0.
  Maxed hot-boost-style all-105 builds avg 948 G (Gretzky's 894 is beatable by god-builds ON
  PURPOSE; his 2,857 points and 92-goal season stay safe). `CAREER_MAX.hockey = {g:1060, p:2380}`.
- **Server:** 'hockey' in both `gameOf`s, SLOT_MAX `{_default:108, Frame:96}`, OVR_W by label,
  LEGEND_CAP 6, sort keys `g`/`p`. `collectionSync` GAMES now covers ALL games (was
  pitcher/batter/baller only — striker/keeper/cfb binders weren't syncing; fixed in this commit).
- **v1 scope:** CFB-style cuts — no ads (read `ads.md`), no versus/franchise/social/season-track/
  switcher on-page. KEPT (unlike CFB v1): achievements + xp + collection + quests + share-card +
  full daily challenge/streak (runs its own daily every day, keys `pl_dc_*_hockey`,
  `pl_draft_hockey`, daily seed `pl-daily-<date>-hockey-v1`).

## Monsters — "Monster Lab" (built 2026-07-12, NOT yet pushed) — `monster.html` at `/monster`, game key `mon`
The Pokémon game. Same transform recipe. **7 slots** (HP/Attack/Defense/Sp. Attack/Sp.
Defense/Speed + Frame=size).
- **⚠️ IP posture (Matt's explicit call):** NO Nintendo sprites or official artwork anywhere —
  cards render a **client-side SVG type badge** (dual-type gradient + type emoji, cached per type
  pair in `headshot()`). Names + base stats are facts from the **open PokeAPI bulk CSVs**
  (`fetch-pokemon.js`, 5 requests to raw.githubusercontent.com/PokeAPI). The figure is an
  ORIGINAL AI-generated kaiju (`_mon-source.jpg`), deliberately not any real Pokémon. Footer
  disclaims Nintendo/Game Freak/TPC. Don't add sprite URLs back.
- **Data:** pool = 875 default forms (BST ≥ 280, legendaries excluded); **legends** = 48
  legendary/mythical BST ≥ 600 (Arceus 99 · Mewtwo 94; sub-legendaries stay in the pool);
  **Prime = real Mega/G-Max forms** (103 of them — Boost is literally Mega Evolution; incl. the
  Legends Z-A megas) else synth +6. **Slot ratings = real base stats** `stat*0.68+12` capped 125
  (Blissey's 255 HP pins the cap; over-99 like Judge). **Card OVR = BST percentile** through
  anchors `[(0,45),(.5,68),(.9,82),(1,99)]` (diamonds = pseudo-legendaries/UBs/paradoxes).
  `heightIn` = **decimeters**; Frame = `40+ln(dm/10)*18` log curve; the page's `parseHeightIn`
  parses "1.7 m". Weights 1.2× Atk/SpA/Spe · 1.1× HP/SpD · 1.0× Def/Frame.
- **Career sim** (seed `|mon-career-v1`): pro battle-circuit — seasons S1..S~18 (age = season
  number; decision modal says "Season"), win rate from the whole statline, flawless **sweeps**,
  the sim's "teams" are the ten **regional Leagues** (Kanto..Hisui; type colors + league colors
  share one TEAM_COLORS map), 🏆 League titles (rings), **World Championships** (mvp), Rookie
  Cup, Iron Wall, win-rate crowns, League Hall of Fame, Trainer Draft ceremony. Tuned: 99 OVR =
  100% HOF / 1.3 Worlds; 90 = 84%; 85 = 36% (bands sit right of other games because mon OVRs
  run past 99 — a maxed build is ~120). `CAREER_MAX.mon = {w:1410, sweeps:520}` (all-130 abuse
  ceiling 1339). Sort keys `w`/`sweeps`.
- **Server/site wiring:** same checklist as hockey (both `gameOf`s, SLOT_MAX `{_default:134,
  Frame:100}`, OVR_W by label, LEGEND_CAP 5, legends from pokemon.json, hub chip, switcher,
  binder tab, `/monster` rewrite, leaderboard rows in all sibling pages).
- **v1 scope:** identical to hockey's.

> **Adding-a-game checklist** (what hockey/mon touched — the next sport follows it): data script
> → figure+masks scripts → page transform → sim harness verify → `api/score.js` (gameOf,
> SLOT_MAX, OVR_W, LEGEND_CAP, legendSet, CAREER_MAX, SORT_FIELDS) → `api/account.js` (gameOf,
> collectionSync GAMES) → `collection.js` GAMES → `switcher.js` (GAMES/ORDER/pageGame/dailyGame)
> → `index.html` (GAME/SPORTS/copy) → `vercel.json` rewrite → every sibling page's SORT_OPTIONS/
> LB_SPORTS/lbGame whitelist/GAME_LABEL/FIG_CONFIG/shared-path map.

---

## 🐐 GOAT Squad (LIVE 2026-07-17) — `goatsquad.html` at `/goatsquad`, game key `goatsquad`
Roguelike slot-machine **roster builder** (a different genre from the build games — no figure, no
career sim). Front door: **squad.goat-lab.app** (root 307-redirects to `/goatsquad`). Hub tile on
every sport in `index.html` (replaced the dev-era "Roster Rush" tile — that was this game's old
name, which is why **every localStorage key is `pl_rr_*`** (`pl_rr_day/gauntlet/bossSeen/mute/name`)
and internal CSS/fn names say `rr-`).

- **Sport-agnostic engine + config split:** ALL game content — brand, slots, spin speed, rarity,
  coaches, bosses, gauntlet map/shop/relics/economy, sim constants, tier bands, team colors — lives
  in **`goatsquad-nba.json`** (`GAME_CONFIG_URL` const at the top of the HTML). A new sport (NFL/NHL)
  = a copy of that JSON + a clone of the HTML pointing at it; zero engine changes. The config reads
  the existing **`/ballers.json`** through a declarative `adapter` (poolKey/legendsKey/field maps;
  `primaryPositionOnly` → a "PG / SG" player belongs ONLY to the PG slot).
- **Core loop:** 7 slots (PG/SG/SF/PF/C · 6TH MAN any-position weight 0.75 · COACH −5..+5 mod).
  Every open slot spins at once (fixed **10 faces/sec, NO easing — STOP timing is a learnable
  skill**), STOP freezes all → **tap-lock exactly ONE** → rest respin. One **mulligan** after the
  last lock (drop one + respin, STOP locks instantly, ratings stay hidden). Team OVR = weighted avg
  + coach mod, **unclamped**. Taps use the `onTap` helper (pointerup within 12px — a drag scrolls,
  never picks); the STOP buttons fire on **pointerdown** on purpose (latency = skill).
- **Determinism:** reels are fixed 512-entry sequences drawn up-front (FNV-1a→mulberry32);
  `run.tick` only advances while spinning, so pauses don't desync. **Daily** seed
  `pl-daily-<local date>-goatsquad-v1` → same reels + boss worldwide; attempts count **at start**
  (no refresh-scumming); the boss series RNG is seeded from date+attempt+ovr. Boss rotates daily
  through the 16-team `bosses` list. **Gauntlet spins are Math.random** (not seeded).
  Rarity: banded weights + `legendMult` 0.2; a **legend pity timer** (gauntlet only, 18 dry stops)
  forces a legend onto an open position slot; legends are filtered out of the 6th-man slot unless
  they'd be wasted otherwise (`sixLegendOk`).
- **Boss series:** first to 4. Per-game P(win) = .5 + (ovr−boss)·`perGameSlope .04` + momentum
  (.09 × games trailing), clamped [.1,.9]; **down 3–1 = +25% comeback boost, +50% if LeBron is on
  your squad** (`comeback.hero`), pierces the cap to .95. Boss abilities: `bossElimEdge` ('96
  Bulls), `bossFirstGameEdge` ('17 Warriors), `noPlayerMomentum` ('13 Heat), `bossComeback` ('16
  Cavs), `ovrDebuff` ('04 Pistons — hits the sim, not the display). Cinematic GSAP playthrough:
  quarter checkpoints with lead-swing shaping (`addSwing` — most games see a lead change), box
  scores (points share ∝ rating^1.6), star lines, elimination-game flashes, ⏩ skip once you've
  seen one series. Result screen ends with a **scouting report** (`buildTips` — trash-talk lines
  incl. "the wheel offered X and you never grabbed him", computed from what actually flew past).
- **The Gauntlet (roguelike mode):** 10-layer map in config `layers` (8 fights + 2 shops; 1-key
  layer = straight road, 2-key = **fork** (tap a city — safe vs harder-with-better-spoils), `'shop'`
  = traveling shop), plane flies you city to city. Build the squad ONCE at fight 1; it persists in
  `pl_rr_gauntlet` (forever, not daily). **One life** — a series loss wipes the run (`freshG`),
  no refresh-scumming. Beat a team → **victory spoils wheel**: their era-rated roster (Ray Allen is
  87 on the '08 Celtics, 79 on the '13 Heat), sign one by cutting the position incumbent or 6th man
  (squad stays 7) — or pass. **Relics** ride that wheel (`relicChance` .25/card, **max 5**, land more →
  swap): 20 per sport (2026-07-22 StS/Balatro pass added 11 — restrictions/scalers/gambles). Simple
  types: elimEdge/noMomentumDrag/gameEdge/gameWinCash/interestCap/shopDiscount/upsetMult(×3 upset
  pay)/ovrBoost/firstGameEdge. Stateful/rule types resolve through **`relicEffects()`** (ONE resolver
  under relicSum/relicHas — every caller inherits new relics): noRingers/proveIt (OVR + a rule),
  cityCash (Piggy Bank — dies on first shop buy via `shopSpent()`), dynasty/egg/bandwagon (counters
  on `r.state`, settled post-payout in the result screen), rentalStar (25% walk roll/win), moodSwings
  (deterministic ±, football = two-act half/final variant), deepPockets (cash→win%, capped),
  copycat (mirrors newest by `r.seq`), poacher (next-route-team player rides the spoils wheel).
  Egg hatches only into pure-upside weight-1 relics (never restrictions). All gauntlet-only —
  the Daily stays byte-identical.
- **Run variety (2026-07-22, same pass):** `ensureLadder()` rolls a **rotating ladder** per fresh run
  (band-matched ±2 swaps across the whole `gauntlet.teams` map — incl. 6-7 new hand-authored era teams
  per sport tagged by `_rotation_comment`; the FINAL TWO fights never move; mid-run saves without a
  roll keep the classic config ladder) plus ONE **⚠️ ELITE** side of one fork (`G.elite`): +2 rating,
  a granted ability (deterministic pick from `ELITE_ABILITIES`), pulsing map node + ⚠️ tags, spoils
  wheel at 60% relic cards + tripled stars + $10 bounty (inside `buzzerBonus` so live/settle agree).
  The other fork road is always the escape. **🃏 Run modifiers** (`gauntlet.mods` in config, behavior
  keyed by id in the page): every fresh gauntlet offers 3 of 5 + Standard Issue — scorched (no
  legends, +$40) / benchmob (6th-man +6, bosses +1) / headstart (free economy relic, shop +30%) /
  ironfive (no mulligan, +$60) / underdogs (reels ≤84, winnings +50%). Reel filters run through
  `buildPools(filter)` and everything is gauntlet-gated — the Daily stays byte-identical. **🏆
  Banners** (Ascension, renamed): base-table championship unlocks BANNER I–V, saved per device in
  `pl_rr_banner`/`pl_sb_banner`/`pl_fb_banner` {max,last}; picker chips on the pre-run map card;
  screws stack — +1 team rating/level, II +20% shop, III half interest cap, IV no mulligan, V no
  Insurance. Level rides `G.banner`, tags the fight kicker + boss intro, posts as `build.rr.banner`
  (shows on lb row detail + share text), unlock announced on the champion result screen + a howto
  bullet on all three pages. Football variants: two-act Mood Swings and a 2-ability elite pool.
- **Economy (Balatro-style Cap Space):** $5/game win, +$15 series, +$10 sweep, +$20 upset; interest
  on series wins ($1 per $5 held, cap $10) rewards a float. All cash rules live in ONE place
  (`payPerGameWin`/`buzzerBonus`/`interestFor`) shared by the live in-series counter and the result
  payout so they can never disagree. **Shop items:** 🛟 Insurance (one-use — a fatal loss rewinds to
  the killing game and re-flips from there), 🏋️ Training Camp +2 (max +4/player), 🎰 FA wheel,
  ✨ Relic Wheel ($65 repeatable — every card is a relic, spoils-wheel weights minus owned),
  🎟️ Second-Stop Token, 📋 Coach Carousel, 🏟️ Home Court Deed (flips the 2-2-1-1-1 pattern + 3%
  home edge), 🎓 Draft Workout (≤69 rookie who grows +1 per game win, cap 99).
- **Leaderboard:** shared `/api/score`, `game='goatsquad'`. Posts `{ovr, build:{career:{totals:{w:
  <fights beaten>}}, rr:{total, champion, cash, relics}}}`; board fetches `?sort=w` (distance
  first, squad OVR tiebreak; 👑 CHAMPION at 8/8). Submit row appears **only when the run is over**
  (death or championship — mid-run wins can't post partials). **No `SLOT_MAX['goatsquad']` →
  `checkBuild` passes through; no CAREER_MAX entry either — fully trust-the-client** (accepted,
  same posture as the rest).
- **Share card:** 1000×1230 canvas, 3×2 headshot grid + coach row + cash/fights/relics rail.
  cdn.nba.com has no CORS headers → canvas draws via the same-origin **`/nba-headshots/` proxy**
  (a `vercel.json` rewrite); in-game `<img>` tags keep the CDN. Mobile share-sheet / desktop
  download; emoji-square copy text.
- **Ads:** Playwire ramp IS on this page (full ads.md 3-piece contract) + mobile rail-containment
  CSS. ⚠️ **Louis must be told this page + the squad.goat-lab.app subdomain exist or no units
  serve.**
- **Scope:** page loads ONLY GSAP + namefilter + GA + ramp — **no accounts/XP/achievements/
  collection/quests/switcher/store** (deliberate: guest-first, own daily via `pl_rr_day`, not part
  of the cross-game daily streak).

### ⚾ GOAT Squad Baseball (built 2026-07-18, NOT yet pushed) — `goatsquad-baseball.html` at `/squad-baseball`, game key `squadball`
Baseball edition of the engine. **Generated from `goatsquad.html` by an anchored transform**
(session-scratch script, see this file's first commit) — NOT hand-cloned; regen = re-run the
transform against the current NBA engine. Config `goatsquad-mlb.json` + data `squadball-mlb.json`
(`node fetch-squadball.js` — merges batters.json + pitchers.json, pulls **secondary positions**
from The Show API, drops novelty "Home Run Derby X" cards that leak pitchers into hitter slots,
and era-patches `mlbamId` onto gauntlet rosters/managers via statsapi people-search — the '62
Mets Frank Thomas resolves to the 1951 debut, not the Big Hurt).
- **11 slots on a faint SVG ballpark** (config slots carry x/y coords; `.slot-pin` wrappers own
  the translate so GSAP scale tweens keep the button transform): C/1B/2B/3B/SS/LF/CF/RF around
  the diamond, P on the mound (weight **1.25**), DH on the bench (any hitter, weight 0.9),
  MANAGER · DUGOUT card bottom-left. STOP is static below the field (sticky covered the C row).
- **Secondary-position eligibility + hard no-duplicate guard** (the baseball-only engine deltas):
  `primaryPositionOnly:false` — a "SS/3B" player rides both reels — so `entryFor` skips names
  locked anywhere, `stopAll` dedupes the frozen board (later slots advance to the next clean reel
  entry — deterministic, daily-safe), the pity legend / FA wheel / rookie wheel / victory spoils
  all filter squad names, and the Game-7 rental handles DH-primary hires (pi −1 → DH seat).
  Name-based, so the two Will Smiths (C vs P) can't co-roster — accepted quirk.
- **Baseball series presentation:** runs (winner avg ~5.0 / loser ~2.6, max 13, no ties —
  harness-tuned 2026-07-18 after Matt's "too high"), line-score checkpoints END 3RD/6TH/8TH/FINAL,
  2-3-2 home pattern, box = H·HR·RBI per hitter (kept in the engine's pts/reb/ast fields so render
  code is untouched) + a pitcher line (IP·K·ER), FIRST PITCH copy. **Box coherence contract:**
  hits roll first, homers come out of the hits (≤ team runs), RBIs distribute to the guys who hit
  with per-player caps (HR·4 + other hits·2 + 1) and RBI ≤ runs team-wide — keeps "1-for-4 with
  6 RBI" lines impossible; ~8.6 team hits / 1.08 HR per game. Pool = current big-leaguers only
  (`fetch-squadball.js` drops FA + sub-60 cards; 1,073 pool + 215 legends). The board + STOP fit
  ONE screen (`#slotGrid` height clamps to the viewport via dvh; STOP static below the field).
- **Gauntlet ladder (Matt-approved):** '62 Mets 74 → '02 Angels 78/'05 White Sox 80 → '90 Reds 84
  (ovrDebuff "Nasty Boys") → shop → '84 Tigers 87/'16 Cubs 89 → '72 A's 90 (noPlayerMomentum) →
  '63 Dodgers 92/'29 A's 93 → shop → '98 Yankees 96 (bossElimEdge = Mariano) → **'27 Yankees 100**
  (bossFirstGameEdge). 16-boss daily rotation incl. '17 Astros (Game-1 edge) + '04 Red Sox
  (bossComeback; **comeback hero = David Ortiz**). Balance mirrors the NBA 2026-07-17 pass
  (insurance 125, rental 100/90+, weighted relics, comeback .1/.2).
- **Wiring:** `/squad-baseball` + `/mlb-headshots/:id/spots/:size` proxy (midfield.mlbstatic has
  no CORS — share-card canvas) in vercel.json; `squadball` in score.js gameOf; baseball sports'
  hub tile points here. localStorage ns **`pl_sb_*`** (NBA keeps pl_rr_*; sim-speed `pl_gs_speed`
  is shared). Verified: headless Node harness (dup guard across randomized drafts, daily
  determinism, 800-series sim stats, 300-hire rental sweep) + browser smoke on the dev server.
  ⚠️ Same Louis/Playwire note: this page + route need unit mapping.

---

## 1v1 "Face Off" mode (LIVE) — `versus.html` + `api/match.js` + `api/ably-token.js`
Live online PvP. Two real players match; one is randomly assigned **Pitcher**, the other **Batter**;
each **quick-builds** their guy under a shot clock; a seeded GSAP **at-bat** plays on both screens;
**higher Overall always wins** (tie → seeded coin). Entry points: a banner + ☰ item on `index.html`,
a `⚔️ 1v1 Live` ☰ item in both games, and the `/versus` route.

> **Real balance (22,959 matches, 2026-06-29): BATTER-favored ~53% / pitcher ~47%; avg build OVR
> pitcher 89.6 vs batter 90.2.** The old "pitcher ~54%" note (88 matches) was small-sample noise —
> the large sample shows batters win ~6 pts more because they build ~0.6 OVR higher. Check live via
> the `pvpMatchStats` curl below.
>
> **2026-06-29 pitcher-Defense fix (versus only):** pitcher `fielding_ability` was uniquely
> compressed/low (median 48 vs 60s–80s for every other slot), a guaranteed dead anchor. In
> `versus.html` we now (1) curve it onto the others' scale via `curvePitchDef` (median→~62, elite
> raw-70+ gloves → curved 95+) and (2) weight it via `defWeightP` (0.3 for average, ramps to ~1.2
> only for elite curved D). Applies to the **pitcher role only** — batter Defense is already the
> highest batter slot (median 70, well spread), so it's untouched. Sim: +0.9 avg pitcher OVR, which
> *helps* the underdog pitcher side. **Re-check `pvpMatchStats`** after post-fix games accumulate; if
> pitchers jump past ~53%, shave the `curvePitchDef`/`defWeightP` constants down.
>
> **2026-07-02 shave:** that happened — pitchers hit 54.4% reported (50k matches, avg OVR 90.8 vs
> 90.5). `curvePitchDef` shaved from `62 + (v-48)*1.5` to `60 + (v-48)*1.4` (≈ −0.3 avg pitcher
> OVR, the size of the gap); `defWeightP` untouched (shaving both overshoots batter-favored again).
> Re-check `pvpMatchStats` after post-shave games accumulate; expect pitcher-reported wins ~51–52%
> (reporting bias means it never reads exactly 50). Still high → drop the base to 58.

### ⚙️ Setup REQUIRED for a fresh deploy
- **`ABLY_API_KEY`** env var in Vercel (format `appId.keyId:keySecret`, mark **Sensitive**). Without
  it `/versus` matchmaking errors. `GOOGLE_CLIENT_ID`, `DATABASE_URL`/Neon are already set.
- **No `npm i ably`** — `api/ably-token.js` signs Ably TokenRequests with Node `crypto`; the browser
  loads Ably from CDN (`ably.min-2.js`) with `authUrl: '/api/ably-token'`.

### Realtime (Ably)
- One shared connection (`connectAbly` guarded by `ablyPromise`), reused by matchmaking AND the live
  ticker. **`echoMessages:false`** so your own published build doesn't come back as the opponent's
  (that caused an early "you vs you" bug; handlers also ignore `msg.clientId === clientId`).
- Channels: `versus:invite:<id>` (matchmaking hand-off), `versus:match:<matchId>` (in-match
  presence + `build`/`progress` messages), `versus:online` (global presence for the ticker).

### Matchmaking (`api/match.js`, table `pvp_queue`)
- Atomic claim: `DELETE … WHERE id = (SELECT … WHERE id<>me AND (pid IS NULL OR pid<>mypid) AND
  fresh ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)`. **`pid`** = `acct:<sub>` or
  `guest:<guestId>` → you can't match **yourself** on a 2nd tab/device. (To self-test, use one
  normal + one **incognito** window = different guestId.)
- Waiting is **push-based**: the claimer publishes the match to the waiter's `versus:invite:<id>`
  (waiter subscribed to its own channel) + a **3s retry** net so two simultaneous searchers still
  pair. Stale rows >60s swept; `leave` action + `navigator.sendBeacon` on `pagehide`; claimer
  re-queues after 8s if the opponent never shows.

### Quick-build (in `versus.html`)
- Per-role trimmed draft. **2-minute (120s) shot clock**; auto-fills remaining slots on timeout.
  Each open slot **previews the landed player's `+rating`**. Power-ups (one each): **Re-spin, Snag
  (L/R), Boost (Prime)**. **Grey tier excluded: `MIN_VERSUS_OVR = 65`** (`pool()` filters
  `DATA[role].pool` to `ovr >= 65`).
- Layout mirrors the normal game: **reel + Spin button on top**, then slots (tap to assign), then
  the figure (mobile-friendly; `build-grid` reordered).
- `ROLE` config object holds per-role `slots`/`weights`/`figure`/`h2r`(heightToRating)/`slotWeight`;
  `computeOvr` uses the same weights as each game. Role reveal shows a glowing team-colored
  **silhouette** (mask of the figure PNG) instead of an emoji.
- At-bat seed (`mulberry32`) drives identical flavor on both phones. **Wait-arena**: finishing first
  takes you to the arena — your glowing fighter ready, opponent's side greyed out + a **live
  progress bar** of their slots; 75s no-show → **"No Contest"** (no rating change).

### Elo + accounts (`api/account.js`)
- On `users` table: **`pvp_elo`** (start 1000), `pvp_wins`, `pvp_losses`, `pvp_streak`. Dedup table
  `pvp_results(match_id, google_sub)`.
- Each player updates **only their own** rating vs the opponent's reported `elo` (sent in the `build`
  message). **K=32**. **Win-streak bonus**: `+2` Elo per consecutive win, caps at a **5-win streak**
  (max +10); any loss resets. `nextElo()` + `STREAK_BONUS/STREAK_CAP`.
- **Guests are rated (no password):** device `guestId` + chosen `guestName` (localStorage
  `pl_guestId`/`pl_guestName`) stored in `users` under a **`guest:<id>`** key. **`pvpKey(body)`**
  resolves a request to a signed-in user OR a guest. The chosen **handle** (`guestName`) is the
  public display name everywhere (NOT the Google full name) — sent via `principal()` and saved as
  `users.name`.
- Actions: **`pvpStats`** (rating/record), **`pvpResult`** (apply result + Elo + streak + logs the
  match), **`pvpClaim`** (carry a guest rating onto a Google account on first sign-in, only if the
  account has 0 games), **`pvpLeaderboard`** (top by `pvp_elo` + the caller's rank).
- Sign-in is shared with the games via **`pl_account`** localStorage. **`login` now KEEPS the
  existing `session_token`** (`COALESCE(users.session_token, EXCLUDED…)`) instead of rotating it —
  fixes the "signed out moving between pages" bug (Google One-Tap auto-sign-in fired per page load
  and used to invalidate other tabs' tokens).

### Stats page + live ticker
- **Stats screen** (in `versus.html`): rating, worldwide rank, W/L/win-rate/games + **Top Players**
  leaderboard. Reachable from: 📊 button on matchmaking, 📊 on the result screen, and **`/versus#stats`**
  deep-link from all three hamburger menus.
- **Live ticker** on the matchmaking screen: `"X playing · Y waiting for a match"` driven by the
  `versus:online` Ably presence channel (every `/versus` visit joins on load; status =
  `idle`/`searching`/`playing`).

### Match logging + how to read win rates (table `pvp_matches`)
- Every finished match logs `(match_id, role, won, ovr, opp_ovr)` (anonymous). Read via the
  **token-gated `pvpMatchStats`** action: token = `STATS_TOKEN` env var, fallback hardcoded
  `'pl-balance-7f3a9c21'` in `api/account.js` (server-side only, safe).
- Check anytime:
  `curl -s -X POST https://pitchinglab.pitchergami.com/api/account -H "content-type: application/json"
  -d '{"action":"pvpMatchStats","token":"pl-balance-7f3a9c21"}'`

### Ghosts, friend challenges + build challenges (all 3 versus pages)
- **Ghost match**: an empty lobby offers "👻 Face a Ghost" after ~20s — a random real recent build
  from the leaderboard (`GET /api/score?action=ghost&game=&min=&max=`), Elo counts.
  Dev harness: `?ghost=1`.
- **Meet lobby (social-tab challenges, 2026-07-12)**: both sides of a friends-panel challenge
  navigate to `?meet=<challengeId>&side=from|to` — presence on Ably `versus:meet:<id>` (hoops:/
  soccer: prefix on those pages) pairs them in ANY arrival order; the `from` side generates the
  match, friendly (no Elo), 3-min no-show timeout. Replaced the fragile ?ch= handshake for
  social challenges; `?ch=` copy-links + `?lobby=1` still work. Challenges are open to ANYONE
  (server caps: 10 pending outgoing, 1/pair, 24h expiry).
- **Build challenge (`?gb=<saveId>`)**: profile build rows' ⚔️ → ghost match vs that EXACT Hall of
  Fame save (`buildGet` action; saved game key = defender role, e.g. pitcher build → you build the
  batter). Friendly, no Elo (farmable otherwise); reports `buildDefenseResult` → the owner gets a
  🛡️ held / 💥 fell notification (`notifications` table + APNs, deduped per save+challenger per
  day) surfaced by social.js's 🔔 Activity tab, toasts, and the ☰-button badge dot (20s poll).

### Known caveats (1v1)
- **Trust-the-client**: OVR, Elo, and win/loss are reported from the browser (cheatable) — same class
  as the leaderboard caveat. Harden later by validating server-side.
- All `pvp_*` tables + columns auto-create/`ALTER … IF NOT EXISTS` on first request (no migrations).
