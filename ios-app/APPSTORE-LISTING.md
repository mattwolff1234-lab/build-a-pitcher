# App Store listing · paste-ready submission kit
(updated 2026-07-11: Sign in with Apple + push notifications + College Football in the app)

## Name (30 chars max)
GoatLab: Sports GM Builder
(fallbacks if taken: "GoatLab - Build the GOAT", "GoatLab Sports Sim")

## Subtitle (30 chars max)
Build players. Sim careers.

## Promotional text (170 chars, editable without review)
Spin real pro cards, build your dream player, and sim their whole career. Daily
challenges, live 1v1s, franchise mode, and college football.

## Description
THE SPORTS LAB IN YOUR POCKET

Spin the reel. Land on a real pro. Bolt their rating onto your player, slot by slot,
then simulate an entire career: seasons, awards, injuries, championships, and a
Hall of Fame verdict.

FOUR SPORTS, ONE LAB
· Baseball: build a pitcher or a hitter from real MLB-rated cards
· Basketball: build a hooper from real NBA-rated cards
· Soccer: build a striker or a keeper from real FIFA-rated cards
· College Football: build a QB, RB, or WR, win the natty, then go pro

WAYS TO PLAY
· DAILY CHALLENGE: the same cards for everyone worldwide, one shot a day. Beat the
  board, protect your streak.
· 1v1 LIVE: match a real opponent, quick-build on a shot clock, and watch the
  showdown play out. Climb the Elo ladder through monthly seasons.
· FRANCHISE MODE: sign your creations to a club, play seasons game by game, work
  the trade lines, develop prospects, draft rookies, and chase titles. Three save
  slots, full box scores, player careers that span years.
· COLLECTION and QUESTS: every card you pull goes in the binder; restriction runs
  and achievements keep the lab spicy.

YOUR CREW
Claim your @handle, add friends, scout their builds, and challenge them to friendly
1v1s in any sport. Level up, earn Season Track rewards, and show off your avatar.

Sign in with Apple to keep your Hall of Fame, friends, and rating on every device -
or just play as a guest. No account needed. Free forever.

## Keywords (100 chars, comma-separated)
sports,sim,GM,baseball,basketball,soccer,football,career,franchise,draft,builder,daily

## Category
Primary: Games > Sports · Secondary: Games > Simulation

## Age rating questionnaire
- Violence/sexual content/profanity/drugs/gambling/horror: **None** for all.
  (Simulated sports only. No real gambling, no loot boxes - the card reel costs
  nothing and awards no purchases.)
- Contests: None. In-app purchases: No.
- Unrestricted web access: **NO** (external links open in Safari, outside the app).
- User interaction answers (newer questionnaire): users CAN interact (1v1 matches,
  friends, leaderboard names). Names/handles pass a server-side profanity filter and
  players never free-type messages to each other - there is NO chat.
  Expected result: **4+** (worst case 9+; accept whatever it computes, don't fudge).

## App Privacy (the questionnaire in App Store Connect)
Data types collected:
- **Email Address + Name** - only if the user chooses Sign in with Apple. Linked to
  identity. Purpose: App Functionality (account/save sync). Not used for tracking.
- **User ID** - guest/device id or account id. Linked to identity (for account
  holders). Purpose: App Functionality. Not used for tracking.
- **Gameplay Content** ("Other User Content"): builds/scores/handles shown on
  leaderboards. Linked to identity for signed-in users. App Functionality.
- **Device ID (push token)** - Purpose: App Functionality (notifications).
  Not tracking.
- **Usage Data / Product Interaction** (Google Analytics) - NOT linked to identity,
  Analytics purpose.
- Tracking across apps/websites: **NO** (no ads SDK in the app, no ATT prompt).
- Privacy policy URL: https://pitchinglab.pitchergami.com/privacy

## Review notes (paste into "Notes" for the reviewer)
- No account is required: tap "Play as guest" on first launch to access everything.
- Sign in with Apple is optional and only syncs saves across devices.
- IMPORTANT - "1v1 Live" is live-player matchmaking. If no other player is online
  at review time, matchmaking will keep searching; this is expected behavior, not a
  bug. Every other mode (build, career sim, Daily Challenge, Franchise, Collection)
  is fully playable single-player.
- Push notifications are used for friend requests, 1v1 challenges, and a daily
  streak reminder. Declining permission changes nothing else.

## Screenshots (need at least 3, up to 10)
Required size: 6.9"/6.7" class - 1290x2796 (portrait). Easiest path: take them on
your iPhone in the TestFlight build (Matt's phone screenshots can be resized/padded
to exact spec - hand them to Claude). Shot list:
1. Hub with the four sport chips + mode grid
2. Mid-build: reel landed, glowing body slots
3. Career card: HOF verdict + trophies
4. Franchise: standings + game feed
5. College: Signing Day / natty trophy moment
6. 1v1 arena (staged with two devices, or skip)

## Version info
- Version 1.0.0, build number = GitHub run number (automatic).
- Copyright: 2026 Wolff Labs LLC
- Support URL: https://pitchinglab.pitchergami.com
- Marketing URL (optional): https://pitchinglab.pitchergami.com

## Pre-submit checklist
- [ ] APNs key added to Vercel (APNS_KEY_ID / APNS_TEAM_ID / APNS_KEY_P8) so pushes
      work for reviewers
- [ ] Screenshots uploaded (3 minimum)
- [ ] App Privacy questionnaire filled (answers above)
- [ ] Age rating filled (answers above)
- [ ] Review notes pasted
- [ ] Pick the final TestFlight build on the version page
- [ ] "Sign in with Apple" works in the picked build (verify on device first!)
