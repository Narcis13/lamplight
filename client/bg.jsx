/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · backgammon room (React)
   The board, both players, the dice and the cube, your controls, and
   the game log and chat. The App owns the data (the server's state for
   this board); this component draws it and sends your moves back.

   The board is an SVG for the wood, felt and points, with the checkers,
   dice and cube as HTML on top, so each checker can glide from point to
   point. Checkers keep an identity between states (see `restack`), so
   a move animates the checker that actually moved.

   You always see the board from your own side: your home board is
   bottom right. People watching see it from white's side.
   ════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Fmt, PROFILES } from '../shared/engine.js';
import { BAR, OFF, Turn, countOn, pointOf, indexOf, KIND_NAME } from '../shared/backgammon.js';
import { hueOf } from './view.js';

/* ───────────── geometry, in board units ───────────── */
const FR = 18, PW = 66, BARW = 56, TRAY = 78;
const LEFT0 = FR, BAR0 = LEFT0 + 6 * PW, RIGHT0 = BAR0 + BARW, RIGHT1 = RIGHT0 + 6 * PW, TRAY0 = RIGHT1 + FR;
const W = TRAY0 + TRAY + FR, H = 720, MID = H / 2;
const R = 30, SLAB = 13, PL = 288; // checker radius, a borne-off checker's thickness, point length
const pctX = x => `${(x / W) * 100}%`, pctY = y => `${(y / H) * 100}%`;
const colX = c => (c < 6 ? LEFT0 + c * PW + PW / 2 : RIGHT0 + (c - 6) * PW + PW / 2);
/** Where point n (in the viewer's numbering) is drawn: column 0..11 and top/bottom row. */
const slotOf = n => (n <= 12 ? { col: 12 - n, bottom: true } : { col: n - 13, bottom: false });

/** Centre of the k-th checker (0 = bottom of the stack) of `count` at a location, from `view`'s side. */
function checkerXY(loc, k, count, seat, view) {
  if (loc === BAR) {
    const step = Math.min(2 * R, (MID - FR - 2 * R - 40) / Math.max(1, count - 1));
    const mine = seat === view;
    return { x: BAR0 + BARW / 2, y: mine ? MID + 44 + k * step : MID - 44 - k * step };
  }
  if (loc === OFF) {
    const mine = seat === view;
    return { x: TRAY0 + TRAY / 2, y: mine ? H - FR - 10 - k * (SLAB + 2) : FR + 10 + k * (SLAB + 2), slab: true };
  }
  const { col, bottom } = slotOf(pointOf(view, loc));
  const step = Math.min(2 * R, (MID - FR - 2 * R - 14) / Math.max(1, count - 1));
  return { x: colX(col), y: bottom ? H - FR - R - k * step : FR + R + k * step };
}

/** Which location a point on the board falls in, from `view`'s side. */
function hitTest(bx, by, view) {
  if (bx >= RIGHT1 + FR / 2) return OFF;
  if (bx >= BAR0 && bx < RIGHT0) return BAR;
  if (bx < LEFT0 - 6 || by < 0 || by > H) return null;
  const col = bx < BAR0 ? Math.max(0, Math.min(5, Math.floor((bx - LEFT0) / PW))) : 6 + Math.max(0, Math.min(5, Math.floor((bx - RIGHT0) / PW)));
  const n = by >= MID ? 12 - col : col + 13;
  return indexOf(view, n);
}

const locsOf = (pos, seat) => {
  const m = new Map();
  for (let i = 0; i < 24; i++) { const c = countOn(pos, seat, i); if (c) m.set(i, c); }
  if (pos.bar[seat]) m.set(BAR, pos.bar[seat]);
  if (pos.off[seat]) m.set(OFF, pos.off[seat]);
  return m;
};

/**
 * Gives every checker an identity that survives from one state to the next. Checkers that are still
 * where they belong stay put (bottom of each stack first); the rest move to wherever checkers are now
 * missing, landing on top. One move therefore animates exactly one checker (two, with a hit).
 */
function restack(prev, pos) {
  const out = [];
  for (const seat of [0, 1]) {
    const need = locsOf(pos, seat);
    const mine = prev ? prev.filter(c => c.seat === seat) : null;
    if (!mine || mine.length !== 15) {
      let id = 0;
      for (const [loc, n] of need) for (let k = 0; k < n; k++) out.push({ id: `${seat}-${id++}`, seat, loc, k, moved: false });
      continue;
    }
    const byLoc = new Map();
    for (const c of mine) { if (!byLoc.has(c.loc)) byLoc.set(c.loc, []); byLoc.get(c.loc).push(c); }
    const stay = [], free = [];
    for (const [loc, list] of byLoc) {
      list.sort((a, b) => a.k - b.k);
      const n = need.get(loc) || 0;
      list.forEach((c, j) => (j < n ? stay : free).push(c));
    }
    const have = new Map();
    for (const c of stay) have.set(c.loc, (have.get(c.loc) || 0) + 1);
    const placed = stay.map(c => ({ ...c, moved: false }));
    for (const [loc, n] of need) {
      for (let h = have.get(loc) || 0; h < n; h++) { const c = free.shift(); placed.push({ ...c, loc, k: 99 + h, moved: true }); }
    }
    const per = new Map();
    for (const c of placed) { if (!per.has(c.loc)) per.set(c.loc, []); per.get(c.loc).push(c); }
    for (const list of per.values()) { list.sort((a, b) => a.k - b.k); list.forEach((c, j) => { c.k = j; }); }
    out.push(...placed);
  }
  return out;
}

const usd = v => Fmt.usd(v);
const signedUsd = v => (v > 0 ? `+${usd(v)}` : v < 0 ? `−${usd(-v)}` : 'even');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** What giving up now would count as for `me`: 1, or 2 for a gammon, 3 for a backgammon. */
function resignMult(pos, me) {
  if (pos.off[me] > 0) return 1;
  if (pos.bar[me] > 0) return 3;
  for (let i = 0; i < 24; i++) if (countOn(pos, me, i) && pointOf(1 - me, i) <= 6) return 3;
  return 2;
}

function useNow(active, ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

/* ───────────── the board ───────────── */
function Dice({ dice, remaining, x, rollKey, small }) {
  if (!dice) return null;
  const list = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice;
  // a die is used once the remaining dice no longer include it
  const left = remaining ? remaining.slice() : null;
  const used = list.map(d => { if (!left) return false; const i = left.indexOf(d); if (i >= 0) { left.splice(i, 1); return false; } return true; });
  const size = list.length === 4 || small ? 40 : 50, gap = 12;
  const total = list.length * size + (list.length - 1) * gap;
  return list.map((d, i) => (
    <div key={`${rollKey}-${i}`} className={`bg-die roll${used[i] ? ' used' : ''}`} data-v={d}
      style={{ left: pctX(x - total / 2 + i * (size + gap) + size / 2), top: pctY(MID), width: pctX(size), padding: pctX(size * 0.13), animationDelay: `${i * 40}ms` }}>
      {Array.from({ length: d }, (_, j) => <i key={j} />)}
    </div>
  ));
}

function BoardSVG({ view, targets, sources, selected }) {
  const tri = [];
  for (let n = 1; n <= 24; n++) {
    const { col, bottom } = slotOf(n);
    const x0 = col < 6 ? LEFT0 + col * PW : RIGHT0 + (col - 6) * PW;
    const yb = bottom ? H - FR : FR, yt = bottom ? H - FR - PL : FR + PL;
    const dark = (col + (bottom ? 1 : 0)) % 2 === 0;
    const i = indexOf(view, n);
    const cls = `pt ${dark ? 'dark' : 'light'}${targets.has(i) ? ' target' : ''}${sources.has(i) ? ' source' : ''}${selected === i ? ' selected' : ''}`;
    tri.push(<polygon key={n} className={cls} points={`${x0 + 2},${yb} ${x0 + PW - 2},${yb} ${x0 + PW / 2},${yt}`} />);
    tri.push(<text key={`l${n}`} className="pt-num" x={x0 + PW / 2} y={bottom ? H - 5 : 13}>{n}</text>);
  }
  return (
    <svg className="bg-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id="bgWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6a4426" /><stop offset=".5" stopColor="#4d2f19" /><stop offset="1" stopColor="#3a2212" /></linearGradient>
        <radialGradient id="bgFelt" cx=".5" cy=".45" r=".75"><stop offset="0" stopColor="#2f8063" /><stop offset=".6" stopColor="#1f5f49" /><stop offset="1" stopColor="#123d2f" /></radialGradient>
      </defs>
      <rect className="frame" x="0" y="0" width={W} height={H} rx="18" fill="url(#bgWood)" />
      <rect className="felt" x={LEFT0} y={FR} width={6 * PW} height={H - 2 * FR} fill="url(#bgFelt)" />
      <rect className="felt" x={RIGHT0} y={FR} width={6 * PW} height={H - 2 * FR} fill="url(#bgFelt)" />
      <rect className="bar" x={BAR0} y={FR - 4} width={BARW} height={H - 2 * FR + 8} fill="url(#bgWood)" />
      <rect className={`tray${targets.has(OFF) ? ' target' : ''}`} x={TRAY0} y={FR} width={TRAY} height={H - 2 * FR} rx="6" />
      <line className="tray-mid" x1={TRAY0 + 8} x2={TRAY0 + TRAY - 8} y1={MID} y2={MID} />
      {tri}
      {sources.has(BAR) && <rect className={`bar-hl${selected === BAR ? ' selected' : ''}`} x={BAR0 + 4} y={MID + 10} width={BARW - 8} height={MID - FR - 14} rx="8" />}
    </svg>
  );
}

function Board({ s, view, me, bg, app, turn, autoDone }) {
  const wrap = useRef(null);
  const prev = useRef(null);
  const [sel, setSel] = useState(null);
  const [drag, setDrag] = useState(null); // { from, id, x, y, sx, sy, moved, dropped }
  const myMove = !!(turn && me != null);
  const legal = useMemo(() => (myMove ? turn.legal() : []), [turn, myMove]);
  const sources = useMemo(() => new Set(legal.map(m => m.from)), [legal]);
  const dests = useMemo(() => (myMove && sel != null && sources.has(sel) ? turn.destinations(sel) : new Map()), [turn, sel, sources, myMove]);
  const targets = useMemo(() => new Set(dests.keys()), [dests]);
  const checkers = useMemo(() => { prev.current = restack(prev.current, s.pos); return prev.current; }, [s.pos]);
  const counts = useMemo(() => { const m = new Map(); for (const c of checkers) { const k = `${c.seat}:${c.loc}`; m.set(k, (m.get(k) || 0) + 1); } return m; }, [checkers]);

  // a new state: forget the selection unless it still makes sense; pick the only checker that can move
  useEffect(() => {
    setDrag(null);
    if (!myMove) { setSel(null); return; }
    if (sources.size === 1) setSel([...sources][0]);
    else setSel(x => (x != null && sources.has(x) ? x : null));
  }, [s, myMove, sources]);

  // finished the roll: send it, if you asked us to
  const finished = myMove && turn.done && turn.moves.length > 0;
  useEffect(() => {
    if (!finished || !autoDone) return undefined;
    const t = setTimeout(() => app.bgSend('done'), 260);
    return () => clearTimeout(t);
  }, [finished, autoDone, s]);

  const toBoard = e => {
    const r = wrap.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const send = (from, to) => { app.bgSend('move', { from, to }); setSel(null); };
  const clickAt = loc => {
    if (!myMove || loc == null) return;
    if (sel != null && targets.has(loc)) { send(sel, loc); return; }
    if (sources.has(loc)) { setSel(sel === loc && sources.size > 1 ? null : loc); return; }
    setSel(sources.size === 1 ? [...sources][0] : null);
  };
  const topChecker = loc => {
    const list = checkers.filter(c => c.seat === me && c.loc === loc);
    return list.reduce((a, c) => (!a || c.k > a.k ? c : a), null);
  };
  const onDown = e => {
    if (!myMove || e.button > 0) return;
    const p = toBoard(e), loc = hitTest(p.x, p.y, view);
    if (loc == null || !sources.has(loc)) return;
    if (sel != null && sel !== loc && targets.has(loc)) return; // a click on a target: the release moves there
    const c = topChecker(loc);
    if (!c) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ from: loc, id: c.id, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false });
    setSel(loc);
  };
  const onMove = e => {
    if (!drag || drag.dropped) return;
    const p = toBoard(e);
    const moved = drag.moved || Math.hypot(p.x - drag.sx, p.y - drag.sy) > 12;
    setDrag({ ...drag, x: p.x, y: p.y, moved });
  };
  const onUp = e => {
    const p = toBoard(e), loc = hitTest(p.x, p.y, view);
    if (drag && !drag.dropped) {
      if (drag.moved) {
        const path = turn.destinations(drag.from);
        if (loc != null && path.has(loc)) { setDrag({ ...drag, dropped: true }); send(drag.from, loc); return; }
        setDrag(null);
        return;
      }
      setDrag(null); // a press and release in place: the checker stays selected
      return;
    }
    clickAt(loc);
  };
  const onDouble = e => {
    if (!myMove) return;
    const p = toBoard(e), loc = hitTest(p.x, p.y, view);
    const best = legal.filter(m => m.from === loc).sort((a, b) => b.die - a.die)[0];
    if (best) send(best.from, best.to);
  };

  // where the dice go: on the mover's half, yours on the right
  const diceX = seat => (seat === view ? RIGHT0 + 3 * PW : LEFT0 + 3 * PW);
  const cube = s.cube, cubeY = cube.owner == null ? MID : cube.owner === view ? H - FR - 15 * (SLAB + 2) - 50 : FR + 15 * (SLAB + 2) + 50;
  const offering = s.phase === 'double';
  const ts = s.turnState;

  return (
    <div className={`bg-board${myMove ? ' my-move' : ''}${drag && drag.moved && !drag.dropped ? ' dragging' : ''}`} ref={wrap}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)} onDoubleClick={onDouble}
      role="application" aria-label="Backgammon board">
      <BoardSVG view={view} targets={targets} sources={sources} selected={sel} />
      {checkers.map(c => {
        const n = counts.get(`${c.seat}:${c.loc}`) || 1;
        const pos = checkerXY(c.loc, c.k, n, c.seat, view);
        const dragged = drag && drag.id === c.id && (drag.moved || drag.dropped);
        const x = dragged ? drag.x : pos.x, y = dragged ? drag.y : pos.y;
        const top = c.k === n - 1;
        const cls = `bg-ck s${c.seat}${pos.slab ? ' slab' : ''}${c.moved ? ' moved' : ''}${dragged ? ' held' : ''}${top && c.seat === me && sources.has(c.loc) ? ' can' : ''}${top && sel === c.loc && c.seat === me ? ' sel' : ''}`;
        return <div key={c.id} className={cls} style={{ left: pctX(x), top: pctY(y), zIndex: dragged ? 60 : c.moved ? 40 : 10 + c.k }} />;
      })}
      {[...counts].filter(([k, n]) => n > 5 && !k.endsWith(':off')).map(([k, n]) => {
        const [seat, locS] = k.split(':');
        const loc = locS === BAR ? BAR : Number(locS);
        const p = checkerXY(loc, n - 1, n, Number(seat), view);
        return <div key={`n${k}`} className={`bg-count s${seat}`} style={{ left: pctX(p.x), top: pctY(p.y) }}>{n}</div>;
      })}
      {[...targets].map(t => {
        const n = (counts.get(`${me}:${t}`) || 0) + 1;
        const p = checkerXY(t, n - 1, Math.max(n, 1), me, view);
        return <div key={`t${t}`} className={`bg-target${t === OFF ? ' off' : ''}`} style={{ left: pctX(p.x), top: pctY(t === OFF ? H - FR - 40 : p.y) }} />;
      })}
      {s.phase === 'opening' && s.opening && (
        <>
          <Dice dice={[s.opening[view === 0 ? 0 : 1]]} x={diceX(view)} rollKey={`o${bg.rollKey}a`} />
          <Dice dice={[s.opening[view === 0 ? 1 : 0]]} x={diceX(1 - view)} rollKey={`o${bg.rollKey}b`} />
        </>
      )}
      {(s.phase === 'move') && s.dice && <Dice dice={s.dice} remaining={ts ? ts.remaining : null} x={diceX(s.turn)} rollKey={bg.rollKey} />}
      {s.phase === 'move' && ts && ts.required === 0 && <div className="bg-note" style={{ left: pctX(diceX(s.turn)), top: pctY(MID + 52) }}>No legal moves</div>}
      <div className={`bg-cube${offering ? ' offer' : ''}${cube.owner == null ? ' center' : ''}`} style={{ left: pctX(TRAY0 + TRAY / 2), top: pctY(cubeY) }}
        title={cube.owner == null ? 'The doubling cube, in the middle' : `The cube is on ${cube.value}`}>
        {offering ? cube.value * 2 : cube.value === 1 ? 64 : cube.value}
      </div>
      {s.phase === 'over' && s.result && <ResultBanner s={s} me={me} bg={bg} />}
      {s.phase === 'idle' && s.waiting && <div className="bg-wait">{s.waiting}</div>}
    </div>
  );
}

function ResultBanner({ s, me, bg }) {
  const r = s.result;
  const now = useNow(s.nextIn != null);
  const name = r.names ? r.names[r.winner] : '';
  const mine = me != null && r.winner === me, lost = me != null && r.loser === me;
  const how = r.kind === 'drop' ? 'Double passed' : r.kind === 'resign' ? 'Resigned' : r.kind === 'forfeit' ? 'Forfeit' : r.mult === 3 ? 'Backgammon!' : r.mult === 2 ? 'Gammon!' : 'Single game';
  const worth = `${plural(r.points, 'point')}${s.mode === 'money' ? ` · ${usd(r.amount)}` : ''}`;
  const left = s.nextIn != null && bg.stateAt ? Math.max(0, Math.ceil((s.nextIn - (now - bg.stateAt)) / 1000)) : null;
  return (
    <div className={`bg-result${mine ? ' won' : lost ? ' lost' : ''}`} role="status">
      <small>{how}</small>
      <b>{r.matchOver ? (mine ? 'You win the match' : `${name} wins the match`) : mine ? 'You win' : `${name} wins`}</b>
      <span>{r.kind === 'forfeit' && r.matchOver ? `${s.scores[0]}-${s.scores[1]}` : worth}{s.mode === 'match' && !(r.kind === 'forfeit') ? ` · ${s.scores[0]}-${s.scores[1]} to ${s.matchTo}` : ''}</span>
      {r.matchOver && s.mode === 'match' && mine && <span className="prize">{usd(s.entry * 2)} to your bankroll</span>}
      {left != null && left > 0 && !s.waiting && <em>{r.matchOver ? 'New match' : 'Next game'} in {left}s</em>}
    </div>
  );
}

/* ───────────── players ───────────── */
function Avatar({ seat }) {
  const P = seat.profileKey ? PROFILES[seat.profileKey] : null;
  return <span className="bg-av" style={{ '--hue': P ? P.hue : hueOf(seat.name) }} aria-hidden="true">{P ? P.emoji : (seat.name[0] || '?').toUpperCase()}</span>;
}

function PlayerBar({ s, seatIdx, me, bg, app, top }) {
  const seat = s.seats[seatIdx];
  const live = s.phase !== 'idle' && s.phase !== 'over';
  const onTurn = live && (s.turn === seatIdx && s.phase !== 'double' ? true : s.phase === 'double' && s.offerBy === 1 - seatIdx);
  const clock = s.clock && s.clock.seat === seatIdx ? s.clock : null;
  const now = useNow(!!clock);
  const reserved = s.reserved.find(r => r.seat === seatIdx);
  const color = <span className={`bg-chip s${seatIdx}`} aria-label={seatIdx === 0 ? 'White' : 'Black'} />;
  if (!seat) {
    const canSit = me == null && bg.pending == null;
    return (
      <div className={`bg-player empty${top ? ' top' : ''}`}>
        {color}
        <span className="bg-name"><b>{reserved ? `${reserved.name} is sitting down` : 'Open seat'}</b><small>{s.mode === 'money' ? `${usd(s.buyIn)} buy-in` : `${usd(s.entry)} entry`}</small></span>
        {canSit && !reserved && <button className="btn primary small" onClick={() => app.bgSit(seatIdx)}>Sit here</button>}
      </div>
    );
  }
  const P = seat.profileKey ? PROFILES[seat.profileKey] : null;
  let status = '';
  if (!seat.connected) status = 'Reconnecting…';
  else if (seat.away) status = 'Sitting out';
  else if (seat.broke) status = 'Out of chips';
  else if (live && onTurn) status = s.phase === 'double' ? 'Deciding on the double' : s.phase === 'roll' ? (seat.kind === 'bot' ? 'Thinking…' : 'To roll') : 'Moving';
  const left = clock && bg.stateAt ? Math.max(0, clock.left - (now - bg.stateAt)) : 0;
  const net = seat.net || 0;
  return (
    <div className={`bg-player${top ? ' top' : ''}${onTurn ? ' on' : ''}${seatIdx === me ? ' me' : ''}`}>
      {color}
      <Avatar seat={seat} />
      <span className="bg-name">
        <b>{seat.name}{seatIdx === me && <em className="you">You</em>}{P && <em className="tag">{P.tag}</em>}</b>
        <small>{status || `${s.pips[seatIdx]} pips`}{status ? ` · ${s.pips[seatIdx]} pips` : ''}</small>
      </span>
      <span className="bg-score">
        {s.mode === 'match'
          ? <><b className="num">{s.scores[seatIdx]}</b><small>of {s.matchTo}</small></>
          : seat.kind === 'human'
            ? <><b className="num">{usd(seat.stack)}</b><small className={net > 0 ? 'pos' : net < 0 ? 'neg' : ''}>{signedUsd(net)}</small></>
            : <><b className="num house">House</b><small className={net > 0 ? 'pos' : net < 0 ? 'neg' : ''}>{signedUsd(net)}</small></>}
      </span>
      {clock && <span className="bg-clock" aria-label={`${Math.ceil(left / 1000)} seconds`}><i style={{ transform: `scaleX(${clock.total ? left / clock.total : 0})` }} className={left < 8000 ? 'low' : ''} /><em className="num">{Math.ceil(left / 1000)}s</em></span>}
    </div>
  );
}

/* ───────────── your controls ───────────── */
function Controls({ s, me, bg, app, turn, autoDone, setAutoDone, onResign }) {
  const seat = me != null ? s.seats[me] : null;
  const live = s.phase !== 'idle' && s.phase !== 'over';
  const B = (label, t, opts = {}) => <button className={`btn${opts.primary ? ' primary' : ''}`} onClick={() => (typeof t === 'function' ? t() : app.bgSend(t))} disabled={opts.disabled} title={opts.title}>{label}{opts.kbd && <kbd>{opts.kbd}</kbd>}</button>;
  let main = null, hint = '';
  if (me == null) {
    const open = s.seats.some(x => !x || x.kind === 'bot') && s.reserved.length < 2;
    if (bg.pending != null) hint = s.mode === 'match' && live ? "Seat saved. You're in when this match ends" : "Seat saved. You're in when this game ends";
    else if (open) { hint = 'Watching'; main = B(s.mode === 'money' ? `Sit · ${usd(s.buyIn)}` : `Play · ${usd(s.entry)} entry`, () => app.bgSit(-1), { primary: true }); }
    else hint = 'Watching. Both seats are taken';
  } else if (seat && seat.broke) {
    hint = `Out of chips. Rebuy for ${usd(s.buyIn)} to keep playing`;
    main = <>{B(`Rebuy · ${usd(s.buyIn)}`, 'rebuy', { primary: true })}{B('Back to lobby', () => app.bgLeave())}</>;
  } else if (seat && seat.away) {
    hint = live ? "You're sitting out: we play your turns for you" : "You're sitting out";
    main = B("I'm back", 'back', { primary: true });
  } else if (!live) {
    hint = s.waiting || (s.phase === 'over' ? '' : 'Setting up the board');
  } else if (s.phase === 'opening') {
    hint = 'Opening roll: the higher die moves first, with both dice';
  } else if (s.phase === 'double' && s.offerBy === 1 - me) {
    const v = s.cube.value;
    hint = `${s.seats[1 - me].name} doubles. Take, and play on for ${v * 2}; pass, and give up ${plural(v, 'point')}${s.mode === 'money' ? ` (${usd(v * s.stake)})` : ''}`;
    main = <>{B(`Pass · lose ${v}`, 'drop', { kbd: 'P' })}{B(`Take · play for ${v * 2}`, 'take', { primary: true, kbd: 'T' })}</>;
  } else if (s.phase === 'double') {
    hint = `Waiting for ${s.seats[1 - me].name} to take or pass`;
  } else if (s.phase === 'roll' && s.turn === me) {
    hint = s.canDouble ? 'Double before you roll, or just roll' : '';
    main = <>{s.canDouble && B(`Double to ${s.cube.value * 2}`, 'double', { kbd: 'D' })}{B('Roll', 'roll', { primary: true, kbd: 'Space' })}</>;
  } else if (s.phase === 'move' && s.turn === me && turn) {
    const left = turn.left;
    hint = turn.required === 0 ? 'No legal moves. Your turn passes' : left ? `Move ${plural(left, 'checker')}: click one, then where it goes, or drag it. Double-click plays the bigger die` : autoDone ? '' : 'Done? Confirm to pass the dice';
    main = <>
      {B('Undo', 'undo', { disabled: !turn.moves.length, kbd: 'U' })}
      {!autoDone && B('Done', 'done', { primary: true, disabled: !turn.done || !turn.moves.length, kbd: 'Space' })}
    </>;
  } else {
    const who = s.seats[s.turn];
    hint = who ? `${who.name} ${s.phase === 'roll' ? 'is about to roll' : 'is moving'}` : '';
  }
  return (
    <div className="bg-controls">
      <div className="bg-hint" aria-live="polite">{hint}</div>
      <div className="bg-acts">{main}</div>
      {me != null && (
        <div className="bg-opts">
          <label className="bg-toggle"><input type="checkbox" checked={autoDone} onChange={e => setAutoDone(e.target.checked)} /> Auto-confirm moves</label>
          {live && seat && !seat.away && <button className="btn small ghost" onClick={() => app.bgSend('sitOut')}>Sit out</button>}
          {live && <button className="btn small ghost" onClick={onResign}>Resign</button>}
        </div>
      )}
    </div>
  );
}

/* ───────────── log & chat ───────────── */
/** Beside the board on a wide screen; on a phone it slides over the board when you open it from the top bar. */
function Side({ bg, app, open, onClose }) {
  const [tab, setTab] = useState('log');
  const [text, setText] = useState('');
  const box = useRef(null);
  const items = tab === 'log' ? bg.log : bg.chat;
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [items.length, tab, open]);
  const aside = useRef(null);
  useEffect(() => {
    const shown = aside.current && getComputedStyle(aside.current).visibility !== 'hidden';
    if (tab === 'chat' && bg.chatUnread && shown) app.clearChatUnread();
  }, [tab, bg.chatUnread, open]);
  return (
    <aside className={`bg-side panel-card${open ? ' open' : ''}`} ref={aside}>
      <button className="tool close bg-side-close" aria-label="Close" onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <div className="bg-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Game log</button>
        <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>Chat{bg.chatUnread && tab !== 'chat' ? <span className="dot" /> : null}</button>
      </div>
      <div className="bg-feed" ref={box}>
        {tab === 'log'
          ? (bg.log.length ? bg.log.map((l, i) => <p key={i} className={`ln ${l.k || ''}`}>{l.t}</p>) : <p className="muted">Moves appear here as they are played.</p>)
          : (bg.chat.length ? bg.chat.map((c, i) => <p key={i} className={c.bot ? 'bot' : ''}><b>{c.name}</b> {c.text}</p>) : <p className="muted">Say hello. Everyone at this board sees it.</p>)}
      </div>
      {tab === 'chat' && (
        <form className="bg-chat" onSubmit={e => { e.preventDefault(); const t = text.trim(); if (t) app.bgSend('chat', { text: t }); setText(''); }}>
          <input value={text} maxLength={160} onChange={e => setText(e.target.value)} placeholder="Message" aria-label="Chat message" />
          <button className="btn" disabled={!text.trim()}>Send</button>
        </form>
      )}
    </aside>
  );
}

function Confirm({ title, children, yes, no, onYes, onNo }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onNo(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onNo]);
  return (
    <div className="modal open bg-modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => { if (e.target === e.currentTarget) onNo(); }}>
      <div className="sheet">
        <h2>{title}</h2>
        <p className="lede">{children}</p>
        <div className="sheet-actions">
          <button className="btn primary" onClick={onYes} autoFocus>{yes}</button>
          <button className="btn" onClick={onNo}>{no}</button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── the room ───────────── */
export function BgRoom({ bg, app }) {
  const s = bg.s;
  const [confirm, setConfirm] = useState(null); // 'leave' | 'resign'
  const [sideOpen, setSideOpen] = useState(false); // the log and chat, on a phone
  const [autoDone, setAutoDoneState] = useState(!!app.settings.bgAutoDone);
  const setAutoDone = v => { setAutoDoneState(v); app.settings.bgAutoDone = v; app.save(); };
  const me = bg.me;
  const view = me ?? 0;
  const turn = useMemo(() => (s && me != null && s.phase === 'move' && s.turn === me && s.turnState
    ? Turn.restore({ pos: s.pos, seat: me, dice: s.dice, ...s.turnState }) : null), [s, me]);

  // keyboard: space rolls or confirms, U undoes, D doubles, T/P answer a double
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape' && sideOpen) { setSideOpen(false); return; }
      if (!s || me == null || confirm || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.matches && e.target.matches('input, textarea, button')) return;
      const k = e.key.toLowerCase();
      const mine = s.turn === me;
      if ((k === ' ' || k === 'enter') && mine && s.phase === 'roll') { e.preventDefault(); app.bgSend('roll'); }
      else if ((k === ' ' || k === 'enter') && mine && turn && turn.done && turn.moves.length) { e.preventDefault(); app.bgSend('done'); }
      else if ((k === 'u' || k === 'backspace') && turn && turn.moves.length) { e.preventDefault(); app.bgSend('undo'); }
      else if (k === 'd' && mine && s.canDouble) { e.preventDefault(); app.bgSend('double'); }
      else if (s.phase === 'double' && s.offerBy === 1 - me && (k === 't' || k === 'p')) { e.preventDefault(); app.bgSend(k === 't' ? 'take' : 'drop'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [s, me, turn, confirm, sideOpen]);

  if (!s) {
    return (
      <div className="bg-room">
        <BgTop bg={bg} app={app} onLeave={() => app.bgLeave()} />
        <div className="bg-loading">Setting up the board…</div>
      </div>
    );
  }
  const live = s.phase !== 'idle' && s.phase !== 'over';
  const seated = me != null;
  const leave = () => (seated && (live || (s.mode === 'match' && !s.matchOver && (s.scores[0] || s.scores[1]))) ? setConfirm('leave') : app.bgLeave());
  // what giving up now costs: the cube, times a gammon or backgammon if it would be one
  const mult = seated ? resignMult(s.pos, me) : 1, pts = s.cube.value * mult;
  const atStake = () => (s.mode === 'match'
    ? `You forfeit the match and your ${usd(s.entry)} entry.`
    : `You give up ${plural(pts, 'point')}${mult > 1 ? ` (a ${KIND_NAME[mult]})` : ''}, ${usd(pts * s.stake)}.`);
  return (
    <div className="bg-room">
      <BgTop bg={bg} app={app} onLeave={leave} sideOpen={sideOpen} onSide={() => setSideOpen(!sideOpen)} />
      <main className="bg-main">
        <section className="bg-play" aria-label="The board">
          <PlayerBar s={s} seatIdx={1 - view} me={me} bg={bg} app={app} top />
          <Board s={s} view={view} me={me} bg={bg} app={app} turn={turn} autoDone={autoDone} />
          <PlayerBar s={s} seatIdx={view} me={me} bg={bg} app={app} />
          <Controls s={s} me={me} bg={bg} app={app} turn={turn} autoDone={autoDone} setAutoDone={setAutoDone} onResign={() => setConfirm('resign')} />
        </section>
        <Side bg={bg} app={app} open={sideOpen} onClose={() => setSideOpen(false)} />
      </main>
      {confirm === 'leave' && (
        <Confirm title="Leave the board?" yes="Leave" no="Keep playing" onNo={() => setConfirm(null)} onYes={() => { setConfirm(null); app.bgLeave(); }}>
          {live || s.mode === 'match' ? atStake() : ''} {s.mode === 'money' ? 'What is in front of you goes back to your bankroll.' : ''}
        </Confirm>
      )}
      {confirm === 'resign' && (
        <Confirm title="Resign this game?" yes="Resign" no="Play on" onNo={() => setConfirm(null)} onYes={() => { setConfirm(null); app.bgSend('resign'); }}>
          {s.mode === 'match' ? `${s.seats[1 - me]?.name || 'Your opponent'} scores ${plural(pts, 'point')}${mult > 1 ? `, a ${KIND_NAME[mult]}` : ''}.` : atStake()}
        </Confirm>
      )}
    </div>
  );
}

function BgTop({ bg, app, onLeave, sideOpen, onSide }) {
  const s = bg.s, w = app.wallet;
  const fmt = s ? (s.mode === 'money' ? `Money game · ${usd(s.stake)} a point` : `Match to ${s.matchTo} · ${usd(s.entry)} entry`) : '';
  return (
    <header className="topbar bg-topbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5v4.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /><path d="M3.5 15a8.5 8.5 0 0 1 17 0z" fill="currentColor" /><path d="M9.5 18a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /></svg>
        <span className="wordmark">Lamplight</span>
      </div>
      <div className="table-info">
        <span className="ti-name">{s ? s.name : 'Backgammon'}</span>
        <span className="ti-game">{fmt}</span>
        {s && s.mode === 'match' && <span className="ti-stakes">Score <b>{s.scores[0]}-{s.scores[1]}</b>{s.crawford ? ' · Crawford' : ''}</span>}
        {s && s.gameNo > 0 && <span className="ti-hand">Game <b>{s.gameNo}</b></span>}
        <span className={`conn${app.lobby.connected ? '' : ' down'}`}>{app.lobby.connected ? 'Online' : 'Reconnecting'}</span>
      </div>
      <nav className="tools" aria-label="Board tools">
        {w && <span className="wallet-chip" title="Your bankroll"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></svg><b className="num">{usd(w.bankroll)}</b></span>}
        {onSide && (
          <button className="tool bg-side-btn" aria-pressed={String(!!sideOpen)} onClick={onSide} aria-label="Game log and chat">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg>
            {bg.chatUnread && <span className="dot" />}
          </button>
        )}
        <button className="tool" onClick={() => app.openSettings()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M18 7h2M4 17h3M11 17h9" /><circle cx="15.5" cy="7" r="2.3" /><circle cx="8.5" cy="17" r="2.3" /></svg>
          <span className="lbl">Settings</span>
        </button>
        <button className="tool" onClick={onLeave}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" /></svg>
          <span className="lbl">Lobby</span>
        </button>
      </nav>
    </header>
  );
}
