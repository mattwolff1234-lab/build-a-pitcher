// Leaderboard API (Vercel serverless function, talks to Neon Postgres).
//   GET  /api/score?scope=global|daily&limit=50  -> ranked rows
//   POST /api/score  { name, ovr, build }         -> inserts, returns id + global rank
//
// DB URL is injected by the Vercel<>Neon integration (DATABASE_URL / POSTGRES_URL).

const { neon } = require('@neondatabase/serverless');

const CONN = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
const sql = neon(CONN);

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
    const limit = Math.min(100, Math.max(1, parseInt(req.query && req.query.limit, 10) || 50));
    const rows = scope === 'daily'
      ? await sql`SELECT id, name, ovr, created_at FROM scores
            WHERE created_at >= date_trunc('day', now())
            ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`
      : await sql`SELECT id, name, ovr, created_at FROM scores
            ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`;
    return res.status(200).json({ ok: true, rows: rows.map(r => ({ ...r, id: Number(r.id) })) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
