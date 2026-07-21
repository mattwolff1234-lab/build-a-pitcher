// Generates goatsquad-football.html FROM goatsquad-baseball.html by anchored string
// replacement — the same recipe that produced the baseball page, except this transform
// is COMMITTED (the baseball one was session-scratch; regenerating it meant archaeology).
//   node gen-squadfoot.js
// Every replacement asserts its occurrence count, so if the baseball engine drifts the
// generator fails loudly instead of silently producing a half-transformed page.
// Engine deltas beyond reskin strings:
//   · fieldSvg(): ballpark -> gridiron (end zones, yard lines, hashes, midfield oval)
//   · scores are built from scoring EVENTS (TD 7 · FG 3 · odd 6/8/2) so every number
//     is a real football number; quarters weight Q2/Q4 hot (two-minute drills)
//   · boxScore coherence: receivers' yards SUM to the QB's passing line, TDs are
//     handed to named players and reconcile with the team's TD count, defense gets a
//     unit line (a pick-six lives there), QB gets his own line like the pitcher did
//   · proxyImg reads a LIST of canvas proxies (EA portraits + ESPN + Wikipedia)

const fs = require('fs');

const SRC = 'goatsquad-baseball.html';
const OUT = 'goatsquad-football.html';
let html = fs.readFileSync(SRC, 'utf8');

let nRep = 0;
function rep(from, to, expect) {
  expect = expect == null ? 1 : expect;
  const parts = html.split(from);
  if (parts.length - 1 !== expect) {
    console.error(`ANCHOR MISS (${parts.length - 1} of ${expect} expected):\n---\n${from.slice(0, 200)}\n---`);
    process.exit(1);
  }
  html = parts.join(to);
  nRep += expect;
}

/* ---------------- head / brand / constants ---------------- */
rep('GOAT Squad Baseball · GoatLab', 'GOAT Squad Football · GoatLab', 2);
rep('Spin the wheel, fill your lineup, sign their stars.', 'Spin the wheel, field your eleven, sign their stars.');
rep('not affiliated with Major League Baseball', 'not affiliated with the National Football League');
rep('document.title = `${CFG.brand} Baseball · GoatLab`;', 'document.title = `${CFG.brand} Football · GoatLab`;');
rep("const GAME_CONFIG_URL = '/goatsquad-mlb.json';", "const GAME_CONFIG_URL = '/goatsquad-nfl.json';");
rep("const ROUTE = '/squad-baseball';", "const ROUTE = '/squad-football';");
rep("'squadball'", "'squadfoot'");
rep('pl_sb_', 'pl_fb_', 11);

/* ---------------- copy: home screen, buttons, badges ---------------- */
rep('<b>Every open position spins at once</b> — shortstops at SS, aces on the mound, sluggers at DH, faces flying past on the field.',
  '<b>Every open position spins at once</b> — quarterbacks at QB, corners on the island, playmakers at FLEX, faces flying past on the field.');
rep('⚾ BUILD &amp; FIGHT', '🏈 BUILD &amp; FIGHT');
rep("'⚔️ PLAY THE SERIES' : '⚾ BUILD YOUR LINEUP'", "'⚔️ PLAY THE SERIES' : '🏈 BUILD YOUR SQUAD'");
rep('FIRST PITCH…', 'KICKOFF…', 2);
rep('<span class="gs-badge you" title="Your squad">⚾</span>', '<span class="gs-badge you" title="Your squad">🏈</span>');
rep("'⭐', '⚾', '💰'", "'⭐', '🏈', '💰'");
rep("' · DUGOUT'", "' · SIDELINE'");
rep("e.coach ? 'MGR' :", "e.coach ? 'HC' :");
rep('⚾ PLAY BALL · GAME 7', '🏈 KICK OFF · GAME 7');
rep("'YOUR PARK' : 'THEIR PARK'", "'YOUR STADIUM' : 'THEIR STADIUM'", 2);
rep("['END 3RD', 'END 6TH', 'END 8TH', 'FINAL']", "['END 1ST', 'HALFTIME', 'END 3RD', 'FINAL']");
rep("['3RD', '6TH', '8TH', 'FIN']", "['1ST', 'HALF', '3RD', 'FIN']");
rep('// 5x2 headshot grid — the full 10-man lineup', '// 5x2 headshot grid — the full 10-man squad');
rep('// re-flip Game 7 with the mercenary on the floor — games 1–6 stand',
  '// re-flip Game 7 with the mercenary on the field — games 1–6 stand');

/* ---------------- engine header comment ---------------- */
rep([
  '   GOAT Squad BASEBALL — the goatsquad.html engine with a ballpark slot layout,',
  '   a hard no-duplicate guard (secondary positions overlap the pools) and a',
  '   baseball series presentation. Regenerated from goatsquad.html by an anchored',
  '   transform (see git history of this file\'s first commit).'
].join('\n'), [
  '   GOAT Squad FOOTBALL — the goatsquad-baseball.html engine with a gridiron slot',
  '   layout and a football series presentation: scores built from TD/FG events so',
  '   every number is a real football number, and box lines that reconcile (the',
  '   receivers\' yards ARE the QB\'s passing yards). Regenerated from',
  '   goatsquad-baseball.html by gen-squadfoot.js — committed, rerun any time.'
].join('\n'));

/* ---------------- adapter: full-URL imgs on config rosters + coaches ---------------- */
rep('// coaches with an nbaId get their real headshot; the rest keep the 📋 clipboard',
  '// coaches with a baked img (Wikipedia portrait) show it; the rest keep the 📋 clipboard');
rep("img: c.mlbamId != null ? CFG.adapter.imageTemplate.replace('{id}', c.mlbamId) : null",
  'img: c.img || null');
rep("img: p.mlbamId != null ? CFG.adapter.imageTemplate.replace('{id}', p.mlbamId) : imgByName(p.name),",
  'img: p.img || imgByName(p.name),');

/* ---------------- canvas proxy list (three image origins) ---------------- */
rep([
  'function proxyImg(url) {',
  '  const P = CFG.adapter.canvasImageProxy;',
  "  return (url && P && url.indexOf(P.from) === 0) ? P.to + url.slice(P.from.length) : url;",
  '}'
].join('\n'), [
  'function proxyImg(url) {',
  '  for (const P of (CFG.adapter.canvasImageProxies || [])) {',
  '    if (url && url.indexOf(P.from) === 0) return P.to + url.slice(P.from.length);',
  '  }',
  '  return url;',
  '}'
].join('\n'));
rep('   /nba-headshots/ proxy so the canvas stays exportable (cdn.nba.com has no CORS). ---------- */',
  '   same-origin proxies so the canvas stays exportable (EA portraits, ESPN and\n   Wikipedia all live on foreign origins). ---------- */');

/* ---------------- the gridiron ---------------- */
rep('  /* the ballpark stage — every slot sits ON the field at its position, faint diamond behind.',
  '  /* the gridiron stage — every slot sits ON the field at its position, faint yard lines behind.');
rep('/* ---------- slot grid — slots pinned onto a faint SVG ballpark ---------- */',
  '/* ---------- slot grid — slots pinned onto a faint SVG gridiron ---------- */');
rep('background:linear-gradient(180deg, #0a1a12 0%, #0a1320 76%, var(--bg0) 100%);',
  'background:linear-gradient(180deg, #0a1c11 0%, #0b1a14 62%, var(--bg0) 100%);');

const OLD_FIELD = [
  'function fieldSvg() {',
  '  return `<svg id="fieldSvg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">',
  '    <path d="M50,92 L4,36 Q50,-14 96,36 Z" fill="rgba(74,222,128,.05)" stroke="rgba(120,220,160,.14)" stroke-width=".35"/>',
  '    <path d="M50,90 L27,61 Q50,35 73,61 Z" fill="rgba(214,158,90,.10)" stroke="rgba(214,170,110,.18)" stroke-width=".3"/>',
  '    <path d="M50,86 L33,64 50,44 67,64 Z" fill="rgba(74,222,128,.06)"/>',
  '    <path d="M50,88 L26,60 50,33 74,60 Z" fill="none" stroke="rgba(234,242,251,.18)" stroke-width=".35"/>',
  '    <ellipse cx="50" cy="60" rx="4.4" ry="3.2" fill="rgba(214,158,90,.16)"/>',
  '    <path d="M50,88 L4,36 M50,88 L96,36" stroke="rgba(234,242,251,.11)" stroke-width=".3"/>',
  '    <rect x="49.1" y="32.2" width="1.8" height="1.8" fill="rgba(234,242,251,.25)"/>',
  '    <rect x="73.1" y="59.2" width="1.8" height="1.8" fill="rgba(234,242,251,.25)"/>',
  '    <rect x="25.1" y="59.2" width="1.8" height="1.8" fill="rgba(234,242,251,.25)"/>',
  '    <rect x="6" y="79" width="17" height="9" rx="1.4" fill="rgba(9,15,25,.45)" stroke="rgba(120,160,210,.14)" stroke-width=".3"/>',
  '    <rect x="77" y="79" width="17" height="9" rx="1.4" fill="rgba(9,15,25,.45)" stroke="rgba(120,160,210,.14)" stroke-width=".3"/>',
  '  </svg>`;',
  '}'
].join('\n');
const NEW_FIELD = [
  'function fieldSvg() {',
  '  return `<svg id="fieldSvg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">',
  '    <rect x="6" y="2" width="88" height="96" fill="rgba(74,222,128,.05)" stroke="rgba(120,220,160,.14)" stroke-width=".35"/>',
  '    <rect x="6" y="2" width="88" height="8" fill="rgba(25,198,255,.08)"/>',
  '    <rect x="6" y="90" width="88" height="8" fill="rgba(255,122,24,.08)"/>',
  '    <line x1="6" y1="10" x2="94" y2="10" stroke="rgba(234,242,251,.20)" stroke-width=".4"/>',
  '    <line x1="6" y1="90" x2="94" y2="90" stroke="rgba(234,242,251,.20)" stroke-width=".4"/>',
  '    <g stroke="rgba(234,242,251,.09)" stroke-width=".3">',
  '      <line x1="6" y1="23" x2="94" y2="23"/><line x1="6" y1="36" x2="94" y2="36"/>',
  '      <line x1="6" y1="63" x2="94" y2="63"/><line x1="6" y1="76" x2="94" y2="76"/>',
  '    </g>',
  '    <line x1="6" y1="50" x2="94" y2="50" stroke="rgba(234,242,251,.16)" stroke-width=".45"/>',
  '    <g stroke="rgba(234,242,251,.07)" stroke-width=".25">',
  '      <line x1="38" y1="12" x2="38" y2="88"/><line x1="62" y1="12" x2="62" y2="88"/>',
  '    </g>',
  '    <ellipse cx="50" cy="50" rx="7" ry="4.4" fill="none" stroke="rgba(234,242,251,.10)" stroke-width=".3"/>',
  '  </svg>`;',
  '}'
].join('\n');
rep(OLD_FIELD, NEW_FIELD);

/* ---------------- utility-slot comments (DH -> FLEX) ---------------- */
rep('// A legend never shows in the utility (DH) slot unless', '// A legend never shows in the utility (FLEX) slot unless');
rep("  if (pi < 0) return true;   // a true DH — the utility slot IS his position slot",
  '  if (pi < 0) return true;   // a true flex type — the utility slot IS his position slot');
rep('// no-duplicate rule: secondary positions overlap the pools (a "SS/3B" guy rides both\n// reels), so any name already LOCKED in a slot is skipped everywhere else.',
  '// no-duplicate rule: the pools overlap (a WR rides the WR1, WR2 AND FLEX reels), so\n// any name already LOCKED in a slot is skipped everywhere else.');
rep("const idx = pi < 0 ? si : (run.locked[pi].rating <= run.locked[si].rating ? pi : si);   // true DHs go to the DH seat",
  "const idx = pi < 0 ? si : (run.locked[pi].rating <= run.locked[si].rating ? pi : si);   // pure-FLEX types take the FLEX seat");

/* ---------------- the series sim: events, quarters, swing, box ---------------- */
const OLD_SIM = [
  '// runs through 4 checkpoints (end of the 3rd / 6th / 8th / final) — buckets weighted by',
  '// how many innings each covers, zeros welcome (this is baseball)',
  'function quarters(total, rng) {',
  '  const q = [0, 0, 0, 0];',
  '  const w = [3, 3, 2, 1];',
  '  for (let r = 0; r < total; r++) {',
  '    let x = rng() * 9, k = 0;',
  '    while (x > w[k]) { x -= w[k]; k++; }',
  '    q[k]++;',
  '  }',
  '  return q;',
  '}',
  '// Make most games a back-and-forth: shift runs within each team\'s own line (totals',
  '// untouched) so the eventual LOSER leads through the 3rd or the 6th.',
  'function addSwing(qW, qL, rng) {',
  '  const k = rng() < 0.5 ? 0 : 1;',
  '  const cw = qW.slice(0, k + 1).reduce((a, b) => a + b, 0);',
  '  const cl = qL.slice(0, k + 1).reduce((a, b) => a + b, 0);',
  '  const need = cw - cl;',
  '  if (need < 0) return;                       // loser already leads there',
  '  const s = need + 1;',
  '  if (qW[k] < s || qL[3] < s) return;         // can\'t manufacture the lead — leave it wire-to-wire',
  '  qW[k] -= s; qW[3] += s;',
  '  qL[k] += s; qL[3] -= s;',
  '}'
].join('\n');
const NEW_SIM = [
  '// each team\'s game is a list of scoring EVENTS (TD 7 · FG 3 · the odd 6/8/2), dropped',
  '// into quarters weighted like a real Sunday — Q2/Q4 run hot (two-minute drills).',
  'function scoreEvents(n, rng) {',
  '  const ev = [];',
  '  for (let i = 0; i < n; i++) {',
  '    const r = rng();',
  '    ev.push(r < 0.55 ? 7 : r < 0.59 ? 6 : r < 0.63 ? 8 : r < 0.97 ? 3 : 2);',
  '  }',
  '  return ev;',
  '}',
  'function quarters(events, rng) {',
  '  const q = [0, 0, 0, 0];',
  '  const w = [0.21, 0.29, 0.22, 0.28];',
  '  for (const pts of events) {',
  '    let x = rng(), k = 0;',
  '    while (k < 3 && x > w[k]) { x -= w[k]; k++; }',
  '    q[k] += pts;',
  '  }',
  '  return q;',
  '}',
  '// Make most games a back-and-forth: move whole scores (a TD, else a FG) between the',
  '// winner\'s early/late quarters (totals untouched) so the eventual LOSER leads after',
  '// the 1st or at the half. Residues stay football-shaped (0 or ≥3 left behind).',
  'function addSwing(qW, qL, rng) {',
  '  const k = rng() < 0.5 ? 0 : 1;',
  '  const lead = () => qW.slice(0, k + 1).reduce((a, b) => a + b, 0) - qL.slice(0, k + 1).reduce((a, b) => a + b, 0);',
  '  const take = (q, i) => { for (const v of [7, 3]) { if (q[i] === v || q[i] >= v + 3) { q[i] -= v; return v; } } return 0; };',
  '  for (let guard = 0; guard < 8 && lead() >= 0; guard++) {',
  '    let v = take(qW, k);',
  '    if (v) { qW[3] += v; continue; }',
  '    v = take(qL, 3);',
  '    if (v) { qL[k] += v; continue; }',
  '    return;                                   // can\'t manufacture it — wire-to-wire',
  '  }',
  '}'
].join('\n');
rep(OLD_SIM, NEW_SIM);

const OLD_BOX = [
  '// hitters get H / HR / RBI (kept in the engine\'s pts/reb/ast fields so every render',
  '// spot stays untouched); the pitcher gets his own line (IP · K · ER) under the table.',
  '// Order matters for believability: hits come first (rating-driven), homers come OUT of',
  '// the hits (and can\'t outnumber the team\'s runs), then the remaining runs are credited',
  '// as RBIs to the guys who actually hit, capped per player — a 1-for-4 night can no',
  '// longer drive in 6. Runs nobody drives in scored on errors/wild pitches (RBI ≤ R, like',
  '// a real box).',
  'function boxScore(teamRuns, oppRuns, roster, rng) {',
  "  const hitters = roster.filter(r => r.key !== 'p');",
  "  const pitcher = roster.find(r => r.key === 'p');",
  '  const rows = hitters.map(r => ({',
  '    name: lastName(r.name),',
  '    pts: Math.min(4, Math.floor((r.rating / 96) * (0.25 + rng() * 2.9))),',
  '    reb: 0, ast: 0, _r: r.rating',
  '  }));',
  '  let hrLeft = teamRuns;                                    // every homer scores at least one',
  '  rows.forEach(row => {',
  '    if (row.pts > 0 && hrLeft > 0 && rng() < 0.13 + row._r / 700) { row.reb = 1; hrLeft--; }',
  '    if (row.pts > 1 && row.reb === 1 && hrLeft > 0 && rng() < 0.10) { row.reb = 2; hrLeft--; }',
  '  });',
  '  rows.forEach(row => { row.ast = row.reb; });              // homers bank their own RBI',
  '  let pool = teamRuns - rows.reduce((a, r) => a + r.ast, 0);',
  '  const cap = row => row.reb * 4 + (row.pts - row.reb) * 2 + (row.pts > 0 ? 1 : 0);',
  '  for (let guard = 0; pool > 0 && guard < 220; guard++) {',
  '    const open = rows.filter(r => r.ast < cap(r));',
  '    if (!open.length) break;',
  '    const ws = open.map(r => r.pts + 2 * r.reb + 0.4);',
  '    let roll = rng() * ws.reduce((a, b) => a + b, 0), pick = open[0];',
  '    for (let i = 0; i < open.length; i++) { if ((roll -= ws[i]) < 0) { pick = open[i]; break; } }',
  '    pick.ast++;',
  '    pool--;',
  '  }',
  '  let star = 0;',
  '  const shine = r => r.ast * 2 + r.reb * 3 + r.pts;',
  '  rows.forEach((r, i) => { if (shine(r) > shine(rows[star])) star = i; });',
  '  rows.forEach(r => { delete r._r; });',
  '  const benchPts = Math.floor(rng() * 3);                   // bench knocks',
  '  let pline = null;',
  '  if (pitcher) {',
  '    const ipFull = Math.max(4, Math.min(9, 5 + Math.round((pitcher.rating - 75) / 8) + Math.floor(rng() * 2)));',
  '    const outs = rng() < 0.45 ? Math.floor(rng() * 3) : 0;',
  '    const k = Math.max(1, Math.round(ipFull * (0.55 + pitcher.rating / 110) * (0.6 + rng() * 0.7)));',
  '    const er = Math.max(0, oppRuns - Math.floor(rng() * 3));',
  "    pline = { name: lastName(pitcher.name), ip: ipFull + '.' + outs, k, er };",
  '  }',
  '  return { rows, benchPts, star, pline };',
  '}'
].join('\n');
const NEW_BOX = [
  '// skill players get TOUCHES / YARDS / TDs (kept in the engine\'s pts/reb/ast fields so',
  '// every render spot stays untouched); the QB gets his own line (C/ATT · YDS · TD · INT)',
  '// and the defense gets a unit line. Coherence contract (the baseball lesson, applied',
  '// first try): the game\'s scoring events arrive from simSeries, every offensive TD is',
  '// handed to a named player (or a QB sneak), a stray one is a pick-six that lives in the',
  '// defense line, and the receivers\' yards ARE the QB\'s passing yards — split among them.',
  '// So a 2-catch 190-yard night, a 6-TD team box with 2 TDs scored, or receivers who',
  '// out-gain their own QB are all impossible by construction.',
  'function boxScore(events, oppEvents, roster, rng) {',
  '  const teamPts = events.reduce((a, b) => a + b, 0);',
  '  const oppPts = oppEvents.reduce((a, b) => a + b, 0);',
  "  const qb = roster.find(r => r.key === 'qb');",
  "  const OFF = ['rb', 'wr1', 'wr2', 'te', 'flex'];",
  '  const rows = OFF.map(k => roster.find(r => r.key === k))',
  '    .map(r => ({ name: lastName(r.name), key: r.key, pts: 0, reb: 0, ast: 0, _r: r.rating }));',
  '  const tdEvents = events.filter(e => e !== 3 && e !== 2).length;',
  '  const defTd = tdEvents > 0 && rng() < 0.10 ? 1 : 0;      // the odd pick-six',
  '  let qbRush = 0;',
  '  const tdW = { rb: 1.25, wr1: 1.0, wr2: 0.85, te: 0.8, flex: 0.7 };',
  '  for (let t = 0; t < tdEvents - defTd; t++) {',
  '    if (rng() < 0.10) { qbRush++; continue; }              // QB sneak',
  '    const ws = rows.map(r => tdW[r.key] * Math.pow(r._r / 80, 2));',
  '    let roll = rng() * ws.reduce((a, b) => a + b, 0), pick = rows[0];',
  '    for (let i = 0; i < rows.length; i++) { if ((roll -= ws[i]) < 0) { pick = rows[i]; break; } }',
  '    pick.ast++;',
  '  }',
  '  // passing volume scales with the QB and the shootout; receivers split ALL of it',
  '  const passYds = Math.round((105 + qb.rating * 1.5 + teamPts * 2.0) * (0.72 + rng() * 0.5));',
  '  const shares = rows.map(r => ({ rb: 0.13, wr1: 0.30, wr2: 0.24, te: 0.18, flex: 0.15 }[r.key] * (0.55 + rng() * 0.9) * (r._r / 82)));',
  '  const shareSum = shares.reduce((a, b) => a + b, 0);',
  '  let recLeft = passYds;',
  '  rows.forEach((r, i) => {',
  '    const y = i === rows.length - 1 ? recLeft : Math.round(passYds * shares[i] / shareSum);',
  '    r.reb = Math.max(0, y); recLeft -= y;',
  '  });',
  '  // the RB adds his ground game on top of the dump-offs',
  "  const rb = rows.find(r => r.key === 'rb');",
  '  const rushYds = Math.round((30 + rb._r * 0.95) * (0.55 + rng() * 0.8));',
  '  const dumpYds = rb.reb;',
  '  rb.reb += rushYds;',
  '  // touches: receptions cover the yards (and at least the TDs); the RB adds carries',
  '  rows.forEach(r => {',
  "    const recs = r.key === 'rb' ? Math.max(0, Math.round(dumpYds / (7 + rng() * 4))) : Math.round(r.reb / (9.5 + rng() * 5));",
  '    r.pts = Math.max(r.ast, recs, r.reb > 0 ? 1 : 0);',
  '  });',
  '  rb.pts += 9 + Math.round(rushYds / 5.5) + Math.floor(rng() * 4);',
  '  // QB line: completions/attempts from the same yards, INTs lean on bad nights',
  '  const att = Math.max(14, Math.round(passYds / (7.0 + rng() * 1.6)));',
  '  const cmp = Math.min(att, Math.round(att * (0.53 + qb.rating / 380 + rng() * 0.09)));',
  '  const rbRushTd = Math.min(rb.ast, Math.round(rb.ast * 0.7));',
  '  const passTd = rows.reduce((a, r) => a + r.ast, 0) - rbRushTd;',
  '  const int = ((rng() < (teamPts > oppPts ? 0.26 : 0.5)) ? 1 : 0) + (rng() < 0.10 ? 1 : 0);',
  '  const qline = { name: lastName(qb.name), cmp, att, yds: passYds, td: passTd, int, rush: qbRush };',
  '  // the defense line: front-seven ratings drive sacks, the secondary drives takeaways',
  "  const dlR = roster.find(r => r.key === 'dl').rating, lbR = roster.find(r => r.key === 'lb').rating;",
  "  const cbP = roster.find(r => r.key === 'cb'), sP = roster.find(r => r.key === 's');",
  '  const sacks = Math.max(0, Math.round((dlR + lbR - 132) / 20 + rng() * 2.6 - 0.5));',
  '  const ints = defTd + ((rng() < (cbP.rating + sP.rating - 130) / 240) ? 1 : 0);',
  '  const defStars = [{ n: cbP.name, r: cbP.rating }, { n: sP.name, r: sP.rating }];',
  '  const dline = { sacks, ints, td: defTd, star: lastName((dlR + 6 > Math.max(cbP.rating, sP.rating) ? { n: roster.find(r => r.key === \'dl\').name } : defStars.sort((a, b) => b.r - a.r)[0]).n) };',
  '  // star of the game: best yardage/TD line, or the QB when he out-shines the room',
  '  let star = 0;',
  '  const shine = r => r.reb + 27 * r.ast;',
  '  rows.forEach((r, i) => { if (shine(r) > shine(rows[star])) star = i; });',
  '  if (passYds * 0.44 + 27 * (passTd + qbRush) > shine(rows[star])) star = -1;',
  '  rows.forEach(r => { delete r._r; delete r.key; });',
  '  return { rows, benchPts: 0, star, qline, dline };',
  '}',
  '// the ⭐ lines, long (scoreboard) and short (series log) — one place for both formats',
  'function starLine(g) {',
  '  const b = g.box;',
  '  if (b.star === -1) return `⭐ ${b.qline.name} ${b.qline.cmp}/${b.qline.att} · ${b.qline.yds} YDS · ${b.qline.td} TD`;',
  '  const r = b.rows[b.star];',
  '  return `⭐ ${r.name} ${r.pts} TCH · ${r.reb} YDS${r.ast ? ` · ${r.ast} TD` : \'\'}`;',
  '}',
  'function starShort(g) {',
  '  const b = g.box;',
  '  return b.star === -1 ? `${b.qline.name} ${b.qline.yds} YDS` : `${b.rows[b.star].name} ${b.rows[b.star].reb} YDS`;',
  '}'
].join('\n');
rep(OLD_BOX, NEW_BOX);

/* simSeries: event-built scores replace the run-total roll */
rep([
  '    const hi = 1 + Math.floor(Math.pow(rng(), 1.35) * 10) + (rng() < 0.08 ? 3 : 0);   // winner 1–13, skews low',
  '    const lo = Math.max(0, hi - 1 - Math.floor(rng() * Math.min(hi, 5)));',
  '    const us = win ? hi : lo, them = win ? lo : hi;',
  '    const q = quarters(us, rng), q2 = quarters(them, rng);',
  '    if (rng() < 0.8) addSwing(win ? q : q2, win ? q2 : q, rng);   // most games see a lead change',
  '    const g = { win, us, them, q, q2, box: boxScore(us, them, roster, rng), home };'
].join('\n'), [
  '    const nW = 3 + Math.floor(rng() * 3) + (rng() < 0.18 ? 1 : 0);                    // winner: 3–6 scores',
  '    const nL = Math.max(1, nW - (rng() < 0.5 ? 0 : 1) - (rng() < 0.35 ? 1 : 0)) - (rng() < 0.05 ? 2 : 0);',
  '    const evW = scoreEvents(nW, rng), evL = scoreEvents(Math.max(0, nL), rng);',
  '    // settle ties/upside-down games gently: soften a loser TD to a FG before dropping scores',
  '    const sum = ev => ev.reduce((a, b) => a + b, 0);',
  '    for (let guard = 0; guard < 12 && evL.length && sum(evL) >= sum(evW); guard++) {',
  '      const j = evL.findIndex(e => e >= 6);',
  '      if (j >= 0 && sum(evL) - sum(evW) < 4) evL[j] = 3; else evL.pop();',
  '    }',
  '    const hi = evW.reduce((a, b) => a + b, 0), lo = evL.reduce((a, b) => a + b, 0);',
  '    const us = win ? hi : lo, them = win ? lo : hi;',
  '    const q = quarters(win ? evW : evL, rng), q2 = quarters(win ? evL : evW, rng);',
  '    if (rng() < 0.8) addSwing(win ? q : q2, win ? q2 : q, rng);   // most games see a lead change',
  '    const g = { win, us, them, q, q2, box: boxScore(win ? evW : evL, win ? evL : evW, roster, rng), home };'
].join('\n'));

rep('// Home Field Deed flips the 2-3-2 pattern into YOUR park and adds a small edge there',
  '// Home Field Deed flips the 2-3-2 pattern into YOUR stadium and adds a small edge there');
rep('// 2-3-2 World Series format', '// 2-3-2 series format', 2);

/* star render spots go through the shared helpers (the star can now be the QB) */
rep([
  '      const star = g.box.rows[g.box.star];',
  '      $(\'gsStar\').textContent = `⭐ ${star.name} ${star.pts}-4${star.reb ? ` · ${star.reb} HR` : \'\'} · ${star.ast} RBI`;',
  '      const row = document.createElement(\'div\');',
  '      row.className = \'game-row\';',
  '      row.innerHTML = `<span class="gn">GM ${st.n}</span><span class="gstar">⭐ ${star.name} ${star.ast} RBI</span><b class="${g.win ? \'win\' : \'loss\'} disp">${g.win ? \'W\' : \'L\'} ${g.us}–${g.them}</b>`;'
].join('\n'), [
  '      $(\'gsStar\').textContent = starLine(g);',
  '      const row = document.createElement(\'div\');',
  '      row.className = \'game-row\';',
  '      row.innerHTML = `<span class="gn">GM ${st.n}</span><span class="gstar">⭐ ${starShort(g)}</span><b class="${g.win ? \'win\' : \'loss\'} disp">${g.win ? \'W\' : \'L\'} ${g.us}–${g.them}</b>`;'
].join('\n'));

/* box-score overlay: QB + defense lines replace bench + pitcher */
rep('<table class="bs"><thead><tr><th>PLAYER</th><th>H</th><th>HR</th><th>RBI</th></tr></thead><tbody id="bsBody"></tbody></table>',
  '<table class="bs"><thead><tr><th>PLAYER</th><th>TCH</th><th>YDS</th><th>TD</th></tr></thead><tbody id="bsBody"></tbody></table>');
rep([
  '    `<tr class="bench"><td>Bench</td><td>${g.box.benchPts}</td><td>—</td><td>—</td></tr>` +',
  '    (g.box.pline ? `<tr><td>⚾ ${g.box.pline.name}</td><td colspan="3" style="text-align:right">${g.box.pline.ip} IP · ${g.box.pline.k} K · ${g.box.pline.er} ER</td></tr>` : \'\');'
].join('\n'), [
  '    `<tr><td>🏈 ${g.box.qline.name}</td><td colspan="3" style="text-align:right">${g.box.qline.cmp}/${g.box.qline.att} · ${g.box.qline.yds} YDS · ${g.box.qline.td} TD · ${g.box.qline.int} INT${g.box.qline.rush ? ` · ${g.box.qline.rush} RUSH TD` : \'\'}</td></tr>` +',
  '    `<tr class="bench"><td>🛡️ Defense</td><td colspan="3" style="text-align:right">${g.box.dline.sacks} SACK · ${g.box.dline.ints} INT${g.box.dline.td ? \' · PICK-6\' : \'\'} · led by ${g.box.dline.star}</td></tr>`;'
].join('\n'));

/* ---------------- scouting report: yards are the headline stat ---------------- */
rep('    a.pts += r.ast; a.n++;   // RBI is the headline stat here',
  '    a.pts += r.reb; a.n++;   // yards are the headline stat here');
rep('`${run.ovr} vs ${b.rating}. Some losses are scheduled before first pitch — this one ${100 - odds} times out of 100.`',
  '`${run.ovr} vs ${b.rating}. Some losses are scheduled before kickoff — this one ${100 - odds} times out of 100.`');
rep('`Game 7 and it slipped. One swing from a different story.`',
  '`Game 7 and it slipped. One snap from a different story.`');
rep("`Seven games, one bad night. That's October baseball.`",
  "`Seven games, one bad night. That's January football.`");
rep('`<b>${wk} (${wkR})</b> got pitched around all series${wkPpg ? ` — ${wkPpg} RBIs a night won\'t cut it` : \'\'}.`',
  '`<b>${wk} (${wkR})</b> got hunted every snap${wkPpg ? ` — ${wkPpg} yards a night won\'t cut it` : \'\'}.`');
rep('`<b>${wk}</b> at ${wkR} was the hole in the lineup${wkPpg ? `. ${wkPpg} RBIs a game says so` : \'\'}.`',
  '`<b>${wk}</b> at ${wkR} was the hole in the depth chart${wkPpg ? `. ${wkPpg} yards a game says so` : \'\'}.`');
rep('`Your best guy was <b>${stN}</b> at <b>${stR}</b>. Nobody in this lineup scares a ${b.rating} team.`',
  '`Your best guy was <b>${stN}</b> at <b>${stR}</b>. Nobody on this roster scares a ${b.rating} team.`');
rep('`Ninth inning came and nobody wanted the moment. A ${stR}-rated leading man isn\'t enough.`',
  '`The fourth quarter came and nobody wanted the ball. A ${stR}-rated leading man isn\'t enough.`');
rep('`${low} guys under 75 in the lineup. Depth like that folds over seven games.`',
  '`${low} guys under 75 on the field. Depth like that folds over seven games.`');
rep('`You can hide one weak bat. You had ${low}.`',
  '`You can hide one weak starter. You had ${low}.`');
rep('`<b>${topN}</b> drove in <b>${tp} a game</b> and never cooled off.`',
  '`<b>${topN}</b> piled up <b>${tp} yards a game</b> and never cooled off.`');
rep('`<b>${topN}</b> carried the offense: <b>${tp} RBIs</b> a night.`',
  '`<b>${topN}</b> carried the offense: <b>${tp} yards</b> a night.`');
rep('`Ask the box score who won this. It says <b>${topN}</b>, ${tp} RBIs a game.`',
  '`Ask the box score who won this. It says <b>${topN}</b>, ${tp} yards a game.`');

/* ---------------- 🔍 the scout: one-use overall peek during the mulligan ---------------- */
rep('<button class="btn ghost disp" id="dropBtn" style="display:none">🔄 DROP ONE</button>',
  '<button class="btn ghost disp" id="dropBtn" style="display:none">🔄 DROP ONE</button>\n      <button class="btn ghost disp" id="scoutBtn" style="display:none">🔍 SCOUT ONE</button>');
rep([
  "  $('keepBtn').style.display = 'inline-flex';",
  "  $('dropBtn').style.display = 'inline-flex';",
  "  $('gameHint').innerHTML = 'Squad full! Keep it, or <b>drop one</b> and gamble on a respin?';",
  "  if (window.gsap) gsap.from('#keepBtn, #dropBtn', { y: 8, opacity: 0, duration: .22, stagger: .06, ease: 'power2.out', clearProps: 'all' });"
].join('\n'), [
  "  $('keepBtn').style.display = 'inline-flex';",
  "  $('dropBtn').style.display = 'inline-flex';",
  "  $('scoutBtn').style.display = run.scoutUsed ? 'none' : 'inline-flex';",
  "  $('gameHint').innerHTML = run.scoutUsed",
  "    ? 'Squad full! Keep it, or <b>drop one</b> and gamble on a respin?'",
  "    : 'Squad full! Keep it, <b>drop one</b> and respin — or 🔍 <b>scout</b> one overall first.';",
  "  if (window.gsap) gsap.from('#keepBtn, #dropBtn, #scoutBtn', { y: 8, opacity: 0, duration: .22, stagger: .06, ease: 'power2.out', clearProps: 'all' });"
].join('\n'));
rep([
  'function offerDone() {',
  "  $('keepBtn').style.display = 'none';",
  "  $('dropBtn').style.display = 'none';",
  "  $('stopBtn').style.display = 'inline-flex';",
  '}'
].join('\n'), [
  'function offerDone() {',
  "  $('keepBtn').style.display = 'none';",
  "  $('dropBtn').style.display = 'none';",
  "  $('scoutBtn').style.display = 'none';",
  "  $('stopBtn').style.display = 'inline-flex';",
  '}'
].join('\n'));
rep('function keepSquad() {', [
  '// 🔍 the scout: once per build, put ONE player\'s overall on the table before deciding',
  '// who to drop. Purely informational — no RNG is consumed, so the daily stays shared.',
  'function startScoutPick() {',
  "  run.phase = 'scout-pick';",
  "  $('keepBtn').style.display = 'none';",
  "  $('dropBtn').style.display = 'none';",
  "  $('scoutBtn').style.display = 'none';",
  "  $('gameHint').innerHTML = 'Tap ONE player to <b>scout</b> — his overall goes public.';",
  "  CFG.slots.forEach((s, i) => $('slot' + i).classList.add('pickable'));",
  '}',
  'function scoutSlot(i) {',
  '  run.scoutUsed = true;',
  "  const e = run.locked[i], rEl = $('sRate' + i);",
  "  rEl.textContent = e.coach ? ((e.mod > 0 ? '+' : '') + e.mod) : e.rating;",
  "  rEl.style.display = 'flex';",
  "  $('slot' + i).classList.add('t-' + tierKey(e));",
  "  CFG.slots.forEach((s, j) => $('slot' + j).classList.remove('pickable'));",
  "  if (window.gsap) gsap.fromTo('#slot' + i, { scale: 1 }, { scale: 1.08, duration: .16, yoyo: true, repeat: 1, ease: 'power2.out' });",
  '  Sound.lock();',
  "  track('scout_used', { slot: CFG.slots[i].key, rating: e.coach ? e.mod : e.rating });",
  '  redoOffer();',
  '}',
  'function keepSquad() {'
].join('\n'));
rep("  if (run && run.phase === 'redo-pick' && run.locked[i]) { dropSlot(i); return; }", [
  "  if (run && run.phase === 'scout-pick' && run.locked[i]) { scoutSlot(i); return; }",
  "  if (run && run.phase === 'redo-pick' && run.locked[i]) { dropSlot(i); return; }"
].join('\n'));
rep("$('dropBtn').addEventListener('click', startRedoPick);",
  "$('dropBtn').addEventListener('click', startRedoPick);\n$('scoutBtn').addEventListener('click', startScoutPick);");
rep('It can come back better... or worse.</span></div>',
  'It can come back better... or worse. A one-use 🔍 <b>scout</b> can peek ONE overall first.</span></div>');

fs.writeFileSync(OUT, html);
console.log(`${OUT} written · ${nRep} anchored replacements`);
