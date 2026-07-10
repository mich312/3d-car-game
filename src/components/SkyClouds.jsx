import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Clouds, Cloud } from '@react-three/drei';
import * as THREE from 'three';
import { localState } from '../net.js';

// A soft radial puff sprite, drawn locally to a data URL so clouds cost no
// download (drei's default sprite is a CDN fetch that fails offline / under a
// strict CSP).
function makeCloudSprite() {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return canvas.toDataURL();
}

// A scattered field of volumetric puffs, seeded once so the layout is stable.
// Kept far out and at a moderate altitude so they read as banks near the
// horizon in the chase camera rather than sitting directly overhead.
const FIELD = [
  { pos: [-300, 128, -240], bounds: [120, 12, 90], volume: 8, seed: 1 },
  { pos: [280, 150, -200], bounds: [130, 12, 90], volume: 9, seed: 2 },
  { pos: [-90, 138, 320], bounds: [120, 10, 90], volume: 8, seed: 3 },
  { pos: [340, 132, 260], bounds: [120, 12, 90], volume: 8, seed: 4 },
  { pos: [-340, 158, 140], bounds: [120, 12, 90], volume: 9, seed: 5 },
];

/**
 * A drifting cloud layer high above the world. The group follows the player so
 * clouds are always overhead in the infinite hub, with a slow circular sway
 * (plus each puff's own billow) reading as gentle wind — no wrap jumps.
 *
 * The puffs use drei's default lit MeshLambertMaterial, so the day/night sun
 * colours them automatically: white at noon, gold at dusk, dark blue at night.
 */
export default function SkyClouds() {
  const group = useRef();
  const base = useMemo(() => new THREE.Color('#eef3ff'), []);
  const sprite = useMemo(makeCloudSprite, []);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const [px, , pz] = localState.p;
    g.position.set(px + Math.sin(t * 0.018) * 45, 0, pz + Math.cos(t * 0.014) * 45);
  });

  return (
    <group ref={group}>
      <Clouds texture={sprite} material={THREE.MeshLambertMaterial} limit={400} frustumCulled={false}>
        {FIELD.map((c) => (
          <Cloud
            key={c.seed}
            seed={c.seed}
            position={c.pos}
            bounds={c.bounds}
            segments={22}
            volume={c.volume}
            growth={5}
            speed={0.26}
            opacity={0.7}
            color={base}
          />
        ))}
      </Clouds>
    </group>
  );
}
