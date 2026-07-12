// Bakes hockey.json (the NHL game's data) from the OFFICIAL NHL stats API (api.nhle.com — open,
// no key). Unlike the other games there is no public ratings database (EA's drop-api 204s on
// every NHL slug), so ratings are DERIVED from real 2025-26 regular-season stats: each of the 8
// rated attributes is a stat composite ranked across the pool and mapped through a percentile
// curve onto the familiar 40-99 scale. "Live series = real-world-accurate" taken literally.
//   Pool  = skaters with >= MIN_GP games (goalies excluded, like RPs in the pitcher game).
//   Prime = synthesized +6/slot ovr+5 (CFB pattern — no special-edition cards exist for NHL).
//   Legends = hand-authored retired greats (ids resolved via search.d3.nhle.com for mugs).
// Headshots: assets.nhle.com/mugs/nhl/<season>/<team>/<id>.png (pool) / mugs/nhl/latest (legends).
//   Run: node fetch-hockey.js          (re-run any time; ~4 requests total)
// When the 2026-27 season has enough games (~Dec), bump SEASON.

const fs = require('fs');

const SEASON = 20252026;
const MIN_GP = 25;

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126', 'Accept': 'application/json' };
async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
  return r.json();
}
const REST = which => `https://api.nhle.com/stats/rest/en/skater/${which}?limit=-1&cayenneExp=seasonId=${SEASON}%20and%20gameTypeId=2`;

const POS = { C: 'C', L: 'LW', R: 'RW', D: 'D' };
const fmtHeight = inches => inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : null;

// Percentile -> rating curve. p in [0,1] over the pool ranking for that stat composite.
// Tuned so the weighted-OVR distribution matches the sibling games (median ~low 70s, a handful
// of diamonds, the very best offense stats hit 99).
const curve = p => Math.round(40 + 59 * Math.pow(p, 1.35));

// Rank-based percentile with average rank for ties, then curved.
function rateAll(rows, valueOf) {
  const vals = rows.map(valueOf);
  const sorted = vals.slice().sort((a, b) => a - b);
  const lo = v => { let a = 0, b = sorted.length; while (a < b) { const m = (a + b) >> 1; if (sorted[m] < v) a = m + 1; else b = m; } return a; };
  const hi = v => { let a = 0, b = sorted.length; while (a < b) { const m = (a + b) >> 1; if (sorted[m] <= v) a = m + 1; else b = m; } return a; };
  const n = sorted.length;
  return vals.map(v => curve(((lo(v) + hi(v)) / 2) / n));
}

// Small-sample shrinkage: a 25-game rate is pulled toward the mean harder than an 82-game one.
const shrink = (rate, gp) => rate * (gp / (gp + 12));

(async () => {
  const [sum, rt, bios] = await Promise.all([getJson(REST('summary')), getJson(REST('realtime')), getJson(REST('bios'))]);
  const rtById = new Map(rt.data.map(r => [r.playerId, r]));
  const bioById = new Map(bios.data.map(r => [r.playerId, r]));

  const rows = sum.data.filter(s => s.gamesPlayed >= MIN_GP && rtById.get(s.playerId) && bioById.get(s.playerId));
  console.log(`NHL ${SEASON}: ${sum.data.length} skaters, ${rows.length} with ${MIN_GP}+ GP`);

  // --- stat composites (higher = better). Rates are per-game / per-60 so injured stars rate fair.
  const comp = rows.map(s => {
    const r = rtById.get(s.playerId), gp = s.gamesPlayed;
    const toiMin = (s.timeOnIcePerGame || 0) / 60;
    return {
      sniping:    shrink(s.goals / gp, gp) + 0.012 * (s.shootingPct || 0) * 100,
      playmaking: shrink(s.assists / gp, gp),
      shotpower:  shrink(s.shots / gp, gp),
      physical:   (r.hitsPer60 || 0) + 0.02 * ((bioById.get(s.playerId).weight || 200) - 200),
      defense:    (r.blockedShotsPer60 || 0) * 0.8 + 0.06 * (s.plusMinus / gp) * 82 * 0.1 + ((r.takeawaysPer60 || 0) - (r.giveawaysPer60 || 0)) * 0.25,
      iq:         ((r.takeawaysPer60 || 0) - (r.giveawaysPer60 || 0)) + 0.02 * s.plusMinus,
      clutch:     shrink((s.gameWinningGoals + 1.5 * (s.otGoals || 0) + 0.5 * (s.shGoals || 0)) / gp, gp),
      motor:      toiMin,
    };
  });

  const KEYS = ['sniping', 'playmaking', 'shotpower', 'physical', 'defense', 'iq', 'clutch', 'motor'];
  const rated = {};
  for (const k of KEYS) rated[k] = rateAll(comp, c => c[k]);

  const pool = rows.map((s, i) => {
    const bio = bioById.get(s.playerId);
    const card = {
      name: s.skaterFullName,
      team: (s.teamAbbrevs || '').split(',').pop().trim() || bio.currentTeamAbbrev || 'FA',
      pos: POS[s.positionCode] || s.positionCode,
      nhlId: s.playerId,
      height: fmtHeight(bio.height), heightIn: bio.height || null,
    };
    for (const k of KEYS) card[k] = rated[k][i];
    return card;
  });

  // --- card OVR: production composite (points + ice time + defensive value), NOT the average of
  // the specialist attributes — averaging punishes specialists and caps stars at ~84. The card ovr
  // only drives tier/border/glow (build OVR comes from the slot values you assign), so it should
  // rank "how good is this player", like The Show/2K overalls do.
  const prod = rows.map((s, i) => {
    const gp = s.gamesPlayed, toiMin = (s.timeOnIcePerGame || 0) / 60;
    return shrink(s.points / gp, gp) + 0.35 * (toiMin / 20) + 0.30 * Math.max(0, comp[i].defense) / 6;
  });
  // Piecewise-linear through anchors tuned to match the sibling pools' tier spread
  // (pitchers/ballers: median ~73-77, ~13% diamond): p=0→45, .5→73, .87→85, 1→99.
  const OVR_ANCH = [[0, 45], [0.5, 73], [0.87, 85], [1, 99]];
  const ovrCurve = p => { for (let i = 1; i < OVR_ANCH.length; i++) { const [p0, r0] = OVR_ANCH[i - 1], [p1, r1] = OVR_ANCH[i]; if (p <= p1) return Math.round(r0 + (r1 - r0) * (p - p0) / (p1 - p0)); } return 99; };
  const sortedProd = prod.slice().sort((a, b) => a - b);
  const pctOf = v => { let a = 0, b = sortedProd.length; while (a < b) { const m = (a + b) >> 1; if (sortedProd[m] < v) a = m + 1; else b = m; } return a / sortedProd.length; };
  pool.forEach((p, i) => { p.ovr = ovrCurve(pctOf(prod[i])); });
  pool.sort((a, b) => b.ovr - a.ovr);

  const prime = {};
  for (const c of pool) {
    const pr = { ...c, ovr: Math.round(c.ovr + 5), synthPrime: true };
    for (const k of KEYS) pr[k] = Math.round(pr[k] + 6);
    prime[c.name] = pr;
  }

  // --- hand-authored retired greats (purple Legend cards). Ratings are era-lore, not derived.
  //     [name, pos, heightIn, ovr, sniping, playmaking, shotpower, physical, defense, iq, clutch, motor, team]
  const LEGENDS = [
    ['Wayne Gretzky',   'C',  72, 99, 97, 99, 88, 42, 70, 99, 99, 96, 'EDM'],
    ['Mario Lemieux',   'C',  76, 98, 99, 97, 96, 70, 72, 96, 97, 92, 'PIT'],
    ['Bobby Orr',       'D',  72, 98, 92, 97, 90, 82, 99, 98, 96, 97, 'BOS'],
    ['Gordie Howe',     'RW', 72, 97, 95, 91, 93, 97, 88, 94, 94, 96, 'DET'],
    ['Bobby Hull',      'LW', 70, 95, 97, 87, 99, 84, 74, 86, 90, 93, 'CHI'],
    ['Jaromir Jagr',    'RW', 75, 95, 94, 94, 93, 84, 76, 92, 92, 97, 'PIT'],
    ['Maurice Richard', 'RW', 70, 94, 98, 82, 92, 86, 72, 84, 99, 88, 'MTL'],
    ['Ray Bourque',     'D',  71, 94, 84, 90, 95, 84, 97, 95, 88, 98, 'BOS'],
    ['Nicklas Lidstrom','D',  73, 94, 78, 88, 86, 70, 99, 99, 92, 96, 'DET'],
    ['Jean Beliveau',   'C',  75, 94, 92, 93, 88, 80, 82, 93, 95, 91, 'MTL'],
    ['Mark Messier',    'C',  73, 93, 90, 92, 88, 94, 82, 92, 98, 95, 'NYR'],
    ['Steve Yzerman',   'C',  71, 93, 92, 93, 87, 74, 88, 95, 94, 92, 'DET'],
    ['Joe Sakic',       'C',  71, 93, 94, 92, 92, 66, 78, 92, 97, 92, 'COL'],
    ['Mike Bossy',      'RW', 72, 93, 99, 85, 90, 58, 68, 88, 94, 84, 'NYI'],
    ['Brett Hull',      'RW', 71, 93, 99, 82, 97, 62, 60, 84, 95, 86, 'STL'],
    ['Stan Mikita',     'C',  69, 92, 90, 93, 85, 74, 82, 96, 90, 90, 'CHI'],
    ['Phil Esposito',   'C',  73, 92, 96, 88, 92, 78, 66, 86, 92, 90, 'BOS'],
    ['Peter Forsberg',  'C',  72, 92, 88, 95, 84, 90, 84, 94, 93, 84, 'COL'],
    ['Teemu Selanne',   'RW', 72, 91, 96, 88, 91, 60, 66, 87, 90, 88, 'ANA'],
    ['Pavel Datsyuk',   'C',  71, 90, 86, 93, 80, 62, 92, 99, 90, 86, 'DET'],
    ['Paul Coffey',     'D',  72, 91, 88, 93, 90, 64, 84, 88, 86, 94, 'EDM'],
    ['Doug Harvey',     'D',  71, 91, 74, 88, 80, 84, 98, 96, 88, 94, 'MTL'],
    ['Denis Potvin',    'D',  72, 91, 84, 87, 88, 92, 95, 92, 92, 92, 'NYI'],
    ['Chris Pronger',   'D',  78, 90, 76, 84, 86, 97, 96, 90, 90, 95, 'ANA'],
    ['Scott Niedermayer','D', 73, 90, 78, 88, 84, 74, 95, 94, 93, 94, 'NJD'],
    ['Chris Chelios',   'D',  73, 90, 70, 82, 80, 94, 96, 92, 88, 97, 'CHI'],
    ['Guy Lafleur',     'RW', 72, 93, 95, 92, 90, 58, 68, 90, 94, 90, 'MTL'],
    ['Marcel Dionne',   'C',  68, 92, 95, 92, 88, 56, 62, 88, 86, 92, 'LAK'],
    ['Sergei Fedorov',  'C',  74, 92, 90, 91, 90, 76, 90, 94, 90, 93, 'DET'],
    ['Eric Lindros',    'C',  76, 91, 90, 88, 90, 98, 70, 84, 88, 82, 'PHI'],
    ['Pavel Bure',      'RW', 70, 92, 98, 84, 92, 62, 58, 84, 92, 84, 'VAN'],
    ['Jarome Iginla',   'RW', 73, 91, 93, 86, 92, 90, 72, 88, 93, 92, 'CGY'],
    ['Daniel Alfredsson','RW',71, 89, 88, 89, 87, 68, 76, 90, 88, 90, 'OTT'],
    ['Zdeno Chara',     'D',  81, 90, 72, 74, 96, 99, 97, 88, 88, 95, 'BOS'],
    ['Duncan Keith',    'D',  73, 89, 68, 84, 78, 70, 95, 93, 92, 97, 'CHI'],
    ['Henrik Sedin',    'C',  74, 89, 68, 97, 72, 60, 74, 94, 86, 92, 'VAN'],
  ].map(([name, pos, heightIn, ovr, sniping, playmaking, shotpower, physical, defense, iq, clutch, motor, team]) =>
    ({ name, team, ovr, pos, nhlId: null, height: fmtHeight(heightIn), heightIn, sniping, playmaking, shotpower, physical, defense, iq, clutch, motor, legend: true }));

  // Resolve legend ids for mugs via the NHL search API (retired players still have headshots
  // under mugs/nhl/latest/<id>.png). Name+position matched; a miss just means silhouette art.
  for (const leg of LEGENDS) {
    try {
      const res = await getJson(`https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=10&q=${encodeURIComponent(leg.name)}`);
      const hit = res.find(p => p.name.toLowerCase() === leg.name.toLowerCase() && !p.active) || res.find(p => p.name.toLowerCase() === leg.name.toLowerCase());
      if (hit) leg.nhlId = +hit.playerId;
    } catch (e) { /* silhouette fallback */ }
  }

  fs.writeFileSync('hockey.json', JSON.stringify({ season: SEASON, pool, prime, legends: LEGENDS }));

  // --- report
  const ovrs = pool.map(p => p.ovr);
  const tier = t => ovrs.filter(o => t[0] <= o && o <= t[1]).length;
  console.log(`Wrote hockey.json: ${pool.length} pool, ${Object.keys(prime).length} primes, ${LEGENDS.length} legends (${LEGENDS.filter(l => l.nhlId).length} with mugs)`);
  console.log(`OVR: top ${ovrs[0]} | p90 ${ovrs[Math.floor(ovrs.length * 0.1)]} | median ${ovrs[Math.floor(ovrs.length * 0.5)]} | grey<=64 ${tier([0, 64])} bronze ${tier([65, 74])} silver ${tier([75, 79])} gold ${tier([80, 84])} diamond85+ ${tier([85, 99])}`);
  console.log('Top 12: ' + pool.slice(0, 12).map(p => `${p.name}(${p.ovr} ${p.pos})`).join(', '));
  const top = k => pool.slice().sort((a, b) => b[k] - a[k]).slice(0, 5).map(p => `${p.name} ${p[k]}`).join(', ');
  for (const k of KEYS) console.log(`  ${k}: ${top(k)}`);
})();
