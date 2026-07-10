// Generates franchise-hoops.html + franchise-soccer.html from franchise.html.
// Sport-agnostic core (slots, trades, development, playoffs, settings, logs) stays
// byte-identical; only the sport layer is swapped. Every anchor must match EXACTLY once.
'use strict';
const fs = require('fs');
const ROOT = 'C:/Users/mattw/build-a-pitcher/';
const base = fs.readFileSync(ROOT + 'franchise.html', 'utf8');

let failures = 0;
function rep(src, oldS, newS, tag) {
  const n = src.split(oldS).length - 1;
  if (n !== 1) { console.log(`FAIL [${tag}] x${n}: ${JSON.stringify(String(oldS).slice(0, 90))}`); failures++; return src; }
  return src.replace(oldS, newS);
}
// swap the region [startMark, endMark) — endMark is kept
function swap(src, startMark, endMark, replacement, tag) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a < 0 ? 0 : a);
  if (a < 0 || b < 0 || src.indexOf(startMark, a + 1) >= 0) { console.log(`FAIL [${tag}] block bounds a=${a} b=${b}`); failures++; return src; }
  return src.slice(0, a) + replacement + src.slice(b);
}

/* ================================================================== */
/* =========================== HOOPS ================================ */
/* ================================================================== */
function genHoops() {
  let s = base;
  // ---- head / branding ----
  s = rep(s, '<title>GoatLab · Franchise</title>', '<title>GoatLab · Hoops Franchise</title>', 'h-title');
  s = rep(s, '<meta property="og:title" content="GoatLab · Franchise">', '<meta property="og:title" content="GoatLab · Hoops Franchise">', 'h-og');
  s = rep(s, '<span class="tag">⚾ Franchise Mode</span>', '<span class="tag">🏀 Franchise Mode</span>', 'h-tag');
  // ---- storage / sync / pool keys ----
  s = rep(s, `const LS_KEY = 'pl_franchise';
const LS_SLOTS = 'pl_fr_slots';`, `const LS_KEY = 'pl_franchise_hoops';
const LS_SLOTS = 'pl_fr_slots_hoops';`, 'h-ls');
  s = rep(s, `action: 'franchiseSync', sport: 'baseball', sub: a.sub, sessionToken: a.sessionToken, franchise: W })`,
    `action: 'franchiseSync', sport: 'hoops', sub: a.sub, sessionToken: a.sessionToken, franchise: W })`, 'h-sync');
  s = rep(s, `sessionStorage.getItem('pl_fr_pool')`, `sessionStorage.getItem('pl_fr_pool_hoops')`, 'h-pool1');
  s = rep(s, `sessionStorage.setItem('pl_fr_pool',`, `sessionStorage.setItem('pl_fr_pool_hoops',`, 'h-pool2');
  s = rep(s, `const [p, b] = await Promise.all(['pitcher', 'batter'].map(g =>
      fetch(\`/api/score?action=names&game=\${g}&min=55&max=99&limit=120\`).then(r => r.json())));
    if (p && p.ok && b && b.ok && p.rows.length > 10 && b.rows.length > 10) {
      POOL = { pitcher: p.rows, batter: b.rows };`,
    `const [p] = await Promise.all([fetch('/api/score?action=names&game=baller&min=55&max=99&limit=150').then(r => r.json())]);
    if (p && p.ok && p.rows.length > 10) {
      POOL = { baller: p.rows };`, 'h-pool3');
  s = rep(s, `const key = 'pl_fr_xpday';`, `const key = 'pl_fr_xpday_hoops';`, 'h-xpkey');
  s = rep(s, `if (window.XP) XP.award(8, 'franchise win');`, `if (window.XP) XP.award(8, 'hoops franchise win');`, 'h-xpw');
  s = rep(s, `if (window.XP) XP.award(150, 'franchise title');`, `if (window.XP) XP.award(150, 'hoops franchise title');`, 'h-xpt');
  // ---- mode select: clubs deferred on this sport ----
  s = rep(s, `$('modeMP').onclick = () => { uiView = 'clubs'; render(); };`,
    `$('modeMP').onclick = () => toast('👥 Clubs launch on baseball first — hoops clubs follow right after.');`, 'h-mp');
  s = rep(s, `<div class="tv" style="margin-top:10px;color:var(--gold)">🚧 Early access — clubs forming now</div>`,
    `<div class="tv" style="margin-top:10px;color:var(--dim)">🔜 Baseball clubs first — hoops next</div>`, 'h-mp2');
  s = rep(s, `<button class="frtab" data-tab="clubs">👥 Clubs</button>`, ``, 'h-clubtab');
  // ---- founding copy + roster shape (5 starters + 3 bench = 8 ballers) ----
  s = rep(s, `Stop throwing your builds away. Sign your created pitchers and hitters, run a club in an
      8-team league where <b>every roster is real</b>`,
    `Stop throwing your builds away. Sign your created ballers, run a club in an
      8-team league where <b>every roster is real</b>`, 'h-hero');
  s = rep(s, `<div class="sub" style="margin-bottom:8px">Build/import this many of the 14 — the front office signs free agents for the rest.</div>`,
    `<div class="sub" style="margin-bottom:8px">Build/import this many of the 8 — the front office signs free agents for the rest.</div>`, 'h-found1');
  s = rep(s, `const CREATE_OPTS = [0, 1, 3, 5, 9, 14], GAME_OPTS = [16, 32, 48];`,
    `const CREATE_OPTS = [0, 1, 2, 3, 5, 8], GAME_OPTS = [16, 32, 48];`, 'h-opts');
  s = rep(s, `cr.innerHTML = CREATE_OPTS.map(v => optBtn(v, newCreate, v === 0 ? 'None — front office' : v === 14 ? 'All 14' : String(v))).join('');`,
    `cr.innerHTML = CREATE_OPTS.map(v => optBtn(v, newCreate, v === 0 ? 'None — front office' : v === 8 ? 'All 8' : String(v))).join('');`, 'h-found2');
  s = rep(s, `    rotation: [null, null, null, null, null],
    lineup: [null, null, null, null, null, null, null, null, null],`,
    `    rotation: [null, null, null, null, null],
    lineup: [null, null, null],`, 'h-shape');
  s = rep(s, `function createLimit() { return Math.min(14, Math.max(0, settingsOf(F).create)); }`,
    `function createLimit() { return Math.min(8, Math.max(0, settingsOf(F).create)); }`, 'h-cap');
  s = rep(s, `<div class="sub">How many of the 14 must be YOUR creations`, `<div class="sub">How many of the 8 must be YOUR creations`, 'h-set');
  s = rep(s, `<div class="rsec">Starting Rotation — 5 pitchers</div>`, `<div class="rsec">Starting Five — 5 ballers</div>`, 'h-rsec1');
  s = rep(s, `<div class="rsec">Lineup — 9 hitters</div>`, `<div class="rsec">Bench — 3 ballers</div>`, 'h-rsec2');
  s = rep(s, `Want a brand-new creation? <a href="/pitching?franchise=1" style="color:var(--accent2)">Build a pitcher</a> /
      <a href="/batting?franchise=1" style="color:var(--accent2)">build a batter</a> — your club drafts them on the spot.</p>`,
    `Want a brand-new creation? <a href="/hoops?franchise=1" style="color:var(--accent2)">Build a baller</a> — your club drafts them on the spot.</p>`, 'h-blinks');
  s = rep(s, `        <a class="btn cy" href="/pitching?franchise=1" style="text-decoration:none">⚾ Build a Pitcher ↗</a>
        <a class="btn cy" href="/batting?franchise=1" style="text-decoration:none">💥 Build a Batter ↗</a>`,
    `        <a class="btn cy" href="/hoops?franchise=1" style="text-decoration:none">🏀 Build a Baller ↗</a>`, 'h-blinks2');
  s = rep(s, `Signings start at <b>age 23</b>`, `Signings start at <b>age 23</b>`, 'h-keep');   // no-op sanity anchor
  // ---- my-team markup labels ----
  s = rep(s, `    <div class="rsec">Rotation</div>
    <div id="mtRot"></div>
    <div class="rsec">Lineup</div>
    <div id="mtLine"></div>`, `    <div class="rsec">Starting Five</div>
    <div id="mtRot"></div>
    <div class="rsec">Bench</div>
    <div id="mtLine"></div>`, 'h-mtsec');
  // ---- engine: team strength ----
  s = rep(s, `const teamOvr = t => Math.round((rosterAvg(t.rot) + rosterAvg(t.line)) / 2);`,
    `const teamOvr = t => Math.round(rosterAvg(t.rot) * 0.72 + rosterAvg(t.line) * 0.28);   // starters carry it`, 'h-teamovr');
  // ---- engine: stats block ----
  s = swap(s, 'function blankS(game)', '/* ---- one regular-season game', `function blankS(game) { return { g: 0, pts: 0, reb: 0, ast: 0 }; }
function resetSeasonStats(F) {
  for (const p of F.rotation.concat(F.lineup)) if (p) p.s = blankS(p.game);
}
function foldSeasonStats(F) {
  for (const p of F.rotation.concat(F.lineup)) {
    if (!p || !p.s) continue;
    if (!p.c) p.c = Object.assign({ seasons: 0 }, blankS(p.game));
    p.c.seasons += 1;
    for (const k of Object.keys(p.s)) p.c[k] = Math.round(((p.c[k] || 0) + p.s[k]) * 10) / 10;
  }
}
// end-of-season hardware for YOUR club, from the accumulated real stats
function seasonAwards(F) {
  let mvp = null, six = null;
  const score = p => p.s.pts + p.s.reb * 1.2 + p.s.ast * 1.5;
  for (const p of F.rotation.concat(F.lineup)) if (p && p.s && (!mvp || score(p) > score(mvp))) mvp = p;
  for (const p of F.lineup) if (p && p.s && (!six || score(p) > score(six))) six = p;
  const line = p => \`\${ppg(p.s)} PPG · \${rpg(p.s)} RPG · \${apg(p.s)} APG\`;
  return {
    mvp: mvp ? { name: mvp.name, line: line(mvp) } : null,
    ace: six ? { name: six.name, line: line(six) } : null,   // "ace" slot = Sixth Man
  };
}
const ppg = s => s.g > 0 ? (s.pts / s.g).toFixed(1) : '0.0';
const rpg = s => s.g > 0 ? (s.reb / s.g).toFixed(1) : '0.0';
const apg = s => s.g > 0 ? (s.ast / s.g).toFixed(1) : '0.0';

`, 'h-stats');
  // ---- engine: simGame ----
  s = swap(s, 'function simGame(F, day) {', '// bank the game\'s stats', `function simGame(F, day) {
  const rng = seededRandom(\`\${F.id}|s\${F.season}|g\${day}\`);
  const rival = F.rivals[day % 7];
  const spotlight = F.rotation[day % 5];
  const oppStar = rival.rot[day % 5];
  const myStr = rosterAvg(F.rotation) * 0.72 + rosterAvg(F.lineup) * 0.28;
  const oppStr = rosterAvg(rival.rot) * 0.72 + rosterAvg(rival.line) * 0.28;
  const bell = s => (rng() + rng() + rng() - 1.5) * s;
  // score: your offense minus their defense, calibrated so equal teams split 50/50
  let runsFor = Math.round(clamp(104 + (myStr - 76) * 0.4 - (oppStr - 76) * 0.1 + bell(8), 60, 165));
  let runsAgainst = Math.round(clamp(104 + (oppStr - 76) * 0.4 - (myStr - 76) * 0.1 + bell(8), 60, 165));
  if (runsFor === runsAgainst) runsFor += rng() < clamp(0.5 + (myStr - oppStr) * 0.015, 0.25, 0.75) ? 2 : -2;   // overtime
  const win = runsFor > runsAgainst;
  // full box: all 8 wearing real minutes (starters heavy, bench lighter)
  const all = F.rotation.map(p => ({ p, w: 1 })).concat(F.lineup.map(p => ({ p, w: 0.55 })));
  const raw = all.map(x => Math.max(0.5, (x.p.ovr - 38) * x.w * (0.7 + rng() * 0.6)));
  const tot = raw.reduce((a, v) => a + v, 0);
  let left = runsFor;
  const box = all.map((x, i) => {
    const pts = i === all.length - 1 ? Math.max(0, left) : Math.max(0, Math.round(runsFor * raw[i] / tot));
    left -= pts;
    const reb = Math.max(0, Math.round(2 + (x.p.ovr - 50) * 0.08 * x.w + bell(1.8)));
    const ast = Math.max(0, Math.round(1 + (x.p.ovr - 50) * 0.07 * x.w + bell(1.5)));
    return { n: x.p.name, pts, reb, ast };
  });
  let star = 0;
  for (let i = 1; i < box.length; i++) if (box[i].pts > box[star].pts) star = i;
  const sb = box[star];
  let hero = null;
  const heroRng = rng();
  if (win && runsFor - runsAgainst <= 2 && heroRng < 0.55) hero = \`🦸 \${sb.n} hits the dagger at the buzzer!\`;
  else if (sb.pts >= 40) hero = \`🔥 \${sb.n} drops a 40-piece — \${sb.pts} points.\`;
  else if (sb.pts >= 10 && sb.reb >= 10 && sb.ast >= 10) hero = \`👑 \${sb.n} posts a TRIPLE-DOUBLE: \${sb.pts}/\${sb.reb}/\${sb.ast}.\`;
  else if (win && star >= 5 && heroRng < 0.6) hero = \`⚡ Bench spark: \${sb.n} pours in \${sb.pts} off the pine.\`;
  else if (heroRng < 0.14) hero = win ? \`⭐ \${sb.n} controls the fourth quarter.\` : \`😤 \${sb.n}'s \${sb.pts} weren't enough tonight.\`;
  return {
    win, runsFor, runsAgainst, opp: rival.name, oppIdx: day % 7, oppStarter: oppStar.name,
    starter: spotlight.name, box,
    line: \`\${sb.n}: \${sb.pts} PTS · \${sb.reb} REB · \${sb.ast} AST\`,
    hero,
  };
}
`, 'h-simgame');
  // ---- engine: applyGameStats ----
  s = swap(s, 'function applyGameStats(F, g) {', '// the six rivals', `function applyGameStats(F, g) {
  F.rotation.concat(F.lineup).forEach((p, i) => {
    if (!p || !g.box[i]) return;
    if (!p.s) p.s = blankS(p.game);
    const x = g.box[i];
    p.s.g++; p.s.pts += x.pts; p.s.reb += x.reb; p.s.ast += x.ast;
  });
}
`, 'h-apply');
  // ---- engine: playoff game ----
  s = swap(s, 'function simPlayoffGame(F, tag', 'function simRivalSeries', `function simPlayoffGame(F, tag, rivalIdx, gameNo) {
  const R = F.rivals[rivalIdx];
  const rng = seededRandom(\`\${F.id}|s\${F.season}|\${tag}\${gameNo}\`);
  const spotlight = F.rotation[(F.day + gameNo) % 5];
  const oppStar = R.rot[gameNo % 5];
  const myStr = rosterAvg(F.rotation) * 0.72 + rosterAvg(F.lineup) * 0.28;
  const oppStr = rosterAvg(R.rot) * 0.72 + rosterAvg(R.line) * 0.28;
  const bell = s => (rng() + rng() + rng() - 1.5) * s;
  let runsFor = Math.round(clamp(104 + (myStr - 76) * 0.4 - (oppStr - 76) * 0.1 + bell(8), 60, 165));
  let runsAgainst = Math.round(clamp(104 + (oppStr - 76) * 0.4 - (myStr - 76) * 0.1 + bell(8), 60, 165));
  if (runsFor === runsAgainst) runsFor += rng() < 0.5 ? 2 : -2;
  const big = Math.max(12, Math.round((spotlight.ovr - 50) * 0.55 + 12 + bell(6)));
  return { win: runsFor > runsAgainst, runsFor, runsAgainst, starter: spotlight.name, oppStarter: oppStar.name, k: big,
    line: \`\${spotlight.name}: \${big} PTS on the big stage\` };
}
`, 'h-po');
  s = rep(s, `hero: g.k >= 11 ? \`🔥 \${g.starter} strikes out \${g.k} on the big stage.\` : null, box: null,`,
    `hero: g.k >= 35 ? \`🔥 \${g.starter} erupts for \${g.k} in the playoffs.\` : null, box: null,`, 'h-pohero');
  // ---- rival roster shape ----
  s = rep(s, `  return {
    rot: Array.from({ length: 5 }, () => mk('pitcher')),
    line: Array.from({ length: 9 }, () => mk('batter')),
  };`, `  return {
    rot: Array.from({ length: 5 }, () => mk('baller')),
    line: Array.from({ length: 3 }, () => mk('baller')),
  };`, 'h-rivshape');
  // ---- box-score log entry: names already ride in the box ----
  s = rep(s, `    box: g.box.map((x, i) => ({ n: F.lineup[i] ? F.lineup[i].name : '—', ab: x.ab, h: x.h, hr: x.hr, rbi: x.rbi })),`,
    `    box: g.box,`, 'h-logbox');
  // ---- box overlay ----
  s = rep(s, `  const rows = (e.box || []).map(b => \`<div class="prow" style="cursor:default">
    <span class="nm">\${escapeHTML(b.n)}</span>
    <span class="age">\${b.h}-for-\${b.ab}</span>
    <span class="age">\${b.hr ? '💣 ' + b.hr + ' HR' : ''}</span>
    <span class="ov" style="font-size:13px;width:52px">\${b.rbi} RBI</span></div>\`).join('');
  $('boxBody').innerHTML = \`<div class="pcard-sec">On the mound</div>
    <div class="sub">\${escapeHTML(e.line)}</div>
    \${rows ? \`<div class="pcard-sec">At the plate</div>\${rows}\` : '<div class="hint">No batting box for playoff games (yet).</div>'}
    \${e.hero ? \`<div class="pcard-sec">Moment of the game</div><div class="sub">\${escapeHTML(e.hero)}</div>\` : ''}\`;`,
    `  const rows = (e.box || []).map(b => \`<div class="prow" style="cursor:default">
    <span class="nm">\${escapeHTML(b.n)}</span>
    <span class="age">\${b.pts} PTS</span>
    <span class="age">\${b.reb} REB</span>
    <span class="ov" style="font-size:13px;width:52px">\${b.ast} AST</span></div>\`).join('');
  $('boxBody').innerHTML = \`<div class="pcard-sec">Game ball</div>
    <div class="sub">\${escapeHTML(e.line)}</div>
    \${rows ? \`<div class="pcard-sec">Full box</div>\${rows}\` : '<div class="hint">No box for playoff games (yet).</div>'}
    \${e.hero ? \`<div class="pcard-sec">Moment of the game</div><div class="sub">\${escapeHTML(e.hero)}</div>\` : ''}\`;`, 'h-boxov');
  // ---- next-up strip ----
  s = rep(s, `· <span>P: <b>\${escapeHTML(ours ? ours.name : '?')}</b> (\${ours ? ours.ovr : '?'}) vs <b>\${escapeHTML(theirs.name)}</b> (\${theirs.ovr})</span>\`;`,
    `· <span>Spotlight: <b>\${escapeHTML(ours ? ours.name : '?')}</b> (\${ours ? ours.ovr : '?'}) vs <b>\${escapeHTML(theirs.name)}</b> (\${theirs.ovr})</span>\`;`, 'h-nextup');
  // ---- seats / labels / stat lines ----
  s = rep(s, `  const pos = where === 'rot' ? \`SP\${i + 1}\` : \`Batter \${i + 1}\`;`,
    `  const pos = where === 'rot' ? \`Starter \${i + 1}\` : \`Bench \${i + 1}\`;`, 'h-seatpos');
  s = rep(s, `  const stat = withStats && p.s ? \`<span class="stat">\${p.game === 'pitcher'
    ? \`\${p.s.w}-\${p.s.l} · \${era(p.s)} ERA · \${p.s.k} K\`
    : \`\${avg(p.s)} · \${p.s.hr} HR · \${p.s.rbi} RBI\`}</span>\` : '';`,
    `  const stat = withStats && p.s ? \`<span class="stat">\${ppg(p.s)} PPG · \${rpg(p.s)} RPG · \${apg(p.s)} APG</span>\` : '';`, 'h-seatstat');
  s = rep(s, `  $('mtRot').innerHTML = F.rotation.map((p, i) => p ? prowHtml(p, \`SP\${i + 1}\`,
    p.s ? \`\${p.s.w}-\${p.s.l} · \${era(p.s)} · \${p.s.k} K\` : '—', \`rot\${i}\`) : '').join('');
  $('mtLine').innerHTML = F.lineup.map((p, i) => p ? prowHtml(p, \`B\${i + 1}\`,
    p.s ? \`\${avg(p.s)} · \${p.s.hr} HR · \${p.s.rbi} RBI\` : '—', \`line\${i}\`) : '').join('');`,
    `  $('mtRot').innerHTML = F.rotation.map((p, i) => p ? prowHtml(p, \`S\${i + 1}\`,
    p.s ? \`\${ppg(p.s)} PPG · \${rpg(p.s)} RPG · \${apg(p.s)} APG\` : '—', \`rot\${i}\`) : '').join('');
  $('mtLine').innerHTML = F.lineup.map((p, i) => p ? prowHtml(p, \`B\${i + 1}\`,
    p.s ? \`\${ppg(p.s)} PPG · \${rpg(p.s)} RPG · \${apg(p.s)} APG\` : '—', \`line\${i}\`) : '').join('');`, 'h-mt');
  s = rep(s, `  const cells = (st) => isP
    ? [[\`\${st.w}-\${st.l}\`, 'Record'], [st.ip > 0 ? era(st) : '—', 'ERA'], [st.k, 'K'], [st.gs, 'Starts'], [st.ip ? st.ip.toFixed(1) : 0, 'IP'], [st.ip > 0 ? (st.k * 9 / st.ip).toFixed(1) : '—', 'K/9']]
    : [[st.ab > 0 ? avg(st) : '—', 'AVG'], [st.hr, 'HR'], [st.rbi, 'RBI'], [st.h, 'Hits'], [st.g, 'Games'], [st.ab, 'AB']];`,
    `  const cells = (st) => [[ppg(st), 'PPG'], [rpg(st), 'RPG'], [apg(st), 'APG'], [st.pts, 'Points'], [st.reb, 'Boards'], [st.g, 'Games']];`, 'h-cells');
  s = rep(s, `      <div class="pcard-sub">\${isP ? 'Starting Pitcher' : 'Batter'} · age \${p.age}`,
    `      <div class="pcard-sub">\${isP ? 'Starter' : 'Bench'} · age \${p.age}`, 'h-cardsub');
  s = rep(s, `  const isP = p.game === 'pitcher';
  const s = p.s, c = p.c;`, `  const isP = F.rotation.includes(p);
  const s = p.s, c = p.c;`, 'h-isp');
  // ---- picker / FA / draft game mapping (everything is a baller) ----
  s = rep(s, `  const game = where === 'rot' ? 'pitcher' : 'batter';
  $('pickTitle').textContent = where === 'rot' ? \`Sign a pitcher — SP\${idx + 1}\` : \`Sign a hitter — spot \${idx + 1}\`;`,
    `  const game = 'baller';
  $('pickTitle').textContent = where === 'rot' ? \`Sign a baller — Starter \${idx + 1}\` : \`Sign a baller — Bench \${idx + 1}\`;`, 'h-picker');
  s = rep(s, `        <span class="nm">🛠️ Build a brand-new \${game === 'pitcher' ? 'pitcher' : 'hitter'}</span>`,
    `        <span class="nm">🛠️ Build a brand-new baller</span>`, 'h-buildrow');
  s = rep(s, `    location.href = pickSeat.where === 'rot' ? '/pitching?franchise=1' : '/batting?franchise=1';`,
    `    location.href = '/hoops?franchise=1';`, 'h-buildgo');
  s = rep(s, `    placePlayer(mkFA(rng, pickSeat.where === 'rot' ? 'pitcher' : 'batter', POOL, usedNames()));`,
    `    placePlayer(mkFA(rng, 'baller', POOL, usedNames()));`, 'h-fapick');
  s = rep(s, `  F.rotation = F.rotation.map((p, i) => p || (n++, mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|r\${i}\`), 'pitcher', POOL, used)));
  F.lineup = F.lineup.map((p, i) => p || (n++, mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|l\${i}\`), 'batter', POOL, used)));`,
    `  F.rotation = F.rotation.map((p, i) => p || (n++, mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|r\${i}\`), 'baller', POOL, used)));
  F.lineup = F.lineup.map((p, i) => p || (n++, mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|l\${i}\`), 'baller', POOL, used)));`, 'h-autofill');
  s = rep(s, `  F.rotation = F.rotation.map((p, i) => p || mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|r\${i}\`), 'pitcher', POOL, used));
  F.lineup = F.lineup.map((p, i) => p || mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|l\${i}\`), 'batter', POOL, used));`,
    `  F.rotation = F.rotation.map((p, i) => p || mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|r\${i}\`), 'baller', POOL, used));
  F.lineup = F.lineup.map((p, i) => p || mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|l\${i}\`), 'baller', POOL, used));`, 'h-startfill');
  s = rep(s, `  const game = seat.where === 'rot' ? 'pitcher' : 'batter';
  const pickNo`, `  const game = 'baller';
  const pickNo`, 'h-draftgame');
  s = rep(s, `<div class="pos">\${game === 'pitcher' ? 'SP prospect' : 'Bat prospect'}</div>`,
    `<div class="pos">Prospect</div>`, 'h-draftpos');
  // ---- rookie flow: a baller can take ANY seat (both groups listed) ----
  s = rep(s, `  const where = rk.game === 'pitcher' ? 'rot' : 'line';
  const arr = where === 'rot' ? F.rotation : F.lineup;`,
    `  const where = 'rot';   // hoops: one position — the picker below lists starters AND bench
  const arr = F.rotation.concat(F.lineup);`, 'h-assignarr');
  s = rep(s, `  $('assignSub').textContent = rk.game === 'pitcher'
    ? 'Pick his rotation spot — whoever holds it is released.'
    : 'Pick his lineup spot — whoever holds it is released.';`,
    `  $('assignSub').textContent = 'Pick his spot — starters first, bench after. Whoever holds it is released.';`, 'h-assignsub');
  s = rep(s, `    <span class="pos" style="font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:1.5px;color:var(--dim);width:34px">\${where === 'rot' ? 'SP' + (i + 1) : 'B' + (i + 1)}</span>`,
    `    <span class="pos" style="font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:1.5px;color:var(--dim);width:34px">\${i < 5 ? 'S' + (i + 1) : 'B' + (i - 4)}</span>`, 'h-assignpos');
  s = rep(s, `  document.querySelectorAll('[data-assign]').forEach(el => el.onclick = () => {
    closeOv('assignOv');
    signRookieTo(where, Number(el.dataset.assign));
  });`,
    `  document.querySelectorAll('[data-assign]').forEach(el => el.onclick = () => {
    closeOv('assignOv');
    const k = Number(el.dataset.assign);
    signRookieTo(k < 5 ? 'rot' : 'line', k < 5 ? k : k - 5);
  });`, 'h-assignclick');
  s = rep(s, `  $('rookieMeta').textContent = \`\${rk.ovr} OVR · \${rk.game === 'pitcher' ? 'Starting Pitcher' : 'Batter'} · age 22\`;`,
    `  $('rookieMeta').textContent = \`\${rk.ovr} OVR · Baller · age 22\`;`, 'h-rkmeta');
  s = rep(s, `(\${rk.ovr} OVR \${rk.game === 'pitcher' ? 'SP' : 'batter'}) went <b>#1 in your Franchise Draft</b>`,
    `(\${rk.ovr} OVR baller) went <b>#1 in your Franchise Draft</b>`, 'h-banner');
  // ---- trade hub labels ----
  s = rep(s, `  $('thMine').innerHTML = dead ? '' : F.rotation.map((p, i) => p ? thRow(p, \`SP\${i + 1}\`, \`rot|\${i}\`, th.mine === \`rot|\${i}\`) : '').join('')
    + F.lineup.map((p, i) => p ? thRow(p, \`B\${i + 1}\`, \`line|\${i}\`, th.mine === \`line|\${i}\`) : '').join('');`,
    `  $('thMine').innerHTML = dead ? '' : F.rotation.map((p, i) => p ? thRow(p, \`S\${i + 1}\`, \`rot|\${i}\`, th.mine === \`rot|\${i}\`) : '').join('')
    + F.lineup.map((p, i) => p ? thRow(p, \`B\${i + 1}\`, \`line|\${i}\`, th.mine === \`line|\${i}\`) : '').join('');`, 'h-th1');
  s = rep(s, `    $('thTheirs').innerHTML = pool.map((p, i) => thRow(p, w === 'rot' ? \`SP\${i + 1}\` : \`B\${i + 1}\`, String(i), false)).join('');`,
    `    $('thTheirs').innerHTML = pool.map((p, i) => thRow(p, w === 'rot' ? \`S\${i + 1}\` : \`B\${i + 1}\`, String(i), false)).join('');`, 'h-th2');
  // ---- team viewer rows + meta ----
  s = rep(s, `  $('teamOvMeta').textContent = \`\${T.w}–\${T.l} · \${teamOvr(T)} team OVR · rotation \${Math.round(rosterAvg(T.rot))} · lineup \${Math.round(rosterAvg(T.line))}\`;`,
    `  $('teamOvMeta').textContent = \`\${T.w}–\${T.l} · \${teamOvr(T)} team OVR · starters \${Math.round(rosterAvg(T.rot))} · bench \${Math.round(rosterAvg(T.line))}\`;`, 'h-tvmeta');
  s = rep(s, `  $('teamOvList').innerHTML = T.rot.map((p, i) => row(p, \`SP\${i + 1}\`, 'r' + i)).join('') + T.line.map((p, i) => row(p, \`B\${i + 1}\`, 'l' + i)).join('');`,
    `  $('teamOvList').innerHTML = T.rot.map((p, i) => row(p, \`S\${i + 1}\`, 'r' + i)).join('') + T.line.map((p, i) => row(p, \`B\${i + 1}\`, 'l' + i)).join('');`, 'h-tvrows');
  // ---- awards labels ----
  s = rep(s, `\${h.mvp ? \`<div class="aw"><div class="at">🏅 Team MVP</div>`, `\${h.mvp ? \`<div class="aw"><div class="at">🏅 Team MVP</div>`, 'h-aw-keep');
  s = rep(s, `\${h.ace ? \`<div class="aw"><div class="at">🔥 Staff Ace</div>`, `\${h.ace ? \`<div class="aw"><div class="at">⚡ Sixth Man</div>`, 'h-aw');
  s = rep(s, `      \${h.ace ? \`<span style="color:var(--muted);font-size:11px">Ace \${escapeHTML(h.ace.name)}</span>\` : ''}`,
    `      \${h.ace ? \`<span style="color:var(--muted);font-size:11px">6th Man \${escapeHTML(h.ace.name)}</span>\` : ''}`, 'h-aw2');
  // ---- season toast ----
  s = rep(s, 'toast(`Season ${F.season} begins — ${gamesOf(F)} games, top 4 make the playoffs.`);',
    'toast(`Season ${F.season} begins — ${gamesOf(F)} games, top 4 make the playoffs. 🏀`);', 'h-toast');
  return s;
}

/* ================================================================== */
/* =========================== SOCCER ============================== */
/* ================================================================== */
function genSoccer() {
  let s = base;
  s = rep(s, '<title>GoatLab · Franchise</title>', '<title>GoatLab · Soccer Franchise</title>', 's-title');
  s = rep(s, '<meta property="og:title" content="GoatLab · Franchise">', '<meta property="og:title" content="GoatLab · Soccer Franchise">', 's-og');
  s = rep(s, '<span class="tag">⚾ Franchise Mode</span>', '<span class="tag">⚽ Franchise Mode</span>', 's-tag');
  s = rep(s, `const LS_KEY = 'pl_franchise';
const LS_SLOTS = 'pl_fr_slots';`, `const LS_KEY = 'pl_franchise_soccer';
const LS_SLOTS = 'pl_fr_slots_soccer';`, 's-ls');
  s = rep(s, `action: 'franchiseSync', sport: 'baseball', sub: a.sub, sessionToken: a.sessionToken, franchise: W })`,
    `action: 'franchiseSync', sport: 'soccer', sub: a.sub, sessionToken: a.sessionToken, franchise: W })`, 's-sync');
  s = rep(s, `sessionStorage.getItem('pl_fr_pool')`, `sessionStorage.getItem('pl_fr_pool_soccer')`, 's-pool1');
  s = rep(s, `sessionStorage.setItem('pl_fr_pool',`, `sessionStorage.setItem('pl_fr_pool_soccer',`, 's-pool2');
  s = rep(s, `const [p, b] = await Promise.all(['pitcher', 'batter'].map(g =>
      fetch(\`/api/score?action=names&game=\${g}&min=55&max=99&limit=120\`).then(r => r.json())));
    if (p && p.ok && b && b.ok && p.rows.length > 10 && b.rows.length > 10) {
      POOL = { pitcher: p.rows, batter: b.rows };`,
    `const [p, b] = await Promise.all(['keeper', 'striker'].map(g =>
      fetch(\`/api/score?action=names&game=\${g}&min=55&max=99&limit=120\`).then(r => r.json())));
    if (p && p.ok && b && b.ok && p.rows.length > 10 && b.rows.length > 10) {
      POOL = { keeper: p.rows, striker: b.rows };`, 's-pool3');
  s = rep(s, `const key = 'pl_fr_xpday';`, `const key = 'pl_fr_xpday_soccer';`, 's-xpkey');
  s = rep(s, `if (window.XP) XP.award(8, 'franchise win');`, `if (window.XP) XP.award(8, 'soccer franchise win');`, 's-xpw');
  s = rep(s, `if (window.XP) XP.award(150, 'franchise title');`, `if (window.XP) XP.award(150, 'soccer franchise title');`, 's-xpt');
  s = rep(s, `$('modeMP').onclick = () => { uiView = 'clubs'; render(); };`,
    `$('modeMP').onclick = () => toast('👥 Clubs launch on baseball first — soccer clubs follow right after.');`, 's-mp');
  s = rep(s, `<div class="tv" style="margin-top:10px;color:var(--gold)">🚧 Early access — clubs forming now</div>`,
    `<div class="tv" style="margin-top:10px;color:var(--dim)">🔜 Baseball clubs first — soccer next</div>`, 's-mp2');
  s = rep(s, `<button class="frtab" data-tab="clubs">👥 Clubs</button>`, ``, 's-clubtab');
  s = rep(s, `Stop throwing your builds away. Sign your created pitchers and hitters, run a club in an
      8-team league where <b>every roster is real</b>`,
    `Stop throwing your builds away. Sign your created strikers and keepers, run a club in an
      8-team league where <b>every roster is real</b>`, 's-hero');
  s = rep(s, `<div class="sub" style="margin-bottom:8px">Build/import this many of the 14 — the front office signs free agents for the rest.</div>`,
    `<div class="sub" style="margin-bottom:8px">Build/import this many of the 11 — the front office signs free agents for the rest.</div>`, 's-found1');
  s = rep(s, `const CREATE_OPTS = [0, 1, 3, 5, 9, 14], GAME_OPTS = [16, 32, 48];`,
    `const CREATE_OPTS = [0, 1, 3, 5, 8, 11], GAME_OPTS = [16, 32, 48];`, 's-opts');
  s = rep(s, `cr.innerHTML = CREATE_OPTS.map(v => optBtn(v, newCreate, v === 0 ? 'None — front office' : v === 14 ? 'All 14' : String(v))).join('');`,
    `cr.innerHTML = CREATE_OPTS.map(v => optBtn(v, newCreate, v === 0 ? 'None — front office' : v === 11 ? 'All 11' : String(v))).join('');`, 's-found2');
  s = rep(s, `    rotation: [null, null, null, null, null],
    lineup: [null, null, null, null, null, null, null, null, null],`,
    `    rotation: [null, null],
    lineup: [null, null, null, null, null, null, null, null, null],`, 's-shape');
  s = rep(s, `function createLimit() { return Math.min(14, Math.max(0, settingsOf(F).create)); }`,
    `function createLimit() { return Math.min(11, Math.max(0, settingsOf(F).create)); }`, 's-cap');
  s = rep(s, `<div class="sub">How many of the 14 must be YOUR creations`, `<div class="sub">How many of the 11 must be YOUR creations`, 's-set');
  s = rep(s, `<div class="rsec">Starting Rotation — 5 pitchers</div>`, `<div class="rsec">Goalkeepers — 2 keepers</div>`, 's-rsec1');
  s = rep(s, `<div class="rsec">Lineup — 9 hitters</div>`, `<div class="rsec">The Attack — 9 strikers</div>`, 's-rsec2');
  s = rep(s, `Want a brand-new creation? <a href="/pitching?franchise=1" style="color:var(--accent2)">Build a pitcher</a> /
      <a href="/batting?franchise=1" style="color:var(--accent2)">build a batter</a> — your club drafts them on the spot.</p>`,
    `Want a brand-new creation? <a href="/striker?franchise=1" style="color:var(--accent2)">Build a striker</a> /
      <a href="/keeper?franchise=1" style="color:var(--accent2)">build a keeper</a> — your club signs them on the spot.</p>`, 's-blinks');
  s = rep(s, `        <a class="btn cy" href="/pitching?franchise=1" style="text-decoration:none">⚾ Build a Pitcher ↗</a>
        <a class="btn cy" href="/batting?franchise=1" style="text-decoration:none">💥 Build a Batter ↗</a>`,
    `        <a class="btn cy" href="/striker?franchise=1" style="text-decoration:none">⚽ Build a Striker ↗</a>
        <a class="btn cy" href="/keeper?franchise=1" style="text-decoration:none">🧤 Build a Keeper ↗</a>`, 's-blinks2');
  s = rep(s, `    <div class="rsec">Rotation</div>
    <div id="mtRot"></div>
    <div class="rsec">Lineup</div>
    <div id="mtLine"></div>`, `    <div class="rsec">Goalkeepers</div>
    <div id="mtRot"></div>
    <div class="rsec">The Attack</div>
    <div id="mtLine"></div>`, 's-mtsec');
  s = rep(s, `const teamOvr = t => Math.round((rosterAvg(t.rot) + rosterAvg(t.line)) / 2);`,
    `const teamOvr = t => Math.round(rosterAvg(t.rot) * 0.35 + rosterAvg(t.line) * 0.65);   // the attack carries it`, 's-teamovr');
  s = swap(s, 'function blankS(game)', '/* ---- one regular-season game', `function blankS(game) { return game === 'keeper' ? { g: 0, saves: 0, ga: 0, cs: 0 } : { g: 0, goals: 0, assists: 0 }; }
function resetSeasonStats(F) {
  for (const p of F.rotation.concat(F.lineup)) if (p) p.s = blankS(p.game);
}
function foldSeasonStats(F) {
  for (const p of F.rotation.concat(F.lineup)) {
    if (!p || !p.s) continue;
    if (!p.c) p.c = Object.assign({ seasons: 0 }, blankS(p.game));
    p.c.seasons += 1;
    for (const k of Object.keys(p.s)) p.c[k] = Math.round(((p.c[k] || 0) + p.s[k]) * 10) / 10;
  }
}
// end-of-season hardware for YOUR club, from the accumulated real stats
function seasonAwards(F) {
  let boot = null, glove = null;
  for (const p of F.lineup) if (p && p.s && (!boot || (p.s.goals * 2 + p.s.assists) > (boot.s.goals * 2 + boot.s.assists))) boot = p;
  for (const p of F.rotation) if (p && p.s && (!glove || (p.s.cs * 3 + p.s.saves * 0.2) > (glove.s.cs * 3 + glove.s.saves * 0.2))) glove = p;
  return {
    mvp: boot ? { name: boot.name, line: \`\${boot.s.goals} goals · \${boot.s.assists} assists\` } : null,
    ace: glove ? { name: glove.name, line: \`\${glove.s.cs} clean sheets · \${glove.s.saves} saves\` } : null,
  };
}
const gpg = s => s.g > 0 ? (s.goals / s.g).toFixed(2) : '0.00';

`, 's-stats');
  s = swap(s, 'function simGame(F, day) {', '// bank the game\'s stats', `function simGame(F, day) {
  const rng = seededRandom(\`\${F.id}|s\${F.season}|g\${day}\`);
  const rival = F.rivals[day % 7];
  const gkIdx = (day % 4 === 3) ? 1 : 0;                   // your #2 gets every 4th match
  const gk = F.rotation[gkIdx] || F.rotation[0];
  const oppGk = rival.rot[gkIdx] || rival.rot[0];
  const atk = rosterAvg(F.lineup), oppAtk = rosterAvg(rival.line);
  const myDef = gk.ovr * 0.75 + atk * 0.25;
  const oppDef = oppGk.ovr * 0.75 + oppAtk * 0.25;
  const bell = s => (rng() + rng() + rng() - 1.5) * s;
  const gfMean = clamp(1.5 + (atk - oppDef) * 0.05, 0.15, 4.2);
  const gaMean = clamp(1.5 + (oppAtk - myDef) * 0.05, 0.15, 4.2);
  let runsFor = Math.max(0, Math.round(gfMean + bell(1.15)));
  let runsAgainst = Math.max(0, Math.round(gaMean + bell(1.15)));
  if (runsFor === runsAgainst) runsFor += rng() < clamp(0.5 + (atk - oppDef) * 0.012, 0.25, 0.75) ? 1 : -1;   // extra time
  if (runsFor < 0) runsFor = 0;
  const win = runsFor > runsAgainst;
  // goals + assists distributed across the attack by quality
  const weights = F.lineup.map(p => Math.max(1, p.ovr - 45));
  const wTot = weights.reduce((a, v) => a + v, 0);
  const box = F.lineup.map(p => ({ n: p.name, goals: 0, assists: 0 }));
  for (let sc = 0; sc < runsFor; sc++) {
    let r = rng() * wTot, idx = 0;
    for (; idx < 8; idx++) { r -= weights[idx]; if (r <= 0) break; }
    box[idx].goals++;
    if (rng() < 0.6) box[(idx + 1 + Math.floor(rng() * 8)) % 9].assists++;
  }
  const saves = Math.max(0, Math.round(2.2 + (oppAtk - 55) * 0.07 + bell(1.4)));
  let star = 0;
  for (let i = 1; i < 9; i++) if (box[i].goals * 2 + box[i].assists > box[star].goals * 2 + box[star].assists) star = i;
  const sb = box[star];
  let hero = null;
  const heroRng = rng();
  if (sb.goals >= 3) hero = \`👑 HAT-TRICK! \${sb.n} bags three.\`;
  else if (sb.goals === 2) hero = \`🔥 \${sb.n} strikes twice.\`;
  else if (win && runsAgainst === 0 && heroRng < 0.6) hero = \`🧱 \${gk.name} is a wall — \${saves} saves, clean sheet.\`;
  else if (win && runsFor - runsAgainst === 1 && heroRng < 0.5) hero = \`🦸 \${sb.n} wins it late!\`;
  else if (heroRng < 0.14) hero = win ? \`⭐ \${sb.n} runs the show.\` : \`😤 \${gk.name} deserved better protection.\`;
  return {
    win, runsFor, runsAgainst, opp: rival.name, oppIdx: day % 7, oppStarter: oppGk.name,
    starter: gk.name, gkIdx, saves, box,
    line: \`\${gk.name}: \${saves} save\${saves === 1 ? '' : 's'} · \${runsAgainst === 0 ? 'CLEAN SHEET' : runsAgainst + ' conceded'}\`,
    hero,
  };
}
`, 's-simgame');
  s = swap(s, 'function applyGameStats(F, g) {', '// the six rivals', `function applyGameStats(F, g) {
  const gk = F.rotation[g.gkIdx];
  if (gk) {
    if (!gk.s) gk.s = blankS('keeper');
    gk.s.g++; gk.s.saves += g.saves; gk.s.ga += g.runsAgainst;
    if (g.runsAgainst === 0) gk.s.cs++;
  }
  F.lineup.forEach((p, i) => {
    if (!p || !g.box[i]) return;
    if (!p.s) p.s = blankS('striker');
    p.s.g++; p.s.goals += g.box[i].goals; p.s.assists += g.box[i].assists;
  });
}
`, 's-apply');
  s = swap(s, 'function simPlayoffGame(F, tag', 'function simRivalSeries', `function simPlayoffGame(F, tag, rivalIdx, gameNo) {
  const R = F.rivals[rivalIdx];
  const rng = seededRandom(\`\${F.id}|s\${F.season}|\${tag}\${gameNo}\`);
  const gk = F.rotation[0];                                 // your #1 starts every playoff match
  const oppGk = R.rot[0];
  const atk = rosterAvg(F.lineup), oppAtk = rosterAvg(R.line);
  const myDef = gk.ovr * 0.75 + atk * 0.25;
  const oppDef = oppGk.ovr * 0.75 + oppAtk * 0.25;
  const bell = s => (rng() + rng() + rng() - 1.5) * s;
  let runsFor = Math.max(0, Math.round(clamp(1.5 + (atk - oppDef) * 0.05, 0.15, 4.2) + bell(1.15)));
  let runsAgainst = Math.max(0, Math.round(clamp(1.5 + (oppAtk - myDef) * 0.05, 0.15, 4.2) + bell(1.15)));
  if (runsFor === runsAgainst) runsFor += rng() < 0.5 ? 1 : -1;
  if (runsFor < 0) runsFor = 0;
  const saves = Math.max(0, Math.round(2.2 + (oppAtk - 55) * 0.07 + bell(1.4)));
  return { win: runsFor > runsAgainst, runsFor, runsAgainst, starter: gk.name, oppStarter: oppGk.name, k: saves,
    line: \`\${gk.name}: \${saves} save\${saves === 1 ? '' : 's'} on the big stage\` };
}
`, 's-po');
  s = rep(s, `hero: g.k >= 11 ? \`🔥 \${g.starter} strikes out \${g.k} on the big stage.\` : null, box: null,`,
    `hero: g.k >= 7 ? \`🧱 \${g.starter} stands on his head: \${g.k} playoff saves.\` : null, box: null,`, 's-pohero');
  s = rep(s, `  return {
    rot: Array.from({ length: 5 }, () => mk('pitcher')),
    line: Array.from({ length: 9 }, () => mk('batter')),
  };`, `  return {
    rot: Array.from({ length: 2 }, () => mk('keeper')),
    line: Array.from({ length: 9 }, () => mk('striker')),
  };`, 's-rivshape');
  s = rep(s, `    box: g.box.map((x, i) => ({ n: F.lineup[i] ? F.lineup[i].name : '—', ab: x.ab, h: x.h, hr: x.hr, rbi: x.rbi })),`,
    `    box: g.box,`, 's-logbox');
  s = rep(s, `  const rows = (e.box || []).map(b => \`<div class="prow" style="cursor:default">
    <span class="nm">\${escapeHTML(b.n)}</span>
    <span class="age">\${b.h}-for-\${b.ab}</span>
    <span class="age">\${b.hr ? '💣 ' + b.hr + ' HR' : ''}</span>
    <span class="ov" style="font-size:13px;width:52px">\${b.rbi} RBI</span></div>\`).join('');
  $('boxBody').innerHTML = \`<div class="pcard-sec">On the mound</div>
    <div class="sub">\${escapeHTML(e.line)}</div>
    \${rows ? \`<div class="pcard-sec">At the plate</div>\${rows}\` : '<div class="hint">No batting box for playoff games (yet).</div>'}
    \${e.hero ? \`<div class="pcard-sec">Moment of the game</div><div class="sub">\${escapeHTML(e.hero)}</div>\` : ''}\`;`,
    `  const rows = (e.box || []).filter(b => b.goals || b.assists).map(b => \`<div class="prow" style="cursor:default">
    <span class="nm">\${escapeHTML(b.n)}</span>
    <span class="age">\${b.goals ? '⚽'.repeat(Math.min(b.goals, 4)) + ' ' + b.goals : ''}</span>
    <span class="ov" style="font-size:13px;width:64px">\${b.assists ? b.assists + ' asst' : ''}</span></div>\`).join('');
  $('boxBody').innerHTML = \`<div class="pcard-sec">Between the posts</div>
    <div class="sub">\${escapeHTML(e.line)}</div>
    \${rows ? \`<div class="pcard-sec">On the scoresheet</div>\${rows}\` : '<div class="hint">Nobody found the net' + ((e.box || []).length ? '.' : ' — no sheet for playoff games (yet).') + '</div>'}
    \${e.hero ? \`<div class="pcard-sec">Moment of the match</div><div class="sub">\${escapeHTML(e.hero)}</div>\` : ''}\`;`, 's-boxov');
  s = rep(s, `· <span>P: <b>\${escapeHTML(ours ? ours.name : '?')}</b> (\${ours ? ours.ovr : '?'}) vs <b>\${escapeHTML(theirs.name)}</b> (\${theirs.ovr})</span>\`;`,
    `· <span>In goal: <b>\${escapeHTML(ours ? ours.name : '?')}</b> (\${ours ? ours.ovr : '?'}) vs <b>\${escapeHTML(theirs.name)}</b> (\${theirs.ovr})</span>\`;`, 's-nextup');
  // next-up probable: rotation[day % 5] would overflow 2 keepers — fix the index
  s = rep(s, `    const ours = F.rotation[F.day % 5], theirs = rival.rot[F.day % 5];`,
    `    const gkIdx = (F.day % 4 === 3) ? 1 : 0;
    const ours = F.rotation[gkIdx], theirs = rival.rot[gkIdx];`, 's-nextgk');
  s = rep(s, `  const pos = where === 'rot' ? \`SP\${i + 1}\` : \`Batter \${i + 1}\`;`,
    `  const pos = where === 'rot' ? \`GK\${i + 1}\` : \`ST\${i + 1}\`;`, 's-seatpos');
  s = rep(s, `  const stat = withStats && p.s ? \`<span class="stat">\${p.game === 'pitcher'
    ? \`\${p.s.w}-\${p.s.l} · \${era(p.s)} ERA · \${p.s.k} K\`
    : \`\${avg(p.s)} · \${p.s.hr} HR · \${p.s.rbi} RBI\`}</span>\` : '';`,
    `  const stat = withStats && p.s ? \`<span class="stat">\${p.game === 'keeper'
    ? \`\${p.s.cs} CS · \${p.s.saves} saves\`
    : \`\${p.s.goals} G · \${p.s.assists} A\`}</span>\` : '';`, 's-seatstat');
  s = rep(s, `  $('mtRot').innerHTML = F.rotation.map((p, i) => p ? prowHtml(p, \`SP\${i + 1}\`,
    p.s ? \`\${p.s.w}-\${p.s.l} · \${era(p.s)} · \${p.s.k} K\` : '—', \`rot\${i}\`) : '').join('');
  $('mtLine').innerHTML = F.lineup.map((p, i) => p ? prowHtml(p, \`B\${i + 1}\`,
    p.s ? \`\${avg(p.s)} · \${p.s.hr} HR · \${p.s.rbi} RBI\` : '—', \`line\${i}\`) : '').join('');`,
    `  $('mtRot').innerHTML = F.rotation.map((p, i) => p ? prowHtml(p, \`GK\${i + 1}\`,
    p.s ? \`\${p.s.cs} CS · \${p.s.saves} saves · \${p.s.ga} GA\` : '—', \`rot\${i}\`) : '').join('');
  $('mtLine').innerHTML = F.lineup.map((p, i) => p ? prowHtml(p, \`ST\${i + 1}\`,
    p.s ? \`\${p.s.goals} G · \${p.s.assists} A in \${p.s.g}\` : '—', \`line\${i}\`) : '').join('');`, 's-mt');
  s = rep(s, `  const cells = (st) => isP
    ? [[\`\${st.w}-\${st.l}\`, 'Record'], [st.ip > 0 ? era(st) : '—', 'ERA'], [st.k, 'K'], [st.gs, 'Starts'], [st.ip ? st.ip.toFixed(1) : 0, 'IP'], [st.ip > 0 ? (st.k * 9 / st.ip).toFixed(1) : '—', 'K/9']]
    : [[st.ab > 0 ? avg(st) : '—', 'AVG'], [st.hr, 'HR'], [st.rbi, 'RBI'], [st.h, 'Hits'], [st.g, 'Games'], [st.ab, 'AB']];`,
    `  const cells = (st) => isP
    ? [[st.cs, 'Clean sheets'], [st.saves, 'Saves'], [st.ga, 'Conceded'], [st.g, 'Matches'], [st.g > 0 ? (st.saves / st.g).toFixed(1) : '—', 'Saves/gm'], [st.g > 0 ? (st.ga / st.g).toFixed(2) : '—', 'GA/gm']]
    : [[st.goals, 'Goals'], [st.assists, 'Assists'], [st.g, 'Matches'], [gpg(st), 'Goals/gm'], [st.goals + st.assists, 'G+A'], [st.g, 'Games']];`, 's-cells');
  s = rep(s, `      <div class="pcard-sub">\${isP ? 'Starting Pitcher' : 'Batter'} · age \${p.age}`,
    `      <div class="pcard-sub">\${isP ? 'Goalkeeper' : 'Striker'} · age \${p.age}`, 's-cardsub');
  s = rep(s, `  const isP = p.game === 'pitcher';
  const s = p.s, c = p.c;`, `  const isP = p.game === 'keeper';
  const s = p.s, c = p.c;`, 's-isp');
  s = rep(s, `  const game = where === 'rot' ? 'pitcher' : 'batter';
  $('pickTitle').textContent = where === 'rot' ? \`Sign a pitcher — SP\${idx + 1}\` : \`Sign a hitter — spot \${idx + 1}\`;`,
    `  const game = where === 'rot' ? 'keeper' : 'striker';
  $('pickTitle').textContent = where === 'rot' ? \`Sign a keeper — GK\${idx + 1}\` : \`Sign a striker — ST\${idx + 1}\`;`, 's-picker');
  s = rep(s, `        <span class="nm">🛠️ Build a brand-new \${game === 'pitcher' ? 'pitcher' : 'hitter'}</span>`,
    `        <span class="nm">🛠️ Build a brand-new \${game === 'keeper' ? 'keeper' : 'striker'}</span>`, 's-buildrow');
  s = rep(s, `    location.href = pickSeat.where === 'rot' ? '/pitching?franchise=1' : '/batting?franchise=1';`,
    `    location.href = pickSeat.where === 'rot' ? '/keeper?franchise=1' : '/striker?franchise=1';`, 's-buildgo');
  s = rep(s, `    placePlayer(mkFA(rng, pickSeat.where === 'rot' ? 'pitcher' : 'batter', POOL, usedNames()));`,
    `    placePlayer(mkFA(rng, pickSeat.where === 'rot' ? 'keeper' : 'striker', POOL, usedNames()));`, 's-fapick');
  s = rep(s, `  F.rotation = F.rotation.map((p, i) => p || (n++, mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|r\${i}\`), 'pitcher', POOL, used)));
  F.lineup = F.lineup.map((p, i) => p || (n++, mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|l\${i}\`), 'batter', POOL, used)));`,
    `  F.rotation = F.rotation.map((p, i) => p || (n++, mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|r\${i}\`), 'keeper', POOL, used)));
  F.lineup = F.lineup.map((p, i) => p || (n++, mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|l\${i}\`), 'striker', POOL, used)));`, 's-autofill');
  s = rep(s, `  F.rotation = F.rotation.map((p, i) => p || mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|r\${i}\`), 'pitcher', POOL, used));
  F.lineup = F.lineup.map((p, i) => p || mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|l\${i}\`), 'batter', POOL, used));`,
    `  F.rotation = F.rotation.map((p, i) => p || mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|r\${i}\`), 'keeper', POOL, used));
  F.lineup = F.lineup.map((p, i) => p || mkFA(seededRandom(\`\${F.id}|auto|\${F.season}|l\${i}\`), 'striker', POOL, used));`, 's-startfill');
  s = rep(s, `  const game = seat.where === 'rot' ? 'pitcher' : 'batter';
  const pickNo`, `  const game = seat.where === 'rot' ? 'keeper' : 'striker';
  const pickNo`, 's-draftgame');
  s = rep(s, `<div class="pos">\${game === 'pitcher' ? 'SP prospect' : 'Bat prospect'}</div>`,
    `<div class="pos">\${game === 'keeper' ? 'GK prospect' : 'ST prospect'}</div>`, 's-draftpos');
  s = rep(s, `  const where = rk.game === 'pitcher' ? 'rot' : 'line';`,
    `  const where = rk.game === 'keeper' ? 'rot' : 'line';`, 's-assignarr');
  s = rep(s, `  $('assignSub').textContent = rk.game === 'pitcher'
    ? 'Pick his rotation spot — whoever holds it is released.'
    : 'Pick his lineup spot — whoever holds it is released.';`,
    `  $('assignSub').textContent = rk.game === 'keeper'
    ? 'Pick his goalkeeper spot — whoever holds it is released.'
    : 'Pick his attacking spot — whoever holds it is released.';`, 's-assignsub');
  s = rep(s, `    <span class="pos" style="font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:1.5px;color:var(--dim);width:34px">\${where === 'rot' ? 'SP' + (i + 1) : 'B' + (i + 1)}</span>`,
    `    <span class="pos" style="font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:1.5px;color:var(--dim);width:34px">\${where === 'rot' ? 'GK' + (i + 1) : 'ST' + (i + 1)}</span>`, 's-assignpos');
  s = rep(s, `  $('rookieMeta').textContent = \`\${rk.ovr} OVR · \${rk.game === 'pitcher' ? 'Starting Pitcher' : 'Batter'} · age 22\`;`,
    `  $('rookieMeta').textContent = \`\${rk.ovr} OVR · \${rk.game === 'keeper' ? 'Goalkeeper' : 'Striker'} · age 22\`;`, 's-rkmeta');
  s = rep(s, `(\${rk.ovr} OVR \${rk.game === 'pitcher' ? 'SP' : 'batter'}) went <b>#1 in your Franchise Draft</b>`,
    `(\${rk.ovr} OVR \${rk.game === 'keeper' ? 'GK' : 'striker'}) went <b>#1 in your Franchise Draft</b>`, 's-banner');
  s = rep(s, `  $('thMine').innerHTML = dead ? '' : F.rotation.map((p, i) => p ? thRow(p, \`SP\${i + 1}\`, \`rot|\${i}\`, th.mine === \`rot|\${i}\`) : '').join('')
    + F.lineup.map((p, i) => p ? thRow(p, \`B\${i + 1}\`, \`line|\${i}\`, th.mine === \`line|\${i}\`) : '').join('');`,
    `  $('thMine').innerHTML = dead ? '' : F.rotation.map((p, i) => p ? thRow(p, \`GK\${i + 1}\`, \`rot|\${i}\`, th.mine === \`rot|\${i}\`) : '').join('')
    + F.lineup.map((p, i) => p ? thRow(p, \`ST\${i + 1}\`, \`line|\${i}\`, th.mine === \`line|\${i}\`) : '').join('');`, 's-th1');
  s = rep(s, `    $('thTheirs').innerHTML = pool.map((p, i) => thRow(p, w === 'rot' ? \`SP\${i + 1}\` : \`B\${i + 1}\`, String(i), false)).join('');`,
    `    $('thTheirs').innerHTML = pool.map((p, i) => thRow(p, w === 'rot' ? \`GK\${i + 1}\` : \`ST\${i + 1}\`, String(i), false)).join('');`, 's-th2');
  s = rep(s, `  $('teamOvMeta').textContent = \`\${T.w}–\${T.l} · \${teamOvr(T)} team OVR · rotation \${Math.round(rosterAvg(T.rot))} · lineup \${Math.round(rosterAvg(T.line))}\`;`,
    `  $('teamOvMeta').textContent = \`\${T.w}–\${T.l} · \${teamOvr(T)} team OVR · keepers \${Math.round(rosterAvg(T.rot))} · attack \${Math.round(rosterAvg(T.line))}\`;`, 's-tvmeta');
  s = rep(s, `  $('teamOvList').innerHTML = T.rot.map((p, i) => row(p, \`SP\${i + 1}\`, 'r' + i)).join('') + T.line.map((p, i) => row(p, \`B\${i + 1}\`, 'l' + i)).join('');`,
    `  $('teamOvList').innerHTML = T.rot.map((p, i) => row(p, \`GK\${i + 1}\`, 'r' + i)).join('') + T.line.map((p, i) => row(p, \`ST\${i + 1}\`, 'l' + i)).join('');`, 's-tvrows');
  s = rep(s, `\${h.mvp ? \`<div class="aw"><div class="at">🏅 Team MVP</div>`, `\${h.mvp ? \`<div class="aw"><div class="at">👟 Golden Boot</div>`, 's-aw1');
  s = rep(s, `\${h.ace ? \`<div class="aw"><div class="at">🔥 Staff Ace</div>`, `\${h.ace ? \`<div class="aw"><div class="at">🧤 Golden Glove</div>`, 's-aw2');
  s = rep(s, `      \${h.mvp ? \`<span style="color:var(--muted);font-size:11px">MVP \${escapeHTML(h.mvp.name)}</span>\` : ''}`,
    `      \${h.mvp ? \`<span style="color:var(--muted);font-size:11px">Boot \${escapeHTML(h.mvp.name)}</span>\` : ''}`, 's-aw3');
  s = rep(s, `      \${h.ace ? \`<span style="color:var(--muted);font-size:11px">Ace \${escapeHTML(h.ace.name)}</span>\` : ''}`,
    `      \${h.ace ? \`<span style="color:var(--muted);font-size:11px">Glove \${escapeHTML(h.ace.name)}</span>\` : ''}`, 's-aw4');
  s = rep(s, 'toast(`Season ${F.season} begins — ${gamesOf(F)} games, top 4 make the playoffs.`);',
    'toast(`Season ${F.season} begins — ${gamesOf(F)} matches, top 4 make the playoffs. Draws go to extra time. ⚽`);', 's-toast');
  return s;
}

const hoops = genHoops();
const soccer = genSoccer();
if (failures) { console.log(`\n${failures} anchor failures — nothing written.`); process.exit(1); }
fs.writeFileSync(ROOT + 'franchise-hoops.html', hoops);
fs.writeFileSync(ROOT + 'franchise-soccer.html', soccer);
console.log('franchise-hoops.html + franchise-soccer.html written');
