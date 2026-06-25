# Build-a-Pitcher

A browser game: spin a slot-machine reel of MLB pitchers, assign each to one of 8 body-mapped
attribute slots, and build the highest-rated Frankenstein pitcher. Finish a run to name your
pitcher and post it to a global + daily leaderboard.

## Stack
- **Frontend:** single static `index.html` (no build step) + GSAP (CDN). Game data baked into `pitchers.json`.
- **Leaderboard:** `/api/score` Vercel serverless function → Neon Postgres.
- **Deploy:** Vercel (static + serverless functions).

## Local data build (one-time / refresh)
```
node fetch-data.js            # pull MLB The Show ratings -> pitchers.json
node fetch-wiki-headshots.js  # fill remaining headshots from Wikipedia (verified)
```

## Run the game locally (no leaderboard)
```
npx serve .
```
The leaderboard needs the deployed API; use `vercel dev` once linked to test it locally.

## Leaderboard
- `GET /api/score?scope=global|daily&limit=50` — ranked rows
- `POST /api/score` — `{ name, ovr, build }`

Neon connection comes from the Vercel↔Neon integration (`DATABASE_URL`). The table is created
automatically on first request.
