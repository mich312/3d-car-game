import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../store.js';
import { localState, remoteStates } from '../net.js';

// The crown: floats over whoever holds it, or spins at its ground position
// when loose. Shown only in crown mode.
export default function Crown() {
  const mode = useStore((s) => s.mode);
  const group = useRef();

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const { crown, myId } = useStore.getState();
    const t = state.clock.elapsedTime;
    let tx;
    let ty;
    let tz;
    if (crown.holder === myId) {
      tx = localState.p[0];
      ty = 3.4;
      tz = localState.p[2];
    } else if (crown.holder) {
      const rs = remoteStates.get(crown.holder);
      if (!rs) return;
      tx = rs.p[0];
      ty = 3.4;
      tz = rs.p[2];
    } else {
      tx = crown.x;
      ty = 2.2 + Math.sin(t * 2) * 0.4;
      tz = crown.z;
    }
    // snappy follow so it keeps up with a fleeing car
    const k = Math.min(1, 14 * dt);
    g.position.x += (tx - g.position.x) * k;
    g.position.y += (ty - g.position.y) * k;
    g.position.z += (tz - g.position.z) * k;
    g.rotation.y = t * 1.8;
  });

  if (mode !== 'crown') return null;

  return (
    <group ref={group}>
      {/* band */}
      <mesh castShadow>
        <cylinderGeometry args={[0.85, 1.0, 0.55, 8]} />
        <meshStandardMaterial color="#ffd23f" emissive="#c8930a" emissiveIntensity={0.9} metalness={0.9} roughness={0.2} />
      </mesh>
      {/* spikes */}
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.75, 0.62, Math.sin(a) * 0.75]}>
            <coneGeometry args={[0.22, 0.7, 4]} />
            <meshStandardMaterial color="#ffd23f" emissive="#c8930a" emissiveIntensity={0.9} metalness={0.9} roughness={0.2} />
          </mesh>
        );
      })}
      {/* jewel */}
      <mesh position={[0, 0.15, 1.0]}>
        <sphereGeometry args={[0.16, 8, 8]} />
        <meshStandardMaterial color="#ff2b6d" emissive="#ff2b6d" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
    </group>
  );
}
