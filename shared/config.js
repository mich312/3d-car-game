// Shared between the game server and the client so the world layout,
// pickup radii and rules always agree.

export const ARENA_HALF = 90; // arena is a square from -90..90 on x and z
export const WALL_HEIGHT = 5;
export const WIN_SCORE = 15; // first to this many coins wins the round
export const COIN_COUNT = 24;
export const COIN_RADIUS = 3.0; // pickup distance
export const CAR_RADIUS = 1.8; // collision sphere per car
export const PAD_RADIUS = 5; // boost pad trigger radius

// Cylindrical pillars scattered around the arena. {x, z, r}
export const OBSTACLES = [
  { x: 0, z: 0, r: 8 },
  { x: 48, z: 48, r: 6 },
  { x: -48, z: 48, r: 6 },
  { x: 48, z: -48, r: 6 },
  { x: -48, z: -48, r: 6 },
  { x: 0, z: 62, r: 4 },
  { x: 0, z: -62, r: 4 },
  { x: 62, z: 0, r: 4 },
  { x: -62, z: 0, r: 4 },
];

// Boost pads: drive over one to refill nitro and get launched along `angle`.
export const BOOST_PADS = [
  { x: 26, z: 0, angle: Math.PI / 2 },
  { x: -26, z: 0, angle: -Math.PI / 2 },
  { x: 0, z: 26, angle: 0 },
  { x: 0, z: -26, angle: Math.PI },
];

// --- Game modes -----------------------------------------------------------
// The server rotates through MODE_ORDER; each round is one mode. `time` is
// the round cap in seconds — when it expires the mode's timeout rule picks
// the winner.

export const MODES = {
  hub: {
    name: 'FREE ROAM',
    desc: 'Explore the endless world — drive into a portal to play a minigame.',
    time: 0,
  },
  coins: {
    name: 'COIN RUSH',
    desc: 'Grab coins — first to 15 wins. Ram rivals to steal!',
    winScore: 15,
    time: 180,
  },
  tag: {
    name: 'INFECTION',
    desc: 'The infected spread by touch. Last clean car wins!',
    time: 120,
  },
  crown: {
    name: 'CROWN KEEPER',
    desc: 'Hold the crown to score points. Bump the holder to snatch it!',
    winScore: 25,
    time: 120,
  },
  race: {
    name: 'GRAND PRIX',
    desc: 'Drive through the gates in order — 2 laps. First home wins!',
    laps: 2,
    time: 180,
  },
};

export const GAMES = ['coins', 'tag', 'crown', 'race'];

// Portal ring around the hub spawn plaza. Drive through one to join that
// minigame's room; a green exit ring inside each arena brings you back.
// Portals sit on the diagonals so the compass axes stay clear — the highway
// to Neon Heights runs east and the mega kicker launches north.
const PR = 44 / Math.SQRT2;
export const HUB_PORTALS = [
  { game: 'coins', x: PR, z: PR, color: '#ffd23f', icon: '🪙' },
  { game: 'tag', x: PR, z: -PR, color: '#39ff6a', icon: '🧟' },
  { game: 'crown', x: -PR, z: -PR, color: '#ff5db1', icon: '👑' },
  { game: 'race', x: -PR, z: PR, color: '#3fd7ff', icon: '🏁' },
];
export const PORTAL_RADIUS = 5;
export const ARENA_EXIT = { x: 0, z: -82 }; // in-arena ring back to the hub

// Race gates form a loop around the arena, clear of the pillars.
export const RACE_GATES = [
  { x: 0, z: 76 },
  { x: 65, z: 40 },
  { x: 76, z: -10 },
  { x: 35, z: -70 },
  { x: -40, z: -72 },
  { x: -76, z: -5 },
  { x: -68, z: 55 },
];
export const GATE_RADIUS = 9;

export const CROWN_SPAWN = { x: 0, z: -30 };
export const TAG_RADIUS = 4.2; // touch distance for infection / crown snatch

// --- Cars -------------------------------------------------------------------
// Bought with coins earned in any minigame (wallet persists in the browser).
// stats are multipliers on the base physics; shape drives the 3D model.

export const CAR_TYPES = {
  compact: {
    name: 'Compact',
    price: 0,
    desc: 'Balanced starter — reliable everywhere.',
    stats: { speed: 1, accel: 1, grip: 1, nitro: 1 },
    shape: { body: [1.9, 0.55, 4.1], wheelR: 0.42, cabinW: 1.5, ride: 0, spoiler: true },
  },
  muscle: {
    name: 'Muscle',
    price: 150,
    desc: 'Brutal acceleration off the line.',
    stats: { speed: 1.05, accel: 1.28, grip: 0.95, nitro: 1 },
    shape: { body: [2.2, 0.6, 4.4], wheelR: 0.46, cabinW: 1.7, ride: 0.03, scoop: true },
  },
  speedster: {
    name: 'Speedster',
    price: 300,
    desc: 'Slippery top-speed monster. Hold on.',
    stats: { speed: 1.2, accel: 1.05, grip: 0.82, nitro: 1.12 },
    shape: { body: [1.8, 0.42, 4.6], wheelR: 0.4, cabinW: 1.35, ride: -0.05, spoiler: true },
  },
  monster: {
    name: 'Monster',
    price: 550,
    desc: 'Giant wheels, grip for days — eats mountains.',
    stats: { speed: 0.92, accel: 1.12, grip: 1.35, nitro: 0.9 },
    shape: { body: [2.3, 0.7, 4.2], wheelR: 0.68, cabinW: 1.8, ride: 0.4 },
  },
  formula: {
    name: 'Formula X',
    price: 900,
    desc: 'The full package. Nothing else comes close.',
    stats: { speed: 1.26, accel: 1.22, grip: 1.15, nitro: 1.25 },
    shape: { body: [1.5, 0.4, 4.8], wheelR: 0.45, cabinW: 1.1, ride: -0.04, wing: true },
  },
};
export const DEFAULT_CAR = 'compact';

export const CAR_COLORS = [
  '#ff4757',
  '#1e90ff',
  '#2ed573',
  '#ffa502',
  '#a55eea',
  '#ff6b81',
  '#00d2d3',
  '#f9ca24',
];
