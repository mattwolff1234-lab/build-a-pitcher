// Cross-sport Champion Points — weekly + monthly championship standings (read-only API).
// Scoring is percentile-of-field, so NO sport is a better points farm than another:
//   · each daily-challenge run earns points for the share of THAT game's field you beat THAT
//     day (unique #1 = 100, middle of the pack ≈ 50) — raw OVR ranges (CFB ~95 cap vs 99+
//     batters) cancel out because you're only compared to people building the same cards
//   · ties split the rank golf-style: 50 players tied at the top of a 100-field each get ~75,
//     not fifty 100s — cap-clustered games (everyone finds the 99 build) can't mint max points
//   · small fields are damped (× field/25, capped at 1) so a 2-player game can't hand out 100s
//   · every game is one attempt/day with the same 100-point ceiling — equal everywhere
// Windows: week = ISO Mon–Sun on challenge_date (UTC dates) · month = calendar month · day.
//   GET /api/champions?scope=week|month|day[&date=YYYY-MM-DD][&limit=N]
//   → { ok, scope, start, end, total:[{name,pts,bestDay,bestDayDate,runs,days,signedIn}],
//       bestDay:[…same rows sorted by best single day…] }
// player_key is intentionally NOT exposed over HTTP (guest ids / google subs stay private).
// Settlement (coins + champion cosmetics) lives in api/discord-daily.js, which requires this
// module's boards()/windowFor() — one formula, no drift.
const { neon } = require('@neondatabase/serverless');
let NameFilter; try { NameFilter = require('../namefilter.js'); } catch (e) { NameFilter = { clean: (n, f) => n || f }; }

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

// Daily-challenge games only. GOAT Squad is guest-first (no accounts) → no reliable identity
// to rank or pay, so it stays out of the championship.
const GAMES = ['pitcher', 'batter', 'baller', 'striker', 'keeper', 'cfb', 'hockey', 'mon'];

const isoDay = d => d.toISOString().slice(0, 10);
function windowFor(scope, dateStr) {
  const base = new Date((dateStr || isoDay(new Date())) + 'T00:00:00Z');
  if (scope === 'day') return { start: isoDay(base), end: isoDay(base) };
  if (scope === 'month') {
    const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
    const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
    return { start: isoDay(start), end: isoDay(end) };
  }
  const dow = (base.getUTCDay() + 6) % 7;   // Mon = 0
  const start = new Date(base.getTime() - dow * 86400000);
  return { start: isoDay(start), end: isoDay(new Date(start.getTime() + 6 * 86400000)) };
}

// Both boards for a window: total-points sort AND best-single-day sort. Two queries on purpose —
// a one-day wonder can sit below any total-sort LIMIT cutoff, and Best Day pays real coins.
async function boards(start, end, limit) {
  const games = GAMES.join(',');
  const shape = rows => rows.map(r => ({
    key: String(r.player_key || ''),
    name: NameFilter.clean(String(r.name == null ? '' : r.name), 'Anonymous'),
    pts: Number(r.pts), bestDay: Number(r.best_day), bestDayDate: r.best_day_date,
    runs: Number(r.runs), days: Number(r.days),
    signedIn: String(r.player_key || '').indexOf('acct:') === 0,
  }));
  // points per run = 100 · (share of the field beaten, ties averaged) · small-field damper
  const total = await sql`
    WITH runs AS (
      SELECT player_key, name, challenge_date,
        count(*) OVER (PARTITION BY game, challenge_date) AS field,
        rank()   OVER (PARTITION BY game, challenge_date ORDER BY ovr DESC) AS rnk,
        count(*) OVER (PARTITION BY game, challenge_date, ovr) AS ties
      FROM daily_scores
      WHERE challenge_date >= ${start}::date AND challenge_date <= ${end}::date
        AND game = ANY(string_to_array(${games}, ','))
    ), days AS (
      SELECT player_key, challenge_date, max(name) AS name, count(*) AS games,
        sum(100.0 * (field - (rnk + (ties - 1) / 2.0) + 1) / field * LEAST(1.0, field / 25.0)) AS day_pts
      FROM runs GROUP BY player_key, challenge_date
    )
    SELECT player_key,
      (array_agg(name ORDER BY challenge_date DESC))[1] AS name,
      round(sum(day_pts))::int AS pts,
      round(max(day_pts))::int AS best_day,
      to_char((array_agg(challenge_date ORDER BY day_pts DESC))[1], 'YYYY-MM-DD') AS best_day_date,
      sum(games)::int AS runs, count(*)::int AS days
    FROM days GROUP BY player_key
    ORDER BY sum(day_pts) DESC, count(*) DESC LIMIT ${limit}`;
  const best = await sql`
    WITH runs AS (
      SELECT player_key, name, challenge_date,
        count(*) OVER (PARTITION BY game, challenge_date) AS field,
        rank()   OVER (PARTITION BY game, challenge_date ORDER BY ovr DESC) AS rnk,
        count(*) OVER (PARTITION BY game, challenge_date, ovr) AS ties
      FROM daily_scores
      WHERE challenge_date >= ${start}::date AND challenge_date <= ${end}::date
        AND game = ANY(string_to_array(${games}, ','))
    ), days AS (
      SELECT player_key, challenge_date, max(name) AS name, count(*) AS games,
        sum(100.0 * (field - (rnk + (ties - 1) / 2.0) + 1) / field * LEAST(1.0, field / 25.0)) AS day_pts
      FROM runs GROUP BY player_key, challenge_date
    )
    SELECT player_key,
      (array_agg(name ORDER BY challenge_date DESC))[1] AS name,
      round(sum(day_pts))::int AS pts,
      round(max(day_pts))::int AS best_day,
      to_char((array_agg(challenge_date ORDER BY day_pts DESC))[1], 'YYYY-MM-DD') AS best_day_date,
      sum(games)::int AS runs, count(*)::int AS days
    FROM days GROUP BY player_key
    ORDER BY max(day_pts) DESC, sum(day_pts) DESC LIMIT ${limit}`;
  return { total: shape(total), best: shape(best) };
}

module.exports = async (req, res) => {
  if (!sql) return res.status(500).json({ ok: false, error: 'Database not configured' });
  const q = req.query || {};
  const scope = (q.scope === 'month' || q.scope === 'day') ? q.scope : 'week';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : null;
  const limit = Math.max(1, Math.min(200, parseInt(q.limit, 10) || 50));
  try {
    const { start, end } = windowFor(scope, date);
    const b = await boards(start, end, limit);
    const pub = r => ({ name: r.name, pts: r.pts, bestDay: r.bestDay, bestDayDate: r.bestDayDate,
      runs: r.runs, days: r.days, signedIn: r.signedIn });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ok: true, scope, start, end,
      total: b.total.map(pub), bestDay: b.best.map(pub) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
};
module.exports.windowFor = windowFor;
module.exports.boards = boards;
module.exports.GAMES = GAMES;
