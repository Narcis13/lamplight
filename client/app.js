/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · client app
   Keeps a mirror of the server's table, plays the server's events back
   one at a time (so animations never overlap), and sends your actions.
   The client never decides game outcomes; it only draws them.
   ════════════════════════════════════════════════════════════════════ */
import { Fmt, HandEval, Strength, Equity, PROFILES, SPEEDS, Cards, fillMoney, cleanName } from '../shared/engine.js';
import { ACH } from '../shared/achievements.js';
import { $, $$, esc, pct, TableView, SFX, Modal, Drawer } from './view.js';
import { ActionPanel } from './panel.js';
import { Net } from './net.js';

/* ───────────── mirror of the server's state ───────────── */
class SeatMirror {
  constructor(o) { Object.assign(this, o); this.profile = o.profileKey ? PROFILES[o.profileKey] || null : null; }
  get active() { return this.inHand && !this.folded; }
  get canAct() { return this.active && !this.allIn; }
  get net() { return this.stack + this.total - this.buyIns; }
}
class TableMirror {
  constructor() { this.me = null; this.myHole = []; this.pendingSeat = null; this.players = []; this.reserved = []; this.board = []; this.tourney = null; }
  apply(s) {
    if (!s) return;
    const { players, ...rest } = s;
    Object.assign(this, rest);
    this.players = players.map(p => new SeatMirror(p));
    if (this.pendingSeat != null && this.me == null && !this.reserved.some(r => r.seat === this.pendingSeat)) {
      // reservation vanished without a seat (e.g. someone else got there first): back to watching
      if (!this.players.some(p => p.kind === 'human' && p.seat === this.pendingSeat)) this.pendingSeat = null;
    }
  }
  get hero() { return this.me != null ? this.players[this.me] : null; }
  get pot() { return this.players.reduce((s, p) => s + p.total, 0); }
  get collected() { return this.players.reduce((s, p) => s + p.total - p.bet, 0); }
  get isSng() { return this.mode === 'sng'; }
  activeCount() { return this.players.filter(p => p.active).length; }
  get canSit() {
    if (this.isSng && this.tourney && this.tourney.state !== 'registering') return false;
    return this.me == null && this.pendingSeat == null && this.players.filter(p => p.kind !== 'human').length > this.reserved.length;
  }
}

/** Events that happen once and matter: never dropped while we resync, replayed after the snapshot. */
const ONE_OFF = new Set(['youPlaced', 'tourneyOver', 'achievement', 'busted', 'away']);

/* ───────────── settings ───────────── */
const DEFAULTS = {
  fourColor: false, showOdds: true, showTags: true, showHud: true, sound: true, coach: true, chatBubbles: true, celebrate: true,
  theme: 'auto', units: 'usd', name: '', rit: 'ask',
};
const Store = {
  KEY: 'lamplight.settings',
  load() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { s = {}; }
    return Object.assign({}, DEFAULTS, s);
  },
  save(s) { try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } },
};

export class App {
  constructor({ renderLobby, renderOverlay, renderBg }) {
    this.renderLobbyUI = renderLobby;
    this.renderOverlayUI = renderOverlay;
    this.renderBgUI = renderBg;
    this.bg = null; // the backgammon board we're at, if any (poker tables use G and tableId)
    this.settings = Store.load();
    Fmt.units = this.settings.units; Fmt.bb = 2;
    this.sfx = new SFX(this.settings);
    this.view = new TableView(this.sfx);
    this.panel = new ActionPanel(this);
    this.drawer = new Drawer(this);
    this.view.onUpdate = () => this.updateTopbar();
    this.view.onSit = seat => this.net.send({ t: 'sit', seat });
    this.view.onProfile = (id, name) => this.openProfile(id, name);
    this.G = null; this.log = []; this.handIds = new Map();
    this.queue = []; this.pumping = false; this.syncing = false; this.deferred = [];
    this.tableId = null; this.wantSeat = false;
    this.wallet = null;
    this.lobby = {
      tables: [], connected: false, error: '', highlight: null, replaced: false,
      tab: 'tables', profile: null, profileOf: null, leaderboard: null, wallet: null,
    };
    this.overlay = { replay: null, profile: null }; // screens drawn over the table
    this.net = new Net({
      onMessage: m => this.onMessage(m),
      onStatus: up => this.onStatus(up),
      onOpen: () => this.onOpen(),
    });
    this.net.name = this.settings.name || 'Player';

    const q = new URLSearchParams(location.search).get('t');
    if (q) this.lobby.highlight = q;
    this.autoJoin = q && this.settings.name ? q : null;

    this.wire();
    this.applySettings();
    this.showLobby(true);
    this.net.connect();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { document.title = this.baseTitle(); if (this.queue.length > 6) this.resync(); }
    });
    setInterval(() => this.tick(), 1000);
  }

  save() { Store.save(this.settings); }
  baseTitle() {
    if (this.bg && this.bg.s) return `${this.bg.s.name} · Lamplight`;
    return this.G ? `${this.G.name} · Lamplight` : "Lamplight: Hold'em & Backgammon";
  }
  get myId() { return this.wallet ? this.wallet.id : null; }

  /* ───────────── lobby ───────────── */
  showLobby(v) {
    $('#lobby').hidden = !v;
    document.body.classList.toggle('in-lobby', v);
    if (v) { this.renderLobby(); this.refreshLobbyTab(); }
  }
  renderLobby() { this.renderLobbyUI({ ...this.lobby, wallet: this.wallet }, this); }
  renderOverlay() { this.renderOverlayUI(this.overlay, this); }
  setTab(tab) { this.lobby.tab = tab; this.refreshLobbyTab(); this.renderLobby(); }
  refreshLobbyTab() {
    if (this.lobby.tab === 'profile') this.net.send({ t: 'profile' });
    if (this.lobby.tab === 'leaderboard') this.net.send({ t: 'leaderboard' });
  }
  setName(name) {
    this.settings.name = cleanName(name, 16, '');
    this.save();
    this.net.name = this.settings.name || 'Player';
    this.net.send({ t: 'hello', name: this.net.name });
    this.renderLobby();
  }
  claimBonus() { this.net.send({ t: this.wallet && this.wallet.refill ? 'refill' : 'bonus' }); }
  createTable(opts) { this.lobby.error = ''; this.pendingCreateSit = true; this.pendingCreateGame = opts.game || 'poker'; this.net.send({ t: 'create', opts }); }
  /** `game` is known when we just opened the table; otherwise the lobby list says (or the first snapshot will). */
  join(id, sit, game = null) {
    if (!this.settings.name) { this.lobby.error = 'Pick a name first, so the table knows what to call you.'; this.lobby.tab = 'tables'; this.renderLobby(); return; }
    this.lobby.error = '';
    const t = this.lobby.tables.find(x => x.id === id);
    if (game === 'bg' || (!game && t && t.game === 'bg')) this.enterBg(id, sit); else this.enterTable(id, sit);
    this.net.send({ t: 'join', id, sit, name: this.net.name });
  }

  /* ───────────── backgammon ───────────── */
  enterBg(id, sit) {
    this.tableId = null; this.G = null; this.queue = []; this.wantSeat = false;
    this.panel.reset(); this.view.clearCards?.(); this.view.hideMsg();
    this.bg = { id, s: null, me: null, pending: null, wantSeat: sit, log: [], chat: [], chatUnread: false, rollKey: 0, stateAt: 0 };
    const u = new URL(location.href); u.searchParams.set('t', id); history.replaceState(null, '', u);
    document.body.classList.add('in-bg');
    this.showLobby(false);
    this.renderBg();
  }
  bgLeave() {
    this.net.send({ t: 'leave' });
    this.bg = null;
    document.body.classList.remove('in-bg');
    const u = new URL(location.href); u.searchParams.delete('t'); history.replaceState(null, '', u);
    document.title = this.baseTitle();
    this.renderBg();
    this.showLobby(true);
  }
  bgSend(t, extra = {}) { this.net.send({ t, ...extra }); }
  clearChatUnread() { if (this.bg) { this.bg.chatUnread = false; this.renderBg(); } }
  bgSit(seat) {
    if (!this.settings.name) { this.view.toast('Pick a name in the lobby first'); return; }
    this.net.send({ t: 'sit', seat });
  }
  openSettings() { Modal.open('settingsModal'); }
  renderBg() { this.renderBgUI(this.bg, this); }
  /** Messages for the board we're at. Returns false for the ones the rest of the app handles (wallet, profile…). */
  onBg(m) {
    const b = this.bg;
    const mySeat = s => (b.me != null && s.seats[b.me] && s.seats[b.me].kind === 'human' && (!this.myId || s.seats[b.me].id === this.myId) ? b.me : null);
    switch (m.e) {
      case 'bgSnap':
        b.s = m.s; b.me = m.me; b.pending = m.pending; b.log = m.log || []; b.stateAt = Date.now(); b.rollKey++;
        if (b.me != null) b.pending = null;
        document.title = this.baseTitle();
        this.renderBg();
        return true;
      case 'bg': {
        const was = b.s;
        b.s = m.s; b.stateAt = Date.now();
        b.me = mySeat(m.s);
        if (b.pending != null && !m.s.reserved.length && b.me == null && m.s.seats[b.pending] && m.s.seats[b.pending].kind === 'human') b.pending = null;
        if (m.line) this.bgLine(m.line, false);
        if (m.ev) this.bgEvent(m.ev);
        if (m.s.phase === 'roll' && m.s.turn === b.me && b.me != null && (!was || was.phase !== 'roll' || was.turn !== b.me) && m.s.canDouble) {
          this.sfx.turn();
          if (document.hidden) document.title = '● Your roll · Lamplight';
        }
        this.renderBg();
        return true;
      }
      case 'bgLine': this.bgLine(m.line, true); return true;
      case 'pending':
        b.pending = m.seat;
        this.view.toast(m.now === false ? (m.match ? "Seat saved. You're in when this match ends" : "Seat saved. You're in when this game ends") : 'Taking your seat');
        this.renderBg();
        return true;
      case 'bgBusted': this.view.toast(`Out of chips. Rebuy for ${Fmt.usd(m.buyIn)} to keep playing`); return true;
      case 'bgMatchWon': this.celebrate('Match won!', `${Fmt.usd(m.prize)} to your bankroll`, 'big'); return true;
      case 'chat':
        b.chat.push({ name: m.name, text: m.text, bot: !!m.bot });
        if (b.chat.length > 80) b.chat.shift();
        b.chatUnread = true;
        if (m.bot) this.sfx.blip();
        this.renderBg();
        return true;
      case 'toast': this.view.toast(fillMoney(m.msg)); return true;
      case 'error':
        if (m.gone) { this.bgLeave(); this.lobby.error = m.msg; this.renderLobby(); return true; }
        if (b.pending != null && b.me == null) b.pending = null;
        this.view.toast(m.msg);
        this.renderBg();
        return true;
      case 'replaced':
        this.bg = null; document.body.classList.remove('in-bg'); this.renderBg();
        this.lobby.replaced = true;
        this.lobby.error = 'This seat was opened in another tab. Close this one, or reload it to play here instead.';
        this.showLobby(true);
        return true;
      case 'achievement': this.showAchievement(m); return true;
    }
    return false;
  }
  bgLine(line, render) {
    const b = this.bg;
    b.log.push(line);
    if (b.log.length > 120) b.log.shift();
    if (render) this.renderBg();
  }
  /** Sounds for what just happened on the board. */
  bgEvent(ev) {
    const b = this.bg, me = b.me;
    switch (ev.type) {
      case 'opening': case 'roll': b.rollKey++; this.sfx.card(); setTimeout(() => this.sfx.flip(), 90); break;
      case 'move': if (ev.moves && ev.moves.some(x => x.hit)) this.sfx.chips(); else this.sfx.chip(); break;
      case 'undo': this.sfx.chip(); break;
      case 'double': this.sfx.bell(); if (me != null && ev.seat !== me) this.sfx.turn(); break;
      case 'reject': this.view.toast("That move isn't allowed"); break;
      case 'over': {
        const r = ev.result;
        if (me != null && r.winner === me) {
          this.sfx.win();
          if (!r.matchOver && r.mult >= 2 && r.kind !== 'drop' && this.settings.celebrate) this.celebrate(r.mult === 3 ? 'Backgammon!' : 'Gammon!', `${r.points} points`, 'med');
        } else this.sfx.chips();
        break;
      }
    }
  }
  enterTable(id, sit) {
    this.tableId = id; this.wantSeat = sit;
    this.G = new TableMirror();
    this.log = []; this.queue = []; this.deferred = []; this.drawer.chat = []; this.handIds = new Map(); this.placed = null;
    this.view.me = null; this.view.sig = ''; this.view.clearCards?.(); this.view.hideMsg();
    this.panel.reset();
    this.panel.idle('Connecting to the table');
    Modal.close('tourneyModal');
    const u = new URL(location.href); u.searchParams.set('t', id); history.replaceState(null, '', u);
    this.showLobby(false);
  }
  leaveTable() {
    this.net.send({ t: 'leave' });
    this.tableId = null; this.wantSeat = false; this.G = null; this.queue = [];
    this.panel.reset(); Modal.close('rebuyModal'); Modal.close('summaryModal'); Modal.close('tourneyModal');
    this.view.clearCards(); this.view.hideMsg();
    Fmt.cur = '$'; Fmt.bb = 2;
    const u = new URL(location.href); u.searchParams.delete('t'); history.replaceState(null, '', u);
    document.title = this.baseTitle();
    this.showLobby(true);
  }

  /* ───────────── screens over everything ───────────── */
  openReplay(id) { if (id) this.net.send({ t: 'hand', id }); }
  openProfile(id, name = '') {
    if (!id) return;
    if (!name) { // from the leaderboard: find the name there
      const lb = this.lobby.leaderboard;
      const row = lb && [lb.worth, lb.winners, lb.pots, lb.sng].flat().find(r => r && r.id === id);
      name = row ? row.name : '';
    }
    this.overlay.profile = { id, name, data: null, mine: id === this.myId };
    this.renderOverlay();
    this.net.send({ t: 'profile', id });
  }
  closeOverlay(which) { this.overlay[which] = null; this.renderOverlay(); }

  /* ───────────── connection ───────────── */
  onStatus(up) {
    this.lobby.connected = up;
    const c = $('#conn');
    c.classList.toggle('down', !up);
    c.textContent = up ? 'Online' : 'Reconnecting';
    this.renderLobby();
    if (this.bg) this.renderBg();
  }
  onOpen() {
    this.net.send({ t: 'hello', name: this.net.name });
    if (this.bg) {
      const b = this.bg;
      this.net.send({ t: 'join', id: b.id, sit: b.me != null || b.pending != null || b.wantSeat, name: this.net.name });
    } else if (this.tableId) {
      const seated = this.G && (this.G.me != null || this.G.pendingSeat != null);
      this.syncing = true; this.queue = [];
      this.net.send({ t: 'join', id: this.tableId, sit: seated || this.wantSeat, name: this.net.name });
    } else if (this.autoJoin) {
      const id = this.autoJoin; this.autoJoin = null;
      this.join(id, true);
    } else this.refreshLobbyTab();
  }
  resync() { this.deferred.push(...this.queue.filter(m => ONE_OFF.has(m.e))); this.queue = []; this.syncing = true; this.net.send({ t: 'sync' }); }

  onMessage(m) {
    // joined from a link before the lobby said what kind of table it was: it's a backgammon board
    if (m.e === 'bgSnap' && !this.bg && this.tableId && m.s && m.s.id === this.tableId) this.enterBg(m.s.id, this.wantSeat);
    if (this.bg && this.onBg(m)) return;
    switch (m.e) {
      case 'lobby': this.lobby.tables = m.tables; this.renderLobby(); return;
      case 'created':
        this.join(m.id, !!this.pendingCreateSit, this.pendingCreateGame); this.pendingCreateSit = false; return;
      case 'error':
        if (this.tableId && !m.gone) { this.view.toast(m.msg); if (this.G && this.G.pendingSeat != null && this.G.me == null) { this.G.pendingSeat = null; this.panel.refreshMode(this.G); } return; }
        if (m.gone && this.tableId) { this.leaveTable(); }
        this.lobby.error = m.msg; this.renderLobby(); return;
      case 'replaced':
        this.lobby.replaced = true; this.tableId = null; this.G = null;
        this.lobby.error = 'This seat was opened in another tab. Close this one, or reload it to play here instead.';
        this.showLobby(true); return;
      case 'wallet':
        this.wallet = m.wallet; this.renderLobby(); this.updateTopbar(); if (this.bg) this.renderBg(); return;
      case 'bonus':
        this.view.toast(m.refill ? `Topped up with ${Fmt.usd(m.amount)} to get you back in the game` : `Daily bonus: ${Fmt.usd(m.amount)}${m.streak > 1 ? `, day ${m.streak} of your streak` : ''}`);
        this.sfx.win();
        return;
      case 'profile':
        if (this.overlay.profile && this.overlay.profile.id === m.id) { this.overlay.profile = { ...this.overlay.profile, data: m.data, mine: m.mine, loaded: true }; this.renderOverlay(); }
        if (m.mine) { this.lobby.profile = m.data; this.renderLobby(); }
        return;
      case 'leaderboard': this.lobby.leaderboard = m.data; this.renderLobby(); return;
      case 'hand':
        if (!m.data) { this.view.toast('That hand is no longer on file'); return; }
        this.overlay.replay = m.data; this.renderOverlay(); return;
      case 'handSaved': this.handIds.set(m.no, m.id); this.drawer.dirty(); return;
      case 'chat':
        this.drawer.addChat(m.name, m.text, m.bot);
        if (this.G && m.seat != null && this.settings.chatBubbles) this.view.bubble(m.seat, m.text, m.bot);
        if (m.bot) this.sfx.blip();
        return;
      case 'emote': if (this.G) { this.view.emote(m.seat, m.k); this.sfx.pop(); } return;
      case 'blindsUp': this.sfx.bell(); return;
      case 'ritAsk': this.onRitAsk(m); return;
      case 'ritResult': this.panel.hideRit(null); return;
      case 'timeBank': this.panel.startBank(m.ms); return;
      case 'achievement':
        if (!this.G) { this.showAchievement(m); return; }
        break; // queued: shown once the hand's animations are done
    }
    if (!this.tableId) return;
    if (m.e === 'yourTurn' && document.hidden) document.title = '● Your turn · Lamplight';
    if (this.syncing && m.e !== 'snap') { if (ONE_OFF.has(m.e)) this.deferred.push(m); return; }
    this.queue.push(m);
    if (this.queue.length > 60) { this.resync(); return; }
    this.pump();
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    while (this.queue.length) {
      const m = this.queue.shift();
      try { await this.handle(m); } catch (err) { console.error('event failed', m.e, err); }
    }
    this.pumping = false;
  }

  /** Stakes, chip units and currency follow the table: dollars at cash tables, plain chips in tournaments. */
  syncUnits() {
    const G = this.G;
    if (!G || !G.bb) return;
    const cur = G.isSng ? '' : '$';
    if (Fmt.bb !== G.bb || Fmt.cur !== cur) { Fmt.bb = G.bb; Fmt.cur = cur; this.drawer.dirty(); }
  }

  /* ───────────── server events → screen ───────────── */
  async handle(m) {
    const G = this.G, V = this.view, P = this.panel;
    if (!G) return;
    switch (m.e) {
      case 'snap': {
        this.syncing = false;
        G.me = m.me; G.myHole = m.hole || []; G.pendingSeat = m.pendingSeat;
        G.apply(m.s); this.syncUnits();
        V.me = G.me; V.canSit = G.canSit;
        P.cancel();
        this.log = (m.log || []).map(h => ({ no: h.no, lines: h.lines.slice() }));
        if (G.me != null && G.myHole.length === 2 && this.log[0]) this.log[0].lines.splice(1, 0, { html: `Your cards ${Cards.htmlList(G.myHole)}`, cls: '' });
        V.restore(G, G.myHole);
        this.refreshHero(); P.refreshMode(G);
        document.title = this.baseTitle();
        $('#tableName').textContent = G.name;
        if (m.prompt) { this.startPrompt(m.prompt); if (m.prompt.banking) P.startBank(m.prompt.ms); }
        if (m.rit) this.onRitAsk(m.rit);
        this.drawer.dirty();
        if (this.deferred.length) this.queue.push(...this.deferred.splice(0));
        this.checkPlaced();
        return;
      }
      case 'state':
        G.apply(m.s); this.syncUnits(); V.canSit = G.canSit; V.updateTable(G); P.sync(G);
        this.checkPlaced();
        if (m.why === 'seats') this.refreshHero();
        return;
      case 'newHand':
        G.apply(m.s); G.myHole = []; this.syncUnits();
        V.canSit = G.canSit;
        await V.newHand(G);
        P.newHand(G); this.refreshHero();
        return;
      case 'dealHole':
        if (m.c != null && m.seat === G.me) G.myHole.push(m.c);
        V.dealHole(m.seat, m.round, m.c); this.sfx.card();
        return;
      case 'dealt':
        G.apply(m.s);
        await V.revealMine();
        if (G.me != null && G.myHole.length === 2) this.logLine(G.handNo, { html: `Your cards ${Cards.htmlList(G.myHole)}`, cls: '' }, 1);
        V.updateTable(G); this.refreshHero(); P.sync(G);
        return;
      case 'board':
        G.apply(m.s); P.newStreet(G);
        await V.dealBoard(m.cards, m.start, SPEEDS[G.speed] || SPEEDS.normal, m.run || 1);
        this.refreshHero();
        return;
      case 'active': V.setActive(m.seat); return;
      case 'thinking': V.setThinking(m.seat, m.ms, m.bank); return;
      case 'rit': G.apply(m.s); V.runTwice(m.board); this.sfx.flip(); return;
      case 'action':
        G.apply(m.s);
        if (m.seat === G.me && P.prompting) P.cancel();
        V.showAction(m.seat, m.res); this.sfx.forAction(m.res);
        V.updateTable(G); P.sync(G);
        this.refreshHero();
        return;
      case 'collect':
        this.sfx.chips();
        await V.collectBets(m.bets);
        return;
      case 'endStreet': G.apply(m.s); V.endStreet(G); V.updateTable(G); return;
      case 'reveal': V.reveal(m.seat, m.hole); this.sfx.flip(); if (G.players[m.seat]) G.players[m.seat].shown = m.hole; P.refreshMode(G); return;
      case 'equity': V.showEquity(m.list); this.refreshHero(); return;
      case 'highlight': V.highlight(m.winners, m.best, G, m.run || 1); this.lastWin = { winners: m.winners, best: m.best, run: m.run || 1 }; return;
      case 'award': {
        const mine = m.awards.find(a => a.seat === G.me);
        if (mine) this.sfx.win(); else this.sfx.chips();
        await V.award(m.awards);
        if (mine) this.maybeCelebrate(mine.amount);
        return;
      }
      case 'message': V.message(fillMoney(m.title), fillMoney(m.sub), m.sticky); return;
      case 'toast': V.toast(fillMoney(m.msg)); return;
      case 'logStart':
        this.log.unshift({ no: m.no, lines: [] });
        if (this.log.length > 40) this.log.pop();
        this.lastWin = null;
        this.drawer.dirty();
        return;
      case 'log': this.logLine(m.no, { html: m.html, cls: m.cls }); return;
      case 'handOver':
        G.apply(m.s); V.setActive(null); V.updateTable(G); P.handOver(G); this.updateTopbar();
        return;
      case 'yourTurn': this.startPrompt(m); return;
      case 'turnOver': if (P.prompting) P.cancel(); P.sync(G); return;
      case 'pending':
        G.pendingSeat = m.seat; V.canSit = false; V.updateTable(G); P.refreshMode(G);
        V.toast(G.isSng ? "You're registered. Good luck" : m.now ? 'Taking your seat' : "Seat saved. You're dealt in next hand");
        return;
      case 'busted': {
        const choice = await P.askRebuy(m.buyIn, G.bb);
        if (choice === 'rebuy') this.net.send({ t: 'rebuy' });
        else if (choice === 'leave') this.leaveTable();
        this.syncIdleButtons();
        return;
      }
      case 'away': V.toast("You missed two turns, so we've sat you out"); P.refreshMode(G); return;
      case 'achievement': this.showAchievement(m); return;
      case 'tourneyStart':
        G.apply(m.s); this.syncUnits(); V.restore(G, G.myHole); P.refreshMode(G); this.refreshHero();
        V.message('Shuffle up and deal', `${G.players.filter(p => p.kind !== 'empty').length} players, ${Fmt.money(1500)} chips each`);
        this.sfx.bell();
        return;
      case 'eliminated': V.bust(m.seat); return;
      case 'youPlaced':
        this.placed = m;
        if (m.place === 1) this.celebrate('Champion!', `You won the tournament and ${Fmt.usd(m.prize)}`, 'big');
        else if (!m.final) this.showTourneyResult(null);
        return;
      case 'tourneyOver': this.showTourneyResult(m.results); return;
    }
  }

  logLine(no, line, at = -1) {
    const h = this.log.find(x => x.no === no);
    if (!h) return;
    if (at >= 0) h.lines.splice(at, 0, line); else h.lines.push(line);
    this.drawer.dirty();
  }

  startPrompt(m) {
    const G = this.G, P = this.panel;
    if (!G.hero) return;
    const pre = P.takePreaction(m.L);
    if (pre) { setTimeout(() => this.net.send({ t: 'act', id: m.id, a: pre }), (SPEEDS[G.speed] || SPEEDS.normal).pre); return; }
    this.sfx.turn();
    P.prompt(m.L, G, m.ms, m.bank || 0).then(a => { if (a) this.net.send({ t: 'act', id: m.id, a }); document.title = this.baseTitle(); });
  }

  /** Everyone is all in: do we run it twice? Your standing preference answers for you, or we ask. */
  onRitAsk(m) {
    const pref = this.settings.rit;
    const reply = yes => this.net.send({ t: 'rit', id: m.id, yes });
    if (pref === 'always') { reply(true); this.view.toast('You chose to run it twice'); return; }
    if (pref === 'never') { reply(false); return; }
    this.sfx.turn();
    this.panel.askRit(m.ms).then(ans => { if (ans != null) reply(ans); });
  }

  /* ───────────── wins worth a fuss ───────────── */
  maybeCelebrate(amount) {
    const G = this.G, h = G.hero;
    if (!h || !this.settings.celebrate) return;
    const lw = this.lastWin;
    let cat = -1;
    const board = lw && lw.run === 2 && G.board2 ? G.board2 : G.board;
    if (lw && lw.winners.includes(G.me) && board.length === 5 && G.myHole.length === 2) cat = HandEval.category(HandEval.score(G.myHole.concat(board)));
    const names = { 6: 'Full house!', 7: 'Four of a kind!', 8: 'Straight flush!' };
    const royal = cat === 8 && HandEval.describe(HandEval.score(G.myHole.concat(board))) === 'Royal flush';
    if (royal) this.celebrate('Royal flush!', `You take ${Fmt.money(amount)}`, 'big');
    else if (cat >= 6) this.celebrate(names[cat], `You take ${Fmt.money(amount)}`, cat >= 7 ? 'big' : 'med');
    else if (amount >= 60 * G.bb) this.celebrate('Monster pot', `${Fmt.money(amount)} is yours`, 'med');
  }
  celebrate(title, sub, size = 'med') {
    if (!this.settings.celebrate) return;
    this.view.celebrate(title, sub, size);
    this.sfx.fanfare();
  }
  showAchievement(m) {
    const a = ACH[m.key];
    if (!a) return;
    const mine = m.pid && m.pid === this.myId;
    if (mine) {
      this.view.achievement(a);
      this.sfx.fanfare();
      if (this.lobby.tab === 'profile') this.net.send({ t: 'profile' });
    } else if (m.name) this.view.toast(`${m.name} unlocked ${a.icon} ${a.title}`);
  }

  /* ───────────── tournaments ───────────── */
  showTourneyResult(results) {
    const G = this.G, t = G && G.tourney, me = this.placed;
    const list = results || (t && t.results) || [];
    const medal = p => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : `${p}th`);
    $('#tourneyTitle').textContent = results ? 'Final standings' : me ? `You finished ${ordinal(me.place)}` : 'Tournament';
    $('#tourneyLede').textContent = me
      ? me.prize > 0 ? `${Fmt.usd(me.prize)} goes to your bankroll.` : results ? 'No cash this time. The next one is already open in the lobby.' : 'Out of chips. Stay and watch the rest, or head back to the lobby.'
      : 'Here is how it went.';
    $('#tourneyList').innerHTML = list.slice().sort((a, b) => a.place - b.place).map(r => {
      const P = r.profile ? PROFILES[r.profile] : null;
      return `<li class="${me && r.name === this.net.name && r.kind === 'human' ? 'me' : ''}"><span class="plc">${medal(r.place)}</span>
        <span class="who">${P ? P.emoji + ' ' : ''}${esc(r.name)}</span><span class="num prize">${r.prize ? Fmt.usd(r.prize) : ''}</span></li>`;
    }).join('') || '<li class="muted">Standings appear as players are knocked out.</li>';
    $('#tourneyAgain').hidden = !results;
    Modal.open('tourneyModal');
  }
  /** Safety net: if the tournament standings list me but I never saw my placing, show it now. */
  checkPlaced() {
    const t = this.G && this.G.tourney;
    if (!t || !this.myId || this.placed) return;
    const r = t.results.find(x => x.id === this.myId);
    if (!r) return;
    this.placed = { place: r.place, prize: r.prize, final: t.state === 'finished' };
    if (t.state !== 'finished') this.showTourneyResult(null);
  }
  playAgain() {
    const G = this.G;
    Modal.close('tourneyModal');
    const buyIn = G && G.tourney ? G.tourney.buyIn : 500;
    const speed = G ? G.speed : 'turbo';
    this.leaveTable();
    this.createTable({ mode: 'sng', sngBuyIn: buyIn, speed, name: '' });
  }

  /* ───────────── your hand, odds ───────────── */
  refreshHero() {
    const G = this.G, P = this.panel;
    if (!G) return;
    const h = G.hero;
    if (!h) {
      P.info({ state: 'out', title: G.pendingSeat != null ? (G.isSng ? 'Registered' : 'Seat saved') : 'Watching', sub: G.name ? (G.isSng ? G.name : `${G.name}, ${G.stakes} blinds`) : '' });
      return;
    }
    if (!h.inHand || G.myHole.length < 2) { P.info({ state: 'out', title: h.stack === 0 ? 'Out of chips' : 'Waiting for the deal' }); return; }
    const name = this.handName();
    if (h.folded) { P.info({ state: 'folded', name }); return; }
    const opp = G.activeCount() - 1;
    const street = G.street;
    const live = G.players.filter(p => p.active);
    const hands = live.map(p => (p.seat === G.me ? G.myHole : p.shown));
    if (G.runout && hands.every(x => x && x.length === 2)) {
      const eq = this.settings.showOdds ? Equity.known(hands, G.board)[live.findIndex(p => p.seat === G.me)] : null;
      P.info({ state: 'live', name, street, opp, eq, known: true });
      return;
    }
    const eq = this.settings.showOdds && opp > 0 ? Equity.vsRandom(G.myHole, G.board, opp, 1600) : null;
    const toCall = Math.min(Math.max(0, G.currentBet - h.bet), h.stack);
    const need = this.settings.coach && toCall > 0 && !['done', 'showdown'].includes(street) ? toCall / (G.pot + toCall) : null;
    P.info({ state: 'live', name, street, opp, eq, need, toCall });
  }
  handName() {
    const G = this.G, hole = G.myHole;
    if (hole.length < 2) return '';
    if (G.board.length < 3) return Strength.preflopName(hole[0], hole[1]);
    return HandEval.describe(HandEval.score(hole.concat(G.board)));
  }

  /* ───────────── chrome ───────────── */
  wire() {
    $('#unitsBtn').onclick = () => this.toggleUnits();
    $('#logBtn').onclick = () => this.drawer.toggle('log');
    $('#statsBtn').onclick = () => (this.drawer.isOpen && this.drawer.tab === 'stats' ? this.drawer.close() : this.drawer.open('stats'));
    $('#settingsBtn').onclick = () => Modal.open('settingsModal');
    $('#leaveBtn').onclick = () => { if (this.G && this.G.hero) this.openSummary(); else if (this.tableId) this.leaveTable(); else this.showLobby(true); };
    $('#summaryKeep').onclick = () => Modal.close('summaryModal');
    $('#summaryNew').onclick = () => { Modal.close('summaryModal'); this.leaveTable(); };
    $('#tourneyWatch').onclick = () => Modal.close('tourneyModal');
    $('#tourneyLobby').onclick = () => { Modal.close('tourneyModal'); this.leaveTable(); };
    $('#tourneyAgain').onclick = () => this.playAgain();
    $('#sitBtn').onclick = () => {
      const h = this.G && this.G.hero;
      if (h && h.stack === 0 && !this.G.isSng) this.net.send({ t: 'rebuy' });
      else this.net.send({ t: 'sit' });
    };
    $('#backBtn').onclick = () => this.net.send({ t: 'back' });
    $('#sitOutBtn').onclick = () => this.net.send({ t: 'sitOut' });
    $('#startBtn').onclick = () => this.net.send({ t: 'start' });
    $('#showBtn').onclick = () => { this.net.send({ t: 'show' }); $('#showBtn').hidden = true; };
    $('#emoteBtn').onclick = e => { e.stopPropagation(); $('#emotes').classList.toggle('open'); };
    $('#emotes').onclick = e => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      this.net.send({ t: 'emote', k: b.dataset.k });
      $('#emotes').classList.remove('open');
    };
    document.addEventListener('click', e => { if (!e.target.closest('#emotes, #emoteBtn')) $('#emotes').classList.remove('open'); });
    $('#walletChip').onclick = () => { if (this.tableId) return; this.setTab('profile'); };

    $$('#settingsModal .seg').forEach(seg => (seg.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      this.settings[seg.dataset.setting] = b.dataset.v; this.save(); this.applySettings();
    }));
    $$('#settingsModal .switch').forEach(sw => (sw.onclick = () => {
      const k = sw.dataset.setting;
      this.settings[k] = !this.settings[k]; this.save(); this.applySettings();
      if (k === 'showOdds' || k === 'coach') this.refreshHero();
      if (k === 'sound' && this.settings.sound) { this.sfx.init(); setTimeout(() => this.sfx.chip(), 30); }
    }));
    $$('[data-close]').forEach(b => (b.onclick = () => Modal.close(b.closest('.modal').id)));
    document.addEventListener('keydown', e => this.onKey(e));
  }

  /** The buttons under the idle message: sit in, rebuy, start, show, I'm back, sit out. */
  syncIdleButtons() {
    const G = this.G, h = G && G.hero;
    const sit = $('#sitBtn'), back = $('#backBtn'), out = $('#sitOutBtn'), start = $('#startBtn'), show = $('#showBtn');
    const sng = G && G.isSng, reg = sng && G.tourney && G.tourney.state === 'registering';
    const busted = !!(h && h.stack === 0 && !h.inHand && !sng);
    sit.hidden = !(G && ((!h && G.canSit) || busted));
    sit.textContent = busted ? 'Rebuy' : sng ? `Register · ${Fmt.usd(G.tourney.buyIn)}` : 'Sit in';
    back.hidden = !(h && h.away);
    out.hidden = !(h && !h.away && !busted && !reg);
    start.hidden = !(reg && h);
    const between = G && (G.street === 'done' || G.street === 'showdown');
    show.hidden = !(h && between && h.inHand && !h.shown && G.myHole.length === 2);
    $('#emoteBtn').hidden = !h;
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
    const u = $('#unitsBtn');
    u.setAttribute('aria-pressed', String(s.units === 'bb'));
    u.title = s.units === 'bb' ? 'Showing big blinds. Switch to chips' : 'Showing chips. Switch to big blinds';
  }

  toggleUnits() {
    this.settings.units = this.settings.units === 'bb' ? 'usd' : 'bb';
    this.save(); this.applySettings();
    if (this.G) { this.view.updateTable(this.G); this.panel.refreshUnits(); }
    this.drawer.render();
  }

  /** Once a second: tournament countdowns in the top bar. */
  tick() { if (this.G && this.G.isSng) this.updateTopbar(); }

  updateTopbar() {
    const w = this.wallet, chip = $('#walletChip');
    if (w) { chip.hidden = false; chip.querySelector('b').textContent = Fmt.usd(w.bankroll); chip.title = `Bankroll ${Fmt.usd(w.bankroll)}${w.inPlay ? `, plus ${Fmt.usd(w.inPlay)} on tables` : ''}`; }
    const G = this.G;
    if (!G) return;
    $('#handNo').textContent = G.handNo;
    const stakes = $('#tiStakes');
    const t = G.tourney;
    stakes.classList.toggle('sng', !!G.isSng);
    if (G.isSng && t) {
      if (t.state === 'registering') {
        const left = t.startsAt ? Math.max(0, Math.ceil((t.startsAt - Date.now()) / 1000)) : null;
        stakes.innerHTML = `Sit &amp; Go <b>${Fmt.usd(t.buyIn)}</b><span class="x"> · prize pool <b>${Fmt.usd(t.pool)}</b></span>${left != null ? ` · starts in <b>${left}s</b>` : ''}`;
      } else if (t.state === 'running') {
        stakes.innerHTML = `Level <b>${t.level}</b> · <b>${G.sb}/${G.bb}</b><span class="x"> · next <b>${t.next[0]}/${t.next[1]}</b> in ${t.nextIn} ${t.nextIn === 1 ? 'hand' : 'hands'}</span> · <b>${t.alive}</b> left`;
      } else stakes.innerHTML = 'Tournament over';
    } else stakes.innerHTML = `Blinds <b>${esc(G.stakes || '')}</b>`;
    const h = G.hero, b = $('#sessionNet');
    $('#sessionLbl').textContent = G.isSng ? 'Chips' : 'Session';
    if (h) {
      const net = G.isSng ? h.stack + h.total : h.net;
      b.textContent = G.isSng ? Fmt.money(net) : Fmt.signed(net) || Fmt.money(0);
      b.className = G.isSng ? '' : net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    } else { b.textContent = '—'; b.className = ''; }
    this.syncIdleButtons();
    if (this.drawer.isOpen && this.drawer.tab === 'stats') this.drawer.dirty();
  }

  openSummary() {
    const G = this.G, h = G.hero, st = h.stats, net = h.net;
    if (G.isSng) {
      const running = G.tourney && G.tourney.state === 'running';
      $('#summaryTitle').textContent = running ? 'Leave the tournament?' : 'Leave the table?';
      $('#summaryLede').textContent = running
        ? "You'll stay registered: your stack keeps posting blinds and folding until you come back or bust. Prizes still count."
        : 'Your registration is cancelled and the buy-in goes back to your bankroll.';
    } else {
      $('#summaryTitle').textContent = 'Leaving already?';
      $('#summaryLede').textContent = `Here's where your session at ${G.name} stands. Your stack goes back to your bankroll. If you leave mid-hand your cards are folded.`;
    }
    const buyIns = Math.round(h.buyIns / G.buyIn);
    $('#summaryGrid').innerHTML = `
      <div><b class="num ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${Fmt.signed(net) || Fmt.money(0)}</b><span>Net result</span></div>
      <div><b class="num">${st.hands}</b><span>Hands played</span></div>
      <div><b class="num">${Fmt.money(st.biggest)}</b><span>Biggest pot you won</span></div>
      <div><b class="num">${pct(st.vpip, st.hands)}% / ${pct(st.pfr, st.hands)}%</b><span>VPIP / PFR</span></div>
      <div><b class="num">${st.won}</b><span>Pots won</span></div>
      <div><b class="num">${G.isSng ? Fmt.money(h.stack) : buyIns}</b><span>${G.isSng ? 'Chips' : buyIns === 1 ? 'Buy-in used' : 'Buy-ins used'}</span></div>`;
    Modal.open('summaryModal');
  }

  onKey(e) {
    if (e.key === 'Escape') {
      if (this.overlay.replay || this.overlay.profile) return; // the screen handles its own Escape
      for (const id of ['settingsModal', 'summaryModal', 'tourneyModal']) if (Modal.isOpen(id)) { Modal.close(id); return; }
      if (this.drawer.isOpen) this.drawer.close();
      return;
    }
    if (!$('#lobby').hidden || Modal.isOpen() || this.overlay.replay || this.overlay.profile || e.metaKey || e.ctrlKey || e.altKey) return;
    const P = this.panel, t = e.target;
    const typing = t.matches && t.matches('input:not([type="range"]), textarea');
    const onControl = t.matches && t.matches('button, input');
    if (typing || !P.prompting) return;
    const k = e.key.toLowerCase();
    if (k === 'f') { e.preventDefault(); P.act('fold'); }
    else if (k === 'c' || k === 'k' || (k === ' ' && !onControl)) { e.preventDefault(); P.act('call'); }
    else if (k === 'r' || (k === 'enter' && !onControl)) { e.preventDefault(); P.act('raise'); }
    else if ((k === 'arrowup' || k === 'arrowright') && t !== P.slider) { e.preventDefault(); P.nudge(1); }
    else if ((k === 'arrowdown' || k === 'arrowleft') && t !== P.slider) { e.preventDefault(); P.nudge(-1); }
    else if (k >= '1' && k <= '5') { e.preventDefault(); P.preset(+k - 1); }
  }
}

const ordinal = n => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n] || 'th');

export { esc };
