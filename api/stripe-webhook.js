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
    if (event.type !== 'checkout.session.completed') return res.status(200).json({ ok: true, ignored: event.type });
    const s = event.data && event.data.object;
    const sub = s && s.metadata && String(s.metadata.player_key || '').slice(0, 80);
    const pack = s && s.metadata && Catalog.PACKS[s.metadata.pack];
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
  } catch (e) {
    // 500 → Stripe retries (good: transient DB errors self-heal; the ledger ref stays idempotent)
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
