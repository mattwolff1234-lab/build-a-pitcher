# Ads — Playwire (Ramp) integration

> **Read this before touching page layout, `<head>` sections, or `vercel.json`.**
> The ad integration is 3 small pieces per page; any redesign must carry them along.

## Account
- **Provider:** Playwire (Ramp dashboard: https://ramp.playwire.com)
- **PUB ID:** `1025880` · **SITE ID:** `77906` (registered domain: `goat-lab.app`)
- **Contact:** Louis at Playwire (email thread, July 2026)
- **Google approval:** MCM verification resolved; *full* Google approval still pending as of
  2026-07-09 — revenue is expected to be weak until it lands. Louis is tracking it.
- Playwire tunes ad placements on their side per page layout. **After any major UI/UX
  overhaul, email Louis a heads-up** so their ad-ops team can re-optimize.

## The 3-piece contract (per page) — do not lose these in redesigns
Every monetized page needs exactly this, nothing more:

1. **Head snippet** (layout-independent; sits right after the GA4 `gtag` block):
   ```html
   <!-- Playwire Ramp - PUB 1025880 / SITE 77906 -->
   <script>
     window.ramp = window.ramp || {};
     window.ramp.que = window.ramp.que || [];
     window.ramp.passiveMode = true;
     document.addEventListener('DOMContentLoaded', function () {
       window.ramp.que.push(function () { window.ramp.spaNewPage(window.location.pathname); });
     });
   </script>
   <script async src="//cdn.intergient.com/1025880/77906/ramp.js"></script>
   <style>
   /* Ad-safe mobile spacing: keep fixed-bottom UI above the Playwire anchor ad (see ads.md) */
   @media (max-width:900px){
     body{ padding-bottom:60px; }
     body .toast, body .day-toast{ bottom:92px; }
     body .xp-hud{ bottom:calc(8vh + 56px); }
     body #challengeNotif{ bottom:120px !important; }
     body .overlay, body .draft-overlay, body .daily-reveal, body .hotb-overlay,
     body .dq-ov, body .col-ov, body .ach-ov, body .st-ov{ padding-bottom:72px; }
   }
   </style>
   ```
2. **In-game ad slot** (reel/game pages only) — first child inside `<div id="game">`:
   ```html
   <div id="game-ad" style="min-height:100px;display:flex;align-items:center;justify-content:center;width:100%;max-width:970px;margin:6px auto 12px;"></div>
   ```
   Only fills if Playwire maps a unit to it in RAMP (confirm with Louis if it stays empty).
3. **Ad-safe mobile spacing** (the `<style>` block in piece 1) — the anchor ad is
   `position:fixed; bottom:0` with an astronomically high z-index, so it covers EVERYTHING
   in the bottom ~60px of a phone screen. Two protections:
   - `body{padding-bottom:60px}` protects normal in-flow content (buttons, panels).
   - **`position:fixed` bottom-pinned elements are NOT protected by body padding** — each
     one must be raised above the ad zone individually. Currently raised: `.toast`/`.day-toast`
     (game feedback), `.xp-hud` (XP gain bar), `#challengeNotif` (versus), and the
     full-screen overlay containers get extra bottom padding so centered panels can't
     extend under the ad. **Any NEW fixed bottom-anchored element (toast, bar, sticky nav)
     must sit ≥ 92px from the bottom on ≤900px screens** — add it to this style block.

   ⚠️ **Planned nav rework (bottom tab bar / switcher.js):** a `bottom:0` tab bar will sit
   UNDER the anchor ad and be unusable on mobile. Either stack it above the ad zone
   (`bottom:60px` when ads active), or ask Playwire to disable the bottom rail unit — decide
   before shipping that rework.

Everything else (which ads show, where side rails/anchors go) is injected by `ramp.js` and
configured in the RAMP dashboard — not in this repo.

## Where the tag lives (9 pages)
| Page | Head snippet | `#game-ad` slot |
|---|---|---|
| `index.html` (landing) | ✅ | — |
| `pitcher.html` | ✅ | ✅ |
| `build-a-batter.html` | ✅ | ✅ |
| `build-a-baller.html` | ✅ | ✅ |
| `build-a-striker.html` | ✅ | ✅ |
| `build-a-keeper.html` | ✅ | ✅ |
| `versus.html` | ✅ | — |
| `versus-hoops.html` | ✅ | — |
| `college.html` | ✅ | ✅ |

**New pages/games must get the head snippet** (and the `#game-ad` slot if they have a game
area). Copy from any existing page.

- `goatsquad.html` (goat-lab.app): head snippet ✅ + `#game-ad` ✅ — but the slot sits
  **below the game sections** (end of `.wrap`), not at the top: Ramp injects a placeholder
  wrapper even with no ad sold, and the reserved ~100px up top pushed the draft board
  under the sticky STOP button on phones. Keep it below the game if this page is redesigned.

## ads.txt — dynamic (Playwire-hosted), zero upkeep
- `vercel.json` has a **301 redirect**: `/ads.txt` → `https://config.playwire.com/dyn_ads/1025880/77906/ads.txt`
- Playwire keeps that hosted file current; **never hand-edit the static `ads.txt`** in the
  repo (it's a dead fallback shadowed by the redirect — harmless, ignorable).
- Extra ad partners outside Playwire go in RAMP → Ad Integration → Dynamic Ads.txt →
  "Additional Authorized Sellers" (not in this repo).
- Verify: `curl -sI https://pitchinglab.pitchergami.com/ads.txt` → expect `301` +
  `Location: config.playwire.com/...`. Deployed & verified 2026-07-09.

## Status / history
- **2026-07-09:** Dynamic ads.txt live (commit `f738725`). Ad tag applied to all 8 pages
  (commit `b0ea0cb`) — **push to `main` = ads go live**; tell Louis once deployed.
- The old `ads-staging` branch (local + origin) is **obsolete** — its one commit was
  re-applied onto current main as `b0ea0cb`. Safe to delete.
- Original snippet was anchored next to the Vercel Web Analytics script (since removed);
  it now anchors after the GA4 block.

## Verifying ads after a deploy
```bash
# tag present on a live page?
curl -s https://pitchinglab.pitchergami.com/pitching | grep -c intergient   # expect 1
# ads.txt redirect intact?
curl -sI https://pitchinglab.pitchergami.com/ads.txt | grep -i location
```
In a browser: bottom anchor ad on mobile widths + network requests to `cdn.intergient.com`.
Revenue/impressions: RAMP dashboard (expect near-zero until full Google approval).

## Gotchas
- **Ad blockers** hide everything (test in a normal window).
- `ramp.passiveMode = true` + `spaNewPage()` is the pattern Playwire gave us — keep both
  even though the site does full page loads.
- Don't add other ad networks' tags without telling Playwire — conflicts tank revenue and
  can violate the Playwire agreement.
- Consent/privacy (GDPR/CCPA) banners are handled inside `ramp.js` by Playwire.
