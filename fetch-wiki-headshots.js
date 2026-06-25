// Fallback-of-the-fallback: for pitchers with no MLBAM headshot, try Wikipedia —
// but ONLY accept an image after verifying the page is actually that player
// (matching last name + first name/nickname) and is a baseball pitcher.
//
//   node fetch-wiki-headshots.js
//
// Patches matching entries in pitchers.json with an `img` field (direct URL).

const fs = require('fs');

const UA = 'BuildAPitcher/1.0 (mattwolff1234@gmail.com)';
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'’-]/g, '').replace(/\s+/g, ' ').trim();

const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
// common baseball first-name nicknames (either direction)
const NICK = [
  ['mike', 'michael'], ['matt', 'matthew'], ['alex', 'alexander'], ['nate', 'nathan'],
  ['nate', 'nathaniel'], ['nick', 'nicholas'], ['jake', 'jacob'], ['will', 'william'],
  ['zach', 'zachary'], ['zack', 'zachary'], ['gabe', 'gabriel'], ['rob', 'robert'],
  ['robbie', 'robert'], ['dom', 'dominic'], ['sam', 'samuel'], ['ben', 'benjamin'],
  ['joe', 'joseph'], ['tony', 'anthony'], ['chris', 'christopher'], ['dan', 'daniel'],
  ['danny', 'daniel'], ['jon', 'jonathan'], ['drew', 'andrew'], ['andy', 'andrew'],
  ['charlie', 'charles'], ['tom', 'thomas'], ['tommy', 'thomas'], ['josh', 'joshua'],
  ['mitch', 'mitchell'], ['ed', 'edward'], ['eddie', 'edward'], ['tj', 'thomas'],
  ['gus', 'gustavo'], ['jj', 'james'],
];
function firstNameMatch(a, b) {
  if (a === b) return true;
  return NICK.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function tokens(name) {
  return norm(name).split(' ').filter(t => t && !SUFFIX.has(t));
}

function verify(cardName, page) {
  const c = tokens(cardName);
  const p = tokens(page.title);
  if (c.length < 2 || p.length < 2) return false;
  if (c[c.length - 1] !== p[p.length - 1]) return false;        // last name must match
  if (!firstNameMatch(c[0], p[0])) return false;                // first name / nickname
  if (page.type && page.type !== 'standard') return false;      // no disambiguation pages
  const text = ((page.description || '') + ' ' + (page.extract || '')).toLowerCase();
  if (!text.includes('baseball')) return false;
  if (!/pitch/.test(text)) return false;                        // must be a pitcher
  return true;
}

async function wiki(path) {
  const r = await fetch('https://en.wikipedia.org' + path, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function resolve(name) {
  // candidate titles from search
  const q = encodeURIComponent(name + ' baseball pitcher');
  const search = await wiki(`/w/api.php?action=query&list=search&srsearch=${q}&srlimit=3&format=json&origin=*`);
  const hits = (search.query && search.query.search) || [];
  for (const h of hits) {
    try {
      const sum = await wiki(`/api/rest_v1/page/summary/${encodeURIComponent(h.title)}`);
      if (verify(name, sum) && sum.thumbnail && sum.thumbnail.source) {
        return { url: sum.thumbnail.source, title: sum.title };
      }
    } catch (e) { /* skip */ }
  }
  return null;
}

async function main() {
  const data = JSON.parse(fs.readFileSync('pitchers.json', 'utf8'));
  const all = [...data.pool, ...Object.values(data.prime), ...data.legends];
  const missingNames = [...new Set(all.filter(p => !p.mlbamId && !p.img).map(p => p.name))];
  console.log(`Trying Wikipedia for ${missingNames.length} pitchers...`);

  const resolved = {};
  for (const name of missingNames) {
    let hit = null;
    try { hit = await resolve(name); } catch (e) {}
    if (hit) { resolved[name] = hit.url; console.log(`  ✓ ${name}  ->  ${hit.title}`); }
    else console.log(`  ✗ ${name}  (no verified match)`);
    await new Promise(r => setTimeout(r, 150));
  }

  for (const p of all) if (!p.mlbamId && resolved[p.name]) p.img = resolved[p.name];
  fs.writeFileSync('pitchers.json', JSON.stringify(data));
  console.log(`\nResolved ${Object.keys(resolved).length}/${missingNames.length} via Wikipedia. Wrote pitchers.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
