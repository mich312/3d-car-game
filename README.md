# 🏎️ Nitro Rumble

A 3D multiplayer arcade car game built with **React Three Fiber**.

Drive a neon low-poly car around a synthwave arena, grab coins, hit boost pads,
drift around pillars — and ram other players to **steal their coins**. First
driver to 15 coins wins the round.

![game](https://img.shields.io/badge/three.js-R3F-blue) ![multiplayer](https://img.shields.io/badge/multiplayer-websockets-green)

## Rotating game modes

The server rotates through four games, one per round, announced with a big
banner and a round timer. Bots play every mode.

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
- **Server-authoritative rules** — coins, steals, infections, crown snatches,
  gate progress, and round wins are all decided server-side.
- **HUD** — mode banner + round timer, adaptive scoreboard, speedometer,
  nitro gauge, event feed, and a real-time minimap (gates and the loose crown
  included).

### Testing flags

`node server/index.js --mode race --round-time 20` starts the rotation at a
given mode with short rounds — handy for trying every mode quickly.

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
