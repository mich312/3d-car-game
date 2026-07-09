import { create } from 'zustand';
import { MODES } from '../shared/config.js';

let feedId = 1;
let bannerTimer = null;

export const useStore = create((set, get) => ({
  phase: 'lobby', // 'lobby' | 'playing' | 'disconnected'
  myId: null,
  players: {}, // id -> { id, name, color, bot } (roster; positions live in net.remoteStates)
  scores: {}, // id -> mode-specific score (coins / crown pts / gates passed)
  coins: [], // [{ id, x, z }]
  mode: 'coins',
  infected: [], // tag: player ids
  crown: { holder: null, x: 0, z: 0 },
  timeLeft: 0,
  banner: null, // { title, desc } shown at round start
  winner: null, // { id, name } while the round-over banner is up
  feed: [], // [{ id, text, tone }]
  // HUD values pushed from the local car at a throttled rate
  hudSpeed: 0,
  hudNitro: 100,

  setHud: (hudSpeed, hudNitro) => set({ hudSpeed, hudNitro }),
  setTimeLeft: (timeLeft) => set({ timeLeft }),

  pushFeed: (text, tone = 'info') => {
    const entry = { id: feedId++, text, tone };
    set((s) => ({ feed: [...s.feed.slice(-4), entry] }));
    setTimeout(() => {
      set((s) => ({ feed: s.feed.filter((f) => f.id !== entry.id) }));
    }, 5000);
  },

  showBanner: (mode) => {
    const m = MODES[mode];
    if (!m) return;
    clearTimeout(bannerTimer);
    set({ banner: { title: m.name, desc: m.desc } });
    bannerTimer = setTimeout(() => set({ banner: null }), 5500);
  },

  applyModeState: (mode, data) => {
    set({
      mode,
      infected: data?.infected ?? [],
      crown: data?.crown ?? { holder: null, x: 0, z: 0 },
    });
  },

  init: ({ id, players, coins, mode, data }) => {
    const roster = {};
    const scores = {};
    for (const p of players) {
      roster[p.id] = { id: p.id, name: p.name, color: p.color, bot: p.bot };
      scores[p.id] = p.score;
    }
    set({ phase: 'playing', myId: id, players: roster, scores, coins });
    get().applyModeState(mode, data);
    get().showBanner(mode);
  },

  playerJoined: (p) => {
    set((s) => ({
      players: { ...s.players, [p.id]: { id: p.id, name: p.name, color: p.color, bot: p.bot } },
      scores: { ...s.scores, [p.id]: p.score },
    }));
    get().pushFeed(`${p.name} joined the rumble`);
  },

  playerLeft: (id) => {
    set((s) => {
      const players = { ...s.players };
      const scores = { ...s.scores };
      const name = players[id]?.name;
      delete players[id];
      delete scores[id];
      if (name) get().pushFeed(`${name} left`);
      return { players, scores, infected: s.infected.filter((i) => i !== id) };
    });
  },

  coinTaken: ({ id, by, coin, score }) => {
    set((s) => ({
      coins: s.coins.map((c) => (c.id === id ? coin : c)),
      scores: { ...s.scores, [by]: score },
    }));
  },

  steal: ({ from, to, scores }) => {
    const s = get();
    const thief = s.players[to]?.name || '???';
    const victim = s.players[from]?.name || '???';
    if (from === s.myId) s.pushFeed(`${thief} rammed you and stole a coin!`, 'bad');
    else if (to === s.myId) s.pushFeed(`You stole a coin from ${victim}!`, 'good');
    else s.pushFeed(`${thief} stole a coin from ${victim}`);
    set((st) => ({ scores: { ...st.scores, ...scores } }));
  },

  tagged: ({ id }) => {
    const s = get();
    const name = s.players[id]?.name || '???';
    if (id === s.myId) s.pushFeed('You got infected! Spread it!', 'bad');
    else s.pushFeed(`${name} got infected!`);
    set((st) => ({ infected: [...st.infected, id] }));
  },

  crownUpdate: ({ holder, x, z }) => {
    const s = get();
    if (holder) {
      const name = s.players[holder]?.name || '???';
      if (holder === s.myId) s.pushFeed('You have the crown! Run!', 'good');
      else s.pushFeed(`${name} took the crown!`);
      set({ crown: { holder, x: 0, z: 0 } });
    } else {
      set({ crown: { holder: null, x: x ?? 0, z: z ?? 0 } });
    }
  },

  gatePassed: ({ id, n }) => {
    set((s) => ({ scores: { ...s.scores, [id]: n } }));
  },

  mergeScores: (scores) => set((s) => ({ scores: { ...s.scores, ...scores } })),

  roundWon: ({ id, name }) => set({ winner: { id, name } }),

  roundReset: ({ coins, players, mode, data }) => {
    const scores = {};
    for (const p of players) scores[p.id] = p.score;
    set({ coins, scores, winner: null });
    get().applyModeState(mode, data);
    get().showBanner(mode);
  },

  disconnected: () => set({ phase: 'disconnected' }),
}));
