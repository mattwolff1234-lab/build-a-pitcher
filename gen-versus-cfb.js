/* ============================================================================
   gen-versus-cfb.js — build versus-cfb.html from the (working) versus-hoops.html.

   CFB 1v1 is a SAME-POSITION MIRROR: both players are assigned the same college
   position (QB/RB/WR) from the shared match seed, quick-build it under the shot
   clock, higher Overall wins (seeded coin on a tie). Ranked + server-settled via
   the CFB pvp handlers already wired into api/account.js + api/match-cfb.js.

   versus-hoops.html was itself built as a "both build the same role" mirror (the
   pitcher/batter ROLE keys are vestigial A/B labels), so this is mostly a config
   + data + string swap. The one real rewrite is the showdown: the basketball
   possession engine is replaced by a compact seeded football scoreboard reveal
   (the winner logic — higher OVR, seeded coin on tie — is preserved verbatim).

   Run:  node gen-versus-cfb.js   → writes versus-cfb.html
   Re-run after editing versus-hoops.html to keep the CFB page in sync.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, 'versus-hoops.html');
const OUT = path.join(__dirname, 'versus-cfb.html');

let s = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');   // normalize CRLF→LF so multi-line matches work
let step = 0;
function must(find, replace, expect) {
  const n = s.split(find).length - 1;
  if (expect != null && n !== expect) {
    throw new Error(`[T${step}] expected ${expect} of ${JSON.stringify(find.slice(0, 60))}, found ${n}`);
  }
  if (n === 0) throw new Error(`[T${step}] NOT FOUND: ${JSON.stringify(find.slice(0, 80))}`);
  s = s.split(find).join(replace);
  step++;
}
function soft(find, replace) {           // cosmetic · log if absent, never fail
  const n = s.split(find).length - 1;
  if (n === 0) { console.warn(`  (soft miss: ${JSON.stringify(find.slice(0, 50))})`); return; }
  s = s.split(find).join(replace);
}

/* ---------- T: the shared data config (ROLE / slots / weights) ---------- */
const CONFIG_OLD = `const HOOPER_SLOTS = [
  { key:'threept',    label:'3-Pointer',  part:'Shooting Hand', mask:'hoop-seg-threept.png',    ax:16, ay:50, lx:7,  ly:56 },
  { key:'finishing',  label:'Finishing',  part:'Thighs',        mask:'hoop-seg-finishing.png',  ax:40, ay:61, lx:11, ly:74 },
  { key:'dribble',    label:'Dribble',    part:'Forearms',      mask:'hoop-seg-dribble.png',    ax:27, ay:40, lx:8,  ly:38 },
  { key:'playmaking', label:'Playmaking', part:'Off Hand',      mask:'hoop-seg-playmaking.png', ax:85, ay:55, lx:93, ly:60 },
  { key:'defense',    label:'Defense',    part:'Shoulders',     mask:'hoop-seg-defense.png',    ax:70, ay:25, lx:92, ly:22 },
  { key:'rebounding', label:'Rebounding', part:'Core',          mask:'hoop-seg-rebounding.png', ax:53, ay:46, lx:9,  ly:20 },
  { key:'speed',      label:'Speed',      part:'Legs',          mask:'hoop-seg-speed.png',      ax:80, ay:76, lx:90, ly:82 },
  { key:'clutch',     label:'Clutch',     part:'Head',          mask:'hoop-seg-clutch.png',     ax:58, ay:12, lx:86, ly:8 },
  { key:'frame',      label:'Frame',      part:'Height',        mask:'hoop-seg-frame.png',      ax:54, ay:30, lx:93, ly:40, type:'height' },
];
const WEIGHTS_HOOP = { threept:1.2, finishing:1.2, playmaking:1.2, dribble:1.1, defense:1.1, rebounding:1.1, clutch:1.1, speed:0.9, frame:1.0 };
function heightToRatingHoop(inches){ return inches ? clamp(Math.round(50+(inches-70)*3.6),1,125) : 60; }

const HOOP_CFG = () => ({ data:'ballers.json', figure:'baller-figure.png', slots:HOOPER_SLOTS,
  h2r:heightToRatingHoop, slotWeight:(k,v)=>WEIGHTS_HOOP[k]||1 });
const ROLE = { pitcher: HOOP_CFG(), batter: HOOP_CFG() };`;

const CONFIG_NEW = `// (config block replaced by gen-versus-cfb.js)
// SAME-POSITION MIRROR: both players build the SAME college position (QB/RB/WR), chosen from the
// shared match seed. The pitcher/batter ROLE keys are vestigial A/B side labels · both point at one
// position config so the matchmaking/figure/showdown code needs no changes. (POSITIONS is pasted
// verbatim from college.html so the slots/weights/figures match the single-player CFB game exactly.)
const POSITIONS = {
  qb: {
    key: 'qb', label: 'Quarterback', short: 'QB', figure: 'cfb-qb-figure.png', aspect: '7/5',
    slots: [
      { key: 'shortAcc', label: 'Short Accuracy', part: 'Throwing Hand', mask: 'cfb-qb-seg-shortAcc.png', ax: 30, ay: 20, lx: 7,  ly: 6 },
      { key: 'armPower', label: 'Arm Power',      part: 'Throwing Arm',  mask: 'cfb-qb-seg-armPower.png', ax: 40.8, ay: 29, lx: 8,  ly: 30 },
      { key: 'iq',       label: 'Football IQ',    part: 'Helmet',        mask: 'cfb-qb-seg-iq.png',       ax: 49.1, ay: 15.4, lx: 88, ly: 7 },
      { key: 'poise',    label: 'Poise',          part: 'Chest',         mask: 'cfb-qb-seg-poise.png',    ax: 49.8, ay: 30, lx: 90, ly: 21 },
      { key: 'deepAcc',  label: 'Deep Ball',      part: 'Off Arm',       mask: 'cfb-qb-seg-deepAcc.png',  ax: 58, ay: 26.7, lx: 92, ly: 37 },
      { key: 'midAcc',   label: 'Mid Accuracy',   part: 'Core',          mask: 'cfb-qb-seg-midAcc.png',   ax: 49.8, ay: 45, lx: 10, ly: 48 },
      { key: 'frame',    label: 'Frame',          part: 'Height',        mask: 'cfb-qb-seg-frame.png',    ax: 49.8, ay: 34, lx: 90, ly: 56, type: 'height' },
      { key: 'onRun',    label: 'On the Run',     part: 'Plant Leg',     mask: 'cfb-qb-seg-onRun.png',    ax: 58.7, ay: 62.2, lx: 91, ly: 79 },
      { key: 'wheels',   label: 'Wheels',         part: 'Back Leg',      mask: 'cfb-qb-seg-wheels.png',   ax: 42.2, ay: 63.8, lx: 9,  ly: 81 },
    ],
    weights: { shortAcc: 1.2, midAcc: 1.2, deepAcc: 1.2, armPower: 1.1, poise: 1.1, iq: 1.1, onRun: 1.0, wheels: 1.0, frame: 1.0 },
  },
  rb: {
    key: 'rb', label: 'Running Back', short: 'RB', figure: 'cfb-rb-figure.png', aspect: '7/5',
    slots: [
      { key: 'vision',  label: 'Vision',        part: 'Eyes',       mask: 'cfb-rb-seg-vision.png',  ax: 51.9, ay: 17.5, lx: 85, ly: 5 },
      { key: 'power',   label: 'Power',         part: 'Stiff Arm',  mask: 'cfb-rb-seg-power.png',   ax: 42.4, ay: 29.3, lx: 92, ly: 13 },
      { key: 'breakTk', label: 'Break Tackle',  part: 'Pads',       mask: 'cfb-rb-seg-breakTk.png', ax: 62.3, ay: 28.4, lx: 8,  ly: 9 },
      { key: 'ballSec', label: 'Ball Security', part: 'The Rock',   mask: 'cfb-rb-seg-ballSec.png', ax: 40, ay: 40, lx: 7,  ly: 23 },
      { key: 'hands',   label: 'Catching',      part: 'Soft Hands', mask: 'cfb-rb-seg-hands.png',   ax: 59.4, ay: 44.1, lx: 8,  ly: 44 },
      { key: 'frame',   label: 'Frame',         part: 'Height',     mask: 'cfb-rb-seg-frame.png',   ax: 52.4, ay: 33.4, lx: 90, ly: 40, type: 'height' },
      { key: 'elusive', label: 'Elusiveness',   part: 'Hips',       mask: 'cfb-rb-seg-elusive.png', ax: 49, ay: 50, lx: 9,  ly: 60 },
      { key: 'burst',   label: 'Burst',         part: 'Drive Knee', mask: 'cfb-rb-seg-burst.png',   ax: 55.8, ay: 64.1, lx: 91, ly: 62 },
      { key: 'speed',   label: 'Speed',         part: 'Stride Leg', mask: 'cfb-rb-seg-speed.png',   ax: 45.3, ay: 59.7, lx: 12, ly: 86 },
    ],
    weights: { speed: 1.2, breakTk: 1.2, vision: 1.2, burst: 1.1, elusive: 1.1, power: 1.1, ballSec: 1.0, hands: 1.0, frame: 1.0 },
  },
  wr: {
    key: 'wr', label: 'Wide Receiver', short: 'WR', figure: 'cfb-wr-figure.png', aspect: '7/5',
    slots: [
      { key: 'routes',  label: 'Routes',      part: 'Helmet',         mask: 'cfb-wr-seg-routes.png',  ax: 52.4, ay: 16.4, lx: 10, ly: 9 },
      { key: 'hands',   label: 'Hands',       part: 'Gloves',         mask: 'cfb-wr-seg-hands.png',   ax: 36.7, ay: 54.8, lx: 90, ly: 5 },
      { key: 'spectac', label: 'Spectacular', part: 'Full Extension', mask: 'cfb-wr-seg-spectac.png', ax: 61.2, ay: 28.9, lx: 91, ly: 22 },
      { key: 'release', label: 'Release',     part: 'Shoulders',      mask: 'cfb-wr-seg-release.png', ax: 42.5, ay: 28.5, lx: 9,  ly: 28 },
      { key: 'traffic', label: 'In Traffic',  part: 'Chest',          mask: 'cfb-wr-seg-traffic.png', ax: 51, ay: 40, lx: 8,  ly: 45 },
      { key: 'frame',   label: 'Frame',       part: 'Height',         mask: 'cfb-wr-seg-frame.png',   ax: 51.4, ay: 34.5, lx: 90, ly: 41, type: 'height' },
      { key: 'leap',    label: 'Leaping',     part: 'Hips',           mask: 'cfb-wr-seg-leap.png',    ax: 49, ay: 50, lx: 9,  ly: 59 },
      { key: 'agility', label: 'Agility',     part: 'Lead Leg',       mask: 'cfb-wr-seg-agility.png', ax: 58.2, ay: 59.2, lx: 92, ly: 72 },
      { key: 'speed',   label: 'Speed',       part: 'Trail Leg',      mask: 'cfb-wr-seg-speed.png',   ax: 44.7, ay: 58.9, lx: 10, ly: 85 },
    ],
    weights: { hands: 1.2, speed: 1.2, routes: 1.2, release: 1.1, traffic: 1.1, spectac: 1.1, agility: 1.0, leap: 1.0, frame: 1.0 },
  },
};
function heightToRatingCfb(inches){ if(!inches) return 60; return clamp(Math.round(48+(inches-66)*3.4),1,110); }
function CFB_CFG(posKey){ const P = POSITIONS[posKey];
  return { posKey, data:'cfb.json', figure:P.figure, slots:P.slots,
    h2r:heightToRatingCfb, slotWeight:(k,v)=>P.weights[k]||1 }; }
let ROLE = { pitcher:null, batter:null };
// Picked from the shared match seed so BOTH players land on the same position (no negotiation).
function selectVersusPosition(posKey){ const cfg = CFB_CFG(posKey); ROLE = { pitcher:cfg, batter:cfg }; DATA = {}; _poolCache = {}; }`;
must(CONFIG_OLD, CONFIG_NEW, 1);

/* ---------- T: teams / colors / headshot (NBA → CFB) ---------- */
const TEAMS_OLD = `const TEAM_COLORS = {
  ATL:'#E03A3E', BOS:'#007A33', BKN:'#1D1D1D', CHA:'#00788C', CHI:'#CE1141',
  CLE:'#860038', DAL:'#00538C', DEN:'#0E2240', DET:'#C8102E', GSW:'#1D428A',
  HOU:'#CE1141', IND:'#002D62', LAC:'#C8102E', LAL:'#552583', MEM:'#5D76A9',
  MIA:'#98002E', MIL:'#00471B', MIN:'#0C2340', NOP:'#0C2340', NYK:'#006BB6',
  OKC:'#007AC1', ORL:'#0077C0', PHI:'#006BB6', PHX:'#1D1160', POR:'#E03A3E',
  SAC:'#5A2D81', SAS:'#767A7F', TOR:'#CE1141', UTA:'#002B5C', WAS:'#002B5C', FA:'#5b636e',
};
const TEAM_NAMES = {
  ATL:'Hawks', BOS:'Celtics', BKN:'Nets', CHA:'Hornets', CHI:'Bulls', CLE:'Cavaliers',
  DAL:'Mavericks', DEN:'Nuggets', DET:'Pistons', GSW:'Warriors', HOU:'Rockets', IND:'Pacers',
  LAC:'Clippers', LAL:'Lakers', MEM:'Grizzlies', MIA:'Heat', MIL:'Bucks', MIN:'Timberwolves',
  NOP:'Pelicans', NYK:'Knicks', OKC:'Thunder', ORL:'Magic', PHI:'76ers', PHX:'Suns',
  POR:'Trail Blazers', SAC:'Kings', SAS:'Spurs', TOR:'Raptors', UTA:'Jazz', WAS:'Wizards',
};
const IDLE_JERSEY = '#aeb6c2';
function teamColor(t){ return TEAM_COLORS[t] || IDLE_JERSEY; }`;

const TEAMS_NEW = `let CFB = null;   // full cfb.json { positions, legends, teams } · loaded once by loadData()
const IDLE_JERSEY = '#aeb6c2';
// School colors come baked in cfb.json; anything unmapped gets a stable hash color (like college.html).
const HASH_PALETTE = ['#7a1f1f', '#1f3d7a', '#1f6e3d', '#6e1f7a', '#7a5a1f', '#1f6e6e', '#4a1f7a', '#7a1f4a', '#2d5a1f', '#1f2d5a', '#5a411f', '#0f4d64'];
function hashColor(name){ let h = 0; const str = String(name || '');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return HASH_PALETTE[h % HASH_PALETTE.length]; }
function teamColor(team){ if(!team) return IDLE_JERSEY; const t = CFB && CFB.teams && CFB.teams[team]; return (t && t.color) || hashColor(team); }
function teamLogoUrl(team){ const t = CFB && CFB.teams && CFB.teams[team]; return (t && t.img) || ''; }`;
must(TEAMS_OLD, TEAMS_NEW, 1);

must(
  `function headshot(p){ return p.img || (p.nbaId ? \`https://cdn.nba.com/headshots/nba/latest/260x190/\${p.nbaId}.png\` : SILHOUETTE); }`,
  `function headshot(p){ if(p.img) return p.img; return teamLogoUrl(p.team) || SILHOUETTE; }`, 1);

/* ---------- T: data loader (flat ballers.json → nested cfb.json position slice) ---------- */
must(
`async function loadData(role){
  if (DATA[role]) return DATA[role];
  const res = await fetch(ROLE[role].data);
  DATA[role] = await res.json();
  return DATA[role];
}`,
`async function loadData(role){
  if (DATA[role]) return DATA[role];
  if (!CFB){ CFB = await (await fetch('cfb.json')).json(); }
  const k = ROLE[role].posKey;
  DATA[role] = { pool: CFB.positions[k].pool, prime: CFB.positions[k].prime,
                 legends: (CFB.legends && CFB.legends[k]) || [], eraPrimes: [] };
  return DATA[role];
}`, 1);

/* ---------- T: role-reveal figure mask is now position-dependent (drop the static CSS) ---------- */
must(`  .role-card.pitcher .role-fig { -webkit-mask-image:url(baller-figure.png); mask-image:url(baller-figure.png); }`,
     `  .role-card.pitcher .role-fig { /* mask set per-position in beginRoleReveal */ }`, 1);
must(`  .role-card.batter .role-fig { -webkit-mask-image:url(baller-figure.png); mask-image:url(baller-figure.png); }`,
     `  .role-card.batter .role-fig { /* mask set per-position in beginRoleReveal */ }`, 1);

/* ---------- T: beginRoleReveal — set the figure mask + copy from the chosen position ---------- */
must(
`  $('roleLabel').textContent = "You're up! Build your Hooper!";
  $('roleSub').textContent = myRole === 'pitcher'
    ? 'Build a pitcher to strike them out. Highest Overall wins.'
    : 'Build a hitter to crush it. Highest Overall wins.';`,
`  const _posCfg = ROLE[myRole], _posLabel = (_posCfg && POSITIONS[_posCfg.posKey]) ? POSITIONS[_posCfg.posKey].label : 'Player';
  if (_posCfg) $('roleFig').style.webkitMaskImage = $('roleFig').style.maskImage = 'url(' + _posCfg.figure + ')';
  $('roleLabel').textContent = "You're up! Build your " + _posLabel + "!";
  $('roleSub').textContent = 'Same position, same cards for both of you. Highest Overall wins the matchup.';`, 1);

/* ---------- T: pick the shared position from the seed (before loadData) in both entry points ---------- */
must(
  `matchId=mId; myRole=role; oppRole=role==='pitcher'?'batter':'pitcher'; seed=(sd>>>0); oppId=opp; wasClaimer=!!claimer;`,
  `matchId=mId; myRole=role; oppRole=role==='pitcher'?'batter':'pitcher'; seed=(sd>>>0); oppId=opp; wasClaimer=!!claimer;
  selectVersusPosition(['qb','rb','wr'][(seed>>>0) % 3]);`, 1);
must(
  `  seed = (Math.random() * 0xffffffff) >>> 0;
  rng = mulberry32(seed || 1);
  oppId = 'ghost';`,
  `  seed = (Math.random() * 0xffffffff) >>> 0;
  rng = mulberry32(seed || 1);
  selectVersusPosition(['qb','rb','wr'][(seed>>>0) % 3]);
  oppId = 'ghost';`, 1);

/* ---------- T: hide the basketball court art (keep scoreboard + wait arena + flash) ---------- */
must(`  .hv-court { position:relative;`,
`  #hvCourt .hv-baseline, #hvCourt .hv-mid, #hvCourt .hv-circle, #hvCourt .hv-arc3, #hvCourt .hv-key,
  #hvCourt .hv-hoop, #hvCourt .hv-figwrap, #hvCourt #hvBall, #hvCourt #hvNetFlash { display:none !important; }
  .hv-court { position:relative;`, 1);
soft(`>First to 11<i id="hvPoss">`, `>FINAL<i id="hvPoss">`);

/* ---------- T: the showdown — football scoreboard reveal (winner logic preserved) ---------- */
const PLAY_OLD = `function playAtBat(){
  if(matchResolved) return;
  showScreen('atbatScreen');
  waitingArena=false; stopWaitClock(); $('waitArena').classList.remove('show');
  $('hvOff').classList.remove('dim'); $('hvDef').classList.remove('dim');
  const pitcher = myRole==='pitcher' ? myBuild : oppBuild;   // side A · attacks the RIGHT hoop
  const batter  = myRole==='pitcher' ? oppBuild : myBuild;   // side B · attacks the LEFT hoop
  const abRng = atBatRng(pitcher, batter);
  // winner: higher OVR; tie -> seeded coin (identical on both phones)
  let winnerRole;
  if(batter.ovr>pitcher.ovr)winnerRole='batter';
  else if(pitcher.ovr>batter.ovr)winnerRole='pitcher';
  else winnerRole = abRng()<0.5?'pitcher':'batter';
  const iWon = winnerRole===myRole;
  const script = buildGameScript(pitcher, batter, winnerRole, abRng);`;

const PLAY_NEW = `// Football score line, seeded from the build (identical on both phones). Winner's total is the
// higher; the margin scales with the OVR gap. Pure flavor — the OUTCOME is decided by OVR above.
function cfbGameScript(A, B, winnerRole, rr){
  const gap = Math.abs((A.ovr||0)-(B.ovr||0));
  const winScore = 21 + Math.floor(rr()*21);   // 21-41
  let margin = gap<=1 ? 1+Math.floor(rr()*6) : gap<=3 ? 3+Math.floor(rr()*8)
    : gap<=6 ? 7+Math.floor(rr()*10) : gap<=10 ? 10+Math.floor(rr()*15) : 17+Math.floor(rr()*22);
  const loseScore = Math.max(0, winScore - margin);
  const winnerName = (winnerRole==='pitcher' ? A.name : B.name) || 'The winner';
  const closeness = margin<=3 ? ' in a nail-biter' : margin>=24 ? ' in a rout' : '';
  return { winScore, loseScore, summary: winnerName + ' wins ' + winScore + '–' + loseScore + closeness };
}
function playAtBat(){
  if(matchResolved) return;
  showScreen('atbatScreen');
  waitingArena=false; stopWaitClock(); $('waitArena').classList.remove('show');
  const pitcher = myRole==='pitcher' ? myBuild : oppBuild;   // side A
  const batter  = myRole==='pitcher' ? oppBuild : myBuild;   // side B
  const abRng = atBatRng(pitcher, batter);
  // winner: higher OVR; tie -> seeded coin (identical on both phones)
  let winnerRole;
  if(batter.ovr>pitcher.ovr)winnerRole='batter';
  else if(pitcher.ovr>batter.ovr)winnerRole='pitcher';
  else winnerRole = abRng()<0.5?'pitcher':'batter';
  const iWon = winnerRole===myRole;
  const script = cfbGameScript(pitcher, batter, winnerRole, abRng);

  // NOTE: var names here are deliberately distinct from the dead legacy body below (nmA/colA…) so
  // there is no duplicate-const in this function scope.
  const nmA = escapeHTML(pitcher.name || 'Player A') + (myRole==='pitcher'?' (You)':(isGhost?' \u{1F47B}':''));
  const nmB = escapeHTML(batter.name || 'Player B') + (myRole==='batter'?' (You)':(isGhost?' \u{1F47B}':''));
  const colA = brightTeam(pitcher.team);
  const colB = hvDistinct(colA, brightTeam(batter.team));
  $('matchup').innerHTML =
    '<div class="side"><div class="who" style="color:'+colA+'">\u{1F3C8} '+nmA+'</div><div class="o" style="color:'+colA+'">'+pitcher.ovr+'</div></div>'+
    '<div class="mid">VS</div>'+
    '<div class="side"><div class="who" style="color:'+colB+'">\u{1F3C8} '+nmB+'</div><div class="o" style="color:'+colB+'">'+batter.ovr+'</div></div>';

  const scA = winnerRole==='pitcher' ? script.winScore : script.loseScore;
  const scB = winnerRole==='pitcher' ? script.loseScore : script.winScore;
  $('hvSb').style.display='flex';
  $('hvSA').textContent='0'; $('hvSB').textContent='0';
  $('hvSA').style.color=colA; $('hvSB').style.color=colB;
  $('hvPop').style.opacity=0; $('hvCall').innerHTML='';
  $('hvSkipBtn').style.display='none';
  const cnt = { a:0, b:0 };
  gsap.to(cnt, { a:scA, b:scB, duration:1.7, ease:'power1.inOut',
    onUpdate:()=>{ if(matchResolved) return; $('hvSA').textContent=Math.round(cnt.a); $('hvSB').textContent=Math.round(cnt.b); },
    onComplete:()=>{
      if(matchResolved) return;
      $('hvSA').textContent=scA; $('hvSB').textContent=scB;
      hvFlash('FINAL · '+script.winScore+'–'+script.loseScore, winnerRole==='pitcher'?colA:colB);
      setTimeout(()=>showResult(iWon, pitcher, batter, winnerRole, script), 1400);
    }
  });
  return;
  /* --- legacy basketball possession playback (unused dead code below; skipped by the return) --- */`;
must(PLAY_OLD, PLAY_NEW, 1);
// The original playAtBat body (the possession loop) is now dead code after the early `return;`.
// Close the function cleanly is unnecessary — the old body already ends with its own `}`; the early
// return simply skips it. Verified by node -c on the extracted script below.

/* ---------- T: sport / endpoint / channel strings ---------- */
must(`const LIVE_GAME = 'hoops';`, `const LIVE_GAME = 'cfb';`, 1);
must(`/api/match-hoops`, `/api/match-cfb`, 4);
must(`'hoops:`, `'cfb:`, 8);                       // Ably channel prefixes (challenge/meet/invite/match)
must(`sport:'hoops'`, `sport:'cfb'`, 2);           // pvpStats + pvpResult
must(`game: 'baller', role: 'hooper'`, `game: 'cfb', role: 'cfb'`, 1);   // pvpLock
must(`role: 'hooper'`, `role: 'cfb'`, 1);          // pendingResult (the pvpLock one already swapped)
must(`action=ghost&game=baller&min=87&max=95`, `action=ghost&game=cfb&min=80&max=99`, 1);
must(`if (!b || b.game !== 'baller'){`, `if (!b || b.game !== 'cfb'){`, 1);   // ?gb= build challenge guard
must(`/versus-hoops`, `/versus-cfb`, 4);            // challenge-share links + dev-harness comments
must(`let statsView = 'hoops';`, `let statsView = 'cfb';`, 1);
soft(`statsView==='hoops'?'🏀 Hoops':'⚾ Baseball'`, `'🏈 College FB'`);
soft(`game: 'versus_hoops'`, `game: 'versus_cfb'`);          // gtag events (all)

/* ---------- T: stats-screen sport tabs → single CFB tab ---------- */
soft(`        <button class="stab active" data-sport="hoops">🏀 Hoops</button>
        <button class="stab" data-sport="baseball">⚾ Baseball</button>`,
     `        <button class="stab active" data-sport="cfb">🏈 College FB</button>`);

/* ---------- T: copy / title / brand ---------- */
soft(`<title>Hoops Face Off · GoatLab 1v1</title>`, `<title>College Football Face Off · GoatLab 1v1</title>`);
soft(`Build your hooper fast - highest Overall wins the 1-on-1.`,
     `Build your QB, RB or WR fast - highest Overall wins the 1-on-1.`);
soft(`🏀 Hoops <i>Face Off</i>`, `🏈 College Football <i>Face Off</i>`);
soft(`🏀 Hoops · Live 1v1`, `🏈 College FB · Live 1v1`);
soft(`<h1>Hoops <i>Face Off</i></h1>`, `<h1>College Football <i>Face Off</i></h1>`);

/* ---------- T: neuter the basketball pose-mask warm-loop (football has no pose masks) ---------- */
soft(`// warm the pose masks so the first possession doesn't flicker on slow connections
(function(){ ['drive1','drive2','drive3','drive4','dribble1','dribble2','dribble3','lowdribble1',
  'lowdribble2','cross1','cross2','shoot1','shoot2','three1','dunk1','def1','def2','idle1','hoop']
  .forEach(n=>{ const i=new Image(); i.src='hoops-anim/'+n+'.png'; }); })();`,
`// (basketball pose-mask warm-loop removed for CFB — the football reveal uses no pose art)`);

/* ---------- T: drop the two hidden basketball hoop <img> so they don't 404 on load ---------- */
soft(`      <img class="hv-hoop l" src="hoops-anim/hoop.png" alt="">
      <img class="hv-hoop r" src="hoops-anim/hoop.png" alt="">`, ``);

fs.writeFileSync(OUT, s);
console.log(`Wrote ${OUT} (${s.length} bytes, ${step} required transforms applied).`);
