// Leaderboard API (Vercel serverless function, talks to Neon Postgres).
//   GET  /api/score?scope=global|daily&limit=200&game=pitcher|batter&me=<id>
//   POST /api/score  { name, ovr, build, game }
// One table, separated by `game` so pitching and batting have their own boards.

const { neon } = require('@neondatabase/serverless');
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
const gameOf = g => (g === 'batter' || g === 'baller' || g === 'striker' || g === 'keeper' || g === 'cfb') ? g : 'pitcher';
// Per-player key for daily dedup: signed-in account, else device guest id. Trust-the-client, same
// posture as the rest of the leaderboard · the UNIQUE constraint is what enforces one attempt/day.
const playerKey = b => (b && b.sub ? 'acct:' + String(b.sub).slice(0, 80) : (b && b.guestId ? 'guest:' + String(b.guestId).slice(0, 80) : null));
// The daily resets at each player's LOCAL midnight, so the browser sends its own date (YYYY-MM-DD).
// We validate it and fall back to the server's CURRENT_DATE (UTC) when absent/malformed.
const dailyDate = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// --- Server-side build validation (closes the trust-the-client hole for impossible builds) ---
// Each slot's cap is the TRUE max for that stat across the game's real cards (+ a few points of
// buffer); a value above it can't come from a legit card. Frame is heightToRating-bounded, so it's
// low. Note most batter slots (Vision/Power/Contact/Clutch/Discipline) and some pitcher slots
// (Velocity/Strikeout/Clutch/Stamina) legitimately reach ~125 · only the low-max slots below catch
// a uniform "all-125/all-200" cheat.
// Headroom on top of the raw card maxima, because power-ups stack on legit builds:
//  - baseball (pitcher/batter): 🔥 hot-player boost adds up to +10 to EVERY rated stat
//    (intentionally uncapped), and the Boost power-up then guarantees ≥ +5 over the landed
//    card · so a legit slot can sit ~15 above the best raw card (99 Break → 114 hot+boosted).
//  - all games: Boost's +5-over-landed guarantee alone. Frame is real height (never
//    hot-boosted or Boost-raised), so Frame caps stay at heightToRating bounds.
// Caps stay tight enough to catch "all-150" edited builds without rejecting real ones.
const SLOT_MAX = {
  pitcher: { _default: 132, Break: 117, Command: 117, Defense: 115, 'Ground Ball': 119, Frame: 102 },
  batter:  { _default: 132, Speed: 117, Defense: 117, Frame: 96 },
  baller:  { _default: 133, '3-Pointer': 128, Finishing: 125, Dribble: 128, Playmaking: 125, Defense: 122, Speed: 123, Clutch: 126 },
  // Soccer caps = true maxima across pool+prime+icons in strikers/keepers.json, +5 boost headroom +3 buffer.
  striker: { _default: 125, Finishing: 123, Pace: 125, 'Shot Power': 119, Dribbling: 122, Passing: 122, Heading: 120, Physical: 119, Clutch: 119, Frame: 102 },
  keeper:  { _default: 122, Diving: 122, Reflexes: 122, Handling: 116, Distribution: 116, Positioning: 119, Agility: 113, Command: 119, Clutch: 119, Frame: 112 },
  // CFB27 raw attributes cap at 99; synthesized Primes add +6 and Boost keeps the better per
  // stat (no stacking), so 108 covers every legit slot. Frame = heightToRating (48+(in-66)*3.4).
  cfb:     { _default: 108, Frame: 102 },
};
// Plain weighted-avg OVR · matches batter/baller's client computeOvr exactly, so we can reject an
// inflated OVR claim. Pitcher uses a value-scaled formula, so we don't recompute it (its slot caps
// still block impossible ratings).
const OVR_W = {
  batter: { Vision: 1.1, Power: 1.2, Contact: 1.2, Speed: 1.0, Clutch: 1.1, Discipline: 1.1, Frame: 1.0, Defense: 1.0 },
  baller: { '3-Pointer': 1.2, Finishing: 1.2, Playmaking: 1.2, Dribble: 1.1, Defense: 1.1, Rebounding: 1.1, Clutch: 1.1, Speed: 0.9, Frame: 1.0 },
  striker: { Finishing: 1.2, Pace: 1.2, Dribbling: 1.1, 'Shot Power': 1.1, Passing: 1.1, Clutch: 1.1, Heading: 1.0, Physical: 1.0, Frame: 0.7 },
  keeper: { Reflexes: 1.2, Diving: 1.2, Positioning: 1.1, Handling: 1.1, Clutch: 1.1, Frame: 1.1, Command: 1.0, Distribution: 1.0, Agility: 1.0 },
  // cfb: one flat map spanning all three positions' slot labels (labels are unique per weight -
  // RB's catch slot is labeled "Catching" so it can't collide with WR's 1.2x "Hands").
  cfb: { 'Short Accuracy': 1.2, 'Mid Accuracy': 1.2, 'Deep Ball': 1.2, 'Arm Power': 1.1, Poise: 1.1, 'Football IQ': 1.1, 'On the Run': 1.0, Wheels: 1.0,
    Vision: 1.2, 'Break Tackle': 1.2, Power: 1.1, Burst: 1.1, Elusiveness: 1.1, 'Ball Security': 1.0, Catching: 1.0,
    Hands: 1.2, Routes: 1.2, Speed: 1.2, Release: 1.1, 'In Traffic': 1.1, Spectacular: 1.1, Agility: 1.0, Leaping: 1.0, Frame: 1.0 },
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
      const cfbLeg = require('../cfb.json').legends || {};
      _legends.cfb = names({ legends: [].concat(cfbLeg.qb || [], cfbLeg.rb || [], cfbLeg.wr || []) });
    } catch (e) { _legends = { pitcher: new Set(), batter: new Set(), baller: new Set(), striker: new Set(), keeper: new Set(), cfb: new Set() }; }
  }
  return _legends[game] || null;
}
const LEGEND_CAP = { baller: 6, batter: 7, pitcher: 7, striker: 6, keeper: 6, cfb: 6 };   // observed legit maxima: baller 3, batter 4, pitcher 5; soccer icon odds match baller's 4%

// Career-total sanity caps · above these is impossible under the tuned sim, so an over-cap
// career is either a stale pre-fix client or a doctored payload. We KEEP the score (ovr is
// validated separately) and just strip the career object, so the entry stays on the OVR board
// but can't pollute the career-stat sorts. Re-based 2026-07-11 on the soft-capped sims'
// verified maxima + ~5% margin (Node harness, 2000 seeds on maximal hot-boosted builds:
// pitcher K 6794 IP 4401 W 370 · batter HR 808 H 4037 RBI 3395 R 2182 SB 690).
const CAREER_MAX = {
  batter: { hr: 850, h: 4250, rbi: 3600, r: 2300, sb: 730 },
  pitcher: { k: 7100, ip: 4650, wins: 390 },
  cfb: { yds: 17000, td: 170 },
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

// Creator referral code, set by ref.js as a 30-day cookie when a visitor lands with ?ref=<code>.
// Cookie first (same-origin fetches carry it automatically, so no per-game code), body.ref as a
// fallback for clients that want to pass it explicitly. Same shape ref.js enforces; anything
// else counts as absent — this is attribution, never a reason to reject a submission.
function refOf(req, body) {
  const m = /(?:^|;\s*)pl_ref=([^;]+)/.exec(String((req.headers && req.headers.cookie) || ''));
  const v = String((m && m[1]) || (body && body.ref) || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(v) ? v : null;
}

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
      // Creator referral attribution (?ref=<code> links): tagged onto submissions + a per-day
      // play tally, read back via the token-gated ?action=refStats.
      await sql`ALTER TABLE scores ADD COLUMN IF NOT EXISTS ref text`;
      await sql`ALTER TABLE daily_scores ADD COLUMN IF NOT EXISTS ref text`;
      await sql`CREATE INDEX IF NOT EXISTS idx_scores_ref ON scores (ref) WHERE ref IS NOT NULL`;
      await sql`CREATE TABLE IF NOT EXISTS ref_plays (
        ref text NOT NULL,
        day date NOT NULL DEFAULT CURRENT_DATE,
        n bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (ref, day)
      )`;
      // Distinct devices/accounts per ref code, so one person replaying 100 times counts ONCE.
      // uid = device guestId (or signed-in sub). This is the "new players" number the creator
      // bonus is paid on; ref_plays.n stays as the raw (inflatable) session count for context.
      await sql`CREATE TABLE IF NOT EXISTS ref_users (
        ref text NOT NULL,
        uid text NOT NULL,
        first_seen date NOT NULL DEFAULT CURRENT_DATE,
        PRIMARY KEY (ref, uid)
      )`;
    })().catch(e => { ready = null; throw e; });   // don't cache a transient failure forever
  }
  return ready;
}

module.exports = async (req, res) => {
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

    // GET ?action=refStats&token=<STATS_TOKEN>[&days=90] · creator-referral report. Per ref code:
    // players (UNIQUE devices/accounts — the creator-bonus basis), plays (raw first-spin sessions,
    // inflatable), leaderboard builds (+ per-game split + avg OVR), daily-challenge runs, first/last
    // seen. Token-gated like the other admin reads. Example:
    //   curl -s 'https://goat-lab.app/api/score?action=refStats&token=<STATS_TOKEN>'
    if (req.method !== 'POST' && (req.query && req.query.action) === 'refStats') {
      if (String((req.query && req.query.token) || '') !== ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'Bad token' });
      const days = Math.max(1, Math.min(365, parseInt(req.query && req.query.days, 10) || 90));
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const builds = await sql`SELECT ref, game, count(*)::int AS builds, round(avg(ovr))::int AS avg_ovr,
          min(created_at) AS first_seen, max(created_at) AS last_seen
        FROM scores WHERE ref IS NOT NULL AND created_at >= ${since} GROUP BY ref, game`;
      const dailies = await sql`SELECT ref, count(*)::int AS dailies FROM daily_scores
        WHERE ref IS NOT NULL AND created_at >= ${since} GROUP BY ref`;
      const plays = await sql`SELECT ref, sum(n)::bigint AS plays FROM ref_plays
        WHERE day >= ${since.slice(0, 10)}::date GROUP BY ref`;
      // Unique players = distinct devices/accounts per ref (what the creator bonus is paid on).
      const players = await sql`SELECT ref, count(*)::int AS players FROM ref_users
        WHERE first_seen >= ${since.slice(0, 10)}::date GROUP BY ref`;
      const out = {};
      const at = ref => (out[ref] = out[ref] || { ref, players: 0, plays: 0, builds: 0, dailies: 0, games: {}, avgOvr: null, firstSeen: null, lastSeen: null });
      for (const r of players) at(r.ref).players = Number(r.players);
      for (const r of plays) at(r.ref).plays = Number(r.plays);
      for (const r of dailies) at(r.ref).dailies = r.dailies;
      const ovrSum = {};
      for (const r of builds) {
        const o = at(r.ref);
        o.builds += r.builds;
        o.games[r.game] = (o.games[r.game] || 0) + r.builds;
        ovrSum[r.ref] = (ovrSum[r.ref] || 0) + r.avg_ovr * r.builds;
        if (!o.firstSeen || r.first_seen < o.firstSeen) o.firstSeen = r.first_seen;
        if (!o.lastSeen || r.last_seen > o.lastSeen) o.lastSeen = r.last_seen;
      }
      for (const ref of Object.keys(ovrSum)) out[ref].avgOvr = Math.round(ovrSum[ref] / out[ref].builds);
      const refs = Object.values(out).sort((a, b) => (b.players + b.builds + b.dailies) - (a.players + a.builds + a.dailies));
      return res.status(200).json({ ok: true, days, note: 'players = unique devices/accounts (bonus basis); plays = raw sessions', refs });
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
        const ref = refOf(req, body);
        if (ref) {
          await sql`INSERT INTO ref_plays (ref, day, n) VALUES (${ref}, CURRENT_DATE, 1)
            ON CONFLICT (ref, day) DO UPDATE SET n = ref_plays.n + 1`;
          // Count this device/account once per ref (the payable "new players" number).
          const uid = String((body && body.guestId) || (body && body.sub) || '').trim().slice(0, 80);
          if (uid) await sql`INSERT INTO ref_users (ref, uid) VALUES (${ref}, ${uid})
            ON CONFLICT (ref, uid) DO NOTHING`;
        }
        return res.status(200).json({ ok: true, plays: Number(n) });
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
        await sql`INSERT INTO daily_scores (player_key, game, name, ovr, build, challenge_date, ref)
          VALUES (${key}, ${game}, ${cname}, ${ovr}, ${cbuild}::jsonb, COALESCE(${cd}::date, CURRENT_DATE), ${refOf(req, body)})
          ON CONFLICT (player_key, game, challenge_date) DO NOTHING`;
        const [{ rank }] = await sql`SELECT count(*)::int + 1 AS rank FROM daily_scores
          WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE) AND ovr > ${ovr}`;
        const [{ total }] = await sql`SELECT count(*)::int AS total FROM daily_scores
          WHERE game = ${game} AND challenge_date = COALESCE(${cd}::date, CURRENT_DATE)`;
        return res.status(200).json({ ok: true, rank: Number(rank), total: Number(total) });
      }

      let name = String(body.name == null ? '' : body.name).trim().slice(0, 20);
      if (!name) name = 'Anonymous';
      if (!NameFilter.isClean(name)) return res.status(400).json({ ok: false, error: BAD_NAME_MSG });
      const game = gameOf(body.game);
      const chk = checkBuild(game, body.ovr, body.build);
      if (!chk.ok) return res.status(400).json({ ok: false, error: 'Invalid build - ratings exceed what any real card can have' });
      const ovr = chk.ovr;
      const build = body.build && typeof body.build === 'object' ? JSON.stringify(stripInsaneCareer(game, body.build)) : null;

      const [row] = await sql`
        INSERT INTO scores (name, ovr, build, game, ref) VALUES (${name}, ${ovr}, ${build}::jsonb, ${game}, ${refOf(req, body)})
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
    const SORT_FIELDS = { k: 'k', war: 'war', wins: 'wins', rings: 'rings', cyYoung: 'cyYoung', hr: 'hr', hits: 'h', mvp: 'mvp', pts: 'pts', reb: 'reb', ast: 'ast', goals: 'goals', assists: 'assists', cs: 'cs', saves: 'saves', yds: 'yds', td: 'td', heisman: 'heisman', natty: 'natty' };
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
        if (inScope) me = { id: Number(row.id), rank: ahead + 1, name: NameFilter.clean(row.name, 'Anonymous'), ovr: row.ovr, build: row.build, game: row.game,
          stat: sortField && row.stat != null ? Number(row.stat) : null };
      }
    }
    return res.status(200).json({ ok: true, sort: sortField, rows: rows.map(r => ({ ...r, id: Number(r.id), name: NameFilter.clean(r.name, 'Anonymous'), stat: r.stat == null ? null : Number(r.stat) })), me });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
