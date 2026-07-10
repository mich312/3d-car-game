import { create } from 'zustand';
import { MODES, CAR_TYPES, DEFAULT_CAR } from '../shared/config.js';

let feedId = 1;
let bannerTimer = null;

// --- persistent garage (per browser) ---
const loadJSON = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const savedOwned = loadJSON('nr-owned', [DEFAULT_CAR]).filter((id) => CAR_TYPES[id]);
const owned = savedOwned.length ? savedOwned : [DEFAULT_CAR];
const savedCar = localStorage.getItem('nr-cartype');
const startCar = owned.includes(savedCar) ? savedCar : DEFAULT_CAR;

export const useStore = create((set, get) => ({
  phase: 'lobby', // 'lobby' | 'playing' | 'disconnected'
  myId: null,
  players: {}, // id -> { id, name, color, bot } (roster; positions live in net.remoteStates)
  scores: {}, // id -> mode-specific score (coins / crown pts / gates passed)
  coins: [], // [{ id, x, z }]
  mode: 'hub', // 'hub' or a minigame: 'coins' | 'tag' | 'crown' | 'race'
  roomEpoch: 0, // bumped on each room switch so PlayerCar hard-teleports
  portalCounts: {}, // game -> number of humans inside (hub portal signs)
  infected: [], // tag: player ids
  crown: { holder: null, x: 0, z: 0 },
  timeLeft: 0,
  banner: null, // { title, desc } shown at round start
  winner: null, // { id, name } while the round-over banner is up
  feed: [], // [{ id, text, tone }]
  // HUD values pushed from the local car at a throttled rate
  hudSpeed: 0,
  hudNitro: 100,

  // --- garage / economy (persists in localStorage) ---
  wallet: Number(localStorage.getItem('nr-wallet')) || 0,
  ownedCars: owned,
  carType: startCar,
  roundEarned: 0, // accumulates quietly, toasted at round end

  // --- crash flash + stunt records ---
  impactNonce: 0, // bumped on hard hits; HUD keys a red flash off it
  bestAir: Number(localStorage.getItem('nr-best-air')) || 0, // personal, seconds
  bestJump: Number(localStorage.getItem('nr-best-jump')) || 0, // personal, meters
  airRecord: null, // { name, air } — server-wide, from the hub

  impact: () => set((s) => ({ impactNonce: s.impactNonce + 1 })),

  landJump: (airTime, dist) => {
    const s = get();
    const airR = Math.round(airTime * 10) / 10;
    const d = Math.round(dist);
    s.pushFeed(`✈️ ${airR}s air · ${d}m jump!`, 'good');
    s.earn(Math.min(8, Math.max(1, Math.round(airTime * 2))), 'stunt air');
    let improved = false;
    if (airR > s.bestAir) {
      localStorage.setItem('nr-best-air', String(airR));
      set({ bestAir: airR });
      improved = true;
    }
    if (d > s.bestJump) {
      localStorage.setItem('nr-best-jump', String(d));
      set({ bestJump: d });
      improved = true;
    }
    if (improved) s.pushFeed('🏅 new personal best!', 'gold');
  },

  setAirRecord: (rec, announce = false) => {
    if (!rec || !rec.name || !(rec.air > 0)) return;
    set({ airRecord: { name: rec.name, air: rec.air } });
    if (announce) get().pushFeed(`🏆 ${rec.name} set the AIR RECORD — ${rec.air}s!`, 'gold');
  },

  earn: (n, why = null) => {
    const wallet = get().wallet + n;
    localStorage.setItem('nr-wallet', String(wallet));
    set((s) => ({ wallet, roundEarned: s.roundEarned + n }));
    if (why) get().pushFeed(`+${n} 🪙 ${why}`, 'gold');
  },

  buyCar: (id) => {
    const t = CAR_TYPES[id];
    const s = get();
    if (!t || s.ownedCars.includes(id) || s.wallet < t.price) return;
    const wallet = s.wallet - t.price;
    const ownedCars = [...s.ownedCars, id];
    localStorage.setItem('nr-wallet', String(wallet));
    localStorage.setItem('nr-owned', JSON.stringify(ownedCars));
    localStorage.setItem('nr-cartype', id);
    set({ wallet, ownedCars, carType: id });
  },

  selectCar: (id) => {
    if (!get().ownedCars.includes(id)) return;
    localStorage.setItem('nr-cartype', id);
    set({ carType: id });
  },

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

  setPortalCounts: (portalCounts) => set({ portalCounts }),

  init: ({ id, players, coins, mode, data }) => {
    const roster = {};
    const scores = {};
    for (const p of players) {
      roster[p.id] = { id: p.id, name: p.name, color: p.color, car: p.car, bot: p.bot };
      scores[p.id] = p.score;
    }
    set((s) => ({ phase: 'playing', myId: id, players: roster, scores, coins, roomEpoch: s.roomEpoch + 1 }));
    get().applyModeState(mode, data);
    get().showBanner(mode);
  },

  applyRoom: ({ mode, players, coins, data }) => {
    const roster = {};
    const scores = {};
    for (const p of players) {
      roster[p.id] = { id: p.id, name: p.name, color: p.color, car: p.car, bot: p.bot };
      scores[p.id] = p.score;
    }
    set((s) => ({
      players: roster,
      scores,
      coins,
      winner: null,
      timeLeft: 0,
      roomEpoch: s.roomEpoch + 1,
    }));
    get().applyModeState(mode, data);
    get().showBanner(mode);
    get().pushFeed(mode === 'hub' ? 'Back in the open world' : `Entered ${mode.toUpperCase()} arena`, 'good');
  },

  playerJoined: (p) => {
    set((s) => ({
      players: { ...s.players, [p.id]: { id: p.id, name: p.name, color: p.color, car: p.car, bot: p.bot } },
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
    if (by === get().myId) get().earn(1);
  },

  steal: ({ from, to, scores }) => {
    const s = get();
    const thief = s.players[to]?.name || '???';
    const victim = s.players[from]?.name || '???';
    if (from === s.myId) s.pushFeed(`${thief} rammed you and stole a coin!`, 'bad');
    else if (to === s.myId) s.pushFeed(`You stole a coin from ${victim}!`, 'good');
    else s.pushFeed(`${thief} stole a coin from ${victim}`);
    set((st) => ({ scores: { ...st.scores, ...scores } }));
    if (to === s.myId) get().earn(1);
  },

  tagged: ({ id, by }) => {
    const s = get();
    if (by === s.myId) s.earn(3);
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
    if (id === get().myId) get().earn(2);
  },

  mergeScores: (scores) => {
    const s = get();
    const mine = scores[s.myId];
    if (typeof mine === 'number' && mine > (s.scores[s.myId] || 0)) {
      s.earn(mine - (s.scores[s.myId] || 0));
    }
    set((st) => ({ scores: { ...st.scores, ...scores } }));
  },

  roundWon: ({ id, name }) => {
    set({ winner: { id, name } });
    if (id === get().myId) get().earn(25, 'round win!');
  },

  roundReset: ({ coins, players, mode, data }) => {
    const earned = get().roundEarned;
    if (earned > 0) get().pushFeed(`+${earned} 🪙 earned that round`, 'gold');
    const scores = {};
    for (const p of players) scores[p.id] = p.score;
    set({ coins, scores, winner: null, roundEarned: 0 });
    get().applyModeState(mode, data);
    get().showBanner(mode);
  },

  disconnected: () => set({ phase: 'disconnected' }),
}));
