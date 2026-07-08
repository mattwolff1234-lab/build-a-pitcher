# GoatLab — Retention & Gameplay Roadmap

> Written 2026-07-08 from a full codebase audit (all three games, versus modes, serverless APIs,
> and shipped retention mechanics). Use this as standing context for any AI assistant or future
> planning session: it records what already exists, what shipped from this audit, and the
> remaining prioritized recommendations with implementation pointers.

---

## 1. Retention stack that ALREADY EXISTS (don't re-propose these)

- **Daily Challenge** — date-seeded identical puzzle, one attempt/day (server-enforced via
  `daily_scores` UNIQUE), rotates pitcher↔batter mod-2; hoops daily is always-on. Lucky Spin days.
- **Streaks** — `pl_streak` + 🧊 freeze tokens at [7,14,30,100], calendar modal, server-merged.
- **XP / Levels** (`xp.js`) — cross-game, Pokémon-style gain HUD, 9 rank bands, account-monotonic.
  Earned per build, per career, per 1v1, and per achievement (40 / 120 challenge / per-def `xp` override).
- **Achievements** (`achievements.js`) — ~50 tiles, Minecraft-tree board, account union-merge.
- **1v1 Face Off** (`versus.html`, `versus-hoops.html`) — live matchmaking (Ably + Neon queue),
  Elo + tiers + streak bonus, rematch, friend-challenge links with 3 modes (classic/legends/hard),
  real at-bat / first-to-11 court presentation (outcome = higher OVR, decided pre-animation).
- **Leaderboards** (`api/score.js`) — global/today/daily-challenge scopes × 3 games × career-stat
  sorts, pinned "me" rank, server-side build validation (slot caps, OVR recompute, legend caps).
- **Accounts** — Google sign-in, Hall of Fame saves (max 50/game), guest identity with full merge
  on sign-in (Elo, XP, achievements, streak calendar, collection).
- **Hard Mode** — landing-page toggle, hides ratings until finish.
- **PWA manifest + install prompts** (but NO service worker yet — see §3).
- **GA4 KPI events** + Vercel analytics; Playwire ads.

## 2. SHIPPED from this audit (branch `claude/game-retention-improvements-33nylu`, merged to main)

### Share loop
- **`share-card.js`** — canvas-rendered career-card PNG (pure primitives + emoji, never taints)
  → native share sheet (`navigator.share` files) → desktop fallback download + link copy → last
  resort X text intent. `📤 Share this card` button on the career card in all 3 games.
- **`/p/<id>` share links** — `api/share.js` + vercel rewrite. Crawlers get per-build OG tags;
  humans redirect to the game with `?b=<id>`. Backed by `GET /api/score?action=build&id=`
  (immutable rows, CDN-cached).
- **Beat this career** — `?b=<id>` opens the shared career card in-game; accepting arms
  `beatTarget`; after your own career a win/lose strip renders (higher OVR, WAR tiebreak).
  GA4: `share_card`, `shared_view`, `beat_start`, `beat_result`.

### Collection ("The Binder")
- **`collection.js`** — every assigned player collected forever (best tier, use count, prime/legend
  flags). Binder modal: per-game tabs, rarity sections, ??? tiles, % complete vs full pool (pools
  cached in `pl_col_pool_<game>`). NEW badge on landed panel. localStorage `pl_collection` +
  `collectionSync` (users.collection jsonb, union merge, never-wipe — mirrors achSync).
- Achievements: `collect1/2/3` (25/150/400) + **`collect_all` "Gotta Catch 'Em All"** (complete one
  game's full pool, name-verified; 10,000 XP jackpot; meta-excluded from Completionist).

### QoL fixes
- **Tap-to-stop reel** — Spin button becomes ⏹ Stop mid-spin; result decided at spin time so
  stopping is pure time-savings (RNG untouched → daily stays identical for everyone).
- **⏩ Skip to verdict** on career playback (rows/headlines still render; sounds muted while skipping).
- Removed dead mod-3 `dailyGameFor` from the baller (its daily is always-on by design).

~~Known gap~~ FIXED 2026-07-08: Snag is now deterministic in the Daily Challenge. Only the two
snag-able neighbor cards (`targetIndex ± 1`) are seeded — keyed `pl-daily-snag-<date>-<landed
player>` so the main dailyRng stream (and the day's landing sequence) was untouched by the deploy.
The other 42 strip fillers remain cosmetic-random by design.

## 3. RECOMMENDED NEXT — Tier 1 (highest impact per effort)

### 3.1 Service worker + streak-at-risk push notifications  ⬅ biggest remaining lever
No SW exists at all (grep: no `serviceWorker.register`). Plan:
- Minimal SW: cache-first for static assets (site is static files — trivial), network-only for `/api/*`.
- Web Push with VAPID — sign with Node `crypto` (same hand-rolled pattern as `api/ably-token.js`,
  no npm dep). New `push_subs` table + `api/push.js` (subscribe/send). A Vercel cron (vercel.json
  `crons`) sends two notification types only: "🔥 streak expires in N hours" (needs last-played
  date + tz offset stored per sub) and "🎯 today's daily is live" (opt-in).
- Prompt for permission AFTER a streak milestone toast (highest motivation moment), never on load.

### 3.2 Daily quests (3/day)
Rotating micro-goals ("Assign a Legend", "Finish 85+", "Win a 1v1"), date-seeded like the daily
reel, paying XP direct via `XP.award`. Reuses achievement-engine UI patterns; localStorage +
optional server echo. Turns one daily session into two or three.

## 4. Tier 2

- **Ghost opponent for the empty 1v1 lobby** — after ~20s in queue, offer a match vs a real recent
  build from `pvp_history`/`scores` (labeled GHOST, reduced/no Elo). The at-bat is already a seeded
  playback of a pre-decided outcome (`versus.html` `playAtBat`), so a ghost needs zero new game logic.
  This is the known "empty-lobby" churn point.
- **Monthly Elo seasons** — season key computed from date at request time (no cron), soft squash
  toward 1000 on first game of a new season, season badges. Zero "season" logic exists today.
- **Titles / card-frame flair** — equip titles earned from achievements/streaks/seasons, shown on
  leaderboard rows + versus name tags. Makes existing progression socially visible.
- **Team choice** — draft team is currently seeded-random (`randTeamAb(draftRng)`). Offer a seeded
  3-team choice ("free agency day") so fans can rep their team; pick becomes part of the sim seed
  to preserve determinism. Career cards get more personal → better shares.
- **Offline friend challenges** — challenge links currently require the friend online (Ably-only,
  `sendChallengeRequest` gives up after ~12s). Store pending challenges in a table, surface on next
  visit; notify via push once 3.1 ships.

## 5. Tier 3 (bigger bets)

- **Career decision points** — 2–3 seeded choice nodes (contract: loyalty/ring-chase/max money;
  injury: surgery/pitch-through; retirement: walk away/one more year). Choices join the seed so
  determinism + shareability survive. Natural replay hook.
- **Weekly mutators** — rotating rule-of-the-week (Legends Weekend, Budget Build, Blind Friday)
  with its own weekly leaderboard scope (only global/daily exist today).
- **New power-ups + registry refactor** — power-ups are hardcoded flags/buttons/handlers; refactor
  to a small registry, then add e.g. Scout (peek next spin) and Swap (exchange two placed ratings).
- **Public profile pages** (`/u/<name>`) — level, Elo tier, season badges, best cards, binder %.

## 6. Implementation notes for assistants

- Three near-identical game files: `pitcher.html` (route `/pitching`), `build-a-batter.html`
  (`/batting`), `build-a-baller.html` (`/hoops`). **Any game-loop change must be ported to all
  three** — anchors/function names match, stats/labels/seeds differ.
- Shared drop-in modules loaded `defer`: `achievements.js`, `xp.js`, `collection.js`,
  `share-card.js`. Pattern: IIFE → `window.X`, injected CSS, localStorage + account sync action in
  `api/account.js`, `signOut()` clears local, storage-event listener for cross-tab sign-in/out.
- Serverless: CommonJS only (no `type:module`), Neon via `findConn()` prefix-agnostic scan, tables
  auto-create/`ALTER IF NOT EXISTS` in each file's `ensure()` — no migrations.
- No build step; GSAP via CDN; single quotes; 2-space indent; comments explain design rationale.
- Headless verification harness (recreate if needed): static server + `/api` stubs + gsap shim
  (CDNs are blocked from the sandbox browser), Playwright against system Chromium; drive the game
  by calling `state`/`assign()`/`$('simBtn').click()` directly in page context.

## 7. Measurement

GA4 events already wired: activation/virality/retention KPIs plus (new) `share_card`,
`shared_view`, `beat_start`, `beat_result`, `collection_open`. For each launch above, define the
target metric first: push opt-in %, D7 streak survival, shared-link → new-session conversion,
binder open rate, queue-abandon rate (ghost matches).
