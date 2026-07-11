# OVERNIGHT TASK — Build "College Football Lab" (QB / RB / WR spin-reel game)

Read this whole file before doing anything. This is a handoff from a previous session that did
the data-source recon. You are in **overnight mode** (see the user's global CLAUDE.md): fully
autonomous, NO questions, NO plan confirmations, commit a checkpoint after each finished task,
**NEVER git push**, finish with a MORNING REPORT.

## What Matt asked for (his words, condensed)
- A **college football version** of the existing build-a-player games — **college only**.
- **Three build types in one game: Quarterback, Running Back, Wide Receiver.**
- Stats from **EA Sports College Football 27** (the new game that just came out, July 2026).
- "Make it just like the other ones, but **only do the spin reel for now** — don't worry about
  the other game modes." → Build the core draft loop (spin → land → assign to body slots →
  weighted OVR → finish screen). SKIP: versus/1v1, daily challenge, franchise, hot studs,
  achievements wiring. Career sim: include a lightweight college one only if it's cheap
  (4 seasons, Heisman / natty / NFL-draft-verdict flavor) — otherwise a simple OVR verdict
  screen is fine for v1. Leaderboard wiring is stretch, not required.
- Ship fast. Commit checkpoints locally; Matt reviews and pushes in the morning.

## Repo context (C:\Users\mattw\build-a-pitcher)
- Family of single-file games: `pitcher.html`, `build-a-batter.html`, `build-a-baller.html`
  (NBA), `build-a-striker.html` / `build-a-keeper.html` (soccer). All cloned from each other;
  all dark/broadcast-HUD themed already (that IS the look — no separate "night mode" needed).
- **Best clone source: `build-a-baller.html`** (soccer games were cloned from it too).
- Data bake scripts pattern: `fetch-footballers.js` (EA drop-api, plain Node, pages 100 at a
  time with browser-ish headers) → bakes JSON like `{pool, prime, legends, teams}`.
- Figures: flat silhouette PNG + per-slot feathered masks (`make-striker-figure.py`,
  `make-striker-masks.py` = threshold→crop then Voronoi+feather; anchors live in each game's
  SLOTS array ax/ay). Python + PIL are installed and the pattern is proven.
- Multi-role-in-one-page precedent: `versus.html` has a `ROLE` config object (per-role
  slots/weights/figure/heightToRating). For 3 positions in ONE page, use that pattern: a
  position-select screen up front sets the active config, then the normal draft loop runs.
- Routes live in `vercel.json` rewrites; landing hub is `index.html` + `switcher.js`
  (sport chips). Wiring the new game into those is a LAST step, only if everything else works.
- `node_modules` exists; no build step anywhere; GSAP via CDN.

## DATA SOURCE — where the previous session got to (do not redo this recon)
Goal: EA Sports College Football 27 player ratings (QB/RB/WR) with per-attribute stats
(speed, throw power, accuracy, catching, break tackle, etc.), name, school, class, height.

1. **EA drop-api** (the API behind ea.com ratings hubs, same one the soccer fetch uses):
   - `https://drop-api.ea.com/rating/ea-sports-college-football?locale=en&limit=100&offset=0`
     responds **200 but `{"items":[],"totalItems":0}`** — tried iteration/team/classLevel/
     gender/title params, all empty. `locale` must be plain `en`.
   - `https://drop-api.ea.com/rating/ea-sports-college-football/filters?locale=en` **DOES
     return real CFB27 data**: 6 conference teamGroups with team ids + crest PNGs on
     drop-assets.ea.com, `classLevels` [Sophomore/…], but `iterations: []` and
     `positions: []` — the player items just aren't seeded (or need an iteration value that
     doesn't exist yet). EA may be mid "ratings week" staggered reveal.
   - `https://drop-api.ea.com/rating/madden-nfl?locale=en&limit=1` works fully (99 Ja'Marr
     Chase, full attribute schema incl. playerAbilities) — proves headers/format are right.
     Headers used: User-Agent Mozilla/5.0…Chrome/126, Accept: application/json,
     Origin/Referer https://www.ea.com. Plain curl/Node fetch works — no Cloudflare fight.
   - The ratings page JS confirms the client calls exactly `GET /rating/<franchiseSlug>` with
     params (chunk 9625: `url:"/rating/".concat(e)`), so there's no hidden endpoint — the
     dataset itself is empty/gated right now.
2. **Next recon step that was about to run** (a permission prompt killed it): load
   `https://www.ea.com/games/ea-sports-college-football/ratings` in **headless Chrome with
   `--log-net-log`** and grep the netlog for `drop-api.ea.com/rating/` URLs to capture the
   exact query (and whether the page shows players at all right now, or a "ratings reveal"
   teaser). Command shape:
   `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu
   --user-data-dir=<scratch>/cdp-profile --log-net-log=<scratch>/netlog.json
   --virtual-time-budget=25000 --timeout=30000 <url>`
3. **Fallbacks if drop-api stays empty** (in order):
   a. Re-poll drop-api a few times across the night (EA may flip it on — it's launch week).
   b. Community ratings dumps: search for "College Football 27 full player ratings
      spreadsheet/database" (Operation Sports forums, r/NCAAFBseries, maddenratings.weebly.com
      does CFB too, sites like cfbratings / ratings.football). Verify the dump has
      per-attribute stats, not just OVR.
   c. If only CFB **26** full data is findable tonight, ship v1 on CFB 26 ratings with the
      pipeline pointed so a one-line slug/URL swap upgrades to 27, and flag it loudly in the
      morning report. (Matt explicitly wants the new game's stats, so 27 > 26, but a working
      game on 26 data beats nothing — his call in the morning.)
   d. ESPN/CFBD real-world stats as synthesized ratings — LAST resort, lots of work, avoid.

## Design decisions already made (stick to these)
- One new page (suggest `college.html`, route `/college` or `/cfb`), cloned from
  `build-a-baller.html`, with a **position-select screen** (QB/RB/WR) that sets a
  POSITIONS[key] config (slots, weights, figure, seg prefix) before the draft starts.
- ~9 slots per position mapped to EA attributes + a **Frame** slot from height (reuse
  `heightToRating` pattern). Design each position's slot list from whatever attribute schema
  the data source provides (Madden schema is the best preview: speed, acceleration, throw
  power, short/mid/deep accuracy, break tackle, carrying, catching, route running, jumping,
  awareness…). Weights: 1.2× the position-defining 2-3 stats, 1.1× secondary, 1.0× Frame/rest.
- Tiers/odds/power-ups (Re-spin, Snag, Boost): copy the baller behavior. If no special-edition
  "Prime" cards exist in the data, synthesize Primes (+6/slot, ovr+5) like fetch-ballers/
  fetch-footballers do.
- Teams = college programs from the data (crests available from the filters endpoint's
  teamGroups). Jersey tints: hand-map colors for the ~30 famous programs, name-hash palette
  for the rest (see `POOL_CLUB_COLORS` precedent in the soccer games).
- Figures: 3 silhouettes (QB throwing, RB running, WR catching). Options in order: (1) draw/
  compose simple solid silhouettes with PIL (football player with helmet reads fine as a
  silhouette), (2) reuse ONE generic figure for all three positions to ship, differing only in
  slot anchors. Don't block the whole game on art — a shipped game with one shared figure
  beats an unshipped one with three.
- College-only guard: the CFB27 data is inherently college-only; just don't merge any NFL/
  Madden players into the pool.
- No ads work, no `vercel.json` head changes beyond the route (read `ads.md` before touching
  page <head> if cloning brings ad tags along — SAFEST: strip the Playwire ad-tag block from
  the clone for v1 so a bad head change can't break the ads contract; note it in the report).
- localStorage keys: use a `cfb` game key so nothing collides.

## Overnight rules recap (from Matt's global CLAUDE.md + this thread)
- Dangerous-skip/bypass permissions is set in `.claude/settings.local.json`
  (`permissions.defaultMode: "bypassPermissions"`) — a fresh session inherits it.
- Commit after each finished task ("commit" is pre-authorized; end messages with the
  Co-Authored-By line). NEVER push, never force-push, never rewrite history.
- Verify each piece before moving on: `node --check` extracted scripts, `python -m
  http.server` + curl smoke tests, run the fetch script and sanity-check counts/shapes.
- If something is impossible tonight (e.g., zero usable CFB27 data anywhere), don't sit
  blocked: build everything data-agnostic, wire a placeholder pool from the filters teams, and
  explain exactly what's missing in the report.
- MORNING REPORT at the end: what's ready, what was skipped and why, every judgment call,
  what needs Matt's eyes before pushing live.
