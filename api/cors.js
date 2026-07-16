// Permissive CORS for the bundled iOS/Capacitor app. The app's WebView runs from a
// different origin (capacitor://localhost) than the live API, so every cross-origin
// request triggers a browser CORS check; without these headers the preflight OPTIONS
// is rejected and the real request (sign-in, save, leaderboard, friends, ...) never
// fires. The website itself is same-origin, so this is a no-op there. Auth is a token
// in the body/query (never a cookie), so Allow-Origin:* exposes nothing new.
// Returns true if it already ended the response (an OPTIONS preflight) — callers must
// `if (cors(req, res)) return;` as the very first line of the handler.
module.exports = function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'content-type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
};
