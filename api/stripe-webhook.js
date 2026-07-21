// Stripe webhook — the ONLY place purchased Goat Coins are credited.
//   Dashboard → Developers → Webhooks → endpoint https://<domain>/api/stripe-webhook
//   listening to `checkout.session.completed`; put its signing secret in
//   STRIPE_WEBHOOK_SECRET (Vercel env, Sensitive).
// Signature is verified by hand (HMAC-SHA256 of "<t>.<rawBody>", constant-time compare,
// 5-minute tolerance) — no Stripe SDK, same zero-dep posture as api/ably-token.js.
// Crediting is idempotent: the coin_ledger ref `stripe:<session.id>` is UNIQUE, so Stripe's
// retries / replays / duplicate deliveries can never double-credit.

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const Catalog = require('../catalog.js');

function findConn() {
  const e = process.env;
  const named = e.DATABASE_URL || e.POSTGRES_URL || e.POSTGRES_PRISMA_URL
    || e.STORAGE_URL || e.STORAGE_DATABASE_URL || e.STORAGE_POSTGRES_URL;
  if (named) return named;
  for (const k of Object.keys(e)) {
    const v = e[k];
    if (typeof v === 'string' && /^postgres(ql)?:\/\//.test(v)) return v;
  }
  return null;
}
const CONN = findConn();
const sql = CONN ? neon(CONN) : null;
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';   // needed to look up subscriptions on renewal

// --- GoatLab Pro (subscription) entitlement — stored in users.entitlements jsonb, no new columns.
async function stripeGet(path) {
  if (!STRIPE_KEY) return null;
  const r = await fetch('https://api.stripe.com/v1/' + path, { headers: { authorization: 'Bearer ' + STRIPE_KEY } });
  return r.ok ? r.json() : null;
}
async function setPro(player, patch) {
  await sql`UPDATE users SET entitlements = COALESCE(entitlements, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
    WHERE google_sub = ${player}`;
}
// Stripe API 2025+/dahlia moved current_period_end OFF the Subscription root onto its items.
// Read the latest item period end, falling back to the legacy root field for older API versions.
// (This is what was silently breaking every Pro grant: sub.current_period_end is now undefined,
//  so grantPro bailed with 'no player/end' and returned 200 without granting.)
function subPeriodEndMs(sub) {
  const items = (sub && sub.items && sub.items.data) || [];
  const fromItems = items.map(i => Number(i && i.current_period_end)).filter(n => n > 0).sort((a, b) => b - a)[0];
  const secs = fromItems || Number(sub && sub.current_period_end) || 0;
  return secs * 1000;
}
// ---- thank-you email (Resend) — sent ONCE per account, on the first subscribe only ----
// No-ops until RESEND_API_KEY is set in Vercel (see GO-LIVE.md for the ~10-min setup).
// The pro_welcomed flag is set BEFORE sending, so a Resend hiccup can never double-email
// and an email failure can never block the grant (callers swallow throws).
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || 'GoatLab <hello@goat-lab.app>';
async function sendProWelcome(player, email) {
  if (!RESEND_KEY || !email) return;
  const [u] = await sql`SELECT entitlements FROM users WHERE google_sub = ${player}`;
  const ent = (u && u.entitlements) || {};
  if (ent.pro_welcomed) return;
  await setPro(player, { pro_welcomed: 1 });
  const html = `
  <div style="max-width:520px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1a2333;line-height:1.6">
    <div style="font-size:38px;text-align:center;padding-top:18px">⭐</div>
    <h1 style="text-align:center;font-size:23px;margin:8px 0 4px">Welcome to GoatLab Pro!</h1>
    <p style="text-align:center;color:#5a6a80;margin:0 0 18px">Thanks for backing GoatLab — you just made the games better for everyone.</p>
    <div style="background:#f4f7fb;border-radius:12px;padding:16px 20px;margin-bottom:18px">
      <p style="margin:0 0 6px"><b>Everything that just unlocked:</b></p>
      <p style="margin:0">🚫 Zero ads across every GoatLab game<br>
      🎫 Every season's full GOAT Pass (every tier: cosmetics + ~1450 coins back)<br>
      ✨ Midas Glow — your name in gold with particles, in 1v1 and on the leaderboards<br>
      🌠 Golden Reel Trail on every spin<br>
      ⭐ The Pro star next to your name, everywhere</p>
    </div>
    <p style="margin:0 0 14px">Equip your golden cosmetics from the <b>🎟️ Season Track</b> panel in any game, and claim your battle-pass coins as you earn Season XP. More Pro perks land every season.</p>
    <p style="text-align:center;margin:20px 0"><a href="https://discord.gg/bMVX2zJp49" style="background:#1a2333;color:#ffd23f;text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:bold">Join the GoatLab Discord</a></p>
    <p style="color:#8a97a8;font-size:12px;text-align:center;margin-top:22px">Manage or cancel anytime: any game → 🪙 Store → Manage subscription.<br>GoatLab · Wolff Labs LLC · <a href="https://goat-lab.app/terms.html" style="color:#8a97a8">Terms &amp; refunds</a></p>
  </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + RESEND_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [String(email).slice(0, 200)],
      subject: 'Welcome to GoatLab Pro ⭐ — here’s everything you unlocked', html }),
  });
}

// Grant/extend Pro from a subscription id (checkout.session.completed + every paid invoice).
// fallbackPlayer = player_key stamped on the checkout session, in case the sub metadata is empty.
// welcomeEmail is only passed from the checkout event (never invoices), so renewals can't email.
async function grantPro(res, subId, fallbackPlayer, welcomeEmail) {
  const sub = await stripeGet('subscriptions/' + encodeURIComponent(String(subId || '')));
  if (!sub || sub.error) return res.status(200).json({ ok: true, ignored: 'sub fetch' });
  const player = String((sub.metadata && sub.metadata.player_key) || fallbackPlayer || '').slice(0, 80);
  const end = subPeriodEndMs(sub);
  if (!player || !end) return res.status(200).json({ ok: true, ignored: 'no player/end', hasPlayer: !!player, hasEnd: !!end });
  const untilISO = new Date(end).toISOString();
  await setPro(player, { pro_until: untilISO, no_ads_until: untilISO,
    pro_customer: String(sub.customer || '').slice(0, 80), pro_subscription: String(sub.id || '').slice(0, 80) });
  try { if (welcomeEmail) await sendProWelcome(player, welcomeEmail); } catch (e) {}   // email must never block the grant
  return res.status(200).json({ ok: true, pro: player, until: untilISO });
}
// Cancel — let Pro lapse at the current period end (immediate cancels put that at ~now).
async function revokePro(res, sub) {
  const player = String((sub && sub.metadata && sub.metadata.player_key) || '').slice(0, 80);
  const end = subPeriodEndMs(sub) || Date.now();
  if (!player) return res.status(200).json({ ok: true, ignored: 'no player' });
  const untilISO = new Date(end).toISOString();
  await setPro(player, { pro_until: untilISO, no_ads_until: untilISO, pro_subscription: null });
  return res.status(200).json({ ok: true, pro_revoked: player, until: untilISO });
}

// Signature verification needs the EXACT raw bytes Stripe signed — bodyParser stays off.
module.exports.config = { api: { bodyParser: false } };

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verify(raw, sigHeader) {
  if (!WHSEC || !sigHeader) return false;
  const parts = {};
  for (const kv of String(sigHeader).split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) (parts[kv.slice(0, i)] = parts[kv.slice(0, i)] || []).push(kv.slice(i + 1));
  }
  const t = Number((parts.t || [])[0]);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;   // stale/foreign timestamp
  const expect = crypto.createHmac('sha256', WHSEC).update(`${t}.${raw}`).digest('hex');
  for (const v1 of (parts.v1 || [])) {
    try {
      if (v1.length === expect.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expect))) return true;
    } catch (e) {}
  }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!CONN || !WHSEC) return res.status(503).json({ ok: false, error: 'not configured' });
  try {
    const raw = await readRaw(req);
    if (!verify(raw, req.headers['stripe-signature'])) return res.status(400).json({ ok: false, error: 'bad signature' });
    const event = JSON.parse(raw.toString('utf8'));
    const type = event.type;
    const obj = (event.data && event.data.object) || {};

    // --- GoatLab Pro subscription lifecycle ---
    // subscription id comes from the Checkout Session (obj.subscription) or an invoice
    // (obj.subscription on older API versions, obj.parent.subscription_details.subscription on dahlia).
    const proSubId = obj.subscription
      || (obj.parent && obj.parent.subscription_details && obj.parent.subscription_details.subscription) || null;
    if ((type === 'checkout.session.completed' && obj.mode === 'subscription') ||
        ((type === 'invoice.paid' || type === 'invoice.payment_succeeded') && proSubId)) {
      const welcomeEmail = type === 'checkout.session.completed'
        ? (obj.customer_details && obj.customer_details.email) || null : null;
      return await grantPro(res, proSubId, obj.metadata && obj.metadata.player_key, welcomeEmail);
    }
    if (type === 'customer.subscription.deleted') {
      return await revokePro(res, obj);   // obj = the subscription
    }

    // --- Coin packs (one-time payment) ---
    if (type === 'checkout.session.completed') {
      const s = obj;
      const sub = s.metadata && String(s.metadata.player_key || '').slice(0, 80);
      const pack = s.metadata && Catalog.PACKS[s.metadata.pack];
      if (!sub || !pack) return res.status(200).json({ ok: true, ignored: 'no metadata' });
      if (s.payment_status && s.payment_status !== 'paid') return res.status(200).json({ ok: true, ignored: s.payment_status });
      // Defense-in-depth: the paid amount must match the pack's price (a tampered session
      // can't buy the big pack for the small price).
      if (Number(s.amount_total) !== pack.usd) return res.status(200).json({ ok: true, ignored: 'amount mismatch' });
      const ins = await sql`INSERT INTO coin_ledger (player_key, delta, reason, ref)
        VALUES (${sub}, ${pack.coins}, ${'buy:' + s.metadata.pack}, ${'stripe:' + String(s.id).slice(0, 100)})
        ON CONFLICT (ref) DO NOTHING RETURNING id`;
      if (ins.length) {
        await sql`UPDATE users SET coins = GREATEST(0, COALESCE(coins, 0) + ${pack.coins}) WHERE google_sub = ${sub}`;
      }
      return res.status(200).json({ ok: true, credited: !!ins.length });
    }
    return res.status(200).json({ ok: true, ignored: type });
  } catch (e) {
    // 500 → Stripe retries (good: transient DB errors self-heal; the ledger ref stays idempotent)
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
