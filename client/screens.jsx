/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · profile & leaderboard (React)
   Pure presentation: the App fetches db.profile() / db.leaderboard()
   over the socket and hands the results in. Nothing here talks to the
   server.
   ════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Fmt } from '../shared/engine.js';
import { PROFILES } from '../shared/profiles.js';
import { ACHIEVEMENTS } from '../shared/achievements.js';
import { cardHTML, hueOf } from './view.js';

/* ───────────── little helpers ───────────── */
const usd = v => Fmt.usd(Math.abs(v || 0));
const signedUsd = v => (v > 0 ? '+' : v < 0 ? '−' : '') + usd(v);
const chips = v => Math.round(Math.abs(v || 0)).toLocaleString('en-US');
const signedIn = (v, mode) => (v > 0 ? '+' : v < 0 ? '−' : '') + (mode === 'sng' ? chips(v) : usd(v));
const tone = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const ordinal = n => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10 * (Math.floor(n / 10) % 10 !== 1)] || 'th');

export function timeAgo(t) {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  const d = Math.round(s / 86400);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
const monthYear = t => (t ? new Date(t).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—');
const shortDate = t => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

/** A row of cards drawn with the table's own card markup. */
export function CardRow({ cards, size = 'mini', empty = 0, hl }) {
  const list = (cards || []).slice();
  while (list.length < empty) list.push(null);
  const html = list.map(c => {
    const h = cardHTML(c, { down: c == null });
    return hl && c != null && hl.has(c) ? h.replace('class="card', 'class="card hl') : h;
  }).join('');
  return <div className={`x-cards x-${size}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Avatar({ name, profileKey, size = 36 }) {
  const P = profileKey ? PROFILES[profileKey] : null;
  const hue = P ? P.hue : hueOf(name || '?');
  return (
    <span className={`x-av${P ? ' bot' : ''}`} style={{ '--hue': hue, width: size, height: size, fontSize: size * (P ? 0.5 : 0.46) }} aria-hidden="true">
      {P ? P.emoji : (String(name || '?').trim()[0] || '?').toUpperCase()}
    </span>
  );
}

/* ───────────── winnings chart ───────────── */
function useWidth(ref, fallback = 640) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

/** Smooth path through points (Catmull-Rom as cubic Béziers, clamped so it never overshoots wildly). */
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const t = 0.16;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
    c1[1] = Math.min(hi, Math.max(lo, c1[1])); c2[1] = Math.min(hi, Math.max(lo, c2[1]));
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

export function WinningsChart({ graph, mine = true }) {
  const wrap = useRef(null);
  const W = useWidth(wrap);
  const H = 220, padL = 56, padR = 14, padT = 16, padB = 26;
  const [hover, setHover] = useState(null);
  const series = useMemo(() => [0, ...(graph || [])], [graph]);
  const n = series.length;
  const model = useMemo(() => {
    if (n < 3) return null;
    // keep at most ~320 drawn points: stride, but never drop the extremes
    const stride = Math.max(1, Math.ceil(n / 320));
    const idx = [];
    for (let i = 0; i < n; i += stride) {
      let pick = i, lo = i, hi = i;
      for (let j = i; j < Math.min(n, i + stride); j++) { if (series[j] < series[lo]) lo = j; if (series[j] > series[hi]) hi = j; }
      if (stride > 1) { if (lo !== i) idx.push(Math.min(lo, hi)); pick = Math.max(lo, hi); }
      idx.push(pick);
    }
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    const uniq = [...new Set(idx)].sort((a, b) => a - b);
    let min = Math.min(0, ...series), max = Math.max(0, ...series);
    if (min === max) { min -= 10; max += 10; }
    const padV = (max - min) * 0.08; min -= padV; max += padV;
    const x = i => padL + (i / (n - 1)) * (W - padL - padR);
    const y = v => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const pts = uniq.map(i => [x(i), y(series[i])]);
    const line = smoothPath(pts);
    const zeroY = y(0);
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${zeroY.toFixed(1)} L${pts[0][0].toFixed(1)},${zeroY.toFixed(1)} Z`;
    const ticks = niceTicks(min, max);
    return { x, y, line, area, zeroY, ticks, min, max };
  }, [series, W, n]);

  if (!model) {
    return (
      <div className="pf-chart empty" ref={wrap}>
        <div className="pf-empty-art" aria-hidden="true">📈</div>
        {mine ? <p><b>Your graph starts here.</b> Play a few hands at a cash table and your running winnings will be drawn here, hand by hand.</p>
          : <p><b>No cash hands yet.</b> Their running winnings show up here once they play.</p>}
      </div>
    );
  }
  const last = series[n - 1];
  const pick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const hv = hover != null ? { i: hover, v: series[hover], x: model.x(hover), y: model.y(series[hover]) } : null;
  const zeroFrac = Math.min(1, Math.max(0, model.zeroY / H));
  return (
    <div className="pf-chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={`Cumulative winnings over ${n - 1} cash hands, now ${signedUsd(last)}`}
        onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="pfStroke" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={H}>
            <stop offset={zeroFrac} style={{ stopColor: 'var(--pos)' }} />
            <stop offset={zeroFrac} style={{ stopColor: 'var(--neg)' }} />
          </linearGradient>
          <linearGradient id="pfFill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={H}>
            <stop offset="0" style={{ stopColor: 'var(--pos)', stopOpacity: 0.32 }} />
            <stop offset={zeroFrac} style={{ stopColor: 'var(--pos)', stopOpacity: 0.02 }} />
            <stop offset={zeroFrac} style={{ stopColor: 'var(--neg)', stopOpacity: 0.02 }} />
            <stop offset="1" style={{ stopColor: 'var(--neg)', stopOpacity: 0.3 }} />
          </linearGradient>
        </defs>
        {model.ticks.map(t => (
          <g key={t} className="pf-tick">
            <line x1={padL} x2={W - padR} y1={model.y(t)} y2={model.y(t)} />
            <text x={padL - 8} y={model.y(t) + 4} textAnchor="end">{t === 0 ? '$0' : (t > 0 ? '' : '−') + '$' + compact(Math.abs(t))}</text>
          </g>
        ))}
        <line className="pf-zero" x1={padL} x2={W - padR} y1={model.zeroY} y2={model.zeroY} />
        <path d={model.area} fill="url(#pfFill)" />
        <path className="pf-line" d={model.line} stroke="url(#pfStroke)" />
        <text className="pf-axis" x={padL} y={H - 6}>Hand 1</text>
        <text className="pf-axis" x={W - padR} y={H - 6} textAnchor="end">Hand {(n - 1).toLocaleString('en-US')}</text>
        {hv && (
          <g className="pf-hover">
            <line x1={hv.x} x2={hv.x} y1={padT} y2={H - padB} />
            <circle cx={hv.x} cy={hv.y} r="5" className={tone(hv.v)} />
          </g>
        )}
      </svg>
      {hv && (
        <div className="pf-tip" style={{ left: `${(hv.x / W) * 100}%`, top: hv.y }}>
          <span>{hv.i === 0 ? 'Start' : `Hand ${hv.i.toLocaleString('en-US')}`}</span>
          <b className={tone(hv.v)}>{signedUsd(hv.v) || '$0'}</b>
        </div>
      )}
    </div>
  );
}
function compact(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (v >= 1e4) return Math.round(v / 1e3) + 'k';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

/* ───────────── what the bots think of you ───────────── */
const PRIOR = { vpip: 0.28, pfr: 0.18, threeBet: 0.07, cbet: 0.6, foldToCbet: 0.45, af: 2, wtsd: 0.3, wsd: 0.5 };
const shrink = (k, n, prior, w) => (k + prior * w) / (n + w);
/** The stored reads are raw counters; turn them into the same shrunk rates the bots use. */
export function readRates(r) {
  if (!r) return null;
  const n = r.n || r;
  if (typeof n.h === 'number') {
    const g = k => Number(n[k]) || 0;
    return {
      hands: g('h'),
      vpip: shrink(g('vp'), g('h'), PRIOR.vpip, 12), pfr: shrink(g('pf'), g('h'), PRIOR.pfr, 12),
      threeBet: shrink(g('tb'), g('tbo'), PRIOR.threeBet, 15), cbet: shrink(g('cb'), g('cbo'), PRIOR.cbet, 8),
      foldToCbet: shrink(g('fc'), g('fco'), PRIOR.foldToCbet, 8), af: (g('ag') + PRIOR.af * 4) / (g('ca') + 4),
      wtsd: shrink(g('sd'), g('sf'), PRIOR.wtsd, 10), wsd: shrink(g('sw'), g('sd'), PRIOR.wsd, 8),
    };
  }
  if (typeof r.vpip === 'number') return { hands: r.hands || 0, ...r };
  return null;
}
function readNotes(s) {
  const notes = [];
  const add = (weight, text) => notes.push([weight, text]);
  if (s.vpip > 0.38) add(s.vpip - 0.38, 'You play lots of hands, so bots will value-bet you thinner and bluff you less.');
  else if (s.vpip < 0.18) add(0.18 - s.vpip, "You're seen as tight. When you raise, bots give you credit.");
  if (s.vpip - s.pfr > 0.15) add(s.vpip - s.pfr - 0.15, 'You call far more than you raise preflop. Expect isolation raises.');
  if (s.foldToCbet > 0.55) add(s.foldToCbet - 0.55, 'Bots think you fold to continuation bets often. Expect more bluffs.');
  else if (s.foldToCbet < 0.35) add(0.35 - s.foldToCbet, 'You rarely fold to continuation bets. Bots bluff you less and bet their good hands.');
  if (s.af > 3) add((s.af - 3) / 5, "You're very aggressive after the flop. Bots will call you down lighter.");
  else if (s.af < 1.2) add((1.2 - s.af) / 3, "You're mostly passive after the flop. When you do raise, bots believe you.");
  if (s.wtsd > 0.4) add(s.wtsd - 0.4, 'You go to showdown a lot. Bluffing you rarely works, and bots know it.');
  if (s.threeBet > 0.11) add(s.threeBet - 0.11, 'You 3-bet often. Bots will fight back with lighter 4-bets.');
  notes.sort((a, b) => b[0] - a[0]);
  return notes.length ? notes.slice(0, 3).map(n => n[1]) : ['Bots see you as a fairly balanced player. Nothing obvious to exploit yet.'];
}
const READ_ROWS = [
  ['vpip', 'Plays a hand', 'VPIP'], ['pfr', 'Raises first in', 'PFR'], ['threeBet', 'Re-raises (3-bet)', '3-bet'],
  ['cbet', 'Follows up with a c-bet', 'C-bet'], ['foldToCbet', 'Folds to a c-bet', 'Fold to c-bet'],
  ['wtsd', 'Goes to showdown', 'WTSD'], ['wsd', 'Wins at showdown', 'W$SD'],
];
function BotReads({ reads }) {
  const s = readRates(reads);
  if (!s) return null;
  const forming = s.hands < 30;
  return (
    <section className="pf-box pf-reads" aria-labelledby="pfReadsT">
      <header className="pf-box-head">
        <h3 id="pfReadsT">How the bots read you</h3>
        <span className="pf-note">{forming ? `Early days: ${s.hands} hands seen, reads still forming` : `From ${s.hands.toLocaleString('en-US')} hands they've watched`}</span>
      </header>
      <div className="pf-read-grid">
        {READ_ROWS.map(([k, label, abbr]) => s[k] != null && (
          <div className="pf-read" key={k} title={abbr}>
            <span className="pf-read-l">{label}<small>{abbr}</small></span>
            <span className="pf-bar"><i style={{ width: `${Math.round(Math.min(1, s[k]) * 100)}%` }} /><em style={{ left: `${Math.round((PRIOR[k] ?? 0) * 100)}%` }} title="Typical player" /></span>
            <b className="num">{Math.round(s[k] * 100)}%</b>
          </div>
        ))}
        {s.af != null && (
          <div className="pf-read" title="Aggression factor: bets and raises per call after the flop">
            <span className="pf-read-l">Aggression<small>AF</small></span>
            <span className="pf-bar"><i style={{ width: `${Math.round(Math.min(1, s.af / 5) * 100)}%` }} /><em style={{ left: `${(PRIOR.af / 5) * 100}%` }} title="Typical player" /></span>
            <b className="num">{s.af.toFixed(1)}</b>
          </div>
        )}
      </div>
      <ul className="pf-read-notes">{readNotes(s).map(t => <li key={t}>{t}</li>)}</ul>
      <p className="pf-legend"><em aria-hidden="true" /> marks a typical player</p>
    </section>
  );
}

/* ───────────── profile ───────────── */
function Tile({ label, value, sub, cls = '', big }) {
  return (
    <div className={`pf-tile${big ? ' big' : ''}`}>
      <span className="pf-tile-l">{label}</span>
      <b className={`num ${cls}`}>{value}</b>
      {sub && <span className="pf-tile-s">{sub}</span>}
    </div>
  );
}

function Achievements({ list }) {
  const got = new Map((list || []).map(a => [a.key, a]));
  const count = ACHIEVEMENTS.filter(a => got.has(a.key)).length;
  return (
    <section className="pf-box" aria-labelledby="pfAchT">
      <header className="pf-box-head">
        <h3 id="pfAchT">Achievements</h3>
        <span className="pf-note num">{count} of {ACHIEVEMENTS.length} unlocked</span>
      </header>
      <div className="pf-progress" role="progressbar" aria-valuemin="0" aria-valuemax={ACHIEVEMENTS.length} aria-valuenow={count}>
        <i style={{ width: `${(count / ACHIEVEMENTS.length) * 100}%` }} />
      </div>
      <ul className="pf-ach-grid">
        {ACHIEVEMENTS.map(a => {
          const u = got.get(a.key);
          return (
            <li key={a.key} className={`pf-ach t${a.tier || 1}${u ? ' on' : ''}`} title={u ? `${a.title}: ${a.desc}` : `Locked. ${a.desc}`}>
              <span className="pf-ach-icon" aria-hidden="true">{a.icon}</span>
              <span className="pf-ach-t">{a.title}</span>
              <span className="pf-ach-d">{a.desc}</span>
              <span className="pf-ach-when">{u ? `Unlocked ${shortDate(u.unlocked_at)}` : 'Locked'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SngRecord({ stats, list }) {
  if (!stats.sngPlayed && !(list || []).length) {
    return (
      <section className="pf-box pf-sng" aria-labelledby="pfSngT">
        <header className="pf-box-head"><h3 id="pfSngT">Sit &amp; Go</h3></header>
        <div className="pf-empty-row">
          <span className="pf-empty-art sm" aria-hidden="true">🏆</span>
          <p>No tournaments yet. Six players, rising blinds, the top two get paid. Your first trophy is waiting.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="pf-box pf-sng" aria-labelledby="pfSngT">
      <header className="pf-box-head"><h3 id="pfSngT">Sit &amp; Go</h3><span className="pf-note">Top two paid</span></header>
      <div className="pf-mini-tiles">
        <div><b className="num">{stats.sngPlayed}</b><span>Played</span></div>
        <div><b className="num">{stats.sngWon}</b><span>Won</span></div>
        <div><b className="num">{stats.sngCashes}</b><span>In the money</span></div>
        <div><b className={`num ${tone(stats.sngNet)}`}>{signedUsd(stats.sngNet) || '$0'}</b><span>Net</span></div>
      </div>
      <ol className="pf-sng-list">
        {(list || []).map(t => (
          <li key={t.id}>
            <span className={`pf-place p${t.place}`} aria-label={`${ordinal(t.place)} place`}>{MEDAL[t.place] || ordinal(t.place)}</span>
            <span className="pf-sng-n">{t.name}<small>{usd(t.buy_in)} buy-in · {timeAgo(t.ended_at)}</small></span>
            <b className={`num ${tone(t.prize - t.buy_in)}`}>{signedUsd(t.prize - t.buy_in) || '$0'}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RecentHands({ list, onReplay }) {
  return (
    <section className="pf-box" aria-labelledby="pfRecentT">
      <header className="pf-box-head"><h3 id="pfRecentT">Recent hands</h3>{list.length > 0 && <span className="pf-note">Tap a hand to replay it</span>}</header>
      {!list.length ? (
        <div className="pf-empty-row"><span className="pf-empty-art sm" aria-hidden="true">🂠</span><p>Hands you play are saved here, ready to replay street by street.</p></div>
      ) : (
        <ul className="pf-hands">
          {list.map(h => {
            const title = h.hand || (h.won ? (h.showdown ? 'Won at showdown' : 'Took it down') : h.showdown ? 'Lost at showdown' : h.net < 0 ? 'Folded' : 'Folded, no cost');
            return (
              <li key={h.id}>
                <button type="button" className="pf-hand" onClick={() => onReplay && onReplay(h.id)} aria-label={`Replay hand at ${h.table}, ${title}, ${signedIn(h.net, h.mode) || 'even'}`}>
                  <CardRow cards={h.hole} empty={2} />
                  <span className="pf-hand-mid">
                    <span className="pf-hand-t">{title}{h.mode === 'sng' && <em className="pf-chip">SNG</em>}</span>
                    <span className="pf-hand-s">{h.table} · {timeAgo(h.at)}</span>
                  </span>
                  <CardRow cards={h.board} size="micro" />
                  <b className={`num pf-hand-net ${tone(h.net)}`}>{signedIn(h.net, h.mode) || (h.mode === 'sng' ? '0' : '$0')}</b>
                  <span className="pf-replay" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" /></svg>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Profile({ data, mine = false, onReplay, name: nameProp }) {
  if (!data) {
    return <div className="pf pf-loading" aria-busy="true"><div className="pf-skel" /><div className="pf-skel" /><div className="pf-skel tall" /></div>;
  }
  const st = data.stats || {};
  const w = data.wallet;
  const name = nameProp || (w && w.name) || 'Player';
  const hands = st.hands || 0;
  const worth = w ? w.bankroll + (w.inPlay || 0) : null;
  return (
    <div className="pf">
      <header className="pf-hero">
        <Avatar name={name} size={64} />
        <div className="pf-hero-t">
          <h2>{name}</h2>
          <p>{mine ? 'Your record at Lamplight' : 'Player record'} · member since {monthYear(st.since)}</p>
        </div>
        {w && (
          <div className="pf-bank">
            <span>Bankroll</span>
            <b className="num">{usd(worth)}</b>
            {w.inPlay > 0 && <small>{usd(w.inPlay)} on tables</small>}
          </div>
        )}
      </header>

      <div className="pf-tiles">
        <Tile big label="Cash winnings" value={signedUsd(st.net) || '$0'} cls={tone(st.net)} sub={hands ? 'All stakes, lifetime' : 'No hands yet'} />
        <Tile label="Hands" value={hands.toLocaleString('en-US')} />
        <Tile label="Pots won" value={(st.potsWon || 0).toLocaleString('en-US')} sub={hands ? `${pctOf(st.potsWon, hands)}% of hands` : ''} />
        <Tile label="VPIP / PFR" value={`${pctOf(st.vpip, hands)} / ${pctOf(st.pfr, hands)}`} sub="% of hands played / raised" />
        <Tile label="Showdowns won" value={`${pctOf(st.showdownsWon, st.showdowns)}%`} sub={`${st.showdownsWon || 0} of ${st.showdowns || 0}`} />
        <Tile label="Biggest pot" value={usd(st.biggestPot)} />
        <Tile label="Best hand" value={st.bestHand || '—'} cls="txt" />
      </div>

      <section className="pf-box" aria-labelledby="pfGraphT">
        <header className="pf-box-head">
          <h3 id="pfGraphT">Winnings graph</h3>
          <span className="pf-note">Cash tables, every hand</span>
        </header>
        <WinningsChart graph={data.graph} mine={mine} />
      </section>

      <div className="pf-cols">
        <SngRecord stats={st} list={data.sng} />
        {data.reads ? <BotReads reads={data.reads} /> : !mine ? null : (
          <section className="pf-box pf-reads" aria-labelledby="pfReadsT2">
            <header className="pf-box-head"><h3 id="pfReadsT2">How the bots read you</h3></header>
            <div className="pf-empty-row"><span className="pf-empty-art sm" aria-hidden="true">🕵️</span><p>The bots take notes on everyone. Play a few hands and see what they've written about you.</p></div>
          </section>
        )}
      </div>

      <Achievements list={data.achievements} />
      {mine && <RecentHands list={data.recent || []} onReplay={onReplay} />}
    </div>
  );
}

/* ───────────── leaderboard ───────────── */
const BOARDS = [
  ['worth', 'Richest'], ['winners', 'Top winners'], ['pots', 'Biggest pots'], ['sng', 'Sit & Go'], ['bots', 'The House'],
];
const BOARD_NOTE = {
  worth: 'Bankroll plus chips on tables.',
  winners: 'Lifetime cash-game profit.',
  pots: 'The single biggest cash pot each player has dragged.',
  sng: 'Sit & Go wins. Ties go to whoever needed fewer tournaments.',
  bots: 'The regulars you are up against, and how they are doing against everyone. Beat them.',
};

function Rank({ i }) {
  return <span className={`lb-rank r${i + 1}`}>{MEDAL[i + 1] ? <span aria-label={`${ordinal(i + 1)} place`}>{MEDAL[i + 1]}</span> : i + 1}</span>;
}

export function Leaderboard({ data, myId, onProfile }) {
  const [board, setBoard] = useState('worth');
  if (!data) return <div className="lb lb-loading" aria-busy="true"><div className="pf-skel" /><div className="pf-skel tall" /></div>;
  const rows = data[board] || [];
  const t = data.totals || {};
  const person = (r, i, value, sub, cls = '') => {
    const me = myId && r.id === myId;
    return (
      <li key={r.id || i} className={me ? 'me' : ''}>
        <button type="button" className="lb-row" onClick={() => onProfile && onProfile(r.id)} disabled={!onProfile || !r.id}>
          <Rank i={i} />
          <Avatar name={r.name} size={34} />
          <span className="lb-who"><b>{r.name}{me && <em className="pf-chip you">You</em>}</b><small>{sub}</small></span>
          <b className={`num lb-val ${cls}`}>{value}</b>
        </button>
      </li>
    );
  };
  let body;
  if (board === 'bots') {
    body = rows.length ? rows.map((r, i) => {
      const P = PROFILES[r.key];
      return (
        <li key={r.key} className="bot">
          <div className="lb-row">
            <Rank i={i} />
            <Avatar name={P ? P.name : r.key} profileKey={P ? r.key : null} size={34} />
            <span className="lb-who">
              <b>{P ? P.name : r.key}{P && <em className="pf-chip">{P.tag}</em>}</b>
              <small>{r.hands.toLocaleString('en-US')} hands · {r.pots_won.toLocaleString('en-US')} pots · busted {r.busted}×{r.sng_won ? ` · ${r.sng_won} SNG ${r.sng_won === 1 ? 'win' : 'wins'}` : ''}</small>
            </span>
            <b className={`num lb-val ${tone(r.net)}`}>{signedUsd(r.net) || '$0'}</b>
          </div>
        </li>
      );
    }) : null;
  } else {
    body = rows.length ? rows.map((r, i) => {
      if (board === 'worth') return person(r, i, usd(r.worth), `${(r.hands || 0).toLocaleString('en-US')} hands`);
      if (board === 'winners') return person(r, i, signedUsd(r.net) || '$0', `${(r.hands || 0).toLocaleString('en-US')} hands`, tone(r.net));
      if (board === 'pots') return person(r, i, usd(r.biggest_pot), `${(r.hands || 0).toLocaleString('en-US')} hands`);
      return person(r, i, `${r.sng_won} ${r.sng_won === 1 ? 'win' : 'wins'}`, `${r.sng_played} played`);
    }) : null;
  }
  return (
    <div className="lb">
      <div className="lb-seg" role="tablist" aria-label="Leaderboards">
        {BOARDS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={board === k} onClick={() => setBoard(k)}>{l}</button>
        ))}
      </div>
      <p className="lb-note">{BOARD_NOTE[board]}</p>
      {body ? <ol className={`lb-list${board === 'bots' ? ' house' : ''}`}>{body}</ol> : (
        <div className="pf-empty-row lb-empty"><span className="pf-empty-art sm" aria-hidden="true">{board === 'bots' ? '🎰' : '🪑'}</span>
          <p>{board === 'bots' ? 'The house has not played a hand yet.' : board === 'sng' ? 'No Sit & Go has finished yet. Be the first name here.' : 'Nobody here yet. Sit down and claim the top spot.'}</p></div>
      )}
      <p className="lb-totals num">
        {(t.hands || 0).toLocaleString('en-US')} hands dealt · {(t.players || 0).toLocaleString('en-US')} players · {(t.tournaments || 0).toLocaleString('en-US')} tournaments
      </p>
    </div>
  );
}

