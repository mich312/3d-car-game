import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { CAR_TYPES, DEFAULT_CAR } from '../../shared/config.js';

// Low-poly arcade car, front facing +Z. The silhouette comes from the car
// type's shape config (garage cars look genuinely different).
// Animation inputs are refs so both the local car (physics) and remote cars
// (network interpolation) can drive wheels/flames without re-rendering React.
export default function CarModel({
  color,
  name,
  speedRef,
  steerRef,
  boostRef,
  driftRef,
  infected,
  carType = DEFAULT_CAR,
}) {
  const body = useRef();
  const flameL = useRef();
  const flameR = useRef();
  const sickRing = useRef();
  const wheelSpin = useRef([]);
  const wheelSteer = useRef([]);

  const bodyColor = useMemo(() => new THREE.Color(color), [color]);
  const glowColor = useMemo(() => new THREE.Color(color).multiplyScalar(2.2), [color]);
  const sh = (CAR_TYPES[carType] || CAR_TYPES[DEFAULT_CAR]).shape;
  const [bw, bh, bl] = sh.body;
  const wheelR = sh.wheelR;
  const bodyY = wheelR + bh / 2 + 0.16 + (sh.ride || 0);
  const cabinY = bodyY + bh / 2 + 0.24;
  const nose = bl / 2;

  useFrame((state, dt) => {
    const speed = speedRef?.current ?? 0;
    const steer = steerRef?.current ?? 0;
    const boosting = boostRef?.current ?? false;
    const drift = driftRef?.current ?? 0;

    const spin = (speed * dt) / wheelR;
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
    { pos: [bw / 2 + 0.1, wheelR, bl / 2 - 0.8], front: true },
    { pos: [-(bw / 2 + 0.1), wheelR, bl / 2 - 0.8], front: true },
    { pos: [bw / 2 + 0.1, wheelR, -(bl / 2 - 0.78)], front: false },
    { pos: [-(bw / 2 + 0.1), wheelR, -(bl / 2 - 0.78)], front: false },
  ];

  return (
    <group>
      <group ref={body}>
        {/* chassis: rounded edges + clearcoat showroom paint */}
        <RoundedBox args={[bw, bh, bl]} radius={Math.min(0.14, bh * 0.24)} smoothness={2} position={[0, bodyY, 0]} castShadow>
          <meshPhysicalMaterial
            color={bodyColor}
            metalness={0.65}
            roughness={0.28}
            clearcoat={1}
            clearcoatRoughness={0.12}
            envMapIntensity={1.1}
          />
        </RoundedBox>
        {/* nose wedge */}
        <RoundedBox args={[bw * 0.86, bh * 0.6, 0.7]} radius={0.08} smoothness={2} position={[0, bodyY - 0.08, nose - 0.15]} castShadow>
          <meshPhysicalMaterial
            color={bodyColor}
            metalness={0.65}
            roughness={0.28}
            clearcoat={1}
            clearcoatRoughness={0.12}
            envMapIntensity={1.1}
          />
        </RoundedBox>
        {/* cabin: dark reflective glass */}
        <RoundedBox args={[sh.cabinW, 0.5, bl * 0.45]} radius={0.12} smoothness={2} position={[0, cabinY, -0.25]} castShadow>
          <meshPhysicalMaterial color="#0b1020" metalness={1} roughness={0.07} envMapIntensity={1.5} />
        </RoundedBox>
        {/* muscle hood scoop */}
        {sh.scoop && (
          <mesh position={[0, bodyY + bh / 2 + 0.14, nose - 1.1]} castShadow>
            <boxGeometry args={[bw * 0.32, 0.28, 0.9]} />
            <meshStandardMaterial color="#101426" roughness={0.4} />
          </mesh>
        )}
        {/* spoiler */}
        {sh.spoiler && (
          <>
            <mesh position={[0, cabinY + 0.12, -(bl / 2 - 0.15)]} castShadow>
              <boxGeometry args={[bw, 0.1, 0.5]} />
              <meshStandardMaterial color={bodyColor} roughness={0.4} />
            </mesh>
            <mesh position={[bw * 0.35, cabinY - 0.08, -(bl / 2 - 0.15)]}>
              <boxGeometry args={[0.1, 0.3, 0.3]} />
              <meshStandardMaterial color="#101426" />
            </mesh>
            <mesh position={[-bw * 0.35, cabinY - 0.08, -(bl / 2 - 0.15)]}>
              <boxGeometry args={[0.1, 0.3, 0.3]} />
              <meshStandardMaterial color="#101426" />
            </mesh>
          </>
        )}
        {/* formula rear wing: taller, on struts */}
        {sh.wing && (
          <>
            <mesh position={[0, cabinY + 0.55, -(bl / 2 - 0.2)]} castShadow>
              <boxGeometry args={[bw + 0.7, 0.09, 0.6]} />
              <meshStandardMaterial color="#101426" roughness={0.3} metalness={0.5} />
            </mesh>
            <mesh position={[bw * 0.3, cabinY + 0.22, -(bl / 2 - 0.2)]}>
              <boxGeometry args={[0.08, 0.6, 0.12]} />
              <meshStandardMaterial color="#101426" />
            </mesh>
            <mesh position={[-bw * 0.3, cabinY + 0.22, -(bl / 2 - 0.2)]}>
              <boxGeometry args={[0.08, 0.6, 0.12]} />
              <meshStandardMaterial color="#101426" />
            </mesh>
          </>
        )}
        {/* headlights */}
        <mesh position={[bw * 0.3, bodyY, nose + 0.16]}>
          <boxGeometry args={[0.34, 0.16, 0.08]} />
          <meshStandardMaterial emissive="#fff7c9" emissiveIntensity={2.5} color="#fff7c9" toneMapped={false} />
        </mesh>
        <mesh position={[-bw * 0.3, bodyY, nose + 0.16]}>
          <boxGeometry args={[0.34, 0.16, 0.08]} />
          <meshStandardMaterial emissive="#fff7c9" emissiveIntensity={2.5} color="#fff7c9" toneMapped={false} />
        </mesh>
        {/* taillights */}
        <mesh position={[0, bodyY + 0.05, -(bl / 2 + 0.02)]}>
          <boxGeometry args={[bw * 0.75, 0.14, 0.06]} />
          <meshStandardMaterial emissive="#ff2038" emissiveIntensity={1.8} color="#ff2038" toneMapped={false} />
        </mesh>
        {/* boost flames */}
        <mesh ref={flameL} position={[bw * 0.22, bodyY - 0.1, -(bl / 2 + 0.4)]} rotation-x={-Math.PI / 2} visible={false}>
          <coneGeometry args={[0.22, 1.1, 8]} />
          <meshBasicMaterial color="#63c8ff" toneMapped={false} transparent opacity={0.9} />
        </mesh>
        <mesh ref={flameR} position={[-bw * 0.22, bodyY - 0.1, -(bl / 2 + 0.4)]} rotation-x={-Math.PI / 2} visible={false}>
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
          <group ref={(el) => (wheelSpin.current[i] = el)}>
            <mesh rotation-z={Math.PI / 2} castShadow>
              <cylinderGeometry args={[wheelR, wheelR, 0.32 + wheelR * 0.25, 14]} />
              <meshStandardMaterial color="#15161c" roughness={0.9} />
            </mesh>
            {/* chrome hubcap */}
            <mesh rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[wheelR * 0.5, wheelR * 0.5, 0.34 + wheelR * 0.25, 8]} />
              <meshStandardMaterial color="#c9d4e8" metalness={1} roughness={0.22} envMapIntensity={1.3} />
            </mesh>
          </group>
        </group>
      ))}

      {/* neon underglow in the paint color (HDR color feeds the bloom pass) */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.09, 0]}>
        <planeGeometry args={[bw + 0.25, bl - 0.4]} />
        <meshBasicMaterial
          color={glowColor}
          transparent
          opacity={0.55}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>

      {/* infection aura (tag mode) */}
      {infected && (
        <mesh ref={sickRing} rotation-x={-Math.PI / 2} position={[0, 0.15, 0]}>
          <ringGeometry args={[2.0, 2.7, 24]} />
          <meshBasicMaterial color="#39ff6a" transparent opacity={0.65} toneMapped={false} />
        </mesh>
      )}

      {name && (
        <Html position={[0, cabinY + 1.7, 0]} center occlude={false} zIndexRange={[10, 0]}>
          <div className="nameplate" style={{ borderColor: infected ? '#39ff6a' : color }}>
            {infected ? '🧟 ' : ''}
            {name}
          </div>
        </Html>
      )}
    </group>
  );
}
