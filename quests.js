/* ============================================================================
   GoatLab — Daily Quests engine.
   Included (defer, AFTER xp.js) by every game + versus page. Exposes
   window.Quests. Companion to achievements.js / xp.js, same drop-in pattern
   (IIFE, injected CSS, localStorage).

   Every day (UTC, same clock as the Daily Challenge) three quests are drawn
   from the pool — one Easy, one Medium, one Hard — date-seeded so EVERYONE
   gets the same three. Game pages report progress via Quests.event(name, data)
   at their existing hook points:
     'assign' {game, legend, prime, rating}
     'build'  {game, ovr, vals[], legends, powers, daily, hard}
     'career' {game, ovr, hof, rings, earnings, votePct}
     'versus' {won}
   Completing a quest pays XP via XP.award; all three in one day pay a Clean
   Sweep bonus. Progress is device-local and wipes at the UTC day change (the
   XP earned is what persists — that already syncs to the account).
   ========================================================================== */
(function () {
  'use strict';

  // ---- quest pool ----------------------------------------------------------
  // Difficulty philosophy (per Matt): Easy assumes you're good at the game,
  // Hard is legitimately failable all day. Restriction quests (Purist, Flying
  // Blind) are a house favorite.
  // ev = which event advances it; n = target count (default 1);
  // hit(d) = does this event count; uniq(d) = dedupe key (count = unique keys);
  // red(cur,d) = custom reducer (win streaks reset on a loss).
  const POOL = [
    // ---- EASY (75 XP) ----
    { id: 'e_build85',   tier: 'easy', icon: '🛠️', name: 'Opening Statement', desc: 'Finish a build of 85+ OVR.',                    ev: 'build',  hit: d => d.ovr >= 85 },
    { id: 'e_legend',    tier: 'easy', icon: '🟣', name: 'Touch of Greatness', desc: 'Assign a Legend card.',                        ev: 'assign', hit: d => d.legend },
    { id: 'e_ring',      tier: 'easy', icon: '💍', name: 'Ring Season', desc: 'Sim a career that wins a championship.',              ev: 'career', hit: d => d.rings >= 1 },
    { id: 'e_floor70',   tier: 'easy', icon: '🧱', name: 'No Dead Weight', desc: 'Finish a build where every slot is 70+.',          ev: 'build',  hit: d => d.min >= 70 },
    { id: 'e_powers',    tier: 'easy', icon: '🎒', name: 'Bag of Tricks', desc: 'Use all 3 power-ups in one build.',                 ev: 'build',  hit: d => d.powers >= 3 },
    { id: 'e_2careers',  tier: 'easy', icon: '🔁', name: 'Doubleheader', desc: 'Sim 2 full careers today.',                          ev: 'career', n: 2, hit: () => true },
    { id: 'e_2legends',  tier: 'easy', icon: '👑', name: 'Purple Pair', desc: 'Assign 2 Legends today.',                             ev: 'assign', n: 2, hit: d => d.legend },
    { id: 'e_4diamonds', tier: 'easy', icon: '💎', name: 'Diamond District', desc: 'Finish a build with 4+ cards rated 85+.',        ev: 'build',  hit: d => d.d85 >= 4 },
    { id: 'e_1v1',       tier: 'easy', icon: '⚔️', name: 'Gladiator', desc: 'Win a 1v1 Face Off.',                                   ev: 'versus', hit: d => d.won },
    // ---- MEDIUM (150 XP) ----
    { id: 'm_build91',   tier: 'med', icon: '📐', name: 'Architect', desc: 'Finish a 91+ OVR build.',                                ev: 'build',  hit: d => d.ovr >= 91 },
    { id: 'm_floor80',   tier: 'med', icon: '⛓️', name: 'No Weak Links', desc: 'Finish a build where every slot is 80+.',            ev: 'build',  hit: d => d.min >= 80 },
    { id: 'm_hof',       tier: 'med', icon: '🏛️', name: 'Immortalized', desc: 'Sim a career that makes the Hall of Fame.',          ev: 'career', hit: d => d.hof },
    { id: 'm_6diamonds', tier: 'med', icon: '💠', name: 'Diamond Mine', desc: 'Finish a build with 6+ cards rated 85+.',             ev: 'build',  hit: d => d.d85 >= 6 },
    { id: 'm_3wins',     tier: 'med', icon: '🎩', name: 'Hat Trick', desc: 'Win 3 1v1 Face Offs today.',                             ev: 'versus', n: 3, hit: d => d.won },
    { id: 'm_500m',      tier: 'med', icon: '💵', name: 'Big Contract', desc: 'Sim a career earning $500M+.',                        ev: 'career', hit: d => d.earnings >= 5e8 },
    { id: 'm_2games85',  tier: 'med', icon: '🎽', name: 'Two-Sport Star', desc: 'Finish 85+ OVR builds in 2 different games.',       ev: 'build',  n: 2, hit: d => d.ovr >= 85, uniq: d => d.game },
    { id: 'm_2legends',  tier: 'med', icon: '🔮', name: 'Double Vision', desc: 'Fit 2 Legends into one build.',                      ev: 'build',  hit: d => d.legends >= 2 },
    { id: 'm_2rings',    tier: 'med', icon: '🏆', name: 'Back-to-Back', desc: 'Sim a career with 2+ championships.',                 ev: 'career', hit: d => d.rings >= 2 },
    { id: 'm_daily85',   tier: 'med', icon: '🎯', name: 'Daily Sharp', desc: "Score 85+ on today's Daily Challenge (one attempt!).", ev: 'build',  hit: d => d.daily && d.ovr >= 85 },
    { id: 'm_blind',     tier: 'med', icon: '🙈', name: 'Flying Blind', desc: 'Finish an 85+ build in Hard Mode (ratings hidden).',  ev: 'build',  hit: d => d.hard && d.ovr >= 85 },
    // ---- HARD (300 XP) ----
    { id: 'h_build96',   tier: 'hard', icon: '🖼️', name: 'Masterpiece', desc: 'Finish a 96+ OVR build.',                             ev: 'build',  hit: d => d.ovr >= 96 },
    { id: 'h_floor85',   tier: 'hard', icon: '✨', name: 'Flawless', desc: 'Finish a build where every slot is 85+.',                ev: 'build',  hit: d => d.min >= 85 },
    { id: 'h_unanimous', tier: 'hard', icon: '💯', name: 'Unanimous', desc: 'Get inducted into the Hall of Fame with a 99%+ vote.',  ev: 'career', hit: d => d.hof && d.votePct >= 99 },
    { id: 'h_5wins',     tier: 'hard', icon: '🖐️', name: 'Pentakill', desc: 'Win 5 1v1 Face Offs today.',                            ev: 'versus', n: 5, hit: d => d.won },
    { id: 'h_streak3',   tier: 'hard', icon: '🔥', name: 'Heater', desc: 'Win 3 1v1s in a row today (a loss resets you).',           ev: 'versus', n: 3, red: (c, d) => (d.won ? c + 1 : 0) },
    { id: 'h_3legends',  tier: 'hard', icon: '⚱️', name: 'Trinity', desc: 'Fit 3 Legends into one build.',                           ev: 'build',  hit: d => d.legends >= 3 },
    { id: 'h_daily90',   tier: 'hard', icon: '🎖️', name: 'Daily Dominance', desc: "Score 90+ on today's Daily Challenge (one attempt!).", ev: 'build', hit: d => d.daily && d.ovr >= 90 },
    { id: 'h_4rings',    tier: 'hard', icon: '🐐', name: 'Dynasty', desc: 'Sim a career with 4+ championships.',                     ev: 'career', hit: d => d.rings >= 4 },
    { id: 'h_billion',   tier: 'hard', icon: '🤑', name: 'Billion Dollar Day', desc: 'Sim a career earning $1B+.',                   ev: 'career', hit: d => d.earnings >= 1e9 },
    { id: 'h_purist',    tier: 'hard', icon: '🧘', name: 'Purist', desc: 'Finish a 90+ build using ZERO power-ups.',                 ev: 'build',  hit: d => d.ovr >= 90 && d.powers === 0 },
  ];
  const TIERS = {
    easy: { xp: 75,  label: 'Easy',   color: '#3ddc84' },
    med:  { xp: 150, label: 'Medium', color: '#ffce3a' },
    hard: { xp: 300, label: 'Hard',   color: '#ff5a5a' },
  };
  const SWEEP_XP = 150;
  const byId = Object.fromEntries(POOL.map(q => [q.id, q]));

  // ---- daily selection (date-seeded, same for everyone) --------------------
  // Same hash+PRNG as the games' seededRandom, copied so this file stays drop-in.
  function seededRandom(seedText) {
    let h = 2166136261;
    for (let i = 0; i < seedText.length; i++) {
      h ^= seedText.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function () {
      h += 0x6D2B79F5;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function todayUTC() { return new Date().toISOString().slice(0, 10); }
  function prevUTC(dateStr) { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
  function rawPick(dateStr, tier) {
    const pool = POOL.filter(q => q.tier === tier);
    return pool[Math.floor(seededRandom(`pl-quests-${dateStr}-${tier}-v1`)() * pool.length)];
  }
  // Never serve yesterday's quest again today (shift one slot on a collision).
  function questsFor(dateStr) {
    const prev = prevUTC(dateStr);
    return ['easy', 'med', 'hard'].map(tier => {
      const pool = POOL.filter(q => q.tier === tier);
      let q = rawPick(dateStr, tier);
      if (q.id === rawPick(prev, tier).id) q = pool[(pool.indexOf(q) + 1) % pool.length];
      return q;
    });
  }

  // ---- persistent state (device-local, wiped at the UTC day change) --------
  const KEY = 'pl_quests';
  function load() {
    const today = todayUTC();
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!s || s.date !== today) s = { date: today, prog: {}, sets: {}, done: {}, sweep: false };
    return s;
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }

  // ---- styles ---------------------------------------------------------------
  const css = `
  .dq-ov{ position:fixed; inset:0; z-index:300; display:none; align-items:center; justify-content:center; padding:14px;
    background:rgba(2,5,10,.72); backdrop-filter:blur(3px); }
  .dq-ov.show{ display:flex; }
  .dq-card{ position:relative; width:100%; max-width:560px; max-height:90dvh; display:flex; flex-direction:column;
    border:1px solid var(--line,rgba(120,150,190,.16)); border-radius:16px;
    background:linear-gradient(180deg, rgba(20,31,48,.85), rgba(9,15,25,.95)); backdrop-filter:blur(6px);
    box-shadow:0 18px 60px rgba(0,0,0,.6); overflow:hidden; }
  .dq-head{ display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid var(--line,rgba(120,150,190,.16)); }
  .dq-head .dt{ font-family:'Oswald',sans-serif; font-size:16px; letter-spacing:2px; text-transform:uppercase; }
  .dq-head .dt b{ color:var(--accent2,#19c6ff); }
  .dq-timer{ font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:1px; color:var(--muted,#7e8da3); }
  .dq-x{ margin-left:auto; font-size:16px; line-height:1; padding:6px 11px; border-radius:8px; color:var(--ink,#eaf2fb);
    background:rgba(255,255,255,.04); border:1px solid var(--line,rgba(120,150,190,.16)); cursor:pointer; }
  .dq-x:hover{ border-color:var(--accent2,#19c6ff); }
  .dq-list{ padding:12px 14px; display:flex; flex-direction:column; gap:10px; overflow-y:auto; }
  .dq-row{ position:relative; display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:13px;
    border:1px solid var(--line,rgba(120,150,190,.16)); background:linear-gradient(180deg, rgba(16,32,46,.55), rgba(8,13,22,.7)); }
  .dq-row.done{ border-color:rgba(255,206,58,.5); background:linear-gradient(180deg, rgba(255,206,58,.1), rgba(8,13,22,.7));
    box-shadow:0 0 18px rgba(255,206,58,.12); }
  .dq-tier{ flex:0 0 auto; font-family:'Oswald',sans-serif; font-size:10px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase;
    padding:4px 8px; border-radius:7px; color:var(--tc); border:1px solid var(--tc);
    background:color-mix(in srgb, var(--tc) 12%, transparent); writing-mode:vertical-rl; text-orientation:mixed; transform:rotate(180deg); }
  .dq-ico{ font-size:26px; line-height:1; flex:0 0 auto; }
  .dq-row:not(.done) .dq-ico{ filter:grayscale(.4) brightness(.85); }
  .dq-body{ flex:1; min-width:0; }
  .dq-name{ font-family:'Oswald',sans-serif; font-weight:700; font-size:15px; letter-spacing:.5px; color:var(--ink,#eaf2fb); }
  .dq-row.done .dq-name{ color:var(--gold,#ffce3a); }
  .dq-desc{ font-size:12px; color:var(--muted,#7e8da3); margin-top:2px; line-height:1.4; }
  .dq-track{ position:relative; height:7px; margin-top:7px; border-radius:4px; overflow:hidden; background:rgba(120,150,190,.16); }
  .dq-fill{ position:absolute; inset:0 auto 0 0; border-radius:4px; background:linear-gradient(90deg, var(--accent2,#19c6ff), var(--gold,#ffce3a));
    box-shadow:0 0 8px rgba(25,198,255,.5); transition:width .5s cubic-bezier(.2,.8,.2,1); }
  .dq-count{ font-family:'Oswald',sans-serif; font-size:10px; letter-spacing:.5px; color:var(--dim,#56627a); margin-top:4px; }
  .dq-right{ flex:0 0 auto; text-align:right; }
  .dq-xp{ font-family:'Oswald',sans-serif; font-weight:700; font-size:14px; letter-spacing:.5px; color:var(--gold,#ffce3a); }
  .dq-check{ font-size:22px; }
  .dq-sweep{ display:flex; align-items:center; gap:9px; margin:0 14px 14px; padding:11px 14px; border-radius:12px;
    border:1px dashed var(--line,rgba(120,150,190,.3)); font-family:'Oswald',sans-serif; font-size:12px; letter-spacing:1px;
    text-transform:uppercase; color:var(--muted,#7e8da3); }
  .dq-sweep.done{ border:1px solid rgba(255,206,58,.6); color:var(--gold,#ffce3a); box-shadow:0 0 18px rgba(255,206,58,.15); }
  .dq-toast{ position:fixed; top:18px; right:18px; z-index:340; display:none; align-items:center; gap:13px;
    padding:13px 18px 13px 14px; min-width:290px; border-radius:13px; border:1px solid rgba(25,198,255,.45);
    background:linear-gradient(180deg, rgba(20,31,48,.94), rgba(9,15,25,.96)); backdrop-filter:blur(6px);
    box-shadow:0 14px 44px rgba(0,0,0,.55), 0 0 26px rgba(25,198,255,.14); }
  .dq-toast .ti{ font-size:32px; }
  .dq-toast .tl{ font-family:'Oswald',sans-serif; font-size:11px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:var(--accent2,#19c6ff); }
  .dq-toast .tnm{ font-family:'Oswald',sans-serif; font-size:18px; font-weight:700; letter-spacing:.5px; margin-top:1px; color:var(--ink,#eaf2fb); }
  .dq-toast .tds{ font-size:11px; color:var(--gold,#ffce3a); margin-top:3px; font-family:'Oswald',sans-serif; letter-spacing:.5px; }
  @media (max-width:680px){
    .dq-ov{ padding:10px; }
    .dq-toast{ left:10px; right:10px; min-width:0; top:12px; }
  }`;

  let chromeReady = false, ov, listEl, sweepEl, timerEl, toastEl, timerInt;
  function ensureChrome() {
    if (chromeReady) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    toastEl = document.createElement('div'); toastEl.className = 'dq-toast';
    toastEl.innerHTML = '<span class="ti"></span><div><div class="tl">Quest Complete</div><div class="tnm"></div><div class="tds"></div></div>';
    document.body.appendChild(toastEl);
    chromeReady = true;
  }
  function buildDom() {
    ensureChrome();
    if (ov) return;
    ov = document.createElement('div'); ov.className = 'dq-ov';
    ov.innerHTML = `
      <div class="dq-card">
        <div class="dq-head">
          <span class="dt">📜 <b>Daily</b> Quests</span>
          <span class="dq-timer"></span>
          <button class="dq-x" aria-label="Close">✕</button>
        </div>
        <div class="dq-list"></div>
        <div class="dq-sweep"></div>
      </div>`;
    document.body.appendChild(ov);
    listEl = ov.querySelector('.dq-list');
    sweepEl = ov.querySelector('.dq-sweep');
    timerEl = ov.querySelector('.dq-timer');
    ov.querySelector('.dq-x').onclick = close;
    ov.onclick = e => { if (e.target === ov) close(); };
  }

  function msToReset() {
    const now = new Date();
    const mid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return mid - now;
  }
  function fmtReset() {
    const ms = msToReset(), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return `New quests in ${h}h ${m}m`;
  }

  function progressOf(s, q) { return Math.min(q.n || 1, Number(s.prog[q.id]) || 0); }

  function render() {
    buildDom();
    const s = load();
    const qs = questsFor(s.date);
    timerEl.textContent = fmtReset();
    listEl.innerHTML = qs.map(q => {
      const t = TIERS[q.tier], n = q.n || 1, cur = s.done[q.id] ? n : progressOf(s, q), isDone = !!s.done[q.id];
      const bar = n > 1 ? `<div class="dq-track"><div class="dq-fill" style="width:${(cur / n) * 100}%"></div></div><div class="dq-count">${cur} / ${n}</div>` : '';
      return `<div class="dq-row${isDone ? ' done' : ''}">
        <span class="dq-tier" style="--tc:${t.color}">${t.label}</span>
        <span class="dq-ico">${q.icon}</span>
        <div class="dq-body"><div class="dq-name">${q.name}</div><div class="dq-desc">${q.desc}</div>${bar}</div>
        <div class="dq-right">${isDone ? '<span class="dq-check">✅</span>' : `<span class="dq-xp">+${t.xp} XP</span>`}</div>
      </div>`;
    }).join('');
    sweepEl.className = 'dq-sweep' + (s.sweep ? ' done' : '');
    sweepEl.innerHTML = s.sweep ? `🧹 Clean Sweep! +${SWEEP_XP} XP earned` : `🧹 Clean Sweep · finish all 3 for +${SWEEP_XP} XP`;
  }

  function open() {
    render();
    ov.classList.add('show');
    clearInterval(timerInt);
    timerInt = setInterval(() => { if (timerEl) timerEl.textContent = fmtReset(); }, 30000);
    if (window.gsap) {
      gsap.fromTo(ov.querySelector('.dq-card'), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .3, ease: 'power3.out' });
      gsap.fromTo(ov.querySelectorAll('.dq-row'), { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: .35, stagger: .07, delay: .08, ease: 'power2.out' });
    }
  }
  function close() { clearInterval(timerInt); if (ov) ov.classList.remove('show'); }

  // ---- completion toast + chime --------------------------------------------
  let actx;
  function chime() {
    if ((window.Ach && Ach.muted) || (window.XP && XP.muted)) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;
      [587.33, 739.99, 880, 1174.66].forEach((f, i) => {
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

  // ---- the event sink (called from the games' existing hook points) ---------
  function event(name, data) {
    data = data || {};
    if (name === 'build' && Array.isArray(data.vals) && data.vals.length) {
      data.min = Math.min.apply(null, data.vals);
      data.d85 = data.vals.filter(v => v >= 85).length;
    }
    const s = load();
    const qs = questsFor(s.date);
    let changed = false;
    const completed = [];
    for (const q of qs) {
      if (q.ev !== name || s.done[q.id]) continue;
      const n = q.n || 1;
      let cur = Number(s.prog[q.id]) || 0;
      if (q.red) {
        const nv = q.red(cur, data);
        if (nv !== cur) { s.prog[q.id] = nv; cur = nv; changed = true; }
      } else if (q.uniq) {
        if (q.hit(data)) {
          const k = String(q.uniq(data));
          const arr = s.sets[q.id] || (s.sets[q.id] = []);
          if (arr.indexOf(k) < 0) { arr.push(k); s.prog[q.id] = cur = arr.length; changed = true; }
        }
      } else if (q.hit(data)) {
        s.prog[q.id] = ++cur; changed = true;
      }
      if (cur >= n) { s.done[q.id] = Date.now(); completed.push(q); }
    }
    for (const q of completed) {
      const t = TIERS[q.tier];
      if (window.XP) XP.award(t.xp, 'quest');
      showToast(q.icon, q.name, `${t.label} quest · +${t.xp} XP`);
      try { gtag('event', 'quest_complete', { quest: q.id, tier: q.tier }); } catch (e) {}
    }
    // toasts queue one after another, so the sweep celebration lands last on its own
    if (!s.sweep && qs.every(q => s.done[q.id])) {
      s.sweep = true; changed = true;
      if (window.XP) XP.award(SWEEP_XP, 'quest sweep');
      showToast('🧹', 'Clean Sweep!', `All 3 daily quests · +${SWEEP_XP} XP`);
      try { gtag('event', 'quest_sweep', {}); } catch (e) {}
    }
    if (changed) save(s);
    if (changed) {
      refreshBadges();
      if (ov && ov.classList.contains('show')) render();
    }
  }

  function refreshBadges() {
    const s = load();
    const n = questsFor(s.date).filter(q => s.done[q.id]).length;
    document.querySelectorAll('[data-quest-count]').forEach(el => { el.textContent = n + '/3'; });
  }

  window.Quests = {
    event, open, close, refreshBadges,
    today: () => questsFor(load().date),
    state: load,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshBadges);
  else refreshBadges();

  // ---- local-only test bar (never appears on the live site) -----------------
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !window.GOATLAB_NATIVE) {
    const mk = (txt, fn) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText = 'font:600 12px Oswald,sans-serif;letter-spacing:.5px;color:#eaf2fb;background:#10202e;' +
        'border:1px solid #3ddc84;border-radius:9px;padding:9px 12px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.5);';
      b.onclick = fn;
      return b;
    };
    const add = () => {
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;left:12px;top:12px;z-index:400;display:flex;gap:8px;flex-wrap:wrap;max-width:60vw;';
      bar.appendChild(mk('🎯 Quests', open));
      bar.appendChild(mk('🛠 96 build', () => event('build', { game: 'pitcher', ovr: 96, vals: [86, 88, 90, 85, 92, 87, 89, 91, 95], legends: 3, powers: 0, daily: false, hard: false })));
      bar.appendChild(mk('⚔️ 1v1 W', () => event('versus', { won: true })));
      bar.appendChild(mk('⚔️ 1v1 L', () => event('versus', { won: false })));
      bar.appendChild(mk('🏆 GOAT career', () => event('career', { game: 'pitcher', ovr: 97, hof: true, rings: 4, earnings: 1.2e9, votePct: 99.4 })));
      bar.appendChild(mk('🟣 legend', () => event('assign', { game: 'pitcher', legend: true, prime: false, rating: 93 })));
      bar.appendChild(mk('↺ reset day', () => { try { localStorage.removeItem(KEY); } catch (e) {} refreshBadges(); if (ov && ov.classList.contains('show')) render(); }));
      document.body.appendChild(bar);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  }
})();
