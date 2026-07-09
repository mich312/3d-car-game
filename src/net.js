// Websocket client. Roster/scores/coins go through the zustand store (they
// change rarely); high-frequency position data is kept in `remoteStates`, a
// plain mutable Map that the render loop reads directly — no React re-renders
// at 20Hz.

import { useStore } from './store.js';

export const remoteStates = new Map(); // id -> { p: [x,y,z], yaw, speed, boost }

// The local car writes its live state here every frame; we ship it to the
// server on an interval.
export const localState = { p: [0, 0, 0], yaw: 0, speed: 0, boost: false, spawned: false };

let ws = null;
let sendTimer = null;

export function connect(name, color) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, color }));

  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    const store = useStore.getState();
    switch (msg.t) {
      case 'init': {
        localState.p = [...msg.spawn];
        localState.yaw = msg.yaw;
        localState.spawned = true;
        for (const p of msg.players) {
          if (p.id !== msg.id) {
            remoteStates.set(p.id, { p: [...p.p], yaw: p.yaw, speed: 0, boost: false });
          }
        }
        store.init(msg);
        startSending();
        break;
      }
      case 'room': {
        // teleported to another room: hard-reset positions and roster
        remoteStates.clear();
        localState.p = [...msg.spawn];
        localState.yaw = msg.yaw;
        const myId = store.myId;
        for (const p of msg.players) {
          if (p.id !== myId) {
            remoteStates.set(p.id, { p: [...p.p], yaw: p.yaw, speed: 0, boost: false });
          }
        }
        store.applyRoom(msg);
        break;
      }
      case 'lobby':
        store.setPortalCounts(msg.counts);
        break;
      case 'join':
        remoteStates.set(msg.player.id, {
          p: [...msg.player.p],
          yaw: msg.player.yaw,
          speed: 0,
          boost: false,
        });
        store.playerJoined(msg.player);
        break;
      case 'leave':
        remoteStates.delete(msg.id);
        store.playerLeft(msg.id);
        break;
      case 'state': {
        if (typeof msg.tl === 'number' && msg.tl !== store.timeLeft) store.setTimeLeft(msg.tl);
        const myId = store.myId;
        for (const [id, s] of Object.entries(msg.players)) {
          if (id === myId) continue;
          const cur = remoteStates.get(id);
          if (cur) {
            cur.p[0] = s[0];
            cur.p[1] = s[1];
            cur.p[2] = s[2];
            cur.yaw = s[3];
            cur.speed = s[4];
            cur.boost = !!s[5];
          } else {
            remoteStates.set(id, { p: [s[0], s[1], s[2]], yaw: s[3], speed: s[4], boost: !!s[5] });
          }
        }
        break;
      }
      case 'coin':
        store.coinTaken(msg);
        break;
      case 'steal':
        store.steal(msg);
        break;
      case 'tagged':
        store.tagged(msg);
        break;
      case 'crown':
        store.crownUpdate(msg);
        break;
      case 'gate':
        store.gatePassed(msg);
        break;
      case 'scores':
        store.mergeScores(msg.scores);
        break;
      case 'win':
        store.roundWon(msg);
        break;
      case 'reset':
        store.roundReset(msg);
        break;
    }
  };

  ws.onclose = () => {
    stopSending();
    remoteStates.clear();
    useStore.getState().disconnected();
  };
}

function startSending() {
  stopSending();
  sendTimer = setInterval(() => {
    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          t: 'state',
          p: [+localState.p[0].toFixed(2), +localState.p[1].toFixed(2), +localState.p[2].toFixed(2)],
          y: +localState.yaw.toFixed(3),
          s: +localState.speed.toFixed(1),
          b: localState.boost,
        })
      );
    }
  }, 50);
}

function stopSending() {
  if (sendTimer) clearInterval(sendTimer);
  sendTimer = null;
}

const bumpSent = new Map(); // id -> last sent timestamp (client-side throttle)

export function sendBump(targetId) {
  const now = performance.now();
  if ((bumpSent.get(targetId) || 0) > now - 1500) return;
  bumpSent.set(targetId, now);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'bump', target: targetId }));
}

let portalSent = 0;

export function sendPortal(to) {
  const now = performance.now();
  if (now - portalSent < 1200) return;
  portalSent = now;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'portal', to }));
}
