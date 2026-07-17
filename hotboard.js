/* ============================================================================
   Pitching Lab · 🔥 "Last Night's Studs" bulletin board.
   Included (defer) by the landing page + both baseball games. Exposes window.Hot.
   Follows the achievements.js / xp.js drop-in pattern: self-contained, injects
   its own CSS, fails silent (no list -> the games behave exactly as before).
     - Fetches /api/hot (real MLB box-score studs, computed server-side daily).
     - Hot.ready  -> promise resolving to the list (always resolves, [] on error).
     - Hot.get(mlbamId) / Hot.list() -> used by the games to boost hot cards.
     - Hot.open() -> the bulletin overlay. NO auto-open: it lives only behind the
       ☰ "🔥 Last Night's Studs" menu item (the daily popup was removed 2026-07-11).
   ========================================================================== */
(function () {
  'use strict';

  const SIL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%2311161d"/><circle cx="50" cy="38" r="20" fill="%23394150"/><path d="M50 62c-20 0-34 14-34 34h68c0-20-14-34-34-34z" fill="%23394150"/></svg>');

  let data = { players: [] };
  const byId = new Map();

  const ready = fetch('/api/hot')
    .then(r => r.json())
    .then(j => {
      if (j && j.ok && Array.isArray(j.players)) {
        data = j;
        for (const p of j.players) byId.set(p.mlbamId, p);
      }
      return data.players;
    })
    .catch(() => data.players);

  // ---- styles --------------------------------------------------------------
  const css = `
  .hotb-overlay { position:fixed; inset:0; z-index:520; display:none; align-items:center; justify-content:center;
    padding:16px; background:rgba(4,8,14,.78); backdrop-filter:blur(4px); }
  .hotb-overlay.show { display:flex; }
  .hotb-board { position:relative; width:min(560px, 100%); max-height:min(82vh, 720px); display:flex; flex-direction:column;
    background:linear-gradient(160deg,#101a28,#0b121d); border:1px solid rgba(120,170,220,.28); border-radius:14px;
    box-shadow:0 30px 80px rgba(0,0,0,.6), 0 0 40px rgba(255,122,46,.08) inset;
    animation:hotbPop .38s cubic-bezier(.2,1.4,.4,1); }
  .hotb-board::before, .hotb-board::after { content:''; position:absolute; width:16px; height:16px; pointer-events:none;
    border:2px solid rgba(59,209,255,.55); }
  .hotb-board::before { top:-1px; left:-1px; border-right:none; border-bottom:none; border-radius:14px 0 0 0; }
  .hotb-board::after { bottom:-1px; right:-1px; border-left:none; border-top:none; border-radius:0 0 14px 0; }
  @keyframes hotbPop { from { opacity:0; transform:scale(.9) translateY(14px); } to { opacity:1; transform:none; } }
  .hotb-head { padding:16px 18px 10px; border-bottom:1px solid rgba(120,170,220,.16); }
  .hotb-eyebrow { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:3px; color:#3bd1ff; text-transform:uppercase; }
  .hotb-title { font-family:'Oswald',sans-serif; font-size:26px; font-weight:700; letter-spacing:1px; color:#f2f6fb;
    line-height:1.1; margin-top:3px; text-transform:uppercase; }
  .hotb-title .hotb-date { color:#ff9c4a; }
  .hotb-sub { font-family:Inter,system-ui,sans-serif; font-size:11.5px; color:#8ea2bd; margin-top:5px; line-height:1.4; }
  .hotb-rows { overflow-y:auto; padding:10px 12px; display:flex; flex-direction:column; gap:7px; }
  .hotb-row { display:flex; align-items:center; gap:11px; padding:8px 10px; border-radius:10px;
    background:rgba(20,32,48,.55); border:1px solid rgba(120,170,220,.13);
    animation:hotbRow .45s both cubic-bezier(.2,1.2,.4,1); }
  @keyframes hotbRow { from { opacity:0; transform:translateX(-14px); } to { opacity:1; transform:none; } }
  .hotb-row img { width:46px; height:46px; border-radius:50%; object-fit:cover; background:#0c131e;
    border:2px solid rgba(255,122,46,.55); flex:0 0 auto; }
  .hotb-who { flex:1 1 auto; min-width:0; font-family:Inter,system-ui,sans-serif; }
  .hotb-who .nm { font-size:13.5px; font-weight:700; color:#f2f6fb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .hotb-who .tm { font-size:10.5px; color:#8ea2bd; letter-spacing:.4px; margin-top:1px; }
  .hotb-who .ln { font-size:11.5px; color:#c8d6ea; margin-top:2px; }
  .hotb-right { flex:0 0 auto; display:flex; flex-direction:column; align-items:flex-end; gap:4px; }
  .hotb-chip { font-family:'Oswald',sans-serif; font-size:13px; font-weight:700; letter-spacing:.5px; color:#1a0e04;
    background:linear-gradient(135deg,#ffb02e,#ff7a2e); border-radius:7px; padding:2px 8px;
    box-shadow:0 0 12px rgba(255,122,46,.4); }
  .hotb-go { font-family:'Oswald',sans-serif; font-size:10px; font-weight:600; letter-spacing:1px; text-transform:uppercase;
    color:#3bd1ff; text-decoration:none; }
  .hotb-go:hover { text-decoration:underline; }
  .hotb-here { font-family:'Oswald',sans-serif; font-size:10px; font-weight:600; letter-spacing:1px; color:#ff9c4a; text-transform:uppercase; }
  .hotb-empty { padding:26px 18px; text-align:center; font-family:Inter,system-ui,sans-serif; font-size:13px; color:#8ea2bd; }
  .hotb-foot { padding:11px 18px 14px; border-top:1px solid rgba(120,170,220,.16); font-family:Inter,system-ui,sans-serif;
    font-size:11px; color:#8ea2bd; line-height:1.45; }
  .hotb-foot b { color:#ff9c4a; }
  .hotb-x { position:absolute; top:2px; right:2px; width:44px; height:44px; display:flex; align-items:center;
    justify-content:center; background:none; border:none; color:#c8d6ea; font-size:22px;
    cursor:pointer; line-height:1; font-family:Inter,sans-serif; }
  .hotb-x:hover { color:#f2f6fb; }
  .hotb-close { flex:0 0 auto; margin:0 12px 12px; padding:12px; border-radius:10px; border:1px solid rgba(120,170,220,.28);
    background:rgba(30,45,66,.6); color:#c8d6ea; font-family:'Oswald',sans-serif; font-size:13px; font-weight:600;
    letter-spacing:2px; text-transform:uppercase; cursor:pointer; }
  .hotb-close:hover { background:rgba(40,58,84,.75); color:#f2f6fb; }
  @media (max-width:480px) { .hotb-who .ln { font-size:10.5px; } .hotb-title { font-size:21px; } }`;

  function injectCss() {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---- board ---------------------------------------------------------------
  function pageGame() {
    try { return (typeof LEADERBOARD_GAME !== 'undefined') ? LEADERBOARD_GAME : null; } catch (e) { return null; }
  }
  function niceDate(d) {
    try {
      return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();
    } catch (e) { return ''; }
  }

  let overlay = null;
  function build() {
    if (overlay) { render(); return; }
    injectCss();
    overlay = document.createElement('div');
    overlay.className = 'hotb-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    render();
  }
  function render() {
    const here = pageGame();
    const rows = data.players.map((p, i) => {
      const dest = p.type === 'pitcher' ? { game: 'pitcher', href: '/pitching', label: 'Spin in Pitching →' }
                                        : { game: 'batter', href: '/batting', label: 'Spin in Batting →' };
      const action = here === dest.game
        ? `<span class="hotb-here">🔥 In today's reel</span>`
        : `<a class="hotb-go" href="${dest.href}">${dest.label}</a>`;
      return `<div class="hotb-row" style="animation-delay:${0.06 * i + 0.1}s">
        <img src="https://midfield.mlbstatic.com/v1/people/${p.mlbamId}/spots/120" alt="" loading="lazy"
          onerror="this.onerror=null;this.src='${SIL}'">
        <div class="hotb-who">
          <div class="nm">${p.name}</div>
          <div class="tm">${p.team || ''}${p.pos ? ' · ' + p.pos : ''}</div>
          <div class="ln">${p.line || ''}</div>
        </div>
        <div class="hotb-right"><span class="hotb-chip">+${p.boost} OVR</span>${action}</div>
      </div>`;
    }).join('');
    overlay.innerHTML = `<div class="hotb-board">
      <button class="hotb-x" aria-label="Close">✕</button>
      <div class="hotb-head">
        <div class="hotb-eyebrow">📌 Clubhouse Board</div>
        <div class="hotb-title">🔥 Last Night's Studs${data.gameDate ? ` <span class="hotb-date">· ${niceDate(data.gameDate)}</span>` : ''}</div>
        <div class="hotb-sub">Straight from last night's real MLB box scores · refreshed every morning.</div>
      </div>
      ${data.players.length
        ? `<div class="hotb-rows">${rows}</div>
           <div class="hotb-foot">These players are running hot <b>today only</b>: better spin odds and a
           <b>+5 to +10 rating boost</b> on their card in the reel. Catch them before midnight.</div>`
        : `<div class="hotb-empty">No studs posted yet · check back after tonight's games wrap up. ⚾</div>`}
      <button class="hotb-close">Close</button>
    </div>`;
    overlay.querySelector('.hotb-x').onclick = close;
    overlay.querySelector('.hotb-close').onclick = close;
  }
  function open() { ready.then(() => { build(); overlay.classList.add('show'); }); }
  function close() { if (overlay) overlay.classList.remove('show'); }

  // No auto-open: the board lives behind the ☰ "🔥 Last Night's Studs" item only.
  // (The old once-a-day popup ate the mobile first-screen · Matt killed it 2026-07-11.)

  window.Hot = {
    ready,
    list: () => data.players,
    get: id => byId.get(id) || null,
    date: () => data.gameDate || null,
    open,
    close,
  };
})();
