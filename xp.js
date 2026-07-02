/* ============================================================================
   Pitching Lab — shared XP / Player Level engine.
   Included (defer, AFTER achievements.js) by every game + versus page. Exposes
   window.XP. Companion to achievements.js and follows the exact same patterns:
     - State persists in localStorage 'pl_xp' (shared across all games).
     - XP.award(amount, reason) adds XP, pops a "+N XP" toast (gains batch so a
       build that fires several awards shows one number), and celebrates level-ups.
     - Every achievement unlock also grants XP automatically — we wrap Ach.unlock.
     - The signed-in Google account is the source of truth and follows the user's
       email across devices (server merge = the max of local vs stored XP).
     - XP.mount() renders a level chip + progress bar into any [data-xp-bar] slot
       (drop one into a menu and it fills itself in).
   ========================================================================== */
(function () {
  'use strict';

  // ---- level curve -------------------------------------------------------
  // XP to go from level L to L+1 = 100 + (L-1)*50  (100, 150, 200, 250 …).
  // Cumulative XP required to *reach* level L: 25·(L-1)·(L+2).
  const cumToReach = L => 25 * (L - 1) * (L + 2);
  function levelFromXp(xp) {
    let L = 1;
    while (L < 999 && cumToReach(L + 1) <= xp) L++;
    return L;
  }
  // Flavor rank per level band (shown on the badge).
  const RANKS = [
    { min: 1,  name: 'Rookie Ball',  icon: '🧢' },
    { min: 5,  name: 'Prospect',     icon: '🌱' },
    { min: 10, name: 'Call-Up',      icon: '📈' },
    { min: 16, name: 'Everyday Guy', icon: '⚾' },
    { min: 24, name: 'All-Star',     icon: '⭐' },
    { min: 34, name: 'Superstar',    icon: '🌟' },
    { min: 46, name: 'MVP',          icon: '🏆' },
    { min: 60, name: 'Legend',       icon: '👑' },
    { min: 80, name: 'Immortal',     icon: '🐐' },
  ];
  const rankFor = L => { let r = RANKS[0]; for (const x of RANKS) if (L >= x.min) r = x; return r; };

  // ---- persistent state --------------------------------------------------
  // XP_VER bumps wipe pre-launch local data so everyone starts fresh; the signed-in
  // account (below) is the source of truth once you're logged in.
  const XP_VER = '2026-07-02a';
  let total = 0;
  try {
    if (localStorage.getItem('pl_xp_ver') === XP_VER) total = Number(JSON.parse(localStorage.getItem('pl_xp') || '{}').xp) || 0;
    else {
      localStorage.setItem('pl_xp_ver', XP_VER);
      localStorage.removeItem('pl_xp');
      localStorage.setItem('pl_xp_rst', XP_VER);   // also wipe the account copy on next sync
      total = 0;
    }
  } catch (e) { total = 0; }
  const persist = () => { try { localStorage.setItem('pl_xp', JSON.stringify({ xp: total })); } catch (e) {} };

  // ---- account sync (mirrors achievements.js) ----------------------------
  function acct() { try { return JSON.parse(localStorage.getItem('pl_account') || 'null'); } catch (e) { return null; } }
  let syncTimer = null;
  async function serverSync() {
    const a = acct();
    if (!a || !a.sub || !a.sessionToken) return;
    let owner = null, resetting = false;
    try { owner = localStorage.getItem('pl_xp_owner'); resetting = localStorage.getItem('pl_xp_rst') === XP_VER; } catch (e) {}
    // Same claim logic as achievements: if the local cache belongs to this account, push it up;
    // otherwise it's guest (or another account's) XP — the server adopts it only into an account
    // that has none yet, so a shared device's guest XP can't inflate an established account.
    const claiming = owner !== a.sub && !resetting;
    try {
      const r = await fetch('/api/account', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'xpSync', sub: a.sub, sessionToken: a.sessionToken, xp: total, reset: resetting, claim: claiming }),
      }).then(x => x.json());
      if (r && r.ok && typeof r.xp === 'number') {
        try { if (resetting) localStorage.removeItem('pl_xp_rst'); localStorage.setItem('pl_xp_owner', a.sub); } catch (e) {}
        if (r.xp !== total) { total = r.xp; persist(); mount(); }   // server is authoritative (max-merge)
      }
    } catch (e) {}
  }
  function queueSync() { clearTimeout(syncTimer); syncTimer = setTimeout(serverSync, 500); }
  function signOut() { total = 0; try { localStorage.removeItem('pl_xp'); localStorage.removeItem('pl_xp_owner'); } catch (e) {} mount(); }

  // ---- styles (injected so this file is drop-in) -------------------------
  const css = `
  .xp-bar{ display:flex; align-items:center; gap:11px; width:100%; padding:11px 13px; margin:2px 0 10px;
    border:1px solid var(--line,rgba(120,150,190,.16)); border-radius:12px;
    background:linear-gradient(180deg, rgba(25,198,255,.08), rgba(9,15,25,.5)); }
  .xp-bar .xb-ico{ font-size:24px; line-height:1; filter:drop-shadow(0 0 6px rgba(255,206,58,.4)); }
  .xp-bar .xb-body{ flex:1; min-width:0; }
  .xp-bar .xb-top{ display:flex; align-items:baseline; gap:7px; }
  .xp-bar .xb-lv{ font-family:'Oswald',sans-serif; font-weight:700; font-size:15px; letter-spacing:.5px; color:var(--ink,#eaf2fb); }
  .xp-bar .xb-rank{ font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:var(--accent2,#19c6ff); }
  .xp-bar .xb-xp{ margin-left:auto; font-family:'Oswald',sans-serif; font-size:11px; color:var(--muted,#7e8da3); }
  .xp-bar .xb-track{ position:relative; height:8px; margin-top:6px; border-radius:5px; overflow:hidden;
    background:rgba(120,150,190,.16); }
  .xp-bar .xb-fill{ position:absolute; inset:0 auto 0 0; width:0%; border-radius:5px;
    background:linear-gradient(90deg, var(--accent2,#19c6ff), var(--gold,#ffce3a)); box-shadow:0 0 10px rgba(25,198,255,.5); transition:width .6s cubic-bezier(.2,.8,.2,1); }
  .xp-bar .xb-need{ font-size:10px; color:var(--dim,#56627a); margin-top:4px; font-family:'Oswald',sans-serif; letter-spacing:.5px; }

  .xp-gain{ position:fixed; left:50%; bottom:20px; transform:translateX(-50%); z-index:335; display:none; align-items:center; gap:9px;
    padding:10px 18px; border-radius:999px; border:1px solid rgba(255,206,58,.4);
    background:linear-gradient(180deg, rgba(20,31,48,.96), rgba(9,15,25,.97)); backdrop-filter:blur(6px);
    box-shadow:0 12px 34px rgba(0,0,0,.5), 0 0 20px rgba(255,206,58,.16); pointer-events:none; }
  .xp-gain .xg-amt{ font-family:'Oswald',sans-serif; font-weight:700; font-size:19px; letter-spacing:.5px; color:var(--gold,#ffce3a); }
  .xp-gain .xg-txt{ font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted,#7e8da3); }

  .xp-lvl{ position:fixed; inset:0; z-index:345; display:none; align-items:center; justify-content:center; pointer-events:none; }
  .xp-lvl .xl-card{ position:relative; text-align:center; padding:26px 42px; border-radius:18px;
    border:1px solid rgba(255,206,58,.5);
    background:linear-gradient(180deg, rgba(20,31,48,.95), rgba(9,15,25,.97)); backdrop-filter:blur(8px);
    box-shadow:0 24px 70px rgba(0,0,0,.6), 0 0 44px rgba(255,206,58,.25); }
  .xp-lvl .xl-tag{ font-family:'Oswald',sans-serif; font-size:12px; letter-spacing:4px; text-transform:uppercase; color:var(--accent2,#19c6ff); }
  .xp-lvl .xl-num{ font-family:'Oswald',sans-serif; font-weight:700; font-size:64px; line-height:1; margin:6px 0 2px;
    background:linear-gradient(180deg,#fff,var(--gold,#ffce3a)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  .xp-lvl .xl-rank{ font-family:'Oswald',sans-serif; font-size:17px; letter-spacing:1px; color:var(--ink,#eaf2fb); }
  .xp-lvl .xl-rank .xl-ico{ margin-right:6px; }`;

  let chromeReady = false, gainEl, lvlEl, gainTimer;
  function ensureChrome() {
    if (chromeReady) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    gainEl = document.createElement('div'); gainEl.className = 'xp-gain';
    gainEl.innerHTML = '<span class="xg-amt"></span><span class="xg-txt"></span>';
    document.body.appendChild(gainEl);
    lvlEl = document.createElement('div'); lvlEl.className = 'xp-lvl';
    lvlEl.innerHTML = '<div class="xl-card"><div class="xl-tag">Level Up</div><div class="xl-num"></div><div class="xl-rank"></div></div>';
    document.body.appendChild(lvlEl);
    chromeReady = true;
  }

  // ---- the menu badge ----------------------------------------------------
  function mount() {
    const L = levelFromXp(total), rk = rankFor(L);
    const cur = cumToReach(L), next = cumToReach(L + 1);
    const into = total - cur, span = next - cur, pct = Math.max(0, Math.min(100, span ? (into / span) * 100 : 100));
    document.querySelectorAll('[data-xp-bar]').forEach(host => {
      host.innerHTML = `<div class="xp-bar">
        <span class="xb-ico">${rk.icon}</span>
        <div class="xb-body">
          <div class="xb-top"><span class="xb-lv">Level ${L}</span><span class="xb-rank">${rk.name}</span><span class="xb-xp">${total.toLocaleString()} XP</span></div>
          <div class="xb-track"><div class="xb-fill" style="width:${pct}%"></div></div>
          <div class="xb-need">${into.toLocaleString()} / ${span.toLocaleString()} XP to Level ${L + 1}</div>
        </div>
      </div>`;
    });
    document.querySelectorAll('[data-xp-level]').forEach(el => { el.textContent = L; });
  }

  // ---- gain toast + level-up celebration ---------------------------------
  let pendingGain = 0, levelAtBatchStart = null;
  function flushGain() {
    ensureChrome();
    const amt = pendingGain; pendingGain = 0;
    const before = levelAtBatchStart; levelAtBatchStart = null;
    if (amt <= 0) return;
    gainEl.querySelector('.xg-amt').textContent = '+' + amt.toLocaleString() + ' XP';
    gainEl.querySelector('.xg-txt').textContent = 'Player XP';
    gainEl.style.display = 'flex';
    if (window.gsap) {
      gsap.killTweensOf(gainEl);
      // keep xPercent:-50 so gsap's transform preserves the CSS horizontal centering
      gsap.fromTo(gainEl, { y: 24, opacity: 0, xPercent: -50 }, { y: 0, opacity: 1, xPercent: -50, duration: .4, ease: 'back.out(1.7)' });
    }
    clearTimeout(gainEl._t);
    gainEl._t = setTimeout(() => {
      const hide = () => { gainEl.style.display = 'none'; };
      if (window.gsap) gsap.to(gainEl, { y: 16, opacity: 0, xPercent: -50, duration: .3, ease: 'power2.in', onComplete: hide });
      else hide();
    }, 2200);
    const now = levelFromXp(total);
    if (before != null && now > before) setTimeout(() => celebrateLevel(now), 500);
  }
  function celebrateLevel(L) {
    ensureChrome();
    const rk = rankFor(L);
    lvlEl.querySelector('.xl-num').textContent = 'LV ' + L;
    lvlEl.querySelector('.xl-rank').innerHTML = `<span class="xl-ico">${rk.icon}</span>${rk.name}`;
    lvlEl.style.display = 'flex';
    try { chime(); } catch (e) {}
    const card = lvlEl.querySelector('.xl-card');
    if (window.gsap) {
      gsap.fromTo(card, { scale: .7, opacity: 0, y: 14 }, { scale: 1, opacity: 1, y: 0, duration: .55, ease: 'back.out(1.8)' });
      gsap.to(card, { scale: .9, opacity: 0, duration: .4, delay: 2, ease: 'power2.in', onComplete: () => { lvlEl.style.display = 'none'; } });
    } else setTimeout(() => { lvlEl.style.display = 'none'; }, 2200);
  }

  // ---- sound: short rising arpeggio (respects XP.muted / Ach.muted) ------
  let actx;
  function chime() {
    if (XP.muted || (window.Ach && Ach.muted)) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;
      [392, 523.25, 659.25, 783.99].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        const t = now + i * 0.07;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.45);
      });
    } catch (e) {}
  }

  // ---- public award ------------------------------------------------------
  function award(amount, reason, opts) {
    amount = Math.max(0, Math.round(Number(amount) || 0));
    if (!amount) return;
    if (levelAtBatchStart == null) levelAtBatchStart = levelFromXp(total);
    total += amount;
    persist();
    mount();
    queueSync();
    if (!(opts && opts.silent)) {
      pendingGain += amount;
      clearTimeout(gainTimer);
      gainTimer = setTimeout(flushGain, 850);   // batch several awards from one build into one toast
    }
  }

  // ---- auto-hook the achievements engine: each unlock grants XP ----------
  const ACH_XP = 40, ACH_XP_CHAL = 120;   // challenge tiles are worth more
  function hookAch() {
    if (!window.Ach || Ach.__xpHooked) return false;
    const orig = Ach.unlock;
    Ach.unlock = function (id) {
      const had = Ach.has(id);
      const r = orig.apply(this, arguments);
      if (!had && Ach.has(id)) {
        const a = (Ach.all || []).find(x => x.id === id);
        award(a && a.chal ? ACH_XP_CHAL : ACH_XP, 'achievement');
      }
      return r;
    };
    Ach.__xpHooked = true;
    return true;
  }
  // achievements.js also loads deferred; retry a few times until Ach exists.
  (function tryHook(n) { if (hookAch() || n <= 0) return; setTimeout(() => tryHook(n - 1), 300); })(12);

  const XP = {
    muted: false,
    award,
    total: () => total,
    level: () => levelFromXp(total),
    rank: () => rankFor(levelFromXp(total)),
    info: () => { const L = levelFromXp(total); return { xp: total, level: L, rank: rankFor(L), into: total - cumToReach(L), span: cumToReach(L + 1) - cumToReach(L) }; },
    mount,
    sync: serverSync,
    signOut,
  };
  window.XP = XP;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  // pull the account's XP shortly after load (give Google auto-sign-in time to set pl_account)
  setTimeout(serverSync, 1600);
  window.addEventListener('storage', e => { if (e.key === 'pl_account') serverSync(); });

  // ---- local-only test bar (never appears on the live site) --------------
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    const add = () => {
      const b = document.createElement('button');
      b.textContent = '＋ 75 XP';
      b.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:400;font:600 12px Oswald,sans-serif;letter-spacing:.5px;' +
        'color:#eaf2fb;background:#10202e;border:1px solid #ffce3a;border-radius:9px;padding:9px 12px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.5);';
      b.onclick = () => award(75, 'test');
      document.body.appendChild(b);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  }
})();
