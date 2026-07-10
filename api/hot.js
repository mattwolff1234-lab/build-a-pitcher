// 🔥 "Last Night's Studs" — daily hot-player list from real MLB box scores.
//   GET /api/hot -> { ok, gameDate, players: [{ mlbamId, name, team, pos, type, line, boost }] }
// Computed on the first request of each US-Eastern day (MLB's day boundary) from
// statsapi.mlb.com (schedule -> one boxscore per game), then cached one row per day in Neon —
// no cron needed. The games match players to their cards by mlbamId and apply `boost` (+5..+10)
// in free play. Tune the scoring locally with:  node api/hot.js

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
      await sql`CREATE TABLE IF NOT EXISTS hot_players (
        serve_date text PRIMARY KEY,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

// Today's date string in US Eastern (games end late ET; the list flips at midnight ET).
function etToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function addDays(dateStr, n) {
  return new Date(Date.parse(dateStr + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

// ---- scoring -------------------------------------------------------------
// Pitchers: Game Score-ish. 68+ = stud (Cease's 8 IP / 1 H / 0 ER / 11 K night ≈ 88).
function pitcherScore(s) {
  const parts = String(s.inningsPitched || '0').split('.');
  const outs = (+parts[0] || 0) * 3 + (+parts[1] || 0);
  return {
    outs,
    score: 50 + outs + 1.5 * (s.strikeOuts || 0) - 2 * (s.hits || 0)
      - 4 * (s.earnedRuns || 0) - (s.baseOnBalls || 0)
      + (s.wins ? 3 : 0) + (s.saves ? 5 : 0),
  };
}
// Batters: HR-heavy. 20+ = stud; 2 HR / 4 H / 3 SB nights auto-qualify.
function batterScore(s) {
  return 10 * (s.homeRuns || 0) + 3 * (s.hits || 0) + 2 * (s.doubles || 0)
    + 4 * (s.triples || 0) + 2 * (s.rbi || 0) + 1.5 * (s.runs || 0)
    + 3 * (s.stolenBases || 0) + (s.baseOnBalls || 0);
}
const clampBoost = x => Math.max(5, Math.min(10, Math.round(x)));

function pitcherLine(s, opp) {
  const tag = s.wins ? ' (W)' : s.saves ? ' (SV)' : '';
  return `${s.inningsPitched} IP · ${s.hits || 0} H · ${s.earnedRuns || 0} ER · ${s.strikeOuts || 0} K${tag} vs ${opp}`;
}
function batterLine(s, opp) {
  const parts = [`${s.hits || 0}-for-${s.atBats || 0}`];
  if (s.homeRuns) parts.push(`${s.homeRuns} HR`);
  if (s.doubles) parts.push(`${s.doubles} 2B`);
  if (s.triples) parts.push(`${s.triples} 3B`);
  if (s.rbi) parts.push(`${s.rbi} RBI`);
  if (s.stolenBases) parts.push(`${s.stolenBases} SB`);
  return `${parts.join(' · ')} vs ${opp}`;
}

// Collect stud performances from every Final game on `date`. Returns null if that day
// isn't usable (no finished games, or games still in progress — late west-coast night).
async function computeDay(date) {
  const sched = await getJSON(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
  const games = ((sched.dates && sched.dates[0]) || {}).games || [];
  const finals = games.filter(g => g.status && (g.status.codedGameState === 'F' || g.status.codedGameState === 'O'));
  const anyLive = games.some(g => g.status && g.status.abstractGameState === 'Live');
  if (!finals.length || anyLive) return null;

  const pitchers = [], batters = [];
  for (const g of finals) {
    let box;
    try { box = await getJSON(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`); }
    catch (e) { continue; }
    for (const side of ['home', 'away']) {
      const team = box.teams[side], opp = box.teams[side === 'home' ? 'away' : 'home'];
      const oppAb = (opp.team && opp.team.abbreviation) || '';
      for (const pl of Object.values(team.players || {})) {
        if (!pl.person) continue;
        const base = {
          mlbamId: pl.person.id, name: pl.person.fullName,
          team: (team.team && team.team.abbreviation) || '',
          pos: (pl.position && pl.position.abbreviation) || '',
        };
        const ps = pl.stats && pl.stats.pitching;
        if (ps && ps.inningsPitched) {
          const { score } = pitcherScore(ps);
          if (score >= 68) pitchers.push({ ...base, type: 'pitcher', line: pitcherLine(ps, oppAb), score, boost: clampBoost(5 + 5 * (score - 68) / 27) });
        }
        const bs = pl.stats && pl.stats.batting;
        if (bs && bs.atBats) {
          const score = batterScore(bs);
          if (score >= 20 || bs.homeRuns >= 2 || bs.hits >= 4 || bs.stolenBases >= 3) {
            batters.push({ ...base, type: 'batter', line: batterLine(bs, oppAb), score, boost: clampBoost(5 + 5 * (score - 20) / 25) });
          }
        }
      }
    }
  }
  // Doubleheaders: keep each player's best game of the day.
  const best = list => {
    const m = new Map();
    for (const p of list) if (!m.has(p.mlbamId) || p.score > m.get(p.mlbamId).score) m.set(p.mlbamId, p);
    return [...m.values()].sort((a, b) => b.score - a.score);
  };
  const players = [...best(pitchers).slice(0, 4), ...best(batters).slice(0, 6)]
    .sort((a, b) => b.boost - a.boost || b.score - a.score)
    .map(({ score, ...p }) => p);   // score is internal — don't ship it
  return { ok: true, gameDate: date, players };
}

// Walk back from yesterday (ET) to the most recent fully-finished game day (off-days,
// the All-Star break, or a west-coast game still running past midnight ET).
async function compute(serveDate) {
  for (let i = 1; i <= 5; i++) {
    const payload = await computeDay(addDays(serveDate, -i));
    if (payload && payload.players.length) return payload;
  }
  return null;
}

module.exports = async (req, res) => {
  // max-age lets the BROWSER reuse the list as players hop landing -> pitching -> batting
  // (every request, even a CDN hit, bills as an edge request — only browser cache avoids one)
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600, stale-while-revalidate=3600');
  try {
    const today = etToday();
    if (!CONN) {
      const payload = await compute(today);
      return res.status(200).json(payload || { ok: false, players: [] });
    }
    await ensure();
    const yday = addDays(today, -1);
    const [row] = await sql`SELECT payload FROM hot_players WHERE serve_date = ${today}`;
    // Cached AND already showing yesterday's games -> done. But if the cached list is
    // OLDER (yesterday was still finishing - a late west-coast game - when it was first
    // computed, so the walk-back grabbed an earlier day), try to upgrade in place now
    // that yesterday may be final. Off-days cost one cheap schedule fetch per cache miss.
    if (row && row.payload && row.payload.gameDate === yday) return res.status(200).json(row.payload);
    if (row) {
      let fresh = null;
      try { fresh = await computeDay(yday); } catch (e) {}
      if (fresh && fresh.players.length) {
        await sql`INSERT INTO hot_players (serve_date, payload) VALUES (${today}, ${JSON.stringify(fresh)}::jsonb)
          ON CONFLICT (serve_date) DO UPDATE SET payload = EXCLUDED.payload`;
        return res.status(200).json(fresh);
      }
      return res.status(200).json(row.payload);
    }
    const payload = await compute(today);
    if (payload) {
      await sql`INSERT INTO hot_players (serve_date, payload) VALUES (${today}, ${JSON.stringify(payload)}::jsonb)
        ON CONFLICT (serve_date) DO NOTHING`;
      return res.status(200).json(payload);
    }
    // statsapi down / nothing usable -> serve the most recent stored list rather than nothing
    const [last] = await sql`SELECT payload FROM hot_players ORDER BY serve_date DESC LIMIT 1`;
    return res.status(200).json(last ? last.payload : { ok: false, players: [] });
  } catch (e) {
    return res.status(200).json({ ok: false, players: [], error: String((e && e.message) || e) });
  }
};

// Local tuning harness: prints what the endpoint would compute right now.
if (require.main === module) {
  compute(etToday()).then(p => console.log(JSON.stringify(p, null, 2)));
}
