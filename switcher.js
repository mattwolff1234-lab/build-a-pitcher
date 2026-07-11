/* GoatLab navigation · self-contained drop-in (like xp.js). Two dials, one piece of state:
   - WHAT you're playing = the active game (pl_activeGame: pitcher|batter|baller|striker|keeper).
     Game pages stamp it on load; the landing's sport switcher writes it; the header game chip
     ("⚽ Striker ▾") opens a switch sheet from anywhere, including mid-build.
   - HOW you're playing = the persistent bottom nav (Home · Daily · Build · 1v1 · More) on every
     page. Daily/Build/1v1 route from pl_activeGame, so "Build" always means the right game.
   Include on every page with:  <script src="/switcher.js" defer></script>
   The old single cross-link (#buildTab) is hidden · the chip replaces it · but left in the DOM so
   each game's init() handlers keep working. Landing pages (no `header .brand`) get only the bar. */
(function () {
  'use strict';

  // Pretty routes are Vercel rewrites · a bare local server (python -m http.server) 404s on them,
  // so local previews link straight to the files.
  const LOCAL = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const GAMES = {
    pitcher: { icon: '⚾', sport: 'baseball', sportName: 'Baseball',   name: 'Pitcher', path: LOCAL ? '/pitcher.html' : '/pitching' },
    batter:  { icon: '⚾', sport: 'baseball', sportName: 'Baseball',   name: 'Batter',  path: LOCAL ? '/build-a-batter.html' : '/batting' },
    baller:  { icon: '🏀', sport: 'hoops',    sportName: 'Basketball', name: 'Hooper',  path: LOCAL ? '/build-a-baller.html' : '/hoops' },
    striker: { icon: '⚽', sport: 'soccer',   sportName: 'Soccer',     name: 'Striker', path: LOCAL ? '/build-a-striker.html' : '/striker' },
    keeper:  { icon: '⚽', sport: 'soccer',   sportName: 'Soccer',     name: 'Keeper',  path: LOCAL ? '/build-a-keeper.html' : '/keeper' },
    cfb:     { icon: '🏈', sport: 'cfb',      sportName: 'College Football', name: 'College Star', path: LOCAL ? '/college.html' : '/college' },
  };
  const ORDER = ['pitcher', 'batter', 'baller', 'striker', 'keeper', 'cfb'];
  const VERSUS = { baseball: LOCAL ? '/versus.html' : '/versus', hoops: LOCAL ? '/versus-hoops.html' : '/versus-hoops', soccer: LOCAL ? '/versus-soccer.html' : '/versus-soccer' };
  const FRANCHISE = { baseball: LOCAL ? '/franchise.html' : '/franchise', hoops: LOCAL ? '/franchise-hoops.html' : '/franchise-hoops', soccer: LOCAL ? '/franchise-soccer.html' : '/franchise-soccer' };

  function pageGame() {
    try { if (typeof LEADERBOARD_GAME === 'string' && GAMES[LEADERBOARD_GAME]) return LEADERBOARD_GAME; } catch (e) {}
    const p = location.pathname.toLowerCase();
    if (p.indexOf('franchise') >= 0) return null;   // /franchise-hoops contains 'hoops' · not a game page
    if (p.indexOf('batter') >= 0 || p.indexOf('batting') >= 0) return 'batter';
    if (p.indexOf('baller') >= 0 || p.indexOf('hoops') >= 0) return 'baller';
    if (p.indexOf('striker') >= 0) return 'striker';
    if (p.indexOf('keeper') >= 0) return 'keeper';
    if (p.indexOf('pitch') >= 0) return 'pitcher';
    return null;
  }
  function activeGame() {
    let g = null; try { g = localStorage.getItem('pl_activeGame'); } catch (e) {}
    return GAMES[g] ? g : 'pitcher';
  }
  function setActiveGame(g) { if (GAMES[g]) try { localStorage.setItem('pl_activeGame', g); } catch (e) {} }

  // Baseball AND soccer each rotate ONE daily per day between their two games (2-day cycle,
  // date-seeded, same worldwide); hoops runs its own daily every day. So "today's daily" for a
  // two-game sport is the rotation's game.
  function todayLocal() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function dailyGame(g) {
    const sport = GAMES[g].sport;
    if (sport === 'hoops') return g;
    const days = Math.floor(Date.parse(todayLocal() + 'T00:00:00Z') / 86400000);
    if (sport === 'baseball' || sport === 'cfb') return (days % 2 === 1) ? 'pitcher' : 'batter';   // cfb: no own daily yet
    return (days % 2 === 1) ? 'striker' : 'keeper';
  }

  const CSS = `
  #buildTab { display:none !important; }
  /* the bottom bar + 🎮 chip cover these · hide the menu duplicates */
  #menu a.menu-item[href="/"] { display:none !important; }
  #menu a.menu-item[href^="/versus"]:not([href*="#stats"]) { display:none !important; }
  #menu a.menu-item[href$="#daily"] { display:none !important; }
  #menu a.menu-item[href$="build-a-striker.html"], #menu a.menu-item[href$="build-a-keeper.html"] { display:none !important; }
  #miDaily { display:none !important; }
  /* Hard Mode toggle (menu row) */
  .gs-hm { display:flex; align-items:center; gap:10px; width:100%; padding:11px 14px; margin-bottom:6px; border-radius:10px;
    background:linear-gradient(180deg,#1b2535,#121a27); border:1px solid var(--line,rgba(120,160,210,.16)); box-sizing:border-box; }
  .gs-hm-t { flex:1; min-width:0; font-family:'Oswald',sans-serif; font-size:13px; letter-spacing:1px; text-transform:uppercase; color:var(--ink,#eaf2fb); }
  .gs-hm-t small { display:block; font-family:'Inter',sans-serif; font-size:10.5px; color:var(--muted,#7e8da3); text-transform:none; letter-spacing:0; margin-top:2px; line-height:1.35; }
  .gs-hm-sw { width:40px; height:22px; border-radius:999px; background:rgba(255,255,255,.1); border:1px solid var(--line,rgba(120,160,210,.16));
    position:relative; cursor:pointer; flex:0 0 auto; transition:background .2s; }
  .gs-hm-sw i { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#8fa2bd; transition:left .2s, background .2s; }
  .gs-hm-sw.on { background:rgba(255,122,24,.5); border-color:rgba(255,122,24,.6); }
  .gs-hm-sw.on i { left:20px; background:#ffb35c; }
  /* --gnav-h = our bar (0 on pages without it); --pl-adh = the Playwire anchor ad's MEASURED
     height; --pl-adh-min = the 60px mobile floor from ads.md (the anchor's z-index beats
     everything, so on phones we always clear its zone even if measuring fails). Content padding
     covers bar + ad, and the bar rides ABOVE the ad. */
  :root { --pl-adh-min: 0px; }
  @media (max-width:900px) { :root { --pl-adh-min: 60px; } }
  body { padding-bottom: calc(var(--gnav-h, 0px) + max(var(--pl-adh, 0px), var(--pl-adh-min, 0px)) + env(safe-area-inset-bottom, 0px)); }
  .gnav { position:fixed; left:0; right:0; bottom:max(var(--pl-adh, 0px), var(--pl-adh-min, 0px)); z-index:220; display:flex; justify-content:center;
    padding: 0 10px calc(8px + env(safe-area-inset-bottom, 0px)); pointer-events:none; transition:bottom .25s ease; }
  .gnav-bar { pointer-events:auto; display:flex; width:100%; max-width:520px; border-radius:16px;
    border:1px solid rgba(120,160,210,.22); background:linear-gradient(180deg,rgba(19,29,45,.94),rgba(8,13,22,.97));
    backdrop-filter:blur(10px); box-shadow:0 -6px 30px rgba(0,0,0,.45), 0 10px 34px rgba(0,0,0,.5); overflow:hidden; }
  .gnav-tab { flex:1; position:relative; display:flex; flex-direction:column; align-items:center; gap:2px; padding:9px 2px 8px;
    font-family:'Oswald',sans-serif; font-size:9.5px; font-weight:600; letter-spacing:.8px; text-transform:uppercase;
    color:#7e8da3; text-decoration:none; background:none; border:none; cursor:pointer; line-height:1; min-width:0; }
  .gnav-tab i { font-style:normal; font-size:17px; line-height:1; }
  /* pending friend requests/challenges count · painted by social.js into any [data-social-badge] */
  .gnav-tab [data-social-badge] { position:absolute; top:3px; left:calc(50% + 5px); min-width:15px; padding:1px 4px;
    border-radius:9px; background:#ff4d5e; color:#fff; font-size:9.5px; font-weight:700; text-align:center; line-height:1.3; }
  /* the ☰ menu scrolls under the bottom nav + anchor ad · give its scroller enough bottom
     room that the last items clear both (adapts live via the measured --pl-adh) */
  #menu .overlay-body, #menu .menu-body {
    padding-bottom: calc(var(--gnav-h, 0px) + max(var(--pl-adh, 0px), var(--pl-adh-min, 0px)) + 24px) !important; }
  .gnav-tab.on { color:#eaf2fb; }
  .gnav-tab.on i { filter:drop-shadow(0 0 8px rgba(255,122,24,.8)); }
  .gnav-tab:hover { color:#eaf2fb; }
  /* ⚔️ 1v1 tab: soft HUD glow pulse (filter only · zero layout shift) */
  @media (prefers-reduced-motion: no-preference) {
    .gnav-tab.gnav-vs i { animation: gnavVsPulse 2s ease-in-out infinite; }
  }
  @keyframes gnavVsPulse {
    0%, 100% { filter: drop-shadow(0 0 2px rgba(255,122,24,.25)); }
    50% { filter: drop-shadow(0 0 7px rgba(255,122,24,.85)) drop-shadow(0 0 13px rgba(25,198,255,.45)); }
  }
  .gs-pill { display:inline-flex; align-items:center; gap:6px; padding:6px 11px; border-radius:8px;
    font-family:'Oswald',sans-serif; font-size:12px; font-weight:600; letter-spacing:1px; text-transform:uppercase;
    color:var(--ink,#eaf2fb); background:rgba(255,255,255,.04); border:1px solid var(--line,rgba(120,160,210,.16));
    cursor:pointer; line-height:1; white-space:nowrap; }
  .gs-pill:hover { border-color:var(--accent2,#19c6ff); box-shadow:0 0 12px rgba(25,198,255,.25); }
  .gs-pill .gs-carrot { color:var(--muted,#7e8da3); font-size:10px; }
  @media (max-width:560px){ .gs-pill { padding:6px 8px; font-size:11px; } .gs-pill .gs-name { display:none; } }
  .gs-overlay { position:fixed; inset:0; z-index:230; display:none; align-items:center; justify-content:center;
    padding:18px; background:rgba(3,6,11,.74); backdrop-filter:blur(5px); }
  .gs-overlay.show { display:flex; }
  .gs-card { width:100%; max-width:400px; max-height:80dvh; overflow-y:auto; border-radius:14px; padding:16px;
    border:1px solid var(--line,rgba(120,160,210,.16));
    background:linear-gradient(180deg,rgba(20,31,48,.97),rgba(9,15,25,.98));
    box-shadow:0 24px 70px rgba(0,0,0,.6); }
  .gs-head { display:flex; align-items:center; justify-content:space-between; margin:0 2px 12px; }
  .gs-title { font-family:'Oswald',sans-serif; font-size:14px; letter-spacing:2.5px; text-transform:uppercase; color:var(--ink,#eaf2fb); }
  .gs-x { font-size:15px; line-height:1; padding:6px 11px; border-radius:8px; color:var(--ink,#eaf2fb); cursor:pointer;
    background:rgba(255,255,255,.05); border:1px solid var(--line,rgba(120,160,210,.16)); }
  .gs-sport { font-family:'Oswald',sans-serif; font-size:10.5px; letter-spacing:2px; text-transform:uppercase;
    color:var(--dim,#56627a); margin:12px 4px 6px; display:flex; align-items:center; gap:8px; }
  .gs-sport::after { content:''; flex:1; height:1px; background:linear-gradient(90deg,rgba(120,160,210,.22),transparent); }
  .gs-sport:first-of-type { margin-top:0; }
  .gs-row { display:flex; align-items:center; gap:10px; width:100%; padding:11px 13px; margin-bottom:6px;
    font-family:'Oswald',sans-serif; font-size:14px; letter-spacing:.8px; text-transform:uppercase; text-decoration:none;
    border-radius:10px; color:var(--ink,#eaf2fb); background:linear-gradient(180deg,#1b2535,#121a27);
    border:1px solid var(--line,rgba(120,160,210,.16)); box-sizing:border-box; }
  .gs-row:hover { border-color:var(--accent2,#19c6ff); box-shadow:0 0 14px rgba(25,198,255,.25); }
  .gs-row .gs-ico { font-size:17px; }
  .gs-row .gs-go { margin-left:auto; color:var(--muted,#7e8da3); font-size:13px; }
  .gs-row.gs-here { border-color:rgba(255,122,24,.55); background:linear-gradient(180deg,rgba(255,122,24,.14),rgba(18,26,39,.9)); cursor:default; }
  .gs-row.gs-here .gs-go { color:var(--accent,#ff7a18); font-size:10.5px; letter-spacing:1.5px; }
  .gs-vs { display:flex; gap:8px; }
  .gs-vs .gs-row { flex:1; justify-content:center; margin-bottom:0; font-size:12.5px; }
  `;

  // daily "done today" per game · same lock keys each game's dcKey() uses (baseball pair shares
  // the legacy key, the soccer pair shares one soccer key, hoops has its own)
  function playedFor(g) {
    const sport = GAMES[g].sport;
    const suffix = sport === 'baseball' ? '' : (sport === 'soccer' ? '_soccer' : '_' + g);
    try { return !!JSON.parse(localStorage.getItem('pl_dc_' + todayLocal() + suffix) || 'null'); } catch (e) { return false; }
  }

  let sheet = null;
  function buildSheet(cur) {
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'gs-overlay';
      document.body.appendChild(sheet);
      sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    }
    let rows = '', lastSport = '';
    for (const id of ORDER) {
      const g = GAMES[id];
      if (g.sport !== lastSport) { rows += `<div class="gs-sport">${g.icon} ${g.sportName}</div>`; lastSport = g.sport; }
      // 🎯 marker on the game hosting its sport's daily today (✅ once played)
      const host = dailyGame(id) === id;
      const daily = host ? (playedFor(id) ? '<span style="color:#43e97b;font-size:10.5px;letter-spacing:1px">✅ DAILY DONE</span>' : '<span style="color:#ffce3a;font-size:10.5px;letter-spacing:1px">🎯 DAILY</span>') : '›';
      rows += id === cur
        ? `<div class="gs-row gs-here"><span class="gs-ico">${g.icon}</span>Build a ${g.name}<span class="gs-go">YOU'RE HERE</span></div>`
        : `<a class="gs-row" href="${g.path}" data-gs-game="${id}"><span class="gs-ico">${g.icon}</span>Build a ${g.name}<span class="gs-go">${daily}</span></a>`;
    }
    rows += `<div class="gs-sport">⚔️ 1v1 Live</div><div class="gs-vs">
      <a class="gs-row" href="${VERSUS.baseball}"><span class="gs-ico">⚾</span>Baseball</a>
      <a class="gs-row" href="${VERSUS.hoops}"><span class="gs-ico">🏀</span>Hoops</a>
      <a class="gs-row" href="${VERSUS.soccer}"><span class="gs-ico">⚽</span>Soccer</a></div>`;
    rows += `<div class="gs-sport">🏟️ Franchise</div><div class="gs-vs">
      <a class="gs-row" href="${LOCAL ? '/franchise.html' : '/franchise'}"><span class="gs-ico">⚾</span>Baseball</a>
      <a class="gs-row" href="${LOCAL ? '/franchise-hoops.html' : '/franchise-hoops'}"><span class="gs-ico">🏀</span>Hoops</a>
      <a class="gs-row" href="${LOCAL ? '/franchise-soccer.html' : '/franchise-soccer'}"><span class="gs-ico">⚽</span>Soccer</a></div>`;
    sheet.innerHTML = `<div class="gs-card">
      <div class="gs-head"><span class="gs-title">🎮 Switch Game</span><button class="gs-x" aria-label="Close">✕</button></div>
      ${rows}</div>`;
    sheet.querySelectorAll('[data-gs-game]').forEach(a => a.addEventListener('click', () => setActiveGame(a.dataset.gsGame)));
    sheet.querySelector('.gs-x').addEventListener('click', closeSheet);
    return sheet;
  }
  function openSheet(cur) {
    const s = buildSheet(cur);   // rebuilt each open so the daily ✅s are current
    s.classList.add('show');
    if (window.gsap) gsap.fromTo(s.firstElementChild, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .3, ease: 'power3.out' });
  }
  function closeSheet() { if (sheet) sheet.classList.remove('show'); }

  // Hard Mode lives in the ☰ menu on every page. It only ever applies from the NEXT build -
  // each game re-reads it at reset(), so mid-run flips can't reveal a hard run or fake one.
  function injectHardMode() {
    const menuBody = document.querySelector('#menu .overlay-body, #menu .menu-body');
    if (!menuBody || menuBody.querySelector('.gs-hm')) return;
    const row = document.createElement('div');
    row.className = 'gs-hm';
    row.innerHTML = `<div class="gs-hm-t">🙈 Hard Mode<small>Hide all ratings while you draft. Applies from your next build.</small></div>
      <div class="gs-hm-sw" role="switch" tabindex="0" aria-label="Hard Mode"><i></i></div>`;
    const anchor = menuBody.querySelector('[data-xp-bar]');
    if (anchor) anchor.insertAdjacentElement('afterend', row); else menuBody.prepend(row);
    const sw = row.querySelector('.gs-hm-sw');
    const read = () => { try { return localStorage.getItem('pl_hardMode') === '1'; } catch (e) { return false; } };
    const paint = () => { sw.classList.toggle('on', read()); sw.setAttribute('aria-checked', read()); };
    const flip = () => {
      const on = !read();
      try { localStorage.setItem('pl_hardMode', on ? '1' : '0'); } catch (e) {}
      paint();
      try { if (typeof toast === 'function') toast(on ? '🙈 Hard Mode ON · applies from your next build' : 'Hard Mode off · applies from your next build'); } catch (e) {}
    };
    sw.addEventListener('click', flip);
    sw.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
    paint();
  }

  // Playwire's bottom adhesion ad is a fixed bar at the viewport bottom. Measure it whenever it
  // exists so the nav bar lifts above it and page padding grows to fit both (any ad size, and
  // it settles back down if the ad collapses/closes).
  // iOS gotcha: Safari's collapsing URL bar and home-screen (PWA standalone) mode change the
  // viewport AFTER the ad script positions the unit via a computed `top`, so the "bottom" anchor
  // detaches and floats mid-screen, eating the page. The watchdog below re-pins any detached
  // bottom anchor to the true bottom (and never touches top-anchored units or big interstitials).
  function watchAdhesion() {
    const measure = () => {
      let h = 0;
      const vvGap = window.visualViewport ? Math.max(0, window.innerHeight - window.visualViewport.height) : 0;
      document.querySelectorAll('[class*="bottom_rail"],[id*="bottom_rail"],[class*="adhesion"],[id*="adhesion"],[id*="pw-oop"],[class*="pw-oop"]').forEach(el => {
        try {
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return;
          const r = el.getBoundingClientRect();
          // detached anchor: short unit, clearly above the real bottom, not a top rail → re-pin
          if (r.height > 0 && r.height <= 220 && r.top > 120 && (window.innerHeight - r.bottom) > 40 + vvGap) {
            el.style.setProperty('top', 'auto', 'important');
            el.style.setProperty('bottom', '0px', 'important');
          }
          const r2 = el.getBoundingClientRect();
          if (r2.height > h && Math.abs(window.innerHeight - r2.bottom) < 40 + vvGap) h = Math.round(r2.height);
        } catch (e) {}
      });
      document.documentElement.style.setProperty('--pl-adh', h + 'px');
    };
    measure();
    setInterval(measure, 1500);
    // the URL bar collapsing / keyboard / PWA chrome all resize the visual viewport · re-check fast
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(measure, 60));
    window.addEventListener('orientationchange', () => setTimeout(measure, 250));
  }

  function build() {
    if (document.querySelector('.gnav')) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    watchAdhesion();

    // versus pages: ad-safe padding only · no nav bar (a mid-match mis-tap would forfeit the game)
    if (location.pathname.toLowerCase().indexOf('versus') >= 0) return;
    document.documentElement.style.setProperty('--gnav-h', '66px');
    injectHardMode();

    const onGame = pageGame();
    if (onGame) setActiveGame(onGame);          // arriving at a game makes it the active one
    // a franchise page pins the active game to its sport, so Build/Daily/1v1 route right
    const fpath = location.pathname.toLowerCase();
    const onFranchise = fpath.indexOf('franchise') >= 0;
    if (onFranchise) {
      if (fpath.indexOf('hoops') >= 0) setActiveGame('baller');
      else if (fpath.indexOf('soccer') >= 0) { if (GAMES[activeGame()].sport !== 'soccer') setActiveGame('striker'); }
      else if (GAMES[activeGame()].sport !== 'baseball') setActiveGame('pitcher');
    }
    const act = activeGame();
    const A = GAMES[act];

    // header game chip (game pages only · the landing has the full sport switcher on-page)
    const brand = document.querySelector('header .brand');
    if (brand && onGame) {
      const g = GAMES[onGame];
      const pill = document.createElement('button');
      pill.className = 'gs-pill';
      pill.title = 'Switch game';
      pill.innerHTML = `${g.icon} <span class="gs-name">${g.name}</span> <span class="gs-carrot">▾</span>`;
      const menuBtn = document.getElementById('menuBtn');
      if (menuBtn && menuBtn.parentElement === brand) brand.insertBefore(pill, menuBtn);
      else brand.appendChild(pill);
      pill.addEventListener('click', () => openSheet(onGame));
    }

    // persistent bottom nav
    const isHome = !onGame && (location.pathname === '/' || location.pathname.endsWith('/index.html'));
    const dg = dailyGame(act);
    const hash = (location.hash || '').toLowerCase();
    const onDaily = hash.indexOf('daily') >= 0;
    const onRanks = hash.indexOf('leaderboard') >= 0 || hash.indexOf('lb') === 1;
    const vsPath = VERSUS[A.sport] || null;
    const onVersus = location.pathname.indexOf('versus') >= 0;
    const nav = document.createElement('div');
    nav.className = 'gnav';
    nav.innerHTML = `<nav class="gnav-bar">
      <a class="gnav-tab${isHome ? ' on' : ''}" href="/"><i>🏠</i>Home</a>
      <a class="gnav-tab${onDaily ? ' on' : ''}" data-nav="daily" href="${GAMES[dg].path}#daily"><i>🎯</i>Daily</a>
      <a class="gnav-tab${onGame && !onDaily && !onRanks ? ' on' : ''}" data-nav="build" href="${A.path}"><i>🛠️</i>Build</a>
      ${vsPath
        ? `<a class="gnav-tab gnav-vs${onVersus ? ' on' : ''}" href="${vsPath}"><i>⚔️</i>1v1</a>`
        : `<button class="gnav-tab gnav-vs" data-nav="vs-pick"><i>⚔️</i>1v1</button>`}
      <a class="gnav-tab${onFranchise ? ' on' : ''}" href="${FRANCHISE[A.sport] || FRANCHISE.baseball}"><i>🏟️</i>Frnch</a>
      <a class="gnav-tab${onRanks ? ' on' : ''}" data-nav="ranks" href="${A.path}#leaderboard"><i>🏆</i>Ranks</a>
      <button class="gnav-tab" data-nav="profile"><i>👤</i>Profile<span data-social-badge></span></button>
      ${document.getElementById('menuBtn') ? `<button class="gnav-tab" data-nav="more"><i>☰</i>More</button>` : ''}
    </nav>`;
    document.body.appendChild(nav);

    // Daily/Build/Ranks taps that target THIS page: hash-change alone won't re-trigger init → reload.
    nav.querySelectorAll('[data-nav="daily"], [data-nav="build"], [data-nav="ranks"]').forEach(a => {
      a.addEventListener('click', e => {
        const target = new URL(a.href, location.href);
        if (target.pathname === location.pathname) {
          e.preventDefault();
          if (location.href === target.href) location.reload();
          else { location.href = target.href; location.reload(); }
        }
      });
    });
    const vsPick = nav.querySelector('[data-nav="vs-pick"]');
    if (vsPick) vsPick.addEventListener('click', () => openSheet(onGame));   // soccer: choose a 1v1 sport in the sheet
    const moreTab = nav.querySelector('[data-nav="more"]');
    if (moreTab) moreTab.addEventListener('click', () => {
      const m = document.getElementById('menuBtn');
      if (m) m.click();
    });
    // your own tabbed profile (social.js); falls back to the Friends panel if profiles are down
    nav.querySelector('[data-nav="profile"]').addEventListener('click', () => {
      if (window.Social) Social.openProfile(null);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
