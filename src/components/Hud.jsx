import React, { useEffect, useRef } from 'react';
import { useStore } from '../store.js';
import { localState, remoteStates } from '../net.js';
import { ARENA_HALF, OBSTACLES, MODES, RACE_GATES } from '../../shared/config.js';

function Minimap() {
  const canvasRef = useRef(null);

  useEffect(() => {
    let raf;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const S = canvas.width;
      const toMap = (x, z) => [((x + ARENA_HALF) / (ARENA_HALF * 2)) * S, ((z + ARENA_HALF) / (ARENA_HALF * 2)) * S];

      ctx.clearRect(0, 0, S, S);
      ctx.fillStyle = 'rgba(10, 14, 34, 0.75)';
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = 'rgba(63, 215, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, S - 2, S - 2);

      // pillars
      ctx.fillStyle = 'rgba(90, 110, 190, 0.6)';
      for (const o of OBSTACLES) {
        const [x, y] = toMap(o.x, o.z);
        ctx.beginPath();
        ctx.arc(x, y, (o.r / (ARENA_HALF * 2)) * S, 0, Math.PI * 2);
        ctx.fill();
      }

      const { coins, players, myId, mode, crown } = useStore.getState();

      // coins
      ctx.fillStyle = '#ffd23f';
      for (const c of coins) {
        const [x, y] = toMap(c.x, c.z);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }

      // race gates
      if (mode === 'race') {
        ctx.strokeStyle = '#8a5cf6';
        for (const g of RACE_GATES) {
          const [x, y] = toMap(g.x, g.z);
          ctx.strokeRect(x - 3, y - 3, 6, 6);
        }
      }

      // loose crown
      if (mode === 'crown' && !crown.holder) {
        const [x, y] = toMap(crown.x, crown.z);
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // other players
      for (const [id, s] of remoteStates) {
        const info = players[id];
        if (!info) continue;
        const [x, y] = toMap(s.p[0], s.p[2]);
        ctx.fillStyle = info.color;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // me: triangle pointing along yaw
      const me = players[myId];
      if (me) {
        const [x, y] = toMap(localState.p[0], localState.p[2]);
        ctx.save();
        ctx.translate(x, y);
        // world forward is (sin yaw, cos yaw) in (x, z); map y is world z
        ctx.rotate(Math.PI - localState.yaw);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4.5, 5);
        ctx.lineTo(-4.5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="minimap" width={150} height={150} />;
}

const SCOREBOARD_TITLES = {
  coins: `FIRST TO ${MODES.coins.winScore} 🪙`,
  tag: 'SURVIVE THE INFECTED 🧟',
  crown: `FIRST TO ${MODES.crown.winScore} 👑`,
  race: `${MODES.race.laps} LAPS · ${RACE_GATES.length} GATES 🏁`,
};

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function Hud() {
  const players = useStore((s) => s.players);
  const scores = useStore((s) => s.scores);
  const myId = useStore((s) => s.myId);
  const mode = useStore((s) => s.mode);
  const infected = useStore((s) => s.infected);
  const timeLeft = useStore((s) => s.timeLeft);
  const banner = useStore((s) => s.banner);
  const winner = useStore((s) => s.winner);
  const feed = useStore((s) => s.feed);
  const hudSpeed = useStore((s) => s.hudSpeed);
  const hudNitro = useStore((s) => s.hudNitro);

  const ranked = Object.values(players)
    .map((p) => ({ ...p, score: scores[p.id] || 0, sick: infected.includes(p.id) }))
    .sort((a, b) => (mode === 'tag' ? Number(a.sick) - Number(b.sick) : b.score - a.score));

  const scoreCell = (p) => {
    if (mode === 'tag') return p.sick ? '🧟' : '🏃';
    if (mode === 'race') {
      const lap = Math.floor(p.score / RACE_GATES.length) + 1;
      return `L${Math.min(lap, MODES.race.laps)}·${p.score % RACE_GATES.length}/${RACE_GATES.length}`;
    }
    return p.score;
  };

  return (
    <div className="hud">
      {/* mode + round timer */}
      <div className="mode-pill">
        <span className="mode-name">{MODES[mode]?.name || mode}</span>
        <span className="mode-timer">{fmtTime(timeLeft)}</span>
      </div>

      {/* scoreboard */}
      <div className="scoreboard">
        <div className="scoreboard-title">{SCOREBOARD_TITLES[mode]}</div>
        {ranked.map((p, i) => (
          <div key={p.id} className={`score-row ${p.id === myId ? 'me' : ''}`}>
            <span className="rank">{i + 1}</span>
            <span className="dot" style={{ background: p.color }} />
            <span className="pname">
              {p.name}
              {p.bot ? ' 🤖' : ''}
            </span>
            <span className="pscore">{scoreCell(p)}</span>
          </div>
        ))}
      </div>

      {/* round-start mode banner */}
      {banner && !winner && (
        <div className="mode-banner">
          <div className="mode-banner-title">{banner.title}</div>
          <div className="mode-banner-desc">{banner.desc}</div>
        </div>
      )}

      {/* winner banner */}
      {winner && (
        <div className="winner-banner">
          <div className="winner-text">
            🏆 {winner.id === myId ? 'YOU WIN THE ROUND!' : `${winner.name} WINS THE ROUND!`}
          </div>
          <div className="winner-sub">next round starting…</div>
        </div>
      )}

      {/* event feed */}
      <div className="feed">
        {feed.map((f) => (
          <div key={f.id} className={`feed-item ${f.tone}`}>
            {f.text}
          </div>
        ))}
      </div>

      {/* speed + nitro */}
      <div className="dash">
        <div className="speed">
          <span className="speed-num">{hudSpeed}</span>
          <span className="speed-unit">km/h</span>
        </div>
        <div className="nitro-wrap">
          <div className="nitro-label">NITRO ⇧</div>
          <div className="nitro-bar">
            <div
              className="nitro-fill"
              style={{ width: `${hudNitro}%`, background: hudNitro > 25 ? '#3fd7ff' : '#ff5db1' }}
            />
          </div>
        </div>
      </div>

      <Minimap />

      <div className="hint">WASD drive · SHIFT nitro · SPACE drift</div>
    </div>
  );
}
