import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import CarModel from './CarModel.jsx';
import { remoteStates } from '../net.js';
import { useStore } from '../store.js';

const TWO_PI = Math.PI * 2;
const lerpAngle = (a, b, t) => {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
};

function RemoteCar({ info }) {
  const group = useRef();
  const speedRef = useRef(0);
  const steerRef = useRef(0);
  const boostRef = useRef(false);
  const driftRef = useRef(0);
  const lastYaw = useRef(0);

  useFrame((_, dt) => {
    const s = remoteStates.get(info.id);
    const g = group.current;
    if (!s || !g) return;
    const t = Math.min(1, 12 * dt); // smooth toward the last known server state
    g.position.x += (s.p[0] - g.position.x) * t;
    g.position.y += (s.p[1] - g.position.y) * t;
    g.position.z += (s.p[2] - g.position.z) * t;
    const newYaw = lerpAngle(g.rotation.y, s.yaw, t);
    // derive a steering value from yaw rate so remote wheels turn too
    const yawRate = dt > 0 ? (newYaw - g.rotation.y) / dt : 0;
    steerRef.current += (Math.max(-1, Math.min(1, yawRate / 2.5)) - steerRef.current) * t;
    g.rotation.y = newYaw;
    lastYaw.current = newYaw;
    speedRef.current = s.speed;
    boostRef.current = !!s.boost;
  });

  return (
    <group ref={group} position={[0, 0, 0]}>
      <CarModel
        color={info.color}
        name={info.name}
        speedRef={speedRef}
        steerRef={steerRef}
        boostRef={boostRef}
        driftRef={driftRef}
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
