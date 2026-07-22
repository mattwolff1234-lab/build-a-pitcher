# Reddit playbook: GoatLab

> Post drafts plus the rules that govern them. Built 2026-07-22 from a verified research pass
> (see "What's verified") plus direct observation of how 20-0.com structures its hooks.
> **Read `## Non-negotiables` before posting anything.**
>
> **House style for all copy below: no em dashes.** They read as an AI tell, and an
> astroturfing accusation is fatal in these communities. Use commas, colons, parentheses,
> or just start a new sentence. (Source quotes keep their original punctuation.)

## What's verified vs. what's judgment

**Verified (quoted from source):**
- Reddit has **no sitewide ban on self-promotion**. Its own mod docs say *"promotional content is
  not inherently considered to be spam."* Per-subreddit rules are the only binding constraint.
- There is **no sitewide 9:1 rule.** The only official number is an optional *"10% rule"* that
  *some* communities adopt.
- **r/CFB is dangerous.** Rule 6: posting external links *"for the primary purpose of generating
  income is forbidden and may result in an account suspension, ban and/or a domain ban."* It also
  requires you to comment in the sub before posting at all. GoatLab runs ads, so it is in scope.
  A domain ban blocks **goat-lab.app sub-wide**, not just one post.
- **r/playmygame** exists for exactly this: *"freely playable games… so long as users can click a
  link and play it."*
- Mass-posting the same link across subs is a **sitewide** violation (suspension risk), and using
  a shortener to dodge a domain block is explicitly reportable.
- Subs can **silently filter** new or low-karma accounts (Reputation filtering, Crowd Control).
  Your post goes to a mod queue and **you are never told.**
- **Wordle's grid was invented by a player**, and Wardle shipped the share text **without a URL**
  on purpose: *"it feels spammy… they were sharing for themselves."*

**Refuted, do not repeat these:**
- ❌ "Immaculate Grid went viral from one r/baseball post." The sharper inflection followed a big
  baseball Twitter account, and its user counts are founder-supplied round numbers.
- ❌ "r/CFB bans user-made games." The real risk is the income-link rule, which is narrower but worse.

**Unverified, check the sidebar yourself:** every sub below except r/CFB and r/playmygame.

---

## Non-negotiables

1. **One real account.** Never a throwaway, never a second account to repost something removed.
2. **Disclose in the first line.** "I made this" or "my side project." Undisclosed ownership is
   what makes something astroturfing.
3. **Different title and body every time.** Never the same week. Copy-paste across subs is the
   exact pattern that triggers sitewide spam enforcement.
4. **If a post is removed, stop.** Do not repost, do not shorten the URL, do not try another sub
   that day. Message the mods politely or move on.
5. **Answer every comment.** A dev replying in the thread is the single biggest credibility signal.
6. **Tier 2 and 3 mean no link in the body.** Let people ask. "What's this called?" in the
   comments is worth more than a link in the post.
7. **Check for a shadowban** before investing weeks: post a link, then view the thread in a
   logged-out incognito window. Invisible means you are filtered.
8. **No em dashes in anything you paste.**

---

## Real stats to use (pulled 2026-07-22, re-pull before posting)

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

```bash
curl -s "https://goat-lab.app/api/score?scope=global&limit=200&game=batter" | head -c 400
curl -s "https://goat-lab.app/api/score?scope=global&limit=3&game=pitcher&sort=k"
```

---

## The hook patterns that work

Observed in how 20-0.com frames itself, and consistent with the verified Wordle and Poeltl evidence:

- **Challenge plus rarity stat.** "Can you go 20-0? Only 4% go undefeated." A hard target plus a
  number proving it is hard.
- **"I made X but it's Y."** The highest-performing indie title format on Reddit. It borrows a
  known game's shape and lands the twist in six words.
- **Name the final boss.** Concrete beats abstract every time. "The final boss is the '96 Bulls"
  outperforms "survive a gauntlet of historic teams."
- **Same puzzle for everyone.** The daily's whole social value is comparability. Say so out loud.
- **The machine disagrees with you.** Sim output that contradicts fan consensus is free argument.
- **Lead with the artifact, not the app.** A result, a stat, a screenshot. The game is the answer
  to "where's this from," not the subject of the post.

---

# TIER 1: links allowed (sanctioned discovery subs)

## ⭐ r/playmygame, filled into their required template

r/playmygame requires this exact structure in the BODY. The post title is separate.

**Post title (recommended):**
> I made a roguelike where your deck is a basketball dream team and the final boss is the '96 Bulls

Alternates:
- `GOAT Squad: a roguelike where your deck is a dream team and the final boss is the '96 Bulls`
  (name up front, useful in a sub where people reference games by name)
- `Balatro's interest mechanic, Slay the Spire's one-life run, except your relics are role players`

Title rules: no `[TT]` (that tag is only for PAID games on Tuesdays, yours is free), no platform in
the title (that is the flair you add after posting), and do not open with "free browser game"
because free is assumed in this sub and it burns your best words. Name the inspirations in the
body, not the title: in a title it reads as riding coattails, in the body it reads as craft.

Copy the body as-is, then **add the `[pc] (web)` flair after posting**. Lead with GOAT Squad
rather than the career sims: this audience plays roguelikes, and "Balatro but basketball" lands
harder here than "sports career simulator."

```
Game Title: GOAT Squad

Playable Link: https://goat-lab.app/goatsquad

Platform: Web browser (desktop and mobile, no download, no signup)

Description:
GOAT Squad is a roguelike dream-team builder. Every roster position spins at once
like a slot machine full of real NBA players, and you hit STOP to freeze the board.
The reels move at a fixed speed, so stopping them is a skill rather than a dice roll.
You lock exactly one player from the frozen board, the rest respin, and you repeat
until you have a starting five, a sixth man, and a coach.

Then your squad has to survive. The Gauntlet is a ten layer run against the greatest
teams ever assembled, each one a best-of-seven series, and the final boss is the
1996 Bulls. You earn cap space for wins, spend it in traveling shops between rounds
on things like insurance, training camps, and free agent wheels, and you can pick up
relics that bend the series odds. You get one life. Lose a series and the run is over,
which makes the mid-run decisions actually hurt.

The obvious comparisons are Slay the Spire for the map and one-life structure, and
Balatro for the run economy (held cash earns interest, so banking versus spending is
a real decision). There is also a daily mode where every player in the world gets the
same reels and the same boss, so results are directly comparable.

I am looking for feedback on two things specifically: whether the STOP timing feels
learnable or random on your first run, and whether the shop prices feel right. I
suspect insurance is overpriced but I am too close to it to tell.

Free to Play Status:
[X] Free to play
[ ] Demo/Key available
[ ] Paid (Allowed only on Tuesdays with [TT] in the title)

Involvement: Solo developer. I built all of it: the game design, the code, the data
pipeline that pulls real player ratings, and the art pipeline. Happy to answer
anything about how it works under the hood.
```

**Notes:** description is ~250 words, comfortably over their 100 word minimum. It discloses
solo dev involvement, states free-to-play plainly, and ends with a specific feedback ask, which
is what the sub is for. Play and comment on a few other games in the sub the same day.

---

## GOAT Squad titles for the other Tier 1 subs

The roguelike framing is your strongest hook with gamers. Rotate these, never reuse:

**1. r/incremental_games**
> I made a roguelike where your deck is a basketball dream team and the final boss is the '96 Bulls

**2. r/roguelikes / r/slaythespire-adjacent subs (check rules, many ban promo outright)**
> Slay the Spire's map structure, Balatro's interest mechanic, except your relics are role players and one bad series ends the run

**3. r/WebGames**
> Stop the spinning reels to lock a dream team, then try to survive ten rounds against the greatest teams in history. Free, no signup.

**4. r/browsergames**
> Balatro-style run economy, but the deck is a basketball roster and every boss is a real championship team

**5. r/BaseballGames or team subs (baseball flavor)**
> Built a roguelike where you fill a lineup by stopping slot reels, then run a gauntlet that ends at the 1927 Yankees

**6. r/SideProject**
> My roguelike sports game hit 1.3M pageviews a month with no marketing budget. Here is what actually worked.

---

## Career-sim posts for Tier 1

**7. r/WebGames**
> Free, no signup: draft real MLB pitchers into your own pitcher's body, then watch his 15 year career and Hall of Fame vote play out
>
> Body: Each body part is an attribute. Land on deGrom and you decide whether he is your Velocity or your Command, because you only get one shot at each pro. Then the game sims the whole career off whatever you built.

**8. r/browsergames**
> Made a daily sports puzzle where everyone in the world gets the exact same cards. Today's took me three tries to not waste the legend.

**9. r/IndieDev**
> 1.3M pageviews a month on a browser sports game, solo, no marketing budget. Here is the honest breakdown.
>
> Body: The daily challenge drove retention more than any feature. SEO was an afterthought I am only now fixing. The thing I spent longest on, a 2.5D figure with per body part jersey tinting, moved exactly zero metrics. Ask me anything.

**10. r/gamedev**
> I made my sports career sim fully deterministic so results are reproducible and shareable. Here is the seeding approach and where it bit me.
>
> Body: Same build always produces the same career. Great for sharing and for anti-cheat. Brutal when you want to add a feature mid-season without invalidating everyone's saved results.

**11. r/webdev**
> Shipped 20+ pages of a browser game with no framework and no build step. Single HTML files, and it is fine actually.

**12. r/InternetIsBeautiful** (high bar, one shot, no dev-speak)
> Build a baseball player out of nine different real MLB players, then watch his entire career get simulated
>
> ⚠️ Historically aggressive about removing monetized links. Consider skipping.

---

# TIER 2: comment first, one post later, modmail preferred

*No link in the body. Verify rules first.*

**13. r/Sabermetrics, your single best intellectual fit**
> **Title:** I built a career sim off a FIP core and the strikeout tail looks wrong to me. Where is my model broken?
>
> **Body:** I made this myself, not linking it, just want the math torn apart. K/9 comes from a strikeout rating with small velocity and break terms. ERA is FIP based, adjusted by a strand rate "clutch" input and BABIP off defense. Innings and career length key off stamina. At the top of my board a maxed build produces 7,403 career strikeouts, and Ryan's real record is 5,714, so I am roughly 30% hot at the tail. My guess is compounding: high K rate times high innings times long career all multiply. How would you damp a tail like that without flattening the middle of the distribution?

**14. r/OOTP, respect the incumbents**
> **Title:** For people who play real sim baseball: what is the minimum sim depth before a lightweight version stops feeling credible?
>
> **Body:** I built a 90 second browser career sim and I am trying to find the line. Current model is a FIP core, BABIP off defense, stamina driven innings and career length, clutch as strand rate. What is the first thing you would notice missing?

**15. r/dynastyff**
> **Title:** Simmed 1,000 careers for each rookie archetype. Here are the Hall of Fame hit rates by build profile.

**16. r/EASportsCFB**
> **Title:** What did CFB 26's Road to Glory get wrong? I built a three minute version with the Signing Day hat pick and a Heisman chase, and I want to know what is missing.

**17. r/nbadiscussion**
> **Title:** If you could only build a starting five from random draws, one player's rating per attribute, what is the theoretical ceiling?
>
> **Body:** Best result I have seen is a 110. Curious whether the optimal play is hoarding for the heavily weighted slots or taking value early.

**18. Team subs (r/NYYankees, r/Braves, r/torontoraptors, etc.)**
> **Title:** Built [current star] from scratch in a career sim and it gave him three Cy Youngs and a first ballot Hall of Fame. Argue with the machine.
>
> ⚠️ Time it to a real performance. Team subs are friendlier and a rule mistake costs less.

---

# TIER 3: never cold-post, comments and daily threads only

*r/baseball, r/nba, r/CFB, r/hockey, r/soccer, r/fantasyfootball, r/mlb.*

**19. Any sport sub's daily discussion thread, the result block**
> ```
> 🐐 GoatLab Daily · Pitcher · Jul 22
> 🟪🟦🟦🟨⬜🟫⬛🟨🟫
> 96 OVR · #12 of 847 · 🔥 14
> ```
> This is the whole strategy in one move. If someone asks what it is, answer plainly.

**20. r/baseball off-day thread, the record hook**
> The best simulated pitcher on a career sim board I have been playing has 7,403 strikeouts. Ryan's real 5,714 is one of those records that feels untouchable right up until a computer gets hold of it. What is the actually unbreakable record in baseball?

**21. r/hockey off-day thread**
> Pure measurables put Chara at a 94 for frame in a ratings model I have been messing with. Who else grades out absurdly on physical tools alone?

**22. r/CFB, the only safe path**
> Comment through the season. Then, before Signing Day, send **modmail**: "I built a free college
> football career game with a Signing Day hat pick. Your rules say income generating links are
> forbidden, so I wanted to ask before doing anything. Is there a format you would allow, or should
> I stay out of the way?" **Accept whatever they say.** Do not post regardless of the answer.

---

# RECURRING FORMATS (the UGC engine)

Worth more than any single post, because they get other people posting.

**23. Yesterday's board recap.** Post yesterday's winner and their build every morning in your own
space. A reason for people to check back, and a screenshot magnet.

**24. Weekly build-off with a constraint.** "This week: no card above 85. Highest OVR wins."
Constraints produce wildly different results, which produces comments.

**25. Rate my build thread.** Seed it with your own, let people reply with theirs. Their
screenshots are the ad.

**26. Head to head callout.** "Post your daily result. I will build against the best one tonight
and post the sim." Turns a leaderboard into a story.

**27. Beat the dev.** Publish your daily result early. Anyone who beats it gets a shout in the
next recap. Makes you a participant instead of an owner.

**28. Record chase watch.** When someone approaches 3,000 K, 700 HR, or the 7,403 record, post the
chase. Sports fans are conditioned to care about record watches.

**29. r/GoatLab.** Worth creating as a **home**, not a growth channel. It is where you point people
who ask, where recaps live, and where a link is always allowed. It grows from your Discord and from
comments, not from posting into it.

---

# CALENDAR HOOKS

- Opening Day and first pitch: baseball builds
- NBA opening night, All-Star weekend, playoffs: hoops
- National Signing Day (Feb), Heisman ceremony (Dec), CFP: college football (modmail first)
- NFL Draft: the college to pro continuation
- Trade deadlines: "build the guy your team just got"
- **Hall of Fame announcement day: your single best annual hook.** Your sim renders an HOF verdict,
  which makes it instantly topical.
- A player's monster game: "Last Night's Studs already boosts him in game" is timely and real

---

# SEQUENCING FROM ZERO

| When | Do |
|---|---|
| **Week 0** | Ship the link-free share block ✅ *(done 2026-07-22)*. Check for an existing shadowban. |
| **Weeks 1 to 4** | One account. Comment daily in sport subs **about sports**. Zero game mentions. Satisfies r/CFB's gate and builds the karma signals the filters key on. |
| **Weeks 3 to 6** | First link posts. **Tier 1 only**, one sub at a time, one per week, unique copy each. |
| **Weeks 5 to 10** | Modmail outreach. Tier 2 posts where rules allow. |
| **Month 3+** | Tier 3 daily thread participation. Recurring formats running. r/GoatLab as home base. |

**The Discord is your seed audience**, the thing that turns a cold post into a thread with instant
replies (this is what Poeltl had with its podcast). But ask people to post **in their own words**.
Handing out a script to paste is precisely the "repeatedly posting the same or similar content"
pattern that gets reported to admins.

---

# ONE-LINE TITLE BANK

Swipe file. Pair with the right sub, rewrite the body every time, never reuse a title.

1. I made a roguelike where your deck is a basketball dream team and the final boss is the '96 Bulls
2. Balatro's interest mechanic, Slay the Spire's map, except every boss is a real championship team
3. Can you build a 99? Out of 46,455 batters, almost nobody has.
4. You need a 101 just to crack the top 200 pitchers right now.
5. The hockey board is only 1,535 builds deep. Easiest leaderboard on the site to top today.
6. Everyone gets the same nine cards. Nobody agrees where they go.
7. My simulated pitcher struck out 7,403. Nolan Ryan's real record is 5,714.
8. Built the entire '27 Yankees lineup and still lost the gauntlet.
9. The sim says your favorite player is a Hall of Famer. Argue with it.
10. What is the highest Overall possible if every pick is a coin flip?
11. Spent a legend on Frame and I would do it again.
12. Day 40 of the daily. My streak is the only thing keeping me employed.
13. I made a sports game where losing is a stat line, not a game over.
14. Three Cy Youngs, zero rings. The machine is a comedian.
15. Stop the reels, lock your five, survive ten rounds. One life.
