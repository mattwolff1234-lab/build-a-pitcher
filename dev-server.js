// Tiny local dev server for testing pages without Vercel: node dev-server.js
// Serves the repo on http://localhost:8377 with the pretty-route rewrites
// (/franchise, /pitching, /batting, ...) that vercel.json handles in prod.
// /api/* PROXIES to the LIVE server (pitchinglab.pitchergami.com) so leaderboards,
// wallet, and store data are real — meaning sign-ins/spends/submits hit the real DB.
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const API_ORIGIN = 'https://pitchinglab.pitchergami.com';

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
  '/ranks': '/ranks.html',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/')) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const preq = https.request(API_ORIGIN + req.url, {
        method: req.method,
        headers: { 'content-type': req.headers['content-type'] || 'application/json' },
      }, pres => {
        res.writeHead(pres.statusCode, { 'content-type': pres.headers['content-type'] || 'application/json', 'cache-control': 'no-store' });
        pres.pipe(res);
      });
      preq.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        try { res.end('{"ok":false,"error":"api proxy failed"}'); } catch (e) {}
      });
      if (body.length) preq.write(body);
      preq.end();
    });
    return;
  }
  p = rewrites[p] || p;
  const f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(8377, () => console.log('GoatLab dev server -> http://localhost:8377  (Ctrl+C to stop)'));
