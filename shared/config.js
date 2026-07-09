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
export const HUB_PORTALS = [
  { game: 'coins', x: 0, z: 44, color: '#ffd23f', icon: '🪙' },
  { game: 'tag', x: 44, z: 0, color: '#39ff6a', icon: '🧟' },
  { game: 'crown', x: 0, z: -44, color: '#ff5db1', icon: '👑' },
  { game: 'race', x: -44, z: 0, color: '#3fd7ff', icon: '🏁' },
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
