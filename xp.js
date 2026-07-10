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
      total = 0;
    }
    // A version bump wipes LOCAL data only. The old 'pl_xp_rst' flag propagated the wipe to the
    // account (reset:true on next sync) — but it was also set by every FRESH browser profile,
    // which zeroed the account's XP the moment you signed in on a new device/tab. Never again;
    // clear any stale flag so old installs can't re-trigger it either.
    localStorage.removeItem('pl_xp_rst');
  } catch (e) { total = 0; }
  const persist = () => { try { localStorage.setItem('pl_xp', JSON.stringify({ xp: total })); } catch (e) {} };

  // ---- account sync (mirrors achievements.js) ----------------------------
  function acct() { try { return JSON.parse(localStorage.getItem('pl_account') || 'null'); } catch (e) { return null; } }
  let syncTimer = null;
  async function serverSync() {
    const a = acct();
    if (!a || !a.sub || !a.sessionToken) return;
    let owner = null;
    try { owner = localStorage.getItem('pl_xp_owner'); } catch (e) {}
    // Local XP with no owner = earned while signed out (sign-out zeroes the local copy, so it's
    // all new) → send as a CLAIM and the server ADDS it to the account. Owned by this account →
    // plain sync (server keeps the max). Owned by a DIFFERENT account (rare — an account switch
    // that skipped sign-out) → that XP isn't ours to push; drop it and adopt the account's copy.
    if (owner && owner !== a.sub) { total = 0; lastShownXp = 0; persist(); }
    const claiming = !owner;
    // A claim is ADDED to the account server-side, so it must run once even with several tabs
    // open at sign-in: take a short-lived cross-tab lock and let the losers simply retry later
    // (next award / storage event / page load) — by then the winner has recorded pl_xp_owner
    // and they fall through to a plain max-merge sync.
    let push = total;
    if (claiming) {
      try {
        const lock = Number(localStorage.getItem('pl_xp_claim')) || 0;
        if (Date.now() - lock < 15000) return;
        localStorage.setItem('pl_xp_claim', String(Date.now()));
        // claim the freshest persisted total — this tab's in-memory copy can trail XP just earned in another tab
        push = Math.max(push, Number(JSON.parse(localStorage.getItem('pl_xp') || '{}').xp) || 0);
      } catch (e) {}
    }
    try {
      const r = await fetch('/api/account', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'xpSync', sub: a.sub, sessionToken: a.sessionToken, xp: push, claim: claiming }),
      }).then(x => x.json());
      if (r && r.ok && typeof r.xp === 'number') {
        try { localStorage.setItem('pl_xp_owner', a.sub); localStorage.removeItem('pl_xp_claim'); } catch (e) {}
        if (r.xp !== total) { total = r.xp; lastShownXp = total; persist(); mount(); }   // server is authoritative — no gain animation for a cross-device restore
      }
    } catch (e) {}
  }
  function queueSync() { clearTimeout(syncTimer); syncTimer = setTimeout(serverSync, 500); }
  function signOut() { total = 0; lastShownXp = 0; try { localStorage.removeItem('pl_xp'); localStorage.removeItem('pl_xp_owner'); } catch (e) {} mount(); }

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

  /* The animated, Pokémon-style gain HUD: slides up from the bottom, fills the bar,
     and on each level boundary flashes + bumps the level number, then wraps to empty. */
  .xp-hud{ position:fixed; left:50%; bottom:8vh; z-index:340; display:none; width:min(340px,86vw);
    padding:13px 16px 15px; border-radius:15px; border:1px solid rgba(255,206,58,.4);
    background:linear-gradient(180deg, rgba(20,31,48,.96), rgba(9,15,25,.97)); backdrop-filter:blur(7px);
    box-shadow:0 16px 46px rgba(0,0,0,.55), 0 0 26px rgba(255,206,58,.14); pointer-events:none; }
  .xp-hud .xh-top{ display:flex; align-items:center; gap:9px; margin-bottom:8px; }
  .xp-hud .xh-ico{ font-size:22px; line-height:1; filter:drop-shadow(0 0 6px rgba(255,206,58,.45)); }
  .xp-hud .xh-lv{ font-family:'Oswald',sans-serif; font-weight:700; font-size:17px; letter-spacing:.5px; color:var(--ink,#eaf2fb); transform-origin:left center; }
  .xp-hud .xh-rank{ font-family:'Oswald',sans-serif; font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--accent2,#19c6ff); }
  .xp-hud .xh-amt{ margin-left:auto; font-family:'Oswald',sans-serif; font-weight:700; font-size:16px; letter-spacing:.5px; color:var(--gold,#ffce3a); }
  .xp-hud .xh-track{ position:relative; height:12px; border-radius:7px; overflow:hidden; background:rgba(120,150,190,.18);
    box-shadow:inset 0 1px 3px rgba(0,0,0,.5); }
  .xp-hud .xh-fill{ position:absolute; inset:0 auto 0 0; width:0%; border-radius:7px;
    background:linear-gradient(90deg, var(--accent2,#19c6ff), var(--gold,#ffce3a)); box-shadow:0 0 12px rgba(25,198,255,.6); }
  .xp-hud .xh-shine{ position:absolute; inset:0; border-radius:7px; opacity:0; pointer-events:none;
    background:linear-gradient(90deg, transparent, rgba(255,255,255,.85), transparent); }
  .xp-hud .xh-need{ font-size:10px; color:var(--dim,#56627a); margin-top:5px; font-family:'Oswald',sans-serif; letter-spacing:.5px; }
  .xp-hud .xh-spark{ position:absolute; top:50%; left:50%; width:6px; height:6px; border-radius:50%;
    background:var(--gold,#ffce3a); box-shadow:0 0 8px var(--gold,#ffce3a); pointer-events:none; }
  .xp-hud.leveled{ border-color:rgba(255,206,58,.85); box-shadow:0 16px 46px rgba(0,0,0,.55), 0 0 40px rgba(255,206,58,.4); }`;

  // The stylesheet must land as soon as the bar mounts (not just when a gain animation first
  // plays) — otherwise a page that hasn't awarded XP yet (e.g. the landing page) renders the
  // menu bar completely unstyled, with the label/rank/XP text run together.
  let cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    const head = document.head || document.documentElement;
    if (!head) return;
    const s = document.createElement('style'); s.textContent = css; head.appendChild(s);
    cssInjected = true;
  }

  let chromeReady = false, hud, fillEl, shineEl, lvEl, rankEl, amtEl, icoEl, needEl, gainTimer;
  function ensureChrome() {
    if (chromeReady) return;
    injectCss();
    hud = document.createElement('div'); hud.className = 'xp-hud';
    hud.innerHTML = `<div class="xh-top"><span class="xh-ico"></span><span class="xh-lv"></span><span class="xh-rank"></span><span class="xh-amt"></span></div>
      <div class="xh-track"><div class="xh-fill"></div><div class="xh-shine"></div></div>
      <div class="xh-need"></div>`;
    document.body.appendChild(hud);
    fillEl = hud.querySelector('.xh-fill'); shineEl = hud.querySelector('.xh-shine');
    lvEl = hud.querySelector('.xh-lv'); rankEl = hud.querySelector('.xh-rank');
    amtEl = hud.querySelector('.xh-amt'); icoEl = hud.querySelector('.xh-ico'); needEl = hud.querySelector('.xh-need');
    chromeReady = true;
  }

  // ---- the menu badge ----------------------------------------------------
  function mount() {
    injectCss();
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

  // ---- animated (Pokémon-style) gain sequence ----------------------------
  // `lastShownXp` = the XP the HUD bar last rendered; the sequence animates from there to
  // the live `total`, filling the bar and — for every level boundary it crosses — flashing,
  // bumping the level number, and wrapping the bar to empty. Handles 0, 1, or many level-ups.
  let lastShownXp = total, pendingGain = 0, animBusy = false;

  function pctInto(xp) {
    const L = levelFromXp(xp), c0 = cumToReach(L), c1 = cumToReach(L + 1);
    return { L: L, c0: c0, span: c1 - c0, pct: Math.max(0, Math.min(100, ((xp - c0) / (c1 - c0)) * 100)) };
  }
  function setHudLevel(L) {
    const rk = rankFor(L);
    icoEl.textContent = rk.icon; lvEl.textContent = 'Level ' + L; rankEl.textContent = rk.name;
    const c0 = cumToReach(L), c1 = cumToReach(L + 1);
    needEl.textContent = `${(Math.max(c0, Math.min(c1, animShownXp)) - c0).toLocaleString()} / ${(c1 - c0).toLocaleString()} XP to Level ${L + 1}`;
  }
  let animShownXp = total;

  // Break [from → to] into per-level segments (each capped at its level boundary).
  function segments(from, to) {
    const segs = []; let x = from, guard = 0;
    while (guard++ < 400) {
      const L = levelFromXp(x), boundary = cumToReach(L + 1);
      if (to >= boundary) { segs.push({ from: x, to: boundary, level: L, levelEnd: true }); x = boundary; }
      else { segs.push({ from: x, to: to, level: L, levelEnd: false }); break; }
      if (x >= to) break;
    }
    return segs;
  }

  function flushGain() {
    ensureChrome();
    if (animBusy) return;                     // a sequence is running; it'll catch up on finish
    const from = lastShownXp, to = total;
    if (to <= from) { pendingGain = 0; return; }
    const gained = pendingGain; pendingGain = 0;
    animBusy = true;
    animShownXp = from;
    const segs = segments(from, to);
    const totalLevels = levelFromXp(to) - levelFromXp(from);

    // show the HUD (seeded at the starting level/fill)
    const start = pctInto(from);
    setHudLevel(start.L); fillEl.style.width = start.pct + '%'; amtEl.textContent = '+' + gained.toLocaleString() + ' XP';
    hud.style.display = 'block'; hud.classList.remove('leveled');

    const done = () => {
      animBusy = false;
      lastShownXp = to; animShownXp = to;
      clearTimeout(hud._t);
      hud._t = setTimeout(() => {
        const hide = () => { hud.style.display = 'none'; };
        if (window.gsap) gsap.to(hud, { y: 18, opacity: 0, xPercent: -50, duration: .35, ease: 'power2.in', onComplete: hide });
        else hide();
      }, 1500);
      if (total > lastShownXp) { pendingGain += (total - lastShownXp); setTimeout(flushGain, 60); }   // more arrived mid-animation
    };

    if (!window.gsap) {                        // no GSAP: jump to final state
      const end = pctInto(to); setHudLevel(end.L); fillEl.style.width = end.pct + '%';
      if (totalLevels > 0) { try { chime(); } catch (e) {} }
      hud.style.display = 'block'; done(); return;
    }

    const tl = gsap.timeline({ onComplete: done });
    tl.fromTo(hud, { y: 30, opacity: 0, xPercent: -50 }, { y: 0, opacity: 1, xPercent: -50, duration: .35, ease: 'back.out(1.6)' });
    segs.forEach(seg => {
      const c0 = cumToReach(seg.level), span = cumToReach(seg.level + 1) - c0;
      const proxy = { v: seg.from };
      const frac = (seg.to - seg.from) / span;                     // how much of this level we fill
      tl.add(() => setHudLevel(seg.level));
      tl.to(proxy, {
        v: seg.to, ease: 'none', duration: Math.max(.28, Math.min(1.15, frac * 1.15)),
        onUpdate: () => { animShownXp = proxy.v; fillEl.style.width = (((proxy.v - c0) / span) * 100) + '%'; needEl.textContent = `${Math.round(proxy.v - c0).toLocaleString()} / ${span.toLocaleString()} XP to Level ${seg.level + 1}`; },
      });
      if (seg.levelEnd) {
        tl.add(() => levelUp(seg.level + 1, totalLevels >= 2));     // flash + bump + chime, then bar wraps to 0
        tl.set(fillEl, { width: '0%' });
        tl.to({}, { duration: .34 });                              // small beat before the next fill
      }
    });
  }

  // Mini level-up celebration, played inline on the HUD (repeats for each level in a multi-up).
  function levelUp(L, big) {
    setHudLevel(L);
    try { chime(big); } catch (e) {}
    if (!window.gsap) return;
    hud.classList.add('leveled');
    gsap.fromTo(shineEl, { opacity: 0, x: '-40%' }, { opacity: 1, x: '40%', duration: .45, ease: 'power1.out', onComplete: () => gsap.to(shineEl, { opacity: 0, duration: .2 }) });
    gsap.fromTo(lvEl, { scale: 1.5, color: '#ffce3a' }, { scale: 1, color: '#eaf2fb', duration: .5, ease: 'back.out(2.2)', clearProps: 'color' });
    gsap.fromTo(hud, { scale: 1.05 }, { scale: 1, duration: .4, ease: 'elastic.out(1,.5)' });
    // spark burst from the end of the bar
    const track = hud.querySelector('.xh-track'), rect = track.getBoundingClientRect();
    const n = big ? 14 : 9;
    for (let i = 0; i < n; i++) {
      const sp = document.createElement('span'); sp.className = 'xh-spark'; track.appendChild(sp);
      const ang = (Math.random() * Math.PI) - Math.PI / 2, dist = 26 + Math.random() * 34;
      gsap.set(sp, { left: '92%', top: '50%' });
      gsap.to(sp, { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist - 8, opacity: 0, scale: .3, duration: .55 + Math.random() * .25, ease: 'power2.out', onComplete: () => sp.remove() });
    }
  }

  // ---- sound: short rising arpeggio (respects XP.muted / Ach.muted) ------
  let actx;
  function chime(big) {
    if (XP.muted || (window.Ach && Ach.muted)) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;
      const notes = big ? [392, 523.25, 659.25, 783.99, 1046.5] : [392, 523.25, 659.25, 783.99];
      notes.forEach((f, i) => {
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
    total += amount;
    persist();
    mount();
    queueSync();
    if (opts && opts.silent) { lastShownXp = total; return; }   // credited without the animation
    pendingGain += amount;
    // batch the several awards that fire in one build/career/match into a single animated run
    clearTimeout(gainTimer);
    gainTimer = setTimeout(flushGain, 320);
  }

  // ---- auto-hook the achievements engine: each unlock grants XP ----------
  // 40 normal / 120 challenge, unless the achievement def carries its own `xp`
  // (e.g. Gotta Catch 'Em All pays a jackpot for completing a full card pool).
  const ACH_XP = 40, ACH_XP_CHAL = 120;
  function hookAch() {
    if (!window.Ach || Ach.__xpHooked) return false;
    const orig = Ach.unlock;
    Ach.unlock = function (id) {
      const had = Ach.has(id);
      const r = orig.apply(this, arguments);
      if (!had && Ach.has(id)) {
        const a = (Ach.all || []).find(x => x.id === id);
        // go through the PUBLIC method: season-track.js wraps XP.award to count season XP,
        // so calling the internal award() here would earn XP the track never sees
        XP.award(a && a.xp ? a.xp : (a && a.chal ? ACH_XP_CHAL : ACH_XP), 'achievement');
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
  // React to sign-in/out happening in ANOTHER tab. On sign-out, mirror XP.signOut locally (so this
  // tab can't re-persist the old total and later double-claim it). On sign-in, sync after a beat:
  // the tab that signed in claims first and records pl_xp_owner, so by the time we run we see the
  // owner and do a plain max-merge instead of racing a second (double-counting) claim.
  window.addEventListener('storage', e => {
    if (e.key !== 'pl_account') return;
    if (!acct()) { total = 0; lastShownXp = 0; try { localStorage.removeItem('pl_xp'); localStorage.removeItem('pl_xp_owner'); } catch (err) {} mount(); return; }
    setTimeout(serverSync, 1200 + Math.random() * 800);
  });

  // ---- local-only test bar (never appears on the live site) --------------
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    const add = () => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:400;display:flex;gap:8px;';
      const mk = (txt, amt) => {
        const b = document.createElement('button');
        b.textContent = txt;
        b.style.cssText = 'font:600 12px Oswald,sans-serif;letter-spacing:.5px;color:#eaf2fb;background:#10202e;' +
          'border:1px solid #ffce3a;border-radius:9px;padding:9px 12px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.5);';
        b.onclick = () => XP.award(amt, 'test');   // public method, so wrappers (season track) see it
        return b;
      };
      wrap.appendChild(mk('＋ 75 XP', 75));            // usually a partial fill
      wrap.appendChild(mk('＋ 400 XP', 400));           // crosses one or more levels (multi-up)
      document.body.appendChild(wrap);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  }
})();
