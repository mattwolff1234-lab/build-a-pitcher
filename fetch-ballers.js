// Bakes ballers.json (the basketball game's data) from two inputs:
//   1) ballers-raw.json  — current NBA 2K27 ratings + retired legends + classic/all-time era cards,
//      hand-grabbed in-browser from 2kratings.com (Cloudflare blocks scripted access; see
//      scrape-2k.js). Shape: {players, legends, classics}. A classics-only re-grab lands in
//      ballers-classics-raw.json instead (scrape-2k.js CLASSICS_ONLY) — read from there as fallback.
//   2) stats.nba.com playerindex — official PERSON_ID per player, for cdn.nba.com headshots.
// Output mirrors pitchers.json/batters.json: { pool, prime, legends } + eraPrimes (rare PRIME pull).
//   Run: node fetch-ballers.js   (re-grab ballers-raw.json first if you want fresher ratings)

const fs = require('fs');

const RAWFILE = JSON.parse(fs.readFileSync('ballers-raw.json', 'utf8'));
// Backward-compatible: accept either the new {players,legends} object or an old flat array.
const RAW_PLAYERS = Array.isArray(RAWFILE) ? RAWFILE : (RAWFILE.players || []);
const RAW_LEGENDS = Array.isArray(RAWFILE) ? [] : (RAWFILE.legends || []);
let RAW_CLASSICS = Array.isArray(RAWFILE) ? [] : (RAWFILE.classics || []);
if (!RAW_CLASSICS.length) {
  try { RAW_CLASSICS = JSON.parse(fs.readFileSync('ballers-classics-raw.json', 'utf8')).classics || []; } catch (e) {}
}

const decodeEnt = s => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const norm = s => decodeEnt(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/['’.\-]/g, '').replace(/\s+/g, ' ').trim();
const stripSuffix = k => k.replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').trim();
const heightIn = h => { const m = String(h || '').match(/(\d+)'\s*(\d+)/); return m ? (+m[1] * 12 + +m[2]) : null; };
const avg = (...xs) => { const v = xs.map(x => +x).filter(x => !isNaN(x)); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
// Mostly the BETTER of two related ratings (so a specialist isn't dragged down by their weak half):
// e.g. Defense = elite perimeter OR elite interior; Finishing = elite layup OR elite dunk.
const lean = (a, b) => { a = +a; b = +b; if (isNaN(a) && isNaN(b)) return null; if (isNaN(a)) return Math.round(b); if (isNaN(b)) return Math.round(a); return Math.round(0.85 * Math.max(a, b) + 0.15 * Math.min(a, b)); };

// --- the 99-curve: stretch the top end so elite ratings exceed 99 (like the batter game's uncapped
// Judge), which lifts weighted OVRs toward Build a Batter levels. Tuned vs batters.json below.
const CURVE_T = 72, CURVE_K = 1.55;
const curve = v => (v == null ? null : (v <= CURVE_T ? Math.round(v) : Math.round(CURVE_T + (v - CURVE_T) * CURVE_K)));

// Iconic glass-cleaners whose 2K legend card undersells their real-life rebounding (e.g. Shaq's card
// is only 86/87). Hand-set the FINAL rebounding value (bypasses the curve). Keyed by normalized name.
const REB_OVERRIDE = {};
[["Shaquille O'Neal", 125], ["Wilt Chamberlain", 125], ["David Robinson", 99]].forEach(([n, v]) => { REB_OVERRIDE[norm(n)] = v; });

const TEAM_ABBR = {
  'atlanta hawks': 'ATL', 'boston celtics': 'BOS', 'brooklyn nets': 'BKN', 'charlotte hornets': 'CHA',
  'chicago bulls': 'CHI', 'cleveland cavaliers': 'CLE', 'dallas mavericks': 'DAL', 'denver nuggets': 'DEN',
  'detroit pistons': 'DET', 'golden state warriors': 'GSW', 'houston rockets': 'HOU', 'indiana pacers': 'IND',
  'los angeles clippers': 'LAC', 'la clippers': 'LAC', 'los angeles lakers': 'LAL', 'memphis grizzlies': 'MEM',
  'miami heat': 'MIA', 'milwaukee bucks': 'MIL', 'minnesota timberwolves': 'MIN', 'new orleans pelicans': 'NOP',
  'new york knicks': 'NYK', 'oklahoma city thunder': 'OKC', 'orlando magic': 'ORL', 'philadelphia 76ers': 'PHI',
  'phoenix suns': 'PHX', 'portland trail blazers': 'POR', 'sacramento kings': 'SAC', 'san antonio spurs': 'SAS',
  'toronto raptors': 'TOR', 'utah jazz': 'UTA', 'washington wizards': 'WAS',
  // defunct/relocated franchises on classic-team pages -> the modern franchise (keys pre-normalized:
  // lowercase, no punctuation, since teamAbbr looks them up through norm())
  'seattle supersonics': 'OKC', 'washington bullets': 'WAS', 'baltimore bullets': 'WAS', 'capital bullets': 'WAS',
  'new jersey nets': 'BKN', 'vancouver grizzlies': 'MEM', 'new orleans hornets': 'NOP', 'charlotte bobcats': 'CHA',
  'kansas city kings': 'SAC', 'cincinnati royals': 'SAC', 'rochester royals': 'SAC', 'st louis hawks': 'ATL',
  'philadelphia warriors': 'GSW', 'san francisco warriors': 'GSW', 'san diego rockets': 'HOU',
  'buffalo braves': 'LAC', 'san diego clippers': 'LAC', 'minneapolis lakers': 'LAL', 'syracuse nationals': 'PHI',
  'fort wayne pistons': 'DET', 'new orleans jazz': 'UTA',
};
// Legend "team" strings look like "All-Time Chicago Bulls" / "1990-91 Chicago Bulls" -> map to the franchise.
const teamAbbr = t => TEAM_ABBR[norm(String(t || '').replace(/^(all-time|all-decade|classic|\d{4}-\d{2,4})\s+/i, ''))] || 'FA';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': 'https://www.nba.com/',
};
async function nbaIds() {
  const r = await fetch('https://stats.nba.com/stats/playerindex?LeagueID=00&Season=2025-26&Historical=1', { headers: HEADERS });
  if (!r.ok) throw new Error('playerindex HTTP ' + r.status);
  const rs = (await r.json()).resultSets[0], h = rs.headers, I = n => h.indexOf(n);
  const iId = I('PERSON_ID'), iL = I('PLAYER_LAST_NAME'), iF = I('PLAYER_FIRST_NAME'), iTo = I('TO_YEAR');
  const ids = {}, put = (k, id, to) => { if (k && (!ids[k] || to > ids[k].to)) ids[k] = { id, to }; };
  for (const row of rs.rowSet) {
    const key = norm((row[iF] || '') + ' ' + (row[iL] || '')), to = +row[iTo] || 0;
    put(key, row[iId], to); put(stripSuffix(key), row[iId], to);
  }
  return ids;
}
const lookupId = (ids, name) => { const k = norm(name); return (ids[k] || ids[stripSuffix(k)] || {}).id || null; };

// The 9 game slots <- raw 2K fields (curved). 3-Pointer/Dribble are single stats; the rest blend.
function slim(p, ids, isLegend) {
  const name = decodeEnt(p.name);
  return {
    name, team: teamAbbr(p.team), ovr: p.overall, pos: p.position || null,
    nbaId: lookupId(ids, name), height: p.height, heightIn: heightIn(p.height),
    threept:    curve(p.threePointShot),
    finishing:  curve(lean(p.layup, p.drivingDunk)),
    dribble:    curve(p.ballHandle),
    playmaking: curve(avg(p.passAccuracy, p.passVision, p.passIQ)),
    defense:    curve(lean(p.perimeterDefense, p.interiorDefense)),
    rebounding: REB_OVERRIDE[norm(name)] ?? curve(lean(p.defensiveRebound, p.offensiveRebound)),
    speed:      curve(avg(p.speed, p.agility)),
    clutch:     curve(avg(p.intangibles, p.offensiveConsistency)),
    ...(isLegend ? { legend: true } : {}),
  };
}

const SLOT_KEYS = ['threept', 'finishing', 'dribble', 'playmaking', 'defense', 'rebounding', 'speed', 'clutch'];
function makePrime(card) {                       // Boost power-up: +6 each slot (uncapped, like batter Primes)
  const pr = { ...card, ovr: Math.round(card.ovr + 5), synthPrime: true };
  for (const k of SLOT_KEYS) if (typeof pr[k] === 'number') pr[k] = Math.round(pr[k] + 6);
  return pr;
}

(async () => {
  let ids = {};
  try { ids = await nbaIds(); console.log('NBA index: ' + Object.keys(ids).length + ' name keys'); }
  catch (e) { console.warn('WARNING: NBA index failed (' + e.message + ') -> headshots blank. Re-run later.'); }

  const isHistorical = p => /all-time|all-decade|classic|\d{4}-\d{2}/i.test((p.team || '') + ' ' + (p.slug || ''));
  const seen = new Set(), pool = [];
  for (const p of RAW_PLAYERS) { if (isHistorical(p)) continue; const k = norm(p.name); if (seen.has(k)) continue; seen.add(k); pool.push(slim(p, ids, false)); }
  pool.sort((a, b) => b.ovr - a.ovr);

  const prime = {};
  for (const c of pool) prime[c.name] = makePrime(c);

  // Legends: curated retired greats, OVR-gated, not already in the pool. The bare-slug scrape both
  // MISSES some GOATs (Kobe/Magic/Bird/Duncan pages don't parse) and UNDERSELLS others (Jordan's
  // bare page shows a 90, not his all-time 99) — so each curated legend also considers their best
  // classic/all-time team card from the classics crawl and keeps whichever rates higher.
  const CURATED_LEGENDS = ['Michael Jordan', 'Kobe Bryant', 'Magic Johnson', 'Larry Bird', "Shaquille O'Neal",
    'Tim Duncan', 'Hakeem Olajuwon', 'Wilt Chamberlain', 'Bill Russell', 'Kareem Abdul-Jabbar', 'Julius Erving',
    'Oscar Robertson', 'Jerry West', 'Kevin Garnett', 'Dirk Nowitzki', 'Allen Iverson', 'Charles Barkley',
    'Scottie Pippen', 'Patrick Ewing', 'David Robinson', 'John Stockton', 'Karl Malone', 'Isiah Thomas',
    'Dwyane Wade', 'Paul Pierce', 'Ray Allen', 'Vince Carter', 'Tracy McGrady', 'Steve Nash', 'Gary Payton',
    'Reggie Miller', 'Clyde Drexler', 'Dominique Wilkins', 'Pete Maravich', 'Moses Malone', 'George Gervin',
    'James Worthy', 'Dennis Rodman', 'Manu Ginobili', 'Tony Parker', 'Yao Ming', 'Ben Wallace', 'Grant Hill',
    'Alonzo Mourning', 'Kevin McHale', 'Robert Parish', 'Elgin Baylor', 'Bob Cousy', 'Willis Reed', 'Carmelo Anthony'];
  const cleanName = s => decodeEnt(String(s || '')).replace(/\s*\([^)]*\)\s*$/, '').replace(/^\s*(?:'\d{2}|\d{4}(?:-\d{2,4})?)\s+/, '').trim();
  const curatedSet = new Set(CURATED_LEGENDS.map(norm));
  const poolNames = new Set(pool.map(p => norm(p.name)));
  const legendCands = {};   // norm name -> best raw record (bare-slug scrape vs classics crawl)
  const consider = p => { const k = norm(p.name); if (!legendCands[k] || (p.overall || 0) > (legendCands[k].overall || 0)) legendCands[k] = p; };
  RAW_LEGENDS.forEach(consider);
  for (const p of RAW_CLASSICS) { const name = cleanName(p.name); if (curatedSet.has(norm(name))) consider({ ...p, name }); }
  const legends = [];
  for (const k of Object.keys(legendCands)) {
    const p = legendCands[k];
    if (poolNames.has(k) || (p.overall || 0) < 88) continue;
    legends.push(slim(p, ids, true));
  }
  legends.sort((a, b) => b.ovr - a.ovr);

  // Era "Prime" cards: strong (OVR>=85) classic/all-time versions of non-legend players — the reel's
  // rare PRIME pull ('13 Heat LeBron, '16 Steph...). One card per player; a year-tagged classic card
  // beats an all-time card (era flavor is the point), then highest OVR wins.
  const eraOf = t => { const m = String(t || '').match(/(\d{4})-(\d{2,4})/); return m ? { label: "'" + m[2].slice(-2), start: +m[1] } : null; };
  const legNames = new Set(legends.map(l => norm(l.name)));
  const byPlayer = {};
  let unmapped = 0;
  for (const p of RAW_CLASSICS) {
    if ((p.overall || 0) < 85) continue;
    const name = cleanName(p.name);
    const k = norm(name);
    if (!k || legNames.has(k) || curatedSet.has(k)) continue;   // retired greats stay purple, not PRIME
    const teamStr = p.eraTeam || p.team || '';
    const abbr = teamAbbr(teamStr);
    if (abbr === 'FA') { unmapped++; continue; }
    const era = p.allTime ? null : eraOf(teamStr);
    (byPlayer[k] = byPlayer[k] || []).push({ raw: p, name, abbr, year: era && era.label, start: era ? era.start : 0 });
  }
  // A year-tagged card only counts as the player's "prime" if it's near their best all-time rating
  // (Harden's lone year card is bench '12 OKC at 87 vs All-Time Rockets 95 - that one must lose).
  // Ties go to the EARLIER season ('13 Heat LeBron over '16 Cavs, '16 Steph over '17).
  const pickEra = arr => {
    const best = (list, better) => list.reduce((m, c) => (!m || better(c, m) ? c : m), null);
    const bestAt = best(arr.filter(c => !c.year), (a, b) => a.raw.overall > b.raw.overall);
    const yr = arr.filter(c => c.year && (!bestAt || c.raw.overall >= bestAt.raw.overall - 2));
    return best(yr, (a, b) => a.raw.overall > b.raw.overall || (a.raw.overall === b.raw.overall && a.start < b.start)) || bestAt;
  };
  const eraPrimes = Object.values(byPlayer).map(pickEra).map(c => {
    const card = slim({ ...c.raw, name: c.name }, ids, false);
    card.team = c.abbr; card.prime = true;
    if (c.year) card.year = c.year;
    return card;
  }).sort((a, b) => b.ovr - a.ovr);
  // Boost tie-in: when the real era card is at least as strong as the +6 synth, it becomes the
  // player's Boost target (the game's per-stat max merge already guarantees no stat downgrades).
  for (const ec of eraPrimes) { const sp = prime[ec.name]; if (sp && ec.ovr >= sp.ovr) prime[ec.name] = ec; }

  fs.writeFileSync('ballers.json', JSON.stringify({ pool, prime, legends, eraPrimes }));

  // --- report: headshot coverage + a weighted-OVR distribution to tune the curve against batters.json
  const withId = pool.filter(p => p.nbaId).length;
  const WEIGHTS = { threept: 1.2, finishing: 1.2, dribble: 1.1, playmaking: 1.2, defense: 1.1, rebounding: 1.1, speed: 1.0, clutch: 1.1, frame: 1.0 };
  const h2r = inches => inches ? Math.max(1, Math.min(99, Math.round(50 + (inches - 72) * 2.6))) : 60;
  const wovr = p => { let vs = 0, ws = 0; for (const k of SLOT_KEYS) { const w = WEIGHTS[k]; vs += (p[k] || 0) * w; ws += w; } const fw = WEIGHTS.frame; vs += h2r(p.heightIn) * fw; ws += fw; return vs / ws; };
  const ovrs = pool.map(wovr).sort((a, b) => b - a);
  const pct = q => Math.round(ovrs[Math.floor(ovrs.length * q)]);
  console.log('Wrote ballers.json: ' + pool.length + ' pool, ' + Object.keys(prime).length + ' primes, ' + legends.length + ' legends, ' + eraPrimes.length + ' eraPrimes' + (unmapped ? ' (' + unmapped + ' skipped: unmapped franchise)' : ''));
  console.log('Headshots: ' + withId + '/' + pool.length + ' pool, ' + eraPrimes.filter(p => p.nbaId).length + '/' + eraPrimes.length + ' eraPrimes');
  if (eraPrimes.length) console.log('EraPrimes: ' + eraPrimes.slice(0, 10).map(p => (p.year ? p.year + ' ' : 'AT ') + p.name + '(' + p.ovr + ' ' + p.team + ')').join(', ') + (eraPrimes.length > 10 ? '...' : ''));
  console.log('Build-weighted OVR (curve T=' + CURVE_T + ' k=' + CURVE_K + '): top ' + Math.round(ovrs[0]) + ' | p90 ' + pct(0.10) + ' | median ' + pct(0.50) + ' | 95+: ' + ovrs.filter(o => o >= 95).length + ' | 99+: ' + ovrs.filter(o => o >= 99).length);
  if (legends.length) console.log('Legends: ' + legends.slice(0, 8).map(l => l.name + '(' + l.ovr + ')').join(', ') + (legends.length > 8 ? '...' : ''));
})();
