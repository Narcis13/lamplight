/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · table view
   Draws the table. It never decides anything: the App feeds it the
   server's events and a mirror of the server's state.

   Seats are drawn rotated so that *your* seat is always at the bottom.
   `pos(seat)` maps a real seat number to a place on the layout.
   ════════════════════════════════════════════════════════════════════ */
import { clamp, sleep, Cards, Fmt, RANK_ONE, fillMoney, PROFILES } from '../shared/engine.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const at = (e, [x, y]) => { e.style.left = x + 'px'; e.style.top = y + 'px'; };
export const STREET_NAME = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown', done: 'Hand over', idle: '' };
const SUIT_NAME = ['spades', 'hearts', 'diamonds', 'clubs'];
export const hueOf = name => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

/* ───────────── phones ─────────────
   On a phone the table (or the board) takes the whole screen and the
   controls float over it as glass. `<html data-compact>` says which way:
   "port" (bars at the top and bottom) or "land" (a column on the right).
   CSS and the code below both key off it, so they always agree.        */
const COMPACT = [['land', '(max-height: 500px) and (orientation: landscape)'], ['port', '(max-width: 760px) and (orientation: portrait)']]
  .map(([k, q]) => [k, matchMedia(q)]);
export const compactMode = () => document.documentElement.dataset.compact || '';
function syncCompact() {
  const m = COMPACT.find(([, q]) => q.matches);
  if (m) document.documentElement.dataset.compact = m[0]; else delete document.documentElement.dataset.compact;
}
syncCompact();
COMPACT.forEach(([, q]) => q.addEventListener('change', syncCompact));

/* ───────────── card faces ───────────── */
const SUIT_PATHS = [
  '<path d="M50 5 C58 22 94 38 94 62 C94 76 83 84 72 84 C63 84 57 80 54 74 C55 84 60 91 68 96 L32 96 C40 91 45 84 46 74 C43 80 37 84 28 84 C17 84 6 76 6 62 C6 38 42 22 50 5 Z"/>',
  '<path d="M50 92 C22 70 5 53 5 33 C5 17 17 7 30 7 C40 7 47 13 50 21 C53 13 60 7 70 7 C83 7 95 17 95 33 C95 53 78 70 50 92 Z"/>',
  '<path d="M50 3 C60 20 72 36 88 50 C72 64 60 80 50 97 C40 80 28 64 12 50 C28 36 40 20 50 3 Z"/>',
  '<circle cx="50" cy="29" r="20"/><circle cx="27" cy="58" r="20"/><circle cx="73" cy="58" r="20"/><circle cx="50" cy="52" r="12"/><path d="M46 60 C45 77 40 88 31 96 L69 96 C60 88 55 77 54 60 Z"/>',
];
const suitSVG = (s, cls) => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">${SUIT_PATHS[s]}</svg>`;
const cardName = c => `${RANK_ONE[Cards.rank(c)]} of ${SUIT_NAME[Cards.suit(c)]}`;

function cardEl(c = null, { size = '', down = true } = {}) {
  const e = el('div', `card${size ? ' ' + size : ''}${down ? ' down' : ''}`,
    '<div class="inner"><div class="face front"></div><div class="face back"></div></div>');
  e.setAttribute('role', 'img');
  e.setAttribute('aria-label', 'Face-down card');
  if (c != null) setFace(e, c);
  return e;
}
/** A card as markup, for React screens and anything else drawn from strings. */
export function cardHTML(c, { size = '', down = false } = {}) {
  const face = c == null ? '' : `<span class="rk">${Cards.rankLabel(c)}</span>${suitSVG(Cards.suit(c), 'st')}${suitSVG(Cards.suit(c), 'pip')}`;
  const label = c == null ? 'Face-down card' : cardName(c);
  return `<div class="card${size ? ' ' + size : ''}${down || c == null ? ' down' : ''}" role="img" aria-label="${label}"${c == null ? '' : ` data-s="${'shdc'[Cards.suit(c)]}" data-c="${c}"`}><div class="inner"><div class="face front">${face}</div><div class="face back"></div></div></div>`;
}
function setFace(e, c) {
  const s = Cards.suit(c);
  e.dataset.s = 'shdc'[s];
  e.dataset.c = c;
  e.querySelector('.front').innerHTML = `<span class="rk">${Cards.rankLabel(c)}</span>${suitSVG(s, 'st')}${suitSVG(s, 'pip')}`;
  e.setAttribute('aria-label', cardName(c));
}

/* ───────────── chips ───────────── */
const DENOMS = [
  { v: 500, c: '#5b2a86' }, { v: 100, c: '#1f2027' }, { v: 25, c: '#1f7a4d' },
  { v: 5, c: '#b3262e' }, { v: 1, c: '#ece5d6', e: '#2b3040' },
];
function chipsHTML(amount, maxCols = 3) {
  let rest = Math.round(amount);
  const cols = [];
  for (const d of DENOMS) {
    const n = Math.floor(rest / d.v);
    if (n > 0) { cols.push({ d, n }); rest -= n * d.v; }
  }
  return '<div class="chips">' + cols.slice(0, maxCols).map(({ d, n }) => {
    const k = Math.min(n, 8);
    let s = `<div class="col" style="height:${24 + (k - 1) * 4}px">`;
    for (let i = 0; i < k; i++) s += `<i class="chip" style="--c:${d.c};${d.e ? `--e:${d.e};` : ''}bottom:${i * 4}px"></i>`;
    return s + '</div>';
  }).join('') + '</div>';
}

/* ───────────── sound ─────────────
   Everything is synthesised with WebAudio: no files, nothing to load. */
export class SFX {
  constructor(settings) {
    this.settings = settings; this.ctx = null;
    const unlock = () => this.init();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }
  init() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.6), buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { this.ctx = null; }
  }
  get ok() { return !!(this.settings.sound && this.ctx && this.ctx.state === 'running'); }
  env(g, now, peak, dur) {
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  }
  noise({ t = 0, dur = 0.06, freq = 3000, q = 0.8, type = 'bandpass', gain = 0.2 }) {
    const c = this.ctx, now = c.currentTime + t;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    this.env(g, now, gain, dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(now, Math.random() * 0.4); src.stop(now + dur + 0.03);
  }
  tone({ t = 0, freq = 440, to = 0, dur = 0.15, type = 'sine', gain = 0.15 }) {
    const c = this.ctx, now = c.currentTime + t;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, now);
    if (to) o.frequency.exponentialRampToValueAtTime(to, now + dur);
    this.env(g, now, gain, dur);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + dur + 0.03);
  }
  clack(t = 0, gain = 0.2) {
    this.tone({ t, freq: 2500 + Math.random() * 900, dur: 0.045, type: 'triangle', gain });
    this.noise({ t, dur: 0.03, freq: 5200, q: 2, gain: gain * 0.7 });
  }
  card() { if (this.ok) this.noise({ dur: 0.08, freq: 3800, q: 0.5, type: 'highpass', gain: 0.16 }); }
  flip() { if (this.ok) this.noise({ dur: 0.05, freq: 2200, q: 1.3, gain: 0.2 }); }
  chip() { if (this.ok) this.clack(0, 0.18); }
  chips() { if (!this.ok) return; for (let i = 0; i < 5; i++) this.clack(i * 0.035 + Math.random() * 0.02, 0.12); }
  turn() { if (!this.ok) return; this.tone({ freq: 660, dur: 0.18, type: 'triangle', gain: 0.1 }); this.tone({ t: 0.12, freq: 990, dur: 0.25, type: 'triangle', gain: 0.09 }); }
  win() { if (!this.ok) return; [523, 659, 784, 1047].forEach((f, i) => this.tone({ t: i * 0.09, freq: f, dur: 0.4, type: 'triangle', gain: 0.11 })); }
  tick() { if (!this.ok) return; [0, 0.14].forEach(t => this.tone({ t, freq: 1560, dur: 0.05, type: 'square', gain: 0.035 })); }
  blip() { if (this.ok) this.tone({ freq: 880, to: 1175, dur: 0.09, type: 'sine', gain: 0.05 }); }
  pop() { if (this.ok) this.tone({ freq: 520, to: 780, dur: 0.08, type: 'triangle', gain: 0.08 }); }
  bell() { if (!this.ok) return; [0, 0.18].forEach(t => { this.tone({ t, freq: 1318, dur: 0.9, type: 'sine', gain: 0.07 }); this.tone({ t, freq: 2637, dur: 0.5, type: 'sine', gain: 0.025 }); }); }
  fanfare() {
    if (!this.ok) return;
    [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32], [784, 0.46], [1047, 0.56]].forEach(([f, t]) => this.tone({ t, freq: f, dur: 0.5, type: 'triangle', gain: 0.1 }));
    for (let i = 0; i < 10; i++) this.clack(0.6 + i * 0.03 + Math.random() * 0.02, 0.08);
  }
  forAction(r) {
    if (!this.ok) return;
    if (r.type === 'fold') this.noise({ dur: 0.14, freq: 1300, q: 0.7, gain: 0.1 });
    else if (r.type === 'check') { this.tone({ freq: 170, to: 120, dur: 0.07, gain: 0.3 }); this.tone({ t: 0.11, freq: 170, to: 120, dur: 0.07, gain: 0.26 }); }
    else { this.chips(); if (r.allIn) this.tone({ freq: 120, to: 50, dur: 0.6, gain: 0.25 }); }
  }
}

/* ───────────── layouts ─────────────
   Stage coordinates. A seat anchor is the centre of its avatar. Seat 0
   is always you, at the bottom; seats 1..5 run clockwise.            */
const LAYOUTS = {
  land: {
    W: 1100, H: 700, table: [550, 330, 880, 460], board: [550, 335], pot: [550, 262], msg: [550, 422],
    seats: [[550, 598], [140, 470], [185, 152], [550, 106], [915, 152], [960, 470]],
    bets: [[550, 428], [300, 440], [330, 232], [550, 205], [770, 232], [800, 440]],
    btn: [[665, 478], [230, 395], [262, 250], [468, 192], [838, 250], [870, 395]],
  },
  port: {
    W: 700, H: 1120, table: [350, 540, 580, 860], board: [350, 545], pot: [350, 455], msg: [350, 640],
    seatScale: 1.35, heroScale: 1.3, uiScale: 1.4,
    seats: [[350, 1010], [82, 800], [82, 300], [350, 100], [618, 300], [618, 800]],
    bets: [[350, 798], [215, 735], [232, 400], [350, 252], [468, 400], [485, 735]],
    btn: [[478, 930], [165, 700], [165, 420], [268, 92], [535, 420], [535, 700]],
  },
};

/* ───────────── the table ───────────── */
export class TableView {
  constructor(sfx) {
    this.sfx = sfx;
    this.wrap = $('#stageWrap'); this.stage = $('#stage'); this.tableEl = $('#table');
    this.boardEl = $('#board'); this.potEl = $('#pot'); this.btnEl = $('#dealerBtn'); this.msgEl = $('#centerMsg');
    this.slots = []; this.slots2 = [];
    this.board2El = $('#board2');
    for (let k = 0; k < 5; k++) { const s = el('div', 'slot'); this.boardEl.append(s); this.slots.push(s); }
    for (let k = 0; k < 5; k++) { const s = el('div', 'slot'); this.board2El.append(s); this.slots2.push(s); }
    this.seats = []; this.bets = []; this.layoutName = null; this.sig = '';
    this.me = null; this.canSit = false;
    this.onUpdate = () => {}; this.onSit = () => {}; this.onProfile = () => {};
    new ResizeObserver(() => this.fit()).observe(this.wrap);
    document.addEventListener('click', e => {
      const open = e.target.closest('.seat.open-seat.can-sit');
      if (open) { this.onSit(+open.dataset.seat); return; }
      const person = e.target.closest('.seat.human:not(.hero) .avatar');
      if (person && this.g) { const p = this.g.players[+person.closest('.seat').dataset.seat]; if (p && p.id) { this.onProfile(p.id, p.name); return; } }
      const s = e.target.closest('.seat:not(.hero):not(.open-seat)');
      this.seats.forEach(x => { if (x !== s) x.classList.remove('peek'); });
      if (s) s.classList.toggle('peek');
    });
  }
  get L() { return LAYOUTS[this.layoutName || 'land']; }
  /** Place on the layout for a real seat: 0 is the bottom, then clockwise. */
  pos(seat) { return (seat - (this.me ?? 0) + 6) % 6; }

  /** (Re)builds the seats when who sits where, or who you are, changes. */
  ensureSeats(g, force = false) {
    const keys = g.players.map(p => `${p.kind}:${p.name}:${p.profileKey || ''}`);
    const sig = `${this.me}|` + keys.join('|');
    if (!force && sig === this.sig) return false;
    // keep the cards of anyone still in the same seat: a rebuild must never erase a live hand
    const keep = this.seats.map((s, i) => (this.keys && this.keys[i] === keys[i] ? s.querySelector('.hole') : null));
    this.sig = sig; this.keys = keys;
    this.build(g);
    keep.forEach((h, i) => { if (h && this.seats[i]) this.seats[i].querySelector('.hole').replaceWith(h); });
    this.layoutName = null;
    this.fit();
    return true;
  }

  build(g) {
    this.seats.forEach(s => s.remove()); this.bets.forEach(b => b.remove());
    this.seats = []; this.bets = [];
    for (const p of g.players) {
      const hero = p.seat === this.me, P = p.profile;
      const s = el('div', 'seat' + (hero ? ' hero' : '') + (p.kind === 'empty' ? ' open-seat' : '') + (p.kind === 'human' ? ' human' : ''));
      s.dataset.seat = p.seat;
      s.style.setProperty('--hue', P ? P.hue : p.kind === 'human' ? hueOf(p.name) : 38);
      const loose = P ? clamp((9 - P.play) / 5.5, 0.05, 1) : 0;
      const face = P ? `<span class="face" aria-hidden="true">${P.emoji}</span>`
        : p.kind === 'empty' ? '<span class="plus" aria-hidden="true">+</span>'
        : `<span class="initial">${esc((p.name.trim()[0] || 'P').toUpperCase())}</span>`;
      const tag = P ? `<div class="tag">${P.tag}</div>` : p.kind === 'human' && !hero ? '<div class="tag person">Player</div>' : '';
      s.innerHTML = `
        <div class="hole"></div>
        <div class="avatar">${face}<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" pathLength="100"/></svg></div>
        ${tag}
        <div class="plate"><span class="nm"></span><span class="stk num"></span></div>
        <div class="hud"></div><div class="badge"></div><div class="eq num"></div><div class="gain num"></div><div class="joining"></div><div class="bubble" aria-live="polite"></div><div class="emote-fx" aria-hidden="true"></div>
        ${P ? `<div class="info" role="tooltip">
          <h4>${P.name}</h4>
          <p>${P.style}. ${P.blurb}</p>
          <div class="meter">
            <span>Risk</span><div class="bar"><i style="width:${Math.round(P.risk * 100)}%"></i></div>
            <span>Aggression</span><div class="bar"><i style="width:${Math.round(P.agg * 100)}%"></i></div>
            <span>Looseness</span><div class="bar"><i style="width:${Math.round(loose * 100)}%"></i></div>
          </div>
          <div class="info-stats"></div>
        </div>` : ''}`;
      if (!hero) {
        s.tabIndex = 0;
        s.setAttribute('aria-label', P ? `${P.name}, ${P.style}` : p.kind === 'empty' ? `Open seat ${p.seat + 1}` : `${p.name}, a player`);
      }
      this.stage.append(s);
      this.seats.push(s);
      const b = el('div', 'bet empty');
      this.stage.append(b);
      this.bets.push(b);
    }
  }

  fit() {
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    // on a phone the top bar and the dock float over the stage: fit the table into what they leave
    // (top and bottom when upright, a column on the right when sideways), but never shrink it far below full screen for them.
    // The dock's reserved height, not its current one, so the table stays put when the dock grows for a moment.
    const mode = compactMode(), dock = $('#dock');
    const top = mode === 'port' ? $('.topbar').offsetHeight : 0;
    const bottom = mode === 'port' ? parseFloat(getComputedStyle(dock).minHeight) || dock.offsetHeight : 0;
    const right = mode === 'land' ? dock.offsetWidth : 0;
    const rw = w - right, rh = h - top - bottom;
    const name = rw > 0 && rh > 0 ? (rw / rh < 0.9 ? 'port' : 'land') : (this.layoutName || 'land');
    if (name !== this.layoutName) { this.layoutName = name; this.applyLayout(); }
    const L = this.L;
    let s = w && h ? Math.min(w / L.W, h / L.H) : 1;
    if (mode && rw > 0 && rh > 0) s = Math.max(Math.min(rw / L.W, rh / L.H), s * (mode === 'port' ? 0.86 : 0.8));
    // centre it in the free area, but keep it on screen; when it doesn't fit, it runs under the
    // top bar first (only the far seat is up there) and under the dock (your seat) last
    const sw = L.W * s, sh = L.H * s;
    const cx = sw <= w ? clamp(rw / 2, sw / 2, w - sw / 2) : w / 2;
    let cy = top + rh / 2;
    if (sh > rh) cy = top - Math.min(sh - rh, top) + sh / 2;
    cy = sh <= h ? clamp(cy, sh / 2, h - sh / 2) : h / 2;
    this.stage.style.transform = `translate(-50%, -50%) translate(${Math.round(cx - w / 2)}px, ${Math.round(cy - h / 2)}px) scale(${s})`;
    this.wrap.style.setProperty('--ov-bottom', bottom + 'px');
    const boost = name === 'land' ? Math.round(clamp(0.82 / s, 1, 1.12) * 100) / 100 : 1;
    if (boost !== this.boost) { this.boost = boost; this.applyScales(); }
  }

  applyScales() {
    const L = this.L, u = (L.uiScale || 1) * (this.boost || 1);
    for (const e of [this.potEl, this.msgEl, ...this.bets]) { e.style.scale = u; e.style.transformOrigin = '0 0'; }
    this.btnEl.style.scale = u;
    this.seats.forEach((s, i) => {
      s.style.scale = this.seatScale(i);
      s.style.transformOrigin = i === this.me ? '110px 140px' : '85px 92px';
    });
  }

  applyLayout() {
    const L = this.L;
    this.stage.dataset.layout = this.layoutName;
    this.stage.style.width = L.W + 'px'; this.stage.style.height = L.H + 'px';
    const [cx, cy, w, h] = L.table;
    Object.assign(this.tableEl.style, { left: cx - w / 2 + 'px', top: cy - h / 2 + 'px', width: w + 'px', height: h + 'px' });
    at(this.boardEl, L.board); at(this.board2El, L.board); at(this.potEl, L.pot); at(this.msgEl, L.msg);
    this.seats.forEach((s, i) => {
      const [x, y] = L.seats[this.pos(i)], hero = i === this.me;
      at(s, hero ? [x - 110, y - 140] : [x - 85, y - 92]);
      s.classList.toggle('info-up', !hero && y > L.H * 0.55);
      s.classList.toggle('info-l', x < 170);
      s.classList.toggle('info-r', x > L.W - 170);
    });
    this.bets.forEach((b, i) => at(b, L.bets[this.pos(i)]));
    if (this.g) at(this.btnEl, L.btn[this.pos(this.g.button)]);
    this.applyScales();
  }

  seatScale(i) { const L = this.L; return ((i === this.me ? L.heroScale : L.seatScale) || 1) * (this.boost || 1); }
  toLocal(seat, [px, py]) {
    const [x, y] = this.L.seats[this.pos(seat)], k = this.seatScale(seat);
    return [(px - x) / k, (py - y) / k + (seat === this.me ? 76 : 42)];
  }
  holeOf(seat) { return this.seats[seat].querySelector('.hole'); }

  /* ── events → screen ── */
  toast(msg) {
    const t = el('div', 'toast');
    t.textContent = msg;
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 3300);
  }

  updateTable(g) {
    this.g = g;
    this.ensureSeats(g);
    const live = g.street !== 'done' && g.street !== 'idle';
    for (const p of g.players) {
      const s = this.seats[p.seat];
      if (!s) continue;
      const reserved = g.reserved.find(r => r.seat === p.seat);
      s.querySelector('.joining').textContent = reserved ? `${reserved.name} sits in next hand` : '';
      s.classList.toggle('can-sit', p.kind === 'empty' && this.canSit);
      if (p.kind === 'empty') {
        s.querySelector('.nm').textContent = 'Open seat';
        s.querySelector('.stk').textContent = this.canSit ? 'Sit here' : '';
        s.classList.remove('folded', 'allin', 'offline'); s.classList.add('out');
        this.bets[p.seat].classList.add('empty');
        continue;
      }
      s.querySelector('.nm').textContent = p.name;
      s.querySelector('.stk').textContent = live && p.active && p.allIn && p.stack === 0 ? 'All in' : p.stack === 0 && !p.inHand ? 'Busted' : Fmt.money(p.stack);
      s.classList.toggle('folded', p.inHand && p.folded);
      s.classList.toggle('out', !p.inHand);
      s.classList.toggle('allin', live && p.active && p.allIn);
      s.classList.toggle('offline', p.kind === 'human' && !p.connected);

      const b = this.bets[p.seat], key = p.bet + Fmt.units;
      if (p.bet > 0) {
        if (b._key !== key) { b.innerHTML = chipsHTML(p.bet) + `<span class="amt">${Fmt.money(p.bet)}</span>`; b._key = key; }
        b.classList.remove('empty');
      } else { b.classList.add('empty'); b._key = ''; }

      if (p.kind === 'human' && p.seat !== this.me) {
        const tag = s.querySelector('.tag');
        const st = !p.connected ? 'Offline' : p.leaving ? 'Leaving' : p.away ? 'Away' : 'Player';
        tag.textContent = st;
        tag.className = 'tag ' + (st === 'Player' ? 'person' : 'offline');
      }
      const st = p.stats, hud = s.querySelector('.hud');
      hud.innerHTML = st.hands >= 5 ? `VPIP <b>${pct(st.vpip, st.hands)}</b>&ensp;PFR <b>${pct(st.pfr, st.hands)}</b>` : '';
      if (p.profile) {
        const net = p.net;
        s.querySelector('.info-stats').innerHTML = st.hands
          ? `${st.hands} hands, VPIP ${pct(st.vpip, st.hands)}%, PFR ${pct(st.pfr, st.hands)}%<br>Net <b class="${net >= 0 ? 'pos' : 'neg'}">${Fmt.signed(net) || Fmt.money(0)}</b>${p.buyIns > g.buyIn ? `, ${Math.round(p.buyIns / g.buyIn)} buy-ins` : ''}`
          : 'No hands played yet';
        if (p.profile.tilts) {
          const tag = s.querySelector('.tag'), hot = p.tilt >= 0.3;
          tag.classList.toggle('hot', hot);
          tag.textContent = hot ? 'On tilt' : p.profile.tag;
        }
      }
    }
    const total = g.pot, collected = g.collected;
    const potKey = `${total}|${collected}|${Fmt.units}`;
    if (this.potEl._key !== potKey) {
      this.potEl.innerHTML = (collected > 0 ? chipsHTML(collected) : '') + `<span class="pot-label">Pot <b>${Fmt.money(total)}</b></span>`;
      this.potEl._key = potKey;
    }
    this.potEl.classList.toggle('empty', total === 0);
    at(this.btnEl, this.L.btn[this.pos(g.button)]);
    this.btnEl.hidden = !g.handNo;
    this.onUpdate(g);
  }

  clearCards() {
    $$('.card, .fly', this.stage).forEach(e => e.remove());
    this.stage.classList.remove('rit');
    this.seats.forEach(s => {
      s.classList.remove('winner', 'turn', 'thinking');
      s.querySelector('.badge').className = 'badge';
      s.querySelector('.eq').className = 'eq num';
      s.querySelector('.hole').className = 'hole';
    });
  }

  /** Draws the table from a snapshot, without animation (join, reconnect, resync). */
  restore(g, myHole) {
    this.ensureSeats(g, true);
    this.clearCards();
    this.hideMsg();
    const live = ['preflop', 'flop', 'turn', 'river', 'showdown'].includes(g.street);
    if (live) {
      for (const p of g.players) {
        if (!p.hasCards) continue;
        const mine = p.seat === this.me && myHole.length === 2;
        const faces = mine ? myHole : p.shown;
        const hole = this.holeOf(p.seat);
        for (let r = 0; r < 2; r++) {
          const e = cardEl(faces ? faces[r] : null, { size: p.seat === this.me ? 'lg' : 'sm', down: !faces });
          e.style.setProperty('--r', `${(r ? 1 : -1) * (p.seat === this.me ? 4 : 6)}deg`);
          hole.append(e);
        }
        if (p.shown && !mine) hole.classList.add('revealed');
        if (p.folded) { if (p.seat === this.me) hole.classList.add('folded'); else hole.innerHTML = ''; }
      }
      g.board.forEach((c, k) => this.slots[k].append(cardEl(c, { down: false })));
      if (g.rit && g.board2) { this.stage.classList.add('rit'); g.board2.forEach((c, k) => this.slots2[k].append(cardEl(c, { down: false }))); }
      if (g.activeSeat != null) this.setActive(g.activeSeat);
    }
    this.updateTable(g);
    if (g.waiting) this.message(g.waiting, g.waitingSub ?? 'The next hand starts as soon as someone sits in', true);
  }

  async newHand(g) {
    this.hideMsg();
    this.seats.forEach(s => {
      s.classList.remove('winner', 'turn', 'thinking');
      s.querySelector('.badge').className = 'badge';
      s.querySelector('.eq').className = 'eq num';
    });
    const old = $$('.card', this.stage);
    if (old.length) {
      old.forEach(c => { c.style.transition = 'opacity .22s'; c.style.opacity = '0'; });
      await sleep(240);
      old.forEach(c => c.remove());
    }
    this.stage.classList.remove('rit');
    this.seats.forEach(s => { s.querySelector('.hole').className = 'hole'; });
    this.updateTable(g);
  }

  animateIn(e) {
    e.classList.add('dealing');
    const done = () => e.classList.remove('dealing');
    e.addEventListener('animationend', done, { once: true });
    setTimeout(done, 700);
  }

  dealHole(seat, round, c) {
    const hero = seat === this.me;
    const e = cardEl(hero && c != null ? c : null, { size: hero ? 'lg' : 'sm', down: true });
    const [dx, dy] = this.toLocal(seat, this.L.board);
    e.style.setProperty('--dx', `${dx}px`);
    e.style.setProperty('--dy', `${dy}px`);
    e.style.setProperty('--r', `${(round ? 1 : -1) * (hero ? 4 : 6)}deg`);
    this.animateIn(e);
    this.holeOf(seat).append(e);
  }

  async revealMine() {
    if (this.me == null) return;
    for (const c of $$('.card', this.holeOf(this.me))) {
      if (!c.dataset.c) continue;
      c.classList.remove('down');
      this.sfx.flip();
      await sleep(120);
    }
  }

  /** Run it twice: a second board appears under the first, starting with the cards they share. */
  runTwice(board) {
    this.stage.classList.add('rit');
    this.slots2.forEach(sl => (sl.innerHTML = ''));
    board.forEach((c, k) => { const e = cardEl(c, { down: false }); e.classList.add('shared'); this.slots2[k].append(e); });
  }

  async dealBoard(cards, start, T, run = 1) {
    const slots = run === 2 ? this.slots2 : this.slots;
    const els = cards.map((c, i) => {
      const k = start + i, e = cardEl(c, { down: true });
      e.style.setProperty('--dx', `${-(k - 2) * 80}px`);
      e.style.setProperty('--dy', '-110px');
      return [k, e];
    });
    for (const [k, e] of els) {
      slots[k].innerHTML = '';
      this.animateIn(e);
      slots[k].append(e);
      this.sfx.card();
      await sleep(T.deal + 40);
    }
    await sleep(240);
    for (const [, e] of els) {
      e.classList.remove('down');
      this.sfx.flip();
      if (els.length > 1) await sleep(95);
    }
    await sleep(300);
  }

  setActive(seat) { this.seats.forEach((s, i) => s.classList.toggle('turn', i === seat)); }

  setThinking(seat, ms, bank = false) {
    const s = this.seats[seat];
    if (!s) return;
    s.classList.toggle('bank', ms > 0 && bank);
    if (ms > 0) {
      s.style.setProperty('--think', ms + 'ms');
      s.classList.remove('thinking');
      void s.offsetWidth;
      s.classList.add('thinking');
    } else s.classList.remove('thinking');
  }

  showAction(seat, r) {
    const b = this.seats[seat].querySelector('.badge');
    b.className = `badge ${r.allIn ? 'allin' : r.type}`;
    b.textContent = r.allIn ? 'All in' : { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise' }[r.type];
    void b.offsetWidth;
    b.classList.add('show');
    if (r.type === 'fold') this.fold(seat);
  }

  fold(seat) {
    const hole = this.holeOf(seat);
    if (seat === this.me) { hole.classList.add('folded'); return; }
    const [mx, my] = this.toLocal(seat, this.L.board);
    for (const c of $$('.card', hole)) {
      c.classList.remove('dealing');
      c.style.setProperty('--mx', `${mx}px`);
      c.style.setProperty('--my', `${my}px`);
      requestAnimationFrame(() => c.classList.add('muck'));
      setTimeout(() => c.remove(), 520);
    }
  }

  fly(html, from, to, ms, delay = 0) {
    return new Promise(res => {
      setTimeout(() => {
        const f = el('div', 'fly', `<div>${html}</div>`);
        f.style.scale = (this.L.uiScale || 1) * (this.boost || 1); f.style.transformOrigin = '0 0';
        at(f, from);
        this.stage.append(f);
        void f.offsetWidth;
        const ease = 'cubic-bezier(.45, 0, .2, 1)';
        f.style.transition = `left ${ms}ms ${ease}, top ${ms}ms ${ease}, opacity 160ms ${ms - 140}ms`;
        at(f, to);
        f.style.opacity = '0';
        setTimeout(() => { f.remove(); res(); }, ms + 40);
      }, delay);
    });
  }

  async collectBets(bets) {
    const [px, py] = this.L.pot, jobs = [];
    for (const { seat, amount } of bets) {
      jobs.push(this.fly(chipsHTML(amount), this.L.bets[this.pos(seat)], [px - 30, py], 400));
      this.bets[seat].classList.add('empty');
    }
    await Promise.all(jobs);
  }

  endStreet(g) {
    this.seats.forEach((s, i) => {
      const b = s.querySelector('.badge');
      if (!(b.classList.contains('allin') && g.players[i].allIn)) b.classList.remove('show');
    });
  }

  reveal(seat, hole) {
    if (seat === this.me) return;
    const holeEl = this.holeOf(seat);
    let cards = $$('.card', holeEl);
    if (cards.length < 2) { // joined mid-hand: no backs to flip, draw them
      holeEl.innerHTML = '';
      cards = hole.map((c, r) => { const e = cardEl(c, { size: 'sm', down: true }); e.style.setProperty('--r', `${(r ? 1 : -1) * 6}deg`); holeEl.append(e); return e; });
    }
    cards.forEach((c, i) => { if (hole[i] != null) setFace(c, hole[i]); c.classList.remove('dealing'); });
    holeEl.classList.add('revealed');
    requestAnimationFrame(() => cards.forEach(c => c.classList.remove('down')));
  }

  showEquity(list) {
    const max = Math.max(...list.map(x => x.eq));
    for (const { seat, eq } of list) {
      const e = this.seats[seat].querySelector('.eq');
      e.textContent = Math.round(eq * 100) + '%';
      e.classList.add('show');
      e.classList.toggle('lead', eq === max && eq > 0);
    }
  }

  highlight(winners, best, g, run = 1) {
    const B = new Set(best);
    $$('.eq', this.stage).forEach(e => e.classList.remove('show'));
    this.seats.forEach(s => s.classList.remove('winner'));
    winners.forEach(s => this.seats[s].classList.add('winner'));
    if (this.stage.classList.contains('rit')) {
      this.stage.dataset.run = run;
      for (const sl of run === 2 ? this.slots : this.slots2) sl.querySelector('.card')?.classList.remove('hl', 'dim');
    }
    for (const sl of run === 2 ? this.slots2 : this.slots) {
      const c = sl.querySelector('.card');
      if (!c) continue;
      const on = B.has(+c.dataset.c);
      c.classList.toggle('hl', on); c.classList.toggle('dim', !on);
    }
    for (const p of g.players) {
      if (!p.active) continue;
      const win = winners.includes(p.seat);
      for (const c of $$('.card', this.holeOf(p.seat))) {
        const on = win && B.has(+c.dataset.c);
        c.classList.toggle('hl', on);
        c.classList.toggle('dim', !win);
      }
    }
  }

  async award(awards) {
    const L = this.L;
    this.potEl.classList.add('empty');
    const jobs = awards.map((a, i) => {
      const s = this.seats[a.seat], [x, y] = L.seats[this.pos(a.seat)];
      s.classList.add('winner');
      setTimeout(() => {
        const gain = s.querySelector('.gain');
        gain.textContent = '+' + Fmt.money(a.amount);
        gain.classList.remove('show'); void gain.offsetWidth; gain.classList.add('show');
      }, 420 + i * 140);
      return this.fly(chipsHTML(a.amount), [L.pot[0] - 30, L.pot[1]], [x, y - 8], 560, i * 140);
    });
    await Promise.all(jobs);
    await sleep(200);
  }

  /** A line of table talk over a seat for a few seconds. */
  bubble(seat, text, bot = false) {
    const s = this.seats[seat];
    if (!s) return;
    const b = s.querySelector('.bubble');
    b.textContent = text;
    b.classList.toggle('bot', !!bot);
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.remove('show'), clamp(2600 + text.length * 45, 3000, 6500));
  }
  /** An emoji floats up out of a seat. */
  emote(seat, k) {
    const s = this.seats[seat];
    if (!s) return;
    const box = s.querySelector('.emote-fx');
    const e = el('span', 'emo');
    e.textContent = k;
    e.style.setProperty('--dx', `${Math.round(Math.random() * 40 - 20)}px`);
    box.append(e);
    setTimeout(() => e.remove(), 2200);
  }
  /** A player is knocked out of a tournament. */
  bust(seat) {
    const s = this.seats[seat];
    if (!s) return;
    s.classList.add('busting');
    setTimeout(() => s.classList.remove('busting'), 1400);
  }
  /** Banner and confetti for a big moment. */
  celebrate(title, sub, size = 'med') {
    const box = $('#celebrate');
    box.querySelector('.c1').textContent = title;
    box.querySelector('.c2').textContent = sub || '';
    box.dataset.size = size;
    box.classList.remove('show'); void box.offsetWidth; box.classList.add('show');
    clearTimeout(this._celT);
    this._celT = setTimeout(() => box.classList.remove('show'), size === 'big' ? 4200 : 3000);
    confetti(size === 'big' ? 220 : 110);
  }
  achievement(a) {
    const t = el('div', `ach-toast tier${a.tier}`, `<span class="ai">${a.icon}</span><span><small>Achievement unlocked</small><b>${esc(a.title)}</b><em>${esc(a.desc)}</em></span>`);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 5200);
    confetti(70);
  }

  message(title, sub, sticky = false) {
    this.msgEl.querySelector('.m1').textContent = title;
    this.msgEl.querySelector('.m2').textContent = sub || '';
    this.msgEl.classList.remove('show'); void this.msgEl.offsetWidth; this.msgEl.classList.add('show');
    clearTimeout(this._msgT);
    if (title === 'All in') this._msgT = setTimeout(() => this.hideMsg(), 1800);
  }
  hideMsg() { clearTimeout(this._msgT); this.msgEl.classList.remove('show'); }
}

/* ───────────── modals ───────────── */
export const Modal = {
  open(id) {
    const m = $('#' + id);
    m.classList.add('open'); m.removeAttribute('inert'); m.setAttribute('aria-hidden', 'false');
    const f = m.querySelector('.btn.primary');
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 60);
  },
  close(id) {
    const m = $('#' + id);
    m.classList.remove('open'); m.setAttribute('inert', ''); m.setAttribute('aria-hidden', 'true');
  },
  isOpen(id) { return id ? $('#' + id).classList.contains('open') : !!$('.modal.open'); },
};

/* ───────────── hand log, stats & chat drawer ───────────── */
export class Drawer {
  constructor(app) {
    this.app = app; this.el = $('#drawer'); this.body = $('#drawerBody'); this.tab = 'log'; this.isOpen = false; this._raf = 0;
    this.chat = []; this.unread = false;
    $$('.tab', this.el).forEach(t => (t.onclick = () => this.show(t.dataset.tab)));
    $('#drawerClose').onclick = () => this.close();
  }
  open(tab) {
    this.isOpen = true; this.el.classList.add('open'); this.el.removeAttribute('inert');
    document.body.classList.add('drawer-open');
    $('#logBtn').setAttribute('aria-pressed', 'true');
    this.show(tab || this.tab);
  }
  close() {
    this.isOpen = false; this.el.classList.remove('open'); this.el.setAttribute('inert', '');
    document.body.classList.remove('drawer-open');
    $('#logBtn').setAttribute('aria-pressed', 'false');
  }
  toggle(tab) { this.isOpen ? this.close() : this.open(tab); }
  show(tab) {
    this.tab = tab;
    if (tab === 'chat') this.unread = false;
    $$('.tab', this.el).forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    this.renderTabs();
    this.render();
    if (tab === 'chat') setTimeout(() => $('#chatInput')?.focus({ preventScroll: true }), 50);
  }
  renderTabs() {
    const t = $('.tab[data-tab="chat"]', this.el);
    t.innerHTML = 'Chat' + (this.unread ? '<span class="dot" aria-label="new messages"></span>' : '');
  }
  addChat(name, text, bot = false) {
    this.chat.push({ name, text, bot });
    if (this.chat.length > 100) this.chat.shift();
    if (!(this.isOpen && this.tab === 'chat')) { this.unread = true; this.renderTabs(); }
    this.dirty();
  }
  dirty() {
    if (!this.isOpen || this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }
  render() {
    if (!this.isOpen) return;
    const g = this.app.G;
    this.body.classList.toggle('chat-mode', this.tab === 'chat');
    if (this.tab === 'chat') {
      const lines = this.body.querySelector('.chat-lines');
      const html = this.chat.length
        ? this.chat.map(c => `<div class="chat-line${c.bot ? ' bot' : ''}"><b>${esc(c.name)}</b>${esc(c.text)}</div>`).join('')
        : '<p class="empty-note">Say hello to the table.</p>';
      if (lines) { lines.innerHTML = html; lines.scrollTop = lines.scrollHeight; return; }
      this.body.innerHTML = `<div class="chat"><div class="chat-lines">${html}</div>
        <form id="chatForm"><input id="chatInput" maxlength="160" autocomplete="off" placeholder="Message the table" aria-label="Chat message"><button class="btn" type="submit">Send</button></form></div>`;
      const ls = this.body.querySelector('.chat-lines'); ls.scrollTop = ls.scrollHeight;
      $('#chatForm').onsubmit = e => {
        e.preventDefault();
        const i = $('#chatInput'), text = i.value.trim();
        if (text) this.app.net.send({ t: 'chat', text });
        i.value = '';
      };
      return;
    }
    if (this.tab === 'log') {
      const hands = this.app.log;
      const ids = this.app.handIds;
      this.body.innerHTML = hands.length
        ? hands.map(hd => {
          const id = ids.get(hd.no);
          const replay = id ? `<button class="replay-link" data-hand="${id}" title="Step through this hand">Replay</button>` : '';
          return `<div class="log-hand"><h5><span>Hand ${hd.no}</span>${replay}</h5>${hd.lines.map(l => `<div class="log-line ${l.cls}">${fillMoney(l.html)}</div>`).join('')}</div>`;
        }).join('')
        : '<p class="empty-note">Hands show up here as they are played, newest first.</p>';
      this.body.onclick = e => { const b = e.target.closest('[data-hand]'); if (b) this.app.openReplay(+b.dataset.hand); };
      return;
    }
    if (!g) { this.body.innerHTML = ''; return; }
    const rows = g.players.filter(p => p.kind !== 'empty').map(p => {
      const st = p.stats, net = p.net;
      const who = p.profile ? p.profile.style : p.seat === g.me ? 'You' : 'Player';
      return `<tr><td>${esc(p.name)}<small>${who}</small></td>
        <td>${st.hands}</td><td>${pct(st.vpip, st.hands)}%</td><td>${pct(st.pfr, st.hands)}%</td>
        <td class="${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${Fmt.signed(net) || Fmt.money(0)}</td></tr>`;
    }).join('');
    const t = g.tourney;
    let head = '';
    if (t) {
      const medal = p => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : `${p}th`);
      const places = t.results.slice().sort((a, b) => a.place - b.place)
        .map(r => `<li><span>${medal(r.place)}</span>${esc(r.name)}${r.prize ? `<b class="num">${Fmt.usd(r.prize)}</b>` : ''}</li>`).join('');
      head = `<div class="t-info">
        <div class="t-grid">
          <div><b class="num">${Fmt.usd(t.pool)}</b><span>Prize pool</span></div>
          <div><b class="num">${Fmt.usd(t.payouts[0])}</b><span>First</span></div>
          <div><b class="num">${Fmt.usd(t.payouts[1])}</b><span>Second</span></div>
          <div><b class="num">${t.state === 'running' ? `${g.sb}/${g.bb}` : '—'}</b><span>${t.state === 'running' ? `Level ${t.level}` : t.state === 'registering' ? 'Registering' : 'Finished'}</span></div>
        </div>
        ${places ? `<ol class="t-places">${places}</ol>` : ''}
      </div>`;
    }
    this.body.onclick = null;
    this.body.innerHTML = head + `<table class="stats"><thead><tr><th>Player</th><th>Hands</th><th>VPIP</th><th>PFR</th><th>Net</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="stats-note">VPIP is how often a player puts money in the pot voluntarily before the flop. PFR is how often they raise before the flop. A big gap between the two means lots of calling.</p>`;
  }
}

/* ───────────── confetti ─────────────
   A burst of brass, felt and card colours from the top of the screen. */
let confettiRaf = 0;
const bits = [];
function confetti(n = 120) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('#confetti');
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#e9c985', '#c49a52', '#c2262f', '#33896a', '#f7f0e1', '#6b1f26', '#1f5cc0'];
  for (let i = 0; i < n; i++) {
    bits.push({
      x: W * (0.2 + Math.random() * 0.6), y: H * 0.35 + Math.random() * 40,
      vx: (Math.random() - 0.5) * 13, vy: -6 - Math.random() * 11,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      w: 6 + Math.random() * 7, h: 9 + Math.random() * 9, c: colors[(Math.random() * colors.length) | 0], life: 0,
    });
  }
  if (confettiRaf) return;
  const step = () => {
    ctx.clearRect(0, 0, W, H);
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.vy += 0.32; b.vx *= 0.99; b.vy *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr; b.life++;
      if (b.y > H + 30 || b.life > 320) { bits.splice(i, 1); continue; }
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.scale(1, Math.cos(b.life * 0.18));
      ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    }
    if (bits.length) confettiRaf = requestAnimationFrame(step);
    else { confettiRaf = 0; ctx.clearRect(0, 0, W, H); }
  };
  confettiRaf = requestAnimationFrame(step);
}
