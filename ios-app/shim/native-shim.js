/* GoatLab native shim - injected FIRST into every bundled page by build-www.js.
   Inside the Capacitor shell there is no same-origin server, so:
   1. every fetch to /api/* is rewritten to the live production API;
   2. the page is flagged native (window.GOATLAB_NATIVE) so scripts can adapt;
   3. if the API is unreachable at boot, a styled offline screen shows instead of
      a broken page (App Review tests airplane mode). */
(function () {
  'use strict';
  var API = 'https://pitchinglab.pitchergami.com';
  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    || location.protocol === 'capacitor:'
    || (location.protocol === 'file:' && /goatlab/i.test(navigator.userAgent + ''));
  // Capacitor injects window.Capacitor before page scripts on iOS; the extra checks are
  // belt-and-suspenders for early execution order.
  window.GOATLAB_NATIVE = isNative || undefined;
  if (!isNative && location.hostname !== 'localhost') return;   // on the real site: do nothing

  // ---- /api/* -> production ----
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      if (typeof input === 'string' && input.indexOf('/api/') === 0) input = API + input;
      else if (input && typeof input.url === 'string' && input.url.indexOf('/api/') === 0) {
        input = new Request(API + input.url, input);
      }
    } catch (e) {}
    return origFetch(input, init);
  };
  // sendBeacon is used for presence/leave pings
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      try { if (typeof url === 'string' && url.indexOf('/api/') === 0) url = API + url; } catch (e) {}
      return origBeacon(url, data);
    };
  }

  // ---- offline guard: if the very first API probe fails hard, show a friendly wall ----
  window.addEventListener('DOMContentLoaded', function () {
    if (navigator.onLine !== false) return;
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0a1320;color:#eaf2fb;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;' +
      'font-family:-apple-system,Inter,sans-serif;text-align:center;padding:30px';
    d.innerHTML = '<div style="font-size:52px">🐐</div>' +
      '<div style="font-size:19px;font-weight:700">You\'re offline</div>' +
      '<div style="font-size:13px;color:#8ea2bd;max-width:280px">GoatLab needs a connection for ' +
      'leaderboards, dailies and 1v1s. Your franchise saves are safe on this device.</div>' +
      '<button style="margin-top:8px;padding:12px 26px;border-radius:10px;border:none;font-weight:700;' +
      'background:linear-gradient(180deg,#ffb02e,#ff7a18);color:#14202e" ' +
      'onclick="location.reload()">Try again</button>';
    document.body.appendChild(d);
    window.addEventListener('online', function () { location.reload(); }, { once: true });
  });
})();
