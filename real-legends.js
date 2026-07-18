// real-legends.js — real-world career-record benchmarks woven into the stat leaderboards.
// Drop-in module (namefilter/xp pattern): loaded `defer` on every page with a leaderboard;
// pages call RealLegends.forBoard(game, sort, pos) + RealLegends.rowHTML(entry) while
// interleaving fetched rows by stat value. Purely client-side flavor — real rows never
// consume a rank, never hit the server, and are skipped on OVR sorts / daily / challenge
// boards / ascending ("Worst") direction so the boards never flood.
//
// Numbers = widely cited career totals. Active players (LeBron, Ovechkin, Ronaldo, Messi,
// Crosby, CP3) are marked "as of" in comments — nudge them upward now and then; being a
// season behind is harmless (they're benchmarks, not a stats service). No entries for
// `mon` (fictional) or for sim-specific stats with no real-world analog (soccer Rating,
// keeper Saves, hockey Point Shares, cfb Titles).
(function () {
  'use strict';

  // League chip shown next to the name. Soccer has no single league → generic REAL.
  const TAG = { pitcher: 'MLB', batter: 'MLB', baller: 'NBA', striker: 'REAL', keeper: 'REAL', hockey: 'NHL', cfb: 'NCAA' };

  // Per game, per leaderboard sort key: [name, careerTotal] (+ position for cfb boards).
  // Top 5–10 per stat, fewer where the historical record is thin/mushy.
  const D = {
    pitcher: {
      k: [['Nolan Ryan', 5714], ['Randy Johnson', 4875], ['Roger Clemens', 4672], ['Steve Carlton', 4136], ['Bert Blyleven', 3701], ['Tom Seaver', 3640], ['Don Sutton', 3574], ['Gaylord Perry', 3534]],
      wins: [['Cy Young', 511], ['Walter Johnson', 417], ['Pete Alexander', 373], ['Christy Mathewson', 373], ['Pud Galvin', 365], ['Warren Spahn', 363], ['Kid Nichols', 362], ['Greg Maddux', 355]],
      war: [['Walter Johnson', 164.9], ['Cy Young', 163.6], ['Roger Clemens', 139.2], ['Pete Alexander', 119.1], ['Kid Nichols', 116.7], ['Lefty Grove', 113.3], ['Tom Seaver', 109.9], ['Greg Maddux', 106.7]],
      cyYoung: [['Roger Clemens', 7], ['Randy Johnson', 5], ['Steve Carlton', 4], ['Greg Maddux', 4], ['Clayton Kershaw', 3], ['Justin Verlander', 3]],
      rings: [['Whitey Ford', 6], ['Allie Reynolds', 6], ['Andy Pettitte', 5], ['Lefty Gomez', 5]],
    },
    batter: {
      hr: [['Barry Bonds', 762], ['Hank Aaron', 755], ['Babe Ruth', 714], ['Albert Pujols', 703], ['Alex Rodriguez', 696], ['Willie Mays', 660], ['Ken Griffey Jr.', 630], ['Jim Thome', 612]],
      hits: [['Pete Rose', 4256], ['Ty Cobb', 4189], ['Hank Aaron', 3771], ['Stan Musial', 3630], ['Tris Speaker', 3514], ['Derek Jeter', 3465], ['Cap Anson', 3435], ['Honus Wagner', 3420]],
      war: [['Babe Ruth', 182.6], ['Barry Bonds', 162.8], ['Willie Mays', 156.2], ['Ty Cobb', 151.5], ['Hank Aaron', 143.1], ['Tris Speaker', 134.7], ['Honus Wagner', 130.8], ['Stan Musial', 128.3]],
      rings: [['Yogi Berra', 10], ['Joe DiMaggio', 9], ['Mickey Mantle', 7], ['Phil Rizzuto', 7]],
      mvp: [['Barry Bonds', 7], ['Shohei Ohtani', 4], ['Mike Trout', 3], ['Albert Pujols', 3], ['Alex Rodriguez', 3], ['Mickey Mantle', 3]],
    },
    baller: {
      pts: [['LeBron James', 42184] /* through 2024-25, still adding */, ['Kareem Abdul-Jabbar', 38387], ['Karl Malone', 36928], ['Kobe Bryant', 33643], ['Michael Jordan', 32292], ['Dirk Nowitzki', 31560], ['Wilt Chamberlain', 31419], ['Shaquille O’Neal', 28596]],
      reb: [['Wilt Chamberlain', 23924], ['Bill Russell', 21620], ['Kareem Abdul-Jabbar', 17440], ['Elvin Hayes', 16279], ['Moses Malone', 16212], ['Tim Duncan', 15091], ['Karl Malone', 14968], ['Robert Parish', 14715]],
      ast: [['John Stockton', 15806], ['Chris Paul', 12499] /* through 2024-25 */, ['Jason Kidd', 12091], ['Steve Nash', 10335], ['Mark Jackson', 10334], ['Magic Johnson', 10141], ['Oscar Robertson', 9887]],
      war: [['Kareem Abdul-Jabbar', 273.4], ['LeBron James', 267.0] /* through 2024-25 */, ['Wilt Chamberlain', 247.3], ['Karl Malone', 234.6], ['Michael Jordan', 214.0], ['Tim Duncan', 206.4]],
      rings: [['Bill Russell', 11], ['Sam Jones', 10], ['John Havlicek', 8], ['Robert Horry', 7], ['Michael Jordan', 6]],
      mvp: [['Kareem Abdul-Jabbar', 6], ['Bill Russell', 5], ['Michael Jordan', 5], ['Wilt Chamberlain', 4], ['LeBron James', 4]],
    },
    striker: {
      goals: [['Cristiano Ronaldo', 950] /* ≈, still adding */, ['Lionel Messi', 891] /* ≈, still adding */, ['Josef Bican', 805], ['Pelé', 767], ['Romário', 762], ['Ferenc Puskás', 746], ['Gerd Müller', 735]],
      assists: [['Lionel Messi', 383] /* ≈ */, ['Cristiano Ronaldo', 257] /* ≈ */],
      rings: [['Paco Gento', 6], ['Alfredo Di Stéfano', 5], ['Cristiano Ronaldo', 5], ['Lionel Messi', 4]],
      mvp: [['Lionel Messi', 8], ['Cristiano Ronaldo', 5], ['Michel Platini', 3], ['Johan Cruyff', 3], ['Marco van Basten', 3]],
    },
    keeper: {
      cs: [['Gianluigi Buffon', 501], ['Iker Casillas', 439]],
      rings: [['Iker Casillas', 3], ['Víctor Valdés', 3], ['Manuel Neuer', 2]],
      mvp: [['Emiliano Martínez', 2]],
    },
    hockey: {
      g: [['Alex Ovechkin', 897] /* through 2024-25, still adding */, ['Wayne Gretzky', 894], ['Gordie Howe', 801], ['Jaromir Jagr', 766], ['Brett Hull', 741], ['Marcel Dionne', 731], ['Phil Esposito', 717], ['Mike Gartner', 708]],
      p: [['Wayne Gretzky', 2857], ['Jaromir Jagr', 1921], ['Mark Messier', 1887], ['Gordie Howe', 1850], ['Ron Francis', 1798], ['Marcel Dionne', 1771], ['Steve Yzerman', 1755], ['Sidney Crosby', 1687] /* through 2024-25, still adding */],
      rings: [['Henri Richard', 11], ['Jean Béliveau', 10], ['Yvan Cournoyer', 10], ['Claude Provost', 9], ['Maurice Richard', 8]],
      mvp: [['Wayne Gretzky', 9], ['Gordie Howe', 6], ['Eddie Shore', 4], ['Mario Lemieux', 3], ['Bobby Orr', 3], ['Alex Ovechkin', 3]],
    },
    cfb: {
      yds: [['Case Keenum', 19217, 'QB'], ['Dillon Gabriel', 18722, 'QB'], ['Landry Jones', 16646, 'QB'], ['Donnel Pumphrey', 6405, 'RB'], ['Ron Dayne', 6397, 'RB'], ['Ricky Williams', 6279, 'RB'], ['Corey Davis', 5278, 'WR'], ['Trevor Insley', 5005, 'WR']],
      td: [['Case Keenum', 155, 'QB'], ['Montee Ball', 83, 'RB'], ['Jarett Dillard', 60, 'WR']],
      wins: [['Kellen Moore', 50, 'QB'], ['Colt McCoy', 45, 'QB']],
      heisman: [['Archie Griffin', 2, 'RB']],
    },
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmt(v) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }

  // Sorted-desc benchmark entries for one board view (pos = cfb position filter or null).
  function forBoard(game, sort, pos) {
    const list = (D[game] && D[game][sort]) || [];
    return list
      .filter(e => !pos || String(e[2] || '').toUpperCase() === String(pos).toUpperCase())
      .map(e => ({ name: e[0], stat: e[1], pos: e[2] || null, tag: TAG[game] || 'REAL' }))
      .sort((a, b) => b.stat - a.stat);
  }

  // Same skeleton as the pages' lbRow, minus data-entry-id (real rows aren't clickable
  // — no build to open) and minus the chevron. Rank cell = ★ so real rows never shift
  // anyone's actual rank number.
  function rowHTML(e) {
    const posTag = e.pos ? ` <span class="nm-ovr">${esc(e.pos)}</span>` : '';
    return `<div class="lb-row real"><div class="rank">★</div>
      <div class="nm">${esc(e.name)}<span class="rl-tag">${esc(e.tag)}</span>${posTag}</div>
      <div class="ov rl-stat">${fmt(e.stat)}</div></div>`;
  }

  // Legend-purple styling (matches the games' --legend #a366ff tier color).
  const css = `
  .lb-row.real{cursor:default;border-color:rgba(163,102,255,.55);
    background:linear-gradient(90deg,rgba(163,102,255,.16),rgba(163,102,255,.04));}
  .lb-row.real:hover{border-color:#a366ff;box-shadow:0 0 12px rgba(163,102,255,.3);}
  .lb-row.real .rank{color:#a366ff;}
  .lb-row.real .nm{color:#e6d5ff;}
  .rl-stat{color:#a366ff;}
  .rl-tag{font-family:'Oswald',sans-serif;font-size:9px;font-weight:600;letter-spacing:1.2px;
    color:#a366ff;border:1px solid rgba(163,102,255,.5);border-radius:4px;
    padding:1px 5px;margin-left:6px;vertical-align:1px;}`;
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  window.RealLegends = { forBoard, rowHTML };
})();
