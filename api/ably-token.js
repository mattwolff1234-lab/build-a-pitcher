// Mints a short-lived Ably TokenRequest for the browser, signed server-side so the
// secret Ably key never leaves the server. The client's Ably SDK points its `authUrl`
// here. We sign the TokenRequest by hand with Node's crypto (no `ably` dependency).
//   GET/POST /api/ably-token?clientId=<id>
// Env: ABLY_API_KEY  (format "appId.keyId:keySecret", marked Sensitive in Vercel).

const crypto = require('crypto');

const API_KEY = process.env.ABLY_API_KEY || '';
const TTL_MS = 60 * 60 * 1000; // 1 hour

module.exports = async (req, res) => {
  if (!API_KEY || API_KEY.indexOf(':') === -1) {
    return res.status(500).json({ error: 'Ably not configured (set ABLY_API_KEY)' });
  }
  try {
    const colon = API_KEY.indexOf(':');
    const keyName = API_KEY.slice(0, colon);   // "appId.keyId"
    const keySecret = API_KEY.slice(colon + 1); // the secret half

    const q = req.query || {};
    const clientId = String((q.clientId || (req.body && req.body.clientId) || '')).slice(0, 64) || '*';
    const capability = JSON.stringify({ '*': ['subscribe', 'publish', 'presence'] });
    const ttl = TTL_MS;
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');

    // Ably's canonical TokenRequest signing string (order matters; trailing newline required).
    const signText = keyName + '\n' + ttl + '\n' + capability + '\n' + clientId + '\n' + timestamp + '\n' + nonce + '\n';
    const mac = crypto.createHmac('sha256', keySecret).update(signText).digest('base64');

    return res.status(200).json({ keyName, ttl, capability, clientId, timestamp, nonce, mac });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
