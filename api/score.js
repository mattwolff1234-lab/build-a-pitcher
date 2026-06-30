// Leaderboard API (Vercel serverless function, talks to Neon Postgres).
//   GET  /api/score?scope=global|daily&limit=200&game=pitcher|batter&me=<id>
//   POST /api/score  { name, ovr, build, game }
// One table, separated by `game` so pitching and batting have their own boards.

const { neon } = require('@neondatabase/serverless');

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
// Per-player key for daily dedup: signed-in account, else device guest id. Trust-the-client, same
// posture as the rest of the leaderboard — the UNIQUE constraint is what enforces one attempt/day.
const playerKey = b => (b && b.sub ? 'acct:' + String(b.sub).slice(0, 80) : (b && b.guestId ? 'guest:' + String(b.guestId).slice(0, 80) : null));
// The daily resets at each player's LOCAL midnight, so the browser sends its own date (YYYY-MM-DD).
// We validate it and fall back to the server's CURRENT_DATE (UTC) when absent/malformed.
const dailyDate = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

let ready;
function ensure() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS scores (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name text NOT NULL,
        ovr int NOT NULL,
        build jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE scores ADD COLUMN IF NOT EXISTS game text NOT NULL DEFAULT 'pitcher'`;
      await sql`CREATE INDEX IF NOT EXISTS idx_scores_game_ovr ON scores (game, ovr DESC, created_at ASC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_scores_created ON scores (created_at)`;
      // Live play counter, seeded at 210k (estimated historical plays we never tracked).
      await sql`CREATE TABLE IF NOT EXISTS counters (key text PRIMARY KEY, n bigint NOT NULL DEFAULT 0)`;
      await sql`INSERT INTO counters (key, n) VALUES ('plays', 210000) ON CONFLICT (key) DO NOTHING`;
      // Daily Challenge: one seeded puzzle per day, one attempt per player (enforced by the UNIQUE).
      await sql`CREATE TABLE IF NOT EXISTS daily_scores (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        player_key text NOT NULL,
        game text NOT NULL DEFAULT 'pitcher',
        name text NOT NULL,
        ovr int NOT NULL,
        build jsonb,
        challenge_date date NOT NULL DEFAULT CURRENT_DATE,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (player_key, game, challenge_date)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_daily_scores_date ON daily_scores (game, challenge_date, ovr DESC)`;
    })();
  }
  return ready;
}

module.exports = async (req, res) => {
  if (!CONN) return res.status(500).json({ ok: false, error: 'Database not configured' });
  try {
    await ensure();

    // GET ?action=stats[&game=pitcher|batter|all] — total builds, GOAT (99 OVR) count, + live play counter.
    if (req.method !== 'POST' && (req.query && req.query.action) === 'stats') {
      const g = req.query && req.query.game;
      const [{ total, goat }] = (g === 'all')
        ? await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE ovr >= 99)::int AS goat FROM scores`
        : await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE ovr >= 99)::int AS goat FROM scores WHERE game = ${gameOf(g)}`;
      const [{ n: plays }] = await sql`SELECT n FROM counters WHERE key = 'plays'`;
      const t = Number(total), gt = Number(goat);
      return res.status(200).json({ ok: true, total: t, goat: gt, pct: t > 0 ? (gt / t) * 100 : 0, plays: Number(plays) });
    }

    // GET ?action=challengeLeaderboard — today's daily board + how many have played today.
    if (req.method !== 'POST' && (req.query && req.query.action) === 'challengeLeaderboard') {
      const game = gameOf(req.query && req.query.game);
      const limit = Math.max(1, Math.min(200, parseInt(req.query && req.query.limit, 10) || 50));
      const cd = dailyDate(req.query && req.query.date);
      const rows = await sql`SELECT name, ovr FROM daily_scores
        WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE) ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`;
      const [{ total }] = await sql`SELECT count(*)::int AS total FROM daily_scores WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE)`;
      return res.status(200).json({ ok: true, rows, total: Number(total) });
    }

    // GET ?action=dailyDates&sub=<sub>|&guestId=<id> — the player's daily-play dates (streak calendar)
    // plus today's result (so the one-per-day gate is enforced per ACCOUNT, across devices).
    if (req.method !== 'POST' && (req.query && req.query.action) === 'dailyDates') {
      const key = playerKey(req.query);
      if (!key) return res.status(200).json({ ok: true, dates: [], today: null });
      const game = gameOf(req.query && req.query.game);
      const rows = await sql`SELECT to_char(challenge_date, 'YYYY-MM-DD') AS d FROM daily_scores
        WHERE player_key = ${key} AND game = ${game} ORDER BY challenge_date`;
      const cd = dailyDate(req.query && req.query.date);
      const [t] = await sql`SELECT ovr FROM daily_scores WHERE player_key = ${key} AND game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE)`;
      let today = null;
      if (t) {
        const [{ rank }] = await sql`SELECT count(*)::int + 1 AS rank FROM daily_scores WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE) AND ovr > ${t.ovr}`;
        const [{ total }] = await sql`SELECT count(*)::int AS total FROM daily_scores WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE)`;
        today = { ovr: Number(t.ovr), rank: Number(rank), total: Number(total) };
      }
      return res.status(200).json({ ok: true, dates: rows.map(r => r.d), today });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      // Play counter: fired once per game session (first spin). Increments the live "plays" headline.
      if (body.action === 'play' || (req.query && req.query.action === 'play')) {
        const [{ n }] = await sql`INSERT INTO counters (key, n) VALUES ('plays', 1)
          ON CONFLICT (key) DO UPDATE SET n = counters.n + 1 RETURNING n`;
        return res.status(200).json({ ok: true, plays: Number(n) });
      }

      // Daily Challenge submission — one row per player per day; returns today's rank + field size.
      if (body.action === 'challengeSubmit') {
        const key = playerKey(body);
        if (!key) return res.status(400).json({ ok: false, error: 'No player key' });
        const game = gameOf(body.game);
        const ovr = Math.max(1, Math.min(120, Math.round(Number(body.ovr) || 0)));
        const cname = String(body.name == null ? '' : body.name).trim().slice(0, 40) || 'Anonymous';
        const cbuild = body.build && typeof body.build === 'object' ? JSON.stringify(body.build) : null;
        const cd = dailyDate(body.date);
        await sql`INSERT INTO daily_scores (player_key, game, name, ovr, build, challenge_date)
          VALUES (${key}, ${game}, ${cname}, ${ovr}, ${cbuild}::jsonb, COALESCE(${cd}::date, CURRENT_DATE))
          ON CONFLICT (player_key, game, challenge_date) DO NOTHING`;
        const [{ rank }] = await sql`SELECT count(*)::int + 1 AS rank FROM daily_scores
          WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE) AND ovr > ${ovr}`;
        const [{ total }] = await sql`SELECT count(*)::int AS total FROM daily_scores
          WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE)`;
        return res.status(200).json({ ok: true, rank: Number(rank), total: Number(total) });
      }

      let name = String(body.name == null ? '' : body.name).trim().slice(0, 20);
      if (!name) name = 'Anonymous';
      const ovr = Math.max(1, Math.min(99, Math.round(Number(body.ovr) || 0)));
      const build = body.build && typeof body.build === 'object' ? JSON.stringify(body.build) : null;
      const game = gameOf(body.game);

      const [row] = await sql`
        INSERT INTO scores (name, ovr, build, game) VALUES (${name}, ${ovr}, ${build}::jsonb, ${game})
        RETURNING id, name, ovr, created_at`;
      const [{ ahead }] = await sql`
        SELECT count(*)::int AS ahead FROM scores
        WHERE game = ${game} AND (ovr > ${ovr} OR (ovr = ${ovr} AND created_at < ${row.created_at}))`;
      return res.status(200).json({ ok: true, id: Number(row.id), globalRank: ahead + 1 });
    }

    const scope = (req.query && req.query.scope) || 'global';
    const limit = Math.min(200, Math.max(1, parseInt(req.query && req.query.limit, 10) || 50));
    const daily = scope === 'daily';
    const game = gameOf(req.query && req.query.game);
    // Optional sort by a career-total stat (trust-the-client, same as ovr). Whitelisted keys map to build.career.totals fields.
    const SORT_FIELDS = { k: 'k', war: 'war', wins: 'wins', rings: 'rings', cyYoung: 'cyYoung', hr: 'hr', hits: 'h', mvp: 'mvp', pts: 'pts', reb: 'reb', ast: 'ast' };
    const sortField = SORT_FIELDS[req.query && req.query.sort] || null;
    const worst = (req.query && req.query.sort) === 'ovrAsc'; // ascending OVR ("worst overall")
    const NULL_SENTINEL = -1e30; // ranks missing-career entries last under a stat sort

    let rows;
    if (worst) {
      rows = daily
        ? await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots') ELSE build END AS build,
              game, created_at FROM scores
              WHERE game = ${game} AND created_at >= date_trunc('day', now())
              ORDER BY ovr ASC, created_at ASC LIMIT ${limit}`
        : await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots') ELSE build END AS build,
              game, created_at FROM scores
              WHERE game = ${game}
              ORDER BY ovr ASC, created_at ASC LIMIT ${limit}`;
    } else if (sortField) {
      rows = daily
        ? await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots') ELSE build END AS build,
              game, created_at, (build->'career'->'totals'->>${sortField})::numeric AS stat FROM scores
              WHERE game = ${game} AND created_at >= date_trunc('day', now())
              ORDER BY (build->'career'->'totals'->>${sortField})::numeric DESC NULLS LAST, ovr DESC, created_at ASC LIMIT ${limit}`
        : await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots') ELSE build END AS build,
              game, created_at, (build->'career'->'totals'->>${sortField})::numeric AS stat FROM scores
              WHERE game = ${game}
              ORDER BY (build->'career'->'totals'->>${sortField})::numeric DESC NULLS LAST, ovr DESC, created_at ASC LIMIT ${limit}`;
    } else {
      rows = daily
        ? await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots') ELSE build END AS build,
              game, created_at FROM scores
              WHERE game = ${game} AND created_at >= date_trunc('day', now())
              ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`
        : await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots') ELSE build END AS build,
              game, created_at FROM scores
              WHERE game = ${game}
              ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`;
    }

    let me = null;
    const meId = req.query && req.query.me ? parseInt(req.query.me, 10) : null;
    if (meId) {
      const statField = sortField || 'war'; // value only used when sortField is set
      const [row] = await sql`SELECT id, name, ovr,
        CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots') ELSE build END AS build,
        created_at, game, (build->'career'->'totals'->>${statField})::numeric AS stat FROM scores WHERE id = ${meId}`;
      if (row && row.game === game) {
        let ahead;
        if (sortField) {
          const meVal = row.stat == null ? NULL_SENTINEL : Number(row.stat);
          ahead = daily
            ? (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${game} AND created_at >= date_trunc('day', now())
                    AND (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${NULL_SENTINEL}) > ${meVal}
                      OR (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${NULL_SENTINEL}) = ${meVal} AND created_at < ${row.created_at}))`)[0].ahead
            : (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${game}
                    AND (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${NULL_SENTINEL}) > ${meVal}
                      OR (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${NULL_SENTINEL}) = ${meVal} AND created_at < ${row.created_at}))`)[0].ahead;
        } else if (worst) {
          ahead = daily
            ? (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${row.game} AND created_at >= date_trunc('day', now())
                    AND (ovr < ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`)[0].ahead
            : (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${row.game} AND (ovr < ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`)[0].ahead;
        } else {
          ahead = daily
            ? (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${row.game} AND created_at >= date_trunc('day', now())
                    AND (ovr > ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`)[0].ahead
            : (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${row.game} AND (ovr > ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`)[0].ahead;
        }
        const inScope = daily
          ? (await sql`SELECT 1 FROM scores WHERE id = ${meId} AND created_at >= date_trunc('day', now())`).length > 0
          : true;
        if (inScope) me = { id: Number(row.id), rank: ahead + 1, name: row.name, ovr: row.ovr, build: row.build, game: row.game,
          stat: sortField && row.stat != null ? Number(row.stat) : null };
      }
    }
    return res.status(200).json({ ok: true, sort: sortField, rows: rows.map(r => ({ ...r, id: Number(r.id), stat: r.stat == null ? null : Number(r.stat) })), me });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
