/* ============================================================================
   GoatLab — Season Track: monthly themed reward track (skeleton v1).
   Included (defer, AFTER xp.js) by every game + versus page. Exposes
   window.SeasonTrack. Companion to quests.js / xp.js, same drop-in pattern
   (IIFE, injected CSS, localStorage).

   How it works:
     - Seasons share the 1v1 Elo season clock: Season 1 = 2026-07-15 UTC,
       monthly rollover. Before kickoff the track is a teaser + countdown.
     - Season XP ("SXP") = every XP point earned while a season is active.
       We wrap XP.award (like xp.js wraps Ach.unlock), so builds, careers,
       quests, achievements, and 1v1 all feed the track automatically.
     - Crossing a tier's SXP requirement unlocks its reward permanently
       (inventory survives rollover; only SXP resets each season).
     - v1 rewards that WORK: card frames (career card + share image) and
       profile titles. Skins / animated backdrops / boosts show as SOON.
   ========================================================================== */
(function () {
  'use strict';

  // ---- season clock ----------------------------------------------------------
  // MUST stay byte-identical to api/account.js + versus.html (a Node test compares
  // the three). To move kickoff, change the constant in ALL THREE files.
  const SEASON1_START_MS = Date.UTC(2026, 6, 15);   // 2026-07-15 UTC — keep in sync with the server
  function addUTCMonths(ms, k){ const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + k); return d.getTime(); }
  // dev override: ?season=<epochMs> pretends "now" is that instant (preview post-kickoff UI).
  // Caveat: post-launch, time-travelling triggers the lazy rollover and resets your real SXP.
  let _seasonNowOverride = 0;
  try { const q = new URLSearchParams(location.search).get('season'); const v = q ? Number(q) : 0; if (v > 0) _seasonNowOverride = v; } catch (e) {}
  function seasonNow(){ return _seasonNowOverride || Date.now(); }
  function seasonInfo(nowMs){
    nowMs = nowMs || seasonNow();
    if (nowMs < SEASON1_START_MS) return { number:0, startMs:null, endMs:SEASON1_START_MS };
    const a = new Date(SEASON1_START_MS), n = new Date(nowMs);
    let m = (n.getUTCFullYear() - a.getUTCFullYear()) * 12 + (n.getUTCMonth() - a.getUTCMonth());
    if (nowMs < addUTCMonths(SEASON1_START_MS, m)) m -= 1;
    return { number:m+1, startMs:addUTCMonths(SEASON1_START_MS, m), endMs:addUTCMonths(SEASON1_START_MS, m+1) };
  }
  function fmtCountdown(ms){
    if (ms <= 0) return 'soon';
    const d = Math.floor(ms/86400000), h = Math.floor(ms%86400000/3600000), mn = Math.floor(ms%3600000/60000);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${mn}m`;
    return `${mn}m`;
  }

  // ---- cosmetics + season registry --------------------------------------------
  // `soon` items are earnable placeholders: they unlock into the inventory but can't
  // be equipped yet — they light up retroactively when their plumbing ships.
  const COSMETICS = {
    title_original: { type: 'title', name: 'Season One Original',   icon: '🎖️' },
    frame_cyan:     { type: 'frame', name: 'Circuit Cyan',          icon: '🟦', cls: 'st-frame-cyan' },
    scout_2:        { type: 'item',  name: 'Scout Tokens ×2',       icon: '🔭', item: 'scout', qty: 2 },
    title_grinder:  { type: 'title', name: 'The Grinder',           icon: '⚙️' },
    frame_gold:     { type: 'frame', name: 'Gold Leaf',             icon: '🟨', cls: 'st-frame-gold' },
    trail_comet:    { type: 'trail', name: 'Comet Reel Trail',      icon: '☄️' },
    resim_2:        { type: 'item',  name: 'Re-sim Tokens ×2',      icon: '🔁', item: 'resim', qty: 2 },
    title_goat:     { type: 'title', name: 'Opening Day GOAT',      icon: '🐐' },
    scout_3:        { type: 'item',  name: 'Scout Tokens ×3',       icon: '🔭', item: 'scout', qty: 3 },
    frame_holo:     { type: 'frame', name: 'Holo Legend',           icon: '🌈', cls: 'st-frame-holo' },
    // profile avatars — ids must match the AVATARS registry in social.js; unlocking here
    // makes them selectable in the profile's Style tab (equip lives there, not in the track)
    av_goat_crown:  { type: 'avatar', name: 'Crowned GOAT Avatar',  icon: '👑' },
    av_flame_ball:  { type: 'avatar', name: 'Heat Check Avatar',    icon: '🔥' },
    av_octo_keeper: { type: 'avatar', name: 'Octo Keeper Avatar',   icon: '🐙' },
    av_golden_goat: { type: 'avatar', name: 'Golden GOAT Avatar',   icon: '🐐' },
  };
  // "frame" = the CAREER card (the shareable trophy) — never the reel cards, whose
  // borders are tier information (grey→legend) that cosmetics must not repaint.
  // "item" = consumables (Scout = peek the next spin; Re-sim = re-roll a finished career).
  const TYPE_LABEL = { frame: 'Career Card Frame', title: 'Title', trail: 'Reel Effect', item: 'Consumable', avatar: 'Profile Avatar' };
  // Define SEASONS[2] before 2026-08-15 — an undefined month falls back to re-running
  // this track (already-owned rewards just show as unlocked, nothing new to earn).
  const SEASONS = {
    1: { name: 'Opening Day', icon: '⚾', tiers: [
      { req: 100,  id: 'title_original' },
      { req: 200,  id: 'av_goat_crown' },
      { req: 300,  id: 'frame_cyan' },
      { req: 600,  id: 'scout_2' },
      { req: 1000, id: 'title_grinder' },
      { req: 1250, id: 'av_flame_ball' },
      { req: 1500, id: 'frame_gold' },
      { req: 2100, id: 'trail_comet' },
      { req: 2800, id: 'resim_2' },
      { req: 3200, id: 'av_octo_keeper' },
      { req: 3600, id: 'title_goat' },
      { req: 4500, id: 'scout_3' },
      { req: 5500, id: 'frame_holo' },
      { req: 6200, id: 'av_golden_goat' },
    ] },
  };
  const seasonDef = n => SEASONS[n] || { name: `Season ${n}`, icon: '🏟️', tiers: SEASONS[1].tiers };
  const FRAME_CLASSES = Object.values(COSMETICS).filter(c => c.cls).map(c => c.cls);

  // ---- persistent state --------------------------------------------------------
  // pl_track = { season, sxp, unlocked:{id:1}, equipped:{frame,title} }.
  // unlocked/equipped are the permanent inventory; season+sxp reset on rollover.
  const KEY = 'pl_track';
  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!s || typeof s !== 'object') s = { season: 0, sxp: 0, unlocked: {}, equipped: {}, items: {} };
    if (!s.unlocked || typeof s.unlocked !== 'object') s.unlocked = {};
    if (!s.equipped || typeof s.equipped !== 'object') s.equipped = {};
    if (!s.items || typeof s.items !== 'object') s.items = {};
    s.sxp = Math.max(0, Math.round(Number(s.sxp) || 0));
    const cur = seasonInfo().number;
    if (s.season !== cur) { s.season = cur; s.sxp = 0; save(s); }   // lazy monthly rollover
    return s;
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }

  // ---- account sync (mirrors the always-merge posture of collectionSync) --------
  function acct() { try { return JSON.parse(localStorage.getItem('pl_account') || 'null'); } catch (e) { return null; } }
  let syncTimer = null;
  async function serverSync() {
    const a = acct();
    if (!a || !a.sub || !a.sessionToken) return;
    const s = load();
    try {
      const r = await fetch('/api/account', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'trackSync', sub: a.sub, sessionToken: a.sessionToken,
          season: s.season, sxp: s.sxp, unlocked: s.unlocked, equipped: s.equipped, items: s.items }),
      }).then(x => x.json());
      if (r && r.ok && r.cosmetics) {
        const cur = load();
        if (r.cosmetics.unlocked) cur.unlocked = r.cosmetics.unlocked;
        if (r.cosmetics.equipped) cur.equipped = r.cosmetics.equipped;
        if (r.cosmetics.items) cur.items = r.cosmetics.items;
        const sx = Number((r.cosmetics.seasons || {})[String(cur.season)]) || 0;
        if (sx > cur.sxp) cur.sxp = sx;
        save(cur); applyFrame(); mount(); renderIfOpen();
      }
    } catch (e) {}
  }
  function queueSync() { clearTimeout(syncTimer); syncTimer = setTimeout(serverSync, 800); }
  function signOut() { try { localStorage.removeItem(KEY); } catch (e) {} applyFrame(); mount(); renderIfOpen(); }

  // ---- styles --------------------------------------------------------------------
  const css = `
  .st-ov{ position:fixed; inset:0; z-index:300; display:none; align-items:center; justify-content:center; padding:14px;
    background:rgba(2,5,10,.72); backdrop-filter:blur(3px); }
  .st-ov.show{ display:flex; }
  .st-card{ position:relative; width:100%; max-width:560px; max-height:90dvh; display:flex; flex-direction:column;
    border:1px solid var(--line,rgba(120,150,190,.16)); border-radius:16px;
    background:linear-gradient(180deg, rgba(20,31,48,.85), rgba(9,15,25,.95)); backdrop-filter:blur(6px);
    box-shadow:0 18px 60px rgba(0,0,0,.6); overflow:hidden; }
  .st-head{ display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid var(--line,rgba(120,150,190,.16)); }
  .st-head .tt{ font-family:'Oswald',sans-serif; font-size:16px; letter-spacing:2px; text-transform:uppercase; }
  .st-head .tt b{ color:var(--accent2,#19c6ff); }
  .st-timer{ font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:1px; color:var(--muted,#7e8da3); }
  .st-x{ margin-left:auto; font-size:16px; line-height:1; padding:6px 11px; border-radius:8px; color:var(--ink,#eaf2fb);
    background:rgba(255,255,255,.04); border:1px solid var(--line,rgba(120,150,190,.16)); cursor:pointer; }
  .st-x:hover{ border-color:var(--accent2,#19c6ff); }
  .st-sum{ padding:13px 16px 4px; }
  .st-sum .ss-top{ display:flex; align-items:baseline; gap:8px; font-family:'Oswald',sans-serif; }
  .st-sum .ss-sxp{ font-weight:700; font-size:18px; letter-spacing:.5px; color:var(--gold,#ffce3a); }
  .st-sum .ss-lbl{ font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted,#7e8da3); }
  .st-sum .ss-next{ margin-left:auto; font-size:11px; letter-spacing:.5px; color:var(--dim,#56627a); font-family:'Oswald',sans-serif; }
  .st-sum .ss-inv{ margin-top:8px; font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:.8px; color:var(--gold,#ffce3a); }
  .st-sum .ss-track{ position:relative; height:8px; margin-top:7px; border-radius:5px; overflow:hidden; background:rgba(120,150,190,.16); }
  .st-sum .ss-fill{ position:absolute; inset:0 auto 0 0; border-radius:5px; width:0%;
    background:linear-gradient(90deg, var(--accent2,#19c6ff), var(--gold,#ffce3a)); box-shadow:0 0 10px rgba(25,198,255,.5);
    transition:width .5s cubic-bezier(.2,.8,.2,1); }
  .st-tease{ margin:12px 16px 2px; padding:11px 14px; border-radius:12px; border:1px dashed rgba(255,206,58,.4);
    font-size:12.5px; line-height:1.5; color:var(--muted,#7e8da3); }
  .st-tease b{ color:var(--gold,#ffce3a); }
  .st-list{ padding:12px 14px 14px; display:flex; flex-direction:column; gap:9px; overflow-y:auto; }
  .st-row{ display:flex; align-items:center; gap:12px; padding:11px 13px; border-radius:13px;
    border:1px solid var(--line,rgba(120,150,190,.16)); background:linear-gradient(180deg, rgba(16,32,46,.55), rgba(8,13,22,.7)); }
  .st-row.got{ border-color:rgba(255,206,58,.5); background:linear-gradient(180deg, rgba(255,206,58,.08), rgba(8,13,22,.7)); }
  .st-row.next{ border-color:rgba(25,198,255,.55); box-shadow:0 0 16px rgba(25,198,255,.12); }
  .st-tier{ flex:0 0 34px; text-align:center; font-family:'Oswald',sans-serif; font-weight:700; font-size:13px; color:var(--accent2,#19c6ff);
    border:1px solid rgba(25,198,255,.35); border-radius:9px; padding:6px 0; background:rgba(25,198,255,.07); }
  .st-row.got .st-tier{ color:var(--gold,#ffce3a); border-color:rgba(255,206,58,.5); background:rgba(255,206,58,.08); }
  .st-ico{ font-size:24px; line-height:1; flex:0 0 auto; }
  .st-row:not(.got) .st-ico{ filter:grayscale(.5) brightness(.8); }
  .st-body{ flex:1; min-width:0; }
  .st-name{ font-family:'Oswald',sans-serif; font-weight:700; font-size:14.5px; letter-spacing:.4px; color:var(--ink,#eaf2fb); }
  .st-row.got .st-name{ color:var(--gold,#ffce3a); }
  .st-kind{ font-size:10.5px; letter-spacing:1.2px; text-transform:uppercase; color:var(--muted,#7e8da3); margin-top:2px; font-family:'Oswald',sans-serif; }
  .st-right{ flex:0 0 auto; text-align:right; }
  .st-req{ font-family:'Oswald',sans-serif; font-size:12px; letter-spacing:.5px; color:var(--dim,#56627a); }
  .st-soon{ font-family:'Oswald',sans-serif; font-size:10px; font-weight:600; letter-spacing:1.5px; padding:4px 8px; border-radius:7px;
    color:var(--muted,#7e8da3); border:1px dashed var(--line,rgba(120,150,190,.3)); }
  .st-eq{ font-family:'Oswald',sans-serif; font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase;
    padding:6px 11px; border-radius:8px; cursor:pointer; color:var(--accent2,#19c6ff);
    border:1px solid rgba(25,198,255,.45); background:rgba(25,198,255,.07); }
  .st-eq.on{ color:#0a1220; background:var(--gold,#ffce3a); border-color:var(--gold,#ffce3a); }
  .st-toast{ position:fixed; top:18px; right:18px; z-index:340; display:none; align-items:center; gap:13px;
    padding:13px 18px 13px 14px; min-width:290px; border-radius:13px; border:1px solid rgba(255,206,58,.55);
    background:linear-gradient(180deg, rgba(20,31,48,.94), rgba(9,15,25,.96)); backdrop-filter:blur(6px);
    box-shadow:0 14px 44px rgba(0,0,0,.55), 0 0 26px rgba(255,206,58,.16); }
  .st-toast .ti{ font-size:32px; }
  .st-toast .tl{ font-family:'Oswald',sans-serif; font-size:11px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:var(--gold,#ffce3a); }
  .st-toast .tnm{ font-family:'Oswald',sans-serif; font-size:18px; font-weight:700; letter-spacing:.5px; margin-top:1px; color:var(--ink,#eaf2fb); }
  .st-toast .tds{ font-size:11px; color:var(--accent2,#19c6ff); margin-top:3px; font-family:'Oswald',sans-serif; letter-spacing:.5px; }
  .st-trail-p{ position:fixed; z-index:60; width:7px; height:7px; border-radius:50%; pointer-events:none;
    background:radial-gradient(circle, #fff, #19c6ff 60%, transparent);
    box-shadow:0 0 10px #19c6ff, 0 0 20px rgba(25,198,255,.55); }
  /* in-game Scout button + "next spin" peek chip (markup lives in each game, styled here) */
  .scout-btn{ font-family:'Oswald',sans-serif; font-size:13px; font-weight:600; letter-spacing:.5px; cursor:pointer;
    padding:10px 14px; border-radius:11px; color:var(--accent2,#19c6ff);
    border:1px solid rgba(25,198,255,.45); background:rgba(25,198,255,.07); }
  .scout-btn:disabled{ opacity:.45; cursor:default; }
  .scout-peek{ display:flex; align-items:center; justify-content:center; gap:9px; margin:9px auto 0; padding:8px 14px;
    max-width:320px; border-radius:12px; border:1px solid rgba(25,198,255,.5);
    background:linear-gradient(180deg, rgba(16,32,46,.8), rgba(8,13,22,.85));
    box-shadow:0 0 18px rgba(25,198,255,.18); font-size:13px; color:var(--ink,#eaf2fb); }
  .scout-peek img{ width:30px; height:30px; border-radius:50%; object-fit:cover; background:#11161d; }
  .scout-peek b{ font-family:'Oswald',sans-serif; letter-spacing:.4px; }
  .st-title-chip{ display:inline-flex; align-items:center; gap:6px; margin:0 0 10px; padding:5px 11px; border-radius:9px;
    font-family:'Oswald',sans-serif; font-size:12px; font-weight:600; letter-spacing:1px; text-transform:uppercase;
    color:var(--gold,#ffce3a); border:1px solid rgba(255,206,58,.4); background:rgba(255,206,58,.07); }
  /* equipable card frames — shared by the real career card AND the panel's mini preview */
  .st-frame-cyan{ border:2px solid #19c6ff !important;
    box-shadow:0 0 0 1px rgba(25,198,255,.35), 0 0 22px rgba(25,198,255,.6), 0 14px 44px rgba(0,0,0,.5) !important; }
  .st-frame-gold{ border:2px solid #ffce3a !important;
    box-shadow:0 0 0 1px rgba(255,206,58,.4), 0 0 24px rgba(255,206,58,.6), 0 14px 44px rgba(0,0,0,.5) !important; }
  @property --stg { syntax:'<angle>'; initial-value:135deg; inherits:false; }
  .st-frame-holo{ border:3px solid transparent !important;
    background:linear-gradient(#0c131e,#0c131e) padding-box,
      conic-gradient(from var(--stg,135deg), #19c6ff, #c86bff, #ffce3a, #43e97b, #19c6ff) border-box !important;
    box-shadow:0 0 26px rgba(200,107,255,.55), 0 14px 44px rgba(0,0,0,.5) !important;
    animation:st-holo-spin 5s linear infinite; }
  @keyframes st-holo-spin { to { --stg:495deg; } }
  /* mini preview card at the top of the panel (instant feedback when equipping) */
  .st-preview{ display:flex; align-items:center; gap:14px; margin:12px 16px 0; padding:12px 14px; border-radius:12px;
    border:1px solid var(--line,rgba(120,150,190,.16)); background:rgba(8,13,22,.55); }
  .st-mini{ flex:0 0 96px; height:64px; border-radius:9px; border:1px solid var(--line,rgba(120,150,190,.3));
    background:#0c131e; overflow:hidden; }
  .st-mini .m-top{ height:24px; background:linear-gradient(135deg,#2d5f8a,#12283c); }
  .st-mini .m-line{ height:6px; margin:7px 10px 0; border-radius:3px; background:rgba(120,150,190,.25); }
  .st-mini .m-line.short{ width:55%; }
  .st-prev-body{ flex:1; min-width:0; }
  .st-prev-lbl{ font-family:'Oswald',sans-serif; font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted,#7e8da3); }
  .st-prev-name{ font-family:'Oswald',sans-serif; font-weight:700; font-size:14px; letter-spacing:.5px; color:var(--ink,#eaf2fb); margin-top:3px; }
  .st-prev-body .st-title-chip{ margin:7px 0 0; }
  @media (max-width:680px){
    .st-ov{ padding:10px; }
    .st-toast{ left:10px; right:10px; min-width:0; top:12px; }
  }`;

  let chromeReady = false, ov, listEl, sumEl, prevEl, teaseEl, timerEl, headEl, toastEl, timerInt;
  function ensureChrome() {
    if (chromeReady) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    toastEl = document.createElement('div'); toastEl.className = 'st-toast';
    toastEl.innerHTML = '<span class="ti"></span><div><div class="tl">Season Reward Unlocked</div><div class="tnm"></div><div class="tds"></div></div>';
    document.body.appendChild(toastEl);
    chromeReady = true;
  }
  function buildDom() {
    ensureChrome();
    if (ov) return;
    ov = document.createElement('div'); ov.className = 'st-ov';
    ov.innerHTML = `
      <div class="st-card">
        <div class="st-head">
          <span class="tt"></span>
          <span class="st-timer"></span>
          <button class="st-x" aria-label="Close">✕</button>
        </div>
        <div class="st-sum"></div>
        <div class="st-preview"></div>
        <div class="st-tease" style="display:none"></div>
        <div class="st-list"></div>
      </div>`;
    document.body.appendChild(ov);
    headEl = ov.querySelector('.tt');
    listEl = ov.querySelector('.st-list');
    sumEl = ov.querySelector('.st-sum');
    prevEl = ov.querySelector('.st-preview');
    teaseEl = ov.querySelector('.st-tease');
    timerEl = ov.querySelector('.st-timer');
    ov.querySelector('.st-x').onclick = close;
    ov.onclick = e => { if (e.target === ov) close(); };
  }

  function timerText() {
    const info = seasonInfo();
    return info.number < 1
      ? `Season 1 starts in ${fmtCountdown(info.endMs - seasonNow())}`
      : `Season ends in ${fmtCountdown(info.endMs - seasonNow())}`;
  }

  function render() {
    buildDom();
    const info = seasonInfo();
    const s = load();
    const active = info.number >= 1;
    const showN = active ? info.number : 1;              // preseason previews Season 1
    const def = seasonDef(showN);
    headEl.innerHTML = `${def.icon} <b>Season ${showN}</b> · ${def.name}`;
    timerEl.textContent = timerText();

    teaseEl.style.display = active ? 'none' : 'block';
    teaseEl.innerHTML = `<b>Season 1 kicks off soon.</b> Once it starts, every XP you earn — builds, careers,
      quests, achievements, 1v1 — also fills this track. Rewards you unlock are yours forever.`;

    // live "your card look" preview — instant feedback the moment a frame/title is equipped
    const fId = equippedOf('frame'), tId = equippedOf('title');
    prevEl.innerHTML = `
      <div class="st-mini${fId ? ' ' + COSMETICS[fId].cls : ''}"><div class="m-top"></div><div class="m-line"></div><div class="m-line short"></div></div>
      <div class="st-prev-body">
        <div class="st-prev-lbl">Your card look</div>
        <div class="st-prev-name">${fId ? COSMETICS[fId].name : 'No frame equipped'}</div>
        ${tId ? `<div class="st-title-chip">${COSMETICS[tId].icon} ${COSMETICS[tId].name}</div>` : ''}
      </div>`;

    const tiers = def.tiers;
    const nextTier = tiers.find(t => !s.unlocked[t.id] && t.req > s.sxp);
    const inv = [['scout', '🔭 Scout'], ['resim', '🔁 Re-sim']]
      .filter(([k]) => (Number(s.items[k]) || 0) > 0)
      .map(([k, lbl]) => `${lbl} ×${s.items[k]}`).join(' · ');
    sumEl.innerHTML = active ? `
      <div class="ss-top"><span class="ss-sxp">${s.sxp.toLocaleString()}</span><span class="ss-lbl">Season XP</span>
        <span class="ss-next">${nextTier ? `next reward at ${nextTier.req.toLocaleString()}` : 'track complete!'}</span></div>
      <div class="ss-track"><div class="ss-fill" style="width:${nextTier ? Math.min(100, (s.sxp / nextTier.req) * 100) : 100}%"></div></div>
      ${inv ? `<div class="ss-inv">Inventory: ${inv}</div>` : ''}` : '';

    listEl.innerHTML = tiers.map((t, i) => {
      const c = COSMETICS[t.id] || { type: 'skin', name: t.id, icon: '🎁' };
      const got = !!s.unlocked[t.id];
      const isNext = nextTier && nextTier.id === t.id;
      const equipable = got && !c.soon && EQUIPABLE[c.type];
      const on = equipable && s.equipped[c.type] === t.id;
      const right = got
        ? (c.soon ? '<span class="st-soon">SOON</span>'
          : c.type === 'avatar' ? '<button class="st-eq" data-av-open="1">Use in Profile</button>'
          : equipable ? `<button class="st-eq${on ? ' on' : ''}" data-eq="${t.id}">${on ? 'Equipped' : 'Equip'}</button>` : '✅')
        : `<span class="st-req">${t.req.toLocaleString()} SXP</span>`;
      return `<div class="st-row${got ? ' got' : ''}${isNext ? ' next' : ''}">
        <span class="st-tier">${i + 1}</span>
        <span class="st-ico">${c.icon}</span>
        <div class="st-body"><div class="st-name">${c.name}</div><div class="st-kind">${TYPE_LABEL[c.type] || c.type}${c.soon ? ' · coming soon' : ''}</div></div>
        <div class="st-right">${right}</div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('[data-eq]').forEach(b => { b.onclick = () => equip(b.dataset.eq); });
    // avatars equip in the profile's Style tab (social.js owns the server-visible avatar)
    listEl.querySelectorAll('[data-av-open]').forEach(b => {
      b.onclick = () => { close(); if (window.Social) Social.openProfile(null, 'style'); };
    });
  }
  function renderIfOpen() { if (ov && ov.classList.contains('show')) render(); }

  function open() {
    render();
    ov.classList.add('show');
    clearInterval(timerInt);
    timerInt = setInterval(() => { if (timerEl) timerEl.textContent = timerText(); }, 30000);
    if (window.gsap) {
      gsap.fromTo(ov.querySelector('.st-card'), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .3, ease: 'power3.out' });
      gsap.fromTo(ov.querySelectorAll('.st-row'), { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: .3, stagger: .04, delay: .08, ease: 'power2.out' });
    }
  }
  function close() { clearInterval(timerInt); if (ov) ov.classList.remove('show'); }

  // ---- unlock toast + chime -----------------------------------------------------
  let actx;
  function chime() {
    if ((window.Ach && Ach.muted) || (window.XP && XP.muted)) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        const t = now + i * 0.07;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.45);
      });
    } catch (e) {}
  }
  const toastQ = [];
  let toastBusy = false;
  function showToast(icon, name, sub) { toastQ.push({ icon, name, sub }); pumpToast(); }
  function pumpToast() {
    ensureChrome();
    if (toastBusy || !toastQ.length) return;
    toastBusy = true;
    const t = toastQ.shift();
    toastEl.querySelector('.ti').textContent = t.icon;
    toastEl.querySelector('.tnm').textContent = t.name;
    toastEl.querySelector('.tds').textContent = t.sub;
    toastEl.style.display = 'flex';
    chime();
    if (window.gsap) {
      gsap.killTweensOf(toastEl);
      gsap.fromTo(toastEl, { x: 90, opacity: 0 }, { x: 0, opacity: 1, duration: .5, ease: 'back.out(1.6)' });
    }
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => {
      const done = () => { toastEl.style.display = 'none'; toastBusy = false; pumpToast(); };
      if (window.gsap) gsap.to(toastEl, { x: 90, opacity: 0, duration: .35, ease: 'power2.in', onComplete: done });
      else done();
    }, toastQ.length ? 2200 : 3200);
  }

  // ---- progression ----------------------------------------------------------------
  function addSxp(amount) {
    if (!amount) return;
    const info = seasonInfo();
    if (info.number < 1) return;                        // preseason: dormant
    const s = load();
    s.sxp += amount;
    const def = seasonDef(s.season);
    for (const [i, t] of def.tiers.entries()) {
      if (t.req <= s.sxp && !s.unlocked[t.id]) {
        s.unlocked[t.id] = 1;
        const c = COSMETICS[t.id] || { icon: '🎁', name: t.id };
        if (c.type === 'item') s.items[c.item] = (Number(s.items[c.item]) || 0) + c.qty;   // consumable grant (one-time — unlocked guards)
        showToast(c.icon, c.name, `Season ${s.season} · Tier ${i + 1}`);
      }
    }
    save(s); queueSync(); renderIfOpen();
  }

  // Wrap XP.award so every XP source feeds the track (same pattern as xp.js → Ach.unlock).
  // Server XP restores don't pass through award(), so cross-device syncs can't double-count.
  function hookXP() {
    if (!window.XP || XP.__trackHooked) return !!window.XP;
    const origAward = XP.award;
    XP.award = function (amount, reason, opts) {
      const r = origAward.apply(this, arguments);
      try { addSxp(Math.max(0, Math.round(Number(amount) || 0))); } catch (e) {}
      return r;
    };
    const origOut = XP.signOut;
    XP.signOut = function () { try { signOut(); } catch (e) {} return origOut.apply(this, arguments); };
    XP.__trackHooked = true;
    return true;
  }
  (function tryHook(n) { if (hookXP() || n <= 0) return; setTimeout(() => tryHook(n - 1), 300); })(12);

  // ---- equip + surfaces --------------------------------------------------------------
  const EQUIPABLE = { frame: 1, title: 1, trail: 1 };
  function equip(id) {
    const c = COSMETICS[id];
    const s = load();
    if (!c || !s.unlocked[id] || c.soon || !EQUIPABLE[c.type]) return;
    s.equipped[c.type] = s.equipped[c.type] === id ? null : id;   // tap again to unequip
    save(s); queueSync();
    render(); applyFrame(); mount();
  }
  function equippedOf(type) {
    const s = load();
    const id = s.equipped[type];
    return (id && s.unlocked[id] && COSMETICS[id] && !COSMETICS[id].soon) ? id : null;
  }

  // Cards register themselves once (buildCard calls applyFrame(el)); equip changes
  // re-style every registered card without the game needing to re-render.
  const framedEls = new Set();
  function applyFrame(el) {
    if (el) framedEls.add(el);
    const id = equippedOf('frame');
    const cls = id && COSMETICS[id].cls;
    framedEls.forEach(e => {
      if (!e || !e.classList) return;
      FRAME_CLASSES.forEach(f => e.classList.remove(f));
      if (cls) e.classList.add(cls);
    });
  }

  // ---- consumable inventory ------------------------------------------------------
  function items() { const s = load(); return { scout: Number(s.items.scout) || 0, resim: Number(s.items.resim) || 0 }; }
  function useItem(k) {
    const s = load();
    if (!(Number(s.items[k]) > 0)) return false;
    s.items[k] = Number(s.items[k]) - 1;
    save(s); queueSync(); renderIfOpen();
    return true;
  }

  // ---- reel trail (Comet) ----------------------------------------------------------
  // Games call trailTick(reelEl) from their spin loop; throttled here so the call site
  // can fire every frame. No-op unless the trail is equipped (and GSAP is around).
  let lastTrail = 0;
  function trailTick(el) {
    if (!el || !window.gsap || !equippedOf('trail')) return;
    const now = performance.now();
    if (now - lastTrail < 45) return;
    lastTrail = now;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    for (let i = 0; i < 2; i++) {
      const p = document.createElement('span');
      p.className = 'st-trail-p';
      document.body.appendChild(p);
      gsap.set(p, { left: r.left + r.width * (0.25 + Math.random() * 0.5), top: r.top + Math.random() * r.height });
      gsap.to(p, {
        x: (Math.random() - 0.5) * 70, y: 36 + Math.random() * 54,
        opacity: 0, scale: 0.2, duration: 0.55 + Math.random() * 0.4, ease: 'power1.out',
        onComplete: () => p.remove(),
      });
    }
  }

  // Fills every [data-player-title] slot with the equipped title chip (or clears it).
  function mount() {
    injectOnly();
    const id = equippedOf('title');
    const html = id ? `<div class="st-title-chip">${COSMETICS[id].icon} ${COSMETICS[id].name}</div>` : '';
    document.querySelectorAll('[data-player-title]').forEach(h => { h.innerHTML = html; });
  }
  function injectOnly() { ensureChrome(); }   // CSS must exist before chips/frames render

  // ---- public API ----------------------------------------------------------------
  window.SeasonTrack = {
    open, close, equip,
    equippedFrame: () => equippedOf('frame'),
    equippedTrail: () => equippedOf('trail'),
    equippedTitle: () => { const id = equippedOf('title'); return id ? COSMETICS[id].name : null; },
    items, useItem, trailTick,
    applyFrame, mount,
    info: () => { const i = seasonInfo(); const s = load(); return { season: i.number, endMs: i.endMs, sxp: s.sxp, unlocked: Object.keys(s.unlocked) }; },
    sync: serverSync,
    signOut,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { mount(); });
  else mount();
  setTimeout(serverSync, 2200);   // after Google auto-sign-in has had time to set pl_account
  window.addEventListener('storage', e => {
    if (e.key !== 'pl_account') return;
    if (!acct()) { signOut(); return; }
    setTimeout(serverSync, 1500 + Math.random() * 800);
  });
})();
