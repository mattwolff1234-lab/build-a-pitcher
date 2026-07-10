// Live 1v1 matchmaking for the soccer Face Off — fully isolated from baseball's api/match.js and
// hoops' api/match-hoops.js. Own queue table (pvp_queue_soccer) so soccer players only pair with
// each other. Same atomic claim pattern (FOR UPDATE SKIP LOCKED). Reuses the same Neon DB + Ably
// key (no new creds). Roles are REAL here (like baseball's pitcher/batter): one side quick-builds
// a striker, the other a keeper, then a seeded penalty shootout plays on both screens.
//   POST /api/match-soccer { action:'find', id, pid } -> { matched, matchId, seed, role, oppId } | { waiting:true }
//   POST /api/match-soccer { action:'leave', id }     -> { ok:true }

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
      await sql`CREATE TABLE IF NOT EXISTS pvp_queue_soccer (
        id text PRIMARY KEY,
        pid text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      // Shared with baseball/hoops — records the two real participants of every match so
      // result-reporting can settle authoritatively.
      await sql`CREATE TABLE IF NOT EXISTS pvp_match_players (
        match_id text PRIMARY KEY,
        claimer_pid text,
        opp_pid text,
        claimer_role text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    })().catch(e => { ready = null; throw e; });   // don't cache a transient failure forever
  }
  return ready;
}

module.exports = async (req, res) => {
  if (!CONN) return res.status(500).json({ ok: false, error: 'Database not configured' });
  try {
    await ensure();
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String(body.id || '').slice(0, 64);
    const pid = String(body.pid || '').slice(0, 80) || id;
    const action = body.action || 'find';
    if (!id) return res.status(400).json({ ok: false, error: 'missing id' });

    if (action === 'leave') {
      await sql`DELETE FROM pvp_queue_soccer WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    const claimed = await sql`
      DELETE FROM pvp_queue_soccer
      WHERE id = (
        SELECT id FROM pvp_queue_soccer
        WHERE id <> ${id} AND (pid IS NULL OR pid <> ${pid}) AND created_at > now() - interval '60 seconds'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, pid`;

    if (claimed.length) {
      const oppId = claimed[0].id;
      const oppPid = claimed[0].pid || oppId;
      await sql`DELETE FROM pvp_queue_soccer WHERE id = ${id}`;
      const matchId = crypto.randomUUID();
      const seed = (crypto.randomBytes(4).readUInt32BE(0)) >>> 0;
      // the CLAIMER's role; the waiting opponent gets the other one
      const role = Math.random() < 0.5 ? 'striker' : 'keeper';
      try {
        await sql`INSERT INTO pvp_match_players (match_id, claimer_pid, opp_pid, claimer_role)
          VALUES (${matchId}, ${pid}, ${oppPid}, ${role})
          ON CONFLICT (match_id) DO NOTHING`;
      } catch (e) {}
      return res.status(200).json({ ok: true, matched: true, matchId, seed, role, oppId });
    }

    await sql`DELETE FROM pvp_queue_soccer WHERE created_at < now() - interval '60 seconds'`;
    await sql`INSERT INTO pvp_queue_soccer (id, pid, created_at) VALUES (${id}, ${pid}, now())
      ON CONFLICT (id) DO UPDATE SET created_at = now(), pid = ${pid}`;
    return res.status(200).json({ ok: true, matched: false, waiting: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
