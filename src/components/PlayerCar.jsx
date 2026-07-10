import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import CarModel from './CarModel.jsx';
import { localState, remoteStates, sendBump, sendPortal, sendTrick } from '../net.js';
import { burstFX, addShake, shake } from '../fx.js';
import { useStore } from '../store.js';
import {
  ARENA_HALF,
  OBSTACLES,
  BOOST_PADS,
  PAD_RADIUS,
  CAR_RADIUS,
  RACE_GATES,
  HUB_PORTALS,
  PORTAL_RADIUS,
  ARENA_EXIT,
  GAMES,
  CAR_TYPES,
  DEFAULT_CAR,
} from '../../shared/config.js';
import {
  hubHeight,
  hubGradient,
  hubNormal,
  decorationsForChunk,
  CHUNK_SIZE,
  WATER_LEVEL,
  CITY,
  BUILDINGS,
} from '../../shared/terrain.js';

// Tuning
const ENGINE = 46; // forward acceleration
const REVERSE = 22;
const MAX_SPEED = 30;
const BOOST_MAX_SPEED = 46;
const BOOST_THRUST = 34; // extra accel while boosting
const DRAG = 0.9; // velocity decay per second
const GRIP = 8.0; // how fast lateral slip dies normally
const DRIFT_GRIP = 2.1; // ...and while drifting
const STEER_RATE = 2.7;
const NITRO_DRAIN = 38; // per second
const NITRO_REGEN = 9; // per second
const GRAVITY = 30;
const SLOPE_PULL = 11; // downhill acceleration on terrain

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const UP = new THREE.Vector3(0, 1, 0);

// Crystals in the hub double as charging stations: touching one refills
// nitro and pays a couple of coins (per-crystal cooldown).
const crystalCache = new Map(); // "cx,cz" -> crystal list
const crystalCooldown = new Map(); // "cx,cz,i" -> timestamp
function chargeCrystals(px, pz, onCharge) {
  const cx = Math.floor(px / CHUNK_SIZE);
  const cz = Math.floor(pz / CHUNK_SIZE);
  const key = cx + ',' + cz;
  let crystals = crystalCache.get(key);
  if (!crystals) {
    crystals = decorationsForChunk(cx, cz).crystals;
    crystalCache.set(key, crystals);
    if (crystalCache.size > 200) crystalCache.clear(); // crude LRU
  }
  const now = performance.now();
  for (let i = 0; i < crystals.length; i++) {
    const c = crystals[i];
    const dx = px - c.x;
    const dz = pz - c.z;
    if (dx * dx + dz * dz < 3.2 * 3.2) {
      const ck = key + ',' + i;
      if ((crystalCooldown.get(ck) || 0) > now) continue;
      crystalCooldown.set(ck, now + 60000);
      onCharge();
    }
  }
}

function useKeys() {
  const keys = useRef({ up: false, down: false, left: false, right: false, boost: false, drift: false });
  useEffect(() => {
    const map = {
      KeyW: 'up',
      ArrowUp: 'up',
      KeyS: 'down',
      ArrowDown: 'down',
      KeyA: 'left',
      ArrowLeft: 'left',
      KeyD: 'right',
      ArrowRight: 'right',
      ShiftLeft: 'boost',
      ShiftRight: 'boost',
      Space: 'drift',
    };
    // quick travel: 1-4 jump into a minigame, 0 returns to the hub
    const travel = { Digit1: GAMES[0], Digit2: GAMES[1], Digit3: GAMES[2], Digit4: GAMES[3], Digit0: 'hub' };
    const down = (e) => {
      const k = map[e.code];
      if (k) {
        keys.current[k] = true;
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      }
      if (travel[e.code]) sendPortal(travel[e.code]);
    };
    const up = (e) => {
      const k = map[e.code];
      if (k) keys.current[k] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  return keys;
}

export default function PlayerCar() {
  const group = useRef();
  const keys = useKeys();
  const { camera } = useThree();

  const myId = useStore((s) => s.myId);
  const color = useStore((s) => (s.myId ? s.players[s.myId]?.color : '#ff4757')) || '#ff4757';
  const infected = useStore((s) => s.mode === 'tag' && s.infected.includes(s.myId));
  const carType = useStore((s) => s.carType);
  const stats = (CAR_TYPES[carType] || CAR_TYPES[DEFAULT_CAR]).stats;
  const gateArrow = useRef();

  // Mutable physics state (never triggers React)
  const pos = useRef(new THREE.Vector3(localState.p[0], localState.p[1], localState.p[2]));
  const vel = useRef(new THREE.Vector3());
  const vy = useRef(0);
  const yaw = useRef(localState.yaw);
  const nitro = useRef(100);
  const padCooldown = useRef(0);
  const portalCooldown = useRef(1.5);
  const hudTimer = useRef(0);
  const epoch = useRef(-1);
  const crashRef = useRef({ mag: 0, t: 0 }); // CarModel body wobble after hits
  const flashCooldown = useRef(0); // throttle the HUD impact flash
  const air = useRef({ active: false, t: 0, x: 0, z: 0 }); // hub jump tracking

  // Refs consumed by CarModel for wheel/flame animation
  const speedRef = useRef(0);
  const steerRef = useRef(0);
  const boostRef = useRef(false);
  const driftRef = useRef(0);

  // Scratch objects, allocated once
  const fwd = useRef(new THREE.Vector3());
  const tmp = useRef(new THREE.Vector3());
  const camGoal = useRef(new THREE.Vector3());
  const grad = useRef({ x: 0, z: 0 });
  const nrm = useRef({ x: 0, y: 1, z: 0 });
  const nrmV = useRef(new THREE.Vector3(0, 1, 0));
  const qYaw = useRef(new THREE.Quaternion());
  const qTilt = useRef(new THREE.Quaternion());
  const qGoal = useRef(new THREE.Quaternion());

  useFrame((state, rawDt) => {
    const st = useStore.getState();
    const inHub = st.mode === 'hub';
    const k = keys.current;
    const p = pos.current;
    const v = vel.current;
    let fSpeed = 0;
    let boosting = false;

    // Crash feedback: sparks + shockwave at the contact point, camera shake,
    // body wobble, and (for hard hits) a red screen flash. `power` is the
    // speed lost along the contact normal.
    const onImpact = (power, x, y, z, nx, nz, color) => {
      if (power < 7) return;
      const k = clamp((power - 7) / 28, 0, 1);
      addShake(0.22 + k * 0.5);
      crashRef.current.mag = Math.min(1, 0.35 + k);
      crashRef.current.t = 0;
      burstFX(x, y, z, {
        kind: 'sparks',
        count: Math.round(10 + k * 24),
        color: color || '#ffcf6e',
        nx,
        nz,
        speed: 7 + power * 0.6,
        size: 0.24,
        ttl: 0.7,
      });
      if (power > 14) {
        burstFX(x, y, z, { kind: 'ring', color: '#ffffff', size: 1.2 + k * 1.6 });
        if (flashCooldown.current <= 0) {
          flashCooldown.current = 0.5;
          st.impact();
        }
      }
    };

    // Big-air bookkeeping: dust + shake on touchdown, records past 1s of air.
    const onLanding = (airTime, dist, vyImpact) => {
      const hard = clamp(Math.abs(vyImpact) / 34, 0, 1);
      burstFX(p.x, p.y + 0.2, p.z, {
        kind: 'sparks',
        count: Math.round(8 + airTime * 8),
        color: '#9aa4c4',
        speed: 5 + hard * 6,
        up: 0.5,
        gravity: 5,
        drag: 3,
        grow: 2.6,
        ttl: 0.8,
        size: 0.42,
      });
      addShake(0.12 + hard * 0.4);
      if (hard > 0.5) {
        crashRef.current.mag = Math.min(1, hard);
        crashRef.current.t = 0;
      }
      if (airTime >= 0.8) {
        useStore.getState().landJump(airTime, dist);
        sendTrick(airTime, dist);
      }
    };

    // hard teleport after a room switch (net.js already updated localState)
    if (st.roomEpoch !== epoch.current) {
      epoch.current = st.roomEpoch;
      p.set(localState.p[0], localState.p[1], localState.p[2]);
      if (st.mode === 'hub') p.y = hubHeight(p.x, p.z);
      v.set(0, 0, 0);
      vy.current = 0;
      yaw.current = localState.yaw;
      air.current.active = false;
      air.current.t = 0;
      portalCooldown.current = 2;
      camera.position.set(p.x - Math.sin(yaw.current) * 12, p.y + 7, p.z - Math.cos(yaw.current) * 12);
    }

    // One fixed-size physics step. Sub-stepping below keeps simulation speed
    // identical regardless of frame rate — a 10fps machine must not drive a
    // slower (or through-walls faster) car than a 144fps one.
    const stepPhysics = (dt) => {
    fwd.current.set(Math.sin(yaw.current), 0, Math.cos(yaw.current));
    fSpeed = v.dot(fwd.current); // signed forward speed

    const groundH = inHub ? hubHeight(p.x, p.z) : 0;
    const grounded = p.y <= groundH + 0.25;
    const inWater = inHub && groundH < WATER_LEVEL && p.y < WATER_LEVEL + 0.5;

    // --- boost ---
    boosting = k.boost && nitro.current > 0 && fSpeed > 2 && !inWater;
    if (boosting) nitro.current = Math.max(0, nitro.current - (NITRO_DRAIN / stats.nitro) * dt);
    else nitro.current = Math.min(100, nitro.current + NITRO_REGEN * dt);
    boostRef.current = boosting;

    // --- throttle (weak in the air, sluggish in water) ---
    const engine = ENGINE * stats.accel;
    const throttle = k.up ? 1 : 0;
    const brake = k.down ? 1 : 0;
    let thrust = throttle * engine - brake * (fSpeed > 1 ? engine * 0.9 : REVERSE);
    if (boosting) thrust += BOOST_THRUST * stats.accel;
    if (!grounded) thrust *= 0.12;
    if (inWater) thrust *= 0.35;
    v.addScaledVector(fwd.current, thrust * dt);

    // --- drag ---
    const drag = inWater ? DRAG + 2.6 : DRAG;
    v.multiplyScalar(1 / (1 + drag * dt));

    // --- grip: kill lateral velocity (less while drifting, none airborne) ---
    fSpeed = v.dot(fwd.current);
    tmp.current.copy(fwd.current).multiplyScalar(fSpeed);
    const lat = v.sub(tmp.current); // v is now lateral only
    const grip = (!grounded ? 0.4 : k.drift ? DRIFT_GRIP : GRIP) * stats.grip;
    lat.multiplyScalar(1 / (1 + grip * dt));
    driftRef.current = clamp(lat.length() / 12, 0, 1);
    v.add(tmp.current);

    // --- terrain slope pulls you downhill (hub, grounded only) ---
    if (inHub) hubGradient(p.x, p.z, grad.current);
    if (inHub && grounded) {
      v.x -= grad.current.x * SLOPE_PULL * dt;
      v.z -= grad.current.z * SLOPE_PULL * dt;
    }

    // --- speed caps ---
    const maxF = (boosting ? BOOST_MAX_SPEED : MAX_SPEED) * stats.speed;
    fSpeed = v.dot(fwd.current);
    if (fSpeed > maxF) v.addScaledVector(fwd.current, maxF - fSpeed);
    if (fSpeed < -12) v.addScaledVector(fwd.current, -12 - fSpeed);

    // --- steering (reduced mid-air) ---
    const steer = (k.left ? 1 : 0) - (k.right ? 1 : 0);
    steerRef.current = steer;
    const speedFactor = clamp(Math.abs(fSpeed) / 8, 0, 1) * Math.sign(fSpeed || 1);
    const airFactor = grounded ? 1 : 0.35;
    yaw.current += steer * STEER_RATE * (k.drift ? 1.45 : 1) * speedFactor * airFactor * dt;

    // --- integrate planar + vertical ---
    p.x += v.x * dt;
    p.z += v.z * dt;
    if (inHub) {
      if (grounded) {
        // follow the slope: climb rate = gradient · velocity. Rolling ground
        // stays glued; cresting a ridge at speed carries upward vy into a
        // real jump instead of stuttering micro-airborne on every downhill.
        vy.current = grad.current.x * v.x + grad.current.z * v.z;
      } else {
        vy.current -= GRAVITY * dt;
        // clock the jump for air-time records
        if (!air.current.active) {
          air.current.active = true;
          air.current.t = 0;
          air.current.x = p.x;
          air.current.z = p.z;
        }
        air.current.t += dt;
      }
      p.y += vy.current * dt;
      const h = hubHeight(p.x, p.z);
      if (p.y <= h) {
        if (air.current.active && air.current.t > 0.45) {
          onLanding(
            air.current.t,
            Math.hypot(p.x - air.current.x, p.z - air.current.z),
            vy.current
          );
        }
        air.current.active = false;
        p.y = h;
        vy.current = 0;
      }
    } else {
      p.y = 0;
      vy.current = 0;
    }

    portalCooldown.current -= dt;

    if (inHub) {
      // --- crystal charging stations ---
      chargeCrystals(p.x, p.z, () => {
        nitro.current = 100;
        useStore.getState().earn(2, 'crystal charge!');
      });

      // --- hub portals: drive through a ring to enter its minigame ---
      if (portalCooldown.current <= 0) {
        for (const portal of HUB_PORTALS) {
          const dx = p.x - portal.x;
          const dz = p.z - portal.z;
          if (dx * dx + dz * dz < PORTAL_RADIUS * PORTAL_RADIUS) {
            portalCooldown.current = 3;
            sendPortal(portal.game);
            break;
          }
        }
      }

      // --- Neon Heights buildings: circle vs AABB, skipped when airborne
      //     above the roofline ---
      const dcx = p.x - CITY.x;
      const dcz = p.z - CITY.z;
      if (dcx * dcx + dcz * dcz < (CITY.r + 30) ** 2) {
        for (const b of BUILDINGS) {
          if (p.y > CITY.h + b.h) continue;
          const nx0 = clamp(p.x, b.x - b.w / 2, b.x + b.w / 2);
          const nz0 = clamp(p.z, b.z - b.d / 2, b.z + b.d / 2);
          let dx = p.x - nx0;
          let dz = p.z - nz0;
          let d2 = dx * dx + dz * dz;
          if (d2 >= CAR_RADIUS * CAR_RADIUS) continue;
          let nx, nz;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            nx = dx / d;
            nz = dz / d;
            p.x = nx0 + nx * CAR_RADIUS;
            p.z = nz0 + nz * CAR_RADIUS;
          } else {
            // center inside the box: push out along the shallowest axis
            const px = b.w / 2 - Math.abs(p.x - b.x);
            const pz = b.d / 2 - Math.abs(p.z - b.z);
            if (px < pz) {
              nx = Math.sign(p.x - b.x) || 1;
              nz = 0;
              p.x = b.x + nx * (b.w / 2 + CAR_RADIUS);
            } else {
              nx = 0;
              nz = Math.sign(p.z - b.z) || 1;
              p.z = b.z + nz * (b.d / 2 + CAR_RADIUS);
            }
          }
          const vn = v.x * nx + v.z * nz;
          if (vn < 0) {
            onImpact(-vn, p.x - nx * CAR_RADIUS, p.y + 0.6, p.z - nz * CAR_RADIUS, nx, nz, '#8fd0ff');
            v.x -= nx * vn * 1.6;
            v.z -= nz * vn * 1.6;
            v.multiplyScalar(0.82);
          }
        }
      }
    } else {
      // --- arena walls ---
      const lim = ARENA_HALF - 2;
      if (p.x > lim) { p.x = lim; if (v.x > 0) { onImpact(v.x, p.x + 1.2, p.y + 0.6, p.z, -1, 0); v.x *= -0.45; } }
      if (p.x < -lim) { p.x = -lim; if (v.x < 0) { onImpact(-v.x, p.x - 1.2, p.y + 0.6, p.z, 1, 0); v.x *= -0.45; } }
      if (p.z > lim) { p.z = lim; if (v.z > 0) { onImpact(v.z, p.x, p.y + 0.6, p.z + 1.2, 0, -1); v.z *= -0.45; } }
      if (p.z < -lim) { p.z = -lim; if (v.z < 0) { onImpact(-v.z, p.x, p.y + 0.6, p.z - 1.2, 0, 1); v.z *= -0.45; } }

      // --- pillars ---
      for (const o of OBSTACLES) {
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const d = Math.hypot(dx, dz);
        const min = o.r + CAR_RADIUS;
        if (d < min && d > 0.0001) {
          const nx = dx / d;
          const nz = dz / d;
          p.x = o.x + nx * min;
          p.z = o.z + nz * min;
          const vn = v.x * nx + v.z * nz;
          if (vn < 0) {
            onImpact(-vn, p.x - nx * CAR_RADIUS, p.y + 0.6, p.z - nz * CAR_RADIUS, nx, nz);
            v.x -= nx * vn * 1.6;
            v.z -= nz * vn * 1.6;
            v.multiplyScalar(0.85);
          }
        }
      }

      // --- boost pads ---
      padCooldown.current -= dt;
      for (const pad of BOOST_PADS) {
        const dx = p.x - pad.x;
        const dz = p.z - pad.z;
        if (dx * dx + dz * dz < PAD_RADIUS * PAD_RADIUS && padCooldown.current <= 0) {
          padCooldown.current = 1.2;
          nitro.current = 100;
          tmp.current.set(Math.sin(pad.angle), 0, Math.cos(pad.angle));
          v.addScaledVector(tmp.current, 22);
        }
      }

      // --- exit portal back to the hub ---
      if (portalCooldown.current <= 0) {
        const dx = p.x - ARENA_EXIT.x;
        const dz = p.z - ARENA_EXIT.z;
        if (dx * dx + dz * dz < PORTAL_RADIUS * PORTAL_RADIUS) {
          portalCooldown.current = 3;
          sendPortal('hub');
        }
      }

      // --- car vs car: push self out, report hard hits for coin steals ---
      for (const [id, rs] of remoteStates) {
        const dx = p.x - rs.p[0];
        const dz = p.z - rs.p[2];
        const d = Math.hypot(dx, dz);
        const min = CAR_RADIUS * 2;
        if (d < min && d > 0.0001) {
          const nx = dx / d;
          const nz = dz / d;
          p.x += nx * (min - d);
          p.z += nz * (min - d);
          const vn = v.x * nx + v.z * nz;
          if (vn < 0) {
            // sparks fly in the paint colors at the midpoint between cars
            onImpact(-vn * 1.4, (p.x + rs.p[0]) / 2, p.y + 0.7, (p.z + rs.p[2]) / 2, nx, nz, '#ffe08a');
            v.x -= nx * vn * 1.4;
            v.z -= nz * vn * 1.4;
          }
          if (Math.abs(fSpeed) > 16) sendBump(id);
        }
      }
    }

    }; // end stepPhysics

    let remaining = Math.min(rawDt, 0.12); // cap catch-up after tab switches
    while (remaining > 1e-4) {
      stepPhysics(Math.min(remaining, 1 / 50));
      remaining -= 1 / 50;
    }
    const frameDt = Math.min(rawDt, 0.12);

    // --- pose: yaw + terrain tilt ---
    if (group.current) {
      group.current.position.copy(p);
      qYaw.current.setFromAxisAngle(UP, yaw.current);
      const groundedNow = !inHub || p.y <= hubHeight(p.x, p.z) + 0.25;
      if (inHub && groundedNow) {
        hubNormal(p.x, p.z, nrm.current);
        nrmV.current.set(nrm.current.x, nrm.current.y, nrm.current.z);
        qTilt.current.setFromUnitVectors(UP, nrmV.current);
        qGoal.current.multiplyQuaternions(qTilt.current, qYaw.current);
      } else {
        qGoal.current.copy(qYaw.current);
      }
      group.current.quaternion.slerp(qGoal.current, Math.min(1, 10 * frameDt));
    }
    speedRef.current = fSpeed;

    // --- publish to network ---
    localState.p[0] = p.x;
    localState.p[1] = p.y;
    localState.p[2] = p.z;
    localState.yaw = yaw.current;
    localState.speed = fSpeed;
    localState.boost = boosting;

    // --- camera: chase from behind, terrain-aware, FOV kick on boost ---
    const camDist = 11 + Math.abs(fSpeed) * 0.1;
    camGoal.current
      .copy(p)
      .addScaledVector(fwd.current, -camDist)
      .add(tmp.current.set(0, 5.6 + Math.abs(fSpeed) * 0.03, 0));
    if (inHub) {
      const camFloor = hubHeight(camGoal.current.x, camGoal.current.z) + 2.2;
      if (camGoal.current.y < camFloor) camGoal.current.y = camFloor;
    }
    const smooth = 1 - Math.exp(-5.5 * frameDt);
    camera.position.lerp(camGoal.current, smooth);

    // --- crash shake: trauma decays, amplitude follows trauma² ---
    flashCooldown.current -= frameDt;
    let lookJitter = 0;
    if (shake.trauma > 0) {
      shake.trauma = Math.max(0, shake.trauma - 1.9 * frameDt);
      const s2 = shake.trauma * shake.trauma;
      const tt = state.clock.elapsedTime;
      camera.position.x += Math.sin(tt * 91) * s2 * 0.8;
      camera.position.y += Math.sin(tt * 113 + 2) * s2 * 0.6;
      camera.position.z += Math.cos(tt * 97 + 4) * s2 * 0.8;
      lookJitter = Math.sin(tt * 127) * s2 * 0.5;
    }
    camera.lookAt(p.x + lookJitter, p.y + 1.6, p.z + lookJitter);
    const targetFov = boosting ? 74 : 62;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, 4 * frameDt);
      camera.updateProjectionMatrix();
    }

    // --- race mode: point the overhead arrow at my next gate ---
    if (gateArrow.current) {
      if (st.mode === 'race') {
        gateArrow.current.visible = true;
        const gate = RACE_GATES[(st.scores[st.myId] || 0) % RACE_GATES.length];
        gateArrow.current.rotation.y = Math.atan2(gate.x - p.x, gate.z - p.z) - yaw.current;
      } else {
        gateArrow.current.visible = false;
      }
    }

    // --- HUD (throttled to ~8Hz) ---
    hudTimer.current -= frameDt;
    if (hudTimer.current <= 0) {
      hudTimer.current = 0.12;
      useStore.getState().setHud(Math.round(Math.abs(fSpeed) * 3.2), Math.round(nitro.current));
    }
  });

  if (!myId) return null;

  return (
    <group ref={group}>
      <CarModel
        color={color}
        carType={carType}
        speedRef={speedRef}
        steerRef={steerRef}
        boostRef={boostRef}
        driftRef={driftRef}
        crashRef={crashRef}
        infected={infected}
      />
      {/* next-gate pointer (race mode only) */}
      <group ref={gateArrow} position={[0, 3.4, 0]} visible={false}>
        <mesh rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.5, 1.5, 4]} />
          <meshStandardMaterial color="#3fd7ff" emissive="#3fd7ff" emissiveIntensity={1.8} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
