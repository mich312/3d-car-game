---
name: verify
description: Build, run, and drive Nitro Rumble (R3F client + ws game server) to verify changes end-to-end.
---

# Verifying Nitro Rumble

## Build + launch (production mode, single port)

```bash
npm install
npm run build                      # vite build -> dist/
PORT=3001 node server/index.js &   # serves dist AND the websocket on :3001
curl -s http://localhost:3001/health   # {"ok":true,"players":N}
```

Dev mode alternative: `npm run dev` (server :5174 + vite :5173, ws proxied).
The server defaults to :80 for `npm start`; `--port N` or the PORT env var
override it (the examples here pin 3001 to avoid needing root), and a bind
failure exits with a friendly message instead of a stack trace.

## Surfaces to drive

1. **Websocket protocol** (`ws://localhost:3001/ws`) — join with
   `{t:'join',name,color}`, expect `init` with `id/players/coins/winScore`,
   then 20Hz `{t:'state'}` broadcasts. Send `{t:'state',p:[x,0,z],y,s,b}`
   onto a coin position from `init.coins` → expect a `{t:'coin'}` broadcast.
   Import ws by absolute path in scratch scripts:
   `import WebSocket from '<repo>/node_modules/ws/wrapper.mjs'`.

2. **Browser** — system Playwright is at
   `require('/opt/node22/lib/node_modules/playwright')` (chromium
   preinstalled). Flow: `goto http://localhost:3001/` → fill `.name-input` →
   click `.join-btn` → wait for `.scoreboard`. Drive with
   `page.keyboard.down('KeyW'/'ShiftLeft'/'Space'/'KeyA')`. Assert on
   `.speed-num` (moves >0), `.score-row` count (bots auto-join, 4 total for
   1 human), `.nitro-fill` width. Screenshot for visuals: car, coins,
   pillars, minimap canvas, nameplates (drei Html → real DOM `.nameplate`).

3. **Multiplayer** — open a second page in the same browser, join with a
   different name; both scoreboards must list both humans. A fake ws client
   that mirrors positions from `state` broadcasts can park next to the
   browser player to make remote-car visuals deterministic.

## Game modes

The server rotates coins → tag → crown → race (see shared/config.js MODES).
Test flags: `--mode <name>` starts at that mode, `--round-time <sec>`
overrides every round cap. A full-rotation ws test: join, then per mode park
on the objective (coin pos / another player in tag / CROWN_SPAWN / RACE_GATES
in order) and expect `coin` / `tagged` / `crown`+`scores` / `gate` events,
a `win` per round, and `reset` carrying the next mode.

## Gotchas

- Bots (`id` prefix `b`) fill up to 4 total players and shrink as humans
  join, so scoreboard counts change when a tab joins/closes.
- The steal rule needs the attacker within 8 units AND ≥4 faster than the
  victim, with a 2s per-pair cooldown — probe all three guards.
- Coins the bots grab get replaced (`{t:'coin', coin: <new>}`); scratch
  clients must update their coin list before retrying a pickup.
