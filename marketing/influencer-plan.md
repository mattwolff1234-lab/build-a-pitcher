# GoatLab — Influencer Marketing Plan

> Working doc, July 2026. Companions: `creator-targets.md` (who to contact, with rates) and
> `outreach-templates.md` (what to send them). Attribution: give every creator a link like
> `https://goat-lab.app/?ref=<code>` — the `?ref=` system (see CLAUDE.md) tags their plays,
> leaderboard builds, and daily-challenge runs; read results with
> `GET /api/score?action=refStats&token=<STATS_TOKEN>`.

## The one-liner for creators

**"Spin a slot machine of real MLB players, decide where each rating goes on the body, build a
99, then simulate his entire career."** Free, browser, no download — link in bio just works.

Why creators say yes:
- The **spin** is pack-opening dopamine — the most proven format in sports-gaming content.
- The **Daily Challenge** is the same seed for everyone → "same cards, beat my score" converts
  viewers to players in one tap. This is the Wordle mechanic; lead with it.
- **1v1 Face Off** lets a creator play their own viewers or another creator live.
- **Career cards ship with share links** (`/p/<id>` unfurls with real OG tags → "Beat this
  career" viewer) — every run ends in a shareable artifact.
- Multi-sport: baseball (pitching/batting), hoops, soccer, **college football** (fall campaign).

## Audience tiers

1. **MLB The Show / sports-gaming YouTube+Twitch** — highest conversion; these audiences already
   argue about ratings. Mid-size (20k–200k) creators are affordable and near-perfect fit.
   ⚠️ Our data derives from The Show's API but the UI says "Prime" — pitch as "real MLB
   ratings," never as a Show product.
2. **Baseball TikTok/IG** — highest reach; comedy/culture creators (ex-pros, skit accounts).
   Format = reaction content, not gameplay: "I spun MY career," "worst pitcher possible."
3. **Baseball X/Twitter** — cheap, culture-setting; runs on screenshots + arguments. Career
   cards and slot-strategy debates are native. Mostly free seeding + $50–500 paid posts.
4. **CFB creators (Aug–Sep)** — EA CFB dynasty/RTG YouTubers, recruiting/NIL accounts. Hooks:
   Signing Day ceremony, Heisman/CFP sim, NFL Draft continuation.

## Content formats to hand creators (never make them invent the video)

1. **"Beat my Daily"** — post Daily Challenge build + score; same cards await viewers. Best
   recurring format, 5 minutes of creator effort.
2. **God Squad / Cursed Squad** — best possible vs. worst possible build; the Hall of Not Good
   verdict is the punchline.
3. **Creator-vs-creator 1v1** on stream (higher OVR wins is instantly legible).
4. **"I simmed my own career"** — name the player after themselves, react to the HOF vote.
5. **Slot-strategy debate bait** (X): "97 lands — Strikeout slot or Velocity slot?"
6. **🔥 Studs tie-in** — morning-after MLB recap creators: "last night's studs are boosted
   in-game today."

## Outreach sequence

1. **Seed free first**: 30–50 personalized DMs to micros (5k–50k) with link + one suggested
   format. Expect 10–20% to post organically.
2. **Pay micro/mid only**: micro TikTok/IG $100–400/post; mid $400–1,500; dedicated mid-size
   Show YouTube video $500–2,500. Structure as **2–3 posts over 2 weeks** (Daily Challenge
   compounds), not one-offs.
3. **Spark/whitelist winners**: boost over-performing posts as Spark Ads — cheaper than fresh
   creative.
4. **Skip macros** until `refStats` proves conversion; ad-revenue-per-visit is too small for
   $5k+ posts to pay back.

## Calendar

- **Now → All-Star break:** micro-seeding wave (TikTok/X) + 2–3 paid Show-community videos.
- **All-Star week:** themed Daily content push.
- **Late August:** CFB campaign (Week 0/1) with CFB creators.
- **Sept–Oct:** playoffs tentpole — "GoatLab Invitational" 8-creator 1v1 bracket, small prize.

## Budget scenarios

- **$0:** seeding DMs + own-account cursed builds + reply-guy career cards on baseball X.
- **$1–2k/mo (recommended start):** 6–10 paid micro posts + 1 mid-tier Show video + Spark
  boosts.
- **$5k+ (only after refStats proves ROI):** creator bracket + a recurring weekly "adoption"
  sponsorship with one mid-size Show creator.

## Measurement

Per ref code, from `refStats`: plays (first spins) → leaderboard builds → daily runs (D1+
retention proxy), avg OVR, per-game split. Judge a creator on **plays per dollar** and
**dailies** (the retention signal), not impressions. Kill formats that drive plays but zero
dailies; double down where dailies stick.
