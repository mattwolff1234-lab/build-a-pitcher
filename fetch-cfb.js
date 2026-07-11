// Bakes cfb.json (College Football Lab data: QB / RB / WR) from CFB Labs' public GraphQL API
// (the Netlify function behind cfblabs.com/cfb-roster — full EA Sports College Football 27
// default-roster ratings, 11k+ players). EA's own drop-api for CFB27 is still empty
// (filters endpoint has teams but items:[] — checked July 2026); if EA ever seeds it, this
// script's bake step stays the same, only download() changes.
//   Run: node fetch-cfb.js            (uses cfb-raw.json if present)
//        node fetch-cfb.js --fresh    (re-download ratings first)
// Output: { positions: { qb:{pool,prime}, rb:{...}, wr:{...} }, legends:{qb,rb,wr}, teams }

const fs = require('fs');

const API = 'https://www.cfblabs.com/.netlify/functions/cfb27-players';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Referer': 'https://www.cfblabs.com/cfb-roster',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Mostly the BETTER of two related ratings (same lean as fetch-footballers).
const lean = (a, b) => { a = +a; b = +b; if (isNaN(a) && isNaN(b)) return null; if (isNaN(a)) return Math.round(b); if (isNaN(b)) return Math.round(a); return Math.round(0.85 * Math.max(a, b) + 0.15 * Math.min(a, b)); };
const inToStr = inches => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : null);

// Source data is ALL CAPS ("JEREMIAH SMITH", "OHIO STATE") — humanize it.
const KEEP_CAPS = new Set(['II', 'III', 'IV', 'V', 'JR', 'SR', 'DJ', 'TJ', 'CJ', 'AJ', 'JJ', 'BJ', 'RJ', 'KJ', 'EJ', 'PJ', 'OJ', 'LJ', 'MJ', 'JT', 'JD', 'JC']);
const ACRONYM_TEAMS = new Set(['LSU', 'USC', 'UCF', 'UCLA', 'BYU', 'SMU', 'TCU', 'UAB', 'UTEP', 'UTSA', 'UNLV', 'USF', 'FIU', 'VMI', 'NC']);
function titleWord(w) {
  if (KEEP_CAPS.has(w)) return w;
  let out = w.charAt(0) + w.slice(1).toLowerCase();
  if (/^MC./.test(w)) out = 'Mc' + w.charAt(2) + w.slice(3).toLowerCase();
  // apostrophe/hyphen sub-parts: JA'MARR -> Ja'Marr, SMITH-NJIGBA stays split by caller
  out = out.replace(/(['’])(\w)/g, (m, q, c) => q + c.toUpperCase());
  return out;
}
const titleCase = s => String(s || '').trim().split(/\s+/).map(w => w.split('-').map(titleWord).join('-')).join(' ');
function teamCase(s) {
  return String(s || '').trim().split(/\s+/).map(w => ACRONYM_TEAMS.has(w) ? w : (/^[A-Z]&[A-Z]$/.test(w) ? w : titleWord(w))).join(' ');
}
const classCase = s => titleCase(String(s || '').replace(/_/g, ' '));

// ---------------------------------------------------------------- download
const FIELDS = `first_name last_name position height weight class team OVR SPD STR AGI ACC AWR JMP STA TGH
BTK TRK COD BCV SFA SPM JKM CAR CTH SRR MRR DRR CIT SPC RLS THP SAC MAC DAC RUN TUP BSK PAC`;
const QUERY = `query GetTeamPlayers($positions: [String], $page: Int, $limit: Int, $sortColumn: String, $sortDirection: String) {
  teamPlayers(positions: $positions, page: $page, limit: $limit, sortColumn: $sortColumn, sortDirection: $sortDirection) {
    players { ${FIELDS} } totalCount totalPages currentPage } }`;

async function gql(variables) {
  const u = API + '?query=' + encodeURIComponent(QUERY) + '&variables=' + encodeURIComponent(JSON.stringify(variables));
  for (let tries = 0; tries < 4; tries++) {
    try {
      const r = await fetch(u, { headers: HEADERS });
      if (r.status === 429) { await sleep(3000); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.data || !j.data.teamPlayers) throw new Error('bad payload: ' + JSON.stringify(j).slice(0, 200));
      return j.data.teamPlayers;
    } catch (e) { if (tries === 3) throw e; await sleep(1500); }
  }
}

const GROUPS = {
  qb: ['QB (Right)', 'QB (Left)'],
  rb: ['HB'],                          // fullbacks are blockers — HB only
  wr: ['WR'],
};

async function download() {
  const raw = {};
  for (const [key, positions] of Object.entries(GROUPS)) {
    let page = 1, all = [];
    for (;;) {
      const d = await gql({ positions, page, limit: 200, sortColumn: 'OVR', sortDirection: 'desc' });
      all = all.concat(d.players);
      console.log(`  ${key}: page ${d.currentPage}/${d.totalPages} (${all.length}/${d.totalCount})`);
      if (d.currentPage >= d.totalPages || d.players.length === 0) break;
      page++; await sleep(200);
    }
    raw[key] = all;
  }
  fs.writeFileSync('cfb-raw.json', JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), raw }));
  console.log('Wrote cfb-raw.json: ' + Object.entries(raw).map(([k, v]) => k + '=' + v.length).join(', '));
  return raw;
}

// ---------------------------------------------------------------- bake
// Pool policy (v2, per Matt): Power-4 schools (+Notre Dame) only, floor 64, then the TOP 300
// by OVR per position — ~300 recognizable names per reel instead of 136 schools of depth guys.
// Effective cutoffs land around QB 64 / RB 76 / WR 79 (EA rates skill positions hot).
const POOL_FLOOR = 64, POOL_CAP = 300;
const P4_TEAMS = new Set([
  // SEC
  'Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU', 'Mississippi State',
  'Missouri', 'Oklahoma', 'Ole Miss', 'South Carolina', 'Tennessee', 'Texas', 'Texas A&M', 'Vanderbilt',
  // Big Ten
  'Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State', 'Minnesota', 'Nebraska',
  'Northwestern', 'Ohio State', 'Oregon', 'Penn State', 'Purdue', 'Rutgers', 'UCLA', 'USC', 'Washington', 'Wisconsin',
  // Big 12
  'Arizona', 'Arizona State', 'Baylor', 'BYU', 'Cincinnati', 'Colorado', 'Houston', 'Iowa State',
  'Kansas', 'Kansas State', 'Oklahoma State', 'TCU', 'Texas Tech', 'UCF', 'Utah', 'West Virginia',
  // ACC
  'Boston College', 'California', 'Clemson', 'Duke', 'Florida State', 'Georgia Tech', 'Louisville',
  'Miami', 'NC State', 'North Carolina', 'Pittsburgh', 'SMU', 'Stanford', 'Syracuse', 'Virginia',
  'Virginia Tech', 'Wake Forest',
  'Notre Dame',
]);

function base(p, pos) {
  return {
    name: titleCase(p.first_name + ' ' + p.last_name), pos,
    team: teamCase(p.team), cls: classCase(p.class),
    ovr: p.OVR, height: inToStr(p.height), heightIn: p.height || null, wt: p.weight || null,
  };
}
// 8 rated slots per position (+ Frame from height in-game).
function slimQB(p) {
  return { ...base(p, 'QB'),
    armPower: p.THP, shortAcc: p.SAC, midAcc: p.MAC, deepAcc: p.DAC,
    poise: lean(p.TUP, p.BSK), onRun: lean(p.RUN, p.PAC),
    wheels: lean(p.SPD, p.ACC), iq: p.AWR,
  };
}
function slimRB(p) {
  return { ...base(p, 'RB'),
    speed: p.SPD, burst: lean(p.ACC, p.AGI), breakTk: lean(p.BTK, p.TRK),
    elusive: lean(p.JKM, p.SPM), vision: p.BCV, power: lean(p.SFA, p.STR),
    ballSec: p.CAR, hands: p.CTH,
  };
}
function slimWR(p) {
  return { ...base(p, 'WR'),
    hands: p.CTH, speed: p.SPD, routes: Math.round(((p.SRR || 0) + (p.MRR || 0) + (p.DRR || 0)) / 3),
    release: p.RLS, traffic: p.CIT, spectac: p.SPC,
    agility: lean(p.AGI, p.ACC), leap: p.JMP,
  };
}
const SLIM = { qb: slimQB, rb: slimRB, wr: slimWR };
const SLOT_KEYS = {
  qb: ['armPower', 'shortAcc', 'midAcc', 'deepAcc', 'poise', 'onRun', 'wheels', 'iq'],
  rb: ['speed', 'burst', 'breakTk', 'elusive', 'vision', 'power', 'ballSec', 'hands'],
  wr: ['hands', 'speed', 'routes', 'release', 'traffic', 'spectac', 'agility', 'leap'],
};
function makePrime(card, keys) {              // Boost power-up: +6 each slot, +5 ovr (uncapped, family precedent)
  const pr = { ...card, ovr: Math.round(card.ovr + 5), synthPrime: true };
  for (const k of keys) if (typeof pr[k] === 'number') pr[k] = Math.round(pr[k] + 6);
  return pr;
}

// ---------------------------------------------------------------- legends (purple icons)
// Retired college GREATS — rated on their COLLEGE careers, not the pros (that's the whole bit:
// Tebow is a 97 here). Slot values FINAL, same column order as SLOT_KEYS for the position.
// [name, school, heightIn, ovr, ...8 slots]
const QB_ICONS = [
  ['Tim Tebow',        'Florida',        75, 97, 92, 96, 93, 88, 99, 90, 88, 97],
  ['Vince Young',      'Texas',          77, 97, 95, 90, 88, 90, 97, 96, 96, 92],
  ['Cam Newton',       'Auburn',         77, 96, 97, 91, 87, 89, 96, 92, 93, 91],
  ['Joe Burrow',       'LSU',            76, 96, 92, 99, 97, 95, 96, 90, 78, 98],
  ['Deshaun Watson',   'Clemson',        74, 95, 92, 94, 92, 91, 95, 93, 88, 94],
  ['Johnny Manziel',   'Texas A&M',      72, 94, 90, 92, 90, 84, 93, 97, 91, 88],
  ['Tommie Frazier',   'Nebraska',       74, 94, 88, 89, 85, 84, 94, 92, 92, 93],
  ['Baker Mayfield',   'Oklahoma',       73, 93, 91, 96, 94, 92, 90, 88, 78, 93],
  ['Marcus Mariota',   'Oregon',         76, 93, 90, 94, 92, 89, 90, 94, 93, 92],
  ['Doug Flutie',      'Boston College', 70, 93, 89, 91, 89, 87, 92, 95, 86, 94],
  ['Charlie Ward',     'Florida State',  74, 92, 86, 92, 89, 85, 93, 92, 89, 93],
  ['Matt Leinart',     'USC',            77, 92, 88, 95, 93, 90, 91, 82, 70, 92],
];
const RB_ICONS = [
  ['Barry Sanders',    'Oklahoma State', 68, 99, 96, 99, 93, 99, 99, 85, 90, 82],
  ['Bo Jackson',       'Auburn',         73, 98, 99, 96, 97, 91, 93, 99, 88, 80],
  ['Herschel Walker',  'Georgia',        73, 98, 97, 95, 98, 88, 92, 99, 90, 78],
  ['Reggie Bush',      'USC',            72, 97, 97, 98, 88, 98, 96, 82, 88, 92],
  ['Earl Campbell',    'Texas',          71, 96, 93, 92, 99, 84, 91, 99, 89, 76],
  ['Archie Griffin',   'Ohio State',     69, 96, 92, 93, 92, 92, 97, 88, 91, 82],
  ['Tony Dorsett',     'Pittsburgh',     71, 95, 96, 96, 90, 93, 95, 84, 88, 84],
  ['Adrian Peterson',  'Oklahoma',       73, 95, 96, 94, 96, 88, 92, 96, 86, 80],
  ['Ricky Williams',   'Texas',          70, 95, 93, 92, 96, 89, 94, 95, 92, 84],
  ['Derrick Henry',    'Alabama',        75, 95, 94, 90, 99, 84, 92, 99, 93, 78],
  ['Marcus Allen',     'USC',            74, 94, 91, 92, 91, 90, 95, 90, 92, 90],
  ['Ron Dayne',        'Wisconsin',      70, 93, 87, 86, 99, 78, 91, 99, 94, 72],
];
const WR_ICONS = [
  ['Randy Moss',       'Marshall',       76, 98, 96, 99, 92, 94, 93, 99, 92, 99],
  ['Calvin Johnson',   'Georgia Tech',   77, 98, 97, 95, 93, 92, 97, 99, 91, 98],
  ['Larry Fitzgerald', 'Pittsburgh',     75, 97, 99, 90, 94, 90, 98, 97, 88, 96],
  ['DeVonta Smith',    'Alabama',        73, 96, 96, 93, 97, 95, 94, 92, 94, 90],
  ['Ja\'Marr Chase',   'LSU',            72, 95, 95, 93, 92, 93, 95, 94, 91, 92],
  ['Desmond Howard',   'Michigan',       70, 95, 92, 94, 91, 93, 90, 92, 96, 90],
  ['Tim Brown',        'Notre Dame',     72, 94, 91, 93, 90, 91, 90, 91, 94, 89],
  ['Michael Crabtree', 'Texas Tech',     73, 94, 96, 88, 93, 89, 96, 92, 87, 88],
  ['Amari Cooper',     'Alabama',        73, 93, 93, 91, 96, 92, 91, 88, 92, 87],
  ['Justin Blackmon',  'Oklahoma State', 73, 93, 94, 87, 92, 87, 95, 93, 86, 89],
  ['Braylon Edwards',  'Michigan',       75, 92, 92, 90, 89, 87, 92, 93, 85, 93],
  ['Percy Harvin',     'Florida',        71, 93, 90, 96, 88, 91, 89, 90, 97, 86],
];
let LEGEND_IMGS = {};
function icon(row, posKey, pos) {
  const [name, school, heightIn, ovr, ...vals] = row;
  const card = { name, pos, team: school, cls: 'Legend', ovr, height: inToStr(heightIn), heightIn, legend: true };
  if (LEGEND_IMGS[name]) card.img = LEGEND_IMGS[name];
  SLOT_KEYS[posKey].forEach((k, i) => { card[k] = vals[i]; });
  return card;
}

// ---------------------------------------------------------------- ESPN headshots + logos
// site.api.espn.com college rosters carry a headshot for ~95%+ of P4 players. Schools are
// matched by exact mascot displayName (locations like "Miami" collide across divisions).
const normName = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['\u2019.\-]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, '');
// last name + first-2-letters key: catches Cam/Cameron, Nicco/Nico style roster-name variants
function prefixKey(s) {
  const parts = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['\u2019.\-]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 1] + '|' + parts[0].slice(0, 2);
}
const ESPN_NAMES = {
  'Alabama': 'Alabama Crimson Tide', 'Arkansas': 'Arkansas Razorbacks', 'Auburn': 'Auburn Tigers',
  'Florida': 'Florida Gators', 'Georgia': 'Georgia Bulldogs', 'Kentucky': 'Kentucky Wildcats',
  'LSU': 'LSU Tigers', 'Mississippi State': 'Mississippi State Bulldogs', 'Missouri': 'Missouri Tigers',
  'Oklahoma': 'Oklahoma Sooners', 'Ole Miss': 'Ole Miss Rebels', 'South Carolina': 'South Carolina Gamecocks',
  'Tennessee': 'Tennessee Volunteers', 'Texas': 'Texas Longhorns', 'Texas A&M': 'Texas A&M Aggies',
  'Vanderbilt': 'Vanderbilt Commodores', 'Illinois': 'Illinois Fighting Illini', 'Indiana': 'Indiana Hoosiers',
  'Iowa': 'Iowa Hawkeyes', 'Maryland': 'Maryland Terrapins', 'Michigan': 'Michigan Wolverines',
  'Michigan State': 'Michigan State Spartans', 'Minnesota': 'Minnesota Golden Gophers',
  'Nebraska': 'Nebraska Cornhuskers', 'Northwestern': 'Northwestern Wildcats', 'Ohio State': 'Ohio State Buckeyes',
  'Oregon': 'Oregon Ducks', 'Penn State': 'Penn State Nittany Lions', 'Purdue': 'Purdue Boilermakers',
  'Rutgers': 'Rutgers Scarlet Knights', 'UCLA': 'UCLA Bruins', 'USC': 'USC Trojans',
  'Washington': 'Washington Huskies', 'Wisconsin': 'Wisconsin Badgers', 'Arizona': 'Arizona Wildcats',
  'Arizona State': 'Arizona State Sun Devils', 'Baylor': 'Baylor Bears', 'BYU': 'BYU Cougars',
  'Cincinnati': 'Cincinnati Bearcats', 'Colorado': 'Colorado Buffaloes', 'Houston': 'Houston Cougars',
  'Iowa State': 'Iowa State Cyclones', 'Kansas': 'Kansas Jayhawks', 'Kansas State': 'Kansas State Wildcats',
  'Oklahoma State': 'Oklahoma State Cowboys', 'TCU': 'TCU Horned Frogs', 'Texas Tech': 'Texas Tech Red Raiders',
  'UCF': 'UCF Knights', 'Utah': 'Utah Utes', 'West Virginia': 'West Virginia Mountaineers',
  'Boston College': 'Boston College Eagles', 'California': 'California Golden Bears', 'Clemson': 'Clemson Tigers',
  'Duke': 'Duke Blue Devils', 'Florida State': 'Florida State Seminoles', 'Georgia Tech': 'Georgia Tech Yellow Jackets',
  'Louisville': 'Louisville Cardinals', 'Miami': 'Miami Hurricanes', 'NC State': 'NC State Wolfpack',
  'North Carolina': 'North Carolina Tar Heels', 'Pittsburgh': 'Pittsburgh Panthers', 'SMU': 'SMU Mustangs',
  'Stanford': 'Stanford Cardinal', 'Syracuse': 'Syracuse Orange', 'Virginia': 'Virginia Cavaliers',
  'Virginia Tech': 'Virginia Tech Hokies', 'Wake Forest': 'Wake Forest Demon Deacons',
  'Notre Dame': 'Notre Dame Fighting Irish',
  'Marshall': 'Marshall Thundering Herd',   // Randy Moss's legend card
};
async function downloadEspn() {
  console.log('ESPN: downloading rosters + logos...');
  const H = { 'User-Agent': HEADERS['User-Agent'], 'Accept': 'application/json' };
  const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000', { headers: H });
  const all = (await r.json()).sports[0].leagues[0].teams.map(t => t.team);
  const byDisplay = new Map(all.map(t => [t.displayName, t]));
  const out = { fetched: new Date().toISOString().slice(0, 10), teams: {}, players: {} };
  for (const [name, disp] of Object.entries(ESPN_NAMES)) {
    const t = byDisplay.get(disp);
    if (!t) { console.log('  ESPN MISS: ' + disp); continue; }
    out.teams[name] = { id: t.id, logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.id}.png` };
    try {
      const rr = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${t.id}/roster`, { headers: H });
      const j = await rr.json();
      const players = [];
      for (const g of j.athletes || []) for (const a of g.items || []) {
        if (a.headshot && a.headshot.href) players.push({ name: a.fullName, pos: a.position && a.position.abbreviation, img: a.headshot.href });
      }
      out.players[name] = players;
    } catch (e) { console.log('  roster failed: ' + name); }
    await sleep(200);
  }
  fs.writeFileSync('cfb-espn-raw.json', JSON.stringify(out));
  console.log('Wrote cfb-espn-raw.json: ' + Object.keys(out.players).length + ' team rosters');
}

// ---------------------------------------------------------------- legend photos
// Retired greats aren't on ESPN rosters. ESPN's search API has legacy NFL headshots for most;
// pre-headshot-era guys (Frazier, Campbell, Griffin...) fall back to their Wikipedia portrait.
// Cached in cfb-legend-imgs.json (delete to re-fetch). Misses keep the school-crest card art.
const WIKI_TITLES = {   // disambiguation where the plain name isn't the football player
  'Tim Brown': 'Tim Brown (American football)',
  'Randy Moss': 'Randy Moss',
  'Marcus Allen': 'Marcus Allen',
  'Vince Young': 'Vince Young',
  'Charlie Ward': 'Charlie Ward',
  'Ron Dayne': 'Ron Dayne',
};
async function urlOk(u) {
  try { const r = await fetch(u, { method: 'HEAD' }); return r.ok; } catch (e) { return false; }
}
async function espnLegendImg(name) {
  try {
    const r = await fetch('https://site.web.api.espn.com/apis/search/v2?query=' + encodeURIComponent(name) + '&limit=5',
      { headers: { 'User-Agent': HEADERS['User-Agent'] } });
    const j = await r.json();
    const players = ((j.results || []).find(x => x.type === 'player') || {}).contents || [];
    const want = normName(name);
    for (const pl of players) {
      if (normName(pl.displayName) !== want) continue;
      const img = pl.image && (pl.image.default || pl.image.defaultDark);
      if (img && await urlOk(img)) return img;
    }
  } catch (e) {}
  return null;
}
async function wikiLegendImg(name) {
  try {
    const title = WIKI_TITLES[name] || name;
    const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=400&redirects=1&titles=' + encodeURIComponent(title);
    const r = await fetch(u, { headers: { 'User-Agent': 'GoatLab/1.0 (goat-lab.app)' } });
    const j = await r.json();
    const pages = (j.query || {}).pages || {};
    for (const k of Object.keys(pages)) {
      const t = pages[k].thumbnail;
      if (t && t.source) return t.source;
    }
  } catch (e) {}
  return null;
}
async function downloadLegendImgs() {
  console.log('Legend photos: ESPN search + wiki fallback...');
  const names = [...QB_ICONS, ...RB_ICONS, ...WR_ICONS].map(r => r[0]);
  const out = {};
  for (const name of names) {
    let img = await espnLegendImg(name);
    let via = 'espn';
    if (!img) { img = await wikiLegendImg(name); via = 'wiki'; }
    if (img) { out[name] = img; console.log('  ' + name + ' <- ' + via); }
    else console.log('  ' + name + ' <- MISS (keeps school crest)');
    await sleep(250);
  }
  fs.writeFileSync('cfb-legend-imgs.json', JSON.stringify(out));
  console.log('Wrote cfb-legend-imgs.json: ' + Object.keys(out).length + '/' + names.length);
}

// ---------------------------------------------------------------- teams
// Crests: EA's drop-api filters endpoint has official crest PNGs for the 41 marquee programs
// (saved by hand below — endpoint: /rating/ea-sports-college-football/filters). Colors hand-mapped
// for the famous programs; the game hashes unmapped team names onto a palette (soccer precedent).
const TEAM_COLORS = {
  'Alabama': '#9E1B32', 'Georgia': '#BA0C2F', 'Ohio State': '#BB0000', 'Michigan': '#00274C',
  'Texas': '#BF5700', 'Oklahoma': '#841617', 'USC': '#990000', 'Notre Dame': '#0C2340',
  'LSU': '#461D7C', 'Florida': '#0021A5', 'Florida State': '#782F40', 'Miami': '#F47321',
  'Clemson': '#F56600', 'Tennessee': '#FF8200', 'Penn State': '#041E42', 'Oregon': '#154733',
  'Auburn': '#0C2340', 'Texas A&M': '#500000', 'Ole Miss': '#CE1126', 'Nebraska': '#E41C38',
  'Wisconsin': '#C5050C', 'Iowa': '#FFCD00', 'Washington': '#4B2E83', 'UCLA': '#2D68C4',
  'Colorado': '#CFB87C', 'Missouri': '#F1B82D', 'South Carolina': '#73000A', 'Kentucky': '#0033A0',
  'Arkansas': '#9D2235', 'Mississippi State': '#660000', 'Baylor': '#154734', 'TCU': '#4D1979',
  'Texas Tech': '#CC0000', 'Oklahoma State': '#FF7300', 'Kansas State': '#512888', 'Utah': '#CC0000',
  'Arizona State': '#8C1D40', 'Arizona': '#AB0520', 'BYU': '#002E5D', 'Boise State': '#0033A0',
  'Louisville': '#AD0000', 'Virginia Tech': '#630031', 'North Carolina': '#7BAFD4', 'NC State': '#CC0000',
  'Duke': '#003087', 'Syracuse': '#F76900', 'Pittsburgh': '#003594', 'West Virginia': '#002855',
  'Cincinnati': '#E00122', 'UCF': '#B29A5B', 'Houston': '#C8102E', 'SMU': '#0033A0',
  'Memphis': '#003087', 'Tulane': '#006747', 'Army': '#B4A582', 'Navy': '#00205B',
  'Air Force': '#003087', 'Michigan State': '#18453B', 'Minnesota': '#7A0019', 'Illinois': '#E84A27',
  'Indiana': '#990000', 'Purdue': '#CEB888', 'Northwestern': '#4E2A84', 'Maryland': '#E03A3E',
  'Rutgers': '#CC0033', 'Iowa State': '#C8102E', 'Kansas': '#0051BA', 'Stanford': '#8C1515',
  'California': '#003262', 'Oregon State': '#DC4405', 'Washington State': '#981E32', 'Vanderbilt': '#866D4B',
  'Georgia Tech': '#B3A369', 'Wake Forest': '#9E7E38', 'Boston College': '#98002E', 'Virginia': '#232D4B',
  'Louisiana': '#CE181E', 'Marshall': '#00B140', 'App State': '#222222', 'Appalachian State': '#222222',
  'James Madison': '#450084', 'Liberty': '#0A254E', 'Tulsa': '#002D72', 'Toledo': '#15397F',
  'UNLV': '#B10202', 'San Diego State': '#A6192E', 'Fresno State': '#DB0032', 'Texas State': '#501214',
};

(async () => {
  let raw;
  if (process.argv.includes('--fresh') || !fs.existsSync('cfb-raw.json')) raw = await download();
  else raw = JSON.parse(fs.readFileSync('cfb-raw.json', 'utf8')).raw;

  // EA crest URLs (from the filters endpoint, saved so the bake needs no network).
  let crests = {};
  try {
    const f = JSON.parse(fs.readFileSync('cfb-filters-raw.json', 'utf8'));
    for (const g of f.teamGroups || []) for (const t of g.teams || []) crests[t.label.toUpperCase()] = t.imageUrl;
  } catch (e) { /* optional */ }

  // ESPN enrichment (headshots + logos), downloaded once into cfb-espn-raw.json
  let espn = { teams: {}, players: {} };
  if (!fs.existsSync('cfb-espn-raw.json')) await downloadEspn();
  if (!fs.existsSync('cfb-legend-imgs.json')) await downloadLegendImgs();
  try { LEGEND_IMGS = JSON.parse(fs.readFileSync('cfb-legend-imgs.json', 'utf8')); } catch (e) {}
  try { espn = JSON.parse(fs.readFileSync('cfb-espn-raw.json', 'utf8')); } catch (e) {}
  // Match tiers: (1) exact name on the same team, (2) globally-unique exact name — the EA
  // rosters carry spring-2026 portal moves (Lagway is a Bear) that other sources lag, and the
  // headshot is the same human wherever he plays — (3) last-name + first-2-letters, same team,
  // (4) same prefix key, globally unique.
  const espnIndex = {};        // team -> Map(norm name -> img)
  const espnPrefix = {};       // team -> Map(prefix key -> [imgs])
  const globalExact = new Map(), globalPrefix = new Map();
  for (const [team, players] of Object.entries(espn.players || {})) {
    const m = new Map(), pm = new Map();
    for (const pl of players) {
      const k = normName(pl.name), pk = prefixKey(pl.name);
      if (k && !m.has(k)) m.set(k, pl.img);
      if (k) { if (!globalExact.has(k)) globalExact.set(k, []); globalExact.get(k).push(pl.img); }
      if (pk) {
        if (!pm.has(pk)) pm.set(pk, []);
        pm.get(pk).push(pl.img);
        if (!globalPrefix.has(pk)) globalPrefix.set(pk, []);
        globalPrefix.get(pk).push(pl.img);
      }
    }
    espnIndex[team] = m; espnPrefix[team] = pm;
  }
  function findHeadshot(card) {
    const k = normName(card.name), pk = prefixKey(card.name);
    const m = espnIndex[card.team];
    if (m && m.has(k)) return m.get(k);
    const g = globalExact.get(k);
    if (g && g.length === 1) return g[0];
    const pm = espnPrefix[card.team];
    if (pk && pm && pm.has(pk) && pm.get(pk).length === 1) return pm.get(pk)[0];
    const gp = pk && globalPrefix.get(pk);
    if (gp && gp.length === 1) return gp[0];
    return null;
  }

  const positions = {}, legends = {};
  const ICONS = { qb: QB_ICONS, rb: RB_ICONS, wr: WR_ICONS };
  const POS_LABEL = { qb: 'QB', rb: 'RB', wr: 'WR' };
  for (const key of ['qb', 'rb', 'wr']) {
    const pool = raw[key].map(SLIM[key])
      .filter(p => P4_TEAMS.has(p.team) && (p.ovr || 0) >= POOL_FLOOR)
      .sort((a, b) => b.ovr - a.ovr).slice(0, POOL_CAP);
    let hs = 0;
    for (const c of pool) {
      const img = findHeadshot(c);
      if (img) { c.img = img; hs++; }
    }
    const prime = {}; for (const c of pool) prime[c.name] = makePrime(c, SLOT_KEYS[key]);
    positions[key] = { pool, prime };
    const poolNames = new Set(pool.map(p => p.name.toLowerCase()));
    legends[key] = ICONS[key].map(r => icon(r, key, POS_LABEL[key])).filter(l => !poolNames.has(l.name.toLowerCase()));
    console.log(`  ${key}: headshots ${hs}/${pool.length} (${Math.round(hs / pool.length * 100)}%)`);
  }

  // Teams map: every school in any pool + every legend's school. color = hand map (or null ->
  // game hashes); img = official EA crest, else the ESPN logo (fixes the crest-less schools).
  const teams = {};
  const addTeam = name => {
    if (!name || teams[name]) return;
    teams[name] = { color: TEAM_COLORS[name] || null,
      img: crests[name.toUpperCase()] || (espn.teams[name] && espn.teams[name].logo) || null };
  };
  for (const key of ['qb', 'rb', 'wr']) {
    for (const p of positions[key].pool) addTeam(p.team);
    for (const l of legends[key]) addTeam(l.team);
  }

  fs.writeFileSync('cfb.json', JSON.stringify({ positions, legends, teams }));

  // --- report
  const tierOf = o => o >= 85 ? 'diamond' : o >= 80 ? 'gold' : o >= 75 ? 'silver' : o >= 65 ? 'bronze' : 'grey';
  const h2r = inches => inches ? Math.max(1, Math.min(99, Math.round(48 + (inches - 66) * 3.4))) : 60;
  for (const key of ['qb', 'rb', 'wr']) {
    const pool = positions[key].pool, keys = SLOT_KEYS[key];
    const t = {}; for (const p of pool) t[tierOf(p.ovr)] = (t[tierOf(p.ovr)] || 0) + 1;
    const wovr = p => { let s = 0; for (const k of keys) s += (p[k] || 0); s += h2r(p.heightIn); return s / (keys.length + 1); };
    const ovrs = pool.map(wovr).sort((a, b) => b - a);
    const pct = q => Math.round(ovrs[Math.floor(ovrs.length * q)] || 0);
    console.log(key.toUpperCase() + ': ' + pool.length + ' pool, tiers ' + JSON.stringify(t) +
      ' | build-OVR top ' + Math.round(ovrs[0] || 0) + ' p10 ' + pct(0.10) + ' med ' + pct(0.50) +
      ' | legends ' + legends[key].length);
    console.log('  top: ' + pool.slice(0, 5).map(p => p.name + '(' + p.ovr + ' ' + p.team + ')').join(', '));
  }
  console.log('teams: ' + Object.keys(teams).length + ' (' + Object.values(teams).filter(t => t.color).length + ' colored, ' + Object.values(teams).filter(t => t.img).length + ' crested)');
})();
