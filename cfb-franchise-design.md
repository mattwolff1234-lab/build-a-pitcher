# College Football Franchise — design note (game key `cfb`)

> Status: **design + deterministic engine MVP, UNLISTED.** Not a clone of the baseball pro model.
> Built overnight 2026-07-14. The engine (`cfb-franchise-engine.js`) runs one full season
> start→CFP→offseason, seeded + replayable byte-identical. The interactive page is deferred (a
> 170KB franchise UI can't be browser-verified overnight); this note + the engine + the determinism
> harness are the reviewable deliverable.

## What it is (NOT the baseball model)
A **single-school dynasty**: pick one school from `cfb.json` teams and coach it season after season.
No roster of created players, no trades, no pro draft. Instead: a real **college season** — a 12-game
schedule, weekly **AP-style rankings**, **conference standings**, **rivalry games**, then the
**12-team College Football Playoff** (reusing college.html's existing CFP bracket), win the natty.
Offseason = **recruiting + transfer portal** (team strength evolves), then advance to next season.

## Why the data forces a team-strength model
`cfb.json teams` carry only `{ color, img }` — **no** conference, rivalry, or prestige. So the engine
derives everything:
- **Team strength** = a composite of that school's player pools in `cfb.json` (avg of the top QB +
  top 2 RB/WR + depth), rank-normalized to a 0–100 `prestige`. 68/69 teams have a QB in the pool.
- **Conferences + rivalries** are **hand-authored** in the engine (`CONFERENCES`, `RIVALRIES`),
  mapping the 69 real schools (Power-4 + ND + Marshall) to SEC / Big Ten / Big 12 / ACC / Independent.

## Data model (the save)
localStorage key **`pl_franchise`** shares the same multi-sport blob the other franchises use
(`{ baseball:{…}, hoops:{…}, soccer:{…}, cfb:{…} }`); the CFB slice:
```
{
  v: 1,                         // schema version
  school: "Oregon",             // chosen team (key into cfb.json teams)
  seed: <uint32>,               // fixed at franchise creation → whole dynasty is deterministic
  year: 2026,                   // current season (calendar)
  prog: <int>,                  // monotonic progress counter (franchiseSync merge, never decreases)
  prestige: 78,                 // this school's evolving strength 0-100 (recruiting/portal move it)
  history: [ { year, wins, losses, confRecord, apFinal, cfp: {...}, natty: bool } ],
  season: <current-season-state or null>,   // in-progress season (schedule, results, week)
  trophies: { natties: 1, confTitles: 2, playoffApps: 3 }
}
```
The whole dynasty is a **pure function of `(school, seed, list-of-offseason-choices)`** — no
`Math.random`/`Date.now` in the engine (same contract as the other franchises' `==ENGINE==` blocks).

## Determinism contract (must not break)
- One `seed` per dynasty, fixed at creation. Every season derives its own sub-seed:
  `seasonSeed = hash(seed, year)`. Every game derives `gameSeed = hash(seasonSeed, week, oppId)`.
  Recruiting/portal derive `hash(seasonSeed, 'portal')`.
- **No wall-clock, no Math.random in the engine.** All randomness = `mulberry32(subSeed)` (same
  helper college.html uses). Replaying a save with the same `(school, seed, choices)` reproduces the
  exact schedule, every score, the AP poll, standings, and the CFP bracket — byte-identical.
- Offseason **choices** (which recruits / portal targets a user picks) are recorded in the save so a
  replay applies them positionally, exactly like the CFB career-decision events already do
  (`|cfb-decisions-v1` fixed-draw pattern). The MVP offseason auto-resolves (no user choice) so the
  first pass is fully deterministic from `(school, seed)` alone.

## The season loop (one year)
1. **Schedule (12 games):** 8 conference games (round-robin-ish within the school's conference, seeded
   selection), 1 locked **rivalry** game, 3 non-conference games (seeded from other conferences,
   blue-blood-weighted like the CFP opponent draw). Home/away alternated deterministically.
2. **Play weeks 1–12:** each game's result from `teamStrength(us) vs teamStrength(them)` + a seeded
   variance term (upsets happen). Produces a score + a QB/RB/WR stat line for our school (reusing the
   CFP per-game stat-line helper from college.html).
3. **AP poll (weekly):** all ~69 teams carry a seeded season record; a poll orders them by
   `wins*W + prestige + qualityWinBonus`, recomputed each week. Our rank drives headlines.
4. **Conference standings:** W-L within the conference; the top-2 (seeded tiebreak) meet in the
   **conference championship** (week 13).
5. **CFP selection + bracket:** the 12-team field = 5 highest-ranked conference champs (auto-bids) +
   7 at-large by final AP. Seeds 1–4 bye. **Reuse college.html's existing 12-team CFP bracket sim
   verbatim** (win-prob from prestige/warScore/seed, blue-blood weighting, per-game stat lines, natty
   only by sweeping, runner-up on final loss).
6. **Verdict + history:** append `{year, record, apFinal, cfp result, natty}` to `history`, bump
   `trophies`, `prog++`.

## Offseason (recruiting / transfer portal — NOT a pro draft)
- **Recruiting class:** a seeded star-rating class (2–5★) whose average nudges `prestige` up a little.
- **Transfer portal:** seeded gains/losses; a marquee portal QB can bump prestige, attrition can drop
  it. Net `prestige` drift is bounded (±~4/yr) so a dynasty grows gradually, not explosively.
- MVP: auto-resolved (deterministic). v2: surface 2–3 seeded **choices** (take the 5★ QB vs the
  portal vet; redshirt vs play) recorded in the save — same halt-and-resume pattern as the career
  decision events, determinism preserved.
- Then `year++`, clear `season`, ready for the next year.

## Reuse map (what comes from where)
| Piece | Source |
|---|---|
| `mulberry32` seeded RNG + seed-string hashing | college.html (career/decision sims) |
| 12-team CFP bracket (seed, win-prob, blue-blood weighting, per-game stat lines, natty/runner-up) | college.html — **reused near-verbatim** |
| per-game QB/RB/WR stat line | college.html CFP stat-line helper |
| team prestige from player pools | new (derived from cfb.json positions) |
| conferences + rivalries | new (hand-authored, 69 teams) |
| save shape + `prog` monotonic merge + `franchiseSync` | franchise.html + api/account.js |
| `==ENGINE==` determinism markers | franchise.html pattern |

## Server
`api/account.js` `franchiseSync` (~line 1381) currently accepts `sport ∈ {hoops, soccer, baseball}`
only — **add `'cfb'`** so the CFB dynasty syncs to the account (prog-wins merge). One-line change,
already noted in the Task 3 pass. No new tables (the franchise blob lives in `users.franchise` jsonb).

## Scope tonight vs deferred
- **Tonight (built + headless-tested):** the deterministic engine — team-strength model, conference/
  rivalry data, schedule gen, 12-game sim, AP poll, standings, conference title, 12-team CFP, natty,
  auto offseason, one-season loop, plus a **determinism harness** (same save replays byte-identical).
- **Deferred (needs browser + review):** the interactive `franchise-cfb.html` page (team-select wheel,
  week-by-week UI, AP poll board, bracket viz, offseason choice cards), the `franchiseSync` client
  wiring, the hub/college.html entry points, and user-facing offseason choices. Engine is designed so
  the page is a thin renderer over it.
