/* GoatLab native shim - injected FIRST into every bundled page by build-www.js.
   App-only behavior (does nothing on the website):
   1. /api/* fetches rewrite to the live production API (no same-origin server in the shell)
   2. first-launch ONBOARDING: welcome -> 3 tutorial cards -> Sign in with Apple or guest
   3. Sign in with Apple -> POST loginApple -> the same pl_account the whole site reads
   4. haptic taps on buttons, external links open outside the webview, offline wall */
(function () {
  'use strict';
  var API = 'https://pitchinglab.pitchergami.com';
  var cap = window.Capacitor;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform())
    || location.protocol === 'capacitor:';
  var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  window.GOATLAB_NATIVE = isNative || undefined;
  if (!isNative && !isLocal) return;   // on the real website: do nothing

  /* ---- /api/* -> production ---- */
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
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      try { if (typeof url === 'string' && url.indexOf('/api/') === 0) url = API + url; } catch (e) {}
      return origBeacon(url, data);
    };
  }

  if (!isNative) return;   // preview server gets the API rewrite only; the rest is device-only

  var plugins = (cap && cap.Plugins) || {};

  /* ---- native feel: no long-press text-selection on game UI, no tap flash,
     no rubber-band overscroll; inputs stay selectable. Tab bar hides under the
     keyboard (kb-open) so it doesn't ride up mid-screen while typing a name. */
  var nativeCss = document.createElement('style');
  nativeCss.textContent =
    'body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;' +
    '-webkit-tap-highlight-color:transparent;overscroll-behavior-y:none}' +
    'input,textarea,[contenteditable="true"]{-webkit-user-select:text;user-select:text}' +
    'html.kb-open .gnav{display:none!important}';
  (document.head || document.documentElement).appendChild(nativeCss);
  if (plugins.Keyboard) {
    plugins.Keyboard.addListener('keyboardWillShow', function () { document.documentElement.classList.add('kb-open'); });
    plugins.Keyboard.addListener('keyboardWillHide', function () { document.documentElement.classList.remove('kb-open'); });
  }

  /* ---- splash: cut it the moment the page is actually ready (config keeps a
     1.5s failsafe auto-hide in case this never runs) ---- */
  window.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { try { if (plugins.SplashScreen) plugins.SplashScreen.hide(); } catch (e) {} }, 120);
  });

  /* ---- rate-app prompt at a happy moment: right after finishing a career sim.
     Asks after the 2nd and 6th career, once each; Apple further rate-limits. ---- */
  function maybeAskReview() {
    try {
      var n = (parseInt(localStorage.getItem('pl_careers') || '0', 10) || 0) + 1;
      localStorage.setItem('pl_careers', String(n));
      if ((n === 2 || n === 6) && plugins.InAppReview) {
        setTimeout(function () { try { plugins.InAppReview.requestReview(); } catch (e) {} }, 2500);
      }
    } catch (e) {}
  }
  var xpTries = 0;
  (function wrapXp() {
    var xp = window.XP;
    if (xp && xp.award && !xp.__goatWrapped) {
      var orig = xp.award.bind(xp);
      xp.__goatWrapped = true;
      xp.award = function (amt, reason) { if (reason === 'career') maybeAskReview(); return orig.apply(null, arguments); };
    } else if (!xp || !xp.__goatWrapped) {
      if (++xpTries < 40) setTimeout(wrapXp, 500);
    }
  })();

  /* ---- haptics: a light tick on real button taps ---- */
  var lastTap = 0;
  document.addEventListener('click', function (e) {
    try {
      if (!plugins.Haptics) return;
      var t = e.target && e.target.closest && e.target.closest('button, .btn, .gnav-tab, .mtile, .soc-btn, .frtab, .pickrow, .seat');
      if (!t) return;
      var now = Date.now();
      if (now - lastTap < 90) return;
      lastTap = now;
      plugins.Haptics.impact({ style: 'LIGHT' });
    } catch (err) {}
  }, true);

  /* ---- external links leave the webview politely ---- */
  document.addEventListener('click', function (e) {
    try {
      var a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;
      if (href.indexOf(API) === 0) return;   // our own host stays inside
      e.preventDefault();
      e.stopPropagation();
      if (plugins.Browser) plugins.Browser.open({ url: href });
    } catch (err) {}
  }, true);

  /* ---- offline wall (App Review tests airplane mode) ---- */
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

  /* ---- first-launch onboarding: welcome -> how it works -> sign in or guest ---- */
  function acct() { try { return JSON.parse(localStorage.getItem('pl_account') || 'null'); } catch (e) { return null; } }
  function obDone() { try { return localStorage.getItem('pl_ob_done') === '1'; } catch (e) { return false; } }
  function markOb() { try { localStorage.setItem('pl_ob_done', '1'); } catch (e) {} }

  /* ---- push notifications: streaks, friend requests, challenges ---- */
  function pushCreds() {
    var a = acct();
    if (a && a.sub && a.sessionToken) return { sub: a.sub, sessionToken: a.sessionToken };
    var gid = null, gname = null;
    try { gid = localStorage.getItem('pl_guestId'); gname = localStorage.getItem('pl_guestName'); } catch (e) {}
    if (gid) return { guestId: gid, name: gname || 'Guest' };
    return null;
  }
  var pushWired = false;
  function setupPush() {
    var P = plugins.PushNotifications;
    var creds = pushCreds();
    if (!P || !creds || pushWired) return;
    pushWired = true;
    P.addListener('registration', function (t) {
      var body = Object.assign({ action: 'pushRegister', token: t.value, platform: 'ios' }, creds);
      fetch(API + '/api/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {});
    });
    P.addListener('pushNotificationActionPerformed', function (n) {
      try {
        var u = n && n.notification && n.notification.data && n.notification.data.url;
        if (u && u.charAt(0) === '/') location.href = u;
      } catch (e) {}
    });
    P.checkPermissions().then(function (s) {
      if (s.receive === 'granted') return P.register();
      if (s.receive === 'prompt') return P.requestPermissions().then(function (r) { if (r.receive === 'granted') P.register(); });
    }).catch(function () {});
  }

  var SLIDES = [
    { icon: '🐐', title: 'Welcome to GoatLab', body: 'Spin real pro cards, bolt their ratings onto your own player, and chase the perfect 99. Baseball, basketball, and soccer.' },
    { icon: '🛠️', title: 'Build & simulate', body: 'Fill every slot on the body, then simulate a whole career: seasons, awards, rings, and a Hall of Fame verdict.' },
    { icon: '🎯', title: 'Every day counts', body: 'The Daily Challenge gives everyone the same cards, one shot a day. Streaks, leaderboards, bragging rights.' },
    { icon: '🏟️', title: 'Go bigger', body: 'Face real people in live 1v1s, and run a whole franchise: sign your builds, trade, draft, win titles.' },
  ];

  function showOnboarding() {
    var ov = document.createElement('div');
    ov.id = 'goatOb';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9998;background:#0a1320;color:#eaf2fb;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;padding:32px 26px calc(34px + env(safe-area-inset-bottom));' +
      'font-family:-apple-system,Inter,sans-serif;text-align:center';
    document.documentElement.appendChild(ov);

    var idx = 0;
    function haptic() { try { if (plugins.Haptics) plugins.Haptics.impact({ style: 'LIGHT' }); } catch (e) {} }

    function renderSlide() {
      var last = idx === SLIDES.length - 1;
      var s = SLIDES[idx];
      ov.innerHTML =
        '<div style="flex:1"></div>' +
        '<div style="font-size:74px;line-height:1">' + s.icon + '</div>' +
        '<div style="font-size:24px;font-weight:800;margin-top:18px;letter-spacing:.3px">' + s.title + '</div>' +
        '<div style="font-size:15px;color:#8ea2bd;line-height:1.55;margin-top:10px;max-width:320px">' + s.body + '</div>' +
        '<div style="flex:1"></div>' +
        '<div style="display:flex;gap:7px;margin-bottom:22px">' + SLIDES.map(function (_, i) {
          return '<span style="width:8px;height:8px;border-radius:50%;background:' + (i === idx ? '#ff7a18' : '#26344a') + '"></span>';
        }).join('') + '</div>' +
        (last ? authButtons() :
          '<button id="obNext" style="width:100%;max-width:340px;padding:16px;border-radius:14px;border:none;font-size:16px;' +
          'font-weight:700;background:linear-gradient(180deg,#ffb02e,#ff7a18);color:#14202e">Continue</button>' +
          '<button id="obSkip" style="margin-top:12px;background:none;border:none;color:#56627a;font-size:13px;padding:8px">Skip</button>');
      var next = document.getElementById('obNext');
      if (next) next.onclick = function () { haptic(); idx++; renderSlide(); };
      var skip = document.getElementById('obSkip');
      if (skip) skip.onclick = function () { haptic(); idx = SLIDES.length - 1; renderSlide(); };
      wireAuth();
    }

    function authButtons() {
      return '<div id="obErr" style="color:#ff8c96;font-size:12.5px;min-height:17px;margin-bottom:6px"></div>' +
        '<button id="obApple" style="width:100%;max-width:340px;padding:16px;border-radius:14px;border:none;font-size:16px;' +
        'font-weight:700;background:#fff;color:#000;display:flex;align-items:center;justify-content:center;gap:8px">' +
        '<span style="font-size:19px"></span> Sign in with Apple</button>' +
        '<div style="font-size:11.5px;color:#56627a;margin:10px 0 2px;max-width:320px">Keeps your Hall of Fame, friends, ' +
        'franchises, and 1v1 rating on every device.</div>' +
        '<button id="obGuest" style="margin-top:10px;background:none;border:1px solid #26344a;border-radius:14px;' +
        'color:#8ea2bd;font-size:14px;padding:13px 30px;width:100%;max-width:340px">Play as guest</button>' +
        '<div style="font-size:10.5px;color:#3d495e;margin-top:9px">You can sign in any time from your 👤 Profile.</div>';
    }

    function wireAuth() {
      var ap = document.getElementById('obApple');
      var gu = document.getElementById('obGuest');
      if (gu) gu.onclick = function () { haptic(); markOb(); ov.remove(); setTimeout(setupPush, 1200); };
      if (!ap) return;
      // no plugin (old build) -> hide the Apple button gracefully
      if (!plugins.SignInWithApple) { ap.style.display = 'none'; return; }
      ap.onclick = function () {
        haptic();
        var err = document.getElementById('obErr');
        ap.disabled = true; ap.style.opacity = '.6';
        plugins.SignInWithApple.authorize({
          clientId: 'com.wolfflabs.goatlab',
          scopes: 'name email',
        }).then(function (r) {
          var resp = (r && r.response) || {};
          var fullName = [resp.givenName, resp.familyName].filter(Boolean).join(' ');
          return fetch(API + '/api/account', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'loginApple', identityToken: resp.identityToken, name: fullName }),
          }).then(function (x) { return x.json(); });
        }).then(function (j) {
          if (!j || !j.ok) throw new Error((j && j.error) || 'Sign-in failed');
          try {
            localStorage.setItem('pl_account', JSON.stringify({ sub: j.sub, email: j.email || '', name: j.name, picture: '', sessionToken: j.sessionToken }));
            if (j.handle) localStorage.setItem('pl_guestName', j.handle);
          } catch (e) {}
          markOb();
          location.reload();   // every page picks the account up from pl_account
        }).catch(function (e) {
          ap.disabled = false; ap.style.opacity = '1';
          // user cancelled -> quiet; real failure -> show it
          var m = String((e && e.message) || e);
          if (err && !/cancel|1001/i.test(m)) err.textContent = 'Sign-in didn\'t go through. Try again or play as guest.';
        });
      };
    }

    renderSlide();
  }

  window.addEventListener('DOMContentLoaded', function () {
    if (obDone() || acct()) {
      // returning user: (re-)register for pushes quietly after the page settles
      setTimeout(setupPush, 3000);
      return;
    }
    // only the entry page interrupts with onboarding; deep pages never do
    var p = location.pathname;
    if (p !== '/' && p.indexOf('index.html') < 0) return;
    setTimeout(showOnboarding, 350);
  });
})();
