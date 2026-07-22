# Reddit playbook — GoatLab

> Post drafts + the rules that govern them. Built 2026-07-22 from a verified research pass
> (see the "What's verified" box) plus direct observation of how 20-0.com structures its
> hooks. **Read `## Non-negotiables` before posting anything.**

## What's verified vs. what's judgment

**Verified (quoted from source):**
- Reddit has **no sitewide ban on self-promotion** — its own mod docs say *"promotional content is
  not inherently considered to be spam."* Per-subreddit rules are the only binding constraint.
- There is **no sitewide 9:1 rule.** The only official number is an optional *"10% rule"* that
  *some* communities adopt.
- **r/CFB is dangerous.** Rule 6: posting external links *"for the primary purpose of generating
  income is forbidden and may result in an account suspension, ban and/or a domain ban."* It also
  requires you to comment in the sub before posting at all. GoatLab runs ads → in scope. A domain
  ban blocks **goat-lab.app sub-wide**, not just one post.
- **r/playmygame** exists for exactly this: *"freely playable games… so long as users can click a
  link and play it."*
- Mass-posting the same link across subs is a **sitewide** violation (suspension risk), and using a
  shortener to dodge a domain block is explicitly reportable.
- Subs can **silently filter** new/low-karma accounts (Reputation filtering, Crowd Control). Your
  post goes to a mod queue and **you are never told.**
- **Wordle's grid was invented by a player**, and Wardle shipped the share text **without a URL**
  on purpose: *"it feels spammy… they were sharing for themselves."*

**Refuted — do not repeat these:**
- ❌ "Immaculate Grid went viral from one r/baseball post." The sharper inflection followed a big
  baseball Twitter account, and its user counts are founder-supplied round numbers.
- ❌ "r/CFB bans user-made games." The real risk is the income-link rule, which is narrower but worse.

**Unverified — check the sidebar yourself:** every sub below except r/CFB and r/playmygame.

---

## Non-negotiables

1. **One real account.** Never a throwaway, never a second account to re-post something removed.
2. **Disclose in the first line.** "I made this" / "my side project." Undisclosed ownership is what
   makes something astroturfing.
3. **Different title and body every time.** Never the same week. Copy-paste across subs is the
   exact pattern that triggers sitewide spam enforcement.
4. **If a post is removed: stop.** Do not repost, do not shorten the URL, do not try another sub
   that day. Message the mods politely or move on.
5. **Answer every comment.** A dev replying in the thread is the single biggest credibility signal.
6. **Tier 2/3 = no link in the body.** Let people ask. "What's it called?" in the comments is worth
   more than a link in the post.
7. **Check yourself for a shadowban** before investing weeks: post a link, then view the thread in
   a logged-out incognito window. Invisible = you're filtered.

---

## Real stats to use (pulled 2026-07-22 — re-pull before posting, these drift)

| Board | Builds posted | Top OVR | Cutoff for top 200 |
|---|---|---|---|
| Batter | 46,455 | 112 | 107 |
| Pitcher | 28,556 | 106 | 101 |
| Baller (NBA) | 11,880 | 110 | 103 |
| Striker | 2,294 | 103 | 98 |
| College FB | 3,535 | 93 | 91 |
| Hockey | 1,535 | 97 | 92 |

**Career-sim record on the pitcher board: 7,403 strikeouts.** Nolan Ryan's real record is 5,714.
That gap is a post all by itself.

Re-pull anytime:
```bash
curl -s "https://goat-lab.app/api/score?scope=global&limit=200&game=batter" | head -c 400
curl -s "https://goat-lab.app/api/score?scope=global&limit=3&game=pitcher&sort=k"
```

---

## The hook patterns that work

Observed in how 20-0.com frames itself, and consistent with the verified Wordle/Poeltl evidence:

- **Challenge + rarity stat.** "Can you go 20-0? *Only 4% go undefeated.*" A hard target plus a
  number that proves it's hard. GoatLab's native version: the 99 OVR ceiling, or the top-200 cutoff.
- **Same puzzle for everyone.** The daily's whole social value is that your result is comparable
  to mine. Say so explicitly.
- **Yesterday's answer as recurring content.** A reason to post again tomorrow without it being an ad.
- **The machine disagrees with you.** Sim output that contradicts fan consensus is free argument.
- **Lead with the artifact, not the app.** A result, a stat, a screenshot. The game is the answer to
  "where's this from," not the subject of the post.

---

# TIER 1 — links allowed (sanctioned discovery subs)

*r/playmygame, r/WebGames, r/browsergames, r/incremental_games, r/IndieDev, r/SideProject.
Verify each sidebar; several require flair, a feedback exchange, or minimum account age.*

**1. r/playmygame — the straight ask**
> **Title:** 7 sports, one weird mechanic: you spin a slot reel of real athletes to build a player, then sim their whole career
> **Body:** I made this. The core loop is a slot machine of real pros — whoever you land on, you assign their rating to one attribute of your own player (Velocity, Power, whatever the sport uses). Fill every slot, get an Overall, then the game plays out their entire career: season stats, awards, Hall of Fame vote. Free, no signup, runs in the browser. Looking for feedback on the first 60 seconds specifically — I think the reel needs a better explanation but I've stared at it too long to tell. Happy to play and comment on yours.

**2. r/WebGames — lead with the strangeness**
> **Title:** Free, no signup: draft real MLB pitchers into your own pitcher's body, then watch his 15-year career and Hall of Fame vote play out
> **Body:** Each body part is an attribute. Land on deGrom, decide whether he's your Velocity or your Command — you only get one of each pro. Then it sims the career off whatever you built.

**3. r/browsergames — the daily angle**
> **Title:** Made a daily sports puzzle where everyone in the world gets the exact same cards — today's took me three tries to not waste the legend
> **Body:** Post your result block if you play, curious how differently people slot the same cards.

**4. r/incremental_games — GOAT Squad, speak their language**
> **Title:** Built a roguelike where you stop spinning reels to lock a dream team, then survive a gauntlet of the greatest teams ever
> **Body:** Run economy has interest on held cash (Balatro-style), relics that modify series odds, one life per run. Would love balance feedback — I think insurance is overpriced at 125 but I'm too close to it.

**5. r/SideProject / r/IndieDev — the number is the hook**
> **Title:** 1.3M pageviews/month on a browser sports game, solo, no marketing budget — here's what actually worked
> **Body:** Honest breakdown: daily challenge drove retention more than any feature, SEO was an afterthought I'm only now fixing, and the thing I spent longest on (a 2.5D figure with per-body-part jersey tinting) moved zero metrics. Ask me anything.

**6. r/gamedev — the technical post-mortem**
> **Title:** I made my sports career sim deterministic so every player's result is reproducible and shareable — here's the seeding approach and where it bit me
> **Body:** Same build always produces the same career. Great for sharing and anti-cheat, brutal when you want to add a feature mid-season without invalidating everyone's saved results.

**7. r/webdev — the constraint flex**
> **Title:** Shipped 20+ pages of a browser game with no framework and no build step — single HTML files, and it's fine actually
> **Body:** 1.3M pageviews/month. What broke, what I'd keep, what I'd never do again.

**8. r/InternetIsBeautiful — high bar, one shot, no promo language**
> **Title:** Build a baseball player out of 9 different real MLB players, then watch his entire career get simulated
> ⚠️ Historically aggressive about removing monetized links. One attempt, clean title, no dev-speak. Consider skipping.

---

# TIER 2 — comment first, one post later, modmail preferred

*r/Sabermetrics, r/dynastyff, r/fantasybaseball, r/OOTP, r/EASportsCFB, r/nbadiscussion, team subs.
No link in the body. Verify rules first.*

**9. r/Sabermetrics — your single best intellectual fit**
> **Title:** I built a career sim off a FIP core and the strikeout distribution looks wrong to me — where's my model broken?
> **Body:** K/9 comes from a strikeout rating with small velocity/break terms; ERA is FIP-based, adjusted for a strand-rate "clutch" input and BABIP off defense. Innings and career length key off stamina. At the top of my board a maxed build produces 7,403 career strikeouts — Ryan's real record is 5,714, so I'm ~30% hot at the tail. My guess is compounding: high K rate × high innings × long career all multiply. Curious how you'd damp a tail like that without flattening the middle. (Made the thing myself, not linking it — happy to share if anyone wants to poke at the output.)

**10. r/OOTP — respect the incumbents**
> **Title:** For those who want a 90-second version between OOTP seasons — what would you consider the minimum viable sim depth?
> **Body:** I built a lightweight browser career sim and I'm trying to figure out where "fun and fast" stops being credible to people who play real sim baseball. Currently model: FIP core, BABIP off defense, stamina-driven innings/career length, clutch as strand rate. What's the first thing you'd notice missing?

**11. r/dynastyff — data first, tool second**
> **Title:** Simmed 1,000 careers for each rookie-archetype profile — here are the Hall of Fame hit rates by build type
> **Body:** Table of results. Discussion about which archetype ages best.

**12. r/EASportsCFB — adjacent audience, high intent**
> **Title:** Made a free browser thing that does the Signing Day hat-pick and Heisman chase in about 3 minutes — what did CFB 26's Road to Glory get wrong?
> **Body:** Lead with the critique question. Let them ask what yours is.

**13. r/nbadiscussion — pose the question, don't pitch**
> **Title:** If you could only build a starting five from random draws — one player's rating per attribute — what's the theoretical ceiling?
> **Body:** I ran this and the best result on my board is a 110. Curious what people think the optimal strategy is: hoard for the heavily-weighted slots, or take value early?

**14. Team sub (r/NYYankees, r/Braves, etc.) — smallest risk, warmest reception**
> **Title:** Built [current star] from scratch in a career sim and it gave him three Cy Youngs and a first-ballot Hall of Fame — argue with the machine
> ⚠️ Time it to a real performance. Team subs are friendlier and a rule mistake costs less.

---

# TIER 3 — never cold-post. Comments and daily threads only.

*r/baseball, r/nba, r/CFB, r/hockey, r/soccer, r/fantasyfootball, r/mlb.*

**15. Any sport sub's daily discussion thread — the result block**
> Paste your daily result as a comment, link-free, like a fan:
> ```
> 🐐 GoatLab Daily · Pitcher · Jul 22
> 🟪🟦🟦🟨⬜🟫⬛🟨🟫
> 96 OVR · #12 of 847 · 🔥 14
> ```
> This is the whole strategy in one move. If someone asks what it is, answer plainly.

**16. r/baseball off-day thread — the record hook**
> **Comment:** "The best simulated pitcher on a career-sim board I've been playing has 7,403 strikeouts. Ryan's real 5,714 is one of those records that feels untouchable until a computer gets hold of it. What's the most unbreakable record in baseball, really?"

**17. r/hockey off-day thread — the measurables argument**
> **Comment:** "Pure measurables put Chara at a 94 for frame in a ratings model I've been messing with. Who else grades out absurdly on physical tools alone?"

**18. r/CFB — the ONLY safe path**
> Comment through the season. Then, before Signing Day, **modmail**: "I built a free college-football career game with a Signing Day hat-pick. Your rules say income-generating links are forbidden — is there any format you'd allow, or should I not?" **Accept whatever they say.** Do not post regardless of the answer.

---

# RECURRING FORMATS (the UGC engine)

These are worth more than any single post because they get *other people* posting.

**19. "Yesterday's board" recap** — In your own space (Discord, r/GoatLab), post yesterday's winner
and their build every morning. It's a reason for the community to check back and screenshot.

**20. Weekly build-off with a constraint** — "This week: no card above 85. Highest OVR wins."
Constraint-based challenges generate wildly different results, which generates comments.

**21. "Rate my build" thread** — Seed it with your own, let people reply with theirs. Their
screenshots are the ad.

**22. Head-to-head callout** — "Post your daily result. I'll build against the best one tonight and
post the sim." Turns a leaderboard into a story.

**23. Beat-the-dev** — Publish your daily result early. Anyone who beats it gets a shout in the
next recap. Cheap, and it makes you a participant instead of an owner.

**24. Record-chase watch** — When someone approaches a milestone (3,000 K, 700 HR, the 7,403
record), post the chase. Sports fans are conditioned to care about record watches.

**25. r/GoatLab** — Worth creating as a **home**, not a growth channel. It's where you point people
who ask, where recaps live, and where a link is always allowed. It grows from your Discord and from
comments, not from posting into it.

---

# CALENDAR HOOKS (post when the sport is already talking)

- **Opening Day / first pitch** — baseball builds
- **NBA opening night, All-Star, playoffs** — hoops
- **National Signing Day (Feb), Heisman ceremony (Dec), CFP** — college football (modmail first!)
- **NFL Draft** — the college→pro continuation
- **Trade deadlines** — "build the guy your team just got"
- **Hall of Fame announcement day** — your sim's HOF verdict is instantly topical. *This is your
  single best annual hook.*
- **A player's monster game** — "Last Night's Studs already boosts him in-game" is a real, timely,
  non-promotional thing to mention in a game thread

---

# SEQUENCING FROM ZERO

| When | Do |
|---|---|
| **Week 0** | Ship the link-free share block ✅ *(done 2026-07-22)*. Check for an existing shadowban. |
| **Weeks 1–4** | One account. Comment daily in sport subs **about sports**. Zero game mentions. This satisfies r/CFB's gate and builds the karma signals the filters key on. |
| **Weeks 3–6** | First link posts — **Tier 1 only**, one sub at a time, one per week, unique copy each. |
| **Weeks 5–10** | Modmail outreach. Tier 2 posts where rules allow. |
| **Month 3+** | Tier 3 daily-thread participation. Recurring formats running. r/GoatLab as home base. |

**The Discord is your seed audience** — the thing that turns a cold post into a thread with instant
replies (this is what Poeltl had with its podcast). But ask people to post **in their own words**.
Handing out a script to paste is precisely the "repeatedly posting the same or similar content"
pattern that gets reported to admins.

---

# ONE-LINE TITLE BANK

Swipe file. Pair with the right sub and rewrite the body every time.

1. Can you build a 99? Only [X] of 46,455 batters ever have.
2. You need a 101 just to crack the top 200 pitchers right now.
3. The hockey board is 1,535 builds deep — easiest leaderboard on the site to top today.
4. Everyone gets the same nine cards. Nobody agrees where they go.
5. My simulated pitcher struck out 7,403. Nolan Ryan's real record is 5,714.
6. Built the entire '27 Yankees lineup and still lost the gauntlet.
7. The sim says your favorite player is a Hall of Famer. Argue with it.
8. What's the highest Overall possible if every pick is a coin flip?
9. Spent a legend on Frame and I'd do it again.
10. Day 40 of the daily. My streak is the only thing keeping me employed.
11. I made a sports game where losing is a stat line, not a game over.
12. Three Cy Youngs, zero rings. The machine is a comedian.
