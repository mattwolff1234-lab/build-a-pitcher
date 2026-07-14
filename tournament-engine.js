/* ============================================================================
   tournament-engine.js — deterministic single-elimination bracket engine.

   A 64-player daily bracket where EVERY match derives an identical shared seed
   (so both players get the same reel — pure skill), the field is seeded by rating
   and filled to 64 with ghosts/byes, and placement pays Goat Coins + a champion
   trophy. Game-agnostic (baseball first; pass game='baller' etc. later). See
   tournament-design.md.

   ==ENGINE== DETERMINISM: pure functions of (entrants, ghosts, tournament seed).
   No Math.random, no Date. Same inputs → same bracket, same champion, same coins.
   Dual-env (namefilter.js pattern): module.exports for Node; window.Tournament
   for the browser.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Tournament = api;
})(this, function () {
  'use strict';

  /* ---------- seeded RNG (FNV-1a → mulberry32, the project's standard) ---------- */
  function hashStr(str) {
    let h = 2166136261 >>> 0; const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rngOf = str => mulberry32(hashStr(str));

  /* ---------- ids + per-match shared seed ---------- */
  // US-Eastern day id so it flips at the same time as hot.js (pass the date string in for determinism).
  function dailyTournamentId(dateStr, game) { return 'tourn-' + dateStr + '-' + (game || 'pitcher'); }
  // Both players in (round, matchIndex) seed their reel from THIS → identical spins.
  function matchSeed(tournamentId, round, matchIndex) {
    return hashStr(tournamentId + '|r' + round + '|m' + matchIndex) >>> 0;
  }

  /* ---------- standard bracket seeding order (1v64, 2v63, … winners meet late) ---------- */
  function seedPositions(size) {   // size = power of 2
    let pls = [1, 2];
    const rounds = Math.round(Math.log2(size));
    for (let r = 1; r < rounds; r++) {
      const out = []; const sum = Math.pow(2, r + 1) + 1;
      for (const p of pls) { out.push(p); out.push(sum - p); }
      pls = out;
    }
    return pls;   // length = size, seeds in slot order
  }

  const PLACEMENTS = ['champion', 'runnerUp', 'semifinal', 'quarterfinal', 'round16', 'round32', 'round64'];
  // Placement key from (round the player was eliminated, total rounds). distanceFromEnd 0 = the final.
  function placementFor(roundLost, totalRounds, won) {
    if (won) return 'champion';
    const d = totalRounds - roundLost;                  // 0 = lost final, 1 = lost semi, …
    const map = ['runnerUp', 'semifinal', 'quarterfinal', 'round16', 'round32', 'round64'];
    return map[Math.min(d, map.length - 1)];
  }
  // Default coin payouts (server truth lives in catalog.js EARN.tournament; pass a table to override).
  const DEFAULT_COINS = { champion: 500, runnerUp: 250, semifinal: 120, quarterfinal: 60, round16: 30, round32: 15, round64: 5 };
  function placementCoins(placement, table) { const t = table || DEFAULT_COINS; return t[placement] || 0; }

  /* ---------- build the seeded, filled field ----------
     entrants: [{ key, name, rating }] (humans, key = acct:sub / guest:id)
     ghosts:   [{ key?, name, rating }] (leaderboard builds used to fill; no key = no coins)
     Returns { size, order:[participant-per-slot], rounds } where a participant is
     { key|null, name, rating, kind:'human'|'ghost'|'bye', seed }. */
  function buildField(entrants, ghosts, seed, size) {
    size = size || 64;
    const rng = mulberry32((seed >>> 0) || 1);
    // humans seeded by rating desc (stable seeded tiebreak so equal ratings don't wobble)
    const humans = entrants.slice().map((e, i) => ({ ...e, kind: 'human', _t: rng() }))
      .sort((a, b) => (b.rating - a.rating) || (a._t - b._t));
    // ghosts shuffled deterministically, used as filler after the humans
    const gpool = ghosts.slice().map(g => ({ ...g, kind: 'ghost', _t: rng() })).sort((a, b) => a._t - b._t);
    const ranked = humans.slice(0, size);
    let gi = 0;
    while (ranked.length < size && gi < gpool.length) ranked.push(gpool[gi++]);
    while (ranked.length < size) ranked.push({ key: null, name: 'BYE', rating: -1, kind: 'bye' });
    ranked.forEach((p, i) => { p.seed = i + 1; delete p._t; });   // seed 1 = best
    // place into bracket slots by the standard seed order
    const pos = seedPositions(size);
    const order = pos.map(s => ranked[s - 1]);
    return { size, order, rounds: Math.round(Math.log2(size)) };
  }

  /* ---------- decide one match (higher rating wins; tie → seeded coin) ----------
     A bye (rating -1) always loses to a real slot; two byes → the higher seed (lower number) "wins". */
  function decideMatch(a, b, tournamentId, round, matchIndex) {
    if (a.kind === 'bye' && b.kind !== 'bye') return b;
    if (b.kind === 'bye' && a.kind !== 'bye') return a;
    if (a.kind === 'bye' && b.kind === 'bye') return a.seed < b.seed ? a : b;
    if (a.rating !== b.rating) return a.rating > b.rating ? a : b;
    return rngOf(tournamentId + '|r' + round + '|m' + matchIndex + '|coin')() < 0.5 ? a : b;
  }

  /* ---------- simulate the whole bracket deterministically ----------
     Returns { champion, rounds:[{round, matches:[{a,b,winner,seed}]}], placements:{key->{placement,coins}},
               order }. `ratingOverride` (optional) lets a live settle feed real locked OVRs per slot. */
  function simTournament(entrants, ghosts, seed, opts) {
    opts = opts || {};
    const size = opts.size || 64;
    const tournamentId = opts.tournamentId || 'tourn-sim';
    const coinTable = opts.coinTable || DEFAULT_COINS;
    const field = buildField(entrants, ghosts, seed, size);
    const totalRounds = field.rounds;
    const elim = {};                    // participant.seed -> round eliminated (undefined = still in / champion)
    let current = field.order.slice();  // participants in slot order
    const rounds = [];
    for (let round = 1; round <= totalRounds; round++) {
      const matches = [], next = [];
      for (let m = 0; m < current.length; m += 2) {
        const a = current[m], b = current[m + 1];
        const winner = decideMatch(a, b, tournamentId, round, m / 2);
        const loser = winner === a ? b : a;
        if (loser && loser.kind !== 'bye') elim[loser.seed] = round;
        matches.push({ a, b, winner, matchIndex: m / 2, seed: matchSeed(tournamentId, round, m / 2) });
        next.push(winner);
      }
      rounds.push({ round, name: roundName(round, totalRounds), matches });
      current = next;
    }
    const champion = current[0];
    // placements + coins for every real participant (humans + ghosts; only humans w/ a key earn)
    const placements = {};
    field.order.forEach(p => {
      if (p.kind === 'bye') return;
      const won = p === champion;
      const roundLost = elim[p.seed];
      const placement = won ? 'champion' : placementFor(roundLost, totalRounds, false);
      const coins = (p.kind === 'human' && p.key) ? placementCoins(placement, coinTable) : 0;
      placements[p.seed] = { seed: p.seed, key: p.key || null, name: p.name, kind: p.kind, placement, coins };
    });
    return { tournamentId, size, totalRounds, champion, rounds, placements, order: field.order };
  }

  function roundName(round, totalRounds) {
    const d = totalRounds - round;
    return ['Final', 'Semifinal', 'Quarterfinal', 'Round of 16', 'Round of 32', 'Round of 64'][d] || ('Round ' + round);
  }

  return {
    hashStr, mulberry32, rngOf, dailyTournamentId, matchSeed, seedPositions,
    PLACEMENTS, placementFor, placementCoins, DEFAULT_COINS, buildField, decideMatch, simTournament, roundName,
  };
});
