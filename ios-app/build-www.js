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
  'versus-soccer.html', 'franchise.html', 'franchise-hoops.html', 'franchise-soccer.html',
  'college.html', 'privacy.html',
];
const SCRIPTS = [
  'switcher.js', 'social.js', 'xp.js', 'achievements.js', 'hotboard.js', 'quests.js',
  'season-track.js', 'streak-pop.js', 'share-card.js', 'collection.js', 'namefilter.js',
  // Goat Coins store · store.js hides real-money purchases at runtime inside the Capacitor
  // shell (window.Capacitor check — Apple requires IAP for digital currency); spending stays.
  'catalog.js', 'store.js',
];
const DATA = ['pitchers.json', 'batters.json', 'ballers.json', 'strikers.json', 'keepers.json', 'cfb.json'];
const ASSET_DIRS = ['avatars', 'baseball-anim', 'hoops-anim', 'soccer-anim'];
const ASSET_GLOBS = ['.png', '.webp', '.svg', '.webmanifest', '.ico'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// shim goes in first so pages can reference it
fs.copyFileSync(path.join(__dirname, 'shim', 'native-shim.js'), path.join(OUT, 'native-shim.js'));

let pages = 0, assets = 0, skipped = [];
for (const f of PAGES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { skipped.push(f); continue; }
  let html = fs.readFileSync(src, 'utf8');
  // 1. native shim first, before any other script
  html = html.replace('<head>', '<head>\n<script src="/native-shim.js"></script>');
  // 2. strip Playwire (comment marker through the ramp.js tag, plus the ad-safe style is harmless to keep)
  html = html.replace(/<!-- Playwire Ramp[\s\S]*?cdn\.intergient\.com[^>]*><\/script>/, '<!-- Playwire stripped for native build (web ad tags are invalid in apps) -->');
  // 3. strip Google Sign-In (web GSI is blocked inside app WebViews)
  html = html.replace(/<script[^>]*accounts\.google\.com\/gsi\/client[^>]*><\/script>/, '<!-- GSI stripped for native build (Sign in with Apple lands in v1.1) -->');
  // 4. strip the "powered by Playwire" footer badge (no ads in the app)
  html = html.replace(/<p>(?:(?!<\/p>)[\s\S])*playwire\.com(?:(?!<\/p>)[\s\S])*<\/p>/g, '');
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

console.log(`www/ built: ${pages} pages, ${assets} asset groups.`);
if (skipped.length) console.log('skipped (not found):', skipped.join(', '));
console.log('Next: npx cap sync ios');
