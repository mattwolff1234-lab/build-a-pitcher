// Daily 64-player single-elimination Tournament — server side (Vercel serverless + Neon).
// FEATURE-FLAGGED OFF: every request short-circuits unless process.env.TOURNAMENTS_ENABLED is truthy,
// so nothing is user-facing until launch. See tournament-design.md + tournament-engine.js.
//
// Actions (POST JSON):
//   register {game,date,sub,sessionToken}     -> join today's bracket (signed-in)
//   state    {game,date}  | {id}              -> the tournament row + entrants (public)
//   settle   {id, token}                      -> run the bracket, pay coins (idempotent), record the
//                                                champion trophy, mark done. Token-gated (STATS_TOKEN).
//
// The live round-by-round orchestration (Ably per-match channels keyed by matchSeed, pvpLock settle)
// is the DEFERRED piece; `settle` here runs the deterministic engine from entrant ratings + ghost
// fill so a small bracket can be exercised end-to-end (coins on the ledger, trophy recorded).

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const Engine = require('../tournament-engine.js');
// catalog.js (Goat Coins) is the coin-payout source of truth when present; fall back to the engine's
// DEFAULT_COINS so this lambda loads even before the Goat Coins system is committed/deployed.
let Catalog; try { Catalog = require('../catalog.js'); } catch (e) { Catalog = null; }
const COIN_TABLE = (Catalog && Catalog.EARN && Catalog.EARN.tournament) || Engine.DEFAULT_COINS;
let NameFilter; try { NameFilter = require('../namefilter.js'); } catch (e) { NameFilter = { clean: (n, f) => n || f }; }

function findConn() {
  const e = process.env;
  const named = e.DATABASE_URL || e.POSTGRES_URL || e.POSTGRES_PRISMA_URL
    || e.STORAGE_URL || e.STORAGE_DATABASE_URL || e.STORAGE_POSTGRES_URL;
  if (named) return named;
  for (const k of Object.keys(e)) { const v = e[k]; if (typeof v === 'string' && /^postgres(ql)?:\/\//.test(v)) return v; }
  return null;
}
const CONN = findConn();
const sql = CONN ? neon(CONN) : null;
const GAMES = new Set(['pitcher', 'batter', 'baller', 'striker', 'keeper', 'cfb', 'hockey', 'mon']);
const STATS_TOKEN = process.env.STATS_TOKEN || 'pl-balance-7f3a9c21';

let ready;
function ensure() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS tournaments (
        id text PRIMARY KEY, game text NOT NULL, seed bigint NOT NULL,
        status text NOT NULL DEFAULT 'registration', round int NOT NULL DEFAULT 0,
        bracket jsonb, champion text, created_at timestamptz NOT NULL DEFAULT now())`;
      await sql`CREATE TABLE IF NOT EXISTS tournament_entrants (
        tournament_id text NOT NULL, player_key text NOT NULL, name text, rating int NOT NULL DEFAULT 1000,
        seed int, placement text, PRIMARY KEY (tournament_id, player_key))`;
      await sql`CREATE TABLE IF NOT EXISTS tournament_trophies (
        id bigserial PRIMARY KEY, player_key text NOT NULL, tournament_id text NOT NULL, game text,
        placement text, created_at timestamptz NOT NULL DEFAULT now())`;
      // coin_ledger is normally created by api/account.js; ensure it here too so settle can pay.
      await sql`CREATE TABLE IF NOT EXISTS coin_ledger (
        id bigserial PRIMARY KEY, player_key text NOT NULL, delta int NOT NULL, reason text,
        ref text UNIQUE, created_at timestamptz NOT NULL DEFAULT now())`;
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

// Same idempotent grant as api/account.js grantCoins (UNIQUE ref = the dedupe key).
async function grantCoins(key, delta, reason, ref) {
  const ins = await sql`INSERT INTO coin_ledger (player_key, delta, reason, ref)
    VALUES (${key}, ${Math.round(delta)}, ${String(reason).slice(0, 40)}, ${String(ref).slice(0, 120)})
    ON CONFLICT (ref) DO NOTHING RETURNING id`;
  if (!ins.length) return null;
  const [u] = await sql`UPDATE users SET coins = GREATEST(0, COALESCE(coins, 0) + ${Math.round(delta)})
    WHERE google_sub = ${key} RETURNING coins`;
  return u ? Number(u.coins) : null;
}
async function authed(sub, token) {
  if (!sub || !token) return false;
  const [u] = await sql`SELECT 1 FROM users WHERE google_sub = ${sub} AND session_token = ${token}`;
  return !!u;
}

module.exports = async (req, res) => {
  if (!process.env.TOURNAMENTS_ENABLED) return res.status(200).json({ ok: false, error: 'tournaments not enabled' });
  if (!CONN) return res.status(500).json({ ok: false, error: 'Database not configured' });
  try {
    await ensure();
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = body.action || 'state';
    const game = GAMES.has(body.game) ? body.game : 'pitcher';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : null;
    const id = String(body.id || (date ? Engine.dailyTournamentId(date, game) : '')).slice(0, 80);

    // --- ensure today's tournament row exists (deterministic seed from the id) ---
    async function getOrCreate(tid, g) {
      let [t] = await sql`SELECT * FROM tournaments WHERE id = ${tid}`;
      if (!t) {
        const seed = Engine.hashStr(tid);
        await sql`INSERT INTO tournaments (id, game, seed) VALUES (${tid}, ${g}, ${seed})
          ON CONFLICT (id) DO NOTHING`;
        [t] = await sql`SELECT * FROM tournaments WHERE id = ${tid}`;
      }
      return t;
    }

    if (action === 'register') {
      if (!date) return res.status(400).json({ ok: false, error: 'missing date' });
      if (!(await authed(body.sub, body.sessionToken))) return res.status(401).json({ ok: false, error: 'Not signed in' });
      const t = await getOrCreate(id, game);
      if (t.status !== 'registration') return res.status(200).json({ ok: false, error: 'registration closed' });
      const [{ count }] = await sql`SELECT count(*)::int AS count FROM tournament_entrants WHERE tournament_id = ${id}`;
      if (count >= 64) return res.status(200).json({ ok: false, error: 'bracket full' });
      // rating = the player's pvp Elo (best available), else 1000
      const [u] = await sql`SELECT name, pvp_elo, pvp_elo_hoops, pvp_elo_soccer, pvp_elo_cfb FROM users WHERE google_sub = ${body.sub}`;
      const rating = u ? Math.max(u.pvp_elo || 1000, u.pvp_elo_hoops || 0, u.pvp_elo_soccer || 0, u.pvp_elo_cfb || 0) : 1000;
      const name = NameFilter.clean((u && u.name) || 'Player', 'Player');
      await sql`INSERT INTO tournament_entrants (tournament_id, player_key, name, rating)
        VALUES (${id}, ${body.sub}, ${name}, ${rating})
        ON CONFLICT (tournament_id, player_key) DO UPDATE SET name = ${name}, rating = ${rating}`;
      const [{ count: n2 }] = await sql`SELECT count(*)::int AS count FROM tournament_entrants WHERE tournament_id = ${id}`;
      return res.status(200).json({ ok: true, id, registered: true, entrants: n2 });
    }

    if (action === 'state') {
      if (!id) return res.status(400).json({ ok: false, error: 'missing id/date' });
      const t = await getOrCreate(id, game);
      const entrants = await sql`SELECT player_key, name, rating, seed, placement FROM tournament_entrants WHERE tournament_id = ${id} ORDER BY rating DESC`;
      return res.status(200).json({ ok: true, tournament: { id: t.id, game: t.game, status: t.status, round: t.round, champion: t.champion }, entrants: entrants.map(e => ({ ...e, name: NameFilter.clean(e.name, 'Player') })) });
    }

    // --- settle: run the deterministic engine (entrants + ghost fill), pay coins, record trophy ---
    if (action === 'settle') {
      if (body.token !== STATS_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
      const [t] = await sql`SELECT * FROM tournaments WHERE id = ${id}`;
      if (!t) return res.status(404).json({ ok: false, error: 'no such tournament' });
      const entrantRows = await sql`SELECT player_key, name, rating FROM tournament_entrants WHERE tournament_id = ${id}`;
      const entrants = entrantRows.map(r => ({ key: r.player_key, name: r.name, rating: r.rating }));
      // ghost fill from the leaderboard for this game (top OVRs as filler builds)
      let ghosts = [];
      try {
        const g = await sql`SELECT name, ovr FROM scores WHERE game = ${t.game} ORDER BY ovr DESC LIMIT 64`;
        ghosts = g.map(x => ({ name: NameFilter.clean(x.name, 'Ghost'), rating: Number(x.ovr) || 70 }));
      } catch (e) {}
      const result = Engine.simTournament(entrants, ghosts, Number(t.seed) >>> 0,
        { size: 64, tournamentId: id, coinTable: COIN_TABLE });
      // pay coins (idempotent per player) + record placement + champion trophy
      const paid = [];
      for (const p of Object.values(result.placements)) {
        if (p.kind !== 'human' || !p.key) continue;
        await sql`UPDATE tournament_entrants SET seed = ${p.seed}, placement = ${p.placement}
          WHERE tournament_id = ${id} AND player_key = ${p.key}`;
        if (p.coins > 0) {
          const bal = await grantCoins(p.key, p.coins, 'tournament', 'tourn:' + id + ':' + p.key);
          if (bal != null) paid.push({ key: p.key, placement: p.placement, coins: p.coins });
        }
      }
      const champ = result.champion;
      let championKey = null;
      if (champ && champ.kind === 'human' && champ.key) {
        championKey = champ.key;
        await sql`INSERT INTO tournament_trophies (player_key, tournament_id, game, placement)
          SELECT ${champ.key}, ${id}, ${t.game}, 'champion'
          WHERE NOT EXISTS (SELECT 1 FROM tournament_trophies WHERE tournament_id = ${id} AND placement = 'champion')`;
      }
      await sql`UPDATE tournaments SET status = 'done', champion = ${championKey}, bracket = ${JSON.stringify({ totalRounds: result.totalRounds, championName: champ ? champ.name : null })}::jsonb WHERE id = ${id}`;
      return res.status(200).json({ ok: true, id, champion: champ ? champ.name : null, championKey, paidCount: paid.length, paid });
    }

    return res.status(400).json({ ok: false, error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
