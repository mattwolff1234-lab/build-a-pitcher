// GOAT Squad (football) data bake — pulls the full Madden ratings pool from EA's open
// drop-api (the ONLY slug that answers is the un-yeared `madden-nfl`; `madden-nfl-26`
// 204s, same as every other EA sport). Every current player ships with an EA portrait
// (avatarUrl), so headshots are 100% — no name-matching needed for the pool.
//   node fetch-squadfoot.js            bake (uses madden-raw.json cache if present)
//   node fetch-squadfoot.js --fresh    re-download the Madden pool first
// Output: squadfoot-nfl.json { pool, legends } of { name, team, ovr, pos, img }
//   img is a FULL URL (EA portrait for the pool, ESPN headshot for legends) — the
//   config adapter uses imageIdField:'img' + imageTemplate:'{id}' so the engine's
//   template substitution passes it straight through.
// Legends are hand-authored below (era-lore ratings, like hockey's 36). Their espnId
// is IDENTITY-VERIFIED against ESPN's athlete API (name must match) before the
// headshot URL is kept — a misremembered id falls back to initials, never a wrong face.
// Also verifies espnId on goatsquad-nfl.json gauntlet rosters (same guard), writing
// img onto each roster player. Skipped if the config is absent.

const fs = require('fs');

const RAW_FILE = 'madden-raw.json';
const CFG_FILE = 'goatsquad-nfl.json';
const OUT_FILE = 'squadfoot-nfl.json';
const API = 'https://drop-api.ea.com/rating/madden-nfl?locale=en';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const FRESH = process.argv.includes('--fresh');
const POOL_FLOOR = 60;

const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'’-]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/\s+/g, ' ').trim();

// Madden position ids -> our slot positions. OL / specialists are out (no stat line in
// the series sim — same posture as RPs in the pitcher game and goalies in hockey).
const POS_MAP = {
  QB: 'QB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  LEDG: 'DL', REDG: 'DL', DT: 'DL',
  MIKE: 'LB', SAM: 'LB', WILL: 'LB',
  CB: 'CB', FS: 'S', SS: 'S'
};

const TEAM_ABBR = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS'
};

// ---- retired greats, rated on era lore (hockey-legends pattern). espnId null = no
// reliable ESPN headshot known — the engine shows initials, same as baseball's 1920s guys.
const LEGENDS = [
  // QB
  { name: 'Tom Brady', pos: 'QB', team: 'NE', rating: 99, espnId: 2330 },
  { name: 'Joe Montana', pos: 'QB', team: 'SF', rating: 97, espnId: null },
  { name: 'Peyton Manning', pos: 'QB', team: 'IND', rating: 98, espnId: 1428 },
  { name: 'Dan Marino', pos: 'QB', team: 'MIA', rating: 96, espnId: null },
  { name: 'John Elway', pos: 'QB', team: 'DEN', rating: 95, espnId: null },
  { name: 'Brett Favre', pos: 'QB', team: 'GB', rating: 96, espnId: 158 },
  { name: 'Steve Young', pos: 'QB', team: 'SF', rating: 94, espnId: null },
  { name: 'Aaron Rodgers', pos: 'QB', team: 'GB', rating: 97, espnId: 8439 },
  { name: 'Drew Brees', pos: 'QB', team: 'NO', rating: 95, espnId: 2580 },
  { name: 'Johnny Unitas', pos: 'QB', team: 'IND', rating: 95, espnId: null },
  { name: 'Otto Graham', pos: 'QB', team: 'CLE', rating: 93, espnId: null },
  // RB
  { name: 'Jim Brown', pos: 'RB', team: 'CLE', rating: 99, espnId: null },
  { name: 'Walter Payton', pos: 'RB', team: 'CHI', rating: 97, espnId: null },
  { name: 'Barry Sanders', pos: 'RB', team: 'DET', rating: 98, espnId: null },
  { name: 'Emmitt Smith', pos: 'RB', team: 'DAL', rating: 95, espnId: null },
  { name: 'Eric Dickerson', pos: 'RB', team: 'LAR', rating: 94, espnId: null },
  { name: 'Earl Campbell', pos: 'RB', team: 'TEN', rating: 94, espnId: null },
  { name: 'LaDainian Tomlinson', pos: 'RB', team: 'LAC', rating: 96, espnId: 5528 },
  { name: 'Adrian Peterson', pos: 'RB', team: 'MIN', rating: 96, espnId: 10452 },
  { name: 'Marshall Faulk', pos: 'RB', team: 'LAR', rating: 95, espnId: null },
  { name: 'Gale Sayers', pos: 'RB', team: 'CHI', rating: 93, espnId: null },
  { name: 'Terrell Davis', pos: 'RB', team: 'DEN', rating: 93, espnId: null },
  { name: 'Bo Jackson', pos: 'RB', team: 'LV', rating: 94, espnId: null },
  // WR
  { name: 'Jerry Rice', pos: 'WR', team: 'SF', rating: 99, espnId: null },
  { name: 'Randy Moss', pos: 'WR', team: 'MIN', rating: 98, espnId: 1561 },
  { name: 'Calvin Johnson', pos: 'WR', team: 'DET', rating: 97, espnId: 10453 },
  { name: 'Terrell Owens', pos: 'WR', team: 'SF', rating: 96, espnId: 962 },
  { name: 'Larry Fitzgerald', pos: 'WR', team: 'ARI', rating: 95, espnId: 5527 },
  { name: 'Marvin Harrison', pos: 'WR', team: 'IND', rating: 94, espnId: null },
  { name: 'Cris Carter', pos: 'WR', team: 'MIN', rating: 93, espnId: null },
  { name: 'Michael Irvin', pos: 'WR', team: 'DAL', rating: 93, espnId: null },
  { name: 'Steve Largent', pos: 'WR', team: 'SEA', rating: 92, espnId: null },
  { name: 'Don Hutson', pos: 'WR', team: 'GB', rating: 94, espnId: null },
  // TE
  { name: 'Rob Gronkowski', pos: 'TE', team: 'NE', rating: 97, espnId: 13229 },
  { name: 'Tony Gonzalez', pos: 'TE', team: 'KC', rating: 95, espnId: 1276 },
  { name: 'Antonio Gates', pos: 'TE', team: 'LAC', rating: 93, espnId: 5389 },
  { name: 'Kellen Winslow', pos: 'TE', team: 'LAC', rating: 92, espnId: null },
  { name: 'Shannon Sharpe', pos: 'TE', team: 'DEN', rating: 92, espnId: null },
  // DL
  { name: 'Reggie White', pos: 'DL', team: 'GB', rating: 99, espnId: null },
  { name: 'Aaron Donald', pos: 'DL', team: 'LAR', rating: 98, espnId: 16716 },
  { name: 'J.J. Watt', pos: 'DL', team: 'HOU', rating: 97, espnId: 13979 },
  { name: 'Bruce Smith', pos: 'DL', team: 'BUF', rating: 96, espnId: null },
  { name: 'Deacon Jones', pos: 'DL', team: 'LAR', rating: 95, espnId: null },
  { name: 'Joe Greene', pos: 'DL', team: 'PIT', rating: 95, espnId: null },
  { name: 'Michael Strahan', pos: 'DL', team: 'NYG', rating: 94, espnId: null },
  { name: 'Warren Sapp', pos: 'DL', team: 'TB', rating: 93, espnId: null },
  // LB
  { name: 'Lawrence Taylor', pos: 'LB', team: 'NYG', rating: 99, espnId: null },
  { name: 'Ray Lewis', pos: 'LB', team: 'BAL', rating: 98, espnId: 969 },
  { name: 'Dick Butkus', pos: 'LB', team: 'CHI', rating: 96, espnId: null },
  { name: 'Jack Lambert', pos: 'LB', team: 'PIT', rating: 94, espnId: null },
  { name: 'Junior Seau', pos: 'LB', team: 'LAC', rating: 94, espnId: null },
  { name: 'Mike Singletary', pos: 'LB', team: 'CHI', rating: 93, espnId: null },
  { name: 'Brian Urlacher', pos: 'LB', team: 'CHI', rating: 93, espnId: 2149 },
  { name: 'Luke Kuechly', pos: 'LB', team: 'CAR', rating: 93, espnId: 14922 },
  { name: 'Derrick Brooks', pos: 'LB', team: 'TB', rating: 92, espnId: null },
  // CB
  { name: 'Deion Sanders', pos: 'CB', team: 'DAL', rating: 99, espnId: null },
  { name: 'Darrelle Revis', pos: 'CB', team: 'NYJ', rating: 96, espnId: 10456 },
  { name: 'Rod Woodson', pos: 'CB', team: 'PIT', rating: 95, espnId: null },
  { name: 'Charles Woodson', pos: 'CB', team: 'LV', rating: 95, espnId: 183 },
  { name: 'Champ Bailey', pos: 'CB', team: 'DEN', rating: 94, espnId: 3593 },
  { name: 'Mel Blount', pos: 'CB', team: 'PIT', rating: 93, espnId: null },
  // S
  { name: 'Ronnie Lott', pos: 'S', team: 'SF', rating: 97, espnId: null },
  { name: 'Ed Reed', pos: 'S', team: 'BAL', rating: 97, espnId: 3609 },
  { name: 'Troy Polamalu', pos: 'S', team: 'PIT', rating: 96, espnId: 4713 },
  { name: 'Sean Taylor', pos: 'S', team: 'WAS', rating: 93, espnId: null },
  { name: 'Earl Thomas', pos: 'S', team: 'SEA', rating: 92, espnId: 13252 },
  { name: 'Steve Atwater', pos: 'S', team: 'DEN', rating: 91, espnId: null }
];

async function get(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      await new Promise(r => setTimeout(r, 600 * (attempt + 1) + Math.random() * 400));
    }
  }
  throw new Error(url + ' failed after retries');
}

async function downloadPool() {
  const first = await get(API + '&limit=100&offset=0');
  const total = first.totalItems;
  console.log(`Madden drop-api: ${total} players`);
  let items = first.items.slice();
  const offsets = [];
  for (let o = 100; o < total; o += 100) offsets.push(o);
  let next = 0;
  async function worker() {
    while (next < offsets.length) {
      const o = offsets[next++];
      const d = await get(API + `&limit=100&offset=${o}`);
      items = items.concat(d.items);
      if (o % 500 === 0) console.log(`  …${o}/${total}`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  fs.writeFileSync(RAW_FILE, JSON.stringify(items) + '\n');
  return items;
}

// ---- retired-player headshots: Wikidata knows each player's ESPN.com NFL id (P3686).
// Resolve name -> entity (description must say American football) -> P3686, then the
// ESPN identity check below still gates it: the athlete record for that id must carry
// the SAME name AND the headshot file must exist. A wrong id can never show a wrong face.
const WD = 'https://www.wikidata.org/w/api.php';
const WD_UA = { 'User-Agent': 'goatlab-bake/1.0 (mattwolff1234@gmail.com)' };
const ID_CACHE_FILE = 'espn-id-cache.json';
const idCache = fs.existsSync(ID_CACHE_FILE) ? JSON.parse(fs.readFileSync(ID_CACHE_FILE, 'utf8')) : {};
const saveIdCache = () => fs.writeFileSync(ID_CACHE_FILE, JSON.stringify(idCache, null, 1) + '\n');
// Wikidata rate-limits bursts — pace every call and back off hard when told to slow down
async function wdGet(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise(r => setTimeout(r, 350));
    const res = await fetch(url, { headers: WD_UA });
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      if (!j.error) return j;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw new Error('wikidata gave up: ' + url.slice(0, 90));
}
// name -> { espn: id|null, wiki: portraitUrl|null } — one Wikidata entity lookup gives
// both the ESPN.com NFL id (P3686) and the Commons portrait (P18, the same
// identity-verified fallback fetch-wiki-headshots.js uses for the pitcher game).
async function wikidataFacts(name) {
  if (name in idCache) return idCache[name];
  const out = { espn: null, wiki: null };
  try {
    const s = await wdGet(`${WD}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=7&format=json`);
    const hits = (s.search || []).filter(x => /american football/i.test(x.description || ''));
    for (const h of hits.slice(0, 2)) {
      const c = await wdGet(`${WD}?action=wbgetclaims&entity=${h.id}&format=json`);
      const val = p => { const cl = c.claims && c.claims[p] && c.claims[p][0]; return (cl && cl.mainsnak.datavalue && cl.mainsnak.datavalue.value) || null; };
      const espn = val('P3686'), img = val('P18');
      if (espn && /^\d+$/.test(espn)) out.espn = +espn;
      if (img && !out.wiki) {
        // resolve the Commons redirect NOW so the baked URL is the real upload.wikimedia.org
        // file (proxyable for the share-card canvas; no client-side redirect hops)
        try {
          const r = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=240`,
            { method: 'HEAD', redirect: 'follow', headers: WD_UA });
          if (r.ok && /upload\.wikimedia\.org/.test(r.url)) out.wiki = r.url;
        } catch (e) {}
      }
      if (out.espn || out.wiki) break;
    }
  } catch (e) { console.log(`  wikidata: ${name} unresolved (${e.message.slice(0, 40)})`); }
  idCache[name] = out;
  saveIdCache();
  return out;
}
const espnImg = id => `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`;
async function espnCheck(name, id) {
  if (id == null) return null;
  try {
    const j = await get(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}`);
    const got = j && j.athlete && (j.athlete.displayName || j.athlete.fullName);
    if (got && norm(got) === norm(name)) {
      const head = await fetch(espnImg(id), { method: 'HEAD', headers: UA });
      if (head.ok) return espnImg(id);
      console.log(`  ${name}: espn ${id} verified but no headshot file`);
    } else console.log(`  espn id ${id} is "${got}", wanted "${name}" — dropped`);
  } catch (e) { console.log(`  espn id ${id} (${name}): lookup failed`); }
  return null;
}
async function verifyEspn(name, hintId) {
  let img = await espnCheck(name, hintId);
  if (!img) {
    const facts = await wikidataFacts(name);
    if (facts.espn != null && facts.espn !== hintId) img = await espnCheck(name, facts.espn);
    if (!img) img = facts.wiki;   // pre-digital-era greats: Wikipedia portrait
  }
  return img;
}

async function patchConfigImgs() {
  if (!fs.existsSync(CFG_FILE)) { console.log('no ' + CFG_FILE + ' yet — skipping roster img patch'); return; }
  const cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  let hits = 0, misses = 0;
  const teams = (cfg.gauntlet && cfg.gauntlet.teams) || {};
  for (const key of Object.keys(teams)) {
    for (const pl of (teams[key].players || [])) {
      if (pl.img !== undefined) continue;   // already patched (or authored null)
      pl.img = await verifyEspn(pl.name, pl.espnId);
      delete pl.espnId;
      pl.img ? hits++ : misses++;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  // coaches too (baseball patched its managers the same way) — novelty coaches are
  // authored with img:null and skipped; real ones get the Wikipedia portrait
  for (const c of (cfg.coaches || [])) {
    if (c.img !== undefined) continue;
    c.img = await verifyEspn(c.name, undefined);
    c.img ? hits++ : misses++;
    await new Promise(r => setTimeout(r, 100));
  }
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`config roster imgs: ${hits} verified, ${misses} initials-fallback`);
}

(async function main() {
  const items = (!FRESH && fs.existsSync(RAW_FILE))
    ? JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'))
    : await downloadPool();

  const pool = [];
  const cutPos = {}, cutFloor = [];
  for (const it of items) {
    const pos = POS_MAP[it.position && it.position.id];
    if (!pos) { const k = it.position && it.position.id; cutPos[k] = (cutPos[k] || 0) + 1; continue; }
    if (it.overallRating < POOL_FLOOR) { cutFloor.push(it); continue; }
    pool.push({
      name: `${it.firstName} ${it.lastName}`,
      team: TEAM_ABBR[it.team && it.team.label] || 'FA',
      ovr: it.overallRating,
      pos,
      img: it.avatarUrl || null
    });
  }

  const legends = [];
  for (const L of LEGENDS) {
    legends.push({ name: L.name, team: L.team, ovr: L.rating, pos: L.pos, img: await verifyEspn(L.name, L.espnId) });
    await new Promise(r => setTimeout(r, 100));
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify({ pool, legends }) + '\n');

  // ---- report: slot coverage + OVR histogram (drives the config rarity bands) ----
  const posCount = {}, hist = {};
  let noImg = 0;
  for (const p of pool) {
    posCount[p.pos] = (posCount[p.pos] || 0) + 1;
    if (!p.img) noImg++;
    const b = p.ovr >= 90 ? '90+' : p.ovr >= 85 ? '85-89' : p.ovr >= 80 ? '80-84' : p.ovr >= 75 ? '75-79' : p.ovr >= 65 ? '65-74' : '<65';
    hist[b] = (hist[b] || 0) + 1;
  }
  console.log(`pool ${pool.length} · legends ${legends.length} (${legends.filter(l => l.img).length} with faces)`);
  console.log(`cut: OL/specialists ${JSON.stringify(cutPos)} · below floor ${cutFloor.length}`);
  console.log('slot eligibility:', JSON.stringify(posCount));
  console.log('ovr bands:', JSON.stringify(hist));
  console.log('pool without portrait:', noImg);

  await patchConfigImgs();
})();
