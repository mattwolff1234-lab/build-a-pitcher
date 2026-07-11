// Streak-reminder push (Vercel cron, see vercel.json - daily in the UTC evening).
// Finds devices whose player did YESTERDAY's daily challenge (UTC day, same basis as
// the daily leaderboard) but hasn't done TODAY's, and nudges them once.
// Idempotent by design: last_reminded is stamped per device, so extra calls (or an
// unauthenticated drive-by) can never double-ping anyone. No-ops without APNS_* env.
const { neon } = require('@neondatabase/serverless');
const { sendPush } = require('../apns.js');

function connStr() {
  for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_PRISMA_URL']) {
    if (process.env[k]) return process.env[k];
  }
  for (const k of Object.keys(process.env)) {
    if (/(_|^)(DATABASE|POSTGRES)_URL/.test(k) && /^postgres/.test(process.env[k])) return process.env[k];
  }
  return null;
}

module.exports = async (req, res) => {
  const url = connStr();
  if (!url) return res.status(500).json({ ok: false, error: 'no database' });
  const sql = neon(url);
  try {
    const rows = await sql`
      SELECT pt.token FROM push_tokens pt
      WHERE (pt.last_reminded IS NULL OR pt.last_reminded < (now() AT TIME ZONE 'utc')::date)
        AND EXISTS (SELECT 1 FROM daily_scores d WHERE d.player_key = pt.player_key
                    AND d.challenge_date::date = (now() AT TIME ZONE 'utc')::date - 1)
        AND NOT EXISTS (SELECT 1 FROM daily_scores d2 WHERE d2.player_key = pt.player_key
                    AND d2.challenge_date::date = (now() AT TIME ZONE 'utc')::date)`;
    const tokens = rows.map(r => r.token);
    if (!tokens.length) return res.status(200).json({ ok: true, sent: 0, candidates: 0 });
    // Stamp BEFORE sending - a crash mid-send must not allow a re-run to double-ping.
    await sql`UPDATE push_tokens SET last_reminded = (now() AT TIME ZONE 'utc')::date WHERE token = ANY(${tokens})`;
    const r = await sendPush(tokens, {
      title: 'Your streak is on the line 🔥',
      body: "Today's daily challenge is still open. Keep it alive!",
      data: { url: '/' },
    });
    if (r.dead.length) await sql`DELETE FROM push_tokens WHERE token = ANY(${r.dead})`;
    return res.status(200).json({ ok: true, candidates: tokens.length, sent: r.sent, failed: r.failed, pruned: r.dead.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 200) });
  }
};
