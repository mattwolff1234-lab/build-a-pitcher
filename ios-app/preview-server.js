// iOS app preview: serves the built bundle (www/) inside an iPhone frame.
//   cd ios-app && node build-www.js && node preview-server.js
// then open http://localhost:8378
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.join(__dirname, 'www');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/preview') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(path.join(__dirname, 'preview.html'))); return; }
  if (p === '/assets-icon.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(fs.readFileSync(path.join(__dirname, 'assets', 'logo.png'))); return; }
  const f = path.join(WWW, p);
  if (!f.startsWith(WWW)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(8378, () => console.log('GoatLab app preview -> http://localhost:8378  (Ctrl+C to stop)'));
