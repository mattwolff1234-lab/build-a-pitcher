// GOAT Squad (baseball) data bake — merges the already-baked batters.json (8 field
// positions + DH) and pitchers.json (the P slot) into one squad pool, and adds
// SECONDARY-position eligibility (a "3B/1B" guy can land in either slot) from the
// The Show API, which is the only source that has it (our baked JSONs dropped it).
//   node fetch-squadball.js            full bake (hits mlb25 items for secondaries)
//   node fetch-squadball.js --quick    skip The Show fetch (primary positions only)
// Output: squadball-mlb.json { pool, legends } of { name, team, ovr, pos, mlbamId }
//   pos is "/"-joined, primary FIRST (the engine reads it with primaryPositionOnly:false).
// Also patches mlbamId onto goatsquad-mlb.json gauntlet roster players + managers via
// statsapi people-search (era-aware — the '62 Mets Frank Thomas is NOT the Big Hurt),
// so the spoils wheel and manager cards get real mugs. Skipped if the config is absent.

const fs = require('fs');

const CONCURRENCY = 4;
const ITEMS_BASE = 'https://mlb25.theshow.com/apis/items.json';
const QUICK = process.argv.includes('--quick');

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'’-]/g, '').replace(/\s+/g, ' ').trim();

const FIELD_POS = new Set(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']);

async function getPage(page) {
  const url = `${ITEMS_BASE}?type=mlb_card&page=${page}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      const is429 = /429/.test(e.message);
      await new Promise(r => setTimeout(r, (is429 ? 2000 : 500) * (attempt + 1) + Math.random() * 500));
    }
  }
  throw new Error('page ' + page + ' failed after retries');
}

// name -> Set of secondary positions, unioned across every card of that player
async function buildSecondaryMap() {
  const map = {};
  const first = await getPage(1);
  const total = first.total_pages;
  console.log(`The Show mlb25: ${total} pages`);
  const pages = [first];
  let next = 2;
  async function worker() { while (next <= total) { const p = next++; pages.push(await getPage(p)); if (p % 25 === 0) console.log(`  …page ${p}/${total}`); } }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  let seen = 0;
  for (const d of pages) {
    for (const it of (d.items || [])) {
      const sec = it.display_secondary_positions;
      if (!it.name || !sec) continue;
      const set = map[norm(it.name)] = map[norm(it.name)] || new Set();
      String(sec).split(',').map(s => s.trim()).forEach(p => { if (FIELD_POS.has(p)) { set.add(p); seen++; } });
    }
  }
  console.log(`secondary positions: ${Object.keys(map).length} players, ${seen} entries`);
  return map;
}

function squadEntry(p, isPitcher, secMap) {
  let pos;
  if (isPitcher) pos = 'P';
  else {
    const primary = FIELD_POS.has(p.pos) ? p.pos : 'DH';
    const secs = [...((secMap && secMap[norm(p.name)]) || [])].filter(s => s !== primary);
    pos = [primary, ...secs].join('/');
  }
  return { name: p.name, team: p.team || 'FA', ovr: p.ovr, pos, mlbamId: p.mlbamId || null };
}

// ---- era-aware people-search for gauntlet rosters + managers ----
async function searchPeople(name) {
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
    return ((await r.json()).people || []).filter(p => p.mlbDebutDate);
  } catch (e) { return []; }
}
async function resolveEraId(name, year) {
  const people = await searchPeople(name);
  if (!people.length) return null;
  // debuted on or before the team's season, latest such debut wins
  // ('62 Mets Frank Thomas: 1951 qualifies, the Big Hurt's 1990 does not)
  const era = people.filter(p => +p.mlbDebutDate.slice(0, 4) <= year);
  const list = era.length ? era : people;
  list.sort((a, b) => b.mlbDebutDate.localeCompare(a.mlbDebutDate));
  return list[0].id;
}
async function resolveManagerId(name) {
  const people = await searchPeople(name);
  if (!people.length) return null;   // never played MLB (Weaver, Maddon…) -> clipboard avatar
  const exact = people.filter(p => norm(p.fullName) === norm(name));
  const list = exact.length ? exact : people;
  list.sort((a, b) => a.mlbDebutDate.localeCompare(b.mlbDebutDate));   // these are historic names
  return list[0].id;
}
async function patchConfigIds() {
  const CFG_FILE = 'goatsquad-mlb.json';
  if (!fs.existsSync(CFG_FILE)) { console.log('no ' + CFG_FILE + ' yet — skipping id patch'); return; }
  const cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  let hits = 0, misses = 0;
  const teams = (cfg.gauntlet && cfg.gauntlet.teams) || {};
  for (const key of Object.keys(teams)) {
    const t = teams[key];
    const year = +(String(t.name).match(/\d{4}/) || [0])[0] || 2000;
    for (const pl of (t.players || [])) {
      if (pl.mlbamId != null) continue;
      pl.mlbamId = await resolveEraId(pl.name, year);
      pl.mlbamId != null ? hits++ : (misses++, console.log(`  no id: ${pl.name} (${t.name})`));
      await new Promise(r => setTimeout(r, 120));
    }
  }
  for (const c of (cfg.coaches || [])) {
    if (c.mlbamId !== undefined) continue;   // authored null = deliberate clipboard
    c.mlbamId = await resolveManagerId(c.name);
    c.mlbamId != null ? hits++ : misses++;
    await new Promise(r => setTimeout(r, 120));
  }
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`config ids patched: ${hits} resolved, ${misses} missing (fall back to initials/clipboard)`);
}

(async function main() {
  const batters = JSON.parse(fs.readFileSync('batters.json', 'utf8'));
  const pitchers = JSON.parse(fs.readFileSync('pitchers.json', 'utf8'));
  const secMap = QUICK ? null : await buildSecondaryMap();

  // Home Run Derby X cards are novelty derby versions (pitchers like Wainwright/Arrieta
  // batting 99 in the outfield) — they'd leak arms into hitter slots, so they're out.
  // Free agents (not on any roster) and sub-60 deep prospects are out too — the squad
  // pool is current big-leaguers, not org filler. Legends bypass both (retired greats).
  const real = p => p.series !== 'Home Run Derby X';
  const active = p => p.team && p.team !== 'FA' && p.ovr >= 60;
  const cutFA = batters.pool.filter(p => real(p) && !active(p)).length + pitchers.pool.filter(p => !active(p)).length;
  const pool = batters.pool.filter(p => real(p) && active(p)).map(p => squadEntry(p, false, secMap))
    .concat(pitchers.pool.filter(active).map(p => squadEntry(p, true, null)));
  console.log(`trimmed ${cutFA} FA/sub-60 cards from the pool`);
  const legends = (batters.legends || []).filter(real).map(p => squadEntry(p, false, secMap))
    .concat((pitchers.legends || []).map(p => squadEntry(p, true, null)));

  fs.writeFileSync('squadball-mlb.json', JSON.stringify({ pool, legends }) + '\n');

  // ---- report: pos coverage + OVR histogram (for tuning the config rarity bands) ----
  const posCount = {}, hist = {};
  let multi = 0;
  for (const p of pool) {
    p.pos.split('/').forEach(x => posCount[x] = (posCount[x] || 0) + 1);
    if (p.pos.includes('/')) multi++;
    const b = p.ovr >= 90 ? '90+' : p.ovr >= 85 ? '85-89' : p.ovr >= 80 ? '80-84' : p.ovr >= 75 ? '75-79' : p.ovr >= 65 ? '65-74' : '<65';
    hist[b] = (hist[b] || 0) + 1;
  }
  console.log(`pool ${pool.length} (${multi} multi-position) · legends ${legends.length}`);
  console.log('slot eligibility:', JSON.stringify(posCount));
  console.log('ovr bands:', JSON.stringify(hist));

  await patchConfigIds();
})();
