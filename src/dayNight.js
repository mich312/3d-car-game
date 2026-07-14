import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Day & night cycle
//
// One clock drives everything: sun angle, light colors/intensities, fog,
// stars, and the sky cubemap. Every consumer derives the same `dayT` from the
// shared r3f clock (`dayTime(clock.elapsedTime)`), so nothing needs to be
// stored or synced — they all agree frame to frame, hub and arena alike.
//
// dayT runs 0..1 over one full cycle:
//   0.00 sunrise (east horizon) · 0.25 noon (overhead) ·
//   0.50 sunset (west horizon)  · 0.75 midnight (sun below)
// ---------------------------------------------------------------------------

export const DAY_LENGTH = 150; // seconds for a complete sunrise→sunrise cycle
const START_DAYT = 0.14; // begin mid-morning so the first frame is bright

export function dayTime(elapsed) {
  return (elapsed / DAY_LENGTH + START_DAYT) % 1;
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Colour anchors reused across the cycle.
const C = {
  sunHorizon: new THREE.Color('#ff7a2f'),
  sunNoon: new THREE.Color('#fff3da'),
  ambNight: new THREE.Color('#26355f'),
  ambDay: new THREE.Color('#a8bcff'),
  hemiSkyNight: new THREE.Color('#141d44'),
  hemiSkyDay: new THREE.Color('#8fb0ff'),
  hemiGolden: new THREE.Color('#ffb178'),
  hemiGround: new THREE.Color('#2a2148'),
  fogNight: new THREE.Color('#070b20'),
  fogDay: new THREE.Color('#7c9bd0'),
  fogGolden: new THREE.Color('#c98a6a'),
};

/** Allocate a reusable sample object (call once per consumer, then mutate). */
export function createSkySample() {
  return {
    sun: new THREE.Vector3(1, 0, 0.25),
    dayFactor: 1,
    golden: 0,
    sunColor: new THREE.Color(),
    sunIntensity: 1,
    ambColor: new THREE.Color(),
    ambIntensity: 0.5,
    hemiSky: new THREE.Color(),
    hemiGround: C.hemiGround.clone(),
    hemiIntensity: 0.7,
    fogColor: new THREE.Color(),
    starOpacity: 0,
  };
}

/**
 * Fill `out` with the sky state for time-of-day `dayT` (0..1). Pure aside from
 * writing into the caller-owned `out`, so it's safe to call every frame.
 */
export function sampleSky(dayT, out) {
  const a = dayT * Math.PI * 2;
  const sunY = Math.sin(a); // +1 noon, -1 midnight

  // Sun sweeps east→up→west along a gently tilted arc.
  out.sun.set(Math.cos(a), sunY, 0.28).normalize();

  const day = smoothstep(-0.06, 0.14, sunY); // 0 night → 1 daylight
  const high = smoothstep(0.0, 0.55, sunY); // 0 horizon → 1 overhead
  const golden = day * (1 - high); // warm glow while the sun hugs the horizon

  out.dayFactor = day;
  out.golden = golden;

  out.sunColor.lerpColors(C.sunHorizon, C.sunNoon, high);
  out.sunIntensity = day * (0.95 + 0.8 * high);

  out.ambColor.lerpColors(C.ambNight, C.ambDay, day);
  out.ambIntensity = 0.09 + 0.29 * day;

  out.hemiSky.lerpColors(C.hemiSkyNight, C.hemiSkyDay, day).lerp(C.hemiGolden, golden * 0.6);
  out.hemiIntensity = 0.16 + 0.34 * day;

  out.fogColor.lerpColors(C.fogNight, C.fogDay, day).lerp(C.fogGolden, golden * 0.6);

  out.starOpacity = clamp(1 - day * 1.25, 0, 1);
  return out;
}
