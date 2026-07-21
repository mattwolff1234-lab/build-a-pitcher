/* Jersey wardrobe — Goat Coins cosmetics the build figure actually WEARS.
   Drop-in module (xp.js pattern): loaded with `defer` on every page that loads
   store.js. The store sells jersey SKUs (catalog.js ids prefixed `jr_`, plain
   type:'cosmetic' so the server plumbing + cross-device sync are untouched:
   coinSpend writes users.cosmetics.unlocked, store.js mirrors into pl_track,
   SeasonTrack.sync unions it across devices).

   The figure pages route every garment tint through Jerseys.paint(teamColor):
   no jersey equipped (or not owned any more — e.g. after sign-out) → the plain
   team color, exactly as before. Styles are pure CSS backgrounds rendered
   through the existing garment masks — no new art files. */
(function () {
  'use strict';
  const KEY = 'pl_jersey';   // globally equipped jersey id ('' = none) — one look across all games

  // id → style. css(teamHex) returns a CSS background; team-aware styles weave the
  // team color in, full colorways ignore it. Ids must match catalog.js SKUS keys.
  const STYLES = {
    jr_pinstripe: { name: 'Pinstripes', icon: '🦓',
      css: c => `repeating-linear-gradient(90deg, #ececec 0 7px, ${c} 7px 9px)` },
    jr_retro: { name: 'Retro Cream', icon: '📻',
      css: c => `linear-gradient(180deg, #efe3c8 0%, #dbc99e 78%, ${c} 165%)` },
    jr_blackout: { name: 'Blackout', icon: '🌑',
      css: () => 'linear-gradient(180deg, #35353b, #111115)' },
    jr_gold: { name: 'All-Gold', icon: '🏆',
      css: () => 'linear-gradient(160deg, #f7d75f 0%, #d8a92e 55%, #8a6410 100%)' },
    jr_camo: { name: 'Night Ops Camo', icon: '🪖',
      css: () => 'radial-gradient(ellipse 26% 18% at 22% 28%, #45543a 0 99%, transparent 100%), ' +
        'radial-gradient(ellipse 30% 20% at 68% 62%, #2f3b28 0 99%, transparent 100%), ' +
        'radial-gradient(ellipse 22% 16% at 82% 18%, #59684a 0 99%, transparent 100%), ' +
        'radial-gradient(ellipse 24% 18% at 38% 80%, #3a462f 0 99%, transparent 100%), ' +
        'linear-gradient(180deg, #667550, #4c5a3c)' },
    jr_chrome: { name: 'Diamond Chrome', icon: '💎',
      css: () => 'linear-gradient(135deg, #e9f2fc 0%, #9db4d8 32%, #f4f9ff 52%, #86a5d6 74%, #dfe9f3 100%)' },
  };

  function equippedId() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function owns(id) {
    try { const t = JSON.parse(localStorage.getItem('pl_track') || '{}'); return !!(t.unlocked && t.unlocked[id]); }
    catch (e) { return false; }
  }
  function equip(id) {
    try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (e) {}
    try { if (typeof updateFigure === 'function') updateFigure(); } catch (e) {}
  }
  // What a garment paints: the equipped style's background (only while it's actually
  // owned) or the plain team color — the pre-jersey behavior, byte for byte.
  function paint(teamHex) {
    const id = equippedId();
    const s = id && STYLES[id];
    return (s && owns(id)) ? s.css(teamHex) : teamHex;
  }
  function preview(id) { const s = STYLES[id]; return s ? s.css('#3f7fd1') : '#3f7fd1'; }

  window.Jerseys = { STYLES, equippedId, owns, equip, paint, preview };
})();
