/* ============================================================================
   GoatLab — shared career-card image renderer + share sheet.
   Companion to achievements.js / xp.js: dropped into every game page with
   <script src="/share-card.js" defer>. Exposes window.ShareCard.

   ShareCard.share(opts) renders the finished career card to a canvas PNG and
   opens the native share sheet (navigator.share with files). Where files
   can't be shared (desktop browsers, older mobiles) it downloads the PNG and
   copies the share link to the clipboard instead. Resolves to
   {mode:'shared'|'download'|'cancelled'|'failed'} so the caller can toast.

   Everything is drawn with canvas primitives + emoji — no external images —
   so the canvas can never be tainted and toBlob() always works offline.
   ========================================================================== */
(function () {
  'use strict';

  const W = 1000, H = 1020;

  function roundRect(ctx, x, y, w, h, r) {
    if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + w - r.tr, y); ctx.arcTo(x + w, y, x + w, y + r.tr, r.tr);
    ctx.lineTo(x + w, y + h - r.br); ctx.arcTo(x + w, y + h, x + w - r.br, y + h, r.br);
    ctx.lineTo(x + r.bl, y + h); ctx.arcTo(x, y + h, x, y + h - r.bl, r.bl);
    ctx.lineTo(x, y + r.tl); ctx.arcTo(x, y, x + r.tl, y, r.tl);
    ctx.closePath();
  }

  function shade(hex, amt) {
    const n = parseInt(String(hex || '#666666').replace('#', ''), 16);
    if (isNaN(n)) return '#333';
    const f = c => Math.max(0, Math.min(255, c + amt));
    return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  // Shrink a font size until the text fits maxWidth (keeps long player names on the card).
  function fitText(ctx, text, weight, family, size, maxWidth, minSize) {
    let s = size;
    do { ctx.font = `${weight} ${s}px ${family}`; if (ctx.measureText(text).width <= maxWidth) break; s -= 2; } while (s > (minSize || 24));
    return s;
  }

  async function render(o) {
    try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1200))]); } catch (e) {}
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const OSW = "'Oswald','Arial Narrow',sans-serif", INT = "'Inter',Arial,sans-serif";
    const teamA = o.teamColor || '#2b3948', teamB = shade(teamA, -34);

    // --- backdrop: dark stadium navy + a faint perspective grid, like the site bg ---
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1320'); bg.addColorStop(1, '#04070d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(25,198,255,.05)'; ctx.lineWidth = 1;
    for (let y = 60; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const glow = ctx.createRadialGradient(W / 2, 180, 60, W / 2, 180, 700);
    glow.addColorStop(0, 'rgba(25,198,255,.10)'); glow.addColorStop(1, 'rgba(25,198,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // --- card body ---
    const CX = 50, CY = 50, CW2 = W - 100, CH2 = H - 140;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
    roundRect(ctx, CX, CY, CW2, CH2, 26);
    ctx.fillStyle = '#0d1725'; ctx.fill();
    ctx.restore();
    roundRect(ctx, CX, CY, CW2, CH2, 26);
    ctx.strokeStyle = 'rgba(25,198,255,.35)'; ctx.lineWidth = 2; ctx.stroke();

    // --- team-gradient header band ---
    const HH = 250;
    ctx.save();
    roundRect(ctx, CX, CY, CW2, HH, { tl: 26, tr: 26, br: 0, bl: 0 });
    ctx.clip();
    const hg = ctx.createLinearGradient(CX, CY, CX + CW2, CY + HH);
    hg.addColorStop(0, teamA); hg.addColorStop(1, teamB);
    ctx.fillStyle = hg; ctx.fillRect(CX, CY, CW2, HH);
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    for (let x = -HH; x < CW2 + HH; x += 90) { ctx.beginPath(); ctx.moveTo(CX + x, CY + HH); ctx.lineTo(CX + x + HH, CY); ctx.lineTo(CX + x + HH + 26, CY); ctx.lineTo(CX + x + 26, CY + HH); ctx.fill(); }
    ctx.restore();

    // header text
    const LX = CX + 44;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = `600 26px ${OSW}`;
    ctx.fillText(String(o.teamName || '').toUpperCase(), LX, CY + 62);
    ctx.fillStyle = '#fff';
    const nameSize = fitText(ctx, o.name || 'Player', 700, OSW, 64, CW2 - 300, 30);
    ctx.font = `700 ${nameSize}px ${OSW}`;
    ctx.fillText(o.name || 'Player', LX, CY + 62 + nameSize + 12);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = `600 26px ${OSW}`;
    if (o.subtitle) ctx.fillText(String(o.subtitle).toUpperCase(), LX, CY + 186);
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.font = `500 22px ${INT}`;
    if (o.metaLine) ctx.fillText(o.metaLine, LX, CY + 222);

    // OVR badge (right side of header)
    const bx = CX + CW2 - 130, by = CY + HH / 2;
    ctx.beginPath(); ctx.arc(bx, by, 78, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4,8,14,.55)'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = `700 72px ${OSW}`;
    ctx.fillText(String(o.ovr != null ? o.ovr : '-'), bx, by + 18);
    ctx.font = `600 20px ${OSW}`;
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText('OVERALL', bx, by + 52);

    // --- verdict ---
    let y = CY + HH + 96;
    ctx.fillStyle = o.verdictColor || '#ffce3a';
    const vSize = fitText(ctx, o.verdict || '', 700, OSW, 58, CW2 - 80, 30);
    ctx.font = `700 ${vSize}px ${OSW}`;
    ctx.fillText(o.verdict || '', W / 2, y);
    if (o.voteLine) {
      y += 44;
      ctx.fillStyle = 'rgba(234,242,251,.65)';
      ctx.font = `600 24px ${INT}`;
      ctx.fillText(o.voteLine, W / 2, y);
    }

    // --- stat grid (up to 6 laid out 3 x 2; 7-8 go 4 x 2) ---
    const stats = (o.stats || []).slice(0, 8);
    const cols = stats.length > 6 ? 4 : Math.min(3, Math.max(1, stats.length));
    const rows = Math.ceil(stats.length / cols);
    const gw = (CW2 - 88) / cols, gy0 = y + 56, gh = 118;
    stats.forEach((s, i) => {
      const cxx = CX + 44 + (i % cols) * gw + gw / 2;
      const cyy = gy0 + Math.floor(i / cols) * gh;
      roundRect(ctx, cxx - gw / 2 + 8, cyy - 8, gw - 16, gh - 14, 14);
      ctx.fillStyle = 'rgba(25,198,255,.06)'; ctx.fill();
      ctx.strokeStyle = 'rgba(25,198,255,.16)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#eaf2fb';
      ctx.font = `700 44px ${OSW}`;
      ctx.fillText(String(s[0]), cxx, cyy + 48);
      ctx.fillStyle = 'rgba(234,242,251,.55)';
      ctx.font = `600 19px ${INT}`;
      ctx.fillText(String(s[1]).toUpperCase(), cxx, cyy + 82);
    });
    y = gy0 + rows * gh + 30;

    // --- trophy shelf ---
    if (o.trophies) {
      ctx.font = `400 44px ${INT}`;
      ctx.fillStyle = '#eaf2fb';
      ctx.fillText(o.trophies, W / 2, y + 18);
      y += 76;
    }

    // --- earnings ---
    if (o.earnings) {
      ctx.fillStyle = '#ffce3a';
      ctx.font = `700 40px ${OSW}`;
      ctx.fillText(`💰 ${o.earnings}`, W / 2, y + 20);
      ctx.fillStyle = 'rgba(234,242,251,.5)';
      ctx.font = `600 18px ${INT}`;
      ctx.fillText('CAREER EARNINGS', W / 2, y + 52);
    }

    // --- footer bar ---
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(25,198,255,.9)';
    ctx.font = `700 30px ${OSW}`;
    ctx.fillText(`${o.gameEmoji || '⚾'}  GOATLAB`, W / 2, H - 52);
    ctx.fillStyle = 'rgba(234,242,251,.55)';
    ctx.font = `600 22px ${INT}`;
    ctx.fillText(o.url ? o.url.replace(/^https?:\/\//, '') : 'goat-lab.app', W / 2, H - 20);
    ctx.textAlign = 'left';

    return canvas;
  }

  function toBlob(canvas) {
    return new Promise((resolve, reject) => {
      try { canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'); }
      catch (e) { reject(e); }
    });
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'goatlab-career.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function copyLink(url) {
    if (!url) return false;
    try { await navigator.clipboard.writeText(url); return true; } catch (e) { return false; }
  }

  /* opts: { name, teamName, teamColor, ovr, verdict, verdictColor, voteLine,
             subtitle, metaLine, stats:[[val,label]..], trophies, earnings,
             gameEmoji, url, text, filename } */
  // Native share is mobile-only: desktop Chrome/Edge on Windows report
  // canShare({files}) as true, then resolve navigator.share() as if it worked
  // while showing nothing useful — the user just sees a "Shared!" toast.
  // Desktop always takes the download + copy-link path instead.
  function isMobile() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') return navigator.userAgentData.mobile;
    if (/android|iphone|ipad|ipod/i.test(navigator.userAgent)) return true;
    return navigator.maxTouchPoints > 1 && /mac/i.test(navigator.platform); // iPadOS masquerades as a Mac
  }

  async function share(opts) {
    let blob;
    try { blob = await toBlob(await render(opts)); }
    catch (e) { return { mode: 'failed' }; }
    const text = (opts.text || '') + (opts.url ? (opts.text ? '\n' : '') + opts.url : '');
    const file = (typeof File !== 'undefined') ? new File([blob], opts.filename || 'goatlab-career.png', { type: 'image/png' }) : null;
    if (isMobile() && file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return { mode: 'shared' };
      } catch (e) {
        if (e && e.name === 'AbortError') return { mode: 'cancelled' };
        // fall through to download on any other share failure
      }
    }
    download(blob, opts.filename);
    const copied = await copyLink(opts.url);
    return { mode: 'download', copied };
  }

  window.ShareCard = { render, share };
})();
