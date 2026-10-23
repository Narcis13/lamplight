/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · gem duel room (React)
   The players, scores, booster meters, perks, clock, banners, the log
   and chat around the canvas board (client/m3board.js). Everything the
   server sends lands in `m3.feed`; the room plays it back one item at a
   time, and the HUD shows the state as of the last thing that finished
   playing, so scores and meters never run ahead of the board.
   ════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from 'react';
import { Fmt, PROFILES } from '../shared/engine.js';
import { M3, BOOSTERS, PERKS, W, rowOf, colOf, validMoves, groupsOf } from '../shared/match3.js';
import { hueOf } from './view.js';
import { M3Board } from './m3board.js';
import { M3Sfx } from './m3sfx.js';

const usd = v => Fmt.usd(v);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const EMOTES = [['clap', '👏', 'Clap'], ['hurry', '⏰', 'Hurry up'], ['like', '👍', 'Nice'], ['facepalm', '🤦', 'Oops'], ['cool', '😎', 'Cool'], ['flag', '🏳️', 'I give'] ];
const EMOJI = Object.fromEntries(EMOTES.map(([k, e]) => [k, e]));
const ACTIONS = new Set(['swap', 'boost', 'perk', 'timeout']);
const live = s => !!(s && s.phase === 'play');

/** What a booster or the hammer would hit if aimed at cell i, for the board's hover preview. */
function previewOf(kind, cells, i) {
  if (!cells[i]) return [];
  const r = rowOf(i), c = colOf(i), line = [...Array(W).keys()];
  const cross = [...new Set([...line.map(x => r * W + x), ...line.map(x => x * W + c)])];
  if (kind === 'beams') return cross;
  if (kind === 'prism') return cells.map((p, j) => (p && p.c === cells[i].c ? j : -1)).filter(j => j >= 0);
  if (kind === 'volt') return cross.filter(j => cells[j] && cells[j].c === cells[i].c);
  return [i];
}
/** The move that makes the biggest match right now (for the idle hint). */
function bestHint(cells) {
  let best = null, size = 0;
  for (const [a, b] of validMoves(cells)) {
    const t = cells.slice();
    [t[a], t[b]] = [t[b], t[a]];
    const n = t[a].s && t[b].s ? 6 : Math.max(0, ...groupsOf(t).map(g => g.set.size));
    if (n > size) { size = n; best = [a, b]; }
  }
  return best;
}

/** The time now, re-rendering every `ms` while `active` (the time itself is read fresh on every render). */
function useNow(active, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick(x => x + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return Date.now();
}
/** A number that counts up to its target instead of jumping. */
function useTween(target, ms = 650) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const a = from.current, t0 = performance.now();
    if (a === target) return;
    let raf;
    const step = t => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
      const x = Math.round(a + (target - a) * e);
      setV(x); from.current = x;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

/* ───────────── players ───────────── */
function Avatar({ seat }) {
  const P = seat.profileKey ? PROFILES[seat.profileKey] : null;
  return <span className="m3-av" style={{ '--hue': P ? P.hue : hueOf(seat.name) }} aria-hidden="true">{P ? P.emoji : (seat.name[0] || '?').toUpperCase()}</span>;
}

function Meter({ duel, seat, mine, theirs }) {
  const key = duel ? duel.boosters[seat] : null, B = key ? BOOSTERS[key] : null;
  if (!B) return null;
  const n = duel.charge[seat], ready = n >= B.cost;
  return (
    <span className={`m3-meter${ready ? ' ready' : ''}${mine ? ' mine' : theirs ? ' theirs' : ''}`} title={`${B.name}: ${B.desc} Charges with ${B.cost} of ${mine ? 'your' : 'their'} gems.`}>
      <span className="m3-bicon" aria-hidden="true">{B.icon}</span>
      <span className="m3-bname">{B.name}</span>
      <span className="m3-pips" aria-label={`${Math.min(n, B.cost)} of ${B.cost} charged`}>
        {Array.from({ length: B.cost }, (_, k) => <i key={k} className={k < n ? 'on' : ''} />)}
      </span>
    </span>
  );
}

function PlayerCard({ s, seatIdx, me, view, refs, bubble, clockLeft, cls }) {
  const seat = s.seats[seatIdx], d = s.duel;
  const mine = seatIdx === view, onTurn = live(s) && d.turn === seatIdx;
  const score = useTween(d ? d.scores[seatIdx] : 0);
  const reserved = s.reserved.find(r => r.seat === seatIdx);
  if (!seat) {
    return (
      <div className={`m3-player empty ${cls}`}>
        <span className="m3-name"><b>{reserved ? `${reserved.name} is sitting down` : 'Open seat'}</b><small>{s.entry ? `${usd(s.entry)} entry` : 'Free to play'}</small></span>
      </div>
    );
  }
  const P = seat.profileKey ? PROFILES[seat.profileKey] : null;
  let status = '';
  if (!seat.connected) status = 'Reconnecting…';
  else if (seat.away) status = 'Sitting out: the house plays';
  else if (onTurn) status = seat.kind === 'bot' ? 'Thinking…' : seatIdx === me ? 'Your turn' : 'Their turn';
  const clock = onTurn && s.clock && s.clock.seat === seatIdx ? s.clock : null;
  return (
    <div className={`m3-player ${cls}${onTurn ? ' on' : ''}${mine ? ' mine' : ' theirs'}`}>
      <Avatar seat={seat} />
      <span className="m3-name">
        <b>{seat.name}{seatIdx === me && <em className="m3-me">You</em>}{P && <em className="m3-tag">{P.tag}</em>}</b>
        <small>{status || (d && d.boosters ? `${seat.wins ? `${plural(seat.wins, 'win')} here · ` : ''}${mine ? 'Blue gems' : 'Red gems'}` : BOOSTERS[seat.booster]?.name || '')}</small>
      </span>
      <span className="m3-score" ref={el => { refs.score[seatIdx] = el; }}>
        <b className="num">{score}</b>
        {onTurn && d && <span className="m3-moves" aria-label={`${plural(d.moves, 'move')} left`}>{Array.from({ length: Math.max(d.perTurn, d.moves) }, (_, k) => <i key={k} className={k < d.moves ? 'on' : ''} />)}</span>}
      </span>
      <span className="m3-charge" ref={el => { refs.charge[seatIdx] = el; }}><Meter duel={d} seat={seatIdx} mine={mine} theirs={!mine} /></span>
      {clock && <span className="m3-clock" aria-label={`${Math.ceil(clockLeft / 1000)} seconds`}><i style={{ transform: `scaleX(${clock.total ? Math.min(1, clockLeft / clock.total) : 0})` }} className={clockLeft < 8000 ? 'low' : ''} /></span>}
      {bubble && <span className="m3-bubble" key={bubble.key}>{bubble.emoji || bubble.text}</span>}
    </div>
  );
}

/* ───────────── your controls ───────────── */
function Controls({ s, me, ready, target, onBoost, onPerk, onCancel, onEmote, emoteOpen, setEmoteOpen, app }) {
  const d = s.duel, seat = me != null ? s.seats[me] : null;
  if (me == null) {
    const open = s.seats.some(x => !x || x.kind === 'bot') && s.reserved.length < 2;
    return (
      <div className="m3-controls watching">
        <span className="m3-hint">{app.m3.pending != null ? "Seat saved. You're in when this match ends" : open ? 'Watching' : 'Watching. Both seats are taken'}</span>
        {open && app.m3.pending == null && <button className="btn primary" onClick={() => app.m3Sit(-1)}>{s.entry ? `Play · ${usd(s.entry)} entry` : 'Play'}</button>}
      </div>
    );
  }
  if (seat && seat.away) {
    return (
      <div className="m3-controls">
        <span className="m3-hint">{live(s) ? "You're sitting out: the house plays your turns" : "You're sitting out"}</span>
        <button className="btn primary" onClick={() => app.net.send({ t: 'back' })}>I'm back</button>
      </div>
    );
  }
  if (target) {
    const what = target.kind === 'hammer' ? 'the piece to smash' : BOOSTERS[target.kind].name === 'Prism Wand' ? 'a piece: its whole colour goes' : 'where it hits';
    return (
      <div className="m3-controls targeting">
        <span className="m3-hint">Tap {what}</span>
        <button className="btn" onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
      </div>
    );
  }
  const key = d ? d.boosters[me] : seat?.booster, B = BOOSTERS[key];
  const charged = d && d.charge[me] >= B.cost;
  const perks = d ? d.perks[me] : { hammer: true, shuffle: true };
  return (
    <div className="m3-controls">
      {B && (
        <button className={`m3-boost${charged ? ' charged' : ''}`} disabled={!ready || !charged} onClick={onBoost}
          title={`${B.name}: ${B.desc}${charged ? '' : ` Clear ${B.cost - (d ? d.charge[me] : 0)} more blue gems to charge it.`}`}>
          <span className="m3-bicon" aria-hidden="true">{B.icon}</span>
          <span><b>{B.name}</b><small>{charged ? (B.target ? 'Ready: tap, then aim' : 'Ready: tap to fire') : `${d ? d.charge[me] : 0} / ${B.cost} charged`}</small></span>
          <kbd>B</kbd>
        </button>
      )}
      <div className="m3-perks">
        {Object.entries(PERKS).map(([k, P]) => (
          <button key={k} className="m3-perk" disabled={!ready || !perks[k]} onClick={() => onPerk(k)} title={`${P.name}: ${P.desc}`} aria-label={`${P.name}${perks[k] ? '' : ' (used)'}`}>
            <span aria-hidden="true">{P.icon}</span><small>{perks[k] ? P.name : 'Used'}</small>
          </button>
        ))}
        <div className="m3-emote-wrap">
          <button className="m3-perk" onClick={() => setEmoteOpen(!emoteOpen)} aria-expanded={emoteOpen} aria-label="Emotes"><span aria-hidden="true">😊</span><small>Emote</small></button>
          {emoteOpen && (
            <div className="m3-emotes" role="menu">
              {EMOTES.map(([k, e, l]) => <button key={k} role="menuitem" title={l} aria-label={l} onClick={() => { onEmote(k); setEmoteOpen(false); }}>{e}</button>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── over the board: before, between and after matches ───────────── */
function BoosterPick({ value, onPick }) {
  return (
    <div className="m3-pick" role="radiogroup" aria-label="Your booster">
      {Object.entries(BOOSTERS).map(([k, B]) => (
        <button key={k} role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onPick(k)} title={B.desc}>
          <span className="m3-bicon" aria-hidden="true">{B.icon}</span>
          <b>{B.name}</b>
          <small>{B.desc}</small>
          <em>{B.cost} gems</em>
        </button>
      ))}
    </div>
  );
}

function Curtain({ s, me, view, app, m3, nextLeft }) {
  const r = s.result, seat = me != null ? s.seats[me] : null;
  const [link, setLink] = useState(false);
  const copy = async () => {
    const url = `${location.origin}/?t=${s.id}`;
    try { await navigator.clipboard.writeText(url); setLink(true); setTimeout(() => setLink(false), 1500); } catch { prompt('Share this link', url); }
  };
  let head = null;
  if (r && s.phase === 'over') {
    const won = me != null && r.winner === me, lost = me != null && r.loser === me;
    const title = r.winner === -1 ? 'A draw' : won ? (r.landslide ? 'Landslide!' : 'You win!') : lost ? 'You lose' : `${r.names[r.winner]} wins`;
    const sub = r.kind === 'forfeit' ? (won ? 'Your opponent left the match' : 'Forfeit') : r.landslide && !won && r.winner >= 0 ? 'A landslide' : '';
    head = (
      <div className={`m3-result${won ? ' won' : lost ? ' lost' : ''}`}>
        <small>{sub || `Match ${r.matchNo}`}</small>
        <b>{title}</b>
        <span className="m3-final num"><i className={view === 0 ? 'mine' : 'theirs'}>{r.scores[0]}</i> – <i className={view === 1 ? 'mine' : 'theirs'}>{r.scores[1]}</i></span>
        {s.entry > 0 && <span className="prize">{r.winner === -1 ? 'Entries go back' : won ? `${usd(r.prize)} to your bankroll` : lost ? `−${usd(s.entry)}` : `${usd(r.prize)} to the winner`}</span>}
      </div>
    );
  }
  const wait = s.phase === 'idle' ? s.waiting : nextLeft > 0 && !s.waiting ? `Next match in ${nextLeft}s` : s.waiting;
  return (
    <div className="m3-curtain">
      <div className="m3-curtain-card">
        {head}
        {!head && <div className="m3-result"><small>{M3.formats[s.format].label} · {M3.formats[s.format].desc}</small><b>{s.name}</b></div>}
        {wait && <p className="m3-wait">{wait}</p>}
        {s.phase === 'idle' && !s.withBot && me != null && s.seats.some(x => !x) && <button className="btn small" onClick={copy}>{link ? 'Copied' : 'Copy the invite link'}</button>}
        {seat && seat.kind === 'human' && (
          <>
            <h3>Your booster for the {s.phase === 'over' ? 'next' : ''} match</h3>
            <BoosterPick value={seat.booster} onPick={k => app.m3Booster(k)} />
          </>
        )}
        {me == null && <p className="m3-wait">{m3.pending != null ? "Seat saved. You're in when this match ends" : ''}</p>}
      </div>
    </div>
  );
}

/** The big callouts: rounds, whose turn, extra moves, boosters. */
function Banner({ b }) {
  if (!b) return null;
  return (
    <div className={`m3-banner ${b.tone || ''}`} key={b.key} role="status">
      {b.small && <small>{b.small}</small>}
      <b>{b.text}</b>
    </div>
  );
}

/* ───────────── log & chat ───────────── */
function Side({ m3, app, open, onClose, opts }) {
  const [tab, setTab] = useState('log');
  const [text, setText] = useState('');
  const box = useRef(null);
  const items = tab === 'log' ? m3.log : m3.chat;
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [items.length, tab, open]);
  const aside = useRef(null);
  useEffect(() => {
    const shown = aside.current && getComputedStyle(aside.current).visibility !== 'hidden';
    if (tab === 'chat' && m3.chatUnread && shown) app.clearChatUnread();
  }, [tab, m3.chatUnread, open]);
  return (
    <aside className={`m3-side panel-card${open ? ' open' : ''}`} ref={aside}>
      <button className="tool close m3-side-close" aria-label="Close" onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <div className="bg-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Match log</button>
        <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>Chat{m3.chatUnread && tab !== 'chat' ? <span className="dot" /> : null}</button>
      </div>
      <div className="bg-feed" ref={box}>
        {tab === 'log'
          ? (m3.log.length ? m3.log.map((l, i) => <p key={i} className={`ln ${l.k || ''}`}>{l.t}</p>) : <p className="muted">Moves appear here as they are played.</p>)
          : (m3.chat.length ? m3.chat.map((c, i) => <p key={i} className={c.bot ? 'bot' : ''}><b>{c.name}</b> {c.text}</p>) : <p className="muted">Say hello. Everyone at this board sees it.</p>)}
      </div>
      {tab === 'chat' && (
        <form className="bg-chat" onSubmit={e => { e.preventDefault(); const t = text.trim(); if (t) app.net.send({ t: 'chat', text: t }); setText(''); }}>
          <input value={text} maxLength={160} onChange={e => setText(e.target.value)} placeholder="Message" aria-label="Chat message" />
          <button className="btn" disabled={!text.trim()}>Send</button>
        </form>
      )}
      {opts && <div className="m3-side-opts">{opts}</div>}
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

function M3Top({ m3, app, shown, onLeave, sideOpen, onSide }) {
  const s = shown, w = app.wallet, d = s && s.duel;
  const fmt = s ? `${M3.formats[s.format].label} · ${s.entry ? `${usd(s.entry)} entry` : 'free'}` : '';
  return (
    <header className="topbar m3-topbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5v4.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /><path d="M3.5 15a8.5 8.5 0 0 1 17 0z" fill="currentColor" /><path d="M9.5 18a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /></svg>
        <span className="wordmark">Lamplight</span>
      </div>
      <div className="table-info">
        <span className="ti-name">{s ? s.name : 'Gem Duel'}</span>
        <span className="ti-game">{fmt}</span>
        {d && live(s) && <span className="ti-hand">Round <b>{d.round}</b> of {d.rounds}</span>}
        <span className={`conn${app.lobby.connected ? '' : ' down'}`}>{app.lobby.connected ? 'Online' : 'Reconnecting'}</span>
      </div>
      <nav className="tools" aria-label="Duel tools">
        {w && <span className="wallet-chip" title="Your bankroll"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></svg><b className="num">{usd(w.bankroll)}</b></span>}
        {onSide && (
          <button className="tool m3-side-btn" aria-pressed={String(!!sideOpen)} onClick={onSide} aria-label="Match log and chat">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg>
            {m3.chatUnread && <span className="dot" />}
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

/* ───────────── the room ───────────── */
export function M3Room({ m3, app }) {
  const host = useRef(null), boardRef = useRef(null), sfxRef = useRef(null);
  const refs = useRef({ score: [null, null], charge: [null, null] }).current;
  const [shown, setShown] = useState(m3.s); // the state as of the last thing the board finished playing
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);
  const [bubbles, setBubbles] = useState([null, null]);
  const [target, setTarget] = useState(null); // { kind } while aiming a booster or the hammer
  const [confirm, setConfirm] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const pumping = useRef(false), shownRef = useRef(m3.s);
  const me = m3.me, view = me ?? 0;
  const s = shown;

  const say = (text, small = '', tone = '', ms = 1300) => {
    const key = Math.random();
    setBanner({ text, small, tone, key });
    setTimeout(() => setBanner(b => (b && b.key === key ? null : b)), ms);
  };
  const bubble = (seat, b) => {
    const key = Math.random();
    setBubbles(x => { const y = x.slice(); y[seat] = { ...b, key }; return y; });
    setTimeout(() => setBubbles(x => { if (!x[seat] || x[seat].key !== key) return x; const y = x.slice(); y[seat] = null; return y; }), 2600);
  };
  const promote = st => { shownRef.current = st; setShown(st); };

  // the canvas board lives as long as the room
  useEffect(() => {
    const sfx = new M3Sfx(app.sfx);
    sfxRef.current = sfx;
    const board = new M3Board(host.current, {
      sfx,
      onSwap: (a, b) => app.net.send({ t: 'swap', a, b }),
      onTap: i => {
        setTarget(t => {
          if (!t) return null;
          if (t.kind === 'hammer') app.net.send({ t: 'perk', kind: 'hammer', target: i });
          else app.net.send({ t: 'boost', target: i });
          return null;
        });
      },
      onBusy: v => setBusy(v),
    });
    boardRef.current = board;
    return () => { board.destroy(); boardRef.current = null; m3.onFeed = null; };
  }, []);
  useEffect(() => { boardRef.current?.setTargets({ score: refs.score, charge: refs.charge }); });
  useEffect(() => { boardRef.current?.setView(view); }, [view]);

  // a snapshot (first join, reconnect): snap the board and start the feed over
  useEffect(() => {
    const b = boardRef.current;
    if (!b || !m3.s) return;
    b.setBoard(m3.s.duel ? m3.s.duel.board : []);
    promote(m3.s);
  }, [m3.snapNo]);

  // play the feed back, one item at a time
  useEffect(() => {
    m3.onFeed = () => pump();
    pump();
  }, []);
  async function pump() {
    if (pumping.current) return;
    pumping.current = true;
    try {
      while (m3.feed.length && boardRef.current) {
        const item = m3.feed.shift();
        await play(item, m3.feed.length);
      }
    } finally { pumping.current = false; }
  }
  async function play(item, behind) {
    const board = boardRef.current, sfx = sfxRef.current, mySeat = m3.me;
    if (item.emote) { bubble(item.emote.seat, { emoji: EMOJI[item.emote.k] }); sfx.emote(); return; }
    if (item.chat) { if (item.chat.seat != null) bubble(item.chat.seat, { text: item.chat.text }); return; }
    const { s: st, ev } = item;
    const nameOf = i => (st.seats[i] ? st.seats[i].name : 'They');
    if (!ev) { promote(st); return; }
    if (ev.type === 'start') {
      board.setBoard(st.duel.board);
      promote(st);
      sfx.round(1, false);
      say(mySeat == null ? `${nameOf(ev.first)} goes first` : ev.first === mySeat ? 'You go first' : `${nameOf(ev.first)} goes first`, `Match ${ev.matchNo}`, 'gold', 1900);
      return;
    }
    if (ev.type === 'turn') {
      promote(st);
      const d = st.duel, final = d.round === d.rounds;
      const yours = mySeat != null && ev.seat === mySeat;
      if (d.half === 0 && behind < 2) { sfx.round(d.round, final); say(final ? 'Final round' : `Round ${d.round}`, `of ${d.rounds}`, 'gold', 1000); await wait(1000); }
      if (yours) sfx.yourTurn(); else sfx.theirTurn();
      if (behind < 2) say(yours ? 'Your turn' : `${nameOf(ev.seat)}'s turn`, yours ? `${plural(d.moves, 'move')}` : '', yours ? 'mine' : 'theirs', 1100);
      return;
    }
    if (ev.type === 'reject') {
      if (ev.seat === mySeat && !board.cancelPending()) { sfx.bad(); app.view.toast("That won't work there"); }
      promote(st);
      return;
    }
    if (ACTIONS.has(ev.type)) {
      if (ev.type === 'timeout') say(ev.seat === mySeat ? "Time's up" : `${nameOf(ev.seat)} ran out of time`, '', 'theirs', 1200);
      await board.play(ev, st.duel.board, { speed: behind > 3 ? 4 : behind > 1 ? 2 : 1 });
      promote(st);
      // the board calls out extra moves and cascades itself (and plays their sounds); the booster is ours to announce
      const mineAct = mySeat != null && ev.seat === mySeat;
      if (ev.ready && !ev.extra) say(mineAct ? 'Booster ready!' : `${nameOf(ev.seat)}'s booster is ready`, BOOSTERS[st.duel.boosters[ev.seat]].name, mineAct ? 'mine' : 'theirs', 1200);
      return;
    }
    if (ev.type === 'over') {
      promote(st);
      const r = ev.result;
      if (mySeat == null || r.winner === -1) sfx.draw(); else if (r.winner === mySeat) sfx.win(); else sfx.lose();
      return;
    }
    promote(st);
  }
  const wait = ms => new Promise(r => setTimeout(r, document.hidden ? 0 : ms));

  // what the board accepts right now
  const latest = m3.s;
  const myTurn = me != null && live(s) && s.duel.turn === me && s.seats[me] && !s.seats[me].away
    && latest && latest.clock && latest.clock.seat === me && s.duel.moves > 0;
  const ready = myTurn && !busy && !m3.feed.length;
  useEffect(() => {
    const b = boardRef.current;
    if (!b) return;
    if (ready && target) b.setInput('target', { preview: i => previewOf(target.kind, s.duel.board, i) });
    else b.setInput(ready ? 'swap' : 'off');
  }, [ready, target, s]);
  useEffect(() => { if (!ready && target) setTarget(null); }, [ready]);

  // a hint after a while with nothing happening
  useEffect(() => {
    const b = boardRef.current;
    if (!b) return;
    b.hint(null);
    if (!ready || target) return;
    const t = setTimeout(() => b.hint(bestHint(s.duel.board)), 9000);
    return () => clearTimeout(t);
  }, [ready, target, s]);

  // the clock: it stands still while the last event plays, then runs
  const now = useNow(!!(latest && (latest.clock || latest.nextIn != null)));
  let clockLeft = 0;
  if (latest && latest.clock) {
    const freeze = m3.lastAnim || 0, gone = now - m3.stateAt;
    clockLeft = Math.max(0, latest.clock.left - Math.max(0, gone - freeze));
  }
  const lastTick = useRef(0);
  useEffect(() => {
    if (!myTurn || !latest.clock) return;
    const sec = Math.ceil(clockLeft / 1000);
    if (sec <= 5 && sec >= 1 && sec !== lastTick.current) { lastTick.current = sec; sfxRef.current?.tick(); }
  }, [now]);

  const onBoost = () => {
    if (!ready) return;
    const key = s.duel.boosters[me];
    if (s.duel.charge[me] < BOOSTERS[key].cost) return;
    if (BOOSTERS[key].target) setTarget({ kind: key });
    else app.net.send({ t: 'boost' });
  };
  const onPerk = k => {
    if (!ready || !s.duel.perks[me][k]) return;
    if (PERKS[k].target) setTarget({ kind: k });
    else app.net.send({ t: 'perk', kind: k });
  };

  // keys: B fires the booster, H the hammer, S shuffles, Escape cancels aiming
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { if (target) setTarget(null); else if (sideOpen) setSideOpen(false); else if (emoteOpen) setEmoteOpen(false); return; }
      if (confirm || e.metaKey || e.ctrlKey || e.altKey || (e.target.matches && e.target.matches('input, textarea'))) return;
      const k = e.key.toLowerCase();
      if (k === 'b') onBoost(); else if (k === 'h') onPerk('hammer'); else if (k === 's') onPerk('shuffle');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const nextLeft = m3.nextAt ? Math.max(0, Math.ceil((m3.nextAt - now) / 1000)) : 0;

  const seated = me != null;
  const leave = () => (seated && live(m3.s) ? setConfirm('leave') : app.m3Leave());
  const opp = 1 - view;
  const opts = seated && (
    <div className="m3-opts">
      {live(s) && s.seats[me] && !s.seats[me].away && <button className="btn small ghost" onClick={() => app.net.send({ t: 'sitOut' })}>Sit out</button>}
      {live(s) && <button className="btn small ghost" onClick={() => { setSideOpen(false); setConfirm('resign'); }}>Resign</button>}
    </div>
  );
  return (
    <div className="m3-room">
      <M3Top m3={m3} app={app} shown={s} onLeave={leave} sideOpen={sideOpen} onSide={() => setSideOpen(!sideOpen)} />
      <main className="m3-main">
        <section className={`m3-play${target ? ' aiming' : ''}`} aria-label="The duel">
          {s && <PlayerCard s={s} seatIdx={opp} me={me} view={view} refs={refs} bubble={bubbles[opp]} clockLeft={clockLeft} cls="m3-them" />}
          <div className="m3-stage">
            <div className="m3-board" ref={host} />
            {s && (s.phase === 'idle' || (s.phase === 'over' && s.result)) && <Curtain s={s} me={me} view={view} app={app} m3={m3} nextLeft={nextLeft} />}
            <Banner b={banner} />
            {!s && <div className="m3-loading">Setting up the board…</div>}
          </div>
          {s && <PlayerCard s={s} seatIdx={view} me={me} view={view} refs={refs} bubble={bubbles[view]} clockLeft={clockLeft} cls="m3-you" />}
          {s && (
            <Controls s={s} me={me} ready={ready} target={target} app={app}
              onBoost={onBoost} onPerk={onPerk} onCancel={() => setTarget(null)}
              onEmote={k => app.net.send({ t: 'emote', k })} emoteOpen={emoteOpen} setEmoteOpen={setEmoteOpen} />
          )}
          {s && seated && <div className="m3-opts-row">{opts}</div>}
        </section>
        {sideOpen && <div className="bg-scrim" onClick={() => setSideOpen(false)} />}
        <Side m3={m3} app={app} open={sideOpen} onClose={() => setSideOpen(false)} opts={opts} />
      </main>
      {confirm === 'leave' && (
        <Confirm title="Leave the duel?" yes="Leave" no="Keep playing" onNo={() => setConfirm(null)} onYes={() => { setConfirm(null); app.m3Leave(); }}>
          Leaving now forfeits the match{s && s.entry ? ` and your ${usd(s.entry)} entry` : ''}.
        </Confirm>
      )}
      {confirm === 'resign' && (
        <Confirm title="Resign this match?" yes="Resign" no="Play on" onNo={() => setConfirm(null)} onYes={() => { setConfirm(null); app.net.send({ t: 'resign' }); }}>
          {s && s.seats[1 - me] ? s.seats[1 - me].name : 'Your opponent'} wins{s && s.entry ? ` and takes both entries (${usd(s.entry * 2)})` : ''}.
        </Confirm>
      )}
    </div>
  );
}
