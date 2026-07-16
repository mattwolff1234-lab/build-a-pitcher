// Live "who's online" counter for the 1v1 pages (Vercel serverless + Neon).
// Replaces the old Ably-presence ticker — presence fan-out to every viewer was ~90% of the Ably
// bill. Each viewer POSTs a heartbeat every ~45s and the SAME response returns the current counts,
// so one lightweight call does both "I'm here" and "how many are here". Cost is linear (M requests),
// not quadratic like presence (M^2), and it's plain DB queries — zero Ably.
//   POST /api/live { id, game, status }   -> upsert heartbeat, sweep stale, return {online,searching,playing}
//   POST /api/live { id, action:'leave' } -> remove immediately (sendBeacon on pagehide)
// A row counts as live if it checked in within the last 75s.

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
const gameOf = g => (g === 'hoops' || g === 'versus-soccer') ? g : 'versus';   // baseball 1v1 = 'versus'
const statusOf = s => (s === 'searching' || s === 'playing') ? s : 'idle';

let ready;
function ensure() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS live_presence (
        id text PRIMARY KEY,
        game text NOT NULL DEFAULT 'versus',
        status text NOT NULL DEFAULT 'idle',
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_live_game_seen ON live_presence (game, updated_at)`;
    })().catch(e => { ready = null; throw e; });   // don't cache a transient failure forever
  }
  return ready;
}

async function counts(game) {
  const [r] = await sql`SELECT
      count(*)::int AS online,
      count(*) FILTER (WHERE status = 'searching')::int AS searching,
      count(*) FILTER (WHERE status = 'playing')::int AS playing
    FROM live_presence WHERE game = ${game} AND updated_at > now() - interval '75 seconds'`;
  return { online: Number(r.online), searching: Number(r.searching), playing: Number(r.playing) };
}

const cors = require('./cors.js');
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  // A live-counter hiccup must never break the page — always answer 200 with a usable shape.
  if (!CONN) return res.status(200).json({ ok: false, online: 0, searching: 0, playing: 0 });
  try {
    await ensure();
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String((body && body.id) || '').slice(0, 80);
    const game = gameOf(body && body.game);

    if (body && body.action === 'leave') {
      if (id) await sql`DELETE FROM live_presence WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }
    if (!id) return res.status(200).json({ ok: true, ...(await counts(game)) });

    const status = statusOf(body && body.status);
    await sql`INSERT INTO live_presence (id, game, status, updated_at)
      VALUES (${id}, ${game}, ${status}, now())
      ON CONFLICT (id) DO UPDATE SET game = ${game}, status = ${status}, updated_at = now()`;
    await sql`DELETE FROM live_presence WHERE updated_at < now() - interval '75 seconds'`;   // sweep stale
    return res.status(200).json({ ok: true, ...(await counts(game)) });
  } catch (e) {
    return res.status(200).json({ ok: false, online: 0, searching: 0, playing: 0, error: String((e && e.message) || e) });
  }
};
