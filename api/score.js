// Leaderboard API (Vercel serverless function, talks to Neon Postgres).
//   GET  /api/score?scope=global|daily&limit=200&game=pitcher|batter&me=<id>
//   POST /api/score  { name, ovr, build, game }
// One table, separated by `game` so pitching and batting have their own boards.

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
// Slur/profanity gate for user-chosen names. New submissions are rejected outright;
// rows that predate the filter are censored on the way OUT (leaderboards) or dropped
// (action=names, which feeds franchise mode's free agents/rivals on every client).
const NameFilter = require('../namefilter.js');
const BAD_NAME_MSG = "That name isn't allowed — pick a different one.";

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
const gameOf = g => (g === 'batter' || g === 'baller' || g === 'striker' || g === 'keeper' || g === 'cfb' || g === 'hockey' || g === 'mon' || g === 'goatsquad' || g === 'squadball' || g === 'squadfoot') ? g : 'pitcher';
// Per-player key for daily dedup: signed-in account, else device guest id. Trust-the-client, same
// posture as the rest of the leaderboard · the UNIQUE constraint is what enforces one attempt/day.
const playerKey = b => (b && b.sub ? 'acct:' + String(b.sub).slice(0, 80) : (b && b.guestId ? 'guest:' + String(b.guestId).slice(0, 80) : null));
// The daily resets at each player's LOCAL midnight, so the browser sends its own date (YYYY-MM-DD).
// We validate it and fall back to the server's CURRENT_DATE (UTC) when absent/malformed.
const dailyDate = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// --- Server-side build validation ---------------------------------------------------------
// Moved to ../build-check.js (now SHARED with api/account.js's pvpLock): slot caps, weighted-
// OVR recompute, legend-count limits, plus the new CARD-TRUTH layer — every verifiable slot
// must name a real player from the baked data and stay within that player's best legit version
// (+ power-up headroom). The data JSONs it requires are bundled into this lambda exactly like
// the old inline legendSet's requires were.
const { checkBuild } = require('../build-check.js');
const Catalog = require('../catalog.js');   // EARN.daily — the Goat Coins daily payout
// Career-total sanity caps · above these is impossible under the tuned sim, so an over-cap
// career is either a stale pre-fix client or a doctored payload. We KEEP the score (ovr is
// validated separately) and just strip the career object, so the entry stays on the OVR board
// but can't pollute the career-stat sorts. Re-based 2026-07-11 on the soft-capped sims'
// verified maxima + ~5% margin (Node harness, 2000 seeds on maximal hot-boosted builds:
// pitcher K 6794 IP 4401 W 370 · batter HR 808 H 4037 RBI 3395 R 2182 SB 690).
const CAREER_MAX = {
  batter: { hr: 850, h: 4250, rbi: 3600, r: 2300, sb: 730 },
  pitcher: { k: 7500, ip: 4650, wins: 390 },
  cfb: { yds: 17000, td: 170 },
  // Verified sim maxima (Node harness, 400 maxed hot-boosted all-105 builds: g 1009 · p 2262) + ~5%.
  hockey: { g: 1060, p: 2380 },
  // Verified sim maxima (500 all-130 abuse builds, above any legit draft: w 1339) + margin.
  mon: { w: 1410, sweeps: 520, badges: 185 },   // badges hard bound: 8/season * 22-season ceiling
};
function stripInsaneCareer(game, build) {
  const caps = CAREER_MAX[game];
  const t = build && build.career && build.career.totals;
  if (!caps || !t || typeof t !== 'object') return build;
  for (const k of Object.keys(caps)) {
    if (Number(t[k]) > caps[k]) { const b = { ...build }; delete b.career; return b; }
  }
  return build;
}

// Token for admin/maintenance actions (same env + fallback as account.js's pvpMatchStats).
const ADMIN_TOKEN = process.env.STATS_TOKEN || 'pl-balance-7f3a9c21';

// Whitelisted career-stat sort keys → build.career.totals fields (shared by the board GET,
// myRanks, and the me-pin). Trust-the-client values, same posture as ovr.
const SORT_FIELDS = { k: 'k', war: 'war', wins: 'wins', rings: 'rings', cyYoung: 'cyYoung', hr: 'hr', hits: 'h', mvp: 'mvp', pts: 'pts', reb: 'reb', ast: 'ast', goals: 'goals', assists: 'assists', cs: 'cs', saves: 'saves', yds: 'yds', td: 'td', heisman: 'heisman', natty: 'natty', g: 'g', p: 'p', w: 'w', sweeps: 'sweeps', badges: 'badges' };
// Which of those sorts each game's boards actually offer (mirror of the clients' SORT_OPTIONS
// minus OVR) — bounds myRanks to the handful of count queries that matter for that game.
const GAME_SORTS = {
  pitcher: ['k', 'war', 'wins', 'rings', 'cyYoung'],
  batter: ['hr', 'hits', 'war', 'rings', 'mvp'],
  baller: ['pts', 'reb', 'ast', 'war', 'rings', 'mvp'],
  striker: ['goals', 'assists', 'war', 'rings', 'mvp'],
  keeper: ['cs', 'saves', 'war', 'rings', 'mvp'],
  hockey: ['g', 'p', 'war', 'rings', 'mvp'],
  mon: ['w', 'badges', 'war', 'rings', 'mvp'],
  cfb: ['yds', 'td', 'wins', 'heisman', 'natty'],
  goatsquad: ['w'], squadball: ['w'], squadfoot: ['w'],
};

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
      // Per-row removal secret, returned once to the submitter — proof of ownership for
      // action=remove. Rows that predate the column stay permanent (NULL never matches).
      await sql`ALTER TABLE scores ADD COLUMN IF NOT EXISTS del_token text`;
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
    })().catch(e => { ready = null; throw e; });   // don't cache a transient failure forever
  }
  return ready;
}

const cors = require('./cors.js');
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (!CONN) return res.status(500).json({ ok: false, error: 'Database not configured' });
  try {
    await ensure();

    // GET ?action=build&id=<scoreId> · one submitted build, career included (powers /p/<id> share links).
    if (req.method !== 'POST' && (req.query && req.query.action) === 'build') {
      const id = parseInt(req.query && req.query.id, 10);
      if (!id || id < 1) return res.status(400).json({ ok: false, error: 'Bad id' });
      const [row] = await sql`SELECT id, name, ovr, game, build, created_at FROM scores WHERE id = ${id}`;
      if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');   // rows are immutable
      return res.status(200).json({ ok: true, entry: { ...row, id: Number(row.id), name: NameFilter.clean(row.name, 'Anonymous') } });
    }

    // GET ?action=myRanks&id=<scoreId> · every rank this ONE entry holds, in a single call:
    // all-time OVR rank + board size, today's OVR rank (if posted today), and its rank on each
    // career-stat sort that game's boards offer. Powers the post-career "where you landed" panel.
    if (req.method !== 'POST' && (req.query && req.query.action) === 'myRanks') {
      const id = parseInt(req.query && req.query.id, 10);
      if (!id || id < 1) return res.status(400).json({ ok: false, error: 'Bad id' });
      const [row] = await sql`SELECT id, ovr, game, build, created_at FROM scores WHERE id = ${id}`;
      if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
      const g = row.game;
      const [{ ahead }] = await sql`SELECT count(*)::int AS ahead FROM scores
        WHERE game = ${g} AND (ovr > ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`;
      const [{ total }] = await sql`SELECT count(*)::int AS total FROM scores WHERE game = ${g}`;
      let today = null;
      const onToday = (await sql`SELECT 1 FROM scores WHERE id = ${id} AND created_at >= date_trunc('day', now())`).length > 0;
      if (onToday) {
        const [{ ahead: ta }] = await sql`SELECT count(*)::int AS ahead FROM scores
          WHERE game = ${g} AND created_at >= date_trunc('day', now())
            AND (ovr > ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`;
        const [{ total: tt }] = await sql`SELECT count(*)::int AS total FROM scores
          WHERE game = ${g} AND created_at >= date_trunc('day', now())`;
        today = { rank: Number(ta) + 1, total: Number(tt) };
      }
      // Same better-than counting the me-pin uses (stat desc, created_at tie-break; null stats
      // can never rank ahead because NULL > v is false).
      const totals = (row.build && row.build.career && row.build.career.totals) || {};
      const stats = {};
      for (const key of (GAME_SORTS[g] || [])) {
        const field = SORT_FIELDS[key];
        const v = Number(totals[field]);
        if (!isFinite(v)) continue;
        const [{ ahead: sa }] = await sql`SELECT count(*)::int AS ahead FROM scores
          WHERE game = ${g} AND ((build->'career'->'totals'->>${field})::numeric > ${v}
            OR ((build->'career'->'totals'->>${field})::numeric = ${v} AND created_at < ${row.created_at}))`;
        stats[key] = { value: v, rank: Number(sa) + 1 };
      }
      return res.status(200).json({ ok: true, game: g, ovr: Number(row.ovr), rank: Number(ahead) + 1, total: Number(total), today, stats });
    }

    // GET ?action=ghost&game=&min=&max= · a random recent build in an OVR band, slots only (no
    // career), for the 1v1 "Ghost" opponent when a lobby is empty. Public read like action=build.
    if (req.method !== 'POST' && (req.query && req.query.action) === 'ghost') {
      const game = gameOf(req.query && req.query.game);
      const min = Math.max(1, Math.min(150, Math.round(Number(req.query && req.query.min) || 87)));
      const max = Math.max(min, Math.min(150, Math.round(Number(req.query && req.query.max) || 95)));
      const rows = await sql`
        SELECT id, name, ovr, jsonb_build_object('slots', build->'slots') AS build
        FROM scores
        WHERE game = ${game} AND ovr BETWEEN ${min} AND ${max}
          AND jsonb_typeof(build->'slots') = 'array'
        ORDER BY created_at DESC LIMIT 150`;
      if (!rows.length) return res.status(200).json({ ok: true, ghost: null });
      const g = rows[Math.floor(Math.random() * rows.length)];
      return res.status(200).json({ ok: true, ghost: { ...g, id: Number(g.id), name: NameFilter.clean(g.name, 'Anonymous') } });
    }

    // GET ?action=names&game=&min=&max=&limit= · a random sample of real submitted builds
    // (name + ovr only) inside an OVR band. Powers franchise mode's free agents, draft
    // prospects, and rival rosters, so the whole league is actual made guys. Public read;
    // the CDN caches one sample briefly (clients pick from it with their own seeds).
    if (req.method !== 'POST' && (req.query && req.query.action) === 'names') {
      const game = gameOf(req.query && req.query.game);
      const min = Math.max(1, Math.min(150, Math.round(Number(req.query && req.query.min) || 55)));
      const max = Math.max(min, Math.min(150, Math.round(Number(req.query && req.query.max) || 99)));
      const limit = Math.max(1, Math.min(150, parseInt(req.query && req.query.limit, 10) || 60));
      const rows = await sql`
        SELECT name, ovr FROM (
          SELECT DISTINCT ON (lower(name)) name, ovr FROM scores
          WHERE game = ${game} AND ovr BETWEEN ${min} AND ${max}
            AND length(name) BETWEEN 2 AND 26 AND lower(name) <> 'anonymous'
          ORDER BY lower(name), created_at DESC
        ) t ORDER BY random() LIMIT ${limit}`;
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
      return res.status(200).json({ ok: true,
        rows: rows.filter(r => NameFilter.isClean(r.name)).map(r => ({ name: r.name, ovr: Number(r.ovr) })) });
    }

    // GET ?action=stats[&game=pitcher|batter|all] · total builds, GOAT (99 OVR) count, + live play counter.
    if (req.method !== 'POST' && (req.query && req.query.action) === 'stats') {
      const g = req.query && req.query.game;
      const [{ total, goat }] = (g === 'all')
        ? await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE ovr >= 99)::int AS goat FROM scores`
        : await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE ovr >= 99)::int AS goat FROM scores WHERE game = ${gameOf(g)}`;
      const [{ n: plays }] = await sql`SELECT n FROM counters WHERE key = 'plays'`;
      const t = Number(total), gt = Number(goat);
      return res.status(200).json({ ok: true, total: t, goat: gt, pct: t > 0 ? (gt / t) * 100 : 0, plays: Number(plays) });
    }

    // GET ?action=challengeLeaderboard · today's daily board + how many have played today.
    if (req.method !== 'POST' && (req.query && req.query.action) === 'challengeLeaderboard') {
      const game = gameOf(req.query && req.query.game);
      const limit = Math.max(1, Math.min(200, parseInt(req.query && req.query.limit, 10) || 50));
      const cd = dailyDate(req.query && req.query.date);
      const rows = await sql`SELECT name, ovr FROM daily_scores
        WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE) ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`;
      const [{ total }] = await sql`SELECT count(*)::int AS total FROM daily_scores WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE)`;
      return res.status(200).json({ ok: true, rows: rows.map(r => ({ ...r, name: NameFilter.clean(r.name, 'Anonymous') })), total: Number(total) });
    }

    // GET ?action=dailyDates&sub=<sub>|&guestId=<id> · the player's daily-play dates (streak calendar)
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

    // redactCareers/redactHotCareers also answer GET (?action=…&token=…) so they can be
    // triggered from environments that can only issue GETs. Token-gated either way; a GET
    // never carries apply/dryRun=0, so a stray crawl can never mutate anything.
    if (req.method !== 'POST' && ['redactCareers', 'redactHotCareers'].includes((req.query && req.query.action) || '')) {
      req.method = 'POST';
      req.body = { ...req.query, dryRun: req.query.dryRun == null ? '1' : req.query.dryRun, apply: 0 };
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      // Play counter: fired once per game session (first spin). Increments the live "plays" headline.
      if (body.action === 'play' || (req.query && req.query.action === 'play')) {
        const [{ n }] = await sql`INSERT INTO counters (key, n) VALUES ('plays', 1)
          ON CONFLICT (key) DO UPDATE SET n = counters.n + 1 RETURNING n`;
        return res.status(200).json({ ok: true, plays: Number(n) });
      }

      // Take yourself off the board. The POST that created the row returned its del_token —
      // only the device that submitted (and stored the token) can remove it. Old rows with a
      // NULL token are not removable (NULL never matches).
      if (body.action === 'remove') {
        const id = parseInt(body.id, 10);
        const token = String(body.token || '');
        if (!id || id < 1 || !/^[a-f0-9]{16,64}$/.test(token)) return res.status(400).json({ ok: false, error: 'Bad request' });
        const gone = await sql`DELETE FROM scores WHERE id = ${id} AND del_token = ${token} RETURNING id`;
        if (!gone.length) return res.status(404).json({ ok: false, error: 'Entry not found (or not yours to remove)' });
        return res.status(200).json({ ok: true, removed: true });
      }

      // Admin (token-gated): strip the stored `career` from leaderboard rows whose build has a
      // slot over a threshold, inside a time window. One-time cleanup for the 2026-07-10
      // inflated-HR sim bug: only builds with a Power slot > 99 hit the bad `superPow` path, so
      // that's the exact affected population. Redacted rows keep their name/OVR/slots (the OVR
      // board is untouched) but drop off the career-stat sorts (NULLS LAST) and lose the career
      // line on share pages. Pass dryRun:true to preview. Example:
      //   curl -X POST .../api/score -H 'content-type: application/json' -d '{"action":"redactCareers",
      //     "token":"<STATS_TOKEN>","game":"batter","slot":"Power","over":99,
      //     "since":"2026-07-10T05:37:00Z","dryRun":true}'
      if (body.action === 'redactCareers') {
        if (String(body.token || '') !== ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'Bad token' });
        const game = gameOf(body.game);
        const slot = String(body.slot || 'Power').slice(0, 30);
        const over = Number.isFinite(Number(body.over)) ? Number(body.over) : 99;
        const ts = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
        const since = ts(body.since) || '2026-07-10T05:37:00Z';   // the bad deploy went out 2026-07-10 ~05:37 UTC
        const until = ts(body.until) || new Date().toISOString();
        if (body.dryRun && body.dryRun !== 'false' && body.dryRun !== '0') {
          const rows = await sql`
            SELECT id, name, ovr, created_at, build->'career'->'totals' AS totals FROM scores
            WHERE game = ${game} AND created_at >= ${since} AND created_at < ${until}
              AND build->'career' IS NOT NULL AND jsonb_typeof(build->'slots') = 'array'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(build->'slots') e
                          WHERE e->>'slot' = ${slot} AND (e->>'value')::numeric > ${over})
            ORDER BY created_at`;
          return res.status(200).json({ ok: true, dryRun: true, count: rows.length,
            rows: rows.map(r => ({ id: Number(r.id), name: r.name, ovr: r.ovr, created_at: r.created_at, totals: r.totals })) });
        }
        const rows = await sql`
          UPDATE scores SET build = build - 'career'
          WHERE game = ${game} AND created_at >= ${since} AND created_at < ${until}
            AND build->'career' IS NOT NULL AND jsonb_typeof(build->'slots') = 'array'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(build->'slots') e
                        WHERE e->>'slot' = ${slot} AND (e->>'value')::numeric > ${over})
          RETURNING id`;
        return res.status(200).json({ ok: true, redacted: rows.length, ids: rows.map(r => Number(r.id)) });
      }

      // Admin (token-gated): like redactCareers, but matches ANY slot over the threshold —
      // the 2026-07-09 Last Night's Studs boost pushes EVERY attribute past 99, and pitcher
      // careers simmed before the 2026-07-11 over-99 soft-cap are inflated/irreproducible.
      // Dry-run by default; ONLY {"apply":1} writes. Window defaults to the hot-feature ship
      // (2026-07-09T07:00Z) → now; pass "until" (the soft-cap deploy time) if run after deploy,
      // because post-fix over-99 careers are legit and must not be stripped. Example:
      //   curl -X POST .../api/score -H 'content-type: application/json' -d '{"action":"redactHotCareers",
      //     "token":"<STATS_TOKEN>","game":"pitcher","apply":1}'
      if (body.action === 'redactHotCareers') {
        if (String(body.token || '') !== ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'Bad token' });
        const game = gameOf(body.game || 'pitcher');
        const over = Number.isFinite(Number(body.over)) ? Number(body.over) : 99;
        const ts = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
        const since = ts(body.since) || '2026-07-09T07:00:00Z';   // Last Night's Studs shipped 2026-07-09 ~07:00 UTC
        const until = ts(body.until) || new Date().toISOString();
        const apply = body.apply === 1 || body.apply === '1' || body.apply === true;
        if (!apply) {
          const rows = await sql`
            SELECT id, name, ovr, created_at, build->'career'->'totals' AS totals FROM scores
            WHERE game = ${game} AND created_at >= ${since} AND created_at < ${until}
              AND build->'career' IS NOT NULL AND jsonb_typeof(build->'slots') = 'array'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(build->'slots') e
                          WHERE (e->>'value') ~ '^[0-9.]+$' AND (e->>'value')::numeric > ${over})
            ORDER BY created_at`;
          return res.status(200).json({ ok: true, dryRun: true, game, since, until, count: rows.length,
            rows: rows.map(r => ({ id: Number(r.id), name: r.name, ovr: r.ovr, created_at: r.created_at, totals: r.totals })) });
        }
        const rows = await sql`
          UPDATE scores SET build = build - 'career'
          WHERE game = ${game} AND created_at >= ${since} AND created_at < ${until}
            AND build->'career' IS NOT NULL AND jsonb_typeof(build->'slots') = 'array'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(build->'slots') e
                        WHERE (e->>'value') ~ '^[0-9.]+$' AND (e->>'value')::numeric > ${over})
          RETURNING id`;
        return res.status(200).json({ ok: true, redacted: rows.length, ids: rows.map(r => Number(r.id)) });
      }

      // Admin (token-gated): one-time XP compensation. Grants `amount` XP (default 250) to every
      // signed-in account holding an affected save (same criterion as redactHotCareers: any slot
      // over the threshold, in the window). Lives here rather than account.js only because this
      // file owns the other admin actions; it writes the same users table. users.xp is monotonic
      // (clients keep max(local, stored)), so a server-side add follows the account everywhere.
      // A dedup row per (grantKey, user) makes re-runs safe - each account is paid ONCE per key.
      // Dry-run by default; ONLY {"apply":1} writes. Example:
      //   curl -X POST .../api/score -H 'content-type: application/json' -d '{"action":"grantXp",
      //     "token":"<STATS_TOKEN>","game":"pitcher","grantKey":"hot-sim-comp-2026-07","apply":1}'
      if (body.action === 'grantXp') {
        if (String(body.token || '') !== ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'Bad token' });
        const game = gameOf(body.game || 'pitcher');
        const over = Number.isFinite(Number(body.over)) ? Number(body.over) : 99;
        const amount = Math.max(1, Math.min(1000, Math.round(Number(body.amount) || 250)));
        const grantKey = String(body.grantKey || 'hot-sim-comp-2026-07').slice(0, 60);
        const ts = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
        const since = ts(body.since) || '2026-07-09T07:00:00Z';
        const until = ts(body.until) || new Date().toISOString();
        const apply = body.apply === 1 || body.apply === '1' || body.apply === true;
        const affected = await sql`
          SELECT DISTINCT google_sub FROM saves
          WHERE game = ${game} AND created_at >= ${since} AND created_at < ${until}
            AND jsonb_typeof(build->'slots') = 'array'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(build->'slots') e
                        WHERE (e->>'value') ~ '^[0-9.]+$' AND (e->>'value')::numeric > ${over})`;
        const subs = affected.map(r => r.google_sub);
        if (!apply) {
          return res.status(200).json({ ok: true, dryRun: true, game, since, until, amount, grantKey, users: subs.length, subs });
        }
        await sql`CREATE TABLE IF NOT EXISTS xp_grants (
          grant_key text NOT NULL, google_sub text NOT NULL, amount int NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (grant_key, google_sub))`;
        let granted = 0;
        for (const sub of subs) {
          const ins = await sql`INSERT INTO xp_grants (grant_key, google_sub, amount) VALUES (${grantKey}, ${sub}, ${amount})
            ON CONFLICT (grant_key, google_sub) DO NOTHING RETURNING google_sub`;
          if (!ins.length) continue;   // already compensated under this key
          await sql`UPDATE users SET xp = COALESCE(xp, 0) + ${amount} WHERE google_sub = ${sub}`;
          granted++;
        }
        return res.status(200).json({ ok: true, granted, alreadyGranted: subs.length - granted, amount, grantKey });
      }

      // Daily Challenge submission · one row per player per day; returns today's rank + field size.
      if (body.action === 'challengeSubmit') {
        const key = playerKey(body);
        if (!key) return res.status(400).json({ ok: false, error: 'No player key' });
        const game = gameOf(body.game);
        // Rotation guard: pitcher/batter and striker/keeper each alternate ONE daily per date
        // (same parity formula as the clients); hoops runs daily. The clients redirect on
        // off-days, so only stale pages and direct POSTs land here · reject them.
        const rd = dailyDate(body.date);
        if (rd && (game === 'pitcher' || game === 'batter' || game === 'striker' || game === 'keeper')) {
          const odd = Math.floor(Date.parse(rd + 'T00:00:00Z') / 86400000) % 2 === 1;
          const host = (game === 'pitcher' || game === 'batter') ? (odd ? 'pitcher' : 'batter') : (odd ? 'striker' : 'keeper');
          if (game !== host) return res.status(400).json({ ok: false, error: `Today's daily is ${host} · this one runs tomorrow` });
        }
        const chk = checkBuild(game, body.ovr, body.build);
        if (!chk.ok) return res.status(400).json({ ok: false, error: 'Invalid build' });
        const ovr = chk.ovr;
        const cname = String(body.name == null ? '' : body.name).trim().slice(0, 40) || 'Anonymous';
        if (!NameFilter.isClean(cname)) return res.status(400).json({ ok: false, error: BAD_NAME_MSG });
        const cbuild = body.build && typeof body.build === 'object' ? JSON.stringify(stripInsaneCareer(game, body.build)) : null;
        const cd = dailyDate(body.date);
        const ins = await sql`INSERT INTO daily_scores (player_key, game, name, ovr, build, challenge_date)
          VALUES (${key}, ${game}, ${cname}, ${ovr}, ${cbuild}::jsonb, COALESCE(${cd}::date, CURRENT_DATE))
          ON CONFLICT (player_key, game, challenge_date) DO NOTHING RETURNING id`;
        // Goat Coins: a validated daily submission pays out once per game per day — signed-in
        // accounts only, first attempt only (the UNIQUE is the dedupe; the ledger ref makes the
        // grant idempotent on top). Never allowed to block the submission itself.
        const inserted = ins.length > 0;
        // Already played today (duplicate) → report the STORED row's standing, not this fresh
        // attempt's OVR, so a re-submit after a dropped response shows the real rank.
        let effOvr = ovr;
        if (!inserted) {
          const [ex] = await sql`SELECT ovr FROM daily_scores
            WHERE player_key = ${key} AND game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE)`;
          if (ex) effOvr = Number(ex.ovr);
        }
        let coins = null;
        if (inserted && key.indexOf('acct:') === 0) {
          try {
            const sub = key.slice(5);
            const ref = `daily:${cd || new Date().toISOString().slice(0, 10)}:${game}:${sub}`;
            const led = await sql`INSERT INTO coin_ledger (player_key, delta, reason, ref)
              VALUES (${sub}, ${Catalog.EARN.daily}, 'daily', ${ref}) ON CONFLICT (ref) DO NOTHING RETURNING id`;
            if (led.length) {
              const [cu] = await sql`UPDATE users SET coins = GREATEST(0, COALESCE(coins, 0) + ${Catalog.EARN.daily})
                WHERE google_sub = ${sub} RETURNING coins`;
              if (cu) coins = { granted: Catalog.EARN.daily, coins: Number(cu.coins) };
            }
          } catch (e) {}
        }
        const [{ rank }] = await sql`SELECT count(*)::int + 1 AS rank FROM daily_scores
          WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE) AND ovr > ${effOvr}`;
        const [{ total }] = await sql`SELECT count(*)::int AS total FROM daily_scores
          WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE)`;
        return res.status(200).json({ ok: true, rank: Number(rank), total: Number(total), coins, recorded: true, dup: !inserted });
      }

      let name = String(body.name == null ? '' : body.name).trim().slice(0, 20);
      if (!name) name = 'Anonymous';
      if (!NameFilter.isClean(name)) return res.status(400).json({ ok: false, error: BAD_NAME_MSG });
      const game = gameOf(body.game);
      const chk = checkBuild(game, body.ovr, body.build);
      if (!chk.ok) return res.status(400).json({ ok: false, error: 'Invalid build - ratings exceed what any real card can have' });
      const ovr = chk.ovr;
      // Equipped cosmetics ride along for display only (trust-the-client, id-shape whitelisted):
      // build.style = { av, fx } → leaderboards render the avatar chip + name effect.
      if (body.build && typeof body.build === 'object' && body.style && typeof body.style === 'object') {
        const style = {};
        if (/^av_[a-z0-9_]{1,30}$/.test(String(body.style.av || ''))) style.av = String(body.style.av);
        if (/^fx_[a-z0-9_]{1,30}$/.test(String(body.style.fx || ''))) style.fx = String(body.style.fx);
        if (Object.keys(style).length) body.build.style = style;
      }
      const build = body.build && typeof body.build === 'object' ? JSON.stringify(stripInsaneCareer(game, body.build)) : null;

      const delToken = crypto.randomBytes(16).toString('hex');
      const [row] = await sql`
        INSERT INTO scores (name, ovr, build, game, del_token) VALUES (${name}, ${ovr}, ${build}::jsonb, ${game}, ${delToken})
        RETURNING id, name, ovr, created_at`;
      const [{ ahead }] = await sql`
        SELECT count(*)::int AS ahead FROM scores
        WHERE game = ${game} AND (ovr > ${ovr} OR (ovr = ${ovr} AND created_at < ${row.created_at}))`;
      return res.status(200).json({ ok: true, id: Number(row.id), globalRank: ahead + 1, token: delToken });
    }

    const scope = (req.query && req.query.scope) || 'global';
    const limit = Math.min(200, Math.max(1, parseInt(req.query && req.query.limit, 10) || 50));
    const daily = scope === 'daily';
    const game = gameOf(req.query && req.query.game);
    // Optional CFB position filter (?pos=qb|rb|wr) · cfb builds store pos as 'QB'/'RB'/'WR'
    const posRaw = req.query && req.query.pos ? String(req.query.pos).toUpperCase() : null;
    const pos = game === 'cfb' && ['QB', 'RB', 'WR'].indexOf(posRaw) >= 0 ? posRaw : null;
    // Optional sort by a career-total stat (SORT_FIELDS whitelist at module scope).
    const sortField = SORT_FIELDS[req.query && req.query.sort] || null;
    const asc = (req.query && req.query.dir) === 'asc';       // flip any stat sort to worst-first
    const worst = (req.query && req.query.sort) === 'ovrAsc'; // ascending OVR ("worst overall")
    const NULL_SENTINEL = -1e30; // ranks missing-career entries last under a stat sort

    // scope=yesterday → the finished day's board (the ranks page crowns row 1 as
    // Yesterday's Champion). OVR-sorted only, no me-pin.
    if (scope === 'yesterday') {
      const yrows = await sql`SELECT id, name, ovr,
          CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots', 'pos', build->>'pos', 'style', build->'style') ELSE build END AS build,
          game, created_at FROM scores
          WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos})
            AND created_at >= date_trunc('day', now()) - interval '1 day' AND created_at < date_trunc('day', now())
          ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`;
      return res.status(200).json({ ok: true, sort: null,
        rows: yrows.map(r => ({ ...r, id: Number(r.id), name: NameFilter.clean(r.name, 'Anonymous') })), me: null });
    }

    let rows;
    if (worst) {
      rows = daily
        ? await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots', 'pos', build->>'pos', 'style', build->'style') ELSE build END AS build,
              game, created_at FROM scores
              WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND created_at >= date_trunc('day', now())
              ORDER BY ovr ASC, created_at ASC LIMIT ${limit}`
        : await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots', 'pos', build->>'pos', 'style', build->'style') ELSE build END AS build,
              game, created_at FROM scores
              WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos})
              ORDER BY ovr ASC, created_at ASC LIMIT ${limit}`;
    } else if (sortField && asc) {
      // worst-first stat sort (dir=asc); NULLS LAST still ranks missing-career entries at the end
      rows = daily
        ? await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots', 'pos', build->>'pos', 'style', build->'style') ELSE build END AS build,
              game, created_at, (build->'career'->'totals'->>${sortField})::numeric AS stat FROM scores
              WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND created_at >= date_trunc('day', now())
              ORDER BY (build->'career'->'totals'->>${sortField})::numeric ASC NULLS LAST, ovr ASC, created_at ASC LIMIT ${limit}`
        : await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots', 'pos', build->>'pos', 'style', build->'style') ELSE build END AS build,
              game, created_at, (build->'career'->'totals'->>${sortField})::numeric AS stat FROM scores
              WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos})
              ORDER BY (build->'career'->'totals'->>${sortField})::numeric ASC NULLS LAST, ovr ASC, created_at ASC LIMIT ${limit}`;
    } else if (sortField) {
      rows = daily
        ? await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots', 'pos', build->>'pos', 'style', build->'style') ELSE build END AS build,
              game, created_at, (build->'career'->'totals'->>${sortField})::numeric AS stat FROM scores
              WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND created_at >= date_trunc('day', now())
              ORDER BY (build->'career'->'totals'->>${sortField})::numeric DESC NULLS LAST, ovr DESC, created_at ASC LIMIT ${limit}`
        : await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots', 'pos', build->>'pos', 'style', build->'style') ELSE build END AS build,
              game, created_at, (build->'career'->'totals'->>${sortField})::numeric AS stat FROM scores
              WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos})
              ORDER BY (build->'career'->'totals'->>${sortField})::numeric DESC NULLS LAST, ovr DESC, created_at ASC LIMIT ${limit}`;
    } else {
      rows = daily
        ? await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots', 'pos', build->>'pos', 'style', build->'style') ELSE build END AS build,
              game, created_at FROM scores
              WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND created_at >= date_trunc('day', now())
              ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`
        : await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots', 'pos', build->>'pos', 'style', build->'style') ELSE build END AS build,
              game, created_at FROM scores
              WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos})
              ORDER BY ovr DESC, created_at ASC LIMIT ${limit}`;
    }

    let me = null;
    const meId = req.query && req.query.me ? parseInt(req.query.me, 10) : null;
    if (meId) {
      const statField = sortField || 'war'; // value only used when sortField is set
      const [row] = await sql`SELECT id, name, ovr,
        CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots', 'pos', build->>'pos', 'style', build->'style') ELSE build END AS build,
        created_at, game, (build->'career'->'totals'->>${statField})::numeric AS stat FROM scores WHERE id = ${meId}`;
      if (row && row.game === game && (!pos || String((row.build && row.build.pos) || '').toUpperCase() === pos)) {
        let ahead;
        if (sortField && asc) {
          // worst-first stat sort (dir=asc): rank counts entries with a LOWER stat. Missing careers
          // sort LAST (ORDER BY ... ASC NULLS LAST), so treat a null stat as +BIG here too.
          const ASC_NULL = 1e30;
          const meVal = row.stat == null ? ASC_NULL : Number(row.stat);
          ahead = daily
            ? (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND created_at >= date_trunc('day', now())
                    AND (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${ASC_NULL}) < ${meVal}
                      OR (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${ASC_NULL}) = ${meVal} AND created_at < ${row.created_at}))`)[0].ahead
            : (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos})
                    AND (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${ASC_NULL}) < ${meVal}
                      OR (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${ASC_NULL}) = ${meVal} AND created_at < ${row.created_at}))`)[0].ahead;
        } else if (sortField) {
          const meVal = row.stat == null ? NULL_SENTINEL : Number(row.stat);
          ahead = daily
            ? (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND created_at >= date_trunc('day', now())
                    AND (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${NULL_SENTINEL}) > ${meVal}
                      OR (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${NULL_SENTINEL}) = ${meVal} AND created_at < ${row.created_at}))`)[0].ahead
            : (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos})
                    AND (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${NULL_SENTINEL}) > ${meVal}
                      OR (COALESCE((build->'career'->'totals'->>${sortField})::numeric, ${NULL_SENTINEL}) = ${meVal} AND created_at < ${row.created_at}))`)[0].ahead;
        } else if (worst) {
          ahead = daily
            ? (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${row.game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND created_at >= date_trunc('day', now())
                    AND (ovr < ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`)[0].ahead
            : (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${row.game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND (ovr < ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`)[0].ahead;
        } else {
          ahead = daily
            ? (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${row.game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND created_at >= date_trunc('day', now())
                    AND (ovr > ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`)[0].ahead
            : (await sql`SELECT count(*)::int AS ahead FROM scores
                  WHERE game = ${row.game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND (ovr > ${row.ovr} OR (ovr = ${row.ovr} AND created_at < ${row.created_at}))`)[0].ahead;
        }
        const inScope = daily
          ? (await sql`SELECT 1 FROM scores WHERE id = ${meId} AND created_at >= date_trunc('day', now())`).length > 0
          : true;
        if (inScope) me = { id: Number(row.id), rank: ahead + 1, name: NameFilter.clean(row.name, 'Anonymous'), ovr: row.ovr, build: row.build, game: row.game,
          stat: sortField && row.stat != null ? Number(row.stat) : null };
      }
    }
    // board size for the ranks-page banner ("N builds posted")
    const [{ total }] = daily
      ? await sql`SELECT count(*)::int AS total FROM scores WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos}) AND created_at >= date_trunc('day', now())`
      : await sql`SELECT count(*)::int AS total FROM scores WHERE game = ${game} AND (${pos}::text IS NULL OR build->>'pos' = ${pos})`;
    return res.status(200).json({ ok: true, sort: sortField, total: Number(total), rows: rows.map(r => ({ ...r, id: Number(r.id), name: NameFilter.clean(r.name, 'Anonymous'), stat: r.stat == null ? null : Number(r.stat) })), me });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
