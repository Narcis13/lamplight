import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { Lobby } from './lobby.jsx';
import { Profile } from './screens.jsx';
import { Replayer } from './replay.jsx';

/** Screens drawn over the table or the lobby: a hand replay, someone's profile. */
function Overlay({ state, app }) {
  const { replay, profile } = state;
  useEffect(() => {
    if (!profile || replay) return;
    const onKey = e => { if (e.key === 'Escape') app.closeOverlay('profile'); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [profile, replay]);
  return (
    <>
      {profile && (
        <div className="modal open ov-profile" role="dialog" aria-modal="true" aria-label="Player profile" onClick={e => { if (e.target === e.currentTarget) app.closeOverlay('profile'); }}>
          <div className="sheet wide">
            <button className="tool close ov-close" aria-label="Close" onClick={() => app.closeOverlay('profile')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            {profile.data
              ? <Profile data={profile.data} mine={profile.mine} name={profile.name} onReplay={id => app.openReplay(id)} />
              : profile.data === null && profile.loaded ? <p className="empty-tables">No profile on file.</p> : <p className="empty-tables">Loading…</p>}
          </div>
        </div>
      )}
      {replay && <Replayer hand={replay} onClose={() => app.closeOverlay('replay')} />}
    </>
  );
}

const lobbyRoot = createRoot(document.getElementById('lobby'));
const overlayRoot = createRoot(document.getElementById('overlay'));
window.lamplight = new App({
  renderLobby: (state, app) => lobbyRoot.render(<Lobby state={{ ...state }} app={app} />),
  renderOverlay: (state, app) => overlayRoot.render(<Overlay state={{ ...state }} app={app} />),
});
