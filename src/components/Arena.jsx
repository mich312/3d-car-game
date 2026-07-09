import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Grid, Html } from '@react-three/drei';
import {
  ARENA_HALF,
  WALL_HEIGHT,
  OBSTACLES,
  BOOST_PADS,
  PAD_RADIUS,
  ARENA_EXIT,
  PORTAL_RADIUS,
} from '../../shared/config.js';

const PILLAR_COLORS = ['#3b4a8f', '#41599e', '#35407f'];

// Green ring that takes you back to the open world.
function ExitPortal() {
  const disc = useRef();
  useFrame((_, dt) => {
    if (disc.current) disc.current.rotation.z -= dt * 1.6;
  });
  return (
    <group position={[ARENA_EXIT.x, 0, ARENA_EXIT.z]}>
      <mesh position={[0, 4.6, 0]} castShadow>
        <torusGeometry args={[PORTAL_RADIUS, 0.55, 12, 36]} />
        <meshStandardMaterial color="#0affa0" emissive="#0affa0" emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      <mesh ref={disc} position={[0, 4.6, 0]}>
        <circleGeometry args={[PORTAL_RADIUS - 0.4, 28]} />
        <meshBasicMaterial color="#0affa0" transparent opacity={0.25} side={2} toneMapped={false} />
      </mesh>
      <Html position={[0, 10.2, 0]} center occlude={false} zIndexRange={[10, 0]}>
        <div className="portal-sign" style={{ borderColor: '#0affa0' }}>
          <div className="portal-title" style={{ color: '#0affa0' }}>
            🌍 BACK TO WORLD
          </div>
        </div>
      </Html>
    </group>
  );
}

export default function Arena() {
  const size = ARENA_HALF * 2;

  const walls = useMemo(
    () => [
      { pos: [0, WALL_HEIGHT / 2, ARENA_HALF + 1], scale: [size + 4, WALL_HEIGHT, 2] },
      { pos: [0, WALL_HEIGHT / 2, -ARENA_HALF - 1], scale: [size + 4, WALL_HEIGHT, 2] },
      { pos: [ARENA_HALF + 1, WALL_HEIGHT / 2, 0], scale: [2, WALL_HEIGHT, size + 4] },
      { pos: [-ARENA_HALF - 1, WALL_HEIGHT / 2, 0], scale: [2, WALL_HEIGHT, size + 4] },
    ],
    [size]
  );

  return (
    <group>
      {/* Ground */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[size + 40, size + 40]} />
        <meshStandardMaterial color="#1d2547" roughness={0.9} metalness={0.1} />
      </mesh>
      <Grid
        position={[0, 0.03, 0]}
        args={[size, size]}
        cellSize={6}
        cellThickness={0.6}
        cellColor="#2a3b73"
        sectionSize={30}
        sectionThickness={1.2}
        sectionColor="#3fd7ff"
        fadeDistance={330}
        fadeStrength={1.5}
      />

      {/* Walls with a glowing rim */}
      {walls.map((w, i) => (
        <group key={i} position={w.pos}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={w.scale} />
            <meshStandardMaterial color="#232c58" roughness={0.7} />
          </mesh>
          <mesh position={[0, WALL_HEIGHT / 2 + 0.15, 0]}>
            <boxGeometry args={[w.scale[0], 0.3, w.scale[2]]} />
            <meshStandardMaterial
              color="#3fd7ff"
              emissive="#3fd7ff"
              emissiveIntensity={1.4}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      {/* Pillars */}
      {OBSTACLES.map((o, i) => (
        <group key={i} position={[o.x, 0, o.z]}>
          <mesh position={[0, 4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[o.r, o.r + 0.6, 8, 24]} />
            <meshStandardMaterial color={PILLAR_COLORS[i % PILLAR_COLORS.length]} roughness={0.55} />
          </mesh>
          <mesh position={[0, 7.2, 0]}>
            <cylinderGeometry args={[o.r + 0.15, o.r + 0.15, 0.5, 24]} />
            <meshStandardMaterial
              color="#ff5db1"
              emissive="#ff5db1"
              emissiveIntensity={1.2}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      <ExitPortal />

      {/* Boost pads */}
      {BOOST_PADS.map((p, i) => (
        <group key={i} position={[p.x, 0.06, p.z]} rotation-y={p.angle}>
          <mesh rotation-x={-Math.PI / 2}>
            <circleGeometry args={[PAD_RADIUS, 32]} />
            <meshStandardMaterial
              color="#0affa0"
              emissive="#0affa0"
              emissiveIntensity={0.9}
              transparent
              opacity={0.55}
              toneMapped={false}
            />
          </mesh>
          {/* chevron pointing along the launch direction (+z locally) */}
          <mesh position={[0, 0.35, 0.8]} rotation-x={Math.PI / 2}>
            <coneGeometry args={[1.6, 3.4, 3]} />
            <meshStandardMaterial
              color="#eafff4"
              emissive="#0affa0"
              emissiveIntensity={2}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
