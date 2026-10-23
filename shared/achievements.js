/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · achievements
   The list both sides share: the server decides when one unlocks, the
   client draws the badge. Order here is the order on the profile page.
   ════════════════════════════════════════════════════════════════════ */
export const ACHIEVEMENTS = [
  { key: 'first_pot', icon: '🩸', title: 'First blood', desc: 'Win your first pot.', tier: 1 },
  { key: 'hands_100', icon: '🪑', title: 'Regular', desc: 'Play 100 hands.', tier: 1 },
  { key: 'showdown_10', icon: '🃏', title: 'Show me', desc: 'Win 10 pots at showdown.', tier: 1 },
  { key: 'full_house', icon: '🏠', title: 'Full boat', desc: 'Win a pot with a full house.', tier: 1 },
  { key: 'wheel', icon: '🛞', title: 'The wheel', desc: 'Win with a five-high straight.', tier: 2 },
  { key: 'hammer', icon: '🔨', title: 'The hammer', desc: 'Win a pot holding seven-deuce offsuit.', tier: 2 },
  { key: 'bluff', icon: '🎭', title: 'Nerves of steel', desc: 'Bet or raise the river and take the pot without a showdown.', tier: 2 },
  { key: 'big_pot', icon: '💰', title: 'Big game', desc: 'Win a pot of 100 big blinds or more.', tier: 2 },
  { key: 'double_up', icon: '⏫', title: 'Double up', desc: 'Double your stack in a single hand.', tier: 2 },
  { key: 'cracked', icon: '💔', title: 'Cracked', desc: 'Lose a showdown holding pocket aces.', tier: 2 },
  { key: 'bad_beat', icon: '⛈️', title: 'Bad beat', desc: 'Lose a showdown with a full house or better.', tier: 3 },
  { key: 'quads', icon: '🎰', title: 'Four of a kind', desc: 'Win a pot with quads.', tier: 3 },
  { key: 'straight_flush', icon: '🌈', title: 'Straight flush', desc: 'Win a pot with a straight flush.', tier: 3 },
  { key: 'royal', icon: '👑', title: 'Royal flush', desc: 'The best hand there is. Win with it.', tier: 4 },
  { key: 'shark_hunter', icon: '🦈', title: 'Shark hunter', desc: 'Knock Viktor Sharkov out of his stack.', tier: 2 },
  { key: 'professor', icon: '🎓', title: 'Graduated', desc: 'Knock out the Professor.', tier: 3 },
  { key: 'hands_1000', icon: '⚙️', title: 'Grinder', desc: 'Play 1,000 hands.', tier: 3 },
  { key: 'sng_cash', icon: '🎟️', title: 'In the money', desc: 'Finish in the top two of a Sit & Go.', tier: 2 },
  { key: 'sng_win', icon: '🏆', title: 'Champion', desc: 'Win a Sit & Go.', tier: 3 },
  { key: 'high_roller', icon: '💎', title: 'High roller', desc: 'Grow your bankroll to $50,000.', tier: 4 },
  { key: 'bg_first', icon: '🎲', title: 'Off the board', desc: 'Win a game of backgammon.', tier: 1 },
  { key: 'bg_gammon', icon: '🌀', title: 'Gammon', desc: 'Bear off all fifteen before your opponent bears off one.', tier: 2 },
  { key: 'bg_cube', icon: '🧊', title: 'Cube action', desc: 'Win a backgammon game with the cube on 4 or higher.', tier: 2 },
  { key: 'bg_match', icon: '🏅', title: 'Match point', desc: 'Win a backgammon match.', tier: 2 },
  { key: 'bg_backgammon', icon: '⚡', title: 'Backgammon!', desc: 'Win with a checker of theirs still on the bar or in your home board.', tier: 3 },
  { key: 'm3_first', icon: '💎', title: 'Gem duelist', desc: 'Win a gem duel.', tier: 1 },
  { key: 'm3_combo', icon: '💥', title: 'Combo', desc: 'Swap two special pieces together in a gem duel.', tier: 1 },
  { key: 'm3_landslide', icon: '🌋', title: 'Landslide', desc: 'Win a gem duel by more than 30% of your opponent\'s score.', tier: 2 },
  { key: 'm3_score', icon: '🌟', title: 'Gem hoarder', desc: 'Score 200 points in a single gem duel.', tier: 3 },
];
export const ACH = Object.fromEntries(ACHIEVEMENTS.map(a => [a.key, a]));
