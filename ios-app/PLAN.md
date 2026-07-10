# GoatLab iOS App · Launch Plan

> Goal: GoatLab on the App Store ASAP. Strategy: **Capacitor** wraps the existing site in a
> native shell. The web pages are bundled INSIDE the app (Apple requires this; a thin
> remote-URL wrapper gets rejected), while all data still comes from the live API at
> pitchinglab.pitchergami.com. One codebase, the site keeps shipping as-is.

## Why Capacitor (and not a rewrite)
- The entire product is static HTML/JS + serverless APIs. Capacitor ships exactly that
  inside a native app with access to push notifications, haptics, etc.
- Everything keeps working: builds, dailies, 1v1 (Ably), franchises, friends. Guests are
  fully supported today (Elo, friends, franchise saves), so v1 can ship guest-first.
- A React Native/Swift rewrite would be months for zero product gain.

## The one hard constraint: you're on Windows
iOS apps can only be BUILT on macOS. Two ways around it (pick in Phase 2):
1. **GitHub Actions macOS runners** (recommended, ~free at our scale: 2,000 min/mo free,
   macOS minutes count 10x, a build is ~15 real minutes = 150 counted; a few builds/month
   fits). The workflow file is scaffolded at `ios-app/ios-build.yml.example`.
2. **Codemagic** (codemagic.io): friendlier UI, 500 free macOS M1 minutes/month, built-in
   App Store publishing. Good backup if Actions is fiddly.
You never need to touch Xcode directly - certificates are handled by an App Store Connect
API key in CI.

---

## Phase 0 · Accounts & identity (start TODAY, it has the longest lead time)
1. **Apple Developer Program** ($99/yr) at developer.apple.com/programs.
   - DECISION: enroll as **Individual** (approved in ~1-2 days, apps show "Matt Wolff") or
     as **Wolff Labs LLC** (shows the company name, but needs a D-U-N-S number - can take
     1-2 weeks if the LLC doesn't have one yet).
   - Recommendation: check for a D-U-N-S first (dnb.com lookup). If none, enroll as
     Individual now and transfer the app to the LLC account later (Apple supports app
     transfer) - do not let paperwork block the launch.
2. While that processes: pick the **display name** ("GoatLab" - check App Store for
   collisions) and note the bundle id already scaffolded: `com.wolfflabs.goatlab`.
3. You'll need a **1024x1024 app icon** (no transparency, no rounded corners - Apple
   rounds it). The goat art from the avatar set is a natural start.

## Phase 1 · Scaffolding (DONE - it's in this folder)
- `package.json` - pinned Capacitor deps + npm scripts.
- `capacitor.config.json` - app id, name, dark background, iOS tweaks.
- `build-www.js` - builds the app's web bundle from the repo root:
  copies the 12 pages + shared JS + assets into `ios-app/www/`, then per page:
  - injects `native-shim.js` FIRST (marks native, rewrites `/api/*` calls to the live
    server, since inside the app there is no same-origin API);
  - **strips the Playwire ad tags** (web ad tags inside a native app violate ad-network
    policy and would tank the whole account - ads.md rules apply; ask Louis about their
    in-app SDK for a later version);
  - **strips Google Sign-In** (Google blocks its web login inside app WebViews). v1 is
    guest-first; Sign in with Apple is the v1.1 login (see Phase 3).
- `shim/native-shim.js` - the runtime glue described above.
- `ios-build.yml.example` - GitHub Actions workflow (manual-trigger only). Move it to
  `.github/workflows/ios-build.yml` when the Apple account exists and secrets are set.

## Phase 2 · First build (needs the Apple account from Phase 0)
On any Mac OR in CI (steps are the same, CI just runs them for you):
```bash
cd ios-app
npm install                 # capacitor cli + core + ios platform
npm run build:www           # bundle the site into www/
npx cap add ios             # generates the native Xcode project (commit it)
npx cap sync ios
```
Then either open in Xcode (Mac) and run on a simulator, or let the workflow archive +
upload to TestFlight. CI secrets needed (all from App Store Connect > Users & Access >
Integrations > App Store Connect API):
- `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the .p8 file contents, base64)
- `IOS_BUNDLE_ID` = com.wolfflabs.goatlab

## Phase 3 · Native must-haves BEFORE submitting (App Review will check)
| Item | Why | Effort |
|---|---|---|
| App icon + splash screen | Required | art only - config is scaffolded |
| **Sign in with Apple** | Guideline 4.8: any app with third-party login must offer it. v1 ships guest-first (no login UI in-app), which sidesteps it; v1.1 adds Apple login | server: new `apple:<sub>` key prefix in api/account.js (the key namespacing was designed for this) + identity-token verification endpoint |
| Strip web ads | AdSense/GPT/Playwire web tags are policy-invalid inside apps | DONE (build step) |
| No ATT prompt needed | We strip ads and GA4 isn't cross-app tracking | disclose analytics in the privacy label instead |
| Offline behavior | A blank white screen on no-signal is a rejection magnet | shim shows a styled "you're offline" screen when the API is unreachable at boot |
| "More than a website" (Guideline 4.2) | The #1 wrapper-app rejection | mitigations: bundled assets (not remote), haptics on key moments, push notifications (streak reminder + club drops are PERFECT uses), home-screen quick actions. Push is the strongest signal - schedule it for the first TestFlight build if possible |

## Phase 4 · App Store listing (can be drafted while builds cook)
- Screenshots: 6.7" (1290x2796) and 6.5" (1242x2688) sets - hub, a build mid-draft, the
  career card, 1v1 at-bat, franchise trophy. Screenshot from a simulator or big iPhone.
- Description + keywords (sports, GM, sim, baseball, basketball, soccer, career...).
- Privacy policy URL: already live at /privacy ✓.
- App Privacy questionnaire: Analytics (GA4 usage data, not linked to identity), no
  tracking, no data sold. Guest ids are app-functionality identifiers.
- Age rating questionnaire: everything "None" -> 4+.

## Phase 5 · TestFlight -> Submit
1. Upload a build (CI does this) -> TestFlight processes (~10 min).
2. Internal testing: your own devices, then the Discord crew as external testers (up to
   10k, needs a quick beta review, usually same-day).
3. Fix what the crew finds, then **Submit for Review**. First reviews take 1-3 days;
   rejections are normal - respond, fix, resubmit (the 4.2 mitigations above are the
   armor).

## Costs
- $99/yr Apple Developer Program. CI: free tier covers us. Nothing else.

## Open decisions for Matt
1. Individual vs LLC enrollment (see Phase 0 - recommendation: whichever is FASTER).
2. Ship v1 guest-first (recommended, fastest) vs wait for Sign in with Apple.
3. Push notifications in v1 (stronger review case, ~a day of extra work) or v1.1.
4. App display name: "GoatLab"? "GoatLab: Sports GM"? (Longer names help search.)

## What the app does NOT change
The website keeps running exactly as-is - same URLs, same ads, same everything. The app
is an additional shell over the same product; server changes (Apple sign-in) are additive.
