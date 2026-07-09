import React, { useState } from 'react';
import { CAR_COLORS } from '../../shared/config.js';
import { connect } from '../net.js';

export default function Lobby() {
  const [name, setName] = useState(() => localStorage.getItem('nr-name') || '');
  const [color, setColor] = useState(() => localStorage.getItem('nr-color') || CAR_COLORS[0]);
  const [joining, setJoining] = useState(false);

  const join = () => {
    const finalName = name.trim() || 'Racer';
    localStorage.setItem('nr-name', finalName);
    localStorage.setItem('nr-color', color);
    setJoining(true);
    connect(finalName, color);
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="logo">
          NITRO<span>RUMBLE</span>
        </h1>
        <p className="tagline">
          Grab coins. Hit boost pads. Ram rivals to steal their loot. First to 15 wins the round.
        </p>

        <label className="field-label">Driver name</label>
        <input
          className="name-input"
          value={name}
          placeholder="Racer"
          maxLength={16}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !joining && join()}
        />

        <label className="field-label">Paint job</label>
        <div className="swatches">
          {CAR_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${c === color ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`color ${c}`}
            />
          ))}
        </div>

        <button className="join-btn" onClick={join} disabled={joining}>
          {joining ? 'Connecting…' : 'START ENGINE'}
        </button>

        <div className="controls-hint">
          <div>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> / arrows — drive
          </div>
          <div>
            <kbd>Shift</kbd> nitro &nbsp;·&nbsp; <kbd>Space</kbd> drift
          </div>
        </div>
      </div>
    </div>
  );
}
