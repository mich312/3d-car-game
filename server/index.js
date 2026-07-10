// Nitro Rumble game server.
//
// The world is a set of ROOMS: a free-roam "hub" (infinite procedural
// terrain, no rules) plus one room per minigame (coins / tag / crown /
// race). Players move between rooms by driving through portals; each
// minigame room runs its own round loop and spawns AI bots whenever at
// least one human is inside — so every minigame is playable alone or
// together. State broadcasts are room-scoped at 20Hz, and the server is
// authoritative for all scoring.
//
// Flags: --port N        listen port (default: PORT env or 80)
//        --round-time N  override every game's round cap, seconds (testing)

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
  CAR_TYPES,
  DEFAULT_CAR,
  MODES,
  GAMES,
  RACE_GATES,
  GATE_RADIUS,
  CROWN_SPAWN,
  TAG_RADIUS,
  HUB_PORTALS,
} from '../shared/config.js';
import { HUB_LIMIT, PLAZA_HEIGHT } from '../shared/terrain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const PORT = Number(argValue('--port')) || Number(process.env.PORT) || 80;
const ROUND_TIME_OVERRIDE = Number(argValue('--round-time')) || null;

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
    const occupancy = {};
    for (const [id, r] of rooms) occupancy[id] = r.players.size;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: players.size, rooms: occupancy }));
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
// World state
// ---------------------------------------------------------------------------

const players = new Map(); // id -> player (player.room = room id)
let nextId = 1;
let coinId = 1;
let airRecord = { name: null, air: 0 }; // best hub jump this server has seen

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
const roundTime = (game) => (ROUND_TIME_OVERRIDE || MODES[game].time) * 1000;

function makeRoom(id, game) {
  return {
    id,
    game, // null for the hub
    players: new Set(), // player ids (humans + bots)
    coins: [],
    infected: new Set(),
    crown: { holder: null, x: CROWN_SPAWN.x, z: CROWN_SPAWN.z },
    crownAcc: 0,
    roundOver: false,
    roundEndsAt: 0,
    roundStartedAt: 0,
    contactCooldown: new Map(),
  };
}

const rooms = new Map([['hub', makeRoom('hub', null)]]);
for (const g of GAMES) rooms.set(g, makeRoom(g, g));

const roomOf = (pl) => rooms.get(pl.room);

function broadcastRoom(room, msg, exceptId = null) {
  const s = JSON.stringify(msg);
  for (const id of room.players) {
    const p = players.get(id);
    if (p && p.ws && p.ws.readyState === 1 && p.id !== exceptId) p.ws.send(s);
  }
}

const publicPlayer = (p) => ({
  id: p.id,
  name: p.name,
  color: p.color,
  car: p.car,
  bot: !!p.bot,
  p: p.p,
  yaw: p.yaw,
  score: p.score,
});

const roomRoster = (room) => [...room.players].map((id) => publicPlayer(players.get(id))).filter(Boolean);
const roomHumans = (room) => [...room.players].map((id) => players.get(id)).filter((p) => p && !p.bot);
const modeData = (room) => ({ infected: [...room.infected], crown: room.crown });

function randomCoinPos() {
  for (let i = 0; i < 60; i++) {
    const x = rand(-ARENA_HALF + 10, ARENA_HALF - 10);
    const z = rand(-ARENA_HALF + 10, ARENA_HALF - 10);
    if (OBSTACLES.every((o) => dist2(x, z, o.x, o.z) > (o.r + 4) ** 2)) return { x, z };
  }
  return { x: 0, z: 35 };
}
const makeCoin = () => ({ id: 'c' + coinId++, ...randomCoinPos() });

// ---------------------------------------------------------------------------
// Room transitions
// ---------------------------------------------------------------------------

function spawnFor(roomId) {
  if (roomId === 'hub') {
    // just outside the portal ring, on the plaza
    const a = rand(0, Math.PI * 2);
    const r = rand(12, 26);
    return { p: [Math.cos(a) * r, PLAZA_HEIGHT, Math.sin(a) * r], yaw: rand(-Math.PI, Math.PI) };
  }
  return { p: [rand(-50, 50), 0, rand(-50, 50)], yaw: rand(-Math.PI, Math.PI) };
}

function removeFromRoom(pl) {
  const room = roomOf(pl);
  if (!room) return;
  room.players.delete(pl.id);
  dropCrown(room, pl);
  room.infected.delete(pl.id);
  broadcastRoom(room, { t: 'leave', id: pl.id });
  if (room.game) manageBots(room);
}

function addToRoom(pl, roomId) {
  const room = rooms.get(roomId);
  const spawn = spawnFor(roomId);
  pl.room = roomId;
  pl.p = spawn.p;
  pl.yaw = spawn.yaw;
  pl.speed = 0;
  pl.score = 0;
  room.players.add(pl.id);
  if (!pl.bot && pl.ws) {
    pl.ws.send(
      JSON.stringify({
        t: 'room',
        mode: room.game || 'hub',
        players: roomRoster(room),
        coins: room.coins,
        data: modeData(room),
        spawn: spawn.p,
        yaw: spawn.yaw,
      })
    );
  }
  broadcastRoom(room, { t: 'join', player: publicPlayer(pl) }, pl.id);
  if (room.game) {
    manageBots(room);
    // first human entering a dormant room kicks off a fresh round
    if (roomHumans(room).length === 1 && !pl.bot) startRound(room);
  }
}

function movePlayer(pl, roomId) {
  if (!rooms.has(roomId) || pl.room === roomId) return;
  removeFromRoom(pl);
  addToRoom(pl, roomId);
}

// ---------------------------------------------------------------------------
// Round lifecycle (per minigame room)
// ---------------------------------------------------------------------------

function startRound(room) {
  room.roundOver = false;
  room.roundStartedAt = Date.now();
  room.roundEndsAt = room.roundStartedAt + roundTime(room.game);
  room.crownAcc = 0;
  room.infected.clear();
  room.contactCooldown.clear();
  room.crown = { holder: null, x: CROWN_SPAWN.x, z: CROWN_SPAWN.z };
  for (const id of room.players) {
    const p = players.get(id);
    if (p) p.score = 0;
  }
  room.coins = room.game === 'coins' ? Array.from({ length: COIN_COUNT }, makeCoin) : [];
  if (room.game === 'tag') {
    const ids = [...room.players];
    if (ids.length > 0) room.infected.add(ids[Math.floor(Math.random() * ids.length)]);
  }
  broadcastRoom(room, {
    t: 'reset',
    mode: room.game,
    coins: room.coins,
    players: roomRoster(room),
    data: modeData(room),
  });
}

function endRound(room, winner) {
  if (room.roundOver) return;
  room.roundOver = true;
  broadcastRoom(room, { t: 'win', id: winner ? winner.id : null, name: winner ? winner.name : 'Nobody' });
  setTimeout(() => {
    if (roomHumans(room).length > 0) startRound(room);
    else room.roundOver = false; // dormant; next human entry restarts
  }, 5000);
}

function topScorer(room) {
  let best = null;
  for (const id of room.players) {
    const p = players.get(id);
    if (p && (!best || p.score > best.score)) best = p;
  }
  return best;
}

function checkTimeout(room) {
  if (Date.now() < room.roundEndsAt) return;
  if (room.game === 'tag') {
    const survivors = [...room.players].map((id) => players.get(id)).filter((p) => p && !room.infected.has(p.id));
    endRound(room, survivors[Math.floor(Math.random() * survivors.length)] || null);
  } else {
    endRound(room, topScorer(room));
  }
}

// ---------------------------------------------------------------------------
// Minigame rules
// ---------------------------------------------------------------------------

function checkCoins(room, pl) {
  if (room.game !== 'coins' || room.roundOver) return;
  for (let i = 0; i < room.coins.length; i++) {
    const c = room.coins[i];
    if (dist2(pl.p[0], pl.p[2], c.x, c.z) < COIN_RADIUS * COIN_RADIUS) {
      const fresh = makeCoin();
      room.coins[i] = fresh;
      pl.score++;
      broadcastRoom(room, { t: 'coin', id: c.id, by: pl.id, coin: fresh, score: pl.score });
      if (pl.score >= MODES.coins.winScore) endRound(room, pl);
      return;
    }
  }
}

function handleBump(room, pl, targetId) {
  if (room.game !== 'coins' || room.roundOver) return;
  const target = players.get(targetId);
  if (!target || target.id === pl.id || target.room !== room.id) return;
  if (dist2(pl.p[0], pl.p[2], target.p[0], target.p[2]) > 8 * 8) return;
  if (Math.abs(pl.speed) < Math.abs(target.speed) + 4) return; // rammer must be clearly faster
  const key = pl.id + ':' + target.id;
  const now = Date.now();
  if ((room.contactCooldown.get(key) || 0) > now) return;
  room.contactCooldown.set(key, now + 2000);
  if (target.score > 0) {
    target.score--;
    pl.score++;
    broadcastRoom(room, {
      t: 'steal',
      from: target.id,
      to: pl.id,
      scores: { [target.id]: target.score, [pl.id]: pl.score },
    });
    if (pl.score >= MODES.coins.winScore) endRound(room, pl);
  }
}

function tickTag(room) {
  if (Date.now() < room.roundStartedAt + 3000) return; // grace period
  const all = [...room.players].map((id) => players.get(id)).filter(Boolean);
  for (const z of all) {
    if (!room.infected.has(z.id)) continue;
    for (const s of all) {
      if (room.infected.has(s.id)) continue;
      if (dist2(z.p[0], z.p[2], s.p[0], s.p[2]) < TAG_RADIUS * TAG_RADIUS) {
        room.infected.add(s.id);
        broadcastRoom(room, { t: 'tagged', id: s.id, by: z.id });
      }
    }
  }
  const survivors = all.filter((p) => !room.infected.has(p.id));
  if (all.length >= 2 && survivors.length === 1) endRound(room, survivors[0]);
}

function tickCrown(room, dt) {
  const holder = room.crown.holder ? players.get(room.crown.holder) : null;
  if (!holder) {
    room.crown.holder = null;
    for (const id of room.players) {
      const p = players.get(id);
      if (p && dist2(p.p[0], p.p[2], room.crown.x, room.crown.z) < 3.5 * 3.5) {
        room.crown.holder = p.id;
        broadcastRoom(room, { t: 'crown', holder: p.id });
        break;
      }
    }
    return;
  }
  room.crownAcc += dt;
  if (room.crownAcc >= 1) {
    room.crownAcc -= 1;
    holder.score++;
    broadcastRoom(room, { t: 'scores', scores: { [holder.id]: holder.score } });
    if (holder.score >= MODES.crown.winScore) {
      endRound(room, holder);
      return;
    }
  }
  const now = Date.now();
  for (const id of room.players) {
    const p = players.get(id);
    if (!p || p.id === holder.id) continue;
    if (dist2(p.p[0], p.p[2], holder.p[0], holder.p[2]) < TAG_RADIUS * TAG_RADIUS) {
      const key = 'crown:' + p.id;
      if ((room.contactCooldown.get(key) || 0) > now) continue;
      room.contactCooldown.set(key, now + 2500);
      room.crown.holder = p.id;
      room.crownAcc = 0;
      broadcastRoom(room, { t: 'crown', holder: p.id });
      break;
    }
  }
}

function dropCrown(room, pl) {
  if (room.game === 'crown' && room.crown.holder === pl.id) {
    room.crown = {
      holder: null,
      x: clamp(pl.p[0], -ARENA_HALF + 10, ARENA_HALF - 10),
      z: clamp(pl.p[2], -ARENA_HALF + 10, ARENA_HALF - 10),
    };
    broadcastRoom(room, { t: 'crown', holder: null, x: room.crown.x, z: room.crown.z });
  }
}

function tickRace(room) {
  const goal = RACE_GATES.length * MODES.race.laps;
  for (const id of room.players) {
    const p = players.get(id);
    if (!p) continue;
    const gate = RACE_GATES[p.score % RACE_GATES.length];
    if (dist2(p.p[0], p.p[2], gate.x, gate.z) < GATE_RADIUS * GATE_RADIUS) {
      p.score++;
      broadcastRoom(room, { t: 'gate', id: p.id, n: p.score });
      if (p.score >= goal) {
        endRound(room, p);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bots — per minigame room, only while a human is present
// ---------------------------------------------------------------------------

const BOT_ROSTER = [
  { name: 'Turbo Tina', color: '#f9ca24', car: 'speedster' },
  { name: 'Sir Skidsalot', color: '#00d2d3', car: 'muscle' },
  { name: 'Rusty', color: '#ff6b81', car: 'monster' },
];
const MAX_BOTS = 3;

const normalizeAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

function manageBots(room) {
  if (!room.game) return;
  const bots = [...room.players].map((id) => players.get(id)).filter((p) => p && p.bot);
  const humans = roomHumans(room).length;
  const want = humans === 0 ? 0 : clamp(4 - humans, 0, MAX_BOTS);
  while (bots.length < want) {
    const spec = BOT_ROSTER[bots.length];
    const bot = {
      id: 'b' + nextId++,
      name: spec.name,
      color: spec.color,
      car: spec.car,
      bot: true,
      room: room.id,
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
    room.players.add(bot.id);
    bots.push(bot);
    broadcastRoom(room, { t: 'join', player: publicPlayer(bot) }, bot.id);
  }
  while (bots.length > want) {
    const bot = bots.pop();
    dropCrown(room, bot);
    room.players.delete(bot.id);
    room.infected.delete(bot.id);
    players.delete(bot.id);
    broadcastRoom(room, { t: 'leave', id: bot.id });
  }
}

function botTarget(room, b) {
  const nearest = (filter) => {
    let best = null;
    let bestD = Infinity;
    for (const id of room.players) {
      const p = players.get(id);
      if (!p || p.id === b.id || !filter(p)) continue;
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

  if (room.game === 'tag') {
    if (room.infected.has(b.id)) {
      const prey = nearest((p) => !room.infected.has(p.id));
      return prey ? { x: prey.p[0], z: prey.p[2] } : null;
    }
    const threat = nearest((p) => room.infected.has(p.id));
    return threat ? fleeFrom(threat.p[0], threat.p[2]) : null;
  }
  if (room.game === 'crown') {
    if (room.crown.holder === b.id) {
      const chaser = nearest(() => true);
      return chaser ? fleeFrom(chaser.p[0], chaser.p[2]) : null;
    }
    if (room.crown.holder) {
      const h = players.get(room.crown.holder);
      return h ? { x: h.p[0], z: h.p[2] } : null;
    }
    return { x: room.crown.x, z: room.crown.z };
  }
  if (room.game === 'race') {
    return RACE_GATES[b.score % RACE_GATES.length];
  }
  // coins
  if (!b.targetCoin || !room.coins.some((c) => c.id === b.targetCoin.id)) {
    let best = null;
    let bestD = Infinity;
    for (const c of room.coins) {
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

function updateBots(room, dt) {
  for (const id of room.players) {
    const b = players.get(id);
    if (!b || !b.bot) continue;
    const target = botTarget(room, b);
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
    checkCoins(room, b);
  }
}

// ---------------------------------------------------------------------------
// Websocket wiring
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let me = null;
  let lastPortal = 0;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.t === 'join' && !me) {
      const spawn = spawnFor('hub');
      me = {
        id: 'p' + nextId++,
        name: String(msg.name || 'Racer').slice(0, 16) || 'Racer',
        color: CAR_COLORS.includes(msg.color) ? msg.color : CAR_COLORS[nextId % CAR_COLORS.length],
        car: CAR_TYPES[msg.car] ? msg.car : DEFAULT_CAR,
        bot: false,
        room: 'hub',
        p: spawn.p,
        yaw: spawn.yaw,
        speed: 0,
        boost: false,
        score: 0,
        ws,
      };
      players.set(me.id, me);
      const hub = rooms.get('hub');
      hub.players.add(me.id);
      ws.send(
        JSON.stringify({
          t: 'init',
          id: me.id,
          mode: 'hub',
          players: roomRoster(hub),
          coins: [],
          data: modeData(hub),
          spawn: spawn.p,
          yaw: spawn.yaw,
        })
      );
      broadcastRoom(hub, { t: 'join', player: publicPlayer(me) }, me.id);
    } else if (!me) {
      // ignore anything before join
    } else if (msg.t === 'state') {
      if (Array.isArray(msg.p) && msg.p.length === 3 && msg.p.every((n) => Number.isFinite(n))) {
        const room = roomOf(me);
        const inHub = me.room === 'hub';
        const lim = inHub ? HUB_LIMIT : ARENA_HALF;
        me.p = [clamp(msg.p[0], -lim, lim), clamp(msg.p[1], -30, 200), clamp(msg.p[2], -lim, lim)];
        me.yaw = Number(msg.y) || 0;
        me.speed = Number(msg.s) || 0;
        me.boost = !!msg.b;
        if (room) checkCoins(room, me);
      }
    } else if (msg.t === 'bump') {
      const room = roomOf(me);
      if (room) handleBump(room, me, String(msg.target || ''));
    } else if (msg.t === 'trick') {
      // hub stunt: keep the server-wide air-time record, announce new ones
      const airTime = Number(msg.air);
      if (
        me.room === 'hub' &&
        Number.isFinite(airTime) &&
        airTime > 0.5 &&
        airTime < 30 &&
        airTime > airRecord.air
      ) {
        airRecord = { name: me.name, air: Math.round(airTime * 10) / 10 };
        broadcastRoom(rooms.get('hub'), { t: 'record', name: airRecord.name, air: airRecord.air });
      }
    } else if (msg.t === 'portal') {
      const to = msg.to === 'hub' ? 'hub' : GAMES.includes(msg.to) ? msg.to : null;
      const now = Date.now();
      if (to && now - lastPortal > 1000) {
        lastPortal = now;
        movePlayer(me, to);
      }
    }
  });

  ws.on('close', () => {
    if (me) {
      removeFromRoom(me);
      players.delete(me.id);
    }
  });
});

// 20Hz world tick per room: bots, rules, scoped state broadcast
const TICK = 1 / 20;
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;
    if (room.game) {
      updateBots(room, TICK);
      if (!room.roundOver && roomHumans(room).length > 0) {
        if (room.game === 'tag') tickTag(room);
        else if (room.game === 'crown') tickCrown(room, TICK);
        else if (room.game === 'race') tickRace(room);
        checkTimeout(room);
      }
    }
    const states = {};
    for (const id of room.players) {
      const p = players.get(id);
      if (!p) continue;
      states[id] = [
        +p.p[0].toFixed(2),
        +p.p[1].toFixed(2),
        +p.p[2].toFixed(2),
        +p.yaw.toFixed(3),
        +p.speed.toFixed(1),
        p.boost ? 1 : 0,
      ];
    }
    broadcastRoom(room, {
      t: 'state',
      players: states,
      tl: room.game && !room.roundOver ? Math.max(0, Math.ceil((room.roundEndsAt - Date.now()) / 1000)) : 0,
    });
  }
}, 50);

// Every 2s, tell hub players how many humans are in each minigame so the
// portal signs can show live occupancy.
setInterval(() => {
  const hub = rooms.get('hub');
  if (hub.players.size === 0) return;
  const counts = {};
  for (const g of GAMES) counts[g] = roomHumans(rooms.get(g)).length;
  broadcastRoom(hub, { t: 'lobby', counts, record: airRecord.name ? airRecord : null });
}, 2000);

// Sanity: portals defined in shared config must map to real rooms.
for (const portal of HUB_PORTALS) {
  if (!rooms.has(portal.game)) throw new Error(`portal to unknown game: ${portal.game}`);
}

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
