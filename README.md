# 🏎️ Nitro Rumble

A 3D multiplayer arcade car game built with **React Three Fiber**.

Drive a neon low-poly car around a synthwave arena, grab coins, hit boost pads,
drift around pillars — and ram other players to **steal their coins**. First
driver to 15 coins wins the round.

![game](https://img.shields.io/badge/three.js-R3F-blue) ![multiplayer](https://img.shields.io/badge/multiplayer-websockets-green)

## Features

- **Real multiplayer** — a Node.js websocket server relays player state at 20Hz;
  remote cars are smoothly interpolated. Open two browser tabs to race a friend.
- **AI bot cars** — up to 3 bots (Turbo Tina, Sir Skidsalot, Rusty) fill the
  arena when few humans are online, so it's fun even solo.
- **Arcade drift physics** — custom velocity/grip model: hold <kbd>Space</kbd>
  to break traction and slide around corners.
- **Nitro boost** — hold <kbd>Shift</kbd> to burn nitro (FOV kick + exhaust
  flames). Nitro regenerates slowly, or instantly refills on the green
  **boost pads**, which also launch you.
- **Coin steals** — ram a slower car at speed to knock a coin loose. The server
  is authoritative for coins, steals, and round wins.
- **Rounds** — first to 15 coins wins; scores reset and coins respawn.
- **HUD** — live scoreboard, speedometer, nitro gauge, event feed, and a
  real-time minimap.

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
npm run dev        # starts the game server (:80) + vite dev server (:5173)
```

Open http://localhost:5173 — in as many tabs/machines as you like.

### Production

```bash
npm run build
npm start          # serves the built client AND the websocket server on :80
                   # (override with PORT=xxxx; binding :80 may require root)
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
