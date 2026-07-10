// Bakes strikers.json + keepers.json (the soccer games' data) from EA's official ratings API:
//   https://drop-api.ea.com/rating/ea-sports-fc  (the public feed behind ea.com/games/ea-sports-fc/ratings)
// Unlike 2K (Cloudflare-blocked), this works from a plain script — no in-browser scrape needed.
// Downloads all pages once into footballers-raw.json (trimmed, men's football only), then bakes.
//   Run: node fetch-footballers.js            (uses footballers-raw.json if present)
//        node fetch-footballers.js --fresh    (re-download ratings first)
// When EA exposes the FC26 dataset on this endpoint (currently serves FC25 imagery), nothing to
// flip — same slug. Output mirrors ballers.json: { pool, prime, legends, teams, nations }.

const fs = require('fs');

const API = 'https://drop-api.ea.com/rating/ea-sports-fc';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Origin': 'https://www.ea.com', 'Referer': 'https://www.ea.com/',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/['’.\-]/g, '').replace(/\s+/g, ' ').trim();
// Mostly the BETTER of two related ratings (specialists aren't dragged down by their weak half).
const lean = (a, b) => { a = +a; b = +b; if (isNaN(a) && isNaN(b)) return null; if (isNaN(a)) return Math.round(b); if (isNaN(b)) return Math.round(a); return Math.round(0.85 * Math.max(a, b) + 0.15 * Math.min(a, b)); };

// --- the 99-curve (same as ballers): stretch the top end so elite ratings exceed 99, lifting
// weighted OVRs toward Build a Batter/Baller levels.
const CURVE_T = 72, CURVE_K = 1.55;
const curve = v => (v == null ? null : (v <= CURVE_T ? Math.round(v) : Math.round(CURVE_T + (v - CURVE_T) * CURVE_K)));

// --- card-OVR stretch: EA compresses overalls (best striker on Earth = 91, best keeper = 89, vs
// Jokic 98 / Judge 98) — spins read low and diamonds are rare. Stretch the shown card OVR onto the
// family scale: Mbappé 91 → 98, elite keepers 89 → 97. Keepers get a stronger k for their lower
// ceiling. Slot values (already 99-curved above) and the career sim are untouched; the hand-authored
// icons (88–98) are already on this scale.
const OVR_T = 72, STRIKER_OVR_K = 1.35, KEEPER_OVR_K = 1.45;
const ovrStretch = (v, k) => (v == null ? null : (v <= OVR_T ? Math.round(v) : Math.round(OVR_T + (v - OVR_T) * k)));

const cmToIn = cm => (cm ? Math.round(cm / 2.54) : null);
const inToStr = inches => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : null);

// ---------------------------------------------------------------- download
async function page(offset, limit) {
  for (let tries = 0; tries < 4; tries++) {
    try {
      const r = await fetch(`${API}?locale=en&limit=${limit}&offset=${offset}`, { headers: HEADERS });
      if (r.status === 429) { await sleep(2500); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (tries === 3) throw e; await sleep(1200); }
  }
}

const S = p => Object.fromEntries(Object.entries(p.stats || {}).map(([k, v]) => [k, v && v.value]));
function trim(p) {
  const st = S(p);
  return {
    id: p.id, ovr: p.overallRating,
    name: (p.commonName || `${p.firstName || ''} ${p.lastName || ''}`).trim(),
    cm: p.height, skill: p.skillMoves, wf: p.weakFootAbility,
    league: p.leagueName || null,
    nation: p.nationality ? { id: p.nationality.id, label: p.nationality.label, img: p.nationality.imageUrl } : null,
    team: p.team ? { id: p.team.id, label: p.team.label, img: p.team.imageUrl } : null,
    pos: p.position ? p.position.shortLabel : null,
    posType: p.position && p.position.positionType ? p.position.positionType.id : null,
    alt: (p.alternatePositions || []).map(a => a.shortLabel),
    st,
  };
}

async function download() {
  const first = await page(0, 100);
  const total = first.totalItems;
  console.log('EA ratings: ' + total + ' players');
  let all = first.items.slice();
  for (let off = 100; off < total; off += 100) {
    const d = await page(off, 100);
    all = all.concat(d.items);
    if (off % 2000 === 0) console.log('  ...' + off + '/' + total);
    await sleep(120);
  }
  // Men's football only, drop deep-bench fodder to keep the raw file sane.
  const men = all.filter(p => p.gender && p.gender.id === 0 && (p.overallRating || 0) >= 62).map(trim);
  fs.writeFileSync('footballers-raw.json', JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), players: men }));
  console.log('Wrote footballers-raw.json: ' + men.length + ' men (of ' + all.length + ' fetched)');
  return men;
}

// ---------------------------------------------------------------- bake
// Striker slots <- EA fields (curved). Attackers: ST/CF/wings (+CAM alternates land here too).
function slimStriker(p) {
  return {
    name: p.name, eaId: p.id, ovr: ovrStretch(p.ovr, STRIKER_OVR_K), pos: p.pos,
    club: p.team ? p.team.label : null, tid: p.team ? p.team.id : null,
    nation: p.nation ? p.nation.label : null, nid: p.nation ? p.nation.id : null,
    league: p.league, skillm: p.skill, wf: p.wf,
    height: inToStr(cmToIn(p.cm)), heightIn: cmToIn(p.cm),
    pace:      curve(lean(p.st.sprintSpeed, p.st.acceleration)),
    finishing: curve(lean(p.st.finishing, p.st.positioning)),
    power:     curve(lean(p.st.shotPower, p.st.longShots)),
    dribbling: curve(lean(p.st.dribbling, p.st.ballControl)),
    passing:   curve(lean(p.st.shortPassing, p.st.vision)),
    heading:   curve(lean(p.st.headingAccuracy, p.st.jumping)),
    physical:  curve(lean(p.st.strength, p.st.stamina)),
    clutch:    curve(lean(p.st.composure, p.st.penalties)),
  };
}

// Keeper slots <- EA GK fields (curved).
function slimKeeper(p) {
  return {
    name: p.name, eaId: p.id, ovr: ovrStretch(p.ovr, KEEPER_OVR_K), pos: p.pos,
    club: p.team ? p.team.label : null, tid: p.team ? p.team.id : null,
    nation: p.nation ? p.nation.label : null, nid: p.nation ? p.nation.id : null,
    league: p.league,
    height: inToStr(cmToIn(p.cm)), heightIn: cmToIn(p.cm),
    diving:       curve(p.st.gkDiving),
    reflexes:     curve(p.st.gkReflexes),
    handling:     curve(p.st.gkHandling),
    distribution: curve(lean(p.st.gkKicking, p.st.shortPassing)),
    positioning:  curve(p.st.gkPositioning),
    agility:      curve(lean(p.st.agility, p.st.acceleration)),
    command:      curve(lean(p.st.jumping, p.st.strength)),
    clutch:       curve(lean(p.st.composure, p.st.reactions)),
  };
}

const STRIKER_KEYS = ['pace', 'finishing', 'power', 'dribbling', 'passing', 'heading', 'physical', 'clutch'];
const KEEPER_KEYS = ['diving', 'reflexes', 'handling', 'distribution', 'positioning', 'agility', 'command', 'clutch'];
function makePrime(card, keys) {              // Boost power-up: +6 each slot (uncapped, like batter/baller)
  const pr = { ...card, ovr: Math.round(card.ovr + 5), synthPrime: true };
  for (const k of keys) if (typeof pr[k] === 'number') pr[k] = Math.round(pr[k] + 6);
  return pr;
}

// ---------------------------------------------------------------- icons (purple legends)
// EA's ratings feed is current players only — retired greats are hand-authored here, slot values
// FINAL (already on the curved scale, like REB_OVERRIDE in ballers). ovr = card display rating.
// [name, nation, pos, cm, ovr, pace, finishing, power, dribbling, passing, heading, physical, clutch]
const STRIKER_ICONS = [
  ['Pelé',               'Brazil',        'ST',  173, 98, 110, 114, 105, 111, 103, 100,  92, 111],
  ['Diego Maradona',     'Argentina',     'CF',  165, 97, 103, 105, 100, 114, 108,  72,  88, 108],
  ['Ronaldo',            'Brazil',        'ST',  183, 96, 114, 111, 105, 108,  97,  86,  97, 105],
  ['Johan Cruyff',       'Netherlands',   'CF',  180, 94, 105, 100,  99, 105, 108,  86,  88, 103],
  ['Alfredo Di Stéfano', 'Argentina',     'CF',  178, 94, 100, 105, 100, 103, 103,  95,  94, 103],
  ['Ferenc Puskás',      'Hungary',       'ST',  172, 94,  88, 111, 108,  99, 100,  78,  90, 105],
  ['Gerd Müller',        'Germany',       'ST',  176, 94,  94, 114,  99,  94,  83,  97,  94, 108],
  ['Zinedine Zidane',    'France',        'CAM', 185, 96,  90,  97, 103, 114, 111,  94, 100, 108],
  ['Ronaldinho',         'Brazil',        'LW',  182, 94, 100,  99, 100, 111, 108,  83,  88, 100],
  ['Garrincha',          'Brazil',        'RW',  169, 93, 105,  92,  90, 111,  97,  69,  80,  97],
  ['Eusébio',            'Portugal',      'ST',  175, 93, 108, 108, 108, 100,  92,  88,  92, 100],
  ['Marco van Basten',   'Netherlands',   'ST',  188, 93,  92, 111, 105,  99,  94, 103,  94, 103],
  ['Thierry Henry',      'France',        'ST',  188, 93, 108, 108, 105, 103,  99,  83,  94, 100],
  ['Romário',            'Brazil',        'ST',  167, 93,  99, 111,  94, 103,  92,  71,  83, 105],
  ['George Best',        'Northern Ireland','RW',175, 93, 103,  99,  97, 108,  99,  80,  86,  97],
  ['Bobby Charlton',     'England',       'CAM', 173, 92,  94, 100, 108, 100, 105,  88,  90, 100],
  ['Roberto Baggio',     'Italy',         'CF',  174, 92,  90,  99,  97, 108, 105,  71,  80, 105],
  ['Zico',               'Brazil',        'CAM', 172, 92,  92, 103, 103, 105, 108,  83,  81, 103],
  ['Dennis Bergkamp',    'Netherlands',   'CF',  183, 91,  88,  99, 100, 105, 108,  80,  88, 103],
  ['Andriy Shevchenko',  'Ukraine',       'ST',  183, 91, 103, 105, 105,  97,  92,  94,  92, 100],
  ['Gabriel Batistuta',  'Argentina',     'ST',  185, 91,  97, 105, 111,  92,  88, 100,  99, 100],
  ['Kaká',               'Brazil',        'CAM', 186, 91, 103,  97, 100, 105, 103,  80,  90,  99],
  ['Luís Figo',          'Portugal',      'RW',  180, 91,  94,  92,  97, 105, 105,  83,  88,  97],
  ['Zlatan Ibrahimović', 'Sweden',        'ST',  195, 92,  86, 105, 108, 103,  97, 100, 105, 103],
  ['Raúl',               'Spain',         'ST',  180, 90,  92, 103,  94, 100,  97,  86,  83, 105],
  ['Alessandro Del Piero','Italy',        'CF',  173, 91,  90, 100, 103, 103, 100,  74,  81, 105],
  ['Eric Cantona',       'France',        'ST',  188, 90,  83,  99, 100, 100, 103,  94,  99, 105],
  ['Didier Drogba',      'Ivory Coast',   'ST',  188, 90,  94, 103, 108,  90,  86, 111, 108, 108],
  ['Wayne Rooney',       'England',       'ST',  176, 90,  92, 100, 105,  97, 103,  92,  99,  99],
  ['Arjen Robben',       'Netherlands',   'RW',  180, 90, 103,  99, 103, 108,  97,  66,  74,  99],
  ['Franck Ribéry',      'France',        'LW',  170, 90, 103,  90,  92, 108, 103,  63,  78,  94],
  ['David Villa',        'Spain',         'ST',  175, 89,  97, 103, 100,  97,  94,  74,  78, 103],
  ['Sergio Agüero',      'Argentina',     'ST',  173, 90,  97, 108,  99, 100,  94,  69,  86, 105],
  ['Fernando Torres',    'Spain',         'ST',  186, 88, 100, 100,  99,  94,  88,  92,  88,  92],
  ['Miroslav Klose',     'Germany',       'ST',  184, 88,  88, 103,  92,  86,  83, 105,  90, 111],
  ['Michael Owen',       'England',       'ST',  173, 88, 108, 103,  90,  92,  88,  74,  74,  97],
  ['Gareth Bale',        'Wales',         'RW',  185, 89, 108,  97, 108,  97,  94,  88,  90, 103],
  ['David Beckham',      'England',       'RM',  183, 89,  78,  92, 105,  92, 114,  80,  86, 108],
];
// Hand-authored NON-icon pool cards (regular reel entries, not purple legends). Same column
// layout as KEEPER_ICONS + optional trailing img (repo-relative path); stats are FINAL (already
// on the curved scale). No eaId, so without an img they'd fall back to the silhouette.
const CUSTOM_KEEPERS = [
  ['Vozhina', null, 193, 93, 93, 96, 90, 80, 93, 58, 82, 88, 'vozhina.webp'],
];
function customKeeper([name, nation, cm, ovr, diving, reflexes, handling, distribution, positioning, agility, command, clutch, img]) {
  return { name, eaId: null, ovr, pos: 'GK', club: null, tid: null, nation, nid: null, league: null,
    height: inToStr(cmToIn(cm)), heightIn: cmToIn(cm),
    diving, reflexes, handling, distribution, positioning, agility, command, clutch, img: img || undefined };
}

// [name, nation, cm, ovr, diving, reflexes, handling, distribution, positioning, agility, command, clutch]
const KEEPER_ICONS = [
  ['Lev Yashin',          'Russia',      189, 94, 114, 111, 108,  92, 111, 100, 105, 111],
  ['Gianluigi Buffon',    'Italy',       192, 93, 108, 111, 108,  94, 111,  94, 100, 111],
  ['Peter Schmeichel',    'Denmark',     193, 92, 108, 111, 105,  99, 105,  92, 111, 108],
  ['Oliver Kahn',         'Germany',     188, 92, 108, 111, 108,  90, 108,  94, 108, 111],
  ['Iker Casillas',       'Spain',       185, 92, 111, 114, 100,  92, 105, 105,  92, 108],
  ['Gordon Banks',        'England',     185, 92, 111, 111, 105,  86, 108, 100,  97, 108],
  ['Dino Zoff',           'Italy',       182, 91, 105, 108, 108,  88, 111,  94,  94, 111],
  ['Edwin van der Sar',   'Netherlands', 197, 91, 103, 105, 105, 108, 108,  88, 100, 105],
  ['Petr Čech',           'Czechia',     196, 90, 105, 108, 105,  94, 105,  90, 103, 105],
  ['Sepp Maier',          'Germany',     183, 90, 105, 108, 103,  86, 105, 103,  92, 103],
  ['Claudio Taffarel',    'Brazil',      182, 88, 103, 105,  99,  88, 100, 100,  88, 105],
  ['David Seaman',        'England',     193, 88, 100, 103, 105,  86, 105,  86,  99, 100],
];

function iconStriker([name, nation, pos, cm, ovr, pace, finishing, power, dribbling, passing, heading, physical, clutch]) {
  return { name, eaId: null, ovr, pos, club: 'Icons', tid: null, nation, nid: null, league: 'Icons',
    height: inToStr(cmToIn(cm)), heightIn: cmToIn(cm),
    pace, finishing, power, dribbling, passing, heading, physical, clutch, legend: true };
}
function iconKeeper([name, nation, cm, ovr, diving, reflexes, handling, distribution, positioning, agility, command, clutch]) {
  return { name, eaId: null, ovr, pos: 'GK', club: 'Icons', tid: null, nation, nid: null, league: 'Icons',
    height: inToStr(cmToIn(cm)), heightIn: cmToIn(cm),
    diving, reflexes, handling, distribution, positioning, agility, command, clutch, legend: true };
}

// ---------------------------------------------------------------- main
(async () => {
  let players;
  if (process.argv.includes('--fresh') || !fs.existsSync('footballers-raw.json')) players = await download();
  else players = JSON.parse(fs.readFileSync('footballers-raw.json', 'utf8')).players;

  // Pool floors (RAW EA overalls, pre-stretch): tuned so each reel has a healthy few hundred
  // names with real tier spread. Keeper floor 71 = every SHOWN (stretched) OVR lands ≥ 70
  // (raw 70 would stretch to 69).
  const STRIKER_FLOOR = 74, KEEPER_FLOOR = 71;
  const ATTACK = new Set(['ST', 'CF', 'LW', 'RW', 'CAM']);
  // Keepers only: top-5 leagues + MLS. EXACT EA league labels — the sponsor parts
  // ("Enilive", "McDonald's") change between datasets, so re-check these on a data refresh.
  const GK_LEAGUES = new Set(['Premier League', 'LALIGA EA SPORTS', 'Serie A Enilive', 'Bundesliga', "Ligue 1 McDonald's", 'MLS']);

  const attackers = players.filter(p =>
    (p.posType === 'attack' || ATTACK.has(p.pos)) && (p.ovr || 0) >= STRIKER_FLOOR && p.st.finishing != null);
  const gks = players.filter(p => p.pos === 'GK' && (p.ovr || 0) >= KEEPER_FLOOR && p.st.gkReflexes != null && GK_LEAGUES.has(p.league));

  const dedupe = arr => { const seen = new Set(), out = []; for (const p of arr) { const k = norm(p.name); if (seen.has(k)) continue; seen.add(k); out.push(p); } return out; };
  const sPool = dedupe(attackers).map(slimStriker).sort((a, b) => b.ovr - a.ovr);
  const kPool = dedupe(gks).map(slimKeeper).concat(CUSTOM_KEEPERS.map(customKeeper)).sort((a, b) => b.ovr - a.ovr);

  const sPrime = {}; for (const c of sPool) sPrime[c.name] = makePrime(c, STRIKER_KEYS);
  const kPrime = {}; for (const c of kPool) kPrime[c.name] = makePrime(c, KEEPER_KEYS);

  // Icons: skip any still-active name that's already in the pool (e.g. if EA re-adds someone).
  const sNames = new Set(sPool.map(p => norm(p.name))), kNames = new Set(kPool.map(p => norm(p.name)));
  const sLegends = STRIKER_ICONS.map(iconStriker).filter(l => !sNames.has(norm(l.name))).sort((a, b) => b.ovr - a.ovr);
  const kLegends = KEEPER_ICONS.map(iconKeeper).filter(l => !kNames.has(norm(l.name))).sort((a, b) => b.ovr - a.ovr);

  // Shared lookup maps: club id -> {name, img crest}, nation id -> {name, img flag}.
  const teams = {}, nations = {};
  for (const p of [...attackers, ...gks]) {
    if (p.team && p.team.id && !teams[p.team.id]) teams[p.team.id] = { name: p.team.label, img: p.team.img };
    if (p.nation && p.nation.id && !nations[p.nation.id]) nations[p.nation.id] = { name: p.nation.label, img: p.nation.img };
  }

  fs.writeFileSync('strikers.json', JSON.stringify({ pool: sPool, prime: sPrime, legends: sLegends, teams, nations }));
  fs.writeFileSync('keepers.json', JSON.stringify({ pool: kPool, prime: kPrime, legends: kLegends, teams, nations }));

  // --- report: tier spread + weighted-OVR distribution (tune floors/curve against ballers.json)
  const tierOf = o => o >= 85 ? 'diamond' : o >= 80 ? 'gold' : o >= 75 ? 'silver' : o >= 65 ? 'bronze' : 'grey';
  const spread = pool => { const t = {}; for (const p of pool) t[tierOf(p.ovr)] = (t[tierOf(p.ovr)] || 0) + 1; return JSON.stringify(t); };
  const h2r = inches => inches ? Math.max(1, Math.min(125, Math.round(50 + (inches - 65) * 3.2))) : 60;
  const report = (label, pool, keys) => {
    const W = 1.1; // flat approx — real weights live in the game files
    const wovr = p => { let vs = 0, ws = 0; for (const k of keys) { vs += (p[k] || 0); ws += 1; } vs += h2r(p.heightIn); ws += 1; return vs / ws; };
    const ovrs = pool.map(wovr).sort((a, b) => b - a);
    const pct = q => Math.round(ovrs[Math.floor(ovrs.length * q)] || 0);
    console.log(label + ': ' + pool.length + ' pool, tiers ' + spread(pool) +
      ' | build-OVR top ' + Math.round(ovrs[0] || 0) + ' p10 ' + pct(0.10) + ' med ' + pct(0.50) +
      ' | 95+: ' + ovrs.filter(o => o >= 95).length);
    console.log('  top: ' + pool.slice(0, 6).map(p => p.name + '(' + p.ovr + ')').join(', '));
  };
  report('Strikers', sPool, STRIKER_KEYS);
  report('Keepers', kPool, KEEPER_KEYS);
  console.log('Legends: ' + sLegends.length + ' striker icons, ' + kLegends.length + ' keeper icons; teams ' +
    Object.keys(teams).length + ', nations ' + Object.keys(nations).length);
})();
