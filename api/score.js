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
const gameOf = g => (g === 'batter' || g === 'baller' || g === 'striker' || g === 'keeper') ? g : 'pitcher';
// Per-player key for daily dedup: signed-in account, else device guest id. Trust-the-client, same
// posture as the rest of the leaderboard — the UNIQUE constraint is what enforces one attempt/day.
const playerKey = b => (b && b.sub ? 'acct:' + String(b.sub).slice(0, 80) : (b && b.guestId ? 'guest:' + String(b.guestId).slice(0, 80) : null));
// The daily resets at each player's LOCAL midnight, so the browser sends its own date (YYYY-MM-DD).
// We validate it and fall back to the server's CURRENT_DATE (UTC) when absent/malformed.
const dailyDate = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// --- Server-side build validation (closes the trust-the-client hole for impossible builds) ---
// Each slot's cap is the TRUE max for that stat across the game's real cards (+ a few points of
// buffer); a value above it can't come from a legit card. Frame is heightToRating-bounded, so it's
// low. Note most batter slots (Vision/Power/Contact/Clutch/Discipline) and some pitcher slots
// (Velocity/Strikeout/Clutch/Stamina) legitimately reach ~125 — only the low-max slots below catch
// a uniform "all-125/all-200" cheat.
const SLOT_MAX = {
  pitcher: { _default: 128, Break: 102, Command: 102, Defense: 100, 'Ground Ball': 104, Frame: 102 },
  batter:  { _default: 128, Speed: 102, Defense: 102, Frame: 96 },
  baller:  { _default: 128, '3-Pointer': 123, Finishing: 120, Dribble: 123, Playmaking: 120, Defense: 117, Speed: 118, Clutch: 121 },
  // Soccer caps = true maxima across pool+prime+icons in strikers/keepers.json, +3 buffer.
  striker: { _default: 120, Finishing: 118, Pace: 120, 'Shot Power': 114, Dribbling: 117, Passing: 117, Heading: 115, Physical: 114, Clutch: 114, Frame: 102 },
  keeper:  { _default: 117, Diving: 117, Reflexes: 117, Handling: 111, Distribution: 111, Positioning: 114, Agility: 108, Command: 114, Clutch: 114, Frame: 112 },
};
// Plain weighted-avg OVR — matches batter/baller's client computeOvr exactly, so we can reject an
// inflated OVR claim. Pitcher uses a value-scaled formula, so we don't recompute it (its slot caps
// still block impossible ratings).
const OVR_W = {
  batter: { Vision: 1.1, Power: 1.2, Contact: 1.2, Speed: 1.0, Clutch: 1.1, Discipline: 1.1, Frame: 1.0, Defense: 1.0 },
  baller: { '3-Pointer': 1.2, Finishing: 1.2, Playmaking: 1.2, Dribble: 1.1, Defense: 1.1, Rebounding: 1.1, Clutch: 1.1, Speed: 0.9, Frame: 1.0 },
  striker: { Finishing: 1.2, Pace: 1.2, Dribbling: 1.1, 'Shot Power': 1.1, Passing: 1.1, Clutch: 1.1, Heading: 1.0, Physical: 1.0, Frame: 0.7 },
  keeper: { Reflexes: 1.2, Diving: 1.2, Positioning: 1.1, Handling: 1.1, Clutch: 1.1, Frame: 1.1, Command: 1.0, Distribution: 1.0, Agility: 1.0 },
};
// Legend names per game, loaded lazily from the baked data (auto-updates on refresh; only read on
// submit, so the GET leaderboard hot path is untouched). Blocks impossible "all-legends" builds:
// legends only come from random spins (~3-4% each), so more than a few can only be a client-edited
// build. Matched by player NAME (not the client-supplied `legend` flag, which a cheat could fake).
let _legends = null;
function legendSet(game) {
  if (!_legends) {
    const names = d => new Set((((d && d.legends) || [])).map(p => String((p && p.name) || '').trim().toLowerCase()).filter(Boolean));
    try {
      _legends = { pitcher: names(require('../pitchers.json')), batter: names(require('../batters.json')), baller: names(require('../ballers.json')),
        striker: names(require('../strikers.json')), keeper: names(require('../keepers.json')) };
    } catch (e) { _legends = { pitcher: new Set(), batter: new Set(), baller: new Set(), striker: new Set(), keeper: new Set() }; }
  }
  return _legends[game] || null;
}
const LEGEND_CAP = { baller: 6, batter: 7, pitcher: 7, striker: 6, keeper: 6 };   // observed legit maxima: baller 3, batter 4, pitcher 5; soccer icon odds match baller's 4%

function checkBuild(game, clientOvr, build) {
  const ovr = Math.max(1, Math.min(120, Math.round(Number(clientOvr) || 0)));
  const maxes = SLOT_MAX[game];
  const slots = build && typeof build === 'object' && Array.isArray(build.slots) ? build.slots : null;
  if (!slots || !slots.length || !maxes) return { ok: true, ovr };   // nothing to validate (legacy/missing build)
  let vsum = 0, wsum = 0, matched = 0, flagLeg = 0, nameLeg = 0;
  const w = OVR_W[game];
  const legs = legendSet(game);
  for (const s of slots) {
    const v = Number(s && s.value);
    if (!Number.isFinite(v) || v < 0) return { ok: false };
    const cap = maxes[s.slot] != null ? maxes[s.slot] : maxes._default;
    if (v > cap) return { ok: false };
    if (s && s.legend === true) flagLeg++;
    if (legs && s && legs.has(String((s.player) || '').trim().toLowerCase())) nameLeg++;
    if (w && w[s.slot] != null) { vsum += v * w[s.slot]; wsum += w[s.slot]; matched++; }
  }
  if (Math.max(flagLeg, nameLeg) >= (LEGEND_CAP[game] || 99)) return { ok: false };   // impossible legend count
  if (w && wsum > 0 && matched === slots.length) {
    const recomputed = Math.round(vsum / wsum);
    if (recomputed > 124 || Math.abs(recomputed - ovr) > 3) return { ok: false };   // inflated / implausible OVR
  }
  return { ok: true, ovr };
}

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
    })().catch(e => { ready = null; throw e; });   // don't cache a transient failure forever
  }
  return ready;
}

module.exports = async (req, res) => {
  if (!CONN) return res.status(500).json({ ok: false, error: 'Database not configured' });
  try {
    await ensure();

    // GET ?action=build&id=<scoreId> — one submitted build, career included (powers /p/<id> share links).
    if (req.method !== 'POST' && (req.query && req.query.action) === 'build') {
      const id = parseInt(req.query && req.query.id, 10);
      if (!id || id < 1) return res.status(400).json({ ok: false, error: 'Bad id' });
      const [row] = await sql`SELECT id, name, ovr, game, build, created_at FROM scores WHERE id = ${id}`;
      if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');   // rows are immutable
      return res.status(200).json({ ok: true, entry: { ...row, id: Number(row.id) } });
    }

    // GET ?action=ghost&game=&min=&max= — a random recent build in an OVR band, slots only (no
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
      return res.status(200).json({ ok: true, ghost: { ...g, id: Number(g.id) } });
    }

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
        // Rotation guard: pitcher/batter and striker/keeper each alternate ONE daily per date
        // (same parity formula as the clients); hoops runs daily. The clients redirect on
        // off-days, so only stale pages and direct POSTs land here — reject them.
        const rd = dailyDate(body.date);
        if (rd && (game === 'pitcher' || game === 'batter' || game === 'striker' || game === 'keeper')) {
          const odd = Math.floor(Date.parse(rd + 'T00:00:00Z') / 86400000) % 2 === 1;
          const host = (game === 'pitcher' || game === 'batter') ? (odd ? 'pitcher' : 'batter') : (odd ? 'striker' : 'keeper');
          if (game !== host) return res.status(400).json({ ok: false, error: `Today's daily is ${host} — this one runs tomorrow` });
        }
        const chk = checkBuild(game, body.ovr, body.build);
        if (!chk.ok) return res.status(400).json({ ok: false, error: 'Invalid build' });
        const ovr = chk.ovr;
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
      const game = gameOf(body.game);
      const chk = checkBuild(game, body.ovr, body.build);
      if (!chk.ok) return res.status(400).json({ ok: false, error: 'Invalid build - ratings exceed what any real card can have' });
      const ovr = chk.ovr;
      const build = body.build && typeof body.build === 'object' ? JSON.stringify(body.build) : null;

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
    const SORT_FIELDS = { k: 'k', war: 'war', wins: 'wins', rings: 'rings', cyYoung: 'cyYoung', hr: 'hr', hits: 'h', mvp: 'mvp', pts: 'pts', reb: 'reb', ast: 'ast', goals: 'goals', assists: 'assists', cs: 'cs', saves: 'saves' };
    const sortField = SORT_FIELDS[req.query && req.query.sort] || null;
    const asc = (req.query && req.query.dir) === 'asc';       // flip any stat sort to worst-first
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
    } else if (sortField && asc) {
      // worst-first stat sort (dir=asc); NULLS LAST still ranks missing-career entries at the end
      rows = daily
        ? await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots') ELSE build END AS build,
              game, created_at, (build->'career'->'totals'->>${sortField})::numeric AS stat FROM scores
              WHERE game = ${game} AND created_at >= date_trunc('day', now())
              ORDER BY (build->'career'->'totals'->>${sortField})::numeric ASC NULLS LAST, ovr ASC, created_at ASC LIMIT ${limit}`
        : await sql`SELECT id, name, ovr,
              CASE WHEN jsonb_typeof(build) = 'object' THEN jsonb_build_object('slots', build->'slots') ELSE build END AS build,
              game, created_at, (build->'career'->'totals'->>${sortField})::numeric AS stat FROM scores
              WHERE game = ${game}
              ORDER BY (build->'career'->'totals'->>${sortField})::numeric ASC NULLS LAST, ovr ASC, created_at ASC LIMIT ${limit}`;
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
