/* ============================================================================
   cfb-franchise-engine.js — deterministic College Football dynasty engine.

   Single-school dynasty (NOT the baseball pro model): pick a school, run a real
   college season — 12-game schedule, weekly AP poll, conference standings,
   rivalry game, conference championship, 12-team CFP — win the natty, then an
   offseason (recruiting + transfer portal) evolves the roster, and on to next
   year. See cfb-franchise-design.md.

   ==ENGINE== DETERMINISM CONTRACT (must not break):
   Everything below is a PURE function of (school, seed, offseason-choices). NO
   Math.random and NO Date/Date.now anywhere in this file. All randomness comes
   from mulberry32 seeded off the dynasty seed + a stable sub-seed per season /
   game / phase. Replaying a save reproduces the exact schedule, every score, the
   AP poll, the standings, and the CFP bracket — byte-identical. (Same pattern as
   franchise.html's ==ENGINE== block and college.html's seeded career sim.)

   Dual-env (namefilter.js pattern): exports for Node (harness) + window.CFBFranchise
   for the browser page.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CFBFranchise = api;
})(this, function () {
  'use strict';

  /* ---------- seeded RNG (mulberry32 — same family college.html uses) ---------- */
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Stable string→uint32 hash so seed-strings ("<seed>|2027|w3|Oregon") are reproducible.
  function hashStr(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const rngOf = (seed, tag) => mulberry32(hashStr(seed + '|' + tag));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- conferences + rivalries (hand-authored: cfb.json has none) ---------- */
  const CONFERENCES = {
    SEC: ['Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU', 'Mississippi State',
      'Missouri', 'Ole Miss', 'Oklahoma', 'South Carolina', 'Tennessee', 'Texas', 'Texas A&M', 'Vanderbilt'],
    'Big Ten': ['Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State', 'Minnesota',
      'Nebraska', 'Northwestern', 'Ohio State', 'Oregon', 'Penn State', 'Purdue', 'Rutgers', 'UCLA',
      'USC', 'Washington', 'Wisconsin'],
    'Big 12': ['Arizona', 'Arizona State', 'Baylor', 'BYU', 'Cincinnati', 'Colorado', 'Houston',
      'Iowa State', 'Kansas', 'Kansas State', 'Oklahoma State', 'TCU', 'Texas Tech', 'UCF', 'Utah',
      'West Virginia'],
    ACC: ['Boston College', 'California', 'Clemson', 'Duke', 'Florida State', 'Georgia Tech',
      'Louisville', 'Miami', 'NC State', 'North Carolina', 'Pittsburgh', 'SMU', 'Stanford', 'Syracuse',
      'Virginia', 'Virginia Tech', 'Wake Forest'],
    Independent: ['Notre Dame', 'Marshall'],
  };
  const CONF_OF = {};
  for (const c in CONFERENCES) CONFERENCES[c].forEach(t => { CONF_OF[t] = c; });

  // Primary rivalry per school (the locked week-11 game). Cross-conference is fine (realistic).
  const RIVALRIES = {
    Alabama: 'Auburn', Auburn: 'Alabama', 'Ohio State': 'Michigan', Michigan: 'Ohio State',
    Oregon: 'Washington', Washington: 'Oregon', USC: 'UCLA', UCLA: 'USC', Texas: 'Oklahoma',
    Oklahoma: 'Texas', Georgia: 'Florida', Florida: 'Georgia', Clemson: 'South Carolina',
    'South Carolina': 'Clemson', Miami: 'Florida State', 'Florida State': 'Miami',
    California: 'Stanford', Stanford: 'California', 'Oklahoma State': 'Kansas State',
    'Kansas State': 'Kansas', Kansas: 'Kansas State', Utah: 'BYU', BYU: 'Utah',
    'Notre Dame': 'USC', 'Michigan State': 'Michigan', 'Indiana': 'Purdue', Purdue: 'Indiana',
    Iowa: 'Iowa State', 'Iowa State': 'Iowa', Pittsburgh: 'West Virginia', 'West Virginia': 'Pittsburgh',
    Virginia: 'Virginia Tech', 'Virginia Tech': 'Virginia', 'North Carolina': 'NC State',
    'NC State': 'North Carolina', Duke: 'Wake Forest', 'Wake Forest': 'Duke', Tennessee: 'Vanderbilt',
    Vanderbilt: 'Tennessee', Kentucky: 'Louisville', Louisville: 'Kentucky', 'Texas A&M': 'LSU',
    LSU: 'Texas A&M', Missouri: 'Arkansas', Arkansas: 'Missouri', Minnesota: 'Wisconsin',
    Wisconsin: 'Minnesota', Nebraska: 'Illinois', Illinois: 'Northwestern', Northwestern: 'Nebraska',
    Maryland: 'Rutgers', Rutgers: 'Maryland', Syracuse: 'Boston College', 'Boston College': 'Syracuse',
    Baylor: 'TCU', TCU: 'Baylor', Arizona: 'Arizona State', 'Arizona State': 'Arizona',
    Cincinnati: 'Houston', Houston: 'Cincinnati', Colorado: 'Utah', 'Georgia Tech': 'Clemson',
    SMU: 'TCU', UCF: 'Cincinnati', 'Mississippi State': 'Ole Miss', 'Ole Miss': 'Mississippi State',
    'Texas Tech': 'Baylor', Marshall: 'Cincinnati',
  };
  const rivalOf = t => RIVALRIES[t] || null;

  /* ---------- team prestige (derived from the cfb.json player pools) ----------
     cfb.json teams carry only {color,img}; strength comes from each school's QB/RB/WR pools.
     computePrestige(cfb) → { team: 40..99 }. Pass the result into every engine call so the
     engine stays a pure function (no global data dependency). */
  function computePrestige(cfb) {
    const best = {};                       // team -> [topQB, topRB, topWR, depthAvg]
    for (const pos of ['qb', 'rb', 'wr']) {
      const pool = (cfb.positions && cfb.positions[pos] && cfb.positions[pos].pool) || [];
      const byTeam = {};
      pool.forEach(p => { (byTeam[p.team] = byTeam[p.team] || []).push(p.ovr || 0); });
      for (const t in byTeam) {
        byTeam[t].sort((a, b) => b - a);
        best[t] = best[t] || { top: [], depth: [] };
        best[t].top.push(byTeam[t][0] || 0);
        best[t].depth.push(...byTeam[t].slice(0, 3));
      }
    }
    // raw score = 0.6*avg(top per position) + 0.4*avg(depth top-3). Then rank-normalize to 40..99.
    const raw = {};
    const teams = Object.keys(cfb.teams || {});
    teams.forEach(t => {
      const b = best[t];
      if (!b || !b.top.length) { raw[t] = 60; return; }
      const topAvg = b.top.reduce((a, x) => a + x, 0) / b.top.length;
      const depthAvg = b.depth.reduce((a, x) => a + x, 0) / b.depth.length;
      raw[t] = 0.6 * topAvg + 0.4 * depthAvg;
    });
    const sorted = teams.slice().sort((a, b) => raw[a] - raw[b]);   // ascending
    const out = {};
    sorted.forEach((t, i) => { out[t] = Math.round(40 + (sorted.length <= 1 ? 55 : (i / (sorted.length - 1)) * 55)); });
    return out;   // 40 (worst) .. 95 (best)
  }

  /* ---------- new dynasty ---------- */
  function newDynasty(school, seed, startYear) {
    return {
      v: 1, school, seed: (seed >>> 0), year: startYear || 2026, prog: 0,
      prestigeSelf: null,          // set on first season from computePrestige, then evolves
      history: [], season: null,
      trophies: { natties: 0, confTitles: 0, playoffApps: 0, cfpWins: 0 },
    };
  }

  // effective prestige of a team this season: the base pool prestige, plus (for the user's school)
  // the accumulated recruiting/portal drift stored on the save.
  function teamPrestige(save, prestige, team) {
    if (team === save.school && save.prestigeSelf != null) return save.prestigeSelf;
    return prestige[team] != null ? prestige[team] : 60;
  }

  /* ---------- schedule generation (12 games) ---------- */
  function buildSchedule(save, prestige) {
    const { school, seed, year } = save;
    const rng = rngOf(seed + '', year + '|sched');
    const conf = CONF_OF[school] || 'Independent';
    const confMates = (CONFERENCES[conf] || []).filter(t => t !== school);
    const rival = rivalOf(school);
    const games = [];
    // 8 conference games (seeded selection from conf mates; Independents get a pseudo-conf slate)
    let confPool = confMates.slice();
    if (confPool.length < 8) {   // Independent: fill from a blue-blood-weighted national pool
      const all = Object.keys(prestige).filter(t => t !== school);
      while (confPool.length < 8) { const c = pick(rng, all); if (!confPool.includes(c)) confPool.push(c); }
    }
    // shuffle deterministically, take 8
    confPool = confPool.map(t => [t, rng()]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const confOpps = confPool.slice(0, 8);
    // 3 non-conference (blue-blood weighted from OTHER conferences), + the rival (locked wk11)
    const others = Object.keys(prestige).filter(t => t !== school && CONF_OF[t] !== conf && t !== rival);
    const nonCon = [];
    while (nonCon.length < 3 && others.length) {
      // blue-blood weight: higher prestige slightly more likely (marquee non-con games)
      const cand = pick(rng, others);
      if (rng() < 0.4 + (teamPrestige(save, prestige, cand) - 40) / 120) {
        if (!nonCon.includes(cand)) nonCon.push(cand);
      }
    }
    while (nonCon.length < 3) { const c = pick(rng, others); if (!nonCon.includes(c)) nonCon.push(c); }
    // assemble 12: interleave; rival locked at week 11; home/away alternating from a seeded start
    const slate = [];
    confOpps.forEach(t => slate.push({ opp: t, conf: true }));
    nonCon.forEach(t => slate.push({ opp: t, conf: false }));
    // deterministic order
    const ordered = slate.map(g => [g, rng()]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    ordered.splice(10, 0, rival ? { opp: rival, conf: CONF_OF[rival] === conf, rival: true } : ordered.pop());
    let homeStart = rng() < 0.5;
    return ordered.slice(0, 12).map((g, i) => ({
      week: i + 1, opp: g.opp, conf: !!g.conf, rival: !!g.rival,
      home: (homeStart ? (i % 2 === 0) : (i % 2 === 1)),
      played: false, us: 0, them: 0, won: null, line: null,
    }));
  }

  /* ---------- one game (seeded from both teams' strength) ---------- */
  function simGame(save, prestige, g) {
    const usP = teamPrestige(save, prestige, save.school);
    const themP = teamPrestige(save, prestige, g.opp);
    const rng = rngOf(save.seed + '', save.year + '|g|' + g.week + '|' + g.opp);
    const homeEdge = g.home ? 2.5 : -2.5;
    // expected margin from prestige gap (+ home edge), plus seeded variance (upsets)
    const gap = (usP - themP) + homeEdge;
    const variance = (rng() + rng() + rng() - 1.5) * 17;   // ~N(0, ~10), heavy enough for upsets
    let margin = gap * 0.9 + variance;
    // scores: base points scaled by offense (prestige) + noise; ensure a winner (no ties in CFB)
    const usPts = clamp(Math.round(17 + (usP - 55) * 0.5 + rng() * 24 + Math.max(0, margin) * 0.5), 3, 70);
    let themPts = clamp(Math.round(17 + (themP - 55) * 0.5 + rng() * 24 + Math.max(0, -margin) * 0.5), 3, 70);
    let us = usPts, them = themPts;
    if (us === them) { if (margin >= 0) us += 3; else them += 3; }   // OT breaker toward the favorite/margin
    const won = us > them;
    // a QB stat line for our school (reused flavor; deterministic)
    const line = { passYd: Math.round(180 + rng() * 200 + (usP - 55) * 2), passTd: Math.round(rng() * 4 + (won ? 1 : 0)),
      rushYd: Math.round(80 + rng() * 160), rushTd: Math.round(rng() * 3) };
    return { us, them, won, line };
  }

  /* ---------- AP-style national poll (all teams carry a seeded record) ---------- */
  // Simulate every OTHER team's record for the season deterministically (cheap model) so we can rank
  // the whole country each week and after the regular season. Our school uses the real played results.
  function nationalRecords(save, prestige, throughWeek) {
    const recs = {};
    const teams = Object.keys(prestige);
    teams.forEach(t => {
      if (t === save.school) return;
      const rng = rngOf(save.seed + '', save.year + '|natl|' + t);
      const p = teamPrestige(save, prestige, t);
      let w = 0;
      for (let i = 0; i < throughWeek; i++) {
        // win prob vs an average opponent scaled by prestige
        const pr = clamp(0.5 + (p - 65) / 60, 0.08, 0.94);
        if (rng() < pr) w++;
      }
      recs[t] = { wins: w, losses: throughWeek - w, prestige: p };
    });
    return recs;
  }
  function apPoll(save, prestige, throughWeek, ourWins, ourLosses) {
    const recs = nationalRecords(save, prestige, throughWeek);
    recs[save.school] = { wins: ourWins, losses: ourLosses, prestige: teamPrestige(save, prestige, save.school) };
    const scored = Object.keys(recs).map(t => {
      const r = recs[t];
      // poll score: wins dominate, prestige breaks near-ties, losses hurt
      const score = r.wins * 10 - r.losses * 6 + r.prestige * 0.35 + hashStr(save.seed + t + save.year) % 100 / 100;
      return { team: t, wins: r.wins, losses: r.losses, prestige: r.prestige, score };
    }).sort((a, b) => b.score - a.score);
    return scored;   // index 0 = #1
  }

  /* ---------- 12-team CFP bracket (structure mirrors college.html's) ----------
     Field = 5 conference champions (auto-bids, seeds by AP) + 7 at-large by AP. Seeds 1-4 get a
     first-round bye. Win prob from prestige + seed edge; blue-bloods weighted. Natty ONLY by sweeping;
     losing the final = runner-up. Every game is seeded so the whole bracket replays identically. */
  function runCFP(save, prestige, field) {
    // field: [{team, seed}] length 12, seed 1..12
    const rng = rngOf(save.seed + '', save.year + '|cfp');
    const byId = {};
    field.forEach(f => { byId[f.seed] = f; });
    const winProb = (a, b) => {
      const pa = teamPrestige(save, prestige, a.team) + (13 - a.seed) * 1.4;
      const pb = teamPrestige(save, prestige, b.team) + (13 - b.seed) * 1.4;
      return clamp(1 / (1 + Math.pow(10, (pb - pa) / 22)), 0.05, 0.95);
    };
    const game = (a, b, roundTag) => {
      const gr = rngOf(save.seed + '', save.year + '|cfp|' + roundTag + '|' + a.seed + 'v' + b.seed);
      const p = winProb(a, b);
      const aWin = gr() < p;
      return aWin ? a : b;
    };
    const log = [];
    // First round: 5v12, 6v11, 7v10, 8v9 (seeds 1-4 bye)
    const r1 = [[5, 12], [6, 11], [7, 10], [8, 9]].map(([h, l]) => game(byId[h], byId[l], 'r1'));
    log.push({ round: 'First Round', winners: r1.map(w => w.team) });
    // Quarters: 1 vs winner(8/9), 2 vs winner(7/10), 3 vs winner(6/11), 4 vs winner(5/12)
    const qf = [
      game(byId[1], r1[3], 'qf'), game(byId[2], r1[2], 'qf'),
      game(byId[3], r1[1], 'qf'), game(byId[4], r1[0], 'qf'),
    ];
    log.push({ round: 'Quarterfinal', winners: qf.map(w => w.team) });
    const sf = [game(qf[0], qf[1], 'sf'), game(qf[2], qf[3], 'sf')];
    log.push({ round: 'Semifinal', winners: sf.map(w => w.team) });
    const champ = game(sf[0], sf[1], 'final');
    const runnerUp = champ === sf[0] ? sf[1] : sf[0];
    log.push({ round: 'National Championship', winners: [champ.team] });
    const usIn = field.some(f => f.team === save.school);
    const weWon = champ.team === save.school;
    const weRunnerUp = runnerUp.team === save.school;
    // how far did WE go?
    let ourResult = 'missed';
    if (usIn) {
      if (weWon) ourResult = 'champion';
      else if (weRunnerUp) ourResult = 'runner-up';
      else if (sf.some(w => w.team === save.school)) ourResult = 'semifinal';
      else if (qf.some(w => w.team === save.school)) ourResult = 'quarterfinal';
      else if (r1.some(w => w.team === save.school)) ourResult = 'lost in quarters';
      else ourResult = 'first round';
    }
    return { champion: champ.team, runnerUp: runnerUp.team, log, ourResult, weWon, weRunnerUp, usIn };
  }

  /* ---------- offseason (recruiting + transfer portal — auto in the MVP) ---------- */
  function offseason(save, prestige) {
    const rng = rngOf(save.seed + '', save.year + '|offseason');
    const base = teamPrestige(save, prestige, save.school);
    // recruiting class avg 2-5 stars nudges prestige toward its "program ceiling"; portal adds noise.
    const recruitStars = 2 + Math.floor(rng() * 4);          // 2..5
    const portalSwing = (rng() - 0.45) * 5;                   // net -2.25 .. +2.75
    const recruitPush = (recruitStars - 3) * 1.2;
    let next = base + recruitPush + portalSwing;
    next = clamp(next, 40, 99);
    // bound per-year drift so a dynasty grows gradually
    next = clamp(next, base - 4, base + 4);
    save.prestigeSelf = Math.round(next);
    return { recruitStars, portalSwing: Math.round(portalSwing * 10) / 10, prestige: save.prestigeSelf };
  }

  /* ---------- orchestrate one full season: schedule → 12 games → AP → conf → CFP → offseason ---------- */
  function playFullSeason(save, prestige) {
    if (save.prestigeSelf == null) save.prestigeSelf = teamPrestige(save, prestige, save.school);
    const schedule = buildSchedule(save, prestige);
    let wins = 0, losses = 0, confW = 0, confL = 0;
    const weekly = [];
    schedule.forEach(g => {
      const r = simGame(save, prestige, g);
      g.played = true; g.us = r.us; g.them = r.them; g.won = r.won; g.line = r.line;
      if (r.won) { wins++; if (g.conf) confW++; } else { losses++; if (g.conf) confL++; }
      const poll = apPoll(save, prestige, g.week, wins, losses);
      const ourRank = poll.findIndex(p => p.team === save.school) + 1;
      weekly.push({ week: g.week, opp: g.opp, home: g.home, rival: g.rival, us: r.us, them: r.them, won: r.won, apRank: ourRank });
    });
    // conference standings + championship: top-2 in our conf by conf record (seeded tiebreak) meet wk13
    const conf = CONF_OF[save.school] || 'Independent';
    const confTeams = (CONFERENCES[conf] || [save.school]);
    const confStand = confTeams.map(t => {
      if (t === save.school) return { team: t, cw: confW, prestige: teamPrestige(save, prestige, t) };
      const rng = rngOf(save.seed + '', save.year + '|confrec|' + t);
      const p = teamPrestige(save, prestige, t);
      let cw = 0; for (let i = 0; i < 8; i++) if (rng() < clamp(0.5 + (p - 65) / 55, 0.1, 0.9)) cw++;
      return { team: t, cw, prestige: p };
    }).sort((a, b) => b.cw - a.cw || b.prestige - a.prestige);
    let confChampion = confStand[0].team, wonConf = false;
    if (confStand.length >= 2 && (confStand[0].team === save.school || confStand[1].team === save.school)) {
      const a = confStand[0], b = confStand[1];
      const gr = rngOf(save.seed + '', save.year + '|confchamp');
      const pa = teamPrestige(save, prestige, a.team), pb = teamPrestige(save, prestige, b.team);
      const aWin = gr() < clamp(1 / (1 + Math.pow(10, (pb - pa) / 22)), 0.05, 0.95);
      confChampion = aWin ? a.team : b.team;
      wonConf = confChampion === save.school;
      if (wonConf) { wins++; } else if (a.team === save.school || b.team === save.school) { losses++; }
    }
    // final AP + CFP field: 5 conf champs (one per conference, top of each) + 7 at-large
    const finalPoll = apPoll(save, prestige, 13, wins, losses);
    const confChamps = {};
    for (const c in CONFERENCES) {
      const top = finalPoll.find(p => CONF_OF[p.team] === c);
      if (top) confChamps[c] = (c === conf) ? confChampion : top.team;
    }
    const autoBids = Object.values(confChamps).slice(0, 5);
    const atLarge = finalPoll.map(p => p.team).filter(t => !autoBids.includes(t)).slice(0, 12 - autoBids.length);
    const fieldTeams = autoBids.concat(atLarge).slice(0, 12);
    // seed the field by final AP order
    const apOrder = finalPoll.map(p => p.team);
    const field = fieldTeams.slice().sort((a, b) => apOrder.indexOf(a) - apOrder.indexOf(b))
      .map((t, i) => ({ team: t, seed: i + 1 }));
    const madeCFP = field.some(f => f.team === save.school);
    const cfp = madeCFP ? runCFP(save, prestige, field) : { ourResult: 'missed', usIn: false, weWon: false, champion: field[0] ? field[0].team : confChampion };

    // record history
    const apFinal = finalPoll.findIndex(p => p.team === save.school) + 1;
    const rec = {
      year: save.year, wins, losses, conf, confRecord: confW + '-' + confL,
      wonConf, apFinal, madeCFP, cfpResult: cfp.ourResult, natty: !!cfp.weWon,
      champion: cfp.champion,
    };
    save.history.push(rec);
    save.trophies.confTitles += wonConf ? 1 : 0;
    save.trophies.playoffApps += madeCFP ? 1 : 0;
    save.trophies.natties += cfp.weWon ? 1 : 0;
    save.prog += 1;
    // offseason → next year
    const off = offseason(save, prestige);
    save.year += 1;
    save.season = null;
    return { schedule, weekly, wins, losses, confStand, confChampion, wonConf, finalPoll, field, cfp, record: rec, offseason: off };
  }

  return {
    mulberry32, hashStr, rngOf, computePrestige, newDynasty,
    CONFERENCES, CONF_OF, RIVALRIES, rivalOf, teamPrestige,
    buildSchedule, simGame, apPoll, runCFP, offseason, playFullSeason,
  };
});
