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

// Neon Heights: a flattened city district east of the plaza, reached by a
// highway carved through the mountains.
export const CITY = { x: 300, z: 0, r: 100, h: 3.5 };
// Ring road circling the plaza — the stunt ramps sit on it.
export const RING_ROAD = { r: 85, w: 9 };
// Crystal Grotto: a hidden hollow west of the plaza, reached through a
// narrow cave pass under the mountains. Packed with charging crystals.
export const GROTTO = { x: -230, z: 0, r: 50, h: 4 };
// Highway sprint: cross the start gate east of the plaza, first to the city
// spire wins. The server times it and keeps the record.
export const TRIAL = { start: { x: 52, z: 0, r: 9 }, finishR: 22 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));

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
  h = h * flat + PLAZA_HEIGHT * (1 - flat);
  // flatten the city district
  const dc = Math.hypot(x - CITY.x, z - CITY.z);
  const flatC = smoothstep(CITY.r, CITY.r + 70, dc);
  h = h * flatC + CITY.h * (1 - flatC);
  // carve the highway corridor between plaza and city — mountain walls stay
  // on both sides, so the drive reads as a canyon pass
  if (x > -10 && x < CITY.x + 40 && Math.abs(z) < 60) {
    const across = smoothstep(16, 55, Math.abs(z)); // 0 on the road, 1 off it
    const along = smoothstep(-10, 30, x) * (1 - smoothstep(CITY.x, CITY.x + 40, x));
    const corridor = 1 - (1 - across) * along;
    const roadH = PLAZA_HEIGHT + (CITY.h - PLAZA_HEIGHT) * clamp01(x / CITY.x);
    h = h * corridor + roadH * (1 - corridor);
  }
  // a narrower pass west toward the grotto — tight enough that the tall
  // sections read as a cave once the arches are on top
  if (x < 10 && x > GROTTO.x - 40 && Math.abs(z) < 55) {
    const across = smoothstep(7, 26, Math.abs(z));
    const along = smoothstep(-10, 30, -x) * (1 - smoothstep(-GROTTO.x, -GROTTO.x + 40, -x));
    const corridor = 1 - (1 - across) * along;
    const roadH = PLAZA_HEIGHT + (GROTTO.h - PLAZA_HEIGHT) * clamp01(x / GROTTO.x);
    h = h * corridor + roadH * (1 - corridor);
  }
  // the grotto hollow itself
  const dg = Math.hypot(x - GROTTO.x, z - GROTTO.z);
  const flatG = smoothstep(GROTTO.r, GROTTO.r + 45, dg);
  return h * flatG + GROTTO.h * (1 - flatG);
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

// --- stunt ramps --------------------------------------------------------------

// Wedges the physics treats as extra ground: anchored at the low edge center,
// rising to `h` over length `l` along `yaw` (forward = [sin yaw, cos yaw]),
// `w` wide. Six ride the ring road; two mega kickers launch off the highway
// and the plaza's north edge.
const RING_RAMP_SIZES = [
  { l: 11, w: 9, h: 4.2 }, // kicker — needs some speed to clock a record
  { l: 14, w: 10, h: 6 }, // launcher
];
const rampDefs = [];
for (let i = 0; i < 6; i++) {
  const a = i * (Math.PI / 3) + 0.85; // offset keeps them clear of the highway junction
  // one of the six is a mega ramp; jumps launch along the ring where the
  // ground stays low (everything pointing away from the plaza lands uphill)
  const size = i === 2 ? { l: 26, w: 12, h: 11 } : RING_RAMP_SIZES[i % 2];
  rampDefs.push({
    x: Math.sin(a) * RING_ROAD.r,
    z: Math.cos(a) * RING_ROAD.r,
    yaw: a + Math.PI / 2, // tangent to the ring — jumps chain as you lap it
    ...size,
  });
}
rampDefs.push({ x: 150, z: 0, yaw: Math.PI / 2, l: 24, w: 11, h: 9 }); // highway canyon jump

export const RAMPS = rampDefs.map((r) => ({
  ...r,
  baseY: terrainHeight(r.x, r.z),
  sin: Math.sin(r.yaw),
  cos: Math.cos(r.yaw),
}));

// Highest ramp under (x, z), or null. `out.h` is the surface height there.
function rampAt(x, z, out) {
  let best = null;
  let bestH = -Infinity;
  for (const r of RAMPS) {
    const dx = x - r.x;
    const dz = z - r.z;
    const u = dx * r.sin + dz * r.cos; // along the ramp
    if (u < 0 || u > r.l) continue;
    const v = dx * r.cos - dz * r.sin; // across
    if (Math.abs(v) > r.w / 2) continue;
    const h = r.baseY + (u / r.l) * r.h;
    if (h > bestH) {
      bestH = h;
      best = r;
    }
  }
  if (best) out.h = bestH;
  return best;
}

const _ramp = { h: 0 };

// Roof height under (x, z), or -Infinity when not over a building.
export function roofAt(x, z) {
  const dcx = x - CITY.x;
  const dcz = z - CITY.z;
  if (dcx * dcx + dcz * dcz > (CITY.r + 5) ** 2) return -Infinity;
  for (const b of BUILDINGS) {
    if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) {
      return CITY.h - 0.3 + b.h;
    }
  }
  return -Infinity;
}

// The surface cars actually drive on in the hub: terrain OR a ramp on top.
// Pass the car's y to also land on rooftops — a roof only counts as ground
// once you're falling onto it, so street-level driving still hits the
// building walls instead of teleporting up.
export function hubHeight(x, z, y) {
  const t = terrainHeight(x, z);
  const r = rampAt(x, z, _ramp);
  let h = r && _ramp.h > t ? _ramp.h : t;
  if (y !== undefined) {
    const rf = roofAt(x, z);
    if (rf > h && y >= rf - 2) h = rf;
  }
  return h;
}

export function hubGradient(x, z, out = { x: 0, z: 0 }) {
  const t = terrainHeight(x, z);
  const r = rampAt(x, z, _ramp);
  if (r && _ramp.h > t) {
    // analytic slope of the wedge — constant along, zero across
    out.x = (r.h / r.l) * r.sin;
    out.z = (r.h / r.l) * r.cos;
    return out;
  }
  return terrainGradient(x, z, out);
}

const _g = { x: 0, z: 0 };

export function hubNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
  hubGradient(x, z, _g);
  const len = Math.hypot(_g.x, 1, _g.z) || 1;
  out.x = -_g.x / len;
  out.y = 1 / len;
  out.z = -_g.z / len;
  return out;
}

// --- Neon Heights buildings -----------------------------------------------------

// Deterministic grid of towers with jitter; gaps form a main street (along x)
// and a cross street. Axis-aligned so car collision is a cheap circle-vs-AABB.
function makeCity() {
  const list = [];
  const grid = 24;
  const n = Math.ceil(CITY.r / grid);
  for (let gx = -n; gx <= n; gx++) {
    for (let gz = -n; gz <= n; gz++) {
      const bx = CITY.x + gx * grid + (hash2(gx * 3 + 7, gz * 5 + 1) - 0.5) * 7;
      const bz = CITY.z + gz * grid + (hash2(gx * 11 - 3, gz * 13 + 9) - 0.5) * 7;
      const dc = Math.hypot(bx - CITY.x, bz - CITY.z);
      if (dc > CITY.r - 12 || dc < 20) continue; // skyline edge + central plaza
      if (Math.abs(bz - CITY.z) < 13) continue; // main street
      if (Math.abs(bx - CITY.x) < 11) continue; // cross street
      const r1 = hash2(gx * 17 + 5, gz * 19 - 7);
      const r2 = hash2(gx * 23 - 1, gz * 29 + 3);
      list.push({
        x: bx,
        z: bz,
        w: 9 + r1 * 6,
        d: 9 + r2 * 6,
        h: 10 + r2 * 14 + (1 - dc / CITY.r) * 26 + r1 * 8, // taller downtown
        tone: Math.floor(r1 * 4) % 4,
        axis: r2 > 0.5 ? 1 : 0, // which faces get the window strip
      });
    }
  }
  return list;
}
export const BUILDINGS = makeCity();

// Collectible gems on the three tallest towers — reward for rooftop jumps.
export const ROOF_GEMS = [...BUILDINGS]
  .sort((a, b) => b.h - a.h)
  .slice(0, 3)
  .map((b) => ({ x: b.x, z: b.z, y: CITY.h - 0.3 + b.h + 1.3 }));

// Stone arches over the deep sections of the west pass — they turn the
// canyon into a tunnel. Client renders them; no physics (open at car level).
export const TUNNEL_ARCHES = (() => {
  const arches = [];
  for (let x = -56; x >= GROTTO.x + GROTTO.r - 4; x -= 8) {
    const wall = Math.min(terrainHeight(x, -24), terrainHeight(x, 24));
    if (wall > 11) arches.push({ x, y: terrainHeight(x, 0) });
  }
  return arches;
})();

// --- biome colors -------------------------------------------------------------

const C = {
  sandLo: [0.76, 0.68, 0.46],
  sandHi: [0.85, 0.78, 0.55],
  grassLo: [0.16, 0.5, 0.3],
  grassHi: [0.3, 0.65, 0.34],
  rock: [0.4, 0.42, 0.5],
  snow: [0.92, 0.95, 1.0],
  seabed: [0.2, 0.35, 0.42],
  pavement: [0.16, 0.18, 0.3],
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
  // the city district floor is paved
  const dc = Math.hypot(x - CITY.x, z - CITY.z);
  if (dc < CITY.r + 14) {
    c = mix(c, C.pavement, (1 - smoothstep(CITY.r - 6, CITY.r + 14, dc)) * (0.75 + jitter * 0.2));
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
    const d = Math.hypot(x, z);
    if (d < PLAZA_RADIUS + 30) continue; // keep the plaza clean
    if (Math.abs(d - RING_ROAD.r) < 10) continue; // ...and the ring road
    if (Math.hypot(x - CITY.x, z - CITY.z) < CITY.r + 20) continue; // ...and the city
    if (x > 20 && x < CITY.x && Math.abs(z) < 24) continue; // ...and the highway
    const inGrotto = Math.hypot(x - GROTTO.x, z - GROTTO.z) < GROTTO.r;
    if (!inGrotto && x < -20 && x > GROTTO.x && Math.abs(z) < 16) continue; // cave road
    if (RAMPS.some((r) => (x - r.x) ** 2 + (z - r.z) ** 2 < 26 * 26)) continue;
    const h = terrainHeight(x, z);
    if (h < WATER_LEVEL + 1.5) continue;
    terrainNormal(x, z, nrm);
    const s = 0.7 + hash2(i * 37 + cx, i * 41 + cz) * 0.9;
    if (inGrotto) {
      // the grotto is a crystal field — no trees, lots of glow
      if (kind >= 0.4) crystals.push({ x, y: h, z, s: s * 1.5 });
      else if (nrm.y > 0.7) rocks.push({ x, y: h, z, s });
      continue;
    }
    if (kind < 0.55 && h < 32 && nrm.y > 0.88) trees.push({ x, y: h, z, s });
    else if (kind < 0.9 && nrm.y > 0.7) rocks.push({ x, y: h, z, s });
    else if (kind >= 0.97) crystals.push({ x, y: h, z, s: s * 1.4 });
  }
  return { trees, rocks, crystals };
}
