# `scrape-x-tweets.js` — viral sports-game tweet scraper

Pulls, de-dupes, engagement-ranks, and digests viral tweets from the X API v2,
tuned for the **"perfect-season / build-a-team" browser-game genre** Pitching Lab
lives in. Two buckets:

1. **Announcement tweets** — a dev launching a game (*"Inspired by 82-0, I built a
   baseball variation…"*). The launch template worth copying for a Lab drop.
2. **Quote-tweets & reactions** — people posting their teams, roasting the game,
   *"can you go 82-0?"* dunks. The organic spread.

## Quick start

```bash
# App-only Bearer token from developer.x.com → your app → Keys and tokens
export X_BEARER_TOKEN="AAAA…"

node scrape-x-tweets.js                 # recent (7d), relevancy-sorted, cap 300
node scrape-x-tweets.js --dry-run       # preview the 28 queries, no token needed
node scrape-x-tweets.js --archive --since 2026-05-01   # full history (Pro/Ent)
node scrape-x-tweets.js --all-langs --max 800          # incl. 7a0 Portuguese
```

Writes two files (git-ignored — regenerate anytime):
- **`x-tweets.json`** — structured records: author + follower count, full text,
  all engagement metrics, category, detected game, and the quoted tweet if any.
- **`x-tweets-digest.md`** — readable digest: top announcements, top quote-tweets,
  other high-engagement mentions, and a per-game breakdown table.

## Access tiers (search needs a paid plan)

| Tier | Search | This script |
|---|---|---|
| **Free** | ❌ none | 403 — can't search (the script tells you) |
| **Basic** ($200/mo) | recent (~7 days), ~15k tweets/mo | default mode ✅ |
| **Pro / Enterprise** | full archive back to 2006 | `--archive` ✅ |

The `--max` flag caps how many tweets you pull so you don't burn the monthly cap;
raise `--pages` to paginate deeper per query.

## The genre map (what to search — already wired in)

The June 2026 viral wave was one family of games. All are in `GAMES` in the script:

| Game | Sport | Site(s) |
|---|---|---|
| **82-0** | NBA | 82-0.com — *the one that "broke NBA Twitter"* (Roy Saar / PlayVault); Haliburton, Brandon Jennings, Le Batard, Nick Wright all posted |
| **162-0** | MLB | 162-0.com, mlb162-0.com, diamond-draft.app, pennantchase.com — **your lane** |
| **17-0** | NFL | perthirtysix.com |
| **38-0** | Premier League | — |
| **7a0** | World Cup | 7a0.com.br (Brazilian; run `--all-langs`) |
| **98-0 / 20-0** | NHL / fantasy FB | 20-0.com |
| **build-a-player** | generic | the naming your own game shares |
| **73-9 / 36-0** | *(you named these)* | 73-9 is the Warriors-record meme, not a confirmed game; 36-0 unconfirmed — kept as low-signal terms |

## The announcement template (the marketing takeaway)

The clone wave spread through a repeatable launch tweet. Real example found in
recon — **@will_herb_stone**:

> *"Inspired by 82-0, I built a baseball variation where you select players to
> build the perfect team. Let me know what you think!"* + link + screenshot

Pattern = **`"Inspired by <viral original>, I built a <your-sport> version"` +
one-line hook + screenshot + link**. The `announce:inspired-by` and
`announce:i-built` queries are built to surface exactly these across the genre so
you can study the highest-engagement phrasings before a Pitching/Batting Lab push.

## Scoring

`viralScore = likes + 2·retweets + 3·quotes + 0.5·replies` — quote-tweets weighted
hardest because "look at my team" quote chains are this genre's actual virality
engine. Everything in both output files is sorted by it.

## Tuning

- `--min-likes N` — drop noise below a like threshold.
- `--query "..."` — add one raw X query on top of the 28 built-ins (e.g. a
  specific creator's handle: `from:will_herb_stone`).
- `--recency` — newest-first instead of relevancy (good for monitoring a live launch).
- Bare-score terms (`17-0`, `20-0`, `38-0`) are paired with context words in the
  script to avoid matching every final score on X; the `url:` queries are the
  precise ones. Tighten `CTX` / `GAMES` in the script if precision/recall drifts.

## Sources (genre recon)

- [How 82-0 Broke NBA Twitter — Complex](https://www.complex.com/bets/a/matt-burke/82-0-nba-twitter-viral-game)
- [Can you go 82-0? NBA players try the viral game — ESPN](https://www.espn.com/nba/story/_/id/48976391/82-0-viral-game-tyrese-haliburton-milwaukee-bucks-trey-murphy)
- [How did 82-0 go viral? We talked to its creators — PHLY](https://allphly.com/76ers/82-0-nba-game-starting-lineup-viral-interview/)
- [17-0 NFL game — PerThirtySix](https://perthirtysix.com/nfl/17-0)
- [How to play the viral 38-0 Premier League game — HITC](https://www.hitc.com/footballs-wordle-how-to-play-the-viral-soccer-game-that-is-all-over-social-media/)
- Will Stone's 162-0 announcement tweet (`@will_herb_stone`) — the template in the wild
