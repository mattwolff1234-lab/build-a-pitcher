/* ============================================================================
   Server-side build validation, shared by api/score.js (leaderboard + daily
   submits) and api/account.js (pvpLock — server-authoritative 1v1).
   CommonJS, namefilter.js-style single file. NOT loaded in the browser.

   Three layers (each rejects the whole submission):
     1. Slot caps (SLOT_MAX) — absolute per-label ceilings.
     2. OVR recompute (OVR_W) — weighted average of the submitted slot values
        must land within 3 of the claimed OVR (pitcher excluded: its client
        formula is value-scaled, not a plain weighted average).
     3. CARD TRUTH (cardIndex) — every verifiable slot must name a REAL player
        from the game's baked data, and the value can't exceed that player's
        best legit version (live/prime/legend/era) + the game's hot allowance.
        The data JSONs here are the SAME files the client plays from (bundled
        into the lambda by the require()s below), so one deploy keeps the
        client pool and the validator in lockstep.

   Frame slots are height-derived (per-game formulas) → card layer skips them;
   layer 1 still caps them. Versus quick-builds submit two legitimately CURVED
   value sets (pitcher Defense via curvePitchDef, all keeper slots via KP_LIFT
   — balance fixes in the versus pages) → pass {versus:true} to skip the card
   layer for exactly those slots.
   ========================================================================== */
'use strict';

const SLOT_MAX = {
  pitcher: { _default: 132, Break: 117, Command: 117, Defense: 115, 'Ground Ball': 119, Frame: 102 },
  batter:  { _default: 132, Speed: 117, Defense: 117, Frame: 96 },
  baller:  { _default: 133, '3-Pointer': 128, Finishing: 125, Dribble: 128, Playmaking: 125, Defense: 122, Speed: 123, Clutch: 126 },
  // Soccer caps = true maxima across pool+prime+icons in strikers/keepers.json, +5 boost headroom +3 buffer.
  striker: { _default: 125, Finishing: 123, Pace: 125, 'Shot Power': 119, Dribbling: 122, Passing: 122, Heading: 120, Physical: 119, Clutch: 119, Frame: 102 },
  keeper:  { _default: 122, Diving: 122, Reflexes: 122, Handling: 116, Distribution: 116, Positioning: 119, Agility: 113, Command: 119, Clutch: 119, Frame: 112 },
  // CFB27 raw attributes cap at 99; synthesized Primes add +6 and Boost keeps the better per
  // stat (no stacking), so 108 covers every legit slot. Frame = heightToRating (48+(in-66)*3.4).
  cfb:     { _default: 108, Frame: 102 },
  // Hockey ratings are percentile-curved to a 99 max; synthesized Primes add +6, so 108 covers
  // every legit slot. Frame = heightToRating (58+(in-73)*4.5, hard-capped 99 -> 6'9" Chara 94).
  hockey:  { _default: 108, Frame: 96 },
  // Monster ratings = real base stats * 0.68 + 12, capped 125 (Blissey's 255 HP pins it);
  // Mega/G-Max Primes carry real form stats and synth Primes add +6, so 134 covers every slot.
  mon:     { _default: 134, Frame: 100 },
};

// Plain weighted-avg OVR · matches batter/baller's client computeOvr exactly, so we can reject an
// inflated OVR claim. Pitcher uses a value-scaled formula, so we don't recompute it (its slot caps
// still block impossible ratings).
const OVR_W = {
  batter: { Vision: 1.1, Power: 1.2, Contact: 1.2, Speed: 1.0, Clutch: 1.1, Discipline: 1.1, Frame: 1.0, Defense: 1.0 },
  baller: { '3-Pointer': 1.2, Finishing: 1.2, Playmaking: 1.2, Dribble: 1.1, Defense: 1.1, Rebounding: 1.1, Clutch: 1.1, Speed: 0.9, Frame: 1.0 },
  striker: { Finishing: 1.2, Pace: 1.2, Dribbling: 1.1, 'Shot Power': 1.1, Passing: 1.1, Clutch: 1.1, Heading: 1.0, Physical: 1.0, Frame: 0.7 },
  keeper: { Reflexes: 1.2, Diving: 1.2, Positioning: 1.1, Handling: 1.1, Clutch: 1.1, Frame: 1.1, Command: 1.0, Distribution: 1.0, Agility: 1.0 },
  // cfb: one flat map spanning all three positions' slot labels (labels are unique per weight -
  // RB's catch slot is labeled "Catching" so it can't collide with WR's 1.2x "Hands").
  cfb: { 'Short Accuracy': 1.2, 'Mid Accuracy': 1.2, 'Deep Ball': 1.2, 'Arm Power': 1.1, Poise: 1.1, 'Football IQ': 1.1, 'On the Run': 1.0, Wheels: 1.0,
    Vision: 1.2, 'Break Tackle': 1.2, Power: 1.1, Burst: 1.1, Elusiveness: 1.1, 'Ball Security': 1.0, Catching: 1.0,
    Hands: 1.2, Routes: 1.2, Speed: 1.2, Release: 1.1, 'In Traffic': 1.1, Spectacular: 1.1, Agility: 1.0, Leaping: 1.0, Frame: 1.0 },
  hockey: { Sniping: 1.2, Playmaking: 1.2, Defense: 1.2, Motor: 1.1, Clutch: 1.1, 'Hockey IQ': 1.1, 'Shot Power': 1.0, Physicality: 1.0, Frame: 1.0 },
  mon: { Attack: 1.2, 'Sp. Attack': 1.2, Speed: 1.2, HP: 1.1, 'Sp. Defense': 1.1, Defense: 1.0, Frame: 1.0 },
};

const LEGEND_CAP = { baller: 6, batter: 7, pitcher: 7, striker: 6, keeper: 6, cfb: 6, hockey: 6, mon: 5 };   // observed legit maxima: baller 3, batter 4, pitcher 5; soccer icon odds match baller's 4%

// Slot label → the data-field it reads on a player object (mirrors each page's SLOTS array;
// cfb is the union of all three positions). Frame is deliberately ABSENT everywhere — its value
// is height-derived per game, so the card layer can't verify it (SLOT_MAX still caps it).
const FIELD = {
  pitcher: { 'Ground Ball': 'hr_per_bf', Break: 'pitch_movement', Strikeout: 'k_per_bf', Velocity: 'pitch_velocity',
    Command: 'pitch_control', Clutch: 'pitching_clutch', Defense: 'fielding_ability', Stamina: 'stamina' },
  batter: { Vision: 'plate_vision', Power: 'power', Contact: 'contact', Speed: 'speed',
    Clutch: 'batting_clutch', Discipline: 'plate_discipline', Defense: 'fielding_ability' },
  baller: { '3-Pointer': 'threept', Finishing: 'finishing', Dribble: 'dribble', Playmaking: 'playmaking',
    Defense: 'defense', Rebounding: 'rebounding', Speed: 'speed', Clutch: 'clutch' },
  striker: { Finishing: 'finishing', Pace: 'pace', 'Shot Power': 'power', Dribbling: 'dribbling',
    Passing: 'passing', Heading: 'heading', Physical: 'physical', Clutch: 'clutch' },
  keeper: { Diving: 'diving', Reflexes: 'reflexes', Handling: 'handling', Distribution: 'distribution',
    Positioning: 'positioning', Agility: 'agility', Command: 'command', Clutch: 'clutch' },
  cfb: { 'Short Accuracy': 'shortAcc', 'Arm Power': 'armPower', 'Football IQ': 'iq', Poise: 'poise',
    'Deep Ball': 'deepAcc', 'Mid Accuracy': 'midAcc', 'On the Run': 'onRun', Wheels: 'wheels',
    Vision: 'vision', Power: 'power', 'Break Tackle': 'breakTk', 'Ball Security': 'ballSec',
    Catching: 'hands', Elusiveness: 'elusive', Burst: 'burst',
    Routes: 'routes', Hands: 'hands', Spectacular: 'spectac', Release: 'release',
    'In Traffic': 'traffic', Leaping: 'leap', Agility: 'agility', Speed: 'speed' },
  hockey: { Sniping: 'sniping', Playmaking: 'playmaking', 'Shot Power': 'shotpower', Physicality: 'physical',
    Defense: 'defense', 'Hockey IQ': 'iq', Motor: 'motor', Clutch: 'clutch' },
  mon: { 'Sp. Attack': 'spatk', Attack: 'attack', 'Sp. Defense': 'spdef', Defense: 'defense', HP: 'hp', Speed: 'speed' },
};

// Power-up headroom on top of a player's best indexed version (live/prime/legend/era):
// the Boost power-up guarantees >= +5 per attribute over the LANDED card (all games), and in
// baseball the landed card can already be a 🔥 hot version (+10 on every rated stat) — so a
// legit baseball slot can sit 15 above the raw card (99 Break → 114 hot+boosted).
const CARD_ALLOW = { pitcher: 15, batter: 15, _default: 5 };

// Versus quick-builds legitimately CURVE these slots above raw card values (balance fixes):
// pitcher Defense via curvePitchDef (max raw 99 → curved ~131 < SLOT_MAX 115? no — curve output
// is capped by SLOT_MAX.Defense 115 in layer 1; skip only the card layer), keeper = every slot
// via KP_LIFT (converges ≤110).
const VERSUS_SKIP = { pitcher: { Defense: 1 }, keeper: '*' };

// ---- card truth index: game → Map(lowercase name → { label: max legit value }) --------------
// Built lazily from the SAME baked JSONs the client plays from (bundled via these require()s,
// exactly like legendSet always did). ~4,700 players × ≤9 slots — a few ms, once per lambda.
let _cards = null;
function loadAll() {
  // Every source card variant a player can legally be assigned from:
  // pool (live) + prime map (Boost) + legends (+ ballers' era primes; cfb per-position).
  const d = {
    pitcher: (j => [j.pool, Object.values(j.prime || {}), j.legends])(require('./pitchers.json')),
    batter: (j => [j.pool, Object.values(j.prime || {}), j.legends])(require('./batters.json')),
    baller: (j => [j.pool, Object.values(j.prime || {}), j.legends, j.eraPrimes])(require('./ballers.json')),
    striker: (j => [j.pool, Object.values(j.prime || {}), j.legends])(require('./strikers.json')),
    keeper: (j => [j.pool, Object.values(j.prime || {}), j.legends])(require('./keepers.json')),
    hockey: (j => [j.pool, Object.values(j.prime || {}), j.legends])(require('./hockey.json')),
    mon: (j => [j.pool, Object.values(j.prime || {}), j.legends])(require('./pokemon.json')),
    cfb: (j => {
      const out = [];
      for (const p of ['qb', 'rb', 'wr']) {
        const pos = (j.positions || {})[p] || {};
        out.push(pos.pool, Object.values(pos.prime || {}), (j.legends || {})[p]);
      }
      return out;
    })(require('./cfb.json')),
  };
  const cards = {};
  for (const game of Object.keys(d)) {
    const fields = FIELD[game];
    const idx = new Map();
    for (const src of d[game]) {
      for (const p of (src || [])) {
        if (!p || !p.name) continue;
        const nm = String(p.name).trim().toLowerCase();
        let rec = idx.get(nm);
        if (!rec) { rec = {}; idx.set(nm, rec); }
        for (const label of Object.keys(fields)) {
          const v = Number(p[fields[label]]);
          if (Number.isFinite(v) && (rec[label] == null || v > rec[label])) rec[label] = v;
        }
      }
    }
    cards[game] = idx;
  }
  return cards;
}
function cardIndex(game) {
  if (!_cards) { try { _cards = loadAll(); } catch (e) { _cards = {}; } }
  return _cards[game] || null;
}

// Legend names per game, from the same data (blocks impossible "all-legends" builds: legends
// only come from random spins at ~3-4%, so more than a few means a client-edited payload).
// Matched by player NAME, not the client-supplied `legend` flag a cheat could fake.
let _legends = null;
function legendSet(game) {
  if (!_legends) {
    const names = d => new Set((((d && d.legends) || [])).map(p => String((p && p.name) || '').trim().toLowerCase()).filter(Boolean));
    try {
      _legends = { pitcher: names(require('./pitchers.json')), batter: names(require('./batters.json')), baller: names(require('./ballers.json')),
        striker: names(require('./strikers.json')), keeper: names(require('./keepers.json')), hockey: names(require('./hockey.json')), mon: names(require('./pokemon.json')) };
      const cfbLeg = require('./cfb.json').legends || {};
      _legends.cfb = names({ legends: [].concat(cfbLeg.qb || [], cfbLeg.rb || [], cfbLeg.wr || []) });
    } catch (e) { _legends = { pitcher: new Set(), batter: new Set(), baller: new Set(), striker: new Set(), keeper: new Set(), cfb: new Set(), hockey: new Set(), mon: new Set() }; }
  }
  return _legends[game] || null;
}

// opts.versus → the submission came from a versus quick-build (curved-slot card-layer skips).
function checkBuild(game, clientOvr, build, opts) {
  const versus = !!(opts && opts.versus);
  const ovr = Math.max(1, Math.min(120, Math.round(Number(clientOvr) || 0)));
  const maxes = SLOT_MAX[game];
  const slots = build && typeof build === 'object' && Array.isArray(build.slots) ? build.slots : null;
  if (!slots || !slots.length || !maxes) {
    // A missing/empty build used to pass with the client's OVR — a leaderboard-forge hole.
    // Pitcher solo submits must carry a real build (the client always sends the full 9 slots).
    if (game === 'pitcher' && !versus) return { ok: false };
    return { ok: true, ovr };   // nothing to validate (legacy/missing build) for other flows
  }
  let vsum = 0, wsum = 0, matched = 0, flagLeg = 0, nameLeg = 0;
  const w = OVR_W[game];
  const legs = legendSet(game);
  const cards = cardIndex(game);
  const fields = FIELD[game];
  const allow = CARD_ALLOW[game] != null ? CARD_ALLOW[game] : CARD_ALLOW._default;
  const vSkip = versus ? VERSUS_SKIP[game] : null;
  for (const s of slots) {
    const v = Number(s && s.value);
    if (!Number.isFinite(v) || v < 0) return { ok: false };
    const cap = maxes[s.slot] != null ? maxes[s.slot] : maxes._default;
    if (v > cap) return { ok: false };
    if (s && s.legend === true) flagLeg++;
    if (legs && s && legs.has(String((s.player) || '').trim().toLowerCase())) nameLeg++;
    if (w && w[s.slot] != null) { vsum += v * w[s.slot]; wsum += w[s.slot]; matched++; }
    // card truth: a verifiable slot must name a real player and stay within their best version
    if (cards && cards.size && fields && fields[s.slot] != null && !(vSkip === '*' || (vSkip && vSkip[s.slot]))) {
      const nm = String((s && s.player) || '').trim().toLowerCase();
      const rec = nm && cards.get(nm);
      if (!rec) return { ok: false };                     // missing or unknown player name
      const mx = rec[s.slot];
      if (mx == null || v > mx + allow) return { ok: false };   // above their best legit version
    }
  }
  if (Math.max(flagLeg, nameLeg) >= (LEGEND_CAP[game] || 99)) return { ok: false };   // impossible legend count
  if (w && wsum > 0 && matched === slots.length) {
    const recomputed = Math.round(vsum / wsum);
    if (recomputed > 124 || Math.abs(recomputed - ovr) > 3) return { ok: false };   // inflated / implausible OVR
  }
  // Pitcher solo OVR is value-scaled (dynamic Defense/Frame weights), so it isn't in OVR_W and the
  // generic recompute above skips it. Recompute it here — require the full, honest 9-slot build —
  // so a plausible low build can't claim a high OVR (closes the documented pitcher forge hole).
  if (game === 'pitcher' && !versus) {
    const PIT_LABELS = ['Ground Ball', 'Break', 'Strikeout', 'Velocity', 'Command', 'Clutch', 'Defense', 'Frame', 'Stamina'];
    const have = new Set(slots.map(s => s && s.slot));
    if (slots.length !== 9 || !PIT_LABELS.every(l => have.has(l))) return { ok: false };
    const recomputed = pitcherSoloOvr(slots);
    if (recomputed > 124 || Math.abs(recomputed - ovr) > 3) return { ok: false };
  }
  return { ok: true, ovr };
}

// Versus PITCHER OVR uses dynamic weights (versus.html slotWeightP: Defense ramps 0.3→1.2 with
// the curved value, Frame ramps 0.4→1.3) — reproduced by LABEL here so pvpLock can recompute it
// server-side. (checkBuild skips pitcher recompute because the SOLO game's formula is
// value-scaled and not replicated; versus is the flow where OVR decides real Elo, so it gets
// the exact check.)
const clamp01 = v => Math.max(0, Math.min(1, v));
const VP_W = { Strikeout: 1.2, 'Ground Ball': 1.2, Command: 1.2, Velocity: 1.1, Break: 1.1, Stamina: 1.1, Clutch: 1.1 };
function versusPitcherOvr(slots) {
  let vs = 0, ws = 0;
  for (const s of (slots || [])) {
    const v = Number(s && s.value) || 0;
    const w = s.slot === 'Defense' ? 0.3 + 0.9 * clamp01((v - 70) / 22)
      : s.slot === 'Frame' ? 0.4 + 0.9 * clamp01((v - 78) / 14)
      : VP_W[s.slot] || 1;
    vs += v * w; ws += w;
  }
  return ws ? Math.round(vs / ws) : 0;
}

// SOLO pitcher OVR — replicates pitcher.html weightedOvr()/slotWeight(): base label weights plus
// value-scaled Defense/Frame ramps (0.4→1.3, ramp(73,85) / ramp(78,92)). Lets checkBuild reject an
// inflated pitcher OVR claim (the solo formula is value-scaled, so it can't live in OVR_W).
const PIT_W = { Strikeout: 1.2, 'Ground Ball': 1.2, Command: 1.2, Velocity: 1.1, Break: 1.1, Stamina: 1.1, Clutch: 1.1 };
function pitcherSoloOvr(slots) {
  let vs = 0, ws = 0;
  for (const s of (slots || [])) {
    const v = Number(s && s.value) || 0;
    const w = s.slot === 'Defense' ? 0.4 + 0.9 * clamp01((v - 73) / 12)
      : s.slot === 'Frame' ? 0.4 + 0.9 * clamp01((v - 78) / 14)
      : PIT_W[s.slot] || 1;
    vs += v * w; ws += w;
  }
  return ws ? Math.round(vs / ws) : 0;
}

module.exports = { checkBuild, versusPitcherOvr, SLOT_MAX, OVR_W, LEGEND_CAP, legendSet };
