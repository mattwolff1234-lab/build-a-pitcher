// APNs sender - shared by api/account.js (friend/challenge pushes) and api/push-cron.js
// (streak reminders). Plain node:http2 + node:crypto, no dependencies.
// Env (Vercel): APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8 (the .p8 contents, raw or base64).
// Missing env -> sendPush() is a silent no-op, so this is safe to ship before the key exists.
'use strict';
const crypto = require('crypto');
const http2 = require('http2');

const TOPIC = 'com.wolfflabs.goatlab';
const HOST = 'https://api.push.apple.com';

let cachedJwt = null, cachedAt = 0;
function apnsJwt() {
  const keyId = process.env.APNS_KEY_ID, teamId = process.env.APNS_TEAM_ID;
  let p8 = process.env.APNS_KEY_P8 || '';
  if (!keyId || !teamId || !p8) return null;
  // Apple wants tokens refreshed between 20 and 60 minutes - cache 45.
  if (cachedJwt && Date.now() - cachedAt < 45 * 60 * 1000) return cachedJwt;
  if (!p8.includes('BEGIN PRIVATE KEY')) p8 = Buffer.from(p8, 'base64').toString('utf8');
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'ES256', kid: keyId }) + '.' + b64({ iss: teamId, iat: Math.floor(Date.now() / 1000) });
  cachedJwt = unsigned + '.' + crypto.sign('sha256', Buffer.from(unsigned), { key: p8, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  cachedAt = Date.now();
  return cachedJwt;
}

// sendPush(tokens, { title, body, data }) -> { sent, failed, dead: [tokens to delete] }
// dead = tokens Apple says are gone (uninstalled) - callers should remove them from the DB.
async function sendPush(tokens, { title, body, data }) {
  const jwt = apnsJwt();
  const out = { sent: 0, failed: 0, dead: [] };
  if (!jwt || !tokens || !tokens.length) return out;
  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: 'default' },
    ...(data ? { data } : {}),
  });
  const client = http2.connect(HOST);
  try {
    await Promise.all(tokens.map(t => new Promise(resolve => {
      const req = client.request({
        ':method': 'POST', ':path': '/3/device/' + t,
        authorization: 'bearer ' + jwt,
        'apns-topic': TOPIC, 'apns-push-type': 'alert', 'apns-priority': '10',
        'content-type': 'application/json',
      });
      let status = 0, resp = '';
      req.on('response', h => { status = h[':status']; });
      req.on('data', c => { resp += c; });
      req.on('end', () => {
        if (status === 200) out.sent++;
        else {
          out.failed++;
          if (status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(resp)) out.dead.push(t);
        }
        resolve();
      });
      req.on('error', () => { out.failed++; resolve(); });
      req.setTimeout(8000, () => { req.close(); });
      req.end(payload);
    })));
  } finally {
    client.close();
  }
  return out;
}

module.exports = { sendPush };
