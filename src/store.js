import { create } from 'zustand';
import { WIN_SCORE } from '../shared/config.js';

let feedId = 1;

export const useStore = create((set, get) => ({
  phase: 'lobby', // 'lobby' | 'playing' | 'disconnected'
  myId: null,
  winScore: WIN_SCORE,
  players: {}, // id -> { id, name, color, bot } (roster; positions live in net.remoteStates)
  scores: {}, // id -> coin count
  coins: [], // [{ id, x, z }]
  winner: null, // { id, name } while the round-over banner is up
  feed: [], // [{ id, text, tone }]
  // HUD values pushed from the local car at a throttled rate
  hudSpeed: 0,
  hudNitro: 100,

  setHud: (hudSpeed, hudNitro) => set({ hudSpeed, hudNitro }),

  pushFeed: (text, tone = 'info') => {
    const entry = { id: feedId++, text, tone };
    set((s) => ({ feed: [...s.feed.slice(-4), entry] }));
    setTimeout(() => {
      set((s) => ({ feed: s.feed.filter((f) => f.id !== entry.id) }));
    }, 5000);
  },

  init: ({ id, players, coins, winScore }) => {
    const roster = {};
    const scores = {};
    for (const p of players) {
      roster[p.id] = { id: p.id, name: p.name, color: p.color, bot: p.bot };
      scores[p.id] = p.score;
    }
    set({ phase: 'playing', myId: id, players: roster, scores, coins, winScore });
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
      return { players, scores };
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

  roundWon: ({ id, name }) => set({ winner: { id, name } }),

  roundReset: ({ coins, players }) => {
    const scores = {};
    for (const p of players) scores[p.id] = p.score;
    set({ coins, scores, winner: null });
  },

  disconnected: () => set({ phase: 'disconnected' }),
}));
