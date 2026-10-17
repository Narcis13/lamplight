/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · your controls
   The dock at the bottom: hand info, pre-actions, and the fold / call /
   raise buttons when the server says it's your turn.
   ════════════════════════════════════════════════════════════════════ */
import { clamp, Fmt } from '../shared/engine.js';
import { $, $$, STREET_NAME, Modal, compactMode } from './view.js';

export class ActionPanel {
  constructor(app) {
    this.app = app;
    this.dock = $('#dock'); this.hiTitle = $('#hiTitle'); this.hiSub = $('#hiSub');
    this.odds = $('#odds'); this.oddsBar = $('#odds i'); this.oddsVal = $('#odds span'); this.oddsNeed = $('#oddsNeed'); this.coach = $('#coach');
    this.sizing = $('#sizing'); this.presets = $('#presets'); this.slider = $('#slider'); this.input = $('#raiseInput');
    this.foldBtn = $('#foldBtn'); this.callBtn = $('#callBtn'); this.raiseBtn = $('#raiseBtn');
    this.preFold = $('#preFold'); this.preCall = $('#preCall'); this.idleEl = $('#idleMsg'); this.clockEl = $('#clock');
    this.pre = null; this.resolve = null; this.L = null; this.g = null; this.value = 0;

    this.foldBtn.onclick = () => this.act('fold');
    this.callBtn.onclick = () => this.act('call');
    this.raiseBtn.onclick = () => this.tapRaise();
    this.slider.oninput = () => this.setValue(+this.slider.value, true);
    this.input.onchange = () => this.setValue(this.parseInput());
    this.input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this.setValue(this.parseInput()); this.act('raise'); } };
    this.input.onfocus = () => this.input.select();
    $('#minus').onclick = () => this.nudge(-1);
    $('#plus').onclick = () => this.nudge(1);
    this.presets.onclick = e => { const b = e.target.closest('.preset'); if (b) this.setValue(+b.dataset.v); };
    this.preFold.onclick = () => this.togglePre('fold');
    this.preCall.onclick = () => this.togglePre('call');
    // a tap anywhere off the dock folds the bet sizing away again
    document.addEventListener('pointerdown', e => { if (this.sizingOpen && !e.target.closest('#dock')) this.openSizing(false); });
  }

  get prompting() { return !!this.resolve; }
  get sizingOpen() { return this.dock.classList.contains('sizing-open'); }
  openSizing(v) { this.dock.classList.toggle('sizing-open', v); }
  /** On a phone the bet sizing hides behind Raise: the first tap shows it in place of the hand info, the second bets. */
  tapRaise() {
    if (compactMode() && !this.sizingOpen && !this.sizing.hidden && !this.raiseBtn.hidden) { this.openSizing(true); return; }
    this.act('raise');
  }
  setMode(m) { this.dock.dataset.mode = m; this.app.syncIdleButtons(); }
  idle(text) { this.setMode('idle'); this.idleEl.textContent = text; }
  reset() {
    this.cancel();
    this.pre = null; this.renderPre();
    this.hiTitle.textContent = 'Pull up a chair';
    this.hiSub.textContent = "Six-handed No-Limit Hold'em";
    this.odds.hidden = true; this.coach.hidden = true;
  }

  togglePre(kind) { this.pre = this.pre === kind ? null : kind; this.renderPre(); }
  renderPre() {
    this.preFold.setAttribute('aria-pressed', String(this.pre === 'fold'));
    this.preCall.setAttribute('aria-pressed', String(this.pre === 'call'));
  }

  refreshMode(g) {
    if (this.resolve) return;
    const h = g.hero;
    const t = g.isSng && g.tourney;
    if (t && t.state === 'registering') {
      if (h) return this.idle(t.startsAt ? "You're registered. Press Start to begin now, or wait for more players" : "You're registered");
      if (g.pendingSeat != null) return this.idle("You're registered. Taking your seat");
      return this.idle(`Register for ${Fmt.usd(t.buyIn)}. The top two share ${Fmt.usd(t.pool)}`);
    }
    if (t && t.state === 'finished') return this.idle('Tournament over');
    if (!h) {
      if (t && t.state === 'running') return this.idle('Watching the tournament');
      if (g.pendingSeat != null) this.idle("You're in. You'll be dealt in next hand");
      else this.idle(g.canSit ? 'Watching. Sit in whenever you like' : 'Watching. The table is full of people');
      return;
    }
    if (h.away) return this.idle("You're sitting out. The table deals around you");
    if (g.street === 'done' || g.street === 'idle') return this.idle(g.waiting || 'Next hand coming up');
    if (h.canAct && g.activeCount() > 1 && !g.runout) {
      this.setMode('pre');
      this.preFold.textContent = g.currentBet > h.bet ? 'Fold' : 'Check / Fold';
    } else if (!h.inHand) this.idle(h.stack === 0 ? 'Out of chips' : 'Sitting this hand out');
    else if (h.folded) this.idle('Folded. Watching the rest of the hand');
    else if (h.allIn) this.idle("You're all in. Sweat it out");
    else this.idle('Waiting for the others');
  }

  newHand(g) { this.pre = null; this.renderPre(); this.hideRit(null); this.refreshMode(g); }
  newStreet(g) { this.pre = null; this.renderPre(); this.refreshMode(g); }
  sync(g) { this.refreshMode(g); }

  takePreaction(L) {
    const p = this.pre;
    if (!p) return null;
    this.pre = null; this.renderPre();
    if (L.canCheck) return { type: 'check' };
    return { type: p === 'fold' ? 'fold' : 'call' };
  }

  /** Shows the buttons. Resolves with your action; the server's clock is shown alongside. */
  prompt(L, g, ms, bank = 0) {
    this.render(L, g);
    this.openSizing(false);
    this.setMode('turn');
    if (this.app.drawer.isOpen && window.innerWidth < 1100) this.app.drawer.close();
    this.bank = bank;
    this.runClock(ms, false);
    return new Promise(res => (this.resolve = res));
  }
  /** The shot clock, or (once it has run out) the time bank counting down. */
  runClock(ms, banking) {
    const end = performance.now() + ms;
    clearInterval(this._clock);
    this.clockEl.classList.toggle('bank', banking);
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      const bank = this.bank >= 1000 ? `<span class="bk">+ ${Math.round(this.bank / 1000)}s bank</span>` : '';
      this.clockEl.innerHTML = banking ? `Time bank <b>${left}s</b>` : `${left}s<span class="ta"> to act</span>${bank}`;
      this.clockEl.classList.toggle('low', left <= 5);
    };
    tick();
    this._clock = setInterval(tick, 250);
  }
  /** The server says our shot clock ran out and the time bank is running. */
  startBank(ms) {
    if (!this.resolve) return;
    this.bank = 0;
    this.runClock(ms, true);
    this.app.sfx.tick();
  }

  /** Asks whether to run it twice. Resolves true or false, or null if the server moved on. */
  askRit(ms) {
    const box = $('#ritAsk'), bar = $('#ritAsk .rit-clock i');
    this.hideRit(null);
    box.hidden = false;
    bar.style.transition = 'none'; bar.style.width = '100%';
    void bar.offsetWidth;
    bar.style.transition = `width ${ms}ms linear`; bar.style.width = '0%';
    return new Promise(res => {
      this._rit = res;
      $('#ritYes').onclick = () => this.hideRit(true);
      $('#ritNo').onclick = () => this.hideRit(false);
    });
  }
  hideRit(answer) {
    $('#ritAsk').hidden = true;
    if (this._rit) { const r = this._rit; this._rit = null; r(answer); }
  }
  /** The server moved on without us (clock ran out, or we resynced). */
  cancel() {
    clearInterval(this._clock);
    this.openSizing(false);
    this.clockEl.textContent = ''; this.clockEl.classList.remove('bank');
    if (this.resolve) { const r = this.resolve; this.resolve = null; r(null); }
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
    this.openSizing(false);
    clearInterval(this._clock); this.clockEl.textContent = ''; this.clockEl.classList.remove('bank');
    this.idle('');
    r(a);
  }

  sizeOptions() {
    const { L, g } = this, bb = g.bb, cur = g.currentBet;
    const potTo = f => cur + (g.pot + L.toCall) * f;
    let o;
    if (g.street === 'preflop') {
      if (g.raiseCount === 0) {
        const limp = g.players.filter(q => q.active && q.seat !== g.sbI && q.seat !== g.bbI && q.bet === bb && q.seat !== g.me).length * bb;
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

  /** Number keys pick the bet-size presets, left to right. */
  preset(i) {
    const b = $$('.preset', this.presets)[i];
    if (b && !this.sizing.hidden) this.setValue(+b.dataset.v);
  }

  units(v) { return Fmt.units === 'bb' ? String(Math.round((v / this.g.bb) * 10) / 10) : String(v); }
  parseInput() {
    const n = parseFloat(String(this.input.value).replace(/[^0-9.,]/g, '').replace(',', '.'));
    if (!isFinite(n)) return this.value;
    return Fmt.units === 'bb' ? n * this.g.bb : n;
  }
  nudge(d) { if (this.g) this.setValue(this.value + d * this.g.bb); }

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

  refreshUnits() { if (this.resolve) this.render(this.L, this.g, true); }

  info(o) {
    this.coach.hidden = true;
    if (o.state === 'out') {
      this.hiTitle.textContent = o.title || 'Waiting for the deal'; this.hiSub.textContent = o.sub || ''; this.odds.hidden = true; return;
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
    // the coach: what the price asks of you, against what the odds bar says you have
    if (o.need != null) {
      const need = Math.round(o.need * 100), eq = Math.round(o.eq * 100);
      this.oddsNeed.hidden = false;
      this.oddsNeed.style.left = need + '%';
      this.oddsNeed.title = `You need ${need}% to call`;
      const ratio = (1 - o.need) / o.need;
      const verdict = eq >= need + 8 ? 'good' : eq >= need - 4 ? 'close' : 'poor';
      const words = { good: 'The price is right', close: 'A close call', poor: 'Expensive for this hand' }[verdict];
      this.coach.hidden = false;
      this.coach.dataset.v = verdict;
      this.coach.innerHTML = `<b>${words}</b><span class="cx"> Calling ${Fmt.money(o.toCall)} gets ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)} to 1. You</span><span class="cs">:</span> need <b>${need}%</b>, <span class="cx">you </span>have <span class="cx">about </span><b>${eq}%</b><span class="cx"> against random hands</span>.`;
    } else { this.oddsNeed.hidden = true; }
  }

  handOver(g) {
    this.pre = null; this.renderPre();
    const h = g.hero;
    this.coach.hidden = true;
    if (h && h.inHand) {
      const d = h.stack - h.startStack;
      this.hiSub.innerHTML = d > 0 ? `You won <b class="pos">${Fmt.money(d)}</b> this hand`
        : d < 0 ? `You lost <b class="neg">${Fmt.money(-d)}</b> this hand` : 'Your stack is unchanged';
      this.odds.hidden = true;
    }
    this.refreshMode(g);
  }

  askRebuy(amount, bb) {
    $('#rebuyText').textContent =
      `You're out of chips. Rebuy for ${Fmt.usd(amount)} (${amount / bb} BB) from your bankroll and get dealt in next hand, watch for a while, or head back to the lobby.`;
    Modal.open('rebuyModal');
    return new Promise(res => {
      $('#rebuyYes').onclick = () => { Modal.close('rebuyModal'); res('rebuy'); };
      $('#rebuyNo').onclick = () => { Modal.close('rebuyModal'); res('watch'); };
      $('#rebuyLeave').onclick = () => { Modal.close('rebuyModal'); res('leave'); };
    });
  }
}
