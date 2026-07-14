// GoatLab Discord verification — confirms the signed-in player is ACTUALLY a member of the GoatLab
// Discord before paying the one-time coin reward (no more honor system). Uses Discord OAuth with the
// `guilds` scope, checks the guild is in the user's guild list, then grants (idempotent by ledger ref).
//
// Env (Vercel, mark Sensitive): DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID.
// In the Discord app (discord.com/developers) add the OAuth2 redirect:
//   https://pitchinglab.pitchergami.com/api/discord
//
//   POST /api/discord { action:'start', sub, sessionToken, returnTo } → { ok, url }  (store opens it)
//   GET  /api/discord?code=…&state=…  (Discord's callback) → checks membership, grants, 302s back
//     to <returnTo>?discord=success | claimed | notmember | error

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
const CID = process.env.DISCORD_CLIENT_ID || '';
const CSEC = process.env.DISCORD_CLIENT_SECRET || '';
const GUILD = process.env.DISCORD_GUILD_ID || '';
const STATE_SECRET = process.env.STATS_TOKEN || 'pl-balance-7f3a9c21';   // signs the OAuth state

function sign(data) { return crypto.createHmac('sha256', STATE_SECRET).update(data).digest('base64url'); }
function makeState(sub, ret) {
  const payload = Buffer.from(JSON.stringify({ s: sub, r: ret, e: Date.now() + 600000 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readState(state) {
  try {
    const [payload, sig] = String(state || '').split('.');
    if (!payload || !sig) return null;
    const expect = sign(payload);
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const o = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return (o && o.e > Date.now()) ? o : null;
  } catch (e) { return null; }
}
async function authed(sub, sessionToken) {
  if (!sub || !sessionToken) return false;
  const [u] = await sql`SELECT session_token FROM users WHERE google_sub = ${sub}`;
  return !!(u && u.session_token && u.session_token === sessionToken);
}

module.exports = async (req, res) => {
  if (!CONN) return res.status(500).json({ ok: false, error: 'Database not configured' });
  const origin = 'https://' + String(req.headers.host || 'pitchinglab.pitchergami.com');
  const redirectUri = origin + '/api/discord';

  // ---- START: authenticate the player, hand back a signed Discord authorize URL ----
  if (req.method === 'POST') {
    if (!CID) return res.status(503).json({ ok: false, error: 'Discord verification is not set up yet' });
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (body.action !== 'start') return res.status(400).json({ ok: false, error: 'unknown action' });
      if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Sign in with Google first' });
      let ret = String(body.returnTo || '/'); if (!/^\/[^/]/.test(ret)) ret = '/';
      const state = makeState(String(body.sub).slice(0, 80), ret);
      const url = 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
        client_id: CID, redirect_uri: redirectUri, response_type: 'code', scope: 'identify guilds', state,
      }).toString();
      return res.status(200).json({ ok: true, url });
    } catch (e) { return res.status(500).json({ ok: false, error: 'Server error' }); }
  }

  // ---- CALLBACK: verify state, exchange code, confirm guild membership, grant, bounce back ----
  const code = req.query && req.query.code;
  const st = readState(req.query && req.query.state);
  const back = (st && st.r) || '/';
  const bounce = (status) => { res.writeHead(302, { Location: origin + back + (back.includes('?') ? '&' : '?') + 'discord=' + status }); res.end(); };
  if (!st || !code) return bounce('error');
  try {
    const tok = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CID, client_secret: CSEC, grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri }).toString(),
    }).then(r => r.json());
    if (!tok || !tok.access_token) return bounce('error');
    const guilds = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { authorization: 'Bearer ' + tok.access_token } }).then(r => r.json());
    const member = Array.isArray(guilds) && GUILD && guilds.some(g => String(g.id) === String(GUILD));
    if (!member) return bounce('notmember');
    const sub = String(st.s).slice(0, 80);
    const amt = Catalog.EARN.discord;
    const ins = await sql`INSERT INTO coin_ledger (player_key, delta, reason, ref)
      VALUES (${sub}, ${amt}, 'discord', ${'discord:' + sub}) ON CONFLICT (ref) DO NOTHING RETURNING id`;
    if (ins.length) await sql`UPDATE users SET coins = GREATEST(0, COALESCE(coins, 0) + ${amt}) WHERE google_sub = ${sub}`;
    return bounce(ins.length ? 'success' : 'claimed');
  } catch (e) { return bounce('error'); }
};
