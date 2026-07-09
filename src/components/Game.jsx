import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
import Arena from './Arena.jsx';
import Coins from './Coins.jsx';
import PlayerCar from './PlayerCar.jsx';
import RemoteCars from './RemoteCars.jsx';

export default function Game() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ fov: 62, near: 0.5, far: 900, position: [0, 40, -60] }}
    >
      <color attach="background" args={['#0a0f24']} />
      <fog attach="fog" args={['#131a38', 140, 480]} />
      <Sky
        distance={450000}
        sunPosition={[80, 12, -120]}
        turbidity={8}
        rayleigh={2.5}
        mieCoefficient={0.02}
        inclination={0.52}
      />
      <Stars radius={300} depth={60} count={2500} factor={5} fade speed={0.5} />

      <ambientLight intensity={0.75} color="#8fa8ff" />
      <directionalLight
        castShadow
        position={[70, 90, -50]}
        intensity={1.6}
        color="#ffe2b0"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-120}
        shadow-camera-right={120}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
        shadow-camera-far={320}
        shadow-bias={-0.0004}
      />
      <hemisphereLight args={['#7f9bea', '#2a2148', 0.9]} />

      <Arena />
      <Coins />
      <PlayerCar />
      <RemoteCars />
    </Canvas>
  );
}
