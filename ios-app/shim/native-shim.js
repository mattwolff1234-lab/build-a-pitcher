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

  /* ---- native sign-in flows (Apple + Google) — shared by the first-launch
     onboarding and the in-menu account slot. Both end in the same pl_account
     localStorage the whole site reads; a reload picks the account up. ---- */
  function loginServer(body) {
    return fetch(API + '/api/account', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (x) { return x.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || 'Sign-in failed');
      try {
        localStorage.setItem('pl_account', JSON.stringify({ sub: j.sub, email: j.email || '', name: j.name, picture: j.picture || '', sessionToken: j.sessionToken }));
        if (j.handle) localStorage.setItem('pl_guestName', j.handle);
      } catch (e) {}
      return j;
    });
  }
  function signInApple() {
    return plugins.SignInWithApple.authorize({
      clientId: 'com.wolfflabs.goatlab',
      scopes: 'name email',
    }).then(function (r) {
      var resp = (r && r.response) || {};
      var fullName = [resp.givenName, resp.familyName].filter(Boolean).join(' ');
      return loginServer({ action: 'loginApple', identityToken: resp.identityToken, name: fullName });
    });
  }
  var GOOGLE_IOS_ID = '349698720898-3kkgcor4aoi0uhmeddugl2ao4vfh89ec.apps.googleusercontent.com';
  var googleReady = null;
  function signInGoogle() {
    var GA = plugins.GoogleAuth;
    // initialize is idempotent; the id also lives in capacitor.config.json as a fallback
    if (!googleReady) {
      googleReady = Promise.resolve()
        .then(function () { return GA.initialize({ clientId: GOOGLE_IOS_ID, iosClientId: GOOGLE_IOS_ID, scopes: ['profile', 'email'] }); })
        .catch(function () {});
    }
    return googleReady.then(function () { return GA.signIn(); }).then(function (u) {
      var tok = u && ((u.authentication && u.authentication.idToken) || u.idToken);
      if (!tok) throw new Error('No Google idToken');
      var gid = null; try { gid = localStorage.getItem('pl_guestId'); } catch (e) {}
      // same action the website uses — including adopting this device's guest streak
      return loginServer({ action: 'login', idToken: tok, guestId: gid || undefined });
    });
  }
  var G_SVG = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  // One HTML builder for both surfaces; ids are prefixed ('ob' onboarding / 'na' menu).
  function authButtonsHtml(p, withGuest) {
    return '<div id="' + p + 'Err" style="color:#ff8c96;font-size:12.5px;min-height:17px;margin-bottom:6px"></div>' +
      '<button id="' + p + 'Apple" style="width:100%;max-width:340px;padding:16px;border-radius:14px;border:none;font-size:16px;' +
      'font-weight:700;background:#fff;color:#000;display:flex;align-items:center;justify-content:center;gap:8px">' +
      '<span style="font-size:19px"></span> Sign in with Apple</button>' +
      '<button id="' + p + 'Google" style="width:100%;max-width:340px;margin-top:10px;padding:16px;border-radius:14px;border:none;font-size:16px;' +
      'font-weight:700;background:#fff;color:#1f1f1f;display:flex;align-items:center;justify-content:center;gap:8px">' +
      G_SVG + ' Sign in with Google</button>' +
      '<div style="font-size:11.5px;color:#56627a;margin:10px 0 2px;max-width:320px">Keeps your Hall of Fame, friends, ' +
      'franchises, and 1v1 rating on every device.</div>' +
      (withGuest ?
        '<button id="obGuest" style="margin-top:10px;background:none;border:1px solid #26344a;border-radius:14px;' +
        'color:#8ea2bd;font-size:14px;padding:13px 30px;width:100%;max-width:340px">Play as guest</button>' +
        '<div style="font-size:10.5px;color:#3d495e;margin-top:9px">You can sign in any time from your 👤 Profile.</div>' : '');
  }
  function wireAuthButtons(p, haptic) {
    function wire(id, plugin, flow) {
      var b = document.getElementById(id);
      if (!b) return;
      // no plugin (old build) -> hide that button gracefully
      if (!plugin) { b.style.display = 'none'; return; }
      b.onclick = function () {
        if (haptic) haptic();
        var err = document.getElementById(p + 'Err');
        b.disabled = true; b.style.opacity = '.6';
        flow().then(function () {
          markOb();
          location.reload();   // every page picks the account up from pl_account
        }).catch(function (e) {
          b.disabled = false; b.style.opacity = '1';
          // user cancelled -> quiet; real failure -> show it
          var m = String((e && e.message) || e);
          if (err && !/cancel|1001|12501|popup.?closed/i.test(m)) err.textContent = 'Sign-in didn\'t go through. Try again or play as guest.';
        });
      };
    }
    wire(p + 'Apple', plugins.SignInWithApple, signInApple);
    wire(p + 'Google', plugins.GoogleAuth, signInGoogle);
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

    function authButtons() { return authButtonsHtml('ob', true); }

    function wireAuth() {
      var gu = document.getElementById('obGuest');
      if (gu) gu.onclick = function () { haptic(); markOb(); ov.remove(); setTimeout(setupPush, 1200); };
      wireAuthButtons('ob', haptic);
    }

    renderSlide();
  }

  /* ---- signed-out ☰ menu: the site's account slot renders web-Google sign-in,
     which can't run inside a WebView — whenever a page draws it, swap in the
     native Apple/Google buttons instead (returning users' way to sign in). ---- */
  function injectMenuAuth() {
    var slot = document.getElementById('acctSlot');
    if (!slot || acct() || document.getElementById('naErr')) return;
    if (!plugins.SignInWithApple && !plugins.GoogleAuth) return;
    slot.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;padding:6px 0">' +
      authButtonsHtml('na', false) + '</div>';
    wireAuthButtons('na');
  }
  new MutationObserver(injectMenuAuth).observe(document.documentElement, { childList: true, subtree: true });

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
