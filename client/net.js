/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · connection
   One WebSocket to /ws, reconnecting with backoff. The token lives in
   sessionStorage: a page refresh keeps your seat, while a second tab is
   a second seat. Your account (bankroll, stats, hand history) is a
   secret key in localStorage, the same in every tab. A private window
   is a different account, handy for trying multiplayer on one machine.
   ════════════════════════════════════════════════════════════════════ */
const TOKEN_KEY = 'lamplight.token';
const ACCOUNT_KEY = 'lamplight.account';

const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));

function account() {
  let k = null;
  try { k = localStorage.getItem(ACCOUNT_KEY); } catch { /* storage blocked */ }
  if (!k || !/^[A-Za-z0-9-]{16,64}$/.test(k)) {
    k = randomId();
    try { localStorage.setItem(ACCOUNT_KEY, k); } catch { /* storage blocked: a new account each visit */ }
  }
  return k;
}

function token() {
  let t = null;
  try { t = sessionStorage.getItem(TOKEN_KEY); } catch { /* storage blocked */ }
  if (!t || !/^[A-Za-z0-9-]{16,64}$/.test(t)) {
    t = randomId();
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* storage blocked */ }
  }
  return t;
}

export class Net {
  constructor({ onMessage, onStatus, onOpen }) {
    this.onMessage = onMessage; this.onStatus = onStatus; this.onOpen = onOpen;
    this.token = token();
    this.key = account();
    this.name = 'Player';
    this.ws = null; this.up = false; this.retry = 0; this.stopped = false;
    this.outbox = [];
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}&key=${encodeURIComponent(this.key)}&name=${encodeURIComponent(this.name)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.up = true; this.retry = 0; this.onStatus(true);
      this.onOpen();
      for (const m of this.outbox.splice(0)) ws.send(m);
    };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.onMessage(m); };
    ws.onclose = ev => {
      if (this.ws !== ws) return;
      this.up = false; this.onStatus(false);
      if (ev.code === 4000 || this.stopped) { this.stopped = true; return; } // this seat was opened in another tab
      const delay = Math.min(8000, 400 * 2 ** this.retry++) + Math.random() * 300;
      setTimeout(() => this.connect(), delay);
    };
  }
  send(obj) {
    const s = JSON.stringify(obj);
    if (this.up && this.ws.readyState === 1) this.ws.send(s);
    else if (obj.t !== 'act') this.outbox.push(s); // a stale action is worse than none
  }
}
