# Ads — Playwire (Ramp) integration

> **Read this before touching page layout, `<head>` sections, or `vercel.json`.**
> The ad integration is 3 small pieces per page; any redesign must carry them along.

## Account
- **Provider:** Playwire (Ramp dashboard: https://ramp.playwire.com)
- **PUB ID:** `1025880`
- ⚠️ **TWO registered sites — the tag must match the domain it is served on:**

  | Domain (incl. subdomains) | SITE / WEB_ID |
  |---|---|
  | `goat-lab.app`, `squad.goat-lab.app` | **77906** |
  | `pitchergami.com`, `pitchinglab.pitchergami.com` | **78265** |

  Playwire confirmed 2026-07-23 (Christian Klein): *"WEB_ID for pitchergami.com is 78265.
  Any subdomain can use the same website id across the site."* Every page now picks the id
  from `location.hostname` at load — **never hardcode one back in.** From 2026-07-09 to
  07-23 all pages served the 77906 tag on both domains, and the pitchergami traffic (69% of
  pageviews) earned $0.21 CPM / 68% fill vs $0.54 / 88% on goat-lab.app.
- **Contacts:** Tiara Baldoni Smith `tbaldoni@` (AE) · Steven Derisse `sderisse@` (onboarding)
  · **Christian Klein `cklein@` (Onboarding Solutions Engineer — the one who answers technical
  ad questions)** · Louis Smith `lsmith@`.
- **Google approval:** landed ~2026-07-09. CPM went $0.14 → $0.41 and PV RPM $0.58 → $3.07
  between 07-09 and 07-21; revenue $14/day → $155/day.
- Playwire tunes ad placements on their side per page layout. **After any major UI/UX
  overhaul, email them a heads-up** so their ad-ops team can re-optimize.

## The 3-piece contract (per page) — do not lose these in redesigns
Every monetized page needs exactly this, nothing more:

1. **Head snippet** (layout-independent; sits right after the GA4 `gtag` block):
   ```html
   <!-- Playwire Ramp - PUB 1025880 / SITE picked by hostname (see table above) -->
   <script>
     window.ramp = window.ramp || {};
     window.ramp.que = window.ramp.que || [];
     window.ramp.passiveMode = true;
     document.addEventListener('DOMContentLoaded', function () {
       window.ramp.que.push(function () { window.ramp.spaNewPage(window.location.pathname); });
     });
   </script>
   <script>
     // Skip Playwire entirely while the Goat Coins '30 Days Ad-Free' entitlement is active,
     // then load the tag for the SITE ID that matches this hostname (see the table above).
     (function () {
       try {
         var w = JSON.parse(localStorage.getItem('pl_wallet') || 'null');
         if (w && w.entitlements && w.entitlements.no_ads_until && Date.parse(w.entitlements.no_ads_until) > Date.now()) return;
       } catch (e) {}
       var site = /(^|\.)pitchergami\.com$/i.test(location.hostname) ? '78265' : '77906';
       var s = document.createElement('script');
       s.async = true; s.src = '//cdn.intergient.com/1025880/' + site + '/ramp.js';
       document.head.appendChild(s);
     })();
   </script>
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

## Where the tag lives (18 pages)
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
| `hockey.html` | ✅ | ✅ | (added 2026-07-22 — was the last game page without a tag)
| `ranks.html` | ✅ | — | (re-added 2026-07-23, see below)

Still tagless on purpose: **`monster.html` only** (de-listed, IP posture).

**New pages/games must get the head snippet** (and the `#game-ad` slot if they have a game
area). Copy from any existing page.

- `goatsquad.html` (goat-lab.app): head snippet ✅ + `#game-ad` ✅ — but the slot sits
  **below the game sections** (end of `.wrap`), not at the top: Ramp injects a placeholder
  wrapper even with no ad sold, and the reserved ~100px up top pushed the draft board
  under the sticky STOP button on phones. Keep it below the game if this page is redesigned.
- `ranks.html` (`/ranks`): tag **removed 2026-07-21, restored 2026-07-23**. The removal was
  based on a DESKTOP-emulated test where side rails covered the board; Playwire confirmed only
  `bottom_rail` is actually mapped for the route, which the ad-safe spacing already clears.
  `switcher.js` stacks the `.gnav` bar above the anchor via `--pl-adh`, so both fit.
  **Still worth eyeballing on a real phone.**

## ads.txt — dynamic (Playwire-hosted), zero upkeep
- `vercel.json` has **two host-conditional 301s** (order matters, specific one first):
  `pitchergami.com` → `dyn_ads/1025880/78265/ads.txt`, everything else → `.../77906/ads.txt`.
- ⚠️ **ads.txt resolves against the ROOT domain, not the subdomain.** Buyers check
  `pitchergami.com/ads.txt` for inventory on `pitchinglab.pitchergami.com` — a redirect on the
  subdomain alone does nothing. **`pitchergami.com` is a DIFFERENT Vercel project
  (`~/pitcher-scorigami`)**, so its `vercel.json` carries its own `/ads.txt` → 78265 redirect.
  It 404'd from launch until 2026-07-23, meaning the majority of traffic had **no authorized
  sellers at all** — the likeliest cause of that domain's weak fill/CPM. If pitchergami's DNS,
  hosting, or repo ever moves, **re-check that redirect first.**
- Playwire keeps the hosted files current; **never hand-edit the static `ads.txt`** in the
  repo (it's a dead fallback shadowed by the redirect — harmless, ignorable).
- Extra ad partners outside Playwire go in RAMP → Ad Integration → Dynamic Ads.txt →
  "Additional Authorized Sellers" (not in this repo).
- Verify all three (root domain matters most):
  ```bash
  curl -sI https://pitchergami.com/ads.txt              | grep -i location   # → .../78265/ads.txt
  curl -sI https://pitchinglab.pitchergami.com/ads.txt  | grep -i location   # → .../78265/ads.txt
  curl -sI https://goat-lab.app/ads.txt                 | grep -i location   # → .../77906/ads.txt
  ```

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
