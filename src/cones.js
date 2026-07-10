// Knockable traffic cones: a slalom on the highway and pairs marking every
// ramp lip. Purely local, purely fun — hitting one sends it flying with a
// spark and it respawns half a minute later.

import { terrainHeight, RAMPS, CITY } from '../shared/terrain.js';

export const CONE_RADIUS = 1.4; // knock distance from car center

function cone(x, z) {
  return {
    x,
    z,
    y: terrainHeight(x, z),
    knocked: false,
    resetAt: 0,
    // flight state while knocked
    px: 0, py: 0, pz: 0,
    vx: 0, vy: 0, vz: 0,
    spin: 0,
    rot: 0,
  };
}

function makeCones() {
  const list = [];
  // slalom line on the highway approach into the city
  for (let i = 0; i < 8; i++) {
    list.push(cone(150 + 38 + i * 9, i % 2 ? 3.4 : -3.4));
  }
  // a pair marking the low edge of every stunt ramp
  for (const r of RAMPS) {
    const ax = r.cos; // across-ramp direction
    const az = -r.sin;
    list.push(cone(r.x + ax * (r.w / 2 + 1.6), r.z + az * (r.w / 2 + 1.6)));
    list.push(cone(r.x - ax * (r.w / 2 + 1.6), r.z - az * (r.w / 2 + 1.6)));
  }
  // city main-street gateway
  for (const dz of [-8, 8]) list.push(cone(CITY.x - CITY.r - 6, dz));
  return list;
}

export const CONES = makeCones();

// Called by the local car's physics on contact. vx/vz = car velocity.
export function knockCone(c, vx, vz, speed) {
  c.knocked = true;
  c.resetAt = Date.now() + 28000;
  c.px = c.x;
  c.py = c.y;
  c.pz = c.z;
  c.vx = vx * 0.8 + (Math.random() - 0.5) * 3;
  c.vz = vz * 0.8 + (Math.random() - 0.5) * 3;
  c.vy = 4.5 + Math.min(9, Math.abs(speed) * 0.18);
  c.spin = (Math.random() - 0.5) * 14;
  c.rot = 0;
}
