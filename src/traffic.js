// Ambient traffic in Neon Heights: dummy cars looping the streets on
// stadium-shaped paths. Positions are a pure function of wall-clock time, so
// every client sees (roughly) the same traffic without any networking, and
// the local car can collide with them deterministically.

import { CITY } from '../shared/terrain.js';

// Stadium loop: two straights along the major axis joined by semicircles.
// hx/hz are the half-extents of the straight section's rectangle.
function stadium(hx, hz) {
  const alongX = hx >= hz;
  const L = 2 * (alongX ? hx : hz); // straight length
  const r = alongX ? hz : hx; // end radius
  const P = 2 * L + 2 * Math.PI * r;
  return { alongX, L, r, P };
}

const LOOPS = [
  { ...stadium(82, 5), hx: 82, hz: 5, speed: 13 }, // main street (east-west)
  { ...stadium(5, 82), hx: 5, hz: 82, speed: 11 }, // cross street (north-south)
];

export const TRAFFIC_CARS = [
  { loop: 0, phase: 0.0, color: '#f5a623' },
  { loop: 0, phase: 0.27, color: '#5bd1ff' },
  { loop: 0, phase: 0.55, color: '#c78bff' },
  { loop: 0, phase: 0.8, color: '#7dff9a' },
  { loop: 1, phase: 0.15, color: '#ff8fb3' },
  { loop: 1, phase: 0.65, color: '#ffe27d' },
];

export const TRAFFIC_RADIUS = 1.7;

// Position + heading of car i at time t (seconds). out = {x, z, yaw}.
export function trafficPos(i, t, out = { x: 0, z: 0, yaw: 0 }) {
  const car = TRAFFIC_CARS[i];
  const lp = LOOPS[car.loop];
  const s = (t * lp.speed + car.phase * lp.P) % lp.P;
  const { L, r, P } = lp;
  // local coords: u along the major axis, v across; then map to world
  let u;
  let v;
  let yawLocal; // 0 = +u
  if (s < L) {
    u = -L / 2 + s;
    v = r;
    yawLocal = 0;
  } else if (s < L + Math.PI * r) {
    const a = (s - L) / r; // 0..pi around the far end
    u = L / 2 + Math.sin(a) * r;
    v = Math.cos(a) * r;
    yawLocal = -a;
  } else if (s < 2 * L + Math.PI * r) {
    u = L / 2 - (s - L - Math.PI * r);
    v = -r;
    yawLocal = Math.PI;
  } else {
    const a = (s - 2 * L - Math.PI * r) / r;
    u = -L / 2 - Math.sin(a) * r;
    v = -Math.cos(a) * r;
    yawLocal = Math.PI - a;
  }
  if (lp.alongX) {
    out.x = CITY.x + u;
    out.z = CITY.z + v;
    // forward=(sin yaw, cos yaw); +u is world +x => yaw = pi/2 - yawLocal
    out.yaw = Math.PI / 2 - yawLocal;
  } else {
    out.x = CITY.x + v;
    out.z = CITY.z + u;
    out.yaw = yawLocal; // +u is world +z => yaw = yawLocal
  }
  return out;
}
