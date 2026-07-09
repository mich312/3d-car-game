// Nitro Rumble game server.
// - Relays player state over websockets at 20Hz
// - Authoritative for coins, scores, coin-steals and round wins
// - Runs simple AI bot cars so the arena is never empty
// - In production also serves the built client from ../dist

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  ARENA_HALF,
  WIN_SCORE,
  COIN_COUNT,
  COIN_RADIUS,
  OBSTACLES,
  CAR_COLORS,
} from '../shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 80;

// ---------------------------------------------------------------------------
// Static file serving (only used when a production build exists)
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: players.size }));
    return;
  }
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(DIST, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html'); // SPA fallback
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Nitro Rumble server is running. Build the client with `npm run build`.');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

const players = new Map(); // id -> player
let nextId = 1;
let coinId = 1;
let roundOver = false;

const rand = (min, max) => min + Math.random() * (max - min);

function randomCoinPos() {
  for (let i = 0; i < 60; i++) {
    const x = rand(-ARENA_HALF + 10, ARENA_HALF - 10);
    const z = rand(-ARENA_HALF + 10, ARENA_HALF - 10);
    const clear = OBSTACLES.every((o) => (x - o.x) ** 2 + (z - o.z) ** 2 > (o.r + 4) ** 2);
    if (clear) return { x, z };
  }
  return { x: 0, z: 35 };
}

const makeCoin = () => ({ id: 'c' + coinId++, ...randomCoinPos() });
let coins = Array.from({ length: COIN_COUNT }, makeCoin);

function broadcast(msg, exceptId = null) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.ws && p.ws.readyState === 1 && p.id !== exceptId) p.ws.send(s);
  }
}

const publicPlayer = (p) => ({
  id: p.id,
  name: p.name,
  color: p.color,
  bot: !!p.bot,
  p: p.p,
  yaw: p.yaw,
  score: p.score,
});

// ---------------------------------------------------------------------------
// Rules: coins, steals, rounds
// ---------------------------------------------------------------------------

function checkCoins(pl) {
  if (roundOver) return;
  for (let i = 0; i < coins.length; i++) {
    const c = coins[i];
    const dx = pl.p[0] - c.x;
    const dz = pl.p[2] - c.z;
    if (dx * dx + dz * dz < COIN_RADIUS * COIN_RADIUS) {
      const fresh = makeCoin();
      coins[i] = fresh;
      pl.score++;
      broadcast({ t: 'coin', id: c.id, by: pl.id, coin: fresh, score: pl.score });
      if (pl.score >= WIN_SCORE) endRound(pl);
      return;
    }
  }
}

const bumpCooldown = new Map(); // "attacker:victim" -> timestamp

function handleBump(pl, targetId) {
  if (roundOver) return;
  const target = players.get(targetId);
  if (!target || target.id === pl.id) return;
  const dx = pl.p[0] - target.p[0];
  const dz = pl.p[2] - target.p[2];
  if (dx * dx + dz * dz > 8 * 8) return; // must actually be near the victim
  if (Math.abs(pl.speed) < Math.abs(target.speed) + 4) return; // rammer must be clearly faster
  const key = pl.id + ':' + target.id;
  const now = Date.now();
  if ((bumpCooldown.get(key) || 0) > now) return;
  bumpCooldown.set(key, now + 2000);
  if (target.score > 0) {
    target.score--;
    pl.score++;
    broadcast({
      t: 'steal',
      from: target.id,
      to: pl.id,
      scores: { [target.id]: target.score, [pl.id]: pl.score },
    });
    if (pl.score >= WIN_SCORE) endRound(pl);
  }
}

function endRound(winner) {
  roundOver = true;
  broadcast({ t: 'win', id: winner.id, name: winner.name });
  setTimeout(() => {
    for (const p of players.values()) p.score = 0;
    coins = Array.from({ length: COIN_COUNT }, makeCoin);
    roundOver = false;
    broadcast({ t: 'reset', coins, players: [...players.values()].map(publicPlayer) });
  }, 5000);
}

// ---------------------------------------------------------------------------
// Bots — keep the arena lively when few humans are around
// ---------------------------------------------------------------------------

const BOT_ROSTER = [
  { name: 'Turbo Tina', color: '#f9ca24' },
  { name: 'Sir Skidsalot', color: '#00d2d3' },
  { name: 'Rusty', color: '#ff6b81' },
];
const MAX_BOTS = 3;

const normalizeAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function manageBots() {
  const all = [...players.values()];
  const humans = all.filter((p) => !p.bot).length;
  const bots = all.filter((p) => p.bot);
  const want = humans === 0 ? 0 : clamp(4 - humans, 0, MAX_BOTS);
  while (bots.length < want) {
    const spec = BOT_ROSTER[bots.length];
    const bot = {
      id: 'b' + nextId++,
      name: spec.name,
      color: spec.color,
      bot: true,
      p: [rand(-60, 60), 0, rand(-60, 60)],
      yaw: rand(-Math.PI, Math.PI),
      speed: 0,
      boost: false,
      score: 0,
      target: null,
      topSpeed: rand(17, 22),
      ws: null,
    };
    players.set(bot.id, bot);
    bots.push(bot);
    broadcast({ t: 'join', player: publicPlayer(bot) });
  }
  while (bots.length > want) {
    const bot = bots.pop();
    players.delete(bot.id);
    broadcast({ t: 'leave', id: bot.id });
  }
}

function updateBots(dt) {
  for (const b of players.values()) {
    if (!b.bot) continue;
    // Chase the nearest coin (re-pick when it disappears)
    if (!b.target || !coins.some((c) => c.id === b.target.id)) {
      let best = null;
      let bestD = Infinity;
      for (const c of coins) {
        const d = (c.x - b.p[0]) ** 2 + (c.z - b.p[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      b.target = best;
    }
    if (!b.target) continue;

    const desired = Math.atan2(b.target.x - b.p[0], b.target.z - b.p[2]);
    const turn = normalizeAngle(desired - b.yaw);
    b.yaw += clamp(turn, -1, 1) * 2.4 * dt;
    // Slow down for sharp turns, speed up on straights
    const wantSpeed = Math.abs(turn) > 1.2 ? b.topSpeed * 0.45 : b.topSpeed;
    b.speed += (wantSpeed - b.speed) * clamp(2.2 * dt, 0, 1);
    b.p[0] += Math.sin(b.yaw) * b.speed * dt;
    b.p[2] += Math.cos(b.yaw) * b.speed * dt;

    // Push out of pillars and nudge the heading so they don't grind on them
    for (const o of OBSTACLES) {
      const dx = b.p[0] - o.x;
      const dz = b.p[2] - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + 1.8;
      if (d < min && d > 0.001) {
        b.p[0] = o.x + (dx / d) * min;
        b.p[2] = o.z + (dz / d) * min;
        b.yaw += (turn >= 0 ? 1 : -1) * 1.5 * dt;
      }
    }
    b.p[0] = clamp(b.p[0], -ARENA_HALF + 2, ARENA_HALF - 2);
    b.p[2] = clamp(b.p[2], -ARENA_HALF + 2, ARENA_HALF - 2);
    checkCoins(b);
  }
}

// ---------------------------------------------------------------------------
// Websocket wiring
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let me = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.t === 'join' && !me) {
      me = {
        id: 'p' + nextId++,
        name: String(msg.name || 'Racer').slice(0, 16) || 'Racer',
        color: CAR_COLORS.includes(msg.color) ? msg.color : CAR_COLORS[nextId % CAR_COLORS.length],
        bot: false,
        p: [rand(-50, 50), 0, rand(-50, 50)],
        yaw: rand(-Math.PI, Math.PI),
        speed: 0,
        boost: false,
        score: 0,
        ws,
      };
      players.set(me.id, me);
      ws.send(
        JSON.stringify({
          t: 'init',
          id: me.id,
          players: [...players.values()].map(publicPlayer),
          coins,
          winScore: WIN_SCORE,
        })
      );
      broadcast({ t: 'join', player: publicPlayer(me) }, me.id);
      manageBots();
    } else if (!me) {
      // ignore anything before join
    } else if (msg.t === 'state') {
      if (Array.isArray(msg.p) && msg.p.length === 3 && msg.p.every((n) => Number.isFinite(n))) {
        me.p = [
          clamp(msg.p[0], -ARENA_HALF, ARENA_HALF),
          clamp(msg.p[1], -5, 20),
          clamp(msg.p[2], -ARENA_HALF, ARENA_HALF),
        ];
        me.yaw = Number(msg.y) || 0;
        me.speed = Number(msg.s) || 0;
        me.boost = !!msg.b;
        checkCoins(me);
      }
    } else if (msg.t === 'bump') {
      handleBump(me, String(msg.target || ''));
    }
  });

  ws.on('close', () => {
    if (me) {
      players.delete(me.id);
      broadcast({ t: 'leave', id: me.id });
      manageBots();
    }
  });
});

// 20Hz world tick: advance bots and broadcast everyone's state (compact arrays)
setInterval(() => {
  updateBots(1 / 20);
  if (players.size === 0) return;
  const states = {};
  for (const p of players.values()) {
    states[p.id] = [
      +p.p[0].toFixed(2),
      +p.p[1].toFixed(2),
      +p.p[2].toFixed(2),
      +p.yaw.toFixed(3),
      +p.speed.toFixed(1),
      p.boost ? 1 : 0,
    ];
  }
  broadcast({ t: 'state', players: states });
}, 50);

server.listen(PORT, () => {
  console.log(`Nitro Rumble server listening on http://localhost:${PORT} (ws path: /ws)`);
});
