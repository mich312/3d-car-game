import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import CarModel from './CarModel.jsx';
import { localState, remoteStates, sendBump, sendPortal } from '../net.js';
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
} from '../../shared/config.js';
import { terrainHeight, terrainGradient, terrainNormal, WATER_LEVEL } from '../../shared/terrain.js';

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
    const dt = Math.min(rawDt, 1 / 20); // avoid physics explosions on tab-switch
    const st = useStore.getState();
    const inHub = st.mode === 'hub';
    const k = keys.current;
    const p = pos.current;
    const v = vel.current;

    // hard teleport after a room switch (net.js already updated localState)
    if (st.roomEpoch !== epoch.current) {
      epoch.current = st.roomEpoch;
      p.set(localState.p[0], localState.p[1], localState.p[2]);
      if (st.mode === 'hub') p.y = terrainHeight(p.x, p.z);
      v.set(0, 0, 0);
      vy.current = 0;
      yaw.current = localState.yaw;
      portalCooldown.current = 2;
      camera.position.set(p.x - Math.sin(yaw.current) * 12, p.y + 7, p.z - Math.cos(yaw.current) * 12);
    }

    fwd.current.set(Math.sin(yaw.current), 0, Math.cos(yaw.current));
    let fSpeed = v.dot(fwd.current); // signed forward speed

    const groundH = inHub ? terrainHeight(p.x, p.z) : 0;
    const grounded = p.y <= groundH + 0.25;
    const inWater = inHub && groundH < WATER_LEVEL && p.y < WATER_LEVEL + 0.5;

    // --- boost ---
    const boosting = k.boost && nitro.current > 0 && fSpeed > 2 && !inWater;
    if (boosting) nitro.current = Math.max(0, nitro.current - NITRO_DRAIN * dt);
    else nitro.current = Math.min(100, nitro.current + NITRO_REGEN * dt);
    boostRef.current = boosting;

    // --- throttle (weak in the air, sluggish in water) ---
    const throttle = k.up ? 1 : 0;
    const brake = k.down ? 1 : 0;
    let thrust = throttle * ENGINE - brake * (fSpeed > 1 ? ENGINE * 0.9 : REVERSE);
    if (boosting) thrust += BOOST_THRUST;
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
    const grip = !grounded ? 0.4 : k.drift ? DRIFT_GRIP : GRIP;
    lat.multiplyScalar(1 / (1 + grip * dt));
    driftRef.current = clamp(lat.length() / 12, 0, 1);
    v.add(tmp.current);

    // --- terrain slope pulls you downhill (hub, grounded only) ---
    if (inHub && grounded) {
      terrainGradient(p.x, p.z, grad.current);
      v.x -= grad.current.x * SLOPE_PULL * dt;
      v.z -= grad.current.z * SLOPE_PULL * dt;
    }

    // --- speed caps ---
    const maxF = boosting ? BOOST_MAX_SPEED : MAX_SPEED;
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
      vy.current -= GRAVITY * dt;
      p.y += vy.current * dt;
      const h = terrainHeight(p.x, p.z);
      if (p.y <= h) {
        p.y = h;
        vy.current = 0;
      }
    } else {
      p.y = 0;
      vy.current = 0;
    }

    portalCooldown.current -= dt;

    if (inHub) {
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
    } else {
      // --- arena walls ---
      const lim = ARENA_HALF - 2;
      if (p.x > lim) { p.x = lim; if (v.x > 0) v.x *= -0.45; }
      if (p.x < -lim) { p.x = -lim; if (v.x < 0) v.x *= -0.45; }
      if (p.z > lim) { p.z = lim; if (v.z > 0) v.z *= -0.45; }
      if (p.z < -lim) { p.z = -lim; if (v.z < 0) v.z *= -0.45; }

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
            v.x -= nx * vn * 1.4;
            v.z -= nz * vn * 1.4;
          }
          if (Math.abs(fSpeed) > 16) sendBump(id);
        }
      }
    }

    // --- pose: yaw + terrain tilt ---
    if (group.current) {
      group.current.position.copy(p);
      qYaw.current.setFromAxisAngle(UP, yaw.current);
      if (inHub && grounded) {
        terrainNormal(p.x, p.z, nrm.current);
        nrmV.current.set(nrm.current.x, nrm.current.y, nrm.current.z);
        qTilt.current.setFromUnitVectors(UP, nrmV.current);
        qGoal.current.multiplyQuaternions(qTilt.current, qYaw.current);
      } else {
        qGoal.current.copy(qYaw.current);
      }
      group.current.quaternion.slerp(qGoal.current, Math.min(1, 10 * dt));
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
      const camFloor = terrainHeight(camGoal.current.x, camGoal.current.z) + 2.2;
      if (camGoal.current.y < camFloor) camGoal.current.y = camFloor;
    }
    const smooth = 1 - Math.exp(-5.5 * dt);
    camera.position.lerp(camGoal.current, smooth);
    camera.lookAt(p.x, p.y + 1.6, p.z);
    const targetFov = boosting ? 74 : 62;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, 4 * dt);
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
    hudTimer.current -= dt;
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
        speedRef={speedRef}
        steerRef={steerRef}
        boostRef={boostRef}
        driftRef={driftRef}
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
