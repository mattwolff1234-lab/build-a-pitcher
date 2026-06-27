// Live 1v1 matchmaking queue (Vercel serverless + Neon Postgres).
// Pairing is atomic in SQL (FOR UPDATE SKIP LOCKED) so two players can never double-pair.
// Waiting is push-based over Ably (the claimer pushes the match to the waiter's invite channel),
// so nobody polls.
//   POST /api/match { action:'find', id }   -> { matched, matchId, seed, role, oppId } | { waiting:true }
//   POST /api/match { action:'leave', id }  -> { ok:true }

const crypto = require('crypto');
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

let ready;
function ensure() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS pvp_queue (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      // pid = a stable per-person id (account sub or device guest id) so we never pair someone
      // with themselves on a second tab/device.
      await sql`ALTER TABLE pvp_queue ADD COLUMN IF NOT EXISTS pid text`;
    })();
  }
  return ready;
}

module.exports = async (req, res) => {
  if (!CONN) return res.status(500).json({ ok: false, error: 'Database not configured' });
  try {
    await ensure();
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String(body.id || '').slice(0, 64);
    const pid = String(body.pid || '').slice(0, 80) || id; // person id (falls back to connection id)
    const action = body.action || 'find';
    if (!id) return res.status(400).json({ ok: false, error: 'missing id' });

    if (action === 'leave') {
      await sql`DELETE FROM pvp_queue WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    // action === 'find': atomically claim the oldest waiting opponent who ISN'T me (different
    // connection AND different person), ignoring stale >60s rows; else enqueue and wait.
    const claimed = await sql`
      DELETE FROM pvp_queue
      WHERE id = (
        SELECT id FROM pvp_queue
        WHERE id <> ${id} AND (pid IS NULL OR pid <> ${pid}) AND created_at > now() - interval '60 seconds'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;

    if (claimed.length) {
      const oppId = claimed[0].id;
      // Make sure I'm not also sitting in the queue from a previous attempt.
      await sql`DELETE FROM pvp_queue WHERE id = ${id}`;
      const matchId = crypto.randomUUID();
      const seed = (crypto.randomBytes(4).readUInt32BE(0)) >>> 0;
      const role = Math.random() < 0.5 ? 'pitcher' : 'batter'; // my role; opponent gets the other
      return res.status(200).json({ ok: true, matched: true, matchId, seed, role, oppId });
    }

    // Sweep stale rows, then enqueue myself (upsert refreshes my timestamp).
    await sql`DELETE FROM pvp_queue WHERE created_at < now() - interval '60 seconds'`;
    await sql`INSERT INTO pvp_queue (id, pid, created_at) VALUES (${id}, ${pid}, now())
      ON CONFLICT (id) DO UPDATE SET created_at = now(), pid = ${pid}`;
    return res.status(200).json({ ok: true, matched: false, waiting: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
