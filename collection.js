/* ============================================================================
   GoatLab — shared player Collection ("The Binder").
   Companion to achievements.js / xp.js: dropped into every game page with
   <script src="/collection.js" defer>. Exposes window.Collection.

   Every player you ASSIGN into a build is collected forever — name, best
   rarity tier, times used, prime/legend flags. The binder UI shows per-game
   progress against the full card pool, grouped by rarity, with ??? tiles for
   the cards you haven't found yet.

   - State persists in localStorage 'pl_collection' and syncs to the Google
     account via api/account.js `collectionSync` (union merge, so it follows
     the email across devices — same posture as achievements.js).
   - Each game calls Collection.setPool(game, [{name,tier},…]) once its data
     json is loaded; pools are cached in localStorage so the binder can show
     "X / Y" for sibling games you've visited before.
   - Collection.record(game, {name,tier,prime,legend}) on every assign.
   - Collection.has(game, name) → NEW-card badge on the landed panel.
   ========================================================================== */
(function () {
  'use strict';

  const GAMES = [
    { id: 'pitcher', icon: '⚾', label: 'Pitchers', noun: 'pitchers' },
    { id: 'batter', icon: '💥', label: 'Batters', noun: 'batters' },
    { id: 'baller', icon: '🏀', label: 'Hoopers', noun: 'hoopers' },
  ];
  const TIERS = [
    { id: 'legend', label: 'Legends', icon: '🟣', color: '#c084fc' },
    { id: 'diamond', label: 'Diamond', icon: '💎', color: '#7de3ff' },
    { id: 'gold', label: 'Gold', icon: '🥇', color: '#ffd23f' },
    { id: 'silver', label: 'Silver', icon: '🥈', color: '#c8d0da' },
    { id: 'bronze', label: 'Bronze', icon: '🥉', color: '#d08a3e' },
    { id: 'grey', label: 'Common', icon: '⚪', color: '#7e8da3' },
  ];
  const TIER_RANK = { legend: 5, diamond: 4, gold: 3, silver: 2, bronze: 1, grey: 0 };
  const tierOf = id => TIERS.find(t => t.id === id) || TIERS[5];

  // ---- persistent state ----
  // col = { pitcher: { "Player Name": {t:'gold', c:3, f:'2026-07-08T…', p:1, l:0} }, batter:{…}, baller:{…} }
  let col = {};
  try { col = JSON.parse(localStorage.getItem('pl_collection') || '{}') || {}; } catch (e) { col = {}; }
  const save = () => { try { localStorage.setItem('pl_collection', JSON.stringify(col)); } catch (e) {} };

  // Per-game card pools, cached so the binder can render sibling games' totals.
  // pools = { pitcher: [[name, tier], …] }
  const pools = {};
  for (const g of GAMES) {
    try {
      const raw = localStorage.getItem('pl_col_pool_' + g.id);
      if (raw) pools[g.id] = JSON.parse(raw);
    } catch (e) {}
  }

  function setPool(game, list) {
    if (!Array.isArray(list) || !list.length) return;
    const seen = new Set(), out = [];
    for (const p of list) {
      const name = p && p.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push([String(name), TIER_RANK[p.tier] != null ? p.tier : 'grey']);
    }
    pools[game] = out;
    try { localStorage.setItem('pl_col_pool_' + game, JSON.stringify(out)); } catch (e) {}
    refreshBadges();
    checkAchievements();   // a data refresh can shrink the pool → a full set may already be complete
  }

  const bucket = game => (col[game] || (col[game] = {}));
  const has = (game, name) => !!(col[game] && col[game][name]);
  const count = game => Object.keys(col[game] || {}).length;
  const totalCount = () => GAMES.reduce((n, g) => n + count(g.id), 0);

  // ---- account sync (mirrors achievements.js: union merge, owner guard) ----
  function acct() { try { return JSON.parse(localStorage.getItem('pl_account') || 'null'); } catch (e) { return null; } }
  let syncTimer = null;
  async function serverSync() {
    const a = acct();
    if (!a || !a.sub || !a.sessionToken) return;
    let owner = null;
    try { owner = localStorage.getItem('pl_col_owner'); } catch (e) {}
    // A different account's local binder isn't ours to push — drop it, adopt this account's.
    if (owner && owner !== a.sub) { col = {}; save(); refreshBadges(); }
    try {
      const r = await fetch('/api/account', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'collectionSync', sub: a.sub, sessionToken: a.sessionToken, collection: col }),
      }).then(x => x.json());
      if (r && r.ok && r.collection && typeof r.collection === 'object') {
        try { localStorage.setItem('pl_col_owner', a.sub); } catch (e) {}
        col = r.collection; save(); refreshBadges();
        checkAchievements();   // a restored account binder can already be complete on this device
        if (ov && ov.classList.contains('show')) render();
      }
    } catch (e) {}
  }
  function queueSync() { clearTimeout(syncTimer); syncTimer = setTimeout(serverSync, 800); }
  function signOut() {
    col = {};
    try { localStorage.removeItem('pl_collection'); localStorage.removeItem('pl_col_owner'); } catch (e) {}
    refreshBadges();
    if (ov && ov.classList.contains('show')) render();
  }

  // ---- recording ----
  function record(game, p) {
    if (!p || !p.name) return false;
    const b = bucket(game);
    const prev = b[p.name];
    const e = prev || { c: 0, f: new Date().toISOString() };
    e.c = (e.c || 0) + 1;
    const t = TIER_RANK[p.tier] != null ? p.tier : 'grey';
    if (!e.t || (TIER_RANK[t] || 0) > (TIER_RANK[e.t] || 0)) e.t = t;   // keep best rarity seen
    if (p.prime) e.p = 1;
    if (p.legend) e.l = 1;
    b[p.name] = e;
    save();
    queueSync();
    refreshBadges();
    checkAchievements();
    if (ov && ov.classList.contains('show')) render();
    return !prev;   // true = brand-new card for the binder
  }

  function checkAchievements() {
    if (!window.Ach) return;
    const n = totalCount();
    if (n >= 25) Ach.unlock('collect1');
    if (n >= 150) Ach.unlock('collect2');
    if (n >= 400) Ach.unlock('collect3');
    // Gotta Catch 'Em All: every player in one game's full pool, verified name-by-name
    // (count can include players who later rotated out of the pool, so count alone isn't proof).
    if (!Ach.has('collect_all')) {
      for (const g of GAMES) {
        const pool = pools[g.id];
        if (pool && pool.length && count(g.id) >= pool.length && pool.every(p => has(g.id, p[0]))) {
          Ach.unlock('collect_all');
          break;
        }
      }
    }
  }

  function refreshBadges() {
    const n = totalCount();
    document.querySelectorAll('[data-col-count]').forEach(el => { el.textContent = n; });
  }

  // ---- binder UI (injected, like achievements.js) ----
  const css = `
  .col-ov{position:fixed;inset:0;z-index:210;display:none;align-items:center;justify-content:center;background:rgba(3,6,11,.78);backdrop-filter:blur(6px);padding:18px}
  .col-ov.show{display:flex}
  .col-card{width:min(860px,96vw);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(20,31,48,.96),rgba(9,15,25,.98));border:1px solid rgba(25,198,255,.3);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}
  .col-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(25,198,255,.18)}
  .col-title{font-family:'Oswald',sans-serif;font-size:19px;font-weight:700;letter-spacing:1px;color:#eaf2fb}
  .col-x{margin-left:auto;background:none;border:none;color:#8fa2bd;font-size:20px;cursor:pointer;padding:4px 8px}
  .col-x:hover{color:#fff}
  .col-tabs{display:flex;gap:8px;padding:12px 18px 0}
  .col-tab{font-family:'Oswald',sans-serif;font-size:13px;font-weight:600;letter-spacing:.6px;color:#8fa2bd;background:rgba(25,198,255,.06);border:1px solid rgba(25,198,255,.16);border-radius:999px;padding:7px 14px;cursor:pointer}
  .col-tab.active{color:#04121c;background:#19c6ff;border-color:#19c6ff}
  .col-sum{padding:14px 18px 4px}
  .col-sum-line{display:flex;align-items:baseline;gap:8px;font-family:'Oswald',sans-serif;color:#eaf2fb}
  .col-sum-line b{font-size:26px}
  .col-sum-line span{color:#8fa2bd;font-size:13px;font-family:'Inter',sans-serif}
  .col-bar{height:8px;border-radius:999px;background:rgba(25,198,255,.12);margin-top:8px;overflow:hidden}
  .col-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#19c6ff,#7de3ff);transition:width .5s ease}
  .col-body{overflow-y:auto;padding:8px 18px 20px;flex:1}
  .col-tier{margin-top:14px}
  .col-tier-h{display:flex;align-items:center;gap:8px;font-family:'Oswald',sans-serif;font-size:14px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px}
  .col-tier-h .tc{margin-left:auto;color:#8fa2bd;font-size:12px;font-family:'Inter',sans-serif}
  .col-grid{display:flex;flex-wrap:wrap;gap:6px}
  .col-chip{font-family:'Inter',sans-serif;font-size:12px;font-weight:600;color:#eaf2fb;background:rgba(255,255,255,.05);border:1px solid var(--cc,#7e8da3);border-radius:8px;padding:5px 9px;display:inline-flex;align-items:center;gap:5px}
  .col-chip .n{color:#8fa2bd;font-weight:500;font-size:11px}
  .col-chip.locked{color:#5c6b82;border-color:rgba(255,255,255,.09);background:rgba(255,255,255,.02);letter-spacing:2px}
  .col-empty{color:#8fa2bd;font-size:13px;padding:18px 4px;font-family:'Inter',sans-serif}
  .col-note{color:#5c6b82;font-size:12px;padding:10px 4px 0;font-family:'Inter',sans-serif}
  @media(max-width:560px){.col-tabs{flex-wrap:wrap}.col-card{max-height:92vh}}
  `;

  let ov = null, ACTIVE = 'pitcher', chromeReady = false;
  function ensureChrome() {
    if (chromeReady) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    ov = document.createElement('div'); ov.className = 'col-ov';
    ov.innerHTML = `<div class="col-card">
      <div class="col-head"><span class="col-title">📇 THE BINDER · YOUR COLLECTION</span><button class="col-x" aria-label="Close">✕</button></div>
      <div class="col-tabs"></div>
      <div class="col-sum"></div>
      <div class="col-body"></div>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('.col-x').onclick = close;
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('show')) close(); });
    chromeReady = true;
  }

  function render() {
    ensureChrome();
    const tabs = ov.querySelector('.col-tabs');
    tabs.innerHTML = GAMES.map(g => {
      const n = count(g.id), pool = pools[g.id];
      return `<button class="col-tab${ACTIVE === g.id ? ' active' : ''}" data-g="${g.id}">${g.icon} ${g.label} <span>${n}${pool ? '/' + pool.length : ''}</span></button>`;
    }).join('');
    tabs.querySelectorAll('.col-tab').forEach(t => t.onclick = () => { ACTIVE = t.dataset.g; render(); });

    const g = GAMES.find(x => x.id === ACTIVE) || GAMES[0];
    const mine = col[g.id] || {};
    const n = Object.keys(mine).length;
    const pool = pools[g.id];
    const sum = ov.querySelector('.col-sum');
    if (pool) {
      const pct = pool.length ? Math.round((n / pool.length) * 100) : 0;
      sum.innerHTML = `<div class="col-sum-line"><b>${n}</b><span>of ${pool.length} ${g.noun} collected · ${pct}%</span></div>
        <div class="col-bar"><i style="width:${Math.min(100, pct)}%"></i></div>`;
    } else {
      sum.innerHTML = `<div class="col-sum-line"><b>${n}</b><span>${g.noun} collected</span></div>`;
    }

    const body = ov.querySelector('.col-body');
    if (!n && !pool) {
      body.innerHTML = `<div class="col-empty">No ${g.noun} collected yet. Every player you assign into a build gets added here, forever. ${g.id === ACTIVE && !pool ? 'Visit that game once to see its full checklist.' : ''}</div>`;
      return;
    }

    // group: collected by tier (best rarity seen), locked pool entries by their pool tier
    const collectedByTier = {}, lockedByTier = {};
    for (const t of TIERS) { collectedByTier[t.id] = []; lockedByTier[t.id] = 0; }
    for (const name in mine) {
      const e = mine[name];
      (collectedByTier[e.t] || collectedByTier.grey).push({ name, e });
    }
    if (pool) for (const [name, t] of pool) {
      if (!mine[name]) lockedByTier[TIER_RANK[t] != null ? t : 'grey']++;
    }
    for (const t of TIERS) collectedByTier[t.id].sort((a, b) => a.name.localeCompare(b.name));

    let html = '';
    for (const t of TIERS) {
      const got = collectedByTier[t.id], locked = lockedByTier[t.id];
      if (!got.length && !locked) continue;
      html += `<div class="col-tier">
        <div class="col-tier-h" style="color:${t.color}">${t.icon} ${t.label}<span class="tc">${got.length}${pool ? ' / ' + (got.length + locked) : ''}</span></div>
        <div class="col-grid">${
          got.map(x => `<span class="col-chip" style="--cc:${t.color}">${x.e.l ? '★ ' : ''}${escapeHTML(x.name)}${x.e.p ? ' ⚡' : ''}${x.e.c > 1 ? `<span class="n">×${x.e.c}</span>` : ''}</span>`).join('')
        }${locked ? Array(Math.min(locked, 400)).fill('<span class="col-chip locked">???</span>').join('') : ''}</div>
      </div>`;
    }
    if (!html) html = `<div class="col-empty">Nothing here yet. Spin and assign players to start your collection.</div>`;
    if (!pool) html += `<div class="col-note">Open ${g.label} once to load its full checklist and see how many cards are still out there.</div>`;
    body.innerHTML = html;
  }

  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function open(game) {
    ensureChrome();
    if (game && GAMES.some(g => g.id === game)) ACTIVE = game;
    serverSync();
    render();
    ov.classList.add('show');
    if (window.gsap) gsap.fromTo(ov.querySelector('.col-card'), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .3, ease: 'power3.out' });
    try { gtag('event', 'collection_open', { total: totalCount() }); } catch (e) {}
  }
  function close() { if (ov) ov.classList.remove('show'); }

  window.Collection = { record, has, count, totalCount, setPool, open, close, sync: serverSync, signOut, refreshBadges };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshBadges);
  else refreshBadges();
  // pull the account's collection shortly after load (give Google auto-sign-in time to set pl_account)
  setTimeout(serverSync, 1800);
  // react to sign-in/out from another tab (mirrors achievements.js)
  window.addEventListener('storage', e => {
    if (e.key !== 'pl_account') return;
    if (!acct()) { signOut(); return; }
    setTimeout(serverSync, 1200 + Math.random() * 800);
  });
})();
