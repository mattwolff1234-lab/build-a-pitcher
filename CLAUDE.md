# Build-a-Pitcher

## What this is
A standalone browser game where you spin a horizontal slot-machine reel of MLB pitcher headshots, land on a random pitcher, and assign their rating to one of 8 attribute slots. After filling all 8 slots, your Frankenstein pitcher enters a simulated career with stats, playoffs, and milestones.

## NOT part of PitcherGami
This is a **separate project** from PitcherGami (~/pitcher-scorigami). Different game, different codebase, different deployments. They share an audience (baseball fans) and can cross-link to each other, but they do not share a database, server, or deployment pipeline.

- PitcherGami: pitchergami.com — daily guessing game about pitcher stat lines
- Build-a-Pitcher: TBD domain — spin-draft attribute game with career simulation

## Core game loop

### The spin
A horizontal slot-machine style reel shows pitcher headshots scrolling by. It auto-stops on a random pitcher. Card borders are colored by OVR tier:
- Grey: 64 and below (Common)
- Bronze: 65-74
- Silver: 75-79
- Gold: 80-84
- Diamond blue: 85+

### The choice
After landing on a pitcher, the player can:
- **Assign** — put that pitcher's rating into any open attribute slot
- **Re-spin** — discard and spin again (1 per run, gone once used)
- **Boost** — upgrade the pitcher to their "Prime" version with juiced stats (1 per run, gone once used), then assign
- You CAN re-spin first, then boost the new result (burns both power-ups on one slot)

### The slots (8 total = 8 spins per run)
| Slot | API Field | What it means |
|---|---|---|
| Velocity | `pitch_velocity` | Raw heat |
| Break | `pitch_movement` | Pitch movement |
| Control | `pitch_control` | Command/location |
| K/9 | `k_per_bf` | Strikeout stuff |
| BB/9 | `bb_per_bf` | Walk avoidance |
| HR/9 | `hr_per_bf` | Keeping ball in park |
| Stamina | `stamina` | Durability/innings |
| Clutch | `pitching_clutch` | High-leverage performance |

### After the draft
All 8 slots filled → career simulation with season-by-season stats, awards, playoff runs, milestones. (Phase 2 — build the spin loop first to validate the mechanic is fun.)

## Data source
Player attribute ratings (1-99 scale) come from the MLB The Show API:
- `mlb25.theshow.com/apis/items.json` (and mlb24, mlb23, mlb22, mlb21 for historical data)
- Free, no auth, returns JSON
- **IMPORTANT: Filter `series === "Live"` only.** Special editions (Spotlight, Finest, Summer, etc.) have inflated stats. Live = real-world accurate ratings.
- "Prime" versions for the Boost power-up use the special edition cards (highest OVR non-Live card for that player). Do NOT reference "MLB The Show" in the game UI — call them "Prime" versions.
- Player headshot images available via `baked_img` field
- `is_hitter: false` to filter pitchers only
- `display_position` for SP vs RP

## Tech stack (planned)
Same patterns as PitcherGami:
- Backend: Node.js on Railway
- Frontend: Static files on Vercel
- Database: TBD (sql.js SQLite or similar)
- No React, no build step — single-file SPA pattern

## Build & deploy
Same as PitcherGami: compile to dist/, commit dist/ with src/ changes, Railway auto-deploys on push to main.
