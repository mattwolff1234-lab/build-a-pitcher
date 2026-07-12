/* ============================================================================
   GoatLab — creator referral capture (?ref=<code>).
   Dropped into every page right after xp.js: <script src="/ref.js" defer>.

   A visitor landing on ANY page with ?ref=koogs gets the code stored in
   localStorage `pl_ref` and a 30-day same-site cookie `pl_ref` (last-touch
   wins; a repeat visit without ?ref just refreshes the cookie's expiry).
   Attribution happens SERVER-side: same-origin fetches send the cookie
   automatically, so api/score.js can tag score/daily submissions and the
   play counter with zero per-game code. window.Ref.code() is exposed for
   anything that wants to read it explicitly.

   Codes are 2-32 chars of [a-z0-9_-] (lowercased); anything else is ignored.
   The ref param is scrubbed from the address bar after capture so copied
   links don't re-attribute.
   ========================================================================== */
(function () {
  'use strict';
  var KEY = 'pl_ref', DAYS = 30;

  function clean(v) {
    v = String(v == null ? '' : v).trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(v) ? v : null;
  }

  var fromUrl = null;
  try { fromUrl = clean(new URLSearchParams(location.search).get('ref')); } catch (e) {}

  var code = null;
  try {
    if (fromUrl) localStorage.setItem(KEY, fromUrl);
    code = fromUrl || clean(localStorage.getItem(KEY));
  } catch (e) { code = fromUrl; }

  if (code) {
    try { document.cookie = KEY + '=' + code + ';path=/;max-age=' + (DAYS * 86400) + ';samesite=lax'; } catch (e) {}
  }

  if (fromUrl) {
    try {
      var u = new URL(location.href);
      u.searchParams.delete('ref');
      history.replaceState(history.state, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash);
    } catch (e) {}
  }

  window.Ref = { code: function () { return code; } };
})();
