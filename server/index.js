// Nitro Rumble game server.
// - Relays player state over websockets at 20Hz
// - Rotates through game modes (coin rush / infection tag / crown keeper /
//   gate race) and is authoritative for all scoring and round wins
// - Runs simple AI bot cars that play every mode
// - In production also serves the built client from ../dist
//
// Flags: --port N        listen port (default: PORT env or 80)
//        --mode NAME     start rotation at this mode (testing)
//        --round-time N  override every mode's round cap, seconds (testing)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  ARENA_HALF,
  COIN_COUNT,
  COIN_RADIUS,
  OBSTACLES,
  CAR_COLORS,
  MODES,
  MODE_ORDER,
  RACE_GATES,
  GATE_RADIUS,
  CROWN_SPAWN,
  TAG_RADIUS,
} from '../shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const PORT = Number(argValue('--port')) || Number(process.env.PORT) || 80;
const ROUND_TIME_OVERRIDE = Number(argValue('--round-time')) || null;
const START_MODE = MODE_ORDER.includes(argValue('--mode')) ? argValue('--mode') : MODE_ORDER[0];

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
    res.end(JSON.stringify({ ok: true, players: players.size, mode }));
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

let mode = START_MODE;
let roundOver = false;
let roundEndsAt = 0;
let roundStartedAt = 0;

let coins = [];
const infected = new Set(); // tag: player ids
let crown = { holder: null, x: CROWN_SPAWN.x, z: CROWN_SPAWN.z }; // crown: holder or ground pos
let crownAcc = 0; // fractional crown points
const contactCooldown = new Map(); // "a:b" -> timestamp (crown snatches, coin bumps)

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;

const roundTime = (m) => (ROUND_TIME_OVERRIDE || MODES[m].time) * 1000;

function randomCoinPos() {
  for (let i = 0; i < 60; i++) {
    const x = rand(-ARENA_HALF + 10, ARENA_HALF - 10);
    const z = rand(-ARENA_HALF + 10, ARENA_HALF - 10);
    const clear = OBSTACLES.every((o) => dist2(x, z, o.x, o.z) > (o.r + 4) ** 2);
    if (clear) return { x, z };
  }
  return { x: 0, z: 35 };
}

const makeCoin = () => ({ id: 'c' + coinId++, ...randomCoinPos() });

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

// Dynamic per-mode state shipped in init/reset so late joiners sync up.
const modeData = () => ({
  infected: [...infected],
  crown,
});

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

function startRound(nextMode) {
  mode = nextMode;
  roundOver = false;
  roundStartedAt = Date.now();
  roundEndsAt = roundStartedAt + roundTime(mode);
  crownAcc = 0;
  infected.clear();
  contactCooldown.clear();
  crown = { holder: null, x: CROWN_SPAWN.x, z: CROWN_SPAWN.z };
  for (const p of players.values()) p.score = 0;
  coins = mode === 'coins' ? Array.from({ length: COIN_COUNT }, makeCoin) : [];
  if (mode === 'tag') {
    const all = [...players.values()];
    if (all.length > 0) infected.add(all[Math.floor(Math.random() * all.length)].id);
  }
  broadcast({
    t: 'reset',
    mode,
    coins,
    players: [...players.values()].map(publicPlayer),
    data: modeData(),
  });
}

function endRound(winner) {
  if (roundOver) return;
  roundOver = true;
  broadcast({ t: 'win', id: winner ? winner.id : null, name: winner ? winner.name : 'Nobody' });
  setTimeout(() => {
    const idx = MODE_ORDER.indexOf(mode);
    startRound(MODE_ORDER[(idx + 1) % MODE_ORDER.length]);
  }, 5000);
}

function topScorer() {
  let best = null;
  for (const p of players.values()) if (!best || p.score > best.score) best = p;
  return best && best.score > 0 ? best : best;
}

function checkTimeout() {
  if (Date.now() < roundEndsAt) return;
  if (mode === 'tag') {
    const survivors = [...players.values()].filter((p) => !infected.has(p.id));
    endRound(survivors[Math.floor(Math.random() * survivors.length)] || null);
  } else {
    endRound(topScorer());
  }
}

// ---------------------------------------------------------------------------
// Mode rules
// ---------------------------------------------------------------------------

function checkCoins(pl) {
  if (mode !== 'coins' || roundOver) return;
  for (let i = 0; i < coins.length; i++) {
    const c = coins[i];
    if (dist2(pl.p[0], pl.p[2], c.x, c.z) < COIN_RADIUS * COIN_RADIUS) {
      const fresh = makeCoin();
      coins[i] = fresh;
      pl.score++;
      broadcast({ t: 'coin', id: c.id, by: pl.id, coin: fresh, score: pl.score });
      if (pl.score >= MODES.coins.winScore) endRound(pl);
      return;
    }
  }
}

function handleBump(pl, targetId) {
  if (mode !== 'coins' || roundOver) return;
  const target = players.get(targetId);
  if (!target || target.id === pl.id) return;
  if (dist2(pl.p[0], pl.p[2], target.p[0], target.p[2]) > 8 * 8) return;
  if (Math.abs(pl.speed) < Math.abs(target.speed) + 4) return; // rammer must be clearly faster
  const key = pl.id + ':' + target.id;
  const now = Date.now();
  if ((contactCooldown.get(key) || 0) > now) return;
  contactCooldown.set(key, now + 2000);
  if (target.score > 0) {
    target.score--;
    pl.score++;
    broadcast({
      t: 'steal',
      from: target.id,
      to: pl.id,
      scores: { [target.id]: target.score, [pl.id]: pl.score },
    });
    if (pl.score >= MODES.coins.winScore) endRound(pl);
  }
}

function tickTag() {
  if (Date.now() < roundStartedAt + 3000) return; // grace period after the reveal
  const all = [...players.values()];
  for (const z of all) {
    if (!infected.has(z.id)) continue;
    for (const s of all) {
      if (infected.has(s.id)) continue;
      if (dist2(z.p[0], z.p[2], s.p[0], s.p[2]) < TAG_RADIUS * TAG_RADIUS) {
        infected.add(s.id);
        broadcast({ t: 'tagged', id: s.id, by: z.id });
      }
    }
  }
  const survivors = all.filter((p) => !infected.has(p.id));
  if (all.length >= 2 && survivors.length === 1) endRound(survivors[0]);
}

function tickCrown(dt) {
  const holder = crown.holder ? players.get(crown.holder) : null;
  if (!holder) {
    crown.holder = null;
    for (const p of players.values()) {
      if (dist2(p.p[0], p.p[2], crown.x, crown.z) < 3.5 * 3.5) {
        crown.holder = p.id;
        broadcast({ t: 'crown', holder: p.id });
        break;
      }
    }
    return;
  }
  // score while holding: 1 point per second
  crownAcc += dt;
  if (crownAcc >= 1) {
    crownAcc -= 1;
    holder.score++;
    broadcast({ t: 'scores', scores: { [holder.id]: holder.score } });
    if (holder.score >= MODES.crown.winScore) {
      endRound(holder);
      return;
    }
  }
  // anyone touching the holder snatches the crown
  const now = Date.now();
  for (const p of players.values()) {
    if (p.id === holder.id) continue;
    if (dist2(p.p[0], p.p[2], holder.p[0], holder.p[2]) < TAG_RADIUS * TAG_RADIUS) {
      const key = 'crown:' + p.id;
      if ((contactCooldown.get(key) || 0) > now) continue;
      contactCooldown.set(key, now + 2500);
      crown.holder = p.id;
      crownAcc = 0;
      broadcast({ t: 'crown', holder: p.id });
      break;
    }
  }
}

function dropCrown(pl) {
  if (mode === 'crown' && crown.holder === pl.id) {
    crown = {
      holder: null,
      x: clamp(pl.p[0], -ARENA_HALF + 10, ARENA_HALF - 10),
      z: clamp(pl.p[2], -ARENA_HALF + 10, ARENA_HALF - 10),
    };
    broadcast({ t: 'crown', holder: null, x: crown.x, z: crown.z });
  }
}

function tickRace() {
  const goal = RACE_GATES.length * MODES.race.laps;
  for (const p of players.values()) {
    const gate = RACE_GATES[p.score % RACE_GATES.length];
    if (dist2(p.p[0], p.p[2], gate.x, gate.z) < GATE_RADIUS * GATE_RADIUS) {
      p.score++;
      broadcast({ t: 'gate', id: p.id, n: p.score });
      if (p.score >= goal) {
        endRound(p);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bots — they play every mode
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
      targetCoin: null,
      topSpeed: rand(17, 22),
      ws: null,
    };
    players.set(bot.id, bot);
    bots.push(bot);
    broadcast({ t: 'join', player: publicPlayer(bot) });
  }
  while (bots.length > want) {
    const bot = bots.pop();
    dropCrown(bot);
    players.delete(bot.id);
    infected.delete(bot.id);
    broadcast({ t: 'leave', id: bot.id });
  }
}

// Where does this bot want to go right now, given the mode?
function botTarget(b) {
  const nearest = (filter) => {
    let best = null;
    let bestD = Infinity;
    for (const p of players.values()) {
      if (p.id === b.id || !filter(p)) continue;
      const d = dist2(b.p[0], b.p[2], p.p[0], p.p[2]);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };
  const fleeFrom = (x, z) => {
    const dx = b.p[0] - x;
    const dz = b.p[2] - z;
    const d = Math.hypot(dx, dz) || 1;
    return {
      x: clamp(b.p[0] + (dx / d) * 40, -ARENA_HALF + 8, ARENA_HALF - 8),
      z: clamp(b.p[2] + (dz / d) * 40, -ARENA_HALF + 8, ARENA_HALF - 8),
    };
  };

  if (mode === 'tag') {
    if (infected.has(b.id)) {
      const prey = nearest((p) => !infected.has(p.id));
      return prey ? { x: prey.p[0], z: prey.p[2] } : null;
    }
    const threat = nearest((p) => infected.has(p.id));
    return threat ? fleeFrom(threat.p[0], threat.p[2]) : null;
  }
  if (mode === 'crown') {
    if (crown.holder === b.id) {
      const chaser = nearest(() => true);
      return chaser ? fleeFrom(chaser.p[0], chaser.p[2]) : null;
    }
    if (crown.holder) {
      const h = players.get(crown.holder);
      return h ? { x: h.p[0], z: h.p[2] } : null;
    }
    return { x: crown.x, z: crown.z };
  }
  if (mode === 'race') {
    return RACE_GATES[b.score % RACE_GATES.length];
  }
  // coins
  if (!b.targetCoin || !coins.some((c) => c.id === b.targetCoin.id)) {
    let best = null;
    let bestD = Infinity;
    for (const c of coins) {
      const d = dist2(b.p[0], b.p[2], c.x, c.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    b.targetCoin = best;
  }
  return b.targetCoin;
}

function updateBots(dt) {
  for (const b of players.values()) {
    if (!b.bot) continue;
    const target = botTarget(b);
    if (!target) continue;

    const desired = Math.atan2(target.x - b.p[0], target.z - b.p[2]);
    const turn = normalizeAngle(desired - b.yaw);
    b.yaw += clamp(turn, -1, 1) * 2.4 * dt;
    const wantSpeed = Math.abs(turn) > 1.2 ? b.topSpeed * 0.45 : b.topSpeed;
    b.speed += (wantSpeed - b.speed) * clamp(2.2 * dt, 0, 1);
    b.p[0] += Math.sin(b.yaw) * b.speed * dt;
    b.p[2] += Math.cos(b.yaw) * b.speed * dt;

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
          mode,
          players: [...players.values()].map(publicPlayer),
          coins,
          data: modeData(),
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
      dropCrown(me);
      players.delete(me.id);
      infected.delete(me.id);
      broadcast({ t: 'leave', id: me.id });
      manageBots();
    }
  });
});

// 20Hz world tick: bots, mode rules, state broadcast
const TICK = 1 / 20;
setInterval(() => {
  updateBots(TICK);
  if (players.size > 0 && !roundOver) {
    if (mode === 'tag') tickTag();
    else if (mode === 'crown') tickCrown(TICK);
    else if (mode === 'race') tickRace();
    checkTimeout();
  }
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
  broadcast({
    t: 'state',
    players: states,
    tl: roundOver ? 0 : Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000)),
  });
}, 50);

startRound(START_MODE);

// ---------------------------------------------------------------------------
// Listen
// ---------------------------------------------------------------------------

// The ws library re-emits http server errors on the WebSocketServer, so the
// handler must be attached to both — whichever fires first wins.
const onBindError = (err) => {
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
    console.error(
      `\nCould not bind port ${PORT} (${err.code}).\n` +
        (PORT === 80
          ? 'Port 80 is often taken by IIS/HTTP.sys on Windows, or needs root on Linux/macOS.\n'
          : '') +
        'Pick another port with:  node server/index.js --port 3001\n'
    );
    process.exit(1);
  }
  throw err;
};
server.on('error', onBindError);
wss.on('error', onBindError);

server.listen(PORT, () => {
  console.log(`Nitro Rumble server listening on http://localhost:${PORT} (ws path: /ws)`);
});
