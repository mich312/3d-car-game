import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../store.js';

function Coin({ coin, index }) {
  const spinner = useRef();
  useFrame((state) => {
    const g = spinner.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.rotation.y = t * 2.4 + index;
    g.position.y = 1.4 + Math.sin(t * 2 + index * 1.7) * 0.35;
  });
  return (
    <group position={[coin.x, 0, coin.z]}>
      <group ref={spinner} position={[0, 1.4, 0]}>
        <mesh rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[1.0, 1.0, 0.22, 20]} />
          <meshStandardMaterial
            color="#ffd23f"
            emissive="#b8860b"
            emissiveIntensity={0.8}
            metalness={0.9}
            roughness={0.25}
          />
        </mesh>
      </group>
      {/* soft glow ring on the ground */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.6, 1.3, 24]} />
        <meshBasicMaterial color="#ffd23f" transparent opacity={0.25} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default function Coins() {
  const coins = useStore((s) => s.coins);
  const mode = useStore((s) => s.mode);
  if (mode !== 'coins') return null;
  return (
    <>
      {coins.map((c, i) => (
        <Coin key={c.id} coin={c} index={i} />
      ))}
    </>
  );
}
