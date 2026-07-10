import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import CarModel from './CarModel.jsx';
import { remoteStates } from '../net.js';
import { useStore } from '../store.js';
import { terrainNormal } from '../../shared/terrain.js';

const TWO_PI = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const lerpAngle = (a, b, t) => {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
};

function RemoteCar({ info }) {
  const infected = useStore((s) => s.mode === 'tag' && s.infected.includes(info.id));
  const group = useRef();
  const speedRef = useRef(0);
  const steerRef = useRef(0);
  const boostRef = useRef(false);
  const driftRef = useRef(0);
  const yawRef = useRef(0);
  const nrm = useRef({ x: 0, y: 1, z: 0 });
  const nrmV = useRef(new THREE.Vector3(0, 1, 0));
  const qYaw = useRef(new THREE.Quaternion());
  const qTilt = useRef(new THREE.Quaternion());
  const qGoal = useRef(new THREE.Quaternion());

  useFrame((_, dt) => {
    const s = remoteStates.get(info.id);
    const g = group.current;
    if (!s || !g) return;
    const t = Math.min(1, 12 * dt); // smooth toward the last known server state
    g.position.x += (s.p[0] - g.position.x) * t;
    g.position.y += (s.p[1] - g.position.y) * t;
    g.position.z += (s.p[2] - g.position.z) * t;
    const newYaw = lerpAngle(yawRef.current, s.yaw, t);
    // derive a steering value from yaw rate so remote wheels turn too
    const yawRate = dt > 0 ? (newYaw - yawRef.current) / dt : 0;
    steerRef.current += (Math.max(-1, Math.min(1, yawRate / 2.5)) - steerRef.current) * t;
    yawRef.current = newYaw;
    speedRef.current = s.speed;
    boostRef.current = !!s.boost;

    // pose: yaw + terrain tilt in the hub (same shared height field)
    qYaw.current.setFromAxisAngle(UP, newYaw);
    if (useStore.getState().mode === 'hub') {
      terrainNormal(g.position.x, g.position.z, nrm.current);
      nrmV.current.set(nrm.current.x, nrm.current.y, nrm.current.z);
      qTilt.current.setFromUnitVectors(UP, nrmV.current);
      qGoal.current.multiplyQuaternions(qTilt.current, qYaw.current);
    } else {
      qGoal.current.copy(qYaw.current);
    }
    g.quaternion.slerp(qGoal.current, t);
  });

  return (
    <group ref={group} position={[0, 0, 0]}>
      <CarModel
        color={info.color}
        name={info.name}
        carType={info.car}
        speedRef={speedRef}
        steerRef={steerRef}
        boostRef={boostRef}
        driftRef={driftRef}
        infected={infected}
      />
    </group>
  );
}

export default function RemoteCars() {
  const players = useStore((s) => s.players);
  const myId = useStore((s) => s.myId);
  return (
    <>
      {Object.values(players)
        .filter((p) => p.id !== myId)
        .map((p) => (
          <RemoteCar key={p.id} info={p} />
        ))}
    </>
  );
}
