import React from 'react';
import { useStore } from './store.js';
import Lobby from './components/Lobby.jsx';
import Game from './components/Game.jsx';
import Hud from './components/Hud.jsx';

export default function App() {
  const phase = useStore((s) => s.phase);

  if (phase === 'lobby') return <Lobby />;

  if (phase === 'disconnected') {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1 className="logo">
            NITRO<span>RUMBLE</span>
          </h1>
          <p className="tagline">Connection lost.</p>
          <button className="join-btn" onClick={() => window.location.reload()}>
            Rejoin
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-root">
      <Game />
      <Hud />
    </div>
  );
}
