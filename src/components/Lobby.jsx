import React, { useState } from 'react';
import { CAR_COLORS, CAR_TYPES } from '../../shared/config.js';
import { connect } from '../net.js';
import { initAudio } from '../sound.js';
import { useStore } from '../store.js';

function StatBar({ label, value }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <div className="stat-bar">
        <div className="stat-fill" style={{ width: `${Math.min(100, (value / 1.4) * 100)}%` }} />
      </div>
    </div>
  );
}

function Garage({ color }) {
  const wallet = useStore((s) => s.wallet);
  const ownedCars = useStore((s) => s.ownedCars);
  const carType = useStore((s) => s.carType);
  const buyCar = useStore((s) => s.buyCar);
  const selectCar = useStore((s) => s.selectCar);

  return (
    <div className="garage">
      <div className="garage-head">
        <label className="field-label">Garage</label>
        <span className="wallet-chip">🪙 {wallet}</span>
      </div>
      <div className="car-cards">
        {Object.entries(CAR_TYPES).map(([id, t]) => {
          const isOwned = ownedCars.includes(id);
          const selected = carType === id;
          const affordable = wallet >= t.price;
          return (
            <div key={id} className={`car-card ${selected ? 'selected' : ''}`}>
              <div className="car-topline">
                <span className="car-name">{t.name}</span>
                {!isOwned && <span className="car-price">🪙 {t.price}</span>}
              </div>
              <div className="car-preview" style={{ color }}>
                <CarSilhouette shape={t.shape} color={color} />
              </div>
              <StatBar label="SPD" value={t.stats.speed} />
              <StatBar label="ACC" value={t.stats.accel} />
              <StatBar label="GRP" value={t.stats.grip} />
              {isOwned ? (
                <button
                  className={`car-btn ${selected ? 'active' : ''}`}
                  onClick={() => selectCar(id)}
                  disabled={selected}
                >
                  {selected ? 'SELECTED' : 'SELECT'}
                </button>
              ) : (
                <button className="car-btn buy" onClick={() => buyCar(id)} disabled={!affordable}>
                  {affordable ? 'BUY' : 'TOO PRICEY'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="garage-hint">Earn 🪙 in every minigame — wins pay +25, crystals in the world +2.</div>
    </div>
  );
}

// tiny CSS-free side-view silhouette so each card reads differently
function CarSilhouette({ shape, color }) {
  const [, bh, bl] = shape.body;
  const w = 110;
  const scale = w / (bl + 1.2);
  const wheelR = shape.wheelR * scale * 1.15;
  const bodyH = Math.max(10, bh * scale * 1.35);
  const ride = (shape.ride || 0) * scale;
  const base = 40;
  return (
    <svg width={w} height={52} viewBox={`0 0 ${w} 52`}>
      <rect
        x={6}
        y={base - bodyH - wheelR - ride}
        width={w - 12}
        height={bodyH}
        rx={4}
        fill={color}
      />
      <rect
        x={w * 0.3}
        y={base - bodyH - wheelR - ride - 7}
        width={w * (shape.cabinW / 5)}
        height={9}
        rx={3}
        fill="#101426"
      />
      {(shape.spoiler || shape.wing) && (
        <rect x={8} y={base - bodyH - wheelR - ride - (shape.wing ? 12 : 6)} width={14} height={4} fill={shape.wing ? '#101426' : color} />
      )}
      <circle cx={24} cy={base - wheelR / 2} r={wheelR} fill="#15161c" />
      <circle cx={w - 24} cy={base - wheelR / 2} r={wheelR} fill="#15161c" />
    </svg>
  );
}

export default function Lobby() {
  const [name, setName] = useState(() => localStorage.getItem('nr-name') || '');
  const [color, setColor] = useState(() => localStorage.getItem('nr-color') || CAR_COLORS[0]);
  const [joining, setJoining] = useState(false);

  const join = () => {
    const finalName = name.trim() || 'Racer';
    localStorage.setItem('nr-name', finalName);
    localStorage.setItem('nr-color', color);
    setJoining(true);
    initAudio(); // WebAudio needs a user gesture — this click is it
    connect(finalName, color, useStore.getState().carType);
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="logo">
          NITRO<span>RUMBLE</span>
        </h1>
        <p className="tagline">
          Explore an endless procedurally generated world, then drive into a portal: Coin Rush,
          Infection, Crown Keeper, or the Grand Prix — solo against bots or with friends.
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

        <Garage color={color} />

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
            <kbd>Shift</kbd> nitro &nbsp;·&nbsp; <kbd>Space</kbd> drift &nbsp;·&nbsp; <kbd>1</kbd>–
            <kbd>4</kbd>/<kbd>0</kbd> quick travel
          </div>
        </div>
      </div>
    </div>
  );
}
