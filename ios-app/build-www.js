// Builds the app's bundled web assets: repo root -> ios-app/www/
//   node build-www.js
// Per page it: injects native-shim.js first, strips the Playwire ad tags (web ad tags
// are policy-invalid inside a native app) and the Google Sign-In script (its web flow
// is blocked in app WebViews - v1 is guest-first; Sign in with Apple lands in v1.1).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(__dirname, 'www');

const PAGES = [
  'index.html', 'pitcher.html', 'build-a-batter.html', 'build-a-baller.html',
  'build-a-striker.html', 'build-a-keeper.html', 'versus.html', 'versus-hoops.html',
  'versus-soccer.html', 'versus-cfb.html', 'franchise.html', 'franchise-hoops.html',
  'franchise-soccer.html', 'college.html', 'hockey.html', 'monster.html',
  'goatsquad.html', 'goatsquad-baseball.html', 'goatsquad-football.html',
  'ranks.html', 'privacy.html', 'terms.html',
];
const SCRIPTS = [
  'switcher.js', 'social.js', 'xp.js', 'achievements.js', 'hotboard.js', 'quests.js',
  'season-track.js', 'streak-pop.js', 'share-card.js', 'collection.js', 'namefilter.js',
  'real-legends.js',
  // Goat Coins store · store.js hides real-money purchases at runtime inside the Capacitor
  // shell (window.Capacitor check — Apple requires IAP for digital currency); spending stays.
  'catalog.js', 'store.js', 'jerseys.js',
];
const DATA = ['pitchers.json', 'batters.json', 'ballers.json', 'strikers.json', 'keepers.json',
  'cfb.json', 'hockey.json', 'pokemon.json',
  // GOAT Squad: one config + one player pool per sport
  'goatsquad-nba.json', 'goatsquad-mlb.json', 'goatsquad-nfl.json',
  'squadball-mlb.json', 'squadfoot-nfl.json'];

// Clean routes ("/goatsquad") only exist because vercel.json rewrites them to a file.
// The app has no server, so every such link 404s inside the shell — pages ARE bundled
// but unreachable. Read the real rewrite table and swap those links for the actual
// file at build time, so the app can never drift from the site's routing.
function routeMap() {
  const map = new Map();
  try {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    for (const r of v.rewrites || []) {
      if (r.has || !r.source || !r.destination) continue;         // skip host-conditional redirects
      if (!/^\/[\w-]+$/.test(r.source)) continue;                 // simple one-segment routes only
      if (!/\.html$/.test(r.destination)) continue;
      const file = r.destination.replace(/^\//, '');
      if (PAGES.includes(file)) map.set(r.source, '/' + file);    // only routes we actually ship
    }
  } catch (e) {}
  return map;
}
const ROUTES = routeMap();
const ASSET_DIRS = ['avatars', 'baseball-anim', 'hoops-anim', 'soccer-anim'];
const ASSET_GLOBS = ['.png', '.webp', '.svg', '.webmanifest', '.ico'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// shim goes in first so pages can reference it
fs.copyFileSync(path.join(__dirname, 'shim', 'native-shim.js'), path.join(OUT, 'native-shim.js'));

// onboarding tutorial screenshots (app-only asset, lives in ios-app/assets/tutorial)
const TUT_SRC = path.join(__dirname, 'assets', 'tutorial');
if (fs.existsSync(TUT_SRC)) {
  fs.mkdirSync(path.join(OUT, 'tutorial'), { recursive: true });
  for (const f of fs.readdirSync(TUT_SRC)) {
    if (f.endsWith('.png')) fs.copyFileSync(path.join(TUT_SRC, f), path.join(OUT, 'tutorial', f));
  }
}

let pages = 0, assets = 0, rewrites = 0, skipped = [];
for (const f of PAGES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { skipped.push(f); continue; }
  let html = fs.readFileSync(src, 'utf8');
  // 1. native shim first, before any other script
  html = html.replace('<head>', '<head>\n<script src="/native-shim.js"></script>');
  // 2. strip Playwire. The tag is now a CONDITIONAL LOADER (two <script>s that append
  //    ramp.js at runtime), not a plain <script src>, so match the whole block from the
  //    marker through the loader's own </script>, then drop the ad-safe spacing <style>.
  //    Web ad tags inside a native app violate Playwire policy (would tank the account) —
  //    the post-build guard at the bottom of this file FAILS the build if any loader leaks.
  html = html.replace(/<!-- Playwire Ramp[\s\S]*?cdn\.intergient\.com[\s\S]*?<\/script>/,
    '<!-- Playwire stripped for native build (web ad tags are invalid in apps) -->');
  html = html.replace(/\n?[ \t]*<style>\s*\/\* Ad-safe mobile spacing[\s\S]*?<\/style>/, '');
  // 3. strip Google Sign-In (web GSI is blocked inside app WebViews)
  html = html.replace(/<script[^>]*accounts\.google\.com\/gsi\/client[^>]*><\/script>/, '<!-- GSI stripped for native build (native Apple/Google sign-in via the shim instead) -->');
  // 4. strip the "powered by Playwire" footer badge (no ads in the app)
  html = html.replace(/<p>(?:(?!<\/p>)[\s\S])*playwire\.com(?:(?!<\/p>)[\s\S])*<\/p>/g, '');
  // 5. point clean routes at real files — "/goatsquad" has no server to rewrite it here.
  //    Quote-delimited so "/goatsquad-nba.json" and friends are never touched; a #hash or
  //    ?query is carried through (/pitching#daily -> /pitcher.html#daily).
  for (const [route, file] of ROUTES) {
    const re = new RegExp('(["\'`])' + route.replace(/[-/]/g, '\\$&') + '((?:[#?][^"\'`]*)?)\\1', 'g');
    html = html.replace(re, (_m, q, tail) => q + file + tail + q);
    rewrites++;
  }
  fs.writeFileSync(path.join(OUT, f), html);
  pages++;
}
for (const f of SCRIPTS.concat(DATA)) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { skipped.push(f); continue; }
  fs.copyFileSync(src, path.join(OUT, f));
  assets++;
}
for (const f of fs.readdirSync(ROOT)) {
  if (ASSET_GLOBS.includes(path.extname(f))) {
    fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
    assets++;
  }
}
for (const dir of ASSET_DIRS) {
  const src = path.join(ROOT, dir);
  if (!fs.existsSync(src)) { skipped.push(dir + '/'); continue; }
  fs.cpSync(src, path.join(OUT, dir), { recursive: true });
  assets++;
}

// Guardrail: a web ad loader must NEVER reach the app bundle — it violates Playwire's
// policy and risks the whole ad account (see ads.md). If the strip above ever drifts from
// the tag format again, fail loudly here instead of silently shipping ads inside the app.
const adLeaks = fs.readdirSync(OUT)
  .filter(f => f.endsWith('.html'))
  .filter(f => fs.readFileSync(path.join(OUT, f), 'utf8').includes('cdn.intergient.com'));
if (adLeaks.length) {
  console.error('\nFATAL: Playwire ad loader survived native stripping in: ' + adLeaks.join(', '));
  console.error('The app must ship with NO web ad tags. Fix the strip in build-www.js (step 2).');
  process.exit(1);
}

console.log(`www/ built: ${pages} pages, ${assets} asset groups, ${ROUTES.size} clean routes rewritten to files.`);
if (skipped.length) console.log('skipped (not found):', skipped.join(', '));
console.log('Next: npx cap sync ios');
