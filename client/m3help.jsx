/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · gem duel: how to play
   The whole game explained for someone who has never played a match-3,
   with little pictures drawn from the board's own gems. Opens from the
   lobby and from the duel's top bar. Numbers (rounds, costs, clocks)
   come from the rules module, so the guide never drifts from the game.
   ════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef } from 'react';
import { M3, BOOSTERS, PERKS } from '../shared/match3.js';
import { gemImage } from './m3board.js';

/* A tiny board: each row is a string of cells. A digit is a gem's look (0 blue = yours, 1 red = theirs,
   2 green, 3 orange, 4 purple, 5 gold), followed by h/v (arrow), b (bomb) or z (lightning); '.' is empty.
   Cells listed in `hl` glow; `arrow` draws a swap from one cell to another as [[row, col], [row, col]]. */
const KIND = { h: 'h', v: 'v', b: 'bomb', z: 'bolt' };
function Mini({ rows, hl = [], swap = null, caption }) {
  const cells = rows.map(r => r.split(' '));
  const lit = new Set(hl.map(([r, c]) => `${r},${c}`));
  const cols = cells[0].length;
  return (
    <figure className="m3h-mini">
      <div className="m3h-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {cells.flatMap((row, r) => row.map((t, c) => (
          <span key={`${r},${c}`} className={`m3h-cell${lit.has(`${r},${c}`) ? ' lit' : ''}`}>
            {t !== '.' && <img src={gemImage(+t[0], KIND[t[1]] || '')} alt="" draggable="false" />}
          </span>
        )))}
        {swap && <SwapArrow swap={swap} rows={cells.length} cols={cols} />}
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
function SwapArrow({ swap: [[r0, c0], [r1, c1]], rows, cols }) {
  const x = c => ((c + 0.5) / cols) * 100, y = r => ((r + 0.5) / rows) * 100;
  return (
    <svg className="m3h-swap" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line x1={x(c0)} y1={y(r0)} x2={x(c1)} y2={y(r1)} />
    </svg>
  );
}
const Gem = ({ look, s = '' }) => <img className="m3h-gem" src={gemImage(look, s)} alt="" draggable="false" />;
const Then = () => <span className="m3h-then" aria-hidden="true">→</span>;

const SECTIONS = [
  ['quick', 'In one minute'], ['turn', 'Your turn'], ['points', 'Points'], ['extra', 'Extra moves'],
  ['specials', 'Special gems'], ['combos', 'Combos'], ['colours', 'Blue and red'], ['boosters', 'Boosters'],
  ['perks', 'Perks'], ['winning', 'Rounds and winning'], ['clock', 'The clock'], ['money', 'Entries'],
  ['people', 'Friends and bots'], ['controls', 'Controls'], ['tips', 'Beginner tips'],
];

/** Plain-language versions of each booster, with when it shines. */
const BOOSTER_HOW = {
  ember: ['A spark drops on a random spot and clears a plus shape: the gem it hits and the four around it.', 'Cheap and quick to charge. Fire it whenever it is ready.'],
  sweep: ['A lantern sweeps across the middle row and clears all seven gems in it.', 'Also cheap. Gems above the middle fall down afterwards, which can set off cascades.'],
  beams: ['You tap any gem: its whole row and its whole column are cleared, 13 gems at once.', 'Aim where specials are waiting: the beams set them off too.'],
  prism: ['You tap a gem, and every gem of that colour on the board disappears.', 'Pick your own blue colour and you often charge the booster right back up.'],
  volt: ['You tap a gem: lightning jumps to every gem of that colour in the same row and column.', 'Look for a row or column with lots of one colour. It needs at least two.'],
  hat: ['Three random gems turn into special gems (arrows or bombs) that only last until the end of your turn.', 'Use them straight away: match them, or swap two of them together for a combo.'],
};

export function M3Manual({ onClose }) {
  const box = useRef(null);
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', k, true);
    box.current?.focus();
    return () => document.removeEventListener('keydown', k, true);
  }, [onClose]);
  const go = id => { const el = box.current?.querySelector(`#m3h-${id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const classic = M3.formats.classic, sprint = M3.formats.sprint, triples = M3.formats.triples, S = M3.speeds;
  return (
    <div className="m3h-wrap" role="dialog" aria-modal="true" aria-labelledby="m3hTitle" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="m3h" ref={box} tabIndex={-1}>
        <header className="m3h-head">
          <div className="m3h-title">
            <div>
              <small>Gem Duel</small>
              <h2 id="m3hTitle">How to play</h2>
            </div>
            <button className="tool close" aria-label="Close the guide" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <nav className="m3h-toc" aria-label="Sections">
            {SECTIONS.map(([id, label]) => <button key={id} type="button" onClick={() => go(id)}>{label}</button>)}
          </nav>
        </header>

        <div className="m3h-body">
          <section id="m3h-quick">
            <h3>In one minute</h3>
            <p className="m3h-lede">
              Two players share <b>one board of gems</b> and take turns. On your turn you <b>swap two gems that sit next to each other</b> so
              that three or more of the same kind line up. They pop, you get <b>a point for every gem</b>, and new gems fall in from the top.
              After {classic.rounds} rounds, <b>whoever has more points wins</b>.
            </p>
            <div className="m3h-row">
              <Mini rows={['2 0 2', '0 2 0']} hl={[[0, 1], [1, 1]]} swap={[[0, 1], [1, 1]]} caption="Swap the blue gem down…" />
              <Then />
              <Mini rows={['2 2 2', '0 0 0']} hl={[[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]} caption="…two lines of three: 6 points" />
            </div>
            <p>That is the whole game. Everything else in this guide helps you score more than your opponent.</p>
          </section>

          <section id="m3h-turn">
            <h3>Your turn</h3>
            <ul>
              <li>You get <b>{classic.moves} moves</b> each turn. A move is one swap.</li>
              <li>You can only swap two gems that touch <b>side by side or one above the other</b> (not diagonally).</li>
              <li>A swap has to make <b>a line of at least three of the same gem</b>, across or down. If it doesn't, the gems slide back and
                nothing happens: you don't lose the move, just try another one.</li>
              <li>After a match, the gems above fall into the gaps and new gems drop in. If the falling gems make new lines by themselves
                (a <b>cascade</b>), those pop too, and the points are yours.</li>
              <li>The board is shared: <b>whatever you leave behind, your opponent gets to play with next</b>.</li>
              <li>When your moves run out, it is your opponent's turn. A banner tells you whose turn it is, and the glowing card is the
                player who is moving.</li>
            </ul>
          </section>

          <section id="m3h-points">
            <h3>Points</h3>
            <p><b>Every gem that disappears is one point</b> for the player whose turn it is, however it disappeared: a normal match, a
              special gem going off, a cascade, a booster or a perk. There are no bonus multipliers: bigger explosions simply clear
              more gems.</p>
            <p>Your score is the big number on your card. Little <b>+N</b> numbers float up from the board as gems pop.</p>
          </section>

          <section id="m3h-extra">
            <h3>Extra moves: match four or more</h3>
            <p>If your swap makes a match of <b>four or more gems</b> (a line of four or five, or an L or T shape), <b>you keep that move</b>.
              The board says <i>Extra move!</i> and you can keep going. Chain several of these and you can play a long turn.</p>
            <div className="m3h-row">
              <Mini rows={['3 3 4 3', '2 5 3 2']} hl={[[0, 2], [1, 2]]} swap={[[1, 2], [0, 2]]} caption="Four orange in a row…" />
              <Then />
              <div className="m3h-callout"><b>Extra move!</b><span>and an arrow gem</span></div>
            </div>
            <p className="m3h-note">Only the match your swap makes counts. Lucky cascades still score, but they don't give extra moves.</p>
          </section>

          <section id="m3h-specials">
            <h3>Special gems</h3>
            <p>Big matches leave a <b>special gem</b> behind (where you swapped, if you can). Specials keep their colour.</p>
            <div className="m3h-specials">
              <div className="m3h-card">
                <div className="m3h-row tight"><Mini rows={['4 4 4 4']} hl={[[0, 0], [0, 1], [0, 2], [0, 3]]} /><Then /><Mini rows={['4h']} /></div>
                <div><b>Arrow</b><span>Made by <b>four in a line</b>. When it goes off it clears its <b>whole row</b> (or its whole column,
                  if the four were up and down: the chevrons show which way). 7 gems.</span></div>
              </div>
              <div className="m3h-card">
                <div className="m3h-row tight"><Mini rows={['5 5 5', '. . 5', '. . 5']} hl={[[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]} /><Then /><Mini rows={['5b']} /></div>
                <div><b>Bomb</b><span>Made by <b>an L or T shape</b> of five. It blows up the <b>3×3 square</b> around it. 9 gems.</span></div>
              </div>
              <div className="m3h-card">
                <div className="m3h-row tight"><Mini rows={['2 2 2 2 2']} hl={[[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]} /><Then /><Mini rows={['2z']} /></div>
                <div><b>Lightning</b><span>Made by <b>five in a line</b>. It zaps <b>{M3.bolt} random gems</b> all over the board.</span></div>
              </div>
            </div>
            <p><b>How to set one off:</b></p>
            <ul>
              <li>Match it with gems of <b>its colour</b>, like any other gem.</li>
              <li>Or catch it in another special's blast: it goes off too, and chains like that can clear half the board.</li>
              <li>Or <b>swap it with another special</b> for a combo (next section). That works even if they are different colours.</li>
            </ul>
            <p className="m3h-warn">Careful: a special you leave on the board at the end of your turn is <b>your opponent's to use</b>.</p>
          </section>

          <section id="m3h-combos">
            <h3>Combos: swap two specials together</h3>
            <p>Two special gems next to each other can always be swapped, even without a match. Both are used up in one big effect:</p>
            <table className="m3h-table">
              <tbody>
                <tr><td><Gem look={3} s="h" /> + <Gem look={4} s="v" /></td><td><b>Arrow + arrow</b></td><td>A cross: the whole row and the whole column.</td></tr>
                <tr><td><Gem look={3} s="h" /> + <Gem look={5} s="bomb" /></td><td><b>Arrow + bomb</b></td><td>Three whole rows (or three columns) at once.</td></tr>
                <tr><td><Gem look={5} s="bomb" /> + <Gem look={4} s="bomb" /></td><td><b>Bomb + bomb</b></td><td>A huge 5×5 explosion.</td></tr>
                <tr><td><Gem look={2} s="bolt" /> + <Gem look={3} s="bolt" /></td><td><b>Lightning + lightning</b></td><td>{M3.bolt * 2} random gems zapped.</td></tr>
                <tr><td><Gem look={2} s="bolt" /> + <Gem look={3} s="h" /></td><td><b>Lightning + arrow</b></td><td>Five random gems become arrows, and they all fire.</td></tr>
                <tr><td><Gem look={2} s="bolt" /> + <Gem look={5} s="bomb" /></td><td><b>Lightning + bomb</b></td><td>Four random gems become bombs, and they all blow.</td></tr>
              </tbody>
            </table>
            <p className="m3h-note">A combo uses up your move (it never gives an extra one), but it usually scores far more than a plain match.</p>
          </section>

          <section id="m3h-colours">
            <h3>Blue is yours, red is theirs</h3>
            <div className="m3h-row tight">
              <span className="m3h-chip mine"><Gem look={0} /> Your gems are always the <b>blue flames</b></span>
              <span className="m3h-chip theirs"><Gem look={1} /> Your opponent's are the <b>red diamonds</b></span>
            </div>
            <p>Your opponent sees it the other way round: on their screen, their gems are blue. The other four kinds
              (<Gem look={2} /> <Gem look={3} /> <Gem look={4} /> <Gem look={5} />) belong to nobody.</p>
            <ul>
              <li><b>Clearing blue gems on your turn charges your booster</b> (see the dots on the meter under your name).</li>
              <li><b>Clearing red gems on your turn takes them away from your opponent</b>: those can't charge their booster any more.
                It's a good way to slow them down.</li>
              <li>The other colours just score points.</li>
            </ul>
          </section>

          <section id="m3h-boosters">
            <h3>Boosters</h3>
            <p>Before each match you pick <b>one booster</b> (the cards on the board between matches). It charges as you clear your blue
              gems, and when the meter is full you can fire it. <b>Firing a booster never costs a move</b>, and you can fire it again in the
              same turn if it fills up again. It only works on your own turn.</p>
            <p>To fire it, press the glowing booster button under your card (or the <kbd>B</kbd> key). Some boosters then ask you to
              <b> tap a gem to aim</b>: the board lights up what they will hit before you let go. Press <kbd>Esc</kbd> or <b>Cancel</b> to change your mind.</p>
            <div className="m3h-boosters">
              {Object.entries(BOOSTERS).map(([k, B]) => (
                <div key={k} className="m3h-booster">
                  <span className="m3-bicon" aria-hidden="true">{B.icon}</span>
                  <div>
                    <b>{B.name}</b> <em>{B.cost} blue gems{B.target ? ' · you aim it' : ''}</em>
                    <p>{BOOSTER_HOW[k][0]}</p>
                    <p className="m3h-tip">{BOOSTER_HOW[k][1]}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="m3h-note">The meter can't hold more than the booster costs, so don't sit on a full meter for long: fire it and start charging again.</p>
          </section>

          <section id="m3h-perks">
            <h3>Perks</h3>
            <p>Everyone gets the same two perks, <b>once each per match</b>, and like boosters they <b>don't cost a move</b>:</p>
            <ul>
              <li><b>{PERKS.hammer.icon} {PERKS.hammer.name}</b> (<kbd>H</kbd>): tap any gem to smash it. If it was a special, it goes off.
                Great for setting off a special that you can't match, or for breaking up a big move your opponent is waiting for.</li>
              <li><b>{PERKS.shuffle.icon} {PERKS.shuffle.name}</b> (<kbd>S</kbd>): mixes up the whole board. Handy when the board looks bad for you.</li>
            </ul>
            <p className="m3h-note">If the board ever has no possible move at all, it shuffles itself for free.</p>
          </section>

          <section id="m3h-winning">
            <h3>Rounds and winning</h3>
            <ul>
              <li>A <b>round</b> is one turn for each player. <b>Classic</b> has {classic.rounds} rounds of {classic.moves} moves,
                <b> Sprint</b> {sprint.rounds} rounds of {sprint.moves}, <b>Triples</b> {triples.rounds} rounds of {triples.moves} moves.</li>
              <li>Who goes first is picked at random, and <b>the same player goes first in every round</b>. So the second player always has
                the last turn of the match, knowing exactly how many points they need.</li>
              <li>After the last round, the <b>higher score wins</b>. Equal scores are a <b>draw</b>.</li>
              <li>Win by more than {Math.round(M3.landslide * 100)}% of your opponent's score and it is a <b>Landslide!</b></li>
              <li>A new match starts by itself a few seconds later. Pick a different booster on the results card if you like.</li>
            </ul>
          </section>

          <section id="m3h-clock">
            <h3>The clock</h3>
            <ul>
              <li>Each turn has a time limit: <b>{S.relaxed.clock} seconds</b> on Relaxed, <b>{S.normal.clock}</b> on Normal,
                <b> {S.turbo.clock}</b> on Turbo. The thin bar under the moving player's card runs down.</li>
              <li>The clock <b>stops while gems are falling and exploding</b>, so animations never eat your time.</li>
              <li>If it runs out, <b>you lose the rest of that turn</b>. Miss two turns in a row and the house plays for you until you press <b>I'm back</b>.</li>
              <li>If your connection drops, you have 60 seconds to come back before the match is lost.</li>
            </ul>
          </section>

          <section id="m3h-money">
            <h3>Entries and your bankroll</h3>
            <ul>
              <li>Some duels are <b>free</b>. Others have an <b>entry</b> ({M3.entries.filter(Boolean).map(v => `$${v.toLocaleString('en-US')}`).join(', ')}) taken from
                your play-money bankroll when the match starts.</li>
              <li>The <b>winner takes both entries</b>. A draw gives both back.</li>
              <li><b>Leaving or resigning during a match counts as losing it</b> (your opponent wins). Between matches you can leave freely.</li>
            </ul>
          </section>

          <section id="m3h-people">
            <h3>Playing a friend or a bot</h3>
            <ul>
              <li><b>Against a bot:</b> press <b>Play</b> on a duel that says "vs a … bot". Casual bots are gentle, sharp bots plan ahead.
                To learn at your own pace, use <b>Open a duel</b> with <b>Lamplight bot</b>, a <b>Free</b> entry and the <b>Relaxed</b> clock.
                (The Sprint Arcade is free and short, but its clock is fast.)</li>
              <li><b>Against a friend:</b> in <b>Open a duel</b> choose <b>A friend</b> as the opponent, open it, then press <b>Copy the invite link</b>
                (or <b>Link</b> in the lobby) and send it. Your friend opens it, types a name if they haven't yet and presses <b>Play</b>;
                with a name already set, they sit straight down.</li>
              <li>Your friend can also just find your duel in their own lobby, under <b>Gem Duel</b>, and press <b>Play</b>.</li>
              <li>A bot holding a seat gives it up to a person between matches. Anyone else can <b>Watch</b>.</li>
            </ul>
          </section>

          <section id="m3h-controls">
            <h3>Controls</h3>
            <table className="m3h-table keys">
              <tbody>
                <tr><td><b>Swap</b></td><td>Drag a gem onto its neighbour, or swipe it that way on a phone. Or tap one gem, then the one next to it.</td></tr>
                <tr><td><kbd>B</kbd></td><td>Fire your booster (when it's full).</td></tr>
                <tr><td><kbd>H</kbd> / <kbd>S</kbd></td><td>Hammer / Shuffle.</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Cancel aiming, close panels and this guide.</td></tr>
                <tr><td><b>Emote</b></td><td>Six quick reactions for your opponent. Chat and the match log are on the right (on a phone, the list button at the top).</td></tr>
              </tbody>
            </table>
            <p className="m3h-note">Stuck? Wait a few seconds on your turn and a possible move starts to pulse.</p>
          </section>

          <section id="m3h-tips">
            <h3>Beginner tips</h3>
            <ol className="m3h-tips">
              <li><b>Look for fours first.</b> An extra move is worth more than a few points.</li>
              <li><b>Match near the bottom</b> when you can: more gems fall afterwards, so cascades are more likely.</li>
              <li><b>Prefer blue matches</b> to charge your booster, and <b>red ones</b> to keep your opponent's empty.</li>
              <li><b>Use your specials before your turn ends</b>, or your opponent will.</li>
              <li><b>Two specials side by side?</b> Swap them together: combos are the biggest scores in the game.</li>
              <li><b>Fire your booster before your last move</b>: once your moves are used up, your turn is over. Its cascades may line up something for that move too.</li>
              <li><b>Save the Hammer</b> for a special you can't reach, or for your very last turn.</li>
              <li><b>Going second?</b> You get the final turn: watch the score and take risks only if you need to.</li>
            </ol>
            <div className="m3h-end">
              <button className="btn primary" onClick={onClose}>Got it, let's play</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
