// Goat Coins checkout (Vercel serverless → Stripe, no SDK — raw REST like api/ably-token.js).
//   POST /api/buy { action:'checkout', pack, sub, sessionToken, returnTo? }
//     → { ok, url } — redirect the browser to Stripe Checkout. Signed-in only (a paid
//       balance must survive the browser). Coins are CREDITED by api/stripe-webhook.js on
//       checkout.session.completed — never here (a success redirect can be faked; the
//       signed webhook can't).
// Env (Vercel, mark Sensitive): STRIPE_SECRET_KEY (sk_test_… builds/tests everything;
// flip to sk_live_… + the live webhook secret when Wolff Labs' Stripe account is ready).

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
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';

async function authed(sub, sessionToken) {
  if (!sub || !sessionToken) return false;
  const [u] = await sql`SELECT session_token FROM users WHERE google_sub = ${sub}`;
  return !!(u && u.session_token && u.session_token === sessionToken);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  if (!CONN) return res.status(500).json({ ok: false, error: 'Database not configured' });
  if (!STRIPE_KEY) return res.status(503).json({ ok: false, error: 'Purchases are not set up yet' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.action !== 'checkout') return res.status(400).json({ ok: false, error: 'unknown action' });
    if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Sign in with Google first' });
    // Bounce back to wherever the store was opened from (path only — no open redirects).
    const origin = 'https://' + String(req.headers.host || 'pitchinglab.pitchergami.com');
    let returnTo = String(body.returnTo || '/');
    if (!/^\/[^/]/.test(returnTo)) returnTo = '/';
    const glue = returnTo.includes('?') ? '&' : '?';
    const playerKey = String(body.sub).slice(0, 80);

    let form;
    if (body.plan === 'pro' || body.pack === 'pro') {
      // GoatLab Pro — recurring MONTHLY subscription. Grants no-ads + premium pass; the entitlement
      // is set/renewed/expired by api/stripe-webhook.js (never here). player_key rides on the
      // subscription metadata so renewal invoices map back to this account.
      const PRO = Catalog.PRO;
      form = new URLSearchParams({
        mode: 'subscription',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(PRO.usd),
        'line_items[0][price_data][recurring][interval]': PRO.interval,
        'line_items[0][price_data][product_data][name]': PRO.name,
        'line_items[0][price_data][product_data][description]': PRO.tagline,
        'metadata[player_key]': playerKey,
        'metadata[plan]': 'pro',
        'subscription_data[metadata][player_key]': playerKey,
        success_url: origin + returnTo + glue + 'purchase=success&pro=1&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: origin + returnTo + glue + 'purchase=cancel',
      });
    } else {
      const packId = String(body.pack || '').slice(0, 20);
      const pack = Catalog.PACKS[packId];
      if (!pack) return res.status(400).json({ ok: false, error: 'Unknown pack' });
      form = new URLSearchParams({
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(pack.usd),
        'line_items[0][price_data][product_data][name]': `${pack.coins.toLocaleString('en-US')} Goat Coins`,
        'line_items[0][price_data][product_data][description]': 'GoatLab in-game currency',
        'metadata[player_key]': playerKey,
        'metadata[pack]': packId,
        success_url: origin + returnTo + glue + 'purchase=success&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: origin + returnTo + glue + 'purchase=cancel',
      });
    }
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + STRIPE_KEY, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const session = await r.json();
    if (!r.ok || !session || !session.url) {
      const msg = (session && session.error && session.error.message) || 'Stripe error';
      return res.status(502).json({ ok: false, error: msg });
    }
    return res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error: ' + (e && e.message) });
  }
};
