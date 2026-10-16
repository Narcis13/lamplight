/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · hand replayer (React)
   Steps through a saved hand (db.hand()) one event at a time: blinds,
   every action, every street, and the result. The table state at each
   step is rebuilt from the record, so any step can be jumped to.
   ════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HandEval } from '../shared/engine.js';
import { PROFILES } from '../shared/profiles.js';
import { cardHTML, hueOf } from './view.js';

const STREET_LABEL = {
  preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', result: 'Result',
  'run2-flop': 'Run 2 flop', 'run2-turn': 'Run 2 turn', 'run2-river': 'Run 2 river',
};
// avatar centres, in % of the stage; slot 0 is the bottom, then clockwise
const SLOTS = [[50, 79], [9, 60], [15, 22], [50, 17], [85, 22], [91, 60]];
const CENTER = [50, 49];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const SPEEDS = [[1, '1×'], [2, '2×'], [0.5, '½×']];

function cardsHTML(cards, { hl, dim, down } = {}) {
  return cards.map(c => {
    let h = cardHTML(c, { down: down || c == null });
    if (c != null && hl && hl.has(c)) h = h.replace('class="card', 'class="card hl');
    else if (c != null && dim) h = h.replace('class="card', 'class="card dim');
    return h;
  }).join('');
}

/** Replays the record into one snapshot per step. */
export function buildSteps(rec) {
  const cur = rec.mode === 'sng' ? '' : '$';
  const m = v => cur + Math.round(v).toLocaleString('en-US');
  const seatOf = s => rec.seats.find(x => x.seat === s);
  const nm = s => seatOf(s)?.name || `Seat ${s + 1}`;
  const st = {
    stacks: Object.fromEntries(rec.seats.map(s => [s.seat, s.stack])),
    bets: {}, folded: [], allIn: [], badge: {}, board: [], board2: null, pot: 0, street: 'preflop',
  };
  const snap = (extra) => ({
    stacks: { ...st.stacks }, bets: { ...st.bets }, folded: st.folded.slice(), allIn: st.allIn.slice(),
    badge: { ...st.badge }, board: st.board.slice(), board2: st.board2 && st.board2.slice(), pot: st.pot, street: st.street, ...extra,
  });
  const collect = () => {
    for (const [s, b] of Object.entries(st.bets)) st.pot += b;
    st.bets = {};
  };
  const steps = [snap({ kind: 'start', text: `${rec.seats.length} players. Blinds ${m(rec.sb)}/${m(rec.bb)}. ${nm(rec.button)} has the button.` })];
  let blindN = 0;
  for (const e of rec.events) {
    if (e.k === 'blind') {
      const which = blindN === 0 ? 'small' : 'big'; // the engine always posts the small blind first
      blindN++;
      st.stacks[e.s] -= e.a; st.bets[e.s] = (st.bets[e.s] || 0) + e.a;
      if (st.stacks[e.s] === 0) st.allIn.push(e.s);
      steps.push(snap({ kind: 'blind', seat: e.s, text: `${nm(e.s)} posts the ${which} blind, ${m(e.a)}` }));
    } else if (e.k === 'act') {
      if (e.type === 'fold') st.folded.push(e.s);
      if (e.paid) { st.stacks[e.s] -= e.paid; st.bets[e.s] = (st.bets[e.s] || 0) + e.paid; }
      if (e.allIn && !st.allIn.includes(e.s)) st.allIn.push(e.s);
      const verb = { fold: 'folds', check: 'checks', call: `calls ${m(e.paid)}`, bet: `bets ${m(e.to)}`, raise: `raises to ${m(e.to)}` }[e.type] || e.type;
      const label = e.allIn ? 'All in' : { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise' }[e.type];
      st.badge = { ...st.badge, [e.s]: { type: e.allIn ? 'allin' : e.type, label } };
      steps.push(snap({ kind: 'act', seat: e.s, act: e.type, text: `${nm(e.s)} ${verb}${e.allIn ? ', all in' : ''}` }));
    } else if (e.k === 'return') {
      st.stacks[e.s] += e.a; st.bets[e.s] = Math.max(0, (st.bets[e.s] || 0) - e.a);
      st.allIn = st.allIn.filter(x => x !== e.s || st.stacks[e.s] === 0);
      steps.push(snap({ kind: 'return', seat: e.s, text: `Uncalled ${m(e.a)} goes back to ${nm(e.s)}` }));
    } else if (e.k === 'street' && e.run === 2) {
      // run it twice: the second board starts from the cards both runs share
      if (!st.board2) st.board2 = st.board.slice(0, rec.ritFrom ?? 0);
      st.board2.push(...e.cards);
      st.street = `run2-${e.name}`;
      steps.push(snap({ kind: 'street', cards: e.cards, text: `Second run, ${STREET_LABEL[e.name].toLowerCase()}` }));
    } else if (e.k === 'street') {
      collect();
      st.street = e.name; st.board.push(...e.cards);
      const keep = {};
      for (const s of st.allIn) if (st.badge[s]) keep[s] = { type: 'allin', label: 'All in' };
      st.badge = keep;
      steps.push(snap({ kind: 'street', cards: e.cards, text: `${STREET_LABEL[e.name]}` }));
    }
  }
  // result
  collect();
  const pot = st.pot;
  const gains = {};
  const lines = [];
  for (const p of rec.pots) {
    const share = Math.floor(p.amount / p.winners.length);
    let rem = p.amount - share * p.winners.length;
    for (const w of p.winners) { gains[w] = (gains[w] || 0) + share + (rem > 0 ? 1 : 0); rem--; }
    const who = p.winners.map(nm);
    const hand = p.score != null ? HandEval.describe(p.score) : null;
    lines.push({
      run: p.run || 1,
      winners: p.winners,
      text: `${who.join(' and ')} ${who.length > 1 ? 'split' : 'wins'} ${p.label} (${m(p.amount)})`,
      hand,
    });
  }
  const end = { ...st.stacks };
  for (const s of rec.seats) end[s.seat] = rec.end?.[s.seat] ?? (st.stacks[s.seat] + (gains[s.seat] || 0));
  st.stacks = end; st.pot = 0; st.badge = {};
  const winners = [...new Set(rec.pots.flatMap(p => p.winners))];
  steps.push(snap({ kind: 'result', street: 'result', pot: 0, finalPot: pot, gains, lines, winners, text: lines.map(l => l.text + (l.hand ? `, ${l.hand.replace(/^./, c => c.toLowerCase())}` : '')).join('. ') }));

  // others' cards turn over once nobody can act any more (showdown or all-in runout); voluntary shows at the end
  let lastAct = 0;
  steps.forEach((s, i) => { if (s.kind === 'act') lastAct = i; });
  const showdown = rec.scores && Object.keys(rec.scores).length >= 2;
  const revealAt = showdown ? lastAct + 1 : steps.length - 1;
  return { steps, revealAt, money: m, name: nm };
}

function Seat({ s, slot, step, isMine, show, hole, hl, result, money, dim }) {
  const P = s.profile ? PROFILES[s.profile] : null;
  const hue = P ? P.hue : hueOf(s.name);
  const [x, y] = SLOTS[slot];
  const folded = step.folded.includes(s.seat);
  const badge = step.badge[s.seat];
  const win = result && step.winners.includes(s.seat);
  const gain = result ? step.gains[s.seat] : 0;
  const hasCards = !folded || isMine;
  const face = hole && (isMine || show);
  const cards = face ? hole : [null, null];
  return (
    <div className={`rp-seat${isMine ? ' mine' : ''}${folded ? ' folded' : ''}${win ? ' win' : ''}${dim ? ' dim' : ''}${step.seat === s.seat && step.kind !== 'street' ? ' now' : ''}`}
      style={{ left: `${x}%`, top: `${y}%`, '--hue': hue }}>
      <div className={`rp-hole${face ? ' up' : ''}`} aria-label={face ? `${s.name}'s cards` : undefined}
        dangerouslySetInnerHTML={{ __html: hasCards ? cardsHTML(cards, { hl: result ? hl : null, dim: result && !win && face, down: !face }) : '' }} />
      <div className="rp-av" aria-hidden="true">{P ? P.emoji : (s.name.trim()[0] || '?').toUpperCase()}</div>
      {s.pos && <span className="rp-pos">{s.pos}</span>}
      <div className="rp-plate">
        <span className="rp-nm">{s.name}</span>
        <span className="rp-stk num">{step.allIn.includes(s.seat) && step.stacks[s.seat] === 0 && !result ? 'All in' : money(step.stacks[s.seat])}</span>
      </div>
      {badge && <span className={`rp-badge rp-b-${badge.type}`}>{badge.label}</span>}
      {gain > 0 && <span className="rp-gain num">+{money(gain)}</span>}
    </div>
  );
}

export function Replayer({ hand, onClose }) {
  const built = useMemo(() => (hand && hand.seats ? buildSteps(hand) : null), [hand]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIx, setSpeedIx] = useState(0);
  const dlg = useRef(null);
  const tl = useRef(null);
  const n = built ? built.steps.length : 0;
  const go = useCallback(k => setI(v => Math.max(0, Math.min(n - 1, typeof k === 'function' ? k(v) : k))), [n]);

  // open: focus the dialog, restore focus on close
  useEffect(() => {
    const prev = document.activeElement;
    dlg.current?.focus({ preventScroll: true });
    return () => { if (prev && prev.focus) prev.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { setI(0); setPlaying(!!built); }, [built]);

  // autoplay
  useEffect(() => {
    if (!playing || !built) return;
    if (i >= n - 1) { setPlaying(false); return; }
    const next = built.steps[i + 1];
    const base = next.kind === 'street' ? 1400 : next.kind === 'result' ? 1600 : i === 0 ? 900 : 1050;
    const t = setTimeout(() => go(v => v + 1), base / SPEEDS[speedIx][0]);
    return () => clearTimeout(t);
  }, [playing, i, n, built, speedIx, go]);

  // keep the current timeline entry in view
  useEffect(() => {
    const box = tl.current, cur = box && box.querySelector('[aria-current="step"]');
    if (!box || !cur) return;
    const top = cur.offsetTop - box.offsetTop, bottom = top + cur.offsetHeight;
    if (top < box.scrollTop + 8) box.scrollTop = top - 40;
    else if (bottom > box.scrollTop + box.clientHeight - 8) box.scrollTop = bottom - box.clientHeight + 40;
  }, [i]);

  const onKeyRef = useRef(null);
  useEffect(() => {
    // capture phase: while the replay is open it owns the keyboard, so table hotkeys (F, C, R) never fire behind it
    const h = e => {
      const t = e.target, typing = t && t.matches && t.matches('input:not([type="range"]), textarea, [contenteditable="true"]');
      if (typing && !(dlg.current && dlg.current.contains(t))) return;
      e.stopPropagation();
      if (onKeyRef.current) onKeyRef.current(e);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);
  const onKey = e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); onClose && onClose(); return; }
    if (e.target.matches && e.target.matches('input')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); go(v => v + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setPlaying(false); go(v => v - 1); }
    else if (e.key === 'Home') { e.preventDefault(); setPlaying(false); go(0); }
    else if (e.key === 'End') { e.preventDefault(); setPlaying(false); go(n - 1); }
    else if (e.key === ' ' && !(e.target.matches && e.target.matches('button'))) { e.preventDefault(); togglePlay(); }
  };
  onKeyRef.current = onKey;
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (i >= n - 1) setI(0);
    setPlaying(true);
  };

  const shell = body => (
    <div className="rp-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div className="rp" role="dialog" aria-modal="true" aria-labelledby="rpTitle" tabIndex={-1} ref={dlg}>
        {body}
      </div>
    </div>
  );
  const closeBtn = (
    <button type="button" className="rp-close" onClick={onClose} aria-label="Close replay">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );

  if (!built) {
    return shell(<>
      <header className="rp-head"><div><h2 id="rpTitle">Hand replay</h2><p>{hand === undefined ? 'Loading the hand' : "This hand isn't available any more."}</p></div>{closeBtn}</header>
      {hand === undefined && <div className="rp-loading" aria-busy="true"><span /><span /><span /></div>}
    </>);
  }

  const { steps, revealAt, money } = built;
  const step = steps[i];
  const result = step.kind === 'result';
  const mine = hand.mine;
  const rot = mine ?? hand.seats[0].seat;
  const hl = new Set(result ? hand.best || [] : []);
  const hl2 = new Set(result ? hand.best2 || [] : []);
  const boardHTML = (cards, set) => [0, 1, 2, 3, 4].map(k => (cards[k] != null ? cardsHTML([cards[k]], { hl: set, dim: result && set.size > 0 }) : '<div class="rp-slot"></div>')).join('');
  const betTotal = Object.values(step.bets).reduce((a, b) => a + b, 0);
  const potShown = result ? 0 : step.pot + betTotal; // at the result the banner takes its place
  const btnSlot = (hand.button - rot + 6) % 6;
  const btnPos = lerp(SLOTS[btnSlot], CENTER, 0.27);
  const when = hand.endedAt || hand.startedAt;

  // timeline groups
  const groups = [];
  steps.forEach((s, k) => {
    const street = s.kind === 'result' ? 'result' : s.street;
    let g = groups[groups.length - 1];
    if (!g || g.street !== street) { g = { street, items: [], at: k, cards: s.kind === 'street' ? s.cards : null }; groups.push(g); }
    if (s.kind !== 'street') g.items.push([k, s]);
  });
  const curGroup = step.kind === 'result' ? 'result' : step.street;

  return shell(<>
    <header className="rp-head">
      <div>
        <h2 id="rpTitle">Hand #{hand.no}</h2>
        <p>
          {hand.tableName || 'Table'} · {hand.mode === 'sng' ? `Sit & Go, blinds ${money(hand.sb)}/${money(hand.bb)}` : `${money(hand.sb)}/${money(hand.bb)} No-Limit Hold'em`}
          {when ? ` · ${new Date(when).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
        </p>
      </div>
      {closeBtn}
    </header>

    <div className="rp-body">
      <div className="rp-main">
        <div className="rp-stage">
          <div className="rp-felt" aria-hidden="true"><div className="rp-rail" /><div className="rp-cloth" /></div>
          <div className={`rp-pot num${potShown ? '' : ' empty'}`}>Pot <b>{money(potShown)}</b></div>
          <div className={`rp-board${step.board2 ? ' rp-run1' : ''}`} aria-label={step.board2 ? 'First board' : 'Board'}
            dangerouslySetInnerHTML={{ __html: boardHTML(step.board, hl) }} />
          {step.board2 && <div className="rp-board rp-run2" aria-label="Second board" dangerouslySetInnerHTML={{ __html: boardHTML(step.board2, hl2) }} />}
          {hand.seats.map(s => {
            const slot = (s.seat - rot + 6) % 6;
            const b = step.bets[s.seat] || 0;
            const [bx, by] = lerp(SLOTS[slot], CENTER, 0.42);
            return [
              <Seat key={s.seat} s={s} slot={slot} step={step} isMine={s.seat === mine} show={i >= revealAt}
                hole={hand.hole[s.seat]} hl={hl} result={result} money={money}
                dim={result && !step.winners.includes(s.seat)} />,
              b > 0 && <div key={`b${s.seat}`} className="rp-bet num" style={{ left: `${bx}%`, top: `${by}%` }}><i aria-hidden="true" />{money(b)}</div>,
            ];
          })}
          <div className="rp-dealer" style={{ left: `${btnPos[0] + 5}%`, top: `${btnPos[1]}%` }} aria-hidden="true">D</div>
          {result && step.board2 && [1, 2].map(r => {
            const l = step.lines.find(x => x.run === r);
            return l && (
              <div key={r} className={`rp-runwin r${r}`} role="status">
                <b>{l.winners.map(w => built.name(w)).join(' & ')}</b>{l.hand && <span>{l.hand}</span>}
              </div>
            );
          })}
          {result && !step.board2 && (
            <div className="rp-result" role="status">
              {step.lines.slice(0, 2).map((l, k) => <div key={k}><b>{l.text}</b>{l.hand && <span>{l.hand}</span>}</div>)}
            </div>
          )}
        </div>

        <div className="rp-caption" aria-live="polite">
          <span className="rp-street">{STREET_LABEL[step.kind === 'result' ? 'result' : step.street]}</span>
          <span className="rp-text">{step.text}</span>
        </div>

        <div className="rp-controls">
          <div className="rp-btns">
            <button type="button" onClick={() => { setPlaying(false); go(0); }} disabled={i === 0} aria-label="First step">
              <svg viewBox="0 0 24 24"><path d="M6 5v14M18 5.5v13L8.5 12z" /></svg>
            </button>
            <button type="button" onClick={() => { setPlaying(false); go(v => v - 1); }} disabled={i === 0} aria-label="Previous step">
              <svg viewBox="0 0 24 24"><path d="M15.5 5.5v13L5 12z" /></svg>
            </button>
            <button type="button" className="rp-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
                : <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <button type="button" onClick={() => { setPlaying(false); go(v => v + 1); }} disabled={i === n - 1} aria-label="Next step">
              <svg viewBox="0 0 24 24"><path d="M8.5 5.5v13L19 12z" /></svg>
            </button>
            <button type="button" onClick={() => { setPlaying(false); go(n - 1); }} disabled={i === n - 1} aria-label="Last step">
              <svg viewBox="0 0 24 24"><path d="M18 5v14M6 5.5v13L15.5 12z" /></svg>
            </button>
          </div>
          <input type="range" className="rp-scrub" min="0" max={n - 1} step="1" value={i} aria-label="Step"
            style={{ '--fill': `${n > 1 ? (i / (n - 1)) * 100 : 100}%` }}
            onChange={e => { setPlaying(false); go(+e.target.value); }} />
          <span className="rp-count num" aria-hidden="true">{i + 1}/{n}</span>
          <button type="button" className="rp-speed num" onClick={() => setSpeedIx(k => (k + 1) % SPEEDS.length)} aria-label={`Playback speed ${SPEEDS[speedIx][1]}`}>{SPEEDS[speedIx][1]}</button>
        </div>
      </div>

      <ol className="rp-timeline" ref={tl} aria-label="Hand timeline">
        {groups.map(g => (
          <li key={g.at} className={`rp-group${g.street === curGroup ? ' cur' : ''}`}>
            <button type="button" className="rp-group-h" onClick={() => { setPlaying(false); go(g.at); }} aria-current={i === g.at && steps[g.at].kind === 'street' ? 'step' : undefined}>
              <span>{STREET_LABEL[g.street]}</span>
              {g.cards && <span className="rp-mini" dangerouslySetInnerHTML={{ __html: cardsHTML(g.cards) }} />}
            </button>
            {g.items.length > 0 && (
              <ol>
                {g.items.map(([k, s]) => {
                  const who = s.seat != null ? hand.seats.find(x => x.seat === s.seat) : null;
                  const P = who && who.profile ? PROFILES[who.profile] : null;
                  return (
                    <li key={k}>
                      <button type="button" className={`rp-item rp-k-${s.act || s.kind}${k === i ? ' on' : ''}${k > i ? ' ahead' : ''}`}
                        aria-current={k === i ? 'step' : undefined} onClick={() => { setPlaying(false); go(k); }}>
                        {who && <span className="rp-dot" style={{ '--hue': P ? P.hue : hueOf(who.name) }} aria-hidden="true" />}
                        <span>{s.kind === 'result' ? (s.lines.length ? s.lines.map(l => l.text + (l.hand ? ` with ${l.hand.replace(/^./, c => c.toLowerCase())}` : '')).join('. ') : 'Hand over') : s.text}</span>
                        {who && who.seat === mine && <em>You</em>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </div>
    <p className="rp-keys" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd> step · <kbd>Space</kbd> play · <kbd>Esc</kbd> close</p>
  </>);
}
