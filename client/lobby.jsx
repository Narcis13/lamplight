/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · lobby (React)
   Your bankroll, the tables and tournaments, the leaderboard and your
   profile. The App owns the data; this component only renders it and
   calls back.
   ════════════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react';
import { PROFILES, STAKES, SNG, Fmt } from '../shared/engine.js';
import { hueOf } from './view.js';
import { Profile, Leaderboard } from './screens.jsx';

const SPEED_LABEL = { relaxed: 'Relaxed', normal: 'Normal', turbo: 'Turbo', test: 'Test' };
const SKILL_LABEL = { casual: 'Casual bots', regular: 'Regular bots', sharp: 'Sharp bots' };
const usd = v => Fmt.usd(v);

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5v4.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /><path d="M3.5 15a8.5 8.5 0 0 1 17 0z" fill="currentColor" /><path d="M9.5 18a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /></svg>
      <span className="wordmark">Lamplight</span>
    </div>
  );
}

function Wallet({ wallet, onBonus }) {
  const now = useNow(30_000);
  if (!wallet) return <div className="wallet skeleton" aria-hidden="true" />;
  const b = wallet.bonus;
  let label, ready = false, hint = '';
  if (wallet.refill) { label = 'Free chips'; ready = true; hint = 'Your bankroll is empty. Top it back up.'; }
  else if (b.ready) { label = `Claim ${usd(b.amount)}`; ready = true; hint = b.streak ? `Day ${b.streak + 1} of your streak` : 'Your daily bonus is ready'; }
  else {
    const h = Math.max(0, b.at - now), hrs = Math.floor(h / 3600_000), mins = Math.ceil((h % 3600_000) / 60_000);
    label = hrs ? `Bonus in ${hrs}h ${mins}m` : `Bonus in ${mins}m`;
    hint = b.streak ? `${b.streak}-day streak. Come back tomorrow to keep it going` : 'A free bonus every day';
  }
  return (
    <div className="wallet">
      <div className="w-main">
        <span className="w-lbl">Bankroll</span>
        <b className="num">{usd(wallet.bankroll)}</b>
        {wallet.inPlay > 0 && <span className="w-play">+{usd(wallet.inPlay)} on tables</span>}
      </div>
      <button className={`btn small bonus${ready ? ' ready' : ''}`} disabled={!ready} onClick={onBonus} title={hint}>
        <span aria-hidden="true">{ready ? '🎁' : '⏳'}</span> {label}
      </button>
    </div>
  );
}

function SeatPip({ s }) {
  if (s.kind === 'empty') return <span className="pip-seat empty"><span className="av">+</span><span>Open</span></span>;
  const P = s.profileKey ? PROFILES[s.profileKey] : null;
  const hue = P ? P.hue : hueOf(s.name);
  return (
    <span className={`pip-seat ${s.kind}`} title={P ? `${P.name}, ${P.style} bot` : `${s.name}, a player`}>
      <span className="av" style={{ '--hue': hue }} aria-hidden="true">{P ? P.emoji : (s.name[0] || '?').toUpperCase()}</span>
      <span>{s.name}</span>
    </span>
  );
}

function CopyLink({ id }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = `${location.origin}/?t=${id}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { prompt('Share this link', url); }
  };
  return <button className="btn small" onClick={copy} title="Copy a link friends can open">{copied ? 'Copied' : 'Link'}</button>;
}

function TableCard({ t, highlight, onSit, onWatch, bankroll }) {
  const people = t.humans === 1 ? '1 player' : `${t.humans} players`;
  const short = bankroll != null && bankroll < t.buyIn;
  return (
    <div className={`tcard${highlight ? ' highlight' : ''}`}>
      <div>
        <h4>{t.name} <span className="stake-tag">{t.stakes}</span></h4>
        <div className="meta">
          {usd(t.buyIn)} buy-in · {SPEED_LABEL[t.speed] || t.speed} · {SKILL_LABEL[t.skill] || ''} · {people}
          {t.handNo ? ` · hand ${t.handNo}` : ''}
        </div>
      </div>
      <div className="acts2">
        <CopyLink id={t.id} />
        <button className="btn small" onClick={onWatch}>Watch</button>
        <button className="btn primary small" onClick={onSit} disabled={t.open <= 0 || short}
          title={t.open <= 0 ? 'Every seat has a person in it' : short ? `You need ${usd(t.buyIn)} to sit here` : 'A bot gives up its seat for you'}>
          {t.open <= 0 ? 'Full' : 'Sit'}
        </button>
      </div>
      <div className="seats">{t.seats.map((s, i) => <SeatPip key={i} s={s} />)}</div>
    </div>
  );
}

function SngCard({ t, highlight, onSit, onWatch, bankroll }) {
  const now = useNow();
  const tt = t.tourney || {};
  const reg = tt.state === 'registering', run = tt.state === 'running';
  const left = reg && tt.startsAt ? Math.max(0, Math.ceil((tt.startsAt - now) / 1000)) : null;
  const short = bankroll != null && bankroll < t.buyIn;
  const humans = t.seats.filter(s => s.kind === 'human').length;
  return (
    <div className={`tcard sng${highlight ? ' highlight' : ''}${run ? ' live' : ''}`}>
      <div>
        <h4>{t.name} <span className="stake-tag gold">{usd(t.buyIn)}</span></h4>
        <div className="meta">
          {reg && <>Registering · {humans}/6 people{left != null ? ` · starts in ${left}s` : ' · bots fill the rest'} · </>}
          {run && <><span className="live-dot" aria-hidden="true" />Level {tt.level + 1} · {tt.alive} left · </>}
          {tt.state === 'finished' && <>Finished{tt.winner ? `, won by ${tt.winner}` : ''} · </>}
          Prize pool {usd(tt.pool || t.buyIn * 6)} · {SPEED_LABEL[t.speed] || t.speed}
        </div>
      </div>
      <div className="acts2">
        {reg && <CopyLink id={t.id} />}
        <button className="btn small" onClick={onWatch}>Watch</button>
        {reg && <button className="btn primary small" onClick={onSit} disabled={t.open <= 0 || short} title={short ? `You need ${usd(t.buyIn)} to register` : 'Register'}>Register</button>}
      </div>
      <div className="seats">{t.seats.map((s, i) => <SeatPip key={i} s={s} />)}</div>
    </div>
  );
}

function Seg({ value, options, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={String(value === v)} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

function CreateTable({ onCreate, disabled, bankroll }) {
  const [mode, setMode] = useState('cash');
  const [name, setName] = useState('');
  const [speed, setSpeed] = useState('normal');
  const [stakes, setStakes] = useState('micro');
  const [buyInBB, setBuyIn] = useState(100);
  const [fillBots, setFill] = useState(true);
  const [bots, setBots] = useState(0);
  const [skill, setSkill] = useState('regular');
  const [sngBuyIn, setSngBuyIn] = useState(500);
  const cost = mode === 'sng' ? sngBuyIn : STAKES[stakes].bb * buyInBB;
  const short = bankroll != null && bankroll < cost;
  return (
    <form className="panel-card create" onSubmit={e => { e.preventDefault(); onCreate({ mode, name, speed, stakes, buyInBB, fillBots, bots, skill, sngBuyIn }); }}>
      <h2>Open a table</h2>
      <Seg label="Game" value={mode} onChange={setMode} options={[['cash', 'Cash game'], ['sng', 'Sit & Go']]} />
      <h3>Name</h3>
      <div className="field"><input value={name} maxLength={24} placeholder={mode === 'sng' ? 'Friday knockout' : 'Friday night game'} onChange={e => setName(e.target.value)} aria-label="Table name" /></div>
      {mode === 'cash' ? (
        <>
          <h3>Stakes</h3>
          <Seg label="Stakes" value={stakes} onChange={setStakes} options={Object.entries(STAKES).map(([k, v]) => [k, v.label])} />
          <h3>Buy-in</h3>
          <Seg label="Buy-in" value={buyInBB} onChange={setBuyIn} options={[[50, `${usd(STAKES[stakes].bb * 50)}`], [100, `${usd(STAKES[stakes].bb * 100)}`], [200, `${usd(STAKES[stakes].bb * 200)}`]]} />
        </>
      ) : (
        <>
          <h3>Buy-in</h3>
          <Seg label="Buy-in" value={sngBuyIn} onChange={setSngBuyIn} options={SNG.buyIns.map(v => [v, usd(v)])} />
          <p className="form-note">Six players, {SNG.chips.toLocaleString('en-US')} chips each. Blinds rise every few hands. First takes {usd(Math.round(sngBuyIn * 6 * SNG.payouts[0]))}, second {usd(sngBuyIn * 6 - Math.round(sngBuyIn * 6 * SNG.payouts[0]))}.</p>
        </>
      )}
      <h3>Speed</h3>
      <Seg label="Speed" value={speed} onChange={setSpeed} options={[['relaxed', 'Relaxed'], ['normal', 'Normal'], ['turbo', 'Turbo']]} />
      <h3>Bots</h3>
      <Seg label="Bot skill" value={skill} onChange={setSkill} options={[['casual', 'Casual'], ['regular', 'Regular'], ['sharp', 'Sharp']]} />
      {mode === 'cash' && (
        <>
          <div className="setting">
            <div><b>Fill open seats with bots</b><span>Keeps it six-handed. A bot gets up whenever a person sits down.</span></div>
            <button type="button" className="switch" aria-pressed={String(fillBots)} aria-label="Fill open seats with bots" onClick={() => setFill(!fillBots)} />
          </div>
          {!fillBots && (
            <>
              <h3>Bots to start with</h3>
              <Seg label="Bots" value={bots} onChange={setBots} options={[[0, 'None'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]} />
            </>
          )}
        </>
      )}
      <div className="sheet-actions">
        <button className="btn primary" disabled={disabled || short}>{mode === 'sng' ? `Open and register · ${usd(cost)}` : `Open and sit · ${usd(cost)}`}</button>
      </div>
      {short && <p className="form-note neg">Your bankroll can't cover this buy-in.</p>}
    </form>
  );
}

function Tabs({ tab, onTab }) {
  const tabs = [['tables', 'Play'], ['leaderboard', 'Leaderboard'], ['profile', 'Profile']];
  return (
    <nav className="lobby-tabs" role="tablist" aria-label="Lobby">
      {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={String(tab === k)} onClick={() => onTab(k)}>{l}</button>)}
    </nav>
  );
}

export function Lobby({ state, app }) {
  const [name, setName] = useState(app.settings.name || '');
  const commit = () => { if (name.trim() !== (app.settings.name || '')) app.setName(name); };
  const sit = id => { commit(); app.join(id, true); };
  const watch = id => { commit(); app.join(id, false); };
  const host = location.port ? `${location.hostname}:${location.port}` : location.hostname;
  const bankroll = state.wallet ? state.wallet.bankroll : null;
  const cash = state.tables.filter(t => t.mode !== 'sng');
  const order = Object.keys(STAKES);
  cash.sort((a, b) => order.indexOf(a.stakesKey) - order.indexOf(b.stakesKey));
  const sngs = state.tables.filter(t => t.mode === 'sng');
  const rank = t => ({ registering: 0, running: 1, finished: 2 }[t.tourney?.state] ?? 3);
  sngs.sort((a, b) => rank(a) - rank(b));

  return (
    <div className="lobby-inner">
      <header className="lobby-head">
        <Brand />
        <Wallet wallet={state.wallet} onBonus={() => app.claimBonus()} />
        <span className={`conn${state.connected ? '' : ' down'}`}>{state.connected ? 'Connected' : 'Connecting'}</span>
      </header>
      <div className="lobby-bar">
        <div className="field name-field">
          <label htmlFor="lobbyName">Playing as</label>
          <input id="lobbyName" value={name} maxLength={16} autoComplete="off" spellCheck="false" placeholder="Your name"
            onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }} />
        </div>
        <Tabs tab={state.tab} onTab={t => { commit(); app.setTab(t); }} />
      </div>
      {state.error && <div className="err" role="alert">{state.error}</div>}

      {state.tab === 'tables' && (
        <div className="lobby-grid">
          <div className="lobby-col">
            <section className="panel-card" aria-labelledby="sngTitle">
              <div className="sec-head">
                <h2 id="sngTitle">Sit &amp; Go</h2>
                <span className="sec-sub">Six players, rising blinds, top two paid</span>
              </div>
              <div className="tables">
                {sngs.length === 0 && <p className="empty-tables">No tournaments open. Start one on the right.</p>}
                {sngs.map(t => <SngCard key={t.id} t={t} bankroll={bankroll} highlight={t.id === state.highlight} onSit={() => sit(t.id)} onWatch={() => watch(t.id)} />)}
              </div>
            </section>
            <section className="panel-card" aria-labelledby="tablesTitle">
              <div className="sec-head">
                <h2 id="tablesTitle">Cash tables</h2>
                <span className="sec-sub">Sit down with any part of your bankroll, get up whenever you like</span>
              </div>
              <div className="tables">
                {cash.length === 0 && <p className="empty-tables">No tables yet. Open one on the right.</p>}
                {cash.map(t => <TableCard key={t.id} t={t} bankroll={bankroll} highlight={t.id === state.highlight} onSit={() => sit(t.id)} onWatch={() => watch(t.id)} />)}
              </div>
              <p className="hint">
                Playing with friends? They open this same address, <code>{host}</code>, pick a name and sit.
                Use <b>Link</b> to send them straight to a table.
              </p>
            </section>
          </div>
          <CreateTable bankroll={bankroll} disabled={!state.connected} onCreate={opts => { commit(); if (!name.trim()) { app.lobby.error = 'Pick a name first.'; app.renderLobby(); return; } app.createTable(opts); }} />
        </div>
      )}

      {state.tab === 'leaderboard' && (
        <section className="panel-card wide">
          {state.leaderboard
            ? <Leaderboard data={state.leaderboard} myId={state.wallet?.id} onProfile={id => app.openProfile(id)} />
            : <p className="empty-tables">Loading the leaderboard…</p>}
        </section>
      )}

      {state.tab === 'profile' && (
        <section className="panel-card wide">
          {state.profile
            ? <Profile data={state.profile} mine name={state.wallet?.name} onReplay={id => app.openReplay(id)} />
            : <p className="empty-tables">Loading your profile…</p>}
        </section>
      )}
    </div>
  );
}
