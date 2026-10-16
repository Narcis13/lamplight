/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · bot personalities
   Shared by the server (the bots' brains) and the client (seat tags,
   the profile popover, the lobby). Pure data.
   ════════════════════════════════════════════════════════════════════ */
/* ───────────── bot personalities ─────────────
   Display (read by the client):
   name, emoji, tag, style, hue, blurb, tilts
   play    Chen-style looseness score (lower = looser; the client's meter)
   agg     tendency to bet/raise rather than check/call (0..1)
   risk    appetite for variance (0..1)

   Tuning (read by server/bots.js):
   vpip      share of hands it wants to play at a full six-max table
   pfrRatio  share of the pots it enters by raising rather than limping/calling
   threeBet  multiplier on its re-raising ranges
   bluff     frequency of betting without the goods
   sticky    reluctance to fold once involved
   sizing    bet size multiplier (1 = standard)
   cbet      continuation-bet frequency as the preflop raiser
   trap      how often it slowplays monsters and check-raises
   donk      how often it leads into the preflop raiser
   shove     chance of a surprise all-in with a strong hand
   noise     how erratic its hand reading is (scaled down by skill)
   tiltiness how much a bad beat gets to it (1 = a lot)
   chatty    how often it talks at the table                          */
export const PROFILES = {
  rock: {
    name: 'Greta Stone', emoji: '🪨', tag: 'Rock', style: 'Tight-passive', hue: 212,
    blurb: 'Plays very few hands and hates risk. When she bets big, believe her.',
    play: 8, agg: 0.3, risk: 0.15,
    vpip: 0.13, pfrRatio: 0.5, threeBet: 0.5, bluff: 0.03, sticky: 0.04, sizing: 0.65, cbet: 0.45,
    trap: 0.15, donk: 0.03, shove: 0, noise: 0.8, tiltiness: 0.15, chatty: 0.45,
  },
  shark: {
    name: 'Viktor Sharkov', emoji: '🦈', tag: 'Shark', style: 'Tight-aggressive', hue: 190,
    blurb: 'Disciplined and price-driven. Takes calculated risks and punishes limps.',
    play: 6.8, agg: 0.68, risk: 0.5,
    vpip: 0.22, pfrRatio: 0.88, threeBet: 1.1, bluff: 0.14, sticky: 0.05, sizing: 0.9, cbet: 0.66,
    trap: 0.15, donk: 0.02, shove: 0.02, noise: 0.5, tiltiness: 0.1, chatty: 0.35,
  },
  maniac: {
    name: 'Max Mayhem', emoji: '🔥', tag: 'Maniac', style: 'Loose-aggressive', hue: 14,
    blurb: 'Raises constantly and loves a coin flip. Risk-seeking to a fault.',
    play: 4, agg: 0.88, risk: 0.95,
    vpip: 0.46, pfrRatio: 0.8, threeBet: 2.2, bluff: 0.36, sticky: 0.2, sizing: 1.15, cbet: 0.85,
    trap: 0.05, donk: 0.12, shove: 0.07, noise: 1.3, tiltiness: 0.35, chatty: 0.8,
  },
  station: {
    name: 'Phil Calloway', emoji: '🐟', tag: 'Station', style: 'Loose-passive', hue: 150,
    blurb: 'Calls far too often and rarely raises. Bet your good hands into him.',
    play: 5, agg: 0.12, risk: 0.7,
    vpip: 0.44, pfrRatio: 0.18, threeBet: 0.3, bluff: 0.03, sticky: 0.45, sizing: 0.55, cbet: 0.35,
    trap: 0.25, donk: 0.1, shove: 0, noise: 1.0, tiltiness: 0.2, chatty: 0.6,
  },
  gambler: {
    name: 'Lucky Lucia', emoji: '🎲', tag: 'Gambler', style: 'Volatile, tilts', hue: 285, tilts: true,
    blurb: 'Solid until she loses a big pot. Then her risk dial climbs fast.',
    play: 6.2, agg: 0.5, risk: 0.72,
    vpip: 0.27, pfrRatio: 0.65, threeBet: 1, bluff: 0.18, sticky: 0.12, sizing: 1, cbet: 0.6,
    trap: 0.1, donk: 0.05, shove: 0.04, noise: 1.0, tiltiness: 1, chatty: 0.7,
  },
  pro: {
    name: 'Prof. Iris Quant', emoji: '🎓', tag: 'Pro', style: 'Balanced, near-GTO', hue: 262,
    blurb: 'Studies the solvers and plays both ways. Hard to read and harder to beat.',
    play: 6.5, agg: 0.66, risk: 0.55,
    vpip: 0.25, pfrRatio: 0.9, threeBet: 1.25, bluff: 0.2, sticky: 0.08, sizing: 0.95, cbet: 0.6,
    trap: 0.22, donk: 0.03, shove: 0.02, noise: 0.25, tiltiness: 0.03, chatty: 0.3,
  },
  nit: {
    name: 'Walter Tightly', emoji: '🔒', tag: 'Nit', style: 'Ultra-tight, then aggressive', hue: 232,
    blurb: 'Waits all night for a premium hand, then bets it hard. A raise from him means a big hand.',
    play: 9, agg: 0.72, risk: 0.2,
    vpip: 0.1, pfrRatio: 0.92, threeBet: 0.7, bluff: 0.04, sticky: 0.02, sizing: 1, cbet: 0.72,
    trap: 0.05, donk: 0.02, shove: 0.01, noise: 0.5, tiltiness: 0.25, chatty: 0.4,
  },
  trapper: {
    name: 'Serena Snare', emoji: '🕸️', tag: 'Trapper', style: 'Tricky, slowplays', hue: 326,
    blurb: 'Checks her monsters and waits for you to bet. Beware the check-raise.',
    play: 6.4, agg: 0.45, risk: 0.55,
    vpip: 0.24, pfrRatio: 0.55, threeBet: 0.8, bluff: 0.12, sticky: 0.15, sizing: 0.85, cbet: 0.4,
    trap: 0.7, donk: 0.03, shove: 0.02, noise: 0.7, tiltiness: 0.2, chatty: 0.5,
  },
  tourist: {
    name: 'Gus Holiday', emoji: '🍹', tag: 'Tourist', style: 'Loose, fun, unpredictable', hue: 48,
    blurb: 'On vacation and here for a good time. Plays anything, leads into raisers, sizes by feel.',
    play: 3.8, agg: 0.42, risk: 0.85,
    vpip: 0.55, pfrRatio: 0.3, threeBet: 0.6, bluff: 0.2, sticky: 0.35, sizing: 0.8, cbet: 0.5,
    trap: 0.05, donk: 0.45, shove: 0.05, noise: 1.6, tiltiness: 0.3, chatty: 1,
  },
};
