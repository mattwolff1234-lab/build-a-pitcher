/* Pitching Lab — X (Twitter) scraper for viral sports-game tweets.
 *
 *   X_BEARER_TOKEN=xxxxx node scrape-x-tweets.js [flags]
 *
 * Pulls, de-dupes, ranks, and digests two kinds of tweets from the X API v2,
 * tuned for the "perfect-season / build-a-team" browser-game genre this repo
 * lives in:
 *   1. ANNOUNCEMENT tweets — a dev launching a game
 *      ("Inspired by 82-0, I built a baseball variation…"). The viral launch
 *      template worth copying for a Pitching Lab / Batting Lab drop.
 *   2. QUOTE-TWEETS & REACTIONS — people posting their teams, roasting the
 *      game, "can you go 82-0?" dunks. The organic spread.
 * Covers the whole family: 82-0 (NBA), 162-0 (MLB), 17-0 (NFL), 38-0 (EPL),
 * 7a0 (World Cup), 98-0 (NHL), 20-0 (fantasy FB), plus generic "build a player"
 * launches — and the extra terms you named (73-9, 36-0).
 *
 * ── Auth ──────────────────────────────────────────────────────────────────
 * Set X_BEARER_TOKEN (or TWITTER_BEARER_TOKEN) to an App-only Bearer token from
 * developer.x.com. Search REQUIRES a paid access level:
 *   • Basic ($200/mo) → recent search (last ~7 days), ~15k tweets/mo cap.
 *   • Pro / Enterprise → full-archive search via --archive (back to 2006).
 *   • Free tier CANNOT search (returns 403) — this script says so if that's you.
 *
 * ── Output (written next to this script) ───────────────────────────────────
 *   x-tweets.json       — structured, de-duped, engagement-ranked records.
 *   x-tweets-digest.md  — readable digest: top announcements, top quote-tweets,
 *                         per-game breakdown (the viral playbook at a glance).
 *
 * ── Flags ──────────────────────────────────────────────────────────────────
 *   --max N        hard cap on tweets fetched across all queries (default 300).
 *                  Mind your monthly Tweet cap — Basic is ~15k/mo.
 *   --pages N      pages (100 tweets each) to pull PER query (default 1).
 *   --min-likes N  drop tweets below N likes before writing (default 0).
 *   --recency      sort each query by recency instead of relevancy (default).
 *   --archive      full-archive search (Pro/Enterprise only).
 *   --since DATE   --archive only: earliest date YYYY-MM-DD (default 2026-05-01).
 *   --until DATE   --archive only: latest date YYYY-MM-DD.
 *   --lang CODE    language filter (default en). --all-langs to disable.
 *   --all-langs    don't filter by language (catches 7a0 Portuguese, etc.).
 *   --query "..."  add one extra raw X query on top of the built-in set.
 *   --out PREFIX   output filename prefix (default x-tweets).
 *   --dry-run      print the resolved queries + config and exit (no API calls).
 */

const fs = require('fs');

const TOKEN = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN || '';
const API = 'https://api.twitter.com/2/tweets/search';

// ── CLI parsing ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = name => argv.includes('--' + name);
const val = (name, def) => {
  const i = argv.indexOf('--' + name);
  if (i === -1) return def;
  const nx = argv[i + 1];
  return (nx !== undefined && !nx.startsWith('--')) ? nx : true;
};
const OPTS = {
  max: +val('max', 300),
  pages: Math.max(1, +val('pages', 1)),
  perPage: 100,                       // 10–100 (recent) / –500 (archive); 100 is safe on both
  minLikes: +val('min-likes', 0),
  sort: has('recency') ? 'recency' : 'relevancy',
  archive: has('archive'),
  since: String(val('since', '2026-05-01')),
  until: String(val('until', '')),
  lang: has('all-langs') ? '' : String(val('lang', 'en')),
  extraQuery: has('query') ? String(val('query', '')) : '',
  out: String(val('out', 'x-tweets')),
  dryRun: has('dry-run'),
};

// ── The game family ────────────────────────────────────────────────────────
// `terms`   = phrases that identify the game in tweet text.
// `domains` = sites the game lives on, matched via the url: operator — far more
//             precise than a bare score like "17-0", which matches countless
//             unrelated tweets.
const GAMES = [
  { key: '82-0',           sport: 'NBA',            terms: ['82-0'],             domains: ['82-0.com'] },
  { key: '162-0',          sport: 'MLB',            terms: ['162-0'],            domains: ['162-0.com', '162-0.net', 'mlb162-0.com', 'diamond-draft.app', 'pennantchase.com'] },
  { key: '17-0',           sport: 'NFL',            terms: ['17-0'],             domains: ['perthirtysix.com'] },
  { key: '38-0',           sport: 'Premier League', terms: ['38-0'],             domains: [] },
  { key: '7a0',            sport: 'World Cup',      terms: ['7a0', 'sete a zero'], domains: ['7a0.com.br'] },
  { key: '98-0',           sport: 'NHL',            terms: ['98-0'],             domains: [] },
  { key: '20-0',           sport: 'Fantasy FB',     terms: ['20-0'],             domains: ['20-0.com'] },
  { key: 'build-a-player', sport: 'generic',        terms: ['build a player', 'build-a-player', 'build a pitcher', 'build a batter', 'build a quarterback', 'build a striker'], domains: ['pitchinglab.pitchergami.com'] },
  // Extra terms you named — lower signal (73-9 is the Warriors-record meme;
  // 36-0 isn't confirmed as a game). Kept last so priority games fill first.
  { key: '73-9',           sport: 'NBA meme',       terms: ['73-9'],             domains: [] },
  { key: '36-0',           sport: 'unconfirmed',    terms: ['36-0'],             domains: [] },
];

// Context words that disambiguate a bare score from an actual game reference.
const CTX = '(roster OR lineup OR draft OR undefeated OR game OR "perfect season" OR play OR team OR spin)';

// ── Query builder ──────────────────────────────────────────────────────────
const LANG = OPTS.lang ? ` lang:${OPTS.lang}` : '';
const NORT = ' -is:retweet';
const quote = t => (t.includes(' ') ? `"${t}"` : t);
const orTerms = terms => '(' + terms.map(quote).join(' OR ') + ')';
const orUrls = domains => (domains.length ? '(' + domains.map(d => `url:"${d}"`).join(' OR ') + ')' : '');

function buildQueries() {
  const Q = [];
  const add = (label, category, q) => Q.push({ label, category, q: q.trim() });

  // 1) Genre-wide ANNOUNCEMENT templates (highest value — the launch playbook).
  add('announce:inspired-by', 'announcement',
    '("inspired by 82-0" OR "inspired by 162-0" OR "my version of 82-0" OR "my take on 82-0" OR "version of 82-0" OR "like 82-0 but")' + NORT + LANG);
  add('announce:i-built', 'announcement',
    '(("I built" OR "I made" OR "I created" OR "I coded" OR "vibe coded" OR "just launched" OR "just shipped" OR "just dropped") ' +
    '("build a" OR "perfect season" OR "draft game" OR "roster builder" OR "82-0" OR "162-0" OR "guess the"))' + NORT + LANG);

  // 2) Optional user-supplied extra query.
  if (OPTS.extraQuery) add('custom', 'game', OPTS.extraQuery);

  // 3) Per-game: precise url match, quote-tweets, and contextual mentions.
  for (const g of GAMES) {
    if (g.domains.length) add(`url:${g.key}`, 'game', orUrls(g.domains) + NORT + LANG);
    add(`quote:${g.key}`, 'quote', orTerms(g.terms) + ' is:quote' + LANG);
    add(`ctx:${g.key}`, 'game', orTerms(g.terms) + ' ' + CTX + NORT + LANG);
  }
  return Q;
}

// ── Classification / scoring (pure — also exercised by --dry-run self-check) ─
const ANNOUNCE_RE = /\b(i|we)\s+(built|made|created|coded|shipped|launched|dropped|designed)\b|\bvibe.?coded\b|\bjust (launched|shipped|dropped|built|made|released)\b|\binspired by \d+[-–]\d+\b|\bmy (version|take)\b/i;

function classify(t, text) {
  const refs = t.referenced_tweets || [];
  if (refs.some(r => r.type === 'quoted')) return 'quote';
  if (ANNOUNCE_RE.test(text)) return 'announcement';
  return 'reaction';
}

function detectGame(text, t) {
  const hay = (text || '').toLowerCase();
  const urls = ((t.entities && t.entities.urls) || [])
    .map(u => (u.expanded_url || u.display_url || u.url || '').toLowerCase()).join(' ');
  for (const g of GAMES) {
    if (g.terms.some(term => hay.includes(term.toLowerCase()))) return g.key;
    if (g.domains.some(d => urls.includes(d.toLowerCase()))) return g.key;
  }
  return null;
}

// Quote-tweets are the strongest virality signal for this genre ("look at my
// team" chains), so weight them hardest.
const viralScore = m =>
  (m.like_count || 0) + 2 * (m.retweet_count || 0) + 3 * (m.quote_count || 0) + 0.5 * (m.reply_count || 0);

// ── X API v2 request (rate-limit + tier aware) ─────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function xsearch(query, nextToken) {
  const params = new URLSearchParams({
    query,
    max_results: String(OPTS.perPage),
    sort_order: OPTS.sort,
    'tweet.fields': 'public_metrics,created_at,author_id,entities,referenced_tweets,note_tweet,lang',
    expansions: 'author_id,referenced_tweets.id,referenced_tweets.id.author_id',
    'user.fields': 'username,name,public_metrics,verified',
  });
  if (nextToken) params.set('next_token', nextToken);
  if (OPTS.archive) {
    if (OPTS.since) params.set('start_time', OPTS.since + 'T00:00:00Z');
    if (OPTS.until) params.set('end_time', OPTS.until + 'T00:00:00Z');
  }
  const url = `${API}/${OPTS.archive ? 'all' : 'recent'}?${params}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    let r;
    try {
      r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    } catch (e) {
      if (attempt < 4) { await sleep(1500 * (attempt + 1)); continue; }
      throw e;
    }
    if (r.status === 429) {                                   // rate limited — wait for reset
      const reset = +r.headers.get('x-rate-limit-reset') || 0;
      const waitMs = Math.min(16 * 60 * 1000, Math.max(2000, reset * 1000 - Date.now()));
      console.warn(`  ↳ rate limited, waiting ${Math.ceil(waitMs / 1000)}s…`);
      await sleep(waitMs);
      continue;
    }
    if (r.status === 401) throw new Error('401 Unauthorized — check X_BEARER_TOKEN (App-only Bearer token).');
    if (r.status === 403) {
      const body = await r.text().catch(() => '');
      throw new Error(
        `403 Forbidden — this token can't run ${OPTS.archive ? 'full-archive' : 'recent'} search. ` +
        `The Free tier has no search access; you need Basic (recent) or Pro/Enterprise (--archive). ${body.slice(0, 240)}`);
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      if (attempt < 4) { await sleep(1500 * (attempt + 1)); continue; }
      throw new Error(`HTTP ${r.status}: ${body.slice(0, 240)}`);
    }
    return r.json();
  }
}

// ── Collect ────────────────────────────────────────────────────────────────
async function collect(queries) {
  const usersById = new Map();     // author_id -> user
  const refTweets = new Map();     // tweet_id  -> quoted tweet
  const byId = new Map();          // tweet_id  -> raw tweet (de-duped across queries)

  outer:
  for (const { label, q } of queries) {
    let token = null, pulled = 0;
    for (let page = 0; page < OPTS.pages; page++) {
      if (byId.size >= OPTS.max) break outer;
      let res;
      try {
        res = await xsearch(q, token);
      } catch (e) {
        console.warn(`  ! query "${label}" failed: ${e.message}`);
        if (/40[13]/.test(e.message)) throw e;   // auth/tier errors are fatal, not per-query
        break;
      }
      const data = res.data || [];
      for (const u of (res.includes && res.includes.users) || []) if (!usersById.has(u.id)) usersById.set(u.id, u);
      for (const rt of (res.includes && res.includes.tweets) || []) if (!refTweets.has(rt.id)) refTweets.set(rt.id, rt);
      for (const t of data) if (!byId.has(t.id)) byId.set(t.id, t);
      pulled += data.length;
      token = res.meta && res.meta.next_token;
      console.log(`  [${label}] +${data.length} (total ${byId.size})`);
      if (!token) break;
      await sleep(1100);                         // gentle pacing between pages
    }
  }
  return { byId, usersById, refTweets };
}

function toRecord(t, usersById, refTweets) {
  const u = usersById.get(t.author_id) || {};
  const m = t.public_metrics || {};
  const text = (t.note_tweet && t.note_tweet.text) || t.text || '';
  let quoted = null;
  const ref = (t.referenced_tweets || []).find(r => r.type === 'quoted');
  if (ref) {
    const qt = refTweets.get(ref.id);
    if (qt) {
      const qu = usersById.get(qt.author_id) || {};
      quoted = { id: ref.id, author: qu.username || null, text: (qt.note_tweet && qt.note_tweet.text) || qt.text || '' };
    }
  }
  return {
    id: t.id,
    url: `https://x.com/${u.username || 'i'}/status/${t.id}`,
    author: {
      username: u.username || null,
      name: u.name || null,
      followers: (u.public_metrics && u.public_metrics.followers_count) || null,
      verified: !!u.verified,
    },
    createdAt: t.created_at || null,
    lang: t.lang || null,
    text,
    metrics: {
      like: m.like_count || 0, retweet: m.retweet_count || 0, reply: m.reply_count || 0,
      quote: m.quote_count || 0, bookmark: m.bookmark_count || 0, impression: m.impression_count || 0,
    },
    viralScore: viralScore(m),
    category: classify(t, text),
    game: detectGame(text, t),
    quoted,
  };
}

// ── Digest rendering ───────────────────────────────────────────────────────
const nf = n => (n == null ? '?' : n.toLocaleString('en-US'));
function block(r) {
  const a = r.author;
  const who = a.username ? `**@${a.username}**${a.verified ? ' ☑️' : ''}${a.followers != null ? ` · ${nf(a.followers)} followers` : ''}` : '**(unknown)**';
  const met = `❤️ ${nf(r.metrics.like)} · 🔁 ${nf(r.metrics.retweet)} · 💬 ${nf(r.metrics.quote)} · ↩️ ${nf(r.metrics.reply)}`;
  const when = r.createdAt ? r.createdAt.slice(0, 10) : '';
  const gtag = r.game ? ` \`${r.game}\`` : '';
  let out = `- ${who} · ${met} · ${when}${gtag}\n  > ${r.text.replace(/\n+/g, '\n  > ')}\n  ${r.url}`;
  if (r.quoted) out += `\n  ↳ QT of @${r.quoted.author || '?'}: “${(r.quoted.text || '').slice(0, 160).replace(/\n+/g, ' ')}”`;
  return out;
}

function digest(records) {
  const byScore = [...records].sort((a, b) => b.viralScore - a.viralScore);
  const announcements = byScore.filter(r => r.category === 'announcement');
  const quotes = byScore.filter(r => r.category === 'quote');
  const reactions = byScore.filter(r => r.category === 'reaction');

  const L = [];
  L.push(`# Viral sports-game tweets — digest`);
  L.push(`\n_Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${records.length} tweets · ${OPTS.archive ? 'full-archive' : 'recent (7d)'} search, sorted by ${OPTS.sort}._`);
  L.push(`\nEngagement score = likes + 2·retweets + 3·quotes + 0.5·replies (quote-tweets weighted hardest — they're this genre's virality engine).`);

  L.push(`\n## 🚀 Announcement tweets (the launch playbook) — ${announcements.length}`);
  L.push(announcements.length ? announcements.slice(0, 40).map(block).join('\n') : '_none found — widen with --archive or --all-langs._');

  L.push(`\n## 💬 Top quote-tweets & reaction chains — ${quotes.length}`);
  L.push(quotes.length ? quotes.slice(0, 40).map(block).join('\n') : '_none found._');

  L.push(`\n## 🔥 Other high-engagement mentions — ${reactions.length}`);
  L.push(reactions.length ? reactions.slice(0, 30).map(block).join('\n') : '_none found._');

  // Per-game breakdown table.
  L.push(`\n## 🎮 By game`);
  L.push(`\n| Game | Sport | Tweets | Top engagement |\n|---|---|---:|---|`);
  for (const g of GAMES) {
    const hits = records.filter(r => r.game === g.key);
    if (!hits.length) continue;
    const top = hits.sort((a, b) => b.viralScore - a.viralScore)[0];
    L.push(`| \`${g.key}\` | ${g.sport} | ${hits.length} | @${(top.author.username) || '?'} (${nf(top.metrics.like)}❤️) |`);
  }
  const untagged = records.filter(r => !r.game).length;
  if (untagged) L.push(`| _(untagged)_ | — | ${untagged} | — |`);
  return L.join('\n') + '\n';
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const queries = buildQueries();

  if (OPTS.dryRun) {
    console.log('DRY RUN — no API calls.\n');
    console.log('Config:', JSON.stringify({ ...OPTS }, null, 2));
    console.log(`\n${queries.length} queries:`);
    queries.forEach((q, i) => {
      const warn = q.q.length > 512 ? '  ⚠️ >512 chars' : '';
      console.log(`\n${String(i + 1).padStart(2)}. [${q.category}] ${q.label} (${q.q.length} chars)${warn}\n    ${q.q}`);
    });
    // Quick self-check of the pure classifiers so the logic is provably wired.
    const sample = { text: 'Inspired by 82-0, I built a baseball variation!', referenced_tweets: [], entities: { urls: [{ expanded_url: 'https://162-0.com' }] } };
    console.log('\nself-check classify:', classify(sample, sample.text), '| detectGame:', detectGame(sample.text, sample),
      '| viralScore{like:10,quote:4}:', viralScore({ like_count: 10, quote_count: 4 }));
    return;
  }

  if (!TOKEN) {
    console.error('✗ No token. Set X_BEARER_TOKEN (or TWITTER_BEARER_TOKEN) to an App-only Bearer token.');
    console.error('  Get one at developer.x.com → your app → Keys and tokens → Bearer Token.');
    console.error('  Search needs a paid tier (Basic/Pro). Run with --dry-run to preview queries without a token.');
    process.exit(1);
  }

  console.log(`Searching X (${OPTS.archive ? 'full-archive' : 'recent'}, sort=${OPTS.sort}, cap=${OPTS.max})…\n`);
  const { byId, usersById, refTweets } = await collect(queries);

  let records = [...byId.values()].map(t => toRecord(t, usersById, refTweets));
  if (OPTS.minLikes) records = records.filter(r => r.metrics.like >= OPTS.minLikes);
  records.sort((a, b) => b.viralScore - a.viralScore);

  const jsonPath = `${OPTS.out}.json`;
  const mdPath = `${OPTS.out}-digest.md`;
  fs.writeFileSync(jsonPath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    mode: OPTS.archive ? 'archive' : 'recent',
    sort: OPTS.sort,
    count: records.length,
    queries: queries.map(q => ({ label: q.label, category: q.category, q: q.q })),
    tweets: records,
  }, null, 2));
  fs.writeFileSync(mdPath, digest(records));

  const byCat = records.reduce((a, r) => (a[r.category] = (a[r.category] || 0) + 1, a), {});
  console.log(`\n✓ ${records.length} tweets → ${jsonPath} + ${mdPath}`);
  console.log(`  categories: ${JSON.stringify(byCat)}`);
  const top = records[0];
  if (top) console.log(`  most viral: @${top.author.username} — ${nf(top.metrics.like)}❤️ / ${nf(top.metrics.quote)}💬\n  ${top.url}`);
}

main().catch(e => { console.error('\n✗', e.message); process.exit(1); });
