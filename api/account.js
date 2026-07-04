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
const gameOf = g => (g === 'batter' || g === 'baller') ? g : 'pitcher';

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
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_streak int NOT NULL DEFAULT 0`;
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
      await sql`CREATE TABLE IF NOT EXISTS pvp_history (
        id serial PRIMARY KEY,
        player_key text NOT NULL,
        match_id text NOT NULL,
        won boolean NOT NULL,
        my_role text,
        my_ovr int,
        opp_name text,
        opp_ovr int,
        elo_before int,
        elo_after int,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE pvp_history ADD COLUMN IF NOT EXISTS opp_key text`;
      // Separate NBA-1v1 ("hoops") rating board, kept on the same user rows in dedicated columns
      // so basketball ranking never mixes with baseball. (DEFAULT backfills existing rows at 1000.)
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_elo_hoops int NOT NULL DEFAULT 1000`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_wins_hoops int NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_losses_hoops int NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_streak_hoops int NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE pvp_history ADD COLUMN IF NOT EXISTS sport text`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS achievements jsonb NOT NULL DEFAULT '{}'::jsonb`;
      // Cross-game player XP (drives the account Level). Monotonic; server keeps the max of
      // local-vs-stored so progress follows the email across devices and can't be lowered.
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS xp bigint NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS current_streak int NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS best_streak int NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_date date`;
      await sql`CREATE INDEX IF NOT EXISTS idx_pvp_history_player ON pvp_history (player_key, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_pvp_history_opp_key ON pvp_history (opp_key) WHERE opp_key IS NOT NULL`;
    })().catch(e => { ready = null; throw e; });   // don't cache a transient failure forever
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
// K is overridable so the dodge-loss backfill can apply retro losses at a gentler K (softer penalty).
function nextElo(elo, oppElo, won, k = 32) {
  const expected = 1 / (1 + Math.pow(10, (oppElo - elo) / 400));
  const delta = Math.round(k * ((won ? 1 : 0) - expected));
  return { elo: Math.max(100, elo + delta), delta };
}
// Small win-streak bonus: +2 Elo per consecutive win, stops growing at a 5-win streak (max +10).
const STREAK_BONUS = 2, STREAK_CAP = 5;

// ---- NBA 1v1 ("hoops") rating: a fully separate Elo board kept on the same user rows in dedicated
// *_hoops columns. These run ONLY when the client sends sport:'hoops'; the baseball pvp* actions
// below are byte-for-byte unchanged. Same Elo math, streak bonus, and opponent-loss apply. ----
async function hoopsStats(key, res) {
  const [u] = await sql`SELECT pvp_elo_hoops AS elo, pvp_wins_hoops AS wins, pvp_losses_hoops AS losses, pvp_streak_hoops AS streak FROM users WHERE google_sub = ${key}`;
  if (!u) return res.status(401).json({ ok: false, error: 'Not signed in' });
  return res.status(200).json({ ok: true, elo: u.elo, wins: u.wins, losses: u.losses, streak: u.streak });
}
async function hoopsResult(body, key, res) {
  const matchId = String(body.matchId || '').slice(0, 80);
  if (!matchId) return res.status(400).json({ ok: false, error: 'missing matchId' });
  const won = !!body.won;
  const oppElo = Math.max(100, Math.min(4000, Math.round(Number(body.oppElo) || 1000)));
  const myOvr = Math.round(Number(body.ovr) || 0) || null;
  const oppOvr = Math.round(Number(body.oppOvr) || 0) || null;
  const oppName = String(body.oppName || '').trim().slice(0, 40) || null;
  // Authoritative opponent from the recorded match (mirrors pvpResult): charge the true loser
  // even if they quit before ever identifying themselves, and reject a reporter who provably
  // wasn't one of the two participants. Matches with no record (pre-fix or friend challenges)
  // fall through to the client-reported oppKey path.
  const normKey = p => (p && p.indexOf('acct:') === 0) ? p.slice(5) : p;
  let recordedOpp = null;
  try {
    const [mp] = await sql`SELECT claimer_pid, opp_pid FROM pvp_match_players WHERE match_id = ${matchId}`;
    if (mp) {
      const a = normKey(mp.claimer_pid), b = normKey(mp.opp_pid);
      if (key !== a && key !== b) return res.status(403).json({ ok: false, error: 'not a participant in this match' });
      recordedOpp = (key === a) ? b : a;
    }
  } catch (e) {}
  const [u] = await sql`SELECT pvp_elo_hoops AS elo, pvp_wins_hoops AS wins, pvp_losses_hoops AS losses, pvp_streak_hoops AS streak FROM users WHERE google_sub = ${key}`;
  if (!u) return res.status(401).json({ ok: false, error: 'Not signed in' });
  // namespaced dedup key so a hoops match never collides with a baseball one in the shared pvp_results
  const dedup = 'h:' + matchId;
  const ins = await sql`INSERT INTO pvp_results (match_id, google_sub) VALUES (${dedup}, ${key}) ON CONFLICT DO NOTHING RETURNING match_id`;
  if (!ins.length) {
    // Already settled — usually the winner reported first and we applied this player's loss
    // server-side. Pull the real delta from the recorded history row so the loser's screen
    // shows "-13" instead of "+0".
    let delta = 0, elo = u.elo;
    try {
      const [h] = await sql`SELECT elo_before, elo_after FROM pvp_history
        WHERE match_id = ${matchId} AND player_key = ${key} AND sport = 'hoops'`;
      if (h) { delta = h.elo_after - h.elo_before; elo = h.elo_after; }
    } catch (e) {}
    return res.status(200).json({ ok: true, counted: false, elo, delta, bonus: 0, streak: u.streak, wins: u.wins, losses: u.losses });
  }
  const { delta } = nextElo(u.elo, oppElo, won);
  const streak = won ? (u.streak || 0) + 1 : 0;
  const bonus = won ? Math.min(streak, STREAK_CAP) * STREAK_BONUS : 0;
  const elo = Math.max(100, u.elo + delta + bonus);
  const wins = u.wins + (won ? 1 : 0), losses = u.losses + (won ? 0 : 1);
  await sql`UPDATE users SET pvp_elo_hoops = ${elo}, pvp_wins_hoops = ${wins}, pvp_losses_hoops = ${losses}, pvp_streak_hoops = ${streak} WHERE google_sub = ${key}`;
  // Prefer the recorded opponent; else the client-reported oppKey. Normalize acct:<sub> to the
  // raw sub stored in users — hoops previously kept the prefix, so the loss-apply silently
  // no-op'd against every signed-in opponent (only guests ever got charged).
  const oppKeyVal = body.oppKey ? String(body.oppKey).slice(0, 80) : null;
  const clientOpp = oppKeyVal && /^(acct:|guest:)/.test(oppKeyVal) ? normKey(oppKeyVal) : null;
  const settleOpp = recordedOpp || clientOpp;
  const validOppKey = settleOpp && settleOpp !== key ? settleOpp : null;
  try {
    await sql`INSERT INTO pvp_history (player_key, match_id, won, my_role, my_ovr, opp_name, opp_ovr, opp_key, elo_before, elo_after, sport)
      VALUES (${key}, ${matchId}, ${won}, 'hooper', ${myOvr}, ${oppName}, ${oppOvr}, ${validOppKey}, ${u.elo}, ${elo}, 'hoops')`;
  } catch (e) {}
  if (won && validOppKey) {
    try {
      const oppIns = await sql`INSERT INTO pvp_results (match_id, google_sub) VALUES (${dedup}, ${validOppKey}) ON CONFLICT DO NOTHING RETURNING match_id`;
      if (oppIns.length) {
        const [opp] = await sql`SELECT pvp_elo_hoops AS elo, pvp_wins_hoops AS wins, pvp_losses_hoops AS losses FROM users WHERE google_sub = ${validOppKey}`;
        if (opp) {
          const { delta: oppDelta } = nextElo(opp.elo, u.elo, false);
          const oppNewElo = Math.max(100, opp.elo + oppDelta);
          await sql`UPDATE users SET pvp_elo_hoops = ${oppNewElo}, pvp_losses_hoops = ${opp.losses + 1}, pvp_streak_hoops = 0 WHERE google_sub = ${validOppKey}`;
          const winnerName = String(body.name || '').slice(0, 40);
          await sql`INSERT INTO pvp_history (player_key, match_id, won, my_role, my_ovr, opp_name, opp_ovr, opp_key, elo_before, elo_after, sport)
            VALUES (${validOppKey}, ${matchId}, false, 'hooper', ${oppOvr}, ${winnerName}, ${myOvr}, ${key}, ${opp.elo}, ${oppNewElo}, 'hoops')`;
        }
      }
    } catch (e) {}
  }
  return res.status(200).json({ ok: true, counted: true, elo, delta: delta + bonus, bonus, streak, wins, losses });
}
async function hoopsLeaderboard(body, res) {
  const limit = Math.max(1, Math.min(100, parseInt(body.limit, 10) || 50));
  const rows = await sql`SELECT name, pvp_elo_hoops AS elo, pvp_wins_hoops AS wins, pvp_losses_hoops AS losses
    FROM users WHERE (pvp_wins_hoops + pvp_losses_hoops) > 0
    ORDER BY pvp_elo_hoops DESC, (pvp_wins_hoops + pvp_losses_hoops) DESC LIMIT ${limit}`;
  let me = null;
  const key = await pvpKey(body);
  if (key) {
    const [u] = await sql`SELECT name, pvp_elo_hoops AS elo, pvp_wins_hoops AS wins, pvp_losses_hoops AS losses FROM users WHERE google_sub = ${key}`;
    if (u && (u.wins + u.losses) > 0) {
      const [{ ahead }] = await sql`SELECT count(*)::int AS ahead FROM users
        WHERE (pvp_wins_hoops + pvp_losses_hoops) > 0 AND pvp_elo_hoops > ${u.elo}`;
      me = { rank: ahead + 1, name: u.name, elo: u.elo, wins: u.wins, losses: u.losses };
    } else if (u) {
      me = { rank: null, name: u.name, elo: u.elo, wins: u.wins, losses: u.losses };
    }
  }
  return res.status(200).json({ ok: true, rows, me });
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
          RETURNING session_token, current_streak, best_streak, (xmax = 0) AS is_new`;
        return res.status(200).json({ ok: true, sub: profile.sub, email: profile.email, name: profile.name, picture: profile.picture, sessionToken: row.session_token,
          streak: Number(row.current_streak) || 0, bestStreak: Number(row.best_streak) || 0, isNew: row.is_new === true });
      }

      if (action === 'save') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        let name = String(body.name == null ? '' : body.name).trim().slice(0, 40) || 'My Player';
        const ovr = Math.max(1, Math.min(120, Math.round(Number(body.ovr) || 0)));
        const build = body.build && typeof body.build === 'object' ? JSON.stringify(body.build) : null;
        const game = gameOf(body.game);
        const MAX_HOF_SAVES = 50;
        const [{ count: saveCount }] = await sql`SELECT count(*)::int AS count FROM saves WHERE google_sub = ${body.sub} AND game = ${game}`;
        if (saveCount >= MAX_HOF_SAVES) return res.status(400).json({ ok: false, error: `Hall of Fame full (${MAX_HOF_SAVES} max). Delete some to save new ones.` });
        const [row] = await sql`INSERT INTO saves (google_sub, game, name, ovr, build)
          VALUES (${body.sub}, ${game}, ${name}, ${ovr}, ${build}::jsonb) RETURNING id`;
        return res.status(200).json({ ok: true, id: Number(row.id) });
      }

      if (action === 'delete') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        await sql`DELETE FROM saves WHERE id = ${Number(body.id)} AND google_sub = ${body.sub}`;
        return res.status(200).json({ ok: true });
      }

      // Bump the signed-in user's daily streak (UTC). Increments if they last played yesterday,
      // resets to 1 on a gap, no-ops if already counted today. Returns the authoritative streak.
      if (action === 'updateStreak') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const y = new Date(now); y.setUTCDate(y.getUTCDate() - 1);
        const yd = y.toISOString().slice(0, 10);
        const [u] = await sql`SELECT last_active_date, current_streak, best_streak FROM users WHERE google_sub = ${body.sub}`;
        const last = u && u.last_active_date ? String(u.last_active_date).slice(0, 10) : null;
        if (last === today) return res.status(200).json({ ok: true, streak: (u && u.current_streak) || 0, best: (u && u.best_streak) || 0, firstToday: false });
        const streak = last === yd ? (((u && u.current_streak) || 0) + 1) : 1;
        const best = Math.max((u && u.best_streak) || 0, streak);
        await sql`UPDATE users SET current_streak = ${streak}, best_streak = ${best}, last_active_date = ${today} WHERE google_sub = ${body.sub}`;
        return res.status(200).json({ ok: true, streak, best, firstToday: true });
      }

      // Merge the caller's achievements with what's stored on their account (union, keeping the
      // earliest unlock time per id) so progress follows their email across devices.
      if (action === 'achSync') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const incoming = (body.achievements && typeof body.achievements === 'object') ? body.achievements : {};
        // reset=true replaces the account copy with the caller's current set (used for version wipes);
        // otherwise merge (union, earliest unlock time wins) so progress follows the email across devices.
        const base = body.reset === true ? {} : ((await sql`SELECT achievements FROM users WHERE google_sub = ${body.sub}`)[0] || {}).achievements || {};
        // claim=true marks pre-sign-in guest progress: adopt it only into an account with no
        // unlocks yet (mirrors pvpClaim), so a shared device's guest board can never pollute an
        // established account — but a long-time guest keeps their board on first sign-in.
        const adopt = (body.claim === true && Object.keys(base).length > 0) ? {} : incoming;
        const merged = Object.assign({}, base);
        let n = 0;
        for (const k in adopt) {
          if (n++ > 200) break;
          if (typeof k !== 'string' || !k || k.length > 40) continue;
          const t = String(adopt[k] || '').slice(0, 40);
          if (!merged[k] || (t && t < merged[k])) merged[k] = t || merged[k] || new Date().toISOString();
        }
        await sql`UPDATE users SET achievements = ${JSON.stringify(merged)}::jsonb WHERE google_sub = ${body.sub}`;
        return res.status(200).json({ ok: true, achievements: merged });
      }

      // Sync cross-game player XP. XP is monotonic: the account keeps the MAX of the caller's
      // local total and what's stored, so it follows the email across devices and never drops.
      if (action === 'xpSync') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const incoming = Math.max(0, Math.min(1e12, Math.round(Number(body.xp) || 0)));
        const stored = Number(((await sql`SELECT xp FROM users WHERE google_sub = ${body.sub}`)[0] || {}).xp) || 0;
        // reset=true wipes the account copy (version wipe). claim=true (pre-sign-in guest XP)
        // is only adopted into an account that has none yet — mirrors achSync/pvpClaim.
        let merged;
        if (body.reset === true) merged = incoming;
        else if (body.claim === true && stored > 0) merged = stored;
        else merged = Math.max(stored, incoming);
        await sql`UPDATE users SET xp = ${merged} WHERE google_sub = ${body.sub}`;
        return res.status(200).json({ ok: true, xp: merged });
      }

      if (action === 'pvpStats') {
        const key = await pvpKey(body);
        if (!key) return res.status(401).json({ ok: false, error: 'Not signed in' });
        if (body.sport === 'hoops') return hoopsStats(key, res);
        const [u] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses, pvp_streak AS streak FROM users WHERE google_sub = ${key}`;
        if (!u) return res.status(401).json({ ok: false, error: 'Not signed in' });
        return res.status(200).json({ ok: true, elo: u.elo, wins: u.wins, losses: u.losses, streak: u.streak });
      }

      if (action === 'pvpResult') {
        const key = await pvpKey(body);
        if (!key) return res.status(401).json({ ok: false, error: 'Not signed in' });
        if (body.sport === 'hoops') return hoopsResult(body, key, res);
        const matchId = String(body.matchId || '').slice(0, 80);
        if (!matchId) return res.status(400).json({ ok: false, error: 'missing matchId' });
        const won = !!body.won;
        const oppElo = Math.max(100, Math.min(4000, Math.round(Number(body.oppElo) || 1000)));
        const role = (body.role === 'pitcher' || body.role === 'batter') ? body.role : null;
        const myOvr = Math.round(Number(body.ovr) || 0) || null;
        const oppOvr = Math.round(Number(body.oppOvr) || 0) || null;
        const oppName = String(body.oppName || '').trim().slice(0, 40) || null;

        // Authoritative opponent from the recorded match. Closes loss-dodging (we charge the true
        // loser from the record even if they never report) and rejects a reporter who was provably
        // not one of the two participants. Matches with no record (created before this shipped, or
        // friendly/challenge games that skip matchmaking) fall through to the legacy oppKey path.
        const normKey = p => (p && p.indexOf('acct:') === 0) ? p.slice(5) : p;
        let recordedOpp = null;
        try {
          const [mp] = await sql`SELECT claimer_pid, opp_pid FROM pvp_match_players WHERE match_id = ${matchId}`;
          if (mp) {
            const a = normKey(mp.claimer_pid), b = normKey(mp.opp_pid);
            if (key !== a && key !== b) return res.status(403).json({ ok: false, error: 'not a participant in this match' });
            recordedOpp = (key === a) ? b : a;
          }
        } catch (e) {}

        // anonymous balance log (one row per match+role; idempotent)
        if (role) {
          try {
            await sql`INSERT INTO pvp_matches (match_id, role, won, ovr, opp_ovr)
              VALUES (${matchId}, ${role}, ${won}, ${myOvr}, ${oppOvr})
              ON CONFLICT (match_id, role) DO NOTHING`;
          } catch (e) {}
        }
        const [u] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses, pvp_streak AS streak FROM users WHERE google_sub = ${key}`;
        if (!u) return res.status(401).json({ ok: false, error: 'Not signed in' });
        // dedupe: only the first report for this (match, player) counts
        const ins = await sql`INSERT INTO pvp_results (match_id, google_sub) VALUES (${matchId}, ${key})
          ON CONFLICT DO NOTHING RETURNING match_id`;
        if (!ins.length) {
          // Already settled — usually the winner reported first and we applied this player's loss
          // server-side. Pull the real delta from the recorded history row so the loser's screen
          // shows "-13" instead of "+0".
          let delta = 0, elo = u.elo;
          try {
            const [h] = await sql`SELECT elo_before, elo_after FROM pvp_history
              WHERE match_id = ${matchId} AND player_key = ${key} AND sport IS DISTINCT FROM 'hoops'`;
            if (h) { delta = h.elo_after - h.elo_before; elo = h.elo_after; }
          } catch (e) {}
          return res.status(200).json({ ok: true, counted: false, elo, delta, bonus: 0, streak: u.streak, wins: u.wins, losses: u.losses });
        }
        const { delta } = nextElo(u.elo, oppElo, won);
        // win-streak bonus (grows per consecutive win, capped at a 5-win streak)
        const streak = won ? (u.streak || 0) + 1 : 0;
        const bonus = won ? Math.min(streak, STREAK_CAP) * STREAK_BONUS : 0;
        const elo = Math.max(100, u.elo + delta + bonus);
        const wins = u.wins + (won ? 1 : 0), losses = u.losses + (won ? 0 : 1);
        await sql`UPDATE users SET pvp_elo = ${elo}, pvp_wins = ${wins}, pvp_losses = ${losses}, pvp_streak = ${streak} WHERE google_sub = ${key}`;
        // Prefer the recorded opponent; else the client-reported oppKey (normalized so account keys,
        // sent as `acct:<sub>`, match the raw `<sub>` stored in users — a bug that previously made
        // the loss-apply silently no-op for signed-in opponents).
        const oppKeyVal = body.oppKey ? String(body.oppKey).slice(0, 80) : null;
        const clientOpp = oppKeyVal && /^(acct:|guest:)/.test(oppKeyVal) ? normKey(oppKeyVal) : null;
        const settleOpp = recordedOpp || clientOpp;
        const validOppKey = settleOpp && settleOpp !== key ? settleOpp : null;
        try {
          await sql`INSERT INTO pvp_history (player_key, match_id, won, my_role, my_ovr, opp_name, opp_ovr, opp_key, elo_before, elo_after)
            VALUES (${key}, ${matchId}, ${won}, ${role}, ${myOvr}, ${oppName}, ${oppOvr}, ${validOppKey}, ${u.elo}, ${elo})`;
        } catch (e) {}
        // When the winner reports, server-side apply the loss to the opponent so they can't
        // dodge it by refreshing before pvpResult fires on their end.
        if (won && validOppKey) {
          try {
            const oppIns = await sql`INSERT INTO pvp_results (match_id, google_sub)
              VALUES (${matchId}, ${validOppKey}) ON CONFLICT DO NOTHING RETURNING match_id`;
            if (oppIns.length) {
              const [opp] = await sql`SELECT pvp_elo, pvp_wins, pvp_losses FROM users WHERE google_sub = ${validOppKey}`;
              if (opp) {
                const { delta: oppDelta } = nextElo(opp.pvp_elo, u.elo, false);
                const oppNewElo = Math.max(100, opp.pvp_elo + oppDelta);
                await sql`UPDATE users SET pvp_elo = ${oppNewElo}, pvp_losses = ${opp.pvp_losses + 1}, pvp_streak = 0 WHERE google_sub = ${validOppKey}`;
                const oppHistRole = role ? (role === 'pitcher' ? 'batter' : 'pitcher') : null;
                const winnerName = String(body.name || '').slice(0, 40);
                await sql`INSERT INTO pvp_history (player_key, match_id, won, my_role, my_ovr, opp_name, opp_ovr, opp_key, elo_before, elo_after)
                  VALUES (${validOppKey}, ${matchId}, false, ${oppHistRole}, ${oppOvr}, ${winnerName}, ${myOvr}, ${key}, ${opp.pvp_elo}, ${oppNewElo})`;
              }
            }
          } catch (e) {}
        }
        return res.status(200).json({ ok: true, counted: true, elo, delta: delta + bonus, bonus, streak, wins, losses });
      }

      if (action === 'pvpHistory') {
        const key = await pvpKey(body);
        if (!key) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const rows = body.sport === 'hoops'
          ? await sql`SELECT won, my_role, my_ovr, opp_name, opp_ovr, elo_before, elo_after, created_at
              FROM pvp_history WHERE player_key = ${key} AND sport = 'hoops' ORDER BY created_at DESC LIMIT 20`
          : await sql`SELECT won, my_role, my_ovr, opp_name, opp_ovr, elo_before, elo_after, created_at
              FROM pvp_history WHERE player_key = ${key} AND sport IS DISTINCT FROM 'hoops' ORDER BY created_at DESC LIMIT 20`;
        return res.status(200).json({ ok: true, history: rows });
      }

      // Carry a device-guest's rating onto a Google account the first time they sign in.
      // Baseball and hoops claim independently, each only onto a side the account hasn't played
      // yet (so we never clobber an existing rating). Claimed match history is re-keyed so it
      // follows the account; the guest row is only deleted once nothing unclaimed is left on it.
      if (action === 'pvpClaim') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const gid = body.guestId ? ('guest:' + String(body.guestId).slice(0, 48)) : null;
        const [acct] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses,
          pvp_elo_hoops AS helo, pvp_wins_hoops AS hwins, pvp_losses_hoops AS hlosses FROM users WHERE google_sub = ${body.sub}`;
        const [g] = gid ? await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses, pvp_streak AS streak,
          pvp_elo_hoops AS helo, pvp_wins_hoops AS hwins, pvp_losses_hoops AS hlosses, pvp_streak_hoops AS hstreak
          FROM users WHERE google_sub = ${gid}` : [];
        let claimedBase = false, claimedHoops = false;
        if (acct && g) {
          if (acct.wins === 0 && acct.losses === 0 && (g.wins > 0 || g.losses > 0)) {
            await sql`UPDATE users SET pvp_elo = ${g.elo}, pvp_wins = ${g.wins}, pvp_losses = ${g.losses}, pvp_streak = ${g.streak} WHERE google_sub = ${body.sub}`;
            await sql`UPDATE pvp_history SET player_key = ${body.sub} WHERE player_key = ${gid} AND sport IS DISTINCT FROM 'hoops'`;
            claimedBase = true;
          }
          if (acct.hwins === 0 && acct.hlosses === 0 && (g.hwins > 0 || g.hlosses > 0)) {
            await sql`UPDATE users SET pvp_elo_hoops = ${g.helo}, pvp_wins_hoops = ${g.hwins}, pvp_losses_hoops = ${g.hlosses}, pvp_streak_hoops = ${g.hstreak} WHERE google_sub = ${body.sub}`;
            await sql`UPDATE pvp_history SET player_key = ${body.sub} WHERE player_key = ${gid} AND sport = 'hoops'`;
            claimedHoops = true;
          }
          const baseLeft = (g.wins > 0 || g.losses > 0) && !claimedBase;
          const hoopsLeft = (g.hwins > 0 || g.hlosses > 0) && !claimedHoops;
          if ((claimedBase || claimedHoops) && !baseLeft && !hoopsLeft) {
            await sql`UPDATE pvp_history SET opp_key = ${body.sub} WHERE opp_key = ${gid}`;
            await sql`DELETE FROM users WHERE google_sub = ${gid}`;  // retire the guest identity
          }
        }
        const src = claimedBase ? g : acct;
        return res.status(200).json({ ok: true, claimed: claimedBase || claimedHoops, claimedHoops,
          elo: src ? src.elo : 1000, wins: src ? src.wins : 0, losses: src ? src.losses : 0 });
      }

      if (action === 'pvpLeaderboard') {
        if (body.sport === 'hoops') return hoopsLeaderboard(body, res);
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

      // admin: dump a single player's full 1v1 match history (token-gated) — for investigating
      // implausible records. Target by email (exact) or google_sub key.
      if (action === 'pvpPlayerHistory') {
        if (body.token !== STATS_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });
        let key = body.key ? String(body.key) : null;
        if (!key && body.email) {
          const [u] = await sql`SELECT google_sub FROM users WHERE lower(email) = lower(${String(body.email).trim()})`;
          key = u ? u.google_sub : null;
        }
        if (!key) return res.status(400).json({ ok: false, error: 'key or email required (no match)' });
        const [u] = await sql`SELECT google_sub, name, email, pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses, pvp_streak AS streak, created_at FROM users WHERE google_sub = ${key}`;
        const rows = await sql`
          SELECT h.match_id, h.won, h.my_role, h.my_ovr, h.opp_name, h.opp_ovr, h.opp_key, h.elo_before, h.elo_after, h.created_at,
            EXISTS (SELECT 1 FROM users ou WHERE ou.google_sub = h.opp_key) AS opp_is_real,
            EXISTS (SELECT 1 FROM pvp_history h2 WHERE h2.match_id = h.match_id AND h2.player_key = h.opp_key AND h2.won = false) AS opp_recorded_loss
          FROM pvp_history h WHERE h.player_key = ${key}
          ORDER BY h.created_at ASC`;
        return res.status(200).json({ ok: true, user: u || null, count: rows.length, history: rows });
      }

      // admin: look up a player by name and cross-check reported vs logged matches
      if (action === 'pvpUserLookup') {
        if (body.token !== STATS_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });
        const name = String(body.name || '').trim();
        if (!name) return res.status(400).json({ ok: false, error: 'name required' });
        const rows = await sql`
          SELECT u.google_sub, u.name, u.email, u.created_at,
            u.pvp_elo AS elo, u.pvp_wins AS wins, u.pvp_losses AS losses, u.pvp_streak AS streak,
            count(r.match_id)::int AS logged_matches
          FROM users u
          LEFT JOIN pvp_results r ON r.google_sub = u.google_sub
          WHERE lower(u.name) LIKE lower(${'%' + name + '%'})
          GROUP BY u.google_sub, u.name, u.email, u.created_at, u.pvp_elo, u.pvp_wins, u.pvp_losses, u.pvp_streak
          ORDER BY u.pvp_elo DESC`;
        return res.status(200).json({ ok: true, rows: rows.map(r => ({
          name: r.name, email: r.email, created_at: r.created_at,
          elo: r.elo, wins: r.wins, losses: r.losses, streak: r.streak,
          logged_matches: r.logged_matches,
          // if wins+losses >> logged_matches, they may be submitting fake results
          discrepancy: (r.wins + r.losses) - r.logged_matches
        })) });
      }

      // admin: backfill losses for players who dodged by refreshing before the result fired.
      // Finds wins with no corresponding loss in pvp_history, matches the loser by name,
      // and applies the loss if exactly one candidate exists (ambiguous names are skipped).
      // Defaults to dryRun:true — pass dryRun:false to actually commit changes.
      if (action === 'pvpBackfillLosses') {
        if (body.token !== STATS_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });
        const dryRun = body.dryRun !== false;
        // Gentler penalty for retro dodge-losses (default K=8 ≈ 1/4 of a live loss). Tunable via body.k.
        const backfillK = Math.max(1, Math.min(32, Math.round(Number(body.k) || 8)));

        // Wins with no corresponding loss row in pvp_history for the same match
        const orphanedWins = await sql`
          SELECT h.match_id, h.player_key AS winner_key, h.opp_name, h.opp_ovr,
                 h.elo_before AS winner_elo_before, h.my_ovr AS winner_ovr, h.my_role AS winner_role,
                 h.created_at
          FROM pvp_history h
          WHERE h.won = true
            AND NOT EXISTS (
              SELECT 1 FROM pvp_history h2
              WHERE h2.match_id = h.match_id AND h2.won = false
            )
          ORDER BY h.created_at ASC`;

        const results = [];
        let applied = 0, skipped_ambiguous = 0, skipped_no_candidate = 0;

        for (const win of orphanedWins) {
          // Find users whose display name matches the loser name and who haven't
          // submitted any result for this match yet
          const candidates = await sql`
            SELECT google_sub, pvp_elo, pvp_wins, pvp_losses, pvp_streak, name
            FROM users
            WHERE name = ${win.opp_name}
              AND google_sub <> ${win.winner_key}
              AND NOT EXISTS (
                SELECT 1 FROM pvp_results
                WHERE match_id = ${win.match_id} AND google_sub = users.google_sub
              )`;

          if (candidates.length === 0) {
            skipped_no_candidate++;
            results.push({ match_id: win.match_id, winner: win.winner_key, loser_name: win.opp_name, status: 'no_candidate', dry: dryRun });
            continue;
          }
          if (candidates.length > 1) {
            skipped_ambiguous++;
            results.push({ match_id: win.match_id, winner: win.winner_key, loser_name: win.opp_name, status: 'ambiguous', candidates: candidates.length, dry: dryRun });
            continue;
          }

          const loser = candidates[0];
          const { delta } = nextElo(loser.pvp_elo, win.winner_elo_before, false, backfillK);
          const newElo = Math.max(100, loser.pvp_elo + delta);

          results.push({
            match_id: win.match_id,
            winner_key: win.winner_key,
            loser_key: loser.google_sub,
            loser_name: loser.name,
            loser_elo_before: loser.pvp_elo,
            loser_elo_after: newElo,
            elo_delta: delta,
            match_date: win.created_at,
            status: dryRun ? 'would_apply' : 'applied',
          });

          if (!dryRun) {
            const ins = await sql`INSERT INTO pvp_results (match_id, google_sub)
              VALUES (${win.match_id}, ${loser.google_sub}) ON CONFLICT DO NOTHING RETURNING match_id`;
            if (ins.length) {
              await sql`UPDATE users SET pvp_elo = ${newElo}, pvp_losses = ${loser.pvp_losses + 1}, pvp_streak = 0
                WHERE google_sub = ${loser.google_sub}`;
              const loserRole = win.winner_role ? (win.winner_role === 'pitcher' ? 'batter' : 'pitcher') : null;
              const [wu] = await sql`SELECT name FROM users WHERE google_sub = ${win.winner_key}`;
              try {
                await sql`INSERT INTO pvp_history (player_key, match_id, won, my_role, my_ovr, opp_name, opp_ovr, elo_before, elo_after)
                  VALUES (${loser.google_sub}, ${win.match_id}, false, ${loserRole}, ${win.opp_ovr},
                          ${wu ? wu.name : ''}, ${win.winner_ovr}, ${loser.pvp_elo}, ${newElo})`;
              } catch (e) {}
              applied++;
            }
          }
        }

        return res.status(200).json({
          ok: true, dryRun,
          total_orphaned_wins: orphanedWins.length,
          applied, skipped_ambiguous, skipped_no_candidate,
          results,
        });
      }

      // One-time, token-gated: rebuild achievements from server evidence (pvp_history, daily_scores,
      // Hall of Fame saves) for signed-in accounts. Additive only — never removes or overwrites an
      // existing unlock — so it safely restores boards lost to the old sign-in flow that discarded
      // guest progress. Defaults to dryRun:true; pass dryRun:false to commit.
      if (action === 'achBackfill') {
        if (body.token !== STATS_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });
        const dryRun = body.dryRun !== false;
        const evid = {};
        const add = (sub, ...ids) => {
          if (!sub || sub.indexOf('guest:') === 0) return;
          const set = evid[sub] || (evid[sub] = new Set());
          for (const id of ids) set.add(id);
        };

        // 1v1 (both sports share the achievement board): played, win runs, Elo peaks, blowouts, upsets
        const hist = await sql`SELECT player_key, won, my_ovr, opp_ovr, elo_after
          FROM pvp_history WHERE player_key NOT LIKE 'guest:%' ORDER BY player_key, created_at`;
        let prev = null, run = 0;
        for (const h of hist) {
          if (h.player_key !== prev) { prev = h.player_key; run = 0; }
          add(h.player_key, 'versus_root');
          run = h.won ? run + 1 : 0;
          if (run >= 3) add(h.player_key, 'streak1');
          if (run >= 5) add(h.player_key, 'streak2');
          if (run >= 10) add(h.player_key, 'streak3');
          const ea = Number(h.elo_after) || 0;
          if (ea >= 1200) add(h.player_key, 'elo1');
          if (ea >= 1400) add(h.player_key, 'elo2');
          if (ea >= 1600) add(h.player_key, 'elo3');
          if (h.won && h.my_ovr && h.opp_ovr) {
            const d = h.my_ovr - h.opp_ovr;
            if (d >= 10) add(h.player_key, 'mismatch1');
            if (d >= 15) add(h.player_key, 'mismatch2');
            if (d >= 20) add(h.player_key, 'mismatch3');
            if (d < 0) add(h.player_key, 'underdog');
          }
        }

        // current rating/streak/record columns catch matches that predate pvp_history
        const users = await sql`SELECT google_sub, achievements, pvp_elo, pvp_streak, pvp_wins, pvp_losses,
          pvp_elo_hoops, pvp_streak_hoops, pvp_wins_hoops, pvp_losses_hoops
          FROM users WHERE google_sub NOT LIKE 'guest:%'`;
        for (const u of users) {
          if ((u.pvp_wins + u.pvp_losses + u.pvp_wins_hoops + u.pvp_losses_hoops) > 0) add(u.google_sub, 'versus_root');
          const elo = Math.max(u.pvp_elo, u.pvp_elo_hoops), st = Math.max(u.pvp_streak, u.pvp_streak_hoops);
          if (elo >= 1200) add(u.google_sub, 'elo1');
          if (elo >= 1400) add(u.google_sub, 'elo2');
          if (elo >= 1600) add(u.google_sub, 'elo3');
          if (st >= 3) add(u.google_sub, 'streak1');
          if (st >= 5) add(u.google_sub, 'streak2');
          if (st >= 10) add(u.google_sub, 'streak3');
        }

        // dailies (per game, like the in-game unlocks): played / 7 / 30 / 100, and each daily
        // submission is proof of a completed build at that OVR
        const dailies = await sql`SELECT player_key, count(*)::int AS n, max(ovr)::int AS best,
            bool_or(ovr = 99) AS goat, bool_or(ovr > 99) AS beyond, bool_or(ovr < 60) AS bargain
          FROM daily_scores WHERE player_key LIKE 'acct:%' GROUP BY player_key, game`;
        for (const d of dailies) {
          const sub = d.player_key.slice(5);
          add(sub, 'daily_root', 'draft_root');
          if (d.n >= 7) add(sub, 'grind1');
          if (d.n >= 30) add(sub, 'grind2');
          if (d.n >= 100) add(sub, 'grind3');
          if (d.best >= 90) add(sub, 'builder1');
          if (d.best >= 95) add(sub, 'builder2');
          if (d.goat) add(sub, 'the_goat');
          if (d.beyond) add(sub, 'beyond');
          if (d.bargain) add(sub, 'bargain');
        }

        // Hall of Fame saves. Older saves store the FULL career (huge), so pulling raw build jsonb
        // blows Neon's 64MB response cap — extract just the per-save facts in SQL instead.
        const saves = await sql`SELECT google_sub, game, ovr,
            (build->'career'->'totals') IS NOT NULL AS simmed,
            COALESCE((build->'career'->'totals'->>'rings')::numeric, 0)::int AS rings,
            COALESCE((build->'career'->'totals'->>'k')::numeric, 0)::int AS k,
            COALESCE((build->'career'->'totals'->>'wins')::numeric, 0)::int AS wins,
            COALESCE((build->'career'->'totals'->>'earnings')::numeric, 0)::bigint AS earnings,
            (SELECT bool_or(CASE WHEN s->>'value' ~ '^[0-9]+([.][0-9]+)?$' THEN (s->>'value')::numeric >= 125 END)
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(build->'slots') = 'array' THEN build->'slots' ELSE '[]'::jsonb END) s) AS offcharts,
            (SELECT count(DISTINCT s->>'team') = 1 AND count(*) >= 7 AND count(s->>'team') = count(*)
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(build->'slots') = 'array' THEN build->'slots' ELSE '[]'::jsonb END) s) AS one_team,
            (SELECT bool_or(CASE WHEN s->>'ovr' ~ '^[0-9]+([.][0-9]+)?$' THEN (s->>'ovr')::numeric >= 99 END)
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(build->'slots') = 'array' THEN build->'slots' ELSE '[]'::jsonb END) s
               WHERE s->>'slot' IN ('Defense', 'Frame')) AS nepo,
            (SELECT min(s->>'display')
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(build->'slots') = 'array' THEN build->'slots' ELSE '[]'::jsonb END) s
               WHERE s->>'slot' = 'Frame') AS frame_disp
          FROM saves WHERE google_sub NOT LIKE 'guest:%'`;
        for (const s of saves) {
          const sub = s.google_sub;
          add(sub, 'draft_root');
          if (s.ovr >= 90) add(sub, 'builder1');
          if (s.ovr >= 95) add(sub, 'builder2');
          if (s.ovr === 99) add(sub, 'the_goat');
          if (s.ovr > 99) add(sub, 'beyond');
          if (s.ovr < 60) add(sub, 'bargain');
          if (s.offcharts) add(sub, 'offcharts');
          if (s.one_team) add(sub, 'one_team');
          if (s.nepo) add(sub, 'nepo');
          const hm = /(\d+)'\s*(\d+)/.exec(String(s.frame_disp || ''));
          if (hm) {
            const inches = Number(hm[1]) * 12 + Number(hm[2]);
            if (inches <= 71) add(sub, 'short_king');
            if (inches >= 81) add(sub, 'tall_tale');
          }
          if (s.simmed) {
            add(sub, 'sim_root');
            if (s.rings >= 1) add(sub, 'ring1');
            if (s.rings >= 3) add(sub, 'ring2');
            if (s.rings >= 5) add(sub, 'ring3');
            if (Number(s.earnings) >= 1e9) add(sub, 'billion');
            if (s.game === 'pitcher') {
              if (s.k >= 1000) add(sub, 'k1');
              if (s.k >= 3000) add(sub, 'k2');
              if (s.k >= 5000) add(sub, 'k3');
              if (s.wins >= 100) add(sub, 'w1');
              if (s.wins >= 200) add(sub, 'w2');
              if (s.wins >= 300) add(sub, 'w3');
            }
          }
        }

        // merge into users.achievements — only fills gaps, never touches existing unlocks
        const nowIso = new Date().toISOString();
        const byAch = {};
        let updated = 0, grants = 0;
        for (const u of users) {
          const set = evid[u.google_sub];
          if (!set) continue;
          const cur = (u.achievements && typeof u.achievements === 'object') ? u.achievements : {};
          const missing = [...set].filter(id => !cur[id]);
          if (!missing.length) continue;
          updated++;
          grants += missing.length;
          for (const id of missing) byAch[id] = (byAch[id] || 0) + 1;
          if (!dryRun) {
            const merged = Object.assign({}, cur);
            for (const id of missing) merged[id] = nowIso;
            await sql`UPDATE users SET achievements = ${JSON.stringify(merged)}::jsonb WHERE google_sub = ${u.google_sub}`;
          }
        }
        return res.status(200).json({ ok: true, dryRun, accounts_scanned: users.length,
          accounts_granted: updated, total_grants: grants, by_achievement: byAch });
      }

      return res.status(400).json({ ok: false, error: 'Unknown action' });
    }

    // GET ?action=pvpAuditPlayer&token=...&name=... — shows times beaten vs losses reported for a player
    if ((req.query && req.query.action) === 'pvpAuditPlayer') {
      if (req.query.token !== STATS_TOKEN) {
        return res.status(403).send('<h2 style="font-family:sans-serif;color:red">Forbidden</h2>');
      }
      await ensure();
      const name = String(req.query.name || '').trim();
      if (!name) return res.status(400).send('<h2 style="font-family:sans-serif">Missing ?name=</h2>');

      // Current user row(s) matching this name
      const users = await sql`SELECT google_sub, name, pvp_elo, pvp_wins, pvp_losses, pvp_streak FROM users WHERE lower(name) = lower(${name})`;
      const userKeys = users.map(u => u.google_sub);

      // Every pvp_history row where someone reported beating this player —
      // match by opp_key (stable identity, name-change-proof) OR opp_name (legacy rows)
      const timesBeaten = await sql`
        SELECT h.match_id, h.player_key AS winner_key, h.opp_key, h.created_at,
          EXISTS (
            SELECT 1 FROM pvp_results pr
            WHERE pr.match_id = h.match_id
              AND (
                pr.google_sub = ANY(${userKeys})
                OR (h.opp_key IS NOT NULL AND pr.google_sub = h.opp_key)
              )
          ) AS loss_reported
        FROM pvp_history h
        WHERE h.won = true
          AND (
            (h.opp_key IS NOT NULL AND h.opp_key = ANY(${userKeys}))
            OR (h.opp_key IS NULL AND lower(h.opp_name) = lower(${name}))
          )
        ORDER BY h.created_at DESC`;

      const total = timesBeaten.length;
      const reported = timesBeaten.filter(r => r.loss_reported).length;
      const dodged = total - reported;

      const beatRows = timesBeaten.map(r => `<tr>
        <td style="color:#aaa;font-size:11px">${new Date(r.created_at).toLocaleDateString()}</td>
        <td style="font-size:12px;word-break:break-all">${r.winner_key}</td>
        <td style="text-align:center;font-size:11px;color:#666">${r.opp_key ? '🔑 key' : '📛 name'}</td>
        <td style="text-align:center">${r.loss_reported ? '<span style="color:#4c4">✓</span>' : '<span style="color:#e55">✗ DODGED</span>'}</td>
      </tr>`).join('');

      const userRows = users.map(u => `<tr>
        <td><b>${u.name}</b></td>
        <td style="text-align:center">${u.pvp_wins}</td>
        <td style="text-align:center">${u.pvp_losses}</td>
        <td style="text-align:center">${u.pvp_elo}</td>
      </tr>`).join('');

      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit: ${name}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#111;color:#eee;padding:16px;max-width:600px;margin:0 auto}
  h1{font-size:20px}h2{font-size:15px;color:#aaa;margin:20px 0 8px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;color:#aaa;padding:5px 6px;border-bottom:1px solid #333}
  td{padding:5px 6px;border-bottom:1px solid #1e1e1e}
  .stat{display:inline-block;background:#1e1e1e;border-radius:8px;padding:10px 16px;margin:4px;text-align:center}
  .stat b{display:block;font-size:22px}
  .stat span{font-size:11px;color:#aaa;text-transform:uppercase}
  .red{color:#e55}.grn{color:#4c4}
</style></head><body>
<h1>Player Audit: ${name}</h1>
<div>
  <div class="stat"><b>${total}</b><span>Times beaten (recorded)</span></div>
  <div class="stat grn"><b>${reported}</b><span>Losses submitted</span></div>
  <div class="stat red"><b>${dodged}</b><span>Dodged losses</span></div>
</div>
<h2>Current account(s)</h2>
<table><tr><th>Name</th><th>W</th><th>L</th><th>Elo</th></tr>
  ${userRows || '<tr><td colspan="4" style="color:#888">No user found with this exact name</td></tr>'}
</table>
<h2>Match log (times beaten)</h2>
<table><tr><th>Date</th><th>Winner key</th><th>Match by</th><th style="text-align:center">Loss filed?</th></tr>
  ${beatRows || '<tr><td colspan="3" style="color:#888">No recorded losses found — name may have changed</td></tr>'}
</table>
</body></html>`;
      return res.status(200).setHeader('content-type', 'text/html').send(html);
    }

    // GET ?action=pvpBackfillPreview&token=... — browser-friendly admin page for the loss backfill
    if ((req.query && req.query.action) === 'pvpBackfillPreview') {
      if (req.query.token !== STATS_TOKEN) {
        return res.status(403).send('<h2 style="font-family:sans-serif;color:red">Forbidden</h2>');
      }
      await ensure();
      const applying = req.query.apply === '1';
      const backfillK = Math.max(1, Math.min(32, Math.round(Number(req.query.k) || 8)));

      const orphanedWins = await sql`
        SELECT h.match_id, h.player_key AS winner_key, h.opp_name, h.opp_ovr,
               h.elo_before AS winner_elo_before, h.my_ovr AS winner_ovr, h.my_role AS winner_role,
               h.created_at
        FROM pvp_history h
        WHERE h.won = true
          AND NOT EXISTS (
            SELECT 1 FROM pvp_history h2
            WHERE h2.match_id = h.match_id AND h2.won = false
          )
        ORDER BY h.created_at ASC`;

      let applied = 0;
      const byPlayer = {};
      for (const win of orphanedWins) {
        const candidates = await sql`
          SELECT google_sub, pvp_elo, pvp_wins, pvp_losses, pvp_streak, name FROM users
          WHERE name = ${win.opp_name} AND google_sub <> ${win.winner_key}
            AND NOT EXISTS (
              SELECT 1 FROM pvp_results WHERE match_id = ${win.match_id} AND google_sub = users.google_sub
            )`;
        if (candidates.length !== 1) continue;
        const loser = candidates[0];
        const { delta } = nextElo(loser.pvp_elo, win.winner_elo_before, false, backfillK);
        const newElo = Math.max(100, loser.pvp_elo + delta);
        if (!byPlayer[loser.name]) byPlayer[loser.name] = { losses: 0, elo_drop: 0 };
        byPlayer[loser.name].losses++;
        byPlayer[loser.name].elo_drop += delta;
        if (applying) {
          const ins = await sql`INSERT INTO pvp_results (match_id, google_sub)
            VALUES (${win.match_id}, ${loser.google_sub}) ON CONFLICT DO NOTHING RETURNING match_id`;
          if (ins.length) {
            await sql`UPDATE users SET pvp_elo = ${newElo}, pvp_losses = ${loser.pvp_losses + 1}, pvp_streak = 0 WHERE google_sub = ${loser.google_sub}`;
            const loserRole = win.winner_role ? (win.winner_role === 'pitcher' ? 'batter' : 'pitcher') : null;
            const [wu] = await sql`SELECT name FROM users WHERE google_sub = ${win.winner_key}`;
            try {
              await sql`INSERT INTO pvp_history (player_key, match_id, won, my_role, my_ovr, opp_name, opp_ovr, elo_before, elo_after)
                VALUES (${loser.google_sub}, ${win.match_id}, false, ${loserRole}, ${win.opp_ovr}, ${wu ? wu.name : ''}, ${win.winner_ovr}, ${loser.pvp_elo}, ${newElo})`;
            } catch(e) {}
            applied++;
          }
        }
      }

      const ranked = Object.entries(byPlayer)
        .map(([name, d]) => ({ name, losses: d.losses, elo_drop: d.elo_drop }))
        .sort((a, b) => b.losses - a.losses);
      const total = ranked.reduce((s, r) => s + r.losses, 0);
      const token = req.query.token;
      const applyUrl = `/api/account?action=pvpBackfillPreview&token=${encodeURIComponent(token)}&k=${backfillK}&apply=1`;

      const rows = ranked.map((p, i) => `<tr>
        <td>${i + 1}</td><td><b>${p.name}</b></td>
        <td style="text-align:center">${p.losses}</td>
        <td style="text-align:center;color:#e55">${p.elo_drop}</td>
      </tr>`).join('');

      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loss Backfill</title>
<style>
  body{font-family:system-ui,sans-serif;background:#111;color:#eee;padding:16px;max-width:600px;margin:0 auto}
  h1{font-size:20px;margin-bottom:4px}
  .sub{color:#aaa;font-size:13px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th{text-align:left;color:#aaa;padding:6px 8px;border-bottom:1px solid #333}
  td{padding:6px 8px;border-bottom:1px solid #222}
  .btn{display:block;margin:24px 0 8px;padding:14px;background:#e55;color:#fff;font-size:16px;font-weight:700;border:none;border-radius:8px;width:100%;cursor:pointer;text-align:center;text-decoration:none}
  .btn:hover{background:#c33}
  .done{background:#2a2;color:#fff;padding:14px;border-radius:8px;font-weight:700;text-align:center;font-size:16px}
  .skipped{color:#888;font-size:12px;margin-top:12px}
</style></head><body>
<h1>Loss Backfill ${applying ? '— Applied ✓' : '— Preview'}</h1>
<div class="sub">${orphanedWins.length} orphaned wins found · ${total} losses to assign · gentle K=${backfillK}</div>
${applying
  ? `<div class="done">✓ Applied ${applied} loss${applied !== 1 ? 'es' : ''} to ${ranked.length} player${ranked.length !== 1 ? 's' : ''}</div>`
  : `<a class="btn" href="${applyUrl}" onclick="return confirm('Apply ${total} losses to ${ranked.length} players?')">Apply All ${total} Losses</a>`}
<table>
  <tr><th>#</th><th>Player</th><th style="text-align:center">Losses</th><th style="text-align:center">Elo Drop</th></tr>
  ${rows || '<tr><td colspan="4" style="color:#888;padding:12px">No recoverable dodged losses found</td></tr>'}
</table>
</body></html>`;

      return res.status(200).setHeader('content-type', 'text/html').send(html);
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
