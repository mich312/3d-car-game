import React, { useEffect, useRef } from 'react';
import { useStore } from '../store.js';
import { localState, remoteStates } from '../net.js';
import { ARENA_HALF, OBSTACLES } from '../../shared/config.js';

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

      // coins
      const { coins, players, myId } = useStore.getState();
      ctx.fillStyle = '#ffd23f';
      for (const c of coins) {
        const [x, y] = toMap(c.x, c.z);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
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

export default function Hud() {
  const players = useStore((s) => s.players);
  const scores = useStore((s) => s.scores);
  const myId = useStore((s) => s.myId);
  const winScore = useStore((s) => s.winScore);
  const winner = useStore((s) => s.winner);
  const feed = useStore((s) => s.feed);
  const hudSpeed = useStore((s) => s.hudSpeed);
  const hudNitro = useStore((s) => s.hudNitro);

  const ranked = Object.values(players)
    .map((p) => ({ ...p, score: scores[p.id] || 0 }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="hud">
      {/* scoreboard */}
      <div className="scoreboard">
        <div className="scoreboard-title">FIRST TO {winScore} 🪙</div>
        {ranked.map((p, i) => (
          <div key={p.id} className={`score-row ${p.id === myId ? 'me' : ''}`}>
            <span className="rank">{i + 1}</span>
            <span className="dot" style={{ background: p.color }} />
            <span className="pname">
              {p.name}
              {p.bot ? ' 🤖' : ''}
            </span>
            <span className="pscore">{p.score}</span>
          </div>
        ))}
      </div>

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

      <div className="hint">WASD drive · SHIFT nitro · SPACE drift · ram cars to steal coins</div>
    </div>
  );
}
