/* Goat Coins catalog — ONE source of truth for both sides (namefilter.js pattern):
     - Browser: <script src="/catalog.js" defer> → window.Catalog (display only —
       names, icons, prices the store UI renders).
     - Server:  require('../catalog.js') in api/account.js + api/buy.js — the ONLY
       prices that matter. coinSpend/checkout re-read them here, so a client can't
       invent a discount.

   COIN PACKS (real money, Stripe Checkout; usd = cents). Coins are signed-in only.
   SKUS (spend coins):
     type 'pass'       → entitlements.pass[season] = true (premium Season Track lane)
     type 'cosmetic'   → users.cosmetics.unlocked[id] = 1 (equips via the existing
                         Season Track / profile Style plumbing — id must exist in the
                         matching registry: AVATARS in social.js, COSMETICS in
                         season-track.js)
     type 'item'       → users.cosmetics.items[item] += qty (Scout/Re-sim tokens ·
                         note trackSync items are client-authoritative, the buyer's
                         device applies the new count immediately)
     type 'entitlement'→ entitlements[ent] = true (permanent flag, e.g. franchise perks)
     type 'tokens'     → entitlements counters (entitlements[ent] += qty)
     type 'noads'      → entitlements.no_ads_until = now + days (ad-free window)

   All amounts are // TUNE — Matt's balancing pass expected before real-money launch. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Catalog = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Real-money coin packs (usd in CENTS for Stripe; label is what the button shows).
  // Keys are internal ids (kept stable so in-flight Stripe metadata resolves); coins = payout.
  const PACKS = {
    c500:  { coins: 3000,  usd: 499,  label: 'Handful of Coins',  icon: '🪙' },            // TUNE
    c1200: { coins: 7000,  usd: 999,  label: 'Bag of Coins',      icon: '💰', tag: 'Most popular' },  // TUNE
    c2600: { coins: 16000, usd: 1999, label: 'Vault of Coins',    icon: '🏦', tag: 'Best value' },    // TUNE
  };

  // GoatLab Pro — real-money AUTO-RENEWING SUBSCRIPTION (NOT coins). Monthly or annual. Grants
  // no-ads + the premium Season Track lane (+ room for more perks). api/buy.js creates a
  // mode:'subscription' Checkout for the chosen plan; api/stripe-webhook.js sets entitlements
  // .pro_until (= no_ads_until) to each paid period's end (works for month OR year) and lapses on cancel.
  const PRO = {
    id: 'pro', name: 'GoatLab Pro', icon: '⭐',
    tagline: 'No ads · every GOAT Pass included · exclusive golden cosmetics',
    // What the buyer reads on the Stripe Checkout page itself (api/buy.js sends it as the
    // line-item description) — sell the full package, not just "no ads".
    checkoutDesc: 'Zero ads across every GoatLab game · every season’s full GOAT Pass included (~1450 coins back per season) · exclusive Midas Glow name effect + Golden Reel Trail · Pro star on your name. More Pro perks landing every season — cancel anytime.',
    perks: [
      'Zero ads across every GoatLab game',
      'Every season’s FULL GOAT Pass included (every tier: frames, avatars, name effects + ~1450 🪙 back per season)',
      '✨ Midas Glow — exclusive golden name effect with particles, shown in 1v1 and on the leaderboards',
      '⭐ Pro star on your name everywhere',
      'Golden Reel Trail on every spin',
      'Coming soon: monthly coin drop · Pro-only tournaments · early access to new sports',
    ],
    plans: {   // usd in CENTS. api/buy.js picks by body.cycle; the webhook reads the real period end.
      monthly: { usd: 499,  interval: 'month', label: 'Monthly' },                    // TUNE $4.99/mo
      yearly:  { usd: 3999, interval: 'year',  label: 'Yearly', tag: 'Save 33%' },    // TUNE $39.99/yr
    },
  };

  // Coin-priced store items. (Ad-free is Pro-only; the premium Season Track lane is included
  // with Pro OR sold here for coins — season:'current' resolves server-side via the shared
  // season clock, so this one SKU always sells the pass for whatever season is live.)
  const SKUS = {
    pass_cur: { type: 'pass', season: 'current', price: 1500, name: 'GOAT Pass — this season', icon: '🎫',  // TUNE
      desc: 'Unlock this season’s GOAT Pass — EVERY tier: exclusive cosmetics + 🪙 coins back. Included free with GoatLab Pro.' },

    // Cosmetics — ids live in social.js AVATARS (track:'future' art, already rendered + equippable).
    av_robot_ump:   { type: 'cosmetic', price: 350, name: 'Robo Ump Avatar', icon: '🤖', desc: 'Beep. Strike three.' },        // TUNE
    av_ghost_jersey:{ type: 'cosmetic', price: 350, name: 'Double Zero Avatar', icon: '👻', desc: 'The ghost in the lineup.' }, // TUNE
    av_astro_ball:  { type: 'cosmetic', price: 350, name: 'Moonshot Avatar', icon: '🚀', desc: 'Launch angle: vertical.' },     // TUNE

    // Jerseys (`jr_` prefix) — worn by the FIGURE in every build game (registry + CSS live in
    // jerseys.js; the store renders these with a live swatch + Equip toggle). Plain 'cosmetic'
    // type so unlock/sync ride the existing users.cosmetics plumbing.
    jr_pinstripe: { type: 'cosmetic', price: 150, name: 'Pinstripes Jersey', icon: '🦓', desc: 'Team-color pinstripes on white. Timeless.' },                // TUNE
    jr_retro:     { type: 'cosmetic', price: 200, name: 'Retro Cream Jersey', icon: '📻', desc: 'Sandlot cream with a team-color fade. Grandpa approves.' }, // TUNE
    jr_blackout:  { type: 'cosmetic', price: 200, name: 'Blackout Jersey', icon: '🌑', desc: 'City-edition black on black. Menacing.' },                     // TUNE
    jr_camo:      { type: 'cosmetic', price: 250, name: 'Night Ops Camo Jersey', icon: '🪖', desc: 'They never saw the fastball coming.' },                  // TUNE
    jr_gold:      { type: 'cosmetic', price: 300, name: 'All-Gold Jersey', icon: '🏆', desc: 'For players who already know they made the Hall.' },           // TUNE
    jr_chrome:    { type: 'cosmetic', price: 500, name: 'Diamond Chrome Jersey', icon: '💎', desc: 'Liquid-metal shine. The flex of flexes.' },              // TUNE

    // Consumables (Scout stays earnable FREE on the track — these are top-ups).
    scout_x5: { type: 'item', item: 'scout', qty: 5, price: 200, name: 'Scout Tokens ×5', icon: '🔭',   // TUNE
      desc: 'Peek the next spin before you commit. 5 uses.' },
    resim_x3: { type: 'item', item: 'resim', qty: 3, price: 250, name: 'Re-sim Tokens ×3', icon: '🔁',  // TUNE
      desc: 'Re-roll a finished career. 3 uses.' },

    // Franchise perks — DEFERRED (uncomment when the franchise pages actually read them):
    // the franchise engine is deterministic (==ENGINE== contract) and has no scouting system
    // yet, so selling these now would sell no-ops. The server-side entitlement plumbing
    // ('entitlement' + 'tokens' types) is live and waiting.
    // fr_scout_pack:  { type: 'entitlement', ent: 'fr_scout', price: 400, name: 'Front Office Scouting', icon: '🗂️',
    //   desc: 'Permanent: extra scouting reports on every franchise draft class.' },
    // fr_mulligan_x2: { type: 'tokens', ent: 'fr_mulligan', qty: 2, price: 300, name: 'Playoff Mulligans ×2', icon: '⏪',
    //   desc: 'Replay a lost playoff series. 2 uses, any franchise.' },
  };

  // Server-verified coin grants (client never picks amounts — these are read server-side).
  const EARN = {
    daily: 25,          // per validated Daily Challenge submission, per game, once per day  // TUNE
    dailyTop: [100, 50, 25], // Discord daily digest: yesterday's daily top-3 per game (accounts only, ledger ref dailytop:<date>:<game>:<sub>)  // TUNE
    // Cross-sport championships (api/champions.js scoring, crowned by the Discord digest cron):
    weeklyTop: [300, 150, 75],    // weekly Total Points top 3 (ref weektop:<monday>:<sub>)      // TUNE
    weeklyBestDay: 150,           // weekly Best Single Day winner (ref weekbest:<monday>:<sub>) // TUNE
    monthlyTop: [1000, 500, 250], // monthly Total Points top 3 (ref monthtop:<1st>:<sub>)       // TUNE
    monthlyBestDay: 400,          // monthly Best Single Day winner (ref monthbest:<1st>:<sub>)  // TUNE
    pvpWin: 10,         // per RANKED 1v1 win settled from locked builds                     // TUNE
    pvpWinDailyCap: 5,  // max coin-paying wins per day                                      // TUNE
    discord: 1000,      // one-time: joining the GoatLab Discord (per account)               // TUNE
    trackSeasonCap: 800, // max coins claimable from Season Track tiers per season           // TUNE
    // Daily 64-player Tournament placement payouts (one per player per bracket, best placement,
    // settled on locked truth only · ledger ref tourn:<bracketId>:<player_key>). See
    // tournament-design.md + tournament-engine.js. FEATURE-FLAGGED OFF until launch.
    tournament: { champion: 500, runnerUp: 250, semifinal: 120, quarterfinal: 60, round16: 30, round32: 15, round64: 5 }, // TUNE
  };

  // Season Track COIN tiers (the cosmetic tiers stay in season-track.js's SEASONS — these are
  // only the coin payouts, listed here so the SERVER can validate claims: sxp ≥ req, premium
  // lane needs the pass, one grant per tier per account). Per-season total must stay ≤
  // EARN.trackSeasonCap (free) — the premium lane's coins-back is the pass's value, not capped.
  const TRACK_COINS = {
    // Season 1 "Opening Day" — premium lane is unlocked by GoatLab Pro (not a coin pass).
    1: {
      free: [
        { req: 600,  coins: 100 },   // TUNE
        { req: 2100, coins: 150 },   // TUNE
        { req: 4500, coins: 200 },   // TUNE
      ],
      premium: [
        { req: 200,  coins: 150 },   // TUNE
        { req: 1200, coins: 200 },   // TUNE
        { req: 2800, coins: 250 },   // TUNE
        { req: 5000, coins: 400 },   // TUNE — ~1000 coins back over a season of Pro
      ],
    },
    // Season 2+ — paid-only GOAT Pass (2026-07-21): ONE lane ('premium', pass/Pro required —
    // trackClaimCoins now gates BOTH lanes anyway; S1 keeps its old split so existing claim
    // refs stay stable). S2 pays ~1450 back across the season on the 1500 pass.
    2: {
      free: [],
      premium: [
        { req: 300,  coins: 100 },   // TUNE
        { req: 900,  coins: 150 },   // TUNE
        { req: 1600, coins: 150 },   // TUNE
        { req: 2400, coins: 200 },   // TUNE
        { req: 3300, coins: 200 },   // TUNE
        { req: 4300, coins: 250 },   // TUNE
        { req: 5400, coins: 400 },   // TUNE
      ],
    },
  };

  return { PACKS, PRO, SKUS, EARN, TRACK_COINS };
});
