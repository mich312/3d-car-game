import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import CarModel from './CarModel.jsx';
import { localState, remoteStates, sendBump } from '../net.js';
import { useStore } from '../store.js';
import {
  ARENA_HALF,
  OBSTACLES,
  BOOST_PADS,
  PAD_RADIUS,
  CAR_RADIUS,
  RACE_GATES,
} from '../../shared/config.js';

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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
    const down = (e) => {
      const k = map[e.code];
      if (k) {
        keys.current[k] = true;
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      }
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
  const pos = useRef(new THREE.Vector3(localState.p[0], 0, localState.p[2]));
  const vel = useRef(new THREE.Vector3());
  const yaw = useRef(localState.yaw);
  const nitro = useRef(100);
  const padCooldown = useRef(0);
  const hudTimer = useRef(0);

  // Refs consumed by CarModel for wheel/flame animation
  const speedRef = useRef(0);
  const steerRef = useRef(0);
  const boostRef = useRef(false);
  const driftRef = useRef(0);

  // Scratch vectors, allocated once
  const fwd = useRef(new THREE.Vector3());
  const tmp = useRef(new THREE.Vector3());
  const camGoal = useRef(new THREE.Vector3());

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20); // avoid physics explosions on tab-switch
    const k = keys.current;
    const p = pos.current;
    const v = vel.current;

    fwd.current.set(Math.sin(yaw.current), 0, Math.cos(yaw.current));
    let fSpeed = v.dot(fwd.current); // signed forward speed

    // --- boost ---
    const boosting = k.boost && nitro.current > 0 && fSpeed > 2;
    if (boosting) nitro.current = Math.max(0, nitro.current - NITRO_DRAIN * dt);
    else nitro.current = Math.min(100, nitro.current + NITRO_REGEN * dt);
    boostRef.current = boosting;

    // --- throttle ---
    const throttle = k.up ? 1 : 0;
    const brake = k.down ? 1 : 0;
    let thrust = throttle * ENGINE - brake * (fSpeed > 1 ? ENGINE * 0.9 : REVERSE);
    if (boosting) thrust += BOOST_THRUST;
    v.addScaledVector(fwd.current, thrust * dt);

    // --- drag ---
    v.multiplyScalar(1 / (1 + DRAG * dt));

    // --- grip: kill lateral velocity (less while drifting) ---
    fSpeed = v.dot(fwd.current);
    tmp.current.copy(fwd.current).multiplyScalar(fSpeed); // forward component
    const lat = v.sub(tmp.current); // v is now lateral only
    const grip = k.drift ? DRIFT_GRIP : GRIP;
    lat.multiplyScalar(1 / (1 + grip * dt));
    driftRef.current = clamp(lat.length() / 12, 0, 1);
    v.add(tmp.current); // recombine

    // --- speed caps ---
    const maxF = boosting ? BOOST_MAX_SPEED : MAX_SPEED;
    fSpeed = v.dot(fwd.current);
    if (fSpeed > maxF) v.addScaledVector(fwd.current, maxF - fSpeed);
    if (fSpeed < -12) v.addScaledVector(fwd.current, -12 - fSpeed);

    // --- steering ---
    const steer = (k.left ? 1 : 0) - (k.right ? 1 : 0);
    steerRef.current = steer;
    const speedFactor = clamp(Math.abs(fSpeed) / 8, 0, 1) * Math.sign(fSpeed || 1);
    yaw.current += steer * STEER_RATE * (k.drift ? 1.45 : 1) * speedFactor * dt;

    // --- integrate ---
    p.addScaledVector(v, dt);

    // --- walls ---
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
          v.x -= nx * vn * 1.6; // bounce with some energy loss
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

    // --- apply to scene ---
    if (group.current) {
      group.current.position.copy(p);
      group.current.rotation.y = yaw.current;
    }
    speedRef.current = fSpeed;

    // --- publish to network ---
    localState.p[0] = p.x;
    localState.p[1] = p.y;
    localState.p[2] = p.z;
    localState.yaw = yaw.current;
    localState.speed = fSpeed;
    localState.boost = boosting;

    // --- camera: chase from behind, widen FOV while boosting ---
    const camDist = 11 + Math.abs(fSpeed) * 0.10;
    camGoal.current
      .copy(p)
      .addScaledVector(fwd.current, -camDist)
      .add(tmp.current.set(0, 5.6 + Math.abs(fSpeed) * 0.03, 0));
    const smooth = 1 - Math.exp(-5.5 * dt);
    camera.position.lerp(camGoal.current, smooth);
    camera.lookAt(p.x, 1.6, p.z);
    const targetFov = boosting ? 74 : 62;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, 4 * dt);
      camera.updateProjectionMatrix();
    }

    // --- race mode: point the overhead arrow at my next gate ---
    if (gateArrow.current) {
      const st = useStore.getState();
      if (st.mode === 'race') {
        gateArrow.current.visible = true;
        const gate = RACE_GATES[(st.scores[st.myId] || 0) % RACE_GATES.length];
        // parent group is rotated by yaw, so aim relative to it
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
