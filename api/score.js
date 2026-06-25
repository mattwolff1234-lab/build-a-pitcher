// Leaderboard API (Vercel serverless function, talks to Neon Postgres).
//   GET  /api/score?scope=global|daily&limit=50  -> ranked rows
//   POST /api/score  { name, ovr, build }         -> inserts, returns id + global rank
//
// DB URL is injected by the Vercel<>Neon integration (DATABASE_URL / POSTGRES_URL).

const { neon } = require('@neondatabase/serverless');

// Find the Postgres connection string regardless of the env-var prefix Vercel/Neon
// chose (DATABASE_URL, POSTGRES_URL, STORAGE_DATABASE_URL, etc.). Falls back to
// scanning for any value that looks like a postgres:// URL.
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
      await sql`CREATE INDEX IF NOT EXISTS idx_scores_ovr ON scores (ovr DESC, created_at ASC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_scores_created ON scores (created_at)`;
    })();
  }
  return ready;
}

module.exports = async (req, res) => {
  if (!CONN) return res.status(500).json({ ok: false, error: 'Database not configured' });
  try {
    await ensure();

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      let name = String(body.name == null ? '' : body.name).trim().slice(0, 20);
      if (!name) name = 'Anonymous';
      const ovr = Math.max(1, Math.min(99, Math.round(Number(body.ovr) || 0)));
      const build = body.build && typeof body.build === 'object' ? JSON.stringify(body.build) : null;

      const [row] = await sql`
        INSERT INTO scores (name, ovr, build) VALUES (${name}, ${ovr}, ${build}::jsonb)
        RETURNING id, name, ovr, created_at`;
      const [{ ahead }] = await sql`
        SELECT count(*)::int AS ahead FROM scores
        WHERE ovr > ${ovr} OR (ovr = ${ovr} AND created_at < ${row.created_at})`;
      return res.status(200).json({ ok: true, id: Number(row.id), globalRank: ahead + 1 });
    }

    const scope = (req.query && req.query.scope) || 'global';
    const limit = Math.min(200, Math.max(1, parseInt(req.query && req.query.limit, 10) || 50));
    const daily = scope === 'daily';
    const rows = daily
      ? await sql`SELECT id, name, ovr, created_at FROM scores
            WHERE created_at >= date_trunc('day', now())
            ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`
      : await sql`SELECT id, name, ovr, created_at FROM scores
            ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`;

    // Rank of a specific entry within this scope (so a submitter sees their place even if not top-N).
    let me = null;
    const meId = req.query && req.query.me ? parseInt(req.query.me, 10) : null;
    if (meId) {
      const [row] = await sql`SELECT id, name, ovr, created_at FROM scores WHERE id = ${meId}`;
      if (row) {
        const aheadRows = daily
          ? await sql`SELECT count(*)::int AS ahead FROM scores
                WHERE created_at >= date_trunc('day', now())
                  AND (ovr > ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`
          : await sql`SELECT count(*)::int AS ahead FROM scores
                WHERE ovr > ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at})`;
        const inScope = daily
          ? (await sql`SELECT 1 FROM scores WHERE id = ${meId} AND created_at >= date_trunc('day', now())`).length > 0
          : true;
        if (inScope) me = { rank: aheadRows[0].ahead + 1, name: row.name, ovr: row.ovr };
      }
    }
    return res.status(200).json({ ok: true, rows: rows.map(r => ({ ...r, id: Number(r.id) })), me });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
