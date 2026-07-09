import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

// Low-poly arcade car, front facing +Z.
// Animation inputs are refs so both the local car (physics) and remote cars
// (network interpolation) can drive wheels/flames without re-rendering React.
export default function CarModel({ color, name, speedRef, steerRef, boostRef, driftRef, infected }) {
  const body = useRef();
  const flameL = useRef();
  const flameR = useRef();
  const sickRing = useRef();
  const wheelSpin = useRef([]);
  const wheelSteer = useRef([]);

  const bodyColor = useMemo(() => new THREE.Color(color), [color]);

  useFrame((state, dt) => {
    const speed = speedRef?.current ?? 0;
    const steer = steerRef?.current ?? 0;
    const boosting = boostRef?.current ?? false;
    const drift = driftRef?.current ?? 0;

    const spin = (speed * dt) / 0.42;
    for (const w of wheelSpin.current) if (w) w.rotation.x += spin;
    for (const g of wheelSteer.current) {
      if (g) g.rotation.y += (steer * 0.45 - g.rotation.y) * Math.min(1, 12 * dt);
    }
    if (body.current) {
      // lean into corners, squat a little under boost
      const targetRoll = -steer * Math.min(Math.abs(speed) / 30, 1) * 0.12 - drift * 0.05;
      body.current.rotation.z += (targetRoll - body.current.rotation.z) * Math.min(1, 8 * dt);
      const targetPitch = boosting ? 0.03 : 0;
      body.current.rotation.x += (targetPitch - body.current.rotation.x) * Math.min(1, 6 * dt);
    }
    if (sickRing.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 6) * 0.12;
      sickRing.current.scale.setScalar(pulse);
    }
    const flicker = boosting ? 0.9 + Math.sin(state.clock.elapsedTime * 40) * 0.35 : 0;
    for (const f of [flameL.current, flameR.current]) {
      if (f) {
        f.visible = boosting;
        f.scale.setScalar(Math.max(0.001, flicker));
      }
    }
  });

  const wheelPositions = [
    { pos: [1.02, 0.42, 1.28], front: true },
    { pos: [-1.02, 0.42, 1.28], front: true },
    { pos: [1.02, 0.42, -1.3], front: false },
    { pos: [-1.02, 0.42, -1.3], front: false },
  ];

  return (
    <group>
      <group ref={body}>
        {/* chassis */}
        <mesh position={[0, 0.62, 0]} castShadow>
          <boxGeometry args={[1.9, 0.55, 4.1]} />
          <meshStandardMaterial color={bodyColor} roughness={0.35} metalness={0.35} />
        </mesh>
        {/* nose wedge */}
        <mesh position={[0, 0.52, 1.9]} castShadow>
          <boxGeometry args={[1.7, 0.34, 0.7]} />
          <meshStandardMaterial color={bodyColor} roughness={0.35} metalness={0.35} />
        </mesh>
        {/* cabin */}
        <mesh position={[0, 1.08, -0.25]} castShadow>
          <boxGeometry args={[1.5, 0.52, 1.9]} />
          <meshStandardMaterial color="#101426" roughness={0.15} metalness={0.7} />
        </mesh>
        {/* spoiler */}
        <mesh position={[0, 1.18, -1.95]} castShadow>
          <boxGeometry args={[1.9, 0.1, 0.5]} />
          <meshStandardMaterial color={bodyColor} roughness={0.4} />
        </mesh>
        <mesh position={[0.7, 1.0, -1.95]}>
          <boxGeometry args={[0.1, 0.3, 0.3]} />
          <meshStandardMaterial color="#101426" />
        </mesh>
        <mesh position={[-0.7, 1.0, -1.95]}>
          <boxGeometry args={[0.1, 0.3, 0.3]} />
          <meshStandardMaterial color="#101426" />
        </mesh>
        {/* headlights */}
        <mesh position={[0.6, 0.62, 2.06]}>
          <boxGeometry args={[0.34, 0.16, 0.08]} />
          <meshStandardMaterial emissive="#fff7c9" emissiveIntensity={2.5} color="#fff7c9" toneMapped={false} />
        </mesh>
        <mesh position={[-0.6, 0.62, 2.06]}>
          <boxGeometry args={[0.34, 0.16, 0.08]} />
          <meshStandardMaterial emissive="#fff7c9" emissiveIntensity={2.5} color="#fff7c9" toneMapped={false} />
        </mesh>
        {/* taillights */}
        <mesh position={[0, 0.66, -2.07]}>
          <boxGeometry args={[1.5, 0.14, 0.06]} />
          <meshStandardMaterial emissive="#ff2038" emissiveIntensity={1.8} color="#ff2038" toneMapped={false} />
        </mesh>
        {/* boost flames */}
        <mesh ref={flameL} position={[0.45, 0.5, -2.45]} rotation-x={-Math.PI / 2} visible={false}>
          <coneGeometry args={[0.22, 1.1, 8]} />
          <meshBasicMaterial color="#63c8ff" toneMapped={false} transparent opacity={0.9} />
        </mesh>
        <mesh ref={flameR} position={[-0.45, 0.5, -2.45]} rotation-x={-Math.PI / 2} visible={false}>
          <coneGeometry args={[0.22, 1.1, 8]} />
          <meshBasicMaterial color="#63c8ff" toneMapped={false} transparent opacity={0.9} />
        </mesh>
      </group>

      {/* wheels */}
      {wheelPositions.map((w, i) => (
        <group
          key={i}
          position={w.pos}
          ref={(el) => {
            if (w.front) wheelSteer.current[i] = el;
          }}
        >
          <mesh
            ref={(el) => (wheelSpin.current[i] = el)}
            rotation-z={Math.PI / 2}
            castShadow
          >
            <cylinderGeometry args={[0.42, 0.42, 0.32, 14]} />
            <meshStandardMaterial color="#15161c" roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* infection aura (tag mode) */}
      {infected && (
        <mesh ref={sickRing} rotation-x={-Math.PI / 2} position={[0, 0.15, 0]}>
          <ringGeometry args={[2.0, 2.7, 24]} />
          <meshBasicMaterial color="#39ff6a" transparent opacity={0.65} toneMapped={false} />
        </mesh>
      )}

      {name && (
        <Html position={[0, 2.7, 0]} center occlude={false} zIndexRange={[10, 0]}>
          <div className="nameplate" style={{ borderColor: infected ? '#39ff6a' : color }}>
            {infected ? '🧟 ' : ''}
            {name}
          </div>
        </Html>
      )}
    </group>
  );
}
