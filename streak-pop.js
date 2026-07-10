/* ============================================================================
   GoatLab · 🔥 streak-pop.js: the post-daily streak celebration.
   Drop-in (xp.js pattern): self-contained, injects its own CSS, exposes
   window.StreakPop. Loaded (defer) by the 5 game pages after season-track.js.

   Each game calls StreakPop.show({ count, frozeUsed }) right where the daily
   streak actually increments (finishDailyChallenge → mp.firstToday). Display
   only · it never touches the daily lock keys, the determinism, or the
   server's updateStreak; the one side effect is a small once-per-day XP bonus
   (10 + 2×streak, capped 50) via XP.award. Skips gracefully without GSAP/XP.
   ========================================================================== */
(function () {
  'use strict';

  const MILESTONES = [3, 7, 14, 30, 100];   // mirrors each game's STREAK_MILESTONES
  const css = `
  .spop-ov { position:fixed; inset:0; z-index:960; display:flex; align-items:center; justify-content:center;
    background:rgba(4,8,14,.82); backdrop-filter:blur(5px); }
  .spop-card { position:relative; text-align:center; padding:34px 40px 30px; max-width:min(400px, 88vw);
    border-radius:18px; border:1px solid rgba(255,140,46,.4);
    background:linear-gradient(165deg,#1c1710,#0d0a06 60%,#140d05);
    box-shadow:0 30px 90px rgba(0,0,0,.65), 0 0 60px -18px rgba(255,122,24,.55); }
  .spop-card::before, .spop-card::after { content:''; position:absolute; width:16px; height:16px; pointer-events:none;
    border:2px solid rgba(255,176,46,.6); }
  .spop-card::before { top:-1px; left:-1px; border-right:none; border-bottom:none; border-radius:18px 0 0 0; }
  .spop-card::after { bottom:-1px; right:-1px; border-left:none; border-top:none; border-radius:0 0 18px 0; }
  .spop-eyebrow { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:3.5px; color:#ffb02e; text-transform:uppercase; }
  .spop-flame { font-size:64px; line-height:1; margin:10px 0 2px; display:inline-block;
    filter:drop-shadow(0 0 18px rgba(255,122,24,.65)); }
  .spop-n { font-family:'Oswald',sans-serif; font-size:64px; font-weight:700; line-height:1; color:#fff;
    text-shadow:0 0 26px rgba(255,140,46,.5); }
  .spop-n small { font-size:20px; font-weight:600; color:#ffb02e; letter-spacing:2px; margin-left:6px; }
  .spop-label { font-family:'Oswald',sans-serif; font-size:15px; letter-spacing:2.5px; text-transform:uppercase;
    color:#f2e6d8; margin-top:2px; }
  .spop-mile { font-family:Inter,system-ui,sans-serif; font-size:13px; color:#d9c9b4; margin-top:12px; line-height:1.5; }
  .spop-mile b { color:#ffd23f; }
  .spop-froze { font-family:Inter,sans-serif; font-size:12.5px; color:#7fd7ff; margin-top:8px; }
  .spop-xp { display:inline-flex; align-items:center; gap:7px; margin-top:14px; padding:7px 16px; border-radius:20px;
    font-family:'Oswald',sans-serif; font-size:15px; font-weight:600; letter-spacing:1px; color:#0a1420;
    background:linear-gradient(135deg,#ffd23f,#ff9a2e); box-shadow:0 6px 22px rgba(255,170,46,.4); opacity:0; }
  .spop-tap { font-family:Inter,sans-serif; font-size:10.5px; color:#8a7a63; letter-spacing:1px; margin-top:14px;
    text-transform:uppercase; }
  .spop-spark { position:absolute; left:50%; top:38%; font-size:18px; pointer-events:none; }`;

  let cssIn = false;
  function injectCss() {
    if (cssIn) return; cssIn = true;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function milestoneLine(count) {
    if (MILESTONES.includes(count)) {
      const flair = { 3: "You're on a roll!", 7: 'One full week!', 14: 'Two weeks straight!', 30: 'A whole month. Legendary.', 100: 'One hundred days. GOAT status. 🐐' };
      return `🎉 <b>${count}-day milestone!</b> ${flair[count] || ''}`;
    }
    const next = MILESTONES.find(m => m > count);
    if (!next) return '';
    const left = next - count;
    return `<b>${left}</b> more day${left === 1 ? '' : 's'} → 🔥 <b>${next}-day</b> streak`;
  }

  function show(opts) {
    const count = Math.max(1, Number(opts && opts.count) || 1);
    const frozeUsed = !!(opts && opts.frozeUsed);
    // once per local day, across all five games (pl_streak is shared, so this only
    // fires on the day's FIRST daily anyway · this is a belt-and-suspenders guard)
    try {
      if (localStorage.getItem('pl_spop_day') === today()) return;
      localStorage.setItem('pl_spop_day', today());
    } catch (e) {}
    const xpAmt = Math.min(50, 10 + 2 * count);
    injectCss();
    // let the daily-results panel land first, then celebrate on top of it
    setTimeout(() => run(count, frozeUsed, xpAmt), (opts && opts.delay != null) ? opts.delay : 700);
  }

  function run(count, frozeUsed, xpAmt) {
    const ov = document.createElement('div');
    ov.className = 'spop-ov';
    ov.innerHTML = `<div class="spop-card">
      <div class="spop-eyebrow">Daily Challenge</div>
      <div class="spop-flame">🔥</div>
      <div class="spop-n"><span class="num">${count > 1 ? count - 1 : 0}</span><small>DAY${count === 1 ? '' : 'S'}</small></div>
      <div class="spop-label">Streak ${count === 1 ? 'started' : 'extended'}</div>
      ${frozeUsed ? '<div class="spop-froze">🧊 Streak Freeze used · your streak survived the missed day!</div>' : ''}
      <div class="spop-mile">${milestoneLine(count)}</div>
      ${window.XP ? `<div class="spop-xp">+${xpAmt} XP · daily streak</div>` : ''}
      <div class="spop-tap">tap to continue</div>
    </div>`;
    document.body.appendChild(ov);

    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      if (window.gsap) gsap.to(ov, { opacity: 0, duration: .3, onComplete: () => ov.remove() });
      else ov.remove();
    };
    ov.addEventListener('click', close);

    const award = () => { try { if (window.XP) XP.award(xpAmt, 'daily streak'); } catch (e) {} };

    if (!window.gsap) {   // no GSAP → static card, still counts
      ov.querySelector('.num').textContent = count;
      award();
      setTimeout(close, 2600);
      return;
    }
    const card = ov.querySelector('.spop-card');
    const numEl = ov.querySelector('.num');
    const flame = ov.querySelector('.spop-flame');
    const xpChip = ov.querySelector('.spop-xp');
    gsap.fromTo(ov, { opacity: 0 }, { opacity: 1, duration: .3 });
    gsap.fromTo(card, { y: 30, scale: .88, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: .5, ease: 'back.out(1.6)' });
    gsap.fromTo(flame, { scale: 0, rotation: -12 }, { scale: 1, rotation: 0, duration: .55, delay: .15, ease: 'back.out(2.2)' });
    gsap.to(flame, { scale: 1.08, duration: .55, delay: .8, yoyo: true, repeat: 3, ease: 'sine.inOut' });
    // the count-up: N-1 → N with a pop on landing (0 → 1 for a fresh streak)
    const cv = { v: count > 1 ? count - 1 : 0 };
    gsap.to(cv, {
      v: count, duration: .8, delay: .55, ease: 'power2.inOut',
      onUpdate: () => { numEl.textContent = Math.round(cv.v); },
      onComplete: () => {
        numEl.textContent = count;
        gsap.fromTo(numEl, { scale: 1.45, color: '#ffd23f' }, { scale: 1, color: '#ffffff', duration: .5, ease: 'back.out(2)' });
        // spark burst around the flame
        for (let i = 0; i < 8; i++) {
          const sp = document.createElement('span');
          sp.className = 'spop-spark';
          sp.textContent = i % 2 ? '✨' : '🔥';
          card.appendChild(sp);
          const a = (i / 8) * Math.PI * 2;
          gsap.fromTo(sp, { x: 0, y: 0, opacity: 1, scale: .7 },
            { x: Math.cos(a) * 90, y: Math.sin(a) * 70, opacity: 0, scale: 1.15, duration: .8, ease: 'power2.out', onComplete: () => sp.remove() });
        }
        if (xpChip) gsap.to(xpChip, { opacity: 1, y: -4, duration: .45, ease: 'back.out(1.6)' });
        award();   // XP bar (xp.js HUD) rolls in under the overlay · that's the reward shot
      },
    });
    setTimeout(close, 4600);
  }

  window.StreakPop = { show };
})();
