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
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS achievements jsonb NOT NULL DEFAULT '{}'::jsonb`;
      await sql`CREATE INDEX IF NOT EXISTS idx_pvp_history_player ON pvp_history (player_key, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_pvp_history_opp_key ON pvp_history (opp_key) WHERE opp_key IS NOT NULL`;
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
// Small win-streak bonus: +2 Elo per consecutive win, stops growing at a 5-win streak (max +10).
const STREAK_BONUS = 2, STREAK_CAP = 5;

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

      // Merge the caller's achievements with what's stored on their account (union, keeping the
      // earliest unlock time per id) so progress follows their email across devices.
      if (action === 'achSync') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const incoming = (body.achievements && typeof body.achievements === 'object') ? body.achievements : {};
        // reset=true replaces the account copy with the caller's current set (used for version wipes);
        // otherwise merge (union, earliest unlock time wins) so progress follows the email across devices.
        const base = body.reset === true ? {} : ((await sql`SELECT achievements FROM users WHERE google_sub = ${body.sub}`)[0] || {}).achievements || {};
        const merged = Object.assign({}, base);
        let n = 0;
        for (const k in incoming) {
          if (n++ > 200) break;
          if (typeof k !== 'string' || !k || k.length > 40) continue;
          const t = String(incoming[k] || '').slice(0, 40);
          if (!merged[k] || (t && t < merged[k])) merged[k] = t || merged[k] || new Date().toISOString();
        }
        await sql`UPDATE users SET achievements = ${JSON.stringify(merged)}::jsonb WHERE google_sub = ${body.sub}`;
        return res.status(200).json({ ok: true, achievements: merged });
      }

      if (action === 'pvpStats') {
        const key = await pvpKey(body);
        if (!key) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const [u] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses, pvp_streak AS streak FROM users WHERE google_sub = ${key}`;
        if (!u) return res.status(401).json({ ok: false, error: 'Not signed in' });
        return res.status(200).json({ ok: true, elo: u.elo, wins: u.wins, losses: u.losses, streak: u.streak });
      }

      if (action === 'pvpResult') {
        const key = await pvpKey(body);
        if (!key) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const matchId = String(body.matchId || '').slice(0, 80);
        if (!matchId) return res.status(400).json({ ok: false, error: 'missing matchId' });
        const won = !!body.won;
        const oppElo = Math.max(100, Math.min(4000, Math.round(Number(body.oppElo) || 1000)));
        const role = (body.role === 'pitcher' || body.role === 'batter') ? body.role : null;
        const myOvr = Math.round(Number(body.ovr) || 0) || null;
        const oppOvr = Math.round(Number(body.oppOvr) || 0) || null;
        const oppName = String(body.oppName || '').trim().slice(0, 40) || null;

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
        if (!ins.length) return res.status(200).json({ ok: true, counted: false, elo: u.elo, delta: 0, bonus: 0, streak: u.streak, wins: u.wins, losses: u.losses });
        const { delta } = nextElo(u.elo, oppElo, won);
        // win-streak bonus (grows per consecutive win, capped at a 5-win streak)
        const streak = won ? (u.streak || 0) + 1 : 0;
        const bonus = won ? Math.min(streak, STREAK_CAP) * STREAK_BONUS : 0;
        const elo = Math.max(100, u.elo + delta + bonus);
        const wins = u.wins + (won ? 1 : 0), losses = u.losses + (won ? 0 : 1);
        await sql`UPDATE users SET pvp_elo = ${elo}, pvp_wins = ${wins}, pvp_losses = ${losses}, pvp_streak = ${streak} WHERE google_sub = ${key}`;
        const oppKeyVal = body.oppKey ? String(body.oppKey).slice(0, 80) : null;
        const validOppKey = oppKeyVal && /^(acct:|guest:)/.test(oppKeyVal) && oppKeyVal !== key ? oppKeyVal : null;
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
        const rows = await sql`SELECT won, my_role, my_ovr, opp_name, opp_ovr, elo_before, elo_after, created_at
          FROM pvp_history WHERE player_key = ${key} ORDER BY created_at DESC LIMIT 20`;
        return res.status(200).json({ ok: true, history: rows });
      }

      // Carry a device-guest's rating onto a Google account the first time they sign in
      // (only if the account hasn't played yet, so we never clobber an existing rating).
      if (action === 'pvpClaim') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const gid = body.guestId ? ('guest:' + String(body.guestId).slice(0, 48)) : null;
        const [acct] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${body.sub}`;
        if (gid && acct && acct.wins === 0 && acct.losses === 0) {
          const [g] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses, pvp_streak AS streak FROM users WHERE google_sub = ${gid}`;
          if (g && (g.wins > 0 || g.losses > 0)) {
            await sql`UPDATE users SET pvp_elo = ${g.elo}, pvp_wins = ${g.wins}, pvp_losses = ${g.losses}, pvp_streak = ${g.streak} WHERE google_sub = ${body.sub}`;
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
          const { delta } = nextElo(loser.pvp_elo, win.winner_elo_before, false);
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
        const { delta } = nextElo(loser.pvp_elo, win.winner_elo_before, false);
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
      const applyUrl = `/api/account?action=pvpBackfillPreview&token=${encodeURIComponent(token)}&apply=1`;

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
<div class="sub">${orphanedWins.length} orphaned wins found · ${total} losses to assign</div>
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
