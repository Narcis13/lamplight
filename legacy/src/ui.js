
/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · interface
   Everything below talks to the DOM. The engine above never does.
   ════════════════════════════════════════════════════════════════════ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const at = (e, [x, y]) => { e.style.left = x + 'px'; e.style.top = y + 'px'; };
const STREET_NAME = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown', done: 'Hand over', idle: '' };
const SUIT_NAME = ['spades', 'hearts', 'diamonds', 'clubs'];

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
class SFX {
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
class TableView {
  constructor(sfx) {
    this.sfx = sfx;
    this.wrap = $('#stageWrap'); this.stage = $('#stage'); this.tableEl = $('#table');
    this.boardEl = $('#board'); this.potEl = $('#pot'); this.btnEl = $('#dealerBtn'); this.msgEl = $('#centerMsg');
    this.slots = [];
    for (let k = 0; k < 5; k++) { const s = el('div', 'slot'); this.boardEl.append(s); this.slots.push(s); }
    this.seats = []; this.bets = []; this.game = null; this.layoutName = null; this.onUpdate = () => {};
    new ResizeObserver(() => this.fit()).observe(this.wrap);
    document.addEventListener('click', e => {
      const s = e.target.closest('.seat:not(.hero)');
      this.seats.forEach(x => { if (x !== s) x.classList.remove('peek'); });
      if (s) s.classList.toggle('peek');
    });
  }
  get L() { return LAYOUTS[this.layoutName || 'land']; }

  bind(g) {
    this.game = g;
    $$('.card, .fly', this.stage).forEach(e => e.remove());
    this.hideMsg();
    this.build(g);
    this.layoutName = null;
    this.fit();
    this.updateTable(g);
  }

  build(g) {
    this.seats.forEach(s => s.remove()); this.bets.forEach(b => b.remove());
    this.seats = []; this.bets = [];
    for (const p of g.players) {
      const hero = p.seat === 0, P = p.profile;
      const s = el('div', 'seat' + (hero ? ' hero' : ''));
      s.dataset.seat = p.seat;
      s.style.setProperty('--hue', P ? P.hue : 38);
      const loose = P ? clamp((9 - P.play) / 5.5, 0.05, 1) : 0;
      const face = P ? `<span class="face" aria-hidden="true">${P.emoji}</span>` : `<span class="initial">${esc(p.name.trim()[0] || 'H').toUpperCase()}</span>`;
      s.innerHTML = `
        <div class="hole"></div>
        <div class="avatar">${face}<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" pathLength="100"/></svg></div>
        ${P ? `<div class="tag">${P.tag}</div>` : ''}
        <div class="plate"><span class="nm"></span><span class="stk num"></span></div>
        <div class="hud"></div><div class="badge"></div><div class="eq num"></div><div class="gain num"></div>
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
      if (!hero) { s.tabIndex = 0; s.setAttribute('aria-label', `${P.name}, ${P.style}`); }
      this.stage.append(s);
      this.seats.push(s);
      const b = el('div', 'bet empty');
      this.stage.append(b);
      this.bets.push(b);
    }
  }

  fit() {
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    const name = w && h ? (w / h < 0.9 ? 'port' : 'land') : (this.layoutName || 'land');
    if (name !== this.layoutName) { this.layoutName = name; this.applyLayout(); }
    const L = this.L;
    const s = w && h ? Math.min(w / L.W, h / L.H) : 1;
    this.stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    // on small landscape screens, grow seats and chips a little so text stays legible
    const boost = name === 'land' ? Math.round(clamp(0.82 / s, 1, 1.12) * 100) / 100 : 1;
    if (boost !== this.boost) { this.boost = boost; this.applyScales(); }
  }

  applyScales() {
    const L = this.L, u = (L.uiScale || 1) * (this.boost || 1);
    for (const e of [this.potEl, this.msgEl, ...this.bets]) { e.style.scale = u; e.style.transformOrigin = '0 0'; }
    this.btnEl.style.scale = u;
    this.seats.forEach((s, i) => {
      s.style.scale = this.seatScale(i);
      s.style.transformOrigin = i === 0 ? '110px 140px' : '85px 92px';
    });
  }

  applyLayout() {
    const L = this.L;
    this.stage.dataset.layout = this.layoutName;
    this.stage.style.width = L.W + 'px'; this.stage.style.height = L.H + 'px';
    const [cx, cy, w, h] = L.table;
    Object.assign(this.tableEl.style, { left: cx - w / 2 + 'px', top: cy - h / 2 + 'px', width: w + 'px', height: h + 'px' });
    at(this.boardEl, L.board); at(this.potEl, L.pot); at(this.msgEl, L.msg);
    this.seats.forEach((s, i) => {
      const [x, y] = L.seats[i], hero = i === 0;
      at(s, hero ? [x - 110, y - 140] : [x - 85, y - 92]);
      s.classList.toggle('info-up', !hero && y > L.H * 0.55);
      s.classList.toggle('info-l', x < 170);
      s.classList.toggle('info-r', x > L.W - 170);
    });
    this.bets.forEach((b, i) => at(b, L.bets[i]));
    if (this.game) at(this.btnEl, L.btn[this.game.button]);
    this.applyScales();
  }

  seatScale(i) { const L = this.L; return ((i === 0 ? L.heroScale : L.seatScale) || 1) * (this.boost || 1); }
  /** Offset from a seat's hole-card centre to a stage point, in the seat's own (unscaled) units. */
  toLocal(seat, [px, py]) {
    const [x, y] = this.L.seats[seat], k = this.seatScale(seat);
    return [(px - x) / k, (py - y) / k + (seat === 0 ? 76 : 42)];
  }

  /* ── engine → view ── */
  toast(msg) {
    const t = el('div', 'toast');
    t.textContent = msg;
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 3300);
  }

  updateTable(g) {
    const live = g.street !== 'done' && g.street !== 'idle';
    for (const p of g.players) {
      const s = this.seats[p.seat];
      if (!s) continue;
      s.querySelector('.nm').textContent = p.name;
      s.querySelector('.stk').textContent = live && p.active && p.allIn && p.stack === 0 ? 'All in' : Fmt.money(p.stack);
      s.classList.toggle('folded', p.inHand && p.folded);
      s.classList.toggle('out', !p.inHand);
      s.classList.toggle('allin', live && p.active && p.allIn);

      const b = this.bets[p.seat], key = p.bet + Fmt.units;
      if (p.bet > 0) {
        if (b._key !== key) { b.innerHTML = chipsHTML(p.bet) + `<span class="amt">${Fmt.money(p.bet)}</span>`; b._key = key; }
        b.classList.remove('empty');
      } else { b.classList.add('empty'); b._key = ''; }

      if (p.profile) {
        const st = p.stats, hud = s.querySelector('.hud');
        hud.innerHTML = st.hands >= 5 ? `VPIP <b>${pct(st.vpip, st.hands)}</b>&ensp;PFR <b>${pct(st.pfr, st.hands)}</b>` : '';
        const net = p.net;
        s.querySelector('.info-stats').innerHTML = st.hands
          ? `${st.hands} hands, VPIP ${pct(st.vpip, st.hands)}%, PFR ${pct(st.pfr, st.hands)}%<br>Net <b class="${net >= 0 ? 'pos' : 'neg'}">${Fmt.signed(net) || Fmt.money(0)}</b>${p.buyIns > g.buyIn ? `, ${Math.round(p.buyIns / g.buyIn)} buy-ins` : ''}`
          : 'No hands played yet';
        if (p.profile.tilts) {
          const tag = s.querySelector('.tag'), hot = p.brain.tilt >= 0.3;
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
    if (g.players.length) at(this.btnEl, this.L.btn[g.button]);
    this.btnEl.hidden = !g.handNo;
    this.onUpdate(g);
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
    const hero = seat === 0;
    const e = cardEl(hero ? c : null, { size: hero ? 'lg' : 'sm', down: true });
    const [dx, dy] = this.toLocal(seat, this.L.board);
    e.style.setProperty('--dx', `${dx}px`);
    e.style.setProperty('--dy', `${dy}px`);
    e.style.setProperty('--r', `${(round ? 1 : -1) * (hero ? 4 : 6)}deg`);
    this.animateIn(e);
    this.seats[seat].querySelector('.hole').append(e);
  }

  async revealHero() {
    for (const c of $$('.card', this.seats[0].querySelector('.hole'))) {
      c.classList.remove('down');
      this.sfx.flip();
      await sleep(120);
    }
    await sleep(280);
  }

  async dealBoard(cards, start, g) {
    const T = g.T;
    const els = cards.map((c, i) => {
      const k = start + i, e = cardEl(c, { down: true });
      e.style.setProperty('--dx', `${-(k - 2) * 80}px`);
      e.style.setProperty('--dy', '-110px');
      return [k, e];
    });
    for (const [k, e] of els) {
      this.animateIn(e);
      this.slots[k].append(e);
      this.sfx.card();
      await sleep(T.deal + 40);
    }
    await sleep(240);
    for (const [, e] of els) {
      e.classList.remove('down');
      this.sfx.flip();
      if (els.length > 1) await sleep(95);
    }
    await sleep(430);
  }

  setActive(seat) { this.seats.forEach((s, i) => s.classList.toggle('turn', i === seat)); }

  setThinking(seat, ms) {
    const s = this.seats[seat];
    if (ms > 0) {
      s.style.setProperty('--think', ms + 'ms');
      s.classList.remove('thinking');
      void s.offsetWidth;
      s.classList.add('thinking');
    } else s.classList.remove('thinking');
  }

  showAction(p, r) {
    const b = this.seats[p.seat].querySelector('.badge');
    b.className = `badge ${r.allIn ? 'allin' : r.type}`;
    b.textContent = r.allIn ? 'All in' : { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise' }[r.type];
    void b.offsetWidth;
    b.classList.add('show');
  }

  fold(seat) {
    const hole = this.seats[seat].querySelector('.hole');
    if (seat === 0) { hole.classList.add('folded'); return; }
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

  async collectBets(g) {
    const [px, py] = this.L.pot, jobs = [];
    for (const p of g.players) {
      if (p.bet <= 0) continue;
      jobs.push(this.fly(chipsHTML(p.bet), this.L.bets[p.seat], [px - 30, py], 400));
      this.bets[p.seat].classList.add('empty');
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
    const holeEl = this.seats[seat].querySelector('.hole');
    const cards = $$('.card', holeEl);
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

  highlight(winners, best, g) {
    const B = new Set(best);
    $$('.eq', this.stage).forEach(e => e.classList.remove('show'));
    winners.forEach(s => this.seats[s].classList.add('winner'));
    for (const sl of this.slots) {
      const c = sl.querySelector('.card');
      if (!c) continue;
      const on = B.has(+c.dataset.c);
      c.classList.toggle('hl', on); c.classList.toggle('dim', !on);
    }
    for (const p of g.players) {
      if (!p.active) continue;
      const win = winners.includes(p.seat);
      for (const c of $$('.card', this.seats[p.seat].querySelector('.hole'))) {
        const on = win && B.has(+c.dataset.c);
        c.classList.toggle('hl', on);
        c.classList.toggle('dim', !win);
      }
    }
  }

  async award(awards, g) {
    const L = this.L;
    this.potEl.classList.add('empty');
    const jobs = awards.map((a, i) => {
      const s = this.seats[a.seat], [x, y] = L.seats[a.seat];
      s.classList.add('winner');
      setTimeout(() => {
        const gain = s.querySelector('.gain');
        gain.textContent = '+' + Fmt.money(a.amount);
        gain.classList.remove('show'); void gain.offsetWidth; gain.classList.add('show');
      }, 420 + i * 140);
      return this.fly(chipsHTML(a.amount), [L.pot[0] - 30, L.pot[1]], [x, y - 8], 560, i * 140);
    });
    await Promise.all(jobs);
    await sleep(260);
  }

  message(title, sub) {
    this.msgEl.querySelector('.m1').textContent = title;
    this.msgEl.querySelector('.m2').textContent = sub || '';
    this.msgEl.classList.remove('show'); void this.msgEl.offsetWidth; this.msgEl.classList.add('show');
    clearTimeout(this._msgT);
    if (title === 'All in') this._msgT = setTimeout(() => this.hideMsg(), 1800);
  }
  hideMsg() { clearTimeout(this._msgT); this.msgEl.classList.remove('show'); }
}

/* ───────────── your controls ───────────── */
class ActionPanel {
  constructor(app) {
    this.app = app;
    this.dock = $('#dock'); this.hiTitle = $('#hiTitle'); this.hiSub = $('#hiSub');
    this.odds = $('#odds'); this.oddsBar = $('#odds i'); this.oddsVal = $('#odds span');
    this.sizing = $('#sizing'); this.presets = $('#presets'); this.slider = $('#slider'); this.input = $('#raiseInput');
    this.foldBtn = $('#foldBtn'); this.callBtn = $('#callBtn'); this.raiseBtn = $('#raiseBtn');
    this.preFold = $('#preFold'); this.preCall = $('#preCall'); this.idleEl = $('#idleMsg');
    this.pre = null; this.resolve = null; this.L = null; this.g = null; this.value = 0;

    this.foldBtn.onclick = () => this.act('fold');
    this.callBtn.onclick = () => this.act('call');
    this.raiseBtn.onclick = () => this.act('raise');
    this.slider.oninput = () => this.setValue(+this.slider.value, true);
    this.input.onchange = () => this.setValue(this.parseInput());
    this.input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this.setValue(this.parseInput()); this.act('raise'); } };
    this.input.onfocus = () => this.input.select();
    $('#minus').onclick = () => this.nudge(-1);
    $('#plus').onclick = () => this.nudge(1);
    this.presets.onclick = e => { const b = e.target.closest('.preset'); if (b) this.setValue(+b.dataset.v); };
    this.preFold.onclick = () => this.togglePre('fold');
    this.preCall.onclick = () => this.togglePre('call');
  }

  get prompting() { return !!this.resolve; }
  setMode(m) { this.dock.dataset.mode = m; }
  idle(text) { this.setMode('idle'); this.idleEl.textContent = text; }
  reset() {
    this.resolve = null; this.pre = null; this.renderPre();
    this.hiTitle.textContent = 'Pull up a chair';
    this.hiSub.textContent = "Six-handed No-Limit Hold'em, $1/$2 blinds";
    this.odds.hidden = true;
  }

  togglePre(kind) { this.pre = this.pre === kind ? null : kind; this.renderPre(); }
  renderPre() {
    this.preFold.setAttribute('aria-pressed', String(this.pre === 'fold'));
    this.preCall.setAttribute('aria-pressed', String(this.pre === 'call'));
  }

  refreshMode(g) {
    if (this.resolve) return;
    const h = g.hero;
    if (g.street === 'done') return;
    if (h.canAct && g.activeCount() > 1 && !g.runout) {
      this.setMode('pre');
      this.preFold.textContent = g.currentBet > h.bet ? 'Fold' : 'Check / Fold';
    } else if (!h.inHand) this.idle('Sitting this hand out');
    else if (h.folded) this.idle('Folded. Watching the rest of the hand');
    else if (h.allIn) this.idle("You're all in. Sweat it out");
    else this.idle('Waiting for the others');
  }

  /* ── engine → panel ── */
  newHand(g) { this.pre = null; this.renderPre(); this.refreshMode(g); }
  newStreet(g) { this.pre = null; this.renderPre(); this.refreshMode(g); }
  sync(g) { this.refreshMode(g); }

  takePreaction(L) {
    const p = this.pre;
    if (!p) return null;
    this.pre = null; this.renderPre();
    if (L.canCheck) return { type: 'check' };
    return { type: p === 'fold' ? 'fold' : 'call' };
  }

  prompt(L, g) {
    this.render(L, g);
    this.setMode('turn');
    // on narrow screens the drawer covers the buttons: get it out of the way
    if (this.app.drawer.isOpen && window.innerWidth < 1100) this.app.drawer.close();
    return new Promise(res => (this.resolve = res));
  }

  render(L, g, keep = false) {
    this.L = L; this.g = g;
    const hero = g.hero;
    this.foldBtn.disabled = L.canCheck;
    this.foldBtn.title = L.canCheck ? 'Checking is free' : '';
    const [cl, cv] = [this.callBtn.querySelector('.a-l'), this.callBtn.querySelector('.a-v')];
    if (L.canCheck) { cl.textContent = 'Check'; cv.textContent = ''; }
    else { cl.textContent = L.callAmt >= hero.stack ? 'Call all in' : 'Call'; cv.textContent = Fmt.money(L.callAmt); }
    this.raiseBtn.hidden = !L.canRaise;
    this.sizing.hidden = !L.canRaise || L.minTo >= L.maxTo;
    if (L.canRaise) {
      this.slider.min = L.minTo; this.slider.max = L.maxTo; this.slider.step = 1;
      this.buildPresets();
      this.setValue(keep ? this.value : this.defaultSize());
    }
  }

  act(kind) {
    if (!this.resolve) return;
    let a;
    if (kind === 'fold') { if (this.foldBtn.disabled) return; a = { type: 'fold' }; }
    else if (kind === 'call') a = { type: this.L.canCheck ? 'check' : 'call' };
    else { if (this.raiseBtn.hidden) return; a = { type: 'raise', to: this.value }; }
    const r = this.resolve;
    this.resolve = null;
    this.idle('');
    r(a);
  }

  sizeOptions() {
    const { L, g } = this, bb = g.bb, cur = g.currentBet;
    const potTo = f => cur + (g.pot + L.toCall) * f;
    let o;
    if (g.street === 'preflop') {
      if (g.raiseCount === 0) {
        const limp = g.players.filter(q => q.active && q.seat !== g.sbI && q.seat !== g.bbI && q.bet === bb && q.seat !== 0).length * bb;
        o = [['2.5 BB', 2.5 * bb + limp], ['3 BB', 3 * bb + limp], ['4 BB', 4 * bb + limp], ['Pot', potTo(1)]];
      } else o = [['2.5×', cur * 2.5], ['3×', cur * 3], ['4×', cur * 4], ['Pot', potTo(1)]];
    } else if (L.isBet) o = [['⅓', potTo(1 / 3)], ['½', potTo(0.5)], ['¾', potTo(0.75)], ['Pot', potTo(1)]];
    else o = [['Min', L.minTo], ['½', potTo(0.5)], ['¾', potTo(0.75)], ['Pot', potTo(1)]];
    const seen = new Set();
    const out = [];
    for (const [label, raw] of o) {
      const v = clamp(Math.round(raw), L.minTo, L.maxTo);
      if (v >= L.maxTo || seen.has(v)) continue;
      seen.add(v); out.push([label, v]);
    }
    out.push(['All in', L.maxTo]);
    return out;
  }
  buildPresets() {
    this.presets.innerHTML = this.sizeOptions()
      .map(([l, v]) => `<button class="preset" data-v="${v}" title="${Fmt.money(v)}">${l}</button>`).join('');
  }
  defaultSize() {
    const { L, g } = this, cur = g.currentBet;
    if (g.street === 'preflop') {
      if (g.raiseCount === 0) return this.sizeOptions()[0][1];
      return cur * 3;
    }
    return L.isBet ? cur + (g.pot + L.toCall) * 0.5 : cur * 3;
  }

  units(v) { return Fmt.units === 'bb' ? String(Math.round((v / this.g.bb) * 10) / 10) : String(v); }
  parseInput() {
    const n = parseFloat(String(this.input.value).replace(/[^0-9.,]/g, '').replace(',', '.'));
    if (!isFinite(n)) return this.value;
    return Fmt.units === 'bb' ? n * this.g.bb : n;
  }
  nudge(d) { this.setValue(this.value + d * this.g.bb); }

  setValue(v, fromSlider = false) {
    const L = this.L;
    if (!L) return;
    v = clamp(Math.round(v), L.minTo, L.maxTo);
    this.value = v;
    if (!fromSlider) this.slider.value = v;
    const span = L.maxTo - L.minTo;
    this.slider.style.setProperty('--fill', (span ? ((v - L.minTo) / span) * 100 : 100) + '%');
    this.input.value = this.units(v);
    const all = v >= L.maxTo;
    this.raiseBtn.querySelector('.a-l').textContent = all ? 'All in' : L.isBet ? 'Bet' : 'Raise to';
    this.raiseBtn.querySelector('.a-v').textContent = Fmt.money(v);
    $$('.preset', this.presets).forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === v)));
  }

  refreshUnits() {
    if (this.resolve) this.render(this.L, this.g, true); // same decision, labels in the new units
  }

  info(o) {
    if (o.state === 'out') {
      this.hiTitle.textContent = 'Waiting for the deal'; this.hiSub.textContent = ''; this.odds.hidden = true; return;
    }
    this.hiTitle.textContent = o.name;
    if (o.state === 'folded') { this.hiSub.textContent = 'You folded this one'; this.odds.hidden = true; return; }
    const who = o.opp === 1 ? '1 opponent' : `${o.opp} opponents`;
    this.hiSub.textContent = o.known
      ? `${STREET_NAME[o.street] || 'All in'}, cards face up against ${who}`
      : `${STREET_NAME[o.street] || ''} against ${who}`;
    if (o.eq == null) { this.odds.hidden = true; return; }
    this.odds.hidden = false;
    this.odds.title = o.known ? 'Your equity against the revealed hands'
      : `Chance to win against ${o.opp} random ${o.opp === 1 ? 'hand' : 'hands'}`;
    this.oddsBar.style.width = Math.round(o.eq * 100) + '%';
    this.oddsVal.textContent = Math.round(o.eq * 100) + '%';
  }

  handOver(g) {
    this.pre = null; this.renderPre();
    const h = g.hero;
    if (h.inHand) {
      const d = h.stack - h.startStack;
      this.hiSub.innerHTML = d > 0 ? `You won <b class="pos">${Fmt.money(d)}</b> this hand`
        : d < 0 ? `You lost <b class="neg">${Fmt.money(-d)}</b> this hand` : 'Your stack is unchanged';
      this.odds.hidden = true;
    }
    this.idle(g.paused ? 'Paused. Press Resume to deal again' : 'Next hand coming up');
  }

  askRebuy(amount) {
    $('#rebuyText').textContent =
      `You're out of chips. Rebuy for ${Fmt.usd(amount)} (${amount / this.app.game.bb} BB) and keep playing, or cash out and see how the session went.`;
    Modal.open('rebuyModal');
    return new Promise(res => {
      $('#rebuyYes').onclick = () => { Modal.close('rebuyModal'); res(true); };
      $('#rebuyNo').onclick = () => { Modal.close('rebuyModal'); res(false); };
    });
  }
}

/* ───────────── modals ───────────── */
const Modal = {
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

/* ───────────── hand log & stats drawer ───────────── */
class Drawer {
  constructor(app) {
    this.app = app; this.el = $('#drawer'); this.body = $('#drawerBody'); this.tab = 'log'; this.isOpen = false; this._raf = 0;
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
    $$('.tab', this.el).forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    this.render();
  }
  dirty() {
    if (!this.isOpen || this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }
  render() {
    if (!this.isOpen) return;
    const g = this.app.game;
    if (this.tab === 'log') {
      const hands = this.app.log.hands;
      this.body.innerHTML = hands.length
        ? hands.map(hd => `<div class="log-hand"><h5>Hand ${hd.no}</h5>${hd.lines.map(l => `<div class="log-line ${l.cls}">${l.html}</div>`).join('')}</div>`).join('')
        : '<p class="empty-note">Hands show up here as they are played, newest first.</p>';
      return;
    }
    const rows = g.players.map(p => {
      const st = p.stats, net = p.net;
      return `<tr><td>${esc(p.name)}<small>${p.profile ? p.profile.style : 'You'}</small></td>
        <td>${st.hands}</td><td>${pct(st.vpip, st.hands)}%</td><td>${pct(st.pfr, st.hands)}%</td>
        <td class="${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${Fmt.signed(net) || Fmt.money(0)}</td></tr>`;
    }).join('');
    this.body.innerHTML = `<table class="stats"><thead><tr><th>Player</th><th>Hands</th><th>VPIP</th><th>PFR</th><th>Net</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="stats-note">VPIP is how often a player puts money in the pot voluntarily before the flop. PFR is how often they raise before the flop. A big gap between the two means lots of calling.</p>`;
  }
}

/* ───────────── settings ───────────── */
const DEFAULTS = { speed: 'normal', fourColor: false, showOdds: true, showTags: true, showHud: true, sound: true, theme: 'auto', units: 'usd', name: 'Hero', buyInBB: 100 };
const Store = {
  KEY: 'lamplight.settings',
  load() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch (e) { s = {}; }
    return Object.assign({}, DEFAULTS, s);
  },
  save(s) { try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ } },
};

/** Wraps a view object so a retired game can never touch the screen again. */
function gate(obj, g) {
  return new Proxy(obj, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      return (...a) => (g.retired ? new Promise(() => {}) : v.apply(t, a));
    },
  });
}

/* ───────────── the app ───────────── */
class App {
  constructor() {
    this.settings = Store.load();
    Fmt.units = this.settings.units;
    this.sfx = new SFX(this.settings);
    this.view = new TableView(this.sfx);
    this.panel = new ActionPanel(this);
    this.drawer = new Drawer(this);
    this.view.onUpdate = g => this.updateTopbar(g);
    this.wire();
    this.applySettings();
    this.newSession();
  }

  save() { Store.save(this.settings); }

  wire() {
    $('#unitsBtn').onclick = () => this.toggleUnits();
    $('#pauseBtn').onclick = () => this.togglePause();
    $('#logBtn').onclick = () => this.drawer.toggle('log');
    $('#statsBtn').onclick = () => (this.drawer.isOpen && this.drawer.tab === 'stats' ? this.drawer.close() : this.drawer.open('stats'));
    $('#settingsBtn').onclick = () => Modal.open('settingsModal');
    $('#leaveBtn').onclick = () => this.openSummary(false);

    $('#startBtn').onclick = () => this.start();
    $('#nameInput').onkeydown = e => { if (e.key === 'Enter') this.start(); };
    $('#buyinSeg').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      this.settings.buyInBB = +b.dataset.v; this.save(); this.syncControls();
    };
    $('#summaryKeep').onclick = () => this.closeSummary();
    $('#summaryNew').onclick = () => { Modal.close('summaryModal'); this.newSession(); };

    $$('#settingsModal .seg').forEach(seg => (seg.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      this.settings[seg.dataset.setting] = b.dataset.v; this.save(); this.applySettings();
    }));
    $$('#settingsModal .switch').forEach(sw => (sw.onclick = () => {
      const k = sw.dataset.setting;
      this.settings[k] = !this.settings[k]; this.save(); this.applySettings();
      if (k === 'showOdds') this.refreshOdds();
      if (k === 'sound' && this.settings.sound) { this.sfx.init(); setTimeout(() => this.sfx.chip(), 30); }
    }));
    $$('[data-close]').forEach(b => (b.onclick = () => Modal.close(b.closest('.modal').id)));

    document.addEventListener('keydown', e => this.onKey(e));
  }

  applySettings() {
    const s = this.settings, root = document.documentElement;
    if (s.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = s.theme;
    document.body.classList.toggle('four', !!s.fourColor);
    $('#stage').classList.toggle('hide-tags', !s.showTags);
    $('#stage').classList.toggle('hide-hud', !s.showHud);
    Fmt.units = s.units;
    this.syncControls();
  }
  syncControls() {
    const s = this.settings;
    $$('#settingsModal .seg').forEach(seg => $$('button', seg).forEach(b => b.setAttribute('aria-pressed', String(s[seg.dataset.setting] === b.dataset.v))));
    $$('#settingsModal .switch').forEach(sw => sw.setAttribute('aria-pressed', String(!!s[sw.dataset.setting])));
    $$('#buyinSeg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === s.buyInBB)));
    const u = $('#unitsBtn');
    u.setAttribute('aria-pressed', String(s.units === 'bb'));
    u.title = s.units === 'bb' ? 'Showing big blinds. Switch to dollars' : 'Showing dollars. Switch to big blinds';
  }

  refreshOdds() {
    const g = this.game;
    if (g && g.handNo && ['preflop', 'flop', 'turn', 'river'].includes(g.street)) g.refreshHero();
  }

  toggleUnits() {
    this.settings.units = this.settings.units === 'bb' ? 'usd' : 'bb';
    this.save(); this.applySettings();
    if (this.game) { this.view.updateTable(this.game); this.panel.refreshUnits(); }
    this.drawer.render();
  }

  setPauseUI(paused) {
    const b = $('#pauseBtn');
    b.setAttribute('aria-pressed', String(paused));
    b.querySelector('.lbl').textContent = paused ? 'Resume' : 'Pause';
    b.querySelector('.i-pause').style.display = paused ? 'none' : '';
    b.querySelector('.i-play').style.display = paused ? '' : 'none';
  }
  togglePause() {
    const g = this.game;
    if (!g || !g.running) return;
    const p = !g.paused;
    g.setPaused(p);
    this.setPauseUI(p);
    if (g.street === 'done') this.panel.idle(p ? 'Paused. Press Resume to deal again' : 'Next hand coming up');
    else if (p) this.view.toast('The table will pause after this hand');
  }

  updateTopbar(g) {
    $('#handNo').textContent = g.handNo;
    const net = g.hero.net, b = $('#sessionNet');
    b.textContent = Fmt.signed(net) || Fmt.money(0);
    b.className = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    if (this.drawer.isOpen && this.drawer.tab === 'stats') this.drawer.dirty();
  }

  newSession() {
    const old = this.game;
    if (old) { old.retired = true; old.stop(); }
    this.panel.reset();
    this.panel.idle('Take a seat to begin');
    this.log = new HandLog();
    this.log.onChange = () => this.drawer.dirty();
    const g = new Game({ settings: this.settings });
    g.view = gate(this.view, g); g.panel = gate(this.panel, g); g.sfx = gate(this.sfx, g); g.log = this.log;
    g.setup({ name: this.settings.name || 'Hero', buyInBB: this.settings.buyInBB || 100 });
    this.game = g;
    this.view.bind(g);
    this.setPauseUI(false);
    this.drawer.render();
    $('#nameInput').value = this.settings.name || 'Hero';
    this.renderLineup(g);
    this.syncControls();
    Modal.open('startModal');
  }

  renderLineup(g) {
    $('#lineup').innerHTML = g.players.slice(1).map(p => {
      const P = p.profile;
      return `<div class="row"><div class="av" style="--hue:${P.hue}" aria-hidden="true">${P.emoji}</div>
        <div class="who"><b>${P.name}</b><span>${P.style}. ${P.blurb}</span></div>
        <div class="risk">Risk appetite<div class="bar"><i style="width:${Math.round(P.risk * 100)}%"></i></div></div></div>`;
    }).join('');
  }

  start() {
    const g = this.game;
    if (g.running) return;
    const name = ($('#nameInput').value || '').replace(/[<>&"'`]/g, '').trim().slice(0, 16) || 'Hero';
    const bbs = this.settings.buyInBB || 100;
    this.settings.name = name; this.save();
    g.buyIn = bbs * g.bb;
    for (const p of g.players) { p.stack = g.buyIn; p.buyIns = g.buyIn; }
    g.hero.name = name;
    this.view.bind(g);
    Modal.close('startModal');
    this.sfx.init();
    this.panel.idle('Shuffling up and dealing');
    g.run().then(() => { if (!g.retired && this.game === g) this.openSummary(true); });
  }

  openSummary(ended) {
    const g = this.game, h = g.hero, st = h.stats, net = h.net;
    this._wasPaused = g.paused;
    if (!ended && g.running) { g.setPaused(true); this.setPauseUI(true); }
    $('#summaryTitle').textContent = ended ? 'Cashed out' : 'Leaving already?';
    $('#summaryLede').textContent = ended
      ? `You played ${st.hands} ${st.hands === 1 ? 'hand' : 'hands'} at the Lamplight table. Here's how it went.`
      : "Here's where your session stands. The table pauses after the current hand while you decide.";
    const buyIns = Math.round(h.buyIns / g.buyIn);
    $('#summaryGrid').innerHTML = `
      <div><b class="num ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${Fmt.signed(net) || Fmt.money(0)}</b><span>Net result</span></div>
      <div><b class="num">${st.hands}</b><span>Hands played</span></div>
      <div><b class="num">${Fmt.money(g.session.biggestWin)}</b><span>Biggest pot you won</span></div>
      <div><b class="num">${pct(st.vpip, st.hands)}% / ${pct(st.pfr, st.hands)}%</b><span>VPIP / PFR</span></div>
      <div><b class="num">${st.won}</b><span>Pots won</span></div>
      <div><b class="num">${buyIns}</b><span>${buyIns === 1 ? 'Buy-in used' : 'Buy-ins used'}</span></div>`;
    $('#summaryKeep').hidden = ended;
    Modal.open('summaryModal');
  }
  closeSummary() {
    Modal.close('summaryModal');
    const g = this.game;
    if (g.running && !this._wasPaused) { g.setPaused(false); this.setPauseUI(false); if (g.street === 'done') this.panel.idle('Next hand coming up'); }
  }

  onKey(e) {
    if (e.key === 'Escape') {
      if (Modal.isOpen('settingsModal')) Modal.close('settingsModal');
      else if (Modal.isOpen('summaryModal') && !$('#summaryKeep').hidden) this.closeSummary();
      else if (this.drawer.isOpen) this.drawer.close();
      return;
    }
    if (Modal.isOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    const P = this.panel, t = e.target;
    const typing = t.matches && t.matches('input:not([type="range"]), textarea');
    const onControl = t.matches && t.matches('button, input');
    if (typing) return;
    const k = e.key.toLowerCase();
    if (!P.prompting) {
      if (k === 'p') this.togglePause();
      return;
    }
    if (k === 'f') { e.preventDefault(); P.act('fold'); }
    else if (k === 'c' || k === 'k' || (k === ' ' && !onControl)) { e.preventDefault(); P.act('call'); }
    else if (k === 'r' || (k === 'enter' && !onControl)) { e.preventDefault(); P.act('raise'); }
    else if ((k === 'arrowup' || k === 'arrowright') && t !== P.slider) { e.preventDefault(); P.nudge(1); }
    else if ((k === 'arrowdown' || k === 'arrowleft') && t !== P.slider) { e.preventDefault(); P.nudge(-1); }
  }
}

window.addEventListener('DOMContentLoaded', () => { window.lamplight = new App(); });
