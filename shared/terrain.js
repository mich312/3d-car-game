// Deterministic, dependency-free terrain math for the hub world.
// Shared by every client (and importable by the server) so the "infinite"
// procedurally generated world is identical for all players — same seed,
// same hash, same mountains.

export const TERRAIN_SEED = 20260709;
export const CHUNK_SIZE = 64; // world units per chunk
export const CHUNK_RES = 32; // quads per chunk side
export const VIEW_CHUNKS = 4; // chunk ring radius streamed around the player
export const WATER_LEVEL = -2;
export const PLAZA_RADIUS = 55; // flat neon plaza around the spawn
export const PLAZA_HEIGHT = 2;
export const HUB_LIMIT = 2048; // soft world edge the server clamps to

// --- noise ------------------------------------------------------------------

// Integer bit-mix hash -> [0, 1). Stable across JS engines (no trig tricks).
function hash2(ix, iz) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ TERRAIN_SEED) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  return lerp(
    lerp(hash2(ix, iz), hash2(ix + 1, iz), fx),
    lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), fx),
    fz
  );
}

export function fbm(x, z, octaves = 4, gain = 0.5, lacunarity = 2) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, z) * amp;
    norm += amp;
    amp *= gain;
    x = x * lacunarity + 31.7;
    z = z * lacunarity - 17.3;
  }
  return sum / norm; // 0..1
}

const smoothstep = (a, b, t) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

// --- height field ------------------------------------------------------------

export function terrainHeight(x, z) {
  // big mountain masses, exponent sharpens the peaks
  const m = fbm(x * 0.0035, z * 0.0035, 5);
  const mountains = Math.pow(m, 2.3) * 92;
  // rolling hills on top
  const hills = fbm(x * 0.016 + 100, z * 0.016 - 70, 3) * 7;
  // shallow basins so lakes form below WATER_LEVEL
  let h = mountains + hills - 7;
  // flatten a plaza at the spawn for the portal ring
  const d = Math.hypot(x, z);
  const flat = smoothstep(PLAZA_RADIUS + 10, PLAZA_RADIUS + 90, d);
  return h * flat + PLAZA_HEIGHT * (1 - flat);
}

// Seamless analytic-ish normal via central differences (used for chunk
// normals too, so chunk borders never show a lighting seam).
export function terrainNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
  const e = 1.2;
  const nx = terrainHeight(x - e, z) - terrainHeight(x + e, z);
  const nz = terrainHeight(x, z - e) - terrainHeight(x, z + e);
  const ny = 2 * e;
  const len = Math.hypot(nx, ny, nz) || 1;
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
  return out;
}

// Downhill pull used by car physics: gradient of the height field.
export function terrainGradient(x, z, out = { x: 0, z: 0 }) {
  const e = 1.2;
  out.x = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  out.z = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  return out;
}

// --- biome colors -------------------------------------------------------------

const C = {
  sandLo: [0.76, 0.68, 0.46],
  sandHi: [0.85, 0.78, 0.55],
  grassLo: [0.16, 0.5, 0.3],
  grassHi: [0.3, 0.65, 0.34],
  rock: [0.4, 0.42, 0.5],
  snow: [0.92, 0.95, 1.0],
  seabed: [0.2, 0.35, 0.42],
};

const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function biomeColor(h, slopeY, x, z) {
  const jitter = hash2(Math.floor(x * 3.7), Math.floor(z * 3.7)) * 0.5 + 0.5; // 0.5..1
  let c;
  if (h < WATER_LEVEL - 1.5) c = C.seabed;
  else if (h < WATER_LEVEL + 2.2) c = mix(C.sandLo, C.sandHi, jitter);
  else if (h > 42) c = C.snow;
  else {
    c = mix(C.grassLo, C.grassHi, jitter);
    if (h > 30) c = mix(c, C.snow, smoothstep(30, 42, h) * 0.7);
  }
  // steep faces read as bare rock
  if (slopeY < 0.78 && h > WATER_LEVEL + 1) {
    c = mix(c, C.rock, smoothstep(0.78, 0.6, slopeY));
  }
  return c;
}

// --- chunk geometry data --------------------------------------------------------

// Returns plain typed arrays for one chunk; the client wraps them into a
// three.js BufferGeometry. Normals come from the height field, so adjacent
// chunks shade seamlessly.
export function buildChunkData(cx, cz) {
  const n = CHUNK_RES + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const step = CHUNK_SIZE / CHUNK_RES;
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const nrm = { x: 0, y: 1, z: 0 };

  let i = 0;
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const x = x0 + gx * step;
      const z = z0 + gz * step;
      const h = terrainHeight(x, z);
      positions[i] = x;
      positions[i + 1] = h;
      positions[i + 2] = z;
      terrainNormal(x, z, nrm);
      normals[i] = nrm.x;
      normals[i + 1] = nrm.y;
      normals[i + 2] = nrm.z;
      const c = biomeColor(h, nrm.y, x, z);
      colors[i] = c[0];
      colors[i + 1] = c[1];
      colors[i + 2] = c[2];
      i += 3;
    }
  }

  const indices = new Uint32Array(CHUNK_RES * CHUNK_RES * 6);
  let j = 0;
  for (let gz = 0; gz < CHUNK_RES; gz++) {
    for (let gx = 0; gx < CHUNK_RES; gx++) {
      const a = gz * n + gx;
      const b = a + 1;
      const c2 = a + n;
      const d = c2 + 1;
      indices[j++] = a;
      indices[j++] = c2;
      indices[j++] = b;
      indices[j++] = b;
      indices[j++] = c2;
      indices[j++] = d;
    }
  }
  return { positions, normals, colors, indices };
}

// --- decorations ------------------------------------------------------------------

// Deterministic props per chunk: trees on gentle grass, rocks anywhere dry,
// rare glowing crystals. Returned as plain transform lists for instancing.
export function decorationsForChunk(cx, cz) {
  const trees = [];
  const rocks = [];
  const crystals = [];
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const nrm = { x: 0, y: 1, z: 0 };
  const ATTEMPTS = 26;
  for (let i = 0; i < ATTEMPTS; i++) {
    const rx = hash2(cx * 131 + i * 7, cz * 173 + i * 13);
    const rz = hash2(cx * 197 - i * 11, cz * 139 + i * 17);
    const kind = hash2(cx * 89 + i * 29, cz * 83 - i * 23);
    const x = x0 + rx * CHUNK_SIZE;
    const z = z0 + rz * CHUNK_SIZE;
    if (Math.hypot(x, z) < PLAZA_RADIUS + 30) continue; // keep the plaza clean
    const h = terrainHeight(x, z);
    if (h < WATER_LEVEL + 1.5) continue;
    terrainNormal(x, z, nrm);
    const s = 0.7 + hash2(i * 37 + cx, i * 41 + cz) * 0.9;
    if (kind < 0.55 && h < 32 && nrm.y > 0.88) trees.push({ x, y: h, z, s });
    else if (kind < 0.9 && nrm.y > 0.7) rocks.push({ x, y: h, z, s });
    else if (kind >= 0.97) crystals.push({ x, y: h, z, s: s * 1.4 });
  }
  return { trees, rocks, crystals };
}
