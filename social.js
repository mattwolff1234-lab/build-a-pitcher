/* ============================================================================
   GoatLab — 👥 Friends (social layer).
   Included (defer) by the hub, all 5 game pages, and all 3 versus pages.
   Follows the xp.js / hotboard.js drop-in pattern: self-contained, injects its
   own CSS, exposes window.Social, fails silent when the API is unreachable.

     - CLAIMED HANDLES: signed-in players claim a unique @handle (first come,
       first served) and are found by handle search. Guests can search + add +
       be friends, but can't claim (a handle must survive a cleared browser).
     - Friends overlay (☰ → 👥 Friends): friends / requests / search tabs,
       pending challenges, online dots, head-to-head records.
     - Profile overlay: XP level, per-sport 1v1 records, top + recent Hall of
       Fame builds, challenge button.
     - Challenges ride the versus pages' EXISTING friendly-challenge flow:
       accepting one navigates to /versus[-hoops|-soccer]?ch=<personId>&cn=<name>,
       which pings the challenger's Ably inbox exactly like a shared link.
     - Polls friendList on load + every 60s while visible (also the heartbeat
       that makes you show as "online"). Badges [data-social-badge] slots and
       pops a toast on new incoming requests/challenges.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- identity (same model as versus.html) ---------- */
  function acct() { try { return JSON.parse(localStorage.getItem('pl_account') || 'null'); } catch (e) { return null; } }
  function guestId() {
    let id = null;
    try { id = localStorage.getItem('pl_guestId'); } catch (e) {}
    if (!id) {
      id = 'g_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem('pl_guestId', id); } catch (e) {}
    }
    return id;
  }
  function handle() { try { return (localStorage.getItem('pl_guestName') || '').trim(); } catch (e) { return ''; } }
  function principal() {
    const a = acct();
    const h = handle();
    if (a && a.sub && a.sessionToken) {
      const p = { sub: a.sub, sessionToken: a.sessionToken };
      if (h) p.name = h;               // chosen 1v1 handle, never the Google full name
      return p;
    }
    return { guestId: guestId(), name: h || 'Guest' };
  }
  function api(action, extra) {
    return fetch('/api/account', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ action }, principal(), extra || {})),
    }).then(r => r.json());
  }
  function ga(ev, params) { try { window.gtag && gtag('event', ev, params || {}); } catch (e) {} }

  /* ---------- constants ---------- */
  const SPORTS = [
    { id: 'baseball', icon: '⚾', label: 'Baseball', route: '/versus' },
    { id: 'hoops', icon: '🏀', label: 'Hoops', route: '/versus-hoops' },
    { id: 'soccer', icon: '⚽', label: 'Soccer', route: '/versus-soccer' },
  ];
  const sport = id => SPORTS.find(s => s.id === id) || SPORTS[0];
  const GAME_META = {
    pitcher: { icon: '⚾', label: 'Pitcher' },
    batter: { icon: '💥', label: 'Batter' },
    baller: { icon: '🏀', label: 'Hooper' },
    striker: { icon: '⚽', label: 'Striker' },
    keeper: { icon: '🧤', label: 'Keeper' },
  };

  /* ---------- avatar registry ----------
     Real pixel-art in /avatars/<id>.webp (128px, from Matt's generated set); the emoji +
     gradient render instantly and as the fallback if an image ever fails to load.
     track: null = free · 's1' = Season 1 Track reward · 'future' = a later season's reward.
     Ids must satisfy /^[a-z0-9_]{1,32}$/ (server) and match season-track.js COSMETICS ids. */
  const AV_SRC = id => '/avatars/' + id + '.webp';
  const AVATARS = {
    // free starters
    av_goat_catcher: { emoji: '🐐', name: 'Backstop', bg: 'linear-gradient(135deg,#2b3f57,#16202f)', track: null },
    av_goat_headband: { emoji: '🐐', name: 'Headband GOAT', bg: 'linear-gradient(135deg,#1d4e89,#122232)', track: null },
    av_goat_keeper: { emoji: '🐐', name: 'Keeper GOAT', bg: 'linear-gradient(135deg,#1d7a4f,#0e2318)', track: null },
    av_goat_scarf: { emoji: '🐐', name: 'Super Fan', bg: 'linear-gradient(135deg,#8a4a1d,#2b1a10)', track: null },
    av_fox_wink: { emoji: '🦊', name: 'Sly Fox', bg: 'linear-gradient(135deg,#8a4a1d,#2b1a10)', track: null },
    av_bear_hoops: { emoji: '🐻', name: 'Big Bear', bg: 'linear-gradient(135deg,#6b4226,#241811)', track: null },
    av_wolf_howl: { emoji: '🐺', name: 'Lone Wolf', bg: 'linear-gradient(135deg,#44506a,#181d29)', track: null },
    av_shark_grin: { emoji: '🦈', name: 'Mako', bg: 'linear-gradient(135deg,#166d7a,#0d2229)', track: null },
    av_penguin_dive: { emoji: '🐧', name: 'The Diver', bg: 'linear-gradient(135deg,#3a6ea5,#101b28)', track: null },
    av_soccer_shades: { emoji: '⚽', name: 'Cool Touch', bg: 'linear-gradient(135deg,#1d7a4f,#0e2318)', track: null },
    av_basketball_mad: { emoji: '🏀', name: 'Buckets', bg: 'linear-gradient(135deg,#a04a1c,#2b160b)', track: null },
    // Season 1 Track rewards (unlock via season-track.js tiers)
    av_goat_crown: { emoji: '👑', name: 'Crowned GOAT', bg: 'linear-gradient(135deg,#8a6b1d,#2b2210)', track: 's1' },
    av_flame_ball: { emoji: '🔥', name: 'Heat Check', bg: 'linear-gradient(135deg,#a02c1c,#2b0f0b)', track: 's1' },
    av_octo_keeper: { emoji: '🐙', name: 'Octo Keeper', bg: 'linear-gradient(135deg,#6b2d8a,#20102b)', track: 's1' },
    av_golden_goat: { emoji: '🐐', name: 'Golden GOAT', bg: 'linear-gradient(135deg,#c9971c,#4a3407)', track: 's1' },
    // future season rewards (locked until a later track grants them)
    av_bull_bat: { emoji: '🐂', name: 'Raging Bull', bg: 'linear-gradient(135deg,#7a2222,#230d0d)', track: 'future' },
    av_eagle_glove: { emoji: '🦅', name: 'Talon', bg: 'linear-gradient(135deg,#5a4a2a,#1c1710)', track: 'future' },
    av_rhino_bat: { emoji: '🦏', name: 'The Tank', bg: 'linear-gradient(135deg,#4e5a66,#181d22)', track: 'future' },
    av_robot_ump: { emoji: '🤖', name: 'Robo Ump', bg: 'linear-gradient(135deg,#2a6a8a,#0f222b)', track: 'future' },
    av_astro_ball: { emoji: '🚀', name: 'Moonshot', bg: 'linear-gradient(135deg,#3a3a7a,#121226)', track: 'future' },
    av_lightning_bat: { emoji: '⚡', name: 'Voltage', bg: 'linear-gradient(135deg,#8a7a1d,#2b2610)', track: 'future' },
    av_ghost_jersey: { emoji: '👻', name: 'Double Zero', bg: 'linear-gradient(135deg,#556077,#1a1e28)', track: 'future' },
  };
  for (const id in AVATARS) AVATARS[id].src = AV_SRC(id);   // every avatar has real art now
  // the image sits on top; the emoji shows while it loads (or if it 404s and removes itself)
  const avatarInner = a => `<span class="soc-avemoji">${a.emoji}</span>${a.src
    ? `<img src="${esc(a.src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}`;
  function avatarUnlocked(id) {
    const a = AVATARS[id];
    if (!a) return false;
    if (!a.track) return true;
    try { return window.SeasonTrack && SeasonTrack.info().unlocked.indexOf(id) >= 0; } catch (e) { return false; }
  }
  function myAvatar() { try { return localStorage.getItem('pl_avatar') || null; } catch (e) { return null; } }
  async function setAvatar(id) {
    if (id && !avatarUnlocked(id)) return false;
    try { localStorage.setItem('pl_avatar', id || ''); } catch (e) {}
    try { await api('avatarSet', { avatar: id || '' }); } catch (e) {}
    refresh();
    return true;
  }
  // XP → level, mirroring xp.js: cost to REACH level L is 25·(L−1)·(L+2)
  function levelOf(xp) {
    let L = 1;
    while (L < 400 && 25 * L * (L + 3) <= xp) L++;   // xpFor(L+1) = 25·L·(L+3)
    return L;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- styles ---------- */
  const css = `
  .soc-overlay { position:fixed; inset:0; z-index:530; display:none; align-items:center; justify-content:center;
    padding:16px; background:rgba(4,8,14,.78); backdrop-filter:blur(4px); }
  .soc-overlay.show { display:flex; }
  .soc-panel { position:relative; width:min(520px,100%); max-height:min(84vh,760px); display:flex; flex-direction:column;
    background:linear-gradient(160deg,#101a28,#0b121d); border:1px solid rgba(120,170,220,.28); border-radius:14px;
    box-shadow:0 30px 80px rgba(0,0,0,.6); animation:socPop .38s cubic-bezier(.2,1.4,.4,1); }
  .soc-panel::before, .soc-panel::after { content:''; position:absolute; width:16px; height:16px; pointer-events:none;
    border:2px solid rgba(59,209,255,.55); }
  .soc-panel::before { top:-1px; left:-1px; border-right:none; border-bottom:none; border-radius:14px 0 0 0; }
  .soc-panel::after { bottom:-1px; right:-1px; border-left:none; border-top:none; border-radius:0 0 14px 0; }
  @keyframes socPop { from { opacity:0; transform:scale(.92) translateY(14px); } to { opacity:1; transform:none; } }
  .soc-head { padding:16px 18px 10px; border-bottom:1px solid rgba(120,170,220,.16); }
  .soc-eyebrow { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:3px; color:#3bd1ff; text-transform:uppercase; }
  .soc-title { font-family:'Oswald',sans-serif; font-size:24px; font-weight:700; letter-spacing:1px; color:#f2f6fb;
    line-height:1.1; margin-top:3px; text-transform:uppercase; }
  .soc-code { display:flex; align-items:center; gap:8px; margin-top:9px; flex-wrap:wrap; }
  .soc-code .cd { font-family:'Oswald',sans-serif; font-size:15px; font-weight:700; letter-spacing:2px; color:#ffd23f;
    background:rgba(255,210,63,.1); border:1px solid rgba(255,210,63,.35); border-radius:7px; padding:3px 10px; }
  .soc-code .cp { font-family:Inter,sans-serif; font-size:11px; color:#3bd1ff; background:none; border:1px solid rgba(59,209,255,.4);
    border-radius:7px; padding:4px 10px; cursor:pointer; letter-spacing:.5px; }
  .soc-code .cp:hover { background:rgba(59,209,255,.12); }
  .soc-code .hint { font-family:Inter,sans-serif; font-size:10.5px; color:#8ea2bd; flex-basis:100%; }
  .soc-tabs { display:flex; gap:6px; padding:10px 14px 0; }
  .soc-tab { flex:1; font-family:'Oswald',sans-serif; font-size:12px; letter-spacing:1.5px; text-transform:uppercase;
    color:#8ea2bd; background:rgba(20,32,48,.55); border:1px solid rgba(120,170,220,.13); border-radius:8px 8px 0 0;
    padding:8px 4px; cursor:pointer; position:relative; }
  .soc-tab.active { color:#f2f6fb; border-color:rgba(59,209,255,.45); background:rgba(25,198,255,.08); }
  .soc-tab .n { display:inline-block; min-width:16px; padding:0 4px; margin-left:4px; border-radius:8px; font-size:10px;
    background:#ff4d5e; color:#fff; }
  .soc-body { overflow-y:auto; padding:12px 14px 16px; display:flex; flex-direction:column; gap:8px; min-height:180px; }
  .soc-row { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:10px;
    background:rgba(20,32,48,.55); border:1px solid rgba(120,170,220,.13); }
  .soc-av { width:40px; height:40px; border-radius:50%; flex:0 0 auto; background:#182334; display:flex; align-items:center;
    justify-content:center; font-family:'Oswald',sans-serif; font-weight:700; font-size:17px; color:#3bd1ff; overflow:hidden;
    border:2px solid rgba(120,170,220,.25); position:relative; }
  .soc-av img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .soc-dot { position:absolute; right:-1px; bottom:-1px; width:11px; height:11px; border-radius:50%; background:#3a4656;
    border:2px solid #0d1520; }
  .soc-row.online .soc-dot, .soc-av.on .soc-dot { background:#39d98a; box-shadow:0 0 8px rgba(57,217,138,.7); }
  .soc-av .soc-avemoji { font-size:21px; line-height:1; }
  .soc-phead .soc-av .soc-avemoji { font-size:30px; }
  /* avatar picker (profile Style tab) */
  .soc-avgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(66px,1fr)); gap:9px; }
  .soc-avcell { position:relative; display:flex; flex-direction:column; align-items:center; gap:5px; padding:9px 4px 7px;
    border-radius:11px; border:1px solid rgba(120,170,220,.13); background:rgba(20,32,48,.55); cursor:pointer; }
  .soc-avcell:hover { border-color:rgba(59,209,255,.5); }
  .soc-avcell.sel { border-color:#ffd23f; box-shadow:0 0 12px rgba(255,210,63,.35); background:rgba(255,210,63,.07); }
  .soc-avcell.lock .soc-av { filter:grayscale(.85) brightness(.55); }
  .soc-avcell .nm { font-family:Inter,sans-serif; font-size:9px; color:#8ea2bd; text-align:center; line-height:1.2;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  .soc-avcell .lk { position:absolute; top:5px; right:6px; font-size:11px; }
  .soc-who { flex:1 1 auto; min-width:0; font-family:Inter,system-ui,sans-serif; }
  .soc-who .nm { font-size:13.5px; font-weight:700; color:#f2f6fb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .soc-who .sub { font-size:10.5px; color:#8ea2bd; margin-top:2px; letter-spacing:.3px; }
  .soc-who .sub b { color:#ffd23f; font-weight:600; }
  .soc-acts { display:flex; gap:6px; flex:0 0 auto; }
  .soc-btn { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:1px; text-transform:uppercase; cursor:pointer;
    color:#dfe9f5; background:rgba(25,198,255,.1); border:1px solid rgba(59,209,255,.4); border-radius:7px; padding:6px 10px; }
  .soc-btn:hover { background:rgba(25,198,255,.2); }
  .soc-btn.warm { color:#1a0e04; background:linear-gradient(135deg,#ffb02e,#ff7a2e); border-color:transparent; font-weight:600; }
  .soc-btn.dim { color:#8ea2bd; background:none; border-color:rgba(120,170,220,.25); }
  .soc-btn.danger { color:#ff8c96; border-color:rgba(255,77,94,.4); background:rgba(255,77,94,.08); }
  .soc-btn:disabled { opacity:.5; cursor:default; }
  .soc-empty { padding:26px 12px; text-align:center; font-family:Inter,sans-serif; font-size:12.5px; color:#8ea2bd; line-height:1.6; }
  .soc-sec { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#8ea2bd;
    margin:4px 2px 0; }
  .soc-chal { border-color:rgba(255,176,46,.4); background:rgba(255,140,46,.08); }
  .soc-x { position:absolute; top:9px; right:11px; background:none; border:none; color:#8ea2bd; font-size:20px;
    cursor:pointer; padding:4px 8px; line-height:1; font-family:Inter,sans-serif; z-index:2; }
  .soc-x:hover { color:#f2f6fb; }
  .soc-input { width:100%; box-sizing:border-box; font-family:'Oswald',sans-serif; font-size:16px; letter-spacing:2px;
    text-transform:uppercase; color:#f2f6fb; background:rgba(10,16,26,.8); border:1px solid rgba(120,170,220,.3);
    border-radius:8px; padding:10px 12px; outline:none; }
  .soc-input:focus { border-color:rgba(59,209,255,.6); }
  .soc-note { font-family:Inter,sans-serif; font-size:11.5px; color:#8ea2bd; line-height:1.55; }
  .soc-note b { color:#ffd23f; }
  .soc-err { font-family:Inter,sans-serif; font-size:12px; color:#ff8c96; min-height:16px; }
  .soc-ok { color:#39d98a; }
  /* profile */
  .soc-phead { display:flex; align-items:center; gap:13px; }
  .soc-phead .soc-av { width:56px; height:56px; font-size:24px; }
  .soc-pname { font-family:'Oswald',sans-serif; font-size:22px; font-weight:700; letter-spacing:1px; color:#f2f6fb;
    text-transform:uppercase; line-height:1.1; }
  .soc-psub { font-family:Inter,sans-serif; font-size:11px; color:#8ea2bd; margin-top:3px; }
  .soc-lvl { display:inline-block; font-family:'Oswald',sans-serif; font-size:11px; font-weight:700; letter-spacing:1px;
    color:#0a1420; background:linear-gradient(135deg,#3bd1ff,#19c6ff); border-radius:7px; padding:2px 8px; margin-right:6px; }
  .soc-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }
  .soc-stat { background:rgba(20,32,48,.55); border:1px solid rgba(120,170,220,.13); border-radius:10px; padding:8px 6px; text-align:center; }
  .soc-stat .ic { font-size:15px; }
  .soc-stat .v { font-family:'Oswald',sans-serif; font-size:17px; font-weight:700; color:#f2f6fb; margin-top:2px; }
  .soc-stat .l { font-family:Inter,sans-serif; font-size:9.5px; color:#8ea2bd; letter-spacing:.5px; text-transform:uppercase; margin-top:1px; }
  .soc-build { display:flex; align-items:center; gap:9px; padding:7px 10px; border-radius:9px;
    background:rgba(20,32,48,.55); border:1px solid rgba(120,170,220,.13); font-family:Inter,sans-serif; }
  .soc-build .gi { font-size:17px; flex:0 0 auto; }
  .soc-build .bn { flex:1 1 auto; min-width:0; font-size:12.5px; font-weight:600; color:#f2f6fb; white-space:nowrap;
    overflow:hidden; text-overflow:ellipsis; }
  .soc-build .bn small { display:block; font-weight:400; font-size:10px; color:#8ea2bd; margin-top:1px; }
  .soc-build .ov { font-family:'Oswald',sans-serif; font-size:15px; font-weight:700; color:#ffd23f; flex:0 0 auto; }
  .soc-h2h { text-align:center; font-family:'Oswald',sans-serif; font-size:13px; letter-spacing:1px; color:#dfe9f5;
    background:rgba(255,210,63,.07); border:1px solid rgba(255,210,63,.25); border-radius:9px; padding:7px; }
  .soc-kv { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 11px;
    border-radius:9px; background:rgba(20,32,48,.55); border:1px solid rgba(120,170,220,.13);
    font-family:Inter,sans-serif; font-size:12.5px; color:#c8d6ea; }
  .soc-kv b { font-family:'Oswald',sans-serif; font-size:15px; font-weight:700; color:#f2f6fb; letter-spacing:.5px; }
  /* sport picker + toast */
  .soc-sports { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  .soc-sport { font-family:'Oswald',sans-serif; text-transform:uppercase; letter-spacing:1px; font-size:12px; color:#dfe9f5;
    background:rgba(20,32,48,.7); border:1px solid rgba(120,170,220,.25); border-radius:10px; padding:13px 6px; cursor:pointer; text-align:center; }
  .soc-sport:hover { border-color:rgba(59,209,255,.55); background:rgba(25,198,255,.1); }
  .soc-sport .si { display:block; font-size:22px; margin-bottom:4px; }
  .soc-toast { position:fixed; bottom:84px; left:50%; transform:translateX(-50%); z-index:540; max-width:380px;
    width:calc(100% - 32px); background:linear-gradient(160deg,#14212f,#0d1520); border:1px solid rgba(255,176,46,.45);
    border-radius:12px; padding:12px 14px; box-shadow:0 18px 50px rgba(0,0,0,.55); font-family:Inter,sans-serif; }
  .soc-toast .tt { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#ffb02e; }
  .soc-toast .tm { font-size:13px; color:#f2f6fb; margin-top:3px; line-height:1.4; }
  .soc-toast .ta { display:flex; gap:8px; margin-top:9px; }
  [data-social-badge] { display:none; margin-left:auto; min-width:18px; text-align:center; padding:1px 5px; border-radius:9px;
    font-family:'Oswald',sans-serif; font-size:11px; font-weight:700; background:#ff4d5e; color:#fff; }
  @media (max-width:480px) { .soc-stats { grid-template-columns:repeat(3,1fr); } .soc-title { font-size:20px; } }`;

  let cssIn = false;
  function injectCss() {
    if (cssIn) return; cssIn = true;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------- state ---------- */
  let data = null;          // last friendList payload
  let overlay = null, tab = 'friends', busy = false;
  let toastEl = null;

  /* ---------- badge + toast ---------- */
  function pendingCount() {
    if (!data) return 0;
    return (data.requestsIn || []).length + (data.challenges || []).filter(c => c.incoming).length;
  }
  function paintBadge() {
    injectCss();   // badge styles live in the injected sheet — make sure it's in before painting
    const n = pendingCount();
    document.querySelectorAll('[data-social-badge]').forEach(el => {
      el.textContent = n;
      el.style.display = n > 0 ? 'inline-block' : 'none';
    });
  }
  function seen() {
    try { return JSON.parse(localStorage.getItem('pl_social_seen') || '{}'); } catch (e) { return {}; }
  }
  function markSeen() {
    if (!data) return;
    const s = {
      req: (data.requestsIn || []).map(r => r.key),
      chal: (data.challenges || []).filter(c => c.incoming).map(c => c.id),
    };
    try { localStorage.setItem('pl_social_seen', JSON.stringify(s)); } catch (e) {}
  }
  function maybeToast() {
    if (!data || (overlay && overlay.classList.contains('show'))) return;
    const s = seen();
    const newChal = (data.challenges || []).filter(c => c.incoming && !(s.chal || []).includes(c.id))[0];
    if (newChal) {
      const sp = sport(newChal.sport);
      return showToast('⚔️ Challenge!', `<b>${esc(newChal.fromName)}</b> challenged you to ${sp.icon} ${sp.label} — friendly 1v1, no Elo.`, [
        { label: 'Accept', warm: true, fn: () => acceptChallenge(newChal.id) },
        { label: 'View', fn: () => { hideToast(); open(); } },
      ]);
    }
    const newReq = (data.requestsIn || []).filter(r => !(s.req || []).includes(r.key))[0];
    if (newReq) {
      showToast('👥 Friend request', `<b>${esc(newReq.name)}</b> wants to be your friend.`, [
        { label: 'View', warm: true, fn: () => { hideToast(); open('requests'); } },
      ]);
    }
  }
  function showToast(title, msgHtml, actions) {
    hideToast();
    injectCss();
    toastEl = document.createElement('div');
    toastEl.className = 'soc-toast';
    toastEl.innerHTML = `<div class="tt">${title}</div><div class="tm">${msgHtml}</div><div class="ta"></div>`;
    const ta = toastEl.querySelector('.ta');
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'soc-btn' + (a.warm ? ' warm' : '');
      b.textContent = a.label;
      b.onclick = a.fn;
      ta.appendChild(b);
    });
    const x = document.createElement('button');
    x.className = 'soc-btn dim'; x.textContent = '✕';
    x.onclick = () => { markSeen(); hideToast(); };
    ta.appendChild(x);
    document.body.appendChild(toastEl);
    if (window.gsap) gsap.fromTo(toastEl, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: .4, ease: 'back.out(1.6)' });
  }
  function hideToast() { if (toastEl) { toastEl.remove(); toastEl = null; } }

  /* ---------- polling ---------- */
  let pollTimer = null;
  async function refresh() {
    try {
      const r = await api('friendList');
      if (r && r.ok) {
        data = r;
        try { localStorage.setItem('pl_avatar', r.myAvatar || ''); } catch (e) {}   // server is source of truth
        paintBadge(); maybeToast();
      }
    } catch (e) {}
    return data;
  }
  function startPolling() {
    if (pollTimer) return;
    setTimeout(refresh, 1600);          // let Google One Tap set pl_account first
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  }

  /* ---------- overlay shell ---------- */
  function buildOverlay() {
    if (overlay) return;
    injectCss();
    overlay = document.createElement('div');
    overlay.className = 'soc-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.appendChild(overlay);
  }
  function close() { if (overlay) overlay.classList.remove('show'); markSeen(); paintBadge(); }
  function open(startTab) {
    buildOverlay();
    tab = startTab || 'friends';
    overlay.classList.add('show');
    renderLoading('Loading your crew…');
    refresh().then(() => { renderFriends(); markSeen(); });
    ga('friends_open');
  }
  function renderLoading(msg) {
    overlay.innerHTML = `<div class="soc-panel"><button class="soc-x">✕</button>
      <div class="soc-head"><div class="soc-eyebrow">GoatLab Social</div><div class="soc-title">👥 Friends</div></div>
      <div class="soc-body"><div class="soc-empty">${esc(msg)}</div></div></div>`;
    overlay.querySelector('.soc-x').onclick = close;
  }

  /* ---------- friends panel ---------- */
  function avatarHtml(p) {
    const av = p.avatar && AVATARS[p.avatar];
    const on = p.online ? ' on' : '';
    if (av) {
      return `<div class="soc-av${on}" style="background:${av.bg}">${avatarInner(av)}<span class="soc-dot"></span></div>`;
    }
    const initial = esc((p.name || 'P').trim().charAt(0).toUpperCase() || 'P');
    const img = p.picture ? `<img src="${esc(p.picture)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    return `<div class="soc-av${on}">${initial}${img}<span class="soc-dot"></span></div>`;
  }
  function renderFriends() {
    if (!overlay) return;
    if (!data) { renderLoading('Could not reach the clubhouse — check your connection and try again.'); return; }
    const nIn = (data.requestsIn || []).length;
    const inChals = (data.challenges || []).filter(c => c.incoming);
    const outChals = (data.challenges || []).filter(c => !c.incoming);

    const chalRows = inChals.map(c => {
      const sp = sport(c.sport);
      return `<div class="soc-row soc-chal" data-chal="${esc(c.id)}">
        <div class="soc-who"><div class="nm">${sp.icon} ${esc(c.fromName)}</div>
        <div class="sub">challenged you · ${sp.label} · friendly, no Elo</div></div>
        <div class="soc-acts"><button class="soc-btn warm" data-act="chal-accept">Play</button>
        <button class="soc-btn dim" data-act="chal-decline">✕</button></div></div>`;
    }).join('') + outChals.map(c => {
      const sp = sport(c.sport);
      return `<div class="soc-row soc-chal" data-chal="${esc(c.id)}">
        <div class="soc-who"><div class="nm">${sp.icon} You → ${esc(c.toName)}</div>
        <div class="sub">waiting for them to accept · <a href="${sport(c.sport).route}?lobby=1" style="color:#3bd1ff">wait in the arena</a></div></div>
        <div class="soc-acts"><button class="soc-btn dim" data-act="chal-cancel">Cancel</button></div></div>`;
    }).join('');

    const friendRows = (data.friends || []).length ? data.friends.map(f => {
      const rec = (f.myWins || f.theirWins) ? ` · <b>${f.myWins}–${f.theirWins}</b> vs you` : '';
      return `<div class="soc-row ${f.online ? 'online' : ''}" data-key="${esc(f.key)}" data-name="${esc(f.name)}">
        ${avatarHtml(f)}
        <div class="soc-who"><div class="nm">${esc(f.name)}</div>
        <div class="sub">Lv ${levelOf(f.xp)} · ${f.elo} Elo${rec}${f.online ? ' · <span style="color:#39d98a">online</span>' : ''}</div></div>
        <div class="soc-acts">
          <button class="soc-btn" data-act="profile">Profile</button>
          <button class="soc-btn warm" data-act="challenge">⚔️</button>
        </div></div>`;
    }).join('') : `<div class="soc-empty">No friends yet.<br>Search a handle in the <b>Find</b> tab to add your first one.</div>`;

    const reqRows = nIn || (data.requestsOut || []).length
      ? (data.requestsIn || []).map(r => `<div class="soc-row" data-key="${esc(r.key)}">
          ${avatarHtml(r)}
          <div class="soc-who"><div class="nm">${esc(r.name)}</div><div class="sub">wants to be friends</div></div>
          <div class="soc-acts"><button class="soc-btn warm" data-act="req-accept">Accept</button>
          <button class="soc-btn dim" data-act="req-decline">✕</button></div></div>`).join('')
        + ((data.requestsOut || []).length ? `<div class="soc-sec">Sent</div>` : '')
        + (data.requestsOut || []).map(r => `<div class="soc-row" data-key="${esc(r.key)}">
          ${avatarHtml(r)}
          <div class="soc-who"><div class="nm">${esc(r.name)}</div><div class="sub">request sent — waiting</div></div>
          <div class="soc-acts"><button class="soc-btn dim" data-act="req-cancel">Cancel</button></div></div>`).join('')
      : `<div class="soc-empty">No pending requests.</div>`;

    const isGuestNoName = !acct() && !handle();
    const addBody = `
      ${isGuestNoName ? `<div class="soc-note">Pick a display name (shown on the requests you send):</div>
      <input class="soc-input" id="socHandle" maxlength="20" placeholder="Your name" style="text-transform:none">` : ''}
      <div class="soc-note">Find friends by their handle:</div>
      <input class="soc-input" id="socSearch" maxlength="20" placeholder="Search handles…" autocomplete="off" style="text-transform:none">
      <div id="socResults" style="display:flex;flex-direction:column;gap:8px"></div>
      <div class="soc-err" id="socAddMsg"></div>
      <div class="soc-note">Friends can see your <b>profile</b> — 1v1 records and your Hall of Fame builds — and
      challenge you to friendly 1v1s in any sport. Only players who've <b>claimed a handle</b> show up in
      search${acct() ? '' : ' — sign in with Google (☰ menu) to claim yours and let friends find you'}.</div>`;

    const bodies = {
      friends: (chalRows ? `<div class="soc-sec">Challenges</div>${chalRows}<div class="soc-sec">Friends</div>` : '') + friendRows,
      requests: reqRows,
      add: addBody,
    };

    const claimUi = `<div class="soc-code" style="flex-direction:column;align-items:stretch">
          <span class="hint">Claim your unique handle — first come, first served. Friends find you by it.</span>
          <div style="display:flex;gap:8px"><input class="soc-input" id="socClaim" maxlength="20" placeholder="YourHandle" style="text-transform:none;flex:1">
          <button class="soc-btn warm" id="socClaimBtn">Claim</button>${renaming ? '<button class="soc-btn dim" id="socClaimCancel">✕</button>' : ''}</div>
          <div class="soc-err" id="socClaimMsg"></div></div>`;
    const headExtra = (data.myHandle && !renaming)
      ? `<div class="soc-code"><span class="cd" id="socMe" style="cursor:pointer" title="View my profile">@${esc(data.myHandle)}</span>
          <button class="cp" id="socRename">Change</button>
          <button class="cp" id="socMeBtn">My profile</button>
          <span class="hint">Your handle — friends find you by searching it.</span></div>`
      : data.guest
        ? `<div class="soc-code"><button class="cp" id="socMeBtn">👤 My profile</button>
          <span class="hint">Sign in with Google (☰ menu) to claim a unique handle so friends can find <i>you</i>. You can still search and add friends below.</span></div>`
        : claimUi;

    overlay.innerHTML = `<div class="soc-panel"><button class="soc-x">✕</button>
      <div class="soc-head">
        <div class="soc-eyebrow">GoatLab Social</div>
        <div class="soc-title">👥 Friends</div>
        ${headExtra}
      </div>
      <div class="soc-tabs">
        <button class="soc-tab ${tab === 'friends' ? 'active' : ''}" data-tab="friends">Friends${inChals.length ? `<span class="n">${inChals.length}</span>` : ''}</button>
        <button class="soc-tab ${tab === 'requests' ? 'active' : ''}" data-tab="requests">Requests${nIn ? `<span class="n">${nIn}</span>` : ''}</button>
        <button class="soc-tab ${tab === 'add' ? 'active' : ''}" data-tab="add">🔎 Find</button>
      </div>
      <div class="soc-body">${bodies[tab] || ''}</div></div>`;

    overlay.querySelector('.soc-x').onclick = close;
    overlay.querySelectorAll('.soc-tab').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderFriends(); });
    const renameBtn = overlay.querySelector('#socRename');
    if (renameBtn) renameBtn.onclick = () => { renaming = true; renderFriends(); };
    const cancelBtn = overlay.querySelector('#socClaimCancel');
    if (cancelBtn) cancelBtn.onclick = () => { renaming = false; renderFriends(); };
    const meChip = overlay.querySelector('#socMe');
    if (meChip) meChip.onclick = () => openProfile(null);
    const meBtn = overlay.querySelector('#socMeBtn');
    if (meBtn) meBtn.onclick = () => openProfile(null);
    wireClaim();
    const searchIn = overlay.querySelector('#socSearch');
    if (searchIn) {
      searchIn.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 400); });
      searchIn.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(); } });
    }
    overlay.querySelectorAll('[data-act]').forEach(b => b.onclick = () => handleAct(b));
  }

  /* ---------- claim a handle ---------- */
  let renaming = false, claimBusy = false, claimTimer = null;
  // `after` = what to re-render on success (defaults to the friends panel; the profile
  // Settings tab passes its own so you land back on your refreshed profile).
  function wireClaim(after) {
    const input = overlay.querySelector('#socClaim'), btn = overlay.querySelector('#socClaimBtn'), msg = overlay.querySelector('#socClaimMsg');
    if (!input || !btn) return;
    input.addEventListener('input', () => {                 // live availability check while typing
      clearTimeout(claimTimer);
      const h = input.value.trim();
      if (h.length < 3) { msg.textContent = ''; return; }
      claimTimer = setTimeout(async () => {
        try {
          const r = await api('handleCheck', { handle: h });
          if (r && r.ok && input.value.trim() === h) {
            msg.className = 'soc-err' + (r.available ? ' soc-ok' : '');
            msg.textContent = !r.valid ? 'Handles are 3–20 letters, numbers, or _'
              : (r.available ? `@${h} is available ✓` : `@${h} is taken`);
          }
        } catch (e) {}
      }, 450);
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    btn.onclick = async () => {
      if (claimBusy) return;
      const h = input.value.trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(h)) { msg.className = 'soc-err'; msg.textContent = 'Handles are 3–20 letters, numbers, or _'; return; }
      claimBusy = true; btn.disabled = true; msg.className = 'soc-err'; msg.textContent = 'Claiming…';
      try {
        const r = await api('handleClaim', { handle: h });
        if (r && r.ok) {
          // the handle is now the display name everywhere (versus reads pl_guestName)
          try { localStorage.setItem('pl_guestName', r.handle); } catch (e) {}
          ga('handle_claimed');
          renaming = false;
          if (after) { await after(); }
          else { await refresh(); renderFriends(); }
        } else { msg.className = 'soc-err'; msg.textContent = (r && r.error) || 'Could not claim that handle.'; }
      } catch (e) { msg.textContent = 'Network error — try again.'; }
      claimBusy = false;
      const b2 = overlay.querySelector('#socClaimBtn'); if (b2) b2.disabled = false;
    };
  }

  /* ---------- handle search + add ---------- */
  let searchTimer = null, searchBusy = false;
  async function doSearch() {
    const input = overlay.querySelector('#socSearch'), out = overlay.querySelector('#socResults'), msg = overlay.querySelector('#socAddMsg');
    if (!input || !out) return;
    const q = input.value.trim();
    if (msg) msg.textContent = '';
    if (q.length < 2) { out.innerHTML = ''; return; }
    out.innerHTML = '<div class="soc-empty" style="padding:10px">Searching…</div>';
    let r = null;
    try { r = await api('friendSearch', { q }); } catch (e) {}
    if (!input.isConnected || input.value.trim() !== q) return;   // stale response — a newer search took over
    if (!r || !r.ok) { out.innerHTML = '<div class="soc-empty" style="padding:10px">Search failed — try again.</div>'; return; }
    if (!r.results.length) { out.innerHTML = `<div class="soc-empty" style="padding:10px">Nobody's claimed a handle starting with "${esc(q)}" yet.</div>`; return; }
    out.innerHTML = r.results.map(u => {
      const btn = u.rel === 'friends' ? '<button class="soc-btn dim" disabled>Friends ✓</button>'
        : u.rel === 'pending' ? '<button class="soc-btn dim" disabled>Requested</button>'
        : u.rel === 'incoming' ? '<button class="soc-btn warm" data-sadd="accept">Accept</button>'
        : '<button class="soc-btn warm" data-sadd="add">＋ Add</button>';
      return `<div class="soc-row" data-key="${esc(u.key)}">
        ${avatarHtml({ name: u.handle, picture: u.picture })}
        <div class="soc-who"><div class="nm">@${esc(u.handle)}</div>
        <div class="sub">Lv ${levelOf(u.xp)} · ${u.elo} Elo</div></div>
        <div class="soc-acts">${btn}</div></div>`;
    }).join('');
    out.querySelectorAll('[data-sadd]').forEach(b => b.onclick = () => addFromSearch(b));
  }
  async function addFromSearch(btn) {
    if (searchBusy) return;
    searchBusy = true; btn.disabled = true;
    const key = btn.closest('.soc-row').dataset.key;
    const msg = overlay.querySelector('#socAddMsg');
    // guests attach a display name so the recipient sees who's asking
    const nameIn = overlay.querySelector('#socHandle');
    if (nameIn && nameIn.value.trim()) { try { localStorage.setItem('pl_guestName', nameIn.value.trim().slice(0, 20)); } catch (e) {} }
    try {
      const r = btn.dataset.sadd === 'accept'
        ? await api('friendRespond', { key, accept: true })
        : await api('friendRequest', { toKey: key });
      if (r && r.ok) {
        const accepted = btn.dataset.sadd === 'accept' || r.status === 'accepted';
        btn.textContent = accepted ? 'Friends ✓' : 'Requested';
        btn.className = 'soc-btn dim';
        if (msg) { msg.className = 'soc-err soc-ok'; msg.textContent = accepted ? 'You are now friends! 🎉' : 'Request sent.'; }
        ga('friend_request', { result: accepted ? 'accepted' : 'pending' });
        refresh();
      } else if (msg) { msg.className = 'soc-err'; msg.textContent = (r && r.error) || 'Something went wrong.'; }
    } catch (e) { if (msg) { msg.className = 'soc-err'; msg.textContent = 'Network error — try again.'; } }
    searchBusy = false;
  }

  async function handleAct(btn) {
    if (busy) return;
    const act = btn.dataset.act;
    const row = btn.closest('.soc-row');
    const key = row && row.dataset.key;
    const chalId = row && row.dataset.chal;
    busy = true; btn.disabled = true;
    try {
      if (act === 'profile') { busy = false; return openProfile(key); }
      if (act === 'challenge') { busy = false; return pickSport(key, row.dataset.name); }
      if (act === 'req-accept') { await api('friendRespond', { key, accept: true }); ga('friend_accept'); }
      if (act === 'req-decline' || act === 'req-cancel') await api('friendRespond', { key, accept: false });
      if (act === 'chal-accept') { busy = false; return acceptChallenge(chalId); }
      if (act === 'chal-decline') await api('challengeRespond', { id: chalId, accept: false });
      if (act === 'chal-cancel') await api('challengeRespond', { id: chalId, accept: false });
      await refresh();
      renderFriends();
    } catch (e) {}
    busy = false;
  }

  /* ---------- challenges ---------- */
  function pickSport(key, name) {
    const body = overlay.querySelector('.soc-body');
    body.innerHTML = `<div class="soc-note" style="text-align:center">Challenge <b>${esc(name || 'your friend')}</b> to a
      friendly 1v1 — build head-to-head, no Elo on the line. Pick the sport:</div>
      <div class="soc-sports">${SPORTS.map(s => `<button class="soc-sport" data-sport="${s.id}"><span class="si">${s.icon}</span>${s.label}</button>`).join('')}</div>
      <div class="soc-err" id="socChalMsg"></div>
      <button class="soc-btn dim" id="socChalBack" style="align-self:center">← Back</button>`;
    body.querySelector('#socChalBack').onclick = () => renderFriends();
    body.querySelectorAll('.soc-sport').forEach(b => b.onclick = async () => {
      const spId = b.dataset.sport, sp = sport(spId);
      const msg = body.querySelector('#socChalMsg');
      msg.textContent = 'Sending challenge…';
      try {
        const r = await api('challengeCreate', { toKey: key, sport: spId });
        if (r && r.ok) {
          ga('friend_challenge_sent', { sport: spId });
          body.innerHTML = `<div class="soc-empty" style="color:#dfe9f5">⚔️ Challenge sent!<br><br>
            <b>${esc(name || 'Your friend')}</b> will see it wherever they are on GoatLab.
            Head to the ${sp.icon} arena so you're ready the moment they accept.</div>
            <button class="soc-btn warm" id="socGoArena" style="padding:11px">⚔️ Wait in the ${sp.label} arena</button>
            <button class="soc-btn dim" id="socStay" style="align-self:center">Stay here — I'll go later</button>`;
          body.querySelector('#socGoArena').onclick = () => { location.href = sp.route + '?lobby=1'; };
          body.querySelector('#socStay').onclick = () => { refresh().then(renderFriends); };
        } else msg.textContent = (r && r.error) || 'Could not send the challenge.';
      } catch (e) { msg.textContent = 'Network error — try again.'; }
    });
  }
  async function acceptChallenge(id) {
    hideToast();
    try {
      const r = await api('challengeRespond', { id, accept: true });
      if (r && r.ok && r.status === 'accepted') {
        ga('friend_challenge_accept', { sport: r.sport });
        markSeen();
        const sp = sport(r.sport);
        location.href = sp.route + '?ch=' + encodeURIComponent(r.fromPersonId) + '&cn=' + encodeURIComponent(r.fromName);
        return;
      }
    } catch (e) {}
    refresh().then(() => { if (overlay && overlay.classList.contains('show')) renderFriends(); });
  }

  /* ---------- profile (tabbed: Overview / Friends / Stats / Settings / Style) ---------- */
  let profTab = 'overview', profData = null;
  async function openProfile(key, startTab) {
    buildOverlay();
    overlay.classList.add('show');
    renderLoading('Pulling up the card…');
    let p = null;
    try { const r = await api('profile', key ? { key } : {}); if (r && r.ok) p = r.profile; } catch (e) {}
    if (!p) { renderLoading('Could not load that profile.'); return; }
    profTab = (startTab && p.self) ? startTab : 'overview';
    profData = p;
    renderProfile();
  }
  const fmtD = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  function buildRow(b) {
    const g = GAME_META[b.game] || { icon: '🏗️', label: b.game };
    return `<div class="soc-build"><span class="gi">${g.icon}</span>
      <span class="bn">${esc(b.name)}<small>${g.label} · ${fmtD(b.created_at)}</small></span>
      <span class="ov">${b.ovr} OVR</span></div>`;
  }
  function sportRow(icon, label, s) {
    const games = s.wins + s.losses;
    const rate = games ? Math.round(100 * s.wins / games) : 0;
    return `<div class="soc-kv"><span>${icon} ${label}</span>
      <span><b>${s.elo}</b> Elo · ${s.wins}–${s.losses}${games ? ` (${rate}%)` : ''}${s.streak > 1 ? ` · 🔥${s.streak}` : ''}</span></div>`;
  }

  function profOverview(p) {
    const statCells = [
      { ic: '⚾', v: p.baseball.elo, l: `${p.baseball.wins}–${p.baseball.losses} 1v1` },
      { ic: '🏀', v: p.hoops.elo, l: `${p.hoops.wins}–${p.hoops.losses} 1v1` },
      { ic: '⚽', v: p.soccer.elo, l: `${p.soccer.wins}–${p.soccer.losses} 1v1` },
    ].map(s => `<div class="soc-stat"><div class="ic">${s.ic}</div><div class="v">${s.v}</div><div class="l">${s.l}</div></div>`).join('');
    let h2h = '';
    if (p.h2h && (p.h2h.mine || p.h2h.theirs)) {
      const lead = p.h2h.mine > p.h2h.theirs ? 'You lead' : p.h2h.mine < p.h2h.theirs ? 'They lead' : 'All square';
      h2h = `<div class="soc-h2h">HEAD-TO-HEAD · ${lead} ${p.h2h.mine}–${p.h2h.theirs}</div>`;
    }
    const topSorted = (p.topBuilds || []).slice().sort((x, y) => y.ovr - x.ovr);
    const buildsHtml = topSorted.length
      ? `<div class="soc-sec">Top builds</div>${topSorted.map(buildRow).join('')}
         <div class="soc-sec">Recent builds</div>${(p.recentBuilds || []).map(buildRow).join('')}`
      : `<div class="soc-empty">${p.guest
          ? 'Guest account — builds only save to a Hall of Fame after signing in with Google.'
          : 'No Hall of Fame builds saved yet.'}</div>`;
    return `<div class="soc-stats">${statCells}</div>
      ${h2h}
      ${buildsHtml}
      ${!p.self ? `<button class="soc-btn warm" id="socProfChal" style="padding:11px">⚔️ Challenge to a 1v1</button>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <button class="soc-btn dim" id="socProfBack">← Friends</button>
        <button class="soc-btn danger" id="socProfRemove">Remove friend</button>
      </div>` : `<button class="soc-btn dim" id="socProfBack" style="align-self:flex-start">← Friends</button>`}`;
  }

  function profFriends(p) {
    const list = p.friends || [];
    if (!list.length) return `<div class="soc-empty">${p.self
      ? 'No friends yet — find some in the 🔎 Find tab.'
      : 'No friends to show yet.'}</div>`;
    return list.map(f => {
      const btn = f.rel === 'you' ? '<button class="soc-btn dim" disabled>You</button>'
        : f.rel === 'friends' ? '<button class="soc-btn" data-pf="profile">Profile</button>'
        : f.rel === 'pending' ? '<button class="soc-btn dim" disabled>Requested</button>'
        : f.rel === 'incoming' ? '<button class="soc-btn warm" data-pf="accept">Accept</button>'
        : '<button class="soc-btn warm" data-pf="add">＋ Add</button>';
      return `<div class="soc-row ${f.online ? 'online' : ''}" data-key="${esc(f.key)}">
        ${avatarHtml(f)}
        <div class="soc-who"><div class="nm">${esc(f.name)}</div>
        <div class="sub">Lv ${levelOf(f.xp)} · ${f.elo} Elo${f.online ? ' · <span style="color:#39d98a">online</span>' : ''}</div></div>
        <div class="soc-acts">${btn}</div></div>`;
    }).join('');
  }

  function profStats(p) {
    const st = p.stats || {};
    const builds = st.builds || [];
    const totalGames = ['baseball', 'hoops', 'soccer'].reduce((s, k) => s + p[k].wins + p[k].losses, 0);
    const buildRows = builds.length
      ? builds.map(b => {
          const g = GAME_META[b.game] || { icon: '🏗️', label: b.game };
          return `<div class="soc-kv"><span>${g.icon} ${g.label}s</span><span><b>${b.count}</b> saved · best <b>${b.best}</b> OVR</span></div>`;
        }).join('')
      : `<div class="soc-empty" style="padding:12px">${p.guest ? 'Guest account — no Hall of Fame saves.' : 'No builds saved yet.'}</div>`;
    return `<div class="soc-sec">1v1 record${totalGames ? ` · ${totalGames} matches` : ''}</div>
      ${sportRow('⚾', 'Baseball', p.baseball)}
      ${sportRow('🏀', 'Hoops', p.hoops)}
      ${sportRow('⚽', 'Soccer', p.soccer)}
      <div class="soc-sec">Hall of Fame builds · ${st.buildsTotal || 0} saved</div>
      ${buildRows}
      <div class="soc-sec">Progress</div>
      <div class="soc-kv"><span>⭐ Level</span><span><b>${levelOf(p.xp)}</b> · ${(p.xp || 0).toLocaleString()} XP</span></div>
      <div class="soc-kv"><span>🏅 Achievements</span><span><b>${(st.achievements || 0)}</b> unlocked</span></div>
      <div class="soc-kv"><span>🔥 Daily streak</span><span><b>${st.dailyStreak || 0}</b> now · best ${st.bestDailyStreak || 0}</span></div>`;
  }

  function profSettings(p) {
    if (!acct()) {
      return `<div class="soc-note">You're playing as a <b>guest</b>. Your display name (what friends see):</div>
        <input class="soc-input" id="socGuestName" maxlength="20" placeholder="Your name" style="text-transform:none" value="${esc(handle())}">
        <button class="soc-btn warm" id="socGuestSave" style="padding:10px">Save name</button>
        <div class="soc-err" id="socSetMsg"></div>
        <div class="soc-note">Sign in with Google (☰ menu) to claim a unique <b>@handle</b>, keep your friends
        list across devices, and save builds to your Hall of Fame.</div>`;
    }
    return `<div class="soc-note">Your unique handle — friends find you by searching it. Changing it frees the old one for someone else.</div>
      <div style="display:flex;gap:8px"><input class="soc-input" id="socClaim" maxlength="20" placeholder="YourHandle" style="text-transform:none;flex:1" value="${esc(p.handle || '')}">
      <button class="soc-btn warm" id="socClaimBtn">${p.handle ? 'Change' : 'Claim'}</button></div>
      <div class="soc-err" id="socClaimMsg"></div>
      <div class="soc-note">Handles are 3–20 letters, numbers, or underscores — unique across GoatLab, first come, first served.</div>`;
  }

  function profStyle(p) {
    const cur = p.avatar || myAvatar();
    const cells = Object.keys(AVATARS).map(id => {
      const a = AVATARS[id];
      const un = avatarUnlocked(id);
      const sel = un && cur === id;
      return `<div class="soc-avcell${sel ? ' sel' : ''}${un ? '' : ' lock'}" data-av="${id}" title="${esc(a.name)}">
        <div class="soc-av" style="background:${a.bg}">${avatarInner(a)}</div>
        <span class="nm">${esc(a.name)}</span>
        ${un ? '' : '<span class="lk">🔒</span>'}</div>`;
    }).join('');
    return `<div class="soc-note">Pick your avatar — friends see it everywhere your name shows up.
      🔒 ones are <b>Season Track rewards</b>: earn XP while a season is live and they unlock forever.</div>
      <div class="soc-avgrid">
        <div class="soc-avcell${!cur ? ' sel' : ''}" data-av="" title="Default">
          <div class="soc-av">${esc((p.name || 'P').charAt(0).toUpperCase())}</div>
          <span class="nm">Default</span></div>
        ${cells}</div>
      <div class="soc-err" id="socAvMsg"></div>
      <button class="soc-btn" id="socOpenTrack" style="padding:10px">🎟️ Open the Season Track</button>`;
  }

  function renderProfile() {
    const p = profData;
    if (!p || !overlay) return;
    const since = p.memberSince ? new Date(p.memberSince).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
    const tabs = [
      ['overview', 'Overview'],
      ['friends', `Friends${(p.friends || []).length ? ` (${p.friends.length})` : ''}`],
      ['stats', 'Stats'],
    ];
    if (p.self) { tabs.push(['settings', 'Settings'], ['style', 'Style']); }
    const bodies = { overview: profOverview, friends: profFriends, stats: profStats, settings: profSettings, style: profStyle };
    overlay.innerHTML = `<div class="soc-panel"><button class="soc-x">✕</button>
      <div class="soc-head" style="padding-bottom:0">
        <div class="soc-phead">
          ${avatarHtml(p)}
          <div><div class="soc-pname">${p.handle ? '@' : ''}${esc(p.name)}</div>
          <div class="soc-psub"><span class="soc-lvl">LV ${levelOf(p.xp)}</span>${since ? 'Playing since ' + since : ''}${p.online ? ' · <span style="color:#39d98a">online now</span>' : ''}</div></div>
        </div>
        <div class="soc-tabs" style="padding:12px 0 0">
          ${tabs.map(([id, label]) => `<button class="soc-tab ${profTab === id ? 'active' : ''}" data-ptab="${id}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="soc-body">${(bodies[profTab] || profOverview)(p)}</div></div>`;
    overlay.querySelector('.soc-x').onclick = close;
    overlay.querySelectorAll('[data-ptab]').forEach(b => b.onclick = () => { profTab = b.dataset.ptab; renderProfile(); });
    wireProfileBody(p);
  }

  function wireProfileBody(p) {
    const back = overlay.querySelector('#socProfBack');
    if (back) back.onclick = () => { if (data) renderFriends(); else open(); };   // profile can open before the first poll
    const chal = overlay.querySelector('#socProfChal');
    if (chal) chal.onclick = () => { tab = 'friends'; renderFriends(); pickSport(p.key, p.name); };
    const rm = overlay.querySelector('#socProfRemove');
    if (rm) rm.onclick = async () => {
      if (!confirm(`Remove ${p.name} from your friends?`)) return;
      try { await api('friendRemove', { key: p.key }); } catch (e) {}
      await refresh();
      renderFriends();
    };
    // friends-of-friends rows: view mutuals, accept, or add
    overlay.querySelectorAll('[data-pf]').forEach(b => b.onclick = async () => {
      const k = b.closest('.soc-row').dataset.key;
      const act = b.dataset.pf;
      if (act === 'profile') return openProfile(k);
      b.disabled = true;
      try {
        const r = act === 'accept'
          ? await api('friendRespond', { key: k, accept: true })
          : await api('friendRequest', { toKey: k });
        if (r && r.ok) {
          b.textContent = (act === 'accept' || r.status === 'accepted') ? 'Friends ✓' : 'Requested';
          b.className = 'soc-btn dim';
          refresh();
        } else b.disabled = false;
      } catch (e) { b.disabled = false; }
    });
    // style tab: avatar picker (locked cells explain their Season Track source)
    overlay.querySelectorAll('[data-av]').forEach(c => c.onclick = async () => {
      const id = c.dataset.av;
      if (id && !avatarUnlocked(id)) {
        const a = AVATARS[id];
        const msg = overlay.querySelector('#socAvMsg');
        if (msg) msg.textContent = `🔒 ${a.name} is a ${a.track === 's1' ? 'Season 1' : 'future season'} Track reward — earn XP while the season is live to unlock it.`;
        return;
      }
      await setAvatar(id || null);
      ga('avatar_set', { avatar: id || 'default' });
      profData.avatar = id || null;
      renderProfile();
    });
    const trackBtn = overlay.querySelector('#socOpenTrack');
    if (trackBtn) trackBtn.onclick = () => { close(); if (window.SeasonTrack) SeasonTrack.open(); };
    // settings tab: signed-in handle management (reuses the claim wiring)...
    wireClaim(async () => { await refresh(); openProfile(null); });
    // ...or the guest display-name saver
    const gsave = overlay.querySelector('#socGuestSave');
    if (gsave) gsave.onclick = () => {
      const v = (overlay.querySelector('#socGuestName').value || '').trim().slice(0, 20);
      const msg = overlay.querySelector('#socSetMsg');
      if (!v) { if (msg) msg.textContent = 'Enter a name.'; return; }
      try { localStorage.setItem('pl_guestName', v); } catch (e) {}
      api('friendList');   // any authenticated call pushes the new name to the server
      if (msg) { msg.className = 'soc-err soc-ok'; msg.textContent = 'Saved — friends will see this name.'; }
    };
  }

  /* ---------- wiring ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('#miFriends, [data-social-open]');
    if (t) { e.preventDefault(); open(); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startPolling);
  else startPolling();

  window.Social = { open, openProfile, refresh, setAvatar, count: pendingCount };
})();
