// Batter version of fetch-data.js — pulls MLB The Show hitters and writes batters.json.
//   node fetch-batters.js
// Output: { pool, prime, legends } of Live hitter cards with hitting ratings.

const fs = require('fs');

const CONCURRENCY = 4;
// 2025 is the primary season (full card set, mature ratings, all tiers).
// 2026 is fetched as a supplement: a player's 2026 card replaces their 2025 card
// only if the 2026 OVR is strictly higher (dedup step in main()).
// Older seasons contribute gold-and-above (OVR >= 80) historical cards only.
const SOURCES = [
  { base: 'https://mlb25.theshow.com/apis/items.json', year: 2025, minOvr: 0,  prime: true }, // primary season
  { base: 'https://mlb26.theshow.com/apis/items.json', year: 2026, minOvr: 0 },               // upgrade if higher OVR
  { base: 'https://mlb24.theshow.com/apis/items.json', year: 2024, minOvr: 80 },
  { base: 'https://mlb23.theshow.com/apis/items.json', year: 2023, minOvr: 80 },
  { base: 'https://mlb22.theshow.com/apis/items.json', year: 2022, minOvr: 80 },
  { base: 'https://mlb21.theshow.com/apis/items.json', year: 2021, minOvr: 80 },
];

let ID_MAP = {};
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'’-]/g, '').replace(/\s+/g, ' ').trim();

async function buildIdMap() {
  const map = {};
  for (const yr of [2021, 2022, 2023, 2024, 2025, 2026]) {
    try {
      const r = await fetch(`https://statsapi.mlb.com/api/v1/sports/1/players?season=${yr}`);
      const people = (await r.json()).people || [];
      for (const p of people) if (p.fullName) map[norm(p.fullName)] = p.id;
    } catch (e) { console.warn(`  roster ${yr} failed: ${e.message}`); }
  }
  return map;
}

const PROSPECT_SERIES = new Set(['2025 Draft', '2026 Draft', 'Pipeline', 'Pipeline Past', 'Spring Breakout']);
async function resolveLegendId(name) {
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
    const people = ((await r.json()).people || []).filter(p => p.mlbDebutDate);
    if (!people.length) return null;
    people.sort((a, b) => a.mlbDebutDate.localeCompare(b.mlbDebutDate));
    return people[0].id;
  } catch (e) { return null; }
}
async function resolveActiveId(name) {
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
    let people = (await r.json()).people || [];
    if (!people.length) return null;
    const exact = people.filter(p => norm(p.fullName) === norm(name));
    if (exact.length) people = exact;
    people.sort((a, b) => {
      if (!!b.active - !!a.active) return !!b.active - !!a.active;
      return (b.mlbDebutDate || '').localeCompare(a.mlbDebutDate || '');
    });
    return people[0].id;
  } catch (e) { return null; }
}

const avg = (a, b) => Math.round(((+a || 0) + (+b || 0)) / 2);
function slim(item, year) {
  const hm = String(item.height || '').match(/(\d+)'\s*(\d+)/);
  return {
    name: item.name,
    team: item.team_short_name || item.team,
    ovr: item.ovr,
    pos: item.display_position,
    mlbamId: ID_MAP[norm(item.name)] || null,
    series: item.series,
    year,
    height: item.height || '',
    heightIn: hm ? (+hm[1] * 12 + +hm[2]) : null,
    // hitting ratings (contact/power are L/R averages)
    contact: avg(item.contact_left, item.contact_right),
    power: avg(item.power_left, item.power_right),
    plate_vision: item.plate_vision,
    plate_discipline: item.plate_discipline,
    batting_clutch: item.batting_clutch,
    speed: item.speed,
    fielding_ability: item.fielding_ability,
    arm_strength: item.arm_strength,
    hitting_durability: item.hitting_durability,
  };
}

async function getPage(base, page) {
  const url = `${base}?type=mlb_card&page=${page}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) throw new Error('HTTP 429');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 5) throw err;
      const is429 = String(err.message).includes('429');
      await new Promise(r => setTimeout(r, (is429 ? 2000 : 500) * (attempt + 1) + Math.random() * 500));
    }
  }
}
async function fetchAll(base) {
  const first = await getPage(base, 1);
  const total = first.total_pages;
  const items = [...first.items];
  let next = 2;
  async function worker() { while (next <= total) { const p = next++; const d = await getPage(base, p); for (const it of d.items) items.push(it); } }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return items;
}

// MVP + Silver Slugger + Hank Aaron winners — our "MVP / top year" set that's guaranteed a Prime.
const AWARD_IDS = ['ALMVP', 'NLMVP', 'ALSS', 'NLSS', 'ALHAA', 'NLHAA'];
async function fetchAwardWinners() {
  const names = new Set();
  for (const id of AWARD_IDS) {
    for (let y = 2010; y <= 2025; y++) {
      try {
        const r = await fetch(`https://statsapi.mlb.com/api/v1/awards/${id}/recipients?sportId=1&season=${y}`);
        for (const a of ((await r.json()).awards || [])) {
          if (a.player && a.player.nameFirstLast) names.add(norm(a.player.nameFirstLast));
        }
      } catch (e) { /* skip a year/award that errors */ }
      await new Promise(r => setTimeout(r, 50));
    }
  }
  return names;
}

async function main() {
  console.log('Building MLBAM id map...');
  ID_MAP = await buildIdMap();
  console.log(`  id map entries: ${Object.keys(ID_MAP).length}`);

  const pool = [];
  const prime = {};
  let legends = [];

  for (const src of SOURCES) {
    process.stdout.write(`Fetching ${src.year}... `);
    const items = await fetchAll(src.base);
    const hitters = items.filter(it => it.is_hitter === true);
    const live = hitters.filter(it => it.series === 'Live' && it.ovr >= src.minOvr);
    for (const it of live) pool.push(slim(it, src.year));
    console.log(`${hitters.length} hitters, +${live.length} to pool (OVR>=${src.minOvr})`);

    if (src.prime) {
      const activeNames = new Set(hitters.filter(it => it.series === 'Live').map(it => it.name));
      // Any player who has a prospect/showcase card is a current prospect, NOT a retired legend —
      // exclude them by NAME (their highest card may be a non-prospect special like "Neon"/"Spotlight").
      const prospectNames = new Set(hitters.filter(it => PROSPECT_SERIES.has(it.series)).map(it => it.name));
      const primeRaw = {}, legRaw = {};
      for (const it of hitters) {
        if (it.series === 'Live') continue;
        if (!primeRaw[it.name] || it.ovr > primeRaw[it.name].ovr) primeRaw[it.name] = it;
        if (activeNames.has(it.name) || prospectNames.has(it.name)) continue; // active or prospect → not a legend
        if (!legRaw[it.name] || it.ovr > legRaw[it.name].ovr) legRaw[it.name] = it;
      }
      for (const name in primeRaw) prime[name] = slim(primeRaw[name], src.year);
      legends = Object.values(legRaw).filter(it => it.ovr >= 85).map(it => { const s = slim(it, null); s.legend = true; return s; });
      console.log(`  Legends (85+ retired): ${legends.length} — resolving headshots...`);
      for (const lg of legends) { const id = await resolveLegendId(lg.name); if (id) lg.mlbamId = id; await new Promise(r => setTimeout(r, 120)); }
      console.log(`  Legends with headshot: ${legends.filter(l => l.mlbamId).length}/${legends.length}`);
      console.log(`  Prime cards: ${Object.keys(prime).length}`);
    }
  }

  // Per player name, keep the highest-OVR card; ties keep the first source (2025).
  const byName = new Map();
  for (const p of pool) {
    if (!byName.has(p.name) || p.ovr > byName.get(p.name).ovr) byName.set(p.name, p);
  }
  const dedupedPool = [...byName.values()];

  // Guarantee a Prime for every MVP / Silver Slugger / Hank Aaron winner in the pool.
  // If they have no special-edition card, synthesize one by boosting their best Live card.
  console.log('\nFetching MVP / Silver Slugger / Hank Aaron winners...');
  const awardNames = await fetchAwardWinners();
  console.log(`  award-winner names: ${awardNames.size}`);
  const RATING_KEYS = ['contact', 'power', 'plate_vision', 'plate_discipline', 'batting_clutch', 'speed', 'fielding_ability', 'arm_strength', 'hitting_durability'];
  const bestLive = {};
  for (const p of dedupedPool) { const n = norm(p.name); if (!bestLive[n] || p.ovr > bestLive[n].ovr) bestLive[n] = p; }
  let synth = 0;
  for (const n of awardNames) {
    const live = bestLive[n];
    if (!live || prime[live.name]) continue; // not in pool, or already has a real Prime
    const sp = { ...live };
    for (const k of RATING_KEYS) if (typeof sp[k] === 'number') sp[k] = sp[k] + 6;
    sp.ovr = (live.ovr || 0) + 6;
    sp.synthPrime = true;
    prime[live.name] = sp;
    synth++;
  }
  console.log(`  synthesized ${synth} Primes for award winners without one (total Primes: ${Object.keys(prime).length})`);

  const missing = {};
  for (const p of [...dedupedPool, ...Object.values(prime)]) if (!p.mlbamId && !(p.name in missing)) missing[p.name] = null;
  const missNames = Object.keys(missing);
  console.log(`\nResolving ${missNames.length} missing headshots via search...`);
  let found = 0;
  for (const name of missNames) { const id = await resolveActiveId(name); if (id) { missing[name] = id; found++; } await new Promise(r => setTimeout(r, 110)); }
  for (const p of [...dedupedPool, ...Object.values(prime)]) if (!p.mlbamId && missing[p.name]) p.mlbamId = missing[p.name];
  console.log(`  recovered ${found}/${missNames.length} ids`);

  console.log(`\nSpin pool: ${dedupedPool.length} cards | with headshot id: ${dedupedPool.filter(p => p.mlbamId).length}`);
  fs.writeFileSync('batters.json', JSON.stringify({ pool: dedupedPool, prime, legends }));
  console.log(`Wrote batters.json (${(fs.statSync('batters.json').size / 1024).toFixed(0)} KB)`);
}
main().catch(e => { console.error(e); process.exit(1); });
