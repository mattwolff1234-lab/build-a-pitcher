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
const gameOf = g => (g === 'batter' || g === 'baller' || g === 'striker' || g === 'keeper') ? g : 'pitcher';

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
      // Whether the result came from a completed at-bat (true) vs a forfeit/quit claim (false).
      // A completed result is authoritative and can reverse a wrongful forfeit-loss (see pvpResult).
      // Existing rows default true so historical results are never retro-reversed.
      await sql`ALTER TABLE pvp_history ADD COLUMN IF NOT EXISTS decided boolean NOT NULL DEFAULT true`;
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
      // Player card collection ("The Binder"): { pitcher:{ "Name":{t,c,f,p,l} }, batter:{…}, baller:{…} }.
      // Union-merged on sync (like achievements) so the binder follows the email across devices.
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS collection jsonb NOT NULL DEFAULT '{}'::jsonb`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS current_streak int NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS best_streak int NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_date date`;
      // ---- Monthly Elo seasons (baseball 1v1). Dormant until SEASON1_START_MS; then the first
      // ranked game of a season rolls a player over (squash + placements). pvp_season = the season
      // NUMBER a player's live pvp_elo/wins/losses belongs to (0 = never rolled / pre-season). ----
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_season int NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_placement_games int NOT NULL DEFAULT 0`;
      // Per-season standings: upserted every result → the live current-season board AND the frozen
      // history (past-season rows stop being written once the month passes).
      await sql`CREATE TABLE IF NOT EXISTS pvp_seasons (
        season int NOT NULL,
        player_key text NOT NULL,
        name text,
        elo int NOT NULL DEFAULT 1000,
        wins int NOT NULL DEFAULT 0,
        losses int NOT NULL DEFAULT 0,
        peak_elo int NOT NULL DEFAULT 1000,
        placed boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (season, player_key)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_pvp_seasons_board ON pvp_seasons (season, elo DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_pvp_seasons_player ON pvp_seasons (player_key)`;
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

// ---- Monthly Elo seasons ----------------------------------------------------
// Season 1 kickoff (one editable constant; MUST match SEASON1_START_MS in versus.html). Everything
// season-related is DORMANT until this instant — before it, seasonInfo().number is 0 and pvpResult
// touches no season columns, so live behavior is unchanged.
const SEASON1_START_MS = Date.UTC(2026, 6, 15);   // 2026-07-15 00:00 UTC (July = month 6)
const N_PLACEMENT = 5;          // placement games at the start of each season
const SQUASH = 0.5;             // how far last season's Elo is pulled toward 1000 to seed placements
const K_PLACEMENT = 48;         // higher K during placements so 5 games move you decisively
// Each season is one UTC month measured from the anchor. Both client and server compute this
// identically from Date.now(), so the countdown and the authoritative rollover agree.
function addUTCMonths(ms, k) { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + k); return d.getTime(); }
function seasonInfo(nowMs) {
  if (nowMs < SEASON1_START_MS) return { number: 0, startMs: null, endMs: SEASON1_START_MS };
  const a = new Date(SEASON1_START_MS), n = new Date(nowMs);
  let m = (n.getUTCFullYear() - a.getUTCFullYear()) * 12 + (n.getUTCMonth() - a.getUTCMonth());
  if (nowMs < addUTCMonths(SEASON1_START_MS, m)) m -= 1;   // day-of-month hasn't ticked over yet
  return { number: m + 1, startMs: addUTCMonths(SEASON1_START_MS, m), endMs: addUTCMonths(SEASON1_START_MS, m + 1) };
}
const placementStartElo = prevElo => 1000 + Math.round((prevElo - 1000) * SQUASH);

// Apply one match result to a player's season-aware Elo state. PURE (no DB). When seasons are
// dormant (`cur < 1`) it returns the classic lifetime result and leaves season fields at 0, so
// pvpResult stays byte-identical to pre-season behavior. `u` = { elo, wins, losses, streak,
// season, placement_games } from the users row.
function applyMatch(u, won, oppElo, cur) {
  let elo = u.elo, wins = u.wins, losses = u.losses, streak = u.streak || 0;
  let season = u.season || 0, placement = u.placement_games || 0;
  let rolledOver = false;
  if (cur >= 1 && season !== cur) {
    // first game of a new season → squash last season's Elo toward 1000, reset record + placements
    elo = placementStartElo(elo);
    wins = 0; losses = 0; streak = 0; placement = 0; season = cur; rolledOver = true;
  }
  const inPlacement = cur >= 1 && placement < N_PLACEMENT;
  const k = inPlacement ? K_PLACEMENT : 32;
  const { delta } = nextElo(elo, oppElo, won, k);
  const newStreak = (won && !inPlacement) ? streak + 1 : 0;             // no streaks during placements
  const bonus = (won && !inPlacement) ? Math.min(newStreak, STREAK_CAP) * STREAK_BONUS : 0;
  return {
    elo: Math.max(100, elo + delta + bonus),
    startElo: elo,                                    // elo this match was actually played from (post-squash)
    wins: wins + (won ? 1 : 0),
    losses: losses + (won ? 0 : 1),
    streak: newStreak,
    season,
    placement_games: cur >= 1 ? placement + 1 : 0,
    placed: cur >= 1 && (placement + 1) >= N_PLACEMENT,
    delta, bonus, rolledOver, inPlacement,
  };
}
// Upsert a player's row in the current season's standings (also the frozen history once the month
// passes). peak_elo climbs and never drops.
async function upsertSeason(season, key, name, r) {
  try {
    await sql`INSERT INTO pvp_seasons (season, player_key, name, elo, wins, losses, peak_elo, placed)
      VALUES (${season}, ${key}, ${name || null}, ${r.elo}, ${r.wins}, ${r.losses}, ${r.elo}, ${r.placed})
      ON CONFLICT (season, player_key) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, pvp_seasons.name),
        elo = EXCLUDED.elo, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
        peak_elo = GREATEST(pvp_seasons.peak_elo, EXCLUDED.elo),
        placed = EXCLUDED.placed, updated_at = now()`;
  } catch (e) {}
}

// Walk a list of played dates ('YYYY-MM-DD') and return { current, best } daily streaks —
// current is the consecutive run ending today (or yesterday, when today isn't played yet).
// Mirrors the client's streaksFromDates so both sides agree with the visible calendar.
function streaksFromDates(dates, today) {
  const days = [...new Set(dates)].sort();
  if (!days.length) return { current: 0, best: 0 };
  const shift = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = (prev && shift(prev, 1) === d) ? run + 1 : 1; if (run > best) best = run; prev = d; }
  const set = new Set(days);
  let anchor = set.has(today) ? today : (set.has(shift(today, -1)) ? shift(today, -1) : null);
  let current = 0;
  while (anchor && set.has(anchor)) { current++; anchor = shift(anchor, -1); }
  return { current, best };
}

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
  const decided = body.decided !== false;   // completed at-bat vs forfeit/quit claim (see pvpResult)
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
    let delta = 0, elo = u.elo, recWon = won, hRow = null;
    try {
      const [h] = await sql`SELECT id, won, elo_before, elo_after FROM pvp_history
        WHERE match_id = ${matchId} AND player_key = ${key} AND sport = 'hoops'
        ORDER BY created_at DESC LIMIT 1`;
      if (h) { hRow = h; delta = h.elo_after - h.elo_before; elo = h.elo_after; recWon = !!h.won; }
    } catch (e) {}
    // Conflict fix (mirrors baseball pvpResult): a completed game win overrides a forfeit/quit claim
    // that wrongly settled this player as a loss. Reverse both players' hoops ratings.
    if (decided && won && hRow && hRow.won === false && myOvr && oppOvr && myOvr >= oppOvr) {
      const oppKeyVal = body.oppKey ? String(body.oppKey).slice(0, 80) : null;
      const clientOpp = oppKeyVal && /^(acct:|guest:)/.test(oppKeyVal) ? normKey(oppKeyVal) : null;
      const oppK = recordedOpp || clientOpp;
      if (oppK && oppK !== key) {
        try {
          const [oh] = await sql`SELECT id, won, decided, elo_before, elo_after FROM pvp_history
            WHERE match_id = ${matchId} AND player_key = ${oppK} AND sport = 'hoops'
            ORDER BY created_at DESC LIMIT 1`;
          if (oh && oh.won === true && oh.decided === false) {
            const uBefore = hRow.elo_before, oBefore = oh.elo_before;
            const uWin = nextElo(uBefore, oBefore, true).delta;
            const oLoss = nextElo(oBefore, uBefore, false).delta;
            const uAdj = uWin - (hRow.elo_after - uBefore);
            const oAdj = oLoss - (oh.elo_after - oBefore);
            const [uNow] = await sql`SELECT pvp_elo_hoops AS elo, pvp_wins_hoops AS wins, pvp_losses_hoops AS losses FROM users WHERE google_sub = ${key}`;
            const [oNow] = await sql`SELECT pvp_elo_hoops AS elo, pvp_wins_hoops AS wins, pvp_losses_hoops AS losses FROM users WHERE google_sub = ${oppK}`;
            if (uNow && oNow) {
              const uNewElo = Math.max(100, uNow.elo + uAdj);
              const oNewElo = Math.max(100, oNow.elo + oAdj);
              await sql`UPDATE users SET pvp_elo_hoops = ${uNewElo}, pvp_wins_hoops = ${uNow.wins + 1}, pvp_losses_hoops = ${Math.max(0, uNow.losses - 1)}, pvp_streak_hoops = 1 WHERE google_sub = ${key}`;
              await sql`UPDATE users SET pvp_elo_hoops = ${oNewElo}, pvp_wins_hoops = ${Math.max(0, oNow.wins - 1)}, pvp_losses_hoops = ${oNow.losses + 1}, pvp_streak_hoops = 0 WHERE google_sub = ${oppK}`;
              await sql`UPDATE pvp_history SET won = true, decided = true, elo_after = ${uBefore + uWin} WHERE id = ${hRow.id}`;
              await sql`UPDATE pvp_history SET won = false, elo_after = ${oBefore + oLoss} WHERE id = ${oh.id}`;
              return res.status(200).json({ ok: true, counted: true, reversed: true, won: true, elo: uNewElo, delta: uWin, bonus: 0, streak: 1, wins: uNow.wins + 1, losses: Math.max(0, uNow.losses - 1) });
            }
          }
        } catch (e) {}
      }
    }
    return res.status(200).json({ ok: true, counted: false, won: recWon, elo, delta, bonus: 0, streak: u.streak, wins: u.wins, losses: u.losses });
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
    await sql`INSERT INTO pvp_history (player_key, match_id, won, my_role, my_ovr, opp_name, opp_ovr, opp_key, elo_before, elo_after, sport, decided)
      VALUES (${key}, ${matchId}, ${won}, 'hooper', ${myOvr}, ${oppName}, ${oppOvr}, ${validOppKey}, ${u.elo}, ${elo}, 'hoops', ${decided})`;
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
          await sql`INSERT INTO pvp_history (player_key, match_id, won, my_role, my_ovr, opp_name, opp_ovr, opp_key, elo_before, elo_after, sport, decided)
            VALUES (${validOppKey}, ${matchId}, false, 'hooper', ${oppOvr}, ${winnerName}, ${myOvr}, ${key}, ${opp.elo}, ${oppNewElo}, 'hoops', ${decided})`;
        }
      }
    } catch (e) {}
  }
  return res.status(200).json({ ok: true, counted: true, won, elo, delta: delta + bonus, bonus, streak, wins, losses });
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

    // The token-gated admin backfills are also reachable via GET (handy where only fetches are
    // possible): ?action=achBackfill|xpBackfill&token=...&apply=1 — apply=1 ⇒ dryRun:false.
    const qAction = req.query && req.query.action;
    if (req.method === 'GET' && (qAction === 'achBackfill' || qAction === 'xpBackfill')) {
      req.method = 'POST';
      req.body = { action: qAction, token: req.query.token, dryRun: req.query.apply !== '1' };
    }

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
          RETURNING session_token, current_streak, best_streak, last_active_date, (xmax = 0) AS is_new`;
        let streakOut = Number(row.current_streak) || 0, bestOut = Number(row.best_streak) || 0;
        // Adopt this device's guest daily-challenge history into the account, so days played
        // before signing in keep counting toward the streak/calendar. Days the account already
        // has stay put; then the streak counters are recomputed from the merged calendar (they
        // only ever go UP here — a break is applied by updateStreak on actual play, not login).
        if (body.guestId) {
          try {
            const gKey = 'guest:' + String(body.guestId).slice(0, 80);
            const aKey = 'acct:' + profile.sub;
            await sql`UPDATE daily_scores d SET player_key = ${aKey} WHERE d.player_key = ${gKey}
              AND NOT EXISTS (SELECT 1 FROM daily_scores a WHERE a.player_key = ${aKey}
                AND a.game = d.game AND a.challenge_date = d.challenge_date)`;
            const played = await sql`SELECT DISTINCT challenge_date::text AS d FROM daily_scores WHERE player_key = ${aKey}`;
            if (played.length) {
              const today = new Date().toISOString().slice(0, 10);
              const s = streaksFromDates(played.map(r => r.d), today);
              const lastPlayed = played.map(r => r.d).sort().pop();
              const storedLast = row.last_active_date ? String(row.last_active_date).slice(0, 10) : null;
              const newCur = Math.max(streakOut, s.current);
              const newBest = Math.max(bestOut, s.best, newCur);
              const newLast = (!storedLast || lastPlayed > storedLast) ? lastPlayed : storedLast;
              if (newCur !== streakOut || newBest !== bestOut || newLast !== storedLast) {
                await sql`UPDATE users SET current_streak = ${newCur}, best_streak = ${newBest}, last_active_date = ${newLast} WHERE google_sub = ${profile.sub}`;
              }
              streakOut = newCur; bestOut = newBest;
            }
          } catch (e) {}
        }
        return res.status(200).json({ ok: true, sub: profile.sub, email: profile.email, name: profile.name, picture: profile.picture, sessionToken: row.session_token,
          streak: streakOut, bestStreak: bestOut, isNew: row.is_new === true });
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
      // resets to 1 on a gap. Cross-checks the daily-challenge calendar and the client's counter
      // (never lowers either) so signing in mid-streak can't clobber it. Returns the final streak.
      if (action === 'updateStreak') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const y = new Date(now); y.setUTCDate(y.getUTCDate() - 1);
        const yd = y.toISOString().slice(0, 10);
        const [u] = await sql`SELECT last_active_date, current_streak, best_streak FROM users WHERE google_sub = ${body.sub}`;
        const last = u && u.last_active_date ? String(u.last_active_date).slice(0, 10) : null;
        const firstToday = last !== today;
        let streak = last === today ? ((u && u.current_streak) || 0)
          : (last === yd ? (((u && u.current_streak) || 0) + 1) : 1);
        // Also derive from the daily-challenge calendar itself (covers guest days merged in at
        // login and plays recorded on other devices) — take whichever run is longer.
        try {
          const played = await sql`SELECT DISTINCT challenge_date::text AS d FROM daily_scores WHERE player_key = ${'acct:' + body.sub}`;
          if (played.length) streak = Math.max(streak, streaksFromDates(played.map(r => r.d), today).current);
        } catch (e) {}
        // The client's counter can legitimately be AHEAD of ours: it counts days played signed-out
        // before this sign-in and Streak Freeze tokens (a freeze bridges one missed day; the server
        // doesn't track them). Never lower it — same trust-the-client model as the leaderboard.
        const clientCount = Math.max(0, Math.min(100000, Math.round(Number(body.count) || 0)));
        streak = Math.max(streak, clientCount);
        const best = Math.max((u && u.best_streak) || 0, streak);
        if (firstToday || streak !== ((u && u.current_streak) || 0) || best !== ((u && u.best_streak) || 0)) {
          await sql`UPDATE users SET current_streak = ${streak}, best_streak = ${best}, last_active_date = ${today} WHERE google_sub = ${body.sub}`;
        }
        return res.status(200).json({ ok: true, streak, best, firstToday });
      }

      // Merge the caller's achievements with what's stored on their account (union, keeping the
      // earliest unlock time per id) so progress follows their email across devices.
      if (action === 'achSync') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const incoming = (body.achievements && typeof body.achievements === 'object') ? body.achievements : {};
        // ALWAYS merge (union, earliest unlock time wins). body.reset — the old launch-time
        // "version wipe" — is deliberately ignored: cached clients set it from any FRESH browser
        // profile too, which replaced the account's board with an empty one (the "signed in on a
        // new device and lost everything" bug). Likewise the old claim gate (adopt guest unlocks
        // only into an empty account) silently discarded a signed-out session's progress; unlocks
        // earned on this device merge in regardless.
        const base = ((await sql`SELECT achievements FROM users WHERE google_sub = ${body.sub}`)[0] || {}).achievements || {};
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

      // Sync cross-game player XP. XP is monotonic on the account — it follows the email across
      // devices and can never drop. Signed-out (guest) XP is ADDED on first sync after sign-in.
      if (action === 'xpSync') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const incoming = Math.max(0, Math.min(1e12, Math.round(Number(body.xp) || 0)));
        const stored = Number(((await sql`SELECT xp FROM users WHERE google_sub = ${body.sub}`)[0] || {}).xp) || 0;
        // body.reset (the old launch-time version wipe) is deliberately IGNORED: cached clients
        // send it from any fresh browser profile, which zeroed the account's XP on first sync
        // after sign-in. XP stays monotonic on the account.
        // claim=true = XP earned on this device while signed out (the local copy is zeroed on
        // sign-out, so it's all new): ADD it to the account instead of throwing it away.
        // Otherwise the local copy mirrors this account — keep the max.
        const merged = body.claim === true
          ? Math.min(1e12, stored + incoming)
          : Math.max(stored, incoming);
        await sql`UPDATE users SET xp = ${merged} WHERE google_sub = ${body.sub}`;
        return res.status(200).json({ ok: true, xp: merged });
      }

      // Merge the caller's card collection with the account's (union per game+player: max use
      // count, earliest first-collected time, best rarity tier, sticky prime/legend flags).
      // Same always-merge posture as achSync — a fresh device can never wipe the account's binder.
      if (action === 'collectionSync') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const GAMES = ['pitcher', 'batter', 'baller'];
        const TIER_RANK = { legend: 5, diamond: 4, gold: 3, silver: 2, bronze: 1, grey: 0 };
        const incoming = (body.collection && typeof body.collection === 'object') ? body.collection : {};
        const base = ((await sql`SELECT collection FROM users WHERE google_sub = ${body.sub}`)[0] || {}).collection || {};
        const merged = {};
        for (const g of GAMES) {
          const mb = (base[g] && typeof base[g] === 'object') ? base[g] : {};
          merged[g] = mb;
          const inc = (incoming[g] && typeof incoming[g] === 'object') ? incoming[g] : {};
          let n = Object.keys(mb).length;
          for (const name in inc) {
            if (typeof name !== 'string' || !name || name.length > 60) continue;
            const e = inc[name];
            if (!e || typeof e !== 'object') continue;
            if (!mb[name] && n >= 3000) continue;   // per-game entry cap (pools are ~hundreds)
            const cur = mb[name] || {};
            if (!mb[name]) n++;
            const t = TIER_RANK[e.t] != null ? e.t : 'grey';
            mb[name] = {
              t: (TIER_RANK[cur.t] || 0) >= (TIER_RANK[t] || 0) && cur.t ? cur.t : t,
              c: Math.min(1e6, Math.max(Number(cur.c) || 0, Math.max(0, Math.round(Number(e.c) || 0)))),
              f: (cur.f && (!e.f || String(cur.f) < String(e.f))) ? cur.f : String(e.f || cur.f || new Date().toISOString()).slice(0, 40),
              ...(cur.p || e.p ? { p: 1 } : {}),
              ...(cur.l || e.l ? { l: 1 } : {}),
            };
          }
        }
        await sql`UPDATE users SET collection = ${JSON.stringify(merged)}::jsonb WHERE google_sub = ${body.sub}`;
        return res.status(200).json({ ok: true, collection: merged });
      }

      if (action === 'pvpStats') {
        const key = await pvpKey(body);
        if (!key) return res.status(401).json({ ok: false, error: 'Not signed in' });
        if (body.sport === 'hoops') return hoopsStats(key, res);
        const [u] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses, pvp_streak AS streak, pvp_season AS season, pvp_placement_games AS placement_games FROM users WHERE google_sub = ${key}`;
        if (!u) return res.status(401).json({ ok: false, error: 'Not signed in' });
        // season/placementGames let the chip show a live band or "Placement N/5"; the client computes
        // the season number + countdown itself from the shared SEASON1_START_MS, so no extra fetch.
        return res.status(200).json({ ok: true, elo: u.elo, wins: u.wins, losses: u.losses, streak: u.streak, season: u.season || 0, placementGames: u.placement_games || 0 });
      }

      if (action === 'pvpResult') {
        const key = await pvpKey(body);
        if (!key) return res.status(401).json({ ok: false, error: 'Not signed in' });
        if (body.sport === 'hoops') return hoopsResult(body, key, res);
        const matchId = String(body.matchId || '').slice(0, 80);
        if (!matchId) return res.status(400).json({ ok: false, error: 'missing matchId' });
        const won = !!body.won;
        // A completed at-bat is authoritative; a forfeit/quit claim is not. Older clients omit this
        // (undefined → treated as decided so their normal results still settle).
        const decided = body.decided !== false;
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
        const [u] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses, pvp_streak AS streak, pvp_season AS season, pvp_placement_games AS placement_games, name FROM users WHERE google_sub = ${key}`;
        if (!u) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const curSeason = seasonInfo(Date.now()).number;   // 0 = dormant (pre-kickoff)
        // dedupe: only the first report for this (match, player) counts
        const ins = await sql`INSERT INTO pvp_results (match_id, google_sub) VALUES (${matchId}, ${key})
          ON CONFLICT DO NOTHING RETURNING match_id`;
        if (!ins.length) {
          // Already settled — usually the winner reported first and we applied this player's loss
          // server-side. Pull the real delta from the recorded history row so the loser's screen
          // shows "-13" instead of "+0".
          let delta = 0, elo = u.elo, recWon = won, hRow = null;
          try {
            const [h] = await sql`SELECT id, won, elo_before, elo_after FROM pvp_history
              WHERE match_id = ${matchId} AND player_key = ${key} AND sport IS DISTINCT FROM 'hoops'
              ORDER BY created_at DESC LIMIT 1`;
            if (h) { hRow = h; delta = h.elo_after - h.elo_before; elo = h.elo_after; recWon = !!h.won; }
          } catch (e) {}

          // Conflict fix: a *completed at-bat* win from this player overrides a forfeit/quit claim
          // that wrongly settled them as a loss (asymmetric build delivery — the opponent never saw
          // our build, claimed a quit-win, while we actually finished the at-bat and won). Reverse
          // both players. Gated tightly so two real (decided) results — which always agree on the
          // higher-OVR winner — can never trigger it: requires the opponent's settling row to be a
          // NON-decided (forfeit) win and our OVR to be at least theirs.
          if (decided && won && hRow && hRow.won === false && myOvr && oppOvr && myOvr >= oppOvr) {
            const oppKeyVal = body.oppKey ? String(body.oppKey).slice(0, 80) : null;
            const clientOpp = oppKeyVal && /^(acct:|guest:)/.test(oppKeyVal) ? normKey(oppKeyVal) : null;
            const oppK = recordedOpp || clientOpp;
            if (oppK && oppK !== key) {
              try {
                const [oh] = await sql`SELECT id, won, decided, elo_before, elo_after FROM pvp_history
                  WHERE match_id = ${matchId} AND player_key = ${oppK} AND sport IS DISTINCT FROM 'hoops'
                  ORDER BY created_at DESC LIMIT 1`;
                if (oh && oh.won === true && oh.decided === false) {
                  const uBefore = hRow.elo_before, oBefore = oh.elo_before;
                  const uWin = nextElo(uBefore, oBefore, true).delta;    // what we should have gotten
                  const oLoss = nextElo(oBefore, uBefore, false).delta;  // what they should have gotten
                  // apply as a *relative* correction so an intervening match in the race window isn't clobbered
                  const uAdj = uWin - (hRow.elo_after - uBefore);
                  const oAdj = oLoss - (oh.elo_after - oBefore);
                  const [uNow] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${key}`;
                  const [oNow] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${oppK}`;
                  if (uNow && oNow) {
                    const uNewElo = Math.max(100, uNow.elo + uAdj);
                    const oNewElo = Math.max(100, oNow.elo + oAdj);
                    await sql`UPDATE users SET pvp_elo = ${uNewElo}, pvp_wins = ${uNow.wins + 1}, pvp_losses = ${Math.max(0, uNow.losses - 1)}, pvp_streak = 1 WHERE google_sub = ${key}`;
                    await sql`UPDATE users SET pvp_elo = ${oNewElo}, pvp_wins = ${Math.max(0, oNow.wins - 1)}, pvp_losses = ${oNow.losses + 1}, pvp_streak = 0 WHERE google_sub = ${oppK}`;
                    await sql`UPDATE pvp_history SET won = true, decided = true, elo_after = ${uBefore + uWin} WHERE id = ${hRow.id}`;
                    await sql`UPDATE pvp_history SET won = false, elo_after = ${oBefore + oLoss} WHERE id = ${oh.id}`;
                    return res.status(200).json({ ok: true, counted: true, reversed: true, won: true, elo: uNewElo, delta: uWin, bonus: 0, streak: 1, wins: uNow.wins + 1, losses: Math.max(0, uNow.losses - 1) });
                  }
                }
              } catch (e) {}
            }
          }
          // return the *recorded* outcome so a client whose local result disagreed (a forfeit /
          // both-claim-win race) can reconcile its headline to the Elo it actually got.
          return res.status(200).json({ ok: true, counted: false, won: recWon, elo, delta, bonus: 0, streak: u.streak, wins: u.wins, losses: u.losses });
        }
        // Season-aware settle: dormant (curSeason<1) reproduces the classic K=32 + streak result and
        // writes no season columns; active seasons roll the player over on their first game of the
        // month (squash + reset), apply K=48 no-streak during the 5 placements, then normal Elo.
        const r = applyMatch(u, won, oppElo, curSeason);
        const { elo, wins, losses, streak, bonus, delta } = r;
        if (curSeason >= 1) {
          await sql`UPDATE users SET pvp_elo = ${elo}, pvp_wins = ${wins}, pvp_losses = ${losses}, pvp_streak = ${streak}, pvp_season = ${r.season}, pvp_placement_games = ${r.placement_games} WHERE google_sub = ${key}`;
          await upsertSeason(curSeason, key, u.name, r);
        } else {
          await sql`UPDATE users SET pvp_elo = ${elo}, pvp_wins = ${wins}, pvp_losses = ${losses}, pvp_streak = ${streak} WHERE google_sub = ${key}`;
        }
        // Prefer the recorded opponent; else the client-reported oppKey (normalized so account keys,
        // sent as `acct:<sub>`, match the raw `<sub>` stored in users — a bug that previously made
        // the loss-apply silently no-op for signed-in opponents).
        const oppKeyVal = body.oppKey ? String(body.oppKey).slice(0, 80) : null;
        const clientOpp = oppKeyVal && /^(acct:|guest:)/.test(oppKeyVal) ? normKey(oppKeyVal) : null;
        const settleOpp = recordedOpp || clientOpp;
        const validOppKey = settleOpp && settleOpp !== key ? settleOpp : null;
        try {
          await sql`INSERT INTO pvp_history (player_key, match_id, won, my_role, my_ovr, opp_name, opp_ovr, opp_key, elo_before, elo_after, decided)
            VALUES (${key}, ${matchId}, ${won}, ${role}, ${myOvr}, ${oppName}, ${oppOvr}, ${validOppKey}, ${r.startElo}, ${elo}, ${decided})`;
        } catch (e) {}
        // When the winner reports, server-side apply the loss to the opponent so they can't
        // dodge it by refreshing before pvpResult fires on their end.
        if (won && validOppKey) {
          try {
            const oppIns = await sql`INSERT INTO pvp_results (match_id, google_sub)
              VALUES (${matchId}, ${validOppKey}) ON CONFLICT DO NOTHING RETURNING match_id`;
            if (oppIns.length) {
              const [opp] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses, pvp_streak AS streak, pvp_season AS season, pvp_placement_games AS placement_games, name FROM users WHERE google_sub = ${validOppKey}`;
              if (opp) {
                // Same season-aware machinery for the settled opponent (a loss vs the winner's rating),
                // so an opponent crossing a season boundary isn't mutated without a rollover.
                const or = applyMatch(opp, false, u.elo, curSeason);
                if (curSeason >= 1) {
                  await sql`UPDATE users SET pvp_elo = ${or.elo}, pvp_wins = ${or.wins}, pvp_losses = ${or.losses}, pvp_streak = ${or.streak}, pvp_season = ${or.season}, pvp_placement_games = ${or.placement_games} WHERE google_sub = ${validOppKey}`;
                  await upsertSeason(curSeason, validOppKey, opp.name, or);
                } else {
                  await sql`UPDATE users SET pvp_elo = ${or.elo}, pvp_losses = ${or.losses}, pvp_streak = 0 WHERE google_sub = ${validOppKey}`;
                }
                const oppHistRole = role ? (role === 'pitcher' ? 'batter' : 'pitcher') : null;
                const winnerName = String(body.name || '').slice(0, 40);
                await sql`INSERT INTO pvp_history (player_key, match_id, won, my_role, my_ovr, opp_name, opp_ovr, opp_key, elo_before, elo_after, decided)
                  VALUES (${validOppKey}, ${matchId}, false, ${oppHistRole}, ${oppOvr}, ${winnerName}, ${myOvr}, ${key}, ${or.startElo}, ${or.elo}, ${decided})`;
              }
            }
          } catch (e) {}
        }
        const out = { ok: true, counted: true, won, elo, delta: delta + bonus, bonus, streak, wins, losses };
        // season extras let the client render placement progress / "placed" instead of a raw Elo delta
        if (curSeason >= 1) { out.season = curSeason; out.placementGames = r.placement_games; out.placed = r.placed; out.inPlacement = r.inPlacement; }
        return res.status(200).json(out);
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

      // Carry a device-guest's rating onto a Google account at sign-in. The guest record MERGES
      // into the account even if the account has already played (the old "only onto a never-played
      // account" gate silently threw away everything earned while signed out): W/L are added, the
      // rating moves by the guest's net delta from the 1000 start (a fresh account lands exactly on
      // the guest rating), and the guest streak — their most recent games — carries over. The guest
      // row is consumed atomically (DELETE .. RETURNING) so a repeated/concurrent claim is a no-op,
      // and claimed match history is re-keyed so it follows the account.
      if (action === 'pvpClaim') {
        if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const gid = body.guestId ? ('guest:' + String(body.guestId).slice(0, 48)) : null;
        let claimedBase = false, claimedHoops = false;
        const [g] = gid ? await sql`DELETE FROM users WHERE google_sub = ${gid}
          AND (pvp_wins > 0 OR pvp_losses > 0 OR pvp_wins_hoops > 0 OR pvp_losses_hoops > 0)
          RETURNING pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses, pvp_streak AS streak,
            pvp_season AS season, pvp_placement_games AS placement,
            pvp_elo_hoops AS helo, pvp_wins_hoops AS hwins, pvp_losses_hoops AS hlosses, pvp_streak_hoops AS hstreak` : [];
        if (g) {
          const [acct] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses,
            pvp_elo_hoops AS helo, pvp_wins_hoops AS hwins, pvp_losses_hoops AS hlosses FROM users WHERE google_sub = ${body.sub}`;
          if (acct) {
            if (g.wins > 0 || g.losses > 0) {
              const elo = Math.max(100, Math.min(4000, acct.elo + (g.elo - 1000)));
              // carry the guest's season/placement so placements done as a guest survive sign-in
              await sql`UPDATE users SET pvp_elo = ${elo}, pvp_wins = ${acct.wins + g.wins}, pvp_losses = ${acct.losses + g.losses}, pvp_streak = ${g.streak}, pvp_season = ${g.season || 0}, pvp_placement_games = ${g.placement || 0} WHERE google_sub = ${body.sub}`;
              await sql`UPDATE pvp_history SET player_key = ${body.sub} WHERE player_key = ${gid} AND sport IS DISTINCT FROM 'hoops'`;
              // re-key the guest's season standings onto the account (drop any that would collide with
              // a season the account already has a row for, then re-key the rest — no PK violation)
              await sql`DELETE FROM pvp_seasons WHERE player_key = ${gid} AND season IN (SELECT season FROM pvp_seasons WHERE player_key = ${body.sub})`;
              await sql`UPDATE pvp_seasons SET player_key = ${body.sub} WHERE player_key = ${gid}`;
              claimedBase = true;
            }
            if (g.hwins > 0 || g.hlosses > 0) {
              const helo = Math.max(100, Math.min(4000, acct.helo + (g.helo - 1000)));
              await sql`UPDATE users SET pvp_elo_hoops = ${helo}, pvp_wins_hoops = ${acct.hwins + g.hwins}, pvp_losses_hoops = ${acct.hlosses + g.hlosses}, pvp_streak_hoops = ${g.hstreak} WHERE google_sub = ${body.sub}`;
              await sql`UPDATE pvp_history SET player_key = ${body.sub} WHERE player_key = ${gid} AND sport = 'hoops'`;
              claimedHoops = true;
            }
            await sql`UPDATE pvp_history SET opp_key = ${body.sub} WHERE opp_key = ${gid}`;
          }
        }
        const [after] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${body.sub}`;
        return res.status(200).json({ ok: true, claimed: claimedBase || claimedHoops, claimedHoops,
          elo: after ? after.elo : 1000, wins: after ? after.wins : 0, losses: after ? after.losses : 0 });
      }

      if (action === 'pvpLeaderboard') {
        if (body.sport === 'hoops') return hoopsLeaderboard(body, res);
        const limit = Math.max(1, Math.min(100, parseInt(body.limit, 10) || 50));
        // ?season=N → that season's final standings from pvp_seasons (only PLACED players rank);
        // no season param → the existing live board off users (= current lifetime/season Elo).
        const wantSeason = parseInt(body.season, 10);
        if (wantSeason >= 1) {
          const rows = await sql`SELECT name, elo, wins, losses FROM pvp_seasons
            WHERE season = ${wantSeason} AND placed = true
            ORDER BY elo DESC, (wins + losses) DESC LIMIT ${limit}`;
          let me = null;
          const key = await pvpKey(body);
          if (key) {
            const [u] = await sql`SELECT name, elo, wins, losses, placed FROM pvp_seasons WHERE season = ${wantSeason} AND player_key = ${key}`;
            if (u && u.placed) {
              const [{ ahead }] = await sql`SELECT count(*)::int AS ahead FROM pvp_seasons WHERE season = ${wantSeason} AND placed = true AND elo > ${u.elo}`;
              me = { rank: ahead + 1, name: u.name, elo: u.elo, wins: u.wins, losses: u.losses };
            } else if (u) {
              me = { rank: null, name: u.name, elo: u.elo, wins: u.wins, losses: u.losses };
            }
          }
          return res.status(200).json({ ok: true, rows, me, season: wantSeason });
        }
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

      // The caller's season-by-season history (for the Seasons tab). Each row carries the player's
      // final band Elo + their worldwide rank that season (placed players only).
      if (action === 'pvpSeasonHistory') {
        const key = await pvpKey(body);
        if (!key) return res.status(401).json({ ok: false, error: 'Not signed in' });
        const rows = await sql`SELECT season, name, elo, wins, losses, peak_elo AS peak, placed
          FROM pvp_seasons WHERE player_key = ${key} ORDER BY season DESC`;
        const seasons = [];
        for (const s of rows) {
          let rank = null;
          if (s.placed) {
            const [{ ahead }] = await sql`SELECT count(*)::int AS ahead FROM pvp_seasons WHERE season = ${s.season} AND placed = true AND elo > ${s.elo}`;
            rank = ahead + 1;
          }
          seasons.push({ season: s.season, elo: s.elo, wins: s.wins, losses: s.losses, peak: s.peak, placed: s.placed, rank });
        }
        return res.status(200).json({ ok: true, seasons });
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

      // admin: manually reverse one match's Elo/record when a false forfeit/quit claim beat the real
      // winner's report to the server (the same wrong the live reversal in pvpResult now prevents,
      // but for matches that were settled before that shipped). Token-gated + idempotent: only acts
      // if the intended winner is currently recorded as the loser of that match. Uses a relative
      // correction so ratings that moved in later matches aren't clobbered.
      if (action === 'pvpFixMatch') {
        if (body.token !== STATS_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });
        const matchId = String(body.matchId || '').slice(0, 80);
        const hoops = body.sport === 'hoops';
        let winnerKey = body.winnerKey ? String(body.winnerKey) : null;
        if (!winnerKey && body.winnerEmail) {
          const [wu] = await sql`SELECT google_sub FROM users WHERE lower(email) = lower(${String(body.winnerEmail).trim()})`;
          winnerKey = wu ? wu.google_sub : null;
        }
        if (!matchId || !winnerKey) return res.status(400).json({ ok: false, error: 'matchId and winnerKey/winnerEmail required' });
        const [wh] = hoops
          ? await sql`SELECT id, won, elo_before, elo_after, opp_key FROM pvp_history WHERE match_id = ${matchId} AND player_key = ${winnerKey} AND sport = 'hoops' ORDER BY created_at DESC LIMIT 1`
          : await sql`SELECT id, won, elo_before, elo_after, opp_key FROM pvp_history WHERE match_id = ${matchId} AND player_key = ${winnerKey} AND sport IS DISTINCT FROM 'hoops' ORDER BY created_at DESC LIMIT 1`;
        if (!wh) return res.status(404).json({ ok: false, error: 'no history row for that winner + match' });
        if (wh.won === true) return res.status(200).json({ ok: true, alreadyDone: true, note: 'winner already recorded as a win' });
        const loserKey = body.loserKey ? String(body.loserKey) : wh.opp_key;
        if (!loserKey) return res.status(400).json({ ok: false, error: 'loserKey unknown (pass loserKey)' });
        const [lh] = hoops
          ? await sql`SELECT id, won, elo_before, elo_after FROM pvp_history WHERE match_id = ${matchId} AND player_key = ${loserKey} AND sport = 'hoops' ORDER BY created_at DESC LIMIT 1`
          : await sql`SELECT id, won, elo_before, elo_after FROM pvp_history WHERE match_id = ${matchId} AND player_key = ${loserKey} AND sport IS DISTINCT FROM 'hoops' ORDER BY created_at DESC LIMIT 1`;
        if (!lh) return res.status(404).json({ ok: false, error: 'no history row for the loser + match' });
        const uBefore = wh.elo_before, oBefore = lh.elo_before;
        const uWin = nextElo(uBefore, oBefore, true).delta;
        const oLoss = nextElo(oBefore, uBefore, false).delta;
        const uAdj = uWin - (wh.elo_after - uBefore);   // relative: undo the wrong result + apply the right one
        const oAdj = oLoss - (lh.elo_after - oBefore);
        if (hoops) {
          const [uNow] = await sql`SELECT pvp_elo_hoops AS elo, pvp_wins_hoops AS wins, pvp_losses_hoops AS losses FROM users WHERE google_sub = ${winnerKey}`;
          const [oNow] = await sql`SELECT pvp_elo_hoops AS elo, pvp_wins_hoops AS wins, pvp_losses_hoops AS losses FROM users WHERE google_sub = ${loserKey}`;
          if (!uNow || !oNow) return res.status(404).json({ ok: false, error: 'user row missing' });
          const uNewElo = Math.max(100, uNow.elo + uAdj), oNewElo = Math.max(100, oNow.elo + oAdj);
          await sql`UPDATE users SET pvp_elo_hoops = ${uNewElo}, pvp_wins_hoops = ${uNow.wins + 1}, pvp_losses_hoops = ${Math.max(0, uNow.losses - 1)} WHERE google_sub = ${winnerKey}`;
          await sql`UPDATE users SET pvp_elo_hoops = ${oNewElo}, pvp_wins_hoops = ${Math.max(0, oNow.wins - 1)}, pvp_losses_hoops = ${oNow.losses + 1} WHERE google_sub = ${loserKey}`;
          await sql`UPDATE pvp_history SET won = true, decided = true, elo_after = ${uBefore + uWin} WHERE id = ${wh.id}`;
          await sql`UPDATE pvp_history SET won = false, elo_after = ${oBefore + oLoss} WHERE id = ${lh.id}`;
          return res.status(200).json({ ok: true, reversed: true, sport: 'hoops',
            winner: { key: winnerKey, elo: uNewElo, wins: uNow.wins + 1, losses: Math.max(0, uNow.losses - 1) },
            loser: { key: loserKey, elo: oNewElo, wins: Math.max(0, oNow.wins - 1), losses: oNow.losses + 1 } });
        }
        const [uNow] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${winnerKey}`;
        const [oNow] = await sql`SELECT pvp_elo AS elo, pvp_wins AS wins, pvp_losses AS losses FROM users WHERE google_sub = ${loserKey}`;
        if (!uNow || !oNow) return res.status(404).json({ ok: false, error: 'user row missing' });
        const uNewElo = Math.max(100, uNow.elo + uAdj), oNewElo = Math.max(100, oNow.elo + oAdj);
        await sql`UPDATE users SET pvp_elo = ${uNewElo}, pvp_wins = ${uNow.wins + 1}, pvp_losses = ${Math.max(0, uNow.losses - 1)} WHERE google_sub = ${winnerKey}`;
        await sql`UPDATE users SET pvp_elo = ${oNewElo}, pvp_wins = ${Math.max(0, oNow.wins - 1)}, pvp_losses = ${oNow.losses + 1} WHERE google_sub = ${loserKey}`;
        await sql`UPDATE pvp_history SET won = true, decided = true, elo_after = ${uBefore + uWin} WHERE id = ${wh.id}`;
        await sql`UPDATE pvp_history SET won = false, elo_after = ${oBefore + oLoss} WHERE id = ${lh.id}`;
        return res.status(200).json({ ok: true, reversed: true,
          winner: { key: winnerKey, elo: uNewElo, wins: uNow.wins + 1, losses: Math.max(0, uNow.losses - 1) },
          loser: { key: loserKey, elo: oNewElo, wins: Math.max(0, oNow.wins - 1), losses: oNow.losses + 1 } });
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

      // One-time, token-gated: restore account XP from server evidence, for accounts zeroed by
      // the old fresh-profile reset bug. Computes a conservative FLOOR of what the account must
      // have earned — achievement unlocks (40 XP each, 120 for challenge tiles), daily-challenge
      // submissions (build-finish + career-sim XP per play), and the 1v1 record (55/win, 18/loss)
      // — and raises users.xp to it where it's lower. Never lowers anyone (XP stays monotonic).
      // Run achBackfill FIRST so restored unlocks count. Defaults to dryRun:true.
      if (action === 'xpBackfill') {
        if (body.token !== STATS_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });
        const dryRun = body.dryRun !== false;
        const ACH_XP = 40, ACH_XP_CHAL = 120;
        const CHAL = new Set(['the_goat', 'beyond', 'k3', 'w3', 'unanimous', 'ring3', 'billion',
          'streak3', 'elo3', 'mismatch3', 'grind3', 'completionist']);
        // per-account daily evidence: each submission = a finished build (20 + max(0, ovr-60))
        // + the career sim that always follows it (40 + max(0, ovr-70))
        const dailyXp = {};
        try {
          const dailies = await sql`SELECT player_key,
              sum(60 + GREATEST(0, ovr - 60) + GREATEST(0, ovr - 70))::int AS xp
            FROM daily_scores WHERE player_key LIKE 'acct:%' GROUP BY player_key`;
          for (const d of dailies) dailyXp[d.player_key.slice(5)] = Number(d.xp) || 0;
        } catch (e) {}
        const users = await sql`SELECT google_sub, email, name, xp, achievements,
            pvp_wins, pvp_losses, pvp_wins_hoops, pvp_losses_hoops
          FROM users WHERE google_sub NOT LIKE 'guest:%'`;
        const rows = [];
        let granted = 0, totalXp = 0;
        for (const u of users) {
          const ach = (u.achievements && typeof u.achievements === 'object') ? u.achievements : {};
          let floor = 0;
          for (const id in ach) floor += CHAL.has(id) ? ACH_XP_CHAL : ACH_XP;
          floor += dailyXp[u.google_sub] || 0;
          floor += 55 * ((u.pvp_wins || 0) + (u.pvp_wins_hoops || 0));
          floor += 18 * ((u.pvp_losses || 0) + (u.pvp_losses_hoops || 0));
          const cur = Number(u.xp) || 0;
          if (floor <= cur) continue;
          granted++;
          totalXp += floor - cur;
          rows.push({ email: u.email, name: u.name, xp_before: cur, xp_after: floor });
          if (!dryRun) await sql`UPDATE users SET xp = ${floor} WHERE google_sub = ${u.google_sub}`;
        }
        rows.sort((a, b) => (b.xp_after - b.xp_before) - (a.xp_after - a.xp_before));
        return res.status(200).json({ ok: true, dryRun, accounts_scanned: users.length,
          accounts_raised: granted, total_xp_granted: totalXp, rows: rows.slice(0, 100) });
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
