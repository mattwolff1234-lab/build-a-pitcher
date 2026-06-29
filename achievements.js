/* ============================================================================
   GoatLab — shared Achievements engine.
   Included by pitcher.html and versus.html. Exposes window.Ach.
   - State persists in localStorage 'pl_achievements' (shared across both games).
   - Ach.unlock(id) fires the toast + chime and lights the tile. Safe to call
     repeatedly; only the first call per id does anything.
   - Ach.open() shows the Minecraft-style advancements board.
   - Each game wires its own hook points (see pitcher.html / versus.html).
   ========================================================================== */
(function () {
  'use strict';

  // ---- achievement definitions (col/row drive the tree layout per category) ----
  const ACHIEVEMENTS = [
    // ---- Draft ----
    { id: 'draft_root', cat: 'draft', icon: '🛠️', name: 'Welcome to the Lab', desc: 'Finish your first build.', col: 0, row: 2 },
    { id: 'first_overall', cat: 'draft', icon: '1️⃣', name: 'First Overall', desc: 'Get drafted first overall in your career.', col: 1, row: 0, parent: 'draft_root' },
    { id: 'builder1', cat: 'draft', icon: '🏗️', name: 'Master Builder I', desc: 'Build a pitcher with a 90+ weighted OVR.', col: 1, row: 1, parent: 'draft_root' },
    { id: 'builder2', cat: 'draft', icon: '🏗️', name: 'Master Builder II', desc: 'Build a 95+ weighted OVR.', col: 2, row: 1, parent: 'builder1' },
    { id: 'the_goat', cat: 'draft', icon: '🐐', name: 'The G.O.A.T.', desc: 'Build a perfect 99 OVR.', col: 3, row: 1, parent: 'builder2', chal: true },
    { id: 'beyond', cat: 'draft', icon: '🌌', name: 'Beyond Perfect', desc: 'Build a pitcher rated over 99 OVR.', col: 4, row: 1, parent: 'the_goat', chal: true },
    { id: 'offcharts', cat: 'draft', icon: '📈', name: 'Off the Charts', desc: 'Place a 125+ rated attribute on your build.', col: 1, row: 2, parent: 'draft_root' },
    { id: 'heist', cat: 'draft', icon: '🦝', name: 'The Heist', desc: 'Snag a neighbor, then Boost that same card.', col: 1, row: 3, parent: 'draft_root' },
    { id: 'triple1', cat: 'draft', icon: '🎰', name: 'Triple Threat I', desc: 'Use all 3 power-ups in one build.', col: 1, row: 4, parent: 'draft_root' },
    { id: 'triple2', cat: 'draft', icon: '🎲', name: 'Triple Threat II', desc: 'Use all 3 power-ups in a single turn.', col: 2, row: 4, parent: 'triple1' },
    { id: 'bargain', cat: 'draft', icon: '🪙', name: 'Bargain Bin', desc: 'Finish a build under 60 OVR.', col: 1, row: 5, parent: 'draft_root' },
    // ---- Career ----
    { id: 'sim_root', cat: 'career', icon: '⚾', name: 'Cup of Coffee', desc: 'Simulate a full career.', col: 0, row: 8 },
    { id: 'k1', cat: 'career', icon: '🔥', name: 'Strikeout Artist I', desc: '1,000 career strikeouts.', col: 1, row: 5, parent: 'sim_root' },
    { id: 'k2', cat: 'career', icon: '🔥', name: 'Strikeout Artist II', desc: '3,000 career strikeouts.', col: 2, row: 5, parent: 'k1' },
    { id: 'k3', cat: 'career', icon: '☄️', name: 'Strikeout Artist III', desc: '5,000 career strikeouts.', col: 3, row: 5, parent: 'k2', chal: true },
    { id: 'w1', cat: 'career', icon: '🐴', name: 'Workhorse I', desc: '100 career wins.', col: 1, row: 7, parent: 'sim_root' },
    { id: 'w2', cat: 'career', icon: '🐴', name: 'Workhorse II', desc: '200 career wins.', col: 2, row: 7, parent: 'w1' },
    { id: 'w3', cat: 'career', icon: '🐴', name: 'Workhorse III', desc: '300 career wins.', col: 3, row: 7, parent: 'w2', chal: true },
    { id: 'hopg', cat: 'career', icon: '👍', name: 'Hall of Pretty Good', desc: 'Retire into the Hall of Pretty Good tier.', col: 1, row: 9, parent: 'sim_root' },
    { id: 'cooperstown', cat: 'career', icon: '🏆', name: 'First Ballot', desc: 'Earn Hall of Fame induction.', col: 2, row: 9, parent: 'hopg' },
    { id: 'unanimous', cat: 'career', icon: '💯', name: 'Unanimous', desc: 'Get inducted with a 99%+ vote.', col: 3, row: 9, parent: 'cooperstown', chal: true },
    { id: 'ring1', cat: 'career', icon: '💍', name: 'Ring Bearer', desc: 'Win a World Series.', col: 1, row: 11, parent: 'sim_root' },
    { id: 'ring2', cat: 'career', icon: '💍', name: 'Dynasty', desc: 'Win 3 World Series rings.', col: 2, row: 11, parent: 'ring1' },
    { id: 'ring3', cat: 'career', icon: '👑', name: 'Dynasty II', desc: 'Win 5 World Series rings.', col: 3, row: 11, parent: 'ring2', chal: true },
    // ---- 1v1 ----
    { id: 'versus_root', cat: 'versus', icon: '⚔️', name: 'Step in the Ring', desc: 'Play a 1v1 Face Off match.', col: 0, row: 15 },
    { id: 'streak1', cat: 'versus', icon: '📈', name: 'On a Heater I', desc: 'Win 3 matches in a row.', col: 1, row: 13, parent: 'versus_root' },
    { id: 'streak2', cat: 'versus', icon: '📈', name: 'On a Heater II', desc: 'Win 5 matches in a row.', col: 2, row: 13, parent: 'streak1' },
    { id: 'streak3', cat: 'versus', icon: '🌋', name: 'On a Heater III', desc: 'Win 10 matches in a row.', col: 3, row: 13, parent: 'streak2', chal: true },
    { id: 'elo1', cat: 'versus', icon: '🥉', name: 'Contender I', desc: 'Climb past 1200 Elo.', col: 1, row: 15, parent: 'versus_root' },
    { id: 'elo2', cat: 'versus', icon: '🥈', name: 'Contender II', desc: 'Climb past 1400 Elo.', col: 2, row: 15, parent: 'elo1' },
    { id: 'elo3', cat: 'versus', icon: '🥇', name: 'Contender III', desc: 'Climb past 1600 Elo.', col: 3, row: 15, parent: 'elo2', chal: true },
    { id: 'mismatch1', cat: 'versus', icon: '💪', name: 'Mismatch I', desc: 'Win a 1v1 by 10+ Overall.', col: 1, row: 16, parent: 'versus_root' },
    { id: 'mismatch2', cat: 'versus', icon: '💪', name: 'Mismatch II', desc: 'Win a 1v1 by 15+ Overall.', col: 2, row: 16, parent: 'mismatch1' },
    { id: 'mismatch3', cat: 'versus', icon: '💥', name: 'Mismatch III', desc: 'Win a 1v1 by 20+ Overall.', col: 3, row: 16, parent: 'mismatch2', chal: true },
    { id: 'underdog', cat: 'versus', icon: '🐶', name: 'Underdog', desc: 'Win despite a lower build OVR.', col: 1, row: 17, parent: 'versus_root' },
    // ---- Daily (feature not live yet; tiles show as locked) ----
    { id: 'daily_root', cat: 'daily', icon: '📅', name: 'Show Up', desc: 'Play a Daily Challenge.', col: 0, row: 19 },
    { id: 'grind1', cat: 'daily', icon: '🎯', name: 'Daily Grind I', desc: 'Complete 7 daily challenges.', col: 1, row: 18, parent: 'daily_root' },
    { id: 'grind2', cat: 'daily', icon: '🎯', name: 'Daily Grind II', desc: 'Complete 30 daily challenges.', col: 2, row: 18, parent: 'grind1' },
    { id: 'grind3', cat: 'daily', icon: '🏆', name: 'Daily Grind III', desc: 'Complete 100 daily challenges.', col: 3, row: 18, parent: 'grind2', chal: true },
    { id: 'shiny', cat: 'daily', icon: '✨', name: 'Shiny Hunter', desc: 'Land a shiny player. (Coming soon!)', col: 1, row: 19, parent: 'daily_root', future: true },
    { id: 'completionist', cat: 'daily', icon: '🏅', name: 'Completionist', desc: 'Unlock every other achievement.', col: 1, row: 20, parent: 'daily_root', chal: true },
    // ---- Fun ----
    { id: 'short_king', cat: 'fun', icon: '👑', name: 'Short King', desc: 'Use a 5\'11" or shorter pitcher for your Frame.', col: 0, row: 22 },
    { id: 'tall_tale', cat: 'fun', icon: '🦒', name: 'Tall Tale', desc: 'Use a 6\'9" or taller pitcher for your Frame.', col: 1, row: 22 },
    { id: 'hall_not_good', cat: 'fun', icon: '🗑️', name: 'Hall of Not Good', desc: 'Retire into the lowest verdict tier. Hey, you tried.', col: 0, row: 23 },
    { id: 'glass_cannon', cat: 'fun', icon: '🎆', name: 'Glass Cannon', desc: '95+ Strikeout with bottom-tier Stamina.', col: 1, row: 23 },
    { id: 'one_team', cat: 'fun', icon: '🧬', name: 'Loyalty Program', desc: 'Fill all 9 slots with players from one team.', col: 0, row: 24 },
    { id: 'nepo', cat: 'fun', icon: '🤷', name: 'Wrong Number', desc: 'Put a 99-rated card in your lowest-weighted slot.', col: 1, row: 24 },
  ];
  const CATS = [
    { id: 'all', icon: '🏟️', label: 'All' },
    { id: 'draft', icon: '🛠️', label: 'Draft' },
    { id: 'career', icon: '⚾', label: 'Career' },
    { id: 'versus', icon: '⚔️', label: '1v1' },
    { id: 'daily', icon: '📅', label: 'Daily' },
    { id: 'fun', icon: '😜', label: 'Fun' },
  ];
  const HEADSHOT_IDS = [669373, 808967, 547973, 676979, 554430, 695243, 694973, 605483, 693433, 650911, 621242, 668881, 592332, 669302, 543135, 601713, 678495, 669432, 662253, 693645, 686613, 694819, 657746, 608331, 671922, 670280, 656876, 656546];
  const hsUrl = id => `https://midfield.mlbstatic.com/v1/people/${id}/spots/180`;
  const byId = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));
  // completionist counts every non-meta, non-future achievement
  const META_IDS = ['completionist', 'shiny'];

  // ---- persistent state ----
  // Local cache. ACH_VER bumps wipe any pre-launch local data so everyone starts fresh; the
  // signed-in account (below) is the source of truth and follows the user's email across devices.
  const ACH_VER = '2026-06-29c';
  let done = {};
  try {
    if (localStorage.getItem('pl_ach_ver') === ACH_VER) done = JSON.parse(localStorage.getItem('pl_achievements') || '{}');
    else {
      localStorage.setItem('pl_ach_ver', ACH_VER);
      localStorage.removeItem('pl_achievements');
      localStorage.setItem('pl_ach_rst', ACH_VER); // also wipe the account copy on next sync
      done = {};
    }
  } catch (e) { done = {}; }
  const save = () => { try { localStorage.setItem('pl_achievements', JSON.stringify(done)); } catch (e) {} };

  // ---- account sync (linked to the Google account / email via api/account.js) ----
  function acct() { try { return JSON.parse(localStorage.getItem('pl_account') || 'null'); } catch (e) { return null; } }
  let syncTimer = null;
  async function serverSync() {
    const a = acct();
    if (!a || !a.sub || !a.sessionToken) return;
    let owner = null, resetting = false;
    try { owner = localStorage.getItem('pl_ach_owner'); resetting = localStorage.getItem('pl_ach_rst') === ACH_VER; } catch (e) {}
    // If the local cache already belongs to this account, push its unlocks up (covers offline play).
    // Otherwise it's guest progress (or a different account) — adopt this account's set and discard
    // the local data, so achievements stay tied to whoever is signed in with Google.
    const sameOwner = owner === a.sub;
    const payload = (sameOwner || resetting) ? done : {};
    try {
      const r = await fetch('/api/account', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'achSync', sub: a.sub, sessionToken: a.sessionToken, achievements: payload, reset: resetting }),
      }).then(x => x.json());
      if (r && r.ok && r.achievements) {
        try { if (resetting) localStorage.removeItem('pl_ach_rst'); localStorage.setItem('pl_ach_owner', a.sub); } catch (e) {}
        done = r.achievements; save(); refreshBadges();
        if (chromeReady && built && ov && ov.classList.contains('show')) render();
      }
    } catch (e) {}
  }
  function queueSync() { clearTimeout(syncTimer); syncTimer = setTimeout(serverSync, 400); }
  // Called on sign-out: a guest should not inherit the previous account's board.
  function signOut() {
    done = {};
    try { localStorage.removeItem('pl_achievements'); localStorage.removeItem('pl_ach_owner'); } catch (e) {}
    refreshBadges();
    if (chromeReady && built && ov && ov.classList.contains('show')) render();
  }

  // ---- styles (injected so this file is fully drop-in) ----
  const css = `
  .ach-ov{ position:fixed; inset:0; z-index:300; display:none; align-items:center; justify-content:center; padding:14px;
    background:rgba(2,5,10,.72); backdrop-filter:blur(3px); }
  .ach-ov.show{ display:flex; }
  .ach-card{ position:relative; width:100%; max-width:780px; max-height:90dvh; display:flex; flex-direction:column;
    border:1px solid var(--line,rgba(120,150,190,.16)); border-radius:16px;
    background:linear-gradient(180deg, rgba(20,31,48,.78), rgba(9,15,25,.92)); backdrop-filter:blur(6px);
    box-shadow:0 18px 60px rgba(0,0,0,.6); overflow:hidden; }
  .ach-head{ display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid var(--line,rgba(120,150,190,.16)); }
  .ach-head .at{ font-family:'Oswald',sans-serif; font-size:16px; letter-spacing:2px; text-transform:uppercase; }
  .ach-head .at b{ color:var(--accent,#ff7a18); }
  .ach-head .ap{ font-family:'Oswald',sans-serif; font-size:12px; color:var(--muted,#7e8da3); letter-spacing:1px; }
  .ach-head .ap b{ color:var(--gold,#ffce3a); font-size:15px; }
  .ach-x{ margin-left:auto; font-size:16px; line-height:1; padding:6px 11px; border-radius:8px; color:var(--ink,#eaf2fb);
    background:rgba(255,255,255,.04); border:1px solid var(--line,rgba(120,150,190,.16)); cursor:pointer; }
  .ach-x:hover{ border-color:var(--accent,#ff7a18); }
  .ach-tabs{ display:flex; gap:5px; padding:10px 14px 0; flex-wrap:wrap; }
  .ach-tab{ display:flex; align-items:center; gap:6px; padding:8px 12px; border:1px solid var(--line,rgba(120,150,190,.16)); border-bottom:none;
    border-radius:10px 10px 0 0; background:rgba(16,32,46,.5); cursor:pointer;
    font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--muted,#7e8da3); }
  .ach-tab .tc{ font-size:10px; color:var(--gold,#ffce3a); }
  .ach-tab.active{ color:var(--ink,#eaf2fb); border-color:var(--accent2,#19c6ff); background:rgba(25,198,255,.1); }
  .ach-wrap{ position:relative; margin:0 14px 14px; border:1px solid var(--line,rgba(120,150,190,.16)); border-radius:0 12px 12px 12px;
    overflow:auto; -webkit-overflow-scrolling:touch; touch-action:pan-x pan-y; overscroll-behavior:contain; flex:1; min-height:0;
    background:linear-gradient(180deg, rgba(9,15,25,.7), rgba(4,7,13,.85)); }
  .ach-canvas{ position:relative; overflow:hidden; }
  .ach-zoom{ position:absolute; right:12px; bottom:12px; z-index:20; display:flex; flex-direction:column; gap:6px; }
  .ach-zoom button{ width:40px; height:40px; font-size:18px; line-height:1; color:var(--ink,#eaf2fb); cursor:pointer;
    border:1px solid var(--accent2,#19c6ff); border-radius:10px; background:rgba(16,32,46,.92); backdrop-filter:blur(4px);
    box-shadow:0 6px 18px rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; }
  .ach-zoom button:active{ transform:scale(.92); }
  .ach-hs{ position:absolute; width:80px; height:80px; border-radius:8px; object-fit:cover; opacity:.05; filter:grayscale(1) contrast(.8); pointer-events:none; }
  .ach-vig{ position:absolute; inset:0; pointer-events:none; background:radial-gradient(120% 100% at 50% 40%, transparent 55%, rgba(4,7,13,.7) 100%); }
  .ach-links{ position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:1; }
  .ach-link{ fill:none; stroke:rgba(126,141,163,.35); stroke-width:3; }
  .ach-link.lit{ stroke:rgba(255,206,58,.55); }
  .ach-node{ position:absolute; width:var(--asz,80px); height:var(--asz,80px); z-index:2; cursor:pointer; display:flex; align-items:center; justify-content:center;
    border:2px solid #2c3447; border-radius:12px; background:linear-gradient(180deg, rgba(28,38,56,.95), rgba(10,16,26,.95));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 6px 18px rgba(0,0,0,.5); transition:box-shadow .25s, border-color .25s; }
  .ach-node .ai{ font-size:calc(var(--asz,80px)*.4); line-height:1; filter:grayscale(1) brightness(.5); transition:filter .35s; }
  .ach-node:hover{ transform:translateY(-2px) scale(1.05); z-index:9; }
  .ach-node.chal::before{ content:''; position:absolute; inset:-5px; border-radius:15px; z-index:-1;
    background:conic-gradient(from 0deg, #5a4a12, #2c3447, #5a4a12, #2c3447, #5a4a12); opacity:.55; }
  .ach-node.done{ border-color:var(--gold,#ffce3a); background:linear-gradient(180deg, rgba(255,206,58,.14), rgba(10,16,26,.92));
    box-shadow:0 0 22px rgba(255,206,58,.28), inset 0 1px 0 rgba(255,255,255,.08); }
  .ach-node.done .ai{ filter:none; }
  .ach-node.chal.done{ border-color:var(--legend,#a366ff); box-shadow:0 0 26px rgba(163,102,255,.4); }
  .ach-node.chal.done::before{ background:conic-gradient(from 0deg, var(--legend,#a366ff), var(--gold,#ffce3a), var(--legend,#a366ff), var(--gold,#ffce3a)); opacity:.9; }
  .ach-node.future{ border-style:dashed; }
  .ach-node .alk{ position:absolute; right:-6px; bottom:-6px; font-size:12px; opacity:.85; }
  .ach-node.just{ animation:achPop .6s ease; }
  @keyframes achPop{ 0%{transform:scale(1);} 35%{transform:scale(1.18);} 100%{transform:scale(1.05);} }
  .ach-tip{ position:fixed; z-index:330; display:none; max-width:240px; padding:11px 13px; pointer-events:none;
    border:1px solid rgba(163,102,255,.5); border-radius:10px;
    background:linear-gradient(180deg, rgba(16,12,28,.97), rgba(8,6,16,.98)); box-shadow:0 12px 36px rgba(0,0,0,.6); }
  .ach-tip .tn{ font-family:'Oswald',sans-serif; font-weight:700; font-size:15px; letter-spacing:.5px; color:var(--muted,#7e8da3); }
  .ach-tip.unlocked .tn{ color:var(--gold,#ffce3a); }
  .ach-tip.chalk .tn{ color:var(--legend,#a366ff); }
  .ach-tip .td{ font-size:12px; color:var(--muted,#7e8da3); margin-top:5px; line-height:1.45; }
  .ach-tip .ts{ font-size:11px; margin-top:7px; letter-spacing:.5px; text-transform:uppercase; font-family:'Oswald',sans-serif; color:var(--dim,#56627a); }
  .ach-tip.unlocked .ts{ color:var(--gold,#ffce3a); }
  .ach-toast{ position:fixed; top:18px; right:18px; z-index:340; display:none; align-items:center; gap:13px;
    padding:13px 18px 13px 14px; min-width:290px; border-radius:13px; border:1px solid rgba(255,206,58,.35);
    background:linear-gradient(180deg, rgba(20,31,48,.94), rgba(9,15,25,.96)); backdrop-filter:blur(6px);
    box-shadow:0 14px 44px rgba(0,0,0,.55), 0 0 26px rgba(255,206,58,.14); }
  .ach-toast::before,.ach-toast::after{ content:''; position:absolute; width:12px; height:12px; opacity:.8; }
  .ach-toast::before{ top:6px; left:6px; border-top:2px solid var(--accent2,#19c6ff); border-left:2px solid var(--accent2,#19c6ff); }
  .ach-toast::after{ bottom:6px; right:6px; border-bottom:2px solid var(--accent2,#19c6ff); border-right:2px solid var(--accent2,#19c6ff); }
  .ach-toast .ti{ font-size:32px; }
  .ach-toast .tl{ font-family:'Oswald',sans-serif; font-size:11px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:var(--gold,#ffce3a); }
  .ach-toast .tb{ min-width:0; }
  .ach-toast .tnm{ font-family:'Oswald',sans-serif; font-size:18px; font-weight:700; letter-spacing:.5px; margin-top:1px; color:var(--ink,#eaf2fb); }
  .ach-toast .tds{ font-size:11px; color:var(--muted,#7e8da3); margin-top:3px; line-height:1.35; max-width:230px; }
  .ach-toast .tds:empty{ display:none; }
  body.ach-open{ overflow:hidden; }
  @media (max-width:680px){
    /* full-page on mobile so it scrolls in isolation (no scroll-behind) and nothing is cut off */
    .ach-ov{ padding:0; align-items:stretch; justify-content:stretch; }
    .ach-card{ max-width:none; width:100%; height:100dvh; max-height:100dvh; border-radius:0; border:none; }
    .ach-head{ padding:12px 14px; }
    .ach-head .at{ font-size:14px; }
    .ach-tabs{ flex-wrap:nowrap; overflow-x:auto; padding:8px 10px 0; }
    .ach-tab{ flex:0 0 auto; }
    .ach-tab .tc{ display:none; }
    .ach-wrap{ margin:0 8px 8px; }
    .ach-zoom button{ width:46px; height:46px; font-size:20px; }
    .ach-toast{ left:10px; right:10px; min-width:0; top:12px; }
  }`;

  // ---- layout (zoom-driven: effective sizes = base × zoom, re-laid-out on zoom change) ----
  const BASE = { CW: 160, CH: 92, X0: 40, Y0: 30, SZ: 80 };
  let CW, CH, X0, Y0, SZ;
  const isMobile = () => window.matchMedia && window.matchMedia('(max-width:680px)').matches;
  let zoom = isMobile() ? 0.62 : 1;
  const ZMIN = 0.4, ZMAX = 1.8;
  function applyZoom() { CW = BASE.CW * zoom; CH = BASE.CH * zoom; X0 = BASE.X0 * zoom; Y0 = BASE.Y0 * zoom; SZ = BASE.SZ * zoom; }
  applyZoom();
  let ACTIVE = 'all', built = false;
  let ov, canvas, svg, tabsEl, tip, toast, progEl, wrap;

  let chromeReady = false;
  function ensureChrome() {
    if (chromeReady) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    tip = document.createElement('div'); tip.className = 'ach-tip';
    tip.innerHTML = '<div class="tn"></div><div class="td"></div><div class="ts"></div>';
    document.body.appendChild(tip);
    toast = document.createElement('div'); toast.className = 'ach-toast';
    toast.innerHTML = '<span class="ti"></span><div class="tb"><div class="tl">Achievement Unlocked</div><div class="tnm"></div><div class="tds"></div></div>';
    document.body.appendChild(toast);
    chromeReady = true;
  }

  function buildDom() {
    ensureChrome();
    ov = document.createElement('div'); ov.className = 'ach-ov';
    ov.innerHTML = `
      <div class="ach-card">
        <div class="ach-head">
          <span class="at">🏅 <b>Trophy</b> Room</span>
          <span class="ap"><b class="ach-pn">0</b> / ${ACHIEVEMENTS.length} Unlocked</span>
          <button class="ach-x" aria-label="Close">✕</button>
        </div>
        <div class="ach-tabs"></div>
        <div class="ach-wrap"><div class="ach-canvas"><svg class="ach-links"></svg><div class="ach-vig"></div></div></div>
      </div>`;
    document.body.appendChild(ov);

    canvas = ov.querySelector('.ach-canvas');
    svg = ov.querySelector('.ach-links');
    tabsEl = ov.querySelector('.ach-tabs');
    progEl = ov.querySelector('.ach-pn');
    ov.querySelector('.ach-x').onclick = close;
    ov.onclick = e => { if (e.target === ov) close(); };

    svg.innerHTML = `<defs>
      <marker id="achArr" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="rgba(126,141,163,.55)"/></marker>
      <marker id="achArrL" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="rgba(255,206,58,.7)"/></marker>
    </defs>`;

    // background headshots on a jittered grid (no overlap)
    let n = 0;
    for (let gy = 0; gy < 2900; gy += 200) {
      for (let gx = 0; gx < 940; gx += 165) {
        const img = document.createElement('img');
        img.className = 'ach-hs'; img.loading = 'lazy'; img.src = hsUrl(HEADSHOT_IDS[n++ % HEADSHOT_IDS.length]);
        img.style.left = (gx + 16 + (Math.random() * 36 - 18)) + 'px';
        img.style.top = (gy + 16 + (Math.random() * 36 - 18)) + 'px';
        img.style.transform = 'rotate(' + (Math.random() * 14 - 7) + 'deg)';
        img.onerror = function () { this.remove(); };
        canvas.appendChild(img);
      }
    }

    // zoom controls (magnifying glass) — pinned to the card corner, don't scroll away
    wrap = ov.querySelector('.ach-wrap');
    const zc = document.createElement('div'); zc.className = 'ach-zoom';
    zc.innerHTML = '<button data-z="in" aria-label="Zoom in">🔍+</button><button data-z="out" aria-label="Zoom out">🔍−</button>';
    ov.querySelector('.ach-card').appendChild(zc);
    zc.querySelector('[data-z="in"]').onclick = () => setZoom(zoom * 1.25);
    zc.querySelector('[data-z="out"]').onclick = () => setZoom(zoom / 1.25);

    // pinch-to-zoom on the scroll area
    let pinchPrev = 0;
    const tdist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    wrap.addEventListener('touchstart', e => { if (e.touches.length === 2) pinchPrev = tdist(e.touches); }, { passive: true });
    wrap.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && pinchPrev) { e.preventDefault(); const d = tdist(e.touches); if (d) { setZoom(zoom * d / pinchPrev); pinchPrev = d; } }
    }, { passive: false });
    wrap.addEventListener('touchend', e => { if (e.touches.length < 2) pinchPrev = 0; });

    built = true;
  }

  let rafPending = false;
  function scheduleRender() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; render(); }); }
  function setZoom(z) { zoom = Math.max(ZMIN, Math.min(ZMAX, z)); scheduleRender(); }

  let rowMap = {};
  const px = a => ({ x: X0 + a.col * CW, y: Y0 + (rowMap[a.id] || 0) * CH });
  const visible = a => ACTIVE === 'all' || a.cat === ACTIVE;
  // Lay categories out in non-overlapping vertical bands so the "All" view never stacks two
  // categories' tiles on the same coordinate (e.g. Bargain Bin under Strikeout Artist I).
  function buildRowMap(vis) {
    rowMap = {};
    if (ACTIVE === 'all') {
      let y = 0;
      for (const c of CATS) {
        if (c.id === 'all') continue;
        const rows = ACHIEVEMENTS.filter(a => a.cat === c.id).map(a => a.row);
        if (!rows.length) continue;
        const mn = Math.min(...rows), mx = Math.max(...rows);
        ACHIEVEMENTS.forEach(a => { if (a.cat === c.id) rowMap[a.id] = y + (a.row - mn); });
        y += (mx - mn + 1) + 1; // one empty row of breathing space between categories
      }
    } else {
      const mn = Math.min(...vis.map(a => a.row));
      vis.forEach(a => { rowMap[a.id] = a.row - mn; });
    }
  }
  const isDone = id => !!done[id];

  function renderTabs() {
    tabsEl.innerHTML = CATS.map(c => {
      const set = c.id === 'all' ? ACHIEVEMENTS : ACHIEVEMENTS.filter(a => a.cat === c.id);
      const d = set.filter(a => isDone(a.id)).length;
      return `<div class="ach-tab${ACTIVE === c.id ? ' active' : ''}" data-cat="${c.id}"><span>${c.icon}</span>${c.label} <span class="tc">${d}/${set.length}</span></div>`;
    }).join('');
    tabsEl.querySelectorAll('.ach-tab').forEach(t => t.onclick = () => { ACTIVE = t.dataset.cat; render(); });
  }

  function drawLinks() {
    svg.querySelectorAll('polyline').forEach(e => e.remove());
    for (const a of ACHIEVEMENTS) {
      if (!a.parent || !visible(a)) continue;
      const p = px(byId[a.parent]), c = px(a);
      const x1 = p.x + SZ, y1 = p.y + SZ / 2, x2 = c.x - 7, y2 = c.y + SZ / 2, mx = x1 + (x2 - x1) / 2;
      const lit = isDone(a.id) && isDone(a.parent);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      path.setAttribute('points', `${x1},${y1} ${mx},${y1} ${mx},${y2} ${x2},${y2}`);
      path.setAttribute('class', 'ach-link' + (lit ? ' lit' : ''));
      path.setAttribute('marker-end', lit ? 'url(#achArrL)' : 'url(#achArr)');
      svg.appendChild(path);
    }
  }

  function render() {
    applyZoom();
    renderTabs();
    const vis = ACHIEVEMENTS.filter(visible);
    buildRowMap(vis);
    const maxRow = Math.max(...vis.map(a => rowMap[a.id])), maxCol = Math.max(...vis.map(a => a.col));
    canvas.style.height = (Y0 * 2 + (maxRow + 1) * CH) + 'px';
    canvas.style.width = (X0 * 2 + (maxCol + 1) * CW) + 'px';
    canvas.querySelectorAll('.ach-node').forEach(e => e.remove());
    for (const a of vis) {
      const p = px(a);
      const el = document.createElement('div');
      el.className = 'ach-node' + (isDone(a.id) ? ' done' : '') + (a.chal ? ' chal' : '') + (a.future ? ' future' : '');
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.setProperty('--asz', SZ + 'px'); el.dataset.id = a.id;
      el.innerHTML = `<span class="ai">${a.icon}</span>${isDone(a.id) ? '' : `<span class="alk">${a.future ? '✨' : '🔒'}</span>`}`;
      el.addEventListener('mousemove', e => showTip(e, a));
      el.addEventListener('mouseleave', () => { if (!('ontouchstart' in window)) hideTip(); });
      el.addEventListener('click', e => { e.stopPropagation(); showTipAt(a, el); });
      canvas.appendChild(el);
    }
    drawLinks();
    progEl.textContent = ACHIEVEMENTS.filter(a => isDone(a.id)).length;
  }

  function fillTip(a) {
    tip.className = 'ach-tip ' + (isDone(a.id) ? (a.chal ? 'chalk' : 'unlocked') : 'locked');
    tip.querySelector('.tn').textContent = a.future && !isDone(a.id) ? a.name + ' — ???' : a.name;
    tip.querySelector('.td').textContent = a.desc;
    tip.querySelector('.ts').textContent = isDone(a.id) ? '✓ Unlocked' : (a.future ? 'Coming soon' : 'Locked');
    tip.style.display = 'block';
  }
  function showTip(e, a) {
    fillTip(a);
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + 240 > innerWidth) x = e.clientX - 256;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function showTipAt(a, el) {
    fillTip(a);
    const r = el.getBoundingClientRect(), w = Math.min(240, innerWidth - 20), h = tip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2; x = Math.max(10, Math.min(x, innerWidth - w - 10));
    let y = r.top - h - 12; if (y < 10) y = r.bottom + 12;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }

  // ---- sound: synthesized chime, respects Ach.muted ----
  let actx;
  function chime(big) {
    if (Ach.muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;
      const notes = big ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        const t = now + i * 0.08;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.2, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.5);
      });
      const o2 = actx.createOscillator(), g2 = actx.createGain();
      o2.type = 'sine'; o2.frequency.setValueAtTime(1568, now + 0.3);
      g2.gain.setValueAtTime(0.0001, now + 0.3); g2.gain.linearRampToValueAtTime(0.11, now + 0.34);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      o2.connect(g2).connect(actx.destination); o2.start(now + 0.3); o2.stop(now + 0.75);
    } catch (e) {}
  }

  // Toasts queue so several unlocks in one build play one after another (instead of overwriting
  // a single element and only showing the last). The chime fires as each toast appears.
  const toastQ = [];
  let toastBusy = false;
  function showToast(a) { toastQ.push(a); pumpToast(); }
  function pumpToast() {
    ensureChrome();
    if (toastBusy || !toastQ.length || !toast) return;
    toastBusy = true;
    const a = toastQ.shift();
    toast.querySelector('.ti').textContent = a.icon;
    toast.querySelector('.tnm').textContent = a.name;
    toast.querySelector('.tds').textContent = a.desc || '';
    toast.style.display = 'flex';
    chime(!!a.chal);
    if (window.gsap) {
      gsap.killTweensOf(toast);
      gsap.fromTo(toast, { x: 90, opacity: 0 }, { x: 0, opacity: 1, duration: .5, ease: 'back.out(1.6)' });
      gsap.fromTo(toast.querySelector('.ti'), { scale: 0, rotate: -25 }, { scale: 1, rotate: 0, duration: .55, delay: .08, ease: 'back.out(3)' });
    }
    const HOLD = toastQ.length ? 1900 : 3000;   // move quicker when more are waiting
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      const done2 = () => { toast.style.display = 'none'; toastBusy = false; pumpToast(); };
      if (window.gsap) gsap.to(toast, { x: 90, opacity: 0, duration: .35, ease: 'power2.in', onComplete: done2 });
      else done2();
    }, HOLD);
  }

  // ---- public unlock ----
  function unlock(id) {
    const a = byId[id];
    if (!a || done[id]) return false;
    done[id] = new Date().toISOString();
    save();
    queueSync();
    showToast(a);
    refreshBadges();
    if (built && ov.classList.contains('show')) {
      render();
      const el = canvas.querySelector(`.ach-node[data-id="${id}"]`);
      if (el) el.classList.add('just');
    }
    // completionist: every non-meta achievement earned
    if (!done.completionist) {
      const need = ACHIEVEMENTS.filter(x => META_IDS.indexOf(x.id) < 0 && !x.future);
      if (need.every(x => done[x.id])) setTimeout(() => unlock('completionist'), 900);
    }
    return true;
  }

  function refreshBadges() {
    const n = ACHIEVEMENTS.filter(a => done[a.id]).length;
    document.querySelectorAll('[data-ach-count]').forEach(el => { el.textContent = n + '/' + ACHIEVEMENTS.length; });
  }

  function open() {
    if (!built) buildDom();
    serverSync();
    ACTIVE = 'all'; render();
    ov.classList.add('show');
    document.body.classList.add('ach-open');
    if (window.gsap) gsap.fromTo(ov.querySelector('.ach-card'), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .3, ease: 'power3.out' });
  }
  function close() { hideTip(); document.body.classList.remove('ach-open'); if (ov) ov.classList.remove('show'); }

  const Ach = {
    muted: false,
    unlock,
    has: id => !!done[id],
    count: () => ACHIEVEMENTS.filter(a => done[a.id]).length,
    total: ACHIEVEMENTS.length,
    open, close,
    refreshBadges,
    sync: serverSync,
    signOut,
    all: ACHIEVEMENTS,
  };
  window.Ach = Ach;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshBadges);
  else refreshBadges();
  // pull the account's achievements shortly after load (give Google auto-sign-in time to set pl_account)
  setTimeout(serverSync, 1500);
  // re-sync if the user signs in/out in another tab or via the menu
  window.addEventListener('storage', e => { if (e.key === 'pl_account') serverSync(); });

  // ---- local-only test bar (never appears on the live site) ----
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    const mkBtn = (txt, fn) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText = 'font:600 12px Oswald,sans-serif;letter-spacing:.5px;color:#eaf2fb;background:#10202e;' +
        'border:1px solid #19c6ff;border-radius:9px;padding:9px 12px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.5);';
      b.onclick = fn;
      return b;
    };
    const addBar = () => {
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:400;display:flex;gap:8px;flex-wrap:wrap;max-width:60vw;';
      bar.appendChild(mkBtn('🧪 Unlock next', () => {
        const n = ACHIEVEMENTS.find(a => !done[a.id] && !a.future);
        if (n) unlock(n.id); else showToast({ icon: '✅', name: 'All unlocked!' });
      }));
      bar.appendChild(mkBtn('🎲 Random', () => {
        const left = ACHIEVEMENTS.filter(a => !done[a.id] && !a.future);
        if (left.length) unlock(left[(Math.random() * left.length) | 0].id);
      }));
      bar.appendChild(mkBtn('🏅 Board', open));
      bar.appendChild(mkBtn('↺ Reset', () => {
        for (const k in done) delete done[k];
        save(); refreshBadges();
        if (built && ov.classList.contains('show')) render();
        showToast({ icon: '↺', name: 'Board reset' });
      }));
      document.body.appendChild(bar);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addBar);
    else addBar();
  }
})();
