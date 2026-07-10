import React, { useEffect, useRef } from 'react';
import { useStore } from '../store.js';
import { localState, remoteStates } from '../net.js';
import { ARENA_HALF, OBSTACLES, MODES, RACE_GATES, HUB_PORTALS } from '../../shared/config.js';
import { RAMPS, RING_ROAD, CITY, GROTTO } from '../../shared/terrain.js';
import TouchControls from './TouchControls.jsx';

function Minimap() {
  const canvasRef = useRef(null);

  useEffect(() => {
    let raf;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const S = canvas.width;
      const { coins, players, myId, mode, crown } = useStore.getState();
      const inHub = mode === 'hub';

      // hub map is centered on the player; arena map covers the whole arena
      const HUB_RANGE = 170;
      const toMap = inHub
        ? (x, z) => [
            ((x - localState.p[0] + HUB_RANGE) / (HUB_RANGE * 2)) * S,
            ((z - localState.p[2] + HUB_RANGE) / (HUB_RANGE * 2)) * S,
          ]
        : (x, z) => [((x + ARENA_HALF) / (ARENA_HALF * 2)) * S, ((z + ARENA_HALF) / (ARENA_HALF * 2)) * S];

      ctx.clearRect(0, 0, S, S);
      ctx.fillStyle = 'rgba(10, 14, 34, 0.75)';
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = 'rgba(63, 215, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, S - 2, S - 2);

      if (inHub) {
        const scale = S / (HUB_RANGE * 2);
        // ring road + highway east
        ctx.strokeStyle = 'rgba(140, 155, 220, 0.45)';
        ctx.lineWidth = 2;
        const [cx0, cy0] = toMap(0, 0);
        ctx.beginPath();
        ctx.arc(cx0, cy0, RING_ROAD.r * scale, 0, Math.PI * 2);
        ctx.stroke();
        const [hx0, hy0] = toMap(42, 0);
        const [hx1, hy1] = toMap(CITY.x, 0);
        ctx.beginPath();
        ctx.moveTo(hx0, hy0);
        ctx.lineTo(hx1, hy1);
        ctx.stroke();
        // Neon Heights footprint
        const [ctx0, cty0] = toMap(CITY.x, CITY.z);
        ctx.strokeStyle = 'rgba(255, 93, 177, 0.55)';
        ctx.beginPath();
        ctx.arc(ctx0, cty0, CITY.r * scale, 0, Math.PI * 2);
        ctx.stroke();
        // Crystal Grotto + its cave road
        const [gx0, gy0] = toMap(GROTTO.x, GROTTO.z);
        ctx.strokeStyle = 'rgba(125, 249, 255, 0.55)';
        ctx.beginPath();
        ctx.arc(gx0, gy0, GROTTO.r * scale, 0, Math.PI * 2);
        ctx.stroke();
        const [wx0, wy0] = toMap(-42, 0);
        ctx.strokeStyle = 'rgba(140, 155, 220, 0.45)';
        ctx.beginPath();
        ctx.moveTo(wx0, wy0);
        ctx.lineTo(gx0, gy0);
        ctx.stroke();
        // stunt ramps
        ctx.fillStyle = '#ffd23f';
        for (const r of RAMPS) {
          const [x, y] = toMap(r.x, r.z);
          if (x < -4 || x > S + 4 || y < -4 || y > S + 4) continue;
          ctx.fillRect(x - 2, y - 2, 4, 4);
        }
        // portal markers
        for (const portal of HUB_PORTALS) {
          const [x, y] = toMap(portal.x, portal.z);
          if (x < -6 || x > S + 6 || y < -6 || y > S + 6) continue;
          ctx.fillStyle = portal.color;
          ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
        }
      } else {
        // pillars
        ctx.fillStyle = 'rgba(90, 110, 190, 0.6)';
        for (const o of OBSTACLES) {
          const [x, y] = toMap(o.x, o.z);
          ctx.beginPath();
          ctx.arc(x, y, (o.r / (ARENA_HALF * 2)) * S, 0, Math.PI * 2);
          ctx.fill();
        }
      }

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
        if (x < -4 || x > S + 4 || y < -4 || y > S + 4) continue;
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
  hub: 'IN THE WORLD 🌍',
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
  const wallet = useStore((s) => s.wallet);
  const impactNonce = useStore((s) => s.impactNonce);
  const bestAir = useStore((s) => s.bestAir);
  const bestJump = useStore((s) => s.bestJump);
  const bestHw = useStore((s) => s.bestHw);
  const airRecord = useStore((s) => s.airRecord);
  const hwRecord = useStore((s) => s.hwRecord);

  const ranked = Object.values(players)
    .map((p) => ({ ...p, score: scores[p.id] || 0, sick: infected.includes(p.id) }))
    .sort((a, b) => (mode === 'tag' ? Number(a.sick) - Number(b.sick) : b.score - a.score));

  const scoreCell = (p) => {
    if (mode === 'hub') return '·';
    if (mode === 'tag') return p.sick ? '🧟' : '🏃';
    if (mode === 'race') {
      const lap = Math.floor(p.score / RACE_GATES.length) + 1;
      return `L${Math.min(lap, MODES.race.laps)}·${p.score % RACE_GATES.length}/${RACE_GATES.length}`;
    }
    return p.score;
  };

  return (
    <div className="hud">
      {/* red edge flash on hard crashes (remounts per impact to replay) */}
      {impactNonce > 0 && <div key={impactNonce} className="impact-flash" />}

      {/* mode + round timer */}
      <div className="mode-pill">
        <span className="mode-name">{MODES[mode]?.name || mode}</span>
        {mode !== 'hub' && <span className="mode-timer">{fmtTime(timeLeft)}</span>}
      </div>

      {/* wallet */}
      <div className="wallet-pill">🪙 {wallet}</div>

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
        {/* stunt + sprint records (hub only) */}
        {mode === 'hub' && (bestAir > 0 || airRecord || bestHw > 0 || hwRecord) && (
          <div className="records-line">
            {bestAir > 0 && (
              <div>
                ✈️ your best: {bestAir}s air · {bestJump}m
              </div>
            )}
            {airRecord && (
              <div>
                🏆 air record: {airRecord.air}s — {airRecord.name}
              </div>
            )}
            {bestHw > 0 && <div>🛣 your sprint: {bestHw}s</div>}
            {hwRecord && (
              <div>
                🏆 sprint record: {hwRecord.time}s — {hwRecord.name}
              </div>
            )}
          </div>
        )}
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

      <TouchControls />

      <div className="hint">
        {mode === 'hub'
          ? 'WASD drive · SHIFT nitro · hit the yellow ramps for air records · portals (or 1-4) start a game'
          : 'WASD drive · SHIFT nitro · SPACE drift · green ring (or 0) returns to the world'}
      </div>
    </div>
  );
}
