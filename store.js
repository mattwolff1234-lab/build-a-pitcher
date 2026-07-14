/* ============================================================================
   GoatLab · 🪙 Goat Coins store (drop-in module, xp.js/hotboard.js pattern).
   Loaded (defer, AFTER catalog.js) by the hub, the 5 build games and the 3
   versus pages. Self-contained: injects its own CSS, exposes window.Store,
   fails silent when the API is unreachable.

     - Wallet is SERVER-AUTHORITATIVE and signed-in only (api/account.js:
       wallet / coinSpend / trackClaimCoins / discordClaim). This module only
       ever ASKS — guests get a "sign in to earn coins" panel.
     - Chip: any [data-coin-chip] slot becomes the balance button (opens the
       store). Balance is cached in pl_wallet for instant paint, refreshed on
       load/open/actions.
     - Real-money packs → POST /api/buy (Stripe Checkout redirect). Coins are
       credited by the WEBHOOK, so after the ?purchase=success bounce we poll
       the wallet briefly until the balance lands. Purchases are hidden inside
       the Capacitor iOS shell (Apple requires IAP for digital currency) —
       earned-coin SPENDING stays available there.
     - Spending: prices/effects live server-side in catalog.js; the copy here
       is display-only. Cosmetics unlock into the Season Track inventory
       (pl_track mirrors after coinSpend so Style/track UIs light up at once).
     - 🎁 Earn tab: one-time Discord-join reward + how-to-earn list.
   ========================================================================== */
(function () {
  'use strict';
  if (!window.Catalog) { console.warn('store.js: catalog.js must load first'); return; }
  const C = window.Catalog;

  const DISCORD_URL = 'https://discord.gg/bMVX2zJp49';

  /* ---------- identity + api ---------- */
  function acct() { try { return JSON.parse(localStorage.getItem('pl_account') || 'null'); } catch (e) { return null; } }
  function signedIn() { const a = acct(); return !!(a && a.sub && a.sessionToken); }
  function api(action, extra) {
    const a = acct();
    if (!a) return Promise.resolve(null);
    return fetch('/api/account', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ action, sub: a.sub, sessionToken: a.sessionToken }, extra || {})),
    }).then(r => r.json()).catch(() => null);
  }
  function ga(ev, params) { try { window.gtag && gtag('event', ev, params || {}); } catch (e) {} }
  const inApp = () => !!window.Capacitor;   // Capacitor iOS shell → no real-money purchases (Apple IAP rule)

  /* ---------- wallet cache ---------- */
  const WKEY = 'pl_wallet';
  let wallet = null;   // { coins, entitlements, ledger }
  try { wallet = JSON.parse(localStorage.getItem(WKEY) || 'null'); } catch (e) {}
  function saveWallet() { try { localStorage.setItem(WKEY, JSON.stringify(wallet)); } catch (e) {} }
  async function refresh() {
    if (!signedIn()) { wallet = null; paintChips(); return null; }
    const r = await api('wallet');
    if (r && r.ok) {
      wallet = { coins: r.coins, entitlements: r.entitlements || {}, ledger: r.ledger || [] };
      saveWallet(); paintChips(); renderIfOpen();
    }
    return wallet;
  }
  const coins = () => (wallet ? Number(wallet.coins) || 0 : 0);
  const ent = () => (wallet && wallet.entitlements) || {};
  function proActive() { const u = ent().pro_until; return !!(u && Date.parse(u) > Date.now()); }
  function noAds() {
    if (proActive()) return true;   // GoatLab Pro includes no-ads
    const until = ent().no_ads_until;
    return !!(until && Date.parse(until) > Date.now());
  }

  /* ---------- css ---------- */
  const css = `
  [data-coin-chip] { display:inline-flex; }
  .gc-chip { display:inline-flex; align-items:center; gap:6px; cursor:pointer; border:1px solid rgba(255,210,63,.4);
    background:rgba(50,40,12,.55); color:#ffd23f; border-radius:999px; padding:4px 12px; font-family:'Oswald',sans-serif;
    font-size:13px; font-weight:700; letter-spacing:.5px; user-select:none; }
  .gc-chip:hover { background:rgba(70,56,16,.7); }
  .gc-overlay { position:fixed; inset:0; z-index:560; display:none; align-items:center; justify-content:center;
    background:rgba(4,8,14,.72); backdrop-filter:blur(4px); padding:14px; }
  .gc-overlay.show { display:flex; }
  .gc-panel { width:100%; max-width:560px; max-height:88vh; overflow:auto; background:linear-gradient(165deg,#131f2d,#0b1119);
    border:1px solid rgba(255,210,63,.3); border-radius:16px; padding:18px; font-family:Inter,sans-serif; position:relative; }
  .gc-close { position:absolute; top:10px; right:10px; background:none; border:none; color:#8ea2bd; font-size:18px; cursor:pointer; }
  .gc-eyebrow { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:2.5px; color:#ffd23f; text-transform:uppercase; }
  .gc-title { font-family:'Oswald',sans-serif; font-size:24px; color:#fff; letter-spacing:.5px; }
  .gc-bal { font-family:'Oswald',sans-serif; font-size:15px; color:#ffd23f; margin-top:2px; }
  .gc-tabs { display:flex; gap:6px; margin:12px 0; }
  .gc-tab { flex:1; font-family:'Oswald',sans-serif; letter-spacing:1px; text-transform:uppercase; font-size:12px;
    background:rgba(20,32,48,.7); color:#8ea2bd; border:1px solid rgba(120,170,220,.2); border-radius:9px; padding:9px 4px; cursor:pointer; }
  .gc-tab.active { color:#ffd23f; border-color:rgba(255,210,63,.5); background:rgba(50,40,12,.4); }
  .gc-sec { font-family:'Oswald',sans-serif; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#5f7term90; color:#8ea2bd; margin:14px 0 6px; }
  .gc-row { display:flex; align-items:center; gap:11px; background:rgba(16,26,40,.65); border:1px solid rgba(120,170,220,.14);
    border-radius:11px; padding:10px 12px; margin-bottom:8px; }
  .gc-row .ic { font-size:22px; flex:0 0 auto; }
  .gc-row .who { flex:1 1 auto; min-width:0; }
  .gc-row .nm { font-size:13.5px; font-weight:700; color:#f2f6fb; }
  .gc-row .ds { font-size:11.5px; color:#8ea2bd; margin-top:1px; line-height:1.35; }
  .gc-buy { flex:0 0 auto; font-family:'Oswald',sans-serif; font-weight:700; letter-spacing:.5px; border-radius:9px;
    border:1px solid rgba(255,210,63,.45); background:rgba(255,210,63,.12); color:#ffd23f; padding:7px 12px; cursor:pointer; font-size:13px; }
  .gc-buy:hover { background:rgba(255,210,63,.22); }
  .gc-buy:disabled { opacity:.45; cursor:default; }
  .gc-buy.owned { border-color:rgba(57,217,138,.5); color:#39d98a; background:rgba(57,217,138,.08); }
  .gc-pro { background:linear-gradient(160deg,rgba(255,210,63,.14),rgba(120,80,255,.10)); border:1px solid rgba(255,210,63,.4);
    border-radius:13px; padding:13px 14px; margin-bottom:12px; }
  .gc-pro.gc-pro-on { background:linear-gradient(160deg,rgba(57,217,138,.14),rgba(20,32,48,.6)); border-color:rgba(57,217,138,.45); }
  .gc-pro-top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .gc-pro-name { font-family:'Oswald',sans-serif; font-size:17px; font-weight:700; color:#fff; letter-spacing:.5px; }
  .gc-pro-tag { font-family:'Oswald',sans-serif; font-size:14px; font-weight:700; color:#ffd23f; white-space:nowrap; }
  .gc-pro-tag.on { color:#39d98a; }
  .gc-pro-sub { font-size:12px; color:#c9d6e6; margin-top:3px; }
  .gc-pro-perks { margin:8px 0 2px; padding-left:18px; color:#9fb4d0; font-size:12px; line-height:1.6; }
  .gc-pro-btn { width:100%; margin-top:8px; padding:10px; font-size:14px; }
  .gc-note { font-size:11.5px; color:#8ea2bd; line-height:1.45; margin:8px 0; }
  .gc-err { font-size:12px; color:#ff7d8a; min-height:15px; margin-top:6px; }
  .gc-burst { position:fixed; z-index:600; pointer-events:none; font-size:20px; }
  @media (max-width:480px){ .gc-panel { padding:14px; } .gc-title { font-size:20px; } }`;
  let cssIn = false;
  function injectCss() { if (cssIn) return; cssIn = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }

  /* ---------- chip ---------- */
  function paintChips() {
    injectCss();
    document.querySelectorAll('[data-coin-chip]').forEach(el => {
      let chip = el.querySelector('.gc-chip');
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'gc-chip';
        chip.onclick = () => open();
        el.innerHTML = ''; el.appendChild(chip);
      }
      chip.textContent = signedIn() && wallet ? '🪙 ' + coins().toLocaleString('en-US') : '🪙 Store';
    });
  }

  /* ---------- overlay ---------- */
  let overlay = null, tab = 'shop', busy = false;
  function buildOverlay() {
    if (overlay) return;
    injectCss();
    overlay = document.createElement('div');
    overlay.className = 'gc-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }
  function close() { if (overlay) overlay.classList.remove('show'); }
  function open(startTab) {
    buildOverlay();
    tab = startTab || 'shop';
    overlay.classList.add('show');
    render();
    refresh();
    ga('store_open');
  }
  function renderIfOpen() { if (overlay && overlay.classList.contains('show')) render(); }

  function ownedSku(id, sku) {
    const e = ent();
    if (sku.type === 'pass') return !!(e.pass && e.pass[String(sku.season)]);
    if (sku.type === 'entitlement') return !!e[sku.ent];
    if (sku.type === 'cosmetic') {
      try { const t = JSON.parse(localStorage.getItem('pl_track') || '{}'); if (t.unlocked && t.unlocked[id]) return true; } catch (er) {}
      return false;
    }
    return false;   // consumables/tokens/noads are repeatable
  }
  function skuRow(id) {
    const s = C.SKUS[id];
    const owned = ownedSku(id, s);
    const noadsActive = s.type === 'noads' && noAds();
    const btn = owned ? '<button class="gc-buy owned" disabled>Owned ✓</button>'
      : `<button class="gc-buy" data-sku="${id}" ${coins() < s.price ? 'disabled title="Not enough coins"' : ''}>🪙 ${s.price}</button>`;
    const extra = noadsActive ? `<div class="ds" style="color:#39d98a">Active until ${new Date(ent().no_ads_until).toLocaleDateString()}</div>` : '';
    return `<div class="gc-row"><span class="ic">${s.icon}</span>
      <div class="who"><div class="nm">${s.name}</div><div class="ds">${s.desc || ''}</div>${extra}</div>${btn}</div>`;
  }

  // GoatLab Pro — the real-money $5/mo subscription (NOT coins). Its own hero card atop the Shop.
  function proCard() {
    const P = C.PRO; const price = '$' + (P.usd / 100).toFixed(2);
    if (proActive()) {
      const until = new Date(ent().pro_until).toLocaleDateString();
      return `<div class="gc-pro gc-pro-on">
        <div class="gc-pro-top"><span class="gc-pro-name">${P.icon} ${P.name}</span><span class="gc-pro-tag on">ACTIVE</span></div>
        <div class="gc-pro-sub">Renews ${until} · no ads + premium season pass</div>
        <button class="gc-buy" id="gcProManage" style="margin-top:9px">Manage subscription</button>
        <div class="gc-err" id="gcProMsg"></div></div>`;
    }
    const perks = (P.perks || []).map(x => `<li>${x}</li>`).join('');
    if (inApp()) {
      return `<div class="gc-pro"><div class="gc-pro-top"><span class="gc-pro-name">${P.icon} ${P.name}</span><span class="gc-pro-tag">${price}/mo</span></div>
        <div class="gc-pro-sub">${P.tagline}</div><ul class="gc-pro-perks">${perks}</ul>
        <div class="gc-note">Subscribe on the website: <b>goat-lab.app</b></div></div>`;
    }
    return `<div class="gc-pro">
      <div class="gc-pro-top"><span class="gc-pro-name">${P.icon} ${P.name}</span><span class="gc-pro-tag">${price}/mo</span></div>
      <div class="gc-pro-sub">${P.tagline}</div>
      <ul class="gc-pro-perks">${perks}</ul>
      <button class="gc-buy gc-pro-btn" id="gcProSubscribe">Get ${P.name} — ${price}/mo</button>
      <div class="gc-err" id="gcProMsg"></div></div>`;
  }
  function bodyShop() {
    const group = (title, ids) => ids.length ? `<div class="gc-sec">${title}</div>` + ids.map(skuRow).join('') : '';
    const byType = t => Object.keys(C.SKUS).filter(k => C.SKUS[k].type === t);
    return proCard()
      + group('Avatars', byType('cosmetic'))
      + group('Consumables', byType('item'))
      + group('Franchise', byType('entitlement').concat(byType('tokens')))
      + `<div class="gc-err" id="gcShopMsg"></div>`;
  }
  function bodyCoins() {
    if (inApp()) return '<div class="gc-note">Coin purchases aren’t available in the app yet — earn coins by playing, or buy them on the website: <b>goat-lab.app</b>.</div>';
    return Object.keys(C.PACKS).map(id => {
      const p = C.PACKS[id];
      return `<div class="gc-row"><span class="ic">${p.icon}</span>
        <div class="who"><div class="nm">${p.coins.toLocaleString('en-US')} Goat Coins${p.tag ? ` · <span style="color:#39d98a">${p.tag}</span>` : ''}</div>
        <div class="ds">${p.label}</div></div>
        <button class="gc-buy" data-pack="${id}">$${(p.usd / 100).toFixed(2)}</button></div>`;
    }).join('') + `<div class="gc-note">Secure checkout by Stripe. Coins land in your account automatically —
      they follow your Google sign-in on every device.</div><div class="gc-err" id="gcPackMsg"></div>`;
  }
  function bodyEarn() {
    const claimed = (wallet && (wallet.ledger || []).some(l => l.reason === 'discord'));
    const discord = claimed
      ? `<div class="gc-row"><span class="ic">💬</span><div class="who"><div class="nm">GoatLab Discord</div>
          <div class="ds">Reward claimed — see you in there!</div></div><button class="gc-buy owned" disabled>Claimed ✓</button></div>`
      : `<div class="gc-row"><span class="ic">💬</span><div class="who"><div class="nm">Join the GoatLab Discord</div>
          <div class="ds"><a href="${DISCORD_URL}" target="_blank" rel="noopener" style="color:#7aa7ff">Open the invite</a> &amp; join, then verify to claim 🪙 ${C.EARN.discord}.</div></div>
          <button class="gc-buy" id="gcDiscordJoin">Verify &amp; claim</button></div>
        <div class="gc-err" id="gcDiscordMsg"></div>`;
    return discord + `<div class="gc-sec">Ways to earn</div>
      <div class="gc-note">🗓️ <b>Daily Challenge</b> — 🪙 ${C.EARN.daily} per game, every day (first valid run).<br>
      ⚔️ <b>Ranked 1v1 wins</b> — 🪙 ${C.EARN.pvpWin} each, up to ${C.EARN.pvpWinDailyCap} wins a day.<br>
      🎟️ <b>Season Track</b> — coin tiers on the free lane, more on the <b>GoatLab Pro</b> premium lane.</div>`;
  }

  function render() {
    if (!overlay) return;
    if (!signedIn()) {
      overlay.innerHTML = `<div class="gc-panel"><button class="gc-close">✕</button>
        <div class="gc-eyebrow">GoatLab Store</div><div class="gc-title">🪙 Goat Coins</div>
        <div class="gc-note" style="margin-top:10px">Coins follow your <b>Google account</b> so they can never vanish
        with a cleared browser. Sign in from the ☰ menu, then come back — your first Daily Challenge run pays 🪙 ${C.EARN.daily}.</div></div>`;
      overlay.querySelector('.gc-close').onclick = close;
      return;
    }
    const bodies = { shop: bodyShop, coins: bodyCoins, earn: bodyEarn };
    overlay.innerHTML = `<div class="gc-panel"><button class="gc-close">✕</button>
      <div class="gc-eyebrow">GoatLab Store</div>
      <div class="gc-title">🪙 Goat Coins</div>
      <div class="gc-bal">Balance: ${coins().toLocaleString('en-US')}</div>
      <div class="gc-tabs">
        <button class="gc-tab ${tab === 'shop' ? 'active' : ''}" data-tab="shop">🛒 Shop</button>
        ${inApp() ? '' : `<button class="gc-tab ${tab === 'coins' ? 'active' : ''}" data-tab="coins">🪙 Get Coins</button>`}
        <button class="gc-tab ${tab === 'earn' ? 'active' : ''}" data-tab="earn">🎁 Earn</button>
      </div>
      <div class="gc-body">${(bodies[tab] || bodies.shop)()}</div></div>`;
    overlay.querySelector('.gc-close').onclick = close;
    overlay.querySelectorAll('.gc-tab').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
    overlay.querySelectorAll('[data-sku]').forEach(b => b.onclick = () => buySku(b));
    overlay.querySelectorAll('[data-pack]').forEach(b => b.onclick = () => buyPack(b.dataset.pack, b));
    const dj = overlay.querySelector('#gcDiscordJoin');
    if (dj) dj.onclick = () => discordVerify(dj);
    const ps = overlay.querySelector('#gcProSubscribe'); if (ps) ps.onclick = () => buyPro(ps);
    const pm = overlay.querySelector('#gcProManage'); if (pm) pm.onclick = () => managePro(pm);
  }

  /* ---------- actions ---------- */
  async function buySku(btn) {
    if (busy) return; busy = true;
    const id = btn.dataset.sku;
    btn.disabled = true; btn.textContent = '…';
    const r = await api('coinSpend', { sku: id });
    const msg = overlay.querySelector('#gcShopMsg');
    if (r && r.ok) {
      ga('coin_spend', { sku: id, price: C.SKUS[id].price });
      wallet.coins = r.coins;
      if (r.entitlements) wallet.entitlements = r.entitlements;
      saveWallet();
      // mirror into the Season Track inventory so Style/track/scout UIs light up immediately
      try {
        const t = JSON.parse(localStorage.getItem('pl_track') || '{}');
        if (C.SKUS[id].type === 'cosmetic') { t.unlocked = t.unlocked || {}; t.unlocked[id] = 1; }
        if (r.items) t.items = Object.assign(t.items || {}, r.items);
        localStorage.setItem('pl_track', JSON.stringify(t));
      } catch (e) {}
      burst(btn);
      paintChips(); render();
    } else {
      if (msg) msg.textContent = (r && r.error) || 'Could not complete that purchase.';
      btn.disabled = false; btn.textContent = '🪙 ' + C.SKUS[id].price;
    }
    busy = false;
  }
  async function buyPack(packId, btn) {
    if (busy) return; busy = true;
    btn.disabled = true; btn.textContent = 'Opening…';
    ga('coin_pack_checkout', { pack: packId });
    const a = acct();
    let r = null;
    try {
      r = await fetch('/api/buy', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'checkout', pack: packId, sub: a.sub, sessionToken: a.sessionToken,
          returnTo: location.pathname }) }).then(x => x.json());
    } catch (e) {}
    if (r && r.ok && r.url) { location.href = r.url; return; }
    const msg = overlay.querySelector('#gcPackMsg');
    if (msg) msg.textContent = (r && r.error) || 'Checkout is unavailable right now.';
    btn.disabled = false; btn.textContent = '$' + (C.PACKS[packId].usd / 100).toFixed(2);
    busy = false;
  }
  async function buyPro(btn) {
    if (busy) return; busy = true;
    btn.disabled = true; btn.textContent = 'Opening…';
    ga('pro_subscribe_checkout');
    const a = acct(); let r = null;
    try {
      r = await fetch('/api/buy', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'checkout', plan: 'pro', sub: a.sub, sessionToken: a.sessionToken, returnTo: location.pathname }) }).then(x => x.json());
    } catch (e) {}
    if (r && r.ok && r.url) { location.href = r.url; return; }
    const msg = overlay.querySelector('#gcProMsg');
    if (msg) msg.textContent = (r && r.error) || 'Subscription checkout is unavailable right now.';
    btn.disabled = false; btn.textContent = 'Get ' + C.PRO.name + ' — $' + (C.PRO.usd / 100).toFixed(2) + '/mo';
    busy = false;
  }
  async function managePro(btn) {
    if (busy) return; busy = true;
    btn.disabled = true; btn.textContent = 'Opening…';
    const r = await api('billingPortal', { returnTo: location.pathname });
    if (r && r.ok && r.url) { location.href = r.url; return; }
    const msg = overlay.querySelector('#gcProMsg');
    if (msg) msg.textContent = (r && r.error) || 'Could not open billing.';
    btn.disabled = false; btn.textContent = 'Manage subscription';
    busy = false;
  }
  // Verified Discord reward — OAuth with Discord, server confirms guild membership, then grants.
  async function discordVerify(btn) {
    if (busy) return; busy = true;
    btn.disabled = true; btn.textContent = 'Opening Discord…';
    ga('discord_verify_start');
    const a = acct(); let r = null;
    try {
      r = await fetch('/api/discord', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', sub: a.sub, sessionToken: a.sessionToken, returnTo: location.pathname }) }).then(x => x.json());
    } catch (e) {}
    if (r && r.ok && r.url) { location.href = r.url; return; }
    const msg = overlay.querySelector('#gcDiscordMsg');
    if (msg) msg.textContent = (r && r.error) || 'Discord verification is unavailable right now.';
    btn.disabled = false; btn.textContent = 'Verify & claim';
    busy = false;
  }

  /* ---------- coin burst (GSAP if present) ---------- */
  function burst(fromEl) {
    if (!window.gsap || !fromEl) return;
    const rect = fromEl.getBoundingClientRect();
    for (let i = 0; i < 10; i++) {
      const c = document.createElement('div');
      c.className = 'gc-burst'; c.textContent = '🪙';
      c.style.left = (rect.left + rect.width / 2) + 'px';
      c.style.top = (rect.top + rect.height / 2) + 'px';
      document.body.appendChild(c);
      gsap.to(c, { x: (Math.random() - 0.5) * 220, y: -60 - Math.random() * 140, opacity: 0,
        scale: 0.6 + Math.random(), duration: 0.9 + Math.random() * 0.5, ease: 'power2.out', onComplete: () => c.remove() });
    }
  }

  /* ---------- Stripe return bounce ---------- */
  function checkPurchaseReturn() {
    const q = new URLSearchParams(location.search);
    const state = q.get('purchase');
    if (!state) return;
    const isPro = q.get('pro') === '1';
    // scrub the params so refreshes don't re-trigger
    q.delete('purchase'); q.delete('session_id'); q.delete('pro');
    const qs = q.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) {}
    if (state !== 'success') return;
    // the webhook grants asynchronously — poll briefly until it lands (coins for a pack, Pro for a sub)
    const before = coins(); const wasPro = proActive();
    let tries = 0;
    const poll = async () => {
      await refresh();
      const landed = isPro ? (proActive() && !wasPro) : (coins() > before);
      if (landed || tries++ >= 6) {
        open('shop');
        const chip = document.querySelector('.gc-chip');
        if (chip) burst(chip);
        ga(isPro ? 'pro_landed' : 'coin_pack_landed', { landed: landed ? 1 : 0 });
        return;
      }
      setTimeout(poll, 1500);
    };
    poll();
  }

  /* ---------- Discord verify return bounce ---------- */
  function checkDiscordReturn() {
    const q = new URLSearchParams(location.search);
    const d = q.get('discord');
    if (!d) return;
    q.delete('discord');
    const qs = q.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) {}
    refresh().then(() => {
      open('earn');
      if (d === 'success' || d === 'claimed') { const chip = document.querySelector('.gc-chip'); if (chip) burst(chip); ga('discord_verified', { landed: d === 'success' ? 1 : 0 }); return; }
      const msg = overlay && overlay.querySelector('#gcDiscordMsg');
      if (msg) msg.textContent = d === 'notmember'
        ? 'You’re not in the GoatLab Discord yet — join with the invite above, then verify.'
        : 'Discord verification failed — please try again.';
    });
  }

  /* ---------- wiring ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('#miStore, [data-store-open]');
    if (t) { e.preventDefault(); open(); }
  });
  function boot() { paintChips(); refresh(); checkPurchaseReturn(); checkDiscordReturn(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.Store = { open, refresh, coins, noAds, entitlements: ent };
})();
