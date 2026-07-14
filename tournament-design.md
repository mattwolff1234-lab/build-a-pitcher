# Tournaments — design spec + flagged MVP (baseball first, built game-agnostic)

> Status: **spec + deterministic engine + flagged API skeleton. FEATURE FLAG OFF by default.**
> Built overnight 2026-07-14. Deliverable = this spec + `tournament-engine.js` (headless-tested) +
> `api/tournament.js` (auto-CREATE TABLE, gated by env) + `EARN.tournament` in catalog.js. The live
> realtime bracket UI is DEFERRED (reuses the Face Off stack; can't be browser-verified overnight).

## The pitch
A **64-player single-elimination daily bracket**. Everyone in a given match gets the **identical
seeded spins**, so it's pure skill — power-up timing + slot placement. Ratings shown. **Placement
pays Goat Coins**; the **champion gets a trophy** shown on their profile. One bracket per game per
day (baseball first: `pitcher`; the engine is game-agnostic so `baller`/`striker`/etc. drop in later).

## Bracket lifecycle
```
registration window  →  lock + seed (fill to 64)  →  6 rounds of live 1v1  →  champion
   (opens daily)         (byes / ghost fill)          64→32→16→8→4→2→1
```
- **Daily id (deterministic):** `tourn-<YYYY-MM-DD>-<game>` (US-Eastern day, matching hot.js). Anyone
  who opens Tournaments that day joins the same bracket.
- **Registration:** signed-in players `register`. Cap 64 humans. Entry is free (a small participation
  coin reward makes it worth entering).
- **Lock + seed:** at the round-1 start time (or when 64 fill), the field locks. Entrants are **seeded
  by rating** (pvp Elo, else 1000) high→low into slots 1..N, then the field is **filled to 64**:
  - remaining slots take **ghost builds** pulled from the leaderboard (`GET /api/score?action=ghost`),
    seeded selection — same mechanism as the existing 1-lobby ghost matches, so every round always has
    an opponent;
  - if the ghost pool is exhausted, the slot is a **BYE** (its opponent auto-advances round 1).
  - Standard bracket bracketing: seed 1 vs 64, 2 vs 63, … so the top seeds meet late.

## Identical spins each round (the skill core)
Every match derives a **shared match seed** so both players see the byte-identical reel:
```
matchSeed(tournamentId, round, matchIndex) = FNV1a(tournamentId + '|r' + round + '|m' + matchIndex)
```
Both players in that match seed their quick-build reel from `matchSeed` (exactly like `versus.html`'s
per-match `seed`). Extends the daily-challenge shared-seed idea from one seed/day to one seed/match.
The **outcome** is decided the same way Face Off decides it: higher Overall wins, seeded coin on a tie
— **server-settled** from locked builds (`pvpLock`/`lockedTruth`), never trust-the-client. A human vs a
ghost/bye is settled by comparing the human's locked OVR to the ghost's stored OVR (bye = auto-win).

## Data model (Neon, all `CREATE TABLE IF NOT EXISTS` — no migrations)
```sql
tournaments (
  id text PRIMARY KEY,               -- tourn-YYYY-MM-DD-<game>
  game text NOT NULL,
  seed bigint NOT NULL,              -- fixed at creation → seeding + fill are reproducible
  status text NOT NULL DEFAULT 'registration',  -- registration | live | done
  round int NOT NULL DEFAULT 0,      -- current round (1..6); 0 = pre-lock
  bracket jsonb,                     -- the 64-slot seeded field + per-round results once locked
  champion text,                     -- winning player_key
  created_at timestamptz DEFAULT now()
)
tournament_entrants (
  tournament_id text, player_key text, name text, rating int, seed int,
  placement text,                    -- filled at settle: champion|runner-up|semifinal|…|round-64
  PRIMARY KEY (tournament_id, player_key)
)
tournament_trophies (
  id bigserial PRIMARY KEY, player_key text, tournament_id text, game text,
  placement text, created_at timestamptz DEFAULT now()
)
```
Per-round shared seed is **derived** (not stored) from `(tournament.seed via id, round, matchIndex)`.
Match results reuse the existing `pvp_builds` lock rows (settle from `lockedTruth`); the bracket's
`bracket` jsonb records each round's winners so the next round pairs deterministically.

## Coins by placement (server-authoritative, anti-farm)
Payouts live in **`catalog.js EARN.tournament`** (server is the only truth). One payout per player per
tournament — their **best placement** — via the idempotent ledger ref `tourn:<id>:<player_key>`
(same `grantCoins`/`coin_ledger` UNIQUE-ref pattern as `pvpWinCoins`). Settled **only on locked
truth** (a player who never locked a build earns nothing → no farming by registering and idling).
Suggested tiers (all `// TUNE`):
| placement | coins |
|---|---|
| champion | 500 |
| runner-up | 250 |
| semifinal (top 4) | 120 |
| quarterfinal (top 8) | 60 |
| round of 16 | 30 |
| round of 32 | 15 |
| played ≥1 match | 5 |
Ghost/bye slots never earn (no `player_key`). Daily cap is implicit: one bracket/day, one payout each.

## Trophies + profile
The champion (and optionally finalists) get a `tournament_trophies` row. `getProfile` returns a
`trophies` array; the profile view shows a 🏆 trophy case ("Daily Champion — Pitching Lab, Jul 15").
The engine records placement for everyone so a future "tournament history" tab is a free read.

## Reusing the Face Off realtime stack
- **Matchmaking within a round** is NOT open matchmaking — it's a **fixed pairing** (the bracket says
  who plays whom). Two paired players meet on an Ably channel `tourn:<id>:r<round>:m<matchIndex>`
  (same presence/hand-off pattern as `versus:match:<matchId>`), both seed from `matchSeed`.
- **Build lock + settle** reuse `pvpLock` + `lockedTruth` verbatim (game-typed; build-check validates).
  The tournament API reads the two lock rows for a match and advances the winner — no new trust surface.
- **No-show / clock:** a player who doesn't lock within the round timer forfeits (opponent advances);
  both-no-show → the higher seed advances (deterministic).

## Feature flag
`api/tournament.js` is gated: it returns `{ ok:false, error:'tournaments not enabled' }` unless
`process.env.TOURNAMENTS_ENABLED` is truthy. The client entry point (a hub/menu item + page) ships
behind the same flag so nothing is user-facing until turned on. **Default OFF.**

## Game-agnostic
Everything keys on a `game` string (`pitcher` first). The seed/fill/settle/coins/trophy logic has no
baseball specifics — adding basketball is: allow `game='baller'`, point ghost fill at
`?action=ghost&game=baller`, done. (Same posture as the versus `sport` param.)

## Scope tonight vs stubbed
- **Built + headless-tested:** `tournament-engine.js` — daily id, seed derivation, rating-seeded
  bracket, ghost/bye fill to 64, 6-round advancement, placement mapping, placement→coins, champion/
  trophy; a harness runs a full 8-slot AND 64-slot bracket end-to-end with ghost fill and asserts
  determinism + one-payout-per-player + a champion emerges.
- **Built (flagged, needs a live DB to exercise):** `api/tournament.js` — auto-CREATE TABLE, `register`
  / `state` / `settle` actions, coins via `grantCoins` idempotent ref, trophy insert. The coin/
  placement settle path is unit-tested against a mock DB in the harness.
- **STUBBED / deferred (needs browser + review):** the live realtime bracket UI (registration screen,
  live bracket viz, round-by-round quick-build reusing versus-cfb/versus.html, Ably per-match channels),
  the client feature-flag entry point, and the round-timer/no-show orchestration. The engine is designed
  so the UI is a thin renderer + the existing Face Off match flow keyed by `matchSeed`.
