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
