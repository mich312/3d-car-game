# 🏎️ Nitro Rumble

A 3D multiplayer arcade car game built with **React Three Fiber**.

Drive a neon low-poly car around a synthwave arena, grab coins, hit boost pads,
drift around pillars — and ram other players to **steal their coins**. First
driver to 15 coins wins the round.

![game](https://img.shields.io/badge/three.js-R3F-blue) ![multiplayer](https://img.shields.io/badge/multiplayer-websockets-green)

## The open world

You spawn in an **infinite procedurally generated world** — rolling grass
hills, pine forests, rocky peaks with snow caps, lakes, and glowing crystals.
The terrain streams in chunks around you and is generated from a shared
seeded noise field, so every player drives the same world. Slopes pull you
downhill, crests launch you airborne, and water bogs you down.

At the center is a neon **portal plaza**: drive into a ring (or press
<kbd>1</kbd>–<kbd>4</kbd>) to enter that minigame's arena. Portal signs show
live player counts. A green exit ring in every arena (or <kbd>0</kbd>) brings
you back to the world.

Around the plaza runs a **stunt ring road** lined with neon-railed jump
ramps — one of them a mega kicker. Big air pays coins, posts your air-time
and jump-distance **personal bests** (persisted in your browser), and the
longest air anyone has pulled off becomes the **server-wide air record**,
announced to every driver in the hub. Follow the **highway east** through a
canyon pass (jump included) to reach **Neon Heights**, a glowing city
district with solid buildings, streets, and a beacon spire you can see from
the mountains.

## Minigames

Each minigame runs in its own room with its own round loop, and AI bots fill
the arena whenever you're alone — every game works solo or multiplayer.

| Mode | Rules |
| --- | --- |
| 🪙 **Coin Rush** | Grab coins; ram a slower car to steal one. First to 15 wins. |
| 🧟 **Infection** | One car starts infected and spreads it by touch. Last clean car wins. |
| 👑 **Crown Keeper** | Hold the crown to earn a point per second; bump the holder to snatch it. First to 25. |
| 🏁 **Grand Prix** | Drive the glowing gates in order, 2 laps. An arrow over your car points to your next gate. |

## Features

- **Real multiplayer** — a Node.js websocket server relays player state at 20Hz;
  remote cars are smoothly interpolated. Open two browser tabs to race a friend.
- **AI bot cars** — up to 3 bots (Turbo Tina, Sir Skidsalot, Rusty) fill the
  arena when few humans are online. They chase coins, flee the infected (or
  hunt you once infected), guard the crown, and run the race line.
- **Arcade drift physics** — custom velocity/grip model: hold <kbd>Space</kbd>
  to break traction and slide around corners.
- **Nitro boost** — hold <kbd>Shift</kbd> to burn nitro (FOV kick + exhaust
  flames). Nitro regenerates slowly, or instantly refills on the green
  **boost pads**, which also launch you.
- **Crunchy crashes** — every hard hit throws a burst of sparks and a
  shockwave ring at the contact point, shakes the camera (trauma-style,
  scaled to impact speed), wobbles the car body on its suspension, and
  flashes the screen edges red on really big ones. Landings kick up dust.
- **Server-authoritative rules** — coins, steals, infections, crown snatches,
  gate progress, and round wins are all decided server-side.
- **HUD** — mode banner + round timer, adaptive scoreboard, speedometer,
  nitro gauge, event feed, and a real-time minimap (gates and the loose crown
  included).

- **Overengineered on purpose** — multi-room websocket server (hub + one room
  per minigame, all state room-scoped), deterministic chunk-streamed terrain
  with seamless analytic normals, instanced decorations, terrain-following
  shadow sun, and bloom post-processing on everything neon.

### Testing flags

`node server/index.js --round-time 20` shortens every round — handy for
testing. Quick-travel keys <kbd>1</kbd>–<kbd>4</kbd> / <kbd>0</kbd> jump
between rooms without driving to a portal.

## Garage — earn coins, unlock cars

Everything you do pays out 🪙 into a persistent wallet (saved in your
browser): +1 per coin grabbed or stolen, +3 per infection you spread, +1 per
second holding the crown, +2 per race gate, **+25 for winning a round**, and
+2 for touching a glowing crystal out in the world (which also refills your
nitro).

Spend it in the lobby garage — five rides with different stats and bodies,
visible to every other player:

| Car | 🪙 | Character |
| --- | --- | --- |
| Compact | free | balanced starter |
| Muscle | 150 | brutal acceleration, hood scoop |
| Speedster | 300 | +20% top speed, slippery grip |
| Monster | 550 | giant wheels, +35% grip, eats mountains |
| Formula X | 900 | best everything, rear wing |

## Playing together

Everyone who opens the same server URL shares one world: you meet in the hub,
see each other's cars and nameplates, and joining the same portal puts you in
the same match. Run `npm start` and share `http://<your-host>` (LAN or a
deployed box) — one Node process serves the whole game. Solo players always
get bot opponents.

## Controls

| Key | Action |
| --- | --- |
| <kbd>W</kbd>/<kbd>↑</kbd> | accelerate |
| <kbd>S</kbd>/<kbd>↓</kbd> | brake / reverse |
| <kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd> | steer |
| <kbd>Shift</kbd> | nitro boost |
| <kbd>Space</kbd> | handbrake / drift |

## Running it

```bash
npm install
npm run dev        # starts the game server (:5174) + vite dev server (:5173)
```

> **"vite not found" / "concurrently not found"?** Dev tools live in
> devDependencies. Run a plain `npm install` — without `--production` or
> `--omit=dev`, and without `NODE_ENV=production` set (that makes npm skip
> devDependencies). `npm install --include=dev` forces them regardless.

Open http://localhost:5173 — in as many tabs/machines as you like.

### Production

```bash
npm run build
npm start          # serves the built client AND the websocket server on :80
```

Port 80 needs root on Linux/macOS and is often taken by IIS/HTTP.sys on
Windows. Override it with the cross-platform `--port` flag (or the `PORT`
env var):

```bash
node server/index.js --port 3001
```

## Architecture

```
shared/config.js      world layout + rules, imported by both sides
server/index.js       ws relay, authoritative coins/scores/steals/rounds, AI bots
src/net.js            websocket client; 20Hz state in a mutable Map (no React churn)
src/store.js          zustand store for roster/scores/coins/UI
src/components/
  Game.jsx            canvas, lights, sky
  Arena.jsx           ground grid, walls, pillars, boost pads
  PlayerCar.jsx       local arcade physics, collisions, chase camera
  RemoteCars.jsx      interpolated network players
  CarModel.jsx        shared low-poly car (wheels, lean, boost flames)
  Coins.jsx / Hud.jsx pickups and 2D overlay (scoreboard, minimap, nitro)
```

The client simulates its own car locally (instant feel), publishes position at
20Hz, and the server settles anything contested: coin pickups, coin steals on
collisions, and round wins.
