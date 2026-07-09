import React, { useMemo } from 'react';
import { useStore } from '../store.js';
import { RACE_GATES } from '../../shared/config.js';

// Goal-post style race gates, shown only in race mode. The local player's
// next gate glows cyan with a light beam; the rest stay dim.
function Gate({ gate, angle, active }) {
  const color = active ? '#3fd7ff' : '#8a5cf6';
  const intensity = active ? 2.2 : 0.55;
  const w = 11;
  return (
    <group position={[gate.x, 0, gate.z]} rotation-y={angle}>
      {[-w / 2, w / 2].map((x) => (
        <mesh key={x} position={[x, 3, 0]} castShadow>
          <cylinderGeometry args={[0.45, 0.45, 6, 10]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 6.2, 0]}>
        <boxGeometry args={[w + 0.9, 0.5, 0.5]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} toneMapped={false} />
      </mesh>
      {active && (
        <mesh position={[0, 14, 0]}>
          <cylinderGeometry args={[w / 2, w / 2, 16, 20, 1, true]} />
          <meshBasicMaterial color="#3fd7ff" transparent opacity={0.08} depthWrite={false} side={2} />
        </mesh>
      )}
    </group>
  );
}

export default function Gates() {
  const mode = useStore((s) => s.mode);
  const myId = useStore((s) => s.myId);
  const myProgress = useStore((s) => s.scores[s.myId] || 0);

  // orient each gate to face the direction of travel (toward the next gate)
  const angles = useMemo(
    () =>
      RACE_GATES.map((g, i) => {
        const next = RACE_GATES[(i + 1) % RACE_GATES.length];
        return Math.atan2(next.x - g.x, next.z - g.z) + Math.PI / 2;
      }),
    []
  );

  if (mode !== 'race' || !myId) return null;
  const current = myProgress % RACE_GATES.length;

  return (
    <>
      {RACE_GATES.map((g, i) => (
        <Gate key={i} gate={g} angle={angles[i]} active={i === current} />
      ))}
    </>
  );
}
