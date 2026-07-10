// Tiny local dev server for testing pages without Vercel: node dev-server.js
// Serves the repo on http://localhost:8377 with the pretty-route rewrites
// (/franchise, /pitching, /batting, ...) that vercel.json handles in prod.
// API routes (/api/*) are NOT served — account/leaderboard calls fail soft.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
const rewrites = {
  '/': '/index.html', '/franchise': '/franchise.html',
  '/franchise-hoops': '/franchise-hoops.html', '/franchise-soccer': '/franchise-soccer.html',
  '/pitching': '/pitcher.html',
  '/batting': '/build-a-batter.html', '/hoops': '/build-a-baller.html',
  '/striker': '/build-a-striker.html', '/keeper': '/build-a-keeper.html',
  '/versus': '/versus.html', '/versus-hoops': '/versus-hoops.html', '/versus-soccer': '/versus-soccer.html',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  p = rewrites[p] || p;
  const f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(8377, () => console.log('GoatLab dev server -> http://localhost:8377  (Ctrl+C to stop)'));
