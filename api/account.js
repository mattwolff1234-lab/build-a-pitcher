// Accounts + saved players API (Vercel serverless, Neon Postgres).
// Sign-in is "Sign in with Google": the browser gets a Google ID token, we verify it here,
// then issue our own long-lived session token (stored on the device) for save/list/delete.
//
//   POST /api/account  { action:'login',  idToken }
//   POST /api/account  { action:'save',   sub, sessionToken, game, name, ovr, build }
//   POST /api/account  { action:'delete', sub, sessionToken, id }
//   GET  /api/account?action=list&sub=<sub>&sessionToken=<tok>&game=pitcher|batter

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

// Public OAuth client id (safe to embed). Replace the placeholder with your real id from
// Google Cloud Console, or set GOOGLE_CLIENT_ID in the Vercel project env.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || '349698720898-t9bpb8fp7ks6scf8ci8mmoeec1lpm3d3.apps.googleusercontent.com';

// Secret for the private balance-stats read (server-side only; not served to the browser).
const STATS_TOKEN = process.env.STATS_TOKEN || 'pl-balance-7f3a9c21';

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
const gameOf = g => (g === 'batter' ? 'batter' : 'pitcher');

let ready;
function ensure() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (
        google_sub text PRIMARY KEY,
        email text,
        name text,
        picture text,
        session_token text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS saves (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        google_sub text NOT NULL,
        game text NOT NULL DEFAULT 'pitcher',
        name text NOT NULL,
        ovr int NOT NULL,
        build jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_saves_user ON saves (google_sub, created_at DESC)`;
      // 1v1 Elo rating + record, stored on the user. (DEFAULT backfills existing rows.)
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_elo int NOT NULL DEFAULT 1000`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_wins int NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_losses int NOT NULL DEFAULT 0`;
      // one row per (match, player) so a result can only count once even if reported twice
      await sql`CREATE TABLE IF NOT EXISTS pvp_results (
        match_id text NOT NULL,
        google_sub text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (match_id, google_sub)
      )`;
      // anonymous match outcome log (role + win + OVRs) for measuring real balance
      await sql`CREATE TABLE IF NOT EXISTS pvp_matches (
        match_id text NOT NULL,
        role text NOT NULL,
        won boolean NOT NULL,
        ovr int,
        opp_ovr int,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (match_id, role)
      )`;
    })();
  }
  return ready;
}

// Verify a Google ID token via Google's tokeninfo endpoint (checks signature + expiry server-side);
// we then confirm the audience is our app. Returns the user's profile or null.
async function verifyGoogle(idToken) {
  if (!idToken) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
    if (!r.ok) return null;
    const p = await r.json();
    if (!p || p.aud !== GOOGLE_CLIENT_ID || !p.sub) return null;
    return { sub: p.sub, email: p.email || '', name: p.name || p.email || 'Player', picture: p.picture || '' };
  } catch (e) { return null; }
}

// Standard Elo (K=32). Each player updates only their own rating, vs the opponent's reported rating.
function nextElo(elo, oppElo, won) {
  const expected = 1 / (1 + Math.pow(10, (oppElo - elo) / 400));
  const delta = Math.round(32 * ((won ? 1 : 0) - expected));
  return { elo: Math.max(100, elo + delta), delta };
}

async function authed(sub, sessionToken) {
  if (!sub || !sessionToken) return false;
  const [u] = await sql`SELECT session_token FROM users WHERE google_sub = ${sub}`;
  return !!(u && u.session_token && u.session_token === sessionToken);
}

// Resolve who a PvP request is "as": a signed-in Google user, or an anonymous device guest
// (no password — the random guestId is the bearer). Returns the users-table key, or null.
// Guests are stored in `users` with a "guest:" key and no session token (so they can't touch
// account-only actions like save/list). Auto-creates the row so a fresh guest starts at 1000.
async function pvpKey(body) {
  if (body.guestId) {
    const key = 'guest:' + String(body.guestId).slice(0, 48);
    const name = String(body.name || 'Guest').trim().slice(0, 40) || 'Guest';
    await sql`INSERT INTO users (google_sub, name) VALUES (${key}, ${name})
      ON CONFLICT (google_sub) DO UPDATE SET name = EXCLUDED.name`;
    return key;
  }
  if (await authed(body.sub, body.sessionToken)) {
    // let the player set a public 1v1 handle (shown on the leaderboard) instead of their Google name
    const nm = String(body.name || '').trim().slice(0, 40);
    if (nm) await sql`UPDATE users SET name = ${nm} WHERE google_sub = ${body.sub}`;
    return body.sub;
  }
  return null;
}

module.exports = async (req, res) => {
  if (!CONN) return res.status(500).json({ ok: false, error: 'Database not configured' });
  try {
    await ensure();

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const action = body.action;

      if (action === 'login') {
        const profile = await verifyGoogle(body.idToken);
        if (!profile) return res.status(401).json({ ok: false, error: 'Google sign-in failed' });
        const newToken = crypto.randomBytes(24).toString('hex');
        // KEEP an existing session token instead of rotating it on every login — otherwise the
        // Google One Tap auto-sign-in that fires on each page load would invalidate the token
        // other tabs/pages are holding (which made you "get signed out" moving between pages).
        const [row] = await sql`INSERT INTO users (google_sub, email, name, picture, session_token)
          VALUES (${profile.sub}, ${profile.email}, ${profile.name}, ${profile.picture}, ${newToken})
          ON CONFLICT (google_sub) DO UPDATE SET
            email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture,
            session_token = COALESCE(users.session_token, EXCLUDED.session_token)
          RETURNING session_token`;
        return res.status(200).json({ ok: true, sub: profile.sub, email: profile.email, name: profile.name, picture: profile.picture, sessionToken: row.session_token });
      }

      if (action === 'save') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        let name = String(body.name == null ? '' : body.name).trim().slice(0, 40) || 'My Player';
        const ovr = Math.max(1, Math.min(120, Math.round(Number(body.ovr) || 0)));
        const build = body.build && typeof body.build === 'object' ? JSON.stringify(body.build) : null;
        const game = gameOf(body.game);
        const [row] = await sql`INSERT INTO saves (google_sub, game, name, ovr, build)
          VALUES (${body.sub}, ${game}, ${name}, ${ovr}, ${build}::jsonb) RETURNING id`;
        return res.status(200).json({ ok: true, id: Number(row.id) });
      }

      if (action === 'delete') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        await sql`DELETE FROM saves WHERE id = ${Number(body.id)} AND google_sub = ${body.sub}`;
        return res.status(200).json({ ok: true });
      }

      if (action === 'pvpStats') {
        const key = await pvpKey(body);
        if (!key) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const [u] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${key}`;
        if (!u) return res.status(401).json({ ok: false, error: 'Not signed in' });
        return res.status(200).json({ ok: true, elo: u.elo, wins: u.wins, losses: u.losses });
      }

      if (action === 'pvpResult') {
        const key = await pvpKey(body);
        if (!key) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const matchId = String(body.matchId || '').slice(0, 80);
        if (!matchId) return res.status(400).json({ ok: false, error: 'missing matchId' });
        const won = !!body.won;
        const oppElo = Math.max(100, Math.min(4000, Math.round(Number(body.oppElo) || 1000)));

        // anonymous balance log (one row per match+role; idempotent)
        const role = (body.role === 'pitcher' || body.role === 'batter') ? body.role : null;
        if (role) {
          const myOvr = Math.round(Number(body.ovr) || 0) || null;
          const oppOvr = Math.round(Number(body.oppOvr) || 0) || null;
          try {
            await sql`INSERT INTO pvp_matches (match_id, role, won, ovr, opp_ovr)
              VALUES (${matchId}, ${role}, ${won}, ${myOvr}, ${oppOvr})
              ON CONFLICT (match_id, role) DO NOTHING`;
          } catch (e) {}
        }
        const [u] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${key}`;
        if (!u) return res.status(401).json({ ok: false, error: 'Not signed in' });
        // dedupe: only the first report for this (match, player) counts
        const ins = await sql`INSERT INTO pvp_results (match_id, google_sub) VALUES (${matchId}, ${key})
          ON CONFLICT DO NOTHING RETURNING match_id`;
        if (!ins.length) return res.status(200).json({ ok: true, counted: false, elo: u.elo, delta: 0, wins: u.wins, losses: u.losses });
        const { elo, delta } = nextElo(u.elo, oppElo, won);
        const wins = u.wins + (won ? 1 : 0), losses = u.losses + (won ? 0 : 1);
        await sql`UPDATE users SET pvp_elo = ${elo}, pvp_wins = ${wins}, pvp_losses = ${losses} WHERE google_sub = ${key}`;
        return res.status(200).json({ ok: true, counted: true, elo, delta, wins, losses });
      }

      // Carry a device-guest's rating onto a Google account the first time they sign in
      // (only if the account hasn't played yet, so we never clobber an existing rating).
      if (action === 'pvpClaim') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const gid = body.guestId ? ('guest:' + String(body.guestId).slice(0, 48)) : null;
        const [acct] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${body.sub}`;
        if (gid && acct && acct.wins === 0 && acct.losses === 0) {
          const [g] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${gid}`;
          if (g && (g.wins > 0 || g.losses > 0)) {
            await sql`UPDATE users SET pvp_elo = ${g.elo}, pvp_wins = ${g.wins}, pvp_losses = ${g.losses} WHERE google_sub = ${body.sub}`;
            await sql`DELETE FROM users WHERE google_sub = ${gid}`;  // retire the guest identity
            return res.status(200).json({ ok: true, claimed: true, elo: g.elo, wins: g.wins, losses: g.losses });
          }
        }
        return res.status(200).json({ ok: true, claimed: false, elo: acct ? acct.elo : 1000, wins: acct ? acct.wins : 0, losses: acct ? acct.losses : 0 });
      }

      if (action === 'pvpLeaderboard') {
        const limit = Math.max(1, Math.min(100, parseInt(body.limit, 10) || 50));
        const rows = await sql`SELECT name, pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses
          FROM users WHERE (pvp_wins + pvp_losses) > 0
          ORDER BY pvp_elo DESC, (pvp_wins + pvp_losses) DESC LIMIT ${limit}`;
        // where the requester ranks (works for guests + signed-in), even if outside the top N
        let me = null;
        const key = await pvpKey(body);
        if (key) {
          const [u] = await sql`SELECT name, pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${key}`;
          if (u && (u.wins + u.losses) > 0) {
            const [{ ahead }] = await sql`SELECT count(*)::int AS ahead FROM users
              WHERE (pvp_wins + pvp_losses) > 0 AND pvp_elo > ${u.elo}`;
            me = { rank: ahead + 1, name: u.name, elo: u.elo, wins: u.wins, losses: u.losses };
          } else if (u) {
            me = { rank: null, name: u.name, elo: u.elo, wins: u.wins, losses: u.losses };
          }
        }
        return res.status(200).json({ ok: true, rows, me });
      }

      // private read of the balance log (token-gated; for diagnosing pitcher-vs-batter win rate)
      if (action === 'pvpMatchStats') {
        if (body.token !== STATS_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });
        const [r] = await sql`SELECT
          count(*) FILTER (WHERE role='pitcher')::int AS pitcher_n,
          count(*) FILTER (WHERE role='pitcher' AND won)::int AS pitcher_wins,
          count(*) FILTER (WHERE role='batter')::int AS batter_n,
          count(*) FILTER (WHERE role='batter' AND won)::int AS batter_wins,
          round(avg(ovr) FILTER (WHERE role='pitcher'), 1) AS pitcher_avg_ovr,
          round(avg(ovr) FILTER (WHERE role='batter'), 1) AS batter_avg_ovr,
          count(DISTINCT match_id)::int AS matches
          FROM pvp_matches`;
        const pr = r.pitcher_n ? (100 * r.pitcher_wins / r.pitcher_n) : null;
        const br = r.batter_n ? (100 * r.batter_wins / r.batter_n) : null;
        return res.status(200).json({ ok: true, stats: r,
          pitcher_win_pct: pr == null ? null : Number(pr.toFixed(1)),
          batter_win_pct: br == null ? null : Number(br.toFixed(1)) });
      }

      return res.status(400).json({ ok: false, error: 'Unknown action' });
    }

    // GET ?action=list
    if ((req.query && req.query.action) === 'list') {
      const sub = req.query.sub, sessionToken = req.query.sessionToken;
      if (!(await authed(sub, sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
      const game = req.query.game ? gameOf(req.query.game) : null;
      const rows = game
        ? await sql`SELECT id, game, name, ovr, build, created_at FROM saves WHERE google_sub = ${sub} AND game = ${game} ORDER BY created_at DESC`
        : await sql`SELECT id, game, name, ovr, build, created_at FROM saves WHERE google_sub = ${sub} ORDER BY created_at DESC`;
      return res.status(200).json({ ok: true, rows: rows.map(r => ({ ...r, id: Number(r.id) })) });
    }

    return res.status(400).json({ ok: false, error: 'Unknown request' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
