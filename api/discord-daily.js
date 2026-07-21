// GoatLab Discord daily digest (Vercel cron, see vercel.json — daily 13:10 UTC ≈ 9am ET, after
// every timezone has finished yesterday's daily). Posts via channel webhooks:
//   1. …_RANKINGS webhook — yesterday's Daily Challenge top-3 per game with Goat Coin payouts
//      (signed-in accounts only, EARN.dailyTop amounts, ledger-idempotent), best GOAT Squad runs,
//      and Last Night's Studs (self-fetch of /api/hot, which also pre-warms the day's list).
//   2. …_UPDATES webhook — "What's New": last 24h of git commits (GitHub API) rewritten into
//      player-speak via the Claude API (ANTHROPIC_API_KEY; falls back to raw commit lines).
// Webhook env lookup is name-tolerant: any env var containing RANKING/UPDATE whose value is a
// Discord webhook URL works (plus the original DISCORD_WEBHOOK_DAILY/_PATCH names).
// Idempotent twice over: a discord_posts row per (kind, day) stops double-posting, and coin grants
// dedupe on coin_ledger.ref (dailytop:<date>:<game>:<sub>) — a re-run can never pay or post twice.
// Auth: Vercel cron sends "Authorization: Bearer <CRON_SECRET>" when that env is set; manual runs
// pass ?token=<STATS_TOKEN>. ?dry=1 composes and returns JSON without posting/paying/claiming;
// ?force=1 (token only) bypasses the once-a-day claim to re-post.
const { neon } = require('@neondatabase/serverless');
const Catalog = require('../catalog.js');
let NameFilter; try { NameFilter = require('../namefilter.js'); } catch (e) { NameFilter = { clean: (n, f) => n || f }; }

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
const STATS_TOKEN = process.env.STATS_TOKEN || 'pl-balance-7f3a9c21';
const SITE = 'https://pitchinglab.pitchergami.com';
const REPO = process.env.GITHUB_REPO || 'mattwolff1234-lab/build-a-pitcher';

const DAILY_GAMES = [
  ['pitcher', '⚾ Pitching Lab'],
  ['batter', '⚾ Batting Lab'],
  ['baller', '🏀 Hoops Lab'],
  ['striker', '⚽ Striker'],
  ['keeper', '🧤 Keeper'],
  ['cfb', '🏈 College Football'],
  ['hockey', '🏒 Rink Lab'],
  ['mon', '👾 Monster Lab'],
];
const SQUAD_GAMES = [['goatsquad', '🏀 NBA'], ['squadball', '⚾ MLB'], ['squadfoot', '🏈 NFL']];
const MEDALS = ['🥇', '🥈', '🥉'];

const esc = s => String(s || '').replace(/([\\*_~`|])/g, '\\$1');
const cleanName = n => esc(NameFilter.clean(String(n == null ? '' : n).slice(0, 40), 'Anonymous'));

// Channel-named envs (…_RANKINGS / …_UPDATES): try exact names first, then any env var whose
// name matches and whose value is actually a Discord webhook URL.
function findHook(nameRe, ...exact) {
  for (const n of exact) if (process.env[n]) return process.env[n];
  for (const k of Object.keys(process.env)) {
    if (nameRe.test(k) && /^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(process.env[k] || '')) return process.env[k];
  }
  return '';
}

async function postWebhook(url, payload) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('discord ' + r.status + ': ' + (await r.text()).slice(0, 200));
}

// First line of every non-merge commit in the last 24h (GITHUB_TOKEN needed if the repo is private).
async function recentCommits() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'goatlab-digest' };
  if (process.env.GITHUB_TOKEN) headers.authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const r = await fetch('https://api.github.com/repos/' + REPO + '/commits?since=' + since + '&per_page=30', { headers });
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error('github ' + r.status);
  return list.filter(c => ((c.parents || []).length < 2))
    .map(c => String((c.commit && c.commit.message) || '').split('\n')[0].trim())
    .filter(m => m && !/^merge/i.test(m));
}

// Dev-speak → player-speak. No SDK on purpose (repo is zero-dependency server-side); raw Messages API.
async function playerSpeak(lines) {
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return lines.map(l => '• ' + l);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 700,
      system: 'You write daily patch notes for GoatLab (goat-lab.app), a family of free browser sports games — build-a-player draft games, career sims, 1v1 battles, and roguelike roster builders across baseball, basketball, football, soccer, hockey and more. The user message is raw git commit messages from the last 24 hours. Rewrite them as short, fun, player-facing patch notes: one "• " bullet per meaningful change, at most 8 bullets, plain English, no developer jargon, no file names, no commit hashes. Merge related commits into one bullet. SKIP internal-only work (refactors, tooling, docs, data-pipeline tweaks players cannot see). If nothing is player-facing, reply with exactly: NOTHING. Output only the bullet lines.',
      messages: [{ role: 'user', content: lines.join('\n') }],
    }),
  });
  const j = await r.json();
  if (!j || j.stop_reason === 'refusal') return lines.map(l => '• ' + l);
  const txt = (j.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('').trim();
  if (!txt) return lines.map(l => '• ' + l);
  if (/^NOTHING\.?$/i.test(txt)) return [];
  return txt.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 10);
}

module.exports = async (req, res) => {
  if (!sql) return res.status(500).json({ ok: false, error: 'Database not configured' });
  const q = req.query || {};
  const CRON_SECRET = process.env.CRON_SECRET || '';
  const isCron = !!CRON_SECRET && (req.headers && req.headers.authorization) === 'Bearer ' + CRON_SECRET;
  const isManual = (q.token || '') === STATS_TOKEN;
  if (CRON_SECRET && !isCron && !isManual) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const dry = q.dry === '1';
  const force = q.force === '1' && isManual;

  const out = { ok: true, dry };
  try {
    await sql`CREATE TABLE IF NOT EXISTS discord_posts (
      kind text NOT NULL, post_date date NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, post_date))`;
    await sql`CREATE TABLE IF NOT EXISTS coin_ledger (
      id bigserial PRIMARY KEY, player_key text NOT NULL, delta int NOT NULL, reason text,
      ref text UNIQUE, created_at timestamptz NOT NULL DEFAULT now())`;
    const today = new Date().toISOString().slice(0, 10);
    const reportDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    out.reportDate = reportDate;

    // ---------- 1. Daily digest: top players + coin payouts + studs ----------
    const HOOK_DAILY = findHook(/RANKING/i, 'DISCORD_WEBHOOK_RANKINGS', 'DISCORD_WEBHOOK_DAILY');
    if (!HOOK_DAILY) out.daily = 'skipped: no rankings webhook env set';
    else {
      let claimed = true;
      if (!dry && !force) {
        // Claim BEFORE composing/posting (same posture as push-cron): a crash mid-post must
        // never let a retry double-post. ?force=1 recovers a burned day.
        const ins = await sql`INSERT INTO discord_posts (kind, post_date) VALUES ('daily', ${today})
          ON CONFLICT DO NOTHING RETURNING kind`;
        claimed = ins.length > 0;
      }
      if (!claimed) out.daily = 'already posted today';
      else {
        const amounts = (Catalog.EARN && Catalog.EARN.dailyTop) || [100, 50, 25];
        const fields = [];
        let paid = 0, winners = 0;
        for (const [game, label] of DAILY_GAMES) {
          const rows = await sql`SELECT player_key, name, ovr FROM daily_scores
            WHERE game = ${game} AND challenge_date = ${reportDate}::date
            ORDER BY ovr DESC, created_at ASC LIMIT 3`;
          if (!rows.length) continue;
          fields.push({
            name: label, inline: true,
            value: rows.map((r, i) => {
              const coin = String(r.player_key || '').indexOf('acct:') === 0 && amounts[i]
                ? ' (+' + amounts[i] + ' 🪙)' : '';
              return MEDALS[i] + ' **' + cleanName(r.name) + '** — ' + r.ovr + ' OVR' + coin;
            }).join('\n'),
          });
          if (dry) continue;
          for (let i = 0; i < rows.length && i < amounts.length; i++) {
            const key = String(rows[i].player_key || '');
            if (key.indexOf('acct:') !== 0) continue;   // guests podium but can't hold coins
            const sub = key.slice(5), amt = amounts[i];
            try {
              const led = await sql`INSERT INTO coin_ledger (player_key, delta, reason, ref)
                VALUES (${sub}, ${amt}, 'dailytop', ${'dailytop:' + reportDate + ':' + game + ':' + sub})
                ON CONFLICT (ref) DO NOTHING RETURNING id`;
              if (led.length) {
                await sql`UPDATE users SET coins = GREATEST(0, COALESCE(coins, 0) + ${amt})
                  WHERE google_sub = ${sub}`;
                paid += amt; winners++;
              }
            } catch (e) {}
          }
        }

        // Best GOAT Squad run per sport yesterday (scores table, sorted by fights beaten).
        try {
          const lines = [];
          for (const [game, label] of SQUAD_GAMES) {
            const [r] = await sql`SELECT name, ovr, build FROM scores
              WHERE game = ${game} AND created_at >= ${reportDate}::date
                AND created_at < ${reportDate}::date + INTERVAL '1 day'
              ORDER BY COALESCE((build->'career'->'totals'->>'w')::int, 0) DESC, ovr DESC LIMIT 1`;
            if (!r) continue;
            const b = r.build || {};
            const w = Number((((b.career || {}).totals) || {}).w || 0);
            const champ = (b.rr || {}).champion ? ' 👑' : '';
            lines.push(label + ': **' + cleanName(r.name) + '** — ' + w + ' fights · ' + r.ovr + ' OVR' + champ);
          }
          if (lines.length) fields.push({ name: '🐐 GOAT Squad — best runs', value: lines.join('\n'), inline: false });
        } catch (e) {}

        if (!fields.length) out.daily = 'no runs yesterday — nothing to post';
        else {
          const [{ total }] = await sql`SELECT count(*)::int AS total FROM daily_scores
            WHERE challenge_date = ${reportDate}::date`;
          const embeds = [{
            title: '📊 GoatLab Daily Report — ' + new Date(reportDate + 'T12:00:00Z').toUTCString().slice(0, 11),
            color: 0x22d3ee,
            description: '**' + total + '** daily challenge runs yesterday. Top 3 per game win **'
              + amounts.join(' / ') + ' Goat Coins** (signed-in players — coins are already in your wallet).\n'
              + '▶️ Today\'s challenges are live: ' + SITE,
            fields,
            footer: { text: 'GoatLab · goat-lab.app' },
          }];
          // Studs: self-fetch computes/caches today's list if this is the first request of the day.
          try {
            const host = (req.headers && req.headers.host) || 'pitchinglab.pitchergami.com';
            const hot = await fetch('https://' + host + '/api/hot').then(r => r.json());
            const players = ((hot && hot.players) || []).slice(0, 5);
            if (players.length) embeds.push({
              title: '🔥 Last Night\'s Studs — boosted in-game today',
              color: 0xf97316,
              description: players.map(p =>
                '**' + esc(p.name) + '** (' + p.team + ') — ' + p.line + ' · +' + p.boost + ' boost').join('\n'),
            });
          } catch (e) {}
          if (dry) out.daily = { wouldPost: true, embeds };
          else {
            await postWebhook(HOOK_DAILY, { username: 'GoatLab Bot', embeds });
            out.daily = { posted: true, games: fields.length, runs: Number(total), coinsPaid: paid, winnersPaid: winners };
          }
        }
      }
    }

    // ---------- 2. Patch notes: last 24h of commits → player-speak ----------
    const HOOK_PATCH = findHook(/UPDATE/i, 'DISCORD_WEBHOOK_UPDATES', 'DISCORD_WEBHOOK_PATCH');
    if (!HOOK_PATCH) out.patch = 'skipped: no updates webhook env set';
    else {
      let claimed = true;
      if (!dry && !force) {
        const ins = await sql`INSERT INTO discord_posts (kind, post_date) VALUES ('patch', ${today})
          ON CONFLICT DO NOTHING RETURNING kind`;
        claimed = ins.length > 0;
      }
      if (!claimed) out.patch = 'already posted today';
      else {
        let commits = null;
        try { commits = await recentCommits(); }
        catch (e) { out.patch = 'github unavailable: ' + String(e.message || e).slice(0, 120); }
        if (commits && !commits.length) out.patch = 'no commits in the last 24h';
        else if (commits) {
          let bullets;
          try { bullets = await playerSpeak(commits); }
          catch (e) { bullets = commits.map(l => '• ' + l); }
          if (!bullets.length) out.patch = 'no player-facing changes in the last 24h';
          else {
            const embed = {
              title: '🛠️ What\'s New',
              color: 0x4ade80,
              description: bullets.join('\n').slice(0, 3900),
              footer: { text: 'Fresh updates are live at goat-lab.app' },
            };
            if (dry) out.patch = { wouldPost: true, embed, commits };
            else {
              await postWebhook(HOOK_PATCH, { username: 'GoatLab Bot', embeds: [embed] });
              out.patch = { posted: true, bullets: bullets.length };
            }
          }
        }
      }
    }
  } catch (e) {
    out.ok = false;
    out.error = String(e.message || e).slice(0, 300);
  }
  return res.status(out.ok ? 200 : 500).json(out);
};
