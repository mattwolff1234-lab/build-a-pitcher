// Share-link page for a submitted build: /p/<scoreId> (rewritten to /api/share?id=<scoreId>).
// Crawlers (X, Discord, iMessage…) get real per-build OG tags — "Mad Max — 97 OVR Hall of Fame
// pitcher · 3,012 K" — so shared links unfurl properly. Humans are immediately redirected to the
// right game page with ?b=<id>, which opens the shared-build viewer ("Beat this career").

const { neon } = require('@neondatabase/serverless');

function findConn() {
  const e = process.env;
  const named = e.DATABASE_URL || e.POSTGRES_URL || e.POSTGRES_PRISMA_URL
    || e.STORAGE_URL || e.STORAGE_DATABASE_URL || e.STORAGE_POSTGRES_URL;
  if (named) return named;
  for (const k of Object.keys(e)) {
    const v = e[k];
    if (typeof v === 'string' && /^postgres(ql)?:\/\//.test(v)) return v;
  }
  return null;
}
const CONN = findConn();
const sql = CONN ? neon(CONN) : null;

const GAME_PATH = { pitcher: '/pitching', batter: '/batting', baller: '/hoops' };
const GAME_NOUN = { pitcher: 'pitcher', batter: 'batter', baller: 'hooper' };

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v) || 0;

// One human-readable career line per game, built from whatever totals the stored build has.
function careerLine(game, t) {
  if (!t || typeof t !== 'object') return '';
  const parts = [];
  if (game === 'batter') {
    if (t.hr != null) parts.push(num(t.hr).toLocaleString('en-US') + ' HR');
    if (t.h != null) parts.push(num(t.h).toLocaleString('en-US') + ' hits');
    if (t.war != null) parts.push(num(t.war).toFixed(1) + ' WAR');
  } else if (game === 'baller') {
    if (t.pts != null) parts.push(num(t.pts).toLocaleString('en-US') + ' PTS');
    if (t.reb != null) parts.push(num(t.reb).toLocaleString('en-US') + ' REB');
    if (t.ast != null) parts.push(num(t.ast).toLocaleString('en-US') + ' AST');
  } else {
    if (t.wins != null && t.losses != null) parts.push(t.wins + '-' + t.losses);
    if (t.k != null) parts.push(num(t.k).toLocaleString('en-US') + ' K');
    if (t.war != null) parts.push(num(t.war).toFixed(1) + ' WAR');
  }
  if (t.rings) parts.push(t.rings + ' 💍');
  return parts.join(' · ');
}

module.exports = async (req, res) => {
  const id = parseInt(req.query && req.query.id, 10);
  const home = 'https://goat-lab.app';
  if (!id || id < 1 || !CONN) {
    res.setHeader('Location', home);
    return res.status(302).end();
  }
  let row = null;
  try { [row] = await sql`SELECT id, name, ovr, game, build FROM scores WHERE id = ${id}`; } catch (e) {}
  if (!row) {
    res.setHeader('Location', home);
    return res.status(302).end();
  }
  const game = GAME_PATH[row.game] ? row.game : 'pitcher';
  const dest = `${GAME_PATH[game]}?b=${row.id}`;
  const t = row.build && row.build.career && row.build.career.totals;
  const hof = !!(t && t.hallOfFame);
  const title = `${row.name || 'A player'} — ${row.ovr} OVR ${hof ? 'Hall of Fame ' : ''}${GAME_NOUN[game]}`;
  const line = careerLine(game, t);
  const descr = `${line ? line + '. ' : ''}Built on GoatLab — think you can beat this career?`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');   // score rows are immutable
  return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)} · GoatLab</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(descr)}">
<meta property="og:image" content="${home}/icon-512.png">
<meta property="og:url" content="${home}/p/${row.id}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(descr)}">
<meta name="twitter:image" content="${home}/icon-512.png">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${esc(dest)}">
<script>location.replace(${JSON.stringify(dest)});</script>
<style>body{background:#0a1320;color:#eaf2fb;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}a{color:#19c6ff}</style>
</head>
<body><p>Opening this build… <a href="${esc(dest)}">tap here if nothing happens</a>.</p></body>
</html>`);
};
